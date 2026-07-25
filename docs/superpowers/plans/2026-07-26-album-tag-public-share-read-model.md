# Album Tag and Public Share Read Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace account-derived album tags and coupled public-list refreshes with canonical role references, immutable share items, ID-scoped media-state patches, and a four-event client read model.

**Architecture:** The API owns three focused units: `AlbumTagResolver`, `PublicShareManifest`, and `PublicMediaState`. The miniprogram owns a pure `PublicAlbumReadState`; pagination appends cards while media refresh patches existing cards, so neither operation can rebuild the other’s state.

**Tech Stack:** Node.js ES modules, MySQL 8 migrations, Node test runner, uni-app/Vue miniprogram, WeChat Developer Tools, GitHub Actions.

---

## Source of Truth

Read these together before every task:

- `specs/d57-album-tag-public-share-read-model/requirements.md`
- `specs/d57-album-tag-public-share-read-model/design.md`
- `specs/d57-album-tag-public-share-read-model/tasks.md`
- `docs/superpowers/specs/2026-07-26-album-tags-public-share-read-model-design.md`

Update `specs/d57-album-tag-public-share-read-model/tasks.md` at task start and completion. Do not revive `public_label`, prefix reload, a public pagination/refresh coordinator, or scroll-position compensation.

## File Map

### Database and migration

- Create `apps/api/migrations/0035_album_tag_public_share_read_model.sql`
- Modify `scripts/migration-filename-history.json`
- Modify migration registry/checksum tests only where the existing runner requires the new append-only entry
- Create `apps/api/test/album-tag-model.test.mjs`
- Create `apps/api/test/album-public-share-manifest.test.mjs`

### API domain modules

- Create `apps/api/src/modules/core/album-tags.js`
- Create `apps/api/src/modules/core/public-album-share-manifest.js`
- Create `apps/api/src/modules/core/public-album-media-state.js`
- Modify `apps/api/src/modules/core/service.js`
- Modify `apps/api/src/modules/album-image/repository.js`
- Modify `apps/api/src/legacy-app.js`
- Create `apps/api/test/album-public-media-state.test.mjs`
- Modify existing D48/D50/D54 API tests that still fixture the legacy label table or JSON-only manifest

### Miniprogram

- Create `apps/miniprogram/src/utils/publicAlbumReadState.js`
- Create `apps/miniprogram/test/publicAlbumReadState.test.mjs`
- Modify `apps/miniprogram/src/pages/session/album.vue`
- Modify `apps/miniprogram/src/utils/albumPublicSharePagination.js`
- Modify `apps/miniprogram/src/utils/albumMediaUrls.js` only to keep member refresh isolated from public media-state
- Modify relevant album tests

### Contracts

- Create `scripts/d57-album-tag-public-share-read-model-check.js`
- Modify `package.json`
- Modify D48/D50/D52/D54 spec paragraphs superseded by D57

---

### Task 1: Commit the D57 Spec Set and Record the Baseline

**Files:**
- Create: `specs/d57-album-tag-public-share-read-model/requirements.md`
- Create: `specs/d57-album-tag-public-share-read-model/design.md`
- Create: `specs/d57-album-tag-public-share-read-model/tasks.md`
- Create: `docs/superpowers/plans/2026-07-26-album-tag-public-share-read-model.md`

- [ ] **Step 1: Verify the rejected uncommitted patch is gone**

Run:

```bash
git status --short
```

Expected: only the new D57 spec and plan files are listed.

- [ ] **Step 2: Run the pre-D57 focused baseline**

Run:

```bash
npm run d51:migrations
npm run d48:check
npm run d50:unit
npm run d54:unit
npm run d54:check
npm run build:mp-weixin
```

Expected: all commands pass. If an existing command fails before D57 product edits, record the exact failure under Task 1.3 and stop before implementation.

- [ ] **Step 3: Self-review the spec set**

Run:

```bash
rg -n "TBD|TODO|implement later|fill in|待定" \
  specs/d57-album-tag-public-share-read-model \
  docs/superpowers/plans/2026-07-26-album-tag-public-share-read-model.md
git diff --check
```

Expected: no placeholders and no whitespace errors.

- [ ] **Step 4: Mark Task 1 complete and commit**

```bash
git add \
  specs/d57-album-tag-public-share-read-model \
  docs/superpowers/plans/2026-07-26-album-tag-public-share-read-model.md
git commit -m "docs: specify canonical album share read model"
```

---

### Task 2: Create the Normalized Tables and Trusted Backfill

**Files:**
- Create: `apps/api/migrations/0035_album_tag_public_share_read_model.sql`
- Modify: `scripts/migration-filename-history.json`
- Test: `apps/api/test/album-tag-model.test.mjs`
- Test: `apps/api/test/album-public-share-manifest.test.mjs`
- Test: `scripts/check-migration-filenames.test.mjs`

- [ ] **Step 1: Write failing migration structure tests**

Add tests that read migration 0035 and assert:

```js
assert.match(sql, /CREATE TABLE session_album_media_tags/);
assert.match(sql, /CREATE TABLE session_album_public_share_items/);
assert.match(sql, /GENERATED ALWAYS AS/);
assert.match(sql, /CHECK \\(/);
assert.match(sql, /JSON_TABLE/);
assert.doesNotMatch(backfillBlock, /tag\\.label|users|open_id|nickname/);
```

Also assert the history JSON ends with:

```js
"0035_album_tag_public_share_read_model.sql"
```

