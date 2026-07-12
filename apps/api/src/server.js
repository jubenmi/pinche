import crypto from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { config, publicConfig } from "./config/env.js";
import { checkDatabaseReadiness, withDatabaseConnection, withTransaction } from "./db/mysql.js";
import { AppError, badRequest, forbidden, notFound, unauthorized } from "./http/errors.js";
import { updateUserPhone, updateUserProfile } from "./modules/auth/users.js";
import {
  approveAdminWebLoginTicket,
  createAdminWebLoginTicket,
  pollAdminWebLoginTicket
} from "./modules/auth/admin-web-login.js";
import {
  loginWithWechatCode,
  verifyBusinessToken
} from "./modules/auth/wechat.js";
import { routeExtensions } from "./modules/extensions/registry.js";
import { geocodeStoreLocation, reverseGeocodeCity } from "./modules/location/geocoding.js";
import {
  buildCosAuthorization,
  cosHost,
  cosObjectKeyFromUploadPath,
  cosStorageEnabled,
  deleteCosObject,
  getCosObject,
  getCosImageInfo,
  headCosObject,
  isTrustedCosStorageError,
  readCosObjectRange,
  putCosObject
} from "./storage/cos.js";
import {
  createLocalAlbumVideoResponse,
  inspectLocalAlbumVideoObject,
  inspectSessionAlbumVideoObject,
  validateCosAlbumVideoHeaders
} from "./modules/album-video/media.js";
import {
  finalizeLocalAlbumVideoUpload,
  parseMultipartAlbumVideoStream,
  uploadTempAlbumVideoToCos
} from "./modules/album-video/multipart-stream.js";
import { cleanupAlbumVideoBeforeDelete } from "./modules/album-video/lifecycle.js";
import {
  assertAdminOwnSessionAlbumAllowed,
  assertSessionAlbumImageUploadAllowed,
  assertSessionJoinInviteAllowed,
  assertSessionAlbumUploadAllowed,
  approveSignup,
  cancelSession,
  claimSessionNpcRole,
  claimSessionSeat,
  createSessionAlbumPhoto,
  createSessionAlbumVideo,
  createCatalogRequest,
  createEntityClaim,
  createPrivateScript,
  createPrivateStore,
  createScript,
  createSeat,
  createSession,
  createSessionNpcRole,
  createShareEvent,
  createSignup,
  createStore,
  createSubscriptionRequest,
  deleteAdminSession,
  prepareSessionAlbumPhotoDeletion,
  requestSessionAlbumImageDeletion,
  finalizeSessionAlbumPhotoDeletion,
  deleteScript,
  deleteStore,
  getPublicSessionAlbumPhotoForMedia,
  getPublicSessionAlbumVideoCoverForMedia,
  getSessionForViewer,
  getSessionAlbumShareSubject,
  getSessionShareStats,
  getMySessionAlbumPrivacy,
  getMySessionReview,
  getVisibleSessionAlbumPhotoForMedia,
  getVisibleSessionAlbumVideoForPlayback,
  getFinalizedSessionAlbumImage,
  hideMySignup,
  kickSessionSeat,
  leaveSessionOrganizer,
  approveCatalogReviewItem,
  listAdminScripts,
  listAdminCatalogReviewItems,
  listAdminSessions,
  listAdminStores,
  listActiveScripts,
  listActiveStores,
  listCatalogRequests,
  listMyCatalogReviewItems,
  listMyNotifications,
  listDiscoverableSessions,
  listPublicUpcomingSessions,
  listPublicSessionAlbumShare,
  listSessionAlbum,
  listSessionAlbumPeople,
  listSessionNpcRoles,
  listMySignups,
  listMySessions,
  listSessionReviews,
  listSessionSignups,
  listStoreScripts,
  lockSeat,
  markMyNotificationRead,
  markCatalogReviewItemNeedsChanges,
  mergeCatalogReviewItem,
  publishSession,
  rejectSignup,
  rejectCatalogReviewItem,
  relinkMySessionMembership,
  rescheduleSession,
  replaceStoreScripts,
  reviewCatalogRequest,
  transferSessionOrganizer,
  updateAdminCatalogReviewItem,
  updateDeposit,
  updateMyCatalogReviewItem,
  updateScript,
  updateSeat,
  updateSession,
  updateSessionAlbumVideoProcessingResult,
  updateMySessionAlbumPrivacy,
  updateSessionAlbumPhotoTags,
  updateSessionNpcRole,
  updateStore,
  upsertMySessionReview,
  upsertPerformerProfile,
  insertFinalizedSessionAlbumImage,
  serializeSessionAlbumImage
} from "./modules/core/service.js";
import { isAlbumImageKind } from "./modules/album-image/constants.js";
import { sessionRescheduleResponse } from "./modules/core/session-reschedule.js";
import {
  bindLegacyIntentByteSize,
  findAlbumImageIntent,
  findAlbumImageIntentByObjectKey,
  insertAlbumImageIntent,
  markAlbumImageIntentState,
  recordAlbumImageAuthorization
} from "./modules/album-image/repository.js";
import { createAlbumImageUploadService } from "./modules/album-image/upload-service.js";
import { emitAlbumImageEvent } from "./modules/album-image/telemetry.js";
import { validateStoredAlbumImage } from "./modules/album-image/validator.js";
import { buildAlbumImageUrls } from "./modules/album-image/signed-urls.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const apiRoot = path.resolve(__dirname, "..");
const avatarUploadDir = path.join(apiRoot, "uploads", "avatars");
const sessionReviewUploadDir = path.join(apiRoot, "uploads", "session-reviews");
const sessionAlbumUploadDir = path.join(apiRoot, "uploads", "session-album");
const sessionAlbumDisplayUploadDir = path.join(sessionAlbumUploadDir, "display");
const sessionAlbumVideoUploadDir = path.join(sessionAlbumUploadDir, "videos");
const sessionAlbumVideoSourceUploadDir = path.join(sessionAlbumVideoUploadDir, "source");
const sessionAlbumVideoDisplayUploadDir = path.join(sessionAlbumVideoUploadDir, "display");
const sessionAlbumVideoCoverUploadDir = path.join(sessionAlbumVideoUploadDir, "cover");
const AVATAR_UPLOAD_MAX_BYTES = 2 * 1024 * 1024;
const AVATAR_MULTIPART_MAX_BYTES = AVATAR_UPLOAD_MAX_BYTES + 64 * 1024;
const SESSION_REVIEW_UPLOAD_MAX_BYTES = 4 * 1024 * 1024;
const SESSION_REVIEW_MULTIPART_MAX_BYTES = SESSION_REVIEW_UPLOAD_MAX_BYTES + 64 * 1024;
const SESSION_ALBUM_UPLOAD_MAX_BYTES = 4 * 1024 * 1024;
const SESSION_ALBUM_MULTIPART_MAX_BYTES = SESSION_ALBUM_UPLOAD_MAX_BYTES + 64 * 1024;
const SESSION_ALBUM_VIDEO_UPLOAD_MAX_BYTES = 100 * 1024 * 1024;
const SESSION_ALBUM_VIDEO_MULTIPART_MAX_BYTES = SESSION_ALBUM_VIDEO_UPLOAD_MAX_BYTES + 256 * 1024;
const SESSION_ALBUM_MEDIA_TOKEN_SECONDS = 10 * 60;
const SESSION_ALBUM_SHARE_TOKEN_SECONDS = 30 * 24 * 60 * 60;
const SESSION_JOIN_INVITE_TOKEN_SECONDS = 7 * 24 * 60 * 60;
const SESSION_ALBUM_PUBLIC_MEDIA_TOKEN_SECONDS = 10 * 60;
const SESSION_ALBUM_VIDEO_SNAPSHOT_PARAMS = {
  "ci-process": "snapshot",
  time: "1",
  format: "jpg"
};
const AVATAR_WEBP_RULE = "imageMogr2/auto-orient/thumbnail/512x512>/format/webp/quality/80";
const SESSION_ALBUM_DISPLAY_JPG_RULE =
  "imageMogr2/auto-orient/thumbnail/2048x2048>/format/jpg/quality/85/strip";
const SESSION_ALBUM_THUMBNAIL_RULE =
  "imageMogr2/auto-orient/thumbnail/640x640>/format/jpg/quality/75/strip";
const avatarMimeTypes = {
  "image/jpeg": ".jpg",
  "image/png": ".png"
};

const albumImageUploads = createAlbumImageUploadService({
  cosConfig: config.cos,
  directUploadRequired: config.albumMedia.directUploadRequired,
  transaction: withTransaction,
  access: assertSessionAlbumImageUploadAllowed,
  repository: {
    insert: insertAlbumImageIntent,
    find: findAlbumImageIntent,
    findByObjectKey: findAlbumImageIntentByObjectKey,
    bindByteSize: bindLegacyIntentByteSize,
    recordAuthorization: recordAlbumImageAuthorization,
    markState: markAlbumImageIntentState
  },
  withDatabaseConnection,
  validateStoredImage: (intent) => validateStoredAlbumImage({
    intent,
    storage: {
      head: async (key) => {
        const response = await headCosObject({ key, config: config.cos });
        return {
          etag: response.headers.etag || "",
          byteSize: Number(response.headers["content-length"] || 0),
          contentType: String(response.headers["content-type"] || "")
        };
      },
      imageInfo: ({ key, etag }) => getCosImageInfo({ key, etag, config: config.cos })
    }
  }),
  insertFinalizedImage: insertFinalizedSessionAlbumImage,
  getFinalizedImage: getFinalizedSessionAlbumImage,
  serializeImage: serializeSessionAlbumImage,
  emit: emitAlbumImageEvent
});

async function isPersistedAlbumImageAuthorization(user, body) {
  if (body.uploadId || body.upload_id) return true;
  const key = String(body.key || body.Key || "");
  if (!key) return false;
  return withDatabaseConnection(async (connection) => Boolean(
    await findAlbumImageIntentByObjectKey(connection, {
      userId: Number(user.user.id),
      objectKey: key
    })
  ));
}

function jsonResponse(response, statusCode, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body)
  });
  response.end(body);
}

function errorResponse(response, statusCode, code, message, details) {
  jsonResponse(response, statusCode, {
    ok: false,
    error: {
      code,
      message,
      ...(details ? { details } : {})
    }
  });
}

export function normalizeError(error) {
  if (error instanceof AppError) {
    return error;
  }

  if (isTrustedCosStorageError(error)) {
    const safeMessages = {
      COS_OBJECT_NOT_FOUND: "Album video source object was not found",
      COS_PRECONDITION_FAILED: "Album video source object changed during validation",
      COS_UPSTREAM_ERROR: "Object storage request failed",
      COS_NETWORK_ERROR: "Object storage network request failed",
      COS_REQUEST_TIMEOUT: "Object storage request timed out",
      COS_RESPONSE_ABORTED: "Object storage response was interrupted",
      COS_RESPONSE_TOO_LARGE: "Object storage returned an invalid response",
      COS_INVALID_CONTENT_LENGTH: "Object storage returned invalid metadata",
      COS_INVALID_RANGE_RESPONSE: "Object storage returned an invalid byte range"
    };
    return new AppError(
      Number(error.statusCode),
      error.code,
      safeMessages[error.code] || "Object storage request failed"
    );
  }

  if (error?.code === "WECHAT_CONFIG_MISSING") {
    return new AppError(502, "WECHAT_CONFIG_MISSING", "WeChat login configuration is missing");
  }

  if (error?.code === "WECHAT_LOGIN_FAILED") {
    return new AppError(502, "WECHAT_LOGIN_FAILED", error.message, error.details);
  }

  if (error?.code === "WECHAT_UPSTREAM_TIMEOUT") {
    return new AppError(504, "WECHAT_UPSTREAM_TIMEOUT", "WeChat login service timed out");
  }

  if (error?.code === "ER_DUP_ENTRY") {
    return new AppError(409, "CONFLICT", "Duplicate resource", error.sqlMessage);
  }

  return new AppError(500, "INTERNAL_ERROR", "Internal server error");
}

async function readRawBody(request, maxBytes = Infinity) {
  const chunks = [];
  let totalBytes = 0;
  for await (const chunk of request) {
    totalBytes += chunk.length;
    if (totalBytes > maxBytes) {
      throw badRequest("request body is too large");
    }
    chunks.push(chunk);
  }

  if (chunks.length === 0) {
    return Buffer.alloc(0);
  }

  return Buffer.concat(chunks);
}

async function readJsonBody(request) {
  const rawBody = await readRawBody(request);
  if (rawBody.length === 0) {
    return {};
  }

  const body = rawBody.toString("utf8");
  if (!body.trim()) {
    return {};
  }

  return JSON.parse(body);
}

function isBodyMethod(method) {
  return ["POST", "PATCH", "PUT"].includes(method);
}

async function bodyFor(request) {
  if (!isBodyMethod(request.method)) {
    return {};
  }

  try {
    return await readJsonBody(request);
  } catch (error) {
    throw new AppError(400, "INVALID_JSON", "Request body must be valid JSON");
  }
}

function safeTextEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ""));
  const rightBuffer = Buffer.from(String(right || ""));
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function verifyCosCiCallbackToken(url) {
  const expectedToken = config.cos.ciCallbackToken;
  if (!expectedToken) {
    if (config.nodeEnv === "production") {
      throw forbidden("COS CI callback token is not configured");
    }
    return;
  }

  const token = url.searchParams.get("token") || url.searchParams.get("callbackToken") || "";
  if (!safeTextEqual(token, expectedToken)) {
    throw forbidden("COS CI callback token is invalid");
  }
}

