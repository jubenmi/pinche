# Album Single-Media Sharing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an album member share the currently open approved image or ready video into a one-item public presentation with a `查看完整相册` conversion action backed by the same bounded D48 snapshot.

**Architecture:** Extend D48 snapshot selection with an optional required media ID, then reuse the existing public album route in a focused presentation mode. Add a v2-snapshot-bound public video capability that reauthorizes each application request and proxies local/COS byte ranges. Keep mini-program race control in a pure helper while the page owns tokens, API calls, routing, and the share hook.

**Tech Stack:** Node.js ESM, `node:test`, MySQL service layer, HMAC signed capabilities, COS storage helpers, Vue 2/uni-app, WeChat Mini Program native share button.

---

## File map

- Create `specs/d50-album-single-media-sharing/{requirements.md,design.md,tasks.md}`: D50 source of truth and live progress board.
- Create `scripts/d50-album-single-media-sharing-check.js`: static contract for spec, API, page, viewer, and non-goals.
- Create `apps/api/test/album-single-media-share.test.mjs`: focused selector and capability pure/service contract tests.
- Modify `apps/api/src/modules/core/service.js`: required-media selection and public video authorization.
- Modify `apps/api/src/server.js`: share-token body, focused response, public video capability, local/COS range responder.
- Create `apps/miniprogram/src/utils/albumSingleMediaShare.js`: pure focused-share cache and route helpers.
- Create `apps/miniprogram/test/albumSingleMediaShare.test.mjs`: race, cache, route, and target lookup tests.
- Modify `apps/miniprogram/src/components/AlbumImageViewer.vue`: presentational share state and public-focused CTA.
- Modify `apps/miniprogram/src/pages/session/album.vue`: sender preparation, share hook, focused recipient mode, public video URL loading.
- Modify `package.json`: D50 unit/check scripts and root check integration.
- Modify `scripts/d48-album-sharing-role-claim-separation-smoke.js`, `scripts/d32-admin-album-video-smoke.js`, and focused D31/D42 checkers only where D50 adds an explicit contract.

### Task 1: Commit the D50 specification and failing contract shell

**Files:**
- Create: `specs/d50-album-single-media-sharing/requirements.md`
- Create: `specs/d50-album-single-media-sharing/design.md`
- Create: `specs/d50-album-single-media-sharing/tasks.md`
- Create: `scripts/d50-album-single-media-sharing-check.js`
- Modify: `package.json`

- [ ] **Step 1: Verify the three spec files have no placeholders**

Run:

```bash
rg -n "T[B]D|TO[D]O|FIXM[E]|PLACEHOLDE[R]|implement lat[e]r" specs/d50-album-single-media-sharing docs/superpowers/plans/2026-07-19-album-single-media-sharing.md
```

Expected: no output.

- [ ] **Step 2: Write the initial static contract**

Create `scripts/d50-album-single-media-sharing-check.js` with assertions that read the three spec files, `service.js`, `server.js`, `album.vue`, and `AlbumImageViewer.vue`. The production assertions must initially require these literal contracts so the check is red before implementation:

```js
assert(service.includes("ALBUM_PUBLIC_SHARE_MEDIA_UNAVAILABLE"));
assert(server.includes("focus_media_id"));
assert(server.includes("/public-share/media/${mediaId}/video-url"));
assert(server.includes("session-album-public-video-file"));
assert(albumPage.includes('source === "single_media_share"'));
assert(albumPage.includes('primary-action-label="查看完整相册"'));
assert(viewer.includes('open-type="share"'));
```

The checker must also assert the D50 requirements retain `最多 30`, `最多 3`, `Range`, `查看完整相册`, and every listed non-goal.

- [ ] **Step 3: Add only the D50 static-check shell to the root package**

Add this root script:

```json
"d50:check": "node scripts/d50-album-single-media-sharing-check.js"
```

