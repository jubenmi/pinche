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

const specFiles = [
  "specs/d38-city-session-discovery/requirements.md",
  "specs/d38-city-session-discovery/design.md",
  "specs/d38-city-session-discovery/tasks.md"
];
for (const file of specFiles) {
  assert(read(file), `D38 spec file should exist: ${file}`);
}

const calendar = read("apps/miniprogram/src/components/SessionCalendar.vue");
for (const token of [
  '{ value: "mine", label: "我的"',
  '{ value: "city", label: "同城"',
  'url: "/api/sessions/discovery"',
  'method: "POST"',
  "getCityDiscoveryLocation",
  "readCityDiscoveryCache",
  "writeCityDiscoveryCache",
  "locationFromCache",
  "!locationFromCache",
  "cityLocationState",
  "cityRefreshing",
  'uni.openSetting',
  "item.canManage || item.canRemove",
  "/pages/session/detail?id=",
  "剩余"
]) {
  assert(calendar.includes(token), `SessionCalendar should include D38 contract: ${token}`);
}
for (const legacyToken of [
  '{ value: "all", label: "全部"',
  '{ value: "organized", label: "发起"',
  '{ value: "pending", label: "待处理"'
]) {
  assert(!calendar.includes(legacyToken), `SessionCalendar should remove legacy filter: ${legacyToken}`);
}

const setup = read("apps/miniprogram/src/pages/session/setup.vue");
for (const token of [
  "同城展示",
  "cityVisible: true",
  "setCityVisible",
  'visibility: this.cityVisible ? "public" : "share_only"'
]) {
  assert(setup.includes(token), `Session setup should include D38 visibility: ${token}`);
}

const service = read("apps/api/src/modules/core/service.js");
for (const token of [
  "normalizeSessionVisibility",
  "export async function listDiscoverableSessions",
  "session.status = 'recruiting'",
  "session.start_at > CURRENT_TIMESTAMP",
  "session.visibility = 'public'",
  "session.organizer_user_id <> ?",
  "open_seat.status = 'open'",
  "mine.status IN ('pending', 'approved')",
  "available_seat_count",
  "distance_km",
  "const rowLimit = city ? limitValue(filters.limit, 50) : 5"
]) {
  assert(service.includes(token), `Core service should include D38 discovery rule: ${token}`);
}
const discoveryServiceStart = service.indexOf("export async function listDiscoverableSessions");
const discoveryServiceEnd = service.indexOf("export async function listAdminSessions", discoveryServiceStart);
const discoveryService = service.slice(discoveryServiceStart, discoveryServiceEnd);
assert(!discoveryService.includes("ROUND("), "Discovery should sort by unrounded distance");
assert(
  discoveryService.includes("Number(Number(row.distance_km).toFixed(1))"),
  "Discovery should round distance only while formatting the response"
);

const server = read("apps/api/src/server.js");
assert(
  server.includes('request.method === "POST"') &&
    server.includes('url.pathname === "/api/sessions/discovery"'),
  "Server should expose POST /api/sessions/discovery"
);
assert(server.includes("reverseGeocodeCity"), "Discovery route should reverse-geocode coordinates");
assert(server.includes("listDiscoverableSessions"), "Discovery route should query discoverable sessions");
assert(
  !server.includes('request.method === "GET" && url.pathname === "/api/sessions/discovery"'),
  "Discovery should not put precise coordinates in a GET query"
);

const geocoding = read("apps/api/src/modules/location/geocoding.js");
for (const token of [
  "export async function reverseGeocodeCity",
  "reverseGeocodeWithTencent",
  "reverseGeocodeWithAmap",
  "LOCATION_REVERSE_GEOCODE_FAILED",
  "REVERSE_GEOCODE_TIMEOUT_MS = 2500",
  "options.timeoutMs ?? REVERSE_GEOCODE_TIMEOUT_MS",
  "get_poi"
]) {
  assert(geocoding.includes(token), `Geocoding should include D38 reverse lookup: ${token}`);
}

const utility = read("apps/miniprogram/src/utils/cityDiscovery.js");
assert(!utility.includes("globalThis.uni"), "City discovery should use the uni-app runtime proxy");
assert(utility.includes('typeof uni === "undefined"'), "City discovery should guard direct uni access in Node tests");
for (const token of [
  "CITY_DISCOVERY_CACHE_KEY",
  "CITY_DISCOVERY_CACHE_TTL_MS",
  "24 * 60 * 60 * 1000",
  "getCityDiscoveryLocation",
  'type: "gcj02"',
  "locationFailureState",
  "discoveryRequestBody"
]) {
  assert(utility.includes(token), `City discovery utility should include: ${token}`);
}
assert(
  calendar.includes("timeout: 12000"),
  "Discovery request timeout should leave room for provider fallback and the database query"
);

const manifest = JSON.parse(read("apps/miniprogram/src/manifest.json"));
const mpWeixin = manifest["mp-weixin"] || {};
assert(
  mpWeixin.permission?.["scope.userLocation"]?.desc?.includes("同城"),
  "Manifest should explain the city discovery location purpose"
);
assert(
  Array.isArray(mpWeixin.requiredPrivateInfos) &&
    mpWeixin.requiredPrivateInfos.includes("chooseLocation") &&
    mpWeixin.requiredPrivateInfos.includes("getLocation"),
  "Manifest should declare chooseLocation and getLocation"
);

const home = read("apps/miniprogram/src/pages/index/index.vue");
assert(
  home.includes("<SessionCalendar") && home.includes(':calendar-mode="calendarMode"'),
  "Home should always render the shared calendar in the active authentication mode"
);
assert(
  !home.includes("first-session") && !home.includes('homeState.value ='),
  "An empty mine list should not hide city discovery behind the retired entry state"
);

const smoke = read("scripts/d38-city-session-discovery-smoke.js");
for (const token of [
  "qualifying public session should be discoverable",
  "share-only session should not be discoverable",
  "organizer-owned session should not be discoverable",
  "active signup session should not be discoverable",
  "approved signup session should not be discoverable",
  "locked session should not be discoverable",
  "cancelled session should not be discoverable",
  "store without coordinates should sort after measured stores",
  "distance ordering should use unrounded precision",
  "fallback should return at most five sessions",
  "discovery should reject invalid coordinates",
  "discovery should require login"
]) {
  assert(smoke.includes(token), `D38 smoke should cover: ${token}`);
}

const packageJson = JSON.parse(read("package.json"));
for (const command of [
  "node scripts/d38-city-session-discovery-check.js",
  "node scripts/d38-city-discovery-unit-check.js",
  "node scripts/d38-reverse-geocoding-unit-check.js",
  "node --check scripts/d38-city-session-discovery-smoke.js"
]) {
  assert(packageJson.scripts.check.includes(command), `npm run check should include: ${command}`);
}

console.log("D38 city session discovery checks passed");
