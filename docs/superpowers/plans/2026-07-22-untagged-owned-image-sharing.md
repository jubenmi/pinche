# Untagged Owned Image Sharing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow a member to preview and share their own approved untagged images without creating “other” tags or changing normal album visibility.

**Architecture:** Extend the existing D48 immutable share snapshot with a versioned subset of implicitly included untagged images. Reuse the existing D50 share-token and public album paths, add an explicit member-side preview flow, and keep all eligibility and dynamic reauthorization in the API.

**Tech Stack:** Node.js ESM, `node:test`, MySQL migrations, uni-app Vue 2, TDesign miniprogram components.

---

## File map

- Create `apps/api/migrations/0033_album_untagged_share_preview.sql`: add media tag versions and snapshot-local untagged entries.
- Create `apps/api/test/album-untagged-share-preview.test.mjs`: API unit, migration, snapshot, selection, compatibility and route tests.
- Modify `apps/api/src/modules/core/service.js`: normalization, digest, selection, snapshot creation, dynamic reads and tag version updates.
- Modify `apps/api/src/server.js`: accept D52 share-token body fields and return untagged count.
- Create `apps/miniprogram/src/utils/albumSharePreview.js`: pure route, notice and selection helpers.
- Create `apps/miniprogram/test/albumSharePreview.test.mjs`: helper and page-contract tests.
- Modify `apps/miniprogram/src/pages/session/album.vue`: preview entry, preview state, optional share selection and single-media inclusion.
- Update `specs/d52-untagged-owned-image-sharing/tasks.md`: live execution board and verification evidence.

### Task 1: Lock migration and snapshot compatibility

**Files:**
- Create: `apps/api/test/album-untagged-share-preview.test.mjs`
- Create: `apps/api/migrations/0033_album_untagged_share_preview.sql`
- Modify: `apps/api/src/modules/core/service.js:2379-2490`

- [ ] **Step 1: Write failing migration and digest tests**

Add tests that read the migration and assert `tag_version` plus `implicit_untagged_media`, then assert the old digest remains identical when the implicit array is empty and changes when a tag version changes:

```js
test("D52 migration adds tag versions and snapshot-local untagged entries", () => {
  assert.match(migrationSql, /ADD COLUMN tag_version BIGINT UNSIGNED NOT NULL DEFAULT 0/);
  assert.match(migrationSql, /ADD COLUMN implicit_untagged_media JSON NULL/);
});

test("snapshot digest is backward compatible and binds implicit tag versions", () => {
  const legacy = publicShareSnapshotDigest({ ...claims, mediaIds: [1], coverMediaIds: [] });
  assert.equal(
    publicShareSnapshotDigest({
      ...claims,
      mediaIds: [1],
      coverMediaIds: [],
      implicitUntaggedMedia: []
    }),
    legacy
  );
  assert.notEqual(
    publicShareSnapshotDigest({
      ...claims,
      mediaIds: [1],
      coverMediaIds: [],
      implicitUntaggedMedia: [{ media_id: 1, tag_version: 1 }]
    }),
    legacy
  );
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
node --test apps/api/test/album-untagged-share-preview.test.mjs
```

Expected: FAIL because the migration and implicit digest support do not exist.

- [ ] **Step 3: Add the migration and minimal normalizer**

Create the migration exactly as specified in `specs/d52-untagged-owned-image-sharing/design.md`. Add exported `normalizeImplicitUntaggedMedia` that parses JSON/arrays, treats null as `[]`, validates unique positive `media_id`, nonnegative safe `tag_version`, maximum 30, and membership in `mediaIds`.

Update `publicShareSnapshotDigest` so it adds `implicitUntaggedMedia` to the hashed object only when non-empty. Update `normalizeSessionAlbumPublicShareRow` to validate and project the new field.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run the same command. Expected: migration and digest tests PASS.

- [ ] **Step 5: Commit Task 1**

```bash
git add apps/api/migrations/0033_album_untagged_share_preview.sql apps/api/test/album-untagged-share-preview.test.mjs apps/api/src/modules/core/service.js specs/d52-untagged-owned-image-sharing/tasks.md
git commit -m "feat(api): add versioned untagged share snapshots"
```

### Task 2: Select and persist owned untagged images

**Files:**
- Modify: `apps/api/test/album-untagged-share-preview.test.mjs`
- Modify: `apps/api/src/modules/core/service.js:2163-2325,6576-6728`

- [ ] **Step 1: Write failing eligibility and ordering tests**

Cover these cases individually: own approved untagged image selected with `allowOwnedUntaggedImages: true`; same image excluded without the flag; other uploader excluded; video excluded; uploader privacy false excluded; untagged priority after all tagged groups; focused untagged image selected first.

Use rows with explicit `tag_version` and empty tag arrays:

```js
const untagged = eligibleMedia(9, { tag_version: 2 });
const selected = selectPublicShareMedia(
  [untagged],
  new Map([[9, []]]),
  openPrivacy([100]),
  claims,
  { allowOwnedUntaggedImages: true }
);
assert.deepEqual(selected.map((media) => media.id), [9]);
```

