import crypto from "node:crypto";

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

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function hmac(key, value, encoding) {
  return crypto.createHmac("sha256", key).update(value).digest(encoding);
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
  const url = new URL(callbackUrl);
  url.searchParams.set("token", callbackToken);
  return url.toString();
}

function transportError(statusCode, code = "CONTENT_MODERATION_UPSTREAM_ERROR") {
  const error = new Error("Tencent content moderation request failed");
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

function ciRequestBody(request, callbackUrl) {
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

function tc3Authorization({ secretId, secretKey, timestamp, payload, action }) {
  const service = "tms";
  const host = "tms.tencentcloudapi.com";
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10);
  const canonicalHeaders = [
    "content-type:application/json; charset=utf-8",
    `host:${host}`,
    `x-tc-action:${action.toLowerCase()}`,
    ""
  ].join("\n");
  const signedHeaders = "content-type;host;x-tc-action";
  const canonicalRequest = [
    "POST", "/", "", canonicalHeaders, signedHeaders, sha256(payload)
  ].join("\n");
  const credentialScope = `${date}/${service}/tc3_request`;
  const stringToSign = [
    "TC3-HMAC-SHA256", timestamp, credentialScope, sha256(canonicalRequest)
  ].join("\n");
  const secretDate = hmac(`TC3${secretKey}`, date);
  const secretService = hmac(secretDate, service);
  const secretSigning = hmac(secretService, "tc3_request");
  const signature = hmac(secretSigning, stringToSign, "hex");
  return `TC3-HMAC-SHA256 Credential=${secretId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
}

export function createTencentModerationTransport({
  config,
  fetchImpl = globalThis.fetch,
  now = () => new Date(),
  timeoutMs = 15_000
}) {
  if (typeof fetchImpl !== "function") throw new TypeError("fetch implementation is required");

  return async function transport(request) {
    const signal = AbortSignal.timeout(timeoutMs);
    if (request.kind === "text") {
      const action = "TextModeration";
      const timestamp = Math.floor(now().getTime() / 1000);
      const payload = JSON.stringify({
        Content: Buffer.from(request.content, "utf8").toString("base64"),
        BizType: request.policyId,
        DataId: request.dataId,
        User: { UserId: request.dataId }
      });
      const headers = {
        "content-type": "application/json; charset=utf-8",
        host: "tms.tencentcloudapi.com",
        "x-tc-action": action,
        "x-tc-timestamp": String(timestamp),
        "x-tc-version": "2020-12-29",
        "x-tc-region": request.region,
        authorization: tc3Authorization({
          secretId: config.secretId,
          secretKey: config.secretKey,
          timestamp,
          payload,
          action
        })
      };
      const response = await fetchImpl("https://tms.tencentcloudapi.com/", {
        method: "POST", headers, body: payload, signal
      });
      const body = await readBounded(response);
      if (!response.ok) throw transportError(response.status);
      let parsed;
      try {
        parsed = JSON.parse(body);
      } catch {
        throw transportError(502, "CONTENT_MODERATION_INVALID_RESPONSE");
      }
      if (parsed?.Response?.Error) {
        throw transportError(502, parsed.Response.Error.Code || "CONTENT_MODERATION_UPSTREAM_ERROR");
      }
      return parsed?.Response || {};
    }

    if (request.kind !== "image" && request.kind !== "video") {
      throw new TypeError("unsupported moderation request kind");
    }
    const endpoint = `${request.kind}/auditing`;
    const host = `${request.bucket}.ci.${request.region}.myqcloud.com`;
    const callbackUrl = callbackWithToken(request.callbackUrl, config.callbackToken);
    const body = ciRequestBody(request, callbackUrl);
    const date = now().toUTCString();
    const headers = {
      host,
      date,
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
      signal
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

export function createTencentModerationClient({ config, transport }) {
  if (!config || typeof config !== "object") throw new TypeError("moderation config is required");
  if (typeof transport !== "function") throw new TypeError("moderation transport is required");

  async function submit(kind, input) {
    if (!config.enabled || !config[`${kind}Enabled`]) {
      throw configurationError(`${kind} content moderation is disabled`);
    }
    const policyByKind = {
      image: config.imagePolicyId,
      video: config.videoPolicyId,
      text: config.textPolicyId
    };
    const request = {
      kind,
      policyId: required(policyByKind[kind], `${kind} policyId`),
      dataId: required(input?.dataId, "dataId"),
      region: config.region
    };
    if (kind === "text") {
      request.content = required(input?.content, "content");
    } else {
      request.objectKey = required(input?.objectKey, "objectKey");
      request.bucket = required(config.bucket, "bucket");
      request.callbackUrl = config.callbackUrl;
    }
    return transport(request);
  }

  return {
    submitImage: (input) => submit("image", input),
    submitVideo: (input) => submit("video", input),
    moderateText: (input) => submit("text", input)
  };
}
