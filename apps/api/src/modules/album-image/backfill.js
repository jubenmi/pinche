import { cosObjectKeyFromUploadPath } from "../../storage/cos.js";

const DISPLAY_PREFIX = "/uploads/session-album/display/";

export async function backfillAlbumImageObjectKeys({
  repository,
  storage,
  apply = false,
  pageSize = 100
}) {
  const result = { scanned: 0, updated: 0, missing: 0, invalid: 0 };
  let afterId = 0;
  for (;;) {
    const rows = await repository.listBackfillCandidates(afterId, pageSize);
    if (rows.length === 0) break;
    for (const row of rows) {
      afterId = Math.max(afterId, Number(row.id));
      result.scanned += 1;
      let objectKey;
      try {
        if (!String(row.photo_url || "").startsWith(DISPLAY_PREFIX)) throw new Error("invalid");
        objectKey = cosObjectKeyFromUploadPath(row.photo_url, DISPLAY_PREFIX);
      } catch {
        result.invalid += 1;
        continue;
      }
      let metadata;
      try {
        metadata = await storage.head(objectKey);
      } catch (error) {
        if (error?.code === "COS_OBJECT_NOT_FOUND") {
          result.missing += 1;
          continue;
        }
        throw error;
      }
      if (apply) {
        const changed = await repository.updateBackfilledObject({
          id: row.id,
          objectKey,
          objectEtag: String(metadata.etag || "").replace(/^\"|\"$/g, ""),
          photoUrl: row.photo_url
        });
        if (changed) result.updated += 1;
      }
    }
    if (rows.length < pageSize) break;
  }
  return result;
}
