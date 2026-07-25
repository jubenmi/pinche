import crypto from "node:crypto";

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{8,80}$/;

export function requestIdFrom(request) {
  const raw = request.headers?.["x-request-id"];
  const candidate = Array.isArray(raw) ? raw[0] : raw;
  return REQUEST_ID_PATTERN.test(String(candidate || ""))
    ? String(candidate)
    : crypto.randomUUID();
}

export function clientAddressFrom(request) {
  return String(request.socket?.remoteAddress || "unknown").replace(/^::ffff:/, "");
}

export function createRequestContext(request) {
  return Object.freeze({
    requestId: requestIdFrom(request),
    clientAddress: clientAddressFrom(request),
    startedAt: process.hrtime.bigint()
  });
}