- [ ] **Step 2: Run the migration tests to verify RED**

Run:

```bash
node --test \
  apps/api/test/album-tag-model.test.mjs \
  apps/api/test/album-public-share-manifest.test.mjs \
  scripts/check-migration-filenames.test.mjs
```

Expected: FAIL because migration 0035 and the history entry do not exist.

- [ ] **Step 3: Create migration 0035**

Implement the two tables with this shape:

```sql
CREATE TABLE IF NOT EXISTS session_album_media_tags (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  media_id BIGINT UNSIGNED NOT NULL,
  kind VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  seat_id BIGINT UNSIGNED NULL,
  session_npc_role_id BIGINT UNSIGNED NULL,
  subject_ref_id BIGINT UNSIGNED
    GENERATED ALWAYS AS (
      CASE
        WHEN CAST(kind AS BINARY) = CAST('role' AS BINARY) THEN seat_id
        WHEN CAST(kind AS BINARY) = CAST('npc_role' AS BINARY)
          THEN session_npc_role_id
        ELSE 0
      END
    ) STORED,
  sort_order INT UNSIGNED NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT chk_album_media_tag_shape CHECK (
    (CAST(kind AS BINARY) = CAST('role' AS BINARY)
      AND seat_id IS NOT NULL AND session_npc_role_id IS NULL)
    OR (CAST(kind AS BINARY) = CAST('npc_role' AS BINARY)
      AND seat_id IS NULL AND session_npc_role_id IS NOT NULL)
    OR (CAST(kind AS BINARY) = CAST('other' AS BINARY)
      AND seat_id IS NULL AND session_npc_role_id IS NULL)
  ),
  UNIQUE KEY uniq_album_media_tag_subject (media_id, kind, subject_ref_id),
  CONSTRAINT fk_album_media_tag_media
    FOREIGN KEY (media_id) REFERENCES session_album_photos(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_album_media_tag_seat
    FOREIGN KEY (seat_id) REFERENCES session_seats(id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_album_media_tag_npc_role
    FOREIGN KEY (session_npc_role_id) REFERENCES session_npc_roles(id)
    ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS session_album_public_share_items (
  share_id BIGINT UNSIGNED NOT NULL,
  ordinal INT UNSIGNED NOT NULL,
  media_id BIGINT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (share_id, ordinal),
  UNIQUE KEY uniq_album_public_share_media (share_id, media_id),
  CONSTRAINT fk_album_public_share_item_share
    FOREIGN KEY (share_id) REFERENCES session_album_public_shares(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

Backfill tags using same-session joins. Group duplicate trusted subjects by
media/reference and keep the minimum legacy `sort_order`; use an idempotent
upsert so a partially committed migration can safely resume:

The production statement groups by
`(media_id, kind, seat_id, session_npc_role_id)`, selects
`MIN(sort_order)`, and uses `ON DUPLICATE KEY UPDATE` with `LEAST` so a
retry never increases or duplicates the stored order.

Backfill share items directly from `JSON_TABLE(... FOR ORDINALITY ...)`. Extract
each value as raw JSON and accept only exact positive JSON integers within the
unsigned bigint range. Keep the first occurrence of duplicate media IDs and skip
already-written ordinal/media pairs on retry. Do not join
`session_album_photos`: a physically deleted media ID remains an immutable
manifest tombstone and resolves as unavailable at read time.

- [ ] **Step 4: Append migration history**

Update `scripts/migration-filename-history.json` to:

```json
[
  "0034_schema_migration_checksums.sql",
  "0035_album_tag_public_share_read_model.sql"
]
```

- [ ] **Step 5: Run migration tests to verify GREEN**

Run:

```bash
npm run d51:migrations
node --test \
  apps/api/test/album-tag-model.test.mjs \
  apps/api/test/album-public-share-manifest.test.mjs
```

Expected: all tests pass and the migration filename checker reports no issue.

- [ ] **Step 6: Commit**

```bash
git add \
  apps/api/migrations/0035_album_tag_public_share_read_model.sql \
  scripts/migration-filename-history.json \
  apps/api/test/album-tag-model.test.mjs \
  apps/api/test/album-public-share-manifest.test.mjs
git commit -m "feat(api): add normalized album share schema"
```

---

### Task 3: Implement AlbumTagResolver and Normalized Tag Writes

**Files:**
- Create: `apps/api/src/modules/core/album-tags.js`
- Modify: `apps/api/src/modules/core/service.js`
- Modify: `apps/api/src/modules/album-image/repository.js`
- Modify: `apps/miniprogram/src/pages/session/album.vue`
- Test: `apps/api/test/album-tag-model.test.mjs`
- Test: `apps/miniprogram/test/albumTagModel.test.mjs`
- Modify tests that fixture `session_album_photo_tags`

- [ ] **Step 1: Add failing pure tests**

Test this public surface:

```js
import {
  normalizeAlbumTagKeys,
  resolveAlbumTags,
  resolveAlbumTagPrivacySubjects,
  writeAlbumMediaTags
} from "../src/modules/core/album-tags.js";
```

Required assertions:

```js
assert.deepEqual(
  normalizeAlbumTagKeys(["role:12", "npc-role:8", "other"]),
  [
    { kind: "role", refId: 12, key: "role:12" },
    { kind: "npc_role", refId: 8, key: "npc-role:8" },
    { kind: "other", refId: null, key: "other" }
  ]
);
assert.throws(
  () => normalizeAlbumTagKeys(["dm:session"]),
  /invalid album tag/i
);
```

The fake connection must return a polluted legacy label and canonical role rows; assert only canonical names are emitted and the resolver SQL never contains `users`, `nickname`, `open_id`, or `legacy.label`.

- [ ] **Step 2: Run focused test to verify RED**

Run:

```bash
node --test apps/api/test/album-tag-model.test.mjs
```

Expected: FAIL because `album-tags.js` does not exist.

- [ ] **Step 3: Implement `album-tags.js`**

Export:

```js
export function normalizeAlbumTagKeys(values = []) {
  const seen = new Set();
  return values.map((value) => {
    const key = String(value || "").trim();
    const match = /^(role|npc-role):([1-9]\d*)$/.exec(key);
    const normalized = key === "other"
      ? { kind: "other", refId: null, key }
      : match
        ? {
            kind: match[1] === "role" ? "role" : "npc_role",
            refId: Number(match[2]),
            key
          }
        : null;
    if (!normalized) throw badRequest("Invalid album tag");
    if (seen.has(key)) throw badRequest("Album tags must be unique");
    seen.add(key);
    return normalized;
  });
}

