import crypto from "node:crypto";

import { config } from "../../config/env.js";
import { AppError, badRequest } from "../../http/errors.js";

const PUBLIC_SHARE_MANIFEST_PAGE_LIMIT = 30;
const PUBLIC_SHARE_MANIFEST_WRITE_BATCH_SIZE = 500;
const PUBLIC_SHARE_MANIFEST_TELEMETRY_EVENTS = new Set([
  "public_share_manifest_page",
  "public_share_manifest_mismatch",
  "public_share_manifest_membership_denied",
]);

function manifestInvalid() {
  return new AppError(
    403,
    "ALBUM_PUBLIC_SHARE_MANIFEST_INVALID",
    "Album share manifest is invalid",
  );
}

export function publicShareManifestInvalid() {
  return manifestInvalid();
}

function finiteMetric(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function safeResultCode(value) {
  const code = String(value || "").trim().toUpperCase();
  return /^[A-Z0-9_]{1,64}$/.test(code) ? code : "UNKNOWN";
}

export function emitPublicShareManifestTelemetry(eventName, fields, sink = console.info) {
  if (!PUBLIC_SHARE_MANIFEST_TELEMETRY_EVENTS.has(eventName)) {
    throw new TypeError("unsupported public share manifest telemetry event");
  }
  const event = {
    event: eventName,
    sessionId: finiteMetric(fields?.sessionId),
    shareId: finiteMetric(fields?.shareId),
    requestedLimit: finiteMetric(fields?.requestedLimit),
    returnedCount: finiteMetric(fields?.returnedCount),
    scannedCount: finiteMetric(fields?.scannedCount),
    resultCode: safeResultCode(fields?.resultCode),
    durationMs: finiteMetric(fields?.durationMs),
  };
  sink(JSON.stringify(event));
  return event;
}

function isPositiveSafeInteger(value) {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isNonNegativeSafeInteger(value) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function requestShareId(value) {
  if (!isPositiveSafeInteger(value)) {
    throw badRequest("Invalid album share manifest");
  }
  return value;
}

function storedShareId(value) {
  if (!isPositiveSafeInteger(value)) {
    throw manifestInvalid();
  }
  return value;
}

function normalizeWriteMediaIds(value) {
  if (!Array.isArray(value) || value.length === 0) {
    throw badRequest("Invalid album share manifest");
  }
  const seen = new Set();
  const mediaIds = [];
  for (const mediaId of value) {
    if (!isPositiveSafeInteger(mediaId) || seen.has(mediaId)) {
      throw badRequest("Invalid album share manifest");
    }
    seen.add(mediaId);
    mediaIds.push(mediaId);
  }
  return mediaIds;
}

function normalizeLegacyMediaIds(value) {
  let parsed = value;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      throw manifestInvalid();
    }
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw manifestInvalid();
  }
  const seen = new Set();
  const mediaIds = [];
  for (const mediaId of parsed) {
    if (!isPositiveSafeInteger(mediaId) || seen.has(mediaId)) {
      throw manifestInvalid();
    }
    seen.add(mediaId);
    mediaIds.push(mediaId);
  }
  return mediaIds;
}

function normalizeStoredItems(rows, options = {}) {
  if (!Array.isArray(rows)) {
    throw manifestInvalid();
  }
  const afterOrdinal = options.afterOrdinal ?? -1;
  let previousOrdinal = afterOrdinal;
  const mediaIds = new Set();
  return rows.map((row) => {
    const ordinal = row?.ordinal;
    const mediaId = row?.media_id;
    if (
      !isNonNegativeSafeInteger(ordinal) ||
      ordinal <= previousOrdinal ||
      !isPositiveSafeInteger(mediaId) ||
      mediaIds.has(mediaId)
    ) {
      throw manifestInvalid();
    }
    previousOrdinal = ordinal;
    mediaIds.add(mediaId);
    return { ordinal, media_id: mediaId };
  });
}

function cursorSignature(payload) {
  return crypto
    .createHmac("sha256", config.sessionSecret)
    .update(`album-share-page:${payload}`)
    .digest("base64url");
}

function invalidCursor() {
  return badRequest("Invalid album share cursor");
}