function xmlUnescape(value) {
  return String(value || "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function xmlTextValues(xml, tagName) {
  const pattern = new RegExp(`<${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tagName}>`, "gi");
  const values = [];
  let match = pattern.exec(xml);
  while (match) {
    values.push(xmlUnescape(match[1].trim()));
    match = pattern.exec(xml);
  }
  return values.filter(Boolean);
}

function parseJsonText(value) {
  const text = String(value || "").trim();
  if (!text) {
    return {};
  }
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function firstDeepValue(value, names) {
  const nameSet = new Set(names.map((name) => name.toLowerCase()));
  const stack = [value];
  while (stack.length > 0) {
    const current = stack.shift();
    if (!current || typeof current !== "object") {
      continue;
    }
    if (Array.isArray(current)) {
      stack.push(...current);
      continue;
    }
    for (const [key, item] of Object.entries(current)) {
      if (nameSet.has(key.toLowerCase()) && item !== undefined && item !== null && item !== "") {
        return item;
      }
      if (item && typeof item === "object") {
        stack.push(item);
      }
    }
  }
  return null;
}

function collectDeepValues(value, names) {
  const nameSet = new Set(names.map((name) => name.toLowerCase()));
  const stack = [value];
  const values = [];
  while (stack.length > 0) {
    const current = stack.shift();
    if (!current || typeof current !== "object") {
      continue;
    }
    if (Array.isArray(current)) {
      stack.push(...current);
      continue;
    }
    for (const [key, item] of Object.entries(current)) {
      if (nameSet.has(key.toLowerCase()) && item !== undefined && item !== null && item !== "") {
        values.push(item);
      }
      if (item && typeof item === "object") {
        stack.push(item);
      }
    }
  }
  return values;
}

function callbackObjectPath(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  let text = String(value).trim();
  if (/^https?:\/\//i.test(text)) {
    try {
      text = new URL(text).pathname;
    } catch {
      return null;
    }
  }
  text = text.split("?")[0];
  try {
    text = decodeURIComponent(text);
  } catch {
    return null;
  }
  if (!text.startsWith("/")) {
    text = `/${text}`;
  }
  return text.startsWith("/uploads/session-album/videos/") ? text : null;
}

function callbackStatus({ code, state, status }) {
  const codeText = String(code || "").trim();
  if (codeText && !/^success$/i.test(codeText)) {
    return "failed";
  }
  const value = String(state || status || code || "").trim();
  if (/success|ready|complete|done/i.test(value)) {
    return "ready";
  }
  if (/fail|error/i.test(value)) {
    return "failed";
  }
  return "processing";
}

function parseSessionAlbumVideoProcessingCallback(rawBody) {
  const text = Buffer.isBuffer(rawBody) ? rawBody.toString("utf8").trim() : String(rawBody || "");
  if (!text) {
    throw badRequest("COS CI callback body is required");
  }

  const jsonPayload = text.startsWith("{") || text.startsWith("[") ? parseJsonText(text) : {};
  const isJson = Object.keys(jsonPayload).length > 0 || Array.isArray(jsonPayload);
  const userDataText = isJson
    ? firstDeepValue(jsonPayload, ["UserData", "userData", "Userdata"])
    : xmlTextValues(text, "UserData")[0];
  const userData =
    userDataText && typeof userDataText === "object" ? userDataText : parseJsonText(userDataText);
  const objectValues = isJson
    ? collectDeepValues(jsonPayload, ["Object", "object"])
    : xmlTextValues(text, "Object");
  const objectPaths = objectValues.map(callbackObjectPath).filter(Boolean);
  const inputObject =
    callbackObjectPath(userData.sourceUrl || userData.source_url || userData.inputObject) ||
    objectPaths.find((item) => item.startsWith("/uploads/session-album/videos/source/")) ||
    objectPaths[0] ||
    null;
  const outputObject =
    objectPaths.length > 1 ? objectPaths[objectPaths.length - 1] : objectPaths[0] || null;
  const tag = String(
    userData.kind ||
      userData.tag ||
      (isJson
        ? firstDeepValue(jsonPayload, ["Tag", "tag", "Operation"])
        : xmlTextValues(text, "Tag")[0]) ||
      ""
  );
  const code = String(
    userData.code ||
      (isJson ? firstDeepValue(jsonPayload, ["Code", "code"]) : xmlTextValues(text, "Code")[0]) ||
      ""
  );
  const state = String(
    userData.state ||
      (isJson
        ? firstDeepValue(jsonPayload, ["State", "state"])
        : xmlTextValues(text, "State")[0]) ||
      ""
  );
  const message = String(
    userData.message ||
      (isJson
        ? firstDeepValue(jsonPayload, ["Message", "message", "ErrorMessage"])
        : xmlTextValues(text, "Message")[0]) ||
      ""
  );
  let displayObject =
    callbackObjectPath(userData.displayUrl || userData.display_url || userData.displayObject) ||
    null;
  let coverObject =
    callbackObjectPath(userData.coverUrl || userData.cover_url || userData.coverObject) || null;

  if (outputObject) {
    const lowerOutput = outputObject.toLowerCase();
    const lowerTag = tag.toLowerCase();
    if (
      lowerOutput.includes("/cover/") ||
      /\.(?:jpg|jpeg)$/.test(lowerOutput) ||
      lowerTag.includes("snapshot") ||
      lowerTag.includes("screenshot") ||
      lowerTag.includes("截帧")
    ) {
      coverObject = coverObject || outputObject;
    }
    if (
      lowerOutput.includes("/display/") ||
      lowerOutput.endsWith(".mp4") ||
      lowerTag.includes("transcode") ||
      lowerTag.includes("转码")
    ) {
      displayObject = displayObject || outputObject;
    }
  }

  return {
    mediaId: userData.mediaId || userData.media_id || firstDeepValue(jsonPayload, ["mediaId"]),
    ciJobId:
      userData.ciJobId ||
      userData.ci_job_id ||
      userData.jobId ||
      (isJson
        ? firstDeepValue(jsonPayload, ["JobId", "JobID", "jobId"])
        : xmlTextValues(text, "JobId")[0]),
    processingStatus: callbackStatus({
      code,
      state,
      status: userData.status || firstDeepValue(jsonPayload, ["Status", "status"])
    }),
    kind: tag,
    sourceUrl: inputObject,
    displayUrl: displayObject,
    coverUrl: coverObject,
    processingError: message || code || null
  };
}

async function handleSessionAlbumVideoProcessingCallback(url, request) {
  verifyCosCiCallbackToken(url);
  const rawBody = await readRawBody(request, 1024 * 1024);
  const callback = parseSessionAlbumVideoProcessingCallback(rawBody);
  return updateSessionAlbumVideoProcessingResult(callback);
}

function splitBuffer(buffer, separator) {
  const parts = [];
  let start = 0;
  let index = buffer.indexOf(separator, start);
  while (index !== -1) {
    parts.push(buffer.subarray(start, index));
    start = index + separator.length;
    index = buffer.indexOf(separator, start);
  }
  parts.push(buffer.subarray(start));
  return parts;
}

function trimMultipartPayload(payload) {
  let end = payload.length;
  if (end >= 2 && payload[end - 2] === 13 && payload[end - 1] === 10) {
    end -= 2;
  }
  return payload.subarray(0, end);
}

function avatarExtensionFromBytes(file) {
  if (file.length >= 3 && file[0] === 0xff && file[1] === 0xd8 && file[2] === 0xff) {
    return ".jpg";
  }
  if (
    file.length >= 8 &&
    file[0] === 0x89 &&
    file[1] === 0x50 &&
    file[2] === 0x4e &&
    file[3] === 0x47 &&
    file[4] === 0x0d &&
    file[5] === 0x0a &&
    file[6] === 0x1a &&
    file[7] === 0x0a
  ) {
    return ".png";
  }
  return "";
}

function parseMultipartImageUpload(contentType, body, options = {}) {
  const fieldName = options.fieldName || "avatar";
  const maxBytes = options.maxBytes || AVATAR_UPLOAD_MAX_BYTES;
  const label = options.label || fieldName;
  const boundary = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/)?.[1] ||
    contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/)?.[2];
  if (!boundary) {
    throw badRequest("multipart boundary is required");
  }

  const boundaryBuffer = Buffer.from(`--${boundary}`);
  for (const rawPart of splitBuffer(body, boundaryBuffer)) {
    let part = rawPart;
    if (part.length >= 2 && part[0] === 13 && part[1] === 10) {
      part = part.subarray(2);
    }
    if (part.length === 0 || part.subarray(0, 2).toString() === "--") {
      continue;
    }

    const headerEnd = part.indexOf(Buffer.from("\r\n\r\n"));
    if (headerEnd === -1) {
      continue;
    }

    const headersText = part.subarray(0, headerEnd).toString("utf8");
    const disposition = headersText.match(/^content-disposition:\s*(.+)$/im)?.[1] || "";
    if (!disposition.includes(`name="${fieldName}"`) || !/filename="/.test(disposition)) {
      continue;
    }

    const mimeType = headersText.match(/^content-type:\s*([^\r\n;]+)/im)?.[1]?.trim() || "";
    const file = trimMultipartPayload(part.subarray(headerEnd + 4));
    if (file.length === 0) {
      throw badRequest(`${label} file is required`);
    }
    if (file.length > maxBytes) {
      throw badRequest(`${label} file is too large`);
    }

    const extension = avatarExtensionFromBytes(file) || avatarMimeTypes[mimeType];
    if (!extension) {
      throw badRequest(`${label} must be a JPEG or PNG image`);
    }

    return { extension, file, mimeType };
  }

  throw badRequest(`${label} file is required`);
}

function parseMultipartAvatarUpload(contentType, body) {
  return parseMultipartImageUpload(contentType, body, {
    fieldName: "avatar",
    maxBytes: AVATAR_UPLOAD_MAX_BYTES,
    label: "avatar"
  });
}

function parseRawAvatarUpload(contentType, body) {
  const normalizedContentType = String(contentType || "").split(";")[0].trim().toLowerCase();
  if (body.length === 0) {
    throw badRequest("avatar file is required");
  }
  if (body.length > AVATAR_UPLOAD_MAX_BYTES) {
    throw badRequest("avatar file is too large");
  }

  const extension = avatarExtensionFromBytes(body) || avatarMimeTypes[normalizedContentType];
  if (!extension) {
    throw badRequest("avatar must be a JPEG or PNG image");
  }

  return {
    extension,
    file: body,
    mimeType: extension === ".png" ? "image/png" : "image/jpeg"
  };
}

function avatarContentType(filename) {
  const extension = path.extname(filename).toLowerCase();
  if (extension === ".jpg" || extension === ".jpeg") {
    return "image/jpeg";
  }
  if (extension === ".png") {
    return "image/png";
  }
  if (extension === ".webp") {
    return "image/webp";
  }
  if (extension === ".mp4") {
    return "video/mp4";
  }
  return "application/octet-stream";
}

function uploadedObjectContentType(filename, fallbackContentType = "") {
  const filenameContentType = avatarContentType(filename);
  if (filenameContentType !== "application/octet-stream") {
    return filenameContentType;
  }
  return fallbackContentType || filenameContentType;
}

function isCosUploadStorageEnabled() {
  return cosStorageEnabled(config.cos);
}

function uploadFilenameBase(prefix, userId) {
  return `${prefix}-${userId}-${Date.now()}-${crypto.randomBytes(8).toString("hex")}`;
}

function avatarWebpPicOperations(key) {
  return JSON.stringify({
    is_pic_info: 1,
    rules: [
      {
        bucket: config.cos.bucket,
        fileid: `/${key}`,
        rule: AVATAR_WEBP_RULE
      }
    ]
  });
}

function sessionAlbumDisplayJpgPicOperations(key) {
  return JSON.stringify({
    is_pic_info: 1,
    rules: [
      {
        bucket: config.cos.bucket,
        fileid: `/${key}`,
        rule: SESSION_ALBUM_DISPLAY_JPG_RULE
      }
    ]
  });
}

function normalizeUploadExtension(extension) {
  const normalized = String(extension || "").trim().toLowerCase();
  if (normalized === "jpg" || normalized === "jpeg" || normalized === "png") {
    return `.${normalized}`;
  }
  if (normalized === ".jpg" || normalized === ".jpeg" || normalized === ".png") {
    return normalized;
  }
  return ".jpg";
}

function normalizeVideoUploadExtension(extension) {
  const normalized = String(extension || "").trim().toLowerCase();
  if (normalized === "mp4" || normalized === ".mp4") {
    return ".mp4";
  }
  return ".mp4";
}

async function createCosDirectUploadIntent({ kind, extension, user, userId, sessionId }) {
  if (!isCosUploadStorageEnabled()) {
    return { direct: false };
  }

  const uploadUserId = user?.user?.id || userId;
  if (kind === "adminSessionAlbumVideo") {
    requireRole(user, "system_admin");
    normalizeVideoUploadExtension(extension);
    const session = await assertSessionAlbumUploadAllowed(user, sessionId);
    const key = `uploads/session-album/videos/source/${uploadFilenameBase(
      `admin-video-${session.id}`,
      uploadUserId
    )}.mp4`;
    return {
      direct: true,
      kind,
      sessionId: Number(session.id),
      bucket: config.cos.bucket,
      region: config.cos.region,
      key,
      uploadPath: `/${key}`,
      maxBytes: SESSION_ALBUM_VIDEO_UPLOAD_MAX_BYTES,
      contentType: "video/mp4",
      headers: { "x-cos-forbid-overwrite": "true" }
    };
  }

  const sourceExtension = normalizeUploadExtension(extension);
  if (kind === "avatar") {
    const key = `uploads/avatars/${uploadFilenameBase("user", uploadUserId)}.webp`;
    return {
      direct: true,
      kind,
      bucket: config.cos.bucket,
      region: config.cos.region,
      key,
      uploadPath: `/${key}`,
      maxBytes: AVATAR_UPLOAD_MAX_BYTES,
      contentType: avatarContentType(`source${sourceExtension}`),
      picOperations: avatarWebpPicOperations(key)
    };
  }

  if (kind === "sessionReviewPhoto") {
    const key = `uploads/session-reviews/${uploadFilenameBase("review", uploadUserId)}${sourceExtension}`;
    return {
      direct: true,
      kind,
      bucket: config.cos.bucket,
      region: config.cos.region,
      key,
      uploadPath: `/${key}`,
      maxBytes: SESSION_REVIEW_UPLOAD_MAX_BYTES,
      contentType: avatarContentType(key)
    };
  }

  if (kind === "sessionAlbumPhoto" || kind === "adminSessionAlbumPhoto") {
    const isAdminAlbumUpload = kind === "adminSessionAlbumPhoto";
    const session = isAdminAlbumUpload
      ? await assertAdminOwnSessionAlbumAllowed(user, sessionId)
      : await assertSessionAlbumUploadAllowed(user, sessionId);
    const filenamePrefix = isAdminAlbumUpload ? `admin-album-${session.id}` : `album-${session.id}`;
    const key = `uploads/session-album/display/${uploadFilenameBase(
      filenamePrefix,
      uploadUserId
    )}.jpg`;
    return {
      direct: true,
      kind,
      sessionId: Number(session.id),
      bucket: config.cos.bucket,
      region: config.cos.region,
      key,
      uploadPath: `/${key}`,
      maxBytes: SESSION_ALBUM_UPLOAD_MAX_BYTES,
      contentType: avatarContentType(`source${sourceExtension}`),
      picOperations: sessionAlbumDisplayJpgPicOperations(key)
    };
  }

  throw badRequest("unsupported upload kind");
}

function normalizeCosHeaders(headers = {}) {
  return Object.fromEntries(
    Object.entries(headers || {})
      .filter(([, value]) => value !== undefined && value !== null && value !== "")
      .map(([name, value]) => [String(name).toLowerCase(), String(value)])
  );
}

export function validateAlbumVideoCosUploadHeaders(headers = {}) {
  const normalized = normalizeCosHeaders(headers);
  if (normalized["x-cos-forbid-overwrite"] !== "true") {
    throw forbidden("album video upload must forbid object overwrite");
  }
  validateCosAlbumVideoHeaders({
    contentLength: normalized["content-length"],
    contentType: normalized["content-type"]
  });
  return normalized;
}

