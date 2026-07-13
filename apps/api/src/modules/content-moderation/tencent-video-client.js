import { buildCosAuthorization } from "../../storage/cos.js";

// Tencent CI documents Average mode as evenly distributing Count screenshots
// across the whole video. 100 is a conservative documented Count value that
// preserves coverage without using the SDK example's higher 1000-frame count.
export const TENCENT_VIDEO_AUDIT_AVERAGE_SNAPSHOT_COUNT = 100;

const ACCEPTED_SUBMISSION_STATES = new Set([
  "Submitted",
  "Snapshoting",
  "Auditing",
  "Success"
]);
const VIDEO_SOURCE_OBJECT_KEY = /^uploads\/session-album\/videos\/source\/[A-Za-z0-9._-]+\.mp4$/;
const TENCENT_OPERATIONAL_ERROR_PREFIXES = Object.freeze([
  ["AuthFailure", "AuthFailure"],
  ["UnauthorizedOperation", "UnauthorizedOperation"],
  ["InvalidParameter.BizType", "InvalidParameter.BizType"],
  ["LimitExceeded", "LimitExceeded"],
  ["RequestLimitExceeded", "TENCENT_CI_VIDEO_RATE_LIMITED"],
  ["ResourceUnavailable", "ResourceUnavailable"],
  ["FailedOperation.BalanceNotEnough", "FailedOperation.BalanceNotEnough"]
]);
const SAFE_TRANSPORT_ERROR_CODES = new Set([
  "CONTENT_MODERATION_RESPONSE_TOO_LARGE",
  "CONTENT_MODERATION_UPSTREAM_RESPONSE_INVALID"
]);

function configurationError(message) {
  const error = new Error(message);
  error.code = "CONTENT_MODERATION_CONFIGURATION_ERROR";
  return error;
}

function required(value, name) {
  const text = String(value || "").trim();
  if (!text) throw new TypeError(`${name} is required`);
  return text;
}

function requiredVideoSourceObjectKey(value) {
  const objectKey = required(value, "objectKey");
  if (!VIDEO_SOURCE_OBJECT_KEY.test(objectKey)) {
    throw new TypeError("Tencent video moderation requires a session album video source object");
  }
  return objectKey;
}

export function validateTencentVideoSourceObjectKey(value) {
  return requiredVideoSourceObjectKey(value);
}

export function validateProductionPreflightVideoObjectKey(runId, objectKey) {
  const expected = `system/content-moderation-preflight/${runId}/video-v1.mp4`;
  if (objectKey !== expected) {
    throw new TypeError("invalid production preflight video object key");
  }
  return true;
}

function xml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function xmlTag(source, name) {
  const match = String(source).match(new RegExp(`<${name}>([\\s\\S]*?)<\\/${name}>`, "i"));
  return match?.[1] || "";
}

function callbackWithToken(callbackUrl, callbackToken) {
  const url = new URL(required(callbackUrl, "tencentVideoCallbackUrl"));
  url.searchParams.set("token", required(callbackToken, "tencentVideoCallbackToken"));
  return url.toString();
}