Add `node --check scripts/d50-album-single-media-sharing-check.js` to `check`. Do not add `d50:unit` or D50 `precheck` wiring in this intentionally red phase: the API and mini-program test files do not exist yet. Task 8 adds both only after Tasks 2 and 5 have created those files and the full D50 implementation is green.

- [ ] **Step 4: Run the static checker to verify RED**

Run:

```bash
node scripts/d50-album-single-media-sharing-check.js
```

Expected: FAIL on the first missing production contract, not on spec content or checker syntax.

- [ ] **Step 5: Record and commit the spec phase**

Update D50.1 and the Step 4 red-light note in `tasks.md`, then run:

```bash
git add specs/d50-album-single-media-sharing docs/superpowers/plans/2026-07-19-album-single-media-sharing.md scripts/d50-album-single-media-sharing-check.js package.json
git commit -m "spec: define album single-media sharing"
```

Expected: one commit containing only D50 spec/plan/contract wiring.

### Task 2: Implement required-media snapshot selection with TDD

**Files:**
- Create: `apps/api/test/album-single-media-share.test.mjs`
- Modify: `apps/api/src/modules/core/service.js`
- Modify: `apps/api/src/server.js`
- Modify: `scripts/d48-album-sharing-role-claim-separation-smoke.js`
- Modify: `specs/d50-album-single-media-sharing/tasks.md`

- [ ] **Step 1: Write selector tests before production code**

Use `node:test` and import `selectPublicShareMedia`. Define approved image/video rows and D48 tags/privacy fixtures. The assertions must include:

```js
const selected = selectPublicShareMedia(candidates, tagsMap, privacyByUser, claims, {
  requiredMediaId: 1
});
assert.equal(selected[0].id, 1);
assert.equal(selected.length, 30);

const withRequiredVideo = selectPublicShareMedia(videoCandidates, videoTags, privacy, claims, {
  requiredMediaId: 100
});
assert(withRequiredVideo.some((row) => row.id === 100));
assert.equal(withRequiredVideo.filter((row) => row.media_type === "video").length, 3);

assert.equal(
  selectPublicShareMedia(candidates, tagsMap, privacyByUser, claims, {
    requiredMediaId: 999
  }).some((row) => row.id === 999),
  false
);
```

Also assert an omitted option produces the exact previous D48 ordering.

- [ ] **Step 2: Run selector tests to verify RED**

Run:

```bash
node --test apps/api/test/album-single-media-share.test.mjs
```

Expected: FAIL because `requiredMediaId` does not affect selection.

- [ ] **Step 3: Implement minimal required selection**

Change the selector signature to accept `options = {}`. After filtering and sorting, find the required ranked entry, seed `selected` and `videoCount` with it, then traverse the remaining ranked entries while skipping the required ID. Do not alter the old path when no required ID is present.

The essential implementation shape is:

```js
const requiredMediaId = Number(options.requiredMediaId || 0);
const required = requiredMediaId
  ? ranked.find(({ photo }) => Number(photo.id) === requiredMediaId)
  : null;
const selected = required ? [required.photo] : [];
let videoCount = required && albumMediaType(required.photo) === "video" ? 1 : 0;
for (const { photo } of ranked) {
  if (required && Number(photo.id) === requiredMediaId) continue;
  if (albumMediaType(photo) === "video" && videoCount >= 3) continue;
  selected.push(photo);
  if (albumMediaType(photo) === "video") videoCount += 1;
  if (selected.length >= 30) break;
}
```

- [ ] **Step 4: Run selector tests to verify GREEN**

Run the Task 2 Step 2 command.

Expected: all focused selector tests pass.

- [ ] **Step 5: Add service and route focus behavior**

Normalize `options.focusMediaId` as absent or positive integer, pass it to the selector, and after selection require:

```js
if (focusMediaId && !selectedMedia.some((media) => Number(media.id) === focusMediaId)) {
  throw new AppError(
    409,
    "ALBUM_PUBLIC_SHARE_MEDIA_UNAVAILABLE",
    "The selected album media is not available to share"
  );
}
```

