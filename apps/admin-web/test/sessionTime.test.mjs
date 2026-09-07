import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { beijingWallTimeToIso, isBusinessDateTimeReached } from "@pinche/shared";

const source = await readFile(new URL("../src/components/MiniProgramWorkspace.vue", import.meta.url), "utf8");
test("web creation transmits an explicit UTC instant", () => {
  const expression = source.match(/const transportStartAt = (computed\([\s\S]*?\));/)[1];
  const result = new Function("computed", "startAt", "beijingWallTimeToIso", `return ${expression};`)(
    (fn) => fn(), { value: "2026-09-07 19:30:00" }, beijingWallTimeToIso
  );
  assert.equal(result, "2026-09-07T11:30:00.000Z");
});

test("web album opening uses Beijing for legacy input", (t) => {
  const previousTZ = process.env.TZ;
  process.env.TZ = "UTC";
  t.after(() => { if (previousTZ === undefined) delete process.env.TZ; else process.env.TZ = previousTZ; });
  t.mock.method(Date, "now", () => Date.parse("2026-09-07T02:00:00Z"));
  const code = source.match(/function isAlbumOpenForSession\(session\) \{[\s\S]*?\n\}/)[0];
  const open = new Function("isBusinessDateTimeReached", "currentTime", `${code}; return isAlbumOpenForSession;`)(
    isBusinessDateTimeReached, { value: Date.now() }
  );
  assert.equal(open({ start_at: "2026-09-07 09:00:00" }), true);
});
