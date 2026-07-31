import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const setup = readFileSync(
  new URL("../apps/miniprogram/src/pages/session/setup.vue", import.meta.url),
  "utf8"
);
const createFlow = readFileSync(
  new URL("../apps/miniprogram/src/utils/createFlow.js", import.meta.url),
  "utf8"
);
const authorPrivateText = readFileSync(
  new URL("../apps/miniprogram/src/utils/authorPrivateText.js", import.meta.url),
  "utf8"
);

function methodBody(source, name) {
  const match = source.match(new RegExp(`(?:async\\s+)?${name}\\s*\\([^)]*\\)\\s*\\{`));
  assert.ok(match && match.index !== undefined, `missing method ${name}`);
  const start = match.index + match[0].length;
  let depth = 1;
  for (let index = start; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(start, index);
  }
  assert.fail(`unterminated method ${name}`);
}

function assertBefore(source, first, second, message) {
  const firstIndex = source.indexOf(first);
  const secondIndex = source.indexOf(second);
  assert.ok(firstIndex >= 0 && secondIndex >= 0 && firstIndex < secondIndex, message);
}

assert.doesNotMatch(setup, /:start=["']today["']/);
for (const marker of [
  "TIME_PICKER_START",
  "TIME_PICKER_END",
  "当前为历史补录",
  "创建历史补录",
  "sessionPurpose",
  "creatorSeatId",
  "pendingHistoricalDraft"
]) {
  assert.ok(setup.includes(marker), `setup.vue missing ${marker}`);
}

for (const marker of [
  ":start=\"TIME_PICKER_START\"",
  ":end=\"TIME_PICKER_END\"",
  "当前为历史补录，仅用于记录已完成的车局，不会发布未来拼车。",
  "补录说明",
  "HISTORICAL_PINNED_PLACEHOLDER",
  "historicalCreateSettings",
  "submitPurposeChanged",
  "missingSeatPayloads",
  "historicalDraftFingerprint",
  "继续上次补录",
  "补录草稿已保留，点击重试继续初始化",
  "SESSION_PURPOSE_TIME_MISMATCH",
  "历史车局补录"
]) {
  assert.ok(setup.includes(marker), `setup.vue missing behavior marker ${marker}`);
}
assert.match(setup, /v-if=["']!isHistorical["']/);
assert.match(setup, /sessionPurpose:\s*this\.sessionPurpose/);
assert.match(setup, /creatorSeatId/);
assert.match(setup, /pendingHistoricalDraft:\s*null/);

assert.match(createFlow, /sessionPurpose:\s*flow\.sessionPurpose/);
assert.match(createFlow, /sessionPurpose:\s*decode\(options\.sessionPurpose\)/);
assert.match(authorPrivateText, /session_purpose:\s*content\.sessionPurpose/);

const createPublishedSession = methodBody(setup, "createPublishedSession");
assertBefore(
  createPublishedSession,
  "submitPurposeChanged",
  "ensureLoggedIn",
  "fresh purpose must be checked before login or network work"
);
assertBefore(
  createPublishedSession,
  "hasPendingHistoricalMismatch",
  "ensureLoggedIn",
  "pending draft mismatch must block before login or network work"
);
assertBefore(
  createPublishedSession,
  "persistPendingHistoricalDraft",
  "initializeHistoricalSession",
  "historical marker must be persisted before seat initialization"
);

const recoveryAction = methodBody(setup, "restorePendingHistoricalDraft");
assert.doesNotMatch(recoveryAction, /\brequest\s*\(/);
const historicalInitialization = methodBody(setup, "initializeHistoricalSession");
assertBefore(
  historicalInitialization,
  "recoveredHistoricalSessionMatches",
  "missingSeatPayloads",
  "recovered session identity must be checked before seat creation"
);
assertBefore(
  historicalInitialization,
  "missingSeatPayloads",
  "reloadedResponse",
  "missing seats must be reconciled before the final reload"
);
assertBefore(
  historicalInitialization,
  "resolveSelectedSeat",
  "creatorSeatId",
  "the selected seat must be resolved before historical publish"
);
assert.match(historicalInitialization, /if \(pinnedMessageText\)[\s\S]*\/chat\/pin/);
assert.match(historicalInitialization, /data:\s*\{ creatorSeatId \}/);
assert.doesNotMatch(historicalInitialization, /session-seats\/\$\{[^}]+\}\/claim/);
const historicalPublishIndex = historicalInitialization.indexOf(
  "`/api/sessions/${session.id}/publish`"
);
assert.ok(
  historicalPublishIndex >= 0 &&
    historicalInitialization.indexOf("clearPendingHistoricalDraft", historicalPublishIndex) >
      historicalPublishIndex,
  "the recovery marker must survive until publish succeeds"
);

const futureInitialization = methodBody(setup, "initializeFutureSession");
assertBefore(
  futureInitialization,
  "const selectedSeat",
  "`/api/sessions/${session.id}/publish`",
  "future selected seat must be resolved before publish"
);
assert.match(futureInitialization, /session-seats\/\$\{selectedSeat\.id\}\/claim/);

console.log("historical session backfill static contract passed");
