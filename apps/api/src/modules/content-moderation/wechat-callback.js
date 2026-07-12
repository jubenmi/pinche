import crypto from "node:crypto";

const MAX_CALLBACK_BYTES = 256 * 1024;
const MAX_IDENTIFIER_LENGTH = 128;
const MAX_LABEL_LENGTH = 64;

function callbackError(code, message) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = code === "CONTENT_MODERATION_CALLBACK_UNAUTHORIZED" ? 401 : 400;
  return error;
}

function invalidCallback() {
  return callbackError("CONTENT_MODERATION_INVALID_CALLBACK", "WeChat content moderation callback is invalid");
}

function requiredString(value, maxLength = MAX_IDENTIFIER_LENGTH) {
  if (typeof value !== "string") throw invalidCallback();
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) throw invalidCallback();
  return normalized;
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.isBuffer(left) ? left : Buffer.from(String(left), "utf8");
  const rightBuffer = Buffer.isBuffer(right) ? right : Buffer.from(String(right), "utf8");
  return leftBuffer.length === rightBuffer.length &&
    leftBuffer.length > 0 &&
    crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function rawBodyBuffer(rawBody) {
  const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody || ""), "utf8");
  if (body.length === 0 || body.length > MAX_CALLBACK_BYTES) throw invalidCallback();
  const decoded = body.toString("utf8");
  if (!Buffer.from(decoded, "utf8").equals(body)) throw invalidCallback();
  return body;
}

function strictBase64(value) {
  const encoded = requiredString(value, MAX_CALLBACK_BYTES);
  if (
    encoded.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) ||
    /=.+[^=]/.test(encoded)
  ) {
    throw invalidCallback();
  }
  const decoded = Buffer.from(encoded, "base64");
  if (!decoded.length || decoded.toString("base64") !== encoded) throw invalidCallback();
  return decoded;
}

function parseEncryptedEnvelope(rawBody) {
  let envelope;
  try {
    envelope = JSON.parse(rawBodyBuffer(rawBody).toString("utf8"));
  } catch {
    throw invalidCallback();
  }
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) throw invalidCallback();
  return requiredString(envelope.Encrypt, MAX_CALLBACK_BYTES);
}

function aesKeyBuffer(aesKey) {
  const encoded = requiredString(aesKey, 43);
  if (encoded.length !== 43 || !/^[A-Za-z0-9+/]{43}$/.test(encoded)) throw invalidCallback();
  const decoded = Buffer.from(`${encoded}=`, "base64");
  if (decoded.length !== 32 || decoded.toString("base64").replace(/=$/, "") !== encoded) {
    throw invalidCallback();
  }
  return decoded;
}

function removePkcs7Padding(buffer) {
  if (!buffer.length || buffer.length % 16 !== 0) throw invalidCallback();
  const padding = buffer.at(-1);
  if (!Number.isInteger(padding) || padding < 1 || padding > 32 || padding > buffer.length) {
    throw invalidCallback();
  }
  for (let index = buffer.length - padding; index < buffer.length; index += 1) {
    if (buffer[index] !== padding) throw invalidCallback();
  }
  return buffer.subarray(0, buffer.length - padding);
}

function decryptWechatEnvelope({ encrypt, aesKey, appId }) {
  const encrypted = strictBase64(encrypt);
  if (encrypted.length % 16 !== 0) throw invalidCallback();
  const key = aesKeyBuffer(aesKey);
  let padded;
  try {
    const decipher = crypto.createDecipheriv("aes-256-cbc", key, key.subarray(0, 16));
    decipher.setAutoPadding(false);
    padded = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  } catch {
    throw invalidCallback();
  }
  const plaintext = removePkcs7Padding(padded);
  if (plaintext.length < 20) throw invalidCallback();
  const messageLength = plaintext.readUInt32BE(16);
  const messageStart = 20;
  const messageEnd = messageStart + messageLength;
  if (messageEnd > plaintext.length) throw invalidCallback();
  const message = plaintext.subarray(messageStart, messageEnd);
  const embeddedAppId = plaintext.subarray(messageEnd);
  const expectedAppId = Buffer.from(requiredString(appId), "utf8");
  if (!safeEqual(embeddedAppId, expectedAppId)) throw invalidCallback();
  const text = message.toString("utf8");
  if (!Buffer.from(text, "utf8").equals(message)) throw invalidCallback();
  try {
    return JSON.parse(text);
  } catch {
    throw invalidCallback();
  }
}

