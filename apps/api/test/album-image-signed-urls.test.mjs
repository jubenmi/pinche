import assert from "node:assert/strict";
import test from "node:test";

import { buildAlbumImageUrls } from "../src/modules/album-image/signed-urls.js";
import {
  cosQueryEntries,
  renderCosCanonicalQuery,
  renderCosRequestQuery
} from "../src/storage/cos.js";

const config = {
  enabled: true,
  secretId: "id",
  secretKey: "secret",
  bucket: "pinche-app-1251022382",
  region: "ap-nanjing"
};

test("imageMogr2 is valueless on the wire and empty-valued when signed", () => {
  const entries = cosQueryEntries([
    { name: "imageMogr2/thumbnail/640x640>", value: null }
  ]);
  assert.equal(renderCosRequestQuery(entries), "imageMogr2/thumbnail/640x640%3E");
  assert.equal(
    renderCosCanonicalQuery(entries),
    "imagemogr2%2fthumbnail%2f640x640%3e="
  );
});

test("all album image variants share an exact five-minute expiry", () => {
  const urls = buildAlbumImageUrls({
    objectKey: "uploads/session-album/display/photo.jpg",
    mediaId: 7,
    nowSeconds: 1_000,
    config
  });

  assert.equal(urls.media_url_expires_at, "1970-01-01T00:21:40.000Z");
  assert.match(
    urls.thumbnail_display_url,
    /imageMogr2\/auto-orient\/thumbnail\/640x640%3E/
  );
  for (const url of [
    urls.thumbnail_display_url,
    urls.preview_display_url,
    urls.download_url
  ]) {
    assert.match(url, /q-sign-time=1000;1300/);
    assert.equal(url.includes("secret"), false);
  }
  assert.match(urls.download_url, /response-content-disposition=/);
});
