import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  contentModerationErrorText,
  contentModerationStatusText
} from "../src/utils/contentModeration.js";

const PENDING_TEXT = "内容正在安全审核";
const REJECTED_TEXT = "内容未通过安全审核";
const INTAKE_CLOSED_TEXT = "内容安全服务暂未就绪，暂时无法发布，请稍后再试";

function assertSuccessfulUpdateFollowsRequest(source, requestMarker, successMarker) {
  const requestAt = source.indexOf(requestMarker);
  const successAt = source.indexOf(successMarker, requestAt);
  assert.ok(requestAt >= 0, `missing request marker: ${requestMarker}`);
  assert.ok(successAt > requestAt, `success update must follow request: ${successMarker}`);
}

function extractMethodBody(source, marker) {
  const methodStart = source.indexOf(marker);
  assert.ok(methodStart >= 0, `missing method marker: ${marker}`);
  const bodyStart = source.indexOf("{", methodStart) + 1;
  let depth = 1;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(bodyStart, index);
  }
  throw new Error(`unterminated method: ${marker}`);
}

test("content moderation status presentation only exposes the three approved user messages", () => {
  for (const status of ["pending", "processing", "error", "review"]) {
    assert.equal(contentModerationStatusText(status), PENDING_TEXT);
  }
  assert.equal(contentModerationStatusText("rejected"), REJECTED_TEXT);
  assert.equal(contentModerationStatusText("approved"), "");
  assert.equal(contentModerationStatusText("approved_legacy"), "");
  assert.equal(contentModerationStatusText("untrusted-status"), "");
});

test("provider failures are reduced to safe user messages without provider details", () => {
  assert.equal(
    contentModerationErrorText({
      code: "CONTENT_MODERATION_REVIEW_PENDING",
      message: "WeChat review label: political-person"
    }),
    PENDING_TEXT
  );
  assert.equal(
    contentModerationErrorText({
      code: "CONTENT_MODERATION_REJECTED",
      message: "Tencent hit word: unsafe"
    }),
    REJECTED_TEXT
  );
  assert.equal(
    contentModerationErrorText({
      code: "CONTENT_MODERATION_UNAVAILABLE",
      message: "provider temporarily unavailable"
    }),
    PENDING_TEXT
  );
  assert.equal(
    contentModerationErrorText({
      code: "CONTENT_MODERATION_INTAKE_CLOSED",
      message: "provider configuration details must not be shown"
    }),
    INTAKE_CLOSED_TEXT
  );
  assert.equal(
    contentModerationErrorText({
      code: "CONTENT_MODERATION_CONFIGURATION_ERROR",
      message: "Tencent score=99 and provider token must not be shown"
    }),
    PENDING_TEXT
  );
  assert.equal(contentModerationErrorText({ code: "UNRELATED", message: "other" }), "");
});

