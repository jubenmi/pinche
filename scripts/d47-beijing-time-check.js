import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

function sourceSlice(source, start, end, name) {
  const startIndex = source.indexOf(start);
  assert.notEqual(startIndex, -1, `${name} start marker must exist`);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(endIndex, -1, `${name} end marker must exist`);
  return source.slice(startIndex, endIndex);
}

function sourceFrom(source, marker, name) {
  const startIndex = source.indexOf(marker);
  assert.notEqual(startIndex, -1, `${name} marker must exist`);
  return source.slice(startIndex);
}

const [
  calendarSource,
  detailSource,
  shareSource,
  adminAppSource,
  adminCatalogSource,
  adminPreviewSource,
  adminAlbumSource,
  mysqlSource,
  setupSource,
  miniprogramAlbumSource,
  miniprogramAdminCatalogSource,
  authMessagesSource,
  miniprogramChatSource,
  coreServiceSource,
  sessionCreateTimeSource,
  subscribeMessageSource,
  moderationAdminApiSource,
  moderationRepositorySource,
  talkBusinessTimeSource,
  talkChatSource
] = await Promise.all([
  read("apps/miniprogram/src/components/SessionCalendar.vue"),
  read("apps/miniprogram/src/pages/session/detail.vue"),
  read("apps/miniprogram/src/pages/session/share.vue"),
  read("apps/admin-web/src/App.vue"),
  read("apps/admin-web/src/components/CatalogWorkspace.vue"),
  read("apps/admin-web/src/components/MiniProgramWorkspace.vue"),
  read("apps/admin-web/src/components/SessionAlbumWorkspace.vue"),
  read("apps/api/src/db/mysql.js"),
  read("apps/miniprogram/src/pages/session/setup.vue"),
  read("apps/miniprogram/src/pages/session/album.vue"),
  read("apps/miniprogram/src/pages/admin/catalog.vue"),
  read("apps/miniprogram/src/utils/authMessages.js"),
  read("apps/miniprogram/src/extensions/session-pseudo-chat/ChatEntry.vue"),
  read("apps/api/src/modules/core/service.js"),
  read("apps/api/src/modules/core/session-create-time.js"),
  read("apps/api/src/modules/wechat/subscribe-message.js"),
  read("apps/api/src/modules/content-moderation/admin-api.js"),
  read("apps/api/src/modules/content-moderation/repository.js"),
  read("packages/talk/api/business-time.js"),
  read("packages/talk/miniprogram/ChatEntry.vue")
]);

