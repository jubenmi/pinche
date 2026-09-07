import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import crypto from "node:crypto";
import { unauthorized } from "../src/http/errors.js";

const ticketSource = await readFile(new URL("../src/modules/auth/admin-web-login.js", import.meta.url), "utf8");
const statusSource = ticketSource.match(/(?:export )?function ticketStatus\(row\) \{[\s\S]*?\n\}/)[0].replace("export ", "");
const ticketStatus = new Function(`${statusSource}; return ticketStatus;`)();
for (const status of ["pending", "approved"]) {
  test(`${status} login ticket expires exactly at its deadline`, (t) => {
    t.mock.method(Date, "now", () => Date.parse("2026-09-07T00:05:00Z"));
    assert.equal(ticketStatus({ status, expires_at: new Date("2026-09-07T00:05:00Z") }), "expired");
  });
}

test("business token is rejected at exp without looking up a user", async (t) => {
  const source = (await readFile(new URL("../src/modules/auth/wechat.js", import.meta.url), "utf8"))
    .replace(/^import[\s\S]*?;\s*$/gm, "").replace(/\bexport /g, "");
  let lookups = 0;
  const config = { sessionSecret: "test-secret", wechat: {} };
  const context = vm.createContext({ crypto, Buffer, Date, config, unauthorized,
    getUserWithRolesById: async () => { lookups += 1; return { user: { id: 1 }, roles: [] }; }
  });
  vm.runInContext(source, context);
  const issued = context.issueBusinessToken({ id: 1 }, []);
  t.mock.method(Date, "now", () => issued.expiresAt * 1000);
  await assert.rejects(context.verifyBusinessToken(issued.token), { statusCode: 401 });
  assert.equal(lookups, 0);
});

test("business token with a null payload rejects invalid expiration without a user lookup", async () => {
  const source = (await readFile(new URL("../src/modules/auth/wechat.js", import.meta.url), "utf8"))
    .replace(/^import[\s\S]*?;\s*$/gm, "").replace(/\bexport /g, "");
  let lookups = 0;
  const config = { sessionSecret: "test-secret", wechat: {} };
  const context = vm.createContext({ crypto, Buffer, Date, config, unauthorized,
    getUserWithRolesById: async () => { lookups += 1; return { user: { id: 1 }, roles: [] }; }
  });
  vm.runInContext(source, context);
  await assert.rejects(context.verifyBusinessToken(context.tokenFor(null)), { statusCode: 401 });
  assert.equal(lookups, 0);
});
