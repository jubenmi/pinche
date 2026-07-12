import {
  getWechatAccessTokenProvider,
  requestWithWechatAccessTokenRetry
} from "../wechat/access-token.js";

const API_BASE_URL = "https://api.weixin.qq.com";
const MAX_RESPONSE_BYTES = 64 * 1024;
// Two bounded content requests plus three bounded token-cache operations keep
// the token-invalid path under one 90-second initial moderation lease.
export const WECHAT_CONTENT_SECURITY_REQUEST_TIMEOUT_LIMIT_MS = 20_000;
const TEXT_SUGGESTIONS = new Set(["pass", "review", "risky"]);
const WECHAT_TOKEN_ERRORS = new Set([40001, 40014, 42001]);
const WECHAT_PERMISSION_ERRORS = new Set([48001, 87013]);
const WECHAT_QUOTA_ERRORS = new Set([45009, 45010, 45011]);
const WECHAT_ACCESS_TOKEN_INFRASTRUCTURE_ERRORS = new Set([
  "WECHAT_ACCESS_TOKEN_REQUEST_FAILED",
  "WECHAT_ACCESS_TOKEN_CACHE_UNAVAILABLE",
  "WECHAT_ACCESS_TOKEN_REFRESH_IN_PROGRESS",
  "WECHAT_ACCESS_TOKEN_LOCK_LOST"
]);

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

function createRequestDeadline(timeoutMs) {
  const controller = new AbortController();
  const timeoutError = sanitizedError(
    "WECHAT_CONTENT_SECURITY_TIMEOUT",
    "WeChat content security request failed"
  );
  let timeoutId = null;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      controller.abort(timeoutError);
      reject(timeoutError);
    }, timeoutMs);
  });
  return {
    signal: controller.signal,
    isTimeout(error) {
      return error === timeoutError;
    },
    run(operation) {
      if (controller.signal.aborted) {
        const aborted = Promise.reject(timeoutError);
        aborted.catch(() => {});
        return aborted;
      }
      const operationPromise = Promise.resolve().then(() => {
        if (controller.signal.aborted) throw timeoutError;
        return operation();
      });
      operationPromise.catch(() => {});
      const raced = Promise.race([operationPromise, timeout]);
      raced.catch(() => {});
      return raced;
    },
    close() {
      if (timeoutId !== null) clearTimeout(timeoutId);
    }
  };
}

async function readJson(response, deadline) {
  let body = "";
  try {
    body = await deadline.run(() => response.text());
  } catch (error) {
    if (deadline.isTimeout(error)) throw error;
    throw sanitizedError("WECHAT_CONTENT_SECURITY_NETWORK_ERROR", "WeChat content security request failed");
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

async function callWechatApi({ fetchImpl, path, body, accessToken, timeoutMs }) {
  const deadline = createRequestDeadline(timeoutMs);
  try {
    const response = await deadline.run(() => fetchImpl(requestUrl(path, accessToken), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: deadline.signal
    }));
    // Rate-limit and upstream-status classification must win over parsing: many
    // gateways return HTML/plaintext diagnostic bodies for these statuses.
    if (Number(response.status) === 429 || (response.status >= 500 && response.status <= 599)) {
      return { response, payload: null };
    }
    return { response, payload: await readJson(response, deadline) };
  } catch (error) {
    const code = deadline.isTimeout(error) || deadline.signal.aborted ||
      ["AbortError", "TimeoutError"].includes(error?.name)
      ? "WECHAT_CONTENT_SECURITY_TIMEOUT"
      : "WECHAT_CONTENT_SECURITY_NETWORK_ERROR";
    throw sanitizedError(code, "WeChat content security request failed");
  } finally {
    deadline.close();
  }
}

function responseError({ response, payload }) {
  const status = Number(response?.status || 0);
  if (status === 429) {
    return sanitizedError("WECHAT_CONTENT_SECURITY_RATE_LIMITED", "WeChat content security request failed", status);
  }
  if (status >= 500 && status <= 599) {
    return sanitizedError("WECHAT_CONTENT_SECURITY_UPSTREAM_5XX", "WeChat content security request failed", status);
  }
  const errcode = Number(payload?.errcode);
  if (WECHAT_TOKEN_ERRORS.has(errcode)) {
    return sanitizedError("WECHAT_CONTENT_SECURITY_TOKEN_INVALID", "WeChat content security request failed", status);
  }
  if (WECHAT_PERMISSION_ERRORS.has(errcode)) {
    return sanitizedError("WECHAT_CONTENT_SECURITY_PERMISSION_DENIED", "WeChat content security request failed", status);
  }
  if (WECHAT_QUOTA_ERRORS.has(errcode)) {
    return sanitizedError("WECHAT_CONTENT_SECURITY_QUOTA_EXHAUSTED", "WeChat content security request failed", status);
  }
  return sanitizedError("WECHAT_CONTENT_SECURITY_RESPONSE_INVALID", "WeChat content security response is invalid", status);
}

async function requestSuccess({ tokenProvider, fetchImpl, path, body, timeoutMs, emit, subjectType }) {
  let result;
  try {
    result = await requestWithWechatAccessTokenRetry({
      tokenProvider,
      request: (accessToken) => callWechatApi({ fetchImpl, path, body, accessToken, timeoutMs })
    });
  } catch (error) {
    if (WECHAT_ACCESS_TOKEN_INFRASTRUCTURE_ERRORS.has(String(error?.code || ""))) {
      try {
        emit("moderation_token_refresh_failure", {
          provider: "wechat_sec_check",
          ...(subjectType ? { subjectType } : {}),
          outcome: "error",
          errorCode: "WECHAT_CONTENT_SECURITY_TOKEN_UNAVAILABLE",
          priority: "high"
        });
      } catch {
        // A telemetry sink must not turn an operational retry into a new failure mode.
      }
      throw sanitizedError("WECHAT_CONTENT_SECURITY_TOKEN_UNAVAILABLE", "WeChat content security request failed");
    }
    throw error;
  }
  if (!result.response.ok || Number(result.payload?.errcode || 0) !== 0) {
    throw responseError(result);
  }
  return result.payload;
}

export function createWechatContentSecurityClient({
  tokenProvider = getWechatAccessTokenProvider(),
  fetchImpl = globalThis.fetch,
  timeoutMs = 10_000,
  emit = () => {}
} = {}) {
  if (!tokenProvider || typeof tokenProvider.getAccessToken !== "function") {
    throw new TypeError("tokenProvider.getAccessToken is required");
  }
  if (typeof fetchImpl !== "function") throw new TypeError("fetch implementation is required");
  if (typeof emit !== "function") throw new TypeError("emit must be a function");
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 ||
    timeoutMs >= WECHAT_CONTENT_SECURITY_REQUEST_TIMEOUT_LIMIT_MS) {
    throw new TypeError("timeoutMs must be a positive duration shorter than the retry lease");
  }

  return {
    async checkText({ content, openid, scene, subjectType } = {}) {
      const payload = await requestSuccess({
        tokenProvider,
        fetchImpl,
        emit,
        subjectType,
        path: "/wxa/msg_sec_check",
        timeoutMs,
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
    async checkImage({ mediaUrl, openid, scene, subjectType } = {}) {
      const payload = await requestSuccess({
        tokenProvider,
        fetchImpl,
        emit,
        subjectType,
        path: "/wxa/media_check_async",
        timeoutMs,
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
