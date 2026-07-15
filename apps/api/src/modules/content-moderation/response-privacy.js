import { AppError } from "../../http/errors.js";

export const AUTHOR_PRIVATE_CACHE_CONTROL = "private, no-store";

const PUBLIC_ROUTE_KINDS = new Set([
  "session_public_share",
  "session_discovery",
  "public_calendar",
  "public_review",
  "public_media"
]);

const LEAK_REASON_PRIORITY = Object.freeze([
  "draft_id",
  "content_ref",
  "author_private",
  "publication_state",
  "message_type",
  "author_media_url",
  "scan_limit"
]);

function safeRouteKind(value) {
  const routeKind = String(value || "");
  return PUBLIC_ROUTE_KINDS.has(routeKind) ? routeKind : "unknown";
}

function authorMediaUrl(value) {
  return typeof value === "string" &&
    value.includes("/api/content-moderation/author-media/");
}

export function findAuthorPrivateLeak(value, options = {}) {
  const maxNodes = Number.isSafeInteger(options.maxNodes) && options.maxNodes > 0
    ? Math.min(options.maxNodes, 100_000)
    : 10_000;
  const stack = [value];
  const visited = new Set();
  const reasons = new Set();
  let nodes = 0;

  while (stack.length > 0) {
    const current = stack.pop();
    nodes += 1;
    if (nodes > maxNodes) {
      reasons.add("scan_limit");
      break;
    }
    if (authorMediaUrl(current)) {
      reasons.add("author_media_url");
      continue;
    }
    if (!current || typeof current !== "object") continue;
    if (visited.has(current)) continue;
    visited.add(current);

    if (Array.isArray(current)) {
      for (const entry of current) stack.push(entry);
      continue;
    }
    for (const [key, entry] of Object.entries(current)) {
      if (key === "draft_id") reasons.add("draft_id");
      if (key === "content_ref") reasons.add("content_ref");
      if (key === "author_private") reasons.add("author_private");
      if (key === "publication_state" && entry === "author_only") {
        reasons.add("publication_state");
      }
      if (key === "message_type" && entry === "author_private") {
        reasons.add("message_type");
      }
      stack.push(entry);
    }
  }

  return LEAK_REASON_PRIORITY.find((reason) => reasons.has(reason)) || null;
}

export function containsAuthorPrivateContent(value) {
  return findAuthorPrivateLeak(value) !== null;
}

export function authorPrivateResponseHeaders(value) {
  return containsAuthorPrivateContent(value)
    ? { "cache-control": AUTHOR_PRIVATE_CACHE_CONTROL }
    : {};
}

export function assertPublicResponseSafe(value, options = {}) {
  const reasonCode = findAuthorPrivateLeak(value);
  if (!reasonCode) return value;
  if (typeof options.emit === "function") {
    try {
      options.emit("author_private_public_leak", {
        routeKind: safeRouteKind(options.routeKind),
        reasonCode,
        priority: "high"
      });
    } catch {
      // A failed observability sink cannot make a private response public.
    }
  }
  throw new AppError(
    500,
    "CONTENT_MODERATION_AUTHOR_PRIVATE_LEAK",
    "Public response privacy assertion failed"
  );
}
