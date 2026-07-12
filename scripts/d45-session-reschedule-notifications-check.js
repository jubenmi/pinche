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
assertIncludes(service, "SELECT * FROM sessions WHERE id = ? FOR UPDATE");
assertIncludes(service, "body.membersConfirmed !== true");
assertIncludes(service, "USER_NOTIFICATION_TYPES.SESSION_RESCHEDULED");

const rescheduleRoute = 'idMatch(url.pathname, /^\\/api\\/sessions\\/(\\d+)\\/reschedule$/)';
const updateRoute = 'idMatch(url.pathname, /^\\/api\\/sessions\\/(\\d+)$/)';
assertIncludes(server, rescheduleRoute);
assert(
  server.indexOf(rescheduleRoute) < server.indexOf(updateRoute),
  "expected reschedule route before generic session update route"
);

console.log("D45 session reschedule notification checks passed");
