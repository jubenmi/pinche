import assert from "node:assert/strict";
import test from "node:test";

import {
  createPublicAlbumMediaStateController,
  createPublicAlbumReadState,
  isCurrentPublicAlbumGeneration,
  publicAlbumMediaStateBatches,
  reducePublicAlbumReadState,
} from "../src/utils/publicAlbumReadState.js";

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const entry of Object.values(value)) deepFreeze(entry);
  return Object.freeze(value);
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function fakeTimers() {
  let nextId = 1;
  const active = new Map();
  const scheduled = [];
  const cleared = [];
  return {
    active,
    scheduled,
    cleared,
    setTimer(callback, delay) {
      const id = nextId;
      nextId += 1;
      active.set(id, { callback, delay });
      scheduled.push({ id, callback, delay });
      return id;
    },
    clearTimer(id) {
      cleared.push(id);
      active.delete(id);
    },
    fire(id) {
      const timer = active.get(id);
      assert(timer, `timer ${id} must be active`);
      active.delete(id);
      return timer.callback();
    },
  };
}

test("INITIAL_PAGE replaces cards with strict stable IDs and resets page state", () => {
  const state = deepFreeze({
    cards: [{ id: 90 }],
    nextCursor: "old-cursor",
    pageLoading: true,
    pageError: "old error",
    generation: 4,
  });
  const firstCard = deepFreeze({ id: 1, label: "first" });
  const event = deepFreeze({
    type: "INITIAL_PAGE",
    cards: [
      firstCard,
      { id: 2 },
      { id: 1, label: "duplicate" },
      { id: "3" },
      { id: 0 },
    ],
    nextCursor: " c1 ",
  });

  const next = reducePublicAlbumReadState(state, event);

  assert.deepEqual(next, {
    cards: [firstCard, { id: 2 }],
    nextCursor: "c1",
    pageLoading: false,
    pageError: "",
    generation: 4,
  });
  assert.notStrictEqual(next, state);
});

test("NEXT_PAGE start and failure preserve cards and cursor", () => {
  const state = deepFreeze({
    cards: [{ id: 1 }],
    nextCursor: "c1",
    pageLoading: false,
    pageError: "prior",
    generation: 0,
  });

  const started = reducePublicAlbumReadState(state, {
    type: "NEXT_PAGE",
    status: "start",
  });
  assert.deepEqual(started, {
    ...state,
    pageLoading: true,
    pageError: "",
  });
  assert.strictEqual(started.cards, state.cards);

  const failed = reducePublicAlbumReadState(started, {
    type: "NEXT_PAGE",
    status: "failure",
  });
  assert.deepEqual(failed, {
    ...state,
    pageLoading: false,
    pageError: "继续加载失败，可重试。",
  });
  assert.strictEqual(failed.cards, state.cards);
});

test("NEXT_PAGE success appends unique cards in order and keeps old cards authoritative", () => {
  const originalSecond = deepFreeze({ id: 2, label: "old" });
  const state = deepFreeze({
    cards: [{ id: 1 }, originalSecond],
    nextCursor: "c1",
    pageLoading: true,
    pageError: "prior",
    generation: 0,
  });
  const event = deepFreeze({
    type: "NEXT_PAGE",
    status: "success",
    cards: [
      { id: 2, label: "incoming duplicate" },
      { id: 3 },
      { id: 3, label: "duplicate" },
      { id: "4" },
    ],
    nextCursor: " c2 ",
  });

  const next = reducePublicAlbumReadState(state, event);

  assert.deepEqual(next.cards.map(({ id }) => id), [1, 2, 3]);
  assert.strictEqual(next.cards[1], originalSecond);
  assert.equal(next.nextCursor, "c2");
  assert.equal(next.pageLoading, false);
  assert.equal(next.pageError, "");
});

test("NEXT_PAGE without an explicit status remains compatible with the planned success event", () => {
  const initial = reducePublicAlbumReadState(createPublicAlbumReadState(), {
    type: "INITIAL_PAGE",
    cards: [{ id: 1 }, { id: 2 }],
    nextCursor: "c1",
  });
  const appended = reducePublicAlbumReadState(initial, {
    type: "NEXT_PAGE",
    cards: [{ id: 2 }, { id: 3 }],
    nextCursor: "c2",
  });

  assert.deepEqual(appended.cards.map(({ id }) => id), [1, 2, 3]);
  assert.equal(appended.nextCursor, "c2");
});

