import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  dispatchWechatImageModerationEvent,
  parseWechatSecureImageEvent
} from "../src/modules/content-moderation/wechat-callback.js";
import * as wechatCallback from "../src/modules/content-moderation/wechat-callback.js";

const token = "wechat-content-security-event-token";
const appId = "wx-d45-content-security";
const aesKey = crypto.randomBytes(32).toString("base64").replace(/=$/, "");
const officialUrlVerification = Object.freeze({
  token: "AAAAA",
  signature: "f464b24fc39322e44b38aa78f5edd27bd1441696",
  timestamp: "1714036504",
  nonce: "1514711492",
  echostr: "4375120948345356249"
});

function pkcs7Pad(source, blockSize = 32) {
  const input = Buffer.from(source);
  const padding = blockSize - (input.length % blockSize || blockSize);
  return Buffer.concat([input, Buffer.alloc(padding || blockSize, padding || blockSize)]);
}

function encryptWechatSecurePayload(message, {
  eventToken = token,
  eventAesKey = aesKey,
  eventAppId = appId,
  timestamp = "1720742400",
  nonce = "nonce-d45-image"
} = {}) {
  const aes = Buffer.from(`${eventAesKey}=`, "base64");
  const plaintextMessage = Buffer.from(String(message), "utf8");
  const messageLength = Buffer.alloc(4);
  messageLength.writeUInt32BE(plaintextMessage.length);
  const plaintext = Buffer.concat([
    crypto.randomBytes(16),
    messageLength,
    plaintextMessage,
    Buffer.from(eventAppId, "utf8")
  ]);
  const cipher = crypto.createCipheriv("aes-256-cbc", aes, aes.subarray(0, 16));
  cipher.setAutoPadding(false);
  const Encrypt = Buffer.concat([cipher.update(pkcs7Pad(plaintext)), cipher.final()]).toString("base64");
  const msgSignature = wechatSignature({ eventToken, timestamp, nonce, Encrypt });
  return {
    msgSignature,
    timestamp,
    nonce,
    Encrypt
  };
}

function encryptWechatSecureEvent(event, options) {
  const encrypted = encryptWechatSecurePayload(JSON.stringify(event), options);
  return {
    ...encrypted,
    rawBody: Buffer.from(JSON.stringify({ Encrypt: encrypted.Encrypt }), "utf8")
  };
}

function wechatSignature({ eventToken = token, timestamp, nonce, Encrypt }) {
  return crypto.createHash("sha1")
    .update([eventToken, timestamp, nonce, Encrypt].sort().join(""), "utf8")
    .digest("hex");
}

function secureImageEvent(overrides = {}) {
  return {
    MsgType: "event",
    Event: "wxa_media_check",
    trace_id: "wechat-image-trace-71",
    version: 2,
    result: {
      suggest: "pass",
      label: "normal",
      score: 100
    },
    ...overrides
  };
}

function parse(raw) {
  return parseWechatSecureImageEvent({
    ...raw,
    token,
    aesKey,
    appId
  });
}

function verifyUrlHandshake(input) {
  return wechatCallback.verifyWechatCallbackUrl(input);
}

test("official WeChat URL verification sample returns the supplied echostr", () => {
  const verification = verifyUrlHandshake(officialUrlVerification);

  assert.equal(verification, officialUrlVerification.echostr);
});

test("WeChat URL verification preserves echostr whitespace exactly", () => {
  const echostr = ` ${officialUrlVerification.echostr} `;
  const verification = verifyUrlHandshake({
    ...officialUrlVerification,
    echostr
  });

  assert.equal(verification, echostr);
});

test("WeChat URL verification rejects a well-formed but incorrect signature", () => {
  assert.throws(
    () => verifyUrlHandshake({
      ...officialUrlVerification,
      signature: "0".repeat(40)
    }),
    { code: "CONTENT_MODERATION_CALLBACK_UNAUTHORIZED" }
  );
});

for (const field of ["signature", "timestamp", "nonce", "echostr"]) {
  test(`WeChat URL verification rejects missing ${field}`, () => {
    const input = { ...officialUrlVerification };
    delete input[field];

    assert.throws(
      () => verifyUrlHandshake(input),
      { code: "CONTENT_MODERATION_INVALID_CALLBACK" }
    );
  });
}

