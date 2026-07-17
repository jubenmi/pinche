import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  assertModeratedTextResult,
  moderatedTextHeaders,
  moderatedTextHttpStatus,
  normalizeError
} from "../src/server.js";

const authorPrivateDto = Object.freeze({
  draft_id: 51,
  content_ref: "text-proposal:51",
  publication_state: "author_only",
  moderation_status: "review",
  moderation_message: "仅自己可见 · 进一步审核",
  published_id: 12,
  content: { note: "新的说明" },
  can_edit: false,
  can_delete: true,
  can_resubmit: false
});

test("public moderation outcomes preserve only stable codes and safe messages", () => {
  const openidRequired = Object.assign(new Error("private producer text"), {
    code: "CONTENT_MODERATION_OPENID_REQUIRED",
    statusCode: 422
  });
  const rejected = Object.assign(new Error("provider labels must stay private"), {
    code: "CONTENT_MODERATION_REJECTED",
    statusCode: 422
  });
  const callbackStale = Object.assign(new Error("locked media changed while deciding"), {
    code: "CONTENT_MODERATION_CALLBACK_STALE",
    statusCode: 409
  });

  const normalizedOpenid = normalizeError(openidRequired);
  const normalizedRejected = normalizeError(rejected);
  const normalizedCallbackStale = normalizeError(callbackStale);
  assert.equal(normalizedOpenid.statusCode, 422);
  assert.equal(normalizedOpenid.code, "CONTENT_MODERATION_OPENID_REQUIRED");
  assert.equal(normalizedRejected.statusCode, 422);
  assert.equal(normalizedRejected.code, "CONTENT_MODERATION_REJECTED");
  assert.equal(normalizedCallbackStale.statusCode, 409);
  assert.equal(normalizedCallbackStale.code, "CONTENT_MODERATION_CALLBACK_STALE");
  assert.equal(normalizedOpenid.message.includes("private producer text"), false);
  assert.equal(normalizedRejected.message.includes("provider labels"), false);
  assert.equal(normalizedCallbackStale.message.includes("locked media"), false);
});

test("server routes all D45.5 text mutations through the shared WeChat moderation boundary", async () => {
  const [source, handlerSource] = await Promise.all([
    readFile(new URL("../src/server.js", import.meta.url), "utf8"),
    readFile(new URL("../src/modules/content-moderation/text-proposal-handlers.js", import.meta.url), "utf8")
  ]);

  assert.match(source, /createWechatContentSecurityClient/);
  assert.match(source, /createTextProposalApplicator/);
  assert.match(source, /createProductionTextProposalHandlers/);
  assert.match(source, /function moderateCoveredText/);
  assert.match(source, /function applyApprovedTextProposal/);
  assert.match(source, /applyTextProposal: \(connection, input\) => textProposalApplicator\.apply\(connection, input\)/);
  for (const action of [
    "update_nickname",
    "create_private_store",
    "create_private_script",
    "create_session",
    "update_session",
    "create_session_npc_role",
    "update_session_npc_role",
    "upsert_session_review"
  ]) {
    assert.match(handlerSource, new RegExp(`(?:action:\\s*)?"${action}"`));
  }
});

test("closed or unready text intake cannot fall back to a direct business write", async () => {
  const [source, talkRoutes] = await Promise.all([
    readFile(new URL("../src/server.js", import.meta.url), "utf8"),
    readFile(new URL("../../../packages/talk/api/routes.js", import.meta.url), "utf8")
  ]);
  const start = source.indexOf("async function moderateCoveredText");
  const end = source.indexOf("async function loadTextProposalActor", start);
  const moderate = source.slice(start, end);

  assert.match(moderate, /await resolveContentSecurityIntake\("text"\)/);
  assert.doesNotMatch(
    moderate,
    /!config\.contentModeration\.enabled\s*\|\|\s*!config\.contentModeration\.wechatTextEnabled/
  );
  assert.doesNotMatch(talkRoutes, /typeof moderateCoveredText === "function"[\s\S]{0,400}: null/);
  assert.match(talkRoutes, /D45 text moderation boundary must be configured/);
});