test("MEDIA_PATCH updates or removes existing cards only, preserving order and cursor", () => {
  const state = deepFreeze({
    cards: [
      { id: 1, label: "old", stable: true },
      { id: 2, label: "remove" },
      { id: 3, label: "same" },
    ],
    nextCursor: "c2",
    pageLoading: true,
    pageError: "keep",
    generation: 2,
  });
  const event = deepFreeze({
    type: "MEDIA_PATCH",
    patches: [
      { id: 1, label: "new", preview_display_url: "fresh" },
      { id: 99, label: "must not append" },
      { id: "3", label: "must not coerce" },
    ],
    unavailableIds: [2, "3", 999],
  });

  const next = reducePublicAlbumReadState(state, event);

  assert.deepEqual(next.cards, [
    { id: 1, label: "new", stable: true, preview_display_url: "fresh" },
    { id: 3, label: "same" },
  ]);
  assert.equal(next.nextCursor, "c2");
  assert.equal(next.pageLoading, true);
  assert.equal(next.pageError, "keep");
  assert.equal(next.generation, 2);
});

test("NEXT_PAGE and MEDIA_PATCH completion order has the same semantics", () => {
  const initial = reducePublicAlbumReadState(createPublicAlbumReadState(), {
    type: "INITIAL_PAGE",
    cards: [{ id: 1, label: "old" }, { id: 2 }],
    nextCursor: "c1",
  });
  const nextPage = {
    type: "NEXT_PAGE",
    status: "success",
    cards: [{ id: 3 }],
    nextCursor: "c2",
  };
  const mediaPatch = {
    type: "MEDIA_PATCH",
    patches: [{ id: 1, label: "fresh" }],
    unavailableIds: [2],
  };

  const pageThenPatch = reducePublicAlbumReadState(
    reducePublicAlbumReadState(initial, nextPage),
    mediaPatch,
  );
  const patchThenPage = reducePublicAlbumReadState(
    reducePublicAlbumReadState(initial, mediaPatch),
    nextPage,
  );

  assert.deepEqual(pageThenPatch, patchThenPage);
  assert.deepEqual(pageThenPatch.cards, [
    { id: 1, label: "fresh" },
    { id: 3 },
  ]);
  assert.equal(pageThenPatch.nextCursor, "c2");
});

test("UNLOAD is terminal state data and invalidates the captured generation", () => {
  const state = deepFreeze({
    cards: [{ id: 1 }],
    nextCursor: "c1",
    pageLoading: true,
    pageError: "error",
    generation: 7,
  });
  const capturedGeneration = state.generation;
  const unloaded = reducePublicAlbumReadState(state, { type: "UNLOAD" });

  assert.deepEqual(unloaded, createPublicAlbumReadState(8));
  assert.equal(isCurrentPublicAlbumGeneration(state, capturedGeneration), true);
  assert.equal(isCurrentPublicAlbumGeneration(unloaded, capturedGeneration), false);
  assert.equal(isCurrentPublicAlbumGeneration(unloaded, 8), true);
});

test("unknown and malformed events are no-ops without mutating frozen inputs", () => {
  const state = deepFreeze({
    cards: [{ id: 1, label: "safe" }],
    nextCursor: "c1",
    pageLoading: false,
    pageError: "",
    generation: 1,
  });
  const events = [
    null,
    {},
    { type: "UNKNOWN", cards: [{ id: 2 }] },
    { type: "NEXT_PAGE", status: "malicious", cards: [{ id: 2 }] },
    { type: "NEXT_PAGE", status: "success", cards: null },
    { type: "MEDIA_PATCH", patches: null, unavailableIds: null },
  ].map(deepFreeze);

  for (const event of events) {
    const next = reducePublicAlbumReadState(state, event);
    assert.strictEqual(next, state);
  }
  assert.deepEqual(state.cards, [{ id: 1, label: "safe" }]);
});

test("media-state batches accept strict positive safe integer IDs and preserve first order", () => {
  const mediaIds = deepFreeze([
    3,
    1,
    3,
    "2",
    2,
    0,
    -1,
    1.5,
    Number.MAX_SAFE_INTEGER + 1,
  ]);

  assert.deepEqual(publicAlbumMediaStateBatches(mediaIds, 2), [
    [3, 1],
    [2],
  ]);
  assert.deepEqual(mediaIds, [
    3,
    1,
    3,
    "2",
    2,
    0,
    -1,
    1.5,
    Number.MAX_SAFE_INTEGER + 1,
  ]);
});