test("WeChat URL verification rejects the legacy encrypted GET handshake", () => {
  const encrypted = encryptWechatSecurePayload("wechat-url-verification-echo");

  assert.throws(
    () => verifyUrlHandshake({
      token,
      msgSignature: encrypted.msgSignature,
      timestamp: encrypted.timestamp,
      nonce: encrypted.nonce,
      echostr: encrypted.Encrypt
    }),
    { code: "CONTENT_MODERATION_INVALID_CALLBACK" }
  );
});

test("secure WeChat image event verifies signature, decrypts JSON, and retains only safe result fields", () => {
  const parsed = parse(encryptWechatSecureEvent(secureImageEvent()));

  assert.deepEqual(parsed, {
    traceId: "wechat-image-trace-71",
    result: {
      decision: "pass",
      suggestion: "pass",
      label: "normal",
      score: 100
    }
  });
  assert.equal(JSON.stringify(parsed).includes("Encrypt"), false);
});

test("secure WeChat image event rejects forged signatures, invalid ciphertext, and a foreign AppID", () => {
  const valid = encryptWechatSecureEvent(secureImageEvent());
  assert.throws(() => parse({ ...valid, msgSignature: "0".repeat(40) }), {
    code: "CONTENT_MODERATION_CALLBACK_UNAUTHORIZED"
  });
  const Encrypt = "not-base64";
  assert.throws(
    () => parse({
      ...valid,
      rawBody: Buffer.from(JSON.stringify({ Encrypt })),
      msgSignature: wechatSignature({ ...valid, Encrypt })
    }),
    { code: "CONTENT_MODERATION_INVALID_CALLBACK" }
  );
  assert.throws(
    () => parse(encryptWechatSecureEvent(secureImageEvent(), { eventAppId: "wx-foreign" })),
    { code: "CONTENT_MODERATION_INVALID_CALLBACK" }
  );
});

test("secure WeChat image event rejects oversized raw requests and malformed event schemas", () => {
  const valid = encryptWechatSecureEvent(secureImageEvent());
  assert.throws(
    () => parse({ ...valid, rawBody: Buffer.alloc(256 * 1024 + 1, "x") }),
    { code: "CONTENT_MODERATION_INVALID_CALLBACK" }
  );
  assert.throws(
    () => parse(encryptWechatSecureEvent(secureImageEvent({ Event: "unexpected" }))),
    { code: "CONTENT_MODERATION_INVALID_CALLBACK" }
  );
  assert.throws(
    () => parse(encryptWechatSecureEvent(secureImageEvent({ result: null }))),
    { code: "CONTENT_MODERATION_INVALID_CALLBACK" }
  );
});

test("a structurally valid WeChat event with an unknown suggestion is normalized as error", () => {
  const parsed = parse(encryptWechatSecureEvent(secureImageEvent({
    result: { suggest: "unexpected", label: "unknown", score: 999 }
  })));
  assert.deepEqual(parsed, {
    traceId: "wechat-image-trace-71",
    result: {
      decision: "error",
      suggestion: "unexpected",
      label: "unknown",
      score: 100
    }
  });
});

for (const [suggestion, decision] of [["review", "review"], ["risky", "block"]]) {
  test(`WeChat image ${suggestion} maps to the closed internal ${decision} decision`, () => {
    const parsed = parse(encryptWechatSecureEvent(secureImageEvent({
      result: { suggest: suggestion, label: "category", score: 42 }
    })));
    assert.equal(parsed.result.decision, decision);
  });
}

test("only a trace-id lookup can dispatch a current WeChat image result and no object URL is accepted", async () => {
  const calls = [];
  const response = await dispatchWechatImageModerationEvent({
    event: {
      traceId: "wechat-image-trace-71",
      result: { decision: "pass", suggestion: "pass", label: "normal", score: 100 }
    },
    withDatabaseConnection: async (run) => run({}),
    repository: {
      findModerationAttemptByProviderJobId: async (_connection, provider, providerJobId) => ({
        id: 91,
        moderation_job_id: 71,
        provider,
        provider_job_id: providerJobId
      }),
      findModerationJobById: async () => ({
        id: 71,
        provider: "wechat_sec_check",
        subject_type: "album_image",
        subject_version: "etag-image-71"
      })
    },
    applyMediaResult: async (input) => {
      calls.push(input);
      return { status: "approved", duplicate: false };
    }
  });

  assert.deepEqual(response, { status: "approved", duplicate: false });
  assert.deepEqual(calls, [{
    jobId: 71,
    provider: "wechat_sec_check",
    providerJobId: "wechat-image-trace-71",
    subjectVersion: "etag-image-71",
    result: { decision: "pass", suggestion: "pass", label: "normal", score: 100 }
  }]);
  assert.equal("objectKey" in calls[0], false);
  assert.equal(JSON.stringify(calls).includes("http"), false);
});

