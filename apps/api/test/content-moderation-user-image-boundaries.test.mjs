import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  readMatchingUploadedLocalObject,
  uploadFilenameBase,
  writeUploadedLocalObject
} from "../src/server.js";

import { updateUserProfileWithConnection } from "../src/modules/auth/users.js";
import { upsertMySessionReviewWithConnection } from "../src/modules/core/service.js";

test("profile avatar association resolves an owned published avatar asset and stores its id", async () => {
  const calls = [];
  const connection = {
    async query(sql, params = []) {
      const text = String(sql);
      calls.push({ sql: text, params });
      if (text.includes("avatar_image_asset_id") && text.includes("FROM users")) {
        return [[{ avatar_image_asset_id: null }]];
      }
      if (text.includes("FROM user_image_assets")) return [[{
        id: 31,
        owner_user_id: 7,
        kind: "avatar",
        moderation_status: "approved",
        status: "active"
      }]];
      if (text.includes("UPDATE users")) return [{ affectedRows: 1 }];
      if (text.includes("SELECT * FROM users")) return [[{
        id: 7,
        avatar_url: "/uploads/avatars/user-7.webp"
      }]];
      throw new Error(`unexpected SQL: ${text}`);
    }
  };

  const result = await updateUserProfileWithConnection(connection, 7, {
    avatarUrl: "/uploads/avatars/user-7.webp"
  });

  const assetLookup = calls.find((call) => call.sql.includes("FROM user_image_assets"));
  assert.match(assetLookup.sql, /owner_user_id = \?/);
  assert.match(assetLookup.sql, /kind = \?/);
  assert.match(assetLookup.sql, /moderation_status IN \(\?, \?\)/);
  assert.match(assetLookup.sql, /FOR UPDATE/);
  const update = calls.find((call) => call.sql.includes("UPDATE users"));
  assert.match(update.sql, /avatar_image_asset_id = \?/);
  assert.equal(update.params.includes(31), true);
  assert.equal(result.avatarUrl, "/uploads/avatars/user-7.webp");
});

test("profile avatar association rejects another user's, pending, or unknown asset before user update", async () => {
  let updates = 0;
  const connection = {
    async query(sql) {
      if (String(sql).includes("FROM user_image_assets")) return [[]];
      if (String(sql).includes("UPDATE users")) updates += 1;
      return [{ affectedRows: 1 }];
    }
  };

  await assert.rejects(updateUserProfileWithConnection(connection, 7, {
    avatarUrl: "/uploads/avatars/user-8.webp"
  }), { code: "BAD_REQUEST" });
  assert.equal(updates, 0);
});

test("profile avatar replacement schedules the displaced asset cleanup anchor", async () => {
  const calls = [];
  const connection = {
    async query(sql, params = []) {
      const text = String(sql);
      calls.push({ sql: text, params });
      if (text.includes("avatar_image_asset_id") && text.includes("FROM users")) {
        return [[{ avatar_image_asset_id: 30 }]];
      }
      if (text.includes("FROM user_image_assets")) return [[{
        id: 31,
        owner_user_id: 7,
        kind: "avatar",
        moderation_status: "approved",
        status: "active"
      }]];
      if (text.includes("UPDATE users")) return [{ affectedRows: 1 }];
      if (text.includes("INSERT INTO user_image_asset_cleanup_jobs")) {
        return [{ affectedRows: 1, insertId: 1 }];
      }
      if (text.includes("SELECT * FROM users")) return [[{
        id: 7,
        avatar_url: "/uploads/avatars/new.jpg"
      }]];
      throw new Error(`unexpected SQL: ${text}`);
    }
  };

  await updateUserProfileWithConnection(connection, 7, {
    avatarUrl: "/uploads/avatars/new.jpg"
  });

  const cleanup = calls.find((call) => call.sql.includes("INSERT INTO user_image_asset_cleanup_jobs"));
  assert.ok(cleanup);
  assert.equal(cleanup.params.includes(30), true);
  assert.equal(cleanup.params.includes(31), false);
});

