import {
  buildCosAuthorization,
  cosHost,
  cosQueryEntries,
  encodeCosObjectPath,
  renderCosRequestQuery
} from "../../storage/cos.js";
import {
  ALBUM_IMAGE_THUMBNAIL_PROCESS,
  ALBUM_IMAGE_URL_SECONDS
} from "./constants.js";

export function buildSignedCosImageUrl({
  objectKey,
  queryEntries = [],
  nowSeconds,
  config
}) {
  const entries = cosQueryEntries(queryEntries);
  const authorization = buildCosAuthorization({
    method: "GET",
    key: objectKey,
    headers: { host: cosHost(config) },
    urlParams: entries,
    nowSeconds,
    expiresInSeconds: ALBUM_IMAGE_URL_SECONDS,
    config
  });
  const dataQuery = renderCosRequestQuery(entries);
  return `https://${cosHost(config)}/${encodeCosObjectPath(objectKey)}?${
    dataQuery ? `${dataQuery}&` : ""
  }${authorization}`;
}

export function buildAlbumImageUrls({ objectKey, mediaId, nowSeconds, config }) {
  const expiresAt = new Date(
    (nowSeconds + ALBUM_IMAGE_URL_SECONDS) * 1000
  ).toISOString();
  const preview = buildSignedCosImageUrl({ objectKey, nowSeconds, config });
  return {
    thumbnail_display_url: buildSignedCosImageUrl({
      objectKey,
      queryEntries: [{ name: ALBUM_IMAGE_THUMBNAIL_PROCESS, value: null }],
      nowSeconds,
      config
    }),
    preview_display_url: preview,
    download_url: buildSignedCosImageUrl({
      objectKey,
      queryEntries: [{
        name: "response-content-disposition",
        value: `attachment; filename=album-photo-${Number(mediaId)}.jpg`
      }],
      nowSeconds,
      config
    }),
    media_url_expires_at: expiresAt
  };
}