export async function listAlbumTagOptions(connection, sessionId) {
  const [seats] = await connection.query(
    `SELECT id, role_name, name
     FROM session_seats
     WHERE session_id = ? AND status IN ('confirmed', 'locked')
     ORDER BY id`,
    [sessionId]
  );
  const [npcRoles] = await connection.query(
    `SELECT id, name
     FROM session_npc_roles
     WHERE session_id = ? AND status = 'active'
     ORDER BY sort_order, id`,
    [sessionId]
  );
  return [
    ...seats.map((seat) => ({
      key: `role:${Number(seat.id)}`,
      kind: "role",
      ref_id: Number(seat.id),
      label: String(seat.role_name || seat.name || "").trim()
    })).filter((option) => option.label),
    ...npcRoles.map((role) => ({
      key: `npc-role:${Number(role.id)}`,
      kind: "npc_role",
      ref_id: Number(role.id),
      label: String(role.name || "").trim()
    })).filter((option) => option.label),
    { key: "other", kind: "other", ref_id: null, label: "其他" }
  ];
}

export async function resolveAlbumTags(connection, sessionId, mediaIds) {
  const rows = await selectCanonicalAlbumTagRows(connection, sessionId, mediaIds);
  return groupCanonicalAlbumTags(rows);
}

export async function resolveAlbumTagPrivacySubjects(connection, sessionId, mediaIds) {
  const rows = await selectAlbumTagPrivacyRows(connection, sessionId, mediaIds);
  return groupAlbumTagPrivacyUserIds(rows);
}

export async function writeAlbumMediaTags(connection, {
  mediaId,
  sessionId,
  normalizedTags
}) {
  await assertAlbumTagReferences(connection, sessionId, normalizedTags);
  await connection.query(
    "DELETE FROM session_album_media_tags WHERE media_id = ?",
    [mediaId]
  );
  for (const [sortOrder, tag] of normalizedTags.entries()) {
    await connection.query(
      `INSERT INTO session_album_media_tags
         (media_id, kind, seat_id, session_npc_role_id, sort_order)
       VALUES (?, ?, ?, ?, ?)`,
      [
        mediaId,
        tag.kind,
        tag.kind === "role" ? tag.refId : null,
        tag.kind === "npc_role" ? tag.refId : null,
        sortOrder
      ]
    );
  }
}
```

The referenced private helpers must use the exact same-session SQL and DTO
shape in `design.md`; they are internal to `album-tags.js` and are covered
through the four exported functions.

The resolver query must join normalized tags to media and role tables with same-session predicates. Serialize only:

```js
{
  kind: row.kind,
  ref_id: row.kind === "role"
    ? Number(row.seat_id)
    : row.kind === "npc_role"
      ? Number(row.session_npc_role_id)
      : null,
  label: row.kind === "other"
    ? "其他"
    : String(row.canonical_label || "").trim()
}
```

Drop rows whose canonical label is empty.

- [ ] **Step 4: Cut service reads and writes over**

In `service.js`:

- replace `sessionAlbumPeople` use in tag-option and tag-update paths with `listAlbumTagOptions`;
- replace `albumTagsForPhotos` with `resolveAlbumTags`;
- replace tag privacy user collection with `resolveAlbumTagPrivacySubjects`;
- replace delete/insert into `session_album_photo_tags` with `writeAlbumMediaTags`;
- keep the outward member tag fields limited to `{ key, kind, ref_id, label }`;
- remove DM/NPC/organizer tag-key acceptance.

Update `apps/api/src/modules/album-image/repository.js` to delete from
`session_album_media_tags` when media is removed.

Change the visibility helpers to accept a separate privacy-subject map:

```js
isAlbumPhotoVisibleToUser(
  photo,
  tags,
  privacyByUser,
  userId,
  personalScope,
  tagPrivacyUserIds
)
```

The display `tags` array never carries `user_id`; only
`tagPrivacyUserIds` participates in `allow_tagged_visible`.

- [ ] **Step 5: Update the miniprogram tag picker**

Derive keys from the safe option DTO:

```js
function albumTagKey(tag) {
  if (tag?.kind === "role") return `role:${Number(tag.ref_id)}`;
  if (tag?.kind === "npc_role") return `npc-role:${Number(tag.ref_id)}`;
  return tag?.kind === "other" ? "other" : "";
}
```

Replace UI branches for `seat`, `session_npc_role`, `dm`, `npc` and
`other:session` with `role`, `npc_role` and `other`. Offline fallbacks must
build only those three option types.

- [ ] **Step 6: Update fixtures and run API/client regression**

Run:

```bash
node --test \
  apps/api/test/album-tag-model.test.mjs \
  apps/api/test/album-single-media-share.test.mjs \
  apps/api/test/album-share-selection.test.mjs \
  apps/api/test/album-public-share-cover-recipe.test.mjs \
  apps/miniprogram/test/albumTagModel.test.mjs
