# Public Album Full Share Pagination Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a public album share expose every eligible static photo through bounded pages while its generated cover continues to select at most nine images.

**Architecture:** Keep the immutable public-share snapshot as the authorization boundary, remove only its static-photo count cap, and page through the stored IDs using a share-bound HMAC cursor. The API resolves at most 30 IDs per database query and dynamically rechecks each item. The mini-program resets and appends pages through a pure pagination helper, leaving cover preparation independent of feed completion.

**Tech Stack:** Node.js ESM, MySQL/mysql2, HMAC-SHA256, Vue/uni-app, Node test runner.

---

### Task 1: Full static-photo snapshot contract

**Files:**
- Modify: `apps/api/src/modules/core/service.js:2268-2588,6783-6940`
- Modify: `apps/api/test/album-single-media-share.test.mjs`
- Modify: `specs/d54-public-album-full-share-pagination/tasks.md`

- [ ] **Step 1: Write the failing service tests**

```js
test("public share snapshots all eligible static photos while retaining only three videos", () => {
  const photos = Array.from({ length: 100 }, (_, index) => eligibleMedia(index + 1));
  const selected = selectPublicShareMedia(photos, tagsFor(photos), openPrivacy([100]), claims);
  assert.equal(selected.length, 100);
});

test("a full public-share snapshot keeps 31 media IDs and a bounded visual candidate pool", async () => {
  const result = await createOrReuseSessionAlbumPublicShare(user, 10, optionsFor(31));
  assert.equal(result.media_ids.length, 31);
  assert.equal(result.cover_media_ids.length, 30);
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test apps/api/test/album-single-media-share.test.mjs`

Expected: the new assertions fail because `selectPublicShareMedia` and snapshot normalization stop at 30.

- [ ] **Step 3: Implement the smallest contract change**

```js
// service.js
export function normalizePublicShareSelectedMediaIds(value) {
  if (value === undefined) return null;
  if (!Array.isArray(value) || value.length === 0) {
    throw badRequest("selectedMediaIds must contain at least one media ID");
  }
  // preserve the existing unique-positive-ID loop
}

// Only apply a maximum when the caller explicitly supplies one.
const max = options.max === undefined ? Infinity : Number(options.max);
```

Remove only the `selected.length >= 30` break in default selection and the implicit 30 maxima used for `media_ids` and `implicit_untagged_media`. Keep the `> 3` video validation. Before persisting a new snapshot, order `media_ids` by `created_at ASC, id ASC`; pass the complete selected set to `selectPublicShareCoverMedia`, retain at most 30 safe candidates for actual-buffer analysis, and limit the final renderer output—not the candidate list—to nine images.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `node --test apps/api/test/album-single-media-share.test.mjs`

Expected: all existing tests plus both new full-snapshot tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/core/service.js apps/api/test/album-single-media-share.test.mjs specs/d54-public-album-full-share-pagination/tasks.md
git commit -m "feat: snapshot all public album photos"
```

### Task 2: Service pagination and route contract

**Files:**
- Modify: `apps/api/src/modules/core/service.js:7071-7160`
- Modify: `apps/api/src/server.js:6170-6186`
- Create: `apps/api/test/album-public-share-pagination.test.mjs`
- Modify: `specs/d54-public-album-full-share-pagination/tasks.md`

- [ ] **Step 1: Write failing pagination tests**

```js
test("public-share pages scan a 100-item snapshot without duplicates", async () => {
  const first = await listPublicSessionAlbumShare(claims, { limit: 30 });
  const second = await listPublicSessionAlbumShare(claims, { cursor: first.next_cursor, limit: 30 });
  assert.equal(first.photos.length, 30);
  assert.equal(second.photos.length, 30);
  assert.equal(new Set([...first.photos, ...second.photos].map(({ id }) => id)).size, 60);
});

test("public-share pagination rejects a cursor from another share", async () => {
  const cursor = encodePublicSharePageCursor(50, 30);
  await assert.rejects(() => listPublicSessionAlbumShare(otherClaims, { cursor }), /Invalid album share cursor/);
});
```

- [ ] **Step 2: Run the new test and verify RED**

Run: `node --test apps/api/test/album-public-share-pagination.test.mjs`

Expected: failure because the cursor helpers and paged response fields do not exist.

- [ ] **Step 3: Implement HMAC cursor and bounded scan**

```js
const PUBLIC_SHARE_PAGE_SIZE = 30;