Return `focus_media_id: focusMediaId || null`. In `server.js`, call `const body = await bodyFor(request)` and pass `{ focusMediaId: body.focusMediaId }`. Include `focus_media_id` in the JSON response.

- [ ] **Step 6: Verify RED/GREEN for route contracts and D48 regression**

Run:

```bash
node --test apps/api/test/album-single-media-share.test.mjs
node scripts/d48-album-sharing-role-claim-separation-smoke.js
node scripts/d23-album-share-join-policy-check.js
```

Expected: focused tests and existing D48/D23 contracts pass.

- [ ] **Step 7: Update task tracking and commit**

Mark D50.2 selector items and D50.3 complete with the observed commands, then:

```bash
git add apps/api/test/album-single-media-share.test.mjs apps/api/src/modules/core/service.js apps/api/src/server.js scripts/d48-album-sharing-role-claim-separation-smoke.js specs/d50-album-single-media-sharing/tasks.md
git commit -m "feat: include focused media in album shares"
```

### Task 3: Implement public video authorization and capability with TDD

**Files:**
- Modify: `apps/api/test/album-single-media-share.test.mjs`
- Modify: `apps/api/src/modules/core/service.js`
- Modify: `apps/api/src/server.js`
- Modify: `scripts/d32-admin-album-video-smoke.js`
- Modify: `specs/d50-album-single-media-sharing/tasks.md`

- [ ] **Step 1: Write public video authorization tests**

Add tests for a wished-for `getPublicSessionAlbumVideoForPlayback` using an injectable connection/transaction option or a focused exported pure validator. Cover: active published ready snapshot video succeeds; image, processing video, missing display URL, cross-session ID, snapshot-external ID, revoked share, and privacy-vetoed video fail closed.

The success assertion must inspect only the internal returned fixture:

```js
const media = await getPublicSessionAlbumVideoForPlayback(claims, 77, {
  withConnection: async (work) => work(connection)
});
assert.equal(media.id, 77);
assert.equal(media.media_type, "video");
```

- [ ] **Step 2: Run authorization tests to verify RED**

Run:

```bash
node --test apps/api/test/album-single-media-share.test.mjs
```

Expected: FAIL because the public playback getter does not exist.

- [ ] **Step 3: Implement the public video service getter**

Mirror `getPublicSessionAlbumPhotoForMedia`, but require v2 `shareId`, `media_type=video`, published moderation, `processing_status=ready`, and `display_url`. Load the active share, require snapshot membership, rebuild tags/privacy, and call `isAlbumPhotoVisibleInPublicShare` before returning the row.

- [ ] **Step 4: Run authorization tests to verify GREEN**

Run Task 3 Step 2.

Expected: all service authorization cases pass.

- [ ] **Step 5: Write token and route contract tests before route code**

Add assertions that a capability is bound to `shareId`, `sessionId`, `mediaId`, digest, purpose, and expiry; tampered media ID and expired token fail. Add static/live route checks for:

```text
/api/session-album/public-share/media/:id/video-url
/api/session-album/public-share/media/:id/video-file
```

Run the focused test/check and confirm RED on missing routes.

- [ ] **Step 6: Implement capability signing and routes**

Use a dedicated signed purpose `session-album-public-video-file`. `video-url` verifies the D48 album token, calls the service getter, signs a 10-minute capability, and returns an application URL plus `expiresInSeconds`. `video-file` verifies exact media ID/purpose/expiry, calls the service getter again, and dispatches to the public video responder.

- [ ] **Step 7: Verify route GREEN without weakening the public DTO**

Run:

```bash
node --test apps/api/test/album-single-media-share.test.mjs
node scripts/d32-admin-album-video-smoke.js
node scripts/d48-album-sharing-role-claim-separation-check.js
```

Expected: capability tests pass and D32 still proves public DTO rows contain no direct playback URL.

### Task 4: Implement range-correct local and COS public video responses

