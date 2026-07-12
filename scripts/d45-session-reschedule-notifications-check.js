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

console.log("D45 session reschedule notification checks passed");
