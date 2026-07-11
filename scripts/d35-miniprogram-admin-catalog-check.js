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

function assertIncludes(source, token, message) {
  assert(source.includes(token), message || `Expected source to include ${token}`);
}

function assertExcludes(source, token, message) {
  assert(!source.includes(token), message || `Expected source not to include ${token}`);
}

const catalog = read("apps/miniprogram/src/pages/admin/catalog.vue");
const miniApi = read("apps/miniprogram/src/utils/api.js");
const checkMiniprogram = read("scripts/check-miniprogram.js");
const adminCatalogFlowCheck = read("scripts/d35-admin-catalog-flow-check.js");
const packageJson = JSON.parse(read("package.json"));
const tdesignTouchMixin = read("apps/miniprogram/src/wxcomponents/tdesign-miniprogram/mixins/touch.js");
const tdesignPageScrollMixin = read(
  "apps/miniprogram/src/wxcomponents/tdesign-miniprogram/mixins/page-scroll.js"
);

for (const token of [
  "管理工作台",
  "catalogStats",
  "lastOperationMessage",
  "店家",
  "剧本",
  "待审核"
]) {
  assertIncludes(catalog, token, `D35 workbench should include ${token}`);
}

for (const token of [
  "扫码登录 Web 后台",
  "scanAdminWebLogin",
  "parseAdminWebLoginQr",
  "confirmAdminWebLogin",
  "pinche-admin-login://ticket/",
  "/api/admin/web-login/tickets/"
]) {
  assertIncludes(catalog, token, `D35 global admin tools should preserve web login token: ${token}`);
}

const templateBeforeTabs = catalog.slice(0, catalog.indexOf("<t-tabs"));
assertIncludes(
  templateBeforeTabs,
  "scanAdminWebLogin",
  "D35 scan web admin login should be in the global tool area before catalog tabs"
);

for (const token of [
  "latitude",
  "longitude",
  "纬度（GCJ-02）",
  "经度（GCJ-02）",
  "地图选点",
  "手填 GCJ-02",
  "pickStoreLocation",
  "openStoreLocation",
  "uni.chooseLocation",
  "uni.openLocation",
  "loadStoreScripts",
  "/api/admin/stores/",
  "/scripts",
  "pricePerPerson"
]) {
  assertIncludes(catalog, token, `D35 store editor should include ${token}`);
}

for (const forbidden of [
  "qqmap-wx-jssdk",
  "/ws/place/v1/search",
  "/ws/geocoder/v1",
  "uni.getLocation",
  "wx.getLocation"
]) {
  assertExcludes(catalog, forbidden, `D35 mini-program admin catalog must not include ${forbidden}`);
}

const pickStoreLocationBody = functionBody(catalog, "pickStoreLocation");
assertIncludes(
  pickStoreLocationBody,
  "typeof uni.chooseLocation !== \"function\"",
  "pickStoreLocation should gracefully handle unavailable chooseLocation"
);
assertIncludes(
  pickStoreLocationBody,
  "latitude:",
  "pickStoreLocation should write latitude"
);
assertIncludes(
  pickStoreLocationBody,
  "longitude:",
  "pickStoreLocation should write longitude"
);

const saveStoreBody = functionBody(catalog, "saveStore");
assertIncludes(saveStoreBody, "currentStorePayload()", "saveStore should submit normalized store payload");
assertIncludes(saveStoreBody, "saveStoreScripts", "saveStore should save linked scripts");
const currentStorePayloadBody = functionBody(catalog, "currentStorePayload");
assertIncludes(currentStorePayloadBody, "latitude", "store payload should include latitude");
assertIncludes(currentStorePayloadBody, "longitude", "store payload should include longitude");

for (const token of [
  "scriptRoleRows",
  "scriptNpcRows",
  "addScriptRole",
  "removeScriptRole",
  "moveScriptRole",
  "fillDefaultRoles",
  "addNpcRole",
  "removeNpcRole",
  "roleGender",
  "NPC 角色",
  "角色数量与玩家人数不一致"
]) {
  assertIncludes(catalog, token, `D35 script editor should include ${token}`);
}

