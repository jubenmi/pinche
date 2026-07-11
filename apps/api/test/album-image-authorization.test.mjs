import assert from "node:assert/strict";
import test from "node:test";

import { createAlbumImageUploadService } from "../src/modules/album-image/upload-service.js";
import { ALBUM_IMAGE_DISPLAY_PROCESS } from "../src/modules/album-image/constants.js";

const nowMs = Date.parse("2026-07-11T01:00:00.000Z");
const user = { user: { id: 9 }, roles: [] };
const key = "uploads/session-album/display/album-8-9-1-0123456789abcdef.jpg";
const picOperations = JSON.stringify({ is_pic_info: 1, rules: [{
  bucket: "bucket", fileid: `/${key}`, rule: ALBUM_IMAGE_DISPLAY_PROCESS
}] });

function validAuthorizationBody() {
  return {
    uploadId: "upload-1", bucket: "bucket", region: "region", method: "PUT", key,
    query: {}, headers: {
      host: "bucket.cos.region.myqcloud.com",
      "content-type": "image/png",
      "content-length": "2048",
      "pic-operations": picOperations,
      "x-cos-forbid-overwrite": "true"
    }
  };
}

function buildService({ legacy = false, expiresAt = nowMs + 600_000 } = {}) {
  const state = { boundByteSize: null, recorded: null, findByKeyCalls: 0 };
  const intent = {
    id: "upload-1", user_id: 9, session_id: 8, kind: "sessionAlbumPhoto", object_key: key,
    source_content_type: "image/png", source_byte_size: legacy ? null : 2048,
    status: "pending", upload_expires_at: new Date(expiresAt),
    finalize_deadline_at: new Date(nowMs + 1_500_000)
  };
  const service = createAlbumImageUploadService({
    now: () => nowMs,
    cosConfig: { enabled: true, secretId: "id", secretKey: "secret", bucket: "bucket", region: "region" },
    directUploadRequired: false,
    transaction: async (run) => run({}),
    access: async () => ({ id: 8 }),
    repository: {
      find: async (_c, uploadId) => uploadId === "upload-1" ? intent : null,
      findByObjectKey: async (_c, input) => {
        state.findByKeyCalls += 1;
        return input.userId === 9 && input.objectKey === key ? intent : null;
      },
      bindByteSize: async (_c, input) => { state.boundByteSize = input.byteSize; intent.source_byte_size = input.byteSize; return true; },
      recordAuthorization: async (_c, input) => { state.recorded = input; return true; }
    },
    signer: ({ expiresInSeconds }) => `q-sign-algorithm=sha1&ttl=${expiresInSeconds}`,
    emit: () => {}
  });
  return { service, state, intent };
}

test("strict authorization accepts only the persisted exact request", async () => {
  const { service, state } = buildService();
  const result = await service.authorize({ user, body: validAuthorizationBody() });
  assert.match(result.authorization, /^q-sign-algorithm=sha1&ttl=300$/);
  assert.equal(Date.parse(result.expiresAt) - nowMs, 300_000);
  assert.equal(state.recorded.uploadId, "upload-1");
});

test("strict authorization rejects query, missing header, extra ACL, wrong size, and wrong key", async () => {
  for (const mutate of [
    (body) => { body.query = { imageInfo: "" }; },
    (body) => { delete body.headers["pic-operations"]; },
    (body) => { body.headers["x-cos-acl"] = "public-read"; },
    (body) => { body.headers["content-length"] = "2049"; },
    (body) => { body.key = `${body.key}.changed`; },
    (body) => { body.headers.host = "evil.example"; },
    (body) => { body.method = "POST"; }
  ]) {
    const { service } = buildService();
    const body = validAuthorizationBody();
    mutate(body);
    await assert.rejects(service.authorize({ user, body }), (error) => error.statusCode === 403);
  }
});

test("legacy authorization finds exact owned key and atomically binds length", async () => {
  const { service, state } = buildService({ legacy: true });
  const body = validAuthorizationBody();
  delete body.uploadId;
  const result = await service.authorize({ user, body });
  assert.match(result.authorization, /^q-sign-algorithm=sha1/);
  assert.equal(state.findByKeyCalls, 1);
  assert.equal(state.boundByteSize, 2048);
});

test("authorization enforces owner, pending status, and expiry cap", async () => {
  const capped = buildService({ expiresAt: nowMs + 120_000 });
  assert.match((await capped.service.authorize({ user, body: validAuthorizationBody() })).authorization, /ttl=120/);
  for (const mutate of [
    (intent) => { intent.user_id = 10; },
    (intent) => { intent.status = "finalized"; },
    (intent) => { intent.upload_expires_at = new Date(nowMs); }
  ]) {
    const fixture = buildService();
    mutate(fixture.intent);
    await assert.rejects(
      fixture.service.authorize({ user, body: validAuthorizationBody() }),
      (error) => error.statusCode === 403
    );
  }
});
