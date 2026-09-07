import test from "node:test";
import assert from "node:assert/strict";
import { createClockTicker } from "../src/clockTicker.js";

test("disposed clock cannot be restarted by retained page lifecycle callbacks", (t) => {
  let timers = 0;
  let ticks = 0;
  t.mock.method(globalThis, "setTimeout", () => { timers += 1; return 1; });
  t.mock.method(globalThis, "clearTimeout", () => { timers -= 1; });
  const clock = createClockTicker(() => { ticks += 1; });
  clock.start();
  clock.start();
  assert.equal(timers, 1);
  clock.stop();
  clock.start();
  assert.equal(ticks, 2);
  clock.dispose();
  clock.start();
  assert.equal(timers, 0);
  assert.equal(ticks, 2);
});

test("stopping during a tick cannot schedule a new timer", (t) => {
  let timers = 0;
  t.mock.method(globalThis, "setTimeout", () => { timers += 1; return 1; });
  const clock = createClockTicker(() => clock.stop());
  clock.start();
  assert.equal(timers, 0);
});
