# Admin Video Unlimited Upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow `system_admin` users to upload compressed MP4 album videos without application-level duration or file-size caps while ordinary users remain unable to upload video.

**Architecture:** Keep authorization at the admin routes and remove global 60-second/100MB caps from the authorized video metadata path. Make the multipart parser accept optional byte limits so the admin route can be uncapped while explicit limits remain reusable for future member uploads. In the mini-program, distinguish the WeChat camera recording parameter from upload policy and fail closed unless `wx.compressVideo` returns a distinct, valid output file.

**Tech Stack:** Node.js ESM, `node:assert`, custom D42 verification scripts, Vue/uni-app mini-program, WeChat `wx.chooseMedia` and `wx.compressVideo`, Tencent COS.

---

## File map

- Modify `apps/api/src/modules/core/service.js`: accept every positive admin video duration while retaining admin authorization.
- Modify `apps/api/src/modules/album-video/media.js`: validate positive safe byte sizes and MP4 facts without a global 100MB cap.
- Modify `apps/api/src/modules/album-video/multipart-stream.js`: support an uncapped streaming mode plus explicit finite limits.
- Modify `apps/api/src/server.js`: remove the admin video `maxBytes` intent field and finite local upload limit wiring.
- Modify `apps/miniprogram/src/utils/albumVideo.js`: expose the pure predicate that recognizes a mandatory usable compression result.
- Modify `apps/miniprogram/src/pages/session/album.vue`: always compress, fail closed, and remove duration/size rejection branches.
- Modify `scripts/d42-album-video-hardening-unit-check.js`: replace obsolete cap assertions with positive large-value and compression-result contracts.
- Modify `scripts/d42-album-video-stream-check.js`: prove uncapped multipart mode and preserve explicit finite cap coverage.
- Modify `scripts/d42-album-video-server-check.js`: prove admin intent/local upload wiring omits business byte caps.
- Modify `scripts/d42-miniprogram-album-video-check.js`: prove ordinary users remain image-only and admin uploads always use a valid compressed file.
- Modify `scripts/d32-admin-album-video-check.js` and `scripts/check-miniprogram.js`: update historical static contracts so repository-wide checks describe the new admin-only policy.

### Task 1: Remove global duration and metadata byte caps

**Files:**
- Modify: `scripts/d42-album-video-hardening-unit-check.js:140-180, 500-560, 1469-1510, 2030-2050`
- Modify: `apps/api/src/modules/album-video/media.js:1-40`
- Modify: `apps/api/src/modules/core/service.js:75-90, 600-615`

- [ ] **Step 1: Replace the obsolete 100MB RED contracts**

Change the API-media tests so a positive size above 100MB is accepted by object, multipart-metadata, and COS-header validation:

```js
test("authoritative video metadata accepts a positive size larger than 100MB", async () => {
  const { validateAlbumVideoObject } = await apiMediaHelpers();
  assert.deepEqual(
    validateAlbumVideoObject({
      byteSize: MAX_VIDEO_BYTES + 1,
      contentType: "video/mp4",
      headerBytes: MP4_HEADER
    }),
    { byteSize: MAX_VIDEO_BYTES + 1, contentType: "video/mp4" }
  );
});

test("multipart metadata accepts a positive size larger than 100MB", async () => {
  const { validateMultipartAlbumVideoMetadata } = await apiMediaHelpers();
  assert.deepEqual(
    validateMultipartAlbumVideoMetadata({
      byteSize: MAX_VIDEO_BYTES + 1,
      contentType: "video/mp4",
      filename: "clip.mp4",
      headerBytes: MP4_HEADER
    }),
    { byteSize: MAX_VIDEO_BYTES + 1, contentType: "video/mp4" }
  );
});

test("COS visible upload headers accept a positive length over 100MB", async () => {
  const { validateCosAlbumVideoHeaders } = await apiMediaHelpers();
  assert.deepEqual(
    validateCosAlbumVideoHeaders({
      contentLength: String(MAX_VIDEO_BYTES + 1),
      contentType: "video/mp4"
    }),
    { byteSize: MAX_VIDEO_BYTES + 1, contentType: "video/mp4" }
  );
});
```

