export function emitAlbumImageEvent(event, fields = {}, sink = console.info) {
  sink(JSON.stringify({
    type: "album_image",
    event,
    at: new Date().toISOString(),
    sessionId: Number(fields.sessionId || 0) || undefined,
    mediaId: Number(fields.mediaId || 0) || undefined,
    outcome: fields.outcome || undefined,
    errorCode: fields.errorCode || undefined,
    retryCount: Number.isInteger(fields.retryCount) ? fields.retryCount : undefined,
    signedImageCount: Number.isInteger(fields.signedImageCount)
      ? fields.signedImageCount
      : undefined,
    byteCount: Number.isInteger(fields.byteCount) ? fields.byteCount : undefined,
    variant: ["preview", "thumbnail"].includes(fields.variant) ? fields.variant : undefined
  }));
}
