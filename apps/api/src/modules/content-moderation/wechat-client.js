import {
  getWechatAccessTokenProvider,
  requestWithWechatAccessTokenRetry
} from "../wechat/access-token.js";

const API_BASE_URL = "https://api.weixin.qq.com";
const MAX_RESPONSE_BYTES = 64 * 1024;
const TEXT_SUGGESTIONS = new Set(["pass", "review", "risky"]);

function required(value, name) {
  const text = String(value || "").trim();
  if (!text) throw new TypeError(`${name} is required`);
  return text;
}

function validScene(value) {
  const scene = Number(value);
  if (!Number.isInteger(scene) || scene < 1 || scene > 4) {
    throw new TypeError("scene must be an integer from 1 to 4");
  }
  return scene;
}

function sanitizedError(code, message, statusCode) {
  const error = new Error(message);
  error.code = code;
  if (Number.isInteger(statusCode)) error.statusCode = statusCode;
  return error;
}

function cleanString(value, maxLength) {
  return String(value || "").trim().slice(0, maxLength);
}

function cleanScore(value) {
  const score = Number(value);
  return Number.isFinite(score) ? Math.max(0, Math.min(100, Math.round(score))) : null;
}

async function readJson(response) {
  let body = "";
  try {
    body = await response.text();
  } catch {
    throw sanitizedError("WECHAT_CONTENT_SECURITY_REQUEST_FAILED", "WeChat content security request failed");
  }
  if (Buffer.byteLength(body, "utf8") > MAX_RESPONSE_BYTES) {
    throw sanitizedError(
      "WECHAT_CONTENT_SECURITY_RESPONSE_INVALID",
      "WeChat content security response is invalid",
      response.status
    );
  }
  try {
    return JSON.parse(body);
  } catch {
    throw sanitizedError(
      "WECHAT_CONTENT_SECURITY_RESPONSE_INVALID",
      "WeChat content security response is invalid",
      response.status
    );
  }
}

function requestUrl(path, accessToken) {
  const url = new URL(path, API_BASE_URL);
  url.searchParams.set("access_token", accessToken);
  return url;
}

async function callWechatApi({ fetchImpl, path, body, accessToken }) {
  let response;
  try {
    response = await fetchImpl(requestUrl(path, accessToken), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    });
  } catch {
    throw sanitizedError("WECHAT_CONTENT_SECURITY_REQUEST_FAILED", "WeChat content security request failed");
  }
  return { response, payload: await readJson(response) };
}

async function requestSuccess({ tokenProvider, fetchImpl, path, body }) {
  const result = await requestWithWechatAccessTokenRetry({
    tokenProvider,
    request: (accessToken) => callWechatApi({ fetchImpl, path, body, accessToken })
  });
  if (!result.response.ok || Number(result.payload?.errcode || 0) !== 0) {
    throw sanitizedError(
      "WECHAT_CONTENT_SECURITY_REQUEST_FAILED",
      "WeChat content security request failed",
      result.response.status
    );
  }
  return result.payload;
}

export function createWechatContentSecurityClient({
  tokenProvider = getWechatAccessTokenProvider(),
  fetchImpl = globalThis.fetch
} = {}) {
  if (!tokenProvider || typeof tokenProvider.getAccessToken !== "function") {
    throw new TypeError("tokenProvider.getAccessToken is required");
  }
  if (typeof fetchImpl !== "function") throw new TypeError("fetch implementation is required");

  return {
    async checkText({ content, openid, scene } = {}) {
      const payload = await requestSuccess({
        tokenProvider,
        fetchImpl,
        path: "/wxa/msg_sec_check",
        body: {
          content: required(content, "content"),
          version: 2,
          openid: required(openid, "openid"),
          scene: validScene(scene)
        }
      });
      const result = payload?.result && typeof payload.result === "object" ? payload.result : {};
      const suggestion = cleanString(result.suggest, 32).toLowerCase();
      if (!TEXT_SUGGESTIONS.has(suggestion)) {
        throw sanitizedError(
          "WECHAT_CONTENT_SECURITY_RESPONSE_INVALID",
          "WeChat content security response is invalid"
        );
      }
      return {
        suggestion,
        label: cleanString(result.label, 64),
        score: cleanScore(result.score)
      };
    },
    async checkImage({ mediaUrl, openid, scene } = {}) {
      const payload = await requestSuccess({
        tokenProvider,
        fetchImpl,
        path: "/wxa/media_check_async",
        body: {
          media_url: required(mediaUrl, "mediaUrl"),
          media_type: 2,
          version: 2,
          openid: required(openid, "openid"),
          scene: validScene(scene)
        }
      });
      const traceId = cleanString(payload?.trace_id, 128);
      if (!traceId) {
        throw sanitizedError(
          "WECHAT_CONTENT_SECURITY_RESPONSE_INVALID",
          "WeChat content security response is invalid"
        );
      }
      return { traceId };
    }
  };
}