export function sanitizeCosDirectUploadHeaders({
  directUpload,
  key,
  headers = {},
  cosConfig = config.cos
} = {}) {
  const normalized = normalizeCosHeaders(headers);
  const allowed = new Set(["host", "content-type", "content-length"]);
  if (
    directUpload?.kind === "avatar" ||
    directUpload?.kind === "sessionAlbumPhoto" ||
    directUpload?.kind === "adminSessionAlbumPhoto"
  ) {
    allowed.add("pic-operations");
  }
  if (directUpload?.kind === "adminSessionAlbumVideo") {
    allowed.add("x-cos-forbid-overwrite");
  }
  for (const name of Object.keys(normalized)) {
    if (!allowed.has(name)) {
      throw forbidden(`unsupported COS upload header: ${name}`);
    }
  }

  const safeHeaders = Object.fromEntries(
    Object.entries(normalized).filter(([name]) => name !== "host")
  );
  safeHeaders.host = cosHost(cosConfig);
  if (directUpload?.kind === "adminSessionAlbumVideo") {
    validateAlbumVideoCosUploadHeaders(safeHeaders);
  }
  if (
    directUpload?.kind === "avatar" &&
    safeHeaders["pic-operations"] !== avatarWebpPicOperations(key)
  ) {
    throw forbidden("avatar upload must include the server-issued WebP processing rule");
  }
  if (
    (directUpload?.kind === "sessionAlbumPhoto" ||
      directUpload?.kind === "adminSessionAlbumPhoto") &&
    safeHeaders["pic-operations"] !== sessionAlbumDisplayJpgPicOperations(key)
  ) {
    throw forbidden("album upload must include the server-issued JPG processing rule");
  }
  return safeHeaders;
}

function directUploadKindForKey(key, userId) {
  const userIdText = String(userId);
  const avatarPattern = new RegExp(
    `^uploads/avatars/user-${userIdText}-\\d+-[a-f0-9]{16}\\.webp$`
  );
  if (avatarPattern.test(key)) {
    return { kind: "avatar" };
  }

  const reviewPattern = new RegExp(
    `^uploads/session-reviews/review-${userIdText}-\\d+-[a-f0-9]{16}\\.(?:jpg|jpeg|png)$`
  );
  if (reviewPattern.test(key)) {
    return { kind: "sessionReviewPhoto" };
  }

  const albumMatch = key.match(
    new RegExp(
      `^uploads/session-album/display/album-(\\d+)-${userIdText}-\\d+-[a-f0-9]{16}\\.jpg$`
    )
  );
  if (albumMatch) {
    return { kind: "sessionAlbumPhoto", sessionId: Number(albumMatch[1]) };
  }

  const adminAlbumMatch = key.match(
    new RegExp(
      `^uploads/session-album/display/admin-album-(\\d+)-${userIdText}-\\d+-[a-f0-9]{16}\\.jpg$`
    )
  );
  if (adminAlbumMatch) {
    return { kind: "adminSessionAlbumPhoto", sessionId: Number(adminAlbumMatch[1]) };
  }

  const adminAlbumVideoMatch = key.match(
    new RegExp(
      `^uploads/session-album/videos/source/admin-video-(\\d+)-${userIdText}-\\d+-[a-f0-9]{16}\\.mp4$`
    )
  );
  if (adminAlbumVideoMatch) {
    return { kind: "adminSessionAlbumVideo", sessionId: Number(adminAlbumVideoMatch[1]) };
  }

  throw forbidden("upload object key is not allowed");
}

async function authorizeCosDirectUpload({ body, user }) {
  if (!isCosUploadStorageEnabled()) {
    throw badRequest("COS storage is not enabled");
  }

  const userId = user.user.id;
  const bucket = String(body.bucket || body.Bucket || "");
  const region = String(body.region || body.Region || "");
  const method = String(body.method || body.Method || "").toUpperCase();
  const key = String(body.key || body.Key || "");

  if (bucket !== config.cos.bucket || region !== config.cos.region) {
    throw forbidden("COS bucket or region is not allowed");
  }
  if (method !== "PUT") {
    throw badRequest("only COS PUT uploads can be signed");
  }

  const directUpload = directUploadKindForKey(key, userId);
  const headers = sanitizeCosDirectUploadHeaders({
    directUpload,
    key,
    headers: body.headers || body.Headers,
    cosConfig: config.cos
  });
  if (directUpload.kind === "sessionAlbumPhoto") {
    await assertSessionAlbumUploadAllowed(
      { user: { id: userId }, roles: [] },
      directUpload.sessionId
    );
  }
  if (directUpload.kind === "adminSessionAlbumPhoto") {
    await assertAdminOwnSessionAlbumAllowed(user, directUpload.sessionId);
  }
  if (directUpload.kind === "adminSessionAlbumVideo") {
    requireRole(user, "system_admin");
    await assertSessionAlbumUploadAllowed(user, directUpload.sessionId);
  }
  return {
    authorization: buildCosAuthorization({
      method,
      key,
      headers,
      config: config.cos
    })
  };
}

async function saveUploadedObject({
  key,
  filename,
  file,
  contentType,
  localDir,
  picOperations,
  forbidOverwrite = false
}) {
  if (isCosUploadStorageEnabled()) {
    await putCosObject({
      key,
      body: file,
      contentType,
      picOperations,
      forbidOverwrite,
      config: config.cos
    });
    return `/${key}`;
  }

  await fs.mkdir(localDir, { recursive: true });
  await fs.writeFile(path.join(localDir, filename), file);
  return `/${key}`;
}

async function saveUploadedAvatar(request, userId) {
  const contentType = request.headers["content-type"] || "";
  const isMultipart = contentType.includes("multipart/form-data");
  const body = await readRawBody(
    request,
    isMultipart ? AVATAR_MULTIPART_MAX_BYTES : AVATAR_UPLOAD_MAX_BYTES
  );
  const { extension, file, mimeType } = isMultipart
    ? parseMultipartAvatarUpload(contentType, body)
    : parseRawAvatarUpload(contentType, body);
  const avatarFilenameBase = uploadFilenameBase("user", userId);
  const originalAvatarFilename = `${avatarFilenameBase}${extension}`;
  const avatarFilename = isCosUploadStorageEnabled()
    ? `${avatarFilenameBase}.webp`
    : originalAvatarFilename;
  const key = `uploads/avatars/${avatarFilename}`;
  return saveUploadedObject({
    key,
    filename: avatarFilename,
    file,
    contentType: mimeType || avatarContentType(originalAvatarFilename),
    picOperations: isCosUploadStorageEnabled() ? avatarWebpPicOperations(key) : "",
    localDir: avatarUploadDir
  });
}

async function saveUploadedSessionReviewPhoto(request, userId) {
  const contentType = request.headers["content-type"] || "";
  if (!contentType.includes("multipart/form-data")) {
    throw badRequest("review photo upload must be multipart/form-data");
  }

  const body = await readRawBody(request, SESSION_REVIEW_MULTIPART_MAX_BYTES);
  const { extension, file, mimeType } = parseMultipartImageUpload(contentType, body, {
    fieldName: "photo",
    maxBytes: SESSION_REVIEW_UPLOAD_MAX_BYTES,
    label: "review photo"
  });
  const photoFilename = `${uploadFilenameBase("review", userId)}${extension}`;
  return saveUploadedObject({
    key: `uploads/session-reviews/${photoFilename}`,
    filename: photoFilename,
    file,
    contentType: mimeType || avatarContentType(photoFilename),
    localDir: sessionReviewUploadDir
  });
}

async function processSessionAlbumDisplayJpg(file) {
  const { data, info } = await sharp(file, { failOn: "none" })
    .rotate()
    .resize({
      width: 2048,
      height: 2048,
      fit: "inside",
      withoutEnlargement: true
    })
    .jpeg({
      quality: 85,
      mozjpeg: true
    })
    .toBuffer({ resolveWithObject: true });
  return {
    file: data,
    width: info.width,
    height: info.height,
    byteSize: data.length,
    contentType: "image/jpeg"
  };
}

async function saveUploadedSessionAlbumPhoto(request, userId, sessionId, options = {}) {
  const contentType = request.headers["content-type"] || "";
  if (!contentType.includes("multipart/form-data")) {
    throw badRequest("album photo upload must be multipart/form-data");
  }

  const body = await readRawBody(request, SESSION_ALBUM_MULTIPART_MAX_BYTES);
  const { extension, file, mimeType } = parseMultipartImageUpload(contentType, body, {
    fieldName: "photo",
    maxBytes: SESSION_ALBUM_UPLOAD_MAX_BYTES,
    label: "album photo"
  });
  const filenamePrefix = options.filenamePrefix || `album-${sessionId}`;
  const photoFilename = `${uploadFilenameBase(filenamePrefix, userId)}.jpg`;
  const key = `uploads/session-album/display/${photoFilename}`;

  if (isCosUploadStorageEnabled()) {
    return saveUploadedObject({
      key,
      filename: photoFilename,
      file,
      contentType: mimeType || avatarContentType(`source${extension}`),
      picOperations: sessionAlbumDisplayJpgPicOperations(key),
      localDir: sessionAlbumDisplayUploadDir
    });
  }

  const display = await processSessionAlbumDisplayJpg(file);
  return saveUploadedObject({
    key,
    filename: photoFilename,
    file: display.file,
    contentType: display.contentType,
    localDir: sessionAlbumDisplayUploadDir
  });
}

async function saveUploadedSessionAlbumVideo(request, userId, sessionId) {
  const contentType = request.headers["content-type"] || "";
  if (!contentType.includes("multipart/form-data")) {
    throw badRequest("album video upload must be multipart/form-data");
  }

  const upload = await parseMultipartAlbumVideoStream({
    request,
    contentType,
    tempDir: sessionAlbumVideoSourceUploadDir,
    maxFileBytes: SESSION_ALBUM_VIDEO_UPLOAD_MAX_BYTES,
    maxRequestBytes: SESSION_ALBUM_VIDEO_MULTIPART_MAX_BYTES
  });
  try {
    const videoFilename = `${uploadFilenameBase(`admin-video-${sessionId}`, userId)}.mp4`;
    const key = `uploads/session-album/videos/source/${videoFilename}`;
    if (isCosUploadStorageEnabled()) {
      await uploadTempAlbumVideoToCos({
        tempPath: upload.tempPath,
        key,
        byteSize: upload.byteSize,
        contentType: upload.contentType,
        config: config.cos
      });
    } else {
      await finalizeLocalAlbumVideoUpload({
        tempPath: upload.tempPath,
        destinationPath: path.join(sessionAlbumVideoSourceUploadDir, videoFilename)
      });
    }
    return `/${key}`;
  } finally {
    await upload.cleanup();
  }
}

function sessionAlbumMediaSignature(photoId, expires) {
  return crypto
    .createHmac("sha256", config.sessionSecret)
    .update(`${photoId}:${expires}`)
    .digest("hex");
}

function sessionAlbumMediaPath(photoId, variant = "preview") {
  const expires = Math.floor(Date.now() / 1000) + SESSION_ALBUM_MEDIA_TOKEN_SECONDS;
  const signature = sessionAlbumMediaSignature(photoId, expires);
  const path = `/api/session-album/photos/${photoId}/image?expires=${encodeURIComponent(
    expires
  )}&signature=${encodeURIComponent(signature)}`;
  return variant === "thumbnail" ? `${path}&variant=thumbnail` : path;
}

