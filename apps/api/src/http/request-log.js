const UUID_SEGMENT = /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i;
const INTEGER_SEGMENT = /^\d+$/;
const OPAQUE_SEGMENT = /^[A-Za-z0-9_-]{24,}$/;

export function normalizeRoutePath(rawUrl) {
  let pathname = "/";
  try {
    pathname = new URL(rawUrl || "/", "http://localhost").pathname;
  } catch {
    // Keep the bounded fallback route below.
  }
  return pathname
    .split("/")
    .map((segment) => {
      if (INTEGER_SEGMENT.test(segment) || UUID_SEGMENT.test(segment)) return ":id";
      if (OPAQUE_SEGMENT.test(segment)) return ":token";
      return segment.slice(0, 80);
    })
    .join("/")
    .slice(0, 240);
}

export function logRequest({ request, response, context, logger = console }) {
  const durationMs = Number(process.hrtime.bigint() - context.startedAt) / 1_000_000;
  const entry = Object.freeze({
    event: "http_request",
    requestId: context.requestId,
    method: String(request.method || "UNKNOWN").slice(0, 12),
    route: normalizeRoutePath(request.url),
    status: Number(response.statusCode || 0),
    durationMs: Math.round(durationMs * 100) / 100
  });
  if (logger === console) logger.log(JSON.stringify(entry));
  else if (typeof logger?.info === "function") logger.info(entry);
  else if (typeof logger?.log === "function") logger.log(JSON.stringify(entry));
}
