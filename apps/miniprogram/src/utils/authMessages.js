import { formatSessionStartAt, parseSessionStartAt } from "./sessionReschedule.js";

export function buildOrganizerSignupMessages(sessions = []) {
  return (sessions || [])
    .map((session) => {
      const count = Number(session?.pending_signup_count || 0);
      if (!session?.id || count < 1) {
        return null;
      }
      return {
        kind: "pending_signup",
        type: "pending_signup",
        key: `organizer-signups-${session.id}`,
        sessionId: session.id,
        notificationId: null,
        unread: true,
        createdAt: "",
        count,
        badgeText: count > 99 ? "99+" : String(count),
        title: session.script_name_snapshot || "未命名车局",
        subtitle: [
          session.store_name_snapshot || "店家待定",
          session.start_at || "时间待定"
        ].join(" / "),
        actionText: "去审核",
        targetUrl: `/pages/session/manage?id=${session.id}`
      };
    })
    .filter(Boolean);
}

function safeId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function textOr(value, fallback) {
  const text = typeof value === "string" ? value.trim() : "";
  return text || fallback;
}

function formatShanghaiTime(value, fallback) {
  return parseSessionStartAt(value) ? formatSessionStartAt(value) : fallback;
}

function reviewedMessage(item, common) {
  const payload = item?.payload && typeof item.payload === "object" ? item.payload : {};
  const snapshot = payload.session && typeof payload.session === "object" ? payload.session : {};
  const result = payload.result === "approved" ? "approved" : "rejected";
  const scriptName = textOr(snapshot.script_name_snapshot, "车局信息待定");
  const targetLabel = textOr(payload.target_label, "角色位待定");
  const storeName = textOr(snapshot.store_name_snapshot, "店家待定");
  return {
    ...common,
    result,
    typeTag: "审核结果",
    tagTheme: "primary",
    title: textOr(
      item?.title,
      result === "approved" ? "报名审核已通过" : "报名审核未通过"
    ),
    subtitle: `${scriptName} / ${targetLabel} / ${storeName}`,
    actionText: "查看结果"
  };
}

function rescheduledMessage(item, common) {
  const payload = item?.payload && typeof item.payload === "object" ? item.payload : {};
  const scriptName = textOr(payload.script_name, "车局信息待定");
  const oldStartAt = formatShanghaiTime(payload.old_start_at, "原时间待定");
  const newStartAt = formatShanghaiTime(payload.new_start_at, "新时间待定");
  return {
    ...common,
    typeTag: "车局改期",
    tagTheme: "warning",
    title: textOr(item?.title, "活动时间已调整"),
    subtitle: `${scriptName}：${oldStartAt} → ${newStartAt}`,
    actionText: "查看车局"
  };
}

export function buildPersistentMessages(items = []) {
  return (Array.isArray(items) ? items : []).map((item) => {
    const notificationId = safeId(item?.id);
    const sessionId = safeId(item?.session_id ?? item?.payload?.session?.id);
    const type = item?.type === "session_rescheduled" ? "session_rescheduled" : "signup_reviewed";
    const common = {
      kind: "persistent",
      type,
      key: notificationId ? `notification-${notificationId}` : `notification-unknown-${type}`,
      sessionId,
      notificationId,
      unread: !item?.read_at,
      createdAt: item?.created_at || "",
      targetUrl: sessionId ? `/pages/session/detail?id=${sessionId}` : ""
    };
    return type === "session_rescheduled"
      ? rescheduledMessage(item, common)
      : reviewedMessage(item, common);
  });
}

export function mergeAuthMessages(pendingMessages = [], persistentMessages = []) {
  const persistent = [...(persistentMessages || [])].sort((left, right) => {
    const byCreatedAt = String(right?.createdAt || "").localeCompare(String(left?.createdAt || ""));
    return byCreatedAt || Number(right?.notificationId || 0) - Number(left?.notificationId || 0);
  });
  return [...(pendingMessages || []), ...persistent];
}

export function totalMessageBadgeCount(pendingMessages = [], persistentUnreadCount = 0) {
  return (
    totalOrganizerSignupMessageCount(pendingMessages) +
    Math.max(0, Number(persistentUnreadCount) || 0)
  );
}

export function totalOrganizerSignupMessageCount(messages = []) {
  return (messages || []).reduce((total, message) => total + Number(message?.count || 0), 0);
}
