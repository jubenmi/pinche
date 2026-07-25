export function isChatAccessDeniedError(error) {
  return error?.statusCode === 401 || error?.statusCode === 403;
}

export function canSaveAlbumPrivacy({ loaded, saving, sessionId } = {}) {
  return Boolean(loaded && !saving && sessionId);
}

export function albumListPresentation({ loading, failed, count } = {}) {
  if (loading) {
    return "loading";
  }
  if (failed) {
    return "error";
  }
  return Number(count || 0) > 0 ? "content" : "empty";
}

export function hasPublicAlbumAccessCredentials(sessionId, shareToken) {
  return Boolean(String(sessionId || "").trim() && String(shareToken || "").trim());
}

export function isUnavailablePublicAlbumError(error) {
  return Number(error?.statusCode || 0) === 403;
}
