# City Session Discovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the calendar filters with “我的 / 同城” and add an authenticated, privacy-conscious discovery flow that returns actionable city sessions or five time-based fallback sessions.

**Architecture:** The API extends the existing location provider module for reverse geocoding and adds a discovery query to the core service. The mini program owns a focused location/cache utility while `SessionCalendar.vue` owns discovery UI state, keeping home and mine pages behaviorally aligned. Precise coordinates travel only in a POST body and remain client-cached for at most 24 hours.

**Tech Stack:** Node.js 20, native HTTP server, MySQL, UniApp Vue 3, TDesign mini program components, Node assert/static check scripts, WeChat Developer Tools CLI.

---

## File Map

- Create `scripts/d38-city-session-discovery-check.js`: source-level D38 contract check.
- Create `scripts/d38-city-discovery-unit-check.js`: cache, coordinate, location-state, and request-body checks.
- Create `scripts/d38-reverse-geocoding-unit-check.js`: Tencent-first and Amap-fallback reverse geocoding checks.
- Create `scripts/d38-city-session-discovery-smoke.js`: authenticated API eligibility and ordering smoke scenarios.
- Create `apps/miniprogram/src/utils/cityDiscovery.js`: GCJ-02 validation, 24-hour cache, location request, and POST payload helpers.
- Modify `apps/api/src/modules/location/geocoding.js`: reverse-geocode provider functions and fallback orchestration.
- Modify `apps/api/src/modules/core/service.js`: session visibility normalization and discoverable-session query.
- Modify `apps/api/src/server.js`: authenticated `POST /api/sessions/discovery` orchestration.
- Modify `apps/miniprogram/src/pages/session/setup.vue`: default-on “同城展示” switch and visibility payload.
- Modify `apps/miniprogram/src/components/SessionCalendar.vue`: fixed tabs, lazy discovery, fallback prompt, scoped refresh, and discovery cards.
- Modify `apps/miniprogram/src/pages/index/index.vue`: render the calendar for authenticated users even when “我的” is empty.
- Modify `apps/miniprogram/src/manifest.json`: declare `getLocation` and its purpose.
- Modify `scripts/d34-store-location-check.js`: replace the superseded “must not declare getLocation” assertion with the D38 permission expectation.
- Modify `package.json`: include D38 checks and smoke syntax validation in `npm run check`.
- Modify `specs/d38-city-session-discovery/tasks.md`: check off work only after its command evidence exists.

### Task 1: Establish Red Checks

**Files:**
- Create: `scripts/d38-city-session-discovery-check.js`
- Create: `scripts/d38-city-discovery-unit-check.js`
- Create: `scripts/d38-reverse-geocoding-unit-check.js`
- Create: `scripts/d38-city-session-discovery-smoke.js`
- Modify: `package.json`
- Modify: `specs/d38-city-session-discovery/tasks.md`

- [x] **Step 1: Add the static contract check**

Read the spec, calendar, setup, manifest, server, service, utility, smoke, and package files. Assert these contracts:

```js
assert(calendar.includes('{ value: "mine", label: "我的"'), "calendar should expose 我的");
assert(calendar.includes('{ value: "city", label: "同城"'), "calendar should expose 同城");
assert(!calendar.includes('label: "全部"'), "legacy 全部 filter should be removed");
assert(calendar.includes('url: "/api/sessions/discovery"'), "city data should use discovery API");
assert(calendar.includes('method: "POST"'), "discovery should send coordinates in a POST body");
assert(service.includes("session.visibility = 'public'"), "discovery should require public visibility");
assert(service.includes("session.start_at > CURRENT_TIMESTAMP"), "discovery should require a future start");
assert(service.includes("mine.status IN ('pending', 'approved')"), "discovery should exclude active membership");
assert(setup.includes("同城展示"), "setup should expose city visibility");
assert(setup.includes('visibility: this.cityVisible ? "public" : "share_only"'), "setup should send visibility");
assert(manifest["mp-weixin"].requiredPrivateInfos.includes("getLocation"), "manifest should declare getLocation");
assert(packageJson.scripts.check.includes("d38-city-session-discovery-check.js"), "npm check should include D38");
```