function reviewConnection({ published = true } = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, params = []) {
      const text = String(sql);
      calls.push({ sql: text, params });
      if (text.includes("FROM user_image_assets")) {
        if (!published) return [[]];
        const assetPath = text.includes("WHERE id = ?")
          ? "/uploads/session-reviews/review-7.jpg"
          : params[2];
        return [[{
          id: 51,
          owner_user_id: 7,
          kind: "review",
          asset_path: assetPath,
          moderation_status: "approved",
          status: "active"
        }]];
      }
      if (text.includes("FROM signups")) return [[{
        id: 4,
        seat_id: 5,
        review_eligible_at: "2026-07-17T00:00:00.000Z",
        session_start_at: "2026-07-16T00:00:00.000Z",
        signup_status: "confirmed",
        seat_status: "occupied"
      }]];
      if (text.includes("INSERT INTO session_reviews")) return [{ insertId: 61 }];
      if (text.includes("SELECT *") && text.includes("FROM session_reviews")) {
        return [[{ id: 61, session_id: 9, user_id: 7 }]];
      }
      if (text.includes("SELECT image_asset_id") && text.includes("session_review_photos")) {
        return [[]];
      }
      return [{ affectedRows: 1 }];
    }
  };
}

test("review photo association stores only the current user's published review asset id", async () => {
  const connection = reviewConnection();

  await upsertMySessionReviewWithConnection(connection, { user: { id: 7 } }, 9, {
    rating: 5,
    content: "",
    photoUrls: ["/uploads/session-reviews/review-7.jpg"]
  });

  const insert = connection.calls.find((call) => call.sql.includes("INSERT INTO session_review_photos"));
  const assetLookup = connection.calls.find((call) =>
    call.sql.includes("FROM user_image_assets") && call.sql.includes("asset_path = ?")
  );
  const assetLock = connection.calls.find((call) =>
    call.sql.includes("FROM user_image_assets") && call.sql.includes("WHERE id = ?")
  );
  assert.doesNotMatch(assetLookup.sql, /FOR UPDATE/);
  assert.match(assetLock.sql, /FOR UPDATE/);
  assert.match(insert.sql, /image_asset_id/);
  assert.deepEqual(insert.params, [61, "/uploads/session-reviews/review-7.jpg", 51, 0]);
});

test("review photo association locks reversed client assets in deterministic id order", async () => {
  const connection = reviewConnection();
  const originalQuery = connection.query.bind(connection);
  const paths = new Map([
    ["/uploads/session-reviews/review-a.jpg", { id: 52, path: "/uploads/session-reviews/review-a.jpg" }],
    ["/uploads/session-reviews/review-b.jpg", { id: 51, path: "/uploads/session-reviews/review-b.jpg" }]
  ]);
  connection.query = async (sql, params = []) => {
    const text = String(sql);
    if (text.includes("FROM user_image_assets")) {
      connection.calls.push({ sql: text, params });
      if (text.includes("WHERE id = ?")) {
        const found = [...paths.values()].find((entry) => entry.id === Number(params[0]));
        return [found ? [{
          id: found.id,
          owner_user_id: 7,
          kind: "review",
          asset_path: found.path,
          moderation_status: "approved",
          status: "active"
        }] : []];
      }
      const found = paths.get(String(params[2]));
      return [found ? [{
        id: found.id,
        owner_user_id: 7,
        kind: "review",
        asset_path: found.path,
        moderation_status: "approved",
        status: "active"
      }] : []];
    }
    return originalQuery(sql, params);
  };

  await upsertMySessionReviewWithConnection(connection, { user: { id: 7 } }, 9, {
    rating: 5,
    content: "",
    photoUrls: [
      "/uploads/session-reviews/review-a.jpg",
      "/uploads/session-reviews/review-b.jpg"
    ]
  });

  const lockCalls = connection.calls.filter((call) =>
    call.sql.includes("FROM user_image_assets") && call.sql.includes("FOR UPDATE")
  );
  assert.equal(lockCalls.length, 2);
  assert.deepEqual(lockCalls.map((call) => Number(call.params[0])), [51, 52]);
  assert.equal(lockCalls.every((call) => call.sql.includes("WHERE id = ?")), true);
  const photoInserts = connection.calls.filter((call) =>
    call.sql.includes("INSERT INTO session_review_photos")
  );
  assert.deepEqual(photoInserts.map((call) => [call.params[1], call.params[2]]), [
    ["/uploads/session-reviews/review-a.jpg", 52],
    ["/uploads/session-reviews/review-b.jpg", 51]
  ]);
});

