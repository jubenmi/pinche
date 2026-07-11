import assert from "node:assert/strict";
import test from "node:test";

import { createAlbumImageUploadService } from "../src/modules/album-image/upload-service.js";
import { emitAlbumImageEvent } from "../src/modules/album-image/telemetry.js";

const nowMs = Date.parse("2026-07-11T01:00:00.000Z");
const user = { user: { id: 9 }, roles: [] };

function buildService({ cosEnabled = true, directUploadRequired = false } = {}) {
  const state = { inserted: null, events: [] };
  const service = createAlbumImageUploadService({
    now: () => nowMs,
    randomUUID: () => "00000000-0000-4000-8000-000000000043",
    randomHex: () => "0123456789abcdef",
    cosConfig: {
      enabled: cosEnabled,
      secretId: cosEnabled ? "id" : "",
      secretKey: cosEnabled ? "secret" : "",
      bucket: cosEnabled ? "bucket" : "",
      region: cosEnabled ? "region" : ""
    },
    directUploadRequired,
    transaction: async (run) => run({}),
    access: async (_connection, _user, input) => ({ id: Number(input.sessionId) }),
    repository: {
      insert: async (_connection, intent) => {
        state.inserted = intent;
        return intent;
      }
    },
    emit: (event, fields) => state.events.push({ event, fields })
  });
  return { service, state };
}

test("v2 intent fixes key, timing, source facts, processing, and no fallback", async () => {
  const { service, state } = buildService();
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
  assert.equal(upload.contentLength, 2048);
  assert.equal(upload.headers["x-cos-forbid-overwrite"], "true");
  assert.equal(JSON.parse(upload.picOperations).rules[0].fileid, `/${upload.key}`);
  assert.equal(Date.parse(upload.uploadExpiresAt) - nowMs, 600_000);
  assert.equal(Date.parse(upload.finalizeDeadlineAt) - nowMs, 1_500_000);
  assert.equal(state.inserted.sourceContentType, "image/png");
  assert.equal(state.inserted.sourceByteSize, 2048);
  assert.equal(state.events[0].event, "intent_created");
});

test("admin intent uses the admin key prefix", async () => {
  const { service } = buildService();
  const upload = await service.createIntent({ user: { ...user, roles: ["system_admin"] }, body: {
    kind: "adminSessionAlbumPhoto", sessionId: 8, extension: ".jpg",
    contentType: "image/jpeg", byteSize: 1
  } });
  assert.match(upload.key, /\/admin-album-8-9-/);
});

test("local mode is explicit and required mode fails closed", async () => {
  const local = buildService({ cosEnabled: false }).service;
  assert.deepEqual(await local.createIntent({ user, body: {
    kind: "sessionAlbumPhoto", sessionId: 8, extension: ".jpg",
    contentType: "image/jpeg", byteSize: 1
  } }), { uploadMode: "api-local", direct: false, fallbackAllowed: true, maxBytes: 4 * 1024 * 1024 });
  const required = buildService({ cosEnabled: false, directUploadRequired: true }).service;
  await assert.rejects(
    required.createIntent({ user, body: {
      kind: "sessionAlbumPhoto", sessionId: 8, extension: ".jpg",
      contentType: "image/jpeg", byteSize: 1
    } }),
    (error) => error.code === "COS_CONFIGURATION_ERROR"
  );
});

test("intent validates exact JPEG/PNG source facts and 4MB limit", async () => {
  const { service } = buildService();
  for (const [body, code] of [
    [{ extension: ".gif", contentType: "image/gif", byteSize: 1 }, "UNSUPPORTED_IMAGE_TYPE"],
    [{ extension: ".png", contentType: "image/jpeg", byteSize: 1 }, "UNSUPPORTED_IMAGE_TYPE"],
    [{ extension: ".jpg", contentType: "image/jpeg", byteSize: 4 * 1024 * 1024 + 1 }, "FILE_TOO_LARGE"],
    [{ extension: ".jpg", contentType: "image/jpeg", byteSize: 0 }, "BAD_REQUEST"]
  ]) {
    await assert.rejects(service.createIntent({ user, body: {
      kind: "sessionAlbumPhoto", sessionId: 8, ...body
    } }), (error) => error.code === code);
  }
});

test("telemetry keeps stable metrics and drops secrets and object identifiers", () => {
  let line = "";
  emitAlbumImageEvent("upload_failure", {
    sessionId: 8,
    retryCount: 2,
    errorCode: "COS_NETWORK_ERROR",
    objectKey: "private/key.jpg",
    signedUrl: "https://secret",
    etag: "secret-etag",
    openId: "secret-open-id"
  }, (value) => { line = value; });
  const event = JSON.parse(line);
  assert.equal(event.type, "album_image");
  assert.equal(event.sessionId, 8);
  assert.equal(event.retryCount, 2);
  assert.equal(line.includes("private/key.jpg"), false);
  assert.equal(line.includes("secret"), false);
});