- [x] **Step 2: Add failing utility checks**

Import the wished-for API from `cityDiscovery.js` and assert valid coordinates, invalid coordinate rejection, 24-hour cache expiry/cleanup, POST body generation, successful `gcj02` location, denied state, and unavailable state:

```js
assert.equal(CITY_DISCOVERY_CACHE_TTL_MS, 24 * 60 * 60 * 1000);
assert.deepEqual(discoveryRequestBody({ latitude: 39.9, longitude: 116.4 }), {
  latitude: 39.9,
  longitude: 116.4,
  limit: 50
});
assert.equal(locationFailureState({ errMsg: "getLocation:fail auth deny" }), "denied");
assert.equal(locationFailureState({ code: "LOCATION_UNAVAILABLE" }), "unavailable");
```

- [x] **Step 3: Add failing reverse-geocoding checks**

Import `reverseGeocodeCity` and use an injected `fetchImpl`. Verify Tencent succeeds in one call, Tencent failure falls back to Amap in two calls, municipalities fall back from an empty city to province, invalid coordinates reject with 400, and two provider failures reject with `LOCATION_REVERSE_GEOCODE_FAILED`.

- [x] **Step 4: Add the API smoke script before implementation**

Use the existing `BASE_URL`, dev login, phone authorization, admin store/script creation, seat creation, and publish APIs. Create qualifying and excluded sessions for `public`, `share_only`, draft, past, full, organizer-owned, and already-signed-up cases. Call:

```js
await request("POST", "/api/sessions/discovery", {
  city: "北京",
  latitude: 39.9042,
  longitude: 116.4074
}, player.token);
```

Also verify no-location fallback returns no more than five rows sorted by `start_at`, invalid coordinates return 400, and no token returns 401.

- [x] **Step 5: Run red checks and record the failures**

Run:

```bash
node scripts/d38-city-session-discovery-check.js
node scripts/d38-city-discovery-unit-check.js
node scripts/d38-reverse-geocoding-unit-check.js
```

Expected: each fails because the D38 production contract or export does not yet exist. Record these observed failures under D38.2 in `tasks.md`.

### Task 2: Reverse Geocoding and Discovery API

**Files:**
- Modify: `apps/api/src/modules/location/geocoding.js`
- Modify: `apps/api/src/modules/core/service.js`
- Modify: `apps/api/src/server.js`
- Test: `scripts/d38-reverse-geocoding-unit-check.js`
- Test: `scripts/d38-city-session-discovery-check.js`

- [x] **Step 1: Implement reverse geocoding minimally**

Add `reverseGeocodeWithTencent`, `reverseGeocodeWithAmap`, and:

```js
export async function reverseGeocodeCity(input = {}, options = {}) {
  const location = reverseGeocodeInput(input);
  const failures = [];
  try {
    return await reverseGeocodeWithTencent(location, options);
  } catch (error) {
    failures.push(publicFailure(error, "tencent"));
  }
  try {
    return await reverseGeocodeWithAmap(location, options);
  } catch (error) {
    failures.push(publicFailure(error, "amap"));
  }
  throw new AppError(502, "LOCATION_REVERSE_GEOCODE_FAILED", "Location reverse geocoding failed", { failures });
}
```

Tencent uses `location=lat,lng&get_poi=0`; Amap uses `location=lng,lat`. Normalize city from `city || province`, trim it, and reject an empty provider result.

- [x] **Step 2: Verify reverse tests turn green**

Run: `node scripts/d38-reverse-geocoding-unit-check.js`

Expected: `D38 reverse geocoding unit checks passed`.

- [x] **Step 3: Normalize session visibility**

Add:

```js
function normalizeSessionVisibility(value = "share_only") {
  const visibility = String(value || "share_only").trim();
  if (!["public", "share_only"].includes(visibility)) {
    throw badRequest("visibility must be public or share_only");
  }
  return visibility;
}
```

Use it in `createSession` and only when visibility is present in `updateSession`.

- [x] **Step 4: Implement discoverable-session SQL**

Add `listDiscoverableSessions(user, filters)` using `optionalLatitude`, `optionalLongitude`, a paired-coordinate check, a 64-character safe city, city variants such as `北京` and `北京市`, and the exact predicates:

```sql
session.status = 'recruiting'
AND session.start_at > CURRENT_TIMESTAMP
AND session.visibility = 'public'
AND session.organizer_user_id <> ?
AND EXISTS (
  SELECT 1 FROM session_seats open_seat
  WHERE open_seat.session_id = session.id AND open_seat.status = 'open'
)
AND NOT EXISTS (
  SELECT 1 FROM signups mine
  WHERE mine.session_id = session.id
    AND mine.user_id = ?
    AND mine.status IN ('pending', 'approved')
)
```

Return only card fields plus `seat_count`, `available_seat_count`, and nullable one-decimal Haversine `distance_km`. City mode sorts by date, null-distance placement, distance, time, and ID; fallback sorts by time and ID and hard-limits to five.

- [x] **Step 5: Add the authenticated POST route**

In `server.js`, resolve a supplied cached city as provider `cache`; otherwise reverse-geocode a complete coordinate pair. Catch only `LOCATION_REVERSE_GEOCODE_FAILED` and then call the service without location for time fallback. Return:

```js
{
  mode: city ? "city" : "time_fallback",
  city: city || null,
  location_provider: locationProvider,
  sessions
}
```

Do not log the request body or coordinates.

- [x] **Step 6: Run focused backend checks**

Run:

```bash
node scripts/d38-reverse-geocoding-unit-check.js
node --check apps/api/src/modules/location/geocoding.js
node --check apps/api/src/modules/core/service.js
node --check apps/api/src/server.js
```

Expected: all exit 0.

### Task 3: Create Visibility and Client Location Utility

**Files:**
- Modify: `apps/miniprogram/src/pages/session/setup.vue`
- Create: `apps/miniprogram/src/utils/cityDiscovery.js`
- Modify: `apps/miniprogram/src/manifest.json`
- Modify: `scripts/d34-store-location-check.js`
- Test: `scripts/d38-city-discovery-unit-check.js`

- [x] **Step 1: Implement the cache/location utility**

Export `CITY_DISCOVERY_CACHE_KEY`, `CITY_DISCOVERY_CACHE_TTL_MS`, `validDiscoveryCoordinates`, `readCityDiscoveryCache`, `writeCityDiscoveryCache`, `clearCityDiscoveryCache`, `getCityDiscoveryLocation`, `locationFailureState`, and `discoveryRequestBody`. Cache objects have exactly `city`, `latitude`, `longitude`, and `cachedAt`; invalid, future, malformed, or expired objects are removed.

- [x] **Step 2: Verify the utility test turns green**

Run: `node scripts/d38-city-discovery-unit-check.js`

Expected: `D38 city discovery utility checks passed`.

- [x] **Step 3: Add the default-on setup switch**

Add `cityVisible: true`, restore it with `flow.cityVisible === undefined ? true : Boolean(flow.cityVisible)`, persist it on change, and send:

```js
visibility: this.cityVisible ? "public" : "share_only"
```

Render a TDesign switch titled “同城展示” with the text “开启后，同城玩家可以发现这辆车；关闭后仅通过分享链接加入。”

- [x] **Step 4: Update location permission declarations**

Add `getLocation` to `requiredPrivateInfos` and update `scope.userLocation.desc` to mention choosing a store and discovering city sessions. Update the D34 check so it expects the new declaration instead of forbidding it.

- [x] **Step 5: Run focused client checks**

Run:

```bash
node scripts/d38-city-discovery-unit-check.js
node scripts/d34-store-location-check.js
```

