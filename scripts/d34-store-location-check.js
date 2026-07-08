import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

function read(file) {
  return fs.readFileSync(path.join(root, file), "utf8");
}

function exists(file) {
  return fs.existsSync(path.join(root, file));
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function functionBody(source, name) {
  const marker = `function ${name}`;
  const start = source.indexOf(marker);
  assert(start >= 0, `${name} should exist`);
  const signatureEnd = source.indexOf(") {", start);
  assert(signatureEnd >= 0, `${name} signature should be parseable`);
  const braceStart = source.indexOf("{", signatureEnd);
  let depth = 0;
  for (let index = braceStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(braceStart, index + 1);
      }
    }
  }
  throw new Error(`${name} body should be parseable`);
}

function exportedFunctionBody(source, name) {
  return functionBody(source, name).replace(`function ${name}`, `export async function ${name}`);
}

const migrationFile = "apps/api/migrations/0022_store_location_data.sql";
assert(exists(migrationFile), "D34 migration should exist");
const migration = read(migrationFile);
assert(migration.includes("information_schema.columns"), "D34 migration should be idempotent");
assert(
  migration.includes("latitude DECIMAL(10, 7) NULL"),
  "stores.latitude should be DECIMAL(10, 7) NULL"
);
assert(
  migration.includes("longitude DECIMAL(10, 7) NULL"),
  "stores.longitude should be DECIMAL(10, 7) NULL"
);

const service = read("apps/api/src/modules/core/service.js");
for (const token of ["optionalCoordinate", "optionalLatitude", "optionalLongitude"]) {
  assert(service.includes(`function ${token}`), `service should define ${token}`);
}
assert(service.includes("-90") && service.includes("90"), "latitude range should be validated");
assert(service.includes("-180") && service.includes("180"), "longitude range should be validated");

for (const name of ["createStore"]) {
  const body = exportedFunctionBody(service, name);
  assert(body.includes("optionalLatitude(body.latitude)"), `${name} should normalize latitude`);
  assert(body.includes("optionalLongitude(body.longitude)"), `${name} should normalize longitude`);
  assert(body.includes("latitude") && body.includes("longitude"), `${name} should insert coordinates`);
}

if (service.includes("function createPrivateStore")) {
  const body = exportedFunctionBody(service, "createPrivateStore");
  assert(body.includes("optionalLatitude(body.latitude)"), "createPrivateStore should normalize latitude");
  assert(body.includes("optionalLongitude(body.longitude)"), "createPrivateStore should normalize longitude");
  assert(body.includes("latitude") && body.includes("longitude"), "createPrivateStore should insert coordinates");
}

const updateStoreBody = exportedFunctionBody(service, "updateStore");
assert(updateStoreBody.includes("optionalLatitude(body.latitude)"), "updateStore should normalize latitude");
assert(updateStoreBody.includes("optionalLongitude(body.longitude)"), "updateStore should normalize longitude");
assert(updateStoreBody.includes('["latitude", "latitude"]'), "updateStore should allow latitude");
assert(updateStoreBody.includes('["longitude", "longitude"]'), "updateStore should allow longitude");

if (service.includes("function catalogReviewPatch")) {
  const catalogReviewPatchBody = functionBody(service, "catalogReviewPatch");
  assert(
    catalogReviewPatchBody.includes("optionalLatitude(body.latitude)") &&
      catalogReviewPatchBody.includes("optionalLongitude(body.longitude)"),
    "catalog review store edits should support coordinates"
  );
}

const getSessionBody = exportedFunctionBody(service, "getSession");
for (const token of ["store_address", "store_latitude", "store_longitude"]) {
  assert(getSessionBody.includes(token), `getSession should return ${token}`);
}

const storeDrawer = read("apps/admin-web/src/components/StoreDrawer.vue");
for (const token of [
  "位置设置",
  "纬度（GCJ-02）",
  "经度（GCJ-02）",
  "VITE_TENCENT_MAP_KEY",
  "map.qq.com/api/gljs",
  "TMap.Map",
  "TMap.MultiMarker",
  "handleMapClick",
  "地点搜索",
  "searchPoiByKeyword",
  "applyPoiResult",
  "poiSearchResults",
  "store.latitude",
  "store.longitude"
]) {
  assert(storeDrawer.includes(token), `StoreDrawer should include ${token}`);
}
assert(
  storeDrawer.includes("latitude: model.latitude") &&
    storeDrawer.includes("longitude: model.longitude"),
  "StoreDrawer save payload should include latitude and longitude"
);

const adminDockerfile = read("apps/admin-web/Dockerfile");
assert(
  adminDockerfile.includes("ARG VITE_TENCENT_MAP_KEY") &&
    adminDockerfile.includes("ENV VITE_TENCENT_MAP_KEY=${VITE_TENCENT_MAP_KEY}"),
  "admin-web Docker build should accept VITE_TENCENT_MAP_KEY for production maps"
);

const dockerWorkflow = read(".github/workflows/docker-publish.yml");
assert(
  dockerWorkflow.includes("VITE_TENCENT_MAP_KEY=${{ secrets.VITE_TENCENT_MAP_KEY }}"),
  "docker workflow should pass VITE_TENCENT_MAP_KEY secret into admin-web build"
);

console.log("D34 store location checks passed");
