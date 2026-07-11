import assert from "node:assert/strict";

import { cleanupAlbumVideoBeforeDelete } from "../apps/api/src/modules/album-video/lifecycle.js";
import { runAlbumImageCleanupBatch } from "../apps/api/src/modules/album-image/cleanup.js";
import { ALBUM_IMAGE_DISPLAY_PROCESS } from "../apps/api/src/modules/album-image/constants.js";
import { createAlbumImageUploadService } from "../apps/api/src/modules/album-image/upload-service.js";
import { validateStoredAlbumImage } from "../apps/api/src/modules/album-image/validator.js";
import { AppError } from "../apps/api/src/http/errors.js";
import { attachSessionAlbumMediaUrls } from "../apps/api/src/server.js";

const smokeDatabase = String(process.env.D43_SMOKE_DATABASE || "");
if (smokeDatabase !== "pinche_d43_test") {
  throw new Error("D43 smoke refuses to run without D43_SMOKE_DATABASE=pinche_d43_test");
}
if (process.env.MYSQL_DATABASE && process.env.MYSQL_DATABASE !== smokeDatabase) {
  throw new Error("D43 smoke database guard does not match MYSQL_DATABASE");
}

const nowMs = Date.parse("2026-07-11T01:00:00.000Z");
const owner = { user: { id: 3 }, roles: [] };
const other = { user: { id: 4 }, roles: [] };
let accessAllowed = true;
let intent = null;
let media = null;
let nextMediaId = 91;

const repository = {
  insert: async (_connection, input) => {
    intent = {
      id: input.id,
      user_id: input.userId,
      session_id: input.sessionId,
      kind: input.kind,
      object_key: input.objectKey,
      source_content_type: input.sourceContentType,
      source_byte_size: input.sourceByteSize,
      max_source_byte_size: input.maxSourceByteSize,
      status: "pending",
      upload_expires_at: input.uploadExpiresAt,
      finalize_deadline_at: input.finalizeDeadlineAt,
      cleanup_not_before: input.cleanupNotBefore,
      media_id: null,
      object_etag: null
    };
    return intent;
  },
  find: async () => intent,
  findByObjectKey: async (_connection, input) =>
    intent && input.userId === intent.user_id && input.objectKey === intent.object_key ? intent : null,
  bindByteSize: async () => true,
  recordAuthorization: async () => true,
  markState: async (_connection, input) => {
    if (input.fromStatuses.includes(intent.status)) {
      intent.status = input.toStatus;
      return true;
    }
    return false;
  }
};
const connection = {
  async query(sql, values) {
    if (/UPDATE session_album_upload_intents/.test(String(sql))) {
      intent.status = "finalized";
      intent.media_id = Number(values[0]);
      intent.object_etag = values[5];
      return [{ affectedRows: 1 }];
    }
    throw new Error(`unexpected smoke SQL: ${sql}`);
  }
};
const withConnection = async (run) => run(connection);
const access = async (_connection, user) => {
  if (!accessAllowed || Number(user.user.id) !== 3) {
    throw new AppError(403, "FORBIDDEN", "revoked");
  }
  return { id: 8 };
};
const validator = async (row) => validateStoredAlbumImage({
  intent: row,
  storage: {
    head: async () => ({ etag: '"etag-43"', byteSize: 631, contentType: "image/jpeg" }),
    imageInfo: async () => ({ format: "jpg", width: 1, height: 1, byteSize: 631 })
  }
});
const service = createAlbumImageUploadService({
  now: () => nowMs,
  randomUUID: () => "00000000-0000-4000-8000-000000000043",
  randomHex: () => "0123456789abcdef",
  cosConfig: { enabled: true, secretId: "id", secretKey: "secret", bucket: "bucket", region: "region" },
  directUploadRequired: true,
  transaction: withConnection,
  withDatabaseConnection: withConnection,
  access,
  repository,
  signer: () => "q-sign-algorithm=sha1&smoke=1",
  validateStoredImage: validator,
  insertFinalizedImage: async (_connection, { intent: row, metadata }) => {
    media = {
      id: nextMediaId++, session_id: row.session_id, uploader_user_id: row.user_id,
      media_type: "image", status: "active", object_key: row.object_key,
      object_etag: metadata.etag, image_width: metadata.width, image_height: metadata.height,
      image_byte_size: metadata.byteSize, image_content_type: metadata.contentType
    };
    return media;
  },
  getFinalizedImage: async () => media,
  serializeImage: (row) => ({ ...row }),
  emit: () => {}
});

