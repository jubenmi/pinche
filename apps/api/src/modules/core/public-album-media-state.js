import { badRequest, forbidden } from "../../http/errors.js";

export const PUBLIC_MEDIA_STATE_BATCH_LIMIT = 100;

export function normalizePublicMediaStateIds(values) {
  if (!Array.isArray(values) || values.length === 0) {
    throw badRequest("media_ids must be a non-empty array");
  }
  const ids = [];
  const seen = new Set();
  for (const value of values) {
    if (
      typeof value !== "number" ||
      !Number.isSafeInteger(value) ||
      value <= 0
    ) {
      throw badRequest("media_ids contains an invalid id");
    }
    if (seen.has(value)) continue;
    seen.add(value);
    ids.push(value);
  }
  if (ids.length > PUBLIC_MEDIA_STATE_BATCH_LIMIT) {
    throw badRequest(
      `media_ids must contain at most ${PUBLIC_MEDIA_STATE_BATCH_LIMIT} ids`
    );
  }
  return ids;
}

export async function readPublicAlbumMediaState({
  connection,
  claims,
  mediaIds,
  loadShare,
  readVisibleMedia
}) {
  const requestedIds = normalizePublicMediaStateIds(mediaIds);
  if (typeof loadShare !== "function") {
    throw new TypeError("loadShare must be a function");
  }
  if (typeof readVisibleMedia !== "function") {
    throw new TypeError("readVisibleMedia must be a function");
  }

  const loadedShare = await loadShare(connection, claims);
  const manifestIds = new Set(
    (Array.isArray(loadedShare?.items) ? loadedShare.items : [])
      .map((item) => Number(item?.media_id))
      .filter((id) => Number.isSafeInteger(id) && id > 0)
  );
  if (requestedIds.some((id) => !manifestIds.has(id))) {
    throw forbidden("Album share media is unavailable");
  }

  const visible = await readVisibleMedia(
    connection,
    claims,
    requestedIds,
    loadedShare
  );
  const requestedIdSet = new Set(requestedIds);
  const visibleById = new Map(
    (Array.isArray(visible) ? visible : [])
      .filter((media) => requestedIdSet.has(Number(media?.id)))
      .map((media) => [Number(media.id), media])
  );
  return {
    patches: requestedIds
      .map((id) => visibleById.get(id))
      .filter(Boolean),
    unavailable_ids: requestedIds.filter((id) => !visibleById.has(id))
  };
}

function finiteMetric(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

export function emitPublicMediaStateTelemetry(fields, sink = console.info) {
  const event = {
    event: "public_media_state_refresh",
    sessionId: finiteMetric(fields?.sessionId),
    shareId: finiteMetric(fields?.shareId),
    requestedCount: finiteMetric(fields?.requestedCount),
    patchCount: finiteMetric(fields?.patchCount),
    unavailableCount: finiteMetric(fields?.unavailableCount),
    durationMs: finiteMetric(fields?.durationMs)
  };
  sink(JSON.stringify(event));
  return event;
}
