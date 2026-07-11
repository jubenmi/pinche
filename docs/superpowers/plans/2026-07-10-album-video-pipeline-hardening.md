# Album Video Pipeline Hardening Implementation Plan

> **For Codex:** Execute this plan task-by-task with `superpowers:executing-plans`; use `superpowers:test-driven-development` for every behavior change and update `.kiro/specs/album-video-pipeline-hardening/tasks.md` after each green checkpoint.

**Goal:** Make admin video upload, storage verification, album playback, public sharing, authorization, and deletion deterministic and recoverable without expanding the product scope.

**Architecture:** Keep the existing album model and routes. Add small pure media-validation/range helpers, make storage metadata authoritative before video records are written, enforce source idempotency in MySQL, stream local video with single-range support, and move URL/auth/cache decisions into testable frontend helpers. Preserve the media row as the retry anchor until object cleanup succeeds.

**Tech Stack:** Node.js 20 ESM, native `node:assert`, MySQL 8, Vue 3, uni-app/WeChat mini program, COS signed requests.

**Execution note:** The current `develop` worktree contains user-owned, uncommitted D32 album/video implementation in the exact files this plan must harden. A new worktree from `HEAD` would omit that authoritative state. Execute in the current worktree, inspect each existing diff before editing, stage only files listed by the active task, and never stage unrelated city/calendar/catalog changes.

---

## Task 1: Establish D42 RED tests and isolated smoke gate

**Files:**
- Create: `scripts/d42-album-video-hardening-unit-check.js`
- Create: `scripts/d42-album-video-hardening-check.js`
- Create: `scripts/d42-album-video-hardening-smoke.js`
- Modify: `package.json`
- Modify: `.kiro/specs/album-video-pipeline-hardening/tasks.md`

**Step 1: Write the failing pure behavior test**

Import the not-yet-created helpers and assert:

```js
import assert from "node:assert/strict";
import { isMp4FileHeader, parseSingleByteRange } from "../apps/api/src/modules/album-video/media.js";
import {
  canOpenAlbumMediaPreview,
  compressVideoSizeBytes,
  shouldAttachApiAuthorization,
  videoUrlExpiresAt,
  canReuseVideoUrl
} from "../apps/miniprogram/src/utils/albumVideo.js";
import { shouldAttachAdminAuthorization, RequestSerial } from "../apps/admin-web/src/albumMedia.js";

assert.equal(compressVideoSizeBytes(1024), 1024 * 1024);
assert.equal(compressVideoSizeBytes(undefined), 0);
assert.equal(shouldAttachApiAuthorization("https://cos.example/a.mp4", "https://api.example"), false);
assert.equal(shouldAttachApiAuthorization("/api/a", "https://api.example"), true);
assert.equal(canOpenAlbumMediaPreview({ timelineMode: true, mediaType: "video", processingStatus: "ready" }), false);
assert.equal(canReuseVideoUrl("signed", videoUrlExpiresAt(600, 1_000), 1_000), true);
assert.equal(canReuseVideoUrl("signed", videoUrlExpiresAt(1, 1_000), 1_000), false);
assert.equal(shouldAttachAdminAuthorization("https://cos.example/a.jpg", "https://api.example"), false);
assert.equal(isMp4FileHeader(Buffer.from("0000001866747970", "hex")), true);
assert.deepEqual(parseSingleByteRange("bytes=10-19", 100), { start: 10, end: 19 });
assert.equal(new RequestSerial().next() + 1, new RequestSerial().next() + 1);
```

The final RequestSerial assertions in the actual file must use one instance and prove stale tokens are rejected.

**Step 2: Run the test and verify RED**

Run: `node scripts/d42-album-video-hardening-unit-check.js`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for the new helper modules.

**Step 3: Write the static architecture check**

Read the relevant source files and assert the implementation includes: explicit `:autoplay="false"`, a `video-error` retry path, a timeline preview guard, server object inspection before record creation, a `Range`/206/416 path, no local snapshot fallback, and no single-media assignment into `albumError`.

**Step 4: Add a write-before-connect smoke guard**

Export a pure `assertD42SmokeIsolation(env)` from the smoke script. It must reject unless all are true:

```text
NODE_ENV !== production
WECHAT_MOCK_LOGIN === true
D42_SMOKE_ISOLATED === 1
MYSQL_HOST in localhost, 127.0.0.1, ::1
MYSQL_DATABASE === pinche_d42_test
```

Invoke the guard before importing/starting the API or opening a database connection. With no arguments, print a skip message and exit 0; with `--run`, enforce the guard before any write.

**Step 5: Register commands**

Add `d42:check` and `d42:smoke` scripts. Include syntax/static D42 checks in `npm run check`, but never invoke the write smoke from the aggregate check.

