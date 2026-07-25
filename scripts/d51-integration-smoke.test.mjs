import assert from "node:assert/strict";
import test from "node:test";

import { assertD51IntegrationEnvironment } from "./d51-integration-smoke.js";

const validEnvironment = Object.freeze({
  D51_INTEGRATION_ISOLATED: "1",
  NODE_ENV: "test",
  WECHAT_MOCK_LOGIN: "true",
  MYSQL_HOST: "mysql",
  MYSQL_DATABASE: "pinche_d51_test",
  D51_API_BASE_URL: "http://api:3018",
});

test("D51 integration guard accepts only the dedicated Compose target", () => {
  assert.deepEqual(assertD51IntegrationEnvironment(validEnvironment), {
    apiBaseUrl: "http://api:3018",
    database: "pinche_d51_test",
    mysqlHost: "mysql",
  });
});

for (const [name, patch] of [
  ["marker", { D51_INTEGRATION_ISOLATED: "0" }],
  ["production", { NODE_ENV: "production" }],
  ["mock login", { WECHAT_MOCK_LOGIN: "false" }],
  ["database", { MYSQL_DATABASE: "pinche" }],
  ["database host", { MYSQL_HOST: "127.0.0.1" }],
  ["API host", { D51_API_BASE_URL: "https://api.pinche.jubenmi.com" }],
]) {
  test(`D51 integration guard rejects the wrong ${name} before I/O`, () => {
    assert.throws(
      () => assertD51IntegrationEnvironment({ ...validEnvironment, ...patch }),
      { code: "D51_INTEGRATION_TARGET_INVALID" },
    );
  });
}
