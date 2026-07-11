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
  assert.match(server, /storage_object_key:\s*ignoredObjectKey/);
  assert.match(server, /storage_object_etag:\s*ignoredObjectEtag/);
});
