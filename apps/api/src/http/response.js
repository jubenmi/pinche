export const PRIVATE_NO_STORE_HEADERS = Object.freeze({
  "cache-control": "private, no-store",
});

export function jsonResponse(response, statusCode, payload, headers = {}) {
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, {
    ...headers,
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
  });
  response.end(body);
}

export function errorResponse(response, statusCode, code, message, details) {
  jsonResponse(response, statusCode, {
    ok: false,
    error: {
      code,
      message,
      ...(details ? { details } : {}),
    },
  });
}

export function applyDefaultSecurityHeaders(response) {
  response.setHeader("x-content-type-options", "nosniff");
  response.setHeader("referrer-policy", "no-referrer");
}
