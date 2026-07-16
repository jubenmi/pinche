import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  assertD46IsolatedSmokeEnvironment,
  buildD46IsolatedSmokeImageUrl,
  createD46IsolatedSmokeModerationClient
} from "../apps/api/src/modules/content-moderation/d46-isolated-smoke.js";

// This guard intentionally runs before any network, database, filesystem, or
// child-process work.  The script is not a production smoke command.
assertD46IsolatedSmokeEnvironment(process.env);

const { default: mysql } = await import("mysql2/promise");
const { assertLocalAlbumCleanupPath } = await import("../apps/api/src/modules/album-image/cleanup.js");

const BASE_URL = "http://127.0.0.1:3046";
const TARGET_PATH = "/api/testing/d46-smoke-target";
const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const API_ROOT = path.join(REPOSITORY_ROOT, "apps", "api");
const LOCAL_UPLOAD_ROOT = path.join(API_ROOT, "uploads");

const MYSQL_OPTIONS = Object.freeze({
  host: "127.0.0.1",
  port: 3346,
  database: "pinche_d46_test",
  user: "pinche_d46",
  password: "pinche_d46_local_only"
});
const D46_FIXTURE_LOCK_NAME = "pinche-d46-isolated-acceptance";

const WECHAT_APP_ID = "wx-d46-local";
const WECHAT_CALLBACK_TOKEN = "d46-local-wechat-callback-token-0000000000";
// Base64 for a harmless 32-byte local test value, without trailing padding.
const WECHAT_CALLBACK_AES_KEY = "YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXowMTIzNDU";
const WECHAT_IMAGE_CALLBACK_SUGGESTIONS = new Set(["review", "risky"]);
const TENCENT_CALLBACK_TOKEN = "d46-local-video-callback-token-0000000000";

// The cleanup process gets a complete literal environment.  In particular it
// never inherits a shell, cloud credential, database URL, or production gate.
const LOCAL_WORKER_ENV = Object.freeze({
  NODE_ENV: "test",
  PORT: "3046",
  APP_BASE_URL: "http://127.0.0.1:3046",
  D46_SMOKE_ISOLATED: "1",
  MYSQL_HOST: "127.0.0.1",
  MYSQL_PORT: "3346",
  MYSQL_DATABASE: "pinche_d46_test",
  MYSQL_USER: "pinche_d46",
  MYSQL_PASSWORD: "pinche_d46_local_only",
  REDIS_ENABLED: "true",
  REDIS_URL: "redis://127.0.0.1:6446/15",
  WECHAT_MOCK_LOGIN: "true",
  WECHAT_APP_ID,
  WECHAT_APP_SECRET: "d46-local-placeholder",
  WECHAT_CONTENT_SECURITY_EVENT_TOKEN: WECHAT_CALLBACK_TOKEN,
  WECHAT_CONTENT_SECURITY_EVENT_AES_KEY: WECHAT_CALLBACK_AES_KEY,
  SESSION_SECRET: "d46-local-session-secret-at-least-32-characters",
  CONTACT_ENCRYPTION_KEY: "d46-local-contact-key-at-least-32-characters",
  BOOTSTRAP_ADMIN_OPENIDS: "dev-d46-admin",
  COS_ENABLED: "false",
  COS_DIRECT_MEDIA_URLS: "false",
  COS_DIRECT_UPLOAD_REQUIRED: "false",
  COS_SECRET_ID: "d46-local-fake-id",
  COS_SECRET_KEY: "d46-local-fake-key",
  COS_BUCKET: "d46-local-fake-bucket",
  COS_REGION: "ap-nanjing",
  CONTENT_MODERATION_ENABLED: "true",
  CONTENT_MODERATION_WECHAT_TEXT_ENABLED: "true",
  CONTENT_MODERATION_WECHAT_IMAGE_ENABLED: "true",
  CONTENT_MODERATION_TENCENT_VIDEO_ENABLED: "true",
  CONTENT_MODERATION_TEXT_INTAKE_MODE: "moderated",
  CONTENT_MODERATION_IMAGE_INTAKE_MODE: "moderated",
  CONTENT_MODERATION_VIDEO_INTAKE_MODE: "moderated",
  CONTENT_MODERATION_AUTHOR_PRIVATE_TEXT_ENABLED: "true",
  CONTENT_MODERATION_AUTHOR_PRIVATE_TEXT_ACTIONS: "create_private_store",
  CONTENT_MODERATION_AUTHOR_PRIVATE_IMAGE_ENABLED: "true",
  CONTENT_MODERATION_AUTHOR_PRIVATE_VIDEO_ENABLED: "true",
  CONTENT_MODERATION_AUTHOR_PREVIEW_TTL_SECONDS: "60",
  TENCENT_CI_VIDEO_REGION: "ap-nanjing",
  TENCENT_CI_VIDEO_BIZ_TYPE: "d46-local-fake-policy",
  TENCENT_CI_VIDEO_CALLBACK_URL:
    "http://127.0.0.1:3046/api/internal/content-moderation/tencent-video/callback",
  TENCENT_CI_VIDEO_CALLBACK_TOKEN: TENCENT_CALLBACK_TOKEN,
  TENCENT_CI_VIDEO_CALLBACK_PREVIOUS_TOKEN: "",
  COS_CI_CALLBACK_TOKEN: "",
  CONTENT_MODERATION_PRODUCTION_PREFLIGHT_ENABLED: "false",
  CONTENT_MODERATION_ORPHAN_SCAN_ENABLED: "false",
  CONTENT_MODERATION_ORPHAN_CLEANUP_ENABLED: "false",
  CONTENT_MODERATION_PRODUCTION_PREFLIGHT_CONFIRMATION: "",
  CONTENT_MODERATION_PRODUCTION_PREFLIGHT_OPERATOR_USER_ID: "",
  CONTENT_MODERATION_PRODUCTION_PREFLIGHT_TEST_ADMIN_USER_ID: "",
  CONTENT_MODERATION_PRODUCTION_PREFLIGHT_REFERENCE_HMAC_KEY: "",
  CONTENT_MODERATION_PRODUCTION_PREFLIGHT_IMAGE_FINGERPRINT: "",
  CONTENT_MODERATION_PRODUCTION_PREFLIGHT_VIDEO_FINGERPRINT: "",
  CONTENT_MODERATION_PRODUCTION_PREFLIGHT_RELEASE_FINGERPRINT: "",
  D45_PREFLIGHT_CONFIRMATION: "",
  TENCENT_MAP_SERVICE_KEY: "",
  TENCENT_MAP_KEY: "",
  VITE_TENCENT_MAP_KEY: "",
  AMAP_WEB_SERVICE_KEY: "",
  GAODE_MAP_KEY: "",
  WECHAT_SUBSCRIBE_MESSAGE_ENABLED: "false",
  WECHAT_SUBSCRIBE_TEMPLATE_SIGNUP_CREATED: "",
  WECHAT_SUBSCRIBE_TEMPLATE_SIGNUP_REVIEWED: "",
  WECHAT_SUBSCRIBE_SESSION_RESCHEDULED_TEMPLATE_ID: ""
});

const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9rKJ0AAAAASUVORK5CYII=",
  "base64"
);
const MP4_FTYP = Buffer.from([
  0x00, 0x00, 0x00, 0x10,
  0x66, 0x74, 0x79, 0x70,
  0x69, 0x73, 0x6f, 0x6d,
  0x00, 0x00, 0x00, 0x00
]);

function smokeFailure() {
  return new Error("D46 isolated HTTP acceptance assertion failed");
}

function expect(condition) {
  if (!condition) throw smokeFailure();
}

