import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import * as shared from "@pinche/shared";
import * as reschedule from "../src/utils/sessionReschedule.js";
import * as correction from "../src/utils/sessionTimeCorrection.js";
import { normalizeAuthorPrivateSession } from "../src/utils/authorPrivateText.js";

const source = await readFile(new URL("../src/pages/session/manage.vue", import.meta.url), "utf8");
const script = source.match(/<script>([\s\S]*?)<\/script>/)[1]
  .replace(/import[\s\S]*?from\s*["'][^"']+["'];?/g, "")
  .replace("export default", "globalThis.page =");
const feedback = (await readFile(new URL("../src/utils/tdesignFeedback.js", import.meta.url), "utf8"))
  .replace(/export /g, "");

function harness({ modalFailure = false, requestFailure = null } = {}) {
  const modals = [];
  const modalErrors = [];
  const requests = [];
  const toasts = [];
  const context = vm.createContext({
    ...shared, ...reschedule, ...correction, normalizeAuthorPrivateSession, Date,
    AuthIdentityBar: {}, RoleSeatBoard: {}, ManagePinnedMessage: {}, FeedbackHost: {},
    sessionManageExtensions: [],
    getCurrentPages: () => [{ selectComponent: () => null }],
    ensureLoggedIn: async () => ({ user: { id: 7 } }),
    dataOf: (response) => response.data,
    uni: {
      showModal(options) {
        // Reproduced in WeChat: five Chinese characters cause showModal:fail.
        const oversized = [options.confirmText, options.cancelText]
          .some((text) => Array.from(text || "").length > 4);
        if (oversized || modalFailure) {
          const error = { errMsg: "showModal:fail cancelText length should not larger than 4 Chinese characters" };
          modalErrors.push(error);
          options.fail?.(error);
          return;
        }
        modals.push(options);
      },
      showToast(options) { toasts.push(options.title); }
    },
    async request(options) {
      requests.push(options);
      if (requestFailure) throw requestFailure;
      return { data: { session: { id: 42, organizer_user_id: 7, start_at: options.data.startAt } } };
    }
  });
  vm.runInContext(feedback, context);
  vm.runInContext(script, context);
  const definition = context.page;
  const state = definition.data();
  for (const [name, method] of Object.entries(definition.methods)) state[name] = method.bind(state);
  for (const [name, getter] of Object.entries(definition.computed)) {
    Object.defineProperty(state, name, { get: getter.bind(state) });
  }
  Object.assign(state, {
    sessionId: "42", currentUserId: 7,
    session: {
      id: 42, organizer_user_id: 7, session_purpose: "historical_record",
      start_at: "2026-09-03T13:00:00.000Z", seats: [{ id: 8, status: "confirmed" }]
    }
  });
  return { state, modals, modalErrors, requests, toasts };
}

async function settleConfirmation() {
  await new Promise((resolve) => setImmediate(resolve));
}

test("native confirmation saves September 3 13:00 and replaces the old 21:00 display", async () => {
  const run = harness();
  run.state.openHistoricalCorrectionPicker();
  assert.equal(run.state.historicalCorrectionValue, "2026-09-03 21:00");
  run.state.confirmHistoricalCorrectionSelection({ detail: { value: "2026-09-03 13:00" } });
  assert.equal(run.modalErrors.length, 0, "confirmation options must satisfy the real WeChat limit");
  assert.equal(run.modals.length, 1);
  assert.match(run.modals[0].content, /原时间：2026-09-03 21:00/);
  assert.match(run.modals[0].content, /新时间：2026-09-03 13:00/);
  assert.equal(run.requests.length, 0, "selection alone must wait for confirmation");
  run.modals[0].success({ confirm: true, cancel: false });
  await settleConfirmation();
  assert.equal(run.requests.length, 1);
  assert.equal(run.requests[0].url, "/api/sessions/42/start-time-corrections");
  assert.equal(run.requests[0].method, "POST");
  assert.equal(run.requests[0].data.startAt, "2026-09-03T05:00:00.000Z");
  assert.equal(run.state.formattedStartAt, "2026-09-03 13:00");
  assert.equal(run.state.session.seats[0].id, 8);
  assert.equal(run.state.busyAction, false);
  assert.equal(run.state.statusText, "历史时间已纠正。");
});

test("cancelling correction preserves the original time without a write", async () => {
  const run = harness();
  run.state.showHistoricalCorrectionConfirmation("2026-09-03T05:00:00.000Z");
  assert.equal(run.modals.length, 1);
  run.modals[0].success({ confirm: false, cancel: true });
  await settleConfirmation();
  assert.equal(run.requests.length, 0);
  assert.equal(run.state.formattedStartAt, "2026-09-03 21:00");
});

test("a failed confirmation dialog reports the problem instead of silently stopping", () => {
  const run = harness({ modalFailure: true });
  run.state.showHistoricalCorrectionConfirmation("2026-09-03T05:00:00.000Z");
  assert.equal(run.requests.length, 0);
  assert.equal(run.state.statusText, "确认框打开失败，请重新选择时间后重试。");
  assert.equal(run.state.busyAction, false);
});

test("failed correction keeps the previous time and does not report success", async () => {
  const run = harness({ requestFailure: new Error("Network unavailable") });
  run.state.showHistoricalCorrectionConfirmation("2026-09-03T05:00:00.000Z");
  assert.equal(run.modals.length, 1);
  run.modals[0].success({ confirm: true, cancel: false });
  await settleConfirmation();
  assert.equal(run.state.formattedStartAt, "2026-09-03 21:00");
  assert.equal(run.state.statusText, "时间纠错失败，请稍后重试。");
  assert.equal(run.toasts.length, 0);
  assert.equal(run.state.busyAction, false);
});