function attachAlbumImageUrls(photo, legacyUrls, options) {
  const { storage_object_key: objectKey, storage_object_etag: ignoredEtag, ...safePhoto } = photo;
  void ignoredEtag;
  const signed = options.directMediaUrls && objectKey && cosStorageEnabled(options.cosConfig)
    ? options.buildUrls({
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

function albumImageUrlOptions(options = {}) {
  return {
    directMediaUrls: options.directMediaUrls ?? config.albumMedia.directMediaUrls,
    nowSeconds: options.nowSeconds ?? Math.floor(Date.now() / 1000),
    cosConfig: options.cosConfig || config.cos,
    buildUrls: options.buildUrls || buildAlbumImageUrls
  };
}

function attachLegacyFinalizedAlbumImageUrls(finalized, options = {}) {
  const resolved = albumImageUrlOptions(options);
  const preview = sessionAlbumMediaPath(finalized.photo.id, "preview");
  const thumbnail = sessionAlbumMediaPath(finalized.photo.id, "thumbnail");
  return {
    uploadId: finalized.uploadId,
    photo: attachAlbumImageUrls(finalized.photo, { preview, thumbnail }, resolved)
  };
}

function sessionAlbumVideoUrlPath(mediaId) {
  return `/api/session-album/media/${mediaId}/video-url`;
}

function sessionAlbumVideoCoverPath(mediaId) {
  const expires = Math.floor(Date.now() / 1000) + SESSION_ALBUM_MEDIA_TOKEN_SECONDS;
  const signature = sessionAlbumMediaSignature(mediaId, expires);
  return `/api/session-album/media/${mediaId}/cover?expires=${encodeURIComponent(
    expires
  )}&signature=${encodeURIComponent(signature)}`;
}

function sessionAlbumVideoFilePath(media, userId) {
  const token = signSignedPayload("session-album-video-file", {
    sessionId: tokenPositiveInteger(media.session_id, "sessionId"),
    userId: tokenPositiveInteger(userId, "userId"),
    mediaId: tokenPositiveInteger(media.id, "mediaId"),
    exp: Math.floor(Date.now() / 1000) + SESSION_ALBUM_MEDIA_TOKEN_SECONDS
  });
  return `/api/session-album/media/${media.id}/video-file?token=${encodeURIComponent(token)}`;
}

function verifySessionAlbumVideoFileQuery(mediaId, query) {
  const payload = verifySignedPayload(
    "session-album-video-file",
    query.get("token") || "",
    "album video token"
  );
  const tokenMediaId = tokenPositiveInteger(payload.mediaId, "mediaId");
  if (tokenMediaId !== Number(mediaId)) {
    throw forbidden("album video token is invalid");
  }
  const exp = tokenPositiveInteger(payload.exp, "exp");
  if (exp < Math.floor(Date.now() / 1000)) {
    throw forbidden("album video token expired");
  }
  return {
    sessionId: tokenPositiveInteger(payload.sessionId, "sessionId"),
    userId: tokenPositiveInteger(payload.userId, "userId"),
    mediaId: tokenMediaId,
    exp
  };
}

function encodeCosObjectKey(key) {
  return String(key || "").split("/").map(encodeURIComponent).join("/");
}

const SESSION_ALBUM_VIDEO_SOURCE_PREFIX = "/uploads/session-album/videos/source/";

function albumVideoSourceObjectKey(sourceUrl) {
  try {
    return cosObjectKeyFromUploadPath(sourceUrl, SESSION_ALBUM_VIDEO_SOURCE_PREFIX);
  } catch {
    throw badRequest("sourceUrl must contain an uploaded session album video");
  }
}

export function createSessionAlbumVideoStorageAdapter(options = {}) {
  const cosEnabled = options.cosEnabled ?? isCosUploadStorageEnabled();
  const cosConfig = options.cosConfig || config.cos;
  const headObject = options.headObject || headCosObject;
  const readObjectRange = options.readObjectRange || readCosObjectRange;
  const openFile = options.openFile || fs.open;
  const sourceDir = options.sourceDir || sessionAlbumVideoSourceUploadDir;

  if (!cosEnabled) {
    return {
      inspectObject: async (sourceUrl) => {
        const key = albumVideoSourceObjectKey(sourceUrl);
        const filename = key.slice(SESSION_ALBUM_VIDEO_SOURCE_PREFIX.length - 1);
        return inspectLocalAlbumVideoObject({
          filePath: path.join(sourceDir, filename),
          sourceUrl,
          openFile
        });
      }
    };
  }

  let inspectedKey = "";
  let inspectedEtag = "";
  let inspectedByteSize;
  return {
    getMetadata: async (sourceUrl) => {
      const key = albumVideoSourceObjectKey(sourceUrl);
      const object = await headObject({ key, config: cosConfig });
      const etag = String(object.headers?.etag || "").trim();
      if (!etag) {
        throw new AppError(
          502,
          "COS_OBJECT_VERSION_MISSING",
          "COS album video HEAD response did not include an ETag"
        );
      }
      const metadata = validateCosAlbumVideoHeaders({
        contentLength: object.headers?.["content-length"],
        contentType: object.headers?.["content-type"]
      });
      inspectedKey = key;
      inspectedEtag = etag;
      inspectedByteSize = metadata.byteSize;
      return metadata;
    },
    readRange: async (sourceUrl, start, end) => {
      const key = albumVideoSourceObjectKey(sourceUrl);
      if (!inspectedEtag || key !== inspectedKey) {
        throw new AppError(
          502,
          "COS_OBJECT_VERSION_MISSING",
          "COS album video object version was not established before reading"
        );
      }
      return readObjectRange({
        key,
        start,
        end,
        ifMatch: inspectedEtag,
        expectedByteSize: inspectedByteSize,
        config: cosConfig
      });
    }
  };
}

function albumVideoObjectKey(uploadPath) {
  const pathText = String(uploadPath || "");
  const prefixes = [
    "/uploads/session-album/videos/display/",
    "/uploads/session-album/videos/source/"
  ];
  const prefix = prefixes.find((candidate) => pathText.startsWith(candidate));
  if (!prefix) {
    throw notFound("Album video file not found");
  }
  return cosObjectKeyFromUploadPath(pathText, prefix);
}

function signedCosAlbumVideoUrl(media, method = "GET", range = "") {
  const key = albumVideoObjectKey(media.display_url || media.source_url);
  const host = cosHost(config.cos);
  const headers = {
    host,
    ...(range ? { range: String(range) } : {})
  };
  const authorization = buildCosAuthorization({
    method,
    key,
    headers,
    config: config.cos
  });
  return `https://${host}/${encodeCosObjectKey(key)}?${authorization}`;
}

function signedAlbumVideoUrl(media, userId) {
  return sessionAlbumVideoFilePath(media, userId);
}

function albumVideoSnapshotObjectKey(media) {
  return albumVideoObjectKey(media.video_cover_source_url || media.display_url || media.source_url);
}

function snapshotQueryString() {
  return new URLSearchParams(SESSION_ALBUM_VIDEO_SNAPSHOT_PARAMS).toString();
}

function signedAlbumVideoSnapshotUrl(media, userId) {
  void userId;
  if (!isCosUploadStorageEnabled()) {
    return "";
  }
  if (!media.video_cover_source_url && !media.display_url && !media.source_url) {
    return "";
  }
  const snapshotQuery = snapshotQueryString();
  const key = albumVideoSnapshotObjectKey(media);
  const host = cosHost(config.cos);
  const authorization = buildCosAuthorization({
    method: "GET",
    key,
    headers: { host },
    urlParams: SESSION_ALBUM_VIDEO_SNAPSHOT_PARAMS,
    config: config.cos
  });
  return `https://${host}/${encodeCosObjectKey(key)}?${snapshotQuery}&${authorization}`;
}

function signedPublicAlbumVideoSnapshotUrl(media, claims, albumShareToken) {
  void claims;
  void albumShareToken;
  if (!isCosUploadStorageEnabled()) {
    return "";
  }
  if (!media.video_cover_source_url && !media.display_url && !media.source_url) {
    return "";
  }
  const snapshotQuery = snapshotQueryString();
  const key = albumVideoSnapshotObjectKey(media);
  const host = cosHost(config.cos);
  const authorization = buildCosAuthorization({
    method: "GET",
    key,
    headers: { host },
    urlParams: SESSION_ALBUM_VIDEO_SNAPSHOT_PARAMS,
    config: config.cos
  });
  return `https://${host}/${encodeCosObjectKey(key)}?${snapshotQuery}&${authorization}`;
}

function stripAlbumVideoInternalFields(photo) {
  const { video_cover_source_url, ...safePhoto } = photo;
  return safePhoto;
}

function mediaVariant(query) {
  const variant = query.get("variant") || "preview";
  if (variant === "thumbnail") {
    return "thumbnail";
  }
  if (variant === "preview") {
    return "preview";
  }
  throw badRequest("unsupported album media variant");
}

function verifySessionAlbumMediaQuery(photoId, query) {
  const expires = Number.parseInt(query.get("expires") || "", 10);
  const signature = query.get("signature") || "";
  if (!expires || !signature) {
    throw forbidden("album media token is required");
  }
  if (expires < Math.floor(Date.now() / 1000)) {
    throw forbidden("album media token expired");
  }
  const expected = sessionAlbumMediaSignature(photoId, expires);
  const signatureBuffer = Buffer.from(signature, "hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  if (
    signatureBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)
  ) {
    throw forbidden("album media token is invalid");
  }
}

function signSessionAlbumDirectMediaToken(payload) {
  const exp = payload.exp ||
    Math.floor(Date.now() / 1000) + SESSION_ALBUM_MEDIA_TOKEN_SECONDS;
  return signSignedPayload("session-album-media", {
    sessionId: tokenPositiveInteger(payload.sessionId, "sessionId"),
    userId: tokenPositiveInteger(payload.userId, "userId"),
    photoId: tokenPositiveInteger(payload.photoId, "photoId"),
    variant: mediaVariantName(payload.variant || "preview"),
    exp: tokenPositiveInteger(exp, "exp")
  });
}

function sessionAlbumDirectMediaPath(photoId, album, userId, variant = "preview") {
  const normalizedVariant = mediaVariantName(variant);
  const token = signSessionAlbumDirectMediaToken({
    sessionId: album.session_id,
    userId,
    photoId,
    variant: normalizedVariant
  });
  return `/api/session-album/photos/${photoId}/image?token=${encodeURIComponent(
    token
  )}&variant=${encodeURIComponent(normalizedVariant)}`;
}

function verifySessionAlbumDirectMediaQuery(photoId, query) {
  const payload = verifySignedPayload(
    "session-album-media",
    query.get("token") || "",
    "album media token"
  );
  const tokenPhotoId = tokenPositiveInteger(payload.photoId, "photoId");
  if (tokenPhotoId !== Number(photoId)) {
    throw forbidden("album media token is invalid");
  }
  return {
    sessionId: tokenPositiveInteger(payload.sessionId, "sessionId"),
    userId: tokenPositiveInteger(payload.userId, "userId"),
    photoId: tokenPhotoId,
    variant: mediaVariantName(payload.variant || "preview"),
    exp: tokenPositiveInteger(payload.exp, "exp")
  };
}

function mediaVariantName(variant) {
  if (variant === "thumbnail") {
    return "thumbnail";
  }
  if (variant === "preview") {
    return "preview";
  }
  throw badRequest("unsupported album media variant");
}

export function attachSessionAlbumMediaUrls(album, userId, options = {}) {
  const resolved = albumImageUrlOptions(options);
  let signedImageCount = 0;
  const photos = album.photos.map((photo) => {
      if (photo.media_type === "video") {
        const safePhoto = stripAlbumVideoInternalFields(photo);
        return {
          ...safePhoto,
          cover_url: photo.has_cover ? signedAlbumVideoSnapshotUrl(photo, userId) : "",
          video_url: photo.processing_status === "ready" ? sessionAlbumVideoUrlPath(photo.id) : ""
        };
      }
      const preview = sessionAlbumMediaPath(photo.id, "preview");
      const thumbnail = sessionAlbumMediaPath(photo.id, "thumbnail");
      const willSign = resolved.directMediaUrls && photo.storage_object_key &&
        cosStorageEnabled(resolved.cosConfig);
      if (willSign) signedImageCount += 1;
      return attachAlbumImageUrls(photo, {
        preview,
        thumbnail,
        previewLoad: sessionAlbumDirectMediaPath(photo.id, album, userId, "preview"),
        thumbnailLoad: sessionAlbumDirectMediaPath(photo.id, album, userId, "thumbnail")
      }, resolved);
    });
  (options.emit || emitAlbumImageEvent)("media_urls_signed", {
    sessionId: Number(album.session_id),
    outcome: options.routeKind || "member",
    signedImageCount
  });
  return {
    ...album,
    photos,
    media: photos
  };
}

function signedPayloadSignature(purpose, payloadText) {
  return crypto
    .createHmac("sha256", config.sessionSecret)
    .update(`${purpose}:${payloadText}`)
    .digest("hex");
}

function tokenPositiveInteger(value, label) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw forbidden(`${label} is invalid`);
  }
  return parsed;
}

function signSignedPayload(purpose, payload) {
  const payloadText = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = signedPayloadSignature(purpose, payloadText);
  return `${payloadText}.${signature}`;
}

function verifySignedPayload(purpose, token, label) {
  const [payloadText, signature, extra] = String(token || "").split(".");
  if (!payloadText || !signature || extra !== undefined) {
    throw forbidden(`${label} is required`);
  }

  const expected = signedPayloadSignature(purpose, payloadText);
  const signatureBuffer = Buffer.from(signature, "hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  if (
    signatureBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)
  ) {
    throw forbidden(`${label} is invalid`);
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(payloadText, "base64url").toString("utf8"));
  } catch (error) {
    throw forbidden(`${label} is invalid`);
  }
  if (tokenPositiveInteger(payload.exp, "exp") < Math.floor(Date.now() / 1000)) {
    throw forbidden(`${label} expired`);
  }
  return payload;
}

function normalizeSessionAlbumShareClaims(payload) {
  return {
    sessionId: tokenPositiveInteger(payload.sessionId, "sessionId"),
    sharerUserId: tokenPositiveInteger(payload.sharerUserId, "sharerUserId"),
    seatId: tokenPositiveInteger(payload.seatId, "seatId"),
    exp: tokenPositiveInteger(payload.exp, "exp")
  };
}

function signSessionAlbumShareToken(payload) {
  const exp = payload.exp ||
    Math.floor(Date.now() / 1000) + SESSION_ALBUM_SHARE_TOKEN_SECONDS;
  return signSignedPayload(
    "session-album-share",
    normalizeSessionAlbumShareClaims({ ...payload, exp })
  );
}

function verifySessionAlbumShareToken(token) {
  return normalizeSessionAlbumShareClaims(
    verifySignedPayload("session-album-share", token, "album share token")
  );
}

function normalizeSessionJoinInviteClaims(payload) {
  if (payload.purpose !== "session_join_invite") {
    throw forbidden("session join invite token is invalid");
  }
  return {
    purpose: "session_join_invite",
    sessionId: tokenPositiveInteger(payload.sessionId, "sessionId"),
    inviterUserId: tokenPositiveInteger(payload.inviterUserId, "inviterUserId"),
    exp: tokenPositiveInteger(payload.exp, "exp")
  };
}

function signSessionJoinInviteToken(payload) {
  const exp = payload.exp || Math.floor(Date.now() / 1000) + SESSION_JOIN_INVITE_TOKEN_SECONDS;
  return signSignedPayload(
    "session-join-invite",
    normalizeSessionJoinInviteClaims({
      ...payload,
      purpose: "session_join_invite",
      exp
    })
  );
}

function verifySessionJoinInviteToken(token) {
  return normalizeSessionJoinInviteClaims(
    verifySignedPayload("session-join-invite", token, "session join invite token")
  );
}

function sessionAlbumTokenDigest(token) {
  return crypto
    .createHash("sha256")
    .update(String(token || ""))
    .digest("hex");
}

function signSessionAlbumPublicMediaToken(payload) {
  const exp = payload.exp ||
    Math.floor(Date.now() / 1000) + SESSION_ALBUM_PUBLIC_MEDIA_TOKEN_SECONDS;
  return signSignedPayload("session-album-public-media", {
    sessionId: tokenPositiveInteger(payload.sessionId, "sessionId"),
    sharerUserId: tokenPositiveInteger(payload.sharerUserId, "sharerUserId"),
    seatId: tokenPositiveInteger(payload.seatId, "seatId"),
    photoId: tokenPositiveInteger(payload.photoId, "photoId"),
    shareTokenDigest: String(payload.shareTokenDigest || ""),
    exp: tokenPositiveInteger(exp, "exp")
  });
}

function sessionAlbumPublicMediaPath(
  photoId,
  claims,
  albumShareToken,
  variant = "preview"
) {
  const token = signSessionAlbumPublicMediaToken({
    ...claims,
    photoId,
    shareTokenDigest: sessionAlbumTokenDigest(albumShareToken)
  });
  const path = `/api/session-album/public-share/photos/${photoId}/image?token=${encodeURIComponent(
    token
  )}`;
  return variant === "thumbnail" ? `${path}&variant=thumbnail` : path;
}

function sessionAlbumPublicVideoCoverPath(mediaId, claims, albumShareToken) {
  const token = signSessionAlbumPublicMediaToken({
    ...claims,
    photoId: mediaId,
    shareTokenDigest: sessionAlbumTokenDigest(albumShareToken)
  });
  return `/api/session-album/public-share/media/${mediaId}/cover?token=${encodeURIComponent(
    token
  )}`;
}

function verifySessionAlbumPublicMediaQuery(photoId, query) {
  const payload = verifySignedPayload(
    "session-album-public-media",
    query.get("token") || "",
    "album public media token"
  );
  const tokenPhotoId = tokenPositiveInteger(payload.photoId, "photoId");
  if (tokenPhotoId !== Number(photoId)) {
    throw forbidden("album public media token is invalid");
  }
  if (!payload.shareTokenDigest) {
    throw forbidden("album public media token is invalid");
  }
  return normalizeSessionAlbumShareClaims(payload);
}

export function attachPublicSessionAlbumMediaUrls(
  album,
  claims,
  albumShareToken,
  options = {}
) {
  const resolved = albumImageUrlOptions(options);
  let signedImageCount = 0;
  const photos = album.photos.map((photo) => {
      if (photo.media_type === "video") {
        const safePhoto = stripAlbumVideoInternalFields(photo);
        return {
          ...safePhoto,
          cover_url: photo.has_cover
            ? signedPublicAlbumVideoSnapshotUrl(photo, claims, albumShareToken)
            : ""
        };
      }
      const preview = sessionAlbumPublicMediaPath(photo.id, claims, albumShareToken, "preview");
      const thumbnail = sessionAlbumPublicMediaPath(photo.id, claims, albumShareToken, "thumbnail");
      const willSign = resolved.directMediaUrls && photo.storage_object_key &&
        cosStorageEnabled(resolved.cosConfig);
      if (willSign) signedImageCount += 1;
      return attachAlbumImageUrls(photo, { preview, thumbnail }, resolved);
    });
  (options.emit || emitAlbumImageEvent)("media_urls_signed", {
    sessionId: Number(album.session_id), outcome: "public-share", signedImageCount
  });
  return {
    ...album,
    photos,
    media: photos
  };
}

async function sessionAlbumThumbnailBuffer(file) {
  return sharp(file, { failOn: "none" })
    .rotate()
    .resize({
      width: 640,
      height: 640,
      fit: "inside",
      withoutEnlargement: true
    })
    .jpeg({ quality: 75 })
    .toBuffer();
}

