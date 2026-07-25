import { rateLimited, rateLimitUnavailable } from "../../http/errors.js";

export function createMemoryRateLimitStore({ now = Date.now } = {}) {
  const windows = new Map();
  return {
    async consume({ key, limit, windowSeconds }) {
      const current = Number(now());
      const windowMs = windowSeconds * 1000;
      let record = windows.get(key);
      if (!record || record.expiresAt <= current) {
        record = { count: 0, expiresAt: current + windowMs };
        windows.set(key, record);
      }
      record.count += 1;
      const retryAfter = Math.max(1, Math.ceil((record.expiresAt - current) / 1000));
      return {
        allowed: record.count <= limit,
        count: record.count,
        remaining: Math.max(0, limit - record.count),
        retryAfter
      };
    },
    reset() {
      windows.clear();
    }
  };
}

function assertConsumeInput({ scope, key, limit, windowSeconds }) {
  if (!/^[a-z0-9-]{1,64}$/.test(String(scope || ""))) {
    throw new TypeError("rate-limit scope is invalid");
  }
  if (!key || String(key).length > 240) throw new TypeError("rate-limit key is invalid");
  if (!Number.isSafeInteger(limit) || limit < 1) throw new TypeError("rate-limit limit is invalid");
  if (!Number.isSafeInteger(windowSeconds) || windowSeconds < 1 || windowSeconds > 3600) {
    throw new TypeError("rate-limit window is invalid");
  }
}

export function createAuthRateLimiter({ store }) {
  if (typeof store?.consume !== "function") throw new TypeError("rate-limit store is required");
  return {
    async consume(input) {
      assertConsumeInput(input);
      let result;
      try {
        result = await store.consume({
          key: `${input.scope}:${input.key}`,
          limit: input.limit,
          windowSeconds: input.windowSeconds
        });
      } catch {
        throw rateLimitUnavailable();
      }
      if (!result || result.allowed !== true) {
        throw rateLimited(result?.retryAfter);
      }
      return result;
    }
  };
}