**Step 6: Run RED and smoke-gate checks**

Run:

```bash
node scripts/d42-album-video-hardening-unit-check.js
node scripts/d42-album-video-hardening-smoke.js --run
```

Expected: unit FAIL for missing implementation; smoke FAIL before database access because the isolation variables are absent.

**Step 7: Update task board and commit tests**

Mark 2.1-2.5 complete only after every required RED assertion exists and has been observed failing. Commit only D42 scripts, `package.json`, the plan, and the task board:

```bash
git add docs/superpowers/plans/2026-07-10-album-video-pipeline-hardening.md .kiro/specs/album-video-pipeline-hardening/tasks.md scripts/d42-album-video-hardening-unit-check.js scripts/d42-album-video-hardening-check.js scripts/d42-album-video-hardening-smoke.js package.json
git commit -m "test: define album video hardening coverage"
```

## Task 2: Add backend media primitives and storage inspection

**Files:**
- Create: `apps/api/src/modules/album-video/media.js`
- Modify: `apps/api/src/storage/cos.js`
- Modify: `apps/api/src/server.js`
- Test: `scripts/d42-album-video-hardening-unit-check.js`

**Step 1: Extend RED tests**

Cover MP4 header acceptance/rejection; content-type/size validation; exact, open-ended, suffix, malformed, multi-range, and unsatisfiable ranges. Assert the object inspector rejects missing, empty, over-100MB, non-MP4 metadata, and bad headers.

**Step 2: Implement pure primitives**

Export:

```js
export const MAX_ALBUM_VIDEO_BYTES = 100 * 1024 * 1024;
export function isMp4FileHeader(bytes) { /* length >= 8 and bytes 4..7 === ftyp */ }
export function validateAlbumVideoObject({ byteSize, contentType, sourceUrl, headerBytes }) { /* return normalized metadata or throw 400 */ }
export function parseSingleByteRange(value, size) { /* null for no header; throw 416-compatible error otherwise */ }
```

Keep the helper independent of HTTP response objects so the unit script can exercise every branch.

**Step 3: Add COS metadata operations**

Export `headCosObject(url)` and `readCosObjectRange(url, start, end)` from `apps/api/src/storage/cos.js`, reusing the existing request signer. Return parsed content length/type and bytes; preserve 404 versus retryable 5xx/network errors.

**Step 4: Add unified object inspection**

In `server.js`, implement `inspectSessionAlbumVideoObject(sourceUrl)`:

- validate that the source belongs to the expected session/admin upload prefix;
- COS: HEAD plus `bytes=0-11`;
- local: resolve under the upload root, reject traversal, `stat`, open/read only 12 bytes;
- pass authoritative results through `validateAlbumVideoObject`.

**Step 5: Run GREEN tests**

Run: `node scripts/d42-album-video-hardening-unit-check.js`

Expected: backend primitive assertions PASS; frontend imports may still fail only until Task 6. If one combined file prevents partial green, split backend and frontend sections with dynamic imports and require the backend section to pass now.

**Step 6: Update tasks 3.3-3.6 and commit**

Commit only the media module, COS storage, server wiring, tests, and task board.

## Task 3: Enforce idempotent object-backed video creation

**Files:**
- Create: `apps/api/src/db/migrations/0022_session_album_video_hardening.sql`
- Modify: `apps/api/src/db/migrate.js`
- Modify: `apps/api/src/modules/core/service.js`
- Modify: `apps/api/src/server.js`
- Test: `scripts/d42-album-video-hardening-unit-check.js`
- Test: `scripts/d42-album-video-hardening-smoke.js`

**Step 1: Write RED service/database assertions**

Test through injectable `inspectObject` and database adapters that: missing objects cannot create a row; client byte/type lies are ignored; the same source returns the existing active video; duplicate-key races re-query and return the winner.

**Step 2: Add safe migration preflight**

Before migration 0022 executes, query non-null duplicate `source_url` groups and throw an error listing each source and `GROUP_CONCAT(id)`; do not mutate those rows. The SQL migration adds:

```sql
ALTER TABLE session_album_photos
  ADD UNIQUE KEY uniq_session_album_video_source_url (source_url);
```

**Step 3: Refactor creation**

`createSessionAlbumVideo` must:

1. validate user/session/admin path and scalar metadata;
2. call injected `inspectObject(sourceUrl)` before the transaction;
3. use inspected `byteSize` and `contentType` in the insert;
4. query existing active source before insert;
5. catch only MySQL duplicate-key and re-query the existing video;
6. never create `ready` when inspection fails.

Route code passes `inspectSessionAlbumVideoObject` rather than trusting the payload.

**Step 4: Run unit and isolated smoke**

