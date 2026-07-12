import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

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
assertIncludes(subscribeMessage, "export async function notifySessionRescheduled");
assertIncludes(subscribeMessage, 'scene: "session_rescheduled"');
assertIncludes(subscribeMessage, "rescheduleMessageData");
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

console.log("D45 session reschedule notification checks passed");