Remove the oversized entry from the table named `object inspection rejects ... before reading a byte range`; add a success test whose storage metadata reports `MAX_VIDEO_BYTES + 1` and whose range returns `MP4_HEADER`.

- [ ] **Step 2: Add a RED contract for a long admin duration and unchanged ordinary-user denial**

Remove `durationSeconds: 61` from the invalid-case table and add:

```js
test("video creation allows an admin duration above 60 seconds", async () => {
  const { createSessionAlbumVideo } = await apiCoreService();
  let inspections = 0;
  await assert.rejects(
    createSessionAlbumVideo(
      CREATION_USER,
      CREATION_SESSION_ID,
      creationBody({ durationSeconds: 3_600 }),
      {
        withDatabaseConnection: async (run) => run({}),
        authorizeSessionAlbumVideoCreate: async () => {},
        inspectObject: async () => {
          inspections += 1;
          throw new Error("stop after duration validation");
        }
      }
    ),
    /stop after duration validation/
  );
  assert.equal(inspections, 1);
});
```

Keep the existing invalid case whose roles array is empty; it proves an ordinary user is still rejected before dependencies run.

- [ ] **Step 3: Run the focused tests and verify RED**

Run:

```bash
node scripts/d42-album-video-hardening-unit-check.js --scope=api-media
node scripts/d42-album-video-hardening-unit-check.js --scope=api-creation
```

Expected: the large-size acceptance tests fail with 413 and the long-duration test fails with `durationSeconds must be at most 60 seconds`.

- [ ] **Step 4: Implement positive-only duration and byte validation**

In `media.js`, remove `MAX_ALBUM_VIDEO_BYTES`, `payloadTooLarge`, and the maximum comparison. Keep the positive safe-integer rule:

```js
function normalizeByteSize(value, { required = true } = {}) {
  if (!required && (value === undefined || value === null || value === "")) {
    return undefined;
  }
  const normalized = typeof value === "string" && /^\d+$/.test(value)
    ? Number(value)
    : value;
  if (!Number.isSafeInteger(normalized) || normalized <= 0) {
    throw badRequest("album video byte size must be a positive integer");
  }
  return normalized;
}
```

In `service.js`, delete `ALBUM_VIDEO_MAX_DURATION_SECONDS` and reduce the duration helper to:

```js
function albumVideoDurationSeconds(value) {
  return requiredPositiveInteger(value, "durationSeconds");
}
```

- [ ] **Step 5: Run the focused tests and verify GREEN**

Run the two Step 3 commands again.

Expected: both scopes pass, including non-admin denial and MP4 failures.

- [ ] **Step 6: Commit Task 1**

```bash
git add apps/api/src/modules/core/service.js apps/api/src/modules/album-video/media.js scripts/d42-album-video-hardening-unit-check.js
git commit -m "feat(api): remove admin video metadata caps"
```

### Task 2: Make admin COS and local streaming uploads uncapped

**Files:**
- Modify: `scripts/d42-album-video-stream-check.js:60-115, 130-170`
- Modify: `scripts/d42-album-video-server-check.js:1-90`
- Modify: `apps/api/src/modules/album-video/multipart-stream.js:1-20, 180-230, 270-305`
- Modify: `apps/api/src/server.js:340-350, 2104-2135, 2615-2640`

- [ ] **Step 1: Add a RED multipart contract for explicitly uncapped mode**

Add to `d42-album-video-stream-check.js`:

```js
await withTempDir(async (tempDir) => {
  const boundary = "admin-video-unlimited";
  const payload = Buffer.concat([MP4_HEADER, Buffer.alloc(4096, 0x61)]);
  const result = await parseMultipartAlbumVideoStream({
    request: Readable.from(chunksOf(multipart(boundary, payload), 127)),
    contentType: `multipart/form-data; boundary=${boundary}`,
    tempDir,
    maxFileBytes: null,
    maxRequestBytes: null
  });
  assert.equal(result.byteSize, payload.length);
  await result.cleanup();
  await assertDirectoryEmpty(tempDir);
});
console.log("PASS multipart stream supports explicit uncapped admin uploads");
```

Retain the existing `oversize` case with a 1024-byte explicit cap; future member policy needs finite-limit behavior to remain reusable.

- [ ] **Step 2: Add RED server wiring assertions**

Read `apps/api/src/server.js`, slice the intent, local parser call, and authenticated local route with these exact markers:

```js
const server = await readFile(new URL("../apps/api/src/server.js", import.meta.url), "utf8");
const intentStart = server.indexOf('if (kind === "adminSessionAlbumVideo") {');
const intentEnd = server.indexOf("\n\n  const sourceExtension", intentStart);
const adminVideoIntent = server.slice(intentStart, intentEnd);
const localUploadStart = server.indexOf("async function saveUploadedSessionAlbumVideo");
const localUploadEnd = server.indexOf("\n\nfunction sessionAlbumMediaSignature", localUploadStart);
const localVideoUpload = server.slice(localUploadStart, localUploadEnd);
const localRouteStart = server.indexOf("const adminSessionAlbumVideoUploadId");
const localRouteEnd = server.indexOf(
  "if (\n    request.method === \"POST\" &&\n    url.pathname === \"/api/internal/content-moderation/tencent-video/callback\"",
  localRouteStart
);
const localVideoRoute = server.slice(localRouteStart, localRouteEnd);

assert.doesNotMatch(adminVideoIntent, /maxBytes:/);
assert.doesNotMatch(localVideoUpload, /maxFileBytes:/);
assert.doesNotMatch(localVideoUpload, /maxRequestBytes:/);
assert.match(adminVideoIntent, /requireRole\(user, "system_admin"\)/);
assert.match(localVideoRoute, /requireRole\(user, "system_admin"\)/);
```

- [ ] **Step 3: Run tests and verify RED**

Run:

```bash
node scripts/d42-album-video-stream-check.js
node scripts/d42-album-video-server-check.js
```

Expected: the parser rejects null limits with `invalid multipart file byte limit`; server assertions find `maxBytes`, `maxFileBytes`, and `maxRequestBytes`.

- [ ] **Step 4: Implement optional streaming limits**

Remove the `MAX_ALBUM_VIDEO_BYTES` import. Normalize null/undefined/Infinity to no limit and positive safe integers to finite limits:

```js
function optionalPositiveByteLimit(value, label) {
  if (value === undefined || value === null || value === Infinity) return null;
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`invalid multipart ${label} byte limit`);
  }
  return value;
}
```

Change parser defaults to null, validate request greater than file only when both are finite, and guard comparisons:

```js
const fileByteLimit = optionalPositiveByteLimit(maxFileBytes, "file");
const requestByteLimit = optionalPositiveByteLimit(maxRequestBytes, "request");
if (fileByteLimit && requestByteLimit && requestByteLimit <= fileByteLimit) {
  throw new TypeError("invalid multipart request byte limit");
}
// in writePayload
if (fileByteLimit && fileBytes + bytes.length > fileByteLimit) { /* existing error */ }
// in the request loop
if (requestByteLimit && totalBytes > requestByteLimit) { /* existing error */ }
```

- [ ] **Step 5: Remove admin video caps from server wiring**

Delete `SESSION_ALBUM_VIDEO_UPLOAD_MAX_BYTES` and `SESSION_ALBUM_VIDEO_MULTIPART_MAX_BYTES`. Remove `maxBytes` from the admin COS intent and call the streaming parser without file/request limits:

```js
const upload = await parseMultipartAlbumVideoStream({
  request,
  contentType,
  tempDir: sessionAlbumVideoSourceUploadDir
});
```

Do not change role checks, content-security intake, no-overwrite headers, MP4 validation, or the image upload limits.

- [ ] **Step 6: Run tests and verify GREEN**

Run the Step 3 commands and:

```bash
npm run d42:api-media
```

Expected: all commands pass; explicit finite multipart caps still reject oversized test payloads.

- [ ] **Step 7: Commit Task 2**

```bash
git add apps/api/src/modules/album-video/multipart-stream.js apps/api/src/server.js scripts/d42-album-video-stream-check.js scripts/d42-album-video-server-check.js
git commit -m "feat(api): uncap admin video transfer size"
```

### Task 3: Require a valid compressed mini-program upload

**Files:**
- Modify: `scripts/d42-album-video-hardening-unit-check.js:2030-2050`
- Modify: `scripts/d42-miniprogram-album-video-check.js:40-180`
- Modify: `apps/miniprogram/src/utils/albumVideo.js:1-15`
- Modify: `apps/miniprogram/src/pages/session/album.vue:670-690, 3080-3120, 3315-3505`