**Files:**
- Modify: `apps/api/test/album-single-media-share.test.mjs`
- Modify: `apps/api/src/server.js`
- Modify: `scripts/d42-album-video-server-check.js`
- Modify: `specs/d50-album-single-media-sharing/tasks.md`

- [ ] **Step 1: Write responder tests before production code**

Test an exported `createPublicAlbumVideoResponse` with injected `headObject` and `readObjectRange`. Cover HEAD, full GET, exact range, suffix range, and unsatisfiable range. For COS assert `readObjectRange` receives the authoritative ETag via `ifMatch`, response status is 200/206/416, and no `location` header exists.

- [ ] **Step 2: Run responder tests to verify RED**

Run:

```bash
node --test apps/api/test/album-single-media-share.test.mjs
```

Expected: FAIL because the public responder does not exist.

- [ ] **Step 3: Implement the local branch**

Reuse `createLocalAlbumVideoResponse` and preserve its headers. Add `cache-control: private, no-store`; pipeline the body and return no body for HEAD/416.

- [ ] **Step 4: Implement the COS branch with bounded reads**

HEAD the object and validate authoritative MP4 metadata. Parse the client range with `parseSingleByteRange`. For a requested range, call `readCosObjectRange` with exact start/end and ETag. For a full GET, iterate fixed 1 MiB chunks from 0 to size-1 and write each buffer before reading the next chunk. Set the exact 200/206/416 headers and never emit a redirect or COS URL.

- [ ] **Step 5: Run focused and D42 checks to verify GREEN**

Run:

```bash
node --test apps/api/test/album-single-media-share.test.mjs
npm run d42:api-media
npm run d42:api-server
node scripts/d42-album-video-stream-check.js
```

Expected: focused responder and all existing video transport checks pass.

- [ ] **Step 6: Update tracking and commit Tasks 3–4**

Mark D50.4 complete with test counts, then:

```bash
git add apps/api/test/album-single-media-share.test.mjs apps/api/src/modules/core/service.js apps/api/src/server.js scripts/d32-admin-album-video-smoke.js scripts/d42-album-video-server-check.js specs/d50-album-single-media-sharing/tasks.md
git commit -m "feat: add public album video capabilities"
```

### Task 5: Implement the mini-program pure share state with TDD

**Files:**
- Create: `apps/miniprogram/test/albumSingleMediaShare.test.mjs`
- Create: `apps/miniprogram/src/utils/albumSingleMediaShare.js`
- Modify: `specs/d50-album-single-media-sharing/tasks.md`

- [ ] **Step 1: Write pure helper tests**

Tests must cover positive ID normalization, invalid input, cache entries by ID, out-of-order resolution, current-item projection, no fallback target lookup, and exact query encoding:

```js
assert.equal(normalizeFocusedMediaId("12"), 12);
assert.equal(normalizeFocusedMediaId("0"), null);
assert.equal(focusedPublicMedia([{ id: 1 }], 2), null);

const authority = createSingleMediaShareAuthority();
const first = authority.begin(1);
const second = authority.begin(2);
authority.resolve(second, { status: "ready", mediaId: 2 });
authority.resolve(first, { status: "ready", mediaId: 1 });
assert.equal(authority.entryFor(2).mediaId, 2);
assert.equal(authority.currentEntry(2).mediaId, 2);
```

- [ ] **Step 2: Run helper tests to verify RED**

Run:

```bash
node --test apps/miniprogram/test/albumSingleMediaShare.test.mjs
```

Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement the minimal helper module**

Use closures and immutable entry replacement. The authority must keep a serial per request, store results only under the request media ID, and make `currentEntry(mediaId)` return null unless that exact entry is ready/blocked/failed for the requested ID. Build the path with the existing query semantics:

```js
return `/pages/session/album?${new URLSearchParams({
  id: String(sessionId),
  source: "single_media_share",
  albumShareToken: token,
  focusMediaId: String(mediaId)
}).toString()}`;
```

- [ ] **Step 4: Run helper tests to verify GREEN**

