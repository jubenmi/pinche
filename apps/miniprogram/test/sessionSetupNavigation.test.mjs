import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import * as shared from "@pinche/shared";
import * as creationTime from "../src/utils/sessionCreationTime.js";
import * as setup from "../src/utils/sessionSetup.js";
import { isAuthorPrivateText } from "../src/utils/authorPrivateText.js";

const source = await readFile(new URL("../src/pages/session/setup.vue", import.meta.url), "utf8");
const script = source.match(/<script>([\s\S]*?)<\/script>/)[1]
  .replace(/import[\s\S]*?from\s*["'][^"']+["'];?/g, "")
  .replace("export default", "globalThis.page =");

function harness({ historical = true, publishError, storageErrorAfterPublish = false, privateResult, reloadedStatus } = {}) {
  const requests = [];
  const navigations = [];
  let storedFlow = {};
  const session = {
    id: 81,
    store_id: 7,
    script_id: 9,
    start_at: historical ? "2020-07-30T11:30:00.000Z" : "2099-07-30T11:30:00.000Z",
    session_purpose: historical ? shared.HISTORICAL_RECORD : shared.FUTURE_CARPOOL,
    status: "draft",
    seats: []
  };
  const context = vm.createContext({
    ...shared, ...creationTime, ...setup, isAuthorPrivateText, Date,
    AuthIdentityBar: {}, FeedbackHost: {},
    createSessionCreationKey: () => "navigation-test-key",
    dataOf: (response) => response,
    ensureLoggedIn: async () => ({ user: { id: 5 } }),
    writeCreateFlow(patch) {
      if (storageErrorAfterPublish && session.status === "locked") throw new Error("Storage full");
      storedFlow = { ...storedFlow, ...patch };
    },
    uni: {
      redirectTo({ url }) { navigations.push(url); }
    },
    async request(options) {
      requests.push(options);
      const { url, method = "GET", data } = options;
      if (url === "/api/sessions" && method === "POST") return privateResult || session;
      if (url === "/api/sessions/81/seats" && method === "POST") {
        const seat = { id: 101 + session.seats.length, ...data };
        session.seats.push(seat);
        return seat;
      }
      if (url === "/api/sessions/81" && method === "GET") {
        if (reloadedStatus) session.status = reloadedStatus;
        return session;
      }
      if (url === "/api/sessions/81/publish" && method === "POST") {
        if (publishError) throw publishError;
        session.status = historical ? "locked" : "published";
        return session;
      }
      if (url === "/api/sessions/81/chat/pin" && method === "PATCH") return {};
      if (url === "/api/session-seats/101/claim" && method === "POST") return {};
      throw new Error(`Unexpected request: ${method} ${url}`);
    }
  });
  vm.runInContext(script, context);
  const definition = context.page;
  const state = definition.data();
  for (const [name, method] of Object.entries(definition.methods)) state[name] = method.bind(state);
  for (const [name, getter] of Object.entries(definition.computed)) {
    Object.defineProperty(state, name, { get: getter.bind(state) });
  }
  const roles = [{ id: "role-a", name: "阿梨", note: "侦探", roleGender: "female" }];
  Object.assign(state, {
    store: { id: 7, name: "测试店家" },
    script: { id: 9, name: "测试剧本", price_per_player: 198 },
    role: roles[0], roleOptions: roles, selectedRoles: roles,
    dateValue: historical ? "2020-07-30" : "2099-07-30",
    timeValue: "19:30", sessionPurpose: session.session_purpose,
    pinnedMessageText: "", creationIdempotencyKey: "navigation-test-key"
  });
  return { state, session, requests, navigations, get storedFlow() { return storedFlow; } };
}

test("historical creation publishes the selected role then opens the created car detail", async () => {
  const run = harness();
  await run.state.createPublishedSession();
  assert.equal(run.state.statusText, "");
  assert.equal(run.session.status, "locked");
  assert.deepEqual(JSON.parse(JSON.stringify(run.requests.find((item) => item.url.endsWith("/publish")).data)), { creatorSeatId: 101 });
  assert.deepEqual(run.navigations, ["/pages/session/detail?id=81"]);
  assert.equal(run.state.pendingHistoricalDraft, null);
  assert.equal(run.storedFlow.sessionId, 81);
  assert.equal(run.state.busyAction, false);
});

test("a recovered completed historical creation opens the car without publishing again", async () => {
  const run = harness();
  run.session.status = "locked";
  await run.state.createPublishedSession();
  assert.equal(run.state.statusText, "");
  assert.deepEqual(run.navigations, ["/pages/session/detail?id=81"]);
  assert.equal(run.requests.length, 1);
  assert.equal(run.state.pendingHistoricalDraft, null);
});

test("a draft completed during recovery opens the car without a second publish", async () => {
  const run = harness({ reloadedStatus: "locked" });
  // The reconciliation fetch can see a concurrent retry that already finished publishing.
  const descriptor = run.state.historicalDraftDescriptor();
  run.session.seats = descriptor.seatPayloads.map((payload, index) => ({ id: 101 + index, ...payload }));
  await run.state.createPublishedSession();
  assert.equal(run.state.statusText, "");
  assert.deepEqual(run.navigations, ["/pages/session/detail?id=81"]);
  assert.equal(run.requests.some((item) => item.url.endsWith("/publish")), false);
});

test("local storage failure after historical publish cannot strand the user on setup", async () => {
  const run = harness({ storageErrorAfterPublish: true });
  await run.state.createPublishedSession();
  assert.equal(run.session.status, "locked");
  assert.deepEqual(run.navigations, ["/pages/session/detail?id=81"]);
  assert.equal(run.state.pendingHistoricalDraft, null);
});

test("failed historical publish keeps the draft for retry and does not navigate", async () => {
  const run = harness({ publishError: new Error("Network unavailable") });
  await run.state.createPublishedSession();
  assert.deepEqual(run.navigations, []);
  assert.equal(run.state.pendingHistoricalDraft.sessionId, 81);
  assert.match(run.state.statusText, /点击重试/);
  assert.equal(run.state.busyAction, false);
});

test("a historical moderation draft stays recoverable without opening a nonexistent car", async () => {
  const run = harness({ privateResult: {
    draft_id: 91, content_ref: "text-proposal:91", publication_state: "author_only",
    moderation_status: "review", moderation_message: "仅自己可见 · 进一步审核",
    content: { is_draft: true }, can_edit: false, can_delete: true, can_resubmit: false
  } });
  await run.state.createPublishedSession();
  assert.deepEqual(run.navigations, []);
  assert.equal(run.requests.length, 1);
  assert.equal(run.state.pendingHistoricalDraft.sessionId, null);
  assert.equal(run.state.statusText, "仅自己可见 · 进一步审核");
});

test("future carpool creation still opens the sharing page", async () => {
  const run = harness({ historical: false });
  await run.state.createPublishedSession();
  assert.equal(run.state.statusText, "");
  assert.deepEqual(run.navigations, ["/pages/session/share?id=81"]);
});
