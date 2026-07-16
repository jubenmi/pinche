import { assertD46IsolatedSmokeEnvironment } from "../apps/api/src/modules/content-moderation/d46-isolated-smoke.js";

function assertLocalRedisEnvironment(env) {
  const redisUrl = String(env.REDIS_URL || "").trim();
  const localRedisUrl = /^redis:\/\/(?:127\.0\.0\.1|localhost|\[::1\]):6446(?:\/\d+)?(?:\?.*)?$/;
  if (redisUrl && !localRedisUrl.test(redisUrl)) {
    throw new TypeError("D46 isolated smoke Redis endpoint is not loopback");
  }
}

assertD46IsolatedSmokeEnvironment(process.env);
assertLocalRedisEnvironment(process.env);

const { createApp } = await import("../apps/api/src/server.js");
const server = createApp();
let stopping = false;

function stopServer() {
  if (stopping) return;
  stopping = true;
  server.close((error) => {
    if (error) process.exitCode = 1;
  });
}

process.once("SIGINT", stopServer);
process.once("SIGTERM", stopServer);

server.listen(3046, "127.0.0.1");
