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

function invalidSubmissionResponse() {
  return transportError(502, "CONTENT_MODERATION_UPSTREAM_RESPONSE_INVALID");
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
  if (typeof fetchImpl !== "function") throw new TypeError("fetch implementation is required");
  return async function transport(request) {
    if (request.kind !== "video") throw new TypeError("only Tencent video moderation is supported");
    requiredVideoSourceObjectKey(request.objectKey);
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
    const response = await fetchImpl(`https://${host}/${endpoint}`, {
      method: "POST",
      headers: { ...headers, authorization },
      body,
      signal: AbortSignal.timeout(timeoutMs)
    });
    const responseBody = await readBounded(response);
    if (!response.ok) throw transportError(response.status);
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
