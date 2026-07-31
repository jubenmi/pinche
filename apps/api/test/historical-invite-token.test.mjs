import assert from "node:assert/strict";
import test from "node:test";

import { createHistoricalInviteTokenCodec } from "../src/modules/core/historical-invite-token.js";
import {
  signSignedPayload,
  signedPayloadSignature,
  verifySignedPayload
} from "../src/modules/security/signed-payload.js";

const SECRET = "test-secret";
const NOW_SECONDS = 1_000;
const HISTORICAL_NAMESPACE = "historical-session-claim";
const ORDINARY_NAMESPACE = "session-join-invite";

function createCodec() {
  return createHistoricalInviteTokenCodec({
    secret: SECRET,
    nowSeconds: () => NOW_SECONDS
  });
}

function signClaims(payload, namespace = HISTORICAL_NAMESPACE) {
  return signSignedPayload({
    secret: SECRET,
    namespace,
    payload
  });
}

function signRawPayload(payloadText) {
  const signature = signedPayloadSignature({
    secret: SECRET,
    namespace: HISTORICAL_NAMESPACE,
    payloadText
  });
  return `${payloadText}.${signature}`;
}

function assertHistoricalForbidden(action) {
  assert.throws(action, {
    statusCode: 403,
    code: "FORBIDDEN",
    message: "historical invite token is invalid"
  });
}

test("historical invitation tokens round-trip canonical purpose-scoped claims", () => {
  const codec = createCodec();
  const token = codec.sign({ sessionId: 42, inviterUserId: 7, exp: 1_100 });

  assert.deepEqual(codec.verify(token), {
    purpose: "historical_session_claim",
    sessionPurpose: "historical_record",
    sessionId: 42,
    inviterUserId: 7,
    exp: 1_100
  });
  assertHistoricalForbidden(() => codec.verify(token + "a"));
});

test("historical invitation token verification rejects expired tokens", () => {
  const codec = createCodec();
  const expired = codec.sign({ sessionId: 42, inviterUserId: 7, exp: 999 });

  assertHistoricalForbidden(() => codec.verify(expired));
});

test("historical invitation token verification rejects malformed token payloads", () => {
  const codec = createCodec();
  const malformedJson = Buffer.from("{not-json", "utf8").toString("base64url");
  const signedNull = signClaims(null);

  for (const token of [
    "",
    "missing-signature",
    "payload.signature.extra",
    signRawPayload(malformedJson),
    signedNull
  ]) {
    assertHistoricalForbidden(() => codec.verify(token));
  }
});

test("generic verification rejects signed non-object JSON without leaking parse errors", () => {
  for (const payload of [null, [], 42, "claims"]) {
    const token = signClaims(payload);
    assert.throws(() => verifySignedPayload({
      secret: SECRET,
      namespace: HISTORICAL_NAMESPACE,
      token,
      label: "test token",
      nowSeconds: () => NOW_SECONDS
    }), {
      statusCode: 403,
      code: "FORBIDDEN",
      message: "test token is invalid"
    });
  }
});

test("historical invitation tokens require the exact claim purpose and session purpose", () => {
  const codec = createCodec();
  const valid = {
    purpose: "historical_session_claim",
    sessionPurpose: "historical_record",
    sessionId: 42,
    inviterUserId: 7,
    exp: 1_100
  };

  assertHistoricalForbidden(() => codec.verify(signClaims({
    ...valid,
    purpose: "session_join_invite"
  })));
  assertHistoricalForbidden(() => codec.verify(signClaims({
    ...valid,
    sessionPurpose: "future_carpool"
  })));
});

test("historical invitation tokens reject invalid, missing, and nonpositive ids and expiry", () => {
  const codec = createCodec();
  const valid = {
    purpose: "historical_session_claim",
    sessionPurpose: "historical_record",
    sessionId: 42,
    inviterUserId: 7,
    exp: 1_100
  };
  const invalidValues = [undefined, null, 0, -1, "not-a-number"];

  for (const field of ["sessionId", "inviterUserId", "exp"]) {
    for (const value of invalidValues) {
      const claims = { ...valid, [field]: value };
      if (value === undefined) delete claims[field];
      assertHistoricalForbidden(() => codec.verify(signClaims(claims)));

      const input = { sessionId: 42, inviterUserId: 7, exp: 1_100, [field]: value };
      if (value === undefined) delete input[field];
      assertHistoricalForbidden(() => codec.sign(input));
    }
  }
});

test("historical signing ignores caller-supplied scope claims and canonicalizes trusted values", () => {
  const codec = createCodec();
  const token = codec.sign({
    namespace: ORDINARY_NAMESPACE,
    purpose: "session_join_invite",
    sessionPurpose: "future_carpool",
    sessionId: "42",
    inviterUserId: "7",
    exp: "1100",
    admin: true
  });

  assert.deepEqual(codec.verify(token), {
    purpose: "historical_session_claim",
    sessionPurpose: "historical_record",
    sessionId: 42,
    inviterUserId: 7,
    exp: 1_100
  });
});

test("historical and ordinary invitation token namespaces are cryptographically separate", () => {
  const codec = createCodec();
  const historicalToken = codec.sign({ sessionId: 42, inviterUserId: 7, exp: 1_100 });
  const ordinaryToken = signClaims({
    purpose: "session_join_invite",
    sessionId: 42,
    inviterUserId: 7,
    exp: 1_100
  }, ORDINARY_NAMESPACE);

  assert.equal(
    ordinaryToken,
    "eyJwdXJwb3NlIjoic2Vzc2lvbl9qb2luX2ludml0ZSIsInNlc3Npb25JZCI6NDIsImludml0ZXJVc2VySWQiOjcsImV4cCI6MTEwMH0.5c988399c69c7885e73404b23c47e2bb09baf511879fba51707dc31162814c54"
  );
  assert.throws(() => verifySignedPayload({
    secret: SECRET,
    namespace: ORDINARY_NAMESPACE,
    token: historicalToken,
    label: "session join invite token",
    nowSeconds: () => NOW_SECONDS
  }), { statusCode: 403 });
  assertHistoricalForbidden(() => codec.verify(ordinaryToken));
});