- [ ] **Step 1: Add RED pure compression-result tests**

Add to the mini scope:

```js
test("required video compression accepts only a distinct positive output", async () => {
  const { isUsableRequiredVideoCompression } = await miniProgramHelpers();
  assert.equal(isUsableRequiredVideoCompression({
    originalPath: "source.mp4",
    compressedPath: "compressed.mp4",
    compressedSize: 1024,
    suspicious: false
  }), true);
  for (const facts of [
    { originalPath: "source.mp4", compressedPath: "", compressedSize: 1024 },
    { originalPath: "source.mp4", compressedPath: "source.mp4", compressedSize: 1024 },
    { originalPath: "source.mp4", compressedPath: "compressed.mp4", compressedSize: 0 },
    { originalPath: "source.mp4", compressedPath: "compressed.mp4", compressedSize: 1024, suspicious: true }
  ]) {
    assert.equal(isUsableRequiredVideoCompression(facts), false);
  }
});
```

- [ ] **Step 2: Change static mini-program contracts to the new behavior**

Require these properties in `d42-miniprogram-album-video-check.js`:

```js
assert.match(album, /MAX_ALBUM_VIDEO_RECORDING_DURATION_SECONDS = 60/);
assert.doesNotMatch(uploadChosenVideo, /durationSeconds > /);
assert.doesNotMatch(uploadChosenVideo, /uploadSize > /);
assert.doesNotMatch(album, /shouldCompressVideoBeforeUpload/);
assert.match(compressVideo, /fail:\s*\(\)\s*=>\s*resolve\(null\)/);
assert.doesNotMatch(compressVideo, /return \{ filePath, \.\.\.originalInfo \}/);
assertOrdered(uploadChosenVideo, [
  "await this.compressVideoBeforeUpload(originalPath, uploadInfo)",
  "isUsableRequiredVideoCompression",
  "await uploadSessionAlbumVideo(this.sessionId, uploadPath)"
], "mandatory video compression before upload");
```

Also change the compression method slice to use the next surviving method as its end marker:

```js
const compressVideo = block(
  album,
  "async compressVideoBeforeUpload",
  "isSuspiciousCompressedVideo"
);
```

Keep the existing `canUploadVideo` assertion requiring `this.isSystemAdmin`; it is the ordinary-user denial regression.

- [ ] **Step 3: Run mini tests and verify RED**

Run:

```bash
node scripts/d42-album-video-hardening-unit-check.js --scope=mini
node scripts/d42-miniprogram-album-video-check.js
```

Expected: the helper export is missing and static checks find the old 60-second/100MB/optional-compression branches.

- [ ] **Step 4: Implement the compression-result predicate**

Add to `albumVideo.js`:

```js
export function isUsableRequiredVideoCompression({
  originalPath,
  compressedPath,
  compressedSize,
  suspicious = false
} = {}) {
  const source = String(originalPath || "");
  const output = String(compressedPath || "");
  const size = Number(compressedSize);
  return Boolean(
    source &&
      output &&
      output !== source &&
      Number.isSafeInteger(size) &&
      size > 0 &&
      suspicious !== true
  );
}
```

- [ ] **Step 5: Make compression mandatory and remove business caps**

In `album.vue`:

- Import `isUsableRequiredVideoCompression` beside `compressVideoSizeBytes`.
- Rename the selection constant to `MAX_ALBUM_VIDEO_RECORDING_DURATION_SECONDS`; keep 60 only for WeChat camera recording.
- Rename the 20MB suspicious-output threshold so it no longer controls whether compression runs.
- Delete `MAX_ALBUM_VIDEO_UPLOAD_BYTES` and `shouldCompressVideoBeforeUpload`.
- Make `compressVideoBeforeUpload` return null when `wx.compressVideo` is unavailable or fails, and never substitute the original path for a missing result path.
- Delete the `durationSeconds > 60` and `uploadSize > 100MB` branches.
- Always call compression, compute suspiciousness, validate with `isUsableRequiredVideoCompression`, and stop with `视频压缩失败，请先压缩后再上传` when invalid.
- Upload only `compressed.filePath`; continue requiring readable positive duration and compressed size.
- Change the confirmation title from `上传短视频` to `上传视频`.

