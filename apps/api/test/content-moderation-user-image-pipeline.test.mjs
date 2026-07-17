import assert from "node:assert/strict";
import test from "node:test";

import { serializeAdminModerationDetail } from "../src/modules/content-moderation/admin-api.js";
import { MODERATION_RETRY_ROUTES } from "../src/modules/content-moderation/constants.js";
import {
  findModerationMedia,
  rehydrateModerationRetryJob,
  transitionMediaModeration
} from "../src/modules/content-moderation/repository.js";
import { createContentModerationService } from "../src/modules/content-moderation/service.js";
import { dispatchWechatImageModerationEvent } from "../src/modules/content-moderation/wechat-callback.js";

test("avatar and review images are explicit WeChat retry routes", () => {
  const keys = new Set(MODERATION_RETRY_ROUTES.map((route) => `${route.provider}:${route.subjectType}`));
  assert.equal(keys.has("wechat_sec_check:avatar_image"), true);
  assert.equal(keys.has("wechat_sec_check:review_image"), true);
});

test("shared D45 image job creation persists the requested user-image subject type", async () => {
  const created = [];
  const service = createContentModerationService({
    config: {},
    client: {},
    transaction: async (run) => run({}),
    withDatabaseConnection: async (run) => run({}),
    randomUUID: () => "job-data-id",
    repository: {
      createModerationJob: async (_connection, input) => {
        created.push(input);
        return { id: 41, status: "pending", ...input };
      },
      claimInitialModerationLease: async () => true
    }
  });

  const job = await service.createWechatImageModerationJob({}, {
    subjectType: "avatar_image",
    media: { id: 12, uploader_user_id: 7 },
    objectKey: "uploads/avatars/user-7.webp",
    subjectVersion: "etag-avatar"
  });

  assert.equal(created[0].subjectType, "avatar_image");
  assert.equal(job.subjectType, "avatar_image");
  assert.equal(job.objectKey, "uploads/avatars/user-7.webp");
});

test("moderation repository projects a user image asset into shared immutable media facts", async () => {
  const calls = [];
  const connection = {
    async query(sql, params) {
      calls.push({ sql: String(sql), params });
      return [[{
        id: 12,
        owner_user_id: 7,
        kind: "avatar",
        asset_path: "/uploads/avatars/user-7.webp",
        object_key: "uploads/avatars/user-7.webp",
        object_version: "etag-avatar",
        moderation_status: "pending",
        status: "active"
      }]];
    }
  };

  const media = await findModerationMedia(connection, {
    subject_type: "avatar_image",
    subject_id: "12"
  }, { forUpdate: true });

  assert.match(calls[0].sql, /FROM user_image_assets/);
  assert.match(calls[0].sql, /FOR UPDATE/);
  assert.equal(media.uploader_user_id, 7);
  assert.equal(media.media_type, "image");
  assert.equal(media.moderation_object_version, "etag-avatar");
  assert.equal(media.object_key, "uploads/avatars/user-7.webp");
});

test("shared media transition targets the user image asset selected by subject type", async () => {
  const calls = [];
  const connection = {
    async query(sql, params) {
      calls.push({ sql: String(sql), params });
      return [{ affectedRows: 1 }];
    }
  };

  assert.equal(await transitionMediaModeration(connection, {
    subjectType: "review_image",
    mediaId: 13,
    fromStatuses: ["pending", "error"],
    toStatus: "approved"
  }), true);
  assert.match(calls[0].sql, /UPDATE user_image_assets/);
  assert.doesNotMatch(calls[0].sql, /session_album_photos/);
});

test("retry rehydrates avatar and review assets into the existing WeChat image dispatcher", async () => {
  for (const [subjectType, kind, objectKey] of [
    ["avatar_image", "avatar", "uploads/avatars/user-7.webp"],
    ["review_image", "review", "uploads/session-reviews/review-7.jpg"]
  ]) {
    let query = 0;
    const connection = {
      async query() {
        query += 1;
        if (query === 1) return [[{
          id: 41,
          provider: "wechat_sec_check",
          subject_type: subjectType,
          subject_id: "12",
          subject_version: "etag-image",
          status: "error",
          lease_token: "lease-image",
          retry_exhausted_at: null,
          decided_by_admin_user_id: null
        }]];
        return [[{
          id: 12,
          owner_user_id: 7,
          kind,
          asset_path: `/${objectKey}`,
          object_key: objectKey,
          object_version: "etag-image",
          moderation_status: "pending",
          status: "active"
        }]];
      }
    };

    const retry = await rehydrateModerationRetryJob(connection, {
      jobId: 41,
      leaseToken: "lease-image"
    });
    assert.equal(retry.kind, "wechat_image");
    assert.equal(retry.objectKey, objectKey);
    assert.equal(retry.retryFacts.kind, subjectType);
  }
});

