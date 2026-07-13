import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const server = await readFile(new URL("../src/server.js", import.meta.url), "utf8");

test("authenticated status and finalize routes are wired before generic album routes", () => {
  const statusRoute = server.indexOf("albumUploadStatusId");
  const finalizeRoute = server.indexOf("albumUploadFinalizeId");
  const genericRoute = server.indexOf("sessionAlbumPhotosId");
  assert.equal(statusRoute > 0 && finalizeRoute > statusRoute && genericRoute > finalizeRoute, true);
  assert.match(server.slice(statusRoute, finalizeRoute), /getAuthUser\(request\)/);
  assert.match(server.slice(finalizeRoute, genericRoute), /getAuthUser\(request\)/);
});

test("legacy COS create delegates exact-key finalize and strips storage facts", () => {
  assert.match(server, /albumImageUploads\.finalizeLegacy/);
  assert.match(server, /storage_object_key:\s*objectKey/);
  assert.match(server, /storage_object_etag:\s*ignoredEtag/);
});

test("local image and admin video creation never return media URLs before approval", () => {
  const localImageRoutes = server.slice(
    server.indexOf("const sessionAlbumPhotosId"),
    server.indexOf("const adminSessionAlbumVideosId")
  );
  const adminVideoRoute = server.slice(
    server.indexOf("const adminSessionAlbumVideosId"),
    server.indexOf("const sessionAlbumPhotoId")
  );

  assert.doesNotMatch(localImageRoutes, /image_url:\s*sessionAlbumMediaPath\(photo\.id\)/);
  assert.doesNotMatch(localImageRoutes, /preview_url:\s*sessionAlbumMediaPath\(photo\.id, "preview"\)/);
  assert.doesNotMatch(localImageRoutes, /thumbnail_url:\s*sessionAlbumMediaPath\(photo\.id, "thumbnail"\)/);
  assert.doesNotMatch(adminVideoRoute, /video_url:\s*video\.processing_status/);
  assert.doesNotMatch(adminVideoRoute, /sessionAlbumVideoUrlPath\(video\.id\)/);
});