async function serveLocalUploadedObject({ filePath, filename, response, cacheControl, ciProcess }) {
  let file;
  try {
    file = await fs.readFile(filePath);
  } catch (error) {
    throw notFound();
  }
  const isSessionAlbumThumbnail = ciProcess === SESSION_ALBUM_THUMBNAIL_RULE;
  if (isSessionAlbumThumbnail) {
    file = await sessionAlbumThumbnailBuffer(file);
    filename = "album-thumbnail.jpg";
  }

  response.writeHead(200, {
    "cache-control": cacheControl || "public, max-age=31536000, immutable",
    "content-length": file.length,
    "content-type": uploadedObjectContentType(filename)
  });
  response.end(file);
  return file.length;
}

async function serveCosUploadedObject({ key, filename, response, cacheControl, ciProcess }) {
  const object = await getCosObject({
    key,
    ciProcess,
    config: config.cos
  });

  response.writeHead(200, {
    "cache-control": cacheControl || "public, max-age=31536000, immutable",
    "content-length": object.body.length,
    "content-type": uploadedObjectContentType(filename, object.headers["content-type"])
  });
  response.end(object.body);
  return object.body.length;
}

async function serveUploadedObject({ url, prefix, localDir, response, cacheControl, ciProcess }) {
  const requestedName = decodeURIComponent(url.pathname.slice(prefix.length));
  const filename = path.basename(requestedName);
  if (!filename || filename !== requestedName || !/^[A-Za-z0-9._-]+$/.test(filename)) {
    throw notFound();
  }

  const key = cosObjectKeyFromUploadPath(`${prefix}${filename}`, prefix);
  if (isCosUploadStorageEnabled()) {
    try {
      return await serveCosUploadedObject({ key, filename, response, cacheControl, ciProcess });
    } catch (error) {
      if (error.statusCode && error.statusCode !== 404) {
        throw new AppError(502, "COS_STORAGE_ERROR", "COS storage request failed", error.body);
      }
    }
  }

  return serveLocalUploadedObject({
    filePath: path.join(localDir, filename),
    filename,
    response,
    cacheControl,
    ciProcess
  });
}

function hasObjectNotFoundStatus(error) {
  return [error?.statusCode, error?.status, error?.httpStatus]
    .some((value) => Number(value) === 404);
}

export async function deleteUploadedObject({
  url,
  prefix,
  localDir,
  cosEnabled = isCosUploadStorageEnabled(),
  cosConfig = config.cos,
  deleteCos = deleteCosObject,
  unlinkFile = fs.unlink,
  strictCosErrors = false
}) {
  const requestedName = decodeURIComponent(url.pathname.slice(prefix.length));
  const filename = path.basename(requestedName);
  if (!filename || filename !== requestedName || !/^[A-Za-z0-9._-]+$/.test(filename)) {
    return;
  }

  const key = cosObjectKeyFromUploadPath(`${prefix}${filename}`, prefix);
  if (cosEnabled) {
    try {
      await deleteCos({ key, config: cosConfig });
      return;
    } catch (error) {
      if (strictCosErrors) {
        // COS can make an already-cleaned object idempotent only when the 404
        // originated from our signed storage client. Every other COS failure
        // remains retryable and must keep the video row as the cleanup anchor.
        if (isTrustedCosStorageError(error) && Number(error.statusCode) === 404) return;
        // cleanupAlbumVideoBeforeDelete intentionally treats generic 404s as
        // idempotent for injected/local adapters. Do not let an untrusted COS
        // 404 reach that generic boundary and finalize the video row.
        if (hasObjectNotFoundStatus(error)) {
          throw new AppError(502, "COS_STORAGE_ERROR", "COS storage request failed");
        }
        throw error;
      }
      // Preserve the established image cleanup behavior: known COS failures
      // are reported, while legacy/unknown failures may still try local files.
      if (error.statusCode && error.statusCode !== 404) {
        throw new AppError(502, "COS_STORAGE_ERROR", "COS storage request failed", error.body);
      }
    }
  }

  try {
    await unlinkFile(path.join(localDir, filename));
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }
}

async function readUploadedObject({ url, prefix, localDir }) {
  const requestedName = decodeURIComponent(url.pathname.slice(prefix.length));
  const filename = path.basename(requestedName);
  if (!filename || filename !== requestedName || !/^[A-Za-z0-9._-]+$/.test(filename)) {
    throw notFound();
  }

  const key = cosObjectKeyFromUploadPath(`${prefix}${filename}`, prefix);
  if (isCosUploadStorageEnabled()) {
    const object = await getCosObject({
      key,
      config: config.cos
    });
    return {
      filename,
      body: object.body,
      contentType: uploadedObjectContentType(filename, object.headers["content-type"])
    };
  }

  try {
    const body = await fs.readFile(path.join(localDir, filename));
    return {
      filename,
      body,
      contentType: uploadedObjectContentType(filename)
    };
  } catch (error) {
    throw notFound();
  }
}

async function deleteUploadedSessionAlbumPhotoObject(photoUrl) {
  const url = new URL(photoUrl, "http://localhost");
  if (url.pathname.startsWith("/uploads/session-album/videos/source/")) {
    await deleteUploadedObject({
      url,
      prefix: "/uploads/session-album/videos/source/",
      localDir: sessionAlbumVideoSourceUploadDir,
      strictCosErrors: true
    });
    return;
  }
  if (url.pathname.startsWith("/uploads/session-album/videos/display/")) {
    await deleteUploadedObject({
      url,
      prefix: "/uploads/session-album/videos/display/",
      localDir: sessionAlbumVideoDisplayUploadDir,
      strictCosErrors: true
    });
    return;
  }
  if (url.pathname.startsWith("/uploads/session-album/videos/cover/")) {
    await deleteUploadedObject({
      url,
      prefix: "/uploads/session-album/videos/cover/",
      localDir: sessionAlbumVideoCoverUploadDir,
      strictCosErrors: true
    });
    return;
  }
  if (url.pathname.startsWith("/uploads/session-album/display/")) {
    await deleteUploadedObject({
      url,
      prefix: "/uploads/session-album/display/",
      localDir: sessionAlbumDisplayUploadDir
    });
    return;
  }
  if (url.pathname.startsWith("/uploads/session-album/")) {
    await deleteUploadedObject({
      url,
      prefix: "/uploads/session-album/",
      localDir: sessionAlbumUploadDir
    });
  }
}

async function cleanupUploadedSessionAlbumPhotoObject(photoUrl) {
  if (!photoUrl) {
    return;
  }
  try {
    await deleteUploadedSessionAlbumPhotoObject(photoUrl);
  } catch (error) {
    console.warn("session album COS cleanup failed", {
      code: error?.code || error?.name || "UNKNOWN",
      statusCode: error?.statusCode || null,
      message: error?.message || String(error),
      path: new URL(photoUrl, "http://localhost").pathname
    });
  }
}

async function cleanupUploadedSessionAlbumMediaObjects(urls = []) {
  for (const url of urls) {
    await cleanupUploadedSessionAlbumPhotoObject(url);
  }
}

async function serveUploadedAvatar(url, response) {
  try {
    await serveUploadedObject({
      url,
      prefix: "/uploads/avatars/",
      localDir: avatarUploadDir,
      response
    });
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    throw notFound();
  }
}

async function serveUploadedSessionReviewPhoto(url, response) {
  try {
    await serveUploadedObject({
      url,
      prefix: "/uploads/session-reviews/",
      localDir: sessionReviewUploadDir,
      response
    });
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    throw notFound();
  }
}

async function serveUploadedSessionAlbumPhoto(photo, response, options = {}) {
  const cacheControl = "private, no-store";
  const ciProcess =
    options.variant === "thumbnail" ? SESSION_ALBUM_THUMBNAIL_RULE : undefined;
  try {
    const photoUrl = new URL(photo.photo_url, "http://localhost");
    if (photoUrl.pathname.startsWith("/uploads/session-album/display/")) {
      const byteCount = await serveUploadedObject({
        url: photoUrl,
        prefix: "/uploads/session-album/display/",
        localDir: sessionAlbumDisplayUploadDir,
        response,
        cacheControl,
        ciProcess
      });
      emitAlbumImageEvent("legacy_proxy_read", {
        sessionId: Number(photo.session_id),
        mediaId: Number(photo.id),
        outcome: "success",
        variant: options.variant || "preview",
        byteCount
      });
      return byteCount;
    }
    const byteCount = await serveUploadedObject({
      url: photoUrl,
      prefix: "/uploads/session-album/",
      localDir: sessionAlbumUploadDir,
      response,
      cacheControl,
      ciProcess
    });
    emitAlbumImageEvent("legacy_proxy_read", {
      sessionId: Number(photo.session_id),
      mediaId: Number(photo.id),
      outcome: "success",
      variant: options.variant || "preview",
      byteCount
    });
    return byteCount;
  } catch (error) {
    emitAlbumImageEvent("legacy_proxy_read", {
      sessionId: Number(photo.session_id),
      mediaId: Number(photo.id),
      outcome: "failure",
      variant: options.variant || "preview",
      errorCode: error?.code || "LEGACY_PROXY_READ_FAILED"
    });
    if (error instanceof AppError) {
      throw error;
    }
    throw notFound();
  }
}

async function serveUploadedSessionAlbumVideoCover(media, response) {
  if (!media.cover_url) {
    throw notFound("Album video cover not found");
  }
  const cacheControl = "private, no-store";
  try {
    const coverUrl = new URL(media.cover_url, "http://localhost");
    await serveUploadedObject({
      url: coverUrl,
      prefix: "/uploads/session-album/videos/cover/",
      localDir: sessionAlbumVideoCoverUploadDir,
      response,
      cacheControl
    });
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    throw notFound();
  }
}

function localAlbumVideoFilePath(videoPath, options = {}) {
  const prefixes = [
    [
      "/uploads/session-album/videos/display/",
      options.displayDir || sessionAlbumVideoDisplayUploadDir
    ],
    [SESSION_ALBUM_VIDEO_SOURCE_PREFIX, options.sourceDir || sessionAlbumVideoSourceUploadDir]
  ];
  for (const [prefix, localDir] of prefixes) {
    if (!String(videoPath).startsWith(prefix)) continue;
    try {
      const key = cosObjectKeyFromUploadPath(videoPath, prefix);
      const filename = key.slice(prefix.length - 1);
      return path.join(localDir, filename);
    } catch {
      throw notFound("Album video file not found");
    }
  }
  throw notFound("Album video file not found");
}

export async function serveUploadedSessionAlbumVideoFile(media, response, options = {}) {
  const videoPath = media.display_url || media.source_url;
  if (!videoPath) {
    throw notFound("Album video file not found");
  }
  const cacheControl = "private, no-store";
  const method = String(options.method || "GET").toUpperCase();
  const range = options.range;
  const cosEnabled = options.cosEnabled ?? isCosUploadStorageEnabled();
  if (cosEnabled) {
    response.writeHead(302, {
      "cache-control": cacheControl,
      location: signedCosAlbumVideoUrl(media, method, range)
    });
    response.end();
    return;
  }
  const localResponse = await createLocalAlbumVideoResponse({
    filePath: localAlbumVideoFilePath(videoPath, options),
    method,
    range
  });
  response.writeHead(localResponse.statusCode, {
    ...localResponse.headers,
    "cache-control": cacheControl
  });
  if (!localResponse.body) {
    response.end();
    return;
  }
  try {
    await pipeline(localResponse.body, response);
  } catch (error) {
    response.destroy(error);
  }
}

async function getSessionAlbumDisplayMetadata(photoUrl) {
  const url = new URL(photoUrl, "http://localhost");
  if (!url.pathname.startsWith("/uploads/session-album/display/")) {
    throw badRequest("album photo must use the display image path");
  }
  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const object = await readUploadedObject({
        url,
        prefix: "/uploads/session-album/display/",
        localDir: sessionAlbumDisplayUploadDir
      });
      const metadata = await sharp(object.body, { failOn: "none" }).metadata();
      if (metadata.format !== "jpeg") {
        throw badRequest("album display photo must be a processed JPEG");
      }
      if (Number(metadata.width || 0) > 2048 || Number(metadata.height || 0) > 2048) {
        throw badRequest("album display photo exceeds the 2048px size limit");
      }
      return {
        imageWidth: metadata.width || null,
        imageHeight: metadata.height || null,
        imageByteSize: object.body.length,
        imageContentType: "image/jpeg"
      };
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 180 * (attempt + 1)));
    }
  }
  throw lastError || notFound("Album display photo not found");
}

function idMatch(pathname, pattern) {
  const match = pathname.match(pattern);
  return match ? Number(match[1]) : null;
}

function stringMatch(pathname, pattern) {
  const match = pathname.match(pattern);
  return match ? match[1] : null;
}

async function getAuthUser(request) {
  const header = request.headers.authorization || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    throw unauthorized();
  }
  return verifyBusinessToken(match[1]);
}

async function optionalAuthUser(request) {
  try {
    return await getAuthUser(request);
  } catch (error) {
    return null;
  }
}

function requireRole(user, role) {
  if (!user.roles.includes(role)) {
    throw forbidden(`${role} role required`);
  }
}

function d40SmokeDatabaseIsIsolated() {
  const host = String(config.mysql.host || "").trim().toLowerCase();
  const localHost = ["127.0.0.1", "localhost", "::1"].includes(host);
  return (
    config.nodeEnv !== "production" &&
    config.wechat.mockLogin === true &&
    process.env.D40_SMOKE_ISOLATED === "1" &&
    localHost &&
    config.mysql.database === "pinche_d40_test"
  );
}

function d45SmokeDatabaseIsIsolated() {
  const host = String(config.mysql.host || "").trim().toLowerCase();
  const localHost = ["127.0.0.1", "localhost", "::1"].includes(host);
  return (
    config.nodeEnv !== "production" &&
    config.wechat.mockLogin === true &&
    process.env.D45_SMOKE_ISOLATED === "1" &&
    localHost &&
    config.mysql.database.startsWith("pinche_d45_test")
  );
}

