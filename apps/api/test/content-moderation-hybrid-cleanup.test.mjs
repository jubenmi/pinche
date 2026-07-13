import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { buildContentModerationConfig } from "../src/config/env.js";
import { MODERATION_PROVIDERS } from "../src/modules/content-moderation/constants.js";

const root = new URL("../../../", import.meta.url);
const read = (path) => fs.readFileSync(new URL(path, root), "utf8");

test("hybrid moderation exposes only WeChat and Tencent video providers", () => {
  assert.deepEqual(MODERATION_PROVIDERS, ["wechat_sec_check", "tencent_ci_video"]);
});

test("hybrid moderation config contains no Tencent text or image policy", () => {
  const config = buildContentModerationConfig({
    CONTENT_MODERATION_WECHAT_TEXT_ENABLED: "true",
    CONTENT_MODERATION_WECHAT_IMAGE_ENABLED: "true",
    CONTENT_MODERATION_TENCENT_VIDEO_ENABLED: "true",
    TENCENT_CI_VIDEO_BIZ_TYPE: "video-policy"
  });
  assert.equal(config.wechatTextEnabled, true);
  assert.equal(config.wechatImageEnabled, true);
  assert.equal(config.tencentVideoEnabled, true);
  assert.equal(config.tencentVideoPolicyId, "video-policy");
  assert.equal("textPolicyId" in config, false);
  assert.equal("imagePolicyId" in config, false);
});

test("production configuration and runtime contain no legacy Tencent text/image audit", () => {
  const sources = [
    read(".env.production.example"),
    read("scripts/check-api-env.js"),
    read("apps/api/src/config/env.js"),
    read("apps/api/src/modules/content-moderation/tencent-video-client.js"),
    read("apps/api/src/modules/content-moderation/service.js"),
    read("apps/api/src/server.js"),
    read("apps/api/src/jobs/content-moderation-retry.js")
  ].join("\n");
  for (const legacy of [
    "TENCENT_TMS_BIZ_TYPE",
    "TENCENT_CI_IMAGE_BIZ_TYPE",
    "tencent_tms",
    "submitImage"
  ]) {
    assert.equal(sources.includes(legacy), false, `legacy moderation token remains: ${legacy}`);
  }
});
