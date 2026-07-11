export function emitAlbumImageEvent(event, fields = {}, sink = console.info) {
  sink(JSON.stringify({
    type: "album_image",
    event,
    at: new Date().toISOString(),
    sessionId: Number(fields.sessionId || 0) || undefined,
    mediaId: Number(fields.mediaId || 0) || undefined,
    outcome: fields.outcome || undefined,
    errorCode: fields.errorCode || undefined,
    retryCount: Number.isInteger(fields.retryCount) ? fields.retryCount : undefined
  }));
}