function asPositiveId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function randomFixture() {
  const prefix = `d46-smoke-${Date.now()}-${crypto.randomBytes(6).toString("hex")}`;
  return {
    prefix,
    textReview: `[d46:review] ${prefix}`,
    textBlock: `[d46:block] ${prefix}`,
    textReplacement: `[d46:review] ${prefix}-replacement`,
    userIds: new Set(),
    jobIds: new Set(),
    attemptIds: new Set(),
    proposalIds: new Set(),
    mediaIds: new Set(),
    cleanupJobIds: new Set(),
    localPaths: new Set(),
    systemAdminRoleSnapshots: new Map(),
    authorId: null,
    setupTextProposalHighWaterMark: null,
    authorPhoneSnapshot: null,
    storeId: null,
    scriptId: null,
    sessionId: null,
    seatId: null
  };
}

const AUTHOR_PRIVATE_PREVIEW_PATH =
  /\/api\/(?:content-moderation\/author-media\/images|testing\/d46-smoke\/author-media\/videos)\//;

function cacheControl(result) {
  return String(result.headers.get("cache-control") || "").toLowerCase();
}

function assertPrivateNoStore(result) {
  expect(cacheControl(result) === "private, no-store");
}

function walkResponse(value, visitor, key = "") {
  visitor(value, key);
  if (Array.isArray(value)) {
    for (const item of value) walkResponse(item, visitor, "");
  } else if (value && typeof value === "object") {
    for (const [childKey, childValue] of Object.entries(value)) {
      walkResponse(childValue, visitor, childKey);
    }
  }
}

function assertNoPrivateLeak(value, { markers = [], mediaIds = [], previewUrls = [] } = {}) {
  const forbiddenKeys = new Set(["draft_id", "content_ref", "preview_url"]);
  const mediaIdSet = new Set(mediaIds.map((id) => String(id)));
  walkResponse(value, (node, key) => {
    if (forbiddenKeys.has(key)) throw smokeFailure();
    if (key === "publication_state" && node === "author_only") throw smokeFailure();
    if (key === "id" && mediaIdSet.has(String(node))) throw smokeFailure();
    if (typeof node === "string") {
      // A non-author response must never carry either author preview route,
      // regardless of its JSON field name or a freshly re-signed token.
      if (AUTHOR_PRIVATE_PREVIEW_PATH.test(node)) throw smokeFailure();
      for (const marker of markers) {
        if (marker && node.includes(marker)) throw smokeFailure();
      }
      for (const url of previewUrls) {
        if (url && node.includes(url)) throw smokeFailure();
      }
    }
  });
}

async function request(method, requestPath, options = {}) {
  const headers = new Headers(options.headers || {});
  if (options.token) headers.set("authorization", `Bearer ${options.token}`);
  let body;
  if (options.json !== undefined) {
    headers.set("content-type", "application/json");
    body = JSON.stringify(options.json);
  } else {
    body = options.body;
  }

  let response;
  let rawBody;
  let bytes = null;
  try {
    response = await fetch(`${BASE_URL}${requestPath}`, {
      method,
      headers,
      body,
      signal: AbortSignal.timeout(30_000)
    });
    if (options.binary === true) {
      bytes = Buffer.from(await response.arrayBuffer());
    } else {
      rawBody = await response.text();
    }
  } catch {
    throw smokeFailure();
  }

  let payload = null;
  if (rawBody) {
    try {
      payload = JSON.parse(rawBody);
    } catch {
      throw smokeFailure();
    }
  }
  const expected = options.expected || [200];
  if (!expected.includes(response.status)) throw smokeFailure();
  return { status: response.status, headers: response.headers, payload, data: payload?.data, bytes };
}

async function login(code) {
  const result = await request("POST", "/api/auth/wechat/login", {
    json: { code },
    expected: [200]
  });
  expect(result.data && typeof result.data.token === "string" && asPositiveId(result.data.user?.id));
  return result.data;
}

async function authorizePhone(auth, code) {
  const result = await request("POST", "/api/auth/wechat/phone", {
    token: auth.token,
    json: { code },
    expected: [200]
  });
  expect(result.data?.user && Array.isArray(result.data.roles));
  return { ...auth, user: result.data.user, roles: result.data.roles };
}

function mysqlConnection() {
  return mysql.createConnection(MYSQL_OPTIONS);
}

async function acquireD46FixtureLock(database) {
  const [rows] = await database.query(
    "SELECT GET_LOCK(?, 0) AS acquired",
    [D46_FIXTURE_LOCK_NAME]
  );
  expect(Number(rows[0]?.acquired) === 1);
}

async function releaseD46FixtureLock(database) {
  const [rows] = await database.query(
    "SELECT RELEASE_LOCK(?) AS released",
    [D46_FIXTURE_LOCK_NAME]
  );
  expect(Number(rows[0]?.released) === 1);
}

function localUploadFile(localPath) {
  const normalized = assertLocalAlbumCleanupPath(localPath);
  const relative = normalized.slice("/uploads/".length);
  const resolved = path.resolve(LOCAL_UPLOAD_ROOT, relative);
  expect(resolved.startsWith(`${LOCAL_UPLOAD_ROOT}${path.sep}`));
  return resolved;
}

async function assertFileMissing(localPath) {
  const file = localUploadFile(localPath);
  try {
    await fs.access(file);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw smokeFailure();
  }
  throw smokeFailure();
}

async function unlinkTrackedLocalFile(localPath) {
  const file = localUploadFile(localPath);
  try {
    await fs.unlink(file);
  } catch (error) {
    if (error?.code !== "ENOENT") throw smokeFailure();
  }
}

function startAtBeforeNow() {
  return new Date(Date.now() - 10 * 60 * 1000)
    .toISOString()
    .slice(0, 19)
    .replace("T", " ");
}

function createWechatEncryptedCallback(traceId, { suggestion } = {}) {
  if (!WECHAT_IMAGE_CALLBACK_SUGGESTIONS.has(suggestion)) throw smokeFailure();
  const event = JSON.stringify({
    MsgType: "event",
    Event: "wxa_media_check",
    trace_id: traceId,
    version: 2,
    result: { suggest: suggestion, label: "normal", score: 100 }
  });
  const message = Buffer.from(event, "utf8");
  const prefix = crypto.randomBytes(16);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(message.length, 0);
  const plain = Buffer.concat([prefix, length, message, Buffer.from(WECHAT_APP_ID, "utf8")]);
  const paddingLength = 32 - (plain.length % 32 || 32);
  const padded = Buffer.concat([plain, Buffer.alloc(paddingLength || 32, paddingLength || 32)]);
  const key = Buffer.from(`${WECHAT_CALLBACK_AES_KEY}=`, "base64");
  const cipher = crypto.createCipheriv("aes-256-cbc", key, key.subarray(0, 16));
  cipher.setAutoPadding(false);
  const encrypt = Buffer.concat([cipher.update(padded), cipher.final()]).toString("base64");
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = crypto.randomBytes(8).toString("hex");
  const signature = crypto.createHash("sha1")
    .update([WECHAT_CALLBACK_TOKEN, timestamp, nonce, encrypt].sort().join(""), "utf8")
    .digest("hex");
  return { timestamp, nonce, signature, body: { Encrypt: encrypt } };
}

async function runCleanupWorkerOnce(cleanupJobId) {
  const jobId = asPositiveId(cleanupJobId);
  expect(jobId);
  const result = spawnSync(process.execPath, ["scripts/d46-fixture-cleanup.mjs", String(jobId)], {
    cwd: REPOSITORY_ROOT,
    env: LOCAL_WORKER_ENV,
    stdio: "pipe",
    timeout: 60_000
  });
  if (result.error || result.status !== 0) throw smokeFailure();
}

