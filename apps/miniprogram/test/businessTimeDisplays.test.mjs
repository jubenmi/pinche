import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { formatBeijingDateTime, parseBusinessDateTime } from "@pinche/shared";
import { buildOrganizerSignupMessages } from "../src/utils/authMessages.js";

test("pending signup subtitle displays Beijing time rather than UTC ISO", () => {
  const [message] = buildOrganizerSignupMessages([{
    id: 1, pending_signup_count: 1, start_at: "2026-09-07T16:30:00Z"
  }]);
  assert.match(message.subtitle, /2026-09-08 00:30/);
  assert.doesNotMatch(message.subtitle, /T16:30/);
});

test("album photo dates use Beijing even on a UTC device", async (t) => {
  const originalTZ = process.env.TZ;
  process.env.TZ = "UTC";
  t.after(() => { if (originalTZ === undefined) delete process.env.TZ; else process.env.TZ = originalTZ; });
  const source = await readFile(new URL("../src/pages/session/album.vue", import.meta.url), "utf8");
  const method = source.match(/    formatDate\(value\) \{[\s\S]*?\n    \},/)[0].trim().slice(0, -1);
  const format = new Function("formatBeijingDateTime", `return ({${method}}).formatDate`)(formatBeijingDateTime);
  assert.equal(format("2026-09-07T16:30:00Z"), "2026-09-08 00:30");
});

for (const [file, name] of [["detail.vue", "isAlbumOpen"]]) {
  test(`${file} evaluates legacy Beijing time consistently on UTC devices`, async (t) => {
    const originalTZ = process.env.TZ;
    process.env.TZ = "UTC";
    t.after(() => { if (originalTZ === undefined) delete process.env.TZ; else process.env.TZ = originalTZ; });
    t.mock.method(Date, "now", () => Date.parse("2026-09-07T02:00:00Z"));
    const source = await readFile(new URL(`../src/pages/session/${file}`, import.meta.url), "utf8");
    const method = source.match(new RegExp(`    ${name}\\(\\) \\{[\\s\\S]*?\\n    \\},`))[0].trim().slice(0, -1);
    const check = new Function("parseBusinessDateTime", `return ({${method}}).${name}`)(parseBusinessDateTime);
    assert.equal(check.call({ session: { start_at: "2026-09-07 09:00:00" }, currentTime: Date.now() }), true);
  });
}
