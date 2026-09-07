import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import dayjs from "../src/uni_modules/uv-ui-tools/libs/util/dayjs.js";
import * as shared from "@pinche/shared";
import * as creationTime from "../src/utils/sessionCreationTime.js";
import * as sessionSetup from "../src/utils/sessionSetup.js";

const source = await readFile(new URL("../src/pages/session/setup.vue", import.meta.url), "utf8");
const script = source.match(/<script>([\s\S]*?)<\/script>/)[1]
  .replace(/import[\s\S]*?from\s*["'][^"']+["'];?/g, "")
  .replace("export default", "globalThis.page =");
const context = vm.createContext({ ...shared, ...creationTime, ...sessionSetup, AuthIdentityBar: {}, FeedbackHost: {}, createSessionCreationKey: () => "test-key", writeCreateFlow() {} });
vm.runInContext(script, context);
const page = context.page;

test("creation sends selected Beijing time as UTC", () => {
  assert.equal(page.computed.transportStartAt.call({ dateValue: "2026-09-07", timeValue: "19:30" }), "2026-09-07T11:30:00.000Z");
});

for (const isHistorical of [true, false]) {
  for (const [timeValue, expected] of [
    ["13:00", "2026-09-03T05:00:00.000Z"],
    ["00:30", "2026-09-02T16:30:00.000Z"]
  ]) {
    test(`${isHistorical ? "historical" : "future"} creation payload preserves September 3 ${timeValue}`, () => {
      const state = {
        dateValue: "2026-09-03", timeValue, isHistorical,
        store: { id: 1 }, script: { id: 2 },
        sessionPurpose: isHistorical ? shared.HISTORICAL_RECORD : shared.FUTURE_CARPOOL
      };
      state.startAt = page.computed.startAt.call(state);
      state.transportStartAt = page.computed.transportStartAt.call(state);
      const payload = page.methods.sessionCreationData.call(state, "");
      assert.equal(payload.startAt, expected, "the actual request must include the UTC timezone");
      assert.equal(shared.formatBeijingDateTime(payload.startAt), `2026-09-03 ${timeValue}`);
      assert.equal(state.startAt, `2026-09-03 ${timeValue}:00`, "local drafts keep their existing wall time format");
    });
  }
}

test("pure time picker permits morning on a future date even when now is evening", async () => {
  const picker = source.match(/<t-date-time-picker\s+title="选择时间"[\s\S]*?\/>/)[0];
  const start = picker.includes(':start="TIME_PICKER_START"') ? sessionSetup.TIME_PICKER_START : undefined;
  const end = picker.includes(':end="TIME_PICKER_END"') ? sessionSetup.TIME_PICKER_END : undefined;
  // TDesign anchors a time-only value to its minimum date, then clips it to start/end.
  const min = dayjs(start || "2026-09-07 21:45:00");
  const max = dayjs(end || "2046-09-07 21:45:00");
  for (const clock of ["00:00", "08:00", "13:00", "23:59"]) {
    const chosen = dayjs(`${min.format("YYYY-MM-DD")} ${clock}`);
    const actual = dayjs(Math.min(Math.max(min.valueOf(), chosen.valueOf()), max.valueOf())).format("HH:mm");
    assert.equal(actual, clock);
  }
});

test("saved UTC draft is restored in Beijing time", () => {
  context.readCreateFlow = () => ({ startAt: "2026-09-07T16:30:00.000Z" });
  context.roleOptionsFromFlow = () => [];
  context.selectedRolesFromFlow = () => [];
  const state = { canSubmit: true };
  page.onLoad.call(state);
  assert.equal(state.dateValue, "2026-09-08");
  assert.equal(state.timeValue, "00:30");
});
