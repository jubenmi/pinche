import assert from "node:assert/strict";
import test from "node:test";

import { createDependencies } from "../src/app/create-dependencies.js";

test("dependency composition exposes explicit infrastructure ports and supports overrides", async () => {
  const readiness = async () => ({ ok: true });
  const clock = { now: () => 123 };
  const logger = { info() {} };
  const limiter = { async consume() {} };
  const dependencies = createDependencies({
    checkDatabaseReadiness: readiness,
    clock,
    logger,
    rateLimiter: limiter,
  });

  assert.equal(dependencies.checkDatabaseReadiness, readiness);
  assert.equal(dependencies.clock, clock);
  assert.equal(dependencies.logger, logger);
  assert.equal(dependencies.rateLimiter, limiter);
  assert.equal(typeof dependencies.database.withConnection, "function");
  assert.equal(typeof dependencies.database.withTransaction, "function");
  assert.equal(typeof dependencies.auth.loginWithWechatCode, "function");
  assert.equal(typeof dependencies.auth.verifyBusinessToken, "function");
  assert.equal(typeof dependencies.redis.url, "string");
  assert.equal(typeof dependencies.cos, "object");
  assert.equal(Object.isFrozen(dependencies), true);
});