async function ensureLocalSystemAdmin(database, fixture, userId) {
  const normalizedUserId = asPositiveId(userId);
  expect(normalizedUserId);
  const [rows] = await database.query(
    "SELECT id, status FROM user_roles WHERE user_id = ? AND role = 'system_admin' LIMIT 1",
    [normalizedUserId]
  );
  if (rows[0]?.status === "active") return;
  if (!fixture.systemAdminRoleSnapshots.has(normalizedUserId)) {
    fixture.systemAdminRoleSnapshots.set(normalizedUserId, rows[0]?.status || null);
  }
  if (rows[0]) {
    await database.query(
      "UPDATE user_roles SET status = 'active' WHERE id = ? AND user_id = ?",
      [rows[0].id, normalizedUserId]
    );
  } else {
    await database.query(
      "INSERT INTO user_roles (user_id, role, status) VALUES (?, 'system_admin', 'active')",
      [normalizedUserId]
    );
  }
}

async function snapshotAuthorPhone(database, fixture, userId) {
  const normalizedUserId = asPositiveId(userId);
  expect(normalizedUserId);
  const [rows] = await database.query(
    `SELECT id, phone_encrypted, phone_verified_at
     FROM users
     WHERE id = ? AND open_id = 'dev-d46-admin'
     LIMIT 1`,
    [normalizedUserId]
  );
  const author = rows[0];
  expect(author && Number(author.id) === normalizedUserId);
  fixture.authorPhoneSnapshot = {
    userId: normalizedUserId,
    phoneEncrypted: author.phone_encrypted ?? null,
    phoneVerifiedAt: author.phone_verified_at ?? null
  };
}

async function captureAuthorRoleStatus(database, fixture, role) {
  const [rows] = await database.query(
    "SELECT status FROM user_roles WHERE user_id = ? AND role = ? LIMIT 1",
    [fixture.authorId, role]
  );
  fixture[`authorRoleBefore_${role}`] = rows[0]?.status || null;
}

async function currentAuthorTextProposalHighWaterMark(database, authorId) {
  const normalizedAuthorId = asPositiveId(authorId);
  expect(normalizedAuthorId);
  const [rows] = await database.query(
    `SELECT COALESCE(MAX(id), 0) AS high_water_mark
     FROM content_moderation_text_proposals
     WHERE created_by_user_id = ?`,
    [normalizedAuthorId]
  );
  const highWaterMark = Number(rows[0]?.high_water_mark || 0);
  expect(Number.isSafeInteger(highWaterMark) && highWaterMark >= 0);
  return highWaterMark;
}

async function collectNewAuthorTextProposals(database, fixture, highWaterMark) {
  const authorId = asPositiveId(fixture.authorId);
  const normalizedHighWaterMark = Number(highWaterMark);
  expect(authorId && Number.isSafeInteger(normalizedHighWaterMark) && normalizedHighWaterMark >= 0);
  // The dedicated D46 database has one acceptance writer.  We still retain
  // only exact row IDs born after this fixture's snapshot, never a user-wide
  // or prefix-based cleanup range.
  const [proposals] = await database.query(
    `SELECT id, moderation_job_id
     FROM content_moderation_text_proposals
     WHERE created_by_user_id = ? AND id > ?`,
    [authorId, normalizedHighWaterMark]
  );
  addTrackedRows(fixture.proposalIds, proposals);
  addTrackedRows(fixture.jobIds, proposals, "moderation_job_id");
}

async function createMediaFixture(author, fixture) {
  const store = await request("POST", "/api/admin/stores", {
    token: author.token,
    json: {
      name: `${fixture.prefix} catalog-store`,
      city: "南京",
      district: "鼓楼",
      address: "D46 isolated local fixture",
      latitude: 32.0603,
      longitude: 118.7969,
      status: "active"
    },
    expected: [201]
  });
  fixture.storeId = asPositiveId(store.data?.id);
  expect(fixture.storeId);

  const script = await request("POST", "/api/admin/scripts", {
    token: author.token,
    json: {
      name: `${fixture.prefix} catalog-script`,
      typeTags: ["情感"],
      playerCount: 2,
      summaryNoSpoiler: "D46 isolated local fixture",
      defaultSeatTemplate: [{
        name: "D46 seat",
        seatType: "normal",
        roleName: "D46 role",
        basePrice: 0,
        adjustment: 0
      }],
      status: "active"
    },
    expected: [201]
  });
  fixture.scriptId = asPositiveId(script.data?.id);
  expect(fixture.scriptId);

  const session = await request("POST", "/api/sessions", {
    token: author.token,
    json: {
      storeId: fixture.storeId,
      scriptId: fixture.scriptId,
      startAt: startAtBeforeNow(),
      visibility: "public",
      joinPolicy: "direct",
      joinPhoneRequired: true,
      depositAmount: 0,
      note: "D46 isolated local fixture"
    },
    expected: [201]
  });
  fixture.sessionId = asPositiveId(session.data?.id);
  expect(fixture.sessionId);

  const seat = await request("POST", `/api/sessions/${fixture.sessionId}/seats`, {
    token: author.token,
    json: {
      name: "D46 seat",
      seatType: "normal",
      roleName: "D46 role",
      basePrice: 0,
      adjustment: 0
    },
    expected: [201]
  });
  fixture.seatId = asPositiveId(seat.data?.id);
  expect(fixture.seatId);
  await request("POST", `/api/sessions/${fixture.sessionId}/publish`, {
    token: author.token,
    json: {},
    expected: [200]
  });
}

async function createAlbumShare(member, fixture) {
  const claim = await request("POST", `/api/session-seats/${fixture.seatId}/claim`, {
    token: member.token,
    json: { note: "D46 isolated member" },
    expected: [200]
  });
  expect(claim.data?.join_result === "joined");
  const issued = await request("POST", `/api/sessions/${fixture.sessionId}/album/share-token`, {
    token: member.token,
    json: {},
    expected: [200]
  });
  const token = String(issued.data?.token || "");
  expect(token.length > 20);
  return token;
}

async function getAlbum(token, sessionId, expected = [200]) {
  return request("GET", `/api/sessions/${sessionId}/album`, {
    token,
    expected
  });
}

async function publicAlbum(sessionId, token, expected = [200]) {
  return request("GET", `/api/sessions/${sessionId}/album/public-share?token=${encodeURIComponent(token)}`, {
    expected
  });
}

async function assertAuthorDraftAbsent(author, draftId) {
  const stores = await request("GET", "/api/stores", {
    token: author.token,
    expected: [200]
  });
  const entries = Array.isArray(stores.data) ? stores.data : [];
  expect(!entries.some((entry) => Number(entry?.draft_id) === Number(draftId)));
}

function authorMediaById(album, mediaId) {
  const entries = Array.isArray(album.data?.media) ? album.data.media : album.data?.photos;
  return Array.isArray(entries)
    ? entries.find((entry) => Number(entry?.id) === Number(mediaId)) || null
    : null;
}

async function assertMediaHiddenFromNonAuthors({ fixture, member, observer, shareToken, mediaIds, markers, previewUrls }) {
  const candidates = [
    await getAlbum(member.token, fixture.sessionId),
    await getAlbum(observer.token, fixture.sessionId, [200, 403, 404]),
    await publicAlbum(fixture.sessionId, shareToken)
  ];
  for (const candidate of candidates) {
    assertNoPrivateLeak(candidate.payload, { markers, mediaIds, previewUrls });
    const visible = Array.isArray(candidate.data?.media) ? candidate.data.media : candidate.data?.photos;
    if (Array.isArray(visible)) {
      for (const id of mediaIds) expect(!visible.some((entry) => Number(entry?.id) === Number(id)));
    }
  }
}

