import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { formatBeijingDateTime } from "@pinche/shared";

const source = await readFile(new URL("../vite.config.js", import.meta.url), "utf8");
const definition = source.match(/function formatBuildTime\([\s\S]*?\n\}/)[0];
const format = new Function("formatBeijingDateTime", `${definition}; return formatBuildTime`)(formatBeijingDateTime);
test("mini-program version timestamp is Beijing time on a UTC build host", (t) => {
  const original = process.env.TZ;
  process.env.TZ = "UTC";
  t.after(() => { if (original === undefined) delete process.env.TZ; else process.env.TZ = original; });
  assert.equal(format(new Date("2026-09-07T16:05:00Z")), "2026-09-08 00:05");
});