test("media-state batch limits are explicit positive integers no greater than 100", () => {
  assert.equal(publicAlbumMediaStateBatches([], 100).length, 0);
  assert.equal(publicAlbumMediaStateBatches([1, 2, 3], 100).length, 1);
  for (const limit of [0, -1, 1.5, "2", Infinity, 101]) {
    assert.throws(
      () => publicAlbumMediaStateBatches([1, 2], limit),
      /limit/i,
    );
  }
  assert.throws(
    () => publicAlbumMediaStateBatches("1,2", 2),
    /mediaIds/i,
  );
});

test("batch collection supports atomic refresh commits after every batch succeeds", async () => {
  const state = deepFreeze({
    cards: [{ id: 1 }, { id: 2 }, { id: 3 }],
    nextCursor: "c1",
    pageLoading: false,
    pageError: "",
    generation: 0,
  });
  let committed = state;
  const batches = publicAlbumMediaStateBatches(state.cards.map(({ id }) => id), 2);

  await assert.rejects(
    Promise.all(batches.map(async (batch, index) => {
      if (index === 1) throw new Error("batch failed");
      return { patches: batch.map((id) => ({ id, refreshed: true })) };
    })).then((results) => {
      committed = reducePublicAlbumReadState(committed, {
        type: "MEDIA_PATCH",
        patches: results.flatMap((result) => result.patches),
        unavailableIds: [],
      });
    }),
    /batch failed/,
  );

  assert.strictEqual(committed, state);
});

test("controller schedules once, 30 seconds before the earliest valid expiry", () => {
  const timers = fakeTimers();
  const nowMs = Date.parse("2026-07-26T00:00:00.000Z");
  const cards = [
    { id: 1, media_url_expires_at: "2026-07-26T00:05:00.000Z" },
    { id: 2, media_url_expires_at: "invalid" },
    { id: 3, media_url_expires_at: "2026-07-26T00:03:00.000Z" },
  ];
  const controller = createPublicAlbumMediaStateController({
    readCards: () => cards,
    refreshCards: async () => null,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    now: () => nowMs,
  });

  controller.schedule();
  assert.equal(timers.scheduled[0].delay, 150_000);
  assert.equal(timers.active.size, 1);

  controller.schedule();
  assert.equal(timers.active.size, 1);
  assert.deepEqual(timers.cleared, [1]);
});

test("controller bounds expired and far-future normal schedules to platform timer limits", () => {
  const nowMs = Date.parse("2026-07-26T00:00:00.000Z");
  const delayFor = (expiresAt) => {
    const timers = fakeTimers();
    const controller = createPublicAlbumMediaStateController({
      readCards: () => [{ id: 1, media_url_expires_at: expiresAt }],
      refreshCards: async () => null,
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
      now: () => nowMs,
    });
    controller.schedule();
    return timers.scheduled[0].delay;
  };

  assert.deepEqual([
    delayFor("2026-07-25T23:59:59.000Z"),
    delayFor(new Date(nowMs + 2_147_483_647 + 60_000).toISOString()),
  ], [
    1_000,
    2_147_483_647,
  ]);
});

test("consecutive successful timer refreshes cannot create a zero-delay storm", async () => {
  const timers = fakeTimers();
  const nowMs = Date.parse("2026-07-26T00:00:00.000Z");
  let calls = 0;
  const controller = createPublicAlbumMediaStateController({
    readCards: () => [{
      id: 1,
      media_url_expires_at: "2026-07-26T00:00:10.000Z",
    }],
    refreshCards: async () => {
      calls += 1;
      return null;
    },
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    now: () => nowMs,
  });

  controller.schedule();
  assert.equal(timers.scheduled[0].delay, 1_000);
  timers.fire(timers.scheduled[0].id);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 1);
  assert.equal(timers.scheduled[1].delay, 1_000);
  assert.equal(timers.active.size, 1);

  timers.fire(timers.scheduled[1].id);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 2);
  assert.equal(timers.scheduled[2].delay, 1_000);
  assert.equal(timers.active.size, 1);
  controller.dispose();
});

