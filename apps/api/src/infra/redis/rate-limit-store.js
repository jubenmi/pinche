import { createClient } from "redis";

const CONSUME_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
local ttl = redis.call('TTL', KEYS[1])
return { count, ttl }
`;

function safeKeyPart(value) {
  const normalized = String(value || "");
  if (!/^[A-Za-z0-9:._-]{1,240}$/.test(normalized)) {
    throw new TypeError("rate-limit store key is invalid");
  }
  return normalized;
}

export function createRedisRateLimitStore({ client, keyPrefix = "pinche:rate-limit" }) {
  if (typeof client?.eval !== "function") throw new TypeError("connected Redis client is required");
  const prefix = safeKeyPart(keyPrefix);
  return {
    async consume({ key, limit, windowSeconds }) {
      const result = await client.eval(CONSUME_SCRIPT, {
        keys: [`${prefix}:${safeKeyPart(key)}`],
        arguments: [String(windowSeconds)]
      });
      const count = Number(result?.[0]);
      const ttl = Number(result?.[1]);
      if (!Number.isSafeInteger(count) || count < 1) throw new Error("invalid Redis rate-limit count");
      const retryAfter = Number.isSafeInteger(ttl) && ttl > 0
        ? Math.min(windowSeconds, ttl)
        : windowSeconds;
      return {
        allowed: count <= limit,
        count,
        remaining: Math.max(0, limit - count),
        retryAfter
      };
    }
  };
}

export function createLazyRedisRateLimitStore({ url, createRedisClient = createClient }) {
  let clientPromise;
  async function client() {
    if (!clientPromise) {
      const pending = (async () => {
        const instance = createRedisClient({ url });
        instance.on?.("error", () => {});
        await instance.connect();
        return instance;
      })();
      clientPromise = pending.catch((error) => {
        clientPromise = undefined;
        throw error;
      });
    }
    return clientPromise;
  }
  return {
    async consume(input) {
      const connected = await client();
      return createRedisRateLimitStore({ client: connected }).consume(input);
    }
  };
}
