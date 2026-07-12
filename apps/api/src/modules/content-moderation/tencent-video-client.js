import { buildCosAuthorization } from "../../storage/cos.js";

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
    "<Async>1</Async>",
    `<Callback>${xml(callbackUrl)}</Callback>`,
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
    return {
      JobId: xmlTag(responseBody, "JobId"),
      State: xmlTag(responseBody, "State"),
      DataId: xmlTag(responseBody, "DataId")
    };
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
      return transport({
        kind: "video",
        policyId: required(config.tencentVideoPolicyId, "tencentVideoPolicyId"),
        dataId: required(input?.dataId, "dataId"),
        objectKey: required(input?.objectKey, "objectKey"),
        region: required(config.tencentVideoRegion, "tencentVideoRegion"),
        bucket: required(config.bucket, "bucket"),
        callbackUrl: config.tencentVideoCallbackUrl
      });
    }
  };
}