Run unit normally. Run the database smoke only with the exact isolated environment and an explicitly provisioned `pinche_d42_test`; otherwise record it as blocked/unexecuted, never fall back to `pinche`.

**Step 5: Update tasks 3 and commit**

Mark the parent complete only after migration, preflight, inspection, authoritative metadata, and race behavior are all green.

## Task 4: Tighten authorization and multipart upload validation

**Files:**
- Modify: `apps/api/src/server.js`
- Modify: `apps/api/src/storage/cos.js` if authorization parsing belongs there
- Modify: `apps/miniprogram/src/utils/api.js`
- Test: `scripts/d42-album-video-hardening-unit-check.js`

**Step 1: Write RED tests**

Test that an MP4 extension cannot rescue a bad MIME/header, a MIME cannot rescue a bad extension/header, >100MB is rejected, valid MP4 passes, and COS authorization rejects visible over-limit/wrong-type headers.

**Step 2: Implement strict conjunction validation**

Multipart acceptance requires: size within limit, header valid, MIME absent or `video/mp4`, extension absent or `.mp4`. COS authorization validates `content-length`/`content-type` when present; record creation remains the final check.

**Step 3: Recheck local file size before direct COS upload**

Use `uni.getFileInfo`/provided temp-file size in bytes after receiving the intent. Reject unknown, zero, or >100MB rather than substituting `1`.

**Step 4: Run D42 and relevant D32 checks, update task 4, commit**

Run `node scripts/d42-album-video-hardening-unit-check.js` and `node scripts/d32-admin-album-video-check.js`.

## Task 5: Stream local video and implement HEAD/Range/cover behavior

**Files:**
- Modify: `apps/api/src/server.js`
- Test: `scripts/d42-album-video-hardening-unit-check.js`
- Test: `scripts/d42-album-video-hardening-check.js`

**Step 1: Write RED route-helper assertions**

Create a temporary MP4-shaped file and cover missing HEAD, real content length, full streamed GET, `bytes=0-7`, `bytes=8-`, `bytes=-8`, malformed/multi-range/unsatisfiable 416, and no local snapshot URL.

**Step 2: Implement dedicated local serving**

For local storage, `serveUploadedSessionAlbumVideoFile(media, response, { method, range })` must use `fs.stat` and `createReadStream`; set `Accept-Ranges: bytes`; send 206 plus `Content-Range` for valid ranges; send 416 plus `Content-Range: bytes */size` for invalid ranges; 404 on missing files. COS keeps signed redirect behavior.

**Step 3: Remove local snapshot fallback**

`signedAlbumVideoSnapshotUrl` returns an empty string when COS is disabled. The album mapper retains the existing video placeholder state.

**Step 4: Run checks, update task 5, commit**

## Task 6: Add frontend URL/auth/size helpers and viewer recovery

**Files:**
- Create: `apps/miniprogram/src/utils/albumVideo.js`
- Modify: `apps/miniprogram/src/utils/api.js`
- Modify: `apps/miniprogram/src/pages/session/album.vue`
- Modify: `apps/miniprogram/src/components/AlbumImageViewer.vue`
- Test: `scripts/d42-album-video-hardening-unit-check.js`
- Test: `scripts/d42-album-video-hardening-check.js`

**Step 1: Write RED pure tests**

Cover kB-to-byte conversion, thresholds using bytes, relative/API-origin versus COS-origin auth, URL expiry with 30-second skew, and public video preview denial.

**Step 2: Implement `albumVideo.js`**

Export pure helpers `compressVideoSizeBytes`, `shouldAttachApiAuthorization`, `videoUrlExpiresAt`, `canReuseVideoUrl`, and `canOpenAlbumMediaPreview`. Invalid/unknown compressed sizes return 0 and force a fresh file-info lookup or rejection.

**Step 3: Use byte-safe upload values**

Only `wx.compressVideo.success.size` is multiplied by 1024. Keep `chooseMedia` and `getFileInfo` sizes unchanged. Use the resulting bytes for 20MB/100MB checks, confirmation copy, and payload.

**Step 4: Stop Bearer leakage**

All mini-program media download/request paths call `shouldAttachApiAuthorization(url, getApiBaseUrl())`; absolute COS URLs receive no business Bearer, while relative/API-origin URLs retain it.

**Step 5: Make viewer recoverable**

- bind video `:autoplay="false"`;
- emit `video-error` on the node error;
- expose click retry that emits `need-video`;
- cache `video_url_expires_at` from `expiresInSeconds`;
- refresh before expiry;
- auto-refresh once per active video after an error, then await user retry;
- keep transient load failure only in `previewPhotos`;
- keep close/swipe pause behavior.

**Step 6: Enforce timeline boundary**

Timeline video cards show no playable badge; tapping shows `打开小程序查看视频`; they never enter the viewer or request a member video URL. Member mixed-media ordering remains unchanged.