async function assertImageHiddenFromNonAuthors({
  fixture,
  member,
  observer,
  shareToken,
  imageId,
  previewUrls
}) {
  const markers = [fixture.textReview, fixture.textBlock, fixture.textReplacement];
  await assertMediaHiddenFromNonAuthors({
    fixture,
    member,
    observer,
    shareToken,
    mediaIds: [imageId],
    markers,
    previewUrls
  });
  for (const response of [
    await request("GET", `/api/session-album/photos/${imageId}/image`, { expected: [401, 404] }),
    await request("GET", `/api/session-album/public-share/photos/${imageId}/image`, {
      expected: [401, 403, 404]
    })
  ]) {
    assertNoPrivateLeak(response.payload, { mediaIds: [imageId], markers, previewUrls });
  }
}

async function runTextAcceptance({ author, member, observer, fixture, database }) {
  const review = await request("POST", "/api/stores", {
    token: author.token,
    json: {
      name: fixture.textReview,
      city: "南京",
      district: "鼓楼",
      address: "D46 review fixture",
      latitude: 32.0603,
      longitude: 118.7969
    },
    expected: [202]
  });
  assertPrivateNoStore(review);
  expect(review.data?.publication_state === "author_only");
  const reviewDraftId = asPositiveId(review.data?.draft_id);
  expect(reviewDraftId);
  fixture.proposalIds.add(reviewDraftId);

  const authorStores = await request("GET", "/api/stores", {
    token: author.token,
    expected: [200]
  });
  assertPrivateNoStore(authorStores);
  expect(Array.isArray(authorStores.data));
  expect(authorStores.data.some((entry) => Number(entry?.draft_id) === reviewDraftId));

  for (const response of [
    await request("GET", "/api/stores", { token: member.token, expected: [200] }),
    await request("GET", "/api/stores", { token: observer.token, expected: [200] }),
    await request("GET", "/api/stores", { expected: [200] })
  ]) {
    assertNoPrivateLeak(response.payload, { markers: [fixture.textReview, fixture.textBlock, fixture.textReplacement] });
  }

  const cancelled = await request("DELETE", `/api/content-moderation/author-drafts/${reviewDraftId}`, {
    token: author.token,
    expected: [200]
  });
  assertPrivateNoStore(cancelled);
  expect(cancelled.data?.status === "cancelled");
  await assertAuthorDraftAbsent(author, reviewDraftId);

  const rejected = await request("POST", "/api/stores", {
    token: author.token,
    json: {
      name: fixture.textBlock,
      city: "南京",
      district: "鼓楼",
      address: "D46 rejected fixture",
      latitude: 32.0603,
      longitude: 118.7969
    },
    expected: [202]
  });
  assertPrivateNoStore(rejected);
  expect(rejected.data?.moderation_status === "rejected");
  const rejectedDraftId = asPositiveId(rejected.data?.draft_id);
  expect(rejectedDraftId);
  fixture.proposalIds.add(rejectedDraftId);

  const replacement = await request("POST", "/api/stores", {
    token: author.token,
    json: {
      name: fixture.textReplacement,
      city: "南京",
      district: "鼓楼",
      address: "D46 replacement fixture",
      latitude: 32.0603,
      longitude: 118.7969,
      replacesDraftId: rejectedDraftId
    },
    expected: [202]
  });
  assertPrivateNoStore(replacement);
  activeStage = "text-replacement-response";
  const replacementDraftId = asPositiveId(replacement.data?.draft_id);
  expect(replacementDraftId);
  fixture.proposalIds.add(replacementDraftId);

  activeStage = "text-replacement-link";
  const [rows] = await database.query(
    "SELECT status, moderation_job_id FROM content_moderation_text_proposals WHERE id = ? AND created_by_user_id = ?",
    [rejectedDraftId, fixture.authorId]
  );
  expect(rows.length === 1 && rows[0].status === "superseded");
  activeStage = "text-replacement-jobs";
  const [proposalJobs] = await database.query(
    "SELECT moderation_job_id FROM content_moderation_text_proposals WHERE id IN (?, ?, ?)",
    [reviewDraftId, rejectedDraftId, replacementDraftId]
  );
  for (const row of proposalJobs) fixture.jobIds.add(Number(row.moderation_job_id));

  activeStage = "text-replacement-cancel";
  const replacementCancelled = await request(
    "DELETE",
    `/api/content-moderation/author-drafts/${replacementDraftId}`,
    { token: author.token, expected: [200] }
  );
  assertPrivateNoStore(replacementCancelled);
  expect(replacementCancelled.data?.status === "cancelled");
  await assertAuthorDraftAbsent(author, replacementDraftId);

  activeStage = "text-final-state";
  const [stores] = await database.query(
    "SELECT id FROM stores WHERE name IN (?, ?, ?)",
    [fixture.textReview, fixture.textBlock, fixture.textReplacement]
  );
  expect(stores.length === 0);
}

async function addImageModerationFixture(database, fixture, imageId, authorId) {
  const [mediaRows] = await database.query(
    `SELECT id, session_id, uploader_user_id, photo_url, image_byte_size,
            moderation_status, author_visibility_version, object_key
     FROM session_album_photos
     WHERE id = ? AND session_id = ? AND uploader_user_id = ?
       AND media_type = 'image' AND status = 'active'`,
    [imageId, fixture.sessionId, authorId]
  );
  const media = mediaRows[0];
  expect(media && media.moderation_status === "pending" && Number(media.author_visibility_version) === 1);
  expect(!media.object_key && typeof media.photo_url === "string");
  fixture.localPaths.add(media.photo_url);

  const fileName = path.basename(media.photo_url);
  const objectKey = `uploads/session-album/display/${fileName}`;
  const version = `d46-image-${fixture.prefix}-${crypto.randomBytes(6).toString("hex")}`;
  const client = createD46IsolatedSmokeModerationClient(true);
  const checked = await client.checkImage({
    mediaUrl: buildD46IsolatedSmokeImageUrl(objectKey)
  });
  const traceId = String(checked.traceId || "");
  expect(/^d46-image-[a-f0-9]{32}$/.test(traceId));

  const [updated] = await database.query(
    `UPDATE session_album_photos
     SET object_key = ?, object_etag = ?, moderation_object_version = ?
     WHERE id = ? AND session_id = ? AND uploader_user_id = ?
       AND media_type = 'image' AND status = 'active'
       AND moderation_status = 'pending' AND object_key IS NULL
       AND author_visibility_version = 1`,
    [objectKey, version, version, imageId, fixture.sessionId, authorId]
  );
  expect(Number(updated.affectedRows) === 1);

  const dataId = `${fixture.prefix}-image-${crypto.randomBytes(6).toString("hex")}`;
  const [job] = await database.query(
    `INSERT INTO content_moderation_jobs
       (subject_type, subject_id, subject_version, provider, provider_job_id, data_id,
        status, attempt_count, submitted_at)
     VALUES ('album_image', ?, ?, 'wechat_sec_check', ?, ?, 'processing', 1, CURRENT_TIMESTAMP)`,
    [String(imageId), version, traceId, dataId]
  );
  const jobId = asPositiveId(job.insertId);
  expect(jobId);
  fixture.jobIds.add(jobId);
  await database.query(
    `INSERT INTO content_moderation_provider_attempts
       (moderation_job_id, provider, provider_job_id, attempt_no, is_current, response_summary_json)
     VALUES (?, 'wechat_sec_check', ?, 1, 1, ?)`,
    [jobId, traceId, JSON.stringify({ traceId })]
  );
  return { objectKey, version, traceId, jobId, photoUrl: media.photo_url };
}

