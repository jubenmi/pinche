import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import {
  buildOrganizerSignupMessages,
  buildPersistentMessages,
  mergeAuthMessages,
  totalMessageBadgeCount,
  totalOrganizerSignupMessageCount
} from "../apps/miniprogram/src/utils/authMessages.js";

const root = process.cwd();
const identityBarPath = path.join(root, "apps/miniprogram/src/components/AuthIdentityBar.vue");
const identityBarSource = fs.readFileSync(identityBarPath, "utf8");

const messages = buildOrganizerSignupMessages([
  {
    id: 11,
    script_name_snapshot: "雾都",
    store_name_snapshot: "山海店",
    start_at: "2026-07-05 19:30:00",
    pending_signup_count: 2
  },
  {
    id: 12,
    script_name_snapshot: "空车",
    store_name_snapshot: "山海店",
    start_at: "2026-07-06 19:30:00",
    pending_signup_count: 0
  },
  {
    id: 13,
    pending_signup_count: 105
  }
]);

assert.equal(messages.length, 2, "only sessions with pending signups become messages");
assert.equal(totalOrganizerSignupMessageCount(messages), 107, "message count should sum pending signups");
assert.equal(messages[0].title, "雾都", "message should preserve script title");
assert.equal(messages[0].badgeText, "2", "small message count should be shown directly");
assert.equal(messages[1].title, "未命名车局", "message should have a script fallback");
assert.equal(messages[1].badgeText, "99+", "large message count should be capped");
assert.match(messages[1].subtitle, /店家待定/, "message should have a store fallback");
assert.match(messages[1].subtitle, /时间待定/, "message should have a time fallback");

const persistentMessages = buildPersistentMessages([
  {
    id: 21,
    type: "signup_reviewed",
    session_id: 11,
    payload: { result: "approved", target_label: "侦探位" },
    read_at: null,
    created_at: "2026-07-12 11:00:00"
  },
  {
    id: 22,
    type: "session_rescheduled",
    session_id: 12,
    payload: {
      old_start_at: "2026-07-12T02:00:00.000Z",
      new_start_at: "2026-07-12T11:30:00.000Z"
    },
    read_at: "2026-07-12 12:00:00",
    created_at: "2026-07-12 12:00:00"
  }
]);
assert.equal(persistentMessages[0].unread, true);
assert.match(persistentMessages[0].title, /审核已通过/);
assert.equal(persistentMessages[0].typeTag, "审核结果");
assert.equal(persistentMessages[0].actionText, "查看结果");
assert.match(persistentMessages[1].subtitle, /2026-07-12 10:00 → 2026-07-12 19:30/);
assert.equal(persistentMessages[1].typeTag, "车局改期");
assert.equal(persistentMessages[1].actionText, "查看车局");
assert.equal(totalMessageBadgeCount(messages, 3), 110);
assert.deepEqual(
  mergeAuthMessages(messages, persistentMessages).map((message) => message.kind),
  ["pending_signup", "pending_signup", "persistent", "persistent"]
);

for (const requiredText of [
  "auth-message-chip",
  "messagePanelVisible",
  "refreshOrganizerMessages",
  "message-panel-title\">消息",
  "/pages/session/manage?id=",
  "/api/users/me/notifications",
  "Promise.allSettled",
  "persistentUnreadCount",
  "handleMessageTap",
  "method: \"POST\"",
  "{{ message.typeTag }}",
  "message.kind === 'persistent' && message.unread"
]) {
  assert(
    identityBarSource.includes(requiredText),
    `AuthIdentityBar must include pending signup message panel support: ${requiredText}`
  );
}

console.log("D25 auth message panel check passed.");
