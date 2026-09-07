import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { readSessionDatabaseNow } from "../src/modules/core/session-creation-time.js";
import { normalizeSessionCreationStartAt } from "../src/modules/core/session-purpose.js";

const source = await readFile(new URL("../src/legacy-app.js", import.meta.url), "utf8");
const baseSource = source.slice(source.indexOf("async function currentSessionCreateTextBase("),
  source.indexOf("async function currentNpcRoleTextBase("));
const requestSource = source.slice(source.indexOf("async function moderateCoveredText("),
  source.indexOf("async function loadTextProposalActor("));

function harness() {
  let jobs = 0;
  const queries = [];
  const connection = { async query(sql) {
    queries.push(sql);
    if (sql.includes("CURRENT_TIMESTAMP")) return [[{ database_now: new Date("2026-09-07T11:30:00Z") }]];
    if (sql.includes("FROM stores")) return [[{ id: 1, name: "店家" }]];
    if (sql.includes("FROM scripts")) return [[{ id: 2, name: "剧本" }]];
    if (sql.includes("FROM script_npc_roles")) return [[]];
    throw new Error(`Unexpected SQL: ${sql}`);
  } };
  const context = vm.createContext({
    readSessionDatabaseNow, normalizeSessionCreationStartAt,
    currentActorTextSnapshot: async () => ({ id: 7, phone_verified: true }),
    assertCatalogSessionPreflight() {}, actorSessionCreateSnapshot: (actor) => actor,
    createTextBaseline: (value) => JSON.stringify(value),
    parseTextDraftReplacement: () => null, moderationBody: (body) => body,
    buildTextModerationDescriptor: (input) => input,
    resolveContentSecurityIntake: async () => ({ moderationRequired: true }),
    textProposalTargetSubjectId: () => "creation:create_session:7",
    buildTextProposalPayload: (_action, payload) => payload,
    createTextMutationIdentity: () => ({ idempotencyKey: "creation-request" }),
    textOperationSubjectId: () => "text-op:creation-request",
    contentModeration: { moderateTextMutation: async () => { jobs += 1; return { id: 1 }; } },
    assertModeratedTextResult: (result) => result
  });
  vm.runInContext(baseSource + requestSource, context);
  context.captureTextModerationBase = ({ user, body }) =>
    context.currentSessionCreateTextBase(connection, user.user.id, body);
  return {
    queries, jobs: () => jobs,
    submit: (startAt, sessionPurpose) => context.moderateCoveredText({
      request: {}, user: { user: { id: 7 } }, action: "create_session",
      body: { storeId: 1, scriptId: 2, startAt, sessionPurpose, note: "周末拼车" }
    })
  };
}

for (const startAt of ["2026-09-07 19:29:00", "2026-09-07T11:30:00Z", "not-a-date"]) {
  test(`moderated creation rejects ${startAt} before writing a moderation job`, async () => {
    const instance = harness();
    await assert.rejects(instance.submit(startAt), {
      code: startAt === "not-a-date" ? "INVALID_START_AT" : "SESSION_PURPOSE_TIME_MISMATCH"
    });
    assert.equal(instance.jobs(), 0);
  });
}

for (const startAt of ["2026-09-07 19:31:00", "2026-09-07T11:31:00Z"]) {
  test(`moderated creation permits future ${startAt} using the database clock`, async () => {
    const instance = harness();
    await instance.submit(startAt);
    assert.equal(instance.jobs(), 1);
    assert.equal(instance.queries.some((sql) => sql.includes("CURRENT_TIMESTAMP")), true);
  });
}


test("moderated historical creation retains the past-time path before moderation jobs", async () => {
  const instance = harness();
  await instance.submit("2020-01-01 19:30:00", "historical_record");
  assert.equal(instance.jobs(), 1);
});

test("moderated historical creation rejects a future time with the existing purpose error", async () => {
  const instance = harness();
  await assert.rejects(instance.submit("2099-01-01 19:30:00", "historical_record"), {
    code: "SESSION_PURPOSE_TIME_MISMATCH"
  });
  assert.equal(instance.jobs(), 0);
});
