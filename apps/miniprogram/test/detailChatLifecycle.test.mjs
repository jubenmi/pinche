import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createClockTicker } from "@pinche/shared";
function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

const source = await readFile(new URL("../src/pages/session/detail.vue", import.meta.url), "utf8");
function method(name, async = false, indent = 4) {
  const prefix = " ".repeat(indent);
  const match = source.match(new RegExp(`${prefix}${async ? "async " : ""}${name}\\(\\) \\{[\\s\\S]*?\\n${prefix}\\},`));
  if (!match) return () => {};
  return new Function("createClockTicker", "getCurrentUser", `return ({${match[0].trim().slice(0, -1)}}).${name}`)(createClockTicker, () => ({ user: { id: 7 } }));
}
function state(loadSession = async () => true) {
  let starts = 0;
  let stops = 0;
  const page = {
    sessionId: "1", detailPageVisible: false,
    applyDetailAuthSnapshot() {}, activateDetailPage() {}, invalidateDetailPage() {},
    hideSessionShareMenu() {}, unobserveDetailAuthChanges() {}, reloadDetailProjection: loadSession,
    loadSessionReviews() {}, loadMyReviewState() {}, $nextTick: async (fn) => fn?.(),
    $refs: { sessionDetailExtensionRefs: [{ start: () => starts++, stop: () => stops++ }] },
    startDetailExtensions: method("startDetailExtensions"), stopDetailExtensions: method("stopDetailExtensions")
  };
  return { page, counts: () => ({ starts, stops }) };
}
test("returning to detail restarts extensions stopped on hide", async () => {
  const { page, counts } = state();
  method("onHide", false, 2).call(page);
  await method("onShow", true, 2).call(page);
  assert.deepEqual(counts(), { starts: 1, stops: 1 });
  method("onUnload", false, 2).call(page);
});
test("a late onShow load cannot restart chat after hiding again", async () => {
  const pending = deferred();
  const { page, counts } = state(() => pending.promise);
  const showing = method("onShow", true, 2).call(page);
  method("onHide", false, 2).call(page);
  pending.resolve(true);
  await showing;
  assert.deepEqual(counts(), { starts: 0, stops: 1 });
});
