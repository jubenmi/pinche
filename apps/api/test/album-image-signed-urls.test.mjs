import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAlbumImageUrls,
  buildWechatImageModerationUrl
} from "../src/modules/album-image/signed-urls.js";
import { WECHAT_IMAGE_MODERATION_URL_SECONDS } from "../src/modules/album-image/constants.js";
import { MODERATION_RETRY_LEASE_MIN_MS } from "../src/modules/content-moderation/constants.js";
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
  assert.match(
    urls.thumbnail_display_url,
    /q-url-param-list=imagemogr2%252fauto-orient%252fthumbnail%252f640x640%253e%252fformat%252fjpg%252fquality%252f75%252fstrip/
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

test("WeChat image moderation receives an isolated five-minute GET URL for its bounded fetch window", () => {
  const url = buildWechatImageModerationUrl({
    objectKey: "uploads/session-album/display/private.jpg",
    nowSeconds: 1_000,
    config
  });

  assert.match(url, /^https:\/\/pinche-app-1251022382\.cos\.ap-nanjing\.myqcloud\.com\//);
  // The URL is never returned or stored, but it must outlive the bounded
  // token-refresh-and-retry submission chain and leave a short window for
  // WeChat's asynchronous fetch of this one private object.
  assert.equal(WECHAT_IMAGE_MODERATION_URL_SECONDS, 5 * 60);
  assert.ok(
    WECHAT_IMAGE_MODERATION_URL_SECONDS * 1000 >= MODERATION_RETRY_LEASE_MIN_MS + 120_000,
    "the URL must leave at least two minutes after a full renewed submission lease"
  );
  assert.match(url, /q-sign-time=1000;1300/);
  assert.equal(url.includes("imageMogr2"), false);
  assert.equal(url.includes("response-content-disposition"), false);
  assert.equal(url.includes("secret"), false);
});