function transportError(statusCode, code = "CONTENT_MODERATION_UPSTREAM_ERROR") {
  const error = new Error("Tencent video moderation request failed");
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function createRequestDeadline(timeoutMs) {
  const controller = new AbortController();
  const timeoutError = transportError(undefined, "TENCENT_CI_VIDEO_TIMEOUT");
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

function invalidSubmissionResponse() {
  return transportError(502, "CONTENT_MODERATION_UPSTREAM_RESPONSE_INVALID");
}

function safeTencentOperationalErrorCode(value) {
  const providerCode = String(value || "").trim();
  if (!/^[A-Za-z][A-Za-z0-9.]{0,127}$/.test(providerCode)) return "";
  for (const [prefix, normalized] of TENCENT_OPERATIONAL_ERROR_PREFIXES) {
    if (providerCode === prefix || providerCode.startsWith(`${prefix}.`)) return normalized;
  }
  return "";
}

function responseTransportError(response, responseBody) {
  const providerCode = safeTencentOperationalErrorCode(xmlTag(responseBody, "Code"));
  if (providerCode) return transportError(response.status, providerCode);
  if (Number(response.status) === 429) {
    return transportError(response.status, "TENCENT_CI_VIDEO_RATE_LIMITED");
  }
  if (Number(response.status) >= 500 && Number(response.status) <= 599) {
    return transportError(response.status, "TENCENT_CI_VIDEO_UPSTREAM_5XX");
  }
  return transportError(response.status, "CONTENT_MODERATION_UPSTREAM_RESPONSE_INVALID");
}

function boundedResponseIdentifier(value) {
  const text = String(value || "").trim();
  return text && text.length <= 512 ? text : "";
}

export function validateTencentVideoSubmission(response, expectedDataId) {
  const jobId = boundedResponseIdentifier(response?.JobId);
  const dataId = boundedResponseIdentifier(response?.DataId);
  const state = boundedResponseIdentifier(response?.State);
  if (
    !jobId ||
    dataId !== String(expectedDataId || "") ||
    !ACCEPTED_SUBMISSION_STATES.has(state)
  ) {
    throw invalidSubmissionResponse();
  }
  return { JobId: jobId, DataId: dataId, State: state };
}

async function readBounded(response, maxBytes = 256 * 1024) {
  const body = await response.text();
  if (Buffer.byteLength(body, "utf8") > maxBytes) {
    throw transportError(502, "CONTENT_MODERATION_RESPONSE_TOO_LARGE");
  }
  return body;
}

function requestBody(request, callbackUrl) {
  return [
    "<Request><Input>",
    `<Object>${xml(request.objectKey)}</Object>`,
    `<DataId>${xml(request.dataId)}</DataId>`,
    "</Input><Conf>",
    `<BizType>${xml(request.policyId)}</BizType>`,
    "<Snapshot>",
    "<Mode>Average</Mode>",
    `<Count>${TENCENT_VIDEO_AUDIT_AVERAGE_SNAPSHOT_COUNT}</Count>`,
    "</Snapshot>",
    "<DetectContent>1</DetectContent>",
    `<Callback>${xml(callbackUrl)}</Callback>`,
    "<CallbackVersion>Detail</CallbackVersion>",
    "<CallbackType>1</CallbackType>",
    "</Conf></Request>"
  ].join("");
}

export function createTencentVideoModerationTransport({
  config,
  fetchImpl = globalThis.fetch,
  now = () => new Date(),
  timeoutMs = 15_000
}) {
  return createTencentVideoModerationTransportWithObjectValidator({
    config,
    fetchImpl,
    now,
    timeoutMs,
    validateObjectKey: (request) => requiredVideoSourceObjectKey(request.objectKey)
  });
}

export function createTencentProductionPreflightVideoModerationTransport({
  config,
  fetchImpl = globalThis.fetch,
  now = () => new Date(),
  timeoutMs = 15_000
}) {
  return createTencentVideoModerationTransportWithObjectValidator({
    config,
    fetchImpl,
    now,
    timeoutMs,
    validateObjectKey: (request) => {
      const runId = required(request.runId, "runId");
      const objectKey = required(request.objectKey, "objectKey");
      validateProductionPreflightVideoObjectKey(runId, objectKey);
      return objectKey;
    }
  });
}

function createTencentVideoModerationTransportWithObjectValidator({
  config,
  fetchImpl,
  now,
  timeoutMs,
  validateObjectKey
}) {
  if (typeof fetchImpl !== "function") throw new TypeError("fetch implementation is required");
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs >= 30_000) {
    throw new TypeError("timeoutMs must be a positive duration shorter than the retry lease");
  }
  return async function transport(request) {
    if (request.kind !== "video") throw new TypeError("only Tencent video moderation is supported");
    validateObjectKey(request);
    const endpoint = "video/auditing";
    const host = `${required(request.bucket, "bucket")}.ci.${required(request.region, "region")}.myqcloud.com`;
    const callbackUrl = callbackWithToken(
      request.callbackUrl,
      config.tencentVideoCallbackToken
    );
    const body = requestBody(request, callbackUrl);
    const headers = {
      host,
      date: now().toUTCString(),
      "content-type": "application/xml",
      "content-length": String(Buffer.byteLength(body))
    };
    const authorization = buildCosAuthorization({
      method: "POST",
      key: endpoint,
      headers,
      config: { secretId: config.secretId, secretKey: config.secretKey }
    });
    const deadline = createRequestDeadline(timeoutMs);
    let response;
    let responseBody;
    try {
      response = await deadline.run(() => fetchImpl(`https://${host}/${endpoint}`, {
        method: "POST",
        headers: { ...headers, authorization },
        body,
        signal: deadline.signal
      }));
      responseBody = await deadline.run(() => readBounded(response));
    } catch (error) {
      if (SAFE_TRANSPORT_ERROR_CODES.has(error?.code)) throw error;
      const code = deadline.isTimeout(error) || deadline.signal.aborted ||
        ["AbortError", "TimeoutError"].includes(error?.name) ||
        ["ETIMEDOUT", "ABORT_ERR"].includes(error?.code)
        ? "TENCENT_CI_VIDEO_TIMEOUT"
        : "TENCENT_CI_VIDEO_NETWORK_ERROR";
      throw transportError(undefined, code);
    } finally {
      deadline.close();
    }
    if (!response.ok) throw responseTransportError(response, responseBody);
    return validateTencentVideoSubmission({
      JobId: xmlTag(responseBody, "JobId"),
      State: xmlTag(responseBody, "State"),
      DataId: xmlTag(responseBody, "DataId")
    }, request.dataId);
  };
}

export function createTencentVideoModerationClient({ config, transport }) {
  if (!config || typeof config !== "object") throw new TypeError("moderation config is required");
  if (typeof transport !== "function") throw new TypeError("moderation transport is required");
  return {
    async submitVideo(input) {
      if (!config.enabled || !config.tencentVideoEnabled) {
        throw configurationError("Tencent video content moderation is disabled");
      }
      const request = {
        kind: "video",
        policyId: required(config.tencentVideoPolicyId, "tencentVideoPolicyId"),
        dataId: required(input?.dataId, "dataId"),
        objectKey: requiredVideoSourceObjectKey(input?.objectKey),
        region: required(config.tencentVideoRegion, "tencentVideoRegion"),
        bucket: required(config.bucket, "bucket"),
        callbackUrl: config.tencentVideoCallbackUrl
      };
      return validateTencentVideoSubmission(await transport(request), request.dataId);
    }
  };
}

export function createTencentProductionPreflightVideoModerationClient({ config, transport }) {
  if (!config || typeof config !== "object") throw new TypeError("moderation config is required");
  if (!transport || typeof transport.submitVideo !== "function") {
    throw new TypeError("production preflight Tencent transport is required");
  }
  return {
    async submitProductionPreflightVideo({ runId, objectKey, dataId }) {
      validateProductionPreflightVideoObjectKey(runId, objectKey);
      return transport.submitVideo({
        runId,
        objectKey,
        dataId,
        bizType: config.tencentVideoPolicyId
      });
    }
  };
}

export function parseTencentProductionPreflightCallbackPayload(rawBody) {
  const body = String(Buffer.isBuffer(rawBody) ? rawBody.toString("utf8") : rawBody || "");
  let detail = null;
  try {
    const parsed = JSON.parse(body);
    detail = parsed.JobsDetail || parsed.jobsDetail || parsed;
  } catch {
    detail = {
      JobId: xmlTag(body, "JobId"),
      DataId: xmlTag(body, "DataId"),
      State: xmlTag(body, "State"),
      Result: xmlTag(body, "Result")
    };
  }
  const dataId = String(detail?.DataId || detail?.dataId || "").trim();
  const jobId = String(detail?.JobId || detail?.jobId || "").trim();
  if (!dataId && !jobId) {
    throw new TypeError("production preflight Tencent callback missing DataId or JobId");
  }
  return {
    dataId,
    jobId,
    resultCategory: productionPreflightTencentResultCategory(detail)
  };
}

function productionPreflightTencentResultCategory(detail) {
  const state = String(detail?.State || detail?.state || "").trim();
  if (state && state !== "Success") return "error";
  const result = String(detail?.Result ?? detail?.result ?? "").trim();
  if (result === "0") return "pass";
  if (result === "1") return "block";
  if (result === "2") return "review";
  return "error";
}