function normalizeString(value, maxLength) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLength);
}

function normalizeWechatImageEvent(event) {
  if (!event || typeof event !== "object" || Array.isArray(event)) throw invalidCallback();
  if (event.MsgType !== "event" || event.Event !== "wxa_media_check" || event.version !== 2) {
    throw invalidCallback();
  }
  const traceId = requiredString(event.trace_id);
  if (!event.result || typeof event.result !== "object" || Array.isArray(event.result)) {
    throw invalidCallback();
  }
  const suggestion = requiredString(event.result.suggest, 32).toLowerCase();
  const decision = suggestion === "pass"
    ? "pass"
    : suggestion === "review"
      ? "review"
      : suggestion === "risky"
        ? "block"
        : "error";
  const score = Number(event.result.score);
  return {
    traceId,
    result: {
      decision,
      suggestion,
      label: normalizeString(event.result.label, MAX_LABEL_LENGTH),
      score: Number.isFinite(score) ? Math.max(0, Math.min(100, Math.round(score))) : null
    }
  };
}

export function verifyWechatCallbackSignature({ token, timestamp, nonce, encrypt, msgSignature }) {
  const expectedToken = requiredString(token);
  const expectedTimestamp = requiredString(timestamp);
  const expectedNonce = requiredString(nonce);
  const encrypted = requiredString(encrypt, MAX_CALLBACK_BYTES);
  const providedSignature = requiredString(msgSignature, 40).toLowerCase();
  if (!/^[a-f0-9]{40}$/.test(providedSignature)) return false;
  const expectedSignature = crypto.createHash("sha1")
    .update([expectedToken, expectedTimestamp, expectedNonce, encrypted].sort().join(""), "utf8")
    .digest("hex");
  return safeEqual(providedSignature, expectedSignature);
}

export function parseWechatSecureImageEvent({
  rawBody,
  token,
  aesKey,
  appId,
  msgSignature,
  timestamp,
  nonce
} = {}) {
  const encrypt = parseEncryptedEnvelope(rawBody);
  let authenticated;
  try {
    authenticated = verifyWechatCallbackSignature({
      token,
      timestamp,
      nonce,
      encrypt,
      msgSignature
    });
  } catch {
    throw invalidCallback();
  }
  if (!authenticated) {
    throw callbackError(
      "CONTENT_MODERATION_CALLBACK_UNAUTHORIZED",
      "WeChat content moderation callback is unauthorized"
    );
  }
  return normalizeWechatImageEvent(decryptWechatEnvelope({ encrypt, aesKey, appId }));
}

function staleResult(status = null) {
  return { status, stale: true, duplicate: false };
}

export async function dispatchWechatImageModerationEvent({
  event,
  withDatabaseConnection,
  repository,
  applyMediaResult
} = {}) {
  if (!event?.traceId || typeof withDatabaseConnection !== "function" ||
      typeof applyMediaResult !== "function") {
    throw new TypeError("valid WeChat image callback dependencies are required");
  }
  const attemptAndJob = await withDatabaseConnection(async (connection) => {
    const attempt = await repository.findModerationAttemptByProviderJobId(
      connection,
      "wechat_sec_check",
      event.traceId
    );
    if (!attempt || String(attempt.provider) !== "wechat_sec_check") return null;
    const job = await repository.findModerationJobById(connection, attempt.moderation_job_id);
    if (
      !job ||
      String(job.provider) !== "wechat_sec_check" ||
      String(job.subject_type) !== "album_image"
    ) {
      return null;
    }
    return job;
  });
  if (!attemptAndJob) return staleResult();
  return applyMediaResult({
    jobId: attemptAndJob.id,
    provider: "wechat_sec_check",
    providerJobId: event.traceId,
    subjectVersion: attemptAndJob.subject_version,
    result: event.result
  });
}
