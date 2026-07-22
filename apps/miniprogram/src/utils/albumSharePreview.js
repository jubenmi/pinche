function positiveInteger(value) {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  }
  if (typeof value !== "string" || !/^\d+$/.test(value.trim())) return null;
  const parsed = Number(value.trim());
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function nonnegativeInteger(value) {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value >= 0 ? value : 0;
  }
  if (typeof value !== "string" || !/^\d+$/.test(value.trim())) return 0;
  const parsed = Number(value.trim());
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function normalizedCounts(totalValue, untaggedValue) {
  const total = nonnegativeInteger(totalValue);
  const candidateUntagged = nonnegativeInteger(untaggedValue);
  return {
    total,
    untagged: candidateUntagged <= total ? candidateUntagged : 0
  };
}

export function albumSharePreviewRoute({
  sessionId,
  token,
  total,
  untagged
} = {}) {
  const normalizedSessionId = positiveInteger(sessionId);
  const normalizedToken = typeof token === "string" ? token.trim() : "";
  if (!normalizedSessionId || !normalizedToken) return "";
  const counts = normalizedCounts(total, untagged);
  return "/pages/session/album?" + [
    ["id", normalizedSessionId],
    ["source", "share_preview"],
    ["albumShareToken", normalizedToken],
    ["shareTotal", counts.total],
    ["shareUntagged", counts.untagged]
  ].map(([key, value]) => (
    `${encodeURIComponent(key)}=${encodeURIComponent(value)}`
  )).join("&");
}

export function albumSharePreviewRouteState(options = {}) {
  const source = typeof options?.source === "string" ? options.source : "";
  const token = String(options?.albumShareToken || options?.token || "").trim();
  const sharePreviewRequested = source === "share_preview";
  const counts = token
    ? normalizedCounts(options?.shareTotal, options?.shareUntagged)
    : { total: 0, untagged: 0 };
  return Object.freeze({
    token,
    sharePreviewRequested,
    sharePreviewMode: Boolean(sharePreviewRequested && token),
    total: counts.total,
    untagged: counts.untagged
  });
}

export function albumSharePreviewNotice({ total, untagged } = {}) {
  const counts = normalizedCounts(total, untagged);
  const untaggedText = counts.untagged > 0
    ? `，其中 ${counts.untagged} 张未标注图片`
    : "";
  return `共 ${counts.total} 项${untaggedText}。请确认不含不适合公开的人物或内容。`;
}

function selectionError(error) {
  return Object.freeze({
    ok: false,
    ids: Object.freeze([]),
    error
  });
}

export function normalizeAlbumShareSelection(photos = [], selectedIds = []) {
  if (!Array.isArray(photos) || !Array.isArray(selectedIds)) {
    return selectionError("分享内容已发生变化，请返回重试");
  }
  const mediaById = new Map();
  for (const photo of photos) {
    const id = positiveInteger(photo?.id);
    if (id) mediaById.set(id, photo);
  }
  const ids = [];
  const seen = new Set();
  for (const value of selectedIds) {
    const id = positiveInteger(value);
    if (!id || !mediaById.has(id)) {
      return selectionError("分享内容已发生变化，请返回重试");
    }
    if (!seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }
  if (ids.length === 0) return selectionError("请至少选择 1 项");
  if (ids.length > 30) return selectionError("最多分享 30 项");
  const videoCount = ids.filter(
    (id) => String(mediaById.get(id)?.media_type || "image") === "video"
  ).length;
  if (videoCount > 3) return selectionError("最多分享 3 个视频");
  return Object.freeze({
    ok: true,
    ids: Object.freeze(ids),
    error: ""
  });
}
