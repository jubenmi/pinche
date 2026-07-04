import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import {
  buildOrganizerSignupMessages,
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

for (const requiredText of [
  "auth-message-chip",
  "messagePanelVisible",
  "refreshOrganizerMessages",
  "待处理申请",
  "/pages/session/manage?id="
]) {
  assert(
    identityBarSource.includes(requiredText),
    `AuthIdentityBar must include pending signup message panel support: ${requiredText}`
  );
}

console.log("D25 auth message panel check passed.");
