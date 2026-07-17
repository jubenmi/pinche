import assert from "node:assert/strict";
import test from "node:test";

import { config } from "../src/config/env.js";
import {
  formatSessionRescheduleTime,
  notifySessionRescheduled
} from "../src/modules/wechat/subscribe-message.js";
import { createWechatAccessTokenProvider } from "../src/modules/wechat/access-token.js";

test("formats canonical and offset times in Asia/Shanghai with day rollover", () => {
  assert.equal(formatSessionRescheduleTime("2026-07-13T10:00:00.000Z"), "2026-07-13 18:00:00");
  assert.equal(formatSessionRescheduleTime("2026-07-13T10:00:00+02:00"), "2026-07-13 16:00:00");
  assert.equal(formatSessionRescheduleTime("2026-07-13T18:30:00.000Z"), "2026-07-14 02:30:00");
});

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

test("missing openid skips before network access", async () => {
  const originalFetch = globalThis.fetch;
  const originalEnabled = config.subscribeMessage.enabled;
  const originalTemplate = config.subscribeMessage.sessionRescheduledTemplateId;
  globalThis.fetch = async () => {
    throw new Error("network must not be called");
  };
  config.subscribeMessage.enabled = true;
  config.subscribeMessage.sessionRescheduledTemplateId = "template";
  try {
    const result = await notifySessionRescheduled({ recipientOpenId: "" });
    assert.equal(result.skipped, true);
    assert.equal(result.reason, "openid_missing");
  } finally {
    config.subscribeMessage.enabled = originalEnabled;
    config.subscribeMessage.sessionRescheduledTemplateId = originalTemplate;
    globalThis.fetch = originalFetch;
  }
});

test("access-token requests use a bounded abort signal and are isolated from the default provider", async () => {
  const originals = {
    enabled: config.subscribeMessage.enabled,
    templateId: config.subscribeMessage.sessionRescheduledTemplateId,
    appId: config.wechat.appId,
    appSecret: config.wechat.appSecret,
    fetch: globalThis.fetch
  };
  config.subscribeMessage.enabled = true;
  config.subscribeMessage.sessionRescheduledTemplateId = "timeout-template";
  config.wechat.appId = "timeout-app";
  config.wechat.appSecret = "timeout-secret";
  let defaultFetchCalls = 0;
  let providerFetchCalls = 0;
  globalThis.fetch = async () => {
    defaultFetchCalls += 1;
    throw new Error("the default provider must not be used by this isolated test");
  };
  const tokenProvider = createWechatAccessTokenProvider({
    appId: config.wechat.appId,
    appSecret: config.wechat.appSecret,
    redis: null,
    fetchImpl: async (_url, options) => {
      providerFetchCalls += 1;
      assert.equal(options.signal instanceof AbortSignal, true);
      throw new DOMException("request timed out", "AbortError");
    }
  });
  try {
    await assert.rejects(
      notifySessionRescheduled(
        { recipientOpenId: "openid-timeout", sessionId: 42 },
        { tokenProvider, fetchImpl: globalThis.fetch }
      ),
      { code: "WECHAT_ACCESS_TOKEN_REQUEST_FAILED" }
    );
    assert.equal(providerFetchCalls, 1);
    assert.equal(defaultFetchCalls, 0);
  } finally {
    config.subscribeMessage.enabled = originals.enabled;
    config.subscribeMessage.sessionRescheduledTemplateId = originals.templateId;
    config.wechat.appId = originals.appId;
    config.wechat.appSecret = originals.appSecret;
    globalThis.fetch = originals.fetch;
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
    return { ok: true, json: async () => ({ errcode: 0, msgid: "message-id" }) };
  };
  const tokenProvider = { getAccessToken: async () => "token" };
  try {
    const result = await notifySessionRescheduled(
      {
        recipientOpenId: "openid-8",
        sessionId: 42,
        scriptName: "1234567890123456789🚗尾",
        oldStartAt: "2026-07-13T10:00:00.000Z",
        newStartAt: "2026-07-13T14:00:00.000Z"
      },
      { tokenProvider, fetchImpl: globalThis.fetch }
    );
    assert.equal(result.scene, "session_rescheduled");
    const body = JSON.parse(requests[0].options.body);
    assert.equal(requests[0].options.signal instanceof AbortSignal, true);
    assert.equal(body.template_id, "reschedule-template");
    assert.equal(body.page, "/pages/session/detail?id=42");
    assert.deepEqual(body.data, {
      thing1: { value: "1234567890123456789🚗" },
      date2: { value: "2026-07-13 18:00:00" },
      date3: { value: "2026-07-13 22:00:00" },
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

test("WeChat API errcode returns a failed result without exposing request configuration", async () => {
  const originals = {
    enabled: config.subscribeMessage.enabled,
    templateId: config.subscribeMessage.sessionRescheduledTemplateId,
    appId: config.wechat.appId,
    appSecret: config.wechat.appSecret,
    fetch: globalThis.fetch
  };
  config.subscribeMessage.enabled = true;
  config.subscribeMessage.sessionRescheduledTemplateId = "api-error-template";
  config.wechat.appId = "api-error-app";
  config.wechat.appSecret = "api-error-secret";
  globalThis.fetch = async (_url, options) => {
    assert.equal(options?.method, "POST");
    return { ok: true, json: async () => ({ errcode: 43101, errmsg: "user refuse" }) };
  };
  const tokenProvider = { getAccessToken: async () => "api-error-token" };
  try {
    const result = await notifySessionRescheduled(
      { recipientOpenId: "openid-error", sessionId: 42 },
      { tokenProvider, fetchImpl: globalThis.fetch }
    );
    assert.deepEqual(result, {
      ok: false,
      skipped: false,
      scene: "session_rescheduled",
      error: "user refuse",
      errorCode: 43101
    });
  } finally {
    config.subscribeMessage.enabled = originals.enabled;
    config.subscribeMessage.sessionRescheduledTemplateId = originals.templateId;
    config.wechat.appId = originals.appId;
    config.wechat.appSecret = originals.appSecret;
    globalThis.fetch = originals.fetch;
  }
});