async function route(request, response) {
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);

  if (request.method === "GET" && url.pathname.startsWith("/uploads/avatars/")) {
    await serveUploadedAvatar(url, response);
    return;
  }

  if (request.method === "GET" && url.pathname.startsWith("/uploads/session-reviews/")) {
    await serveUploadedSessionReviewPhoto(url, response);
    return;
  }

  const publicSessionAlbumMediaPhotoId = idMatch(
    url.pathname,
    /^\/api\/session-album\/public-share\/photos\/(\d+)\/image$/
  );
  if (request.method === "GET" && publicSessionAlbumMediaPhotoId) {
    const claims = verifySessionAlbumPublicMediaQuery(
      publicSessionAlbumMediaPhotoId,
      url.searchParams
    );
    const variant = mediaVariant(url.searchParams);
    const photo = await getPublicSessionAlbumPhotoForMedia(
      claims,
      publicSessionAlbumMediaPhotoId
    );
    await serveUploadedSessionAlbumPhoto(photo, response, { variant });
    return;
  }

  const publicSessionAlbumVideoCoverId = idMatch(
    url.pathname,
    /^\/api\/session-album\/public-share\/media\/(\d+)\/cover$/
  );
  if (request.method === "GET" && publicSessionAlbumVideoCoverId) {
    const claims = verifySessionAlbumPublicMediaQuery(
      publicSessionAlbumVideoCoverId,
      url.searchParams
    );
    const media = await getPublicSessionAlbumVideoCoverForMedia(
      claims,
      publicSessionAlbumVideoCoverId
    );
    await serveUploadedSessionAlbumVideoCover(media, response);
    return;
  }

  const sessionAlbumMediaPhotoId = idMatch(
    url.pathname,
    /^\/api\/session-album\/photos\/(\d+)\/image$/
  );
  if (request.method === "GET" && sessionAlbumMediaPhotoId) {
    const variant = mediaVariant(url.searchParams);
    const directMediaToken = url.searchParams.get("token") || "";
    if (directMediaToken) {
      const claims = verifySessionAlbumDirectMediaQuery(
        sessionAlbumMediaPhotoId,
        url.searchParams
      );
      if (claims.variant !== variant) {
        throw forbidden("album media token is invalid");
      }
      const photo = await getVisibleSessionAlbumPhotoForMedia(
        claims.userId,
        sessionAlbumMediaPhotoId
      );
      if (Number(photo.session_id) !== claims.sessionId) {
        throw forbidden("album media token is invalid");
      }
      await serveUploadedSessionAlbumPhoto(photo, response, { variant });
      return;
    }
    const user = await getAuthUser(request);
    verifySessionAlbumMediaQuery(sessionAlbumMediaPhotoId, url.searchParams);
    const photo = await getVisibleSessionAlbumPhotoForMedia(
      user.user.id,
      sessionAlbumMediaPhotoId
    );
    await serveUploadedSessionAlbumPhoto(photo, response, { variant });
    return;
  }

  const sessionAlbumMediaVideoCoverId = idMatch(
    url.pathname,
    /^\/api\/session-album\/media\/(\d+)\/cover$/
  );
  if (request.method === "GET" && sessionAlbumMediaVideoCoverId) {
    const user = await getAuthUser(request);
    verifySessionAlbumMediaQuery(sessionAlbumMediaVideoCoverId, url.searchParams);
    const media = await getVisibleSessionAlbumVideoForPlayback(
      user,
      sessionAlbumMediaVideoCoverId
    );
    await serveUploadedSessionAlbumVideoCover(media, response);
    return;
  }

  const sessionAlbumMediaVideoFileId = idMatch(
    url.pathname,
    /^\/api\/session-album\/media\/(\d+)\/video-file$/
  );
  if ((request.method === "GET" || request.method === "HEAD") && sessionAlbumMediaVideoFileId) {
    const claims = verifySessionAlbumVideoFileQuery(
      sessionAlbumMediaVideoFileId,
      url.searchParams
    );
    const media = await getVisibleSessionAlbumVideoForPlayback(
      { user: { id: claims.userId }, roles: [] },
      sessionAlbumMediaVideoFileId
    );
    if (Number(media.session_id) !== claims.sessionId) {
      throw forbidden("album video token is invalid");
    }
    await serveUploadedSessionAlbumVideoFile(media, response, {
      method: request.method,
      range: request.headers.range
    });
    return;
  }

  const sessionAlbumMediaVideoUrlId = idMatch(
    url.pathname,
    /^\/api\/session-album\/media\/(\d+)\/video-url$/
  );
  if (request.method === "GET" && sessionAlbumMediaVideoUrlId) {
    const user = await getAuthUser(request);
    const media = await getVisibleSessionAlbumVideoForPlayback(
      user,
      sessionAlbumMediaVideoUrlId
    );
    jsonResponse(response, 200, {
      ok: true,
      data: {
        url: signedAlbumVideoUrl(media, user.user.id),
        expiresInSeconds: SESSION_ALBUM_MEDIA_TOKEN_SECONDS
      }
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/users/me/avatar") {
    const user = await getAuthUser(request);
    const avatarUrl = await saveUploadedAvatar(request, user.user.id);
    jsonResponse(response, 201, {
      ok: true,
      data: { avatarUrl }
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/session-reviews/photos") {
    const user = await getAuthUser(request);
    const photoUrl = await saveUploadedSessionReviewPhoto(request, user.user.id);
    jsonResponse(response, 201, {
      ok: true,
      data: { photoUrl }
    });
    return;
  }

  const sessionAlbumUploadId = idMatch(
    url.pathname,
    /^\/api\/sessions\/(\d+)\/album\/uploads$/
  );
  if (request.method === "POST" && sessionAlbumUploadId) {
    const user = await getAuthUser(request);
    await assertSessionAlbumUploadAllowed(user, sessionAlbumUploadId);
    if (config.albumMedia.directUploadRequired) {
      throw new AppError(
        409,
        "DIRECT_UPLOAD_REQUIRED",
        "Production album images must be uploaded directly to COS"
      );
    }
    const photoUrl = await saveUploadedSessionAlbumPhoto(
      request,
      user.user.id,
      sessionAlbumUploadId
    );
    jsonResponse(response, 201, {
      ok: true,
      data: { photoUrl }
    });
    return;
  }

  const adminSessionAlbumUploadId = idMatch(
    url.pathname,
    /^\/api\/admin\/sessions\/(\d+)\/album\/uploads$/
  );
  if (request.method === "POST" && adminSessionAlbumUploadId) {
    const user = await getAuthUser(request);
    const session = await assertAdminOwnSessionAlbumAllowed(user, adminSessionAlbumUploadId);
    if (config.albumMedia.directUploadRequired) {
      throw new AppError(
        409,
        "DIRECT_UPLOAD_REQUIRED",
        "Production album images must be uploaded directly to COS"
      );
    }
    const photoUrl = await saveUploadedSessionAlbumPhoto(
      request,
      user.user.id,
      adminSessionAlbumUploadId,
      { filenamePrefix: `admin-album-${session.id}` }
    );
    jsonResponse(response, 201, {
      ok: true,
      data: { photoUrl }
    });
    return;
  }

  const adminSessionAlbumVideoUploadId = idMatch(
    url.pathname,
    /^\/api\/admin\/sessions\/(\d+)\/album\/videos\/uploads$/
  );
  if (request.method === "POST" && adminSessionAlbumVideoUploadId) {
    const user = await getAuthUser(request);
    requireRole(user, "system_admin");
    await assertSessionAlbumUploadAllowed(user, adminSessionAlbumVideoUploadId);
    const sourceUrl = await saveUploadedSessionAlbumVideo(
      request,
      user.user.id,
      adminSessionAlbumVideoUploadId
    );
    jsonResponse(response, 201, {
      ok: true,
      data: { sourceUrl }
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/cos/ci/session-album-video-callback") {
    const callbackResult = await handleSessionAlbumVideoProcessingCallback(url, request);
    jsonResponse(response, 200, {
      ok: true,
      data: callbackResult
    });
    return;
  }

  const body = await bodyFor(request);

  if (request.method === "POST" && url.pathname === "/api/uploads/cos-intent") {
    const user = await getAuthUser(request);
    const upload = isAlbumImageKind(body.kind)
      ? await albumImageUploads.createIntent({ user, body })
      : await createCosDirectUploadIntent({
          kind: body.kind,
          extension: body.extension,
          user,
          userId: user.user.id,
          sessionId: body.sessionId || body.session_id
        });
    jsonResponse(response, 200, {
      ok: true,
      data: {
        upload
      }
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/uploads/cos-authorization") {
    const user = await getAuthUser(request);
    const useAlbumImageAuthorization = await isPersistedAlbumImageAuthorization(user, body);
    jsonResponse(response, 200, {
      ok: true,
      data: useAlbumImageAuthorization
        ? await albumImageUploads.authorize({ body, user })
        : await authorizeCosDirectUpload({ body, user })
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/telemetry/album-media") {
    await getAuthUser(request);
    const allowedEvents = new Set([
      "upload_retry",
      "upload_failure",
      "media_refresh_success",
      "media_refresh_failure"
    ]);
    const event = String(body.event || "");
    if (!allowedEvents.has(event)) throw badRequest("unsupported album media event");
    const sessionId = Number(body.sessionId ?? body.session_id ?? 0);
    const retryCount = Number(body.retryCount ?? body.retry_count ?? 0);
    if (
      (sessionId && (!Number.isSafeInteger(sessionId) || sessionId < 0)) ||
      (!Number.isSafeInteger(retryCount) || retryCount < 0)
    ) {
      throw badRequest("invalid album media telemetry fields");
    }
    const errorCode = body.errorCode ?? body.error_code;
    if (errorCode !== undefined && !/^[A-Z0-9_]{1,64}$/.test(String(errorCode))) {
      throw badRequest("invalid album media telemetry error code");
    }
    emitAlbumImageEvent(event, {
      sessionId,
      retryCount,
      errorCode: errorCode ? String(errorCode) : undefined
    });
    jsonResponse(response, 202, { ok: true });
    return;
  }

  if (request.method === "GET" && url.pathname === "/health") {
    const database = await checkDatabaseReadiness();
    jsonResponse(response, database.ok ? 200 : 503, {
      ok: database.ok,
      service: "pinche-api",
      config: publicConfig(),
      database,
      now: new Date().toISOString()
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/health/db") {
    const database = await checkDatabaseReadiness();
    jsonResponse(response, database.ok ? 200 : 503, {
      ok: database.ok,
      database: config.mysql.database,
      connected: database.connected,
      schemaReady: database.schemaReady,
      missingTables: database.missingTables,
      ...(database.error ? { error: database.error } : {})
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/testing/d40-smoke-target") {
    if (!d40SmokeDatabaseIsIsolated()) {
      throw new AppError(
        409,
        "SMOKE_DATABASE_NOT_ISOLATED",
        "D40 smoke requires the dedicated local pinche_d40_test database"
      );
    }
    jsonResponse(response, 200, {
      ok: true,
      data: {
        mode: "d40",
        isolated: true,
        database: config.mysql.database
      }
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/testing/d45-smoke-target") {
    if (!d45SmokeDatabaseIsIsolated()) {
      throw new AppError(
        409,
        "SMOKE_DATABASE_NOT_ISOLATED",
        "D45 smoke requires a dedicated local pinche_d45_test database and mock login"
      );
    }
    jsonResponse(response, 200, {
      ok: true,
      data: {
        marker: "d45-session-reschedule-notifications",
        isolated: true,
        database: config.mysql.database,
        wechat_mock_login: true
      }
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/auth/wechat/login") {
    const result = await loginWithWechatCode(body.code);
    jsonResponse(response, 200, {
      ok: true,
      data: result
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/admin/web-login/tickets") {
    jsonResponse(response, 201, {
      ok: true,
      data: await createAdminWebLoginTicket({
        userAgent: request.headers["user-agent"] || body.userAgent
      })
    });
    return;
  }

  const adminWebLoginTicketId = url.pathname.match(
    /^\/api\/admin\/web-login\/tickets\/([^/]+)$/
  )?.[1];
  if (request.method === "GET" && adminWebLoginTicketId) {
    jsonResponse(response, 200, {
      ok: true,
      data: await pollAdminWebLoginTicket(
        adminWebLoginTicketId,
        url.searchParams.get("secret")
      )
    });
    return;
  }

  const adminWebLoginApproveId = url.pathname.match(
    /^\/api\/admin\/web-login\/tickets\/([^/]+)\/approve$/
  )?.[1];
  if (request.method === "POST" && adminWebLoginApproveId) {
    const user = await getAuthUser(request);
    jsonResponse(response, 200, {
      ok: true,
      data: await approveAdminWebLoginTicket(user, adminWebLoginApproveId, body)
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/auth/wechat/phone") {
    const user = await getAuthUser(request);
    const phoneCredential = body.code || body.phoneCode || body.phoneEncrypted || body.phone;
    if (!phoneCredential) {
      throw badRequest("phone authorization code is required");
    }
    const updated = await updateUserPhone(user.user.id, phoneCredential);
    jsonResponse(response, 200, {
      ok: true,
      data: {
        user: updated,
        roles: user.roles
      }
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/users/me") {
    const user = await getAuthUser(request);
    jsonResponse(response, 200, { ok: true, data: user });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/users/me/notifications") {
    const user = await getAuthUser(request);
    jsonResponse(response, 200, {
      ok: true,
      data: await listMyNotifications(user, Object.fromEntries(url.searchParams))
    });
    return;
  }

  const notificationReadId = idMatch(
    url.pathname,
    /^\/api\/users\/me\/notifications\/(\d+)\/read$/
  );
  if (request.method === "POST" && notificationReadId) {
    const user = await getAuthUser(request);
    jsonResponse(response, 200, {
      ok: true,
      data: await markMyNotificationRead(user, notificationReadId)
    });
    return;
  }

  if (request.method === "PATCH" && url.pathname === "/api/users/me") {
    const user = await getAuthUser(request);
    const updatedUser = await updateUserProfile(user.user.id, body);
    jsonResponse(response, 200, {
      ok: true,
      data: {
        user: updatedUser,
        roles: user.roles
      }
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/stores") {
    const user = await optionalAuthUser(request);
    jsonResponse(response, 200, {
      ok: true,
      data: await listActiveStores(Object.fromEntries(url.searchParams), user)
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/stores") {
    const user = await getAuthUser(request);
    jsonResponse(response, 201, {
      ok: true,
      data: await createPrivateStore(user, body)
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/scripts") {
    const user = await optionalAuthUser(request);
    jsonResponse(response, 200, {
      ok: true,
      data: await listActiveScripts(Object.fromEntries(url.searchParams), user)
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/scripts") {
    const user = await getAuthUser(request);
    jsonResponse(response, 201, {
      ok: true,
      data: await createPrivateScript(user, body)
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/catalog-review-items/mine") {
    const user = await getAuthUser(request);
    jsonResponse(response, 200, {
      ok: true,
      data: await listMyCatalogReviewItems(user, Object.fromEntries(url.searchParams))
    });
    return;
  }

  const myCatalogReviewItemMatch = url.pathname.match(
    /^\/api\/catalog-review-items\/(store|script)\/(\d+)$/
  );
  if (request.method === "PATCH" && myCatalogReviewItemMatch) {
    const user = await getAuthUser(request);
    jsonResponse(response, 200, {
      ok: true,
      data: await updateMyCatalogReviewItem(
        user,
        myCatalogReviewItemMatch[1],
        Number(myCatalogReviewItemMatch[2]),
        body
      )
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/admin/stores") {
    const user = await getAuthUser(request);
    requireRole(user, "system_admin");
    jsonResponse(response, 200, {
      ok: true,
      data: await listAdminStores(Object.fromEntries(url.searchParams))
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/admin/stores") {
    const user = await getAuthUser(request);
    requireRole(user, "system_admin");
    jsonResponse(response, 201, { ok: true, data: await createStore(user, body) });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/admin/location/geocode") {
    const user = await getAuthUser(request);
    requireRole(user, "system_admin");
    jsonResponse(response, 200, { ok: true, data: await geocodeStoreLocation(body) });
    return;
  }

  const adminStoreScriptsId = idMatch(url.pathname, /^\/api\/admin\/stores\/(\d+)\/scripts$/);
  if (request.method === "GET" && adminStoreScriptsId) {
    const user = await getAuthUser(request);
    requireRole(user, "system_admin");
    jsonResponse(response, 200, {
      ok: true,
      data: await listStoreScripts(adminStoreScriptsId)
    });
    return;
  }

  if (request.method === "PUT" && adminStoreScriptsId) {
    const user = await getAuthUser(request);
    requireRole(user, "system_admin");
    jsonResponse(response, 200, {
      ok: true,
      data: await replaceStoreScripts(adminStoreScriptsId, body)
    });
    return;
  }

  const adminStoreId = idMatch(url.pathname, /^\/api\/admin\/stores\/(\d+)$/);
  if (request.method === "PATCH" && adminStoreId) {
    const user = await getAuthUser(request);
    requireRole(user, "system_admin");
    jsonResponse(response, 200, { ok: true, data: await updateStore(adminStoreId, body) });
    return;
  }

  if (request.method === "DELETE" && adminStoreId) {
    const user = await getAuthUser(request);
    requireRole(user, "system_admin");
    jsonResponse(response, 200, { ok: true, data: await deleteStore(adminStoreId) });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/admin/scripts") {
    const user = await getAuthUser(request);
    requireRole(user, "system_admin");
    jsonResponse(response, 201, { ok: true, data: await createScript(user, body) });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/admin/scripts") {
    const user = await getAuthUser(request);
    requireRole(user, "system_admin");
    jsonResponse(response, 200, {
      ok: true,
      data: await listAdminScripts(Object.fromEntries(url.searchParams))
    });
    return;
  }

  const adminScriptId = idMatch(url.pathname, /^\/api\/admin\/scripts\/(\d+)$/);
  if (request.method === "PATCH" && adminScriptId) {
    const user = await getAuthUser(request);
    requireRole(user, "system_admin");
    jsonResponse(response, 200, {
      ok: true,
      data: await updateScript(adminScriptId, body)
    });
    return;
  }

  if (request.method === "DELETE" && adminScriptId) {
    const user = await getAuthUser(request);
    requireRole(user, "system_admin");
    jsonResponse(response, 200, {
      ok: true,
      data: await deleteScript(adminScriptId)
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/admin/catalog-review-items") {
    const user = await getAuthUser(request);
    requireRole(user, "system_admin");
    jsonResponse(response, 200, {
      ok: true,
      data: await listAdminCatalogReviewItems(Object.fromEntries(url.searchParams))
    });
    return;
  }

  const adminCatalogReviewItemMatch = url.pathname.match(
    /^\/api\/admin\/catalog-review-items\/(store|script)\/(\d+)$/
  );
  if (request.method === "PATCH" && adminCatalogReviewItemMatch) {
    const user = await getAuthUser(request);
    requireRole(user, "system_admin");
    jsonResponse(response, 200, {
      ok: true,
      data: await updateAdminCatalogReviewItem(
        user,
        adminCatalogReviewItemMatch[1],
        Number(adminCatalogReviewItemMatch[2]),
        body
      )
    });
    return;
  }

  const adminCatalogReviewApproveMatch = url.pathname.match(
    /^\/api\/admin\/catalog-review-items\/(store|script)\/(\d+)\/approve$/
  );
  if (request.method === "POST" && adminCatalogReviewApproveMatch) {
    const user = await getAuthUser(request);
    requireRole(user, "system_admin");
    jsonResponse(response, 200, {
      ok: true,
      data: await approveCatalogReviewItem(
        user,
        adminCatalogReviewApproveMatch[1],
        Number(adminCatalogReviewApproveMatch[2]),
        body
      )
    });
    return;
  }

  const adminCatalogReviewNeedsChangesMatch = url.pathname.match(
    /^\/api\/admin\/catalog-review-items\/(store|script)\/(\d+)\/needs-changes$/
  );
  if (request.method === "POST" && adminCatalogReviewNeedsChangesMatch) {
    const user = await getAuthUser(request);
    requireRole(user, "system_admin");
    jsonResponse(response, 200, {
      ok: true,
      data: await markCatalogReviewItemNeedsChanges(
        user,
        adminCatalogReviewNeedsChangesMatch[1],
        Number(adminCatalogReviewNeedsChangesMatch[2]),
        body
      )
    });
    return;
  }

  const adminCatalogReviewRejectMatch = url.pathname.match(
    /^\/api\/admin\/catalog-review-items\/(store|script)\/(\d+)\/reject$/
  );
  if (request.method === "POST" && adminCatalogReviewRejectMatch) {
    const user = await getAuthUser(request);
    requireRole(user, "system_admin");
    jsonResponse(response, 200, {
      ok: true,
      data: await rejectCatalogReviewItem(
        user,
        adminCatalogReviewRejectMatch[1],
        Number(adminCatalogReviewRejectMatch[2]),
        body
      )
    });
    return;
  }

  const adminCatalogReviewMergeMatch = url.pathname.match(
    /^\/api\/admin\/catalog-review-items\/(store|script)\/(\d+)\/merge$/
  );
  if (request.method === "POST" && adminCatalogReviewMergeMatch) {
    const user = await getAuthUser(request);
    requireRole(user, "system_admin");
    jsonResponse(response, 200, {
      ok: true,
      data: await mergeCatalogReviewItem(
        user,
        adminCatalogReviewMergeMatch[1],
        Number(adminCatalogReviewMergeMatch[2]),
        body
      )
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/admin/sessions") {
    const user = await getAuthUser(request);
    requireRole(user, "system_admin");
    jsonResponse(response, 200, {
      ok: true,
      data: await listAdminSessions(Object.fromEntries(url.searchParams))
    });
    return;
  }

  const adminSessionId = idMatch(url.pathname, /^\/api\/admin\/sessions\/(\d+)$/);
  if (request.method === "DELETE" && adminSessionId) {
    const user = await getAuthUser(request);
    requireRole(user, "system_admin");
    jsonResponse(response, 200, {
      ok: true,
      data: await deleteAdminSession(adminSessionId)
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/admin/catalog-requests") {
    const user = await getAuthUser(request);
    requireRole(user, "system_admin");
    jsonResponse(response, 200, {
      ok: true,
      data: await listCatalogRequests(Object.fromEntries(url.searchParams))
    });
    return;
  }

  const adminCatalogRequestId = idMatch(
    url.pathname,
    /^\/api\/admin\/catalog-requests\/(\d+)$/
  );
  if (request.method === "PATCH" && adminCatalogRequestId) {
    const user = await getAuthUser(request);
    requireRole(user, "system_admin");
    jsonResponse(response, 200, {
      ok: true,
      data: await reviewCatalogRequest(user, adminCatalogRequestId, body)
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/catalog-requests") {
    const user = await getAuthUser(request);
    jsonResponse(response, 201, {
      ok: true,
      data: await createCatalogRequest(user, body)
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/performer-profiles") {
    const user = await getAuthUser(request);
    jsonResponse(response, 200, {
      ok: true,
      data: await upsertPerformerProfile(user, body)
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/entity-claims") {
    const user = await getAuthUser(request);
    jsonResponse(response, 201, {
      ok: true,
      data: await createEntityClaim(user, body)
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/sessions/public/upcoming") {
    jsonResponse(response, 200, {
      ok: true,
      data: {
        sessions: await listPublicUpcomingSessions(Object.fromEntries(url.searchParams))
      }
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/sessions/discovery") {
    const user = await getAuthUser(request);
    const hasLatitude = body.latitude !== undefined && body.latitude !== null && body.latitude !== "";
    const hasLongitude =
      body.longitude !== undefined && body.longitude !== null && body.longitude !== "";
    if (hasLatitude !== hasLongitude) {
      throw badRequest("latitude and longitude must be provided together");
    }

    let city = String(body.city || "").trim();
    let locationProvider = city ? "cache" : null;
    let discoveryFilters = city ? { ...body, city } : { limit: body.limit };
    if (!city && hasLatitude && hasLongitude) {
      try {
        const location = await reverseGeocodeCity({
          latitude: body.latitude,
          longitude: body.longitude
        });
        city = location.city;
        locationProvider = location.provider;
        discoveryFilters = {
          ...body,
          city
        };
      } catch (error) {
        if (error?.code !== "LOCATION_REVERSE_GEOCODE_FAILED") {
          throw error;
        }
        discoveryFilters = { limit: body.limit };
      }
    }

    jsonResponse(response, 200, {
      ok: true,
      data: {
        mode: city ? "city" : "time_fallback",
        city: city || null,
        location_provider: locationProvider,
        sessions: await listDiscoverableSessions(user, discoveryFilters)
      }
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/sessions") {
    const user = await getAuthUser(request);
    jsonResponse(response, 201, { ok: true, data: await createSession(user, body) });
    return;
  }

  const sessionRescheduleId = idMatch(url.pathname, /^\/api\/sessions\/(\d+)\/reschedule$/);
  if (request.method === "POST" && sessionRescheduleId) {
    const user = await getAuthUser(request);
    const result = await rescheduleSession(user, sessionRescheduleId, body);
    jsonResponse(response, 200, { ok: true, data: sessionRescheduleResponse(result) });
    return;
  }

  const sessionId = idMatch(url.pathname, /^\/api\/sessions\/(\d+)$/);
  if (request.method === "GET" && sessionId) {
    const viewer = await optionalAuthUser(request);
    const inviteToken = url.searchParams.get("inviteToken") || "";
    const inviteClaims = inviteToken ? verifySessionJoinInviteToken(inviteToken) : null;
    if (inviteClaims && Number(inviteClaims.sessionId) !== Number(sessionId)) {
      throw forbidden("session join invite token is invalid");
    }
    jsonResponse(response, 200, {
      ok: true,
      data: await getSessionForViewer(sessionId, { viewer, inviteClaims })
    });
    return;
  }
  if (request.method === "PATCH" && sessionId) {
    const user = await getAuthUser(request);
    jsonResponse(response, 200, {
      ok: true,
      data: await updateSession(user, sessionId, body)
    });
    return;
  }

  const sessionNpcRolesId = idMatch(url.pathname, /^\/api\/sessions\/(\d+)\/npc-roles$/);
  if (request.method === "GET" && sessionNpcRolesId) {
    const user = await getAuthUser(request);
    jsonResponse(response, 200, {
      ok: true,
      data: await listSessionNpcRoles(user, sessionNpcRolesId)
    });
    return;
  }
  if (request.method === "POST" && sessionNpcRolesId) {
    const user = await getAuthUser(request);
    jsonResponse(response, 201, {
      ok: true,
      data: await createSessionNpcRole(user, sessionNpcRolesId, body)
    });
    return;
  }

  const sessionNpcRoleId = idMatch(url.pathname, /^\/api\/session-npc-roles\/(\d+)$/);
  if (request.method === "PATCH" && sessionNpcRoleId) {
    const user = await getAuthUser(request);
    jsonResponse(response, 200, {
      ok: true,
      data: await updateSessionNpcRole(user, sessionNpcRoleId, body)
    });
    return;
  }

  const sessionNpcRoleClaimId = idMatch(
    url.pathname,
    /^\/api\/session-npc-roles\/(\d+)\/claim$/
  );
  if (request.method === "POST" && sessionNpcRoleClaimId) {
    const user = await getAuthUser(request);
    jsonResponse(response, 200, {
      ok: true,
      data: await claimSessionNpcRole(user, sessionNpcRoleClaimId, body)
    });
    return;
  }

  const relinkSessionId = idMatch(url.pathname, /^\/api\/sessions\/(\d+)\/relink$/);
  if (request.method === "PATCH" && relinkSessionId) {
    const user = await getAuthUser(request);
    jsonResponse(response, 200, {
      ok: true,
      data: await relinkMySessionMembership(user, relinkSessionId)
    });
    return;
  }

  const transferOrganizerSessionId = idMatch(
    url.pathname,
    /^\/api\/sessions\/(\d+)\/organizer\/transfer$/
  );
  if (request.method === "PATCH" && transferOrganizerSessionId) {
    const user = await getAuthUser(request);
    jsonResponse(response, 200, {
      ok: true,
      data: await transferSessionOrganizer(user, transferOrganizerSessionId, body)
    });
    return;
  }

  const leaveOrganizerSessionId = idMatch(
    url.pathname,
    /^\/api\/sessions\/(\d+)\/organizer\/leave$/
  );
  if (request.method === "PATCH" && leaveOrganizerSessionId) {
    const user = await getAuthUser(request);
    jsonResponse(response, 200, {
      ok: true,
      data: await leaveSessionOrganizer(user, leaveOrganizerSessionId)
    });
    return;
  }

  const sessionJoinInviteTokenId = idMatch(
    url.pathname,
    /^\/api\/sessions\/(\d+)\/join-invite-token$/
  );
  if (request.method === "POST" && sessionJoinInviteTokenId) {
    const user = await getAuthUser(request);
    await assertSessionJoinInviteAllowed(user, sessionJoinInviteTokenId);
    const exp = Math.floor(Date.now() / 1000) + SESSION_JOIN_INVITE_TOKEN_SECONDS;
    jsonResponse(response, 201, {
      ok: true,
      data: {
        token: signSessionJoinInviteToken({
          sessionId: Number(sessionJoinInviteTokenId),
          inviterUserId: Number(user.user.id),
          exp
        }),
        expires_at: new Date(exp * 1000).toISOString()
      }
    });
    return;
  }

  const sessionAlbumShareTokenId = idMatch(
    url.pathname,
    /^\/api\/sessions\/(\d+)\/album\/share-token$/
  );
  if (request.method === "POST" && sessionAlbumShareTokenId) {
    const user = await getAuthUser(request);
    const subject = await getSessionAlbumShareSubject(user, sessionAlbumShareTokenId);
    const exp = Math.floor(Date.now() / 1000) + SESSION_ALBUM_SHARE_TOKEN_SECONDS;
    const claims = {
      sessionId: Number(sessionAlbumShareTokenId),
      sharerUserId: Number(user.user.id),
      seatId: Number(subject.share_subject.seat_id),
      exp
    };
    jsonResponse(response, 200, {
      ok: true,
      data: {
        ...subject,
        token: signSessionAlbumShareToken(claims),
        expires_at: new Date(exp * 1000).toISOString()
      }
    });
    return;
  }

  const publicSessionAlbumShareId = idMatch(
    url.pathname,
    /^\/api\/sessions\/(\d+)\/album\/public-share$/
  );
  if (request.method === "GET" && publicSessionAlbumShareId) {
    const albumShareToken =
      url.searchParams.get("token") || url.searchParams.get("albumShareToken") || "";
    const claims = verifySessionAlbumShareToken(albumShareToken);
    if (claims.sessionId !== Number(publicSessionAlbumShareId)) {
      throw forbidden("album share token is invalid");
    }
    const album = await listPublicSessionAlbumShare(claims);
    jsonResponse(response, 200, {
      ok: true,
      data: attachPublicSessionAlbumMediaUrls(album, claims, albumShareToken)
    });
    return;
  }

  const albumUploadStatusId = stringMatch(
    url.pathname,
    /^\/api\/uploads\/([0-9a-f-]{36})\/status$/i
  );
  if (request.method === "GET" && albumUploadStatusId) {
    const user = await getAuthUser(request);
    jsonResponse(response, 200, {
      ok: true,
      data: await albumImageUploads.status({ user, uploadId: albumUploadStatusId })
    });
    return;
  }

  const albumUploadFinalizeId = stringMatch(
    url.pathname,
    /^\/api\/uploads\/([0-9a-f-]{36})\/finalize$/i
  );
  if (request.method === "POST" && albumUploadFinalizeId) {
    const user = await getAuthUser(request);
    const finalized = await albumImageUploads.finalize({
      user,
      uploadId: albumUploadFinalizeId
    });
    jsonResponse(response, 200, {
      ok: true,
      data: attachLegacyFinalizedAlbumImageUrls(finalized)
    });
    return;
  }

  const sessionAlbumId = idMatch(url.pathname, /^\/api\/sessions\/(\d+)\/album$/);
  if (request.method === "GET" && sessionAlbumId) {
    const user = await getAuthUser(request);
    const album = await listSessionAlbum(user, sessionAlbumId);
    jsonResponse(response, 200, {
      ok: true,
      data: attachSessionAlbumMediaUrls(album, user.user.id)
    });
    return;
  }

  const adminSessionAlbumId = idMatch(
    url.pathname,
    /^\/api\/admin\/sessions\/(\d+)\/album$/
  );
  if (request.method === "GET" && adminSessionAlbumId) {
    const user = await getAuthUser(request);
    await assertAdminOwnSessionAlbumAllowed(user, adminSessionAlbumId);
    const album = await listSessionAlbum(user, adminSessionAlbumId);
    jsonResponse(response, 200, {
      ok: true,
      data: attachSessionAlbumMediaUrls(album, user.user.id, { routeKind: "admin" })
    });
    return;
  }

  const sessionAlbumPrivacyId = idMatch(
    url.pathname,
    /^\/api\/sessions\/(\d+)\/album\/privacy$/
  );
  if (request.method === "GET" && sessionAlbumPrivacyId) {
    const user = await getAuthUser(request);
    jsonResponse(response, 200, {
      ok: true,
      data: await getMySessionAlbumPrivacy(user, sessionAlbumPrivacyId)
    });
    return;
  }
  if (request.method === "PUT" && sessionAlbumPrivacyId) {
    const user = await getAuthUser(request);
    jsonResponse(response, 200, {
      ok: true,
      data: await updateMySessionAlbumPrivacy(user, sessionAlbumPrivacyId, body)
    });
    return;
  }

  const sessionAlbumPeopleId = idMatch(
    url.pathname,
    /^\/api\/sessions\/(\d+)\/album\/people$/
  );
  if (request.method === "GET" && sessionAlbumPeopleId) {
    const user = await getAuthUser(request);
    jsonResponse(response, 200, {
      ok: true,
      data: await listSessionAlbumPeople(user, sessionAlbumPeopleId)
    });
    return;
  }

  const adminSessionAlbumPeopleId = idMatch(
    url.pathname,
    /^\/api\/admin\/sessions\/(\d+)\/album\/people$/
  );
  if (request.method === "GET" && adminSessionAlbumPeopleId) {
    const user = await getAuthUser(request);
    await assertAdminOwnSessionAlbumAllowed(user, adminSessionAlbumPeopleId);
    jsonResponse(response, 200, {
      ok: true,
      data: await listSessionAlbumPeople(user, adminSessionAlbumPeopleId)
    });
    return;
  }

  const sessionAlbumPhotosId = idMatch(
    url.pathname,
    /^\/api\/sessions\/(\d+)\/album\/photos$/
  );
  if (request.method === "POST" && sessionAlbumPhotosId) {
    const user = await getAuthUser(request);
    await assertSessionAlbumUploadAllowed(user, sessionAlbumPhotosId);
    const photoUrl = body.photoUrl || body.photo_url;
    if (isCosUploadStorageEnabled()) {
      const finalized = attachLegacyFinalizedAlbumImageUrls(
        await albumImageUploads.finalizeLegacy({
          user,
          sessionId: sessionAlbumPhotosId,
          kind: "sessionAlbumPhoto",
          photoUrl
        })
      );
      jsonResponse(response, 201, { ok: true, data: finalized.photo });
      return;
    }
    const metadata = await getSessionAlbumDisplayMetadata(photoUrl);
    const photo = await createSessionAlbumPhoto(user, sessionAlbumPhotosId, {
      ...body,
      photoUrl,
      ...metadata
    });
    jsonResponse(response, 201, {
      ok: true,
      data: {
        ...photo,
        image_url: sessionAlbumMediaPath(photo.id),
        preview_url: sessionAlbumMediaPath(photo.id, "preview"),
        thumbnail_url: sessionAlbumMediaPath(photo.id, "thumbnail")
      }
    });
    return;
  }

  const adminSessionAlbumPhotosId = idMatch(
    url.pathname,
    /^\/api\/admin\/sessions\/(\d+)\/album\/photos$/
  );
  if (request.method === "POST" && adminSessionAlbumPhotosId) {
    const user = await getAuthUser(request);
    await assertAdminOwnSessionAlbumAllowed(user, adminSessionAlbumPhotosId);
    const photoUrl = body.photoUrl || body.photo_url;
    if (isCosUploadStorageEnabled()) {
      const finalized = attachLegacyFinalizedAlbumImageUrls(
        await albumImageUploads.finalizeLegacy({
          user,
          sessionId: adminSessionAlbumPhotosId,
          kind: "adminSessionAlbumPhoto",
          photoUrl
        })
      );
      jsonResponse(response, 201, { ok: true, data: finalized.photo });
      return;
    }
    const metadata = await getSessionAlbumDisplayMetadata(photoUrl);
    const photo = await createSessionAlbumPhoto(user, adminSessionAlbumPhotosId, {
      ...body,
      photoUrl,
      ...metadata
    });
    jsonResponse(response, 201, {
      ok: true,
      data: {
        ...photo,
        image_url: sessionAlbumMediaPath(photo.id),
        preview_url: sessionAlbumMediaPath(photo.id, "preview"),
        thumbnail_url: sessionAlbumMediaPath(photo.id, "thumbnail")
      }
    });
    return;
  }

  const adminSessionAlbumVideosId = idMatch(
    url.pathname,
    /^\/api\/admin\/sessions\/(\d+)\/album\/videos$/
  );
  if (request.method === "POST" && adminSessionAlbumVideosId) {
    const user = await getAuthUser(request);
    requireRole(user, "system_admin");
    await assertSessionAlbumUploadAllowed(user, adminSessionAlbumVideosId);
    const storageAdapter = createSessionAlbumVideoStorageAdapter();
    const inspectObject = (sourceUrl) =>
      inspectSessionAlbumVideoObject({ sourceUrl, storageAdapter });
    const video = await createSessionAlbumVideo(user, adminSessionAlbumVideosId, body, {
      inspectObject,
      readyOnCreate: true
    });
    jsonResponse(response, 201, {
      ok: true,
      data: {
        ...video,
        cover_url: "",
        video_url: video.processing_status === "ready" ? sessionAlbumVideoUrlPath(video.id) : ""
      }
    });
    return;
  }

  const sessionAlbumPhotoId = idMatch(
    url.pathname,
    /^\/api\/session-album\/photos\/(\d+)$/
  );
  if (request.method === "DELETE" && sessionAlbumPhotoId) {
    const user = await getAuthUser(request);
    const deletionSnapshot = await prepareSessionAlbumPhotoDeletion(user, sessionAlbumPhotoId);
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
      data: {
        id: deletion.id,
        deleted: false,
        deletionPending: true
      }
    });
    return;
  }

  const sessionAlbumPhotoTagsId = idMatch(
    url.pathname,
    /^\/api\/session-album\/photos\/(\d+)\/tags$/
  );
  if (request.method === "PUT" && sessionAlbumPhotoTagsId) {
    const user = await getAuthUser(request);
    jsonResponse(response, 200, {
      ok: true,
      data: await updateSessionAlbumPhotoTags(user, sessionAlbumPhotoTagsId, body)
    });
    return;
  }

  const sessionReviewsId = idMatch(url.pathname, /^\/api\/sessions\/(\d+)\/reviews$/);
  if (request.method === "GET" && sessionReviewsId) {
    const viewer = await optionalAuthUser(request);
    const inviteToken = url.searchParams.get("inviteToken") || "";
    const inviteClaims = inviteToken ? verifySessionJoinInviteToken(inviteToken) : null;
    const access = await getSessionForViewer(sessionReviewsId, { viewer, inviteClaims });
    jsonResponse(response, 200, {
      ok: true,
      data: access.access_scope === "member" ? await listSessionReviews(sessionReviewsId) : []
    });
    return;
  }

  const mySessionReviewId = idMatch(url.pathname, /^\/api\/sessions\/(\d+)\/review$/);
  if (request.method === "GET" && mySessionReviewId) {
    const user = await getAuthUser(request);
    jsonResponse(response, 200, {
      ok: true,
      data: await getMySessionReview(user, mySessionReviewId)
    });
    return;
  }
  if (request.method === "PUT" && mySessionReviewId) {
    const user = await getAuthUser(request);
    jsonResponse(response, 200, {
      ok: true,
      data: await upsertMySessionReview(user, mySessionReviewId, body)
    });
    return;
  }

  if (
    await routeExtensions({
      body,
      getAuthUser,
      idMatch,
      jsonResponse,
      request,
      response,
      url
    })
  ) {
    return;
  }

  const cancelSessionId = idMatch(url.pathname, /^\/api\/sessions\/(\d+)\/cancel$/);
  if (request.method === "PATCH" && cancelSessionId) {
    const user = await getAuthUser(request);
    jsonResponse(response, 200, {
      ok: true,
      data: await cancelSession(user, cancelSessionId, body)
    });
    return;
  }

  const shareStatsSessionId = idMatch(
    url.pathname,
    /^\/api\/sessions\/(\d+)\/share-stats$/
  );
  if (request.method === "GET" && shareStatsSessionId) {
    jsonResponse(response, 200, {
      ok: true,
      data: await getSessionShareStats(shareStatsSessionId)
    });
    return;
  }

  const publishSessionId = idMatch(url.pathname, /^\/api\/sessions\/(\d+)\/publish$/);
  if (request.method === "POST" && publishSessionId) {
    const user = await getAuthUser(request);
    jsonResponse(response, 200, {
      ok: true,
      data: await publishSession(user, publishSessionId)
    });
    return;
  }

  const sessionSeatSessionId = idMatch(
    url.pathname,
    /^\/api\/sessions\/(\d+)\/seats$/
  );
  if (request.method === "POST" && sessionSeatSessionId) {
    const user = await getAuthUser(request);
    jsonResponse(response, 201, {
      ok: true,
      data: await createSeat(user, sessionSeatSessionId, body)
    });
    return;
  }

  const seatId = idMatch(url.pathname, /^\/api\/session-seats\/(\d+)$/);
  if (request.method === "PATCH" && seatId) {
    const user = await getAuthUser(request);
    jsonResponse(response, 200, { ok: true, data: await updateSeat(user, seatId, body) });
    return;
  }

  const lockSeatId = idMatch(url.pathname, /^\/api\/session-seats\/(\d+)\/lock$/);
  if (request.method === "POST" && lockSeatId) {
    const user = await getAuthUser(request);
    jsonResponse(response, 200, { ok: true, data: await lockSeat(user, lockSeatId) });
    return;
  }

  const claimSeatId = idMatch(url.pathname, /^\/api\/session-seats\/(\d+)\/claim$/);
  if (request.method === "POST" && claimSeatId) {
    const user = await getAuthUser(request);
    jsonResponse(response, 200, {
      ok: true,
      data: await claimSessionSeat(user, claimSeatId, body)
    });
    return;
  }

  const kickSeatId = idMatch(url.pathname, /^\/api\/session-seats\/(\d+)\/kick$/);
  if (request.method === "PATCH" && kickSeatId) {
    const user = await getAuthUser(request);
    jsonResponse(response, 200, {
      ok: true,
      data: await kickSessionSeat(user, kickSeatId, body)
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/signups") {
    const user = await getAuthUser(request);
    jsonResponse(response, 201, { ok: true, data: await createSignup(user, body) });
    return;
  }

  const hideSignupId = idMatch(url.pathname, /^\/api\/signups\/(\d+)\/hide$/);
  if (request.method === "PATCH" && hideSignupId) {
    const user = await getAuthUser(request);
    jsonResponse(response, 200, {
      ok: true,
      data: await hideMySignup(user, hideSignupId)
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/users/me/signups") {
    const user = await getAuthUser(request);
    jsonResponse(response, 200, { ok: true, data: await listMySignups(user) });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/users/me/sessions") {
    const user = await getAuthUser(request);
    jsonResponse(response, 200, {
      ok: true,
      data: await listMySessions(user, Object.fromEntries(url.searchParams))
    });
    return;
  }

  const sessionSignupsId = idMatch(url.pathname, /^\/api\/sessions\/(\d+)\/signups$/);
  if (request.method === "GET" && sessionSignupsId) {
    const user = await getAuthUser(request);
    jsonResponse(response, 200, {
      ok: true,
      data: await listSessionSignups(user, sessionSignupsId)
    });
    return;
  }

  const approveSignupId = idMatch(url.pathname, /^\/api\/signups\/(\d+)\/approve$/);
  if (request.method === "PATCH" && approveSignupId) {
    const user = await getAuthUser(request);
    jsonResponse(response, 200, {
      ok: true,
      data: await approveSignup(user, approveSignupId)
    });
    return;
  }

  const rejectSignupId = idMatch(url.pathname, /^\/api\/signups\/(\d+)\/reject$/);
  if (request.method === "PATCH" && rejectSignupId) {
    const user = await getAuthUser(request);
    jsonResponse(response, 200, {
      ok: true,
      data: await rejectSignup(user, rejectSignupId)
    });
    return;
  }

  const depositSignupId = idMatch(url.pathname, /^\/api\/signups\/(\d+)\/deposit$/);
  if (request.method === "PATCH" && depositSignupId) {
    const user = await getAuthUser(request);
    jsonResponse(response, 200, {
      ok: true,
      data: await updateDeposit(user, depositSignupId, body)
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/share-events/view") {
    jsonResponse(response, 201, {
      ok: true,
      data: await createShareEvent("view", body)
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/share-events/convert") {
    const user = await optionalAuthUser(request);
    jsonResponse(response, 201, {
      ok: true,
      data: await createShareEvent("convert", {
        ...body,
        viewedUserId: body.viewedUserId || user?.user.id || null
      })
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/subscriptions/request-result") {
    const user = await getAuthUser(request);
    jsonResponse(response, 201, {
      ok: true,
      data: await createSubscriptionRequest(user, body)
    });
    return;
  }

  errorResponse(response, 404, "NOT_FOUND", "Route not found");
}

export function createApp() {
  return http.createServer((request, response) => {
    route(request, response).catch((error) => {
      const normalized = normalizeError(error);
      errorResponse(
        response,
        normalized.statusCode,
        normalized.code,
        normalized.message,
        normalized.details
      );
    });
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const server = createApp();
  server.listen(config.port, () => {
    console.log(
      JSON.stringify({
        ok: true,
        service: "pinche-api",
        port: config.port,
        nodeEnv: config.nodeEnv
      })
    );
  });
}