assert.match(calendarSource, /@pinche\/shared/, "calendar must use shared Beijing-time helpers");
assert.doesNotMatch(calendarSource, /function parseStartAt\(/, "calendar must not parse time locally");
assert.doesNotMatch(calendarSource, /date\.getHours\(\)/, "calendar time must not use device hours");
assert.match(detailSource, /formatBeijingDateTime/, "detail must format Beijing time");
assert.match(shareSource, /formatBeijingDateTime/, "share must format Beijing time");
for (const [name, source] of [
  ["admin app", adminAppSource],
  ["admin catalog", adminCatalogSource],
  ["admin preview", adminPreviewSource],
  ["admin album", adminAlbumSource]
]) {
  assert.match(source, /@pinche\/shared/, `${name} must use shared Beijing-time helpers`);
}
assert.doesNotMatch(
  adminPreviewSource,
  /function parseMineStartAt\(/,
  "admin preview must not duplicate local-time parsing"
);
assert.doesNotMatch(
  `${adminPreviewSource}\n${adminAlbumSource}`,
  /function formatShanghaiDate\(/,
  "admin workspaces must not duplicate Beijing formatting"
);
const adminAppFormatter = sourceSlice(
  adminAppSource,
  "function formatDateTime(value) {",
  "function setAuth(nextAuth) {",
  "admin app formatter"
);
const adminCatalogFormatter = sourceSlice(
  adminCatalogSource,
  "function formatDateTime(value) {",
  "watch(tab, load);",
  "admin catalog formatter"
);
const adminPreviewFormatter = sourceSlice(
  adminPreviewSource,
  "function formatDate(value) {",
  "function sessionStatusLabel(value) {",
  "admin preview formatter"
);
const adminAlbumFormatter = sourceSlice(
  adminAlbumSource,
  "function formatDate(value) {",
  "function tagSummary(photo) {",
  "admin album formatter"
);
const adminDefaultDate = sourceSlice(
  adminPreviewSource,
  "function defaultDate() {",
  "function parseJsonArray(value) {",
  "admin create default date"
);
for (const [name, source] of [
  ["admin app formatter", adminAppFormatter],
  ["admin catalog formatter", adminCatalogFormatter],
  ["admin preview formatter", adminPreviewFormatter],
  ["admin album formatter", adminAlbumFormatter]
]) {
  assert.match(source, /formatBeijingDateTime/, `${name} must format Beijing time`);
}
assert.match(adminDefaultDate, /beijingDateKey/, "admin create default must use Beijing date");
assert.match(mysqlSource, /timezone:\s*"Z"/, "mysql2 must interpret DATETIME values as UTC");
assert.match(mysqlSource, /SET time_zone = '\+00:00'/, "MySQL sessions must run in UTC");

const setupDataSlice = sourceSlice(setupSource, "  data() {", "  computed: {", "setup data");
const setupComputedSlice = sourceSlice(setupSource, "  computed: {", "  onLoad() {", "setup computed");
const setupOnLoadSlice = sourceSlice(setupSource, "  onLoad() {", "  methods: {", "setup onLoad");
const setupCreateSlice = sourceSlice(
  setupSource,
  "    sessionCreationData(pinnedMessageText, creationIdentity = {}) {",
  "    async initializeFutureSession(",
  "setup create request"
);
assert.match(
  setupDataSlice,
  /const defaults = sessionCreationDefaults\(\);/,
  "setup data must call shared creation defaults"
);
assert.match(
  setupOnLoadSlice,
  /const savedPickerValue = sessionCreationPickerValue\(flow\.startAt\);/,
  "setup onLoad must restore picker wall time safely"
);
assert.match(setupComputedSlice, /sessionCreationWallTime/, "setup must build canonical wall time");
assert.match(
  setupComputedSlice,
  /sessionCreationTransportStartAt/,
  "setup must explicitly convert picker wall time for transport"
);
assert.match(
  setupCreateSlice,
  /startAt:\s*this\.transportStartAt/,
  "setup create request must send explicit transport time"
);

const miniprogramAlbumFormatter = sourceSlice(
  miniprogramAlbumSource,
  "    formatDate(value) {",
  "    chooseAlbumMedia() {",
  "miniprogram album formatter"
);
const miniprogramCatalogFormatter = sourceSlice(
  miniprogramAdminCatalogSource,
  "function formatDate(value) {",
  "function roleTemplateStatus(script) {",
  "miniprogram admin catalog formatter"
);
const authMessageFormatter = sourceSlice(
  authMessagesSource,
  "function formatShanghaiTime(value, fallback) {",
  "function reviewedMessage(item, common) {",
  "auth message formatter"
);
const miniprogramChatFormatter = sourceSlice(
  miniprogramChatSource,
  "    timeText(value) {",
  "  }\n};",
  "miniprogram chat formatter"
);
assert.match(
  miniprogramAlbumFormatter,
  /formatBeijingDateTime/,
  "miniprogram album must format Beijing time"
);
assert.match(
  miniprogramCatalogFormatter,
  /formatBeijingDateTime/,
  "miniprogram admin catalog must format Beijing time"
);
assert.match(authMessageFormatter, /parseSessionStartAt/, "auth messages must validate session time");
assert.match(authMessageFormatter, /formatSessionStartAt/, "auth messages must format session time");
assert.match(
  miniprogramChatFormatter,
  /formatBeijingShortDateTime/,
  "miniprogram chat must use the shared short formatter"
);

const adminTransportSlice = sourceSlice(
  adminPreviewSource,
  "const startAt = computed(",
  "const defaultPinnedMessage = computed(",
  "admin create transport"
);
const adminCreateSlice = sourceSlice(
  adminPreviewSource,
  "async function createPublishedSession() {",
  "async function loadMine() {",
  "admin create request"
);
const adminStartedSlice = sourceSlice(
  adminPreviewSource,
  "function isShareSessionStarted() {",
  "function roleDisplayText(role) {",
  "admin share start check"
);
const adminAlbumOpenSlice = sourceSlice(
  adminPreviewSource,
  "function isAlbumOpenForSession(session) {",
  "function canTransferToSeat(seat) {",
  "admin album start check"
);
assert.match(adminTransportSlice, /beijingWallTimeToIso/, "admin create must convert wall time");
assert.match(
  adminCreateSlice,
  /startAt:\s*transportStartAt\.value/,
  "admin create request must send explicit transport time"
);
assert.match(
  adminStartedSlice,
  /isBusinessDateTimeReached/,
  "admin share start check must use the shared business-time helper"
);
assert.match(
  adminAlbumOpenSlice,
  /isBusinessDateTimeReached/,
  "admin album start check must use the shared business-time helper"
);

const createSessionSlice = sourceSlice(
  coreServiceSource,
  "export async function createSessionWithConnection",
  "export async function createSession(user, body)",
  "session creation service"
);
const createSessionInsertSlice = sourceSlice(
  createSessionSlice,
  "  const [result] = await connection.query(",
  "  const session = await findById(",
  "session creation INSERT"
);
assert.match(
  createSessionSlice,
  /normalizeSessionCreationStartAt\(\s*requireValue\(body,\s*["']startAt["']\),\s*body\.sessionPurpose\s*\)/,
  "session creation must normalize startAt"
);
assert.match(
  createSessionInsertSlice,
  /script\.name,[\s\S]*?store\.name,[\s\S]*?creation\.startAt,/,
  "session INSERT must bind normalized startAt"
);
assert.doesNotMatch(
  createSessionInsertSlice,
  /requireValue\(\s*body\s*,\s*["']startAt["']\s*\)/,
  "session INSERT must not bind raw startAt"
);
const normalizeSessionCreationSlice = sourceFrom(
  sessionCreateTimeSource,
  "export function normalizeSessionCreationStartAt(value) {",
  "session creation normalization"
);
assert.match(
  normalizeSessionCreationSlice,
  /const parsed = parseBusinessDateTime\(value\);/,
  "session creation normalization must parse business time"
);
assert.match(
  normalizeSessionCreationSlice,
  /return new Date\(Math\.floor\(parsed\.getTime\(\) \/ 1000\) \* 1000\);/,
  "session creation normalization must return a Date for mysql2 binding"
);

const signupMessageSlice = sourceSlice(
  subscribeMessageSource,
  "function messageData(payload",
  "export function formatSessionRescheduleTime",
  "signup subscribe message"
);
const subscribeFormatterSlice = sourceSlice(
  subscribeMessageSource,
  'import { config } from "../../config/env.js";',
  "function rescheduleMessageData(payload)",
  "subscribe time formatters"
);
assert.match(
  signupMessageSlice,
  /formatSessionSignupTime\(payload\.startAt\)/,
  "signup subscribe message must format Beijing time"
);
assert.match(
  subscribeFormatterSlice,
  /import\s*\{\s*beijingDateParts\s*\}\s*from\s*["']@pinche\/shared["']/,
  "subscribe formatters must import the shared Beijing-time kernel"
);
assert.match(
  subscribeFormatterSlice,
  /beijingDateParts\(value\)/,
  "subscribe formatters must use shared Beijing date parts"
);
assert.doesNotMatch(
  subscribeFormatterSlice,
  /Intl\.DateTimeFormat|sessionTimeFormatter/,
  "subscribe formatters must not duplicate Beijing timezone semantics"
);

const moderationQuerySlice = sourceSlice(
  moderationAdminApiSource,
  "export function parseAdminModerationListQuery",
  "function nullableString(value)",
  "moderation admin date query"
);
const moderationRepositorySlice = sourceSlice(
  moderationRepositorySource,
  "export async function listAdminModerationJobs",
  "export async function getAdminModerationJob",
  "moderation repository date query"
);
assert.match(
  moderationQuerySlice,
  /const fromRange = dateFrom \? beijingDayUtcRange\(dateFrom\) : null;/,
  "moderation lower bound must use the Beijing day range helper"
);
assert.match(
  moderationQuerySlice,
  /const toRange = dateTo \? beijingDayUtcRange\(dateTo\) : null;/,
  "moderation upper bound must use the Beijing day range helper"
);
assert.match(moderationQuerySlice, /dateFrom:\s*fromRange\?\.start/, "moderation range must include its start");
assert.match(
  moderationQuerySlice,
  /dateToExclusive:\s*toRange\?\.end/,
  "moderation range must expose an exclusive end"
);
assert.match(
  moderationRepositorySlice,
  /if \(dateFrom\) \{\s*where\.push\("job\.created_at >= \?"\);\s*values\.push\(dateFrom\);\s*\}/,
  "moderation query must include the lower bound"
);
assert.match(
  moderationRepositorySlice,
  /if \(dateToExclusive\) \{\s*where\.push\("job\.created_at < \?"\);\s*values\.push\(dateToExclusive\);\s*\}/,
  "moderation query must exclude the upper bound"
);

const talkSessionFormatter = sourceSlice(
  talkBusinessTimeSource,
  "export function formatTalkSessionDateTime(value) {",
  "export function defaultPinnedMessageForSession(session) {",
  "talk API formatter"
);
const talkPinnedMessage = sourceSlice(
  talkBusinessTimeSource,
  "export function defaultPinnedMessageForSession(session) {",
  "\n}",
  "talk pinned message"
);
const talkChatFormatter = sourceSlice(
  talkChatSource,
  "    timeText(value) {",
  "  }\n};",
  "talk chat formatter"
);
assert.match(
  talkSessionFormatter,
  /return formatBeijingDateTime\(value, "时间待定"\);/,
  "talk API formatter must call the shared Beijing-time helper"
);
assert.match(
  talkPinnedMessage,
  /formatTalkSessionDateTime\(\s*session\.start_at\s*\)/,
  "talk pinned messages must use their shared business-time helper"
);
assert.match(talkChatFormatter, /formatBeijingShortDateTime/, "talk chat must use shared short time");

for (const [name, source] of [
  ["admin app formatter", adminAppFormatter],
  ["admin catalog formatter", adminCatalogFormatter],
  ["admin preview formatter", adminPreviewFormatter],
  ["admin album formatter", adminAlbumFormatter],
  ["admin create default date", adminDefaultDate],
  ["miniprogram album formatter", miniprogramAlbumFormatter],
  ["miniprogram admin catalog formatter", miniprogramCatalogFormatter],
  ["auth message formatter", authMessageFormatter],
  ["miniprogram chat formatter", miniprogramChatFormatter],
  ["admin create transport", adminTransportSlice],
  ["admin share start check", adminStartedSlice],
  ["admin album start check", adminAlbumOpenSlice],
  ["signup subscribe message", signupMessageSlice],
  ["subscribe time formatters", subscribeFormatterSlice],
  ["talk API formatter", talkSessionFormatter],
  ["talk pinned message", talkPinnedMessage],
  ["talk chat formatter", talkChatFormatter]
]) {
  assert.doesNotMatch(source, /toISOString\(\)\.slice/, `${name} must not slice ISO strings`);
  assert.doesNotMatch(
    source,
    /String\(value\)\.slice\(5,\s*16\)/,
    `${name} must not slice timestamp text`
  );
  assert.doesNotMatch(source, /\.getHours\(\)/, `${name} must not use local device hours`);
}

console.log("Beijing time source contract passed.");
