import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  listMyNotifications,
  markMyNotificationRead
} from "../apps/api/src/modules/core/user-notifications.js";

function assertIncludes(source, token) {
  assert(source.includes(token), `expected source to include: ${token}`);
}

const migration = readFileSync(
  new URL("../apps/api/migrations/0024_user_notifications.sql", import.meta.url),
  "utf8"
);
const helper = readFileSync(
  new URL("../apps/api/src/modules/core/user-notifications.js", import.meta.url),
  "utf8"
);
const service = readFileSync(
  new URL("../apps/api/src/modules/core/service.js", import.meta.url),
  "utf8"
);
const server = readFileSync(
  new URL("../apps/api/src/server.js", import.meta.url),
  "utf8"
);
const env = readFileSync(new URL("../apps/api/src/config/env.js", import.meta.url), "utf8");
const subscribeMessage = readFileSync(
  new URL("../apps/api/src/modules/wechat/subscribe-message.js", import.meta.url),
  "utf8"
);
const envExample = readFileSync(new URL("../.env.example", import.meta.url), "utf8");
const productionEnvExample = readFileSync(
  new URL("../.env.production.example", import.meta.url),
  "utf8"
);
const managePage = readFileSync(
  new URL("../apps/miniprogram/src/pages/session/manage.vue", import.meta.url),
  "utf8"
);
const rescheduleHelper = readFileSync(
  new URL("../apps/miniprogram/src/utils/sessionReschedule.js", import.meta.url),
  "utf8"
);
const miniSubscribeHelper = readFileSync(
  new URL("../apps/miniprogram/src/utils/subscribeMessages.js", import.meta.url),
  "utf8"
);
const miniSharePage = readFileSync(
  new URL("../apps/miniprogram/src/pages/session/share.vue", import.meta.url),
  "utf8"
);
const miniDetailPage = readFileSync(
  new URL("../apps/miniprogram/src/pages/session/detail.vue", import.meta.url),
  "utf8"
);
const miniMembershipHelper = readFileSync(
  new URL("../apps/miniprogram/src/utils/sessionMembership.js", import.meta.url),
  "utf8"
);
const miniAuthMessages = readFileSync(
  new URL("../apps/miniprogram/src/utils/authMessages.js", import.meta.url),
  "utf8"
);
const miniAuthIdentityBar = readFileSync(
  new URL("../apps/miniprogram/src/components/AuthIdentityBar.vue", import.meta.url),
  "utf8"
);
const smoke = readFileSync(
  new URL("./d45-session-reschedule-notifications-smoke.js", import.meta.url),
  "utf8"
);
const smokeSafety = readFileSync(
  new URL("./d45-session-reschedule-notifications-safety.js", import.meta.url),
  "utf8"
);
const packageJson = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8")
);