export function encodePublicSharePageCursor(shareId, offset) {
  const payload = Buffer.from(JSON.stringify({ share_id: positiveId(shareId, "shareId"), offset })).toString("base64url");
  const signature = crypto.createHmac("sha256", config.sessionSecret).update(`album-share-page:${payload}`).digest("base64url");
  return `${payload}.${signature}`;
}
```

Add a matching `decodePublicSharePageCursor(cursor, shareId)` using `crypto.timingSafeEqual`. Change `listPublicSessionAlbumShare(claims, options = {})` to scan `share.media_ids` from the decoded offset in chunks of at most `limit`, dynamically filter each chunk with the existing rules, and set the next cursor from the scanned offset. Return `next_cursor`, `has_more`, and the stable snapshot `visible_count`; retain legacy non-snapshot behavior. In `server.js`, pass `url.searchParams.get("cursor")` and `url.searchParams.get("limit")` to the service.

- [ ] **Step 4: Run focused pagination and share tests**

Run: `node --test apps/api/test/album-public-share-pagination.test.mjs apps/api/test/album-single-media-share.test.mjs`

Expected: all pagination, token-scope, full-snapshot, and existing share tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/core/service.js apps/api/src/server.js apps/api/test/album-public-share-pagination.test.mjs specs/d54-public-album-full-share-pagination/tasks.md
git commit -m "feat: paginate public album shares"
```

### Task 3: Mini-program page state

**Files:**
- Create: `apps/miniprogram/src/utils/albumPublicSharePagination.js`
- Create: `apps/miniprogram/test/albumPublicSharePagination.test.mjs`
- Modify: `apps/miniprogram/src/pages/session/album.vue:746-810,1160-1205,2015-2085`
- Modify: `specs/d54-public-album-full-share-pagination/tasks.md`

- [ ] **Step 1: Write failing pure-state tests**

```js
test("merges public-share pages by media ID and keeps the next cursor", () => {
  const next = mergePublicSharePages([{ id: 1 }, { id: 2 }], [{ id: 2 }, { id: 3 }], "cursor-2");
  assert.deepEqual(next.photos.map(({ id }) => id), [1, 2, 3]);
  assert.equal(next.nextCursor, "cursor-2");
});

test("builds a continuation URL only for a non-empty token and cursor", () => {
  assert.equal(publicSharePageUrl(10, "token", "cursor"), "/api/sessions/10/album/public-share?token=token&cursor=cursor");
});
```

- [ ] **Step 2: Run the helper test and verify RED**

Run: `node --test apps/miniprogram/test/albumPublicSharePagination.test.mjs`

Expected: failure because the helper module does not exist.

- [ ] **Step 3: Implement the helper and page integration**

```js
// albumPublicSharePagination.js
export function mergePublicSharePages(current = [], incoming = [], nextCursor = null) {
  const byId = new Map(current.map((photo) => [Number(photo.id), photo]));
  for (const photo of incoming) if (!byId.has(Number(photo?.id))) byId.set(Number(photo.id), photo);
  return { photos: [...byId.values()], nextCursor: String(nextCursor || "") || null };
}
```

In `album.vue`, add `publicShareNextCursor`, `publicShareHasMore`, `publicShareLoadingMore`, and `publicShareLoadMoreError`; reset them for every first-page load or token invalidation. Add `onReachBottom` and `loadMorePublicAlbum`, gate results with `albumListRequestAuthority`, append through the helper, refresh the waterfall, and preserve current photos when a continuation request fails. Do not invoke cover preparation from continuation responses.

- [ ] **Step 4: Run helper and static page checks**

Run: `node --test apps/miniprogram/test/albumPublicSharePagination.test.mjs apps/miniprogram/test/albumShareCover.test.mjs`

Expected: pagination-state tests and existing cover/menu tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/miniprogram/src/utils/albumPublicSharePagination.js apps/miniprogram/test/albumPublicSharePagination.test.mjs apps/miniprogram/src/pages/session/album.vue specs/d54-public-album-full-share-pagination/tasks.md
git commit -m "feat: load public album shares by page"
```

### Task 4: D54 release gate and final verification

**Files:**
- Create: `scripts/d54-public-album-full-share-pagination-check.js`
- Modify: `package.json`
- Modify: `specs/d54-public-album-full-share-pagination/tasks.md`

- [x] **Step 1: Write the D54 static gate**

```js
assert.match(serviceSource, /PUBLIC_SHARE_PAGE_SIZE\s*=\s*30/);
assert.match(serviceSource, /encodePublicSharePageCursor/);
assert.match(serverSource, /cursor:\s*url\.searchParams\.get\("cursor"\)/);
assert.match(albumSource, /loadMorePublicAlbum/);
```

- [x] **Step 2: Run it and correct its source-boundary assertion**

Run: `node scripts/d54-public-album-full-share-pagination-check.js`

Expected: the gate fails closed on an invalid source boundary and passes only after it targets the explicit public-share route.

- [x] **Step 3: Integrate the gate**

Add `d54:unit` for the API and mini-program pagination test files, and add `d54:check` for the static gate. Run both from the root `postcheck` lifecycle after the existing check completes.

- [x] **Step 4: Verify focused and complete checks**

Run:

```bash
npm run d54:unit
npm run d54:check
npm run d48:unit
npm run d50:unit
npm run d52:unit
npm run check
git diff --check
```

Expected: every command exits 0; D54 tests cover 31/100 photos, cursor integrity, page merging, a 30-item safety candidate pool, and a nine-image final-cover cap.

- [ ] **Step 5: Commit and record evidence**

```bash
git add scripts/d54-public-album-full-share-pagination-check.js package.json specs/d54-public-album-full-share-pagination/tasks.md
git commit -m "test: gate full public album pagination"
```
