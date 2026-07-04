import crypto from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { config, publicConfig } from "./config/env.js";
import { checkDatabaseReadiness } from "./db/mysql.js";
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
import {
  buildCosAuthorization,
  cosHost,
  cosObjectKeyFromUploadPath,
  cosStorageEnabled,
  deleteCosObject,
  getCosObject,
  putCosObject
} from "./storage/cos.js";
import {
  assertAdminOwnSessionAlbumAllowed,
  assertSessionAlbumUploadAllowed,
  approveSignup,
  cancelSession,
  claimSessionNpcRole,
  claimSessionSeat,
  createSessionAlbumPhoto,
  createCatalogRequest,
  createEntityClaim,
  createScript,
  createSeat,
  createSession,
  createSessionNpcRole,
  createShareEvent,
  createSignup,
  createStore,
  createSubscriptionRequest,
  deleteAdminSession,
  deleteSessionAlbumPhoto,
  deleteScript,
  deleteStore,
  getPublicSessionAlbumPhotoForMedia,
  getSession,
  getSessionAlbumShareSubject,
  getSessionShareStats,
  getMySessionAlbumPrivacy,
  getMySessionReview,
  getVisibleSessionAlbumPhotoForMedia,
  hideMySignup,
  kickSessionSeat,
  leaveSessionOrganizer,
  listAdminScripts,
  listAdminSessions,
  listAdminStores,
  listActiveScripts,
  listActiveStores,
  listCatalogRequests,
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
  publishSession,
  rejectSignup,
  relinkMySessionMembership,
  replaceStoreScripts,
  reviewCatalogRequest,
  transferSessionOrganizer,
  updateDeposit,
  updateScript,
  updateSeat,
  updateSession,
  updateMySessionAlbumPrivacy,
  updateSessionAlbumPhotoTags,
  updateSessionNpcRole,
  updateStore,
  upsertMySessionReview,
  upsertPerformerProfile
} from "./modules/core/service.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const apiRoot = path.resolve(__dirname, "..");
const avatarUploadDir = path.join(apiRoot, "uploads", "avatars");
const sessionReviewUploadDir = path.join(apiRoot, "uploads", "session-reviews");
const sessionAlbumUploadDir = path.join(apiRoot, "uploads", "session-album");
const sessionAlbumDisplayUploadDir = path.join(sessionAlbumUploadDir, "display");
const AVATAR_UPLOAD_MAX_BYTES = 2 * 1024 * 1024;
const AVATAR_MULTIPART_MAX_BYTES = AVATAR_UPLOAD_MAX_BYTES + 64 * 1024;
const SESSION_REVIEW_UPLOAD_MAX_BYTES = 4 * 1024 * 1024;
const SESSION_REVIEW_MULTIPART_MAX_BYTES = SESSION_REVIEW_UPLOAD_MAX_BYTES + 64 * 1024;
const SESSION_ALBUM_UPLOAD_MAX_BYTES = 4 * 1024 * 1024;
const SESSION_ALBUM_MULTIPART_MAX_BYTES = SESSION_ALBUM_UPLOAD_MAX_BYTES + 64 * 1024;
const SESSION_ALBUM_MEDIA_TOKEN_SECONDS = 10 * 60;
const SESSION_ALBUM_SHARE_TOKEN_SECONDS = 30 * 24 * 60 * 60;
const SESSION_ALBUM_PUBLIC_MEDIA_TOKEN_SECONDS = 10 * 60;
const AVATAR_WEBP_RULE = "imageMogr2/auto-orient/thumbnail/512x512>/format/webp/quality/80";
const SESSION_ALBUM_DISPLAY_JPG_RULE =
  "imageMogr2/auto-orient/thumbnail/2048x2048>/format/jpg/quality/85/strip";
const SESSION_ALBUM_THUMBNAIL_RULE =
  "imageMogr2/auto-orient/thumbnail/640x640>/format/jpg/quality/75/strip";
const avatarMimeTypes = {
  "image/jpeg": ".jpg",
  "image/png": ".png"
};

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

