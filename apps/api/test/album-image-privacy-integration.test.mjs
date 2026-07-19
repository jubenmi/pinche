import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  attachPublicSessionAlbumMediaUrls,
  attachSessionAlbumMediaUrls
} from "../src/server.js";

const cosConfig = { enabled: true, secretId: "id", secretKey: "secret", bucket: "b", region: "r" };

function fakeSignedUrls(calls) {
  return ({ objectKey, mediaId, nowSeconds }) => {
    calls.push({ objectKey, mediaId, nowSeconds });
    return {
      thumbnail_display_url: `signed-thumb-${mediaId}`,
      preview_display_url: `signed-preview-${mediaId}`,
      download_url: `signed-download-${mediaId}`,
      media_url_expires_at: "1970-01-01T00:21:40.000Z"
    };
  };
}

test("member/admin attachment signs only rows already retained by privacy filtering", () => {
  const calls = [];
  const events = [];
  const filteredAlbum = {
    session_id: 8,
    photos: [{
      id: 1,
      media_type: "image",
      moderation_status: "approved",
      storage_object_key: "visible.jpg"
    }]
  };
  const result = attachSessionAlbumMediaUrls(filteredAlbum, 9, {
    directMediaUrls: true, nowSeconds: 1000, cosConfig, buildUrls: fakeSignedUrls(calls),
    emit: (event, fields) => events.push({ event, fields })
  });
  assert.deepEqual(calls, [{ objectKey: "visible.jpg", mediaId: 1, nowSeconds: 1000 }]);
  assert.equal(result.photos.some(({ id }) => id === 2), false);
  assert.deepEqual(events, [{
    event: "media_urls_signed",
    fields: { sessionId: 8, outcome: "member", signedImageCount: 1 }
  }]);
});

test("public-share attachment proxies filtered rows so privacy and revocation remain enforceable", () => {
  const calls = [];
  const result = attachPublicSessionAlbumMediaUrls({
    session_id: 8,
    photos: [{
      id: 5,
      media_type: "image",
      moderation_status: "approved",
      storage_object_key: "public-visible.jpg",
      storage_object_etag: "e"
    }]
  }, { sessionId: 8, sharerUserId: 9, seatId: 2 }, "share-token", {
    directMediaUrls: true, nowSeconds: 1000, cosConfig, buildUrls: fakeSignedUrls(calls),
    emit: () => {}
  });
  assert.equal(calls.length, 0);
  assert.match(
    result.photos[0].image_url,
    /^\/api\/session-album\/public-share\/photos\/5\/image\?token=/
  );
  assert.equal(result.photos[0].preview_display_url, result.photos[0].image_url);
  assert.equal("storage_object_key" in result.photos[0], false);
  assert.equal("storage_object_etag" in result.photos[0], false);
});

test("server exposes no arbitrary bulk image signing endpoint", async () => {
  const server = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  assert.doesNotMatch(server, /bulk-sign|sign-image-ids|media\/sign/);
});