test("the text intake gate leaves profile-only updates outside the D45 text boundary", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  const start = source.indexOf("async function moderateCoveredText");
  const end = source.indexOf("async function loadTextProposalActor", start);
  const moderate = source.slice(start, end);
  const preflight = moderate.indexOf("const preflightDescriptor = buildTextModerationDescriptor");
  const intake = moderate.indexOf('await resolveContentSecurityIntake("text")');

  assert.doesNotMatch(moderate, /textIntakeMode === "legacy"/);
  assert.ok(preflight >= 0 && preflight < intake, "covered text must be identified before intake is closed");
  assert.match(moderate, /if \(!preflightDescriptor\) return null;/);
});

test("direct covered text locks settings and applies the business write on one transaction connection", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  const start = source.indexOf("async function moderateCoveredText");
  const end = source.indexOf("async function loadTextProposalActor", start);
  const moderate = source.slice(start, end);

  assert.match(moderate, /withTransaction\(async \(connection\)/);
  assert.match(moderate, /resolveContentSecurityIntake\("text", \{ connection \}\)/);
  assert.match(moderate, /applyDirectCoveredTextMutation\(connection/);
  assert.ok(
    moderate.indexOf('resolveContentSecurityIntake("text", { connection })') <
      moderate.indexOf("applyDirectCoveredTextMutation(connection"),
    "text must lock settings before any business-row write"
  );
});

test("NPC-role proposal application locks its role and parent session before revalidating ownership", async () => {
  const [source, handlerSource] = await Promise.all([
    readFile(new URL("../src/server.js", import.meta.url), "utf8"),
    readFile(new URL("../src/modules/content-moderation/text-proposal-handlers.js", import.meta.url), "utf8")
  ]);
  const helperStart = source.indexOf("async function currentNpcRoleTextBase");
  const helperEnd = source.indexOf("async function currentReviewTextBase", helperStart);
  const helper = source.slice(helperStart, helperEnd);
  const handlerStart = handlerSource.indexOf("async update_session_npc_role");
  const handlerEnd = handlerSource.indexOf("async upsert_session_review", handlerStart);
  const handler = handlerSource.slice(handlerStart, handlerEnd);

  assert.match(helper, /JOIN sessions AS session/);
  assert.match(helper, /createTextBaseline/);
  assert.doesNotMatch(helper, /UNIX_TIMESTAMP/);
  assert.match(helper, /FOR UPDATE/);
  assert.match(
    handler,
    /currentNpcRoleTextBase\([\s\S]{0,180}\{ forUpdate: true \}/
  );
});

test("initial missing session, NPC, message, and pin targets keep normal not-found handling", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  const slices = [
    ["async function currentSessionTextBase", "async function currentSessionCreateTextBase", /requireInitialTextModerationTarget\(session, "Session"\)/],
    ["async function currentNpcRoleTextBase", "async function currentReviewTextBase", /requireInitialTextModerationTarget\(role, "Session NPC role"\)/],
    ["async function currentMessageTextBase", "async function currentPinnedTextBase", /requireInitialTextModerationTarget\(session, "Session"\)/],
    ["async function currentPinnedTextBase", "async function captureTextModerationBase", /requireInitialTextModerationTarget\(row, "Session"\)/]
  ];

  for (const [startMarker, endMarker, expected] of slices) {
    const start = source.indexOf(startMarker);
    const end = source.indexOf(endMarker, start);
    assert.match(source.slice(start, end), expected);
  }
});

test("a cancelled session message is rejected during capture instead of after WeChat passes", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  const start = source.indexOf("async function currentMessageTextBase");
  const end = source.indexOf("async function currentPinnedTextBase", start);
  const helper = source.slice(start, end);

  assert.match(helper, /String\(session\.status\) === "cancelled"/);
  assert.match(helper, /throw badRequest\("Cancelled session cannot receive messages"\)/);
});

test("profile proposals apply only the canonical nickname/avatar/gender patch", async () => {
  const [handlerSource, profileSource] = await Promise.all([
    readFile(new URL("../src/modules/content-moderation/text-proposal-handlers.js", import.meta.url), "utf8"),
    readFile(new URL("../src/modules/content-moderation/text-profile-patch.js", import.meta.url), "utf8")
  ]);
  const start = handlerSource.indexOf("async update_nickname");
  const end = handlerSource.indexOf("async create_private_store", start);
  const handler = handlerSource.slice(start, end);

  assert.match(profileSource, /\["nickname", "avatarUrl", "gender"\]/);
  assert.match(handler, /profilePatchFromProposalBody\(payload\.body\)/);
  assert.match(handler, /kind: "user_profile"/);
  assert.match(profileSource, /avatar_url: actor\.avatarUrl/);
  assert.match(profileSource, /gender: String\(actor\.gender \|\| ""\)/);
});