function normalizeError(error) {
  if (error instanceof AppError) {
    return error;
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

  return new AppError(500, "INTERNAL_ERROR", error.message);
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

async function createCosDirectUploadIntent({ kind, extension, user, userId, sessionId }) {
  if (!isCosUploadStorageEnabled()) {
    return { direct: false };
  }

  const uploadUserId = user?.user?.id || userId;
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
  if (directUpload.kind === "sessionAlbumPhoto") {
    await assertSessionAlbumUploadAllowed(
      { user: { id: userId }, roles: [] },
      directUpload.sessionId
    );
  }
  if (directUpload.kind === "adminSessionAlbumPhoto") {
    await assertAdminOwnSessionAlbumAllowed(user, directUpload.sessionId);
  }
  const headers = normalizeCosHeaders(body.headers || body.Headers);
  headers.host = headers.host || cosHost(config.cos);

  if (directUpload.kind === "avatar" && headers["pic-operations"] !== avatarWebpPicOperations(key)) {
    throw forbidden("avatar upload must include the server-issued WebP processing rule");
  }
  if (
    (directUpload.kind === "sessionAlbumPhoto" ||
      directUpload.kind === "adminSessionAlbumPhoto") &&
    headers["pic-operations"] !== sessionAlbumDisplayJpgPicOperations(key)
  ) {
    throw forbidden("album upload must include the server-issued JPG processing rule");
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

async function saveUploadedObject({ key, filename, file, contentType, localDir, picOperations }) {
  if (isCosUploadStorageEnabled()) {
    await putCosObject({
      key,
      body: file,
      contentType,
      picOperations,
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

function attachSessionAlbumMediaUrls(album) {
  return {
    ...album,
    photos: album.photos.map((photo) => ({
      ...photo,
      image_url: sessionAlbumMediaPath(photo.id),
      preview_url: sessionAlbumMediaPath(photo.id, "preview"),
      thumbnail_url: sessionAlbumMediaPath(photo.id, "thumbnail")
    }))
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

function attachPublicSessionAlbumMediaUrls(album, claims, albumShareToken) {
  return {
    ...album,
    photos: album.photos.map((photo) => ({
      ...photo,
      image_url: sessionAlbumPublicMediaPath(photo.id, claims, albumShareToken),
      preview_url: sessionAlbumPublicMediaPath(
        photo.id,
        claims,
        albumShareToken,
        "preview"
      ),
      thumbnail_url: sessionAlbumPublicMediaPath(
        photo.id,
        claims,
        albumShareToken,
        "thumbnail"
      )
    }))
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
      await serveCosUploadedObject({ key, filename, response, cacheControl, ciProcess });
      return;
    } catch (error) {
      if (error.statusCode && error.statusCode !== 404) {
        throw new AppError(502, "COS_STORAGE_ERROR", "COS storage request failed", error.body);
      }
    }
  }

  await serveLocalUploadedObject({
    filePath: path.join(localDir, filename),
    filename,
    response,
    cacheControl,
    ciProcess
  });
}

async function deleteUploadedObject({ url, prefix, localDir }) {
  const requestedName = decodeURIComponent(url.pathname.slice(prefix.length));
  const filename = path.basename(requestedName);
  if (!filename || filename !== requestedName || !/^[A-Za-z0-9._-]+$/.test(filename)) {
    return;
  }

  const key = cosObjectKeyFromUploadPath(`${prefix}${filename}`, prefix);
  if (isCosUploadStorageEnabled()) {
    try {
      await deleteCosObject({ key, config: config.cos });
      return;
    } catch (error) {
      if (error.statusCode && error.statusCode !== 404) {
        throw new AppError(502, "COS_STORAGE_ERROR", "COS storage request failed", error.body);
      }
    }
  }

  try {
    await fs.unlink(path.join(localDir, filename));
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
      await serveUploadedObject({
        url: photoUrl,
        prefix: "/uploads/session-album/display/",
        localDir: sessionAlbumDisplayUploadDir,
        response,
        cacheControl,
        ciProcess
      });
      return;
    }
    await serveUploadedObject({
      url: photoUrl,
      prefix: "/uploads/session-album/",
      localDir: sessionAlbumUploadDir,
      response,
      cacheControl,
      ciProcess
    });
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    throw notFound();
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

  const sessionAlbumMediaPhotoId = idMatch(
    url.pathname,
    /^\/api\/session-album\/photos\/(\d+)\/image$/
  );
  if (request.method === "GET" && sessionAlbumMediaPhotoId) {
    const user = await getAuthUser(request);
    verifySessionAlbumMediaQuery(sessionAlbumMediaPhotoId, url.searchParams);
    const variant = mediaVariant(url.searchParams);
    const photo = await getVisibleSessionAlbumPhotoForMedia(
      user.user.id,
      sessionAlbumMediaPhotoId
    );
    await serveUploadedSessionAlbumPhoto(photo, response, { variant });
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

  const body = await bodyFor(request);

  if (request.method === "POST" && url.pathname === "/api/uploads/cos-intent") {
    const user = await getAuthUser(request);
    jsonResponse(response, 200, {
      ok: true,
      data: {
        upload: await createCosDirectUploadIntent({
          kind: body.kind,
          extension: body.extension,
          user,
          userId: user.user.id,
          sessionId: body.sessionId || body.session_id
        })
      }
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/uploads/cos-authorization") {
    const user = await getAuthUser(request);
    jsonResponse(response, 200, {
      ok: true,
      data: await authorizeCosDirectUpload({
        body,
        user
      })
    });
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
    jsonResponse(response, 200, {
      ok: true,
      data: await listActiveStores(Object.fromEntries(url.searchParams))
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/scripts") {
    jsonResponse(response, 200, {
      ok: true,
      data: await listActiveScripts(Object.fromEntries(url.searchParams))
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

  if (request.method === "POST" && url.pathname === "/api/sessions") {
    const user = await getAuthUser(request);
    jsonResponse(response, 201, { ok: true, data: await createSession(user, body) });
    return;
  }

  const sessionId = idMatch(url.pathname, /^\/api\/sessions\/(\d+)$/);
  if (request.method === "GET" && sessionId) {
    jsonResponse(response, 200, { ok: true, data: await getSession(sessionId) });
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

  const sessionAlbumId = idMatch(url.pathname, /^\/api\/sessions\/(\d+)\/album$/);
  if (request.method === "GET" && sessionAlbumId) {
    const user = await getAuthUser(request);
    const album = await listSessionAlbum(user, sessionAlbumId);
    jsonResponse(response, 200, {
      ok: true,
      data: attachSessionAlbumMediaUrls(album)
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
      data: attachSessionAlbumMediaUrls(album)
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

  const sessionAlbumPhotoId = idMatch(
    url.pathname,
    /^\/api\/session-album\/photos\/(\d+)$/
  );
  if (request.method === "DELETE" && sessionAlbumPhotoId) {
    const user = await getAuthUser(request);
    const deletedPhoto = await deleteSessionAlbumPhoto(user, sessionAlbumPhotoId);
    await cleanupUploadedSessionAlbumPhotoObject(deletedPhoto.photo_url);
    jsonResponse(response, 200, {
      ok: true,
      data: {
        id: deletedPhoto.id,
        deleted: true
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
    jsonResponse(response, 200, {
      ok: true,
      data: await listSessionReviews(sessionReviewsId)
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
