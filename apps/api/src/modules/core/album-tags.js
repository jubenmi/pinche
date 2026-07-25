import { badRequest } from "../../http/errors.js";

function canonicalText(primary, fallback = "") {
  const value = String(primary ?? "").trim();
  return value || String(fallback ?? "").trim();
}

function positiveSafeId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function normalizedMediaIds(values = []) {
  const ids = [];
  const seen = new Set();
  for (const value of values) {
    const id = positiveSafeId(value);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

export function normalizeAlbumTagKeys(values = []) {
  if (!Array.isArray(values)) {
    throw badRequest("Invalid album tag");
  }
  const seen = new Set();
  return values.map((value) => {
    const key = String(value || "").trim();
    const match = /^(role|npc-role):([1-9]\d*)$/.exec(key);
    const matchedRefId = match ? positiveSafeId(match[2]) : null;
    const normalized = key === "other"
      ? { kind: "other", refId: null, key }
      : match && matchedRefId
        ? {
            kind: match[1] === "role" ? "role" : "npc_role",
            refId: matchedRefId,
            key,
          }
        : null;
    if (!normalized) throw badRequest("Invalid album tag");
    if (seen.has(key)) throw badRequest("Album tags must be unique");
    seen.add(key);
    return normalized;
  });
}

export async function listAlbumTagOptions(connection, sessionId) {
  const [seats] = await connection.query(
    `
      SELECT id, role_name, name
      FROM session_seats
      WHERE session_id = ?
        AND status IN ('confirmed', 'locked')
      ORDER BY id
    `,
    [sessionId],
  );
  const [npcRoles] = await connection.query(
    `
      SELECT id, name
      FROM session_npc_roles
      WHERE session_id = ?
        AND status = 'active'
      ORDER BY sort_order, id
    `,
    [sessionId],
  );

  return [
    ...seats
      .map((seat) => ({
        key: `role:${Number(seat.id)}`,
        kind: "role",
        ref_id: Number(seat.id),
        label: canonicalText(seat.role_name, seat.name),
      }))
      .filter((option) => positiveSafeId(option.ref_id) && option.label),
    ...npcRoles
      .map((role) => ({
        key: `npc-role:${Number(role.id)}`,
        kind: "npc_role",
        ref_id: Number(role.id),
        label: canonicalText(role.name),
      }))
      .filter((option) => positiveSafeId(option.ref_id) && option.label),
    { key: "other", kind: "other", ref_id: null, label: "其他" },
  ];
}

async function selectAlbumTagReadRows(connection, sessionId, mediaIds) {
  if (mediaIds.length === 0) return [];
  const placeholders = mediaIds.map(() => "?").join(", ");
  const [rows] = await connection.query(
    `
      SELECT
        tag.media_id,
        tag.kind,
        tag.seat_id,
        tag.session_npc_role_id,
        CASE
          WHEN tag.kind = 'role'
            THEN COALESCE(
              NULLIF(TRIM(seat.role_name), ''),
              NULLIF(TRIM(seat.name), '')
            )
          WHEN tag.kind = 'npc_role'
            THEN NULLIF(TRIM(npc_role.name), '')
          ELSE NULL
        END AS canonical_label,
        CASE
          WHEN tag.kind = 'role' THEN seat.confirmed_user_id
          WHEN tag.kind = 'npc_role' THEN npc_role.bound_user_id
          ELSE NULL
        END AS privacy_user_id
      FROM session_album_media_tags tag
      JOIN session_album_photos media
        ON media.id = tag.media_id
       AND media.session_id = ?
      LEFT JOIN session_seats seat
        ON tag.kind = 'role'
       AND seat.id = tag.seat_id
       AND seat.session_id = media.session_id
       AND seat.status IN ('confirmed', 'locked')
      LEFT JOIN session_npc_roles npc_role
        ON tag.kind = 'npc_role'
       AND npc_role.id = tag.session_npc_role_id
       AND npc_role.session_id = media.session_id
       AND npc_role.status = 'active'
      WHERE tag.media_id IN (${placeholders})
        AND (
          (tag.kind = 'role' AND seat.id IS NOT NULL)
          OR (tag.kind = 'npc_role' AND npc_role.id IS NOT NULL)
          OR (
            tag.kind = 'other'
            AND tag.seat_id IS NULL
            AND tag.session_npc_role_id IS NULL
          )
        )
      ORDER BY tag.media_id, tag.sort_order, tag.id
    `,
    [sessionId, ...mediaIds],
  );
  return rows;
}

function projectAlbumTagReadRows(mediaIds, rows = []) {
  const tagsByMediaId = new Map(mediaIds.map((id) => [id, []]));
  const privacySubjectsByMediaId = new Map(
    mediaIds.map((id) => [id, []]),
  );
  const seenPrivacySubjectsByMediaId = new Map(
    mediaIds.map((id) => [id, new Set()]),
  );
  for (const row of rows) {
    const mediaId = positiveSafeId(row.media_id);
    if (!mediaId || !tagsByMediaId.has(mediaId)) continue;
    let tag = null;
    if (row.kind === "role") {
      const refId = positiveSafeId(row.seat_id);
      const label = canonicalText(row.canonical_label);
      if (refId && label) tag = { kind: "role", ref_id: refId, label };
    } else if (row.kind === "npc_role") {
      const refId = positiveSafeId(row.session_npc_role_id);
      const label = canonicalText(row.canonical_label);
      if (refId && label) tag = { kind: "npc_role", ref_id: refId, label };
    } else if (row.kind === "other") {
      tag = { kind: "other", ref_id: null, label: "其他" };
    }
    if (tag) tagsByMediaId.get(mediaId).push(tag);

    const privacyUserId = positiveSafeId(row.privacy_user_id);
    const seenPrivacySubjects = seenPrivacySubjectsByMediaId.get(mediaId);
    if (privacyUserId && !seenPrivacySubjects.has(privacyUserId)) {
      seenPrivacySubjects.add(privacyUserId);
      privacySubjectsByMediaId.get(mediaId).push(privacyUserId);
    }
  }
  return { tagsByMediaId, privacySubjectsByMediaId };
}

export async function resolveAlbumTagReadContext(
  connection,
  sessionId,
  mediaIds,
) {
  const ids = normalizedMediaIds(mediaIds);
  const rows = await selectAlbumTagReadRows(connection, sessionId, ids);
  return projectAlbumTagReadRows(ids, rows);
}

export async function resolveAlbumTags(connection, sessionId, mediaIds) {
  const { tagsByMediaId } = await resolveAlbumTagReadContext(
    connection,
    sessionId,
    mediaIds,
  );
  return new Map(
    [...tagsByMediaId].filter(([, tags]) => tags.length > 0),
  );
}

export async function resolveAlbumTagPrivacySubjects(
  connection,
  sessionId,
  mediaIds,
) {
  const { privacySubjectsByMediaId } = await resolveAlbumTagReadContext(
    connection,
    sessionId,
    mediaIds,
  );
  return privacySubjectsByMediaId;
}

async function assertAlbumTagReferences(
  connection,
  mediaId,
  sessionId,
  normalizedTags,
) {
  const [mediaRows] = await connection.query(
    `
      SELECT media.id
      FROM session_album_photos media
      WHERE media.id = ?
        AND media.session_id = ?
      LIMIT 1
      FOR UPDATE
    `,
    [mediaId, sessionId],
  );
  if (!mediaRows[0]) throw badRequest("Invalid album tag reference");

  const roleIds = normalizedTags
    .filter((tag) => tag.kind === "role")
    .map((tag) => tag.refId);
  if (roleIds.length > 0) {
    const placeholders = roleIds.map(() => "?").join(", ");
    const [rows] = await connection.query(
      `
        SELECT id
        FROM session_seats
        WHERE session_id = ?
          AND status IN ('confirmed', 'locked')
          AND id IN (${placeholders})
        FOR UPDATE
      `,
      [sessionId, ...roleIds],
    );
    const found = new Set(rows.map((row) => positiveSafeId(row.id)).filter(Boolean));
    if (roleIds.some((id) => !found.has(id))) {
      throw badRequest("Invalid album tag reference");
    }
  }

  const npcRoleIds = normalizedTags
    .filter((tag) => tag.kind === "npc_role")
    .map((tag) => tag.refId);
  if (npcRoleIds.length > 0) {
    const placeholders = npcRoleIds.map(() => "?").join(", ");
    const [rows] = await connection.query(
      `
        SELECT id
        FROM session_npc_roles
        WHERE session_id = ?
          AND status = 'active'
          AND id IN (${placeholders})
        FOR UPDATE
      `,
      [sessionId, ...npcRoleIds],
    );
    const found = new Set(rows.map((row) => positiveSafeId(row.id)).filter(Boolean));
    if (npcRoleIds.some((id) => !found.has(id))) {
      throw badRequest("Invalid album tag reference");
    }
  }
}

export async function writeAlbumMediaTags(connection, {
  mediaId,
  sessionId,
  normalizedTags,
}) {
  const id = positiveSafeId(mediaId);
  const session = positiveSafeId(sessionId);
  if (!id || !session || !Array.isArray(normalizedTags)) {
    throw badRequest("Invalid album tag reference");
  }
  const checkedTags = normalizeAlbumTagKeys(
    normalizedTags.map((tag) => tag?.key),
  );
  await assertAlbumTagReferences(connection, id, session, checkedTags);
  await connection.query(
    "DELETE FROM session_album_media_tags WHERE media_id = ?",
    [id],
  );
  for (const [sortOrder, tag] of checkedTags.entries()) {
    await connection.query(
      `
        INSERT INTO session_album_media_tags
          (media_id, kind, seat_id, session_npc_role_id, sort_order)
        VALUES (?, ?, ?, ?, ?)
      `,
      [
        id,
        tag.kind,
        tag.kind === "role" ? tag.refId : null,
        tag.kind === "npc_role" ? tag.refId : null,
        sortOrder,
      ],
    );
  }
}
