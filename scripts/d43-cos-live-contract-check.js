import assert from "node:assert/strict";
import crypto from "node:crypto";

import { ALBUM_IMAGE_DISPLAY_PROCESS } from "../apps/api/src/modules/album-image/constants.js";
import { buildAlbumImageUrls, buildSignedCosImageUrl } from "../apps/api/src/modules/album-image/signed-urls.js";
import {
  deleteCosObject,
  getCosImageInfo,
  headCosObject,
  isTrustedCosStorageError,
  putCosObject
} from "../apps/api/src/storage/cos.js";

if (process.env.D43_COS_CONTRACT !== "1") {
  console.log("D43 COS live contract skipped");
  process.exit(0);
}

for (const name of ["COS_SECRET_ID", "COS_SECRET_KEY", "COS_BUCKET", "COS_REGION"]) {
  if (!process.env[name]) throw new Error(`${name} is required for D43 COS live contract`);
}

const config = {
  enabled: true,
  secretId: process.env.COS_SECRET_ID,
  secretKey: process.env.COS_SECRET_KEY,
  bucket: process.env.COS_BUCKET,
  region: process.env.COS_REGION
};
const key = `contract-tests/album-image/${Date.now()}-${crypto.randomUUID()}.jpg`;
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nKsAAAAASUVORK5CYII=",
  "base64"
);

async function assertFetchOk(url, label) {
  const response = await fetch(url);
  assert.equal(response.ok, true, `${label} returned ${response.status}`);
  await response.arrayBuffer();
}

async function assertFetchRejected(url, label) {
  const response = await fetch(url);
  assert.equal(response.ok, false, `${label} unexpectedly succeeded`);
}

let created = false;
try {
  const picOperations = JSON.stringify({
    is_pic_info: 1,
    rules: [{ bucket: config.bucket, fileid: `/${key}`, rule: ALBUM_IMAGE_DISPLAY_PROCESS }]
  });
  const first = await putCosObject({
    key,
    body: png,
    contentType: "image/png",
    contentLength: png.length,
    picOperations,
    forbidOverwrite: true,
    config
  });
  created = true;
  assert.ok(first.statusCode >= 200 && first.statusCode < 300);
  await assert.rejects(
    putCosObject({
      key,
      body: png,
      contentType: "image/png",
      contentLength: png.length,
      picOperations,
      forbidOverwrite: true,
      config
    }),
    (error) => [409, 412].includes(Number(error.statusCode)) ||
      error.code === "COS_PRECONDITION_FAILED"
  );
  const head = await headCosObject({ key, config });
  const info = await getCosImageInfo({ key, etag: head.headers.etag, config });
  assert.ok(["jpg", "jpeg"].includes(info.format));

  const nowSeconds = Math.floor(Date.now() / 1000);
  const urls = buildAlbumImageUrls({ objectKey: key, mediaId: 43, nowSeconds, config });
  const imageInfoUrl = buildSignedCosImageUrl({
    objectKey: key,
    queryEntries: [{ name: "imageInfo", value: null }],
    nowSeconds,
    config
  });
  await assertFetchOk(urls.thumbnail_display_url, "thumbnail");
  await assertFetchOk(urls.preview_display_url, "preview");
  await assertFetchOk(urls.download_url, "download");
  await assertFetchOk(imageInfoUrl, "ImageInfo");

  const mutated = urls.thumbnail_display_url.replace("quality/75", "quality/76");
  assert.notEqual(mutated, urls.thumbnail_display_url);
  await assertFetchRejected(mutated, "mutated processing parameter");
  const removed = new URL(urls.thumbnail_display_url);
  const processingKey = [...removed.searchParams.keys()].find((name) => name.startsWith("imageMogr2/"));
  assert.ok(processingKey);
  removed.searchParams.delete(processingKey);
  await assertFetchRejected(removed.toString(), "removed processing parameter");
  const appended = new URL(urls.download_url);
  appended.searchParams.append("response-content-type", "image/png");
  await assertFetchRejected(appended.toString(), "appended response parameter");
  console.log("D43 COS live contract passed");
} finally {
  if (created) {
    try {
      await deleteCosObject({ key, config });
    } catch (error) {
      if (!(isTrustedCosStorageError(error) && Number(error.statusCode) === 404)) throw error;
    }
  }
}