async function runImageAcceptance({ author, member, observer, fixture, database, shareToken }) {
  activeStage = "image-upload";
  const form = new FormData();
  form.set("photo", new Blob([PNG_1X1], { type: "image/png" }), `${fixture.prefix}.png`);
  const upload = await request("POST", `/api/sessions/${fixture.sessionId}/album/uploads`, {
    token: author.token,
    body: form,
    expected: [201]
  });
  const photoUrl = String(upload.data?.photoUrl || "");
  expect(/^\/uploads\/session-album\/display\/[A-Za-z0-9._-]+\.jpg$/.test(photoUrl));
  fixture.localPaths.add(photoUrl);

  activeStage = "image-create";
  const created = await request("POST", `/api/sessions/${fixture.sessionId}/album/photos`, {
    token: author.token,
    json: { photoUrl },
    expected: [201]
  });
  activeStage = "image-create-response";
  assertPrivateNoStore(created);
  activeStage = "image-create-payload";
  const imageId = asPositiveId(created.data?.id);
  expect(imageId && created.data?.publication_state === "author_only");
  fixture.mediaIds.add(imageId);

  activeStage = "image-pending-album";
  const pendingAuthorAlbum = await getAlbum(author.token, fixture.sessionId);
  assertPrivateNoStore(pendingAuthorAlbum);
  const pendingAuthorImage = authorMediaById(pendingAuthorAlbum, imageId);
  expect(pendingAuthorImage?.publication_state === "author_only");
  const pendingImagePreviewUrl = String(
    pendingAuthorImage?.preview_display_url || pendingAuthorImage?.preview_url || ""
  );
  expect(pendingImagePreviewUrl.startsWith("/api/content-moderation/author-media/images/"));
  activeStage = "image-pending-preview";
  const pendingImagePreview = await request("GET", pendingImagePreviewUrl, { expected: [200], binary: true });
  assertPrivateNoStore(pendingImagePreview);
  expect(Buffer.isBuffer(pendingImagePreview.bytes) && pendingImagePreview.bytes.length > 0);

  const adapted = await addImageModerationFixture(database, fixture, imageId, fixture.authorId);
  const callback = createWechatEncryptedCallback(adapted.traceId, { suggestion: "review" });
  const response = await request(
    "POST",
    `/api/internal/content-moderation/wechat-image/callback?msg_signature=${encodeURIComponent(callback.signature)}&timestamp=${encodeURIComponent(callback.timestamp)}&nonce=${encodeURIComponent(callback.nonce)}`,
    { json: callback.body, expected: [200] }
  );
  expect(response.data?.status === "review");

  const reviewAuthorAlbum = await getAlbum(author.token, fixture.sessionId);
  assertPrivateNoStore(reviewAuthorAlbum);
  const reviewAuthorImage = authorMediaById(reviewAuthorAlbum, imageId);
  expect(reviewAuthorImage?.publication_state === "author_only");
  const expiresAt = Date.parse(String(reviewAuthorImage?.media_url_expires_at || ""));
  const expiresInMilliseconds = expiresAt - Date.now();
  expect(Number.isFinite(expiresAt) && expiresInMilliseconds >= 0 && expiresInMilliseconds <= 60_000);
  const reviewImagePreviewUrl = String(
    reviewAuthorImage?.preview_display_url || reviewAuthorImage?.preview_url || ""
  );
  expect(reviewImagePreviewUrl.startsWith("/api/content-moderation/author-media/images/"));
  activeStage = "image-review-preview";
  const reviewImagePreview = await request("GET", reviewImagePreviewUrl, { expected: [200], binary: true });
  assertPrivateNoStore(reviewImagePreview);
  expect(Buffer.isBuffer(reviewImagePreview.bytes) && reviewImagePreview.bytes.length > 0);

  activeStage = "image-review-isolation";
  await assertImageHiddenFromNonAuthors({
    fixture,
    member,
    observer,
    shareToken,
    imageId,
    previewUrls: [pendingImagePreviewUrl, reviewImagePreviewUrl]
  });

  const rejected = await request(
    "POST",
    `/api/admin/content-moderation/${adapted.jobId}/reject`,
    {
      token: author.token,
      json: { reason: "D46 isolated fixture rejection" },
      expected: [200]
    }
  );
  expect(rejected.data?.status === "rejected");

  const rejectedAuthorAlbum = await getAlbum(author.token, fixture.sessionId);
  assertPrivateNoStore(rejectedAuthorAlbum);
  const rejectedAuthorImage = authorMediaById(rejectedAuthorAlbum, imageId);
  expect(rejectedAuthorImage?.publication_state === "author_only");
  const rejectedImagePreviewUrl = String(
    rejectedAuthorImage?.preview_display_url || rejectedAuthorImage?.preview_url || ""
  );
  expect(rejectedImagePreviewUrl.startsWith("/api/content-moderation/author-media/images/"));
  const preview = await request("GET", rejectedImagePreviewUrl, { expected: [200], binary: true });
  assertPrivateNoStore(preview);
  expect(Buffer.isBuffer(preview.bytes) && preview.bytes.length > 0);

  await assertImageHiddenFromNonAuthors({
    fixture,
    member,
    observer,
    shareToken,
    imageId,
    previewUrls: [pendingImagePreviewUrl, reviewImagePreviewUrl, rejectedImagePreviewUrl]
  });

  const [cleared] = await database.query(
    `UPDATE session_album_photos
     SET object_key = NULL
     WHERE id = ? AND session_id = ? AND uploader_user_id = ?
       AND media_type = 'image' AND status = 'active'
       AND moderation_status = 'rejected' AND object_key = ?
       AND moderation_object_version = ?`,
    [imageId, fixture.sessionId, fixture.authorId, adapted.objectKey, adapted.version]
  );
  expect(Number(cleared.affectedRows) === 1);
  const deleted = await request("DELETE", `/api/session-album/photos/${imageId}`, {
    token: author.token,
    expected: [202]
  });
  expect(deleted.data?.deletionPending === true);
  const [cleanupRows] = await database.query(
    `SELECT id, storage_kind, local_path FROM session_album_object_cleanup_jobs
     WHERE media_id = ? AND session_id = ? LIMIT 1`,
    [imageId, fixture.sessionId]
  );
  const cleanup = cleanupRows[0];
  expect(cleanup && cleanup.storage_kind === "local" && cleanup.local_path === adapted.photoUrl);
  fixture.cleanupJobIds.add(Number(cleanup.id));
  await runCleanupWorkerOnce(Number(cleanup.id));
  await assertFileMissing(adapted.photoUrl);
  const [remaining] = await database.query("SELECT id FROM session_album_photos WHERE id = ?", [imageId]);
  expect(remaining.length === 0);
  const [cleaned] = await database.query("SELECT status FROM session_album_object_cleanup_jobs WHERE id = ?", [cleanup.id]);
  expect(cleaned[0]?.status === "cleaned");
}

