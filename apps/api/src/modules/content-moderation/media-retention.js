const RETAINED_MEDIA_TYPES = new Set(["image", "video"]);

// This decision is derived from the persisted media row, never the current
// feature flag. Turning D46 off must not make an already-retained object enter
// the legacy rejection cleanup path.
export function shouldRetainRejectedMedia(media) {
  return (
    String(media?.status || "") === "active" &&
    Number(media?.author_visibility_version) === 1 &&
    RETAINED_MEDIA_TYPES.has(String(media?.media_type || ""))
  );
}
