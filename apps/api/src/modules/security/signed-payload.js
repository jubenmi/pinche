import crypto from "node:crypto";

import { forbidden } from "../../http/errors.js";

export function signedPayloadSignature({ secret, namespace, payloadText }) {
  return crypto
    .createHmac("sha256", secret)
    .update(`${namespace}:${payloadText}`)
    .digest("hex");
}

export function tokenPositiveInteger(value, label) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw forbidden(`${label} is invalid`);
  }
  return parsed;
}

export function signSignedPayload({ secret, namespace, payload }) {
  const payloadText = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = signedPayloadSignature({ secret, namespace, payloadText });
  return `${payloadText}.${signature}`;
}

export function verifySignedPayload({
  secret,
  namespace,
  token,
  label,
  nowSeconds = () => Math.floor(Date.now() / 1000)
}) {
  const [payloadText, signature, extra] = String(token || "").split(".");
  if (!payloadText || !signature || extra !== undefined) {
    throw forbidden(`${label} is required`);
  }

  const expected = signedPayloadSignature({ secret, namespace, payloadText });
  const signatureBuffer = Buffer.from(signature, "hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  if (
    signature.length !== expected.length ||
    signatureBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)
  ) {
    throw forbidden(`${label} is invalid`);
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(payloadText, "base64url").toString("utf8"));
  } catch (error) {
    throw forbidden(`${label} is invalid`);
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw forbidden(`${label} is invalid`);
  }
  if (tokenPositiveInteger(payload.exp, "exp") < nowSeconds()) {
    throw forbidden(`${label} expired`);
  }
  return payload;
}
