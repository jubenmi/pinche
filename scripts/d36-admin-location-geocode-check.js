import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertIncludes(source, token, message) {
  assert(source.includes(token), message || `Expected source to include ${token}`);
}

function assertExcludes(source, token, message) {
  assert(!source.includes(token), message || `Expected source not to include ${token}`);
}

function functionBody(source, name) {
  const pattern = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\([^)]*\\)\\s*\\{`);
  const match = source.match(pattern);
  assert(match && match.index !== undefined, `${name} should exist`);
  const start = match.index + match[0].length;
  let depth = 1;
  for (let index = start; index < source.length; index += 1) {
    if (source[index] === "{") {
      depth += 1;
    } else if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(start, index);
      }
    }
  }
  throw new Error(`${name} body should be parseable`);
}

const apiConfig = read("apps/api/src/config/env.js");
const apiServer = read("apps/api/src/server.js");
const adminApi = read("apps/admin-web/src/api.js");
const storeDrawer = read("apps/admin-web/src/components/StoreDrawer.vue");
const packageJson = JSON.parse(read("package.json"));
const miniprogramAdminCatalog = read("apps/miniprogram/src/pages/admin/catalog.vue");
const adminEntrypoint = read("apps/admin-web/docker-entrypoint.d/40-admin-runtime-config.sh");

const geocodingPath = path.join(root, "apps/api/src/modules/location/geocoding.js");
assert(fs.existsSync(geocodingPath), "D36 should add API geocoding module");
const geocoding = fs.readFileSync(geocodingPath, "utf8");

for (const token of [
  "TENCENT_MAP_SERVICE_KEY",
  "TENCENT_MAP_KEY",
  "AMAP_WEB_SERVICE_KEY",
  "GAODE_MAP_KEY",
  "map:"
]) {
  assertIncludes(apiConfig, token, `API config should include service-side map config: ${token}`);
}

for (const token of [
  "geocodeStoreLocation",
  "/api/admin/location/geocode",
  "requireRole(user, \"system_admin\")"
]) {
  assertIncludes(apiServer, token, `API server should expose admin geocode route with ${token}`);
}

const routeIndex = apiServer.indexOf("/api/admin/location/geocode");
const requireRoleIndex = apiServer.indexOf("requireRole(user, \"system_admin\")", routeIndex);
assert(routeIndex >= 0 && requireRoleIndex > routeIndex, "geocode route should require system_admin");

for (const token of [
  "https://apis.map.qq.com/ws/geocoder/v1/",
  "https://restapi.amap.com/v3/geocode/geo",
  "geocodeWithTencent",
  "geocodeWithAmap",
  "reliability",
  "level",
  "LOCATION_GEOCODE_FAILED",
  "coordinateNumber",
  "latitude",
  "longitude"
]) {
  assertIncludes(geocoding, token, `geocoding module should include ${token}`);
}

assert(
  geocoding.indexOf("geocodeWithTencent") < geocoding.indexOf("geocodeWithAmap"),
  "geocoding should try Tencent before AMap"
);

for (const forbidden of ["AMAP_WEB_SERVICE_KEY", "GAODE_MAP_KEY"]) {
  assertExcludes(adminEntrypoint, forbidden, `admin runtime config must not expose ${forbidden}`);
  assertExcludes(miniprogramAdminCatalog, forbidden, `mini-program admin must not expose ${forbidden}`);
  assertExcludes(storeDrawer, forbidden, `StoreDrawer must not expose ${forbidden}`);
}

assertIncludes(adminApi, "geocodeStoreLocation", "admin web API should expose geocodeStoreLocation");
assertIncludes(
  adminApi,
  "/api/admin/location/geocode",
  "admin web API should call service-side geocode route"
);

for (const token of [
  "geocodeAddressFallback",
  "geocodeStoreLocation",
  "requestTencentPoiSearch(keyword)",
  "POI 无候选",
  "今日调用量已达到上限",
  "只回填坐标"
]) {
  assertIncludes(storeDrawer, token, `StoreDrawer should include D36 fallback token: ${token}`);
}

const poiSearchBody = functionBody(storeDrawer, "searchPoiByKeyword");
assert(
  poiSearchBody.indexOf("requestTencentPoiSearch(keyword)") <
    poiSearchBody.indexOf('geocodeAddressFallback(keyword, "POI 无候选")'),
  "StoreDrawer search should try Tencent POI before the no-candidate address geocode fallback"
);
assertIncludes(
  poiSearchBody,
  "!hasTencentMapKey.value",
  "StoreDrawer search should use service-side geocode directly when the frontend Tencent POI key is missing"
);
assertIncludes(
  poiSearchBody,
  "normalizedResults.length > 0",
  "POI results should stop fallback when candidates exist"
);

const fallbackBody = functionBody(storeDrawer, "geocodeAddressFallback");
assertIncludes(fallbackBody, "model.latitude", "fallback should write latitude");
assertIncludes(fallbackBody, "model.longitude", "fallback should write longitude");
for (const forbidden of ["model.address =", "model.name =", "model.city =", "model.district ="]) {
  assertExcludes(fallbackBody, forbidden, `fallback should not overwrite ${forbidden}`);
}

assert(
  packageJson.scripts.check.includes("node scripts/d36-admin-location-geocode-check.js"),
  "npm run check should include D36 geocode check"
);

console.log("D36 admin location geocode checks passed");