const saveScriptBody = functionBody(catalog, "saveScript");
assertIncludes(saveScriptBody, "buildSeatTemplateFromRoles", "saveScript should build role template");
assertIncludes(saveScriptBody, "buildNpcRolesPayload", "saveScript should submit NPC roles");
assertIncludes(saveScriptBody, "npcRoles", "saveScript should submit npcRoles");

for (const token of [
  "reviewTypeFilter",
  "editReviewItem",
  "saveReviewDraft",
  "reviewStoreLinks",
  "approveReviewItem",
  "needsChangesReviewItem",
  "rejectReviewItem",
  "mergeReviewItem",
  "storeScriptLinks"
]) {
  assertIncludes(catalog, token, `D35 review editor should include ${token}`);
}

for (const token of [
  "selectionMode",
  "selectedStoreIds",
  "selectedScriptIds",
  "toggleSelectionMode",
  "runBulkStatus",
  "runBulkDelete",
  "批量上架",
  "批量下架",
  "批量删除"
]) {
  assertIncludes(catalog, token, `D35 bulk operations should include ${token}`);
}

for (const token of [
  "dirty",
  "confirmDiscardChanges",
  "loading",
  "retryActiveTab",
  "showMessage",
  "onShow",
  "syncAdminState"
]) {
  assertIncludes(catalog, token, `D35 mobile state handling should include ${token}`);
}

const syncAdminStateBody = functionBody(catalog, "syncAdminState");
assertIncludes(syncAdminStateBody, "getCurrentUser().roles", "admin catalog should refresh roles when shown");
assertIncludes(syncAdminStateBody, "refreshAll()", "admin catalog should load all domains after admin auth is restored");

const resolveWechatLoginCodeBody = functionBody(miniApi, "resolveWechatLoginCode");
assertIncludes(
  resolveWechatLoginCodeBody,
  "options.devCode && isLocalApiBaseUrl()",
  "local API login should prefer the supplied devCode so admin smoke tests can use deterministic mock openids"
);
assertExcludes(
  resolveWechatLoginCodeBody,
  "import.meta.env.DEV && options.devCode",
  "local API devCode selection should not depend on the Vite dev/build mode"
);

const localApiBaseUrlBody = functionBody(miniApi, "isLocalApiBaseUrl");
assertIncludes(
  localApiBaseUrlBody,
  "String(value || \"\").trim()",
  "local API base detection should work in Mini Program runtimes without the URL Web API"
);
assertIncludes(
  localApiBaseUrlBody,
  "match(/^https?:\\/\\/([^/:?#]+)/i)",
  "local API base detection should extract the hostname without relying only on new URL()"
);

assertIncludes(
  tdesignTouchMixin,
  "touchStart",
  "D35 admin tabs should include the TDesign touch mixin required by t-tabs"
);
assertIncludes(
  tdesignPageScrollMixin,
  "onPageScroll",
  "D35 admin sticky controls should include the TDesign page-scroll mixin required by t-sticky"
);

assertIncludes(
  checkMiniprogram,
  "d35-miniprogram-admin-catalog-check.js",
  "check-miniprogram should reference the D35 static check"
);
assert(
  packageJson.scripts.check.includes("node scripts/d35-miniprogram-admin-catalog-check.js"),
  "npm run check should run D35 static check"
);

for (const token of [
  "assertLocalBaseUrl",
  "http://127.0.0.1:3029",
  "/api/admin/stores",
  "/api/admin/scripts",
  "/api/stores",
  "/api/scripts",
  "/api/admin/catalog-review-items/",
  "needs-changes",
  "merge",
  "storeScriptLinks",
  "D35 admin catalog flow check passed"
]) {
  assertIncludes(adminCatalogFlowCheck, token, `D35 flow check should include ${token}`);
}

console.log("D35 mini-program admin catalog checks passed");