export async function writePublicShareItems(connection, shareId, mediaIds) {
  const normalizedShareId = requestShareId(shareId);
  const normalizedMediaIds = normalizeWriteMediaIds(mediaIds);
  for (
    let start = 0;
    start < normalizedMediaIds.length;
    start += PUBLIC_SHARE_MANIFEST_WRITE_BATCH_SIZE
  ) {
    const batch = normalizedMediaIds.slice(
      start,
      start + PUBLIC_SHARE_MANIFEST_WRITE_BATCH_SIZE,
    );
    const placeholders = batch.map(() => "(?, ?, ?)").join(", ");
    const values = batch.flatMap((mediaId, index) => [
      normalizedShareId,
      start + index,
      mediaId,
    ]);
    await connection.query(
      `
        INSERT INTO session_album_public_share_items
          (share_id, ordinal, media_id)
        VALUES ${placeholders}
      `,
      values,
    );
  }
}

export async function loadPublicShareItems(connection, shareId) {
  const normalizedShareId = storedShareId(shareId);
  const [rows] = await connection.query(
    `
      SELECT ordinal, media_id
      FROM session_album_public_share_items
      WHERE share_id = ?
      ORDER BY ordinal
    `,
    [normalizedShareId],
  );
  return normalizeStoredItems(rows);
}

export function assertManifestMatchesLegacySnapshot(items, legacyMediaIds) {
  const normalizedItems = normalizeStoredItems(items);
  const normalizedLegacyIds = normalizeLegacyMediaIds(legacyMediaIds);
  if (
    normalizedItems.length !== normalizedLegacyIds.length ||
    normalizedItems.some((item, index) => (
      item.ordinal !== index || item.media_id !== normalizedLegacyIds[index]
    ))
  ) {
    throw manifestInvalid();
  }
}

export function encodePublicShareOrdinalCursor(shareId, afterOrdinal) {
  const normalizedShareId = requestShareId(shareId);
  if (!isNonNegativeSafeInteger(afterOrdinal)) throw invalidCursor();
  const payload = Buffer.from(JSON.stringify({
    share_id: normalizedShareId,
    after_ordinal: afterOrdinal,
  })).toString("base64url");
  return `${payload}.${cursorSignature(payload)}`;
}

export function decodePublicShareOrdinalCursor(cursor, shareId, options = {}) {
  try {
    const normalizedShareId = requestShareId(shareId);
    const [payload, signature, extra] = String(cursor || "").split(".");
    const expectedSignature = cursorSignature(payload || "");
    if (
      extra !== undefined ||
      !payload ||
      !signature ||
      signature.length !== expectedSignature.length ||
      !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))
    ) {
      throw new Error("invalid signature");
    }
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) {
      throw new Error("invalid payload");
    }
    if (decoded.share_id !== normalizedShareId) throw new Error("wrong share");

    const keys = Object.keys(decoded).sort();
    let afterOrdinal;
    if (keys.length === 2 && keys[0] === "after_ordinal" && keys[1] === "share_id") {
      if (!isNonNegativeSafeInteger(decoded.after_ordinal)) {
        throw new Error("invalid ordinal");
      }
      afterOrdinal = decoded.after_ordinal;
    } else if (keys.length === 2 && keys[0] === "offset" && keys[1] === "share_id") {
      if (!isPositiveSafeInteger(decoded.offset)) throw new Error("invalid offset");
      if (
        !isPositiveSafeInteger(options.manifestLength) ||
        decoded.offset >= options.manifestLength
      ) {
        throw new Error("offset outside manifest");
      }
      afterOrdinal = decoded.offset - 1;
    } else {
      throw new Error("invalid payload shape");
    }

    if (
      options.maxOrdinal !== undefined &&
      (!isNonNegativeSafeInteger(options.maxOrdinal) || afterOrdinal > options.maxOrdinal)
    ) {
      throw new Error("ordinal outside manifest");
    }
    return afterOrdinal;
  } catch {
    throw invalidCursor();
  }
}

export async function readPublicShareItemPage(connection, shareId, options = {}) {
  const normalizedShareId = requestShareId(shareId);
  const afterOrdinal = options.afterOrdinal ?? -1;
  const limit = options.limit ?? PUBLIC_SHARE_MANIFEST_PAGE_LIMIT;
  if (
    !Number.isSafeInteger(afterOrdinal) ||
    afterOrdinal < -1 ||
    !isPositiveSafeInteger(limit) ||
    limit > PUBLIC_SHARE_MANIFEST_PAGE_LIMIT
  ) {
    throw badRequest("Invalid album share page");
  }
  const [rows] = await connection.query(
    `
      SELECT ordinal, media_id
      FROM session_album_public_share_items
      WHERE share_id = ?
        AND ordinal > ?
      ORDER BY ordinal
      LIMIT ?
    `,
    [normalizedShareId, afterOrdinal, limit],
  );
  const items = normalizeStoredItems(rows, { afterOrdinal });
  return {
    items,
    lastScannedOrdinal: items.at(-1)?.ordinal ?? afterOrdinal,
  };
}
