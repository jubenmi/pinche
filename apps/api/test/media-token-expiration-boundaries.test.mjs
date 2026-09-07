import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { forbidden } from "../src/http/errors.js";
import { signedPayloadSignature as namespacedPayloadSignature, signSignedPayload as signNamespacedPayload, verifySignedPayload as verifyNamespacedPayload, tokenPositiveInteger as parseTokenPositiveInteger, tokenExpiration } from "../src/modules/security/signed-payload.js";

const source = await readFile(new URL("../src/legacy-app.js", import.meta.url), "utf8");
const signedFunctions = source.slice(source.indexOf("function signedPayloadSignature("),
  source.indexOf("function normalizeSessionAlbumShareClaims("));
const standaloneFunctions = ["sessionAlbumMediaSignature", "verifySessionAlbumMediaQuery", "verifySessionAlbumVideoFileQuery"]
  .map((name) => source.match(new RegExp(`function ${name}\\([\\s\\S]*?\\n\\}`))[0]).join("\n");
const now = 1_789_000_000;

function harness(clock = () => now * 1000) {
  const context = vm.createContext({
    namespacedPayloadSignature, signNamespacedPayload, parseTokenPositiveInteger, tokenExpiration,
    verifyNamespacedPayload: (options) => verifyNamespacedPayload({ ...options, nowSeconds: () => Math.floor(clock() / 1000) }),
    crypto, Buffer, forbidden, config: { sessionSecret: "isolated-test-secret" }, Date: { now: clock }
  });
  vm.runInContext(signedFunctions + standaloneFunctions, context);
  return context;
}

for (const purpose of ["session-album-share", "session-join-invite", "session-album-public-media", "author-media-preview"]) {
  test(`${purpose} rejects the exact expiration second and accepts the prior second`, () => {
    const context = harness();
    const expired = context.signSignedPayload(purpose, { exp: now });
    assert.throws(() => context.verifySignedPayload(purpose, expired, "test token"), { statusCode: 403 });
    const current = context.signSignedPayload(purpose, { exp: now + 1 });
    assert.equal(context.verifySignedPayload(purpose, current, "test token").exp, now + 1);
  });
}

for (const exp of [`${now + 1}junk`, `${now + 1}.5`, now + 1.5, Number.MAX_SAFE_INTEGER + 1, null, [], {}]) {
  test(`signed media payload rejects invalid exp ${JSON.stringify(exp)}`, () => {
    const context = harness();
    const token = context.signSignedPayload("session-album-share", { exp });
    assert.throws(() => context.verifySignedPayload("session-album-share", token, "test token"), { statusCode: 403 });
  });
}

test("a signed null payload is rejected as missing exp instead of throwing a server error", () => {
  const context = harness();
  const token = context.signSignedPayload("session-album-share", null);
  assert.throws(() => context.verifySignedPayload("session-album-share", token, "test token"), { statusCode: 403 });
});

test("legacy album query rejects expiration equality and preserves valid signatures", () => {
  const context = harness();
  for (const expires of [now - 1, now]) {
    const query = new URLSearchParams({ expires: String(expires), signature: context.sessionAlbumMediaSignature(7, expires) });
    assert.throws(() => context.verifySessionAlbumMediaQuery(7, query), { statusCode: 403 });
  }
  const query = new URLSearchParams({ expires: String(now + 1), signature: context.sessionAlbumMediaSignature(7, now + 1) });
  assert.doesNotThrow(() => context.verifySessionAlbumMediaQuery(7, query));
});

for (const expires of [`${now + 1}suffix`, `${now + 1}.5`, String(Number.MAX_SAFE_INTEGER + 1)]) {
  test(`legacy query rejects malformed expires ${expires} despite a matching truncated signature`, () => {
    const context = harness();
    const signature = context.sessionAlbumMediaSignature(7, Number.parseInt(expires, 10));
    assert.throws(() => context.verifySessionAlbumMediaQuery(7, new URLSearchParams({ expires, signature })), { statusCode: 403 });
  });
}

test("video token expires if its deadline is reached between the two verification checks", () => {
  let reads = 0;
  const context = harness(() => (now + (reads++ > 0 ? 1 : 0)) * 1000);
  const token = context.signSignedPayload("session-album-video-file", { sessionId: 1, userId: 2, mediaId: 7, exp: now + 1 });
  assert.throws(() => context.verifySessionAlbumVideoFileQuery(7, new URLSearchParams({ token })), { statusCode: 403 });
});