async function createPendingVideoFixture({ author, fixture, database, suffix }) {
  const form = new FormData();
  form.set("video", new Blob([MP4_FTYP], { type: "video/mp4" }), `${fixture.prefix}-${suffix}.mp4`);
  const upload = await request(
    "POST",
    `/api/admin/sessions/${fixture.sessionId}/album/videos/uploads`,
    { token: author.token, body: form, expected: [201] }
  );
  const sourceUrl = String(upload.data?.sourceUrl || "");
  expect(/^\/uploads\/session-album\/videos\/source\/[A-Za-z0-9._-]+\.mp4$/.test(sourceUrl));
  fixture.localPaths.add(sourceUrl);

  const created = await request("POST", `/api/admin/sessions/${fixture.sessionId}/album/videos`, {
    token: author.token,
    json: { sourceUrl, durationSeconds: 1, videoWidth: 1, videoHeight: 1 },
    expected: [201]
  });
  assertPrivateNoStore(created);
  const videoId = asPositiveId(created.data?.id);
  expect(videoId && created.data?.publication_state === "author_only");
  fixture.mediaIds.add(videoId);

  const [jobRows] = await database.query(
    `SELECT job.id, job.data_id, job.subject_version, job.status,
            attempt.id AS attempt_id, attempt.provider_job_id,
            media.source_url, media.moderation_object_version
     FROM content_moderation_jobs job
     JOIN content_moderation_provider_attempts attempt
       ON attempt.moderation_job_id = job.id AND attempt.is_current = 1
     JOIN session_album_photos media ON media.id = CAST(job.subject_id AS UNSIGNED)
     WHERE job.subject_type = 'album_video' AND job.subject_id = ?
       AND media.id = ? AND media.session_id = ? AND media.uploader_user_id = ?
     LIMIT 1`,
    [String(videoId), videoId, fixture.sessionId, fixture.authorId]
  );
  const job = jobRows[0];
  expect(job && job.status === "processing" && job.provider_job_id && job.data_id);
  fixture.jobIds.add(Number(job.id));
  fixture.attemptIds.add(Number(job.attempt_id));

  activeStage = "video-pending-url";
  const pendingAuthorVideoUrl = await request("GET", `/api/session-album/media/${videoId}/video-url`, {
    token: author.token,
    expected: [200]
  });
  assertPrivateNoStore(pendingAuthorVideoUrl);
  expect(pendingAuthorVideoUrl.data?.publication_state === "author_only");
  const pendingVideoPreviewUrl = String(pendingAuthorVideoUrl.data?.url || "");
  expect(pendingVideoPreviewUrl.startsWith("/api/testing/d46-smoke/author-media/videos/"));
  activeStage = "video-pending-preview";
  const pendingVideoPreview = await request("GET", pendingVideoPreviewUrl, {
    headers: { range: "bytes=0-7" },
    expected: [206],
    binary: true
  });
  assertPrivateNoStore(pendingVideoPreview);
  expect(Buffer.isBuffer(pendingVideoPreview.bytes) && pendingVideoPreview.bytes.length === 8);
  return { videoId, sourceUrl, job, pendingVideoPreviewUrl };
}