npm run d48:check
npm run d50:unit
```

Expected: all tests pass; public labels equal canonical member labels.

- [ ] **Step 7: Prove production code no longer reads the legacy tag table**

Run:

```bash
rg -n "session_album_photo_tags|dm:session|npc:session|organizer:session" \
  apps/api/src
```

Expected: no production source matches.

- [ ] **Step 8: Commit**

```bash
git add \
  apps/api/src/modules/core/album-tags.js \
  apps/api/src/modules/core/service.js \
  apps/api/src/modules/album-image/repository.js \
  apps/api/test \
  apps/miniprogram/src/pages/session/album.vue \
  apps/miniprogram/test/albumTagModel.test.mjs
git commit -m "feat(api): resolve album tags from canonical roles"
```

---

### Task 4: Implement the Immutable PublicShareManifest

**Files:**
- Create: `apps/api/src/modules/core/public-album-share-manifest.js`
- Modify: `apps/api/src/modules/core/service.js`
- Test: `apps/api/test/album-public-share-manifest.test.mjs`
- Modify: `apps/api/test/album-public-share-pagination.test.mjs`
- Modify public media authorization tests

- [ ] **Step 1: Write failing manifest tests**

Test exports:

```js
import {
  writePublicShareItems,
  loadPublicShareItems,
  assertManifestMatchesLegacySnapshot,
  encodePublicShareOrdinalCursor,
  decodePublicShareOrdinalCursor,
  readPublicShareItemPage
} from "../src/modules/core/public-album-share-manifest.js";
```

Assert:

- write order is `[0, 1, 2]`;
- duplicate media IDs are rejected before SQL;
- legacy `[4, 2, 9]` must exactly match loaded item order;
- cursor for one share fails for another;
- page scanning returns `lastScannedOrdinal`, not returned count.

- [ ] **Step 2: Run focused tests to verify RED**

Run:

```bash
node --test \
  apps/api/test/album-public-share-manifest.test.mjs \
  apps/api/test/album-public-share-pagination.test.mjs
```

Expected: FAIL because the manifest module does not exist and pagination still slices JSON.

- [ ] **Step 3: Implement the manifest module**

Use:

```js
export async function writePublicShareItems(connection, shareId, mediaIds) {
  for (const [ordinal, mediaId] of normalizeMediaIds(mediaIds).entries()) {
    await connection.query(
      `INSERT INTO session_album_public_share_items
         (share_id, ordinal, media_id)
       VALUES (?, ?, ?)`,
      [shareId, ordinal, mediaId]
    );
  }
}
```

Load:

```sql
SELECT ordinal, media_id
FROM session_album_public_share_items
WHERE share_id = ?
ORDER BY ordinal
```

Page:

```sql
SELECT ordinal, media_id
FROM session_album_public_share_items
WHERE share_id = ?
  AND ordinal > ?
ORDER BY ordinal
LIMIT ?
```

Sign `{ share_id, after_ordinal }` with the same session secret and timing-safe comparison used by the existing cursor.

- [ ] **Step 4: Cut share creation and loading over**

In the existing transaction, immediately after inserting a new
`session_album_public_shares` row, call:

```js
await writePublicShareItems(connection, share.id, mediaIds);
```

For both inserted and reused rows, then run:

```js
const items = await loadPublicShareItems(connection, share.id);
assertManifestMatchesLegacySnapshot(items, share.media_ids);
```

Return a manifest ID set in `loadSessionAlbumPublicShareWithConnection`. Update image, cover, video URL and video byte authorization to use that set.

- [ ] **Step 5: Replace JSON pagination**

`listPublicSessionAlbumShare` must call `readPublicShareItemPage`, dynamically reauthorize candidates, continue scanning when candidates disappear, and sign the last scanned ordinal.

- [ ] **Step 6: Run authorization and pagination tests**

Run:

```bash
node --test \
  apps/api/test/album-public-share-manifest.test.mjs \
  apps/api/test/album-public-share-pagination.test.mjs \
  apps/api/test/album-single-media-share.test.mjs \
  apps/api/test/album-image-privacy-integration.test.mjs
npm run d54:unit
```

Expected: all pages are stable, and every media route rejects IDs outside manifest items.

- [ ] **Step 7: Commit**

```bash
git add \
  apps/api/src/modules/core/public-album-share-manifest.js \
  apps/api/src/modules/core/service.js \
  apps/api/test
