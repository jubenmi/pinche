import assert from "node:assert/strict";
import test from "node:test";

import { AppError } from "../src/http/errors.js";
import { createAlbumImageUploadService } from "../src/modules/album-image/upload-service.js";

const nowMs = Date.parse("2026-07-11T01:00:00.000Z");
const user = { user: { id: 3 }, roles: [] };
const objectKey = "uploads/session-album/display/album-8-3-1-a.jpg";

function harness() {
  const intent = {
    id: "00000000-0000-4000-8000-000000000043",
    user_id: 3,
    session_id: 8,
    kind: "sessionAlbumPhoto",
    object_key: objectKey,
    status: "pending",
    finalize_deadline_at: new Date(nowMs + 1_500_000),
    media_id: null,
    object_etag: null
  };
  const state = {
    allowed: true,
    validation: {
      validationState: "ready", objectPresent: true, etag: "etag-43",
      contentType: "image/jpeg", byteSize: 1234, width: 1600, height: 1200,
      canFinalize: true
    },
    insertedMedia: [],
    events: [],
    timeline: [],
    getObjectCalls: 0,
    validationCalls: 0,
    intakeOpen: true,
    beforeTransaction: null,
    mediaMissing: false
    ,moderationCreated: 0
    ,moderationSubmitted: 0
  };
  let transactionTail = Promise.resolve();
  const transaction = (run) => {
    const next = transactionTail.then(async () => {
      state.beforeTransaction?.(intent);
      state.timeline.push("transaction_begin");
      const result = await run({
        async query(sql, values) {
          assert.match(String(sql), /UPDATE session_album_upload_intents/);
          if (!["pending", "processing"].includes(intent.status)) return [{ affectedRows: 0 }];
          intent.status = "finalized";
          intent.media_id = Number(values[0]);
          intent.object_etag = String(values[5]);
          return [{ affectedRows: 1 }];
        }
      });
      state.timeline.push("transaction_commit");
      return result;
    });
    transactionTail = next.catch(() => {});
    return next;
  };
  const repository = {
    find: async () => intent,
    findByObjectKey: async (_connection, input) =>
      input.userId === 3 && input.objectKey === objectKey ? intent : null,
    markState: async (_connection, input) => {
      if (input.fromStatuses.includes(intent.status)) {
        intent.status = input.toStatus;
        intent.last_error_code = input.errorCode || null;
        return true;
      }
      return false;
    }
  };
  const photoRow = {
    id: 91, session_id: 8, uploader_user_id: 3, media_type: "image", status: "active",
    moderation_status: "pending",
    object_key: objectKey, object_etag: "etag-43", image_width: 1600,
    image_height: 1200, image_byte_size: 1234, image_content_type: "image/jpeg"
  };
  const service = createAlbumImageUploadService({
    now: () => nowMs,
    withDatabaseConnection: async (run) => run({}),
    transaction,
    assertImageIntake: () => {
      if (!state.intakeOpen) {
        throw new AppError(503, "CONTENT_MODERATION_INTAKE_CLOSED", "closed");
      }
    },
    access: async () => {
      if (!state.allowed) throw new AppError(403, "FORBIDDEN", "revoked");
      return { id: 8 };
    },
    repository,
    validateStoredImage: async () => {
      state.validationCalls += 1;
      return state.validation;
    },
    insertFinalizedImage: async () => {
      state.insertedMedia.push(photoRow);
      return photoRow;
    },
    getFinalizedImage: async () => {
      if (state.mediaMissing) throw new AppError(404, "NOT_FOUND", "missing");
      return photoRow;
    },
    serializeImage: (photo) => ({ ...photo }),
    createWechatImageModerationJob: async (_connection, input) => {
      state.moderationCreated += 1;
      state.timeline.push("create_moderation_job");
      assert.equal(input.media.id, 91);
      assert.equal(input.subjectVersion, "etag-43");
      return { id: 51, status: "pending" };
    },
    submitWechatImageModeration: async (job) => {
      state.moderationSubmitted += 1;
      state.timeline.push("submit_moderation");
      assert.equal(job.id, 51);
      if (state.moderationSubmitError) throw state.moderationSubmitError;
    },
    emit: (event, fields) => state.events.push({ event, fields }),
    cosConfig: { enabled: true, secretId: "id", secretKey: "secret", bucket: "b", region: "r" }
  });
  return { service, state, intent, repository };
}

test("a closed intake rejects image finalize before storage inspection or media insertion", async () => {
  const { service, state, intent } = harness();
  state.intakeOpen = false;

  await assert.rejects(service.finalize({ user, uploadId: intent.id }), {
    code: "CONTENT_MODERATION_INTAKE_CLOSED",
    statusCode: 503
  });
  assert.equal(state.validationCalls, 0);
  assert.equal(state.insertedMedia.length, 0);
});

test("status reports ready without creating media", async () => {
  const { service, state } = harness();
  const result = await service.status({ user, uploadId: "00000000-0000-4000-8000-000000000043" });
  assert.deepEqual(result, {
    uploadId: "00000000-0000-4000-8000-000000000043",
    status: "pending",
    validationState: "ready",
    objectPresent: true,
    etag: "etag-43",
    canFinalize: true,
    finalizeDeadlineAt: "2026-07-11T01:25:00.000Z"
  });
  assert.equal(state.insertedMedia.length, 0);
});