test("review replacement serializes the review before locking the deterministic current/new asset union", async () => {
  const connection = reviewConnection();
  const originalQuery = connection.query.bind(connection);
  const paths = new Map([
    ["/uploads/session-reviews/review-a.jpg", { id: 53, path: "/uploads/session-reviews/review-a.jpg" }],
    ["/uploads/session-reviews/review-b.jpg", { id: 52, path: "/uploads/session-reviews/review-b.jpg" }]
  ]);
  const assets = new Map([
    [51, { id: 51, path: "/uploads/session-reviews/review-old.jpg" }],
    ...[...paths.values()].map((entry) => [entry.id, entry])
  ]);
  connection.query = async (sql, params = []) => {
    const text = String(sql);
    if (text.includes("SELECT image_asset_id") && text.includes("session_review_photos")) {
      connection.calls.push({ sql: text, params });
      return [[{ image_asset_id: 51 }]];
    }
    if (text.includes("FROM user_image_assets")) {
      connection.calls.push({ sql: text, params });
      const found = text.includes("WHERE id = ?")
        ? assets.get(Number(params[0]))
        : paths.get(String(params[2]));
      return [found ? [{
        id: found.id,
        owner_user_id: 7,
        kind: "review",
        asset_path: found.path,
        moderation_status: "approved",
        status: "active"
      }] : []];
    }
    return originalQuery(sql, params);
  };

  await upsertMySessionReviewWithConnection(connection, { user: { id: 7 } }, 9, {
    rating: 5,
    content: "",
    photoUrls: [
      "/uploads/session-reviews/review-a.jpg",
      "/uploads/session-reviews/review-b.jpg"
    ]
  });

  const reviewWriteIndex = connection.calls.findIndex((call) =>
    call.sql.includes("INSERT INTO session_reviews")
  );
  const lockCalls = connection.calls
    .map((call, index) => ({ ...call, index }))
    .filter((call) => call.sql.includes("FROM user_image_assets") && call.sql.includes("FOR UPDATE"));
  assert.equal(lockCalls[0].index > reviewWriteIndex, true);
  assert.deepEqual(lockCalls.map((call) => Number(call.params[0])), [51, 52, 53]);
});

test("review photo association fails before the review business write when no published owned asset exists", async () => {
  const connection = reviewConnection({ published: false });

  await assert.rejects(upsertMySessionReviewWithConnection(connection, { user: { id: 7 } }, 9, {
    rating: 5,
    content: "",
    photoUrls: ["/uploads/session-reviews/review-8.jpg"]
  }), { code: "BAD_REQUEST" });
  assert.equal(connection.calls.some((call) => call.sql.includes("INSERT INTO session_reviews")), false);
});

test("review photo replacement schedules only displaced asset cleanup anchors", async () => {
  const connection = reviewConnection();
  const originalQuery = connection.query.bind(connection);
  connection.query = async (sql, params = []) => {
    const text = String(sql);
    if (text.includes("SELECT image_asset_id") && text.includes("session_review_photos")) {
      connection.calls.push({ sql: text, params });
      return [[{ image_asset_id: 51 }, { image_asset_id: 52 }]];
    }
    return originalQuery(sql, params);
  };

  await upsertMySessionReviewWithConnection(connection, { user: { id: 7 } }, 9, {
    rating: 5,
    content: "",
    photoUrls: ["/uploads/session-reviews/review-7.jpg"]
  });

  const cleanups = connection.calls.filter((call) =>
    call.sql.includes("INSERT INTO user_image_asset_cleanup_jobs")
  );
  assert.equal(cleanups.length, 1);
  assert.equal(cleanups[0].params.includes(52), true);
  assert.equal(cleanups[0].params.includes(51), false);
});

