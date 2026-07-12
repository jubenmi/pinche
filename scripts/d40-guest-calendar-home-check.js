import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

function read(file) {
  const target = path.join(root, file);
  return fs.existsSync(target) ? fs.readFileSync(target, "utf8") : "";
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function methodBody(source, methodName) {
  const asyncMarker = `async ${methodName}(`;
  const plainMarker = `${methodName}(`;
  const asyncStart = source.indexOf(asyncMarker);
  const start = asyncStart === -1 ? source.indexOf(plainMarker) : asyncStart;
  if (start === -1) {
    return "";
  }
  const bodyStart = source.indexOf("{", start);
  if (bodyStart === -1) {
    return "";
  }
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === "{") {
      depth += 1;
    } else if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(bodyStart + 1, index);
      }
    }
  }
  return "";
}

const home = read("apps/miniprogram/src/pages/index/index.vue");
const calendar = read("apps/miniprogram/src/components/SessionCalendar.vue");
const detail = read("apps/miniprogram/src/pages/session/detail.vue");
const share = read("apps/miniprogram/src/pages/session/share.vue");
const server = read("apps/api/src/server.js");
const service = read("apps/api/src/modules/core/service.js");

assert(
  !home.includes('homeState === "first-session"') && !home.includes("发起第一辆车"),
  "D40 home must remove the first-session entry screen"
);
assert(
  home.includes("我的车局（点击登录）") && home.includes("我的车局（点击创建）"),
  "D40 home must expose the exact guest/member CTA labels"
);
assert(
  home.includes(':show-admin-button="showAdminAction"'),
  "D40 home must wire admin settings visibility through showAdminAction"
);
assert(
  home.includes('const isAdmin = computed(() => roles.value.includes("system_admin"));'),
  "D40 home admin predicate must require the system_admin role"
);
assert(
  home.includes("const showAdminAction = computed(() => isAdmin.value);") &&
    !home.includes("!isAuthenticated.value || isAdmin.value"),
  "D40 home admin settings must render only for system_admin"
);
assert(
  calendar.includes(
    ".calendar-action-bar {\n  display: grid;\n  grid-template-columns: minmax(0, 1fr) auto;"
  ),
  "D40 calendar admin layout must preserve the two-column base row"
);
assert(
  calendar.includes(`:class="{ 'calendar-action-bar--single': !showAdminButton }"`) &&
    calendar.includes(".calendar-action-bar--single") &&
    calendar.includes("grid-template-columns: minmax(0, 1fr);"),
  "D40 calendar create action must fill the row when admin settings are hidden"
);
assert(
  calendar.includes('v-if="showAdminButton"'),
  "D40 calendar must remove the admin settings node for non-admin users"
);
assert(
  home.includes("/api/sessions/public/upcoming?limit=20"),
  "D40 guest home must load the anonymous upcoming-session API"
);
assert(
  home.includes(':calendar-mode="calendarMode"'),
  "D40 home must pass an explicit calendar mode"
);
assert(
  calendar.includes("calendarMode") && calendar.includes('default: "member"'),
  "D40 calendar must expose an explicit guest/member mode prop"
);
assert(calendar.includes("近期车局"), "D40 guest calendar filter must be labelled 近期车局");
for (const token of [
  'class="calendar-empty-route"',
  "今天还没有公开车局",
  "下一场公开车局发布后，会出现在日期轴上",
  "刷新车局",
  "选择其他日期",
  '@tap="refreshCalendar"',
  '@tap="openCalendarDatePicker"',
  '/static/icons/return-green.svg',
  '/static/icons/calendar-green.svg',
  '/static/art/ink-home-landscape.jpg',
  "emptyDateTicks",
  "addDays"
]) {
  assert(calendar.includes(token), `D40 route-timeline empty state must reuse: ${token}`);
}
assert(
  calendar.includes('v-if="filteredCalendarItems.length > 0"') &&
    !calendar.includes(':description="calendarEmptyText"'),
  "D40 empty calendar must replace the generic empty node and hide the redundant load-more footer"
);
assert(
  calendar.includes("/pages/session/detail?id=${id}&entry=guest"),
  "D40 guest cards must mark the detail entry as guest"
);
assert(
  detail.includes('return this.entry === "guest"'),
  "D40 detail must expose an entry=guest preview state"
);
assert(
  detail.includes("车局已发车，仅同车成员可查看"),
  "D40 detail must expose the post-start privacy message"
);
for (const methodName of ["goShare", "goManage", "goAlbum"]) {
  const body = methodBody(detail, methodName);
  assert(body.includes("ensureProtectedActionLogin"), `D40 ${methodName} must gate identity actions`);
}
assert(
  server.includes('url.pathname === "/api/sessions/public/upcoming"'),
  "D40 API must expose an anonymous public-upcoming route"
);
assert(
  server.includes('url.pathname === "/api/testing/d40-smoke-target"'),
  "D40 API must expose the guarded smoke target"
);
const d40SmokeDatabaseGuard = methodBody(server, "d40SmokeDatabaseIsIsolated");
for (const guardToken of [
  'config.nodeEnv !== "production"',
  "config.wechat.mockLogin === true",
  'process.env.D40_SMOKE_ISOLATED === "1"',
  "localHost",
  'config.mysql.database === "pinche_d40_test"'
]) {
  assert(
    d40SmokeDatabaseGuard.includes(guardToken),
    `D40 API smoke database guard must include: ${guardToken}`
  );
}
assert(
  d40SmokeDatabaseGuard,
  "D40 API must refuse smoke writes unless the dedicated local test database is active"
);
assert(
  service.includes("export async function listPublicUpcomingSessions"),
  "D40 service must expose the public-upcoming query"
);
assert(
  service.includes("pending_npc_signup.session_npc_role_id = open_npc.id") &&
    service.includes("pending_npc_signup.status = 'pending'"),
  "D40 public-upcoming query must not count NPC roles with pending signups as open"
);
assert(
  service.includes("export async function getSessionForViewer"),
  "D40 service must authorize session detail by viewer"
);
assert(
  server.includes("session_join_invite") && share.includes("inviteToken"),
  "D40 friend/group sharing must carry a signed join invitation"
);
assert(
  calendar.includes("/pages/session/detail?id=${id}&entry=city"),
  "D40 must preserve D39 city preview routing"
);

const packageJson = JSON.parse(read("package.json"));
assert(
  packageJson.scripts.check.includes("node scripts/d40-guest-calendar-home-check.js"),
  "npm run check must include the D40 guest-calendar check"
);

console.log("D40 guest calendar home checks passed");
