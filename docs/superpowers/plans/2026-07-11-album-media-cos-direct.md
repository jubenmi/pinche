# Album Media COS Direct Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make production album-image upload, thumbnail, preview, and download bytes flow directly between the mini-program/admin browser and private COS, while API remains the authorization, validation, privacy, and lifecycle control plane.

**Architecture:** Persist one-time album-image upload intents, strictly sign a single COS PUT, validate the processed JPEG with HEAD → ImageInfo → HEAD, and finalize the database row transactionally. Album list endpoints sign 5-minute per-object URLs after existing visibility filtering; a small shared pure-JavaScript state machine gives the mini-program and admin web identical retry and URL-expiry behavior. Local COS-disabled development and one release cycle of legacy image APIs remain supported; video, avatar, and review-photo pipelines stay unchanged.

**Tech Stack:** Node.js 24 ESM, MySQL 8.4/mysql2, Tencent COS XML API and COS v5 SDKs, UniApp/Vue 3, Vite, Node `node:test`, Docker Compose, GitHub Actions.

---

## Execution prerequisites

- Implement from a clean feature worktree created with `superpowers:using-git-worktrees`; use a `codex/album-media-cos-direct` branch based on the latest agreed integration branch.
- Read the confirmed design before editing: `docs/superpowers/specs/2026-07-11-album-media-cos-direct-design.md`.
- Keep `COS_DIRECT_MEDIA_URLS=false` and `COS_DIRECT_UPLOAD_REQUIRED=false` throughout code deployment and migration. Enable them only in Task 16 after the live COS contract, CORS, WeChat domains, and both clients are verified.
- Use one vertical plan because the API protocol, both clients, and rollout switches form one compatibility contract. Each task below is independently testable and commit-sized.

## Locked contracts

- Only `sessionAlbumPhoto` and `adminSessionAlbumPhoto` use the v2 upload-intent protocol. Avatar, review photo, album video upload, video playback, video Range handling, and video deletion retain their current paths.
- Read URL TTL is exactly 300 seconds; refresh skew is exactly 30 seconds.
- Upload window is 600 seconds; each PUT authorization is at most 300 seconds; finalize deadline is upload expiry plus 900 seconds; cleanup starts at least 600 seconds after the latest of upload expiry, last authorization expiry, and finalize deadline.
- A production image upload performs at most three PUT attempts: the first attempt plus two automatic retries. A signature is refreshed at most once. A 409/412 or COS overwrite conflict enters status reconciliation and never performs another PUT.
- Source MIME/byte length belong to the client PUT. Stored MIME/byte length/width/height belong to the processed JPEG. Never compare source and stored lengths.
- New image responses use `thumbnail_display_url`, `preview_display_url`, `download_url`, and `media_url_expires_at`. Existing URL fields and proxy routes remain for one release. Raw `object_key`, ETag, upload authorization, and signed-query internals never appear in an API response.
- Production multipart image routes reject with `DIRECT_UPLOAD_REQUIRED` before multipart parsing. Local `uploadMode: "api-local"` is allowed only when COS is disabled and the server says `fallbackAllowed: true`.
- Finalize and duplicate finalize always re-check current album openness and uploader/admin access. Revoked users receive `ALBUM_UPLOAD_FORBIDDEN` and no refreshed media URL.

Implementation references for the non-obvious COS contracts:

- [Tencent COS ImageInfo](https://cloud.tencent.com/document/product/436/113308): `GET ?imageInfo` returns processed-image format, width, height, and size.
- [Tencent COS upload-time Pic-Operations](https://cloud.tencent.com/document/product/436/115609): a result `fileid` targeting the uploaded key stores the processed result at that key.
- [Tencent COS image-processing signature rules](https://cloud.tencent.com/document/product/436/119427): a valueless `imageMogr2/...` token is an empty-valued canonical query key during signing.
- [Tencent COS Node presigned URL](https://cloud.tencent.com/document/product/436/36121): method, headers, query, key, and expiry must match the eventual request.

## File map

### Shared protocol

- Create `packages/shared/src/albumMedia.js`: stable error codes, COS failure classification, three-attempt upload/reconciliation state machine, expiry check, single-flight helper, and URL-only album merge.
- Modify `packages/shared/src/index.js`: export the album-media protocol.
- Modify `packages/shared/package.json`, `apps/api/package.json`, `apps/miniprogram/package.json`, `apps/admin-web/package.json`, and `package-lock.json`: add focused test scripts and `@pinche/shared` workspace dependencies.
- Create `packages/shared/test/albumMedia.test.mjs`: deterministic retry, conflict, signature-refresh, expiry, merge, and single-flight tests.

### API and database

- Create `apps/api/migrations/0023_album_media_cos_direct.sql`: object-key columns, durable upload intents, and durable deletion jobs.
- Modify `apps/api/src/db/mysql.js`: include the new durable tables in readiness checks.
- Create `apps/api/src/modules/album-image/constants.js`: image-only limits, processing rules, TTLs, statuses, and kinds.
- Create `apps/api/src/modules/album-image/repository.js`: intent CRUD/locking, legacy key lookup, status transitions, cleanup leases, and deletion-job persistence.
- Create `apps/api/src/modules/album-image/signed-urls.js`: the four image URL variants built from the storage layer's structured query representation.
- Create `apps/api/src/modules/album-image/validator.js`: HEAD → ImageInfo → HEAD validation without object-body reads.
- Create `apps/api/src/modules/album-image/upload-service.js`: intent creation, strict authorization, status, idempotent finalize, and legacy create adaptation.
- Create `apps/api/src/modules/album-image/cleanup.js`: leased orphan-intent and business-deletion cleanup.
- Create `apps/api/src/modules/album-image/backfill.js`: HEAD-gated legacy `object_key` backfill.
- Create `apps/api/src/modules/album-image/telemetry.js`: structured, secret-free events used to derive rollout metrics.
- Create `apps/api/src/jobs/album-image-cleanup.js` and `apps/api/src/jobs/backfill-album-image-object-keys.js`: production worker and one-shot backfill entrypoints.
- Modify `apps/api/src/storage/cos.js`: lossless query signing, signed ImageInfo requests, conditional headers, and response parsing.
- Modify `apps/api/src/modules/core/service.js`: connection-aware access checks, finalized-image insert/read, object-key projection, and durable image-delete transition.
- Modify `apps/api/src/config/env.js`: the two independent feature flags.
- Modify `apps/api/src/server.js`: v2 routes, legacy adapters, pre-parse production rejection, signed list fields, and image-only delete enqueueing.
- Create focused API tests under `apps/api/test/album-image-*.test.mjs`.

### Mini-program

- Create `apps/miniprogram/src/utils/albumPhotoUpload.js`: v2 intent/PUT/status/finalize adapter with local-only fallback.
- Create `apps/miniprogram/src/utils/albumMediaUrls.js`: signed-field normalization and page refresh controller.
- Modify `apps/miniprogram/src/utils/api.js`: uploadId-aware COS authorization, exact file facts, stable errors, and maintenance suppression for scoped album calls.
- Modify `apps/miniprogram/src/pages/session/album.vue`: one-step finalized upload, visible phases, batch URL refresh, current-item retry, and local-cache preservation.
- Create `apps/miniprogram/test/albumPhotoUpload.test.mjs` and `apps/miniprogram/test/albumMediaUrls.test.mjs`.

### Admin web

- Modify `apps/admin-web/src/api.js`: v2 image upload/status/finalize API while preserving generic/video fallback.
- Modify `apps/admin-web/src/albumMedia.js`: admin adapters around the shared state machine and URL merge.
- Modify `apps/admin-web/src/components/SessionAlbumWorkspace.vue`: finalized upload result, phases, batch refresh, visibility checks, and signed-field preference.
- Modify `apps/admin-web/src/components/AuthorizedLazyImage.vue`: keep an already loaded object URL across signed-source refresh and reload only after a real failure.
- Create `apps/admin-web/test/albumMedia.test.mjs`.

### Operations and regression gates

- Create `deploy/cos/cors.production.xml` and `deploy/cos/cors.development.xml`.
- Create `docs/runbooks/album-media-cos-direct-release.md`.
- Create `scripts/d43-album-media-cos-direct-check.js`, `scripts/d43-album-media-cos-direct-smoke.js`, and opt-in `scripts/d43-cos-live-contract-check.js`.
- Modify `.env.example`, `.env.production.example`, `docker-compose.prod.example.yml`, `README.md`, `docs/image-processing-policy.md`, `specs/d9-mvp-release/release-checklist.md`, root `package.json`, and narrow D12/D17/D18/D31/D42/check-miniprogram/maintenance assertions that encode the old image behavior.

## Task 1: Shared album-media protocol and deterministic state machine

执行状态：已完成（2026-07-11，6/6 共享协议测试通过）。

**Files:**
- Create: `packages/shared/src/albumMedia.js`
- Modify: `packages/shared/src/index.js`
- Modify: `packages/shared/package.json`
- Create: `packages/shared/test/albumMedia.test.mjs`

- [x] **Step 1: Write failing classification and retry tests**

Create `packages/shared/test/albumMedia.test.mjs` with deterministic fakes. Cover all decisions rather than testing SDK wording:

```js
import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyAlbumCosError,
  createSingleFlight,
  executeAlbumCosUpload,
  mergeAlbumMediaUrls,
  shouldRefreshAlbumMedia
} from "../src/albumMedia.js";

test("network and 5xx retry, overwrite conflicts reconcile, ordinary 4xx fail", () => {
  assert.equal(classifyAlbumCosError({ code: "COS_NETWORK_ERROR" }).action, "retry-put");
  assert.equal(classifyAlbumCosError({ statusCode: 503 }).action, "retry-put");
  assert.equal(classifyAlbumCosError({ statusCode: 412 }).action, "reconcile");
  assert.equal(classifyAlbumCosError({ code: "PreconditionFailed" }).action, "reconcile");
  assert.equal(classifyAlbumCosError({ statusCode: 400 }).action, "fail");
});

test("ambiguous failure checks status before doing one of two retries", async () => {
  const calls = [];
  let puts = 0;
  const result = await executeAlbumCosUpload({
    putObject: async () => {
      calls.push("put");
      puts += 1;
      if (puts === 1) throw Object.assign(new Error("reset"), { code: "COS_NETWORK_ERROR" });
    },
    getStatus: async () => {
      calls.push("status");
      return puts === 1
        ? { validationState: "missing", canFinalize: false }
        : { validationState: "ready", canFinalize: true };
    },
    finalize: async () => ({ photo: { id: 17 } }),
    refreshAuthorization: async () => {},
    sleep: async () => calls.push("sleep"),
    random: () => 0,
    maxStatusPolls: 2,
    onPhase: () => {}
  });
  assert.deepEqual(calls, ["put", "status", "sleep", "put", "status"]);
  assert.equal(result.photo.id, 17);
});

test("overwrite conflict never issues a second PUT and unresolved conflict is stable", async () => {
  let puts = 0;
  await assert.rejects(
    executeAlbumCosUpload({
      putObject: async () => {
        puts += 1;
        throw Object.assign(new Error("exists"), { statusCode: 412 });
      },
      getStatus: async () => ({ validationState: "missing", canFinalize: false }),
      finalize: async () => ({ photo: { id: 1 } }),
      refreshAuthorization: async () => {},
      sleep: async () => {},
      random: () => 0,
      maxStatusPolls: 2,
      onPhase: () => {}
    }),
    (error) => error.code === "COS_UPLOAD_CONFLICT_UNRESOLVED"
  );
  assert.equal(puts, 1);
});

test("expiry, URL-only merge, and single flight preserve page state", async () => {
  assert.equal(shouldRefreshAlbumMedia("2026-07-11T01:05:00.000Z", {
    nowMs: Date.parse("2026-07-11T01:04:30.000Z")
  }), true);
  const current = {
    photos: [{ id: 1, preview_display_url: "old", local_preview_path: "wxfile://cached" }],
    selected_ids: [1]
  };
  const refreshed = {
    photos: [{ id: 1, preview_display_url: "new", media_url_expires_at: "2026-07-11T01:10:00.000Z" }]
  };
  assert.deepEqual(mergeAlbumMediaUrls(current, refreshed), {
    photos: [{
      id: 1,
      preview_display_url: "new",
      local_preview_path: "wxfile://cached",
      media_url_expires_at: "2026-07-11T01:10:00.000Z"
    }],
    selected_ids: [1]
  });
  let runs = 0;
  const flight = createSingleFlight();
  const first = flight.run(async () => { runs += 1; return 9; });
  const second = flight.run(async () => { runs += 1; return 10; });
  assert.equal(await first, 9);
  assert.equal(await second, 9);
  assert.equal(runs, 1);
});
```

- [x] **Step 2: Run the shared test to verify RED**

Run: `node --test packages/shared/test/albumMedia.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `packages/shared/src/albumMedia.js`.

- [x] **Step 3: Implement the pure shared protocol**

Create `packages/shared/src/albumMedia.js` with these public names and fixed limits:

```js
export const ALBUM_MEDIA_ERROR_CODES = Object.freeze({
  network: "COS_NETWORK_ERROR",
  conflictUnresolved: "COS_UPLOAD_CONFLICT_UNRESOLVED",
  signatureExpired: "UPLOAD_SIGNATURE_EXPIRED",
  mediaExpired: "MEDIA_URL_EXPIRED",
  processing: "MEDIA_PROCESSING_PENDING",
  forbidden: "ALBUM_UPLOAD_FORBIDDEN",
  intentExpired: "UPLOAD_INTENT_EXPIRED",
  directRequired: "DIRECT_UPLOAD_REQUIRED",
  configuration: "COS_CONFIGURATION_ERROR",
  domain: "COS_DOMAIN_NOT_ALLOWED"
});

const RETRYABLE_CODES = new Set([
  "COS_NETWORK_ERROR",
  "COS_REQUEST_TIMEOUT",
  "REQUESTTIMEOUT",
  "INTERNALERROR",
  "SERVICEUNAVAILABLE",
  "SLOWDOWN"
]);
const CONFLICT_CODES = new Set([
  "OBJECTALREADYEXISTS",
  "PRECONDITIONFAILED",
  "COS_PRECONDITION_FAILED"
]);
const SIGNATURE_CODES = new Set([
  "REQUESTTIMETOOSKEWED",
  "SIGNATUREDOESNOTMATCH",
  "UPLOAD_SIGNATURE_EXPIRED"
]);
const URL_FIELDS = Object.freeze([
  "thumbnail_display_url",
  "preview_display_url",
  "download_url",
  "media_url_expires_at",
  "thumbnail_url",
  "preview_url",
  "image_url",
  "thumbnail_load_url",
  "preview_load_url",
  "cover_url",
  "video_url"
]);

function normalizedCode(error) {
  return String(error?.code || error?.error?.Code || error?.originalError?.error?.Code || "")
    .replace(/[^A-Za-z0-9_]/g, "")
    .toUpperCase();
}

export function classifyAlbumCosError(error) {
  const status = Number(error?.statusCode || error?.status || error?.httpStatus || 0);
  const code = normalizedCode(error);
  if (status === 409 || status === 412 || CONFLICT_CODES.has(code)) {
    return { action: "reconcile", code: code || "COS_PRECONDITION_FAILED" };
  }
  if (SIGNATURE_CODES.has(code)) {
    return { action: "refresh-authorization", code: ALBUM_MEDIA_ERROR_CODES.signatureExpired };
  }
  if (status >= 500 || RETRYABLE_CODES.has(code) || (status === 0 && !code)) {
    return { action: "retry-put", code: code || ALBUM_MEDIA_ERROR_CODES.network };
  }
  return { action: "fail", code: code || "COS_UPLOAD_REJECTED" };
}

export function albumMediaError(code, message, cause) {
  const error = new Error(message);
  error.code = code;
  if (cause !== undefined) error.cause = cause;
  return error;
}

async function reconcileUpload({
  conflict,
  getStatus,
  finalize,
  sleep,
  maxStatusPolls,
  onPhase
}) {
  onPhase({ phase: "validating", retry: 0 });
  for (let poll = 0; poll < maxStatusPolls; poll += 1) {
    const status = await getStatus();
    if (status?.canFinalize && status.validationState === "ready") {
      const result = await finalize();
      onPhase({ phase: "complete", retry: 0 });
      return result;
    }
    if (status?.validationState === "invalid") {
      throw albumMediaError(status.errorCode || "COS_IMAGE_INVALID", status.message || "COS image validation failed");
    }
    if (poll + 1 < maxStatusPolls) await sleep(Math.min(4000, 500 * 2 ** poll));
  }
  const code = conflict
    ? ALBUM_MEDIA_ERROR_CODES.conflictUnresolved
    : ALBUM_MEDIA_ERROR_CODES.processing;
  throw albumMediaError(code, conflict ? "COS upload conflict could not be reconciled" : "COS image is still processing");
}

export async function executeAlbumCosUpload({
  putObject,
  getStatus,
  finalize,
  refreshAuthorization,
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  random = Math.random,
  maxStatusPolls = 8,
  onPhase = () => {}
}) {
  let putAttempts = 0;
  let signatureRefreshes = 0;
  onPhase({ phase: "preparing", retry: 0 });
  while (putAttempts < 3) {
    onPhase({ phase: "uploading", retry: Math.max(0, putAttempts) });
    putAttempts += 1;
    try {
      await putObject();
      return reconcileUpload({
        conflict: false,
        getStatus,
        finalize,
        sleep,
        maxStatusPolls,
        onPhase
      });
    } catch (error) {
      const decision = classifyAlbumCosError(error);
      if (decision.action === "reconcile") {
        return reconcileUpload({
          conflict: true,
          getStatus,
          finalize,
          sleep,
          maxStatusPolls,
          onPhase
        });
      }
      if (
        decision.action === "refresh-authorization" &&
        signatureRefreshes === 0 &&
        putAttempts < 3
      ) {
        signatureRefreshes += 1;
        await refreshAuthorization();
        continue;
      }
      if (decision.action !== "retry-put" || putAttempts >= 3) throw error;
      const status = await getStatus();
      if (["ready", "processing"].includes(status?.validationState)) {
        return reconcileUpload({
          conflict: false,
          getStatus,
          finalize,
          sleep,
          maxStatusPolls,
          onPhase
        });
      }
      const delay = 500 * 2 ** (putAttempts - 1) + Math.floor(random() * 250);
      await sleep(delay);
    }
  }
  throw albumMediaError(ALBUM_MEDIA_ERROR_CODES.network, "COS upload failed after three attempts");
}

export function shouldRefreshAlbumMedia(expiresAt, { nowMs = Date.now(), skewMs = 30_000 } = {}) {
  const expiresMs = Date.parse(String(expiresAt || ""));
  return Number.isFinite(expiresMs) && expiresMs - nowMs <= skewMs;
}

function mergeMediaCollection(currentItems = [], refreshedItems = []) {
  const currentById = new Map(currentItems.map((item) => [Number(item.id), item]));
  return refreshedItems.map((refreshed) => {
    const current = currentById.get(Number(refreshed.id));
    if (!current) return refreshed;
    const next = { ...current };
    for (const field of URL_FIELDS) {
      if (Object.hasOwn(refreshed, field)) next[field] = refreshed[field];
    }
    return next;
  });
}

export function mergeAlbumMediaUrls(currentAlbum = {}, refreshedAlbum = {}) {
  const next = { ...currentAlbum };
  if (Array.isArray(currentAlbum.photos)) {
    next.photos = mergeMediaCollection(currentAlbum.photos, refreshedAlbum.photos || []);
  }
  if (Array.isArray(currentAlbum.media)) {
    next.media = mergeMediaCollection(currentAlbum.media, refreshedAlbum.media || refreshedAlbum.photos || []);
  }
  return next;
}

export function createSingleFlight() {
  let active = null;
  return {
    run(work) {
      if (active) return active;
      active = Promise.resolve().then(work).finally(() => { active = null; });
      return active;
    },
    get active() { return Boolean(active); }
  };
}
```

Export it from `packages/shared/src/index.js`:

```js
export * from "./albumMedia.js";
```

Add the focused script to `packages/shared/package.json`:

```json
{
  "scripts": {
    "test:album-media": "node --test test/albumMedia.test.mjs"
  }
}
```

- [x] **Step 4: Run the shared tests to verify GREEN**

Run: `npm --workspace packages/shared run test:album-media`

Expected: all shared album-media tests pass; the conflict test reports exactly one PUT.

- [x] **Step 5: Commit the shared protocol**

```bash
git add packages/shared/src/albumMedia.js packages/shared/src/index.js packages/shared/package.json packages/shared/test/albumMedia.test.mjs
git commit -m "feat: add shared album media state machine"
```

## Task 2: Durable schema for object identity, intents, and cleanup jobs

执行状态：已完成（2026-07-11，迁移测试通过，隔离 MySQL 首次应用 25 个迁移且二次执行为空）。

**Files:**
- Create: `apps/api/migrations/0023_album_media_cos_direct.sql`
- Modify: `apps/api/src/db/mysql.js`
- Create: `apps/api/test/album-image-migration.test.mjs`
- Modify: `apps/api/package.json`

- [x] **Step 1: Write the failing migration contract test**

Create a source-level test that locks the table names, foreign-key behavior, uniqueness, lease fields, and readiness registration:

```js
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { requiredSchemaTables } from "../src/db/mysql.js";

test("album image migration has durable intent and cleanup anchors", async () => {
  const sql = await readFile(new URL("../migrations/0023_album_media_cos_direct.sql", import.meta.url), "utf8");
  assert.match(sql, /ADD COLUMN object_key VARCHAR\(512\) NULL/);
  assert.match(sql, /UNIQUE KEY uniq_session_album_photos_object_key \(object_key\)/);
  assert.match(sql, /CREATE TABLE session_album_upload_intents/);
  assert.match(sql, /UNIQUE KEY uniq_album_upload_intents_object_key \(object_key\)/);
  assert.match(sql, /FOREIGN KEY \(media_id\).*ON DELETE SET NULL/s);
  assert.match(sql, /CREATE TABLE session_album_object_cleanup_jobs/);
  assert.match(sql, /lease_token CHAR\(36\) NULL/);
  assert.match(sql, /lease_expires_at DATETIME NULL/);
  assert.deepEqual(
    requiredSchemaTables.filter((name) => name.startsWith("session_album_")),
    ["session_album_upload_intents", "session_album_object_cleanup_jobs"]
  );
});
```

- [x] **Step 2: Run the migration test to verify RED**

Run: `node --test apps/api/test/album-image-migration.test.mjs`

Expected: FAIL because migration `0023_album_media_cos_direct.sql` does not exist and readiness lacks the tables.

- [x] **Step 3: Add the complete additive migration**

Create `apps/api/migrations/0023_album_media_cos_direct.sql`:

```sql
ALTER TABLE session_album_photos
  ADD COLUMN object_key VARCHAR(512) NULL AFTER photo_url,
  ADD COLUMN object_etag VARCHAR(128) NULL AFTER object_key,
  ADD UNIQUE KEY uniq_session_album_photos_object_key (object_key);

CREATE TABLE session_album_upload_intents (
  id CHAR(36) NOT NULL PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  session_id BIGINT UNSIGNED NULL,
  kind VARCHAR(32) NOT NULL,
  object_key VARCHAR(512) NOT NULL,
  source_content_type VARCHAR(64) NOT NULL,
  source_byte_size BIGINT UNSIGNED NULL,
  max_source_byte_size BIGINT UNSIGNED NOT NULL,
  stored_content_type VARCHAR(64) NULL,
  stored_byte_size BIGINT UNSIGNED NULL,
  stored_width INT UNSIGNED NULL,
  stored_height INT UNSIGNED NULL,
  object_etag VARCHAR(128) NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  upload_expires_at DATETIME NOT NULL,
  last_authorization_expires_at DATETIME NULL,
  finalize_deadline_at DATETIME NOT NULL,
  cleanup_not_before DATETIME NOT NULL,
  cleanup_attempts INT UNSIGNED NOT NULL DEFAULT 0,
  next_retry_at DATETIME NULL,
  last_error_code VARCHAR(64) NULL,
  lease_token CHAR(36) NULL,
  lease_expires_at DATETIME NULL,
  media_id BIGINT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  finalized_at DATETIME NULL,
  UNIQUE KEY uniq_album_upload_intents_object_key (object_key),
  UNIQUE KEY uniq_album_upload_intents_media_id (media_id),
  INDEX idx_album_upload_intents_cleanup (status, cleanup_not_before, next_retry_at),
  INDEX idx_album_upload_intents_user_created (user_id, created_at),
  INDEX idx_album_upload_intents_lease (status, lease_expires_at),
  CONSTRAINT fk_album_upload_intents_user FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT fk_album_upload_intents_session FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE SET NULL,
  CONSTRAINT fk_album_upload_intents_media FOREIGN KEY (media_id) REFERENCES session_album_photos(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE session_album_object_cleanup_jobs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  media_id BIGINT UNSIGNED NULL,
  session_id BIGINT UNSIGNED NULL,
  storage_kind VARCHAR(16) NOT NULL,
  object_key VARCHAR(512) NULL,
  local_path VARCHAR(512) NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  attempts INT UNSIGNED NOT NULL DEFAULT 0,
  next_retry_at DATETIME NULL,
  last_error_code VARCHAR(64) NULL,
  lease_token CHAR(36) NULL,
  lease_expires_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  completed_at DATETIME NULL,
  UNIQUE KEY uniq_album_object_cleanup_media (media_id),
  INDEX idx_album_object_cleanup_claim (status, next_retry_at, lease_expires_at),
  INDEX idx_album_object_cleanup_session (session_id, created_at),
  CONSTRAINT fk_album_object_cleanup_media FOREIGN KEY (media_id) REFERENCES session_album_photos(id) ON DELETE SET NULL,
  CONSTRAINT fk_album_object_cleanup_session FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

Both session foreign keys use `ON DELETE SET NULL`: intent/job rows keep their object-cleanup and audit anchors if an administrator hard-deletes a session, while a missing session makes every later authorization/finalize access check fail. Creation still requires and persists a real session ID.

Append only these two tables to `requiredSchemaTables` in `apps/api/src/db/mysql.js`:

```js
  "wechat_identities",
  "session_album_upload_intents",
  "session_album_object_cleanup_jobs"
```

Add `test:album-image` to `apps/api/package.json` without replacing `check`:

```json
"test:album-image": "node --test test/album-image-*.test.mjs"
```

- [x] **Step 4: Verify the migration contract and an isolated MySQL apply**

Run: `npm --workspace apps/api run test:album-image`

Expected: migration contract passes.

Run against the disposable local MySQL configured for this worktree: `MYSQL_DATABASE=pinche_album_cos_plan npm run migrate`

Expected: JSON contains `"0023_album_media_cos_direct.sql"` in `executed`; a second identical command reports an empty `executed` list.

- [x] **Step 5: Commit the schema**

```bash
git add apps/api/migrations/0023_album_media_cos_direct.sql apps/api/src/db/mysql.js apps/api/test/album-image-migration.test.mjs apps/api/package.json
git commit -m "feat: persist album image upload lifecycle"
```

## Task 3: Lossless COS query signing and five-minute image URLs

执行状态：已完成（2026-07-11，6/6 聚焦测试与 69/69 D42 视频回归通过）。

**Files:**
- Create: `apps/api/src/modules/album-image/constants.js`
- Create: `apps/api/src/modules/album-image/signed-urls.js`
- Modify: `apps/api/src/storage/cos.js`
- Create: `apps/api/test/album-image-signed-urls.test.mjs`
- Create: `apps/api/test/album-image-cos-storage.test.mjs`

- [x] **Step 1: Write failing canonical-query and URL tests**

The tests must prove that valueless image-processing tokens appear without `=` in the request URL but with an empty value in COS canonical signing, and that every image URL expires after 300 seconds:

```js
import assert from "node:assert/strict";
import test from "node:test";
import { buildAlbumImageUrls } from "../src/modules/album-image/signed-urls.js";
import {
  cosQueryEntries,
  renderCosCanonicalQuery,
  renderCosRequestQuery
} from "../src/storage/cos.js";

const config = {
  enabled: true,
  secretId: "id",
  secretKey: "secret",
  bucket: "pinche-app-1251022382",
  region: "ap-nanjing"
};

test("imageMogr2 is valueless on the wire and empty-valued when signed", () => {
  const entries = cosQueryEntries([{ name: "imageMogr2/thumbnail/640x640>", value: null }]);
  assert.equal(renderCosRequestQuery(entries), "imageMogr2/thumbnail/640x640%3E");
  assert.equal(renderCosCanonicalQuery(entries), "imagemogr2%2fthumbnail%2f640x640%3e=");
});

test("all album image variants share an exact five-minute expiry", () => {
  const urls = buildAlbumImageUrls({
    objectKey: "uploads/session-album/display/photo.jpg",
    mediaId: 7,
    nowSeconds: 1_000,
    config
  });
  assert.equal(urls.media_url_expires_at, "1970-01-01T00:21:40.000Z");
  assert.match(urls.thumbnail_display_url, /imageMogr2\/auto-orient\/thumbnail\/640x640%3E/);
  assert.match(urls.preview_display_url, /q-sign-time=1000%3B1300|q-sign-time=1000;1300/);
  assert.match(urls.download_url, /response-content-disposition=/);
  assert.equal(urls.thumbnail_display_url.includes("secret"), false);
});
```

Add a storage test with a fake HTTPS request that asserts `GET /key?imageInfo`, signed `if-match`, a 64KB response cap, and parsed JSON; also assert the request does not call the object-body `getCosObject` path.

Add a second storage case where conditional ImageInfo returns 400/405/501: retry ImageInfo once without `If-Match`, then rely on the validator's mandatory second HEAD ETag comparison. Map COS 409 and 412 overwrite responses to trusted `COS_PRECONDITION_FAILED` while retaining the upstream status for diagnostics.

- [x] **Step 2: Run the focused signing tests to verify RED**

Run: `node --test apps/api/test/album-image-signed-urls.test.mjs apps/api/test/album-image-cos-storage.test.mjs`

Expected: FAIL because the album-image modules and `getCosImageInfo` do not exist.

- [x] **Step 3: Add exact constants and structured query rendering**

Create `apps/api/src/modules/album-image/constants.js`:

```js
export const ALBUM_IMAGE_KINDS = Object.freeze([
  "sessionAlbumPhoto",
  "adminSessionAlbumPhoto"
]);
export const ALBUM_IMAGE_MAX_SOURCE_BYTES = 4 * 1024 * 1024;
export const ALBUM_IMAGE_UPLOAD_WINDOW_SECONDS = 600;
export const ALBUM_IMAGE_AUTH_SECONDS = 300;
export const ALBUM_IMAGE_FINALIZE_GRACE_SECONDS = 900;
export const ALBUM_IMAGE_CLEANUP_GRACE_SECONDS = 600;
export const ALBUM_IMAGE_URL_SECONDS = 300;
export const ALBUM_IMAGE_DISPLAY_PROCESS =
  "imageMogr2/auto-orient/thumbnail/2048x2048>/format/jpg/quality/85/strip";
export const ALBUM_IMAGE_THUMBNAIL_PROCESS =
  "imageMogr2/auto-orient/thumbnail/640x640>/format/jpg/quality/75/strip";
export const ALBUM_IMAGE_INTENT_STATUSES = Object.freeze([
  "pending",
  "processing",
  "finalized",
  "expired",
  "rejected",
  "cleanup_pending",
  "cleanup_failed",
  "cleaned"
]);

export function isAlbumImageKind(kind) {
  return ALBUM_IMAGE_KINDS.includes(String(kind || ""));
}
```

First add the one canonical query implementation to `apps/api/src/storage/cos.js`; both signing and the request URL call these functions:

```js
export function cosQueryEntries(urlParams = []) {
  const raw = Array.isArray(urlParams)
    ? urlParams.map(({ name, value = null }) => ({ name: String(name), value }))
    : Object.entries(urlParams).map(([name, value]) => ({ name, value }));
  return raw
    .filter(({ value }) => value !== undefined)
    .sort((left, right) =>
      encodeCosComponent(left.name).toLowerCase()
        .localeCompare(encodeCosComponent(right.name).toLowerCase())
    );
}

export function renderCosRequestQuery(urlParams) {
  return cosQueryEntries(urlParams).map(({ name, value }) =>
    value === null
      ? encodeCosQueryKey(name)
      : `${encodeCosComponent(name)}=${encodeCosComponent(value)}`
  ).join("&");
}

export function renderCosCanonicalQuery(urlParams) {
  return cosQueryEntries(urlParams).map(({ name, value }) =>
    `${encodeCosComponent(name).toLowerCase()}=${
      value === null ? "" : encodeCosComponent(value)
    }`
  ).join("&");
}

export function encodeCosObjectPath(key) {
  return String(key || "").split("/").map(encodeCosComponent).join("/");
}
```

Change `buildCosAuthorization` to derive `q-url-param-list` and its HTTP parameter line from `cosQueryEntries`/`renderCosCanonicalQuery`; do not maintain another encoder or empty-value filter. Existing object-shaped parameters are normalized by `cosQueryEntries` for backward compatibility.

Then create `apps/api/src/modules/album-image/signed-urls.js` around that representation:

```js
import {
  buildCosAuthorization,
  cosHost,
  cosQueryEntries,
  encodeCosObjectPath,
  renderCosRequestQuery
} from "../../storage/cos.js";
import {
  ALBUM_IMAGE_THUMBNAIL_PROCESS,
  ALBUM_IMAGE_URL_SECONDS
} from "./constants.js";

export function buildSignedCosImageUrl({
  objectKey,
  queryEntries = [],
  nowSeconds,
  config
}) {
  const entries = cosQueryEntries(queryEntries);
  const authorization = buildCosAuthorization({
    method: "GET",
    key: objectKey,
    headers: { host: cosHost(config) },
    urlParams: entries,
    nowSeconds,
    expiresInSeconds: ALBUM_IMAGE_URL_SECONDS,
    config
  });
  const objectPath = encodeCosObjectPath(objectKey);
  const dataQuery = renderCosRequestQuery(entries);
  return `https://${cosHost(config)}/${objectPath}?${dataQuery ? `${dataQuery}&` : ""}${authorization}`;
}

export function buildAlbumImageUrls({ objectKey, mediaId, nowSeconds, config }) {
  const expiresAt = new Date((nowSeconds + ALBUM_IMAGE_URL_SECONDS) * 1000).toISOString();
  const preview = buildSignedCosImageUrl({ objectKey, nowSeconds, config });
  return {
    thumbnail_display_url: buildSignedCosImageUrl({
      objectKey,
      queryEntries: [{ name: ALBUM_IMAGE_THUMBNAIL_PROCESS, value: null }],
      nowSeconds,
      config
    }),
    preview_display_url: preview,
    download_url: buildSignedCosImageUrl({
      objectKey,
      queryEntries: [{
        name: "response-content-disposition",
        value: `attachment; filename=album-photo-${Number(mediaId)}.jpg`
      }],
      nowSeconds,
      config
    }),
    media_url_expires_at: expiresAt
  };
}
```

- [x] **Step 4: Add a signed ImageInfo storage primitive**

Extend the internal `cosRequest` to accept `urlParams`, render its request query from the same entries, and include those entries in `buildCosAuthorization`. Then export:

```js
export async function getCosImageInfo({ key, etag, config, request = https.request }) {
  const read = (headers) => cosRequest({
      method: "GET",
      key,
      headers,
      urlParams: [{ name: "imageInfo", value: null }],
      maxResponseBytes: 64 * 1024,
      timeoutMs: DEFAULT_COS_INSPECTION_TIMEOUT_MS,
      request,
      config
    });
  let response;
  try {
    response = await read(etag ? { "if-match": etag } : {});
  } catch (error) {
    if (!etag || ![400, 405, 501].includes(Number(error.upstreamStatusCode))) throw error;
    response = await read({});
  }
  let parsed;
  try {
    parsed = JSON.parse(response.body.toString("utf8"));
  } catch (error) {
    throw cosStorageError(502, "COS_INVALID_IMAGE_INFO", "COS imageInfo response was invalid JSON");
  }
  return {
    format: String(parsed.format || "").toLowerCase(),
    width: Number(parsed.width || 0),
    height: Number(parsed.height || 0),
    byteSize: Number(parsed.size || 0),
    etag: String(response.headers.etag || etag || "").replace(/^\"|\"$/g, "")
  };
}
```

Add `COS_INVALID_IMAGE_INFO` to the trusted storage error set and ensure `cosRequest` signs `if-match` plus the query. Existing no-query GET/HEAD/video calls must render byte-for-byte as before.

Update `cosHttpError` so 409/412 both produce status 412 and code `COS_PRECONDITION_FAILED`, and every mapped error keeps a non-enumerated `upstreamStatusCode` for the conditional-ImageInfo fallback above.

- [x] **Step 5: Run focused and regression tests**

Run: `node --test apps/api/test/album-image-signed-urls.test.mjs apps/api/test/album-image-cos-storage.test.mjs`

Expected: all signing and storage tests pass.

Run: `npm run d42:api-media && npm run d42:api-server`

Expected: existing video signing, metadata, GET, HEAD, and Range checks pass unchanged.

- [x] **Step 6: Commit COS signing and ImageInfo support**

```bash
git add apps/api/src/modules/album-image/constants.js apps/api/src/modules/album-image/signed-urls.js apps/api/src/storage/cos.js apps/api/test/album-image-signed-urls.test.mjs apps/api/test/album-image-cos-storage.test.mjs
git commit -m "feat: sign private COS album image URLs"
```

## Task 4: Authoritative processed-image validator

执行状态：已完成（2026-07-11，11/11 校验器测试与 API 语法检查通过）。

**Files:**
- Create: `apps/api/src/modules/album-image/validator.js`
- Create: `apps/api/test/album-image-validator.test.mjs`

- [x] **Step 1: Write failing validator tests**

Use an injected storage adapter and assert call order and metadata semantics:

```js
import assert from "node:assert/strict";
import test from "node:test";
import { validateStoredAlbumImage } from "../src/modules/album-image/validator.js";

test("validator uses HEAD, ImageInfo, HEAD and accepts PNG source to JPEG output", async () => {
  const calls = [];
  const result = await validateStoredAlbumImage({
    intent: {
      object_key: "uploads/session-album/display/a.jpg",
      source_content_type: "image/png",
      source_byte_size: 3456
    },
    storage: {
      head: async () => {
        calls.push("HEAD");
        return { etag: "etag-1", byteSize: 1234, contentType: "image/jpeg" };
      },
      imageInfo: async ({ etag }) => {
        calls.push(["ImageInfo", etag]);
        return { format: "jpg", width: 1600, height: 1200, byteSize: 1234 };
      }
    }
  });
  assert.deepEqual(calls, ["HEAD", ["ImageInfo", "etag-1"], "HEAD"]);
  assert.deepEqual(result, {
    validationState: "ready",
    objectPresent: true,
    etag: "etag-1",
    contentType: "image/jpeg",
    byteSize: 1234,
    width: 1600,
    height: 1200,
    canFinalize: true
  });
});

test("changed ETag and transient missing metadata remain processing", async () => {
  let headCount = 0;
  const result = await validateStoredAlbumImage({
    intent: { object_key: "uploads/session-album/display/a.jpg" },
    storage: {
      head: async () => ({ etag: `etag-${++headCount}`, byteSize: 100, contentType: "image/jpeg" }),
      imageInfo: async () => ({ format: "jpg", width: 10, height: 10, byteSize: 100 })
    }
  });
  assert.equal(result.validationState, "processing");
  assert.equal(result.canFinalize, false);
});

test("non-JPEG or dimensions above 2048 are invalid", async () => {
  const storage = {
    head: async () => ({ etag: "same", byteSize: 100, contentType: "image/png" }),
    imageInfo: async () => ({ format: "png", width: 4096, height: 100, byteSize: 100 })
  };
  const result = await validateStoredAlbumImage({ intent: { object_key: "a" }, storage });
  assert.equal(result.validationState, "invalid");
  assert.equal(result.errorCode, "COS_IMAGE_PROCESSING_INVALID");
});
```

Add cases for trusted 404 → `missing`, trusted 412 → `processing`, zero/oversized dimensions, zero byte length, and verify no adapter method named `getObject` is invoked.

- [x] **Step 2: Run the validator test to verify RED**

Run: `node --test apps/api/test/album-image-validator.test.mjs`

Expected: FAIL because `validator.js` does not exist.

- [x] **Step 3: Implement the validator as the only finalize inspection path**

Create `apps/api/src/modules/album-image/validator.js`:

```js
function cleanEtag(value) {
  return String(value || "").replace(/^\"|\"$/g, "");
}

function processing(etag = "") {
  return { validationState: "processing", objectPresent: true, etag, canFinalize: false };
}

export async function validateStoredAlbumImage({ intent, storage }) {
  let before;
  try {
    before = await storage.head(intent.object_key);
  } catch (error) {
    if (error?.code === "COS_OBJECT_NOT_FOUND") {
      return { validationState: "missing", objectPresent: false, etag: "", canFinalize: false };
    }
    throw error;
  }
  const beforeEtag = cleanEtag(before.etag);
  let info;
  try {
    info = await storage.imageInfo({ key: intent.object_key, etag: beforeEtag });
  } catch (error) {
    if (["COS_OBJECT_NOT_FOUND", "COS_PRECONDITION_FAILED"].includes(error?.code)) {
      return processing(beforeEtag);
    }
    throw error;
  }
  const after = await storage.head(intent.object_key);
  const afterEtag = cleanEtag(after.etag);
  if (!beforeEtag || beforeEtag !== afterEtag) return processing(afterEtag);
  const format = String(info.format || "").toLowerCase();
  const contentType = String(after.contentType || "").split(";", 1)[0].trim().toLowerCase();
  const byteSize = Number(after.byteSize || 0);
  const width = Number(info.width || 0);
  const height = Number(info.height || 0);
  if (
    !["jpg", "jpeg"].includes(format) ||
    contentType !== "image/jpeg" ||
    !Number.isSafeInteger(byteSize) || byteSize <= 0 ||
    !Number.isSafeInteger(width) || width <= 0 || width > 2048 ||
    !Number.isSafeInteger(height) || height <= 0 || height > 2048
  ) {
    return {
      validationState: "invalid",
      objectPresent: true,
      etag: afterEtag,
      canFinalize: false,
      errorCode: "COS_IMAGE_PROCESSING_INVALID"
    };
  }
  return {
    validationState: "ready",
    objectPresent: true,
    etag: afterEtag,
    contentType,
    byteSize,
    width,
    height,
    canFinalize: true
  };
}
```

- [x] **Step 4: Run the validator tests to verify GREEN**

Run: `node --test apps/api/test/album-image-validator.test.mjs`

Expected: all validator cases pass and the recorded happy-path call order is exactly HEAD, ImageInfo, HEAD.

- [x] **Step 5: Commit the validator**

```bash
git add apps/api/src/modules/album-image/validator.js apps/api/test/album-image-validator.test.mjs
git commit -m "feat: validate album images without proxying bytes"
```

## Task 5: Intent repository and connection-aware album access

执行状态：已完成（2026-07-11，10/10 仓储与权限测试、D18/D23 隐私回归及 API 语法检查通过）。

**Files:**
- Create: `apps/api/src/modules/album-image/repository.js`
- Modify: `apps/api/src/modules/core/service.js:809-875,1672-1760,5597-5622,5860-5919`
- Create: `apps/api/test/album-image-repository.test.mjs`
- Create: `apps/api/test/album-image-access.test.mjs`

- [x] **Step 1: Write failing repository and access tests**

Test with a recording connection so transaction boundaries and `FOR UPDATE` are explicit:

```js
import assert from "node:assert/strict";
import test from "node:test";
import {
  bindLegacyIntentByteSize,
  findAlbumImageIntent,
  findAlbumImageIntentByObjectKey,
  insertAlbumImageIntent
} from "../src/modules/album-image/repository.js";

function recordingConnection(rows = []) {
  const calls = [];
  return {
    calls,
    async query(sql, values) {
      calls.push({ sql: String(sql), values });
      return [rows];
    }
  };
}

test("intent lookup can lock by uploadId or exact user plus object key", async () => {
  const connection = recordingConnection([{ id: "upload-1" }]);
  await findAlbumImageIntent(connection, "upload-1", { forUpdate: true });
  await findAlbumImageIntentByObjectKey(connection, {
    userId: 9,
    objectKey: "uploads/session-album/display/a.jpg"
  }, { forUpdate: true });
  assert.match(connection.calls[0].sql, /WHERE id = \?[\s\S]*FOR UPDATE/);
  assert.match(connection.calls[1].sql, /user_id = \?[\s\S]*object_key = \?[\s\S]*FOR UPDATE/);
  assert.deepEqual(connection.calls[1].values, [9, "uploads/session-album/display/a.jpg"]);
});

test("legacy Content-Length binds once and cannot change", async () => {
  const connection = recordingConnection([{ affectedRows: 1 }]);
  await bindLegacyIntentByteSize(connection, { uploadId: "upload-1", byteSize: 1024 });
  assert.match(connection.calls[0].sql, /source_byte_size = COALESCE\(source_byte_size, \?\)/);
  assert.match(connection.calls[0].sql, /source_byte_size IS NULL OR source_byte_size = \?/);
  assert.deepEqual(connection.calls[0].values, [1024, "upload-1", 1024]);
});
```

In `apps/api/test/album-image-access.test.mjs`, use a fake SQL connection and exported `assertSessionAlbumImageUploadAllowed`. Assert:

- member kind accepts organizer, DM, NPC, confirmed seat, or active bound NPC role;
- admin kind requires `system_admin` and the same user to be `organizer_user_id`;
- `forUpdate: true` appears on session and membership reads;
- closed/cancelled window and revoked membership reject with 403.

- [x] **Step 2: Run repository/access tests to verify RED**

Run: `node --test apps/api/test/album-image-repository.test.mjs apps/api/test/album-image-access.test.mjs`

Expected: FAIL because `repository.js` and the exported connection-aware access function do not exist.

- [x] **Step 3: Implement the narrow repository API**

Create `apps/api/src/modules/album-image/repository.js` with only parameterized SQL. The public contract is:

```js
export async function insertAlbumImageIntent(connection, intent) {
  await connection.query(
    `INSERT INTO session_album_upload_intents
      (id, user_id, session_id, kind, object_key, source_content_type,
       source_byte_size, max_source_byte_size, status, upload_expires_at,
       finalize_deadline_at, cleanup_not_before)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
    [
      intent.id,
      intent.userId,
      intent.sessionId,
      intent.kind,
      intent.objectKey,
      intent.sourceContentType,
      intent.sourceByteSize,
      intent.maxSourceByteSize,
      intent.uploadExpiresAt,
      intent.finalizeDeadlineAt,
      intent.cleanupNotBefore
    ]
  );
  return findAlbumImageIntent(connection, intent.id);
}

export async function findAlbumImageIntent(connection, uploadId, { forUpdate = false } = {}) {
  const [rows] = await connection.query(
    `SELECT * FROM session_album_upload_intents
     WHERE id = ? LIMIT 1 ${forUpdate ? "FOR UPDATE" : ""}`,
    [String(uploadId)]
  );
  return rows[0] || null;
}

export async function findAlbumImageIntentByObjectKey(
  connection,
  { userId, objectKey },
  { forUpdate = false } = {}
) {
  const [rows] = await connection.query(
    `SELECT * FROM session_album_upload_intents
     WHERE user_id = ? AND object_key = ?
     LIMIT 1 ${forUpdate ? "FOR UPDATE" : ""}`,
    [Number(userId), String(objectKey)]
  );
  return rows[0] || null;
}

export async function bindLegacyIntentByteSize(connection, { uploadId, byteSize }) {
  const [result] = await connection.query(
    `UPDATE session_album_upload_intents
     SET source_byte_size = COALESCE(source_byte_size, ?)
     WHERE id = ?
       AND status = 'pending'
       AND (source_byte_size IS NULL OR source_byte_size = ?)`,
    [Number(byteSize), String(uploadId), Number(byteSize)]
  );
  return Number(result.affectedRows || 0) === 1;
}

export async function recordAlbumImageAuthorization(
  connection,
  { uploadId, authorizationExpiresAt, cleanupNotBefore }
) {
  const [result] = await connection.query(
    `UPDATE session_album_upload_intents
     SET last_authorization_expires_at = GREATEST(
           COALESCE(last_authorization_expires_at, ?), ?
         ),
         cleanup_not_before = GREATEST(cleanup_not_before, ?)
     WHERE id = ? AND status = 'pending'`,
    [authorizationExpiresAt, authorizationExpiresAt, cleanupNotBefore, String(uploadId)]
  );
  return Number(result.affectedRows || 0) === 1;
}

export async function markAlbumImageIntentState(
  connection,
  { uploadId, fromStatuses, toStatus, errorCode = null }
) {
  const parameterMarks = fromStatuses.map(() => "?").join(", ");
  const [result] = await connection.query(
    `UPDATE session_album_upload_intents
     SET status = ?, last_error_code = ?
     WHERE id = ? AND status IN (${parameterMarks})`,
    [toStatus, errorCode, String(uploadId), ...fromStatuses]
  );
  return Number(result.affectedRows || 0) === 1;
}
```

Keep cleanup claims out of this commit; Task 9 extends this same repository after its lease tests exist.

- [x] **Step 4: Export connection-aware access and finalized image helpers**

In `apps/api/src/modules/core/service.js`, add these exact public boundaries and have the two existing wrapper functions call the first one inside their current connection scopes:

```js
export async function assertSessionAlbumImageUploadAllowed(
  connection,
  user,
  { sessionId, kind, forUpdate = false }
) {
  const session = await requireSessionAlbumOpen(connection, sessionId, { forUpdate });
  if (kind === "adminSessionAlbumPhoto") {
    if (!isAdmin(user) || Number(session.organizer_user_id) !== Number(user.user.id)) {
      throw forbidden("Only the session organizer can use admin album upload");
    }
    return session;
  }
  await requireSessionAlbumMember(connection, session, user, { forUpdate });
  return session;
}

export async function insertFinalizedSessionAlbumImage(connection, { intent, metadata }) {
  const [result] = await connection.query(
    `INSERT INTO session_album_photos
      (session_id, uploader_user_id, media_type, photo_url, object_key, object_etag,
       image_width, image_height, image_byte_size, image_content_type,
       processing_status, status)
     VALUES (?, ?, 'image', ?, ?, ?, ?, ?, ?, 'image/jpeg', 'ready', 'active')`,
    [
      Number(intent.session_id),
      Number(intent.user_id),
      `/${intent.object_key}`,
      intent.object_key,
      metadata.etag,
      metadata.width,
      metadata.height,
      metadata.byteSize
    ]
  );
  return findById(connection, "session_album_photos", result.insertId);
}

export async function getFinalizedSessionAlbumImage(connection, { mediaId, user }) {
  const photo = await findById(connection, "session_album_photos", mediaId);
  if (!photo || photo.media_type !== "image" || photo.status !== "active") {
    throw notFound("Album photo not found");
  }
  const session = await requireSessionAlbumOpen(connection, photo.session_id);
  await requireSessionAlbumMember(connection, session, user);
  return albumMediaResponse(photo, [], { userId: user.user.id });
}

export function serializeSessionAlbumImage(media, userId) {
  return albumMediaResponse(media, [], { userId });
}
```

Add internal storage facts only to image objects returned from `albumMediaResponse`:

```js
storage_object_key: media.object_key || null,
storage_object_etag: media.object_etag || null
```

Task 8 must strip both fields before every response; add an immediate test here that `albumMediaResponse` contains them only as server-internal projection inputs, not through a route response.

- [x] **Step 5: Run focused and existing privacy tests**

Run: `node --test apps/api/test/album-image-repository.test.mjs apps/api/test/album-image-access.test.mjs`

Expected: repository and access tests pass.

Run: `node scripts/d18-session-album-privacy-check.js && node scripts/d23-album-share-join-policy-check.js`

Expected: existing membership and public-share privacy contracts pass.

- [x] **Step 6: Commit repository and access boundaries**

```bash
git add apps/api/src/modules/album-image/repository.js apps/api/src/modules/core/service.js apps/api/test/album-image-repository.test.mjs apps/api/test/album-image-access.test.mjs
git commit -m "feat: add album image intent repository"
```

## Task 6: Intent creation, strict PUT authorization, and feature flags

执行状态：已完成（2026-07-11，9/9 意图、授权及遥测测试；D17、D42 创建回归与 API 语法检查通过）。

**Files:**
- Create: `apps/api/src/modules/album-image/upload-service.js`
- Create: `apps/api/src/modules/album-image/telemetry.js`
- Modify: `apps/api/src/config/env.js:171-219`
- Modify: `.env.example`
- Modify: `.env.production.example`
- Modify: `apps/api/src/server.js:731-1015,2340-2445`
- Create: `apps/api/test/album-image-upload-intent.test.mjs`
- Create: `apps/api/test/album-image-authorization.test.mjs`

- [x] **Step 1: Write failing intent and authorization tests**

Build the service with injected clock, UUID, database, access, and signer. Lock these cases:

```js
test("v2 intent fixes key, timing, source facts, processing, and no fallback", async () => {
  const upload = await service.createIntent({
    user,
    body: {
      kind: "sessionAlbumPhoto",
      sessionId: 8,
      extension: ".png",
      contentType: "image/png",
      byteSize: 2048
    }
  });
  assert.equal(upload.uploadMode, "cos-direct-v2");
  assert.equal(upload.direct, true);
  assert.equal(upload.fallbackAllowed, false);
  assert.equal(upload.uploadId, "00000000-0000-4000-8000-000000000043");
  assert.equal(upload.contentType, "image/png");
  assert.equal(upload.headers["x-cos-forbid-overwrite"], "true");
  assert.equal(JSON.parse(upload.picOperations).rules[0].fileid, `/${upload.key}`);
  assert.equal(Date.parse(upload.uploadExpiresAt) - nowMs, 600_000);
  assert.equal(Date.parse(upload.finalizeDeadlineAt) - nowMs, 1_500_000);
});

test("strict authorization rejects query, missing header, extra ACL, wrong size, and wrong key", async () => {
  for (const mutate of [
    (body) => { body.query = { imageInfo: "" }; },
    (body) => { delete body.headers["pic-operations"]; },
    (body) => { body.headers["x-cos-acl"] = "public-read"; },
    (body) => { body.headers["content-length"] = "2049"; },
    (body) => { body.key = `${body.key}.changed`; }
  ]) {
    const body = validAuthorizationBody();
    mutate(body);
    await assert.rejects(service.authorize({ user, body }), (error) => error.statusCode === 403);
  }
});

test("legacy authorization finds a persisted exact key and atomically binds length", async () => {
  const body = validAuthorizationBody();
  delete body.uploadId;
  const result = await service.authorize({ user, body });
  assert.match(result.authorization, /^q-sign-algorithm=sha1/);
  assert.equal(repository.boundByteSize, 2048);
});

test("required production mode fails closed when COS is unavailable", async () => {
  const requiredService = buildService({ cosEnabled: false, directUploadRequired: true });
  await assert.rejects(
    requiredService.createIntent({ user, body: validIntentBody() }),
    (error) => error.code === "COS_CONFIGURATION_ERROR"
  );
});
```

Also test JPEG/PNG only, 4MB maximum, uploadId ownership, pending-only authorization, current access recheck, Bucket/Region/PUT equality, exact header-name set, exact Pic-Operations, one-time legacy length binding, and authorization expiry capped by `upload_expires_at`.

- [x] **Step 2: Run intent/authorization tests to verify RED**

Run: `node --test apps/api/test/album-image-upload-intent.test.mjs apps/api/test/album-image-authorization.test.mjs`

Expected: FAIL because `createAlbumImageUploadService` does not exist.

- [x] **Step 3: Add feature flags and stable structured telemetry**

Add config without exposing secrets:

```js
albumMedia: {
  directMediaUrls: booleanEnv("COS_DIRECT_MEDIA_URLS", false),
  directUploadRequired: booleanEnv("COS_DIRECT_UPLOAD_REQUIRED", false)
}
```

Add both variables as `false` in `.env.example` and `.env.production.example`. Extend `publicConfig()` only with these booleans:

```js
albumMedia: {
  directMediaUrls: config.albumMedia.directMediaUrls,
  directUploadRequired: config.albumMedia.directUploadRequired
}
```

Create `telemetry.js`; never log object keys, signed URLs, tokens, ETags, filenames, or open IDs:

```js
export function emitAlbumImageEvent(event, fields = {}, sink = console.info) {
  sink(JSON.stringify({
    type: "album_image",
    event,
    at: new Date().toISOString(),
    sessionId: Number(fields.sessionId || 0) || undefined,
    mediaId: Number(fields.mediaId || 0) || undefined,
    outcome: fields.outcome || undefined,
    errorCode: fields.errorCode || undefined,
    retryCount: Number.isInteger(fields.retryCount) ? fields.retryCount : undefined
  }));
}
```

- [x] **Step 4: Implement `createAlbumImageUploadService` create/authorize methods**

The module initially exposes the two methods implemented and tested in this task:

```js
export function createAlbumImageUploadService(deps) {
  return {
    createIntent: (input) => createIntent(deps, input),
    authorize: (input) => authorize(deps, input)
  };
}
```

Task 7 extends this factory with status and finalize after their tests exist. In this task, `server.js` wires only `createIntent` and `authorize`. Implement create intent with `crypto.randomUUID()`, a random filename component, normalized extension/MIME, and these timestamps:

```js
const uploadExpiresAt = new Date(nowMs + ALBUM_IMAGE_UPLOAD_WINDOW_SECONDS * 1000);
const finalizeDeadlineAt = new Date(
  uploadExpiresAt.getTime() + ALBUM_IMAGE_FINALIZE_GRACE_SECONDS * 1000
);
const cleanupNotBefore = new Date(
  finalizeDeadlineAt.getTime() + ALBUM_IMAGE_CLEANUP_GRACE_SECONDS * 1000
);
```

Generate `uploads/session-album/display/{admin-}album-${sessionId}-${userId}-${unixMs}-${randomHex}.jpg`. Persist before returning. Return this exact shape for direct mode:

```js
{
  uploadMode: "cos-direct-v2",
  direct: true,
  fallbackAllowed: false,
  uploadId,
  sessionId,
  bucket,
  region,
  key: objectKey,
  uploadPath: `/${objectKey}`,
  maxBytes: ALBUM_IMAGE_MAX_SOURCE_BYTES,
  contentType: sourceContentType,
  contentLength: sourceByteSize,
  picOperations: JSON.stringify({
    is_pic_info: 1,
    rules: [{
      bucket,
      fileid: `/${objectKey}`,
      rule: ALBUM_IMAGE_DISPLAY_PROCESS
    }]
  }),
  headers: { "x-cos-forbid-overwrite": "true" },
  uploadExpiresAt: uploadExpiresAt.toISOString(),
  finalizeDeadlineAt: finalizeDeadlineAt.toISOString()
}
```

After persistence, emit `intent_created` with session ID and direct/local outcome. Emit `authorization_issued` without object key or signature. The finalize and cleanup tasks add their own terminal events.

For local COS-disabled mode with no required flag, return exactly:

```js
{
  uploadMode: "api-local",
  direct: false,
  fallbackAllowed: true,
  maxBytes: ALBUM_IMAGE_MAX_SOURCE_BYTES
}
```

For an old client that omits MIME and byte size, derive JPEG/PNG MIME from its normalized extension and persist `source_byte_size = null`; the first valid authorization atomically binds `Content-Length`. A v2 request must include MIME and a positive byte size. Require `.png ↔ image/png` and `.jpg/.jpeg ↔ image/jpeg`; reject a mismatch or unsupported type as `UNSUPPORTED_IMAGE_TYPE`, more than 4MB as `FILE_TOO_LARGE`, current-access failure as `ALBUM_UPLOAD_FORBIDDEN`, and a missing required COS configuration as `COS_CONFIGURATION_ERROR`.

Authorization must resolve by uploadId or exact `(current user, key)`, lock the row, re-check access, bind legacy byte length, and compare the normalized names to exactly:

```js
const REQUIRED_HEADERS = Object.freeze([
  "content-length",
  "content-type",
  "host",
  "pic-operations",
  "x-cos-forbid-overwrite"
]);
```

Require an empty Query, exact Bucket/Region/PUT/Key, exact source facts and Pic-Operations, server COS host, and overwrite value `true`. Sign for `Math.min(300, secondsUntilUploadExpiry)` and atomically record `last_authorization_expires_at` plus recomputed `cleanup_not_before` before returning `{ authorization, expiresAt }`.

- [x] **Step 5: Wire only album-image kinds through the service**

In the existing `/api/uploads/cos-intent` route, delegate when `isAlbumImageKind(body.kind)` and preserve the current function for all other kinds:

```js
const upload = isAlbumImageKind(body.kind)
  ? await albumImageUploads.createIntent({ user, body })
  : await createCosDirectUploadIntent({
      kind: body.kind,
      extension: body.extension,
      user,
      userId: user.user.id,
      sessionId: body.sessionId || body.session_id
    });
```

In `/api/uploads/cos-authorization`, delegate when `body.uploadId` exists or the exact key resolves to a current user's persisted album intent; otherwise use the existing avatar/review/video authorization. Do not infer an album kind from a key regex.

In both image multipart routes, enforce the production switch before calling any multipart parser or file reader:

```js
if (config.albumMedia.directUploadRequired) {
  throw new AppError(
    409,
    "DIRECT_UPLOAD_REQUIRED",
    "Production album images must be uploaded directly to COS"
  );
}
```

Keep this guard out of the album-video multipart route. Add authenticated `POST /api/telemetry/album-media` with an allowlist of `upload_retry`, `upload_failure`, `media_refresh_success`, and `media_refresh_failure`; accept only numeric session/retry fields plus a stable error code, pass them to `emitAlbumImageEvent`, and return 202. This endpoint carries no filenames, URLs, object keys, ETags, or image bytes.

- [x] **Step 6: Run new tests and non-goal regressions**

Run: `node --test apps/api/test/album-image-upload-intent.test.mjs apps/api/test/album-image-authorization.test.mjs`

Expected: all v2, legacy, strict-header, timing, and fail-closed cases pass.

Run: `node scripts/d17-cos-storage-check.js && npm run d42:api-creation`

Expected: avatar, review-photo, and video intent/authorization behavior remains green.

- [x] **Step 7: Commit intent creation and authorization**

```bash
git add apps/api/src/modules/album-image/upload-service.js apps/api/src/modules/album-image/telemetry.js apps/api/src/config/env.js .env.example .env.production.example apps/api/src/server.js apps/api/test/album-image-upload-intent.test.mjs apps/api/test/album-image-authorization.test.mjs
git commit -m "feat: issue strict album image upload intents"
```

## Task 7: Status reconciliation, idempotent finalize, and legacy create adapter

执行状态：已完成（2026-07-11，9/9 finalize/路由测试；D18 与 D42 创建、生命周期回归通过）。

**Files:**
- Modify: `apps/api/src/modules/album-image/upload-service.js`
- Modify: `apps/api/src/modules/album-image/repository.js`
- Modify: `apps/api/src/modules/core/service.js:5860-5919`
- Modify: `apps/api/src/server.js:2415-2445,3201-3265`
- Create: `apps/api/test/album-image-finalize.test.mjs`
- Create: `apps/api/test/album-image-routes.test.mjs`

- [x] **Step 1: Write failing status/finalize tests**

Cover external validation, the short transaction, and current authorization separately:

```js
test("status reports ready from HEAD ImageInfo HEAD without creating media", async () => {
  const result = await service.status({ user, uploadId: "upload-43" });
  assert.deepEqual(result, {
    uploadId: "upload-43",
    status: "pending",
    validationState: "ready",
    objectPresent: true,
    etag: "etag-43",
    canFinalize: true,
    finalizeDeadlineAt: "2026-07-11T01:25:00.000Z"
  });
  assert.equal(repository.insertedMedia.length, 0);
});

test("finalize is idempotent under two callers and creates one media row", async () => {
  const [first, second] = await Promise.all([
    service.finalize({ user, uploadId: "upload-43" }),
    service.finalize({ user, uploadId: "upload-43" })
  ]);
  assert.equal(first.photo.id, 91);
  assert.equal(second.photo.id, 91);
  assert.equal(repository.insertedMedia.length, 1);
});

test("revoked access blocks first and duplicate finalize without leaking URL", async () => {
  access.allowed = false;
  await assert.rejects(
    service.finalize({ user, uploadId: "upload-43" }),
    (error) => error.code === "ALBUM_UPLOAD_FORBIDDEN" && !error.details?.photo
  );
});

test("processing polls status and never fetches the full object body", async () => {
  validator.result = { validationState: "processing", objectPresent: true, canFinalize: false };
  await assert.rejects(
    service.finalize({ user, uploadId: "upload-43" }),
    (error) => error.code === "MEDIA_PROCESSING_PENDING"
  );
  assert.equal(storage.getObjectCalls, 0);
  assert.equal(repository.insertedMedia.length, 0);
});

test("legacy photoUrl finalizes only its exact persisted user session and kind", async () => {
  const result = await service.finalizeLegacy({
    user,
    sessionId: 8,
    kind: "sessionAlbumPhoto",
    photoUrl: "/uploads/session-album/display/album-8-3-1-a.jpg"
  });
  assert.equal(result.photo.id, 91);
  await assert.rejects(
    service.finalizeLegacy({
      user,
      sessionId: 9,
      kind: "sessionAlbumPhoto",
      photoUrl: "/uploads/session-album/display/album-8-3-1-a.jpg"
    }),
    (error) => error.code === "UPLOAD_INTENT_NOT_FOUND"
  );
});
```

Add explicit cases for another user, closed album, admin-owner revocation, deadline expiry, invalid output → rejected, pending → processing, cleanup_pending refusal, changed object key/ETag, finalized intent whose media was deleted, and source PNG whose stored JPEG byte length differs.

For routes, assert `GET /api/uploads/:uploadId/status` and `POST /api/uploads/:uploadId/finalize` require auth. Assert old photo-create routes call `finalizeLegacy` for a persisted COS key and never call `getSessionAlbumDisplayMetadata` or `getCosObject`.

- [x] **Step 2: Run finalize tests to verify RED**

Run: `node --test apps/api/test/album-image-finalize.test.mjs apps/api/test/album-image-routes.test.mjs`

Expected: FAIL because status/finalize are not exported or routed.

- [x] **Step 3: Implement status with current-access reauthorization**

Extend the service factory:

```js
return {
  createIntent: (input) => createIntent(deps, input),
  authorize: (input) => authorize(deps, input),
  status: (input) => status(deps, input),
  finalize: (input) => finalize(deps, input),
  finalizeLegacy: (input) => finalizeLegacy(deps, input)
};
```

Use one internal inspection function so public status never has to carry private finalize metadata:

```js
async function inspectUpload(deps, { user, uploadId }) {
  const intent = await deps.withDatabaseConnection(async (connection) => {
    const row = await deps.repository.findAlbumImageIntent(connection, uploadId);
    if (!row || Number(row.user_id) !== Number(user.user.id)) {
      throw new AppError(404, "UPLOAD_INTENT_NOT_FOUND", "Upload intent was not found");
    }
    await deps.assertUploadAllowed(connection, user, {
      sessionId: row.session_id,
      kind: row.kind
    });
    return row;
  });
  if (intent.status === "finalized") {
    return { intent, validation: null };
  }
  if (deps.now() > new Date(intent.finalize_deadline_at).getTime()) {
    await deps.withDatabaseConnection((connection) =>
      deps.repository.markAlbumImageIntentState(connection, {
        uploadId: intent.id,
        fromStatuses: ["pending", "processing"],
        toStatus: "expired",
        errorCode: "UPLOAD_INTENT_EXPIRED"
      })
    );
    throw new AppError(410, "UPLOAD_INTENT_EXPIRED", "Upload intent expired");
  }
  if (!["pending", "processing"].includes(intent.status)) {
    throw new AppError(409, "UPLOAD_INTENT_NOT_FINALIZABLE", "Upload intent cannot be finalized");
  }
  const validation = {
    ...(await deps.validateStoredImage(intent)),
    objectKey: intent.object_key
  };
  if (validation.validationState === "processing" && intent.status === "pending") {
    await deps.withDatabaseConnection((connection) =>
      deps.repository.markAlbumImageIntentState(connection, {
        uploadId: intent.id,
        fromStatuses: ["pending"],
        toStatus: "processing"
      })
    );
  }
  if (validation.validationState === "invalid") {
    await deps.withDatabaseConnection((connection) =>
      deps.repository.markAlbumImageIntentState(connection, {
        uploadId: intent.id,
        fromStatuses: ["pending", "processing"],
        toStatus: "rejected",
        errorCode: validation.errorCode
      })
    );
  }
  return { intent, validation };
}

function publicUploadStatus({ intent, validation }) {
  if (intent.status === "finalized") {
    return {
      uploadId: intent.id,
      status: "finalized",
      validationState: "ready",
      objectPresent: true,
      etag: intent.object_etag,
      canFinalize: false,
      mediaId: Number(intent.media_id),
      finalizeDeadlineAt: new Date(intent.finalize_deadline_at).toISOString()
    };
  }
  return {
    uploadId: intent.id,
    status: validation.validationState === "processing" ? "processing" : intent.status,
    validationState: validation.validationState,
    objectPresent: validation.objectPresent,
    etag: validation.etag || "",
    canFinalize: validation.canFinalize === true,
    ...(validation.errorCode ? { errorCode: validation.errorCode } : {}),
    finalizeDeadlineAt: new Date(intent.finalize_deadline_at).toISOString()
  };
}

async function status(deps, input) {
  return publicUploadStatus(await inspectUpload(deps, input));
}
```

Conditional repository updates may move pending to processing or pending/processing to rejected. They cannot move finalized, expired, cleanup_pending, cleanup_failed, or cleaned rows.

- [x] **Step 4: Implement the short idempotent finalize transaction**

Inspect outside the transaction, then lock and commit only when ready:

```js
async function finalize(deps, { user, uploadId }) {
  const inspected = await inspectUpload(deps, { user, uploadId });
  const { validation } = inspected;
  if (validation?.validationState === "invalid") {
    throw new AppError(422, validation.errorCode, "Album image processing result is invalid");
  }
  if (inspected.intent.status !== "finalized" && !validation?.canFinalize) {
    throw new AppError(409, "MEDIA_PROCESSING_PENDING", "Album image is still processing");
  }
  return deps.withTransaction(async (connection) => {
    const intent = await deps.repository.findAlbumImageIntent(connection, uploadId, { forUpdate: true });
    if (!intent || Number(intent.user_id) !== Number(user.user.id)) {
      throw new AppError(404, "UPLOAD_INTENT_NOT_FOUND", "Upload intent was not found");
    }
    await deps.assertUploadAllowed(connection, user, {
      sessionId: intent.session_id,
      kind: intent.kind,
      forUpdate: true
    });
    if (intent.status === "finalized") {
      const photo = await deps.getFinalizedImage(connection, {
        mediaId: intent.media_id,
        user
      });
      return { uploadId: intent.id, photo };
    }
    if (
      !["pending", "processing"].includes(intent.status) ||
      deps.now() > new Date(intent.finalize_deadline_at).getTime() ||
      intent.object_key !== validation.objectKey
    ) {
      throw new AppError(409, "UPLOAD_INTENT_NOT_FINALIZABLE", "Upload intent cannot be finalized");
    }
    const photoRow = await deps.insertFinalizedImage(connection, {
      intent,
      metadata: validation
    });
    const [updated] = await connection.query(
      `UPDATE session_album_upload_intents
       SET status = 'finalized', media_id = ?, stored_content_type = ?,
           stored_byte_size = ?, stored_width = ?, stored_height = ?,
           object_etag = ?, finalized_at = CURRENT_TIMESTAMP
       WHERE id = ? AND status IN ('pending', 'processing')`,
      [
        photoRow.id,
        validation.contentType,
        validation.byteSize,
        validation.width,
        validation.height,
        validation.etag,
        intent.id
      ]
    );
    if (Number(updated.affectedRows || 0) !== 1) {
      throw new AppError(409, "UPLOAD_FINALIZE_RACE", "Upload finalize raced with another state transition");
    }
    return {
      uploadId: intent.id,
      photo: deps.serializeImage(photoRow, user.user.id)
    };
  });
}
```

Emit `intent_finalized` only after transaction commit, with session/media IDs and no storage secret. Emit `intent_expired`, `intent_rejected`, and stable validation error codes on their corresponding conditional transitions.

Construct the server dependencies with `withDatabaseConnection`, `withTransaction`, repository functions, `assertSessionAlbumImageUploadAllowed`, `validateStoredAlbumImage`, `insertFinalizedSessionAlbumImage`, `getFinalizedSessionAlbumImage`, `serializeSessionAlbumImage`, `Date.now`, and the COS storage adapter. `validation.etag` is the validator's second-HEAD ETag; no client-supplied ETag reaches this path. If a finalized intent's media row no longer exists, return `FINALIZED_MEDIA_MISSING` without creating a replacement.

- [x] **Step 5: Implement exact-key legacy adaptation and HTTP routes**

`finalizeLegacy` accepts only a root-relative display URL, converts it to an exact object key, finds the current user's persisted intent, and checks session/kind equality before calling `finalize`. It ignores all client metadata.

Add authenticated routes before generic album routes:

```js
const albumUploadStatusId = stringMatch(
  url.pathname,
  /^\/api\/uploads\/([0-9a-f-]{36})\/status$/i
);
if (request.method === "GET" && albumUploadStatusId) {
  const user = await getAuthUser(request);
  jsonResponse(response, 200, {
    ok: true,
    data: publicAlbumUploadStatus(await albumImageUploads.status({ user, uploadId: albumUploadStatusId }))
  });
  return;
}

const albumUploadFinalizeId = stringMatch(
  url.pathname,
  /^\/api\/uploads\/([0-9a-f-]{36})\/finalize$/i
);
if (request.method === "POST" && albumUploadFinalizeId) {
  const user = await getAuthUser(request);
  const finalized = await albumImageUploads.finalize({ user, uploadId: albumUploadFinalizeId });
  jsonResponse(response, 200, {
    ok: true,
    data: attachLegacyFinalizedAlbumImageUrls(finalized)
  });
  return;
}
```

Define the temporary compatibility boundary as:

```js
function attachLegacyFinalizedAlbumImageUrls(finalized) {
  const {
    storage_object_key: ignoredObjectKey,
    storage_object_etag: ignoredObjectEtag,
    ...photo
  } = finalized.photo;
  return {
    uploadId: finalized.uploadId,
    photo: {
      ...photo,
      image_url: sessionAlbumMediaPath(photo.id),
      preview_url: sessionAlbumMediaPath(photo.id, "preview"),
      thumbnail_url: sessionAlbumMediaPath(photo.id, "thumbnail")
    }
  };
}
```

Task 8 upgrades this same boundary with signed fields. Add a route test that neither internal field is present after first finalize or duplicate finalize.

If no existing `stringMatch` helper exists, add one next to `idMatch` that returns capture group 1 or `null` without numeric conversion.

For the two old `{ photoUrl }` create routes: when COS is enabled, call `finalizeLegacy` and return its one photo; when COS is disabled, retain the local metadata/create path. A COS key without a matching persisted intent returns `UPLOAD_INTENT_NOT_FOUND` and never invokes full-object Sharp inspection.

- [x] **Step 6: Run finalize, route, privacy, and video regression tests**

Run: `node --test apps/api/test/album-image-finalize.test.mjs apps/api/test/album-image-routes.test.mjs`

Expected: all state, idempotency, revoked-access, and legacy-route cases pass.

Run: `node scripts/d18-session-album-privacy-check.js && npm run d42:api-creation && npm run d42:api-lifecycle`

Expected: image privacy and the entire video creation/lifecycle suite remain green.

- [x] **Step 7: Commit finalize and reconciliation**

```bash
git add apps/api/src/modules/album-image/upload-service.js apps/api/src/modules/album-image/repository.js apps/api/src/modules/core/service.js apps/api/src/server.js apps/api/test/album-image-finalize.test.mjs apps/api/test/album-image-routes.test.mjs
git commit -m "feat: finalize album images from COS metadata"
```

## Task 8: Signed album responses with legacy/local compatibility

执行状态：已完成（2026-07-11，8/8 响应、隐私及路由测试；D18/D23/D31 回归通过）。

**Files:**
- Modify: `apps/api/src/server.js:1420-1735,3110-3265`
- Modify: `apps/api/src/modules/core/service.js:809-875,5711-5857`
- Create: `apps/api/test/album-image-response-urls.test.mjs`
- Create: `apps/api/test/album-image-privacy-integration.test.mjs`

- [x] **Step 1: Write failing response URL and privacy tests**

Use fixed time and injected signer. Cover member, admin, public share, legacy COS row, local row, and video:

```js
test("direct mode signs only already-filtered image rows and strips storage facts", () => {
  const album = {
    photos: [
      { id: 1, media_type: "image", storage_object_key: "uploads/session-album/display/a.jpg", storage_object_etag: "e" },
      { id: 2, media_type: "video", video_url: "/api/session-album/media/2/video-url" }
    ]
  };
  const result = attachSessionAlbumMediaUrls(album, 9, {
    directMediaUrls: true,
    nowSeconds: 1000,
    cosConfig
  });
  assert.match(result.photos[0].thumbnail_display_url, /^https:\/\/.*\.myqcloud\.com\//);
  assert.equal(result.photos[0].media_url_expires_at, "1970-01-01T00:21:40.000Z");
  assert.equal("storage_object_key" in result.photos[0], false);
  assert.equal("storage_object_etag" in result.photos[0], false);
  assert.equal(result.photos[1].video_url, "/api/session-album/media/2/video-url");
});

test("local or unbackfilled image exposes new fields through the old API and no expiry", () => {
  const result = attachSessionAlbumMediaUrls({
    session_id: 8,
    photos: [{ id: 3, media_type: "image", storage_object_key: null }]
  }, 9, { directMediaUrls: true, nowSeconds: 1000, cosConfig });
  assert.match(result.photos[0].preview_display_url, /^\/api\/session-album\/photos\/3\/image/);
  assert.equal(result.photos[0].media_url_expires_at, null);
});
```

The integration test seeds one visible and one hidden photo for each existing privacy rule, calls member/admin/public-share list paths, and records signer calls. Assert no signer call occurs for a filtered photo and no endpoint accepts arbitrary photo IDs for bulk signing.

- [x] **Step 2: Run response tests to verify RED**

Run: `node --test apps/api/test/album-image-response-urls.test.mjs apps/api/test/album-image-privacy-integration.test.mjs`

Expected: FAIL because the new fields are absent and storage facts are not consumed.

- [x] **Step 3: Add one image attachment function and strip internals**

Refactor the duplicated `photos`/`media` mapping through one function. Preserve existing video branches byte-for-byte:

```js
function attachAlbumImageUrls(photo, legacyUrls, options) {
  const {
    storage_object_key: objectKey,
    storage_object_etag: ignoredEtag,
    ...safePhoto
  } = photo;
  const signed = options.directMediaUrls && objectKey && cosStorageEnabled(options.cosConfig)
    ? buildAlbumImageUrls({
        objectKey,
        mediaId: photo.id,
        nowSeconds: options.nowSeconds,
        config: options.cosConfig
      })
    : {
        thumbnail_display_url: legacyUrls.thumbnail,
        preview_display_url: legacyUrls.preview,
        download_url: legacyUrls.preview,
        media_url_expires_at: null
      };
  return {
    ...safePhoto,
    image_url: legacyUrls.preview,
    preview_url: legacyUrls.preview,
    thumbnail_url: legacyUrls.thumbnail,
    preview_load_url: legacyUrls.previewLoad || legacyUrls.preview,
    thumbnail_load_url: legacyUrls.thumbnailLoad || legacyUrls.thumbnail,
    ...signed
  };
}
```

Use one `nowSeconds` captured at the start of each album response so all image variants share an expiry. Call this function only after `listSessionAlbum`, admin access checks, or `listPublicSessionAlbumShare` has completed existing filtering. Public fallback uses its existing tokenized media path. Never serialize `ignoredEtag` or `objectKey`.

Emit one `media_urls_signed` event per album response with route kind and signed image count, not one event per URL. In the retained legacy image proxy routes, emit `legacy_proxy_read` with variant, response byte count, and outcome so rollout dashboards can measure proxy calls and API image egress.

- [x] **Step 4: Add signed URLs to finalize responses without a new lookup endpoint**

Pass a finalized photo through the same attachment helper using current authenticated/member context. If direct reads are off, return new fields pointing to legacy API URLs. Duplicate finalize after revocation still fails before this helper executes.

- [x] **Step 5: Run response, privacy, and compatibility tests**

Run: `node --test apps/api/test/album-image-response-urls.test.mjs apps/api/test/album-image-privacy-integration.test.mjs`

Expected: all member/admin/public/local/direct cases pass, and raw storage facts are absent.

Run: `node scripts/d18-session-album-privacy-check.js && node scripts/d23-album-share-join-policy-check.js && node scripts/d31-album-viewer-sequence-check.js`

Expected: existing privacy, share-seat, and viewer-order behavior remains green.

- [x] **Step 6: Commit signed album responses**

```bash
git add apps/api/src/server.js apps/api/src/modules/core/service.js apps/api/test/album-image-response-urls.test.mjs apps/api/test/album-image-privacy-integration.test.mjs
git commit -m "feat: return short lived COS album image URLs"
```

## Task 9: Crash-safe orphan cleanup, durable image deletion, and HEAD-gated backfill

执行状态：已完成（2026-07-11，8/8 清理、回填及删除测试；D42 视频删除回归与 API 语法检查通过。实际 worker 删除入口留待受控发布验证）。

**Files:**
- Modify: `apps/api/src/modules/album-image/repository.js`
- Create: `apps/api/src/modules/album-image/cleanup.js`
- Create: `apps/api/src/modules/album-image/backfill.js`
- Create: `apps/api/src/jobs/album-image-cleanup.js`
- Create: `apps/api/src/jobs/backfill-album-image-object-keys.js`
- Modify: `apps/api/src/modules/core/service.js:6271-6333`
- Modify: `apps/api/src/server.js:3283-3311`
- Modify: `apps/api/package.json`
- Create: `apps/api/test/album-image-cleanup.test.mjs`
- Create: `apps/api/test/album-image-backfill.test.mjs`
- Create: `apps/api/test/album-image-delete.test.mjs`

- [x] **Step 1: Write failing lease, deletion, and backfill tests**

Lock the crash and race behavior with an in-memory repository fake:

```js
test("two workers claim each due row once and an expired lease is recoverable", async () => {
  const first = await repository.claimCleanupBatch({ workerId: "worker-a", limit: 10, now });
  const second = await repository.claimCleanupBatch({ workerId: "worker-b", limit: 10, now });
  assert.deepEqual(first.map((row) => row.id), [1]);
  assert.deepEqual(second, []);
  clock.advance(61_000);
  const recovered = await repository.claimCleanupBatch({ workerId: "worker-c", limit: 10, now: clock.now() });
  assert.deepEqual(recovered.map((row) => row.id), [1]);
});

test("an abandoned pending intent is expired by the worker before cleanup claim", async () => {
  clock.set(Date.parse("2026-07-11T01:26:00.000Z"));
  await runAlbumImageCleanupBatch(deps);
  assert.equal(repository.intent("abandoned").status, "expired");
  assert.equal(repository.intent("abandoned").lease_token, null);
});

test("orphan 404 is cleaned and retryable delete failure keeps its anchor", async () => {
  storage.head = async () => { throw Object.assign(new Error("missing"), { code: "COS_OBJECT_NOT_FOUND" }); };
  await runAlbumImageCleanupBatch(deps);
  assert.equal(repository.intent(1).status, "cleaned");

  storage.head = async () => ({ etag: "e" });
  storage.delete = async () => { throw Object.assign(new Error("upstream"), { code: "COS_UPSTREAM_ERROR" }); };
  await runAlbumImageCleanupBatch(deps);
  assert.equal(repository.intent(2).status, "cleanup_failed");
  assert.equal(repository.intent(2).cleanup_attempts, 1);
  assert.ok(repository.intent(2).next_retry_at > clock.now());
});

test("image delete commits deleting plus job before object I/O", async () => {
  const result = await requestAlbumImageDeletion(connection, { user, mediaId: 91 });
  assert.equal(result.status, "deleting");
  assert.equal(connection.jobs.length, 1);
  assert.equal(storage.deleteCalls, 0);
});

test("backfill updates only an exact COS candidate whose HEAD succeeds", async () => {
  storage.head = async (key) => {
    if (key.endsWith("present.jpg")) return { etag: "present-etag" };
    throw Object.assign(new Error("missing"), { code: "COS_OBJECT_NOT_FOUND" });
  };
  const result = await backfillAlbumImageObjectKeys({ repository, storage, apply: true });
  assert.deepEqual(result, { scanned: 2, updated: 1, missing: 1, invalid: 0 });
  assert.equal(repository.photo("present").object_key, "uploads/session-album/display/present.jpg");
  assert.equal(repository.photo("missing").object_key, null);
});
```

Add cases for `cleanup_not_before`, active authorization/finalize deadline, finalize versus cleanup claim, idempotent DELETE, local unlink, successful hard delete of tags/media only after object deletion, cleanup-job retry, and a video delete proving it never enters the new image job.

- [x] **Step 2: Run cleanup/backfill/delete tests to verify RED**

Run: `node --test apps/api/test/album-image-cleanup.test.mjs apps/api/test/album-image-backfill.test.mjs apps/api/test/album-image-delete.test.mjs`

Expected: FAIL because cleanup, backfill, lease claims, and durable image deletion do not exist.

- [x] **Step 3: Add transactional claims with expired-lease recovery**

Extend `repository.js` with transaction-scoped claims. MySQL 8.4 uses `FOR UPDATE SKIP LOCKED`; set a 60-second lease in the same transaction:

```js
export async function expireOverdueAlbumImageIntents(connection, now) {
  const [result] = await connection.query(
    `UPDATE session_album_upload_intents
     SET status = 'expired', last_error_code = 'UPLOAD_INTENT_EXPIRED'
     WHERE status IN ('pending', 'processing')
       AND finalize_deadline_at <= ?`,
    [now]
  );
  return Number(result.affectedRows || 0);
}

export async function claimExpiredAlbumImageIntents(
  connection,
  { leaseToken, now, leaseExpiresAt, limit }
) {
  const [rows] = await connection.query(
    `SELECT * FROM session_album_upload_intents
     WHERE (
       status IN ('expired', 'rejected', 'cleanup_failed')
       OR (status = 'cleanup_pending' AND lease_expires_at <= ?)
     )
       AND cleanup_not_before <= ?
       AND (next_retry_at IS NULL OR next_retry_at <= ?)
     ORDER BY cleanup_not_before, created_at
     LIMIT ? FOR UPDATE SKIP LOCKED`,
    [now, now, now, Number(limit)]
  );
  for (const row of rows) {
    await connection.query(
      `UPDATE session_album_upload_intents
       SET status = 'cleanup_pending', lease_token = ?, lease_expires_at = ?
       WHERE id = ?`,
      [leaseToken, leaseExpiresAt, row.id]
    );
  }
  return rows;
}

export async function claimAlbumObjectCleanupJobs(
  connection,
  { leaseToken, now, leaseExpiresAt, limit }
) {
  const [rows] = await connection.query(
    `SELECT * FROM session_album_object_cleanup_jobs
     WHERE (
       status IN ('pending', 'retry')
       OR (status = 'leased' AND lease_expires_at <= ?)
     )
       AND (next_retry_at IS NULL OR next_retry_at <= ?)
     ORDER BY created_at
     LIMIT ? FOR UPDATE SKIP LOCKED`,
    [now, now, Number(limit)]
  );
  for (const row of rows) {
    await connection.query(
      `UPDATE session_album_object_cleanup_jobs
       SET status = 'leased', lease_token = ?, lease_expires_at = ?
       WHERE id = ?`,
      [leaseToken, leaseExpiresAt, row.id]
    );
  }
  return rows;
}
```

Completion/failure updates must require both row ID and lease token. Retry delay is `min(6 hours, 30 seconds * 2 ** min(attempts, 10))`; clear lease fields on every completion/failure transition.

- [x] **Step 4: Implement cleanup without losing database anchors**

Create `cleanup.js` with injected `headObject`, `deleteObject`, `unlinkFile`, and transaction helpers. For an orphan intent: HEAD, treat trusted 404 as success, DELETE a present object, then mark `cleaned`. For a business deletion job: delete COS/local bytes first; then in one transaction lock job and media, delete tags, hard-delete the media row, and mark job `cleaned`. On any untrusted or retryable error, retain both rows and schedule retry.

The batch boundary is:

```js
export async function runAlbumImageCleanupBatch({
  repository,
  storage,
  unlinkFile,
  withTransaction,
  now = () => Date.now(),
  randomUUID = crypto.randomUUID,
  limit = 25,
  emit = emitAlbumImageEvent
}) {
  await withTransaction((connection) => repository.expireOverdueAlbumImageIntents(
    connection,
    new Date(now())
  ));
  const leaseToken = randomUUID();
  const claimed = await withTransaction((connection) => repository.claimAllCleanup(
    connection,
    {
      leaseToken,
      now: new Date(now()),
      leaseExpiresAt: new Date(now() + 60_000),
      limit
    }
  ));
  for (const item of claimed) {
    await cleanupOneClaim({ item, leaseToken, repository, storage, unlinkFile, withTransaction, now, emit });
  }
  return { claimed: claimed.length };
}
```

`claimAllCleanup` returns tagged entries `{ type: "intent" | "media", row }` and shares the batch limit across both sources.

- [x] **Step 5: Change image deletion to a durable state transition only**

Add `requestSessionAlbumImageDeletion(user, mediaId)` in core service. In one transaction it locks the image and current permission rows, returns the existing job if status is already `deleting`, otherwise updates `status='deleting'` and inserts one cleanup job with `storage_kind='cos'` plus `object_key`, or `storage_kind='local'` plus the validated local path.

Change only the image branch in `server.js`:

```js
if (deletionSnapshot.media_type === "video") {
  const deletedVideo = await cleanupAlbumVideoBeforeDelete({
    urls: deletionSnapshot.object_urls,
    deleteObject: deleteUploadedSessionAlbumPhotoObject,
    finalizeSnapshot: (snapshot) => finalizeSessionAlbumPhotoDeletion(
      user,
      sessionAlbumPhotoId,
      { object_urls: snapshot }
    )
  });
  jsonResponse(response, 200, { ok: true, data: { id: deletedVideo.id, deleted: true } });
  return;
}
const deletion = await requestSessionAlbumImageDeletion(user, sessionAlbumPhotoId);
jsonResponse(response, 202, {
  ok: true,
  data: { id: deletion.id, deleted: false, deletionPending: true }
});
return;
```

Keep list queries on `status='active'`, so `deleting` disappears immediately. Do not change the video cleanup calls or their strict COS error behavior.

- [x] **Step 6: Implement HEAD-gated, resumable backfill**

Create `backfill.js` that pages by media ID over active image rows with `object_key IS NULL` and a root-relative display path. Validate the path with the existing COS key parser, HEAD it, then use a conditional update:

```sql
UPDATE session_album_photos
SET object_key = ?, object_etag = ?
WHERE id = ? AND object_key IS NULL AND photo_url = ?
```

Trusted 404 increments `missing`; invalid paths increment `invalid`; neither updates the row. The CLI defaults to report-only and mutates only with `--apply`:

```js
const apply = process.argv.includes("--apply");
const result = await backfillAlbumImageObjectKeys({ repository, storage, apply });
console.log(JSON.stringify({ ok: true, apply, ...result }, null, 2));
```

- [x] **Step 7: Add worker scripts and run focused tests**

Add API scripts:

```json
"job:album-image-cleanup": "node src/jobs/album-image-cleanup.js",
"job:album-image-backfill": "node src/jobs/backfill-album-image-object-keys.js"
```

The cleanup entrypoint runs one batch with `--once`; otherwise it loops every 30 seconds, handles SIGTERM/SIGINT between batches, and sets a nonzero exit code for an unhandled batch failure so Docker restarts it.

Run: `node --test apps/api/test/album-image-cleanup.test.mjs apps/api/test/album-image-backfill.test.mjs apps/api/test/album-image-delete.test.mjs`

Expected: all lease, retry, delete ordering, local/COS, and backfill cases pass.

Run: `npm run d42:api-delete`

Expected: all video deletion checks pass without entering the image job path.

- [x] **Step 8: Commit cleanup and backfill**

```bash
git add apps/api/src/modules/album-image/repository.js apps/api/src/modules/album-image/cleanup.js apps/api/src/modules/album-image/backfill.js apps/api/src/jobs/album-image-cleanup.js apps/api/src/jobs/backfill-album-image-object-keys.js apps/api/src/modules/core/service.js apps/api/src/server.js apps/api/package.json apps/api/test/album-image-cleanup.test.mjs apps/api/test/album-image-backfill.test.mjs apps/api/test/album-image-delete.test.mjs
git commit -m "feat: make album image cleanup recoverable"
```

## Task 10: Mini-program v2 upload adapter with scoped errors and local-only fallback

执行状态：已完成（2026-07-11，7/7 小程序上传测试；maintenance、D17 与 D42 mini 回归通过）。

**Files:**
- Modify: `apps/miniprogram/package.json`
- Modify: `package-lock.json`
- Modify: `apps/miniprogram/src/utils/api.js:1-149,477-642,829-847,1171-1222`
- Create: `apps/miniprogram/src/utils/albumPhotoUpload.js`
- Create: `apps/miniprogram/test/albumPhotoUpload.test.mjs`

- [x] **Step 1: Write failing mini-program upload tests**

Inject all API/COS calls into the adapter. Lock production/local routing and maintenance isolation:

```js
test("direct v2 sends exact facts and returns the finalized photo without multipart", async () => {
  const calls = [];
  const result = await uploadAlbumPhoto({
    sessionId: 8,
    filePath: "/tmp/photo.png",
    fileSize: 2048,
    contentType: "image/png",
    api: fakeApi(calls, { uploadMode: "cos-direct-v2", direct: true, fallbackAllowed: false }),
    onPhase: (phase) => calls.push(["phase", phase.phase, phase.retry])
  });
  assert.equal(result.photo.id, 91);
  assert.deepEqual(calls.filter(([name]) => name === "localUpload"), []);
  assert.deepEqual(calls.filter(([name]) => name === "intent")[0].slice(1), [
    8,
    { extension: ".png", contentType: "image/png", byteSize: 2048, adminOwner: false }
  ]);
});

test("unknown or failed direct response never opts itself into fallback", async () => {
  for (const upload of [
    { direct: false, fallbackAllowed: false },
    { uploadMode: "unknown", direct: false, fallbackAllowed: true }
  ]) {
    const calls = [];
    await assert.rejects(
      uploadAlbumPhoto({
        sessionId: 8,
        filePath: "/tmp/a.jpg",
        fileSize: 10,
        contentType: "image/jpeg",
        api: fakeApi(calls, upload),
        onPhase: () => {}
      }),
      (error) => error.code === "DIRECT_UPLOAD_REQUIRED"
    );
    assert.equal(calls.some(([name]) => name === "localUpload"), false);
  }
});

test("only explicit api-local plus fallbackAllowed uses the existing local path", async () => {
  const calls = [];
  const result = await uploadAlbumPhoto({
    sessionId: 8,
    filePath: "/tmp/a.jpg",
    fileSize: 10,
    contentType: "image/jpeg",
    api: fakeApi(calls, { uploadMode: "api-local", direct: false, fallbackAllowed: true }),
    onPhase: () => {}
  });
  assert.equal(result.photo.id, 92);
  assert.equal(calls.filter(([name]) => name === "localUpload").length, 1);
});
```

Add adapter cases for two retry attempts, status reconciliation before retry, conflict reconciliation without second PUT, one signature refresh, processing polling, exact phases, and an API/COS failure preserving `code`, `status`, `details`, and message.

Add a source assertion around `api.js` that album intent/status/finalize calls set `suppressMaintenance: true`, while a normal API network failure still invokes the existing maintenance behavior.

- [x] **Step 2: Run mini upload tests to verify RED**

Run: `node --test apps/miniprogram/test/albumPhotoUpload.test.mjs`

Expected: FAIL because `albumPhotoUpload.js` does not exist.

- [x] **Step 3: Add the shared workspace dependency and preserve rich errors**

Add to `apps/miniprogram/package.json`:

```json
"@pinche/shared": "file:../../packages/shared"
```

Run: `npm install --package-lock-only`

Expected: `package-lock.json` records the mini-program link to `packages/shared` without changing unrelated dependency versions.

In the common `request`/upload error paths, create an Error and retain transport facts:

```js
function normalizedApiError({ status = 0, payload = {}, fallbackMessage }) {
  const error = new Error(payload.message || fallbackMessage);
  error.status = Number(status || 0);
  error.statusCode = error.status;
  error.code = payload.code || "API_REQUEST_FAILED";
  error.details = payload.details;
  return error;
}
```

Wrap existing calls to `markBackendMaintenance` with `if (!options.suppressMaintenance)`. Do not alter its default. Only the album intent, authorization, status, finalize, signed-media refresh, and direct media download paths pass `suppressMaintenance: true`.

- [x] **Step 4: Add uploadId-aware COS calls without changing generic fallback**

Export these low-level functions from `api.js`:

```js
export function createSessionAlbumPhotoUploadIntent(sessionId, facts) {
  return request({
    url: "/api/uploads/cos-intent",
    method: "POST",
    data: {
      kind: facts.adminOwner ? "adminSessionAlbumPhoto" : "sessionAlbumPhoto",
      sessionId,
      extension: facts.extension,
      contentType: facts.contentType,
      byteSize: facts.byteSize
    },
    suppressMaintenance: true
  }).then((response) => dataOf(response)?.upload);
}

export function getSessionAlbumPhotoUploadStatus(uploadId) {
  return request({
    url: `/api/uploads/${encodeURIComponent(uploadId)}/status`,
    suppressMaintenance: true
  }).then(dataOf);
}

export function finalizeSessionAlbumPhotoUpload(uploadId) {
  return request({
    url: `/api/uploads/${encodeURIComponent(uploadId)}/finalize`,
    method: "POST",
    data: {},
    suppressMaintenance: true
  }).then(dataOf);
}
```

Keep a short-lived `Map` from exact COS key to uploadId only during `putObject`; include that uploadId in `/api/uploads/cos-authorization`. Pass `ContentLength`, `ContentType`, `PicOperations`, and `Headers: { "x-cos-forbid-overwrite": "true" }` from the intent. Delete the map entry in `finally`. Export `putSessionAlbumPhotoToCos(upload, filePath)` with no API fallback. Enforce a 300,000ms PUT watchdog and call the SDK task's `abort()` when available. Leave existing `uploadCosBackedFile` unchanged for avatar, review photo, and album video.

Normalize mini-program `url not in domain list` errors to `COS_DOMAIN_NOT_ALLOWED`, timeouts to `COS_REQUEST_TIMEOUT`, and preserve COS XML `Code`/`Message` from the SDK. Add fire-and-forget `reportAlbumMediaEvent` calls for retry/failure and URL refresh outcomes; reporting itself uses `suppressMaintenance: true` and never changes the user-visible result.

- [x] **Step 5: Implement the mini-program adapter around the shared state machine**

Create `albumPhotoUpload.js`:

```js
import { albumMediaError, executeAlbumCosUpload } from "@pinche/shared";
import * as defaultApi from "./api.js";

function extensionForFile(path, contentType) {
  if (contentType === "image/png") return ".png";
  if (contentType === "image/jpeg") return ".jpg";
  const match = String(path || "").match(/\.(jpe?g|png)$/i);
  return match ? `.${match[1].toLowerCase()}`.replace(".jpeg", ".jpg") : ".jpg";
}

export async function uploadAlbumPhoto({
  sessionId,
  filePath,
  fileSize,
  contentType,
  adminOwner = false,
  api = defaultApi,
  execute = executeAlbumCosUpload,
  onPhase = () => {}
}) {
  onPhase({ phase: "preparing", retry: 0 });
  const upload = await api.createSessionAlbumPhotoUploadIntent(sessionId, {
    extension: extensionForFile(filePath, contentType),
    contentType,
    byteSize: Number(fileSize),
    adminOwner
  });
  if (upload.uploadMode === "api-local" && upload.direct === false && upload.fallbackAllowed === true) {
    const photoUrl = await api.uploadSessionAlbumPhotoLocal(sessionId, filePath, { adminOwner });
    return api.createSessionAlbumPhotoLegacy(sessionId, photoUrl, { adminOwner });
  }
  if (upload.uploadMode !== "cos-direct-v2" || upload.direct !== true || upload.fallbackAllowed !== false) {
    throw albumMediaError("DIRECT_UPLOAD_REQUIRED", "相册图片必须直传 COS");
  }
  return execute({
    putObject: () => api.putSessionAlbumPhotoToCos(upload, filePath),
    getStatus: () => api.getSessionAlbumPhotoUploadStatus(upload.uploadId),
    finalize: () => api.finalizeSessionAlbumPhotoUpload(upload.uploadId),
    refreshAuthorization: () => api.clearSessionAlbumPhotoAuthorization(upload.key),
    onPhase
  });
}
```

`uploadSessionAlbumPhotoLocal` exports the current multipart helper and resolves to its photo URL string. `createSessionAlbumPhotoLegacy` POSTs that URL, reads `dataOf(response)`, and resolves to `{ photo: dataOf(response) }`, matching the v2 finalize shape. Both are reachable only through the exact `api-local` condition above.

- [x] **Step 6: Verify focused and generic-upload behavior**

Run: `node --test apps/miniprogram/test/albumPhotoUpload.test.mjs`

Expected: all direct/local/retry/reconciliation/error tests pass.

Run: `node scripts/check-maintenance-mode.js && node scripts/d17-cos-storage-check.js && npm run d42:mini`

Expected: scoped album failures never set maintenance; default maintenance, avatar/review fallback, and video paths remain green.

- [x] **Step 7: Commit the mini-program upload adapter**

```bash
git add apps/miniprogram/package.json package-lock.json apps/miniprogram/src/utils/api.js apps/miniprogram/src/utils/albumPhotoUpload.js apps/miniprogram/test/albumPhotoUpload.test.mjs
git commit -m "feat: upload mini program album images directly to COS"
```

## Task 11: Mini-program signed URL lifecycle, cache preservation, and real errors

执行状态：已完成（2026-07-11，12/12 小程序 URL/上传测试；静态、维护、D31、D42 与生产构建通过）。

**Files:**
- Create: `apps/miniprogram/src/utils/albumMediaUrls.js`
- Modify: `apps/miniprogram/src/pages/session/album.vue:594-950,1295-1765,1949-2015,2384-2531,2717-2750,3067-3127`
- Create: `apps/miniprogram/test/albumMediaUrls.test.mjs`

- [x] **Step 1: Write failing URL normalization and refresh-controller tests**

```js
import assert from "node:assert/strict";
import test from "node:test";
import {
  createAlbumMediaRefreshController,
  normalizeAlbumImageUrls
} from "../src/utils/albumMediaUrls.js";

test("signed fields win while old and local paths remain compatible", () => {
  assert.deepEqual(normalizeAlbumImageUrls({
    id: 1,
    thumbnail_display_url: "cos-thumb",
    preview_display_url: "cos-preview",
    download_url: "cos-download",
    thumbnail_load_url: "api-thumb",
    preview_load_url: "api-preview"
  }), {
    thumbnailUrl: "cos-thumb",
    previewUrl: "cos-preview",
    downloadUrl: "cos-download",
    expiresAt: ""
  });
});

test("concurrent expiry and auth failures cause one full-album refresh", async () => {
  let loads = 0;
  let album = {
    photos: [{ id: 1, preview_display_url: "old", local_preview_path: "wxfile://one" }]
  };
  const controller = createAlbumMediaRefreshController({
    readAlbum: () => album,
    writeAlbum: (next) => { album = next; },
    reloadAlbum: async () => {
      loads += 1;
      return { photos: [{ id: 1, preview_display_url: "new" }] };
    },
    setTimer: () => 1,
    clearTimer: () => {},
    now: () => Date.parse("2026-07-11T01:04:40.000Z")
  });
  await Promise.all([controller.refresh(), controller.refresh(), controller.refresh()]);
  assert.equal(loads, 1);
  assert.equal(album.photos[0].preview_display_url, "new");
  assert.equal(album.photos[0].local_preview_path, "wxfile://one");
});
```

Add tests for a timer scheduled 30 seconds early, `onShow` immediate refresh after suspended expiry, `dispose` clearing timers, public-share reload closure, one current-media auth retry, second failure surfacing, and filters/scroll/selection/preview index untouched because only URL fields merge.

- [x] **Step 2: Run URL lifecycle tests to verify RED**

Run: `node --test apps/miniprogram/test/albumMediaUrls.test.mjs`

Expected: FAIL because `albumMediaUrls.js` does not exist.

- [x] **Step 3: Implement URL selection and a single-flight controller**

Create `albumMediaUrls.js` using shared `createSingleFlight`, `mergeAlbumMediaUrls`, and `shouldRefreshAlbumMedia`:

```js
export function normalizeAlbumImageUrls(photo = {}) {
  return {
    thumbnailUrl: photo.thumbnail_display_url || photo.thumbnail_load_url || photo.thumbnail_url || photo.image_url || "",
    previewUrl: photo.preview_display_url || photo.preview_load_url || photo.preview_url || photo.image_url || "",
    downloadUrl: photo.download_url || photo.preview_display_url || photo.preview_load_url || photo.preview_url || photo.image_url || "",
    expiresAt: photo.media_url_expires_at || ""
  };
}

export function createAlbumMediaRefreshController({
  readAlbum,
  writeAlbum,
  reloadAlbum,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  now = Date.now
}) {
  const flight = createSingleFlight();
  let timer = null;
  const cancelTimer = () => {
    if (timer !== null) clearTimer(timer);
    timer = null;
  };
  const schedule = () => {
    cancelTimer();
    const expiries = (readAlbum()?.photos || [])
      .map((photo) => Date.parse(photo.media_url_expires_at || ""))
      .filter(Number.isFinite);
    if (expiries.length === 0) return;
    const delay = Math.max(0, Math.min(...expiries) - now() - 30_000);
    timer = setTimer(() => { void refresh(); }, delay);
  };
  const refresh = () => flight.run(async () => {
    const refreshed = await reloadAlbum();
    writeAlbum(mergeAlbumMediaUrls(readAlbum(), refreshed));
    schedule();
    return readAlbum();
  });
  const checkNow = () => {
    const expiredSoon = (readAlbum()?.photos || []).some((photo) =>
      shouldRefreshAlbumMedia(photo.media_url_expires_at, { nowMs: now() })
    );
    return expiredSoon ? refresh() : (schedule(), Promise.resolve(readAlbum()));
  };
  return { refresh, schedule, checkNow, dispose: cancelTimer };
}
```

- [x] **Step 4: Integrate upload phases and remove the new-client two-step create**

Replace the photo loop's `uploadSessionAlbumPhoto` then `createSessionAlbumPhoto` with `uploadAlbumPhoto`. Map phases exactly:

```js
const phaseLabels = {
  preparing: "准备上传",
  uploading: "上传中",
  validating: "校验中",
  complete: "完成"
};

const result = await uploadAlbumPhoto({
  sessionId: session.value.id,
  filePath: prepared.path,
  fileSize: prepared.size,
  contentType: prepared.contentType,
  onPhase: ({ phase, retry }) => {
    const retryText = phase === "uploading" && retry > 0 ? `（重试 ${retry}/2）` : "";
    albumStatus.value = `${phaseLabels[phase]}${retryText} ${index + 1}/${preparedFiles.length}`;
  }
});
if (!result?.photo?.id) {
  throw albumMediaError("UPLOAD_FINALIZE_RESPONSE_INVALID", "上传完成但缺少相册记录");
}
```

Import `albumMediaError` from `@pinche/shared`. Do not POST `{ photoUrl }` on the v2 path. Use the exact prepared file size/type already produced by photo preparation, then use the existing end-of-batch album reload to display finalized rows.

- [x] **Step 5: Integrate member/public batch refresh without resetting page state**

Instantiate the controller after mode/session/share-token resolution with `reloadAlbum` pointing to the same member or public-share loader. The reload closure fetches album data but does not reset filters, scroll position, selections, preview index, or local preview paths. On `onShow`, call `checkNow`; after every full load, call `schedule`; on `onUnload`, call `dispose`.

Replace per-photo private-only refresh with:

```js
async function retryCurrentMediaAfterAuthFailure(photo, failedUrl, loadCurrent) {
  const key = `${photo.id}:${failedUrl}`;
  if (mediaRefreshAttempts.has(key)) throw albumMediaError("MEDIA_URL_EXPIRED", "图片地址刷新后仍不可用");
  mediaRefreshAttempts.add(key);
  await albumMediaRefresh.refresh();
  const refreshed = findPhotoById(photo.id);
  return loadCurrent(normalizeAlbumImageUrls(refreshed));
}
```

Use it for member and public preview/download errors only when COS/API status is 401/403 or the normalized code is `MEDIA_URL_EXPIRED`, and only once per failed URL.

- [x] **Step 6: Preserve local preview files and prefer signed download URLs**

Keep valid `USER_DATA_PATH` files as the first preview source. URL refresh must not delete or redownload them. For save/download: use cached local preview first; otherwise use `download_url`, then the compatibility preview URL. Do not add Bearer authorization to COS URLs. Mark request/download failures with scoped errors and render `error.message` plus `[error.code]` when a code exists; never call `reLaunch` or global maintenance.

- [x] **Step 7: Run mini-program unit, static, and production build checks**

Run: `node --test apps/miniprogram/test/albumMediaUrls.test.mjs apps/miniprogram/test/albumPhotoUpload.test.mjs`

Expected: all upload and URL lifecycle tests pass.

Run: `node scripts/check-miniprogram.js && node scripts/check-maintenance-mode.js && node scripts/d31-album-viewer-sequence-check.js && npm run d42:mini`

Expected: signed fields are preferred, refresh is single-flight, viewer order/local cache remain intact, and video remains unchanged.

Run: `npm run build:mp-weixin`

Expected: UniApp production build exits 0 and emits `apps/miniprogram/dist/build/mp-weixin`.

- [x] **Step 8: Commit mini-program URL lifecycle**

```bash
git add apps/miniprogram/src/utils/albumMediaUrls.js apps/miniprogram/src/pages/session/album.vue apps/miniprogram/test/albumMediaUrls.test.mjs
git commit -m "feat: refresh mini program COS album URLs"
```

## Task 12: Admin-web v2 image upload without production fallback

执行状态：已完成（2026-07-11，6/6 管理端上传测试；D12、D32 与 D42 创建回归通过）。

**Files:**
- Modify: `apps/admin-web/package.json`
- Modify: `package-lock.json`
- Modify: `apps/admin-web/src/api.js:36-46,112-206,357-410`
- Modify: `apps/admin-web/src/albumMedia.js`
- Create: `apps/admin-web/test/albumMedia.test.mjs`

- [x] **Step 1: Write failing admin upload-adapter tests**

Add tests next to the existing authorization/serial helpers:

```js
import assert from "node:assert/strict";
import test from "node:test";
import { uploadAdminAlbumPhoto } from "../src/albumMedia.js";

test("admin v2 upload finalizes directly and never calls multipart", async () => {
  const calls = [];
  const result = await uploadAdminAlbumPhoto({
    sessionId: 8,
    file: new File([new Uint8Array(2048)], "photo.png", { type: "image/png" }),
    adminOwner: true,
    api: fakeAdminApi(calls, {
      uploadMode: "cos-direct-v2",
      direct: true,
      fallbackAllowed: false,
      uploadId: "upload-43"
    }),
    onPhase: (phase) => calls.push(["phase", phase.phase, phase.retry])
  });
  assert.equal(result.photo.id, 91);
  assert.equal(calls.some(([name]) => name === "multipart"), false);
});

test("admin local fallback requires both exact server fields", async () => {
  const calls = [];
  await uploadAdminAlbumPhoto({
    sessionId: 8,
    file: new File([new Uint8Array(10)], "photo.jpg", { type: "image/jpeg" }),
    adminOwner: true,
    api: fakeAdminApi(calls, {
      uploadMode: "api-local",
      direct: false,
      fallbackAllowed: true
    }),
    onPhase: () => {}
  });
  assert.equal(calls.filter(([name]) => name === "multipart").length, 1);
});
```

Add the same retry/conflict/signature/status/processing/error cases as the mini adapter. Add a source assertion that generic `uploadCosBackedFile` remains used by album video and its fallback is unchanged.

- [x] **Step 2: Run admin adapter tests to verify RED**

Run: `node --test apps/admin-web/test/albumMedia.test.mjs`

Expected: FAIL because `uploadAdminAlbumPhoto` does not exist.

- [x] **Step 3: Add the shared dependency and low-level v2 API**

Add to `apps/admin-web/package.json`:

```json
"@pinche/shared": "file:../../packages/shared"
```

Also add:

```json
"test:album-media": "node --test test/albumMedia.test.mjs"
```

Run: `npm install --package-lock-only`

Expected: the lockfile records the admin workspace link without unrelated upgrades.

In `api.js`, retain `parseResponse`'s `status`, `code`, `details`, and server message. Add low-level functions:

```js
export function requestAlbumPhotoUploadIntent(sessionId, file, options = {}) {
  return apiRequest("/api/uploads/cos-intent", {
    method: "POST",
    body: {
      kind: options.adminOwner ? "adminSessionAlbumPhoto" : "sessionAlbumPhoto",
      sessionId,
      extension: fileExtensionFromName(file.name),
      contentType: file.type,
      byteSize: file.size
    }
  }).then((data) => data.upload);
}

export function getAlbumPhotoUploadStatus(uploadId) {
  return apiRequest(`/api/uploads/${encodeURIComponent(uploadId)}/status`);
}

export function finalizeAlbumPhotoUpload(uploadId) {
  return apiRequest(`/api/uploads/${encodeURIComponent(uploadId)}/finalize`, {
    method: "POST",
    body: {}
  });
}
```

Store uploadId by exact key while `putObject` is active and include it in authorization. Pass `ContentLength: file.size`, `ContentType`, `PicOperations`, and `Headers: upload.headers`. If authorization fails, retain that error by key and reject the PUT with it instead of replacing it with an empty-signature error. Export `putAlbumPhotoToCos`; do not give it a fallback callback. Enforce a 300,000ms watchdog and abort the returned SDK task when supported. Map browser CORS/network failures to `COS_DOMAIN_NOT_ALLOWED` when the error identifies CORS, otherwise `COS_NETWORK_ERROR`; preserve COS XML code/message and report retry/failure telemetry without blocking the upload result.

Rename/export the current image multipart function as `uploadSessionAlbumPhotoLocal(sessionId, file, options)` and keep its resolved value as the photo URL string. Do not route album video through this export.

- [x] **Step 4: Implement the admin adapter using shared semantics**

Extend `albumMedia.js`:

```js
import { albumMediaError, executeAlbumCosUpload } from "@pinche/shared";

export async function uploadAdminAlbumPhoto({
  sessionId,
  file,
  adminOwner,
  api,
  execute = executeAlbumCosUpload,
  onPhase = () => {}
}) {
  if (!api) throw new TypeError("admin album photo API adapter is required");
  const upload = await api.requestAlbumPhotoUploadIntent(sessionId, file, { adminOwner });
  if (upload.uploadMode === "api-local" && upload.direct === false && upload.fallbackAllowed === true) {
    const photoUrl = await api.uploadSessionAlbumPhotoLocal(sessionId, file, { adminOwner });
    const photo = await api.createSessionAlbumPhoto(sessionId, photoUrl, { adminOwner });
    return { photo };
  }
  if (upload.uploadMode !== "cos-direct-v2" || upload.direct !== true || upload.fallbackAllowed !== false) {
    throw albumMediaError("DIRECT_UPLOAD_REQUIRED", "相册图片必须直传 COS");
  }
  return execute({
    putObject: () => api.putAlbumPhotoToCos(upload, file),
    getStatus: () => api.getAlbumPhotoUploadStatus(upload.uploadId),
    finalize: () => api.finalizeAlbumPhotoUpload(upload.uploadId),
    refreshAuthorization: () => api.clearAlbumPhotoAuthorization(upload.key),
    onPhase
  });
}
```

This required dependency avoids a circular import because `api.js` already imports `shouldAttachAdminAuthorization` from `albumMedia.js`. `SessionAlbumWorkspace.vue` passes an object containing the six low-level functions imported from `api.js`.

Keep existing `shouldAttachAdminAuthorization` behavior: same-origin API proxy requests receive Bearer; `*.myqcloud.com` signed reads do not.

- [x] **Step 5: Verify admin adapter and video fallback**

Run: `npm --workspace apps/admin-web run test:album-media`

Expected: all admin direct/local/retry/error tests pass.

Run: `node scripts/d12-admin-web-check.js && node scripts/d32-admin-album-video-check.js && npm run d42:api-creation`

Expected: new image assertions pass and the generic video upload/fallback behavior remains green.

- [x] **Step 6: Commit admin upload adapter**

```bash
git add apps/admin-web/package.json package-lock.json apps/admin-web/src/api.js apps/admin-web/src/albumMedia.js apps/admin-web/test/albumMedia.test.mjs
git commit -m "feat: upload admin album images directly to COS"
```

## Task 13: Admin signed URL lifecycle and blob-cache stability

**Files:**
- Modify: `apps/admin-web/src/albumMedia.js`
- Modify: `apps/admin-web/src/components/SessionAlbumWorkspace.vue:453-518,902-1263,1486-1501`
- Modify: `apps/admin-web/src/components/AuthorizedLazyImage.vue:1-113`
- Modify: `apps/admin-web/test/albumMedia.test.mjs`

- [ ] **Step 1: Add failing admin refresh and lazy-image cache tests**

Extend `albumMedia.test.mjs` with fixed timers and album state:

```js
test("admin refresh is single-flight and merges URLs without resetting controls", async () => {
  const state = {
    album: { photos: [{ id: 1, preview_display_url: "old", display_url: "blob:loaded" }] },
    activeFilter: "mine",
    selectedIds: [1],
    scrollTop: 420
  };
  let loads = 0;
  const controller = createAdminAlbumRefreshController({
    readAlbum: () => state.album,
    writeAlbum: (album) => { state.album = album; },
    reloadAlbum: async () => {
      loads += 1;
      return { photos: [{ id: 1, preview_display_url: "new" }] };
    },
    setTimer: () => 1,
    clearTimer: () => {},
    now: () => Date.parse("2026-07-11T01:04:40.000Z")
  });
  await Promise.all([controller.refresh(), controller.refresh()]);
  assert.equal(loads, 1);
  assert.equal(state.album.photos[0].display_url, "blob:loaded");
  assert.equal(state.activeFilter, "mine");
  assert.deepEqual(state.selectedIds, [1]);
  assert.equal(state.scrollTop, 420);
});
```

Export this predicate from `albumMedia.js` and import it into `AuthorizedLazyImage.vue`; assert a signed `src` change with the same media key and loaded blob returns false, a media-key change returns true, and a previous failure returns true:

```js
export function shouldReloadAuthorizedImage({ mediaKeyChanged, hasObjectUrl, failed }) {
  return mediaKeyChanged || !hasObjectUrl || failed;
}
```

- [ ] **Step 2: Run admin lifecycle tests to verify RED**

Run: `npm --workspace apps/admin-web run test:album-media`

Expected: FAIL on missing refresh controller and lazy-image predicate.

- [ ] **Step 3: Add the admin refresh controller and signed-field normalization**

Wrap shared helpers in `albumMedia.js`:

```js
export function normalizeAdminAlbumImage(photo = {}) {
  const preview = photo.preview_display_url || photo.preview_url || photo.image_url || "";
  return {
    ...photo,
    image_url: preview,
    preview_url: preview,
    thumbnail_url: photo.thumbnail_display_url || photo.thumbnail_url || preview,
    download_url: photo.download_url || preview,
    display_url: photo.display_url || ""
  };
}

export function createAdminAlbumRefreshController(options) {
  const flight = createSingleFlight();
  let timer = null;
  const clear = () => {
    if (timer !== null) options.clearTimer(timer);
    timer = null;
  };
  const schedule = () => {
    clear();
    const expiries = (options.readAlbum()?.photos || [])
      .map((photo) => Date.parse(photo.media_url_expires_at || ""))
      .filter(Number.isFinite);
    if (expiries.length === 0) return;
    timer = options.setTimer(() => { void refresh(); }, Math.max(0, Math.min(...expiries) - options.now() - 30_000));
  };
  const refresh = () => flight.run(async () => {
    const next = await options.reloadAlbum();
    options.writeAlbum(mergeAlbumMediaUrls(options.readAlbum(), next));
    schedule();
    return options.readAlbum();
  });
  const checkNow = () => {
    const expiring = (options.readAlbum()?.photos || []).some((photo) =>
      shouldRefreshAlbumMedia(photo.media_url_expires_at, { nowMs: options.now() })
    );
    return expiring ? refresh() : (schedule(), Promise.resolve(options.readAlbum()));
  };
  return { refresh, schedule, checkNow, dispose: clear };
}
```

- [ ] **Step 4: Integrate upload, expiry, visibility, and one current-media retry**

In `SessionAlbumWorkspace.vue`:

- replace the old upload-then-create pair with `uploadAdminAlbumPhoto` and phase text `准备上传`, `上传中（重试 n/2）`, `校验中`, `完成`;
- normalize signed fields first;
- create one refresh controller per selected session;
- schedule after album load;
- on `document.visibilitychange`, call `checkNow()` whenever the document becomes visible;
- dispose the controller and listener on session change/unmount;
- on a 401/403 signed-media failure, refresh the entire album once and retry that media once; the second failure shows the preserved code/message;
- keep `activeAlbumFilter`, role filter, selected IDs, preview/tagging drawer state, waterfall scroll, and already created blob URLs.

Use `fetchAuthorizedMediaObjectUrl` for both API and COS; its existing origin predicate ensures no API Bearer header is sent to COS.

Wrap cross-origin fetch failures: a COS 401/403 becomes `MEDIA_URL_EXPIRED` and enters the one-refresh path; a browser `TypeError`/CORS failure for the configured COS origin becomes `COS_DOMAIN_NOT_ALLOWED` and is shown without a refresh loop. Preserve `status`, `code`, and the response request ID when exposed by CORS.

- [ ] **Step 5: Keep loaded blobs across signature refreshes**

Add a `mediaKey` prop to `AuthorizedLazyImage.vue`, passed as `photo.id`. On `src` change with the same `mediaKey`, keep a valid `objectUrl`. If the prior fetch failed, clear failure and load the new source. On `mediaKey` change or unmount, revoke the blob. The watch logic is:

```js
watch(
  () => [props.mediaKey, props.src],
  ([nextKey, nextSource], [previousKey]) => {
    sourceSerial += 1;
    loading.value = false;
    if (nextKey !== previousKey) {
      revokeObjectUrl();
      failed.value = false;
      observeImage();
      return;
    }
    if (shouldReloadAuthorizedImage({
      mediaKeyChanged: false,
      hasObjectUrl: Boolean(objectUrl.value),
      failed: failed.value
    })) {
      failed.value = false;
      observeImage();
    }
  }
);
```

- [ ] **Step 6: Run admin tests and production build**

Run: `npm --workspace apps/admin-web run test:album-media && npm --workspace apps/admin-web run test:runtime-config`

Expected: upload, refresh, lazy-image, and runtime config tests pass.

Run: `node scripts/d12-admin-web-check.js && node scripts/d31-album-viewer-sequence-check.js && node scripts/d32-admin-album-video-check.js`

Expected: signed URL preference and state preservation pass; video behavior is unchanged.

Run: `npm run build:admin-web`

Expected: Vite production build exits 0.

- [ ] **Step 7: Commit admin URL lifecycle**

```bash
git add apps/admin-web/src/albumMedia.js apps/admin-web/src/components/SessionAlbumWorkspace.vue apps/admin-web/src/components/AuthorizedLazyImage.vue apps/admin-web/test/albumMedia.test.mjs
git commit -m "feat: refresh admin COS album URLs"
```

## Task 14: COS CORS, cleanup service, and real-bucket contract gate

**Files:**
- Create: `deploy/cos/cors.production.xml`
- Create: `deploy/cos/cors.development.xml`
- Create: `scripts/d43-cos-live-contract-check.js`
- Modify: `docker-compose.prod.example.yml`
- Modify: `package.json`

- [ ] **Step 1: Write a failing static operations contract**

Create assertions in `scripts/d43-album-media-cos-direct-check.js` for exact production origin, methods, headers, exposed diagnostics, compose worker, and opt-in live script:

```js
assert.match(productionCors, /<AllowedOrigin>https:\/\/admin\.pinche\.jubenmi\.com<\/AllowedOrigin>/);
for (const method of ["GET", "HEAD", "PUT"]) {
  assert.match(productionCors, new RegExp(`<AllowedMethod>${method}</AllowedMethod>`));
}
for (const header of [
  "authorization",
  "content-type",
  "content-length",
  "pic-operations",
  "x-cos-forbid-overwrite"
]) {
  assert.match(productionCors, new RegExp(`<AllowedHeader>${header}</AllowedHeader>`));
}
assert.doesNotMatch(productionCors, /<AllowedOrigin>\*<\/AllowedOrigin>/);
assert.match(compose, /album-image-cleanup:[\s\S]*job:album-image-cleanup/);
assert.match(liveContract, /D43_COS_CONTRACT/);
assert.match(liveContract, /forbidOverwrite:\s*true/);
assert.match(liveContract, /getCosImageInfo/);
```

- [ ] **Step 2: Run the static operations check to verify RED**

Run: `node scripts/d43-album-media-cos-direct-check.js --scope=operations`

Expected: FAIL because CORS files, worker service, and live contract do not exist.

- [ ] **Step 3: Add exact production and local-development CORS documents**

Create `deploy/cos/cors.production.xml`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<CORSConfiguration>
  <CORSRule>
    <ID>pinche-admin-album-media</ID>
    <AllowedOrigin>https://admin.pinche.jubenmi.com</AllowedOrigin>
    <AllowedMethod>GET</AllowedMethod>
    <AllowedMethod>HEAD</AllowedMethod>
    <AllowedMethod>PUT</AllowedMethod>
    <AllowedHeader>authorization</AllowedHeader>
    <AllowedHeader>content-type</AllowedHeader>
    <AllowedHeader>content-length</AllowedHeader>
    <AllowedHeader>pic-operations</AllowedHeader>
    <AllowedHeader>x-cos-forbid-overwrite</AllowedHeader>
    <AllowedHeader>x-cos-security-token</AllowedHeader>
    <ExposeHeader>ETag</ExposeHeader>
    <ExposeHeader>x-cos-hash-crc64ecma</ExposeHeader>
    <ExposeHeader>x-cos-request-id</ExposeHeader>
    <ExposeHeader>x-cos-trace-id</ExposeHeader>
    <MaxAgeSeconds>600</MaxAgeSeconds>
  </CORSRule>
</CORSConfiguration>
```

Create a separate development document with the same methods/headers and two explicit rules for `http://localhost:5173` and `http://127.0.0.1:5173`; do not use wildcard origins or metadata/ACL headers.

- [ ] **Step 4: Add the continuously running cleanup service**

Change the API and migrate services to `image: ${PINCHE_API_IMAGE:-hkccr.ccs.tencentyun.com/murder/pinche:latest}`, then add the worker with that same variable so an operator can pin all three to one digest:

```yaml
  album-image-cleanup:
    image: ${PINCHE_API_IMAGE:-hkccr.ccs.tencentyun.com/murder/pinche:latest}
    pull_policy: always
    env_file:
      - .env.production
    command: npm run job:album-image-cleanup
    networks:
      - internal
    depends_on:
      migrate:
        condition: service_completed_successfully
      mysql:
        condition: service_healthy
    restart: unless-stopped
```

The release runbook in Task 15 must pin API, migrate, and worker to the same publish artifact during a rollout; do not run a worker from a different schema version.

- [ ] **Step 5: Implement the opt-in destructive-safe live bucket contract**

The script exits successfully with `D43 COS live contract skipped` unless `D43_COS_CONTRACT=1`. When enabled, require `COS_SECRET_ID`, `COS_SECRET_KEY`, `COS_BUCKET`, and `COS_REGION`. Use a unique key under `contract-tests/album-image/`, an embedded 1×1 PNG, and `finally` deletion.

The enabled sequence is exact:

```js
const picOperations = JSON.stringify({
  is_pic_info: 1,
  rules: [{ bucket: config.bucket, fileid: `/${key}`, rule: ALBUM_IMAGE_DISPLAY_PROCESS }]
});
const first = await putCosObject({
  key,
  body: png,
  contentType: "image/png",
  contentLength: png.length,
  picOperations,
  forbidOverwrite: true,
  config
});
assert.ok(first.statusCode >= 200 && first.statusCode < 300);
await assert.rejects(
  putCosObject({
    key,
    body: png,
    contentType: "image/png",
    contentLength: png.length,
    picOperations,
    forbidOverwrite: true,
    config
  }),
  (error) => [409, 412].includes(Number(error.statusCode)) || error.code === "COS_PRECONDITION_FAILED"
);
const head = await headCosObject({ key, config });
const info = await getCosImageInfo({ key, etag: head.headers.etag, config });
assert.ok(["jpg", "jpeg"].includes(info.format));
```

Fetch and assert 2xx for signed thumbnail, preview, download, and ImageInfo URLs. Mutate, remove, and append a signed processing/response parameter and assert COS rejects each tampered URL. Always call `deleteCosObject` in `finally`; trusted 404 during cleanup is success.

Add root scripts:

```json
"d43:cos-contract": "node scripts/d43-cos-live-contract-check.js",
"d43:check": "node scripts/d43-album-media-cos-direct-check.js"
```

- [ ] **Step 6: Run static checks and the opt-in skip path**

Run: `node scripts/d43-album-media-cos-direct-check.js --scope=operations && npm run d43:cos-contract`

Expected: static checks pass; without the explicit flag, the live script prints `D43 COS live contract skipped` and exits 0.

Run during pre-production with approved test-bucket credentials: `D43_COS_CONTRACT=1 npm run d43:cos-contract`

Expected: one processed JPEG object passes HEAD/ImageInfo/four signed URL checks, the second PUT is rejected, tampered URLs fail, and final cleanup succeeds.

- [ ] **Step 7: Commit operations artifacts**

```bash
git add deploy/cos/cors.production.xml deploy/cos/cors.development.xml scripts/d43-cos-live-contract-check.js scripts/d43-album-media-cos-direct-check.js docker-compose.prod.example.yml package.json
git commit -m "ops: gate album image COS direct rollout"
```

## Task 15: Cross-app regression gate, smoke test, and release runbook

**Files:**
- Create: `scripts/d43-album-media-cos-direct-smoke.js`
- Modify: `scripts/d43-album-media-cos-direct-check.js`
- Modify: `scripts/d12-admin-web-check.js`
- Modify: `scripts/d17-cos-storage-check.js`
- Modify: `scripts/d18-session-album-privacy-check.js`
- Modify: `scripts/d18-session-album-privacy-smoke.js`
- Modify: `scripts/d31-album-viewer-sequence-check.js`
- Modify: `scripts/d42-album-video-delete-integration-check.js`
- Modify: `scripts/check-miniprogram.js`
- Modify: `scripts/check-maintenance-mode.js`
- Modify: `package.json`
- Create: `docs/runbooks/album-media-cos-direct-release.md`
- Modify: `README.md`
- Modify: `docs/image-processing-policy.md`
- Modify: `specs/d9-mvp-release/release-checklist.md`

- [ ] **Step 1: Add failing cross-app source contracts before relaxing old assertions**

The D43 check must import pure helpers where possible and use source assertions only for route/UI wiring. It locks:

```js
assert.match(server, /COS_DIRECT_UPLOAD_REQUIRED|directUploadRequired/);
assert.match(server, /\/api\/uploads\/\(\[0-9a-f-\]\{36\}\)\/status/);
assert.match(server, /\/api\/uploads\/\(\[0-9a-f-\]\{36\}\)\/finalize/);
assert.doesNotMatch(finalizeSource, /getCosObject\(/);
assert.match(miniAlbum, /thumbnail_display_url/);
assert.match(miniAlbum, /preview_display_url/);
assert.match(adminWorkspace, /uploadAdminAlbumPhoto/);
assert.match(adminWorkspace, /visibilitychange/);
assert.match(sharedProtocol, /putAttempts < 3/);
assert.match(sharedProtocol, /COS_UPLOAD_CONFLICT_UNRESOLVED/);
```

Add runtime checks for exactly three PUT attempts, a single auth refresh, one album refresh for many expiring items, legacy/local fallback fields, and no raw `object_key`/ETag response fields.

- [ ] **Step 2: Run the new D43 check to verify RED**

Run: `npm run d43:check`

Expected: FAIL on old assertions and any integration wiring not yet present.

- [ ] **Step 3: Narrow old gates instead of deleting non-goal protection**

Make these exact semantic changes:

- D17 continues to require fallback for avatar/review and generic upload helpers, but asserts `uploadAlbumPhoto` has only the explicit `api-local && fallbackAllowed` branch.
- D12 continues to require admin video fallback, but image upload must use `uploadAdminAlbumPhoto` and no catch-to-multipart path.
- D18 changes image deletion from database-first hard delete to `deleting + cleanup job`; privacy cases and old read routes remain required.
- D31 accepts batch URL replacement but retains viewer ordering, current index, selection, and local cache assertions.
- D42 continues to require the existing synchronous video deletion sequence and adds a negative assertion that video never calls `requestSessionAlbumImageDeletion`.
- `check-miniprogram` prefers new signed fields while continuing to accept compatibility fields and USER_DATA_PATH-only viewer sources.
- maintenance checks require suppression only for album upload/status/finalize/media refresh; ordinary network failures still enter current maintenance mode.

- [ ] **Step 4: Add an isolated API smoke for the lifecycle and privacy boundary**

`d43-album-media-cos-direct-smoke.js` must refuse non-isolated databases using the established smoke target guard. With a fake COS adapter or local HTTP COS stub, run:

1. create member intent;
2. reject cross-user authorization and extra headers;
3. authorize exact PUT and expose a processed JPEG through HEAD/ImageInfo;
4. status ready and finalize twice to one media ID;
5. list as member/admin/public and assert existing visibility filters;
6. revoke membership and assert duplicate finalize gives `ALBUM_UPLOAD_FORBIDDEN`;
7. create an unfinalized intent, move past deadlines, run cleanup, and assert cleaned;
8. request image deletion, fail one object delete, assert media/job remain; retry and assert hard delete;
9. create/play/delete one video and assert the D42 path remains unchanged.

Print one deterministic success line:

```js
console.log("D43 album media COS direct smoke passed: strict upload, idempotent finalize, signed reads, privacy, cleanup, and video isolation");
```

- [ ] **Step 5: Document configuration, domains, error triage, metrics, and rollback**

The runbook must include:

- production flags and required COS variables;
- exact production CORS file and verification from `https://admin.pinche.jubenmi.com`;
- WeChat legal-domain entries: API in `request`; `https://pinche-app-1251022382.cos.ap-nanjing.myqcloud.com` in request, uploadFile, and downloadFile; no trailing path or wildcard;
- dry-run then `--apply` backfill and its scanned/updated/missing/invalid interpretation;
- cleanup worker health and lease/retry queries;
- live contract command and pass criteria;
- structured event queries for upload success/retry/error, intent finalized/expired/cleaned, media URL refresh, COS 403/404/5xx/timeout, proxy route calls, and API image egress;
- independent read/upload switch enablement and rollback;
- explicit note that private Bucket, five-minute URLs, existing privacy filters, legacy routes, and unchanged video pipeline are mandatory.

Update image policy with source-versus-stored metadata and same-key Pic-Operations. Update the release checklist with CORS, WeChat domains, live contract, client versions, staged flags, and one full mini-program release-cycle observation before removing proxy routes.

- [ ] **Step 6: Add D43 and focused tests to root check**

Add scripts:

```json
"d43:unit": "npm --workspace packages/shared run test:album-media && npm --workspace apps/api run test:album-image && node --test apps/miniprogram/test/albumPhotoUpload.test.mjs apps/miniprogram/test/albumMediaUrls.test.mjs && npm --workspace apps/admin-web run test:album-media",
"d43:smoke": "node scripts/d43-album-media-cos-direct-smoke.js"
```

Insert `npm run d43:unit && npm run d43:check` into root `check`. Keep isolated smoke and live contract opt-in so normal CI cannot touch a real database or Bucket.

- [ ] **Step 7: Run focused, full, and build verification**

Run: `npm run d43:unit && npm run d43:check`

Expected: all D43 unit/static checks pass.

Run against the guarded disposable smoke database: `D43_SMOKE_DATABASE=pinche_d43_test npm run d43:smoke`

Expected: the exact D43 success line prints and the database guard confirms isolation.

Run: `npm run check`

Expected: full repository check exits 0, including D12/D17/D18/D31/D42 and maintenance protections.

Run: `npm run build:mp-weixin && npm run build:admin-web`

Expected: both production builds exit 0.

- [ ] **Step 8: Commit regression gates and documentation**

```bash
git add scripts/d43-album-media-cos-direct-smoke.js scripts/d43-album-media-cos-direct-check.js scripts/d12-admin-web-check.js scripts/d17-cos-storage-check.js scripts/d18-session-album-privacy-check.js scripts/d18-session-album-privacy-smoke.js scripts/d31-album-viewer-sequence-check.js scripts/d42-album-video-delete-integration-check.js scripts/check-miniprogram.js scripts/check-maintenance-mode.js package.json docs/runbooks/album-media-cos-direct-release.md README.md docs/image-processing-policy.md specs/d9-mvp-release/release-checklist.md
git commit -m "test: verify direct COS album media flow"
```

## Task 16: Staged production rollout and acceptance

**Files:**
- Verify: `docs/runbooks/album-media-cos-direct-release.md`
- Verify: `deploy/cos/cors.production.xml`
- Verify: `.env.production`
- Verify: deployed API/admin/mini-program artifacts and Tencent COS/WeChat configuration

- [ ] **Step 1: Deploy schema and code with both switches off**

Promote one verified publish artifact, export `PINCHE_API_IMAGE` as its registry digest for API/migrate/cleanup worker, and keep:

```dotenv
COS_DIRECT_MEDIA_URLS=false
COS_DIRECT_UPLOAD_REQUIRED=false
```

Run: `docker compose -f docker-compose.prod.yml run --rm migrate`

Expected: migration succeeds once; `/health/db` reports `schemaReady: true` and neither new table is missing.

- [ ] **Step 2: Apply CORS and WeChat domains before sending direct traffic**

Apply `deploy/cos/cors.production.xml` to the private Bucket. In the WeChat console, keep `https://api.pinche.jubenmi.com` under request and add the exact COS origin under request/uploadFile/downloadFile. Verify there are no semicolon typos, paths, wildcards, or HTTP origins.

Expected: admin preflight from the production origin allows GET/HEAD/PUT and exposes ETag diagnostics; the mini-program domain check accepts the COS host.

- [ ] **Step 3: Run dry-run backfill, apply it, and start cleanup worker**

Run: `docker compose -f docker-compose.prod.yml run --rm api npm run job:album-image-backfill`

Expected: report-only output shows counts and no database mutation.

Run with operator approval: `docker compose -f docker-compose.prod.yml run --rm api npm run job:album-image-backfill -- --apply`

Expected: only HEAD-confirmed objects receive object keys; missing/invalid rows remain legacy-compatible.

Run: `docker compose -f docker-compose.prod.yml up -d album-image-cleanup && docker compose -f docker-compose.prod.yml logs --tail=100 album-image-cleanup`

Expected: worker starts after migration, claims no premature rows, and emits no repeated lease failure.

- [ ] **Step 4: Pass the real private-Bucket contract**

Run from the deployed artifact with temporary contract permission: `D43_COS_CONTRACT=1 npm run d43:cos-contract`

Expected: same-key processed JPEG succeeds, second PUT is rejected, HEAD/ImageInfo/four signed URLs pass, tampering fails, and cleanup succeeds. Stop the rollout if any assertion fails.

- [ ] **Step 5: Release admin web and mini-program while read switch remains off**

Verify both clients against compatibility API fields and local fallback in a non-production COS-disabled environment. Submit/release the mini-program and confirm its uploaded version contains the v2 flow before requiring direct uploads.

Expected: existing users and old mini-program remain functional; new clients do not regress album filters, privacy, preview, download, or video.

- [ ] **Step 6: Enable direct read URLs first**

Set only:

```dotenv
COS_DIRECT_MEDIA_URLS=true
COS_DIRECT_UPLOAD_REQUIRED=false
```

Restart API, then verify member, public share, and admin network traces. Image body host must be COS; API only returns album JSON. Wait through at least two five-minute expiries and background/foreground transitions.

Expected: one batch refresh per album, no lost filter/scroll/selection/preview state, no Bearer header to COS, and old clients continue using proxy URLs.

- [ ] **Step 7: Enable required direct upload after read stability**

Set:

```dotenv
COS_DIRECT_MEDIA_URLS=true
COS_DIRECT_UPLOAD_REQUIRED=true
```

Restart API and test iOS/Android experience builds plus production admin: JPEG, PNG, retryable network interruption, response-lost conflict reconciliation, invalid format, oversize, permission revocation, and local COS-disabled development.

Expected: production network traces contain no album multipart image body to API; errors show stable COS/API codes and never enter global maintenance; API finalize performs only HEAD/ImageInfo/HEAD.

- [ ] **Step 8: Observe acceptance metrics and preserve rollback independence**

For at least one full mini-program release cycle, monitor direct upload success, retries/final errors, intent finalized/expired/cleaned, deletion retries, URL refreshes, COS 403/404/5xx/timeouts, old proxy calls, and API image egress.

Acceptance requires:

```text
new-client image bodies served by COS
new-client production image uploads never multipart to API
five-minute refresh works after foreground resume
existing privacy/share/member tests stay green
API image egress approaches zero as client adoption rises
cleanup has no permanently leased or anchorless rows
```

If reads fail, set only `COS_DIRECT_MEDIA_URLS=false`. If upload v2 fails before a safe fix, set only `COS_DIRECT_UPLOAD_REQUIRED=false`; new clients still refuse an implicit fallback unless the server explicitly returns `api-local`, while old clients receive the documented compatibility behavior. Keep legacy image routes until the observation window is formally closed.