async function sendTencentVideoCallback(job, { Result }) {
  return request(
    "POST",
    "/api/internal/content-moderation/tencent-video/callback",
    {
      headers: { "x-content-moderation-token": TENCENT_CALLBACK_TOKEN },
      json: {
        JobsDetail: {
          JobId: job.provider_job_id,
          DataId: job.data_id,
          Object: String(job.source_url || "").replace(/^\//, ""),
          State: "Success",
          Result,
          Label: "normal",
          SubLabel: "",
          Score: 100
        }
      },
      expected: [200]
    }
  );
}

async function runVideoAcceptance({ author, member, observer, fixture, database, shareToken }) {
  // Tencent's Result=2 is a distinct human-review decision.  Exercise it on
  // its own submitted job so a terminal rejection cannot mask the transition.
  const reviewVideo = await createPendingVideoFixture({
    author,
    fixture,
    database,
    suffix: "review"
  });
  const reviewCallback = await sendTencentVideoCallback(reviewVideo.job, { Result: 2 });
  expect(reviewCallback.data?.status === "review");

  const reviewAuthorAlbum = await getAlbum(author.token, fixture.sessionId);
  assertPrivateNoStore(reviewAuthorAlbum);
  expect(authorMediaById(reviewAuthorAlbum, reviewVideo.videoId)?.publication_state === "author_only");

  const rejectedVideo = await createPendingVideoFixture({
    author,
    fixture,
    database,
    suffix: "rejected"
  });
  const { videoId, sourceUrl, job } = rejectedVideo;
  const callback = await request(
    "POST",
    "/api/internal/content-moderation/tencent-video/callback",
    {
      headers: { "x-content-moderation-token": TENCENT_CALLBACK_TOKEN },
      json: {
        JobsDetail: {
          JobId: job.provider_job_id,
          DataId: job.data_id,
          Object: String(job.source_url || "").replace(/^\//, ""),
          State: "Success",
          Result: 1,
          Label: "normal",
          SubLabel: "",
          Score: 100
        }
      },
      expected: [200]
    }
  );
  expect(callback.data?.status === "rejected");

  const authorVideoUrl = await request("GET", `/api/session-album/media/${videoId}/video-url`, {
    token: author.token,
    expected: [200]
  });
  assertPrivateNoStore(authorVideoUrl);
  expect(authorVideoUrl.data?.publication_state === "author_only");
  expect(Number(authorVideoUrl.data?.expiresInSeconds) >= 1 && Number(authorVideoUrl.data?.expiresInSeconds) <= 60);
  const previewUrl = String(authorVideoUrl.data?.url || "");
  expect(previewUrl.startsWith("/api/testing/d46-smoke/author-media/videos/"));
  const preview = await request("GET", previewUrl, {
    headers: { range: "bytes=0-7" },
    expected: [206],
    binary: true
  });
  assertPrivateNoStore(preview);
  expect(Buffer.isBuffer(preview.bytes) && preview.bytes.length === 8);

  await assertMediaHiddenFromNonAuthors({
    fixture,
    member,
    observer,
    shareToken,
    mediaIds: [reviewVideo.videoId, videoId],
    markers: [fixture.textReview, fixture.textBlock, fixture.textReplacement],
    previewUrls: [
      reviewVideo.pendingVideoPreviewUrl,
      rejectedVideo.pendingVideoPreviewUrl,
      previewUrl
    ]
  });
  for (const anonymousResponse of [
    await request("GET", `/api/session-album/media/${videoId}/video-url`, { expected: [401, 404] }),
    await request("GET", `/api/session-album/public-share/media/${videoId}/cover`, { expected: [401, 403, 404] })
  ]) {
    assertNoPrivateLeak(anonymousResponse.payload, {
      mediaIds: [videoId],
      markers: [fixture.textReview, fixture.textBlock, fixture.textReplacement],
      previewUrls: [
        reviewVideo.pendingVideoPreviewUrl,
        rejectedVideo.pendingVideoPreviewUrl,
        previewUrl
      ]
    });
  }

  const deleted = await request("DELETE", `/api/session-album/photos/${videoId}`, {
    token: author.token,
    expected: [202]
  });
  expect(deleted.data?.deletionPending === true);
  const [cleanupRows] = await database.query(
    `SELECT id, storage_kind, object_urls_json
     FROM session_album_object_cleanup_jobs WHERE media_id = ? AND session_id = ? LIMIT 1`,
    [videoId, fixture.sessionId]
  );
  const cleanup = cleanupRows[0];
  expect(cleanup && cleanup.storage_kind === "multi");
  const entries = typeof cleanup.object_urls_json === "string"
    ? JSON.parse(cleanup.object_urls_json)
    : cleanup.object_urls_json;
  expect(Array.isArray(entries) && entries.some((entry) => entry?.localPath === sourceUrl));
  fixture.cleanupJobIds.add(Number(cleanup.id));
  await runCleanupWorkerOnce(Number(cleanup.id));
  await assertFileMissing(sourceUrl);
  const [remaining] = await database.query("SELECT id FROM session_album_photos WHERE id = ?", [videoId]);
  expect(remaining.length === 0);
  const [cleaned] = await database.query("SELECT status FROM session_album_object_cleanup_jobs WHERE id = ?", [cleanup.id]);
  expect(cleaned[0]?.status === "cleaned");
}

function trackedIds(values) {
  return [...values].map((value) => asPositiveId(value)).filter(Boolean);
}

function addTrackedRows(target, rows, key = "id") {
  for (const row of rows) {
    const id = asPositiveId(row?.[key]);
    if (id) target.add(id);
  }
}

async function collectTrackedArtifacts(database, fixture) {
  const authorId = asPositiveId(fixture.authorId);
  const sessionId = asPositiveId(fixture.sessionId);
  const setupTextProposalHighWaterMark =
    Number.isSafeInteger(fixture.setupTextProposalHighWaterMark) &&
    fixture.setupTextProposalHighWaterMark >= 0
      ? fixture.setupTextProposalHighWaterMark
      : null;
  if (authorId && setupTextProposalHighWaterMark !== null) {
    await collectNewAuthorTextProposals(
      database,
      fixture,
      fixture.setupTextProposalHighWaterMark
    );
  }
  const proposalIds = trackedIds(fixture.proposalIds);
  if (authorId && proposalIds.length) {
    const [proposals] = await database.query(
      `SELECT id, moderation_job_id
       FROM content_moderation_text_proposals
       WHERE created_by_user_id = ? AND id IN (${proposalIds.map(() => "?").join(",")})`,
      [authorId, ...proposalIds]
    );
    addTrackedRows(fixture.proposalIds, proposals);
    addTrackedRows(fixture.jobIds, proposals, "moderation_job_id");
  }

  // A fixture session is unique to this run.  Capture every associated media
  // row before any direct delete, including rows made just before a failure.
  if (sessionId) {
    const [media] = await database.query(
      "SELECT id FROM session_album_photos WHERE session_id = ?",
      [sessionId]
    );
    addTrackedRows(fixture.mediaIds, media);

    const [sessionJobs] = await database.query(
      `SELECT DISTINCT job.id
       FROM content_moderation_jobs AS job
       JOIN session_album_photos AS media
         ON job.subject_id = CAST(media.id AS CHAR)
       WHERE job.subject_type IN ('album_image', 'album_video')
         AND media.session_id = ?`,
      [sessionId]
    );
    addTrackedRows(fixture.jobIds, sessionJobs);

    const [sessionCleanupJobs] = await database.query(
      "SELECT id FROM session_album_object_cleanup_jobs WHERE session_id = ?",
      [sessionId]
    );
    addTrackedRows(fixture.cleanupJobIds, sessionCleanupJobs);
  }

  const mediaIds = trackedIds(fixture.mediaIds);
  if (mediaIds.length) {
    const [mediaJobs] = await database.query(
      `SELECT id
       FROM content_moderation_jobs
       WHERE subject_type IN ('album_image', 'album_video')
         AND subject_id IN (${mediaIds.map(() => "?").join(",")})`,
      mediaIds.map(String)
    );
    addTrackedRows(fixture.jobIds, mediaJobs);

    const [mediaCleanupJobs] = await database.query(
      `SELECT id
       FROM session_album_object_cleanup_jobs
       WHERE media_id IN (${mediaIds.map(() => "?").join(",")})`,
      mediaIds
    );
    addTrackedRows(fixture.cleanupJobIds, mediaCleanupJobs);
  }

  const jobIds = trackedIds(fixture.jobIds);
  if (jobIds.length) {
    const [attempts] = await database.query(
      `SELECT id
       FROM content_moderation_provider_attempts
       WHERE moderation_job_id IN (${jobIds.map(() => "?").join(",")})`,
      jobIds
    );
    addTrackedRows(fixture.attemptIds, attempts);
  }
}

async function cleanupFixture(database, fixture) {
  const attempts = [];
  const safely = async (operation) => {
    try {
      await operation();
    } catch {
      attempts.push(smokeFailure());
    }
  };
  // Recover all already-created artifacts first.  This remains safe on a
  // mid-flow failure because every query is scoped to recorded IDs/session.
  await safely(() => collectTrackedArtifacts(database, fixture));
  const sessionId = asPositiveId(fixture.sessionId);
  const storeId = asPositiveId(fixture.storeId);
  const scriptId = asPositiveId(fixture.scriptId);
  const mediaIds = trackedIds(fixture.mediaIds);
  const proposalIds = trackedIds(fixture.proposalIds);
  const jobIds = trackedIds(fixture.jobIds);
  const attemptIds = trackedIds(fixture.attemptIds);
  const cleanupJobIds = trackedIds(fixture.cleanupJobIds);
  const userIds = trackedIds(fixture.userIds);

  // All deletes below are constrained by IDs recorded during this invocation;
  // no prefix range, glob, or shared local resource is ever used for cleanup.
  if (cleanupJobIds.length) {
    await safely(() => database.query(
      `DELETE FROM session_album_object_cleanup_jobs WHERE id IN (${cleanupJobIds.map(() => "?").join(",")})`,
      cleanupJobIds
    ));
  }
  if (mediaIds.length) {
    await safely(() => database.query(
      `DELETE FROM session_album_upload_intents WHERE media_id IN (${mediaIds.map(() => "?").join(",")})`,
      mediaIds
    ));
  }
  if (proposalIds.length) {
    await safely(() => database.query(
      `DELETE FROM content_moderation_text_proposals
       WHERE id IN (${proposalIds.map(() => "?").join(",")})
         AND created_by_user_id = ?`,
      [...proposalIds, fixture.authorId]
    ));
  }
  if (attemptIds.length) {
    await safely(() => database.query(
      `DELETE FROM content_moderation_provider_attempts
       WHERE id IN (${attemptIds.map(() => "?").join(",")})`,
      attemptIds
    ));
  }
  if (jobIds.length) {
    await safely(() => database.query(
      `DELETE FROM content_moderation_provider_attempts
       WHERE moderation_job_id IN (${jobIds.map(() => "?").join(",")})`,
      jobIds
    ));
    await safely(() => database.query(
      `DELETE FROM content_moderation_jobs WHERE id IN (${jobIds.map(() => "?").join(",")})`,
      jobIds
    ));
  }

  if (sessionId) {
    await safely(async () => {
      const [sessions] = await database.query(
        "SELECT id FROM sessions WHERE id = ? AND organizer_user_id = ? LIMIT 1",
        [sessionId, fixture.authorId]
      );
      if (sessions.length !== 1) return;
      await database.query(
        "UPDATE session_chat_rooms SET pinned_message_id = NULL WHERE session_id = ?",
        [sessionId]
      );
      await database.query(
        "DELETE FROM session_messages WHERE room_id IN (SELECT id FROM session_chat_rooms WHERE session_id = ?)",
        [sessionId]
      );
      await database.query("DELETE FROM session_chat_rooms WHERE session_id = ?", [sessionId]);
      await database.query(
        "DELETE FROM session_review_photos WHERE review_id IN (SELECT id FROM session_reviews WHERE session_id = ?)",
        [sessionId]
      );
      await database.query(
        "DELETE FROM session_album_photo_tags WHERE photo_id IN (SELECT id FROM session_album_photos WHERE session_id = ?)",
        [sessionId]
      );
      await database.query(
        `DELETE FROM session_album_photo_tags
         WHERE seat_id IN (SELECT id FROM session_seats WHERE session_id = ?)
            OR session_npc_role_id IN (SELECT id FROM session_npc_roles WHERE session_id = ?)`,
        [sessionId, sessionId]
      );
      await database.query("DELETE FROM session_album_upload_intents WHERE session_id = ?", [sessionId]);
      await database.query("DELETE FROM session_album_photos WHERE session_id = ?", [sessionId]);
      await database.query("DELETE FROM session_album_privacy WHERE session_id = ?", [sessionId]);
      await database.query("DELETE FROM session_reviews WHERE session_id = ?", [sessionId]);
      await database.query("DELETE FROM signups WHERE session_id = ?", [sessionId]);
      await database.query("DELETE FROM session_npc_roles WHERE session_id = ?", [sessionId]);
      await database.query("DELETE FROM share_events WHERE session_id = ?", [sessionId]);
      await database.query("DELETE FROM session_seats WHERE session_id = ?", [sessionId]);
      await database.query("DELETE FROM sessions WHERE id = ? AND organizer_user_id = ?", [sessionId, fixture.authorId]);
    });
  }

  if (storeId || scriptId) {
    await safely(async () => {
      if (storeId || scriptId) {
        const clauses = [];
        const values = [];
        if (storeId) {
          clauses.push("store_id = ?");
          values.push(storeId);
        }
        if (scriptId) {
          clauses.push("script_id = ?");
          values.push(scriptId);
        }
        await database.query(`DELETE FROM store_scripts WHERE ${clauses.join(" OR ")}`, values);
      }
      if (scriptId) {
        await database.query("DELETE FROM script_npc_roles WHERE script_id = ?", [scriptId]);
        await database.query("DELETE FROM scripts WHERE id = ? AND created_by_admin_user_id = ?", [scriptId, fixture.authorId]);
      }
      if (storeId) {
        await database.query("DELETE FROM stores WHERE id = ? AND created_by_admin_user_id = ?", [storeId, fixture.authorId]);
      }
    });
  }

  for (const [userId, priorStatus] of fixture.systemAdminRoleSnapshots) {
    await safely(async () => {
      if (priorStatus === null) {
        await database.query(
          "DELETE FROM user_roles WHERE user_id = ? AND role = 'system_admin'",
          [userId]
        );
      } else {
        await database.query(
          "UPDATE user_roles SET status = ? WHERE user_id = ? AND role = 'system_admin'",
          [priorStatus, userId]
        );
      }
    });
  }
  if (fixture.authorId && Object.hasOwn(fixture, "authorRoleBefore_organizer")) {
    await safely(async () => {
      const prior = fixture.authorRoleBefore_organizer;
      if (prior === null) {
        await database.query(
          "DELETE FROM user_roles WHERE user_id = ? AND role = 'organizer'",
          [fixture.authorId]
        );
      } else {
        await database.query(
          "UPDATE user_roles SET status = ? WHERE user_id = ? AND role = 'organizer'",
          [prior, fixture.authorId]
        );
      }
    });
  }
  if (fixture.authorPhoneSnapshot) {
    await safely(() => database.query(
      `UPDATE users
       SET phone_encrypted = ?, phone_verified_at = ?
       WHERE id = ? AND open_id = 'dev-d46-admin'`,
      [
        fixture.authorPhoneSnapshot.phoneEncrypted,
        fixture.authorPhoneSnapshot.phoneVerifiedAt,
        fixture.authorPhoneSnapshot.userId
      ]
    ));
  }
  if (userIds.length) {
    await safely(async () => {
      await database.query(
        `DELETE FROM wechat_identities WHERE user_id IN (${userIds.map(() => "?").join(",")})`,
        userIds
      );
      await database.query(
        `DELETE FROM user_roles WHERE user_id IN (${userIds.map(() => "?").join(",")})`,
        userIds
      );
      await database.query(
        `DELETE FROM users WHERE id IN (${userIds.map(() => "?").join(",")})`,
        userIds
      );
    });
  }
  for (const localPath of fixture.localPaths) {
    await safely(() => unlinkTrackedLocalFile(localPath));
  }
  if (attempts.length) throw attempts[0];
}

async function assertNoD46FixtureResidue(database) {
  // This database is created exclusively for one D46 acceptance invocation.
  // A green result is therefore valid only if every transient moderation and
  // album table returns to its migration-only empty state.
  const [rows] = await database.query(
    `SELECT
       (SELECT COUNT(*) FROM content_moderation_jobs) AS moderation_jobs,
       (SELECT COUNT(*) FROM content_moderation_text_proposals) AS text_proposals,
       (SELECT COUNT(*) FROM content_moderation_provider_attempts) AS provider_attempts,
       (SELECT COUNT(*) FROM content_moderation_audit_logs) AS audit_logs,
       (SELECT COUNT(*) FROM session_album_photos) AS album_media,
       (SELECT COUNT(*) FROM session_album_upload_intents) AS upload_intents,
       (SELECT COUNT(*) FROM session_album_object_cleanup_jobs) AS cleanup_jobs`
  );
  const counts = Object.values(rows[0] || {}).map(Number);
  expect(counts.length === 7 && counts.every((count) => Number.isSafeInteger(count) && count === 0));
}

let activeStage = "bootstrap";

async function main() {
  // First I/O: prove the running API is the D46 loopback target before a DB
  // connection, fixture write, upload, callback, or cleanup path is touched.
  const target = await request("GET", TARGET_PATH, { expected: [200] });
  expect(
    target.data?.mode === "d46" &&
      target.data?.isolated === true &&
      target.data?.database === "pinche_d46_test"
  );

  activeStage = "setup";
  const database = await mysqlConnection();
  const fixture = randomFixture();
  let fixtureLockHeld = false;
  try {
    const [databaseRows] = await database.query("SELECT DATABASE() AS database_name");
    expect(databaseRows[0]?.database_name === "pinche_d46_test");
    await acquireD46FixtureLock(database);
    fixtureLockHeld = true;

    let author = await login("dev-d46-admin");
    fixture.authorId = asPositiveId(author.user?.id);
    expect(fixture.authorId);
    await ensureLocalSystemAdmin(database, fixture, fixture.authorId);
    await snapshotAuthorPhone(database, fixture, fixture.authorId);
    author = await authorizePhone(author, `${fixture.prefix}-author-phone`);

    let member = await login(`dev-${fixture.prefix}-member`);
    fixture.userIds.add(asPositiveId(member.user?.id));
    member = await authorizePhone(member, `${fixture.prefix}-member-phone`);
    let observer = await login(`dev-${fixture.prefix}-observer`);
    fixture.userIds.add(asPositiveId(observer.user?.id));
    observer = await authorizePhone(observer, `${fixture.prefix}-observer-phone`);
    await ensureLocalSystemAdmin(database, fixture, observer.user?.id);
    // Tokens embed roles, so re-login after the direct local grant.  The
    // observer remains outside the album and must still see no private data.
    observer = await login(`dev-${fixture.prefix}-observer`);
    expect(Array.isArray(observer.roles));
    expect(observer.roles.includes("system_admin"));
    expect(fixture.userIds.size === 2 && !fixture.userIds.has(fixture.authorId));

    await captureAuthorRoleStatus(database, fixture, "organizer");
    fixture.setupTextProposalHighWaterMark = await currentAuthorTextProposalHighWaterMark(
      database,
      fixture.authorId
    );
    await createMediaFixture(author, fixture);
    await collectNewAuthorTextProposals(
      database,
      fixture,
      fixture.setupTextProposalHighWaterMark
    );
    const shareToken = await createAlbumShare(member, fixture);
    const initialPublicAlbum = await publicAlbum(fixture.sessionId, shareToken);
    assertNoPrivateLeak(initialPublicAlbum.payload, {
      markers: [fixture.textReview, fixture.textBlock, fixture.textReplacement]
    });

    activeStage = "text";
    await runTextAcceptance({ author, member, observer, fixture, database });
    activeStage = "image";
    await runImageAcceptance({ author, member, observer, fixture, database, shareToken });
    activeStage = "video";
    await runVideoAcceptance({ author, member, observer, fixture, database, shareToken });
  } finally {
    try {
      if (fixtureLockHeld) {
        await cleanupFixture(database, fixture);
        await assertNoD46FixtureResidue(database);
      }
    } finally {
      try {
        if (fixtureLockHeld) await releaseD46FixtureLock(database);
      } finally {
        await database.end();
      }
    }
  }
}

try {
  await main();
  console.log("D46 isolated HTTP author-private acceptance passed.");
} catch {
  if (process.env.D46_SMOKE_DEBUG === "1") {
    console.error(`D46 isolated HTTP acceptance failed at ${activeStage}.`);
  } else {
    console.error("D46 isolated HTTP acceptance failed.");
  }
  process.exitCode = 1;
}