The central flow must have this form:

```js
this.statusText = "正在压缩视频...";
const compressed = await this.compressVideoBeforeUpload(originalPath, uploadInfo);
const compressedSize = Number(compressed?.size || 0);
const suspicious = this.isSuspiciousCompressedVideo(compressed || {}, uploadInfo);
if (!isUsableRequiredVideoCompression({
  originalPath,
  compressedPath: compressed?.filePath,
  compressedSize,
  suspicious
})) {
  showToast({ title: "视频压缩失败，请先压缩后再上传", icon: "none" });
  this.statusText = "视频必须成功压缩后才能上传。";
  return;
}
const uploadPath = compressed.filePath;
let uploadSize = compressedSize;
```

- [ ] **Step 6: Run mini tests and verify GREEN**

Run the Step 3 commands.

Expected: both pass, including the unchanged ordinary-user image fallback.

- [ ] **Step 7: Commit Task 3**

```bash
git add apps/miniprogram/src/utils/albumVideo.js apps/miniprogram/src/pages/session/album.vue scripts/d42-album-video-hardening-unit-check.js scripts/d42-miniprogram-album-video-check.js
git commit -m "feat(miniprogram): require admin video compression"
```

### Task 4: Update repository contracts and run complete verification

**Files:**
- Modify: `scripts/d32-admin-album-video-check.js:60-90, 130-170`
- Modify: `scripts/check-miniprogram.js:2275-2310`

- [ ] **Step 1: Update historical static assertions**

Replace assertions that require `ALBUM_VIDEO_MAX_DURATION_SECONDS`, `durationSeconds must be at most 60 seconds`, `SESSION_ALBUM_VIDEO_UPLOAD_MAX_BYTES`, `MAX_ALBUM_VIDEO_DURATION_SECONDS`, and optional compression. Require instead:

```js
assertIncludes("apps/api/src/modules/core/service.js", "albumVideoDurationSeconds");
assertNotIncludes("apps/api/src/modules/core/service.js", "durationSeconds must be at most 60 seconds");
assertNotIncludes("apps/api/src/server.js", "SESSION_ALBUM_VIDEO_UPLOAD_MAX_BYTES");
assertIncludes("apps/miniprogram/src/pages/session/album.vue", "MAX_ALBUM_VIDEO_RECORDING_DURATION_SECONDS");
assertIncludes("apps/miniprogram/src/pages/session/album.vue", "isUsableRequiredVideoCompression");
assertNotIncludes("apps/miniprogram/src/pages/session/album.vue", "shouldCompressVideoBeforeUpload");
```

In `check-miniprogram.js`, change the required D32 strings to the recording-specific constant and mandatory-compression helper; add forbidden checks for the old upload-duration constant and optional-compression method.

- [ ] **Step 2: Run legacy checks and fix only contract drift**

Run:

```bash
node scripts/d32-admin-album-video-check.js
node scripts/check-miniprogram.js
```

Expected: both pass without weakening role, MP4, content-review, playback, or upload-lock assertions.

- [ ] **Step 3: Run targeted feature verification**

Run:

```bash
npm run d42:check
npm run d42:api-server
npm run d42:mini
node --test apps/api/test/content-moderation-video-integration.test.mjs
npm --workspace apps/api run check
```

Expected: every command exits 0 with no failed checks.

- [ ] **Step 4: Run repository-level checks**

Run:

```bash
npm run check
```

Expected: exit 0. If an unrelated environment-dependent smoke check fails, preserve the exact failure output and run every directly affected command separately before reporting.

- [ ] **Step 5: Verify scope and diff quality**

Run:

```bash
git status --short
git diff --check
git diff --stat
```

Expected: only the files listed in this plan are modified; no whitespace errors; the main workspace's unrelated changes are absent from this worktree.

- [ ] **Step 6: Commit Task 4**

```bash
git add scripts/d32-admin-album-video-check.js scripts/check-miniprogram.js
git commit -m "test: update admin video upload contracts"
```

- [ ] **Step 7: Perform final verification before completion**

Invoke `superpowers:verification-before-completion`, rerun the final relevant commands it requires, inspect `git status --short`, and report the exact passing results and branch name `codex/admin-video-unlimited-upload`.
