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

const memberSessionDetailBody = functionBody(service, "memberSessionDetail");
const publicSessionPreviewBody = functionBody(service, "publicSessionPreview");
for (const token of ["store_address", "store_latitude", "store_longitude"]) {
  assert(memberSessionDetailBody.includes(token), `member session detail should return ${token}`);
  assert(publicSessionPreviewBody.includes(token), `public session preview should return ${token}`);
}

const storeDrawer = read("apps/admin-web/src/components/StoreDrawer.vue");
for (const token of [
  "位置设置",
  "纬度（GCJ-02）",
  "经度（GCJ-02）",
  "getTencentMapKey",
  "map.qq.com/api/gljs",
  "TMap.Map",
  "TMap.MultiMarker",
  "handleMapClick",
  "地点搜索",
  "searchPoiByKeyword",
  "applyPoiResult",
  "poiSearchResults",
  "error?.status === 110",
  "error?.status === 121",
  "授权当前 admin 域名",
  "今日调用量已达到上限",
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

const miniprogramCreate = read("apps/miniprogram/src/pages/session/create.vue");
for (const token of [
  "latitude: \"\"",
  "longitude: \"\"",
  "地图选点",
  "pickStoreLocation",
  "uni.chooseLocation",
  "storeForm.latitude",
  "storeForm.longitude",
  "latitude: this.storeForm.latitude",
  "longitude: this.storeForm.longitude",
  "writeCreateFlow({ store, script: null, role: null })"
]) {
  assert(miniprogramCreate.includes(token), `Mini-program create page should include ${token}`);
}
assert(
  !miniprogramCreate.includes("uni.getLocation") && !miniprogramCreate.includes("wx.getLocation"),
  "Mini-program create page should not read current user location"
);

const miniprogramDetail = read("apps/miniprogram/src/pages/session/detail.vue");
for (const token of [
  "session.store_address",
  "session.store_address || hasStoreLocation",
  "查看地图",
  "hasStoreLocation",
  "openStoreMap",
  "uni.openLocation",
  "store_latitude",
  "store_longitude",
  "scale: 18",
  "地图打开失败，请稍后再试"
]) {
  assert(miniprogramDetail.includes(token), `Mini-program detail page should include ${token}`);
}

const manifest = JSON.parse(read("apps/miniprogram/src/manifest.json"));
const mpWeixin = manifest["mp-weixin"] || {};
assert(
  mpWeixin.permission?.["scope.userLocation"]?.desc?.includes("剧本店位置"),
  "Mini-program manifest should declare why chooseLocation needs location access"
);
assert(
  Array.isArray(mpWeixin.requiredPrivateInfos) &&
    mpWeixin.requiredPrivateInfos.includes("chooseLocation"),
  "Mini-program manifest should declare chooseLocation as a required private API"
);
assert(
  !mpWeixin.requiredPrivateInfos?.includes("getLocation"),
  "Mini-program manifest should not declare getLocation"
);

const smoke = read("scripts/d34-store-location-smoke.js");
for (const token of [
  "private store should save legal GCJ-02 coordinates",
  "admin store creation should save coordinates",
  "admin store update should save coordinates",
  "expectedStatus = 200",
  "91",
  "181",
  "session detail should return store address",
  "session detail should return store coordinates",
  "store without coordinates should remain searchable",
  "store without coordinates should still be usable for session creation"
]) {
  assert(smoke.includes(token), `D34 smoke should cover ${token}`);
}

const packageJson = JSON.parse(read("package.json"));
assert(
  packageJson.scripts.check.includes("node scripts/d34-store-location-check.js"),
  "npm run check should run D34 static check"
);
assert(
  packageJson.scripts.check.includes("node --check scripts/d34-store-location-smoke.js"),
  "npm run check should syntax-check D34 smoke"
);
assert(
  packageJson.scripts["d34:smoke"] === "node scripts/d34-store-location-smoke.js",
  "package scripts should expose d34:smoke"
);

console.log("D34 store location checks passed");
