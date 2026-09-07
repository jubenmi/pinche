import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { computed, reactive, ref } from "vue";
import * as shared from "@pinche/shared";
import { canRescheduleSession } from "../src/utils/sessionReschedule.js";

test("calendar date and start state refresh without new API data", async (t) => {
  let now = Date.parse("2026-09-07T15:59:59Z");
  t.mock.method(Date, "now", () => now);
  const callbacks = new Set();
  t.mock.method(globalThis, "setTimeout", (callback) => { callbacks.add(callback); return callback; });
  t.mock.method(globalThis, "clearTimeout", (callback) => callbacks.delete(callback));
  const mounts = [];
  const stops = [];
  const source = (await readFile(new URL("../src/components/SessionCalendar.vue", import.meta.url), "utf8"))
    .match(/<script setup>([\s\S]*?)<\/script>/)[1].replace(/^import[\s\S]*?;\s*$/gm, "");
  const bindings = {
    ...shared, computed, ref, watch() {}, nextTick() {},
    defineProps: () => ({ sessions: [], signups: [], guestSessions: [], calendarMode: "member" }),
    defineEmits: () => () => {}, onMounted: (fn) => mounts.push(fn), onShow: (fn) => mounts.push(fn),
    onHide: (fn) => stops.push(fn), onBeforeUnmount: (fn) => stops.push(fn)
  };
  const state = new Function(...Object.keys(bindings), `${source}\nreturn { selectedDatePickerValue, isStartedAt };`)(...Object.values(bindings));
  mounts.forEach((fn) => fn());
  assert.equal(state.selectedDatePickerValue.value, "2026-09-07");
  const started = computed(() => state.isStartedAt("2026-09-07T16:00:00Z"));
  assert.equal(started.value, false);
  now += 1000;
  [...callbacks].forEach((fn) => { callbacks.delete(fn); fn(); });
  assert.equal(state.selectedDatePickerValue.value, "2026-09-08");
  assert.equal(started.value, true);
  stops.forEach((fn) => fn());
  assert.equal(callbacks.size, 0);
});

test("management reschedule availability reacts to the clock reaching start time", async () => {
  const source = await readFile(new URL("../src/pages/session/manage.vue", import.meta.url), "utf8");
  const method = source.match(/    canReschedule\(\) \{[\s\S]*?\n    \},/)[0].trim().slice(0, -1);
  const getter = new Function("canRescheduleSession", `return ({${method}}).canReschedule;`)(canRescheduleSession);
  const state = reactive({ session: { start_at: "2099-01-01T00:00:00Z" }, currentTime: Date.parse("2098-12-31T23:59:59Z") });
  const allowed = computed(() => getter.call(state));
  assert.equal(allowed.value, true);
  state.currentTime += 1000;
  assert.equal(allowed.value, false);
});

for (const [file, name] of [["detail.vue", "isAlbumOpen"]]) {
  test(`${file} updates start-dependent UI without reloading the session`, async () => {
    const source = await readFile(new URL(`../src/pages/session/${file}`, import.meta.url), "utf8");
    const method = source.match(new RegExp(`    ${name}\\(\\) \\{[\\s\\S]*?\\n    \\},`))[0].trim().slice(0, -1);
    const getter = new Function("parseBusinessDateTime", `return ({${method}}).${name}`)(shared.parseBusinessDateTime);
    const state = reactive({ session: { start_at: "2099-01-01T00:00:00Z" }, currentTime: Date.parse("2098-12-31T23:59:59Z") });
    const started = computed(() => getter.call(state));
    assert.equal(started.value, false);
    state.currentTime += 1000;
    assert.equal(started.value, true);
  });
}
