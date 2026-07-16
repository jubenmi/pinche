import assert from "node:assert/strict";
import { verifyD45SmokePreflight } from "./d45-session-reschedule-notifications-safety.js";

async function expectRejectedWithoutFetch(env, pattern) {
  let fetchCalls = 0;
  await assert.rejects(
    verifyD45SmokePreflight({
      env,
      fetchImpl: async () => {
        fetchCalls += 1;
        throw new Error("fetch must not run");
      }
    }),
    pattern
  );
  assert.equal(fetchCalls, 0);
}

await expectRejectedWithoutFetch(
  { BASE_URL: "https://example.com", WECHAT_SUBSCRIBE_MESSAGE_ENABLED: "false" },
  /non-local BASE_URL before fetch/
);
await expectRejectedWithoutFetch(
  { BASE_URL: "http://127.0.0.1:3029", WECHAT_SUBSCRIBE_MESSAGE_ENABLED: "true" },
  /requires WECHAT_SUBSCRIBE_MESSAGE_ENABLED=false before fetch/
);

for (const invalidTarget of [
  { marker: "wrong", isolated: true, database: "pinche_d45_test", wechat_mock_login: true },
  { marker: "d45-session-reschedule-notifications", isolated: true, database: "pinche", wechat_mock_login: true },
  { marker: "d45-session-reschedule-notifications", isolated: true, database: "pinche_d45_test_archive", wechat_mock_login: true },
  { marker: "d45-session-reschedule-notifications", isolated: true, database: "pinche_d45_test", wechat_mock_login: false }
]) {
  let fetchCalls = 0;
  await assert.rejects(
    verifyD45SmokePreflight({
      env: { BASE_URL: "http://localhost:3029", WECHAT_SUBSCRIBE_MESSAGE_ENABLED: "false" },
      fetchImpl: async (_url, options) => {
        fetchCalls += 1;
        assert.equal(options.method, "GET", "the only allowed unsafe-target request is preflight GET");
        return new Response(JSON.stringify({ ok: true, data: invalidTarget }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
    }),
    /rejected target identity/
  );
  assert.equal(fetchCalls, 1, "wrong server identity must stop after one read-only preflight");
}

console.log("D45 smoke safety checks passed: unsafe targets perform no business requests");
