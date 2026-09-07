import test from "node:test";
import assert from "node:assert/strict";
import { notifySignupCreated, notifySignupReviewed } from "../src/modules/wechat/subscribe-message.js";
import { config } from "../src/config/env.js";

for (const notify of [notifySignupCreated, notifySignupReviewed]) {
  test(`${notify.name} sends Beijing date text for the driver's Date object`, async (t) => {
    const original = { ...config.subscribeMessage };
    config.subscribeMessage.signupCreatedTemplateId = "test-template";
    config.subscribeMessage.signupReviewedTemplateId = "test-template";
    t.after(() => Object.assign(config.subscribeMessage, original));
    let sent;
    const result = await notify({
      organizerOpenId: "test-organizer", applicantOpenId: "test-applicant",
      sessionId: 1, startAt: new Date("2026-09-07T16:30:00.000Z")
    }, {
      runtimeConfig: { nodeEnv: "test", subscribeMessage: { enabled: true }, wechat: { appId: "test", appSecret: "test" } },
      tokenProvider: { getAccessToken: async () => "test-token", invalidate: async () => {} },
      fetchImpl: async (_url, options) => {
        sent = JSON.parse(options.body);
        return { ok: true, json: async () => ({ errcode: 0 }) };
      }
    });
    assert.equal(result.ok, true);
    assert.equal(sent?.data.date4.value, "2026-09-08 00:30:00");
  });
}
