import assert from "node:assert/strict";
import test from "node:test";

import { createWechatContentSecurityClient } from "../src/modules/content-moderation/wechat-client.js";

function createTokenProvider(tokens = ["access-token"]) {
  const getCalls = [];
  const invalidated = [];
  let index = 0;
  return {
    getCalls,
    invalidated,
    async getAccessToken(options) {
      getCalls.push(options ?? null);
      const token = tokens[Math.min(index, tokens.length - 1)];
      index += 1;
      return token;
    },
    async invalidate(token) {
      invalidated.push(token);
    }
  };
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" }
  });
}

test("msgSecCheck submits the required text payload and returns a safe normalized result", async () => {
  const calls = [];
  const tokenProvider = createTokenProvider();
  const client = createWechatContentSecurityClient({
    tokenProvider,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return jsonResponse({
        errcode: 0,
        result: { suggest: "pass", label: "100", score: 88 }
      });
    }
  });

  const result = await client.checkText({
    content: "[note] 不应出现在返回值中",
    openid: "openid-1",
    scene: 4
  });

  assert.deepEqual(JSON.parse(calls[0].options.body), {
    content: "[note] 不应出现在返回值中",
    version: 2,
    openid: "openid-1",
    scene: 4
  });
  assert.equal(new URL(calls[0].url).pathname, "/wxa/msg_sec_check");
  assert.equal(new URL(calls[0].url).searchParams.get("access_token"), "access-token");
  assert.deepEqual(result, { suggestion: "pass", label: "100", score: 88 });
  assert.equal(JSON.stringify(result).includes("不应出现在返回值中"), false);
  assert.equal(JSON.stringify(result).includes("access-token"), false);
});

test("mediaCheckAsync always submits image media_type 2 and returns only trace id", async () => {
  const calls = [];
  const client = createWechatContentSecurityClient({
    tokenProvider: createTokenProvider(),
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return jsonResponse({ errcode: 0, trace_id: "wechat-trace-1" });
    }
  });
  const mediaUrl = "https://private.example.com/object.jpg?signature=do-not-return";

  const result = await client.checkImage({ mediaUrl, openid: "openid-2", scene: 1 });

  assert.equal(new URL(calls[0].url).pathname, "/wxa/media_check_async");
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    media_url: mediaUrl,
    media_type: 2,
    version: 2,
    openid: "openid-2",
    scene: 1
  });
  assert.deepEqual(result, { traceId: "wechat-trace-1" });
  assert.equal(JSON.stringify(result).includes("signature"), false);
});

test("content security client retries once after a WeChat token-invalid response", async () => {
  const tokenProvider = createTokenProvider(["expired-token", "fresh-token"]);
  let callCount = 0;
  const client = createWechatContentSecurityClient({
    tokenProvider,
    fetchImpl: async () => {
      callCount += 1;
      return callCount === 1
        ? jsonResponse({ errcode: 40001, errmsg: "invalid credential" })
        : jsonResponse({ errcode: 0, result: { suggest: "review", label: "200", score: 45 } });
    }
  });

  const result = await client.checkText({ content: "content", openid: "openid-3", scene: 2 });

  assert.deepEqual(result, { suggestion: "review", label: "200", score: 45 });
  assert.equal(callCount, 2);
  assert.deepEqual(tokenProvider.invalidated, ["expired-token"]);
  assert.deepEqual(tokenProvider.getCalls, [null, { forceRefresh: true }]);
});

test("content security failures redact submitted text, URLs and access tokens", async () => {
  const client = createWechatContentSecurityClient({
    tokenProvider: createTokenProvider(["token-that-must-not-leak"]),
    fetchImpl: async () => jsonResponse({
      errcode: 87014,
      errmsg: "private text https://private.example.com/?signature=private-signature"
    })
  });

  await assert.rejects(
    client.checkText({ content: "private text", openid: "openid-4", scene: 2 }),
    (error) => {
      assert.equal(error.code, "WECHAT_CONTENT_SECURITY_REQUEST_FAILED");
      const serialized = `${error.message}\n${JSON.stringify(error)}`;
      for (const secret of ["private text", "private-signature", "token-that-must-not-leak"]) {
        assert.equal(serialized.includes(secret), false);
      }
      return true;
    }
  );
});

test("content security rejects unknown text suggestions instead of treating them as pass", async () => {
  const client = createWechatContentSecurityClient({
    tokenProvider: createTokenProvider(),
    fetchImpl: async () => jsonResponse({ errcode: 0, result: { suggest: "unknown" } })
  });

  await assert.rejects(
    client.checkText({ content: "text", openid: "openid-5", scene: 2 }),
    { code: "WECHAT_CONTENT_SECURITY_RESPONSE_INVALID" }
  );
});
