import assert from "node:assert/strict";
import test from "node:test";

import {
  WECHAT_CONTENT_SECURITY_REQUEST_TIMEOUT_LIMIT_MS,
  createWechatContentSecurityClient
} from "../src/modules/content-moderation/wechat-client.js";
import { classifyModerationError } from "../src/modules/content-moderation/retry.js";

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

test("content-security response body reading shares the request deadline and the configured ceiling stays within the lease budget", async () => {
  const client = createWechatContentSecurityClient({
    tokenProvider: createTokenProvider(),
    timeoutMs: 5,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      text: () => new Promise(() => {})
    })
  });

  await assert.rejects(
    Promise.race([
      client.checkText({ content: "private text", openid: "openid-deadline", scene: 2 }),
      new Promise((_, reject) => setTimeout(
        () => reject(new Error("content response body did not respect its deadline")),
        30
      ))
    ]),
    { code: "WECHAT_CONTENT_SECURITY_TIMEOUT" }
  );
  assert.throws(
    () => createWechatContentSecurityClient({
      tokenProvider: createTokenProvider(),
      timeoutMs: WECHAT_CONTENT_SECURITY_REQUEST_TIMEOUT_LIMIT_MS
    }),
    /shorter than the retry lease/
  );
});

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
      assert.equal(error.code, "WECHAT_CONTENT_SECURITY_RESPONSE_INVALID");
      const serialized = `${error.message}\n${JSON.stringify(error)}`;
      for (const secret of ["private text", "private-signature", "token-that-must-not-leak"]) {
        assert.equal(serialized.includes(secret), false);
      }
      return true;
    }
  );
});

test("content security exposes only safe retry taxonomy for network, provider, permission, and quota failures", async () => {
  const cases = [
    {
      name: "network",
      fetchImpl: async () => { throw new Error("socket reset while sending private text"); },
      code: "WECHAT_CONTENT_SECURITY_NETWORK_ERROR"
    },
    {
      name: "timeout",
      fetchImpl: async () => { throw Object.assign(new Error("request timed out"), { name: "AbortError" }); },
      code: "WECHAT_CONTENT_SECURITY_TIMEOUT"
    },
    {
      name: "rate limited",
      fetchImpl: async () => jsonResponse({ errcode: -1, errmsg: "private provider diagnostic" }, 429),
      code: "WECHAT_CONTENT_SECURITY_RATE_LIMITED"
    },
    {
      name: "upstream 5xx",
      fetchImpl: async () => jsonResponse({ errcode: -1, errmsg: "private provider diagnostic" }, 503),
      code: "WECHAT_CONTENT_SECURITY_UPSTREAM_5XX"
    },
    {
      name: "expired token after the mandatory one refresh",
      fetchImpl: async () => jsonResponse({ errcode: 40001, errmsg: "invalid token" }),
      code: "WECHAT_CONTENT_SECURITY_TOKEN_INVALID"
    },
    {
      name: "permission denied",
      fetchImpl: async () => jsonResponse({ errcode: 48001, errmsg: "not authorized" }),
      code: "WECHAT_CONTENT_SECURITY_PERMISSION_DENIED"
    },
    {
      name: "quota exhausted",
      fetchImpl: async () => jsonResponse({ errcode: 45009, errmsg: "quota exhausted" }),
      code: "WECHAT_CONTENT_SECURITY_QUOTA_EXHAUSTED"
    }
  ];

  for (const entry of cases) {
    const client = createWechatContentSecurityClient({
      tokenProvider: createTokenProvider(["token-one", "token-two"]),
      fetchImpl: entry.fetchImpl
    });
    await assert.rejects(
      client.checkText({ content: "private text", openid: "openid-6", scene: 2 }),
      (error) => {
        assert.equal(error.code, entry.code, entry.name);
        assert.equal(`${error.message}\n${JSON.stringify(error)}`.includes("private text"), false);
        return true;
      }
    );
  }
});

test("non-JSON WeChat 429 and 5xx responses keep their retryable status taxonomy", async () => {
  for (const [status, code] of [[429, "WECHAT_CONTENT_SECURITY_RATE_LIMITED"], [503, "WECHAT_CONTENT_SECURITY_UPSTREAM_5XX"]]) {
    const client = createWechatContentSecurityClient({
      tokenProvider: createTokenProvider(),
      fetchImpl: async () => new Response("<html>private upstream diagnostic</html>", { status })
    });

    await assert.rejects(
      client.checkText({ content: "private text", openid: "openid-7", scene: 2 }),
      (error) => {
        assert.equal(error.code, code);
        assert.equal(classifyModerationError(error).retryable, true);
        assert.equal(`${error.message}\n${JSON.stringify(error)}`.includes("private upstream diagnostic"), false);
        return true;
      }
    );
  }
});

test("access-token infrastructure failures map into retryable high-alert content-security taxonomy", async () => {
  for (const accessTokenCode of [
    "WECHAT_ACCESS_TOKEN_REQUEST_FAILED",
    "WECHAT_ACCESS_TOKEN_CACHE_UNAVAILABLE",
    "WECHAT_ACCESS_TOKEN_REFRESH_IN_PROGRESS",
    "WECHAT_ACCESS_TOKEN_LOCK_LOST"
  ]) {
    const client = createWechatContentSecurityClient({
      tokenProvider: {
        async getAccessToken() {
          throw Object.assign(new Error("private token infrastructure diagnostic"), { code: accessTokenCode });
        }
      },
      fetchImpl: async () => assert.fail("token infrastructure failure must stop before the provider request")
    });

    await assert.rejects(
      client.checkText({ content: "private text", openid: "openid-8", scene: 2 }),
      (error) => {
        assert.equal(error.code, "WECHAT_CONTENT_SECURITY_TOKEN_UNAVAILABLE", accessTokenCode);
        assert.equal(classifyModerationError(error).retryable, true, accessTokenCode);
        assert.equal(classifyModerationError(error).alert, true, accessTokenCode);
        assert.equal(`${error.message}\n${JSON.stringify(error)}`.includes("private token infrastructure diagnostic"), false);
        return true;
      }
    );
  }
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