**Step 7: Run unit/static/D31/D23 and build, update tasks 6-8.1, commit**

Run:

```bash
node scripts/d42-album-video-hardening-unit-check.js
node scripts/d42-album-video-hardening-check.js
node scripts/d31-album-viewer-sequence-check.js
node scripts/d23-album-share-join-policy-check.js
npm -C apps/miniprogram run build:mp-weixin
```

## Task 7: Fix admin cross-origin auth, stale tag requests, and local errors

**Files:**
- Create: `apps/admin-web/src/albumMedia.js`
- Modify: `apps/admin-web/src/api.js`
- Modify: `apps/admin-web/src/components/AuthorizedLazyImage.vue` or the component that owns authorized image fetch
- Modify: `apps/admin-web/src/components/SessionAlbumWorkspace.vue`
- Test: `scripts/d42-album-video-hardening-unit-check.js`
- Test: `scripts/d42-album-video-hardening-check.js`

**Step 1: Write RED tests**

Cover admin same-origin authorization and `RequestSerial`: token 1 becomes stale after token 2; only the latest result can commit. Static assertions reject assignments of video URL, preview, cover, or tag failures into `albumError`.

**Step 2: Implement shared admin helper**

`shouldAttachAdminAuthorization(url, apiBaseUrl)` mirrors the mini-program origin boundary. `RequestSerial` exposes `next()` and `isCurrent(token)`.

**Step 3: Apply safe media fetching**

`fetchAuthorizedMediaObjectUrl` attaches Bearer only to relative/API-origin URLs. The lazy image component emits `{ status }` when fetch fails.

**Step 4: Fix cover and tag races**

Refresh video media metadata once for 401/403 cover failures, merge by media id, and leave further failure local. Guard `openTagDrawer` post-await state writes with the latest request token.

**Step 5: Separate fatal and local errors**

Reserve `albumError` for the initial/main album load. Route video URL, cover, tag preview/save, and single-delete errors to `albumStatus` or media-scoped state so the waterfall and controls stay available.

**Step 6: Run D42/D32 and admin build, update tasks 8.2-9, commit**

## Task 8: Make video deletion cleanup-first and retryable

**Files:**
- Modify: `apps/api/src/modules/core/service.js`
- Modify: `apps/api/src/server.js`
- Modify: `apps/api/src/storage/cos.js`
- Test: `scripts/d42-album-video-hardening-unit-check.js`
- Test: `scripts/d42-album-video-hardening-smoke.js`

**Step 1: Write RED state-transition tests**

With injected cleanup functions, prove: authorization happens before cleanup; 404 is success; network/5xx retains the active DB row; a retry tolerates already-missing objects; tags/media delete only after all distinct object URLs succeed; repeat delete is idempotent.

**Step 2: Split prepare and finalize**

Add service operations that prepare an authorized deletion snapshot without mutation and finalize tag/media deletion transactionally after cleanup. Keep existing image behavior unchanged unless the same cleanup-first path is already compatible.

**Step 3: Cleanup distinct source/display/cover URLs**

Treat storage 404 as success. Propagate retryable failure before calling finalize. Do not delete the DB row first.

**Step 4: Run tests, update task 10, commit**

## Task 9: Full verification and task closure

**Files:**
- Modify: `.kiro/specs/album-video-pipeline-hardening/tasks.md`
- Modify: implementation/test files only if verification exposes an in-scope defect

**Step 1: Run D42 verification**

```bash
npm run d42:check
node scripts/d42-album-video-hardening-smoke.js
```

Run `npm run d42:smoke -- --run` only with the isolated database environment. Never substitute the default database.

**Step 2: Run repository regressions**

```bash
npm run check
node scripts/d31-album-viewer-sequence-check.js
node scripts/d32-admin-album-video-check.js
node scripts/d18-session-album-privacy-check.js
node scripts/d23-album-share-join-policy-check.js
npm -C apps/admin-web run build
npm -C apps/miniprogram run build:mp-weixin
```

**Step 3: Inspect the final diff**

Use `git diff --check`, `git status --short`, and path-scoped diffs. Confirm no unrelated dirty file is staged. Confirm every requirement maps to either a passing automated assertion or the remaining manual WeChat checklist.

**Step 4: Perform or clearly record manual verification**

Use WeChat developer tools if available to verify member open/manual play/swipe pause, timeline no-play, retry after forced failure, and admin cover/tag race behavior. If unavailable, keep 11.6 unchecked and report it explicitly; do not claim it passed.

**Step 5: Close tasks and commit**

Mark only evidenced items complete, append exact commands/results to the verification record, and commit the task-board closure plus any last in-scope fixes. Then use `superpowers:verification-before-completion` before reporting completion.