test("server finalizes COS and local avatar/review uploads into assets and gates raw reads", async () => {
  const server = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  assert.match(server, /createUserImageAssetUploadService/);
  assert.match(server, /insertUserImageAsset/);
  assert.match(server, /findUserImageAssetReadStateByPath/);
  assert.match(server, /userImageAssetUploads\.finalizeUploadedImage/);
  assert.match(server, /url\.pathname === "\/api\/uploads\/user-image\/finalize"/);
  assert.match(server, /enqueueUserImageUploadCleanup/);
  assert.match(server, /protectUserImageUploadCleanup/);

  const finalizeStart = server.indexOf("async function finalizeUploadedUserImage");
  const finalizeEnd = server.indexOf("\nfunction unpublishedUserImageNotFound", finalizeStart);
  const finalizeBody = server.slice(finalizeStart, finalizeEnd);
  assert.match(finalizeBody, /catch \(error\)/);
  assert.match(finalizeBody, /findUserImageAssetByOwnerPath/);
  assert.match(finalizeBody, /enqueueUserImageCleanupJob/);

  const cosFinalizeStart = server.indexOf('url.pathname === "/api/uploads/user-image/finalize"');
  const cosFinalizeEnd = server.indexOf("\n  if (request.method", cosFinalizeStart + 1);
  assert.match(server.slice(cosFinalizeStart, cosFinalizeEnd), /finalizeUploadedUserImage/);

  for (const marker of ["async function saveUploadedAvatar", "async function saveUploadedSessionReviewPhoto"]) {
    const start = server.indexOf(marker);
    const next = server.indexOf("\nasync function ", start + marker.length);
    const body = server.slice(start, next);
    assert.match(body, /finalizeUploadedUserImage/);
    assert.match(body, /userImageUploadOperationId\(request\)/);
    assert.match(body, /uploadFilenameBase\([^)]*operationId/);
    assert.match(body, /EEXIST|COS_PRECONDITION_FAILED/);
    assert.match(body, /readMatchingUploadedLocalObject/);
    assert.ok(
      body.indexOf("readMatchingUploadedLocalObject") < body.indexOf("finalizeUploadedUserImage"),
      "stored-byte replay validation must happen before asset binding and moderation"
    );
  }
  const reviewUploadStart = server.indexOf("async function saveUploadedSessionReviewPhoto");
  const reviewUploadEnd = server.indexOf("\nasync function ", reviewUploadStart + 1);
  assert.match(
    server.slice(reviewUploadStart, reviewUploadEnd),
    /uploadFilenameBase\([\s\S]*uploadScopeKey/
  );
  for (const marker of ["async function serveUploadedAvatar", "async function serveUploadedSessionReviewPhoto"]) {
    const start = server.indexOf(marker);
    const next = server.indexOf("\nasync function ", start + marker.length);
    const body = server.slice(start, next);
    assert.match(body, /assertPublishedUserImagePath/);
  }
  const readGuardStart = server.indexOf("async function assertPublishedUserImagePath");
  const readGuardEnd = server.indexOf("\nfunction ", readGuardStart);
  const readGuard = server.slice(readGuardStart, readGuardEnd);
  assert.match(readGuard, /findUserImageAssetReadStateByPath/);
  assert.match(readGuard, /if \(state\.published\) return;/);
  assert.match(readGuard, /if \(state\.known \|\| wechatImageModerationEnabled\)/);
});

test("review and user serialization boundaries retain only explicitly bound published image references", async () => {
  const [core, users] = await Promise.all([
    readFile(new URL("../src/modules/core/service.js", import.meta.url), "utf8"),
    readFile(new URL("../src/modules/auth/users.js", import.meta.url), "utf8")
  ]);
  const reviewPhotos = core.slice(core.indexOf("async function reviewPhotos"), core.indexOf("export async function listSessionReviews"));
  assert.match(reviewPhotos, /JOIN user_image_assets/);
  assert.match(reviewPhotos, /isModerationPublished/);
  assert.match(reviewPhotos, /album_photo_moderation_status/);
  assert.match(reviewPhotos, /image_asset_moderation_status/);
  assert.doesNotMatch(reviewPhotos, /image_asset_id IS NULL/);
  assert.match(users, /findOwnedPublishedUserImageAsset/);
});

test("mini program finalizes direct avatar and review uploads instead of treating the COS path as public", async () => {
  const api = await readFile(new URL("../../miniprogram/src/utils/api.js", import.meta.url), "utf8");
  const start = api.indexOf("async function uploadCosBackedFile");
  const body = api.slice(start, api.indexOf("\nfunction uploadBackendFile", start));
  assert.match(body, /\/api\/uploads\/user-image\/finalize/);
  assert.match(body, /avatar|sessionReviewPhoto/);
  assert.match(body, /moderationStatus/);
  assert.match(api, /getUserImageAssetStatus/);
  assert.match(api, /assetId/);
  assert.match(api, /setStorageSync/);
  assert.match(api, /recoverPendingUserImage/);
  const clearAuth = api.slice(api.indexOf("export function clearAuth"), api.indexOf("\nfunction ", api.indexOf("export function clearAuth")));
  assert.match(clearAuth, /USER_IMAGE_PENDING_KEYS/);
});

test("server exposes an owner-authenticated user image asset status route", async () => {
  const server = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  assert.match(server, /userImageAssetStatusMatch/);
  assert.match(server, /api\\\/uploads\\\/user-image/);
  assert.match(server, /findOwnedUserImageAssetById/);
  assert.match(server, /projectUserImageAssetStatus/);
  assert.match(server, /userImageUploadOperationMatch/);
  assert.match(server, /findUserImageAssetByUploadOperation/);
  assert.match(server, /userImageUploadScopeKey/);
});

test("local forbidOverwrite atomically preserves the original bytes", async () => {
  const localDir = await mkdtemp(path.join(os.tmpdir(), "pinche-user-image-"));
  try {
    await writeUploadedLocalObject({
      localDir,
      filename: "user-7.jpg",
      file: Buffer.from("first"),
      forbidOverwrite: true
    });
    await assert.rejects(writeUploadedLocalObject({
      localDir,
      filename: "user-7.jpg",
      file: Buffer.from("second"),
      forbidOverwrite: true
    }), { code: "EEXIST" });
    assert.equal(await readFile(path.join(localDir, "user-7.jpg"), "utf8"), "first");
  } finally {
    await rm(localDir, { recursive: true, force: true });
  }
});

test("local upload replay uses the actual stored bytes and rejects conflicting retry bytes", async () => {
  const localDir = await mkdtemp(path.join(os.tmpdir(), "pinche-user-image-replay-"));
  try {
    const stored = Buffer.from("original-upload");
    await writeUploadedLocalObject({
      localDir,
      filename: "review-7.jpg",
      file: stored,
      forbidOverwrite: true
    });
    assert.deepEqual(await readMatchingUploadedLocalObject({
      localDir,
      filename: "review-7.jpg",
      claimedFile: Buffer.from(stored)
    }), stored);
    await assert.rejects(readMatchingUploadedLocalObject({
      localDir,
      filename: "review-7.jpg",
      claimedFile: Buffer.from("different-retry")
    }), { statusCode: 409, code: "USER_IMAGE_UPLOAD_OPERATION_CONFLICT" });
  } finally {
    await rm(localDir, { recursive: true, force: true });
  }
});

test("deterministic review upload keys include the normalized operation scope", () => {
  const operationId = "sessionReviewPhoto-operation-123";
  const sessionNine = uploadFilenameBase("review", 7, operationId, "user:7:session:9");
  const sessionTen = uploadFilenameBase("review", 7, operationId, "user:7:session:10");
  assert.notEqual(sessionNine, sessionTen);
  assert.equal(
    sessionNine,
    uploadFilenameBase("review", 7, operationId, "user:7:session:9")
  );
});
