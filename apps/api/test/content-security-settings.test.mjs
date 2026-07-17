import assert from "node:assert/strict";
import test from "node:test";

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
  assert.equal(calls.some(([sql]) => sql.includes("content_security_settings_audit_logs")), true);
  assert.throws(() => normalizeContentSecuritySettings({ blockWhenUnavailable: "true" }));
});
