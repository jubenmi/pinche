import assert from "node:assert/strict";
import test from "node:test";
import * as shared from "@pinche/shared";
import { miniScreens, sessionBackedMiniScreens } from "../src/adminRoute.js";
import { loadScriptSetup } from "./helpers/scriptSetup.mjs";

async function setup(t, { now, sessions = [], hidden = false }) {
  const timers = new Map();
  const visibilityHandlers = new Set();
  let timerId = 0;
  let fetches = 0;
  const document = {
    visibilityState: hidden ? "hidden" : "visible",
    addEventListener: (name, callback) => {
      assert.equal(name, "visibilitychange");
      visibilityHandlers.add(callback);
    },
    removeEventListener: (name, callback) => {
      assert.equal(name, "visibilitychange");
      visibilityHandlers.delete(callback);
    }
  };
  t.mock.method(Date, "now", () => now);
  t.mock.method(globalThis, "setTimeout", (callback) => { timers.set(++timerId, callback); return timerId; });
  t.mock.method(globalThis, "clearTimeout", (id) => timers.delete(id));
  class RuntimeDate extends Date {
    constructor(...values) { super(...(values.length ? values : [now])); }
  }
  const state = await loadScriptSetup(new URL("../src/components/MiniProgramWorkspace.vue", import.meta.url), {
    ...shared, Date: RuntimeDate, document, miniScreens, sessionBackedMiniScreens,
    writeAdminRoute: () => {},
    getStoredAuth: () => ({ user: { id: 7 }, roles: ["system_admin"] }),
    listMySessions: async () => { fetches += 1; return sessions; },
    listMySignups: async () => []
  }, ["mineDayGroups", "mineCalendarItems", "shareRoleCards", "shareSession", "shareRoleOptions", "mySessions", "createDate"]);
  await state.mount();
  await new Promise(setImmediate);
  t.after(state.unmount);
  return {
    state, timers, visibilityHandlers,
    fetches: () => fetches,
    advance(milliseconds, tick = true) {
      now += milliseconds;
      if (tick) {
        for (const [id, callback] of [...timers]) { timers.delete(id); callback(); }
      }
    },
    setHidden(value) {
      document.visibilityState = value ? "hidden" : "visible";
      [...visibilityHandlers].forEach((callback) => callback());
    }
  };
}

test("calendar today/tomorrow labels change at Beijing midnight without replacing API data", async (t) => {
  const f = await setup(t, {
    now: Date.parse("2026-09-07T15:59:59Z"),
    sessions: [
      { id: 1, start_at: "2026-09-07T06:00:00Z", status: "locked" },
      { id: 2, start_at: "2026-09-08T06:00:00Z", status: "locked" }
    ]
  });
  const apiData = f.state.mySessions.value;
  const selectedCreateDate = f.state.createDate.value;
  assert.deepEqual(f.state.mineDayGroups.value.map((group) => group.relativeLabel), ["明天", "今天"]);
  f.advance(1000);
  assert.deepEqual(f.state.mineDayGroups.value.map((group) => group.relativeLabel), ["今天", "昨天"]);
  assert.equal(f.state.mySessions.value, apiData);
  assert.equal(f.fetches(), 1);
  assert.equal(f.state.createDate.value, selectedCreateDate, "clock updates must preserve the user's creation draft");
});

test("calendar album action and locked share-seat eligibility react exactly at start time", async (t) => {
  const session = { id: 1, start_at: "2026-09-07T11:30:00Z", status: "locked" };
  const f = await setup(t, { now: Date.parse("2026-09-07T11:29:59Z"), sessions: [session] });
  f.state.shareSession.value = session;
  f.state.shareRoleOptions.value = [{ id: "3", status: "open", roleGender: "unlimited" }];
  assert.equal(f.state.mineCalendarItems.value[0].primaryActionLabel, "管理");
  assert.equal(f.state.shareRoleCards.value[0].claimable, false);
  f.advance(1000);
  assert.equal(f.state.mineCalendarItems.value[0].primaryActionLabel, "打开相册");
  assert.equal(f.state.mineCalendarItems.value[0].statusText, "已发车 · 相册开放");
  assert.equal(f.state.shareRoleCards.value[0].claimable, true);
  assert.equal(f.fetches(), 1);
});

test("hidden tabs pause the clock and visibility immediately refreshes crossed boundaries", async (t) => {
  const f = await setup(t, {
    now: Date.parse("2026-09-07T15:59:59Z"),
    sessions: [{ id: 1, start_at: "2026-09-08T06:00:00Z", status: "locked" }]
  });
  assert.equal(f.state.mineDayGroups.value[0].relativeLabel, "明天");
  assert.equal(f.timers.size, 1);
  f.setHidden(true);
  assert.equal(f.timers.size, 0);
  f.advance(2000, false);
  f.setHidden(false);
  assert.equal(f.state.mineDayGroups.value[0].relativeLabel, "今天");
  assert.equal(f.timers.size, 1);
  f.setHidden(false);
  assert.equal(f.timers.size, 1, "repeated visible events must not duplicate the ticker");
});

test("a hidden initial mount waits for visibility and unmount permanently disables retained callbacks", async (t) => {
  const f = await setup(t, { now: Date.parse("2026-09-07T15:59:59Z"), hidden: true });
  assert.equal(f.timers.size, 0);
  assert.equal(f.visibilityHandlers.size, 1);
  const [retainedVisibilityCallback] = f.visibilityHandlers;
  f.setHidden(false);
  assert.equal(f.timers.size, 1);
  f.state.unmount();
  assert.equal(f.visibilityHandlers.size, 0);
  assert.equal(f.timers.size, 0);
  retainedVisibilityCallback();
  assert.equal(f.timers.size, 0);
});