test("the mini-program renders mapped media statuses and keeps text Review on the failure path", async () => {
  const [api, album, review, detail, manage, chat, pinned] = await Promise.all([
    readFile(new URL("../src/utils/api.js", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/session/album.vue", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/session/review.vue", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/session/detail.vue", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/session/manage.vue", import.meta.url), "utf8"),
    readFile(new URL("../src/extensions/session-pseudo-chat/ChatEntry.vue", import.meta.url), "utf8"),
    readFile(new URL("../src/extensions/session-pseudo-chat/ManagePinnedMessage.vue", import.meta.url), "utf8")
  ]);
  const [profile, create, script, setup] = await Promise.all([
    readFile(new URL("../src/components/AuthIdentityBar.vue", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/session/create.vue", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/session/script.vue", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/session/setup.vue", import.meta.url), "utf8")
  ]);
  const template = album.slice(0, album.indexOf("<script>"));
  const reviewSaveStart = review.indexOf("async saveReview()");
  const reviewCatchStart = review.indexOf("} catch (error)", reviewSaveStart);
  const reviewFinallyStart = review.indexOf("} finally", reviewCatchStart);
  const reviewCatch = review.slice(reviewCatchStart, reviewFinallyStart);

  assert.match(api, /contentModerationErrorText/);
  assert.match(api, /const moderationMessage = contentModerationErrorText\(error\);/);
  assert.match(api, /error\.userMessage\s*=\s*moderationMessage;/);
  assert.match(api, /if \(!moderationMessage && !isContentModerationError\(error\)\)/);
  assert.doesNotMatch(api, /error\.userMessage\s*=\s*moderationMessage\s*\|\|\s*error\.message/);
  assert.doesNotMatch(api, /contentModerationErrorText\(error\)\s*\|\|\s*error\.message/);
  assert.match(api, /responseData\.ok === false/);

  assert.equal(
    template.match(/v-if="mediaModerationStatusText\(photo\)"/g)?.length,
    2,
    "both waterfall columns must show the mapped media status"
  );
  assert.match(album, /contentModerationStatusText/);
  assert.match(album, /this\.timelineMode \|\| !photo\?\.is_mine/);
  assert.match(album, /videoStateText\(photo\)[\s\S]*mediaModerationStatusText\(photo\)/);
  assert.doesNotMatch(album, /moderation_message|photo\.(?:provider|provider_job_id|score|suggestion|hit_words)/);
  assert.doesNotMatch(album, /相册媒体尚未通过审核/);
  assert.match(
    album,
    /albumMediaError\("MEDIA_NOT_PUBLISHED", contentModerationStatusText\("review"\)\)/
  );

  assert.match(reviewCatch, /const moderationMessage = contentModerationErrorText\(error\);/);
  assert.match(reviewCatch, /if \(moderationMessage\) \{\s*this\.statusText = moderationMessage;\s*return;/);
  assert.doesNotMatch(reviewCatch, /this\.(?:rating|content|photos)\s*=/);
  assert.match(review, /uploadSessionReviewPhotos/);
  assert.match(review, /recoverPendingSessionReviewPhotos/);
  assert.match(profile, /recoverPendingUserAvatar/);
  assert.match(api, /rememberPendingUserImageOperation[\s\S]*\/api\/uploads\/user-image\/finalize/);
  assert.match(review, /photos\.length \+ pendingPhotoCount >= 9/);
  assert.match(review, /new Set\(\[\.\.\.this\.photos, \.\.\.approvedPaths\]\)/);

  assert.match(detail, /contentModerationErrorText/);
  assert.match(manage, /contentModerationErrorText/);
  assert.match(chat, /this\.authTools\.contentModerationErrorText\?\.\(error\)/);
  assert.match(pinned, /this\.authTools\.contentModerationErrorText\?\.\(error\)/);
  for (const source of [profile, create, script, setup]) {
    assert.match(source, /error\?\.userMessage|error\.userMessage/);
  }
  assertSuccessfulUpdateFollowsRequest(profile, "const auth = await updateUserProfile(patch);", "this.user = auth.user;");
  assertSuccessfulUpdateFollowsRequest(
    profile,
    "const auth = await updateUserProfile(patch);",
    "acknowledgeUserAvatarAssociation(avatarUrl, avatarAssociationCutoff);"
  );
  assertSuccessfulUpdateFollowsRequest(
    profile,
    "const avatarAssociationCutoff = captureUserAvatarAssociationCutoff();",
    "const auth = await updateUserProfile(patch);"
  );
  assert.match(profile, /acknowledgeUserAvatarAssociation\(avatarUrl, avatarAssociationCutoff\)/);
  assertSuccessfulUpdateFollowsRequest(
    review,
    'url: `/api/sessions/${this.sessionId}/review`',
    "acknowledgeSessionReviewPhotoAssociations(this.photos"
  );
  assert.match(review, /canSave\(\)[\s\S]*this\.pendingPhotoCount === 0/);
  assert.match(review, /captureSessionReviewPhotoAssociationCutoff/);
  assert.match(review, /acknowledgeSessionReviewPhotoAssociations\([\s\S]*reviewAssociationCutoff/);
  assertSuccessfulUpdateFollowsRequest(create, "const response = await request({", "this.stores = [store,");
  assertSuccessfulUpdateFollowsRequest(script, "const response = await request({", "this.scripts = [script,");
  assertSuccessfulUpdateFollowsRequest(setup, "const sessionResponse = await request({", "uni.redirectTo({ url:");
  assertSuccessfulUpdateFollowsRequest(
    chat,
    "const message = await this.api.sendMessage(",
    "this.messages = [...this.messages, message];"
  );
  assertSuccessfulUpdateFollowsRequest(
    pinned,
    "const result = await this.api.updatePinnedMessage(",
    "this.pinnedMessage = result.pinnedMessage || null;"
  );
});

test("the D46 static moderation checker passes and is wired into root check", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../../../package.json", import.meta.url), "utf8"));
  const result = spawnSync(process.execPath, ["scripts/d46-content-moderation-check.js"], {
    cwd: new URL("../../..", import.meta.url),
    encoding: "utf8"
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(packageJson.scripts.precheck, /d46:check/);
  assert.equal(
    packageJson.scripts["d46:check"],
    "node --test scripts/d46-content-moderation-check.test.mjs && node scripts/d46-content-moderation-check.js"
  );
});

test("review photo recovery keeps every local file independent and preserves selection order", async () => {
  const storage = new Map();
  const uploadCalls = [];
  const assets = new Map();
  const assetByFile = new Map([
    ["wxfile://review-a.jpg", 101],
    ["wxfile://review-b.jpg", 102],
    ["wxfile://review-c.jpg", 103],
    ...Array.from({ length: 9 }, (_, index) => [
      `wxfile://review-${String.fromCharCode(100 + index)}.jpg`,
      104 + index
    ])
  ]);
  const app = {
    globalData: {
      apiBaseUrl: "http://127.0.0.1:3029",
      token: "test-token",
      authBaseUrl: "http://127.0.0.1:3029",
      user: { id: 7 },
      roles: []
    }
  };
  globalThis.getApp = () => app;
  globalThis.wx = {
    getFileSystemManager: () => ({}),
    canIUse: () => false,
    getStorageSync: () => "",
    setStorageSync() {},
    removeStorageSync() {}
  };
  globalThis.uni = {
    getStorageSync: (key) => storage.get(key) ?? "",
    setStorageSync: (key, value) => storage.set(key, value),
    removeStorageSync: (key) => storage.delete(key),
    request(options) {
      const pathname = new URL(options.url).pathname;
      if (pathname === "/api/uploads/cos-intent") {
        options.success({ statusCode: 200, data: { ok: true, data: { upload: { direct: false } } } });
        return;
      }
      const statusMatch = pathname.match(/^\/api\/uploads\/user-image\/(\d+)$/);
      if (statusMatch) {
        options.success({ statusCode: 200, data: { ok: true, data: assets.get(Number(statusMatch[1])) } });
        return;
      }
      throw new Error(`unexpected request: ${pathname}`);
    },
    uploadFile(options) {
      uploadCalls.push(options.filePath);
      const assetId = assetByFile.get(options.filePath);
      options.success({
        statusCode: 200,
        data: { ok: true, data: { moderationStatus: "pending", assetId } }
      });
    }
  };

  const api = await import(`../src/utils/api.js?review-recovery=${Date.now()}`);
  assert.equal(typeof api.uploadSessionReviewPhotos, "function");
  assert.equal(typeof api.recoverPendingSessionReviewPhotos, "function");

  await assert.rejects(api.uploadSessionReviewPhoto("wxfile://review-a.jpg", { sessionId: 9 }), {
    code: "CONTENT_MODERATION_REVIEW_PENDING",
    assetId: 101
  });
  assets.set(101, {
    assetId: 101,
    kind: "review",
    moderationStatus: "approved",
    path: "/uploads/session-reviews/review-a.jpg"
  });
  await assert.rejects(api.uploadSessionReviewPhoto("wxfile://review-b.jpg", { sessionId: 9 }), {
    code: "CONTENT_MODERATION_REVIEW_PENDING",
    assetId: 102
  });
  assets.set(102, {
    assetId: 102,
    kind: "review",
    moderationStatus: "approved",
    path: "/uploads/session-reviews/review-b.jpg"
  });

  const recovered = [];
  for (const filePath of ["wxfile://review-a.jpg", "wxfile://review-b.jpg"]) {
    recovered.push(await api.uploadSessionReviewPhoto(filePath, { sessionId: 9 }));
  }
  assert.deepEqual(recovered, [
    "/uploads/session-reviews/review-a.jpg",
    "/uploads/session-reviews/review-b.jpg"
  ]);
  await assert.rejects(api.uploadSessionReviewPhoto("wxfile://review-c.jpg", { sessionId: 9 }), {
    code: "CONTENT_MODERATION_REVIEW_PENDING",
    assetId: 103
  });
  assert.deepEqual(uploadCalls, [
    "wxfile://review-a.jpg",
    "wxfile://review-b.jpg",
    "wxfile://review-c.jpg"
  ]);

  const batchFiles = [
    "wxfile://review-d.jpg",
    "wxfile://review-d.jpg",
    ...Array.from({ length: 10 }, (_, index) =>
      `wxfile://review-${String.fromCharCode(101 + index)}.jpg`)
  ];
  const batch = await api.uploadSessionReviewPhotos(batchFiles, { sessionId: 9 });
  assert.deepEqual(batch, { approvedPaths: [], pendingCount: 9, error: null });
  assert.deepEqual(uploadCalls.slice(3), Array.from({ length: 9 }, (_, index) =>
    `wxfile://review-${String.fromCharCode(100 + index)}.jpg`
  ));

  assets.set(104, {
    assetId: 104,
    kind: "review",
    moderationStatus: "approved",
    path: "/uploads/session-reviews/review-d.jpg"
  });
  assets.set(105, { assetId: 105, kind: "review", moderationStatus: "pending" });
  assets.set(106, {
    assetId: 106,
    kind: "review",
    moderationStatus: "approved",
    path: "/uploads/session-reviews/review-f.jpg"
  });
  for (let assetId = 107; assetId <= 112; assetId += 1) {
    assets.set(assetId, { assetId, kind: "review", moderationStatus: "pending" });
  }
  assets.set(103, { assetId: 103, kind: "review", moderationStatus: "pending" });
  assert.deepEqual(await api.recoverPendingSessionReviewPhotos({ sessionId: 10 }), {
    approvedPaths: [],
    pendingCount: 0
  });
  app.globalData.user = { id: 8 };
  assert.deepEqual(await api.recoverPendingSessionReviewPhotos({ sessionId: 9 }), {
    approvedPaths: [],
    pendingCount: 0
  });
  app.globalData.user = { id: 7 };
  const approvedRecovery = await api.recoverPendingSessionReviewPhotos({ sessionId: 9 });
  assert.deepEqual(approvedRecovery, {
    approvedPaths: [
      "/uploads/session-reviews/review-a.jpg",
      "/uploads/session-reviews/review-b.jpg",
      "/uploads/session-reviews/review-d.jpg",
      "/uploads/session-reviews/review-f.jpg"
    ],
    pendingCount: 8
  });
  api.acknowledgeSessionReviewPhotoAssociations(
    approvedRecovery.approvedPaths,
    { sessionId: 9 }
  );
  assert.deepEqual(await api.recoverPendingSessionReviewPhotos({ sessionId: 9 }), {
    approvedPaths: [],
    pendingCount: 0
  });
});

test("pre-finalize operation keys recover avatar transport loss and scoped review batches", async () => {
  const storage = new Map();
  const avatarFile = "wxfile://avatar-lost.jpg";
  const reviewA = "wxfile://review-lost-a.jpg";
  const reviewB = "wxfile://review-lost-b.jpg";
  const avatarOperation = `avatar:user:7:avatar:file:${encodeURIComponent(avatarFile)}`;
  const reviewOperationA = `sessionReviewPhoto:user:7:session:9:file:${encodeURIComponent(reviewA)}`;
  const reviewOperationB = `sessionReviewPhoto:user:7:session:9:file:${encodeURIComponent(reviewB)}`;
  storage.set("pinche_pending_avatar_asset_id", {
    [avatarOperation]: {
      assetId: 0,
      objectKey: "uploads/avatars/lost-avatar.jpg",
      filePath: avatarFile,
      ownerUserId: 7,
      scopeKey: "user:7:avatar"
    }
  });
  storage.set("pinche_pending_review_image_asset_id", {
    [reviewOperationA]: {
      assetId: 0,
      objectKey: "uploads/session-reviews/lost-a.jpg",
      filePath: reviewA,
      ownerUserId: 7,
      sessionId: "9",
      scopeKey: "user:7:session:9"
    },
    [reviewOperationB]: {
      assetId: 0,
      objectKey: "uploads/session-reviews/lost-b.jpg",
      filePath: reviewB,
      ownerUserId: 7,
      sessionId: "9",
      scopeKey: "user:7:session:9"
    }
  });
  const app = {
    globalData: {
      apiBaseUrl: "http://127.0.0.1:3029",
      token: "test-token",
      authBaseUrl: "http://127.0.0.1:3029",
      user: { id: 7 },
      roles: []
    }
  };
  globalThis.getApp = () => app;
  globalThis.wx = {
    getFileSystemManager: () => ({}),
    canIUse: () => false,
    getStorageSync: () => "",
    setStorageSync() {},
    removeStorageSync() {}
  };
  let avatarAttempts = 0;
  const finalizedKeys = [];
  globalThis.uni = {
    getStorageSync: (key) => storage.get(key) ?? "",
    setStorageSync: (key, value) => storage.set(key, value),
    removeStorageSync: (key) => storage.delete(key),
    request(options) {
      const pathname = new URL(options.url).pathname;
      if (pathname !== "/api/uploads/user-image/finalize") {
        throw new Error(`unexpected request: ${pathname}`);
      }
      finalizedKeys.push(options.data.key);
      if (options.data.key === "uploads/avatars/lost-avatar.jpg") {
        avatarAttempts += 1;
        if (avatarAttempts === 1) {
          options.fail({ errMsg: "request:fail timeout" });
          return;
        }
        options.success({
          statusCode: 200,
          data: { ok: true, data: { assetId: 201, moderationStatus: "pending" } }
        });
        return;
      }
      if (options.data.key === "uploads/session-reviews/lost-a.jpg") {
        options.success({
          statusCode: 200,
          data: { ok: true, data: {
            assetId: 202,
            moderationStatus: "approved",
            path: "/uploads/session-reviews/lost-a.jpg"
          } }
        });
        return;
      }
      options.success({
        statusCode: 200,
        data: { ok: true, data: { assetId: 203, moderationStatus: "pending" } }
      });
    }
  };

  const api = await import(`../src/utils/api.js?pre-finalize-recovery=${Date.now()}`);
  await assert.rejects(api.uploadUserAvatar(avatarFile), /超时/);
  assert.equal(
    storage.get("pinche_pending_avatar_asset_id")[avatarOperation].objectKey,
    "uploads/avatars/lost-avatar.jpg"
  );
  await assert.rejects(api.uploadUserAvatar(avatarFile), {
    code: "CONTENT_MODERATION_REVIEW_PENDING",
    assetId: 201
  });
  assert.equal(storage.get("pinche_pending_avatar_asset_id")[avatarOperation].assetId, 201);

  assert.deepEqual(await api.recoverPendingSessionReviewPhotos({ sessionId: 10 }), {
    approvedPaths: [],
    pendingCount: 0
  });
  assert.deepEqual(await api.recoverPendingSessionReviewPhotos({ sessionId: 9 }), {
    approvedPaths: ["/uploads/session-reviews/lost-a.jpg"],
    pendingCount: 1
  });
  assert.deepEqual(finalizedKeys, [
    "uploads/avatars/lost-avatar.jpg",
    "uploads/avatars/lost-avatar.jpg",
    "uploads/session-reviews/lost-a.jpg",
    "uploads/session-reviews/lost-b.jpg"
  ]);
  const reviewPending = storage.get("pinche_pending_review_image_asset_id");
  assert.equal(
    reviewPending[reviewOperationA].approvedPath,
    "/uploads/session-reviews/lost-a.jpg"
  );
  assert.equal(reviewPending[reviewOperationB].assetId, 203);
  api.acknowledgeSessionReviewPhotoAssociations(
    ["/uploads/session-reviews/lost-a.jpg"],
    { sessionId: 9 }
  );
  assert.equal(storage.has("pinche_pending_review_image_asset_id"), false);
});

test("terminal avatar and review recovery records are forgotten so uploads can restart", async () => {
  const storage = new Map();
  const avatarFile = "wxfile://avatar-terminal.jpg";
  const avatarOperation = `avatar:user:7:avatar:file:${encodeURIComponent(avatarFile)}`;
  storage.set("pinche_pending_avatar_asset_id", {
    [avatarOperation]: {
      assetId: 301,
      filePath: avatarFile,
      ownerUserId: 7,
      scopeKey: "user:7:avatar"
    }
  });
  const reviewRecords = {
    "review-nonactive": { assetId: 302 },
    "review-no-path": { assetId: 303 },
    "review-finalize-404": { objectKey: "uploads/session-reviews/gone.jpg" },
    "review-finalize-config": { objectKey: "uploads/session-reviews/unrecoverable.jpg" }
  };
  storage.set("pinche_pending_review_image_asset_id", Object.fromEntries(
    Object.entries(reviewRecords).map(([operationKey, operation]) => [operationKey, {
      ...operation,
      filePath: `wxfile://${operationKey}.jpg`,
      ownerUserId: 7,
      sessionId: "9",
      scopeKey: "user:7:session:9"
    }])
  ));
  globalThis.getApp = () => ({
    globalData: {
      apiBaseUrl: "http://127.0.0.1:3029",
      token: "test-token",
      authBaseUrl: "http://127.0.0.1:3029",
      user: { id: 7 },
      roles: []
    }
  });
  globalThis.wx = {
    getFileSystemManager: () => ({}),
    canIUse: () => false,
    getStorageSync: () => "",
    setStorageSync() {},
    removeStorageSync() {}
  };
  globalThis.uni = {
    getStorageSync: (key) => storage.get(key) ?? "",
    setStorageSync: (key, value) => storage.set(key, value),
    removeStorageSync: (key) => storage.delete(key),
    request(options) {
      const pathname = new URL(options.url).pathname;
      const statusMatch = pathname.match(/^\/api\/uploads\/user-image\/(\d+)$/);
      if (statusMatch) {
        const assetId = Number(statusMatch[1]);
        const data = assetId === 301
          ? { assetId, kind: "avatar", status: "deleted", moderationStatus: "approved" }
          : assetId === 302
            ? { assetId, kind: "review", status: "inactive", moderationStatus: "pending" }
            : { assetId, kind: "review", status: "active", moderationStatus: "approved" };
        options.success({ statusCode: 200, data: { ok: true, data } });
        return;
      }
      if (pathname === "/api/uploads/user-image/finalize") {
        const isMissing = options.data.key.endsWith("gone.jpg");
        options.success({
          statusCode: isMissing ? 404 : 500,
          data: { ok: false, error: {
            code: isMissing ? "NOT_FOUND" : "CONTENT_MODERATION_CONFIGURATION_ERROR",
            message: "terminal replay"
          } }
        });
        return;
      }
      if (pathname === "/api/uploads/cos-intent") {
        throw new Error("fresh upload requested");
      }
      throw new Error(`unexpected request: ${pathname}`);
    }
  };

  const api = await import(`../src/utils/api.js?terminal-user-image-recovery=${Date.now()}`);
  await assert.rejects(api.uploadUserAvatar(avatarFile), /fresh upload requested/);
  assert.equal(storage.has("pinche_pending_avatar_asset_id"), false);
  assert.deepEqual(await api.recoverPendingSessionReviewPhotos({ sessionId: 9 }), {
    approvedPaths: [],
    pendingCount: 0
  });
  assert.equal(storage.has("pinche_pending_review_image_asset_id"), false);
});

test("approved avatar and review recovery survives app restart until business association acknowledgement", async () => {
  const storage = new Map();
  const avatarFile = "wxfile://avatar-approved.jpg";
  const reviewFile = "wxfile://review-approved.jpg";
  const avatarOperation = `avatar:user:7:avatar:file:${encodeURIComponent(avatarFile)}`;
  const reviewOperation = `sessionReviewPhoto:user:7:session:9:file:${encodeURIComponent(reviewFile)}`;
  storage.set("pinche_pending_avatar_asset_id", {
    [avatarOperation]: {
      assetId: 401,
      filePath: avatarFile,
      ownerUserId: 7,
      scopeKey: "user:7:avatar"
    }
  });
  storage.set("pinche_pending_review_image_asset_id", {
    [reviewOperation]: {
      assetId: 402,
      filePath: reviewFile,
      ownerUserId: 7,
      sessionId: "9",
      scopeKey: "user:7:session:9"
    }
  });
  globalThis.getApp = () => ({
    globalData: {
      apiBaseUrl: "http://127.0.0.1:3029",
      token: "test-token",
      authBaseUrl: "http://127.0.0.1:3029",
      user: { id: 7 },
      roles: []
    }
  });
  globalThis.wx = {
    getFileSystemManager: () => ({}),
    canIUse: () => false,
    getStorageSync: () => "",
    setStorageSync() {},
    removeStorageSync() {}
  };
  globalThis.uni = {
    getStorageSync: (key) => storage.get(key) ?? "",
    setStorageSync: (key, value) => storage.set(key, value),
    removeStorageSync: (key) => storage.delete(key),
    request(options) {
      const assetId = Number(new URL(options.url).pathname.split("/").at(-1));
      const path = assetId === 401
        ? "/uploads/avatars/avatar-approved.jpg"
        : "/uploads/session-reviews/review-approved.jpg";
      options.success({
        statusCode: 200,
        data: { ok: true, data: { assetId, status: "active", moderationStatus: "approved", path } }
      });
    }
  };

  const firstApi = await import(`../src/utils/api.js?approved-association-first=${Date.now()}`);
  assert.equal(await firstApi.uploadUserAvatar(avatarFile), "/uploads/avatars/avatar-approved.jpg");
  assert.deepEqual(await firstApi.recoverPendingSessionReviewPhotos({ sessionId: 9 }), {
    approvedPaths: ["/uploads/session-reviews/review-approved.jpg"],
    pendingCount: 0
  });
  assert.equal(storage.has("pinche_pending_avatar_asset_id"), true);
  assert.equal(storage.has("pinche_pending_review_image_asset_id"), true);

  const restartedApi = await import(`../src/utils/api.js?approved-association-restart=${Date.now()}`);
  assert.equal(await restartedApi.uploadUserAvatar(avatarFile), "/uploads/avatars/avatar-approved.jpg");
  assert.deepEqual(await restartedApi.recoverPendingSessionReviewPhotos({ sessionId: 9 }), {
    approvedPaths: ["/uploads/session-reviews/review-approved.jpg"],
    pendingCount: 0
  });
  restartedApi.acknowledgeUserAvatarAssociation("/uploads/avatars/avatar-approved.jpg");
  restartedApi.acknowledgeSessionReviewPhotoAssociations(
    ["/uploads/session-reviews/review-approved.jpg"],
    { sessionId: 9 }
  );
  assert.equal(storage.has("pinche_pending_avatar_asset_id"), false);
  assert.equal(storage.has("pinche_pending_review_image_asset_id"), false);
});

test("authoritative association clears the whole scope and invalidates overlapping recovery", async () => {
  const storage = new Map();
  storage.set("pinche_pending_avatar_asset_id", {
    oldAvatar: {
      assetId: 701,
      approvedPath: "/uploads/avatars/old.jpg",
      ownerUserId: 7,
      scopeKey: "user:7:avatar"
    },
    replacementAvatar: {
      assetId: 702,
      approvedPath: "/uploads/avatars/new.jpg",
      ownerUserId: 7,
      scopeKey: "user:7:avatar"
    }
  });
  storage.set("pinche_pending_review_image_asset_id", {
    removedRecoveredPhoto: {
      assetId: 703,
      approvedPath: "/uploads/session-reviews/removed.jpg",
      ownerUserId: 7,
      sessionId: "9",
      scopeKey: "user:7:session:9"
    },
    savedPhoto: {
      assetId: 704,
      approvedPath: "/uploads/session-reviews/saved.jpg",
      ownerUserId: 7,
      sessionId: "9",
      scopeKey: "user:7:session:9"
    },
    otherSession: {
      assetId: 705,
      approvedPath: "/uploads/session-reviews/other.jpg",
      ownerUserId: 7,
      sessionId: "10",
      scopeKey: "user:7:session:10"
    }
  });
  const app = { globalData: {
    apiBaseUrl: "http://127.0.0.1:3029",
    authBaseUrl: "http://127.0.0.1:3029",
    token: "test-token",
    user: { id: 7 },
    roles: []
  } };
  globalThis.getApp = () => app;
  globalThis.wx = {
    getFileSystemManager: () => ({}),
    canIUse: () => false,
    getStorageSync: () => "",
    setStorageSync() {},
    removeStorageSync() {}
  };
  let releaseRecovery;
  globalThis.uni = {
    getStorageSync: (key) => storage.get(key) ?? "",
    setStorageSync: (key, value) => storage.set(key, value),
    removeStorageSync: (key) => storage.delete(key),
    request(options) {
      if (new URL(options.url).pathname !== "/api/uploads/user-image/703") {
        throw new Error(`unexpected request: ${options.url}`);
      }
      releaseRecovery = () => options.success({
        statusCode: 200,
        data: { ok: true, data: {
          assetId: 703,
          moderationStatus: "approved",
          path: "/uploads/session-reviews/removed.jpg"
        } }
      });
    }
  };

  const api = await import(`../src/utils/api.js?authoritative-scope=${Date.now()}`);
  const overlappingRecovery = api.recoverPendingSessionReviewPhotos({ sessionId: 9 });
  await Promise.resolve();
  api.acknowledgeSessionReviewPhotoAssociations(
    ["/uploads/session-reviews/saved.jpg"],
    { sessionId: 9 }
  );
  releaseRecovery();
  assert.deepEqual(await overlappingRecovery, { approvedPaths: [], pendingCount: 0 });
  assert.deepEqual(Object.keys(storage.get("pinche_pending_review_image_asset_id")), ["otherSession"]);

  api.acknowledgeUserAvatarAssociation("/uploads/avatars/new.jpg");
  assert.equal(storage.has("pinche_pending_avatar_asset_id"), false);

  const reopenedApi = await import(`../src/utils/api.js?authoritative-reopen=${Date.now()}`);
  assert.equal(await reopenedApi.recoverPendingUserAvatar(), "");
  assert.deepEqual(await reopenedApi.recoverPendingSessionReviewPhotos({ sessionId: 9 }), {
    approvedPaths: [],
    pendingCount: 0
  });
});

test("stacked profile requests supersede only uploads started before their association cutoff", async () => {
  const storage = new Map();
  const avatarRequests = [];
  globalThis.getApp = () => ({ globalData: {
    apiBaseUrl: "http://127.0.0.1:3029",
    authBaseUrl: "http://127.0.0.1:3029",
    token: "test-token",
    user: { id: 7 },
    roles: []
  } });
  globalThis.wx = {
    getFileSystemManager: () => ({}),
    canIUse: () => false,
    getStorageSync: () => "",
    setStorageSync() {},
    removeStorageSync() {}
  };
  globalThis.uni = {
    getStorageSync: (key) => storage.get(key) ?? "",
    setStorageSync: (key, value) => storage.set(key, value),
    removeStorageSync: (key) => storage.delete(key),
    getFileSystemManager: () => ({
      stat({ success }) { success({ stats: { size: 12 } }); },
      readFile({ success }) { success({ data: new ArrayBuffer(12) }); }
    }),
    request(options) {
      const pathname = new URL(options.url).pathname;
      if (pathname === "/api/uploads/cos-intent") {
        options.success({ statusCode: 200, data: { ok: true, data: { upload: { direct: false } } } });
        return;
      }
      if (pathname === "/api/users/me/avatar") {
        avatarRequests.push(options);
        return;
      }
      throw new Error(`unexpected request: ${pathname}`);
    }
  };

  const api = await import(`../src/utils/api.js?stacked-avatar-cutoff=${Date.now()}`);
  assert.equal(typeof api.captureUserAvatarAssociationCutoff, "function");
  const oldUpload = api.uploadUserAvatar("wxfile://old-in-flight.jpg");
  for (let index = 0; index < 12 && avatarRequests.length < 1; index += 1) await Promise.resolve();
  assert.equal(avatarRequests.length, 1);

  const associationCutoff = api.captureUserAvatarAssociationCutoff();
  const newerUpload = api.uploadUserAvatar("wxfile://newer-stacked.jpg");
  for (let index = 0; index < 12 && avatarRequests.length < 2; index += 1) await Promise.resolve();
  assert.equal(avatarRequests.length, 2);
  api.acknowledgeUserAvatarAssociation("/uploads/avatars/associated.jpg", associationCutoff);

  const oldRejected = assert.rejects(oldUpload, {
    statusCode: 409,
    code: "USER_IMAGE_UPLOAD_SUPERSEDED",
    userMessage: "图片已由已保存内容替代，请重新选择。"
  });
  avatarRequests[0].success({ statusCode: 201, data: { ok: true, data: {
    avatarUrl: "/uploads/avatars/old.jpg", assetId: 801, moderationStatus: "approved"
  } } });
  avatarRequests[1].success({ statusCode: 201, data: { ok: true, data: {
    avatarUrl: "/uploads/avatars/newer.jpg", assetId: 802, moderationStatus: "approved"
  } } });

  await oldRejected;
  assert.equal(await newerUpload, "/uploads/avatars/newer.jpg");
  const pending = Object.values(storage.get("pinche_pending_avatar_asset_id") || {});
  assert.deepEqual(pending.map((record) => record.approvedPath), ["/uploads/avatars/newer.jpg"]);

  const profileSource = await readFile(
    new URL("../src/components/AuthIdentityBar.vue", import.meta.url),
    "utf8"
  );
  const saveProfileBody = extractMethodBody(profileSource, "async saveProfile()");
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  let profileUpdates = 0;
  const toasts = [];
  const saveProfile = new AsyncFunction(
    "uploadUserAvatar",
    "captureUserAvatarAssociationCutoff",
    "updateUserProfile",
    "acknowledgeUserAvatarAssociation",
    "showToast",
    saveProfileBody
  );
  const profileVm = {
    canSaveProfile: true,
    draftGender: "male",
    draftNickname: "Stacked",
    draftAvatarUrl: "/uploads/avatars/authoritative.jpg",
    draftAvatarTempPath: "wxfile://superseded.jpg",
    savingProfile: false
  };
  await saveProfile.call(
    profileVm,
    async () => { throw {
      statusCode: 409,
      code: "USER_IMAGE_UPLOAD_SUPERSEDED",
      userMessage: "图片已由已保存内容替代，请重新选择。"
    }; },
    () => associationCutoff,
    async () => { profileUpdates += 1; },
    () => {},
    (toast) => toasts.push(toast)
  );
  assert.equal(profileUpdates, 0, "superseded avatar must not send an empty profile patch");
  assert.equal(profileVm.savingProfile, false);
  assert.equal(toasts.at(-1)?.title, "图片已由已保存内容替代，请重新选择。");
});

test("review save blocks pending photos without PUT or acknowledgement and keeps approval recoverable", async () => {
  const reviewSource = await readFile(new URL("../src/pages/session/review.vue", import.meta.url), "utf8");
  const saveReviewBody = extractMethodBody(reviewSource, "async saveReview()");
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  let requestCount = 0;
  let acknowledgementCount = 0;
  const saveReview = new AsyncFunction(
    "request",
    "acknowledgeSessionReviewPhotoAssociations",
    "showToast",
    "contentModerationErrorText",
    "setTimeout",
    "uni",
    saveReviewBody
  );
  const vm = {
    canSave: true,
    saving: false,
    pendingPhotoCount: 1,
    statusText: "",
    sessionId: "9",
    rating: 5,
    content: "",
    photos: []
  };
  await saveReview.call(
    vm,
    async () => { requestCount += 1; },
    () => { acknowledgementCount += 1; },
    () => {},
    () => "",
    () => {},
    { navigateBack() {} }
  );
  assert.equal(requestCount, 0);
  assert.equal(acknowledgementCount, 0);
  assert.equal(vm.statusText, PENDING_TEXT);

  const storage = new Map([["pinche_pending_review_image_asset_id", {
    pendingPhoto: {
      assetId: 901,
      ownerUserId: 7,
      sessionId: "9",
      scopeKey: "user:7:session:9"
    }
  }]]);
  globalThis.getApp = () => ({ globalData: {
    apiBaseUrl: "http://127.0.0.1:3029",
    authBaseUrl: "http://127.0.0.1:3029",
    token: "test-token",
    user: { id: 7 },
    roles: []
  } });
  globalThis.wx = {
    getFileSystemManager: () => ({}), canIUse: () => false,
    getStorageSync: () => "", setStorageSync() {}, removeStorageSync() {}
  };
  globalThis.uni = {
    getStorageSync: (key) => storage.get(key) ?? "",
    setStorageSync: (key, value) => storage.set(key, value),
    removeStorageSync: (key) => storage.delete(key),
    request(options) {
      options.success({ statusCode: 200, data: { ok: true, data: {
        assetId: 901,
        status: "active",
        moderationStatus: "approved",
        path: "/uploads/session-reviews/eventual.jpg"
      } } });
    }
  };
  const api = await import(`../src/utils/api.js?pending-review-save=${Date.now()}`);
  assert.deepEqual(await api.recoverPendingSessionReviewPhotos({ sessionId: 9 }), {
    approvedPaths: ["/uploads/session-reviews/eventual.jpg"],
    pendingCount: 0
  });
});

test("backend fallback persists and replays one operation locator across an approved response loss", async () => {
  const storage = new Map();
  const backendOperationIds = [];
  let backendAttempts = 0;
  globalThis.getApp = () => ({
    globalData: {
      apiBaseUrl: "http://127.0.0.1:3029",
      token: "test-token",
      authBaseUrl: "http://127.0.0.1:3029",
      user: { id: 7 },
      roles: []
    }
  });
  globalThis.wx = {
    getFileSystemManager: () => ({}),
    canIUse: () => false,
    getStorageSync: () => "",
    setStorageSync() {},
    removeStorageSync() {}
  };
  globalThis.uni = {
    getStorageSync: (key) => storage.get(key) ?? "",
    setStorageSync: (key, value) => storage.set(key, value),
    removeStorageSync: (key) => storage.delete(key),
    getFileSystemManager: () => ({
      stat({ success }) { success({ stats: { size: 10 } }); },
      readFile({ success }) { success({ data: new ArrayBuffer(10) }); }
    }),
    request(options) {
      const pathname = new URL(options.url).pathname;
      if (pathname === "/api/uploads/cos-intent") {
        options.success({ statusCode: 200, data: { ok: true, data: { upload: { direct: false } } } });
        return;
      }
      if (pathname === "/api/users/me/avatar") {
        const pending = storage.get("pinche_pending_avatar_asset_id");
        const record = Object.values(pending || {})[0];
        assert.ok(record?.backendOperationId);
        backendOperationIds.push(options.header?.["x-user-image-operation-id"]);
        assert.equal(backendOperationIds.at(-1), record.backendOperationId);
        backendAttempts += 1;
        if (backendAttempts === 1) {
          options.fail({ errMsg: "request:fail timeout" });
          return;
        }
        options.success({ statusCode: 201, data: { ok: true, data: {
          avatarUrl: "/uploads/avatars/backend-approved.jpg",
          assetId: 501,
          moderationStatus: "approved"
        } } });
        return;
      }
      if (pathname === "/api/uploads/user-image/operation") {
        options.success({ statusCode: 200, data: { ok: true, data: {
          path: "/uploads/avatars/backend-approved.jpg",
          assetId: 501,
          kind: "avatar",
          status: "active",
          moderationStatus: "approved"
        } } });
        return;
      }
      throw new Error(`unexpected request: ${pathname}`);
    }
  };

  const api = await import(`../src/utils/api.js?backend-operation-replay=${Date.now()}`);
  await assert.rejects(api.uploadUserAvatar("wxfile://backend-avatar.jpg"));
  assert.ok(Object.values(storage.get("pinche_pending_avatar_asset_id") || {})[0]?.backendOperationId);
  api.clearBackendMaintenance();
  assert.equal(
    await api.uploadUserAvatar("wxfile://backend-avatar.jpg"),
    "/uploads/avatars/backend-approved.jpg"
  );
  assert.equal(backendOperationIds.length, 1);
  const approved = Object.values(storage.get("pinche_pending_avatar_asset_id") || {})[0];
  assert.equal(approved.assetId, 501);
  assert.equal(approved.approvedPath, "/uploads/avatars/backend-approved.jpg");
  api.acknowledgeUserAvatarAssociation(approved.approvedPath);
  assert.equal(storage.has("pinche_pending_avatar_asset_id"), false);
});

test("normal review-page recovery resolves a lost backend response by exact session scope", async () => {
  const storage = new Map();
  storage.set("pinche_pending_review_image_asset_id", {
    "lost-review-operation": {
      backendOperationId: "sessionReviewPhoto-lost-operation-123",
      filePath: "wxfile://lost-review.jpg",
      ownerUserId: 7,
      sessionId: "9",
      draftId: "",
      scopeKey: "user:7:session:9"
    }
  });
  globalThis.getApp = () => ({
    globalData: {
      apiBaseUrl: "http://127.0.0.1:3029",
      token: "test-token",
      authBaseUrl: "http://127.0.0.1:3029",
      user: { id: 7 },
      roles: []
    }
  });
  globalThis.wx = {
    getFileSystemManager: () => ({}),
    canIUse: () => false,
    getStorageSync: () => "",
    setStorageSync() {},
    removeStorageSync() {}
  };
  let lookups = 0;
  globalThis.uni = {
    getStorageSync: (key) => storage.get(key) ?? "",
    setStorageSync: (key, value) => storage.set(key, value),
    removeStorageSync: (key) => storage.delete(key),
    request(options) {
      const requestUrl = new URL(options.url);
      assert.equal(requestUrl.pathname, "/api/uploads/user-image/operation");
      assert.equal(requestUrl.searchParams.get("kind"), "sessionReviewPhoto");
      assert.equal(requestUrl.searchParams.get("operationId"), "sessionReviewPhoto-lost-operation-123");
      assert.equal(requestUrl.searchParams.get("scopeKey"), "user:7:session:9");
      lookups += 1;
      options.success({ statusCode: 200, data: { ok: true, data: {
        assetId: 601,
        kind: "review",
        status: "active",
        moderationStatus: "approved",
        path: "/uploads/session-reviews/backend-lost.jpg"
      } } });
    }
  };

  const api = await import(`../src/utils/api.js?backend-review-lookup=${Date.now()}`);
  assert.deepEqual(await api.recoverPendingSessionReviewPhotos({ sessionId: 10 }), {
    approvedPaths: [], pendingCount: 0
  });
  assert.deepEqual(await api.recoverPendingSessionReviewPhotos({ sessionId: 9 }), {
    approvedPaths: ["/uploads/session-reviews/backend-lost.jpg"], pendingCount: 0
  });
  assert.equal(lookups, 1);
  const record = storage.get("pinche_pending_review_image_asset_id")["lost-review-operation"];
  assert.equal(record.assetId, 601);
  assert.equal(record.approvedPath, "/uploads/session-reviews/backend-lost.jpg");
});

test("avatar recovery resolves an accepted backend upload without selecting the local file again", async () => {
  const storage = new Map();
  storage.set("pinche_pending_avatar_asset_id", {
    "lost-avatar-operation": {
      backendOperationId: "avatar-lost-operation-123",
      filePath: "wxfile://lost-avatar.jpg",
      ownerUserId: 7,
      scopeKey: "user:7:avatar"
    }
  });
  globalThis.getApp = () => ({ globalData: {
    apiBaseUrl: "http://127.0.0.1:3029", token: "test-token",
    authBaseUrl: "http://127.0.0.1:3029", user: { id: 7 }, roles: []
  } });
  globalThis.wx = {
    getFileSystemManager: () => ({}), canIUse: () => false,
    getStorageSync: () => "", setStorageSync() {}, removeStorageSync() {}
  };
  globalThis.uni = {
    getStorageSync: (key) => storage.get(key) ?? "",
    setStorageSync: (key, value) => storage.set(key, value),
    removeStorageSync: (key) => storage.delete(key),
    request(options) {
      const requestUrl = new URL(options.url);
      assert.equal(requestUrl.pathname, "/api/uploads/user-image/operation");
      assert.equal(requestUrl.searchParams.get("kind"), "avatar");
      assert.equal(requestUrl.searchParams.get("scopeKey"), "user:7:avatar");
      options.success({ statusCode: 200, data: { ok: true, data: {
        assetId: 602,
        kind: "avatar",
        status: "active",
        moderationStatus: "approved_legacy",
        path: "/uploads/avatars/backend-lost.webp"
      } } });
    }
  };

  const api = await import(`../src/utils/api.js?backend-avatar-lookup=${Date.now()}`);
  assert.equal(
    await api.recoverPendingUserAvatar(),
    "/uploads/avatars/backend-lost.webp"
  );
  assert.equal(
    storage.get("pinche_pending_avatar_asset_id")["lost-avatar-operation"].assetId,
    602
  );
});

test("terminal backend operation lookups are forgotten and cannot poison a fresh upload", async () => {
  for (const terminal of ["missing", "configuration", "deleted"]) {
    const storage = new Map();
    const oldOperationId = `avatar-old-${terminal}-operation`;
    storage.set("pinche_pending_avatar_asset_id", {
      "old-avatar-operation": {
        backendOperationId: oldOperationId,
        filePath: "wxfile://fresh-avatar.jpg",
        ownerUserId: 7,
        scopeKey: "user:7:avatar"
      }
    });
    globalThis.getApp = () => ({ globalData: {
      apiBaseUrl: "http://127.0.0.1:3029", token: "test-token",
      authBaseUrl: "http://127.0.0.1:3029", user: { id: 7 }, roles: []
    } });
    globalThis.wx = {
      getFileSystemManager: () => ({
        stat({ success }) { success({ stats: { size: 10 } }); },
        readFile({ success }) { success({ data: new ArrayBuffer(10) }); }
      }),
      canIUse: () => false,
      getStorageSync: () => "", setStorageSync() {}, removeStorageSync() {}
    };
    let freshOperationId = "";
    globalThis.uni = {
      getStorageSync: (key) => storage.get(key) ?? "",
      setStorageSync: (key, value) => storage.set(key, value),
      removeStorageSync: (key) => storage.delete(key),
      getFileSystemManager: () => ({
        stat({ success }) { success({ stats: { size: 10 } }); },
        readFile({ success }) { success({ data: new ArrayBuffer(10) }); }
      }),
      request(options) {
        const pathname = new URL(options.url).pathname;
        if (pathname === "/api/uploads/user-image/operation") {
          if (terminal === "deleted") {
            options.success({ statusCode: 200, data: { ok: true, data: {
              assetId: 603, kind: "avatar", status: "deleted", moderationStatus: "approved"
            } } });
          } else {
            options.success({ statusCode: terminal === "missing" ? 404 : 500, data: {
              ok: false,
              error: {
                code: terminal === "missing" ? "NOT_FOUND" : "CONTENT_MODERATION_CONFIGURATION_ERROR",
                message: "terminal operation"
              }
            } });
          }
          return;
        }
        if (pathname === "/api/uploads/cos-intent") {
          options.success({ statusCode: 200, data: { ok: true, data: { upload: { direct: false } } } });
          return;
        }
        if (pathname === "/api/users/me/avatar") {
          freshOperationId = options.header?.["x-user-image-operation-id"] || "";
          options.success({ statusCode: 201, data: { ok: true, data: {
            avatarUrl: "/uploads/avatars/fresh.webp",
            assetId: 604,
            moderationStatus: "approved_legacy"
          } } });
          return;
        }
        throw new Error(`unexpected request: ${pathname}`);
      }
    };

    const api = await import(`../src/utils/api.js?backend-terminal-${terminal}-${Date.now()}`);
    assert.equal(await api.recoverPendingUserAvatar(), "");
    assert.equal(storage.has("pinche_pending_avatar_asset_id"), false);
    assert.equal(
      await api.uploadUserAvatar("wxfile://fresh-avatar.jpg"),
      "/uploads/avatars/fresh.webp"
    );
    assert.ok(freshOperationId);
    assert.notEqual(freshOperationId, oldOperationId);
  }
});