- [ ] **Step 2: Run and verify RED**

Expected: the untagged media remains excluded by the current `tags.length === 0` guard.

- [ ] **Step 3: Implement the untagged candidate branch and ranking**

Add a small helper for owned untagged image eligibility. Move the uploader privacy check before the tag branch. Keep the existing tagged-person checks unchanged. Return priority `3` for the new branch.

In `createOrReuseSessionAlbumPublicShare`, accept `includeOwnedUntaggedImages`, derive:

```js
const implicitUntaggedMedia = selectedMedia
  .filter((media) => (tagsMap.get(Number(media.id)) || []).length === 0)
  .map((media) => ({
    media_id: Number(media.id),
    tag_version: Number(media.tag_version || 0)
  }));
```

Include it in the digest, reusable lookup, INSERT and return `implicit_untagged_count`.

- [ ] **Step 4: Run API tests and verify GREEN**

Run:

```bash
node --test apps/api/test/album-untagged-share-preview.test.mjs apps/api/test/album-single-media-share.test.mjs
```

Expected: all tests PASS.

- [ ] **Step 5: Commit Task 2**

```bash
git add apps/api/src/modules/core/service.js apps/api/test/album-untagged-share-preview.test.mjs specs/d52-untagged-owned-image-sharing/tasks.md
git commit -m "feat(api): include owned untagged images in shares"
```

### Task 3: Reauthorize every public read and invalidate on tag writes

**Files:**
- Modify: `apps/api/test/album-untagged-share-preview.test.mjs`
- Modify: `apps/api/src/modules/core/service.js:6860-6960,7410-7465,7790-7975`

- [ ] **Step 1: Write failing read and tag-version tests**

Assert that a snapshot entry is visible only when current `tag_version` matches. Assert it disappears after version increment, an unlisted empty-tag image remains hidden, public image/video accessors use the same rule, and an untagged item never becomes a cover candidate.

Assert tag update issues:

```sql
UPDATE session_album_photos
SET tag_version = tag_version + 1
WHERE id = ?
```

- [ ] **Step 2: Run and verify RED**

Expected: public readers still reject all empty tags and tag writes do not increment a version.

- [ ] **Step 3: Pass snapshot context through all readers**

Build `implicitUntaggedByMediaId` from the normalized share row. Pass it to list, photo file, video cover, video URL and video file authorization. In the tag update transaction, increment `tag_version` after writing the tag rows and return the updated version.

- [ ] **Step 4: Run and verify GREEN**

Run both D52 and D50 API tests. Expected: PASS with no D50 regressions.

- [ ] **Step 5: Commit Task 3**

```bash
git add apps/api/src/modules/core/service.js apps/api/test/album-untagged-share-preview.test.mjs specs/d52-untagged-owned-image-sharing/tasks.md
git commit -m "feat(api): reauthorize untagged snapshot media"
```

### Task 4: Add strict custom selection and route compatibility

**Files:**
- Modify: `apps/api/test/album-untagged-share-preview.test.mjs`
- Modify: `apps/api/src/modules/core/service.js:2225-2260,6576-6728`
- Modify: `apps/api/src/server.js:5915-5955`

- [ ] **Step 1: Write failing selection and route tests**

Assert exact selected IDs, no replacement, rejection of stale IDs, 30-item and 3-video limits, mutual exclusion with `focusMediaId`, route forwarding of `includeOwnedUntaggedImages` and `selectedMediaIds`, and response `implicit_untagged_count`.

- [ ] **Step 2: Run and verify RED**

Expected: route ignores the fields and selection still auto-fills.

- [ ] **Step 3: Implement strict input normalization**

Normalize `selectedMediaIds` only when supplied, reject empty/duplicate/non-integer/over-30 values, reject more than 3 selected videos after eligibility lookup, and throw `ALBUM_PUBLIC_SHARE_SELECTION_CHANGED` if any requested ID is missing from eligible candidates. Do not append ranked media in selected mode.

Forward the exact camelCase body fields in `server.js` and return the count.

- [ ] **Step 4: Run and verify GREEN**

Run D52 and D50 API tests. Expected: PASS.

- [ ] **Step 5: Commit Task 4**

```bash
git add apps/api/src/modules/core/service.js apps/api/src/server.js apps/api/test/album-untagged-share-preview.test.mjs specs/d52-untagged-owned-image-sharing/tasks.md
git commit -m "feat(api): support custom album share previews"
```

### Task 5: Build share-preview pure state

**Files:**
- Create: `apps/miniprogram/test/albumSharePreview.test.mjs`
- Create: `apps/miniprogram/src/utils/albumSharePreview.js`

- [ ] **Step 1: Write failing helper tests**

Test encoded preview route, safe route parsing, invalid token/count closure, exact notice copy, deduplicated selection, 30-item limit and 3-video limit.

Expected helper shape:

```js
albumSharePreviewRoute({ sessionId, token, total, untagged })
albumSharePreviewRouteState(options)
albumSharePreviewNotice({ total, untagged })
normalizeAlbumShareSelection(photos, selectedIds)
```

- [ ] **Step 2: Run and verify RED**

Expected: module not found.

- [ ] **Step 3: Implement pure immutable helpers**

Return frozen route-state and selection results. Use `source=share_preview`. Invalid session/token returns an empty route; invalid counts normalize to zero. Selection returns `{ ok, ids, error }` and never mutates inputs.

- [ ] **Step 4: Run and verify GREEN**

```bash
node --test apps/miniprogram/test/albumSharePreview.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit Task 5**

```bash
git add apps/miniprogram/src/utils/albumSharePreview.js apps/miniprogram/test/albumSharePreview.test.mjs specs/d52-untagged-owned-image-sharing/tasks.md
git commit -m "feat(miniprogram): add album share preview state"
```

### Task 6: Add member preview and native share gating

**Files:**
- Modify: `apps/miniprogram/test/albumSharePreview.test.mjs`
- Modify: `apps/miniprogram/src/pages/session/album.vue`

- [ ] **Step 1: Add failing page-contract tests**

Read `album.vue` and assert: a `预览并分享` action calls `prepareAlbumSharePreview`; onLoad no longer calls `ensureAlbumShareToken` for a member page; share-token request sends `includeOwnedUntaggedImages: true`; preview route and notice helper are used; `showShareMenus` only enables whole-album sharing in timeline/preview mode.

- [ ] **Step 2: Run and verify RED**

Expected: contracts are absent.

- [ ] **Step 3: Implement member-to-preview flow**

Add the action button, `preparingSharePreview` busy state and method. POST the include flag, build the preview route from the response, and navigate to it. Parse preview route state during `onLoad`, load the existing public album view, display the notice and actions, and leave native share disabled until token and cover preparation finish.

Remove member page calls to `ensureAlbumShareToken`; single-media preparation remains independent.

- [ ] **Step 4: Run and verify GREEN**

Run helper/page contract tests plus the existing single-media tests.

- [ ] **Step 5: Commit Task 6**

```bash
git add apps/miniprogram/src/pages/session/album.vue apps/miniprogram/test/albumSharePreview.test.mjs specs/d52-untagged-owned-image-sharing/tasks.md
git commit -m "feat(miniprogram): preview album before sharing"
```

### Task 7: Add optional custom selection and untagged single-media share

**Files:**
- Modify: `apps/miniprogram/test/albumSharePreview.test.mjs`
- Modify: `apps/miniprogram/src/pages/session/album.vue`

- [ ] **Step 1: Add failing UI-state contracts**

Assert a `share` selection purpose, default snapshot selection, share-specific selectable rule, 30/3 limit handling, `saveShareSelection`, request `selectedMediaIds`, and single-media request `includeOwnedUntaggedImages: true` plus the untagged note.

- [ ] **Step 2: Run and verify RED**

Expected: page has only tag/download purposes and single-media request lacks the include flag.

- [ ] **Step 3: Implement minimal share selection**

Reuse existing checkboxes and bottom toolbar. Keep share selection independent, allow all currently displayed snapshot items, enforce limits with the helper, and recreate the preview token from exact selected IDs. For single media, add the include flag and render the note only for an own empty-tag image.

- [ ] **Step 4: Run and verify GREEN**

Run all D52 miniprogram tests and existing D50 miniprogram tests.

- [ ] **Step 5: Commit Task 7**

```bash
git add apps/miniprogram/src/pages/session/album.vue apps/miniprogram/test/albumSharePreview.test.mjs specs/d52-untagged-owned-image-sharing/tasks.md
git commit -m "feat(miniprogram): adjust album share contents"
```

### Task 8: Verify the complete D52 contract

**Files:**
- Modify: `specs/d52-untagged-owned-image-sharing/tasks.md`

- [ ] **Step 1: Run syntax and focused automated tests**

```bash
node --check apps/api/src/modules/core/service.js
node --check apps/api/src/server.js
node --check apps/miniprogram/src/utils/albumSharePreview.js
node --test apps/api/test/album-untagged-share-preview.test.mjs apps/api/test/album-single-media-share.test.mjs apps/miniprogram/test/albumSharePreview.test.mjs apps/miniprogram/test/albumSingleMediaShare.test.mjs
```

Expected: zero failures.

- [ ] **Step 2: Run repository contract checks**

```bash
git diff --check
node scripts/d48-album-sharing-role-claim-separation-check.js
node scripts/d50-album-single-media-sharing-check.js
```

Expected: zero failures.

- [ ] **Step 3: Review requirements item by item**

Mark only automated items proven by the commands. Leave WeChat developer-tool verification unchecked unless it is actually executed.

- [ ] **Step 4: Commit verification evidence**

```bash
git add specs/d52-untagged-owned-image-sharing/tasks.md
git commit -m "test: verify untagged album sharing"
```