git commit -m "feat(api): paginate immutable public share items"
```

---

### Task 5: Add PublicMediaState

**Files:**
- Create: `apps/api/src/modules/core/public-album-media-state.js`
- Modify: `apps/api/src/modules/core/service.js`
- Modify: `apps/api/src/legacy-app.js`
- Create: `apps/api/test/album-public-media-state.test.mjs`

- [ ] **Step 1: Write failing validation and service tests**

Test:

```js
assert.deepEqual(normalizePublicMediaStateIds([3, 1, 3]), [3, 1]);
assert.throws(
  () => normalizePublicMediaStateIds(Array.from({ length: 101 }, (_, i) => i + 1)),
  /at most 100/i
);
```

With a fake manifest `[1, 2]`, assert request `[1, 9]` fails closed. With item 2 revoked, assert:

```js
{
  patches: [{ id: 1, public_tag_labels: ["沈清商"] }],
  unavailable_ids: [2]
}
```

- [ ] **Step 2: Run focused tests to verify RED**

Run:

```bash
node --test apps/api/test/album-public-media-state.test.mjs
```

Expected: FAIL because the module and route do not exist.

- [ ] **Step 3: Implement the media-state module**

Export:

```js
export const PUBLIC_MEDIA_STATE_BATCH_LIMIT = 100;
export function normalizePublicMediaStateIds(values) {
  if (!Array.isArray(values) || values.length === 0) {
    throw badRequest("media_ids must be a non-empty array");
  }
  const ids = [];
  const seen = new Set();
  for (const value of values) {
    const id = Number(value);
    if (!Number.isSafeInteger(id) || id <= 0) {
      throw badRequest("media_ids contains an invalid id");
    }
    if (seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  if (ids.length > PUBLIC_MEDIA_STATE_BATCH_LIMIT) {
    throw badRequest("media_ids must contain at most 100 ids");
  }
  return ids;
}

export async function readPublicAlbumMediaState({
  connection,
  claims,
  mediaIds,
  loadShare,
  readVisibleMedia
}) {
  const requestedIds = normalizePublicMediaStateIds(mediaIds);
  const share = await loadShare(connection, claims);
  const manifestIds = new Set(
    share.items.map((item) => Number(item.media_id))
  );
  if (requestedIds.some((id) => !manifestIds.has(id))) {
    throw forbidden("Album share media is unavailable");
  }
  const visible = await readVisibleMedia(connection, claims, requestedIds);
  const visibleById = new Map(
    visible.map((media) => [Number(media.id), media])
  );
  return {
    patches: requestedIds
      .map((id) => visibleById.get(id))
      .filter(Boolean),
    unavailable_ids: requestedIds.filter((id) => !visibleById.has(id))
  };
}
```

Membership validation must happen before current visibility filtering:

```js
const manifestIds = new Set(share.items.map((item) => item.media_id));
if (mediaIds.some((id) => !manifestIds.has(id))) {
  throw forbidden("Album share media is unavailable");
}
```

- [ ] **Step 4: Add the POST route**

Add:

```http
POST /api/sessions/:id/album/public-share/media-state?token=...
```

Parse `{ media_ids }`, verify token/session, call the service, attach public URLs to `patches`, and run `assertPublicResponseSafe`.

- [ ] **Step 5: Add safe telemetry**

Emit only:

```js
{
  event: "public_media_state_refresh",
  sessionId,
  shareId,
  requestedCount,
  patchCount,
  unavailableCount,
  durationMs
}
```

Do not emit token, labels, account fields or URLs.

- [ ] **Step 6: Run API tests**

Run:

```bash
node --test \
  apps/api/test/album-public-media-state.test.mjs \
  apps/api/test/content-moderation-author-leak-gates.test.mjs \
  apps/api/test/album-single-media-share.test.mjs
npm --workspace apps/api run check
```

Expected: all tests and syntax checks pass.

- [ ] **Step 7: Commit**

```bash
git add \
  apps/api/src/modules/core/public-album-media-state.js \
  apps/api/src/modules/core/service.js \
  apps/api/src/legacy-app.js \
  apps/api/test/album-public-media-state.test.mjs
git commit -m "feat(api): refresh public media state by manifest id"
```

---

### Task 6: Implement the Four-Event PublicAlbumReadState

**Files:**
- Create: `apps/miniprogram/src/utils/publicAlbumReadState.js`
- Create: `apps/miniprogram/test/publicAlbumReadState.test.mjs`

- [ ] **Step 1: Write the failing reducer tests**

Cover:

```js
const initial = reducePublicAlbumReadState(createPublicAlbumReadState(), {
  type: "INITIAL_PAGE",
  cards: [{ id: 1 }, { id: 2 }],
  nextCursor: "c1"
});

const appended = reducePublicAlbumReadState(initial, {
  type: "NEXT_PAGE",
  cards: [{ id: 2 }, { id: 3 }],
  nextCursor: "c2"
});

assert.deepEqual(appended.cards.map(({ id }) => id), [1, 2, 3]);
assert.equal(appended.nextCursor, "c2");
```

Prove both event orders:

```text
NEXT_PAGE(3) -> MEDIA_PATCH(1)
MEDIA_PATCH(1) -> NEXT_PAGE(3)
```

produce the same IDs, card 1 fields and cursor.

- [ ] **Step 2: Run test to verify RED**

Run:

```bash
node --test apps/miniprogram/test/publicAlbumReadState.test.mjs
```

Expected: FAIL because `publicAlbumReadState.js` does not exist.

- [ ] **Step 3: Implement immutable reducer and batches**

Export:

```js
export function createPublicAlbumReadState(generation = 0) {
  return {
    cards: [],
    nextCursor: null,
    pageLoading: false,
    pageError: "",
    generation
  };
}

export function publicAlbumMediaStateBatches(mediaIds, limit = 100) {
  const ids = [...new Set(mediaIds.map(Number).filter(
    (id) => Number.isSafeInteger(id) && id > 0
  ))];
  const batches = [];
  for (let index = 0; index < ids.length; index += limit) {
    batches.push(ids.slice(index, index + limit));
  }
  return batches;
}

export function reducePublicAlbumReadState(state, event) {
  if (event.type === "UNLOAD") {
    return createPublicAlbumReadState(state.generation + 1);
  }
  if (event.type === "INITIAL_PAGE") {
    return {
      ...state,
      cards: uniqueCards(event.cards),
      nextCursor: normalizedCursor(event.nextCursor),
      pageLoading: false,
      pageError: ""
    };
  }
  if (event.type === "NEXT_PAGE") {
    if (event.status === "start") {
      return { ...state, pageLoading: true, pageError: "" };
    }
    if (event.status === "failure") {
      return {
        ...state,
        pageLoading: false,
        pageError: "继续加载失败，可重试。"
      };
    }
    return {
      ...state,
      cards: uniqueCards([...state.cards, ...event.cards]),
      nextCursor: normalizedCursor(event.nextCursor),
      pageLoading: false,
      pageError: ""
    };
  }
  if (event.type === "MEDIA_PATCH") {
    const unavailable = new Set(event.unavailableIds.map(Number));
    const patches = new Map(
      event.patches.map((patch) => [Number(patch.id), patch])
    );
    return {
      ...state,
      cards: state.cards
        .filter((card) => !unavailable.has(Number(card.id)))
        .map((card) => ({
          ...card,
          ...(patches.get(Number(card.id)) || {})
        }))
    };
  }
  return state;
}

export function isCurrentPublicAlbumGeneration(state, generation) {
  return state.generation === generation;
}
```

`MEDIA_PATCH` must merge by ID, filter unavailable IDs, preserve card order, and leave cursor unchanged.

- [ ] **Step 4: Implement public media-state timer controller**

Export:

```js
export function createPublicAlbumMediaStateController({
  readCards,
  refreshCards,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  now = Date.now,
  retryDelayMs = 30_000
}) {
  let disposed = false;
  let timer = null;
  let flight = null;
  const retryDelay = Math.min(
    2_147_483_647,
    Math.max(1_000, Number.isFinite(retryDelayMs) ? retryDelayMs : 30_000)
  );
  const cancel = () => {
    if (timer !== null) clearTimer(timer);
    timer = null;
  };
  const schedule = () => {
    if (disposed) return;
    cancel();
    const expiries = readCards()
      .map((card) => Date.parse(card.media_url_expires_at || ""))
      .filter(Number.isFinite);
    if (expiries.length === 0) return;
    const delay = Math.max(0, Math.min(...expiries) - now() - 30_000);
    timer = setTimer(() => { void refresh().catch(() => {}); }, delay);
  };
  const scheduleRetry = () => {
    if (disposed) return;
    cancel();
    timer = setTimer(() => { void refresh().catch(() => {}); }, retryDelay);
  };
  const refresh = () => {
    if (disposed) return Promise.resolve(null);
    if (flight) return flight;
    flight = Promise.resolve()
      .then(refreshCards)
      .then((result) => {
        if (!disposed) schedule();
        return result;
      })
      .catch((error) => {
        if (!disposed) scheduleRetry();
        throw error;
      })
      .finally(() => {
        flight = null;
      });
    return flight;
  };
  const dispose = () => {
    disposed = true;
    cancel();
  };
  return { refresh, schedule, dispose };
}
```

It must be single-flight, schedule 30 seconds before the earliest expiry, clamp retry to 1 second through `2_147_483_647`, and make disposal terminal.

- [ ] **Step 5: Run focused tests**

Run:

```bash
node --test apps/miniprogram/test/publicAlbumReadState.test.mjs
```

Expected: all reducer, order, batching, timer and disposal tests pass.

- [ ] **Step 6: Commit**

```bash
git add \
  apps/miniprogram/src/utils/publicAlbumReadState.js \
  apps/miniprogram/test/publicAlbumReadState.test.mjs
git commit -m "feat(miniprogram): add public album read state"
```

---

### Task 7: Integrate PublicAlbumReadState Without Rebuilding the Waterfall

**Files:**
- Modify: `apps/miniprogram/src/pages/session/album.vue`
- Modify: `apps/miniprogram/src/utils/albumPublicSharePagination.js`
- Modify: `apps/miniprogram/src/utils/albumMediaUrls.js`
- Modify: `apps/miniprogram/test/albumPublicSharePagination.test.mjs`
- Modify: `apps/miniprogram/test/albumMediaUrls.test.mjs`
- Modify: `apps/miniprogram/test/albumSharePreview.test.mjs`

- [ ] **Step 1: Add failing page contract tests**

Assert:

- `loadPublicAlbum` dispatches `INITIAL_PAGE`;
- `loadMorePublicAlbum` dispatches `NEXT_PAGE` and calls only the append helper;
- `refreshLoadedPublicAlbumMedia` posts stable batches to `/media-state`;
- patch success calls only `applyPublicAlbumMediaPatchToWaterfall`;
- unload dispatches `UNLOAD` and disposes the public controller;
- no production source contains:

```text
reloadLoadedPublicAlbumPrefix
reloadPublicAlbumSharePrefix
publicShareLoadedPageCount
samePublicAlbumMediaSequence
pageScrollTo
```

- [ ] **Step 2: Run page tests to verify RED**

Run:

```bash
node --test \
  apps/miniprogram/test/publicAlbumReadState.test.mjs \
  apps/miniprogram/test/albumPublicSharePagination.test.mjs \
  apps/miniprogram/test/albumMediaUrls.test.mjs \
  apps/miniprogram/test/albumSharePreview.test.mjs
```

Expected: FAIL because album.vue still performs prefix reload.

- [ ] **Step 3: Add public state to `album.vue`**

Initialize:

```js
publicAlbumRead: createPublicAlbumReadState(),
publicAlbumMediaStateRefresh: null
```

Add:

```js
commitPublicAlbumEvent(event) {
  this.publicAlbumRead = reducePublicAlbumReadState(this.publicAlbumRead, event);
  this.photos = this.publicAlbumRead.cards;
}
```

- [ ] **Step 4: Convert initial and next-page reads**

Initial response:

```js
this.commitPublicAlbumEvent({
  type: "INITIAL_PAGE",
  cards: normalizedPhotos,
  nextCursor: data.has_more === true ? data.next_cursor : null
});
this.refreshWaterfall();
```

Next page:

```js
const beforeIds = new Set(this.publicAlbumRead.cards.map((card) => Number(card.id)));
this.commitPublicAlbumEvent({
  type: "NEXT_PAGE",
  cards: normalizedPhotos,
  nextCursor: data.has_more === true ? data.next_cursor : null
});
const appended = this.publicAlbumRead.cards.filter(
  (card) => !beforeIds.has(Number(card.id))
);
this.appendPublicAlbumWaterfallPhotos(appended);
```

- [ ] **Step 5: Implement media-state batching and atomic commit**

For every batch:

```js
const response = await request({
  method: "POST",
  url: `/api/sessions/${this.sessionId}/album/public-share/media-state${queryString({
    token: this.albumShareToken
  })}`,
  data: { media_ids: batch },
  suppressMaintenance: true
});
```

Accumulate all patches/unavailable IDs. Only after every batch succeeds and generation matches, dispatch one `MEDIA_PATCH`.

- [ ] **Step 6: Patch waterfall rows by ID**

Implement:

```js
applyPublicAlbumMediaPatchToWaterfall(cards, unavailableIds) {
  const unavailable = new Set(unavailableIds.map(Number));
  const byId = new Map(cards.map((card) => [Number(card.id), card]));
  const patchRows = (rows) => rows
    .filter((row) => !unavailable.has(Number(row.id)))
    .map((row) => byId.get(Number(row.id)) || row);
  this.waterfallPhotos = patchRows(this.waterfallPhotos);
  this.waterfallList1 = patchRows(this.waterfallList1);
  this.waterfallList2 = patchRows(this.waterfallList2);
}
```

Do not call waterfall `clear`.

- [ ] **Step 7: Isolate member refresh and delete old public helpers**

- keep `createAlbumMediaRefreshController` for member mode only;
- create/dispose the public media-state controller only in timeline mode;
- delete prefix reload and loaded page count;
- remove exported prefix reload, sequence comparison and row replacement helpers from `albumPublicSharePagination.js`.

- [ ] **Step 8: Run miniprogram regression and build**

Run:

```bash
node --test apps/miniprogram/test/album*.test.mjs
npm run d54:unit
npm run d54:check
npm run build:mp-weixin
```

Expected: all tests pass and build completes without new warnings.

- [ ] **Step 9: Commit**

```bash
git add \
  apps/miniprogram/src/pages/session/album.vue \
  apps/miniprogram/src/utils/albumPublicSharePagination.js \
  apps/miniprogram/src/utils/albumMediaUrls.js \
  apps/miniprogram/test
git commit -m "fix(miniprogram): separate public paging from media refresh"
```

---

### Task 8: Add D57 Gates and Align Superseded Specs

**Files:**
- Create: `scripts/d57-album-tag-public-share-read-model-check.js`
- Modify: `package.json`
- Modify: `specs/d48-album-sharing-role-claim-separation/requirements.md`
- Modify: `specs/d48-album-sharing-role-claim-separation/design.md`
- Modify: `specs/d50-album-single-media-sharing/requirements.md`
- Modify: `specs/d50-album-single-media-sharing/design.md`
- Modify: `specs/d52-untagged-owned-image-sharing/requirements.md`
- Modify: `specs/d52-untagged-owned-image-sharing/design.md`
- Modify: `specs/d54-public-album-full-share-pagination/requirements.md`
- Modify: `specs/d54-public-album-full-share-pagination/design.md`

- [ ] **Step 1: Write the failing D57 gate**

The check must assert:

```js
requireText(migration, "CREATE TABLE session_album_media_tags");
requireText(migration, "CREATE TABLE session_album_public_share_items");
forbidText(apiSource, "session_album_photo_tags");
forbidText(albumSource, "reloadLoadedPublicAlbumPrefix");
forbidText(albumSource, "publicShareLoadedPageCount");
forbidText(publicPaginationSource, "reloadPublicAlbumSharePrefix");
requireText(albumSource, "/album/public-share/media-state");
requireText(albumSource, "appendPublicAlbumWaterfallPhotos");
```

Scope `apiSource` to production sources, excluding immutable migration history.

- [ ] **Step 2: Run gate to verify RED**

Run:

```bash
node scripts/d57-album-tag-public-share-read-model-check.js
```

Expected: FAIL until package scripts and any remaining old references are corrected.

- [ ] **Step 3: Add package scripts**

Add:

```json
"d57:unit": "node --test apps/api/test/album-tag-model.test.mjs apps/api/test/album-public-share-manifest.test.mjs apps/api/test/album-public-media-state.test.mjs apps/miniprogram/test/publicAlbumReadState.test.mjs",
"d57:check": "node scripts/d57-album-tag-public-share-read-model-check.js"
```

Append both to `postcheck`.

- [ ] **Step 4: Align historical specs**

State explicitly:

- D57 replaces persisted tag labels with canonical role references;
- D57 replaces JSON pagination runtime truth with share items;
- D57 replaces prefix reload with media-state patches;
- D52 implicit untagged eligibility remains;
- D50 single-media authorization uses manifest items.

- [ ] **Step 5: Run gate and focused suite**

Run:

```bash
npm run d57:unit
npm run d57:check
npm run d48:check
npm run d50:check
npm run d54:check
git diff --check
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add \
  scripts/d57-album-tag-public-share-read-model-check.js \
  package.json \
  specs
git commit -m "test: gate canonical public album reads"
```

---

### Task 9: Full Verification and Completion Audit

**Files:**
- Modify: `specs/d57-album-tag-public-share-read-model/tasks.md`
- No product edits unless a failure demonstrates a requirement gap

- [ ] **Step 1: Run the required focused suite**

Run:

```bash
npm run d51:migrations
npm run d48:check
npm run d50:unit
npm run d50:check
npm run d54:unit
npm run d54:check
npm run d55:unit
npm run d55:check
npm run d56:unit
npm run d56:check
npm run d57:unit
npm run d57:check
npm run build:mp-weixin
```

Expected: every command exits 0.

- [ ] **Step 2: Run the full project gate**

Run:

```bash
npm run check
```

Expected: all unit, contract and postcheck stages pass.

- [ ] **Step 3: Audit forbidden concepts**

Run:

```bash
rg -n \
  "session_album_photo_tags|reloadLoadedPublicAlbumPrefix|reloadPublicAlbumSharePrefix|publicShareLoadedPageCount|public_label|dm:session|npc:session" \
  apps/api/src apps/miniprogram/src
git diff --check
git status --short
```

Expected: no forbidden production references; no unstaged implementation files.

- [ ] **Step 4: Review every D57 requirement**

For each numbered requirement, link it to:

- migration or source line;
- an automated test name;
- command output;
- manual acceptance item when rendering/runtime evidence is required.

Do not mark a task complete from a static string check alone.

- [ ] **Step 5: Request code review and fix all Critical/Important findings**

Review from the merge base through HEAD with emphasis on:

- canonical role source and privacy separation;
- migration safety and manifest/JSON mismatch;
- every public byte route using manifest items;
- reducer commutativity and unload;
- no waterfall rebuild after initial load.

After any fix, rerun Steps 1–3.

- [ ] **Step 6: Mark Tasks 1–9 complete and commit tracking**

```bash
git add specs/d57-album-tag-public-share-read-model/tasks.md
git commit -m "docs: record d57 verification"
```

---

### Task 10: Guarded CI Release

**Files:**
- No source edits unless CI identifies a real defect

- [ ] **Step 1: Inspect release state**

Run:

```bash
git status --short --branch
git remote -v
git fetch origin
```

Expected: implementation branch clean; remotes reachable.

- [ ] **Step 2: Promote the verified work to `develop` without rewriting history**

Use the repository’s existing CI release workflow. Push `develop`, find the matching GitHub Actions run, and wait for success.

- [ ] **Step 3: Promote verified `develop` to `main`**

Use a temporary worktree based on `origin/main`, merge the verified develop commit, rerun meaningful local checks, push, and wait for main CI success.

- [ ] **Step 4: Promote verified `main` to `publish`**

Use a temporary worktree based on `origin/publish`, merge the verified main commit, rerun meaningful checks, push, and wait for publish CI success.

- [ ] **Step 5: Record evidence**

Add a progress note to `tasks.md` with:

- develop/main/publish SHA;
- GitHub Actions run ID and final status;
- warnings or annotations.

---

### Task 11: WeChat Developer Tools Acceptance and Review Submission

**Files:**
- Build artifact: `apps/miniprogram/dist/build/mp-weixin`
- No source edits unless acceptance exposes a real defect

- [ ] **Step 1: Refresh the developer-tools artifact**

Run:

```bash
npm run devtools:refresh
```

Expected: miniprogram build completes and the developer-tools project refreshes.

- [ ] **Step 2: Compile and inspect in WeChat Developer Tools**

Verify:

- member album and public share show the same latest role/NPC names;
- “其他” remains fixed;
- no DM/NPC worker nickname appears;
- initial public page renders;
- repeated bottom loads append without returning to top;
- triggering `onShow` while a page is loading does not lose the page;
- media-state refresh updates URLs without rebuilding cards;
- revoked media disappears locally;
- invalid/expired share enters the unavailable state.

- [ ] **Step 3: Run device acceptance**

Use a valid share with more than 30 media and confirm on a real device:

- scroll position remains continuous through at least two page loads;
- returning from background does not reset the list;
- image and video preview remain authorized;
- no account identity appears in labels.

- [ ] **Step 4: Upload and submit review**

Upload the verified `publish` artifact with a unique version and concise D57 description. Submit it through the WeChat review flow only after upload success and acceptance evidence.

- [ ] **Step 5: Record submission evidence**

Record in `tasks.md`:

- uploaded version;
- upload timestamp;
- review submission identifier or visible status;
- any platform warning.

Mark Task 11 complete only after the review submission is confirmed by the platform.
