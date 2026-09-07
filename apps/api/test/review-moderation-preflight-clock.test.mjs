import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("../src/legacy-app.js", import.meta.url), "utf8");
function section(start, end) {
  return source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
}
const implementation = [
  section("function sessionTextSnapshot(", "async function currentActorTextSnapshot("),
  section("function assertReviewEligiblePreflight(", "async function currentSessionTextBase("),
  section("async function currentReviewTextBase(", "async function currentMessageTextBase("),
  section("async function moderateCoveredText(", "async function loadTextProposalActor(")
].join("\n");
const startAt = new Date("2026-09-07T11:30:00Z");

function harness({ appNow, databaseNow, cancelledAt = null, eligible = true } = {}) {
  let jobs = 0;
  let dbNow = new Date(databaseNow).getTime();
  const queries = [];
  const connection = { async query(sql) {
    queries.push(sql);
    if (sql.includes("FROM sessions")) return [[{
      id: 1, organizer_user_id: 7, script_id: 2, store_id: 3,
      start_at: startAt, status: cancelledAt ? "cancelled" : "recruiting",
      cancelled_at: cancelledAt,
      ...(sql.includes("AS session_started") ? { session_started: startAt.getTime() <= dbNow ? 1 : 0 } : {})
    }]];
    if (sql.includes("FROM signups AS signup")) return [[{
      id: 9, session_id: 1, user_id: 7, seat_id: 2, status: "approved",
      review_eligible_at: eligible ? new Date("2026-09-06T12:00:00Z") : null
    }]];
    if (sql.includes("FROM session_reviews")) return [[]];
    throw new Error(`Unexpected SQL: ${sql}`);
  } };
  class AppDate extends Date { static now() { return new Date(appNow).getTime(); } }
  const context = vm.createContext({
    Date: AppDate,
    forbidden: (message) => Object.assign(new Error(message), { statusCode: 403 }),
    currentActorTextSnapshot: async () => ({ id: 7 }),
    createTextBaseline: (value) => JSON.stringify(value),
    parseTextDraftReplacement: () => null, moderationBody: (body) => body,
    buildTextModerationDescriptor: (input) => input,
    resolveContentSecurityIntake: async () => ({ moderationRequired: true }),
    textProposalTargetSubjectId: () => "session:1",
    buildTextProposalPayload: (_action, payload) => payload,
    createTextMutationIdentity: () => ({ idempotencyKey: "review-request" }),
    textOperationSubjectId: () => "text-op:review-request",
    contentModeration: { moderateTextMutation: async () => { jobs += 1; return { id: 1 }; } },
    assertModeratedTextResult: (result) => result
  });
  vm.runInContext(implementation, context);
  context.captureTextModerationBase = () => context.currentReviewTextBase(connection, 1, 7);
  return {
    queries, jobs: () => jobs,
    setDatabaseNow(value) { dbNow = new Date(value).getTime(); },
    baseline: (forUpdate = false) => context.currentReviewTextBase(connection, 1, 7, { forUpdate }),
    submit: () => context.moderateCoveredText({
      request: {}, user: { user: { id: 7 } }, action: "create_session_review",
      body: { rating: 5, content: "很好玩" }, subjectId: "1", context: { sessionId: 1 }
    })
  };
}

test("review moderation accepts a started session when the database clock leads the app clock", async () => {
  const instance = harness({ appNow: "2026-09-07T11:29:00Z", databaseNow: "2026-09-07T11:31:00Z" });
  await instance.submit();
  assert.equal(instance.jobs(), 1);
});

test("review moderation rejects a future session before jobs when the app clock leads the database", async () => {
  const instance = harness({ appNow: "2026-09-07T11:31:00Z", databaseNow: "2026-09-07T11:29:00Z" });
  await assert.rejects(instance.submit(), { statusCode: 403 });
  assert.equal(instance.jobs(), 0);
});

test("review moderation opens exactly at the database start boundary", async () => {
  const instance = harness({ appNow: "2026-09-07T11:29:00Z", databaseNow: startAt });
  await instance.submit();
  assert.equal(instance.jobs(), 1);
  assert.match(instance.queries[0], /\(start_at <= CURRENT_TIMESTAMP\) AS session_started/);
});

test("review preflight preserves cancellation before start and signup eligibility restrictions", async () => {
  for (const options of [{ cancelledAt: new Date("2026-09-07T11:29:00Z") }, { eligible: false }]) {
    const instance = harness({ appNow: "2026-09-07T11:31:00Z", databaseNow: "2026-09-07T11:31:00Z", ...options });
    await assert.rejects(instance.submit(), { statusCode: 403 });
    assert.equal(instance.jobs(), 0);
  }
});

test("review preflight permits eligible participants when cancellation occurs at or after start", async () => {
  for (const cancelledAt of [startAt, new Date("2026-09-07T11:30:30Z")]) {
    const instance = harness({ appNow: "2026-09-07T11:29:00Z", databaseNow: "2026-09-07T11:31:00Z", cancelledAt });
    await instance.submit();
    assert.equal(instance.jobs(), 1);
  }
});

test("database clock passage does not change the review moderation baseline", async () => {
  const instance = harness({ appNow: "2026-09-07T11:31:00Z", databaseNow: "2026-09-07T11:29:00Z" });
  const beforeStart = await instance.baseline(true);
  instance.setDatabaseNow("2026-09-07T11:31:00Z");
  const afterStart = await instance.baseline();
  assert.equal(beforeStart, afterStart);
  assert.equal(Object.hasOwn(JSON.parse(afterStart).session, "session_started"), false);
});
