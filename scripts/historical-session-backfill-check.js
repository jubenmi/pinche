import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const historicalSmokeUrl = new URL("./historical-session-backfill-smoke.js", import.meta.url);
assert.ok(
  existsSync(historicalSmokeUrl),
  "historical lifecycle smoke script must exist"
);
const historicalSmoke = readFileSync(historicalSmokeUrl, "utf8");
const historicalSmokePath = fileURLToPath(historicalSmokeUrl);

function assertSmokeSyntax(smokePath, run = spawnSync) {
  const result = run(process.execPath, ["--check", smokePath], {
    encoding: "utf8"
  });
  assert.equal(
    result.status,
    0,
    `historical smoke syntax check failed: ${String(result.stderr || result.stdout || "")}`
  );
}

assertSmokeSyntax(historicalSmokePath);
assert.throws(
  () => assertSmokeSyntax(historicalSmokePath, () => ({
    status: 1,
    stderr: "synthetic smoke syntax failure"
  })),
  /synthetic smoke syntax failure/
);
const rootPackage = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8")
);

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
const detail = readFileSync(
  new URL("../apps/miniprogram/src/pages/session/detail.vue", import.meta.url),
  "utf8"
);
const manage = readFileSync(
  new URL("../apps/miniprogram/src/pages/session/manage.vue", import.meta.url),
  "utf8"
);
const album = readFileSync(
  new URL("../apps/miniprogram/src/pages/session/album.vue", import.meta.url),
  "utf8"
);
const calendar = readFileSync(
  new URL("../apps/miniprogram/src/components/SessionCalendar.vue", import.meta.url),
  "utf8"
);
const managePinnedMessage = readFileSync(
  new URL(
    "../apps/miniprogram/src/extensions/session-pseudo-chat/ManagePinnedMessage.vue",
    import.meta.url
  ),
  "utf8"
);
const coreService = readFileSync(
  new URL("../apps/api/src/modules/core/service.js", import.meta.url),
  "utf8"
);

function methodBody(source, name) {
  const match = source.match(
    new RegExp(`(?:export\\s+)?(?:async\\s+)?(?:function\\s+)?${name}\\s*\\([^)]*\\)\\s*\\{`)
  );
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

function objectMethodDefinition(source, name) {
  const match = source.match(new RegExp(`(?:async\\s+)?${name}\\s*\\([^)]*\\)\\s*\\{`));
  assert.ok(match && match.index !== undefined, `missing object method ${name}`);
  const openBraceIndex = match.index + match[0].lastIndexOf("{");
  const block = braceBlockAt(source, openBraceIndex, `unterminated object method ${name}`);
  return source.slice(match.index, block.end);
}

function compileObjectMethod(source, name, dependencies = {}) {
  const dependencyNames = Object.keys(dependencies);
  const factory = new Function(
    ...dependencyNames,
    `return ({ ${objectMethodDefinition(source, name)} }).${name};`
  );
  return factory(...dependencyNames.map((key) => dependencies[key]));
}

function namedFunctionDefinition(source, name) {
  const match = source.match(new RegExp(`function\\s+${name}\\s*\\([^)]*\\)\\s*\\{`));
  assert.ok(match && match.index !== undefined, `missing function ${name}`);
  const openBraceIndex = match.index + match[0].lastIndexOf("{");
  const block = braceBlockAt(source, openBraceIndex, `unterminated function ${name}`);
  return source.slice(match.index, block.end);
}

function compileNamedFunction(source, name, dependencies = {}) {
  const dependencyNames = Object.keys(dependencies);
  const factory = new Function(
    ...dependencyNames,
    `${namedFunctionDefinition(source, name)}; return ${name};`
  );
  return factory(...dependencyNames.map((key) => dependencies[key]));
}

function assertBefore(source, first, second, message) {
  const firstIndex = source.indexOf(first);
  const secondIndex = source.indexOf(second);
  assert.ok(firstIndex >= 0 && secondIndex >= 0 && firstIndex < secondIndex, message);
}

function pairedElementBlocks(source, tagName) {
  return source.match(new RegExp(`<${tagName}\\b[\\s\\S]*?<\\/${tagName}>`, "g")) || [];
}

function selfClosingElementBlocks(source, tagName) {
  return source.match(new RegExp(`<${tagName}\\b[^>]*?\\/>`, "g")) || [];
}

function requiredElement(blocks, marker, message) {
  const block = blocks.find((candidate) => candidate.includes(marker));
  assert.ok(block, message);
  return block;
}

function braceBlockAt(source, openBraceIndex, message) {
  assert.equal(source[openBraceIndex], "{", message);
  let depth = 1;
  for (let index = openBraceIndex + 1; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) {
      return { body: source.slice(openBraceIndex + 1, index), end: index + 1 };
    }
  }
  assert.fail(message);
}

function hasTopLevelReturn(source) {
  let braceDepth = 0;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const nextCharacter = source[index + 1];
    if (character === "/" && nextCharacter === "/") {
      index = source.indexOf("\n", index + 2);
      if (index < 0) return false;
      continue;
    }
    if (character === "/" && nextCharacter === "*") {
      const commentEnd = source.indexOf("*/", index + 2);
      if (commentEnd < 0) return false;
      index = commentEnd + 1;
      continue;
    }
    if (character === '"' || character === "'" || character === "`") {
      const quote = character;
      for (index += 1; index < source.length; index += 1) {
        if (source[index] === "\\") {
          index += 1;
          continue;
        }
        if (source[index] === quote) {
          break;
        }
      }
      continue;
    }
    if (character === "{") {
      braceDepth += 1;
      continue;
    }
    if (character === "}") {
      braceDepth = Math.max(0, braceDepth - 1);
      continue;
    }
    if (
      braceDepth === 0 &&
      source.startsWith("return", index) &&
      !/[\w$]/.test(source[index - 1] || "") &&
      !/[\w$]/.test(source[index + "return".length] || "")
    ) {
      return true;
    }
  }
  return false;
}

