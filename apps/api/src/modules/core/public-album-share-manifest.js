import crypto from "node:crypto";

import { config } from "../../config/env.js";
import { badRequest, forbidden } from "../../http/errors.js";

const PUBLIC_SHARE_MANIFEST_PAGE_LIMIT = 30;

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
    throw forbidden("Album share manifest is invalid");
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
      throw forbidden("Album share manifest is invalid");
    }
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw forbidden("Album share manifest is invalid");
  }
  const seen = new Set();
  const mediaIds = [];
  for (const mediaId of parsed) {
    if (!isPositiveSafeInteger(mediaId) || seen.has(mediaId)) {
      throw forbidden("Album share manifest is invalid");
    }
    seen.add(mediaId);
    mediaIds.push(mediaId);
  }
  return mediaIds;
}

function normalizeStoredItems(rows, options = {}) {
  if (!Array.isArray(rows)) {
    throw forbidden("Album share manifest is invalid");
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
      throw forbidden("Album share manifest is invalid");
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
  for (const [ordinal, mediaId] of normalizedMediaIds.entries()) {
    await connection.query(
      `
        INSERT INTO session_album_public_share_items
          (share_id, ordinal, media_id)
        VALUES (?, ?, ?)
      `,
      [normalizedShareId, ordinal, mediaId],
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
    throw forbidden("Album share manifest is invalid");
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