const upload = await service.createIntent({
  user: owner,
  body: {
    kind: "sessionAlbumPhoto",
    sessionId: 8,
    extension: ".png",
    contentType: "image/png",
    byteSize: 68
  }
});
const headers = {
  host: "bucket.cos.region.myqcloud.com",
  "content-length": "68",
  "content-type": "image/png",
  "pic-operations": JSON.stringify({
    is_pic_info: 1,
    rules: [{ bucket: "bucket", fileid: `/${upload.key}`, rule: ALBUM_IMAGE_DISPLAY_PROCESS }]
  }),
  "x-cos-forbid-overwrite": "true"
};
const authorizationBody = {
  uploadId: upload.uploadId,
  bucket: "bucket",
  region: "region",
  method: "PUT",
  key: upload.key,
  query: {},
  headers
};
await assert.rejects(service.authorize({ user: other, body: authorizationBody }), {
  code: "ALBUM_UPLOAD_FORBIDDEN"
});
await assert.rejects(service.authorize({
  user: owner,
  body: { ...authorizationBody, headers: { ...headers, "x-cos-acl": "public-read" } }
}), { code: "ALBUM_UPLOAD_FORBIDDEN" });
assert.match((await service.authorize({ user: owner, body: authorizationBody })).authorization, /^q-sign-algorithm/);
assert.equal((await service.status({ user: owner, uploadId: upload.uploadId })).validationState, "ready");
const firstFinalize = await service.finalize({ user: owner, uploadId: upload.uploadId });
const duplicateFinalize = await service.finalize({ user: owner, uploadId: upload.uploadId });
assert.equal(firstFinalize.photo.id, duplicateFinalize.photo.id);

let signerCalls = 0;
const visibleAlbum = attachSessionAlbumMediaUrls({
  session_id: 8,
  photos: [{ ...firstFinalize.photo, storage_object_key: upload.key }]
}, 3, {
  directMediaUrls: true,
  nowSeconds: 1000,
  cosConfig: { enabled: true, secretId: "id", secretKey: "secret", bucket: "bucket", region: "region" },
  buildUrls: ({ mediaId }) => {
    signerCalls += 1;
    return {
      thumbnail_display_url: `signed-thumb-${mediaId}`,
      preview_display_url: `signed-preview-${mediaId}`,
      download_url: `signed-download-${mediaId}`,
      media_url_expires_at: "1970-01-01T00:21:40.000Z"
    };
  },
  emit: () => {}
});
assert.equal(signerCalls, 1);
assert.equal("storage_object_key" in visibleAlbum.photos[0], false);
accessAllowed = false;
await assert.rejects(service.finalize({ user: owner, uploadId: upload.uploadId }), {
  code: "ALBUM_UPLOAD_FORBIDDEN"
});

const cleanupState = { cleaned: false };
await runAlbumImageCleanupBatch({
  repository: {
    expireOverdueAlbumImageIntents: async () => {},
    claimAllCleanup: async () => [{ type: "intent", row: { id: "orphan", object_key: "orphan.jpg" } }],
    completeIntentCleanup: async () => { cleanupState.cleaned = true; },
    failIntentCleanup: async () => assert.fail("orphan cleanup should not fail")
  },
  storage: {
    head: async () => { throw Object.assign(new Error("missing"), { code: "COS_OBJECT_NOT_FOUND" }); },
    delete: async () => assert.fail("missing object should not be deleted")
  },
  withTransaction: async (run) => run({}),
  randomUUID: () => "lease",
  emit: () => {}
});
assert.equal(cleanupState.cleaned, true);

const deletionState = { mediaPresent: true, jobPresent: true, attempts: 0 };
const deletionRepository = {
  expireOverdueAlbumImageIntents: async () => {},
  claimAllCleanup: async () => deletionState.jobPresent
    ? [{
        type: "media",
        row: {
          id: 7,
          media_id: 91,
          session_id: 8,
          storage_kind: "cos",
          object_key: "delete.jpg",
          attempts: deletionState.attempts
        }
      }]
    : [],
  failMediaCleanup: async () => { deletionState.attempts += 1; },
  completeMediaCleanup: async () => {
    deletionState.mediaPresent = false;
    deletionState.jobPresent = false;
  }
};
await runAlbumImageCleanupBatch({
  repository: deletionRepository,
  storage: {
    delete: async () => { throw Object.assign(new Error("upstream"), { code: "COS_UPSTREAM_ERROR" }); }
  },
  withTransaction: async (run) => run({}),
  randomUUID: () => "lease-one",
  emit: () => {}
});
assert.equal(deletionState.mediaPresent, true);
assert.equal(deletionState.jobPresent, true);
assert.equal(deletionState.attempts, 1);
await runAlbumImageCleanupBatch({
  repository: deletionRepository,
  storage: { delete: async () => {} },
  withTransaction: async (run) => run({}),
  randomUUID: () => "lease-two",
  emit: () => {}
});
assert.equal(deletionState.mediaPresent, false);
assert.equal(deletionState.jobPresent, false);

let videoDeletes = 0;
const videoResult = await cleanupAlbumVideoBeforeDelete({
  urls: ["video-source", "video-cover"],
  deleteObject: async () => { videoDeletes += 1; },
  finalizeSnapshot: async () => ({ id: 501, deleted: true })
});
assert.equal(videoResult.deleted, true);
assert.equal(videoDeletes, 2);

console.log("D43 album media COS direct smoke passed: strict upload, idempotent finalize, signed reads, privacy, cleanup, and video isolation");