function leadingHistoricalReturnGuard(source, message) {
  const ifMatch = source.match(/^\s*if\s*\(/);
  assert.ok(ifMatch, message);
  const conditionStart = ifMatch[0].lastIndexOf("(");
  let depth = 1;
  let conditionEnd = -1;
  for (let index = conditionStart + 1; index < source.length; index += 1) {
    if (source[index] === "(") depth += 1;
    if (source[index] === ")") depth -= 1;
    if (depth === 0) {
      conditionEnd = index;
      break;
    }
  }
  assert.ok(conditionEnd > conditionStart, message);
  const condition = source.slice(conditionStart + 1, conditionEnd);
  assert.match(condition, /this\.isHistorical/, message);
  const openBraceIndex = source.indexOf("{", conditionEnd);
  const guard = braceBlockAt(source, openBraceIndex, message);
  assert.ok(hasTopLevelReturn(guard.body), message);
  return guard;
}

function assertLeadingHistoricalReturnBefore(source, effectNeedle, message) {
  const guard = leadingHistoricalReturnGuard(source, message);
  const effectIndex = source.indexOf(effectNeedle);
  assert.ok(effectIndex >= guard.end, message);
}

function assertReturnGuardBefore(source, conditionNeedle, effectNeedle, message) {
  const conditionIndex = source.indexOf(conditionNeedle);
  const effectIndex = source.indexOf(effectNeedle);
  assert.ok(conditionIndex >= 0 && effectIndex >= 0, message);
  const openBraceIndex = source.indexOf("{", conditionIndex + conditionNeedle.length);
  const guard = braceBlockAt(source, openBraceIndex, message);
  assert.ok(hasTopLevelReturn(guard.body), message);
  assert.ok(guard.end <= effectIndex, message);
}

function assertHistoricalOrganizerGuardsAroundAuth(source, authNeedle, effectNeedle, message) {
  const matches = Array.from(
    source.matchAll(
      /if\s*\(\s*this\.isHistorical\s*&&\s*!this\.isHistoricalOrganizer\s*\)\s*\{/g
    )
  );
  const authIndex = source.indexOf(authNeedle);
  const effectIndex = source.indexOf(effectNeedle, authIndex + authNeedle.length);
  assert.ok(matches.length >= 2 && authIndex >= 0 && effectIndex >= 0, message);
  const guards = matches.map((match) => {
    const openBraceIndex = match.index + match[0].lastIndexOf("{");
    const guard = braceBlockAt(source, openBraceIndex, message);
    assert.ok(hasTopLevelReturn(guard.body), message);
    return { start: match.index, ...guard };
  });
  assert.ok(guards[0].end <= authIndex, message);
  assert.ok(guards[1].start > authIndex && guards[1].end <= effectIndex, message);
}

function assertViewerOrganizerGuardsAroundAuth(source, authNeedle, effectNeedle, message) {
  const matches = Array.from(
    source.matchAll(/if\s*\([^)]*!this\.viewerIsOrganizer[^)]*\)\s*\{/g)
  );
  const authIndex = source.indexOf(authNeedle);
  const effectIndex = source.indexOf(effectNeedle, authIndex + authNeedle.length);
  assert.ok(matches.length >= 2 && authIndex >= 0 && effectIndex >= 0, message);
  const guards = matches.map((match) => {
    const openBraceIndex = match.index + match[0].lastIndexOf("{");
    const guard = braceBlockAt(source, openBraceIndex, message);
    assert.ok(hasTopLevelReturn(guard.body), message);
    return { start: match.index, ...guard };
  });
  assert.ok(guards[0].end <= authIndex, message);
  assert.ok(guards[1].start > authIndex && guards[1].end <= effectIndex, message);
}

function assertCalendarPurposeAndRouting(source) {
  const refresh = methodBody(source, "refreshCalendarItem");
  assert.match(
    refresh,
    /item\.sessionPurpose\s*=\s*[\s\S]*item\.session\?\.session_purpose[\s\S]*item\.signup\?\.session_purpose/,
    "calendar merged items must retain purpose from organizer and signup projections"
  );
  const action = methodBody(source, "handleCalendarAction");
  const historicalIndex = action.indexOf("isHistoricalSession");
  const ordinaryShareIndex = action.indexOf("goShare(item.sessionId)");
  assert.ok(historicalIndex >= 0 && historicalIndex < ordinaryShareIndex, "historical calendar routing must precede ordinary share");
  const historyIfIndex = action.lastIndexOf("if", historicalIndex);
  const historyConditionStart = action.indexOf("(", historyIfIndex);
  let conditionDepth = 1;
  let historyConditionEnd = -1;
  for (let index = historyConditionStart + 1; index < action.length; index += 1) {
    if (action[index] === "(") conditionDepth += 1;
    if (action[index] === ")") conditionDepth -= 1;
    if (conditionDepth === 0) {
      historyConditionEnd = index;
      break;
    }
  }
  assert.ok(historyConditionEnd > historyConditionStart, "historical calendar route condition");
  const historyOpenBrace = action.indexOf("{", historyConditionEnd);
  const historicalGuard = braceBlockAt(action, historyOpenBrace, "historical calendar route guard");
  assert.match(historicalGuard.body, /goAlbum\(item\.sessionId\)/);
  assert.match(historicalGuard.body, /\breturn\b[^;]*;/);
  assert.ok(historicalGuard.end <= ordinaryShareIndex, "historical calendar route must return before ordinary share");
}

function assertListMySignupsPurposeProjection(source) {
  const body = methodBody(source, "listMySignups");
  assert.match(
    body,
    /SELECT[\s\S]*session\.session_purpose[\s\S]*FROM signups signup/,
    "listMySignups must project persisted purpose in its signup SELECT"
  );
}

function assertMemberAlbumPurposeProjection(source) {
  const body = methodBody(source, "listSessionAlbum");
  assertBefore(
    body,
    "await requireSessionAlbumMember",
    "session_purpose: session.session_purpose",
    "member album purpose must only be returned after member ACL"
  );
  assertBefore(
    body,
    "await requireSessionAlbumMember",
    "organizer_user_id: session.organizer_user_id",
    "member album organizer must only be returned after member ACL"
  );
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
  "createSessionSetupSubmissionController",
  "createOrRecoverHistoricalDraft",
  "historicalPendingMatchesDescriptor",
  "primaryActionEnabled",
  "historicalCreationKey",
  "idempotencyKey",
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
assert.match(setup, /:disabled="busyAction \|\| !primaryActionEnabled"/);

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
  "createOrRecoverHistoricalDraft",
  "initializeHistoricalSession",
  "historical create/recovery coordination must finish before seat initialization"
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
assert.match(
  historicalInitialization,
  /resolveSelectedSeat\(\s*reloaded\.seats,\s*descriptor\.selectedSeatKey,\s*descriptor\.selectedSeatOccurrence/s
);
assert.doesNotMatch(
  historicalInitialization,
  /resolveSelectedSeat\([\s\S]*pendingHistoricalDraft\.selectedSeatKey/
);
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

for (const [name, source] of [
  ["detail.vue", detail],
  ["manage.vue", manage],
  ["album.vue", album],
  ["SessionCalendar.vue", calendar]
]) {
  assert.ok(source.includes("isHistoricalSession"), `${name} must use persisted session purpose`);
}

for (const marker of ["历史补录", "邀请同车成员补认", "待补认", "已补认"]) {
  assert.ok(
    `${detail}\n${manage}\n${album}\n${calendar}`.includes(marker),
    `historical surfaces missing ${marker}`
  );
}

const detailButtonBlocks = pairedElementBlocks(detail, "t-button");
const detailDirectShareButton = requiredElement(
  detailButtonBlocks,
  'open-type="share"',
  "detail direct share button must remain present for future sessions"
);
assert.match(
  detailDirectShareButton,
  /v-else-if="persistedSessionLoaded && !isHistorical"/,
  "detail direct sharing must stay hidden until persisted future purpose is loaded"
);
assert.match(detail, /uni\.hideShareMenu/);
assert.match(detail, /uni\.showShareMenu/);
assert.match(
  detail,
  /v-if="persistedSessionLoaded && !isHistorical && shareStats\.view_count !== undefined"/
);
assert.match(detail, /v-if="!isHistorical && canRequestRescheduleReminder"/);
const detailHistoricalInviteButton = requiredElement(
  detailButtonBlocks,
  "邀请同车成员补认",
  "detail historical invite button must remain present"
);
assert.match(detailHistoricalInviteButton, /v-if="isHistoricalOrganizer"/);
assert.match(detailHistoricalInviteButton, /@tap="goShare"/);
const detailAlbumPrimaryAction = methodBody(detail, "albumPrimaryAction");
assertBefore(
  detailAlbumPrimaryAction,
  "this.isHistorical",
  "this.isPostStart",
  "detail must keep the album primary for cancelled history before post-start status"
);
assert.match(detail, /v-if="albumPrimaryAction"[^>]*@tap="goAlbum"/);
assert.match(detail, /v-if="!albumPrimaryAction"[^>]*@tap="goAlbum"/);
assertHistoricalOrganizerGuardsAroundAuth(
  methodBody(detail, "goShare"),
  "ensureProtectedActionLogin",
  "uni.navigateTo",
  "historical detail invitation must guard non-organizers before and after login refresh"
);
assertHistoricalOrganizerGuardsAroundAuth(
  methodBody(detail, "goManage"),
  "ensureProtectedActionLogin",
  "uni.navigateTo",
  "historical detail management must guard non-organizers before and after login refresh"
);
assertBefore(
  methodBody(detail, "loadSession"),
  "syncSessionShareMenu",
  "return true",
  "detail must synchronize the share menu after each successful persisted session load"
);
assert.ok(
  methodBody(detail, "ensureProtectedActionLogin").includes("syncSessionShareMenu"),
  "protected detail login must not unconditionally expose the share menu"
);
assert.ok(
  methodBody(detail, "onShareAppMessage").includes("this.isHistorical"),
  "historical detail share callbacks must fail closed"
);
assert.ok(
  methodBody(detail, "onShareAppMessage").includes("persistedSessionLoaded"),
  "detail share callbacks must also fail closed before or after a persisted load"
);
assertBefore(
  methodBody(detail, "onLoad"),
  "this.hideSessionShareMenu()",
  "this.reloadDetailProjection(requestOwner",
  "detail must hide sharing while persisted purpose is still unknown"
);
for (const [helper, effect] of [
  ["loadShareStats", "request({"],
  ["trackShareView", "request({"],
  ["requestShareAction", "ensureProtectedActionLogin"]
]) {
  assertLeadingHistoricalReturnBefore(
    methodBody(detail, helper),
    effect,
    `detail ${helper} must return before ordinary sharing behavior for history`
  );
}
assertBefore(
  methodBody(detail, "detailSeatCards"),
  "this.persistedSessionLoaded",
  "openType",
  "detail role-card sharing must stay hidden until persisted purpose is loaded"
);
assertBefore(
  methodBody(detail, "detailSeatCards"),
  "!this.isHistorical",
  "openType",
  "historical detail role cards must not expose direct share buttons"
);
assertBefore(
  methodBody(detail, "statusLabel"),
  "isHistoricalSession(this.session)",
  "const labels",
  "detail historical status must precede ordinary status mapping"
);
assertBefore(
  methodBody(detail, "seatBoardSummary"),
  "this.isHistorical",
  "个可选",
  "detail historical seat summary must precede ordinary recruitment wording"
);
assertBefore(
  methodBody(detail, "detailNpcRoleSummary"),
  "this.isHistorical",
  "个可选",
  "detail historical NPC summary must precede ordinary recruitment wording"
);
for (const helper of [
  "canApplySeat",
  "canApplyNpcRole",
  "seatStateKind",
  "seatStatusLabel",
  "npcRoleStateKind",
  "npcRoleStatusLabel"
]) {
  leadingHistoricalReturnGuard(
    methodBody(detail, helper),
    `detail ${helper} must return from a leading purpose guard before ordinary seat/NPC state`
  );
}

assert.match(manage, /v-if="session\.id && !isHistorical" class="section"/);
const manageRoleSeatBoards = selfClosingElementBlocks(manage, "RoleSeatBoard");
const manageSignupBoard = requiredElement(
  manageRoleSeatBoards,
  'title="上车申请"',
  "manage signup board must remain present for future sessions"
);
assert.match(manageSignupBoard, /v-if="!isHistorical && session\.id"/);
assert.match(manage, /:session-purpose="session\.session_purpose"/);
const manageButtonBlocks = pairedElementBlocks(manage, "t-button");
const manageHistoricalInviteButton = requiredElement(
  manageButtonBlocks,
  "邀请同车成员补认",
  "manage historical invite button must remain present"
);
assert.match(
  manageHistoricalInviteButton,
  /v-if="isHistorical && viewerIsOrganizer"/
);
assert.match(manageHistoricalInviteButton, /@tap="goHistoricalShare"/);

const manageLoadSessionHarness = compileObjectMethod(manage, "loadSession", {
  request: async () => ({ data: { id: 91, organizer_user_id: 1 } }),
  dataOf: (response) => response.data,
  normalizeAuthorPrivateSession: (session) => session
});
const nonOrganizerManageContext = {
  currentUserId: 2,
  manageRequestGeneration: 1,
  session: { id: 77, organizer_user_id: 2 },
  signups: [{ id: 3 }],
  statusText: "",
  isCurrentManageRequest(owner) {
    return owner?.generation === this.manageRequestGeneration &&
      Number(owner?.userId) === Number(this.currentUserId);
  },
  clearManageProjection(message) {
    this.session = {};
    this.signups = [];
    this.statusText = message;
  },
  syncSessionSettings() {}
};
const nonOrganizerManageLoaded = await manageLoadSessionHarness.call(
  nonOrganizerManageContext,
  { generation: 1, userId: 2 }
);
assert.equal(nonOrganizerManageLoaded, false);
assert.deepEqual(nonOrganizerManageContext.session, {});
assert.deepEqual(nonOrganizerManageContext.signups, []);
assert.equal(nonOrganizerManageContext.statusText, "只有车头可以管理本车。");

const canTransferOrganizerHarness = compileObjectMethod(
  manage,
  "canTransferOrganizerToSeat"
);
assert.equal(
  canTransferOrganizerHarness.call(
    { isHistorical: true, session: { organizer_user_id: 1 } },
    { confirmed_user_id: 2 }
  ),
  false
);
const transferOrganizerHarness = compileObjectMethod(manage, "transferOrganizerToSeat");
const historicalTransferContext = {
  isHistorical: true,
  viewerIsOrganizer: true,
  loginCalls: 0,
  confirmCalls: 0,
  async ensureManageActionLogin() {
    this.loginCalls += 1;
    return { user: { id: 1 } };
  },
  confirmAction() {
    this.confirmCalls += 1;
  }
};
await transferOrganizerHarness.call(historicalTransferContext, {
  name: "角色二",
  confirmed_user_id: 2
});
assert.equal(historicalTransferContext.loginCalls, 0);
assert.equal(historicalTransferContext.confirmCalls, 0);

const albumLoadHarness = compileObjectMethod(album, "loadAlbum", {
  request: async () => {
    throw Object.assign(new Error("network failed"), { code: "NETWORK_FAILED" });
  },
  dataOf: (response) => response.data
});
const clearMemberAlbumProjectionHarness = compileObjectMethod(
  album,
  "clearMemberAlbumProjection"
);
const albumNetworkFailureContext = {
  timelineMode: false,
  currentUserId: 2,
  loadingAlbum: false,
  sessionId: 91,
  photos: [{ id: 7 }],
  people: [{ key: "seat:3" }],
  albumSession: { id: 91 },
  canUpload: true,
  hiddenCount: 4,
  activeFilter: "mine",
  selectedRoleFilter: "seat:3",
  statusText: "",
  mediaLoadSerial: 0,
  beginAlbumListRequest() {
    return 1;
  },
  isCurrentAlbumListRequest() {
    return true;
  },
  beginAlbumMemberRequest(listRequest) {
    return { id: 1, listRequest, userId: this.currentUserId };
  },
  isCurrentAlbumMemberRequest() {
    return true;
  },
  clearMemberAlbumProjection(message) {
    return clearMemberAlbumProjectionHarness.call(this, message);
  },
  applyAlbumNavigationTitle() {},
  albumMediaRefresh: { schedule() {} }
};
await albumLoadHarness.call(albumNetworkFailureContext);
assert.deepEqual(albumNetworkFailureContext.photos, []);
assert.deepEqual(albumNetworkFailureContext.people, []);
assert.equal(albumNetworkFailureContext.albumSession, null);
assert.equal(albumNetworkFailureContext.canUpload, false);
assert.equal(albumNetworkFailureContext.hiddenCount, 0);
assert.equal(albumNetworkFailureContext.activeFilter, "all");
assert.equal(albumNetworkFailureContext.selectedRoleFilter, "");

const beginAlbumMemberRequestHarness = compileObjectMethod(
  album,
  "beginAlbumMemberRequest"
);
const isCurrentAlbumMemberRequestHarness = compileObjectMethod(
  album,
  "isCurrentAlbumMemberRequest"
);
const invalidateAlbumMemberRequestsHarness = compileObjectMethod(
  album,
  "invalidateAlbumMemberRequests"
);
const applyAlbumAuthHarness = compileObjectMethod(album, "applyAlbumAuth");
const handleAlbumAuthChangeHarness = compileObjectMethod(
  album,
  "handleAlbumAuthChange"
);

function albumMemberHarnessContext(userId = 1) {
  return {
    timelineMode: false,
    sessionId: 91,
    currentUserId: userId,
    currentRoles: [],
    albumAuthGeneration: 1,
    suppressAlbumAuthReload: false,
    albumListRequestSerial: 0,
    albumLoadingOwner: null,
    loadingAlbum: false,
    photos: [{ id: 7 }],
    people: [{ key: "seat:3" }],
    albumSession: { id: 91 },
    canUpload: true,
    hiddenCount: 4,
    activeFilter: "mine",
    selectedRoleFilter: "seat:3",
    statusText: "",
    mediaLoadSerial: 0,
    beginAlbumListRequest() {
      this.albumListRequestSerial += 1;
      return this.albumListRequestSerial;
    },
    isCurrentAlbumListRequest(requestId) {
      return requestId === this.albumListRequestSerial;
    },
    beginAlbumMemberRequest() {
      return beginAlbumMemberRequestHarness.call(this);
    },
    isCurrentAlbumMemberRequest(requestOwner) {
      return isCurrentAlbumMemberRequestHarness.call(this, requestOwner);
    },
    invalidateAlbumMemberRequests() {
      return invalidateAlbumMemberRequestsHarness.call(this);
    },
    clearMemberAlbumProjection(message) {
      return clearMemberAlbumProjectionHarness.call(this, message);
    },
    handleAlbumAuthChange(auth) {
      return handleAlbumAuthChangeHarness.call(this, auth);
    },
    resetSingleMediaShareState() {},
    cancelSelectionMode() {},
    clearActiveAlbumShareState() {},
    clearAuthorPrivateAlbumState() {},
    applyAlbumNavigationTitle() {},
    albumMediaRefresh: { schedule() {} }
  };
}

let rejectOldAlbumRequest;
const oldAlbumFailure = new Promise((resolve, reject) => {
  rejectOldAlbumRequest = reject;
});
const staleAlbumFailureHarness = compileObjectMethod(album, "loadAlbum", {
  request: () => oldAlbumFailure,
  dataOf: (response) => response.data
});
const albumGuestDriftContext = albumMemberHarnessContext(1);
const staleAlbumFailure = staleAlbumFailureHarness.call(albumGuestDriftContext);
applyAlbumAuthHarness.call(albumGuestDriftContext, {});
rejectOldAlbumRequest(new Error("late account A failure"));
await staleAlbumFailure;
assert.equal(albumGuestDriftContext.currentUserId, "");
assert.deepEqual(albumGuestDriftContext.photos, []);
assert.deepEqual(albumGuestDriftContext.people, []);
assert.equal(albumGuestDriftContext.albumSession, null);
assert.equal(albumGuestDriftContext.loadingAlbum, false);

let resolveOldAlbumRequest;
const oldAlbumSuccess = new Promise((resolve) => {
  resolveOldAlbumRequest = resolve;
});
const staleAlbumSuccessHarness = compileObjectMethod(album, "loadAlbum", {
  request: () => oldAlbumSuccess,
  dataOf: (response) => response.data
});
const albumAccountDriftContext = albumMemberHarnessContext(1);
const staleAlbumSuccess = staleAlbumSuccessHarness.call(albumAccountDriftContext);
applyAlbumAuthHarness.call(albumAccountDriftContext, { user: { id: 2 }, roles: ["player"] });
resolveOldAlbumRequest({ data: { photos: [{ id: 88 }], can_upload: true } });
await staleAlbumSuccess;
assert.equal(albumAccountDriftContext.currentUserId, 2);
assert.deepEqual(albumAccountDriftContext.photos, []);
assert.deepEqual(albumAccountDriftContext.people, []);
assert.equal(albumAccountDriftContext.albumSession, null);

let resolveLatePeople;
const latePeopleResponse = new Promise((resolve) => {
  resolveLatePeople = resolve;
});
const stalePeopleHarness = compileObjectMethod(album, "loadPeople", {
  request: () => latePeopleResponse,
  dataOf: (response) => response.data
});
const stalePeopleContext = albumMemberHarnessContext(1);
stalePeopleContext.photos = [];
stalePeopleContext.people = [];
stalePeopleContext.albumSession = null;
stalePeopleContext.loadSessionPeopleFallback = async () => {
  throw new Error("stale people request must not start its fallback");
};
stalePeopleContext.mergePeople = (people) => people;
const stalePeopleOwner = stalePeopleContext.beginAlbumMemberRequest();
const stalePeopleLoad = stalePeopleHarness.call(stalePeopleContext, stalePeopleOwner);
applyAlbumAuthHarness.call(stalePeopleContext, { user: { id: 2 } });
resolveLatePeople({ data: { people: [{ key: "seat:99" }] } });
await stalePeopleLoad;
assert.deepEqual(stalePeopleContext.people, []);

let markFallbackStarted;
let resolveLateFallback;
const fallbackStarted = new Promise((resolve) => {
  markFallbackStarted = resolve;
});
const lateFallbackResponse = new Promise((resolve) => {
  resolveLateFallback = resolve;
});
const lateFallbackHarness = compileObjectMethod(album, "loadSessionPeopleFallback", {
  request: () => {
    markFallbackStarted();
    return lateFallbackResponse;
  },
  dataOf: (response) => response.data
});
const peopleBeforeLateFallbackHarness = compileObjectMethod(album, "loadPeople", {
  request: async () => ({ data: { people: [{ key: "seat:5" }] } }),
  dataOf: (response) => response.data
});
const staleFallbackContext = albumMemberHarnessContext(1);
staleFallbackContext.photos = [];
staleFallbackContext.people = [];
staleFallbackContext.albumSession = null;
staleFallbackContext.fallbackApplyCalls = 0;
staleFallbackContext.applyAlbumSessionFallback = () => {
  staleFallbackContext.fallbackApplyCalls += 1;
};
staleFallbackContext.sessionDetailPeople = () => [{ key: "seat:fallback" }];
staleFallbackContext.mergePeople = (people) => people;
staleFallbackContext.loadSessionPeopleFallback = (requestOwner) =>
  lateFallbackHarness.call(staleFallbackContext, requestOwner);
const staleFallbackOwner = staleFallbackContext.beginAlbumMemberRequest();
const staleFallbackLoad = peopleBeforeLateFallbackHarness.call(
  staleFallbackContext,
  staleFallbackOwner
);
await fallbackStarted;
applyAlbumAuthHarness.call(staleFallbackContext, { user: { id: 2 } });
resolveLateFallback({ data: { id: 91, seats: [{ id: 5 }] } });
await staleFallbackLoad;
assert.deepEqual(staleFallbackContext.people, []);
assert.equal(staleFallbackContext.albumSession, null);
assert.equal(staleFallbackContext.fallbackApplyCalls, 0);

const albumOnShowHarness = compileObjectMethod(album, "onShow", {
  getCurrentUser: () => ({ user: { id: 2 } })
});
const albumFullLoadLatchContext = {
  timelineMode: false,
  sessionId: 91,
  currentUserId: 2,
  albumRequiresFullLoad: true,
  loadingAlbum: true,
  fullLoadCalls: 0,
  mediaRefreshCalls: 0,
  handleAlbumAuthChange() {
    return false;
  },
  consumePreviewReturnRefreshSkip() {
    return false;
  },
  async loadAlbum() {
    this.fullLoadCalls += 1;
  },
  albumMediaRefresh: {
    async refresh() {
      albumFullLoadLatchContext.mediaRefreshCalls += 1;
    }
  }
};
await albumOnShowHarness.call(albumFullLoadLatchContext);
assert.equal(albumFullLoadLatchContext.fullLoadCalls, 0);
assert.equal(albumFullLoadLatchContext.mediaRefreshCalls, 0);
albumFullLoadLatchContext.loadingAlbum = false;
await albumOnShowHarness.call(albumFullLoadLatchContext);
assert.equal(albumFullLoadLatchContext.fullLoadCalls, 1);
assert.equal(albumFullLoadLatchContext.mediaRefreshCalls, 0);

const detailOnLoadRaceHarness = compileObjectMethod(detail, "onLoad", {
  getCurrentUser: () => ({ user: null }),
  getToken: () => "",
  authPrincipalOf: () => "guest"
});
const detailOnShowRaceHarness = compileObjectMethod(detail, "onShow", {
  getCurrentUser: () => ({ user: null })
});
const detailLifecycleReloads = [];
const detailLifecycleRaceContext = {
  sessionId: "",
  currentUserId: "",
  currentAuthPrincipal: "guest",
  pageGeneration: 0,
  detailRequestGeneration: 0,
  entry: "",
  shareCode: "",
  source: "",
  focusedSeatId: "",
  focusChatOnLoad: false,
  observeDetailAuthChanges() {},
  hideSessionShareMenu() {},
  applyDetailAuthSnapshot() {
    return false;
  },
  activateDetailPage() {
    this.pageGeneration += 1;
    this.detailRequestGeneration += 1;
    return {
      pageGeneration: this.pageGeneration,
      requestGeneration: this.detailRequestGeneration
    };
  },
  reloadDetailProjection(owner, options) {
    const pending = deferredResult();
    detailLifecycleReloads.push({ owner, options, pending });
    return pending.promise;
  }
};
const racedOnLoad = detailOnLoadRaceHarness.call(detailLifecycleRaceContext, { id: 91 });
const racedOnShow = detailOnShowRaceHarness.call(detailLifecycleRaceContext);
detailLifecycleReloads[1].pending.resolve(true);
await racedOnShow;
detailLifecycleReloads[0].pending.resolve(false);
await racedOnLoad;
assert.equal(
  detailLifecycleReloads[1].options.includeInitialShareContext,
  true,
  "the onShow winner must retain initial share stats and tracking work"
);

let resolveDetailAfterUnload;
const detailAfterUnloadResponse = new Promise((resolve) => {
  resolveDetailAfterUnload = resolve;
});
const detailLoadSessionHarness = compileObjectMethod(detail, "loadSession", {
  request: () => detailAfterUnloadResponse,
  dataOf: (response) => response.data,
  normalizeAuthorPrivateSession: (session) => session
});
const detailAfterUnloadContext = {
  sessionId: 91,
  session: {},
  pageActive: true,
  pageGeneration: 1,
  detailRequestGeneration: 1,
  persistedSessionLoaded: false,
  accessScope: "",
  loadStatusText: "",
  focusedSeatId: "",
  shareMenuWrites: 0,
  isCurrentDetailRequest(requestOwner) {
    return Boolean(
      this.pageActive &&
        requestOwner?.pageGeneration === this.pageGeneration &&
        requestOwner?.requestGeneration === this.detailRequestGeneration &&
        requestOwner?.sessionId === String(this.sessionId)
    );
  },
  hideSessionShareMenu() {
    this.shareMenuWrites += 1;
  },
  syncSessionShareMenu() {
    this.shareMenuWrites += 1;
  },
  clearProtectedDetail(message) {
    this.session = {};
    this.loadStatusText = message;
  }
};
const detailAfterUnloadLoad = detailLoadSessionHarness.call(detailAfterUnloadContext, {
  pageGeneration: 1,
  requestGeneration: 1,
  sessionId: "91"
});
detailAfterUnloadContext.pageActive = false;
detailAfterUnloadContext.pageGeneration += 1;
detailAfterUnloadContext.shareMenuWrites = 0;
resolveDetailAfterUnload({ data: { id: 91, script_name_snapshot: "迟到车局" } });
await detailAfterUnloadLoad;
assert.deepEqual(detailAfterUnloadContext.session, {});
assert.equal(detailAfterUnloadContext.shareMenuWrites, 0);

let resolveOlderDetail;
let rejectNewerDetail;
const olderDetailResponse = new Promise((resolve) => {
  resolveOlderDetail = resolve;
});
const newerDetailFailure = new Promise((resolve, reject) => {
  rejectNewerDetail = reject;
});
let detailRequestCall = 0;
const overlappingDetailLoadHarness = compileObjectMethod(detail, "loadSession", {
  request: () => {
    detailRequestCall += 1;
    return detailRequestCall === 1 ? olderDetailResponse : newerDetailFailure;
  },
  dataOf: (response) => response.data,
  normalizeAuthorPrivateSession: (session) => session
});
const overlappingDetailContext = {
  ...detailAfterUnloadContext,
  session: { id: 44, script_name_snapshot: "旧投影" },
  pageActive: true,
  pageGeneration: 5,
  detailRequestGeneration: 1,
  persistedSessionLoaded: false,
  loadStatusText: "",
  shareMenuWrites: 0
};
const olderDetailLoad = overlappingDetailLoadHarness.call(overlappingDetailContext, {
  pageGeneration: 5,
  requestGeneration: 1,
  sessionId: "91"
});
overlappingDetailContext.detailRequestGeneration = 2;
const newerDetailLoad = overlappingDetailLoadHarness.call(overlappingDetailContext, {
  pageGeneration: 5,
  requestGeneration: 2,
  sessionId: "91"
});
overlappingDetailContext.shareMenuWrites = 0;
rejectNewerDetail(new Error("newer request failed"));
await newerDetailLoad;
const menuWritesAfterNewerFailure = overlappingDetailContext.shareMenuWrites;
resolveOlderDetail({ data: { id: 91, script_name_snapshot: "旧成功" } });
await olderDetailLoad;
assert.deepEqual(overlappingDetailContext.session, {});
assert.equal(overlappingDetailContext.loadStatusText, "车详情加载失败，请稍后重试。");
assert.equal(overlappingDetailContext.shareMenuWrites, menuWritesAfterNewerFailure);

let resolveDetailLogin;
const detailLoginResponse = new Promise((resolve) => {
  resolveDetailLogin = resolve;
});
const protectedDetailLoginHarness = compileObjectMethod(
  detail,
  "ensureProtectedActionLogin",
  {
    ensureLoggedIn: () => detailLoginResponse,
    getCurrentUser: () => ({ user: null }),
    getToken: () => "",
    authPrincipalOf: () => "guest"
  }
);
const protectedDetailLoginContext = {
  pageActive: true,
  pageGeneration: 2,
  sessionId: 91,
  currentUserId: "",
  currentAuthPrincipal: "guest",
  detailAuthGeneration: 0,
  detailLoginContinuationNonce: 0,
  loadStatusText: "",
  loadSessionCalls: 0,
  beginDetailLoginContinuation() {
    this.detailLoginContinuationNonce += 1;
    return {
      nonce: this.detailLoginContinuationNonce,
      pageGeneration: this.pageGeneration,
      sessionId: String(this.sessionId),
      authGeneration: this.detailAuthGeneration,
      originPrincipal: this.currentAuthPrincipal
    };
  },
  isCurrentDetailLoginContinuation(owner) {
    return Boolean(
      this.pageActive &&
        owner?.nonce === this.detailLoginContinuationNonce &&
        owner?.pageGeneration === this.pageGeneration &&
        owner?.sessionId === String(this.sessionId)
    );
  },
  beginDetailRequest() {
    throw new Error("stale login continuation must not begin a detail request");
  },
  async loadSession() {
    this.loadSessionCalls += 1;
    return true;
  },
  async reloadDetailProjection() {
    this.loadSessionCalls += 1;
    return true;
  },
  isCurrentDetailRequest() {
    return false;
  },
  syncSessionShareMenu() {
    throw new Error("stale login continuation must not expose sharing");
  }
};
const protectedDetailLogin = protectedDetailLoginHarness.call(protectedDetailLoginContext);
protectedDetailLoginContext.pageActive = false;
protectedDetailLoginContext.pageGeneration += 1;
resolveDetailLogin({ user: { id: 3 } });
assert.equal(await protectedDetailLogin, null);
assert.equal(protectedDetailLoginContext.currentUserId, "");
assert.equal(protectedDetailLoginContext.loadSessionCalls, 0);

// Executable identity lifecycle harness. The method is compiled from the Vue option so
// auth-event invalidation cannot regress behind static source-shape assertions.
let detailHarnessAuth = { user: { id: 1 } };
let detailHarnessToken = "token-a";
const detailAuthPrincipalOf = (auth = {}, credential = undefined) => {
  const authenticated = credential === undefined
    ? Boolean(String(auth?.token || "").trim())
    : Boolean(String(credential || "").trim());
  return authenticated && auth?.user?.id ? `user:${auth.user.id}` : "guest";
};
const beginDetailRequestHarness = compileObjectMethod(detail, "beginDetailRequest");
const isCurrentDetailPageHarness = compileObjectMethod(detail, "isCurrentDetailPage");
const isCurrentDetailRequestHarness = compileObjectMethod(detail, "isCurrentDetailRequest");
const clearProtectedDetailHarness = compileObjectMethod(detail, "clearProtectedDetail");
const applyDetailAuthSnapshotHarness = compileObjectMethod(
  detail,
  "applyDetailAuthSnapshot",
  {
    getCurrentUser: () => detailHarnessAuth,
    getToken: () => detailHarnessToken,
    authPrincipalOf: detailAuthPrincipalOf
  }
);
const handleDetailAuthChangeHarness = compileObjectMethod(detail, "handleDetailAuthChange");
const beginDetailLoginContinuationHarness = compileObjectMethod(
  detail,
  "beginDetailLoginContinuation"
);
const isCurrentDetailLoginContinuationHarness = compileObjectMethod(
  detail,
  "isCurrentDetailLoginContinuation"
);
const detailExtensionKeyHarness = compileObjectMethod(detail, "detailExtensionKey");
const chatExtension = { id: "pseudo-chat" };
const chatKeyContext = {
  currentAuthPrincipal: "user:1",
  detailAuthGeneration: 0
};
const accountAChatKey = detailExtensionKeyHarness.call(chatKeyContext, chatExtension);
const sameUserRefreshedChatKey = detailExtensionKeyHarness.call(
  chatKeyContext,
  chatExtension
);
assert.equal(sameUserRefreshedChatKey, accountAChatKey);
chatKeyContext.currentAuthPrincipal = "guest";
chatKeyContext.detailAuthGeneration += 1;
const guestChatKey = detailExtensionKeyHarness.call(chatKeyContext, chatExtension);
assert.notEqual(guestChatKey, accountAChatKey);
chatKeyContext.currentAuthPrincipal = "user:2";
chatKeyContext.detailAuthGeneration += 1;
const accountBChatKey = detailExtensionKeyHarness.call(chatKeyContext, chatExtension);
assert.notEqual(accountBChatKey, accountAChatKey);
assert.notEqual(accountBChatKey, guestChatKey);
const retiredAccountAChat = { key: accountAChatKey, messages: [] };
const currentAccountBChat = { key: accountBChatKey, messages: [] };
retiredAccountAChat.messages.push({ id: "late-a-message" });
assert.deepEqual(currentAccountBChat.messages, []);
assert.match(detail, /:key="detailExtensionKey\(extension\)"/);

function detailIdentityHarnessContext(userId = 1) {
  return {
    sessionId: 91,
    session: { id: 91, script_name_snapshot: `账号${userId}车局` },
    pageActive: true,
    pageGeneration: 1,
    detailRequestGeneration: 0,
    detailAuthGeneration: 0,
    detailLoginContinuationNonce: 0,
    currentAuthPrincipal: `user:${userId}`,
    currentUserId: userId,
    persistedSessionLoaded: true,
    accessScope: "member",
    shareStats: { view_count: userId },
    reviews: [{ id: userId }],
    myReviewState: { can_review: true, review: { id: userId } },
    reviewStatusText: "",
    loadStatusText: "",
    focusedSeatId: "",
    clearCalls: 0,
    extensionStops: 0,
    hiddenMenus: 0,
    beginDetailRequest() {
      return beginDetailRequestHarness.call(this);
    },
    isCurrentDetailPage(owner) {
      return isCurrentDetailPageHarness.call(this, owner);
    },
    isCurrentDetailRequest(owner) {
      return isCurrentDetailRequestHarness.call(this, owner);
    },
    applyDetailAuthSnapshot(auth) {
      return applyDetailAuthSnapshotHarness.call(this, auth);
    },
    clearProtectedDetail(message, owner = null) {
      this.clearCalls += 1;
      return clearProtectedDetailHarness.call(this, message, owner);
    },
    stopDetailExtensions() {
      this.extensionStops += 1;
    },
    hideSessionShareMenu() {
      this.hiddenMenus += 1;
    },
    syncSessionShareMenu() {},
    beginDetailLoginContinuation() {
      return beginDetailLoginContinuationHarness.call(this);
    },
    isCurrentDetailLoginContinuation(owner) {
      return isCurrentDetailLoginContinuationHarness.call(this, owner);
    }
  };
}

function deferredResult() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

const oldAccountDetail = deferredResult();
const newAccountDetail = deferredResult();
const accountDetailResponses = [oldAccountDetail, newAccountDetail];
const identityDetailLoadHarness = compileObjectMethod(detail, "loadSession", {
  request: () => accountDetailResponses.shift().promise,
  dataOf: (response) => response.data,
  normalizeAuthorPrivateSession: (session) => session
});
const accountSwitchDetailContext = detailIdentityHarnessContext(1);
accountSwitchDetailContext.loadSession = (owner) =>
  identityDetailLoadHarness.call(accountSwitchDetailContext, owner);
accountSwitchDetailContext.reloadDetailProjection = (owner) =>
  accountSwitchDetailContext.loadSession(owner);
const oldAccountOwner = accountSwitchDetailContext.beginDetailRequest();
const oldAccountLoad = accountSwitchDetailContext.loadSession(oldAccountOwner);
detailHarnessAuth = { user: { id: 2, nickname: "B" } };
detailHarnessToken = "token-b";
const newAccountLoad = handleDetailAuthChangeHarness.call(
  accountSwitchDetailContext,
  detailHarnessAuth
);
assert.deepEqual(accountSwitchDetailContext.session, {});
assert.deepEqual(accountSwitchDetailContext.reviews, []);
assert.equal(accountSwitchDetailContext.currentUserId, 2);
assert.equal(accountSwitchDetailContext.currentAuthPrincipal, "user:2");
assert.equal(accountSwitchDetailContext.extensionStops, 1);
newAccountDetail.resolve({ data: { id: 91, script_name_snapshot: "B车局" } });
assert.equal(await newAccountLoad, true);
assert.equal(accountSwitchDetailContext.session.script_name_snapshot, "B车局");
oldAccountDetail.resolve({ data: { id: 91, script_name_snapshot: "A迟到车局" } });
assert.equal(await oldAccountLoad, false);
assert.equal(accountSwitchDetailContext.session.script_name_snapshot, "B车局");

const oldGuestDetail = deferredResult();
const guestDetailFailure = deferredResult();
const guestDetailResponses = [oldGuestDetail, guestDetailFailure];
const guestDetailLoadHarness = compileObjectMethod(detail, "loadSession", {
  request: () => guestDetailResponses.shift().promise,
  dataOf: (response) => response.data,
  normalizeAuthorPrivateSession: (session) => session
});
detailHarnessAuth = { user: { id: 1 } };
detailHarnessToken = "token-a";
const guestSwitchDetailContext = detailIdentityHarnessContext(1);
guestSwitchDetailContext.loadSession = (owner) =>
  guestDetailLoadHarness.call(guestSwitchDetailContext, owner);
guestSwitchDetailContext.reloadDetailProjection = (owner) =>
  guestSwitchDetailContext.loadSession(owner);
const oldGuestOwner = guestSwitchDetailContext.beginDetailRequest();
const oldGuestLoad = guestSwitchDetailContext.loadSession(oldGuestOwner);
detailHarnessAuth = { user: null };
detailHarnessToken = "";
const guestIdentityLoad = handleDetailAuthChangeHarness.call(
  guestSwitchDetailContext,
  detailHarnessAuth
);
assert.deepEqual(guestSwitchDetailContext.session, {});
assert.equal(guestSwitchDetailContext.currentUserId, "");
assert.equal(guestSwitchDetailContext.currentAuthPrincipal, "guest");
guestDetailFailure.reject(Object.assign(new Error("member only"), { statusCode: 404 }));
assert.equal(await guestIdentityLoad, false);
oldGuestDetail.resolve({ data: { id: 91, script_name_snapshot: "游客不可见的A车局" } });
assert.equal(await oldGuestLoad, false);
assert.deepEqual(guestSwitchDetailContext.session, {});

detailHarnessAuth = { user: { id: 2, nickname: "B更新" } };
detailHarnessToken = "rotated-token-b";
const sameUserContext = detailIdentityHarnessContext(2);
sameUserContext.reloadCalls = 0;
sameUserContext.reloadDetailProjection = async () => {
  sameUserContext.reloadCalls += 1;
  return true;
};
const sameUserAuthGeneration = sameUserContext.detailAuthGeneration;
assert.equal(
  await handleDetailAuthChangeHarness.call(sameUserContext, detailHarnessAuth),
  false
);
assert.equal(sameUserContext.clearCalls, 0);
assert.equal(sameUserContext.reloadCalls, 0);
assert.equal(sameUserContext.detailAuthGeneration, sameUserAuthGeneration);
assert.equal(sameUserContext.session.id, 91);

const lateReviews = deferredResult();
const lateMyReview = deferredResult();
const lateShareStats = deferredResult();
const secondaryDetailRequestHarness = (url) => {
  if (url.endsWith("/reviews")) return lateReviews.promise;
  if (url.endsWith("/review")) return lateMyReview.promise;
  if (url.endsWith("/share-stats")) return lateShareStats.promise;
  throw new Error(`unexpected detail secondary URL: ${url}`);
};
const loadSessionReviewsHarness = compileObjectMethod(detail, "loadSessionReviews", {
  request: ({ url }) => secondaryDetailRequestHarness(url),
  dataOf: (response) => response.data
});
const loadMyReviewStateHarness = compileObjectMethod(detail, "loadMyReviewState", {
  request: ({ url }) => secondaryDetailRequestHarness(url),
  dataOf: (response) => response.data
});
const loadShareStatsHarness = compileObjectMethod(detail, "loadShareStats", {
  request: ({ url }) => secondaryDetailRequestHarness(url),
  dataOf: (response) => response.data
});
const staleSecondaryContext = detailIdentityHarnessContext(1);
staleSecondaryContext.isHistorical = false;
const staleSecondaryOwner = staleSecondaryContext.beginDetailRequest();
const staleSecondaryLoads = [
  loadSessionReviewsHarness.call(staleSecondaryContext, staleSecondaryOwner),
  loadMyReviewStateHarness.call(staleSecondaryContext, staleSecondaryOwner),
  loadShareStatsHarness.call(staleSecondaryContext, staleSecondaryOwner)
];
staleSecondaryContext.detailAuthGeneration += 1;
staleSecondaryContext.detailRequestGeneration += 1;
staleSecondaryContext.currentAuthPrincipal = "user:2";
staleSecondaryContext.currentUserId = 2;
staleSecondaryContext.reviews = [{ id: "B-review" }];
staleSecondaryContext.myReviewState = { can_review: false, review: { id: "B-mine" } };
staleSecondaryContext.shareStats = { view_count: 200 };
lateReviews.resolve({ data: [{ id: "A-review" }] });
lateMyReview.resolve({ data: { can_review: true, review: { id: "A-mine" } } });
lateShareStats.resolve({ data: { view_count: 100 } });
await Promise.all(staleSecondaryLoads);
assert.deepEqual(staleSecondaryContext.reviews, [{ id: "B-review" }]);
assert.deepEqual(staleSecondaryContext.myReviewState, {
  can_review: false,
  review: { id: "B-mine" }
});
assert.deepEqual(staleSecondaryContext.shareStats, { view_count: 200 });

const lateTrackedView = deferredResult();
const trackShareViewHarness = compileObjectMethod(detail, "trackShareView", {
  request: () => lateTrackedView.promise
});
const staleTrackingContext = detailIdentityHarnessContext(1);
staleTrackingContext.isHistorical = false;
staleTrackingContext.shareCode = "share-a";
staleTrackingContext.source = "wechat_share";
staleTrackingContext.focusedSeatId = "";
staleTrackingContext.shareStatsLoads = 0;
staleTrackingContext.loadShareStats = async () => {
  staleTrackingContext.shareStatsLoads += 1;
  return true;
};
const staleTrackingOwner = staleTrackingContext.beginDetailRequest();
const staleTrackingLoad = trackShareViewHarness.call(
  staleTrackingContext,
  staleTrackingOwner
);
staleTrackingContext.pageActive = false;
staleTrackingContext.pageGeneration += 1;
lateTrackedView.resolve({ data: { ok: true } });
assert.equal(await staleTrackingLoad, false);
assert.equal(staleTrackingContext.shareStatsLoads, 0);

const overlappingShareViewPost = deferredResult();
const overlappingShareViewPostStarted = deferredResult();
let overlappingShareViewPostCalls = 0;
const overlappingTrackShareViewHarness = compileObjectMethod(detail, "trackShareView", {
  request: () => {
    overlappingShareViewPostCalls += 1;
    if (overlappingShareViewPostCalls === 1) {
      overlappingShareViewPostStarted.resolve();
      return overlappingShareViewPost.promise;
    }
    return Promise.resolve({ data: { ok: true } });
  }
});
const reloadDetailProjectionHarness = compileObjectMethod(
  detail,
  "reloadDetailProjection"
);
const overlappingShareContext = detailIdentityHarnessContext(1);
overlappingShareContext.isHistorical = false;
overlappingShareContext.shareCode = "share-overlap";
overlappingShareContext.source = "wechat_share";
overlappingShareContext.focusedSeatId = "";
overlappingShareContext.detailShareViewTrackStarted = false;
overlappingShareContext.detailInitialShareStatsPending = true;
overlappingShareContext.relinkSessionMembership = async () => true;
overlappingShareContext.loadSession = async (owner) =>
  overlappingShareContext.isCurrentDetailRequest(owner);
overlappingShareContext.loadSessionReviews = async (owner) =>
  overlappingShareContext.isCurrentDetailRequest(owner);
overlappingShareContext.loadMyReviewState = async (owner) =>
  overlappingShareContext.isCurrentDetailRequest(owner);
const overlappingShareStatsOwners = [];
overlappingShareContext.loadShareStats = async (owner) => {
  if (!overlappingShareContext.isCurrentDetailRequest(owner)) {
    return false;
  }
  overlappingShareStatsOwners.push({
    principal: owner.principal,
    requestGeneration: owner.requestGeneration
  });
  overlappingShareContext.shareStats = {
    loaded_for: owner.principal,
    request_generation: owner.requestGeneration
  };
  return true;
};
overlappingShareContext.trackShareView = (owner) =>
  overlappingTrackShareViewHarness.call(overlappingShareContext, owner);
const firstShareOwner = overlappingShareContext.beginDetailRequest();
const firstShareTrack = overlappingShareContext.trackShareView(firstShareOwner);
await overlappingShareViewPostStarted.promise;
const winningShareOwner = overlappingShareContext.beginDetailRequest();
assert.equal(
  await overlappingShareContext.trackShareView(winningShareOwner),
  false,
  "a superseding detail owner must not claim an already-started page view"
);
const winningShareReload = reloadDetailProjectionHarness.call(
  overlappingShareContext,
  winningShareOwner,
  { includeInitialShareContext: true }
);
assert.equal(await winningShareReload, true);
assert.equal(
  overlappingShareViewPostCalls,
  1,
  "a superseding detail owner must not POST the same share view twice"
);
assert.deepEqual(overlappingShareContext.shareStats, {
  loaded_for: "user:1",
  request_generation: winningShareOwner.requestGeneration
});
overlappingShareViewPost.resolve({ data: { ok: true } });
assert.equal(await firstShareTrack, false);

overlappingShareContext.reloadDetailProjection = (owner, options) =>
  reloadDetailProjectionHarness.call(overlappingShareContext, owner, options);
detailHarnessAuth = { user: { id: 2, nickname: "B" } };
detailHarnessToken = "token-b-share-race";
assert.equal(
  await handleDetailAuthChangeHarness.call(
    overlappingShareContext,
    detailHarnessAuth
  ),
  true
);
assert.equal(
  overlappingShareViewPostCalls,
  1,
  "an identity refresh must GET fresh stats without repeating the page view POST"
);
assert.deepEqual(overlappingShareStatsOwners.at(-1), {
  principal: "user:2",
  requestGeneration: overlappingShareContext.detailRequestGeneration
});
const shareStatsLoadsAfterIdentitySwitch = overlappingShareStatsOwners.length;
detailHarnessAuth = { user: { id: 2, nickname: "B refreshed" } };
detailHarnessToken = "token-b-share-race-rotated";
assert.equal(
  await handleDetailAuthChangeHarness.call(
    overlappingShareContext,
    detailHarnessAuth
  ),
  false
);
assert.equal(overlappingShareViewPostCalls, 1);
assert.equal(
  overlappingShareStatsOwners.length,
  shareStatsLoadsAfterIdentitySwitch,
  "a same-user credential refresh must not reload or repeat share tracking"
);

const olderLoginResult = deferredResult();
const newerLoginResult = deferredResult();
let detailLoginCall = 0;
const dualProtectedLoginHarness = compileObjectMethod(
  detail,
  "ensureProtectedActionLogin",
  {
    ensureLoggedIn: () => {
      detailLoginCall += 1;
      return detailLoginCall === 1 ? olderLoginResult.promise : newerLoginResult.promise;
    },
    getCurrentUser: () => detailHarnessAuth,
    getToken: () => detailHarnessToken,
    authPrincipalOf: detailAuthPrincipalOf
  }
);
detailHarnessAuth = { user: null };
detailHarnessToken = "";
const dualLoginContext = detailIdentityHarnessContext(1);
dualLoginContext.currentAuthPrincipal = "guest";
dualLoginContext.currentUserId = "";
dualLoginContext.session = {};
dualLoginContext.persistedSessionLoaded = false;
dualLoginContext.loadCalls = 0;
dualLoginContext.reloadDetailProjection = async (owner) => {
  if (!dualLoginContext.isCurrentDetailRequest(owner)) {
    return false;
  }
  dualLoginContext.loadCalls += 1;
  dualLoginContext.session = {
    id: 91,
    principal: dualLoginContext.currentAuthPrincipal
  };
  return true;
};
const olderLogin = dualProtectedLoginHarness.call(dualLoginContext);
const newerLogin = dualProtectedLoginHarness.call(dualLoginContext);
detailHarnessAuth = { user: { id: 2 } };
detailHarnessToken = "token-b";
dualLoginContext.applyDetailAuthSnapshot(detailHarnessAuth);
newerLoginResult.resolve({ user: { id: 2 }, token: "token-b" });
assert.equal((await newerLogin)?.user?.id, 2);
assert.equal(dualLoginContext.loadCalls, 1);
const stateAfterNewerLogin = {
  currentUserId: dualLoginContext.currentUserId,
  currentAuthPrincipal: dualLoginContext.currentAuthPrincipal,
  session: { ...dualLoginContext.session },
  loadCalls: dualLoginContext.loadCalls
};
detailHarnessAuth = { user: { id: 1 } };
detailHarnessToken = "token-a";
olderLoginResult.resolve({ user: { id: 1 }, token: "token-a" });
assert.equal(await olderLogin, null);
assert.deepEqual(
  {
    currentUserId: dualLoginContext.currentUserId,
    currentAuthPrincipal: dualLoginContext.currentAuthPrincipal,
    session: { ...dualLoginContext.session },
    loadCalls: dualLoginContext.loadCalls
  },
  stateAfterNewerLogin
);

assert.match(detail, /AUTH_CHANGE_EVENT/);
assert.match(detail, /uni\.\$on\(AUTH_CHANGE_EVENT, this\.handleDetailAuthChange\)/);
assert.match(detail, /uni\.\$off\(AUTH_CHANGE_EVENT, this\.handleDetailAuthChange\)/);
for (const helper of [
  "loadSessionReviews",
  "loadMyReviewState",
  "loadShareStats",
  "trackShareView"
]) {
  assert.match(
    methodBody(detail, helper),
    /isCurrentDetailRequest\(requestOwner\)/,
    `${helper} must bind reads and writes to the current detail owner`
  );
}

assertBefore(
  methodBody(manage, "reload"),
  "this.isHistorical",
  "loadSignups",
  "manage must skip signup loading for historical sessions"
);
assertReturnGuardBefore(
  methodBody(manage, "loadSignups"),
  "if (this.isHistorical)",
  "request({",
  "loadSignups itself must return before historical signup requests"
);
for (const [helper, effect] of [
  ["openReschedulePicker", "this.rescheduleValue"],
  ["confirmRescheduleSelection", "const selectedValue"],
  ["showRescheduleConfirmation", "const memberCount"],
  ["rescheduleSession", "ensureManageActionLogin"],
  ["setJoinPolicy", "this.joinPolicy ="],
  ["setJoinPhoneRequired", "this.joinPhoneRequired ="],
  ["setNpcJoinEnabled", "this.npcJoinEnabled ="],
  ["updateSessionSettings", "ensureManageActionLogin"],
  ["approve", "ensureManageActionLogin"],
  ["reject", "ensureManageActionLogin"],
  ["subscribeSignupReminder", "ensureManageActionLogin"],
  ["handleSignupAction", "const signup"],
  ["closeNpcRole", "ensureManageActionLogin"],
  ["openNpcRole", "ensureManageActionLogin"]
]) {
  assertLeadingHistoricalReturnBefore(
    methodBody(manage, helper),
    effect,
    `manage ${helper} must return before future-only effects for history`
  );
}
assertReturnGuardBefore(
  methodBody(manage, "kickSeat"),
  "if (this.isHistorical)",
  "this.isOnboardSeat",
  "historical seat removal must return before ordinary kick handling"
);
leadingHistoricalReturnGuard(
  methodBody(manage, "handleNpcRoleManagement"),
  "historical NPC management must return before ordinary open/close handling"
);
assertViewerOrganizerGuardsAroundAuth(
  methodBody(manage, "goHistoricalShare"),
  "ensureManageActionLogin",
  "uni.navigateTo",
  "historical invite navigation must verify the organizer before and after auth"
);
const manageLoadSession = methodBody(manage, "loadSession");
assertBefore(
  manageLoadSession,
  'this.statusText = ""',
  "return true",
  "successful historical manage reload must clear a stale load error"
);
assert.match(manageLoadSession, /this\.clearManageProjection/);
assert.match(
  methodBody(manage, "clearManageProjection"),
  /this\.session = \{\}[\s\S]*this\.signups = \[\]/
);
for (const [helper, ordinaryNeedle] of [
  ["sessionStatusLabel", "const labels"],
  ["seatSummary", "const open"],
  ["seatStats", "const open"],
  ["seatStateKind", 'seat.status === "open"'],
  ["seatStatusLabel", "const labels"],
  ["npcRoleSummary", "const available"],
  ["npcRoleStateKind", "role.author_private"],
  ["npcRoleStatusLabel", "role.author_private"],
  ["npcRoleActionText", "role.author_private"],
  ["canKickSeat", "return Boolean(seat?.id);"],
  ["kickSeatActionText", "return this.isOnboardSeat"]
]) {
  assertReturnGuardBefore(
    methodBody(manage, helper),
    "if (this.isHistorical)",
    ordinaryNeedle,
    `manage ${helper} must return from a purpose branch before ordinary wording`
  );
}
leadingHistoricalReturnGuard(
  methodBody(manage, "showRemoveMemberReasons"),
  "historical member-removal confirmation must return before ordinary reason actions"
);
assertLeadingHistoricalReturnBefore(
  methodBody(manage, "leaveOrganizer"),
  "ensureManageActionLogin",
  "historical organizers must not enter the ordinary leave flow"
);
assertBefore(
  methodBody(manage, "releaseNpcRole"),
  "const historicalCopy",
  "this.confirmAction",
  "historical NPC removal copy must be chosen before confirmation"
);
assertBefore(
  methodBody(manage, "cancelSession"),
  "this.isHistorical",
  "确认取消本车",
  "historical cancellation copy must precede ordinary cancellation wording"
);
assertBefore(
  methodBody(manage, "runCancelSession"),
  "this.isHistorical",
  "正在取消本车",
  "historical cancellation progress must precede ordinary cancellation wording"
);
assertBefore(
  methodBody(manage, "cancelSessionErrorText"),
  "this.isHistorical",
  "已有玩家上车",
  "historical cancellation errors must precede ordinary member wording"
);

assert.match(coreService, /session_purpose:\s*session\.session_purpose/);
assert.match(coreService, /organizer_user_id:\s*session\.organizer_user_id/);
assertListMySignupsPurposeProjection(coreService);
const listSessionAlbum = methodBody(coreService, "listSessionAlbum");
assert.match(listSessionAlbum, /session_purpose:\s*session\.session_purpose/);
assert.match(listSessionAlbum, /organizer_user_id:\s*session\.organizer_user_id/);
assertMemberAlbumPurposeProjection(coreService);
const kickSessionSeat = methodBody(coreService, "kickSessionSeat");
assertBefore(
  kickSessionSeat,
  "seat.session_purpose",
  "const content",
  "historical seat removal notices must branch on purpose before ordinary release copy"
);
assert.match(kickSessionSeat, /补认成员/);
assert.match(album, /session_purpose:\s*data\.session_purpose/);
assert.match(album, /organizer_user_id:\s*data\.organizer_user_id/);
const albumButtonBlocks = pairedElementBlocks(album, "t-button");
const albumMediaShareButton = albumButtonBlocks.find((block) =>
  block.includes('@tap="openShareSelectionMode"')
);
const albumRecruitmentButton = albumButtonBlocks.find((block) =>
  block.includes('class="album-command-label">招募<')
);
assert.ok(albumMediaShareButton, "album media share button must remain present");
assert.doesNotMatch(
  albumMediaShareButton,
  /isHistoricalAlbum/,
  "historical albums must keep ordinary media sharing"
);
assert.ok(albumRecruitmentButton, "future album recruitment button must remain present");
assert.match(
  albumRecruitmentButton,
  /v-if="!isHistoricalAlbum"/,
  "album recruitment button must be hidden for every historical member"
);
const albumHistoricalInviteButton = requiredElement(
  albumButtonBlocks,
  'class="album-command-label">邀请补认<',
  "historical album organizer invite button must remain present"
);
assert.match(albumHistoricalInviteButton, /v-if="isHistoricalOrganizer"/);
assert.match(albumHistoricalInviteButton, /@tap="openRecruitment"/);
assertReturnGuardBefore(
  methodBody(album, "openRecruitment"),
  "this.isHistoricalAlbum && !this.isHistoricalOrganizer",
  "uni.navigateTo",
  "historical album recruitment navigation must return for non-organizers"
);
assert.doesNotMatch(methodBody(album, "openRecruitment"), /join[-_]?token|invite[-_]?token/i);
assert.doesNotMatch(album, /joinToken|inviteToken|\/invite-token/);

assertCalendarPurposeAndRouting(calendar);
assert.match(calendar, /key:\s*"historical"[\s\S]*label:\s*"历史补录"/);
assertBefore(
  methodBody(calendar, "calendarIdentityTags"),
  "isHistoricalSession",
  "item.isAuthorPrivate",
  "calendar historical identity must survive the author-private early return"
);
assert.match(
  methodBody(calendar, "refreshCalendarItem"),
  /item\.albumFirst\s*=\s*!calendarItemFailed\(item\)\s*&&\s*!item\.isAuthorPrivate\s*&&/,
  "calendar author-private history must not become an album-first card"
);
assertBefore(
  methodBody(calendar, "calendarItemIsPending"),
  "item.isAuthorPrivate",
  "isHistoricalSession",
  "calendar author-private history must remain pending before active historical status"
);
assertBefore(
  methodBody(calendar, "calendarItemStatusText"),
  "calendarItemFailed(item)",
  "isHistoricalSession",
  "calendar cancellation must be evaluated before active historical identity"
);
assertBefore(
  methodBody(calendar, "calendarItemStatusText"),
  "calendarItemFailed(item)",
  "isCalendarItemPostStart(item)",
  "calendar cancellation must be evaluated before historical/post-start status"
);
assertBefore(
  methodBody(calendar, "calendarItemStatusText"),
  "isHistoricalSession",
  "isCalendarItemPostStart(item)",
  "calendar historical purpose must be evaluated before ordinary post-start status"
);
assert.match(calendar, /已取消补录/);
assert.match(calendar, /打开相册，补上当时的照片|回看这场记录/);

assert.match(managePinnedMessage, /sessionPurpose/);
assert.match(managePinnedMessage, /补录说明/);
const pinnedTitle = methodBody(managePinnedMessage, "pinnedTitle");
const pinnedNote = methodBody(managePinnedMessage, "pinnedNote");
const pinnedPlaceholder = methodBody(managePinnedMessage, "pinnedPlaceholder");
for (const body of [pinnedTitle, pinnedNote, pinnedPlaceholder]) {
  assert.ok(body.includes("this.isHistorical"), "pinned copy must branch on persisted purpose");
}
assert.doesNotMatch(pinnedNote.slice(0, pinnedNote.indexOf(":") + 1), /集合|房间号|临时变更/);
assert.doesNotMatch(
  pinnedPlaceholder.slice(0, pinnedPlaceholder.indexOf(":") + 1),
  /集合|房间号|临时变更/
);
for (const historicalPinnedCopy of [
  "补充这场已完成车局的背景，供当时的同车成员回看。",
  "写下这场已完成车局的补充说明（可选）"
]) {
  assert.ok(managePinnedMessage.includes(historicalPinnedCopy));
  assert.doesNotMatch(historicalPinnedCopy, /集合|房间号|临时变更|招募|上车/);
}

// Mutation probes keep the static contract honest: each representative weak fixture must fail.
assert.throws(() =>
  assertCalendarPurposeAndRouting(`
    function refreshCalendarItem(item) {
      item.sessionPurpose = item.session?.session_purpose || "";
      return item;
    }
    function handleCalendarAction(item) {
      goShare(item.sessionId);
    }
  `)
);
assert.throws(() =>
  assert.match(
    detailHistoricalInviteButton.replace('v-if="isHistoricalOrganizer"', 'v-if="isHistorical"'),
    /v-if="isHistoricalOrganizer"/
  )
);
assert.throws(() =>
  assert.match(
    manageSignupBoard.replace(
      'v-if="!isHistorical && session.id"',
      'v-if="session.id"'
    ),
    /v-if="!isHistorical && session\.id"/
  )
);
assert.throws(() =>
  assertLeadingHistoricalReturnBefore(
    `
      if (this.isHistorical) {
        this.statusText = "still continues";
      }
      await request({ url: "/signups" });
    `,
    "request({",
    "weak historical action guard must fail"
  )
);
assert.throws(() =>
  assertReturnGuardBefore(
    `
      if (this.isHistorical) {
        if (false) {
          return false;
        }
      }
      this.runFutureOnlyEffect();
    `,
    "if (this.isHistorical)",
    "this.runFutureOnlyEffect",
    "a nested-only return must not satisfy a historical guard"
  )
);
assert.throws(() =>
  assertListMySignupsPurposeProjection(`
    export async function listMySignups() {
      return query(\`SELECT signup.* FROM signups signup\`);
    }
  `)
);
assert.throws(() =>
  assertMemberAlbumPurposeProjection(`
    export async function listSessionAlbum() {
      const projection = {
        session_purpose: session.session_purpose,
        organizer_user_id: session.organizer_user_id
      };
      await requireSessionAlbumMember(connection, session, user);
      return projection;
    }
  `)
);

const expectedRootScripts = {
  "historical-session-backfill:unit":
    "node --test packages/shared/test/sessionPurpose.test.mjs apps/api/test/session-purpose.test.mjs apps/api/test/historical-session-migration.test.mjs apps/api/test/historical-invite-token.test.mjs apps/api/test/historical-session-service.test.mjs apps/api/test/historical-session-routes.test.mjs apps/miniprogram/test/sessionSetup.test.mjs apps/miniprogram/test/sessionShareInvite.test.mjs",
  "historical-session-backfill:check":
    "node scripts/historical-session-backfill-check.js",
  "historical-session-backfill:verify":
    "npm run historical-session-backfill:unit && npm run historical-session-backfill:check && npm --workspace apps/api run check && npm run build:mp-weixin",
  "historical-session-backfill:smoke":
    "node scripts/historical-session-backfill-smoke.js"
};
for (const [name, command] of Object.entries(expectedRootScripts)) {
  assert.equal(rootPackage.scripts?.[name], command, `root script ${name} must match the plan`);
}

const smokeRequestBody = methodBody(historicalSmoke, "requestJson");
assert.doesNotMatch(
  historicalSmoke,
  /expectedStatus\s*=(?!=)/,
  "smoke request helpers must not default expected statuses"
);
assert.match(smokeRequestBody, /expectedStatus\s*===\s*undefined/);
assert.match(smokeRequestBody, /redactSensitiveText/);
assert.match(smokeRequestBody, /authorization:\s*`Bearer \$\{token\}`/);
for (const marker of [
  "/api/admin/stores",
  "/api/admin/scripts",
  "/api/sessions",
  "/seats",
  "/api/session-npc-roles/",
  "/publish",
  "/album",
  "/review",
  "/api/sessions/discovery",
  "/api/sessions/public/upcoming",
  "/api/signups",
  "/claim",
  "/join-invite-token",
  "/historical-invite-token",
  "/historical-claims"
]) {
  assert.ok(historicalSmoke.includes(marker), `historical smoke must cover ${marker}`);
}
for (const marker of [
  "historical_record",
  "future_carpool",
  "share_only",
  "review_required",
  "HISTORICAL_ROLE_CLAIM_INVITE_REQUIRED",
  "historical_session_claim",
  "historical_invite_preview",
  "sessionPurpose",
  "inviterUserId",
  "Promise.allSettled",
  "confirmed_user_id",
  "bound_user_id",
  "13:00:00"
]) {
  assert.ok(historicalSmoke.includes(marker), `historical smoke must assert ${marker}`);
}
assert.match(historicalSmoke, /expectedStatus:\s*403/);
assert.match(historicalSmoke, /expectedStatus:\s*400/);
assert.match(historicalSmoke, /expectedStatus:\s*\[200,\s*409\]/);
assert.match(historicalSmoke, /concurrent_historical_claim_successes/);
assert.match(historicalSmoke, /concurrent_historical_claim_conflicts/);
assert.match(historicalSmoke, /ordinary_future_claim_successes/);

const assertLocalDevelopmentBaseUrl = compileNamedFunction(
  historicalSmoke,
  "assertLocalDevelopmentBaseUrl",
  { assert }
);
for (const allowedUrl of [
  "http://localhost:3018",
  "https://127.0.0.1:3018",
  "http://[::1]:3018"
]) {
  assert.doesNotThrow(() => assertLocalDevelopmentBaseUrl(new URL(allowedUrl)));
}
for (const deniedUrl of [
  "http://example.com:3018",
  "http://localhost.example.com:3018",
  "file:///tmp/api",
  "http://user:password@127.0.0.1:3018"
]) {
  assert.throws(() => assertLocalDevelopmentBaseUrl(new URL(deniedUrl)));
}
assertBefore(
  historicalSmoke,
  "assertLocalDevelopmentBaseUrl(baseUrl);",
  "async function requestJson",
  "local base URL must fail closed before any request helper can fetch"
);

const assertDevelopmentHealth = compileNamedFunction(
  historicalSmoke,
  "assertDevelopmentHealth",
  { assert }
);
const safeHealth = {
  ok: true,
  config: { nodeEnv: "development", wechatMockLogin: true },
  database: { schemaReady: true }
};
assert.doesNotThrow(() => assertDevelopmentHealth(safeHealth));
for (const unsafeHealth of [
  { ...safeHealth, ok: false },
  { ...safeHealth, config: { ...safeHealth.config, nodeEnv: "production" } },
  { ...safeHealth, config: { ...safeHealth.config, wechatMockLogin: false } },
  { ...safeHealth, database: { schemaReady: false } }
]) {
  assert.throws(() => assertDevelopmentHealth(unsafeHealth));
}
const smokeMain = methodBody(historicalSmoke, "main");
assertBefore(
  smokeMain,
  'requestJson("GET", "/health"',
  'login("dev-admin-openid"',
  "health preflight must be the first HTTP request before development login"
);
assert.match(smokeMain, /requestJson\("GET", "\/health", \{\s*expectedStatus:\s*200/);
assert.match(smokeMain, /assertDevelopmentHealth/);

for (const marker of [
  "preclaimAlbum",
  "preclaimReview",
  "winnerRace",
  "loserRace",
  "winnerMembership",
  "historicalTokenInOrdinaryNamespace",
  "futureTokenInHistoricalNamespace",
  "organizer.user?.open_id",
  "organizer.user?.avatar_url"
]) {
  assert.ok(historicalSmoke.includes(marker), `historical smoke must retain ${marker}`);
}

const normalizeHistoricalPreviewKey = compileNamedFunction(
  historicalSmoke,
  "normalizeHistoricalPreviewKey"
);
const historicalPreviewSensitiveKey = compileNamedFunction(
  historicalSmoke,
  "historicalPreviewSensitiveKey",
  { normalizeHistoricalPreviewKey }
);
const assertHistoricalPreviewSanitized = compileNamedFunction(
  historicalSmoke,
  "assertHistoricalPreviewSanitized",
  { assert, historicalPreviewSensitiveKey }
);
const safePreview = {
  access_scope: "historical_invite_preview",
  session_purpose: "historical_record",
  script_name_snapshot: "安全剧本名",
  store_name_snapshot: "安全门店名",
  seats: [{ id: 1 }, { id: 2 }, { id: 3 }],
  session_npc_roles: [{ id: 4, is_bound: false, has_pending_signup: false }]
};
assert.doesNotThrow(() => assertHistoricalPreviewSanitized(safePreview, []));
for (const unsafePreview of [
  { ...safePreview, organizer: { id: 9, nickname: "private organizer" } },
  { ...safePreview, album_items: [{ media_url: "/private/media.jpg" }] },
  { ...safePreview, review_eligible_at: "2026-08-01T00:00:00Z" },
  { ...safePreview, canReview: true }
]) {
  assert.throws(() => assertHistoricalPreviewSanitized(unsafePreview, []));
}
assert.throws(() =>
  assertHistoricalPreviewSanitized(
    { ...safePreview, safe_label: "known-private-openid" },
    ["known-private-openid"]
  )
);

console.log("historical session backfill static contract passed");