Run Task 5 Step 2.

Expected: all helper tests pass.

- [ ] **Step 5: Update tracking and commit**

Mark D50.5 complete, then:

```bash
git add apps/miniprogram/src/utils/albumSingleMediaShare.js apps/miniprogram/test/albumSingleMediaShare.test.mjs specs/d50-album-single-media-sharing/tasks.md
git commit -m "feat: add album single-share state"
```

### Task 6: Wire the sender viewer share action

**Files:**
- Modify: `apps/miniprogram/src/components/AlbumImageViewer.vue`
- Modify: `apps/miniprogram/src/pages/session/album.vue`
- Modify: `scripts/d31-album-viewer-sequence-check.js`
- Modify: `scripts/check-miniprogram.js`
- Modify: `scripts/d50-album-single-media-sharing-check.js`
- Modify: `specs/d50-album-single-media-sharing/tasks.md`

- [ ] **Step 1: Tighten static/viewer tests to verify RED**

Require `shareStatus`, current `data-media-id`, `open-type="share"`, `share-status-tap`, and page code that POSTs `{ focusMediaId }` and checks `focus_media_id`. Run D50/D31 checks and confirm failure before production edits.

- [ ] **Step 2: Add presentational viewer props and controls**

Add `shareStatus`, `showCounter`, and `primaryActionLabel` props. Render the counter only when enabled. Render a native share button only when status is ready; render a non-native action for loading/blocked/failed that emits `share-status-tap`. Preserve close/download layout and pointer-event behavior.

- [ ] **Step 3: Add sender preparation in the page**

Create one authority instance in page data. On open/change call `prepareSingleMediaShare(currentPhoto)`. POST focus ID, verify exact response ID/token, prepare image/video-cover share image with safe fallback, and resolve only that ID. Map 409 to blocked and transport errors to failed.

- [ ] **Step 4: Make the share hook dataset-driven**

Change `onShareAppMessage(options)` so button shares use `options.target.dataset.mediaId` and its exact ready cache entry. Keep the current no-argument/menu path unchanged for full-album sharing.

- [ ] **Step 5: Run sender checks and build**

Run:

```bash
node --test apps/miniprogram/test/albumSingleMediaShare.test.mjs
node scripts/d31-album-viewer-sequence-check.js
node scripts/check-miniprogram.js
node scripts/d50-album-single-media-sharing-check.js
npm run build:mp-weixin
```

Expected: all focused checks pass and the production mini-program build exits 0.

### Task 7: Wire public focused mode and public video loading

**Files:**
- Modify: `apps/miniprogram/src/pages/session/album.vue`
- Modify: `apps/miniprogram/src/components/AlbumImageViewer.vue`
- Modify: `apps/miniprogram/test/albumSingleMediaShare.test.mjs`
- Modify: `scripts/check-miniprogram.js`
- Modify: `scripts/d50-album-single-media-sharing-check.js`
- Modify: `specs/d50-album-single-media-sharing/tasks.md`

- [ ] **Step 1: Add focused recipient tests to verify RED**

Extend helper/static tests to require: parsing `single_media_share`; no fallback when target absent; one-item preview array; `showCounter=false`; `primaryActionLabel="查看完整相册"`; CTA exits focus; public video URL endpoint uses album token.

- [ ] **Step 2: Parse route and open one-item focused mode**

Store `singleMediaShareMode`, normalized `focusMediaId`, and a focused unavailable flag. After `loadPublicAlbum` commits its current response, locate the target by ID. If found, open the viewer with `[target]`; if absent, keep the public list loaded but display `该内容已不可查看` without selecting another item.

- [ ] **Step 3: Implement the CTA transition**

Pass `showCounter=false` and `primaryActionLabel="查看完整相册"`. On `primary-action`, close the overlay, clear focused mode, and reveal the already loaded public waterfall. Preserve the same album token and do not authenticate.

- [ ] **Step 4: Enable public ready-video playback**