test("unknown trace IDs are idempotent successes and cannot call the media state machine", async () => {
  let applied = false;
  const response = await dispatchWechatImageModerationEvent({
    event: { traceId: "unknown-trace", result: { decision: "pass" } },
    withDatabaseConnection: async (run) => run({}),
    repository: {
      findModerationAttemptByProviderJobId: async () => null,
      findModerationJobById: async () => { throw new Error("job must not be queried"); }
    },
    applyMediaResult: async () => { applied = true; }
  });
  assert.deepEqual(response, { status: null, stale: true, duplicate: false });
  assert.equal(applied, false);
});

test("server isolates official GET URL verification from secure POST event parsing and sensitive fields", async () => {
  const server = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  const callbackPath = '"/api/internal/content-moderation/wechat-image/callback"';
  const getRoute = server.indexOf(callbackPath);
  const postRoute = server.indexOf(callbackPath, getRoute + callbackPath.length);
  const getRouteStart = server.lastIndexOf("  if (", getRoute);
  const postRouteStart = server.lastIndexOf("  if (", postRoute);
  const genericBody = server.indexOf("const body = await bodyFor(request)");
  assert.ok(
    getRouteStart > 0 &&
      getRouteStart < postRouteStart &&
      postRouteStart < genericBody
  );
  const getRouteBody = server.slice(getRouteStart, postRouteStart);
  const postRouteBody = server.slice(postRouteStart, genericBody);

  assert.match(getRouteBody, /request\.method === "GET"/);
  assert.match(getRouteBody, /verifyWechatCallbackUrl/);
  assert.match(getRouteBody, /signature:\s*url\.searchParams\.get\("signature"\)/);
  assert.match(getRouteBody, /url\.searchParams\.get\("echostr"\)/);
  assert.match(getRouteBody, /"content-type": "text\/plain; charset=utf-8"/);
  assert.match(getRouteBody, /response\.end\(echo\)/);
  assert.doesNotMatch(getRouteBody, /msg_signature|msgSignature/);
  assert.doesNotMatch(getRouteBody, /wechatEventAesKey/);
  assert.doesNotMatch(getRouteBody, /wechatAppId/);
  assert.doesNotMatch(getRouteBody, /readRawBody/);
  assert.doesNotMatch(getRouteBody, /parseWechatSecureImageEvent/);

  assert.match(postRouteBody, /request\.method === "POST"/);
  assert.match(postRouteBody, /url\.searchParams\.get\("msg_signature"\)/);
  assert.match(postRouteBody, /wechatEventAesKey/);
  assert.match(postRouteBody, /wechatAppId/);
  assert.match(postRouteBody, /readRawBody\(request, 256 \* 1024\)/);
  assert.match(postRouteBody, /parseWechatSecureImageEvent/);
  assert.match(postRouteBody, /tryHandleProductionPreflightWechatImageCallback/);
  assert.match(postRouteBody, /if \(\s*config\.contentModeration\.productionPreflight\?\.referenceHmacKey\s*\)/);
  assert.doesNotMatch(postRouteBody, /productionPreflight\?\.enabled\s*&&/);
  assert.match(postRouteBody, /onCleanupFailure/);
  assert.match(postRouteBody, /CONTENT_MODERATION_PRODUCTION_PREFLIGHT_CLEANUP_FAILED/);
  assert.match(server, /hasActiveProductionPreflightWechatImageRun/);
  assert.doesNotMatch(server, /hasAwaitingWechatImageTrace:\s*async \(\) => false/);
  assert.ok(
    postRouteBody.indexOf("tryHandleProductionPreflightWechatImageCallback") <
      postRouteBody.indexOf("dispatchWechatImageModerationEvent")
  );
  assert.match(postRouteBody, /dispatchWechatImageModerationEvent/);
  assert.match(postRouteBody, /emitContentModerationEvent\("moderation_callback_failure"/);
  assert.match(postRouteBody, /outcome: unauthorized \? "unauthorized" : "invalid"/);
  assert.doesNotMatch(postRouteBody, /objectKey|object_key|media_url|signedUrl|console\.log/);
  assert.match(server, /CONTENT_MODERATION_CALLBACK_UNAUTHORIZED: \[401,/);
  assert.match(server, /CONTENT_MODERATION_INVALID_CALLBACK: \[400,/);
});
