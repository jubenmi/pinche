import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("enabled WeChat image moderation wires post-commit finalize hooks to verified storage and identity", async () => {
  const server = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  const uploads = server.slice(
    server.indexOf("const albumImageUploads = createAlbumImageUploadService"),
    server.indexOf("async function isPersistedAlbumImageAuthorization")
  );

  assert.match(server, /buildWechatImageModerationUrl/);
  assert.match(server, /config\.contentModeration\.enabled\s*&&\s*config\.contentModeration\.wechatImageEnabled/);
  assert.match(uploads, /createWechatImageModerationJob:/);
  assert.match(uploads, /contentModeration\.createWechatImageModerationJob/);
  assert.match(uploads, /submitWechatImageModeration:/);
  assert.match(uploads, /contentModeration\.submitWechatImageModeration/);
  assert.match(uploads, /assertImageIntake:\s*\(connection\) => resolveContentSecurityIntake\(/);
  assert.match(server, /SELECT open_id FROM users WHERE id = \? LIMIT 1/);
  assert.match(server, /buildWechatImageModerationUrl\(/);
  assert.equal(uploads.includes("mediaUrl:"), false, "the signed URL must not enter an API response");
});

test("image intake is checked before legacy, multipart, and direct COS paths accept new content", async () => {
  const server = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  for (const marker of ["async function createCosDirectUploadIntent", "async function authorizeCosDirectUpload"]) {
    const start = server.indexOf(marker);
    const segment = server.slice(start, start + 5_000);
    assert.match(segment, /await resolveContentSecurityIntake\("image"\)/, marker);
  }
  for (const marker of [
    "const sessionAlbumPhotosId",
    "const adminSessionAlbumPhotosId",
    "const sessionAlbumUploadId",
    "const adminSessionAlbumUploadId"
  ]) {
    const start = server.indexOf(marker);
    const routeStart = server.indexOf("if (request.method", start);
    const nextRoute = server.indexOf("\n  const ", routeStart + 1);
    const segment = server.slice(routeStart, nextRoute === -1 ? routeStart + 2_000 : nextRoute);
    assert.match(segment, /await resolveContentSecurityIntake\("image"\)/, marker);
  }
});

test("avatar and review-photo upload intents and multipart writes use the persisted image policy", async () => {
  const server = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  const directIntent = server.slice(
    server.indexOf("async function createCosDirectUploadIntent"),
    server.indexOf("function normalizeCosHeaders")
  );
  for (const kind of ["avatar", "sessionReviewPhoto"]) {
    const start = directIntent.indexOf(`if (kind === "${kind}")`);
    const next = directIntent.indexOf("\n  if (kind ===", start + 1);
    assert.match(directIntent.slice(start, next), /await resolveContentSecurityIntake\("image"\)/, kind);
  }
  for (const marker of [
    'url.pathname === "/api/users/me/avatar"',
    'url.pathname === "/api/session-reviews/photos"'
  ]) {
    const start = server.indexOf(marker);
    const segment = server.slice(start, start + 700);
    assert.match(segment, /await resolveContentSecurityIntake\("image"\)/, marker);
  }
  assert.doesNotMatch(server, /assertContentModerationIntake\(/);
});