test("finalize is idempotent under two callers and creates one media row", async () => {
  const { service, state } = harness();
  const [first, second] = await Promise.all([
    service.finalize({ user, uploadId: "00000000-0000-4000-8000-000000000043" }),
    service.finalize({ user, uploadId: "00000000-0000-4000-8000-000000000043" })
  ]);
  assert.equal(first.photo.id, 91);
  assert.equal(second.photo.id, 91);
  assert.equal(state.insertedMedia.length, 1);
  assert.equal(first.photo.moderation_status, "pending");
  assert.equal(state.moderationCreated, 1);
  assert.equal(state.moderationSubmitted, 1);
});

test("finalize creates the WeChat task inside its transaction and submits after commit", async () => {
  const { service, state } = harness();
  await service.finalize({ user, uploadId: "00000000-0000-4000-8000-000000000043" });

  assert.deepEqual(state.timeline, [
    "transaction_begin",
    "create_moderation_job",
    "transaction_commit",
    "submit_moderation"
  ]);
});

test("moderation submission failure keeps the finalized image hidden", async () => {
  const { service, state } = harness();
  state.moderationSubmitError = new Error("network");
  const result = await service.finalize({ user, uploadId: "00000000-0000-4000-8000-000000000043" });
  assert.equal(result.photo.moderation_status, "pending");
  assert.equal(state.insertedMedia.length, 1);
});

test("revoked access blocks first and duplicate finalize without leaking photo", async () => {
  const { service, state, intent } = harness();
  for (const status of ["pending", "finalized"]) {
    intent.status = status;
    intent.media_id = status === "finalized" ? 91 : null;
    state.allowed = false;
    await assert.rejects(
      service.finalize({ user, uploadId: intent.id }),
      (error) => error.code === "ALBUM_UPLOAD_FORBIDDEN" && !error.details?.photo
    );
  }
});

test("processing status never creates media or fetches object body", async () => {
  const { service, state, intent } = harness();
  state.validation = { validationState: "processing", objectPresent: true, etag: "e", canFinalize: false };
  assert.equal((await service.status({ user, uploadId: intent.id })).status, "processing");
  await assert.rejects(service.finalize({ user, uploadId: intent.id }), {
    code: "MEDIA_PROCESSING_PENDING"
  });
  assert.equal(state.getObjectCalls, 0);
  assert.equal(state.insertedMedia.length, 0);
});

test("invalid output rejects and deadline expiry expires", async () => {
  const invalid = harness();
  invalid.state.validation = {
    validationState: "invalid", objectPresent: true, etag: "e", canFinalize: false,
    errorCode: "COS_IMAGE_PROCESSING_INVALID"
  };
  await assert.rejects(invalid.service.finalize({ user, uploadId: invalid.intent.id }), {
    code: "COS_IMAGE_PROCESSING_INVALID"
  });
  assert.equal(invalid.intent.status, "rejected");

  const expired = harness();
  expired.intent.finalize_deadline_at = new Date(nowMs - 1);
  await assert.rejects(expired.service.status({ user, uploadId: expired.intent.id }), {
    code: "UPLOAD_INTENT_EXPIRED"
  });
  assert.equal(expired.intent.status, "expired");
});

test("legacy photoUrl finalizes only exact persisted user, session, and kind", async () => {
  const { service } = harness();
  assert.equal((await service.finalizeLegacy({
    user, sessionId: 8, kind: "sessionAlbumPhoto", photoUrl: `/${objectKey}`
  })).photo.id, 91);
  for (const change of [
    { sessionId: 9, kind: "sessionAlbumPhoto", photoUrl: `/${objectKey}` },
    { sessionId: 8, kind: "adminSessionAlbumPhoto", photoUrl: `/${objectKey}` },
    { sessionId: 8, kind: "sessionAlbumPhoto", photoUrl: `https://host/${objectKey}` }
  ]) {
    const fresh = harness();
    await assert.rejects(fresh.service.finalizeLegacy({ user, ...change }), {
      code: "UPLOAD_INTENT_NOT_FOUND"
    });
  }
});

test("ownership, cleanup state, object-key race, and deleted finalized media fail closed", async () => {
  const other = harness();
  other.intent.user_id = 4;
  await assert.rejects(other.service.status({ user, uploadId: other.intent.id }), {
    code: "UPLOAD_INTENT_NOT_FOUND"
  });

  const cleanup = harness();
  cleanup.intent.status = "cleanup_pending";
  await assert.rejects(cleanup.service.finalize({ user, uploadId: cleanup.intent.id }), {
    code: "UPLOAD_INTENT_NOT_FINALIZABLE"
  });

  const changed = harness();
  changed.state.beforeTransaction = (intent) => { intent.object_key = `${objectKey}.changed`; };
  await assert.rejects(changed.service.finalize({ user, uploadId: changed.intent.id }), {
    code: "UPLOAD_INTENT_NOT_FINALIZABLE"
  });
  assert.equal(changed.state.insertedMedia.length, 0);

  const deleted = harness();
  deleted.intent.status = "finalized";
  deleted.intent.media_id = 91;
  deleted.state.mediaMissing = true;
  await assert.rejects(deleted.service.finalize({ user, uploadId: deleted.intent.id }), {
    code: "FINALIZED_MEDIA_MISSING"
  });
});
