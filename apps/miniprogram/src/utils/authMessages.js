export function buildOrganizerSignupMessages(sessions = []) {
  return (sessions || [])
    .map((session) => {
      const count = Number(session?.pending_signup_count || 0);
      if (!session?.id || count < 1) {
        return null;
      }
      return {
        key: `organizer-signups-${session.id}`,
        sessionId: session.id,
        count,
        badgeText: count > 99 ? "99+" : String(count),
        title: session.script_name_snapshot || "未命名车局",
        subtitle: [
          session.store_name_snapshot || "店家待定",
          session.start_at || "时间待定"
        ].join(" / "),
        actionText: "去审核"
      };
    })
    .filter(Boolean);
}

export function totalOrganizerSignupMessageCount(messages = []) {
  return (messages || []).reduce((total, message) => total + Number(message?.count || 0), 0);
}