Allow a ready video in focused public preview. In `loadPreviewVideoUrl`, choose:

```js
const videoUrlEndpoint = this.timelineMode
  ? `/api/session-album/public-share/media/${photo.id}/video-url${queryString({ token: this.albumShareToken })}`
  : `/api/session-album/media/${photo.id}/video-url`;
```

Remove only the timeline guard required for this focused ready-video path; keep public full-album video behavior unchanged unless the focused route is active. Reuse existing failure transitions.

- [ ] **Step 5: Run focused UI and regression checks**

Run the Task 6 Step 5 commands plus:

```bash
npm run d42:mini
node scripts/d32-admin-album-video-check.js
```

Expected: D50 focused image/video flow passes without changing existing full-album menu behavior.

- [ ] **Step 6: Update tracking and commit Tasks 6–7**

Mark D50.6–D50.7 complete with observed commands, then:

```bash
git add apps/miniprogram/src/components/AlbumImageViewer.vue apps/miniprogram/src/pages/session/album.vue apps/miniprogram/test/albumSingleMediaShare.test.mjs scripts/d31-album-viewer-sequence-check.js scripts/check-miniprogram.js scripts/d50-album-single-media-sharing-check.js specs/d50-album-single-media-sharing/tasks.md
git commit -m "feat: share focused album media"
```

### Task 8: Full verification and task closure

**Files:**
- Modify: `package.json`
- Modify: `specs/d50-album-single-media-sharing/tasks.md`

- [ ] **Step 1: Wire the green D50 unit suite into the root scripts**

After Task 2 has created `apps/api/test/album-single-media-share.test.mjs`, Task 5 has created `apps/miniprogram/test/albumSingleMediaShare.test.mjs`, and Tasks 2–7 have made the D50 static contract green, add:

```json
"d50:unit": "node --test apps/api/test/album-single-media-share.test.mjs apps/miniprogram/test/albumSingleMediaShare.test.mjs"
```

Then prepend `npm run d50:unit && npm run d50:check` to `precheck`.

- [ ] **Step 2: Run all D50 tests and contracts**

Run:

```bash
npm run d50:unit
npm run d50:check
```

Expected: all D50 tests and static contracts pass.

- [ ] **Step 3: Run required focused regressions**

Run:

```bash
node scripts/d48-album-sharing-role-claim-separation-smoke.js
node scripts/d48-album-sharing-role-claim-separation-check.js
node scripts/d23-album-share-join-policy-check.js
node scripts/d31-album-viewer-sequence-check.js
node scripts/d32-admin-album-video-check.js
npm run d42:api-media
npm run d42:api-server
npm run d42:mini
```

Expected: every command exits 0.

- [ ] **Step 4: Run complete verification**

Run:

```bash
npm run check
npm run build:mp-weixin
```

Expected: both commands exit 0; existing Sass deprecation warnings are allowed, new errors are not.

- [ ] **Step 4: Inspect requirements and diff item by item**

Read `requirements.md`, `design.md`, and `tasks.md`, then inspect:

```bash
git diff --check
git status --short
git diff --stat develop...HEAD
git diff develop...HEAD -- apps/api/src/modules/core/service.js apps/api/src/server.js apps/miniprogram/src/utils/albumSingleMediaShare.js apps/miniprogram/src/components/AlbumImageViewer.vue apps/miniprogram/src/pages/session/album.vue
```

Expected: every production edit maps to D50; no migration, new page, direct media URL, interaction feature, or unrelated refactor appears.

- [ ] **Step 5: Record automated and manual status accurately**

Mark only completed D50.8 items. If WeChat native share panels or real COS video require a configured external environment, leave those exact boxes unchecked and record the blocker; do not mark D50.8 parent complete.

- [ ] **Step 6: Commit verification records**

```bash
git add specs/d50-album-single-media-sharing/tasks.md
git commit -m "test: verify album single-media sharing"
```

Expected: a final tracking-only commit if the task file changed after production commits.
