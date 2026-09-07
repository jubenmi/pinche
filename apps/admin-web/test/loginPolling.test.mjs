import assert from "node:assert/strict";
import test from "node:test";
import { deferred, loadScriptSetup } from "./helpers/scriptSetup.mjs";

async function setup(overrides = {}) {
  const timers = new Map();
  const calls = { polls: [], stored: [], emitted: [], drawn: [] };
  let timerId = 0;
  let ticketId = 0;
  const panel = await loadScriptSetup(new URL("../src/components/LoginPanel.vue", import.meta.url), {
    window: {
      setInterval: (callback) => { timers.set(++timerId, callback); return timerId; },
      clearInterval: (id) => timers.delete(id)
    },
    QRCode: { toCanvas: async (_canvas, text) => { calls.drawn.push(text); } },
    defineEmits: () => (...args) => calls.emitted.push(args),
    createLoginTicket: async () => ({ ticketId: ++ticketId, qrText: `qr-${ticketId}` }),
    pollLoginTicket: async (ticket) => { calls.polls.push(ticket.ticketId); return { status: "pending" }; },
    setStoredAuth: (auth) => calls.stored.push(auth),
    ...overrides
  }, ["ticket", "status", "loading", "refreshTicket", "checkTicket"]);
  return { panel, timers, calls };
}

test("slow ticket polling never overlaps within the current QR generation", async () => {
  const response = deferred();
  let requests = 0;
  const { panel } = await setup({
    pollLoginTicket: () => { requests += 1; return response.promise; }
  });
  await panel.mount();
  const first = panel.checkTicket();
  const second = panel.checkTicket();
  response.resolve({ status: "pending" });
  await Promise.all([first, second]);
  assert.equal(requests, 1);
  panel.unmount();
});

for (const outcome of ["expired", "approved", "failed"]) {
  test(`old QR ${outcome} response cannot change the refreshed QR or stop its timer`, async () => {
    const oldResponse = deferred();
    const { panel, timers, calls } = await setup({ pollLoginTicket: () => oldResponse.promise });
    await panel.mount();
    const check = panel.checkTicket();
    await panel.refreshTicket();
    const nextTicket = panel.ticket.value.ticketId;
    if (outcome === "failed") oldResponse.reject(new Error("Old ticket failed"));
    else oldResponse.resolve({ status: outcome, token: outcome === "approved" ? "old-token" : undefined });
    await check;
    assert.equal(panel.ticket.value.ticketId, nextTicket);
    assert.equal(panel.status.value, "pending");
    assert.equal(timers.size, 1);
    assert.equal(calls.stored.length, 0);
    assert.equal(calls.emitted.length, 0);
    panel.unmount();
  });
}

test("refresh invalidates the old QR before ticket creation completes", async () => {
  const nextTicket = deferred();
  let creates = 0;
  let polls = 0;
  const { panel } = await setup({
    createLoginTicket: () => ++creates === 1
      ? Promise.resolve({ ticketId: 1, qrText: "one" }) : nextTicket.promise,
    pollLoginTicket: async () => { polls += 1; return { status: "pending" }; }
  });
  await panel.mount();
  const refresh = panel.refreshTicket();
  await panel.checkTicket();
  const statusWhileLoading = panel.status.value;
  nextTicket.resolve({ ticketId: 2, qrText: "two" });
  await refresh;
  assert.equal(polls, 0);
  assert.equal(statusWhileLoading, "loading");
  panel.unmount();
});

test("old poll cleanup cannot release the refreshed QR's in-flight guard", async () => {
  const oldResponse = deferred();
  const newResponse = deferred();
  const requestedIds = [];
  const { panel } = await setup({
    pollLoginTicket: (ticket) => {
      requestedIds.push(ticket.ticketId);
      return ticket.ticketId === 1 ? oldResponse.promise : newResponse.promise;
    }
  });
  await panel.mount();
  const oldCheck = panel.checkTicket();
  await panel.refreshTicket();
  const newCheck = panel.checkTicket();
  oldResponse.resolve({ status: "pending" });
  await oldCheck;
  const extraCheck = panel.checkTicket();
  newResponse.resolve({ status: "pending" });
  await Promise.all([newCheck, extraCheck]);
  assert.deepEqual(requestedIds, [1, 2]);
  panel.unmount();
});

test("unmount ignores an in-flight approval and prevents new polling", async () => {
  const response = deferred();
  const { panel, timers, calls } = await setup({ pollLoginTicket: () => response.promise });
  await panel.mount();
  const check = panel.checkTicket();
  panel.unmount();
  response.resolve({ status: "approved", token: "unmounted-token" });
  await check;
  assert.equal(calls.stored.length, 0);
  assert.equal(calls.emitted.length, 0);
  assert.equal(timers.size, 0);
});

test("unmount during ticket creation cannot draw or restart polling", async () => {
  const response = deferred();
  const { panel, timers, calls } = await setup({ createLoginTicket: () => response.promise });
  const mount = panel.mount();
  panel.unmount();
  response.resolve({ ticketId: 1, qrText: "unmounted-qr" });
  await mount;
  assert.equal(timers.size, 0);
  assert.equal(calls.drawn.length, 0);
});

test("current approval stores auth once and stops queued polls", async () => {
  const auth = { status: "approved", token: "new-token", user: { id: 7 }, roles: ["system_admin"] };
  const { panel, timers, calls } = await setup({ pollLoginTicket: async () => auth });
  await panel.mount();
  const queuedCallback = [...timers.values()][0];
  await panel.checkTicket();
  await queuedCallback();
  assert.deepEqual(calls.stored, [auth]);
  assert.deepEqual(calls.emitted, [["authenticated", auth]]);
  assert.equal(timers.size, 0);
  panel.unmount();
});

for (const status of ["expired", "consumed"]) {
  test(`current ${status} QR stops polling and remains refreshable`, async () => {
    const { panel, timers } = await setup({ pollLoginTicket: async () => ({ status }) });
    await panel.mount();
    await panel.checkTicket();
    assert.equal(panel.status.value, status);
    assert.equal(timers.size, 0);
    await panel.refreshTicket();
    assert.equal(panel.status.value, "pending");
    assert.equal(timers.size, 1);
    panel.unmount();
  });
}
