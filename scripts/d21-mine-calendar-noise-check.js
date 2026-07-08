import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

function read(file) {
  return fs.readFileSync(path.join(root, file), "utf8");
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const packageJson = JSON.parse(read("package.json"));
assert(
  packageJson.scripts.check.includes("scripts/d21-mine-calendar-noise-check.js"),
  "root check should run d21 mine calendar noise check"
);

const mine = read("apps/miniprogram/src/pages/mine/index.vue");
const calendar = read("apps/miniprogram/src/components/SessionCalendar.vue");

assert(
  mine.includes("SessionCalendar"),
  "Mine page must render the shared SessionCalendar component"
);

assert(
  !calendar.includes('class="summary-grid"') && !calendar.includes('class="summary-card"'),
  "Mine calendar hero must not repeat initiated/joined counts as duplicate summary cards"
);
assert(
  !calendar.includes('class="hero-role"') && !calendar.includes("rolesText"),
  "Mine calendar hero must not expose raw technical auth roles"
);
assert(
  !calendar.includes("下拉刷新最新车局") && !calendar.includes('class="load-hint top"'),
  "Mine calendar list must not render the redundant pull-to-refresh instruction"
);
assert(
  ((calendar.includes('v-for="filter in visibleFilterTabs"') ||
    ((calendar.includes(':options="visibleFilterSegmentOptions"') ||
      calendar.includes(':options="safeVisibleFilterSegmentOptions"')) &&
      calendar.includes("const visibleFilterSegmentOptions = computed") &&
      calendar.includes("visibleFilterTabs.value.map"))) &&
    calendar.includes("const visibleFilterTabs = computed") &&
    calendar.includes("tab.count > 0")),
  "Mine calendar filters must hide zero-count state tabs"
);
assert(
  calendar.includes("if (pendingSignupCount > 0)") &&
    !calendar.includes("return `${Number(item.session?.seat_count || 0)}位 · ${pendingSignupCount}"),
  "Mine calendar rows must hide zero pending-review status text"
);
assert(
  calendar.includes('@tap="handleCalendarCardTap(item)"') &&
    !calendar.includes('class="session-action"') &&
    !calendar.includes("item.actionLabel"),
  "Mine calendar cards must use the whole card as the primary action instead of rendering a Manage button"
);
assert(
  !calendar.includes('value: "joined", label: "参与"') &&
    !calendar.includes('activeCalendarFilter.value === "joined"') &&
    !calendar.includes(".type-badge.joined"),
  "Mine calendar cards must not duplicate participation when a role name already identifies the user"
);
assert(
  !calendar.includes("`${seatName} ${signup.seat_role_name}`") &&
    calendar.includes("function compactSignupRoleText"),
  "Mine calendar role text must collapse duplicate seat and role names into one label"
);
assert(
  !calendar.includes('return "先删照片";') &&
    !calendar.includes('return "取消";') &&
    calendar.includes('return hasOtherOnboardMembers(session) ? "退出" : "删除";'),
  "Mine calendar organized removal button must show Delete instead of Cancel or pre-delete instructions"
);
assert(
  calendar.includes("相册照片没有清空之前无法删除") &&
    calendar.includes('confirmText: "知道了"') &&
    !calendar.includes('"去相册"'),
  "Mine calendar delete must block album-backed sessions with a clear no-op message"
);
assert(
  calendar.includes('class="session-detail-line"') &&
    calendar.includes('grid-template-columns: minmax(0, 1fr) 92rpx;') &&
    !calendar.includes('class="session-side"') &&
    !calendar.includes('class="session-pills"'),
  "Mine calendar card layout must use a simpler two-column layout"
);

console.log("D21 mine calendar noise check passed");