assertIncludes(migration, "CREATE TABLE IF NOT EXISTS user_notifications");
assertIncludes(
  migration,
  "UNIQUE KEY uq_user_notifications_dedupe (user_id, dedupe_key)"
);
assertIncludes(
  migration,
  "KEY idx_user_notifications_inbox (user_id, read_at, created_at)"
);
assertIncludes(helper, "export const USER_NOTIFICATION_TYPES");
assertIncludes(helper, "export async function insertUserNotification");
assertIncludes(helper, "export function userNotificationResponse");
assertIncludes(helper, "export async function listMyNotifications");
assertIncludes(helper, "export async function markMyNotificationRead");
assertIncludes(service, "export async function rescheduleSession");
assertIncludes(service, "export async function rescheduleSessionInTransaction");
assertIncludes(service, "(start_at <= CURRENT_TIMESTAMP) AS session_started");
assertIncludes(service, "FROM sessions WHERE id = ? FOR UPDATE");
assertIncludes(service, "SELECT id FROM session_seats WHERE session_id = ? FOR UPDATE");
assertIncludes(service, "SELECT id FROM session_npc_roles WHERE session_id = ? FOR UPDATE");
assertIncludes(service, "body.membersConfirmed !== true");
assertIncludes(service, "USER_NOTIFICATION_TYPES.SESSION_RESCHEDULED");
assertIncludes(service, "createSessionRescheduleDedupeKey(id)");
assertIncludes(env, "WECHAT_SUBSCRIBE_SESSION_RESCHEDULED_TEMPLATE_ID");
assertIncludes(env, "sessionRescheduledTemplateId");
assertIncludes(envExample, "WECHAT_SUBSCRIBE_SESSION_RESCHEDULED_TEMPLATE_ID=");
assertIncludes(productionEnvExample, "WECHAT_SUBSCRIBE_SESSION_RESCHEDULED_TEMPLATE_ID=");
assertIncludes(envExample, "VITE_SUBSCRIBE_TEMPLATE_SESSION_RESCHEDULED=");
assertIncludes(productionEnvExample, "VITE_SUBSCRIBE_TEMPLATE_SESSION_RESCHEDULED=");
assertIncludes(subscribeMessage, "export async function notifySessionRescheduled");
assertIncludes(subscribeMessage, 'scene: "session_rescheduled"');
assertIncludes(subscribeMessage, "rescheduleMessageData");
assertIncludes(
  subscribeMessage,
  'thing1: { value: valueOrFallback(payload.scriptName, "拼车车局").slice(0, 20) }'
);
assertIncludes(
  subscribeMessage,
  'thing2: { value: valueOrFallback(payload.seatName, "角色位").slice(0, 20) }'
);
assertIncludes(subscribeMessage, 'phrase3: { value: resultText.slice(0, 5) }');
assertIncludes(
  subscribeMessage,
  'date4: { value: valueOrFallback(payload.startAt, "时间待定").slice(0, 20) }'
);
assertIncludes(
  subscribeMessage,
  'thing5: { value: valueOrFallback(payload.actorName, "新申请").slice(0, 20) }'
);
assertIncludes(subscribeMessage, 'valueOrFallback(payload.scriptName, "拼车车局")');
assertIncludes(subscribeMessage, 'formatSessionRescheduleTime(payload.oldStartAt, "原时间待定")');
assertIncludes(subscribeMessage, 'formatSessionRescheduleTime(payload.newStartAt, "新时间待定")');
assertIncludes(subscribeMessage, 'timeZone: "Asia/Shanghai"');
assertIncludes(subscribeMessage, "AbortSignal.timeout");
assertIncludes(subscribeMessage, 'value: "车局已改期"');
assertIncludes(subscribeMessage, "`/pages/session/detail?id=${payload.sessionId}`");
assertIncludes(service, "notifySessionRescheduled");
assertIncludes(service, "Promise.allSettled");
assertIncludes(service, "notificationDelivery");
assertIncludes(rescheduleHelper, "export function parseSessionStartAt");
assertIncludes(rescheduleHelper, "export function formatSessionStartAt");
assertIncludes(rescheduleHelper, "export function canRescheduleSession");
assertIncludes(rescheduleHelper, "export function validateRescheduleSelection");
assertIncludes(rescheduleHelper, "export function buildRescheduleConfirmation");
assertIncludes(rescheduleHelper, "export function rescheduleErrorRequiresRefresh");
assertIncludes(rescheduleHelper, "export function rescheduleConfirmationRequired");
assertIncludes(rescheduleHelper, "export function rescheduleErrorText");
assertIncludes(rescheduleHelper, 'error?.message || ""');
assertIncludes(rescheduleHelper, 'timeZone: "Asia/Shanghai"');
assertIncludes(managePage, 'v-if="canReschedule"');
assertIncludes(managePage, '<t-date-time-picker');
assertIncludes(managePage, ':mode="[\'date\', \'minute\']"');
assertIncludes(managePage, ':start="rescheduleMinimum"');
assertIncludes(managePage, '`/api/sessions/${this.sessionId}/reschedule`');
assertIncludes(managePage, "this.showRescheduleConfirmation(validation.startAt)");
assertIncludes(managePage, "this.rescheduleSession(startAt, memberCount > 0)");
assertIncludes(managePage, "notification_delivery");
assertIncludes(managePage, 'role.status === "active"');
assertIncludes(managePage, "await this.ensureManageActionLogin()");
assertIncludes(managePage, "if (rescheduleConfirmationRequired(error))");
assertIncludes(managePage, "await this.reload()");
assertIncludes(managePage, "this.showRescheduleConfirmation(startAt)");
assertIncludes(miniSubscribeHelper, "member_session_rescheduled");
assertIncludes(miniSubscribeHelper, "VITE_SUBSCRIBE_TEMPLATE_SESSION_RESCHEDULED");
assertIncludes(miniSubscribeHelper, "export const TEMPLATE_IDS");
assertIncludes(miniSubscribeHelper, "export function requestSessionRescheduledSubscription");
assertIncludes(
  miniSubscribeHelper,
  'requestBusinessSubscription("member_session_rescheduled")'
);
assertIncludes(miniSharePage, "requestSessionRescheduledSubscription");
assertIncludes(miniSharePage, 'joinResult === "joined"');
assertIncludes(miniSharePage, 'result.join_result === "npc_joined"');
assert(!miniSharePage.includes('join_result || "joined"'), "missing join_result must not imply success");
assertIncludes(miniSharePage, "wasConfirmedMember");
assertIncludes(miniSharePage, "requestSubscriptionAfterConfirmedJoin");
assertIncludes(miniSharePage, "上车结果异常");
assert.equal(
  miniSharePage.match(/await requestSubscriptionAfterConfirmedJoin\(/g)?.length,
  2,
  "seat and NPC direct results must use guarded transition subscription flow"
);
assertIncludes(miniMembershipHelper, "export function normalizeUserId");
assertIncludes(miniMembershipHelper, "Number.isSafeInteger");
assertIncludes(miniMembershipHelper, "export function shouldRequestRescheduleSubscription");
assertIncludes(miniMembershipHelper, "!wasConfirmedMember && joinResult === confirmedResult");
assertIncludes(miniMembershipHelper, "export async function requestSubscriptionAfterConfirmedJoin");
assertIncludes(miniMembershipHelper, "catch (error)");
assertIncludes(miniDetailPage, "canRequestRescheduleReminder");
assertIncludes(miniDetailPage, "改期提醒");
assertIncludes(miniDetailPage, "requestRescheduleReminder");
assertIncludes(miniDetailPage, "requestSessionRescheduledSubscription");
assertIncludes(miniAuthMessages, "export function buildPersistentMessages");
assertIncludes(miniAuthMessages, "formatSessionStartAt");
assertIncludes(miniAuthMessages, 'kind: "persistent"');
assertIncludes(miniAuthMessages, 'typeTag: "审核结果"');
assertIncludes(miniAuthMessages, 'typeTag: "车局改期"');
assertIncludes(miniAuthMessages, 'actionText: "查看车局"');
assertIncludes(miniAuthMessages, "export function shouldApplyMessageRefresh");
assertIncludes(miniAuthMessages, "export function restorePersistentUnread");
assertIncludes(miniAuthMessages, "if (!notificationId || !type)");
assertIncludes(miniAuthIdentityBar, 'url: "/api/users/me/notifications"');
assertIncludes(miniAuthIdentityBar, "Promise.allSettled");
assertIncludes(miniAuthIdentityBar, "persistentUnreadCount = Math.max(0");
assertIncludes(miniAuthIdentityBar, "message.kind === 'pending_signup'");
assertIncludes(miniAuthIdentityBar, "notificationReadInFlight.includes(notificationId)");
assertIncludes(miniAuthIdentityBar, "method: \"POST\"");
assertIncludes(miniAuthIdentityBar, "{{ message.typeTag }}");
assertIncludes(miniAuthIdentityBar, "sessionsMessagesError");
assertIncludes(miniAuthIdentityBar, "notificationsMessagesError");
assertIncludes(miniAuthIdentityBar, "messageRefreshGeneration");
assertIncludes(miniAuthIdentityBar, "shouldApplyMessageRefresh(requestContext, currentContext)");
assertIncludes(miniAuthIdentityBar, "restorePersistentUnread(");
assertIncludes(miniAuthIdentityBar, "error?.statusCode === 401");
assertIncludes(miniAuthIdentityBar, "loadMoreNotifications");
assertIncludes(miniAuthIdentityBar, "notificationsNextCursor");
assertIncludes(miniAuthIdentityBar, "mergePersistentMessagePages(");
for (const token of [
  "verifyD45SmokePreflight",
  "returned non-JSON",
  '"session_rescheduled"',
  '"signup_reviewed"',
  "notification_delivery",
  "delivery recipients must equal sent + skipped + failed",
  "approved signup result must persist exactly once",
  "rejected signup result must persist exactly once after repeated rejection",
  "membersConfirmed",
  "/api/users/me/notifications",
  "/read"
]) {
  assertIncludes(smoke, token);
}
for (const token of [
  'url.pathname === "/api/testing/d45-smoke-target"',
  "d45SmokeDatabaseIsIsolated",
  'process.env.D45_SMOKE_ISOLATED === "1"',
  'config.mysql.database === "pinche_d45_test"',
  'marker: "d45-session-reschedule-notifications"',
  "wechat_mock_login: true"
]) {
  assertIncludes(server, token);
}
assertIncludes(smokeSafety, "verifyD45SmokePreflight");
assertIncludes(smoke, "await verifyD45SmokePreflight");
assert.equal(
  packageJson.scripts["d45:check"],
  "node scripts/d45-session-reschedule-notifications-safety-check.js && node scripts/d45-session-reschedule-notifications-check.js"
);
assert.equal(
  packageJson.scripts["d45:smoke"],
  "node scripts/d45-session-reschedule-notifications-smoke.js"
);
for (const command of [
  "node --check scripts/d45-session-reschedule-notifications-smoke.js",
  "npm run d45:check",
  "node --test apps/miniprogram/test/sessionReschedule.test.mjs apps/miniprogram/test/authMessages.test.mjs",
  "npm --workspace apps/api run test:session-reschedule"
]) {
  assert(
    packageJson.scripts.check.includes(command),
    `root check must include D45 verification command: ${command}`
  );
}
const rescheduleServiceIndex = service.indexOf("export async function rescheduleSession");
const sessionLockIndex = service.indexOf("FROM sessions WHERE id = ? FOR UPDATE", rescheduleServiceIndex);
const seatLockIndex = service.indexOf(
  "SELECT id FROM session_seats WHERE session_id = ? FOR UPDATE",
  sessionLockIndex
);
const npcRoleLockIndex = service.indexOf(
  "SELECT id FROM session_npc_roles WHERE session_id = ? FOR UPDATE",
  seatLockIndex
);
const recipientReadIndex = service.indexOf("SELECT DISTINCT member.user_id", npcRoleLockIndex);
assert(
  sessionLockIndex < seatLockIndex &&
    seatLockIndex < npcRoleLockIndex &&
    npcRoleLockIndex < recipientReadIndex,
  "expected session, seat, and NPC role locks before recipient selection"
);

const rescheduleRoute = 'idMatch(url.pathname, /^\\/api\\/sessions\\/(\\d+)\\/reschedule$/)';
const updateRoute = 'idMatch(url.pathname, /^\\/api\\/sessions\\/(\\d+)$/)';
assertIncludes(server, rescheduleRoute);
assertIncludes(server, "data: sessionRescheduleResponse(result)");
assert(!server.includes("data: result.recipients"), "route must not expose notification recipients");
assert(
  server.indexOf(rescheduleRoute) < server.indexOf(updateRoute),
  "expected reschedule route before generic session update route"
);

const notificationRows = [
  {
    id: 11,
    type: "signup_reviewed",
    session_id: 22,
    title: "报名审核已通过",
    payload_json: '{"result":"approved"}',
    read_at: null,
    created_at: "2026-07-12 10:00:00",
    unread_count: 3
  }
];
const listQueries = [];
const listResult = await listMyNotifications(
  {
    async query(sql, values) {
      listQueries.push({ sql, values });
      return [notificationRows];
    }
  },
  7,
  500
);
assert.deepEqual(listResult, {
  items: [
    {
      id: 11,
      type: "signup_reviewed",
      session_id: 22,
      title: "报名审核已通过",
      payload: { result: "approved" },
      read_at: null,
      created_at: "2026-07-12 10:00:00"
    }
  ],
  unread_count: 3,
  next_cursor: null,
  has_more: false
});
assert.equal(listQueries.length, 1, "inbox items and unread count must use one DB snapshot");
assert(listQueries.every(({ values }) => values.includes(7)), "inbox SQL must be owner scoped");
assert(
  listQueries.some(({ sql }) =>
    sql.includes("ORDER BY (read_at IS NULL) DESC, created_at DESC") && sql.includes("LIMIT ?")
  ),
  "inbox must cap at 50 and order unread first, then newest"
);
assert.equal(listQueries[0].values.at(-1), 51, "inbox query must fetch one lookahead row");

const emptyListQueries = [];
const emptyListResult = await listMyNotifications(
  {
    async query(sql, values) {
      emptyListQueries.push({ sql, values });
      return [[]];
    }
  },
  7,
  50
);
assert.deepEqual(emptyListResult, {
  items: [],
  unread_count: 0,
  next_cursor: null,
  has_more: false
});
assert.equal(emptyListQueries.length, 1, "empty inbox must also use one query");

const readQueries = [];
const readResult = await markMyNotificationRead(
  {
    async query(sql, values) {
      readQueries.push({ sql, values });
      if (sql.includes("UPDATE user_notifications")) {
        return [{ affectedRows: 1 }];
      }
      return [notificationRows.map((row) => ({ ...row, read_at: "2026-07-12 10:01:00" }))];
    }
  },
  7,
  11
);
assert.equal(readResult.id, 11);
assert(
  readQueries.every(({ values }) => values.includes(7) && values.includes(11)),
  "read update and fetch must both be owner scoped"
);
assert(
  readQueries.some(({ sql }) => sql.includes("WHERE id = ? AND user_id = ?")),
  "read update must constrain both notification and owner"
);
assert(
  readQueries.some(({ sql }) => sql.includes("read_at = COALESCE(read_at, CURRENT_TIMESTAMP)")),
  "repeated mark-read must preserve the original read_at timestamp"
);

const unchangedOwnedRead = await markMyNotificationRead(
  {
    async query(sql) {
      return sql.includes("UPDATE user_notifications")
        ? [{ affectedRows: 0 }]
        : [notificationRows.map((row) => ({ ...row, read_at: "2026-07-12 10:01:00" }))];
    }
  },
  7,
  11
);
assert.equal(unchangedOwnedRead.id, 11, "repeated mark-read must be idempotent");

await assert.rejects(
  () =>
    markMyNotificationRead(
      {
        async query(sql) {
          return sql.includes("UPDATE user_notifications") ? [{ affectedRows: 0 }] : [[]];
        }
      },
      8,
      11
    ),
  (error) => error?.statusCode === 404
);

assertIncludes(server, 'url.pathname === "/api/users/me/notifications"');
assertIncludes(server, "/^\\/api\\/users\\/me\\/notifications\\/(\\d+)\\/read$/");
assertIncludes(service, "USER_NOTIFICATION_TYPES.SIGNUP_REVIEWED");
assertIncludes(service, "signup-reviewed:${signupId}:approved");
assertIncludes(service, "signup-reviewed:${signupId}:rejected");
const approveBody = service.slice(
  service.indexOf("export async function approveSignup"),
  service.indexOf("export async function rejectSignup")
);
const rejectBody = service.slice(
  service.indexOf("export async function rejectSignup"),
  service.indexOf("export async function updateDeposit")
);
assert(
  rejectBody.indexOf('signup.status !== "pending"') <
    rejectBody.indexOf("UPDATE signups SET status = 'rejected'"),
  "reject must guard pending status before any mutation"
);
assert(
  rejectBody.indexOf('signup.status !== "pending"') <
    rejectBody.indexOf("insertSignupReviewedNotification"),
  "reject must guard pending status before persistent notification insertion"
);
assert.equal(
  approveBody.match(/await insertSignupReviewedNotification\(/g)?.length,
  2,
  "approve must persist review notifications for seat and NPC paths"
);
assert.equal(
  rejectBody.match(/await insertSignupReviewedNotification\(/g)?.length,
  2,
  "reject must persist review notifications for seat and NPC paths"
);
for (const [name, body] of [
  ["approve", approveBody],
  ["reject", rejectBody]
]) {
  assert(
    body.indexOf("requireSignupOwner") < body.indexOf("insertSignupReviewedNotification") &&
      body.lastIndexOf("insertSignupReviewedNotification") < body.indexOf("await tryNotify"),
    `${name} must validate the signup, insert inside the transaction, then notify WeChat post-commit`
  );
}

console.log("D45 session reschedule notification checks passed");
