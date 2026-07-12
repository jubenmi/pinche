import assert from "node:assert/strict";
import test from "node:test";

import { config } from "../src/config/env.js";
import { notifySessionRescheduled } from "../src/modules/wechat/subscribe-message.js";

test("disabled reschedule messaging skips without network access", async () => {
  const originalFetch = globalThis.fetch;
  const originalEnabled = config.subscribeMessage.enabled;
  globalThis.fetch = async () => {
    throw new Error("network must not be called");
  };
  config.subscribeMessage.enabled = false;
  try {
    assert.deepEqual(await notifySessionRescheduled({ recipientOpenId: "openid-8" }), {
      ok: true,
      skipped: true,
      scene: "session_rescheduled",
      reason: "disabled"
    });
  } finally {
    config.subscribeMessage.enabled = originalEnabled;
    globalThis.fetch = originalFetch;
  }
});

test("reschedule messaging uses its dedicated template fields and detail page", async () => {
  const originals = {
    enabled: config.subscribeMessage.enabled,
    templateId: config.subscribeMessage.sessionRescheduledTemplateId,
    appId: config.wechat.appId,
    appSecret: config.wechat.appSecret,
    fetch: globalThis.fetch
  };
  const requests = [];
  config.subscribeMessage.enabled = true;
  config.subscribeMessage.sessionRescheduledTemplateId = "reschedule-template";
  config.wechat.appId = "app-id";
  config.wechat.appSecret = "app-secret";
  globalThis.fetch = async (url, options) => {
    requests.push({ url: String(url), options });
    if (requests.length === 1) {
      return { ok: true, json: async () => ({ access_token: "token", expires_in: 7200 }) };
    }
    return { ok: true, json: async () => ({ errcode: 0, msgid: "message-id" }) };
  };
  try {
    const result = await notifySessionRescheduled({
      recipientOpenId: "openid-8",
      sessionId: 42,
      scriptName: "剧本甲",
      oldStartAt: "2026-07-13T10:00:00.000Z",
      newStartAt: "2026-07-13T14:00:00.000Z"
    });
    assert.equal(result.scene, "session_rescheduled");
    const body = JSON.parse(requests[1].options.body);
    assert.equal(body.template_id, "reschedule-template");
    assert.equal(body.page, "/pages/session/detail?id=42");
    assert.deepEqual(body.data, {
      thing1: { value: "剧本甲" },
      date2: { value: "2026-07-13 10:00:00" },
      date3: { value: "2026-07-13 14:00:00" },
      phrase4: { value: "车局已改期" }
    });
  } finally {
    config.subscribeMessage.enabled = originals.enabled;
    config.subscribeMessage.sessionRescheduledTemplateId = originals.templateId;
    config.wechat.appId = originals.appId;
    config.wechat.appSecret = originals.appSecret;
    globalThis.fetch = originals.fetch;
  }
});
