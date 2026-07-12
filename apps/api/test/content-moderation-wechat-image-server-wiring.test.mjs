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
  assert.match(server, /SELECT open_id FROM users WHERE id = \? LIMIT 1/);
  assert.match(server, /buildWechatImageModerationUrl\(/);
  assert.equal(uploads.includes("mediaUrl:"), false, "the signed URL must not enter an API response");
});
