import crypto from "node:crypto";

import { AppError } from "../../http/errors.js";
import { buildCosAuthorization, cosHost, cosStorageEnabled } from "../../storage/cos.js";
import {
  ALBUM_IMAGE_AUTH_SECONDS,
  ALBUM_IMAGE_CLEANUP_GRACE_SECONDS,
  ALBUM_IMAGE_DISPLAY_PROCESS,
  ALBUM_IMAGE_FINALIZE_GRACE_SECONDS,
  ALBUM_IMAGE_MAX_SOURCE_BYTES,
  ALBUM_IMAGE_UPLOAD_WINDOW_SECONDS,
  isAlbumImageKind
} from "./constants.js";

const REQUIRED_HEADERS = Object.freeze([
  "content-length",
  "content-type",
  "host",
  "pic-operations",
  "x-cos-forbid-overwrite"
]);

function serviceError(statusCode, code, message) {
  return new AppError(statusCode, code, message);
}

function forbidden(message) {
  return serviceError(403, "ALBUM_UPLOAD_FORBIDDEN", message);
}

function normalizeExtension(value) {
  const extension = String(value || "").trim().toLowerCase();
  if (["jpg", "jpeg", "png"].includes(extension)) return `.${extension}`;
  if ([".jpg", ".jpeg", ".png"].includes(extension)) return extension;
  throw serviceError(415, "UNSUPPORTED_IMAGE_TYPE", "Only JPEG and PNG sources are supported");
}

function contentTypeForExtension(extension) {
  return extension === ".png" ? "image/png" : "image/jpeg";
}

function normalizeSourceFacts(body) {
  const extension = normalizeExtension(body.extension);
  const suppliedType = body.contentType ?? body.content_type;
  const suppliedSize = body.byteSize ?? body.byte_size;
  const legacy = suppliedType === undefined && suppliedSize === undefined;
  if ((suppliedType === undefined) !== (suppliedSize === undefined)) {
    throw serviceError(400, "BAD_REQUEST", "contentType and byteSize must be supplied together");
  }
  const contentType = legacy
    ? contentTypeForExtension(extension)
    : String(suppliedType || "").trim().toLowerCase();
  if (contentType !== contentTypeForExtension(extension)) {
    throw serviceError(415, "UNSUPPORTED_IMAGE_TYPE", "Image extension and MIME type do not match");
  }
  const byteSize = legacy ? null : Number(suppliedSize);
  if (!legacy && (!Number.isSafeInteger(byteSize) || byteSize <= 0)) {
    throw serviceError(400, "BAD_REQUEST", "byteSize must be a positive integer");
  }
  if (byteSize !== null && byteSize > ALBUM_IMAGE_MAX_SOURCE_BYTES) {
    throw serviceError(413, "FILE_TOO_LARGE", "Image exceeds the 4MB source limit");
  }
  return { extension, contentType, byteSize };
}

function picOperations(config, objectKey) {
  return JSON.stringify({
    is_pic_info: 1,
    rules: [{
      bucket: config.bucket,
      fileid: `/${objectKey}`,
      rule: ALBUM_IMAGE_DISPLAY_PROCESS
    }]
  });
}

function normalizeHeaders(headers = {}) {
  return Object.fromEntries(Object.entries(headers).map(([name, value]) => [
    String(name).toLowerCase(), String(value)
  ]));
}