Expected: both exit 0.

### Task 4: “我的 / 同城” Calendar

**Files:**
- Modify: `apps/miniprogram/src/components/SessionCalendar.vue`
- Modify: `apps/miniprogram/src/pages/index/index.vue`
- Test: `scripts/d38-city-session-discovery-check.js`

- [x] **Step 1: Replace the filter model**

Use `activeFilter = ref("mine")`, fixed mine/city tab options, `mineCalendarItems`, `cityCalendarItems`, and an active data source. Preserve existing merge/dedup behavior and all card-level pending/organizer state.

- [x] **Step 2: Add discovery state and lazy loading**

Track `citySessions`, `cityLoading`, `cityRefreshing`, `cityLoaded`, `cityMode`, `cityName`, `cityLocationState`, `cityStatusText`, and the last coordinates. On first city selection, read valid cache or call `getCityDiscoveryLocation`, then POST to `/api/sessions/discovery`. On denial/unavailability, POST an empty location body and keep the inline authorization prompt visible beside fallback cards.

- [x] **Step 3: Add retry/settings behavior**

“开启定位” calls `uni.openSetting`; when `scope.userLocation` is enabled it clears stale state, locates again, and reloads. If `openSetting` is unavailable, call location directly. Never loop from `onShow` or timers.

- [x] **Step 4: Build discovery cards**

Map each API row to a future card with `canManage = false`, `canRemove = false`, `roleText = 剩余 N 位`, optional distance text, and click navigation to `/pages/session/detail?id=...`. Render the action container only when `canManage || canRemove`; mine cards retain their current actions.

- [x] **Step 5: Scope loading, empty text, refresh, paging, and date direction**

Mine keeps descending order and parent refresh. City keeps API ascending order and component refresh. Bind the scroll refresher to the active scope, reset pagination/selection/collapse state on tab change, and make date target helpers choose the nearest date according to the active sort direction.

- [x] **Step 6: Preserve city access when mine is empty**

After an authenticated home load succeeds, always set `homeState = "calendar"`; keep `first-session` for logged-out users. The existing create button remains visible in the calendar.

- [x] **Step 7: Run the static check to green**

Run: `node scripts/d38-city-session-discovery-check.js`

Expected: `D38 city session discovery checks passed`.

### Task 5: Integrated Verification

**Files:**
- Modify: `specs/d38-city-session-discovery/tasks.md`

- [x] **Step 1: Run focused checks**

```bash
node scripts/d38-city-session-discovery-check.js
node scripts/d38-city-discovery-unit-check.js
node scripts/d38-reverse-geocoding-unit-check.js
node --check apps/api/src/modules/core/service.js
node --check apps/api/src/server.js
node scripts/check-miniprogram.js
```

- [x] **Step 2: Run repository verification**

```bash
npm run check
npm run build:mp-weixin
```

Expected: both exit 0. Any unrelated pre-existing failure is recorded with its exact command and output; D38 failures are fixed before proceeding.

- [x] **Step 3: Run backend smoke when the local API/database is available**

Run: `node scripts/d38-city-session-discovery-smoke.js`

Expected: `D38 city session discovery smoke passed`.

- [ ] **Step 4: Verify in WeChat Developer Tools**

Open the generated mini program and verify: fixed tabs, empty mine access, successful location and distance, denied location prompt plus five fallback cards, authorization recovery, no discovery card actions, detail navigation, and the setup visibility switch.

- [x] **Step 5: Update the spec task record**

Check only evidenced items in `specs/d38-city-session-discovery/tasks.md` and append dated command outcomes under 验证记录. Do not mark smoke or Developer Tools complete when their environment was unavailable.

## Shared Worktree Note

The current `develop` worktree contains user changes in several D38 target files. Apply narrow patches and inspect diffs after every task. Do not reset, restore, or auto-commit implementation files because a file-level commit could absorb unrelated user work; commit only after the user explicitly requests integration and the diff has been separated safely.