test("controller refresh is single-flight and schedules from freshly read cards", async () => {
  const response = deferred();
  const timers = fakeTimers();
  const nowMs = Date.parse("2026-07-26T00:00:00.000Z");
  let calls = 0;
  let cards = [{ id: 1, media_url_expires_at: "2026-07-26T00:05:00.000Z" }];
  const controller = createPublicAlbumMediaStateController({
    readCards: () => cards,
    refreshCards: async () => {
      calls += 1;
      const result = await response.promise;
      cards = result;
      return result;
    },
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    now: () => nowMs,
  });

  const first = controller.refresh();
  const second = controller.refresh();
  assert.strictEqual(first, second);
  await Promise.resolve();
  assert.equal(calls, 1);
  response.resolve([
    { id: 1, media_url_expires_at: "2026-07-26T00:10:00.000Z" },
  ]);
  assert.deepEqual(await first, cards);
  assert.equal(timers.scheduled.at(-1).delay, 570_000);
  assert.equal(timers.active.size, 1);
});

test("controller retries failures within platform timer bounds", async () => {
  const retryDelayFor = async (retryDelayMs) => {
    const timers = fakeTimers();
    const controller = createPublicAlbumMediaStateController({
      readCards: () => [],
      refreshCards: async () => {
        throw new Error("refresh failed");
      },
      retryDelayMs,
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
    });
    await assert.rejects(controller.refresh(), /refresh failed/);
    assert.equal(timers.active.size, 1);
    return timers.scheduled.at(-1).delay;
  };

  const delays = [];
  for (const value of [null, Infinity, "2000", 0, -5, Number.MAX_SAFE_INTEGER]) {
    delays.push(await retryDelayFor(value));
  }
  assert.deepEqual(delays, [
    30_000,
    30_000,
    30_000,
    1_000,
    1_000,
    2_147_483_647,
  ]);
});

test("dispose is terminal and an in-flight success cannot reorder a timer", async () => {
  const response = deferred();
  const timers = fakeTimers();
  let calls = 0;
  const controller = createPublicAlbumMediaStateController({
    readCards: () => [{
      id: 1,
      media_url_expires_at: "2099-01-01T00:00:00.000Z",
    }],
    refreshCards: async () => {
      calls += 1;
      return response.promise;
    },
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  });

  controller.schedule();
  const refresh = controller.refresh();
  await Promise.resolve();
  controller.dispose();
  assert.equal(timers.active.size, 0);
  response.resolve("late result");
  assert.equal(await refresh, "late result");
  assert.equal(timers.active.size, 0);

  controller.schedule();
  assert.equal(await controller.refresh(), null);
  assert.equal(calls, 1);
  assert.equal(timers.active.size, 0);
});

test("dispose during an in-flight failure prevents retry scheduling", async () => {
  const response = deferred();
  const timers = fakeTimers();
  const controller = createPublicAlbumMediaStateController({
    readCards: () => [],
    refreshCards: () => response.promise,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  });

  const refresh = controller.refresh();
  await Promise.resolve();
  controller.dispose();
  response.reject(new Error("late failure"));
  await assert.rejects(refresh, /late failure/);
  assert.equal(timers.active.size, 0);
  assert.equal(timers.scheduled.length, 0);
});

test("a rejecting timer callback is handled and leaves only one retry timer", async () => {
  const timers = fakeTimers();
  const controller = createPublicAlbumMediaStateController({
    readCards: () => [{
      id: 1,
      media_url_expires_at: "2026-07-26T00:00:10.000Z",
    }],
    refreshCards: async () => {
      throw new Error("timer refresh failed");
    },
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    now: () => Date.parse("2026-07-26T00:00:00.000Z"),
    retryDelayMs: 1_000,
  });
  const unhandled = [];
  const onUnhandled = (error) => unhandled.push(error);
  process.on("unhandledRejection", onUnhandled);
  try {
    controller.schedule();
    const timerId = timers.scheduled[0].id;
    assert.equal(timers.fire(timerId), undefined);
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(unhandled, []);
    assert.equal(timers.active.size, 1);
    assert.equal(timers.scheduled.at(-1).delay, 1_000);
  } finally {
    process.off("unhandledRejection", onUnhandled);
    controller.dispose();
  }
});