test("authenticated WeChat trace callback dispatches user image subjects through applyMediaResult", async () => {
  const applied = [];
  const result = await dispatchWechatImageModerationEvent({
    event: { traceId: "trace-avatar", result: { decision: "pass" } },
    withDatabaseConnection: async (run) => run({}),
    repository: {
      findModerationAttemptByProviderJobId: async () => ({
        moderation_job_id: 41,
        provider: "wechat_sec_check"
      }),
      findModerationJobById: async () => ({
        id: 41,
        provider: "wechat_sec_check",
        subject_type: "avatar_image",
        subject_version: "etag-avatar"
      })
    },
    applyMediaResult: async (input) => {
      applied.push(input);
      return { status: "approved" };
    }
  });

  assert.equal(result.status, "approved");
  assert.equal(applied[0].jobId, 41);
  assert.equal(applied[0].subjectVersion, "etag-avatar");
});

test("pass publishes user images while review, block, and provider error remain hidden", async () => {
  for (const subjectType of ["avatar_image", "review_image"]) {
    for (const [decision, expected] of [
      ["pass", "approved"],
      ["review", "review"],
      ["block", "rejected"],
      ["error", "error"]
    ]) {
      const mediaUpdates = [];
      const cleanups = [];
      const job = {
        id: 41,
        provider: "wechat_sec_check",
        provider_job_id: "trace-user-image",
        subject_type: subjectType,
        subject_id: "12",
        subject_version: "etag-image",
        status: "processing",
        attempt_count: 1,
        decided_by_admin_user_id: null,
        created_at: "2026-07-17T00:00:00.000Z"
      };
      const service = createContentModerationService({
        config: { retryLimit: 8 },
        client: {},
        now: () => Date.parse("2026-07-17T00:00:01.000Z"),
        random: () => 0,
        transaction: async (run) => run({}),
        repository: {
          findModerationJobById: async () => job,
          findModerationAttemptByProviderJobId: async () => ({
            id: 71,
            moderation_job_id: 41,
            is_current: 1
          }),
          findCurrentModerationAttempt: async () => ({ id: 71 }),
          findModerationMedia: async () => ({
            id: 12,
            status: "active",
            media_type: "image",
            moderation_status: "pending",
            moderation_object_version: "etag-image",
            object_key: subjectType === "avatar_image"
              ? "uploads/avatars/user-7.webp"
              : "uploads/session-reviews/review-7.jpg"
          }),
          transitionModerationJob: async () => true,
          transitionMediaModeration: async (_connection, input) => {
            mediaUpdates.push(input);
            return true;
          },
          enqueueRejectedMediaCleanup: async () => cleanups.push("album"),
          enqueueUserImageAssetCleanup: async () => cleanups.push("user")
        },
        emit: () => {}
      });

      const result = await service.applyMediaResult({
        jobId: 41,
        provider: "wechat_sec_check",
        providerJobId: "trace-user-image",
        subjectVersion: "etag-image",
        result: { decision }
      });
      assert.equal(result.status, expected);
      assert.equal(mediaUpdates[0].subjectType, subjectType);
      assert.equal(mediaUpdates[0].toStatus, expected);
      assert.deepEqual(cleanups, decision === "block" ? ["user"] : []);
    }
  }
});

test("admin detail identifies avatar and review assets as image media without raw paths", () => {
  for (const subjectType of ["avatar_image", "review_image"]) {
    const detail = serializeAdminModerationDetail({
      id: 41,
      provider: "wechat_sec_check",
      subject_type: subjectType,
      subject_id: "12",
      subject_version: "etag-avatar",
      status: "review",
      media_id: 12,
      uploader_user_id: 7,
      media_type: "image",
      moderation_status: "review",
      object_key: "uploads/avatars/private.webp",
      asset_path: "/uploads/avatars/private.webp"
    });
    assert.equal(detail.media.media_type, "image");
    assert.equal(detail.submitter_user_id, 7);
    assert.equal("object_key" in detail.media, false);
    assert.equal("asset_path" in detail.media, false);
  }
});
