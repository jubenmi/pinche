import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("video inspection preserves COS ETag as the immutable moderation version", async () => {
  const [media, server] = await Promise.all([
    readFile(new URL("../src/modules/album-video/media.js", import.meta.url), "utf8"),
    readFile(new URL("../src/server.js", import.meta.url), "utf8")
  ]);
  assert.match(media, /etag:\s*metadata\.etag/);
  assert.match(server, /return \{ \.\.\.metadata, etag \}/);
});

test("video insert atomically creates and then submits a moderation job", async () => {
  const service = await readFile(new URL("../src/modules/core/service.js", import.meta.url), "utf8");
  const createVideo = service.slice(
    service.indexOf("export async function createSessionAlbumVideo"),
    service.indexOf("export async function updateSessionAlbumVideoProcessingResult")
  );
  assert.match(createVideo, /createVideoModerationJob/);
  assert.match(createVideo, /submitVideoModeration/);
  assert.match(createVideo, /moderation_status/);
  assert.match(createVideo, /subjectVersion:\s*videoObjectVersion/);
});

test("video creation response is a metadata-only pending placeholder", async () => {
  const service = await readFile(new URL("../src/modules/core/service.js", import.meta.url), "utf8");
  const response = service.slice(
    service.indexOf("function sessionAlbumVideoCreateResponse"),
    service.indexOf("export async function createSessionAlbumVideo")
  );
  assert.match(response, /moderation_status/);
  assert.doesNotMatch(response, /source_url:/);
  assert.doesNotMatch(response, /display_url:/);
  assert.doesNotMatch(response, /cover_url:/);
});

