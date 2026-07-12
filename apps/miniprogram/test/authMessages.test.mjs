import test from "node:test";
import assert from "node:assert/strict";
import {
  buildOrganizerSignupMessages,
  buildPersistentMessages,
  mergeAuthMessages,
  totalMessageBadgeCount
} from "../src/utils/authMessages.js";

test("normalizes pending signup messages", () => {
  const [message] = buildOrganizerSignupMessages([
    {
      id: 12,
      script_name_snapshot: "雾都",
      store_name_snapshot: "山海店",
      start_at: "2026-07-12 19:30:00",
      pending_signup_count: 2
    }
  ]);

  assert.deepEqual(message, {
    kind: "pending_signup",
    type: "pending_signup",
    key: "organizer-signups-12",
    title: "雾都",
    subtitle: "山海店 / 2026-07-12 19:30:00",
    actionText: "去审核",
    sessionId: 12,
    notificationId: null,
    unread: true,
    createdAt: "",
    count: 2,
    badgeText: "2",
    targetUrl: "/pages/session/manage?id=12"
  });
});

test("builds defensive signup-reviewed copy and target", () => {
  const messages = buildPersistentMessages([
    {
      id: 31,
      type: "signup_reviewed",
      session_id: 12,
      title: "",
      payload: {
        result: "approved",
        target_label: "侦探位",
        session: { script_name_snapshot: "雾都", store_name_snapshot: "山海店" }
      },
      read_at: null,
      created_at: "2026-07-12 10:00:00"
    },
    { id: 32, type: "signup_reviewed", payload: { result: "rejected" }, read_at: "read" }
  ]);

  assert.equal(messages[0].title, "报名审核已通过");
  assert.equal(messages[0].subtitle, "雾都 / 侦探位 / 山海店");
  assert.equal(messages[0].result, "approved");
  assert.equal(messages[0].targetUrl, "/pages/session/detail?id=12");
  assert.equal(messages[0].unread, true);
  assert.equal(messages[1].title, "报名审核未通过");
  assert.match(messages[1].subtitle, /车局信息待定/);
});

test("formats reschedule old to new copy in Asia/Shanghai", () => {
  const [message] = buildPersistentMessages([
    {
      id: 41,
      type: "session_rescheduled",
      session_id: 22,
      payload: {
        script_name: "孤城",
        old_start_at: "2026-07-12T02:00:00.000Z",
        new_start_at: "2026-07-12T11:30:00.000Z"
      },
      read_at: null,
      created_at: "2026-07-12T03:00:00.000Z"
    }
  ]);

  assert.equal(message.title, "活动时间已调整");
  assert.equal(message.subtitle, "孤城：2026-07-12 10:00 → 2026-07-12 19:30");
  assert.equal(message.targetUrl, "/pages/session/detail?id=22");
});

test("counts pending signups plus persistent API unread count", () => {
  const pending = buildOrganizerSignupMessages([
    { id: 1, pending_signup_count: 3 },
    { id: 2, pending_signup_count: 4 }
  ]);
  assert.equal(totalMessageBadgeCount(pending, 5), 12);
  assert.equal(totalMessageBadgeCount(pending, -20), 7);
});

test("merges pending first and persistent newest with stable id tie-break", () => {
  const pending = buildOrganizerSignupMessages([
    { id: 2, pending_signup_count: 1 },
    { id: 1, pending_signup_count: 1 }
  ]);
  const persistent = buildPersistentMessages([
    { id: 8, type: "signup_reviewed", created_at: "2026-07-12 10:00:00" },
    { id: 9, type: "signup_reviewed", created_at: "2026-07-12 11:00:00" },
    { id: 10, type: "signup_reviewed", created_at: "2026-07-12 11:00:00" }
  ]);

  assert.deepEqual(
    mergeAuthMessages(pending, persistent).map(({ key }) => key),
    ["organizer-signups-2", "organizer-signups-1", "notification-10", "notification-9", "notification-8"]
  );
});

test("persistent navigation target falls back safely when session is missing", () => {
  const [message] = buildPersistentMessages([{ id: 5, type: "session_rescheduled" }]);
  assert.equal(message.targetUrl, "");
  assert.equal(message.sessionId, null);
});