test("each text moderation job uses an operation identity while retaining its real target in the proposal", async () => {
  const [source, handlerSource] = await Promise.all([
    readFile(new URL("../src/server.js", import.meta.url), "utf8"),
    readFile(new URL("../src/modules/content-moderation/text-proposal-handlers.js", import.meta.url), "utf8")
  ]);
  const moderateStart = source.indexOf("async function moderateCoveredText");
  const moderateEnd = source.indexOf("async function loadTextProposalActor", moderateStart);
  const moderate = source.slice(moderateStart, moderateEnd);

  assert.match(moderate, /textProposalTargetSubjectId/);
  assert.match(moderate, /targetSubjectId: proposalTargetId/);
  assert.match(moderate, /textOperationSubjectId/);
  assert.match(handlerSource, /String\(payload\?\.targetSubjectId \|\| ""\) !== target/);
  assert.match(handlerSource, /idempotencyKey: proposal\?\.idempotency_key/);
  assert.match(handlerSource, /currentNpcRoleTextBase\([\s\S]{0,180}\{ forUpdate: true \}/);
});

test("an enabled moderation route cannot fall through to a second business write", async () => {
  let businessWrites = 0;
  const routeResult = (moderated) => {
    const safe = assertModeratedTextResult(moderated);
    return safe ?? ++businessWrites;
  };

  assert.throws(() => routeResult(null), {
    code: "CONTENT_MODERATION_CONFIGURATION_ERROR"
  });
  assert.equal(businessWrites, 0);
  assert.deepEqual(routeResult(authorPrivateDto), authorPrivateDto);
  assert.equal(moderatedTextHttpStatus(authorPrivateDto, 201), 202);
  assert.deepEqual(moderatedTextHeaders(authorPrivateDto), {
    "cache-control": "private, no-store"
  });
  assert.equal(moderatedTextHttpStatus({ id: 88, kind: "create_private_store" }, 201), 201);
  assert.deepEqual(moderatedTextHeaders({ id: 88, kind: "create_private_store" }), {});
  assert.throws(() => assertModeratedTextResult({
    ...authorPrivateDto,
    provider_result: { label: "100" }
  }), { code: "CONTENT_MODERATION_CONFIGURATION_ERROR" });
  assert.deepEqual(routeResult({ id: 88, kind: "create_private_store" }), {
    id: 88,
    kind: "create_private_store"
  });
  assert.equal(businessWrites, 0);

  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  const moderateStart = source.indexOf("async function moderateCoveredText");
  const moderateEnd = source.indexOf("async function loadTextProposalActor", moderateStart);
  assert.match(
    source.slice(moderateStart, moderateEnd),
    /assertModeratedTextResult\(await contentModeration\.moderateTextMutation\(descriptor\)\)/
  );
  assert.doesNotMatch(source, /moderated \|\|/);
});

test("D46 server separates replacement control data and adapts only author-private outcomes to 202", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  const start = source.indexOf("async function moderateCoveredText");
  const end = source.indexOf("async function loadTextProposalActor", start);
  const moderate = source.slice(start, end);

  assert.match(moderate, /parseTextDraftReplacement\(body\)/);
  assert.match(moderate, /replacesDraftId/);
  assert.match(source, /moderatedTextHttpStatus\(moderated,/);
  assert.match(source, /moderatedTextHeaders\(moderated\)/);
  assert.doesNotMatch(moderate, /replaces[_A-Za-z]*Draft[^\n]*canonicalPayload/);
});

test("pseudo-chat routes use the same moderation boundary for messages and pins", async () => {
  const source = await readFile(
    new URL("../../../packages/talk/api/routes.js", import.meta.url),
    "utf8"
  );

  assert.match(source, /moderateCoveredText/);
  assert.match(source, /action: "create_session_message"/);
  assert.match(source, /action: "update_session_pinned_message"/);
});