function sameNames(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

async function checkedAccess(deps, connection, user, intent) {
  try {
    return await deps.access(connection, user, {
      sessionId: Number(intent.session_id ?? intent.sessionId),
      kind: intent.kind,
      forUpdate: true
    });
  } catch (error) {
    if (Number(error?.statusCode) === 403) throw forbidden("Album upload access was revoked");
    throw error;
  }
}

async function createIntent(deps, { user, body = {} }) {
  if (!isAlbumImageKind(body.kind)) {
    throw serviceError(400, "BAD_REQUEST", "Unsupported album image kind");
  }
  const sessionId = Number(body.sessionId ?? body.session_id);
  if (!Number.isSafeInteger(sessionId) || sessionId <= 0) {
    throw serviceError(400, "BAD_REQUEST", "sessionId must be a positive integer");
  }
  const source = normalizeSourceFacts(body);
  const enabled = cosStorageEnabled(deps.cosConfig);
  if (!enabled && deps.directUploadRequired) {
    throw serviceError(503, "COS_CONFIGURATION_ERROR", "COS direct upload is required but unavailable");
  }

  return deps.transaction(async (connection) => {
    await checkedAccess(deps, connection, user, {
      sessionId,
      kind: body.kind
    });
    if (!enabled) {
      deps.emit?.("intent_created", { sessionId, outcome: "api-local" });
      return {
        uploadMode: "api-local",
        direct: false,
        fallbackAllowed: true,
        maxBytes: ALBUM_IMAGE_MAX_SOURCE_BYTES
      };
    }

    const nowMs = deps.now();
    const uploadId = deps.randomUUID();
    const prefix = body.kind === "adminSessionAlbumPhoto" ? "admin-album" : "album";
    const objectKey = `uploads/session-album/display/${prefix}-${sessionId}-${
      Number(user.user.id)
    }-${nowMs}-${deps.randomHex()}.jpg`;
    const uploadExpiresAt = new Date(nowMs + ALBUM_IMAGE_UPLOAD_WINDOW_SECONDS * 1000);
    const finalizeDeadlineAt = new Date(
      uploadExpiresAt.getTime() + ALBUM_IMAGE_FINALIZE_GRACE_SECONDS * 1000
    );
    const cleanupNotBefore = new Date(
      finalizeDeadlineAt.getTime() + ALBUM_IMAGE_CLEANUP_GRACE_SECONDS * 1000
    );
    await deps.repository.insert(connection, {
      id: uploadId,
      userId: Number(user.user.id),
      sessionId,
      kind: body.kind,
      objectKey,
      sourceContentType: source.contentType,
      sourceByteSize: source.byteSize,
      maxSourceByteSize: ALBUM_IMAGE_MAX_SOURCE_BYTES,
      uploadExpiresAt,
      finalizeDeadlineAt,
      cleanupNotBefore
    });
    deps.emit?.("intent_created", { sessionId, outcome: "cos-direct-v2" });
    return {
      uploadMode: "cos-direct-v2",
      direct: true,
      fallbackAllowed: false,
      uploadId,
      sessionId,
      bucket: deps.cosConfig.bucket,
      region: deps.cosConfig.region,
      key: objectKey,
      uploadPath: `/${objectKey}`,
      maxBytes: ALBUM_IMAGE_MAX_SOURCE_BYTES,
      contentType: source.contentType,
      contentLength: source.byteSize,
      picOperations: picOperations(deps.cosConfig, objectKey),
      headers: { "x-cos-forbid-overwrite": "true" },
      uploadExpiresAt: uploadExpiresAt.toISOString(),
      finalizeDeadlineAt: finalizeDeadlineAt.toISOString()
    };
  });
}

async function authorize(deps, { user, body = {} }) {
  if (!cosStorageEnabled(deps.cosConfig)) {
    throw serviceError(503, "COS_CONFIGURATION_ERROR", "COS storage is unavailable");
  }
  return deps.transaction(async (connection) => {
    const key = String(body.key ?? body.Key ?? "");
    const uploadId = body.uploadId ?? body.upload_id;
    const intent = uploadId
      ? await deps.repository.find(connection, String(uploadId), { forUpdate: true })
      : await deps.repository.findByObjectKey(connection, {
          userId: Number(user.user.id), objectKey: key
        }, { forUpdate: true });
    if (!intent || Number(intent.user_id) !== Number(user.user.id) || intent.status !== "pending") {
      throw forbidden("Upload intent is not available");
    }
    await checkedAccess(deps, connection, user, intent);

    const headers = normalizeHeaders(body.headers ?? body.Headers);
    const headerNames = Object.keys(headers).sort();
    const query = body.query ?? body.Query ?? {};
    const queryIsEmpty = query && typeof query === "object" && Object.keys(query).length === 0;
    const expectedPicOperations = picOperations(deps.cosConfig, intent.object_key);
    const contentLength = Number(headers["content-length"]);
    const valid =
      String(body.bucket ?? body.Bucket ?? "") === deps.cosConfig.bucket &&
      String(body.region ?? body.Region ?? "") === deps.cosConfig.region &&
      String(body.method ?? body.Method ?? "").toUpperCase() === "PUT" &&
      key === intent.object_key && queryIsEmpty &&
      sameNames(headerNames, [...REQUIRED_HEADERS]) &&
      headers.host === cosHost(deps.cosConfig) &&
      headers["content-type"] === intent.source_content_type &&
      Number.isSafeInteger(contentLength) && contentLength > 0 &&
      contentLength <= Number(intent.max_source_byte_size || ALBUM_IMAGE_MAX_SOURCE_BYTES) &&
      headers["pic-operations"] === expectedPicOperations &&
      headers["x-cos-forbid-overwrite"] === "true";
    if (!valid) throw forbidden("COS upload request does not match the persisted intent");

    if (intent.source_byte_size === null || intent.source_byte_size === undefined) {
      const bound = await deps.repository.bindByteSize(connection, {
        uploadId: intent.id, byteSize: contentLength
      });
      if (!bound) throw forbidden("Legacy upload length could not be bound");
      intent.source_byte_size = contentLength;
    } else if (Number(intent.source_byte_size) !== contentLength) {
      throw forbidden("COS upload length does not match the persisted intent");
    }

    const nowMs = deps.now();
    const secondsRemaining = Math.floor((new Date(intent.upload_expires_at).getTime() - nowMs) / 1000);
    if (secondsRemaining <= 0) throw forbidden("Upload intent expired");
    const expiresInSeconds = Math.min(ALBUM_IMAGE_AUTH_SECONDS, secondsRemaining);
    const expiresAt = new Date(nowMs + expiresInSeconds * 1000);
    const latestProtectedAt = Math.max(
      new Date(intent.upload_expires_at).getTime(),
      new Date(intent.finalize_deadline_at).getTime(),
      expiresAt.getTime()
    );
    const cleanupNotBefore = new Date(
      latestProtectedAt + ALBUM_IMAGE_CLEANUP_GRACE_SECONDS * 1000
    );
    const recorded = await deps.repository.recordAuthorization(connection, {
      uploadId: intent.id,
      authorizationExpiresAt: expiresAt,
      cleanupNotBefore
    });
    if (!recorded) throw forbidden("Upload intent changed before authorization");
    const authorization = deps.signer({
      method: "PUT",
      key,
      headers,
      nowSeconds: Math.floor(nowMs / 1000),
      expiresInSeconds,
      config: deps.cosConfig
    });
    deps.emit?.("authorization_issued", { sessionId: Number(intent.session_id), outcome: "issued" });
    return { authorization, expiresAt: expiresAt.toISOString() };
  });
}

export function createAlbumImageUploadService(dependencies) {
  const deps = {
    now: () => Date.now(),
    randomUUID: () => crypto.randomUUID(),
    randomHex: () => crypto.randomBytes(8).toString("hex"),
    signer: buildCosAuthorization,
    emit: () => {},
    ...dependencies
  };
  return {
    createIntent: (input) => createIntent(deps, input),
    authorize: (input) => authorize(deps, input)
  };
}
