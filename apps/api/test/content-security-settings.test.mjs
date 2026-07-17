import assert from "node:assert/strict";
import test from "node:test";

import * as contentSecuritySettings from "../src/modules/content-moderation/content-security-settings.js";
import {
  defaultContentSecuritySettings,
  normalizeContentSecuritySettings,
  updateContentSecuritySettings
} from "../src/modules/content-moderation/content-security-settings.js";

test("content security settings default to legacy-compatible direct publication", () => {
  assert.deepEqual(defaultContentSecuritySettings(), {
    blockWhenUnavailable: false,
    blockImageWhenUnavailable: false,
    blockVideoWhenUnavailable: false,
    blockTextWhenUnavailable: false
  });
});

test("content security settings accept exactly four booleans and audit the transition", async () => {
  const calls = [];
  const connection = {
    async query(sql, params = []) {
      calls.push([sql, params]);
      if (sql.includes("FOR UPDATE")) return [[{
        block_when_unavailable: 0,
        block_image_when_unavailable: 0,
        block_video_when_unavailable: 0,
        block_text_when_unavailable: 0
      }]];
      return [[]];
    }
  };
  const result = await updateContentSecuritySettings(connection, 7, {
    blockWhenUnavailable: true,
    blockImageWhenUnavailable: true,
    blockVideoWhenUnavailable: false,
    blockTextWhenUnavailable: true
  });
  assert.equal(result.blockImageWhenUnavailable, true);
  assert.match(calls[0][0], /SELECT \* FROM content_security_settings WHERE id = 1 FOR UPDATE/);
  assert.match(calls[1][0], /UPDATE content_security_settings/);
  assert.equal(calls.some(([sql]) => sql.includes("content_security_settings_audit_logs")), true);
  assert.throws(() => normalizeContentSecuritySettings({ blockWhenUnavailable: "true" }));
});

test("the persisted intake resolver reads the latest settings for every publication decision", async () => {
  assert.equal(
    typeof contentSecuritySettings.createContentSecurityIntakeResolver,
    "function",
    "a reusable asynchronous persisted-settings resolver must exist"
  );
  let row = {
    block_when_unavailable: 0,
    block_image_when_unavailable: 0,
    block_video_when_unavailable: 0,
    block_text_when_unavailable: 0
  };
  let reads = 0;
  const connection = {
    async query(sql) {
      assert.match(sql, /FROM content_security_settings/);
      reads += 1;
      return [[row]];
    }
  };
  const resolveIntake = contentSecuritySettings.createContentSecurityIntakeResolver({
    moderationConfig: {
      enabled: false,
      textIntakeMode: "legacy",
      imageIntakeMode: "legacy",
      videoIntakeMode: "legacy",
      wechatTextEnabled: false,
      wechatImageEnabled: false,
      tencentVideoEnabled: false
    },
    withDatabaseConnection: async (run) => run(connection)
  });

  for (const [type, column] of [
    ["image", "block_image_when_unavailable"],
    ["video", "block_video_when_unavailable"],
    ["text", "block_text_when_unavailable"]
  ]) {
    row = {
      block_when_unavailable: 0,
      block_image_when_unavailable: 0,
      block_video_when_unavailable: 0,
      block_text_when_unavailable: 0
    };
    assert.equal((await resolveIntake(type)).moderationRequired, false);
    row = { ...row, block_when_unavailable: 1, [column]: 1 };
    await assert.rejects(resolveIntake(type), {
      code: "CONTENT_MODERATION_INTAKE_CLOSED",
      statusCode: 503
    });
  }
  assert.equal(reads, 6, "each decision must re-read the row instead of caching it");
});

test("the persisted intake resolver locks settings on the caller transaction connection", async () => {
  const queries = [];
  const transactionConnection = {
    async query(sql) {
      queries.push(sql);
      return [[{
        block_when_unavailable: 0,
        block_image_when_unavailable: 0,
        block_video_when_unavailable: 0,
        block_text_when_unavailable: 0
      }]];
    }
  };
  const resolveIntake = contentSecuritySettings.createContentSecurityIntakeResolver({
    moderationConfig: {
      enabled: false,
      imageIntakeMode: "legacy",
      wechatTextEnabled: false,
      wechatImageEnabled: false,
      tencentVideoEnabled: false
    },
    withDatabaseConnection: async () => {
      throw new Error("must reuse the business transaction connection");
    }
  });

  assert.equal((await resolveIntake("image", { connection: transactionConnection })).moderationRequired, false);
  assert.equal(queries.length, 1);
  assert.match(queries[0], /FOR UPDATE/);
});

test("fallback blocking requires both persisted switches while capability always wins", async () => {
  assert.equal(typeof contentSecuritySettings.createContentSecurityIntakeResolver, "function");
  let row = {
    block_when_unavailable: 1,
    block_image_when_unavailable: 0,
    block_video_when_unavailable: 0,
    block_text_when_unavailable: 0
  };
  const connection = { async query() { return [[row]]; } };
  const moderationConfig = {
    enabled: false,
    textIntakeMode: "legacy",
    imageIntakeMode: "legacy",
    videoIntakeMode: "legacy",
    wechatTextEnabled: false,
    wechatImageEnabled: false,
    tencentVideoEnabled: false
  };
  const resolveIntake = contentSecuritySettings.createContentSecurityIntakeResolver({
    moderationConfig,
    withDatabaseConnection: async (run) => run(connection)
  });

  assert.equal((await resolveIntake("image")).mode, "legacy");
  row = { ...row, block_image_when_unavailable: 1 };
  await assert.rejects(resolveIntake("image"), { code: "CONTENT_MODERATION_INTAKE_CLOSED" });

  moderationConfig.enabled = true;
  for (const [type, providerKey] of [
    ["image", "wechatImageEnabled"],
    ["video", "tencentVideoEnabled"],
    ["text", "wechatTextEnabled"]
  ]) {
    moderationConfig[providerKey] = true;
    assert.deepEqual(await resolveIntake(type), {
      accepting: true,
      mode: "moderated",
      moderationRequired: true,
      reason: "ready"
    });
    moderationConfig[providerKey] = false;
  }
});

test("legacy closed modes cannot override the D46 capability and persisted fallback policy", async () => {
  let row = {
    block_when_unavailable: 0,
    block_image_when_unavailable: 0,
    block_video_when_unavailable: 0,
    block_text_when_unavailable: 0
  };
  const connection = { async query() { return [[row]]; } };
  const moderationConfig = {
    enabled: true,
    textIntakeMode: "closed",
    imageIntakeMode: "closed",
    videoIntakeMode: "closed",
    wechatTextEnabled: false,
    wechatImageEnabled: true,
    tencentVideoEnabled: false
  };
  const resolveIntake = contentSecuritySettings.createContentSecurityIntakeResolver({
    moderationConfig,
    withDatabaseConnection: async (run) => run(connection)
  });

  assert.deepEqual(await resolveIntake("image"), {
    accepting: true,
    mode: "moderated",
    moderationRequired: true,
    reason: "ready"
  });

  moderationConfig.wechatImageEnabled = false;
  assert.deepEqual(await resolveIntake("image"), {
    accepting: true,
    mode: "legacy",
    moderationRequired: false,
    reason: "legacy"
  });

  row = { ...row, block_when_unavailable: 1, block_image_when_unavailable: 1 };
  await assert.rejects(resolveIntake("image"), {
    code: "CONTENT_MODERATION_INTAKE_CLOSED",
    statusCode: 503
  });
});
