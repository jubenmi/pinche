import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

function filePath(relativePath) {
  return path.join(root, relativePath);
}

function exists(relativePath) {
  return fs.existsSync(filePath(relativePath));
}

function read(relativePath) {
  return exists(relativePath) ? fs.readFileSync(filePath(relativePath), "utf8") : "";
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function functionBody(source, name) {
  const pattern = new RegExp(`(?:export\\s+)?(?:async\\s+)?function\\s+${name}\\s*\\([^)]*\\)\\s*\\{`);
  const match = source.match(pattern);
  if (!match || match.index === undefined) {
    return "";
  }
  const start = match.index + match[0].length;
  let depth = 1;
  for (let index = start; index < source.length; index += 1) {
    if (source[index] === "{") {
      depth += 1;
    } else if (source[index] === "}") {
      depth -= 1;
    }
    if (depth === 0) {
      return source.slice(start, index);
    }
  }
  return "";
}

function sourceSliceAfter(source, marker, length = 900) {
  const index = source.indexOf(marker);
  return index === -1 ? "" : source.slice(index, index + length);
}

const migrationPath = "apps/api/migrations/0021_private_catalog_review.sql";
assert(exists(migrationPath), "D33 migration file must exist");

const migration = read(migrationPath);
const rootPackage = read("package.json");
const miniCreate = read("apps/miniprogram/src/pages/session/create.vue");
const miniScript = read("apps/miniprogram/src/pages/session/script.vue");
const miniMine = read("apps/miniprogram/src/pages/mine/index.vue");
const miniAdminCatalog = read("apps/miniprogram/src/pages/admin/catalog.vue");
const adminWebApi = read("apps/admin-web/src/api.js");
const adminRoute = read("apps/admin-web/src/adminRoute.js");
const adminCatalogWorkspace = read("apps/admin-web/src/components/CatalogWorkspace.vue");
const adminStoreDrawer = read("apps/admin-web/src/components/StoreDrawer.vue");
const adminScriptDrawer = read("apps/admin-web/src/components/ScriptDrawer.vue");
for (const tableName of ["stores", "scripts"]) {
  for (const token of [
    `ALTER TABLE ${tableName}`,
    "visibility VARCHAR(32) NOT NULL DEFAULT ''public''",
    "review_status VARCHAR(32) NOT NULL DEFAULT ''approved''",
    "created_by_user_id BIGINT UNSIGNED NULL",
    "reviewed_by_admin_user_id BIGINT UNSIGNED NULL",
    "review_note TEXT NULL",
    "reviewed_at DATETIME NULL",
    "merged_into_id BIGINT UNSIGNED NULL"
  ]) {
    assert(migration.includes(token), `D33 migration must add ${token} to ${tableName}`);
  }

  const indexPrefix = tableName === "stores" ? "idx_stores" : "idx_scripts";
  for (const token of [
    `${indexPrefix}_visibility_review`,
    "(visibility, review_status, status)",
    `${indexPrefix}_created_by_review`,
    "(created_by_user_id, review_status)"
  ]) {
    assert(migration.includes(token), `D33 migration must include ${token} for ${tableName}`);
  }
}

const service = read("apps/api/src/modules/core/service.js");
for (const token of [
  "function normalizeCatalogVisibility",
  "function normalizeCatalogReviewStatus",
  "function isPublicCatalogUsable",
  "function isPrivateCatalogUsableByUser",
  "function assertCatalogUsableForSession",
  "function catalogBadge",
  "createPrivateStore",
  "createPrivateScript",
  "listMyCatalogReviewItems",
  "updateMyCatalogReviewItem",
  "listAdminCatalogReviewItems",
  "updateAdminCatalogReviewItem",
  "approveCatalogReviewItem",
  "markCatalogReviewItemNeedsChanges",
  "rejectCatalogReviewItem",
  "mergeCatalogReviewItem",
  "visibility",
  "review_status",
  "created_by_user_id"
]) {
  assert(service.includes(token), `service.js must include D33 token: ${token}`);
}

const normalizeCatalogVisibilityBody = functionBody(service, "normalizeCatalogVisibility");
assert(
  normalizeCatalogVisibilityBody.includes("public") &&
    normalizeCatalogVisibilityBody.includes("private") &&
    normalizeCatalogVisibilityBody.includes("badRequest"),
  "normalizeCatalogVisibility must accept public/private and reject invalid values"
);

const normalizeCatalogReviewStatusBody = functionBody(service, "normalizeCatalogReviewStatus");
for (const token of ["pending", "needs_changes", "approved", "rejected", "merged", "badRequest"]) {
  assert(
    normalizeCatalogReviewStatusBody.includes(token),
    `normalizeCatalogReviewStatus must include ${token}`
  );
}

const listActiveStoresBody = functionBody(service, "listActiveStores");
assert(
  listActiveStoresBody.includes("created_by_user_id") &&
    listActiveStoresBody.includes("isPublicCatalogUsable") &&
    listActiveStoresBody.includes("catalogResponse"),
  "listActiveStores must mix public usable stores with current user's private stores"
);

const listActiveScriptsBody = functionBody(service, "listActiveScripts");
assert(
  listActiveScriptsBody.includes("created_by_user_id") &&
    listActiveScriptsBody.includes("storeId") &&
    listActiveScriptsBody.includes("isPublicCatalogUsable") &&
    listActiveScriptsBody.includes("catalogResponse"),
  "listActiveScripts must mix public usable scripts with current user's private scripts"
);

const createSessionBody = functionBody(service, "createSession");
const createSessionWithConnectionBody = functionBody(service, "createSessionWithConnection");
assert(
  createSessionBody.includes("withTransaction") &&
    createSessionBody.includes("createSessionWithConnection") &&
    createSessionWithConnectionBody.includes("assertCatalogUsableForSession(store") &&
    createSessionWithConnectionBody.includes("assertCatalogUsableForSession(script"),
  "createSession must delegate catalog validation to its transaction-bound creation helper"
);

const createPrivateStoreBody = functionBody(service, "createPrivateStore");
const createPrivateStoreWithConnectionBody = functionBody(service, "createPrivateStoreWithConnection");
assert(
  createPrivateStoreBody.includes("withDatabaseConnection") &&
    createPrivateStoreBody.includes("createPrivateStoreWithConnection") &&
    createPrivateStoreWithConnectionBody.includes("visibility") &&
    createPrivateStoreWithConnectionBody.includes("private") &&
    createPrivateStoreWithConnectionBody.includes("review_status") &&
    createPrivateStoreWithConnectionBody.includes("pending") &&
    createPrivateStoreWithConnectionBody.includes("created_by_user_id") &&
    createPrivateStoreWithConnectionBody.includes("assertPublicTextSafe"),
  "createPrivateStore must delegate private pending store creation to its connection-bound helper"
);

const createPrivateScriptBody = functionBody(service, "createPrivateScript");
const createPrivateScriptWithConnectionBody = functionBody(service, "createPrivateScriptWithConnection");
assert(
  createPrivateScriptBody.includes("withTransaction") &&
    createPrivateScriptBody.includes("createPrivateScriptWithConnection") &&
    createPrivateScriptWithConnectionBody.includes("visibility") &&
    createPrivateScriptWithConnectionBody.includes("private") &&
    createPrivateScriptWithConnectionBody.includes("review_status") &&
    createPrivateScriptWithConnectionBody.includes("pending") &&
    createPrivateScriptWithConnectionBody.includes("created_by_user_id") &&
    createPrivateScriptWithConnectionBody.includes("privateRoleTemplateJson") &&
    createPrivateScriptWithConnectionBody.includes("assertPublicTextSafe"),
  "createPrivateScript must delegate private pending script creation to its connection-bound helper"
);

const listMyCatalogReviewItemsBody = functionBody(service, "listMyCatalogReviewItems");
assert(
  listMyCatalogReviewItemsBody.includes("created_by_user_id") &&
    listMyCatalogReviewItemsBody.includes("visibility = 'private'") &&
    listMyCatalogReviewItemsBody.includes("catalogReviewRows"),
  "listMyCatalogReviewItems must return current user's submitted catalog review items"
);

const updateMyCatalogReviewItemBody = functionBody(service, "updateMyCatalogReviewItem");
assert(
  updateMyCatalogReviewItemBody.includes("needs_changes") &&
    updateMyCatalogReviewItemBody.includes("review_status = 'pending'") &&
    updateMyCatalogReviewItemBody.includes("created_by_user_id") &&
    updateMyCatalogReviewItemBody.includes("catalogReviewPatch"),
  "updateMyCatalogReviewItem must only resubmit owned needs_changes private items"
);

const listAdminCatalogReviewItemsBody = functionBody(service, "listAdminCatalogReviewItems");
assert(
  listAdminCatalogReviewItemsBody.includes("catalogReviewRows") &&
    listAdminCatalogReviewItemsBody.includes("pending") &&
    listAdminCatalogReviewItemsBody.includes("needs_changes"),
  "listAdminCatalogReviewItems must expose admin review rows with submitter and usage count"
);

const approveCatalogReviewItemBody = functionBody(service, "approveCatalogReviewItem");
assert(
  approveCatalogReviewItemBody.includes("lockCatalogReviewItem") &&
    approveCatalogReviewItemBody.includes("visibility = 'public'") &&
    approveCatalogReviewItemBody.includes("review_status = 'approved'") &&
    approveCatalogReviewItemBody.includes("reviewed_by_admin_user_id") &&
    approveCatalogReviewItemBody.includes("linkApprovedScriptToStores"),
  "approveCatalogReviewItem must approve private items and support script store links"
);

const markCatalogReviewItemNeedsChangesBody = functionBody(
  service,
  "markCatalogReviewItemNeedsChanges"
);
assert(
  markCatalogReviewItemNeedsChangesBody.includes("needs_changes") &&
    markCatalogReviewItemNeedsChangesBody.includes("review_note"),
  "markCatalogReviewItemNeedsChanges must save review note and keep item private"
);

const rejectCatalogReviewItemBody = functionBody(service, "rejectCatalogReviewItem");
assert(
  rejectCatalogReviewItemBody.includes("rejected") &&
    rejectCatalogReviewItemBody.includes("inactive") &&
    rejectCatalogReviewItemBody.includes("review_note"),
  "rejectCatalogReviewItem must reject and deactivate the private item"
);

const mergeCatalogReviewItemBody = functionBody(service, "mergeCatalogReviewItem");
assert(
  mergeCatalogReviewItemBody.includes("merged_into_id") &&
    mergeCatalogReviewItemBody.includes("review_status = 'merged'") &&
    mergeCatalogReviewItemBody.includes("isPublicCatalogUsable"),
  "mergeCatalogReviewItem must merge private items into public approved targets"
);

const server = read("apps/api/src/server.js");
for (const token of [
  "createPrivateStore",
  "createPrivateScript",
  "listMyCatalogReviewItems",
  "updateMyCatalogReviewItem",
  "listAdminCatalogReviewItems",
  "updateAdminCatalogReviewItem",
  "approveCatalogReviewItem",
  "markCatalogReviewItemNeedsChanges",
  "rejectCatalogReviewItem",
  "mergeCatalogReviewItem",
  "optionalAuthUser"
]) {
  assert(server.includes(token), `server.js must include ${token}`);
}

const publicStoresRoute = sourceSliceAfter(
  server,
  'if (request.method === "GET" && url.pathname === "/api/stores")'
);
assert(
  publicStoresRoute.includes("optionalAuthUser(request)") &&
    /listActiveStores\(\s*Object\.fromEntries\(url\.searchParams\),\s*user(?:,\s*\{[\s\S]*?\})?\s*\)/.test(publicStoresRoute),
  "GET /api/stores must pass optional auth user into listActiveStores"
);

const publicScriptsRoute = sourceSliceAfter(
  server,
  'if (request.method === "GET" && url.pathname === "/api/scripts")'
);
assert(
  publicScriptsRoute.includes("optionalAuthUser(request)") &&
    /listActiveScripts\(\s*Object\.fromEntries\(url\.searchParams\),\s*user(?:,\s*\{[\s\S]*?\})?\s*\)/.test(publicScriptsRoute),
  "GET /api/scripts must pass optional auth user into listActiveScripts"
);

const createPrivateStoreRoute = sourceSliceAfter(
  server,
  'if (request.method === "POST" && url.pathname === "/api/stores")'
);
assert(
  createPrivateStoreRoute.includes("const user = await getAuthUser(request)") &&
    createPrivateStoreRoute.includes("createPrivateStore(user, body)"),
  "POST /api/stores must require auth and call createPrivateStore"
);

const createPrivateScriptRoute = sourceSliceAfter(
  server,
  'if (request.method === "POST" && url.pathname === "/api/scripts")'
);
assert(
  createPrivateScriptRoute.includes("const user = await getAuthUser(request)") &&
    createPrivateScriptRoute.includes("createPrivateScript(user, body)"),
  "POST /api/scripts must require auth and call createPrivateScript"
);

const myCatalogReviewRoute = sourceSliceAfter(
  server,
  'if (request.method === "GET" && url.pathname === "/api/catalog-review-items/mine")'
);
assert(
  myCatalogReviewRoute.includes("const user = await getAuthUser(request)") &&
    myCatalogReviewRoute.includes("listMyCatalogReviewItems(user"),
  "GET /api/catalog-review-items/mine must require auth and list current user's submissions"
);

const updateMyCatalogReviewRoute = sourceSliceAfter(
  server,
  "const myCatalogReviewItemMatch = url.pathname.match"
);
assert(
  updateMyCatalogReviewRoute.includes("catalog-review-items") &&
    updateMyCatalogReviewRoute.includes("updateMyCatalogReviewItem(") &&
    updateMyCatalogReviewRoute.includes("const user = await getAuthUser(request)"),
  "PATCH /api/catalog-review-items/:type/:id must require auth and update current user's item"
);

const adminCatalogReviewRoute = sourceSliceAfter(
  server,
  'if (request.method === "GET" && url.pathname === "/api/admin/catalog-review-items")'
);
assert(
  adminCatalogReviewRoute.includes("requireRole(user, \"system_admin\")") &&
    adminCatalogReviewRoute.includes("listAdminCatalogReviewItems"),
  "GET /api/admin/catalog-review-items must require system_admin and list review items"
);

for (const [routeName, serviceName] of [
  ["approve", "approveCatalogReviewItem"],
  ["needs-changes", "markCatalogReviewItemNeedsChanges"],
  ["reject", "rejectCatalogReviewItem"],
  ["merge", "mergeCatalogReviewItem"]
]) {
  const marker =
    routeName === "needs-changes"
      ? "const adminCatalogReviewNeedsChangesMatch"
      : `const adminCatalogReview${routeName[0].toUpperCase()}${routeName.slice(1)}Match`;
  const routeSlice = sourceSliceAfter(
    server,
    marker
  );
  assert(
    routeSlice.includes("catalog-review-items") &&
      routeSlice.includes("requireRole(user, \"system_admin\")") &&
      routeSlice.includes(serviceName),
    `admin ${routeName} route must require system_admin and call ${serviceName}`
  );
}

assert(
  miniCreate.includes("submitPrivateStore") &&
    miniCreate.includes('url: "/api/stores"') &&
    miniCreate.includes("没有找到？添加一个店家") &&
    miniCreate.includes("仅自己可用 · 待审核") &&
    miniCreate.includes("storeBadge"),
  "session/create page must let users add a private store and show its private review badge"
);

assert(
  miniScript.includes("submitPrivateScript") &&
    miniScript.includes('url: "/api/scripts"') &&
    miniScript.includes("没有找到？添加一个剧本") &&
    miniScript.includes("仅自己可用 · 待审核") &&
    miniScript.includes("scriptBadge"),
  "session/script page must let users add a private script and show its private review badge"
);

assert(
  miniMine.includes("我的资料提交") &&
    miniMine.includes("/api/catalog-review-items/mine") &&
    miniMine.includes("submitCatalogEdit") &&
    miniMine.includes("reviewStatusLabel") &&
    miniMine.includes("needs_changes"),
  "mine page must show my catalog submissions and allow needs_changes edits"
);

assert(
  miniAdminCatalog.includes("/api/admin/catalog-review-items") &&
    miniAdminCatalog.includes("/approve") &&
    miniAdminCatalog.includes("/needs-changes") &&
    miniAdminCatalog.includes("/reject") &&
    miniAdminCatalog.includes("/merge") &&
    miniAdminCatalog.includes("catalogAuditLabel(store)") &&
    miniAdminCatalog.includes("catalogAuditLabel(script)") &&
    miniAdminCatalog.includes("待审核资料"),
  "mini admin catalog page must review private catalog items and show unreviewed stores/scripts in normal management lists"
);

for (const token of [
  "listCatalogReviewItems",
  "updateCatalogReviewItem",
  "approveCatalogReviewItem",
  "requestCatalogReviewItemNeedsChanges",
  "rejectCatalogReviewItem",
  "mergeCatalogReviewItem"
]) {
  assert(adminWebApi.includes(`export function ${token}`), `admin web api must export ${token}`);
}

assert(adminRoute.includes('"review"'), "admin web catalog route must include review tab");

assert(
  adminCatalogWorkspace.includes("switchTab('review')") &&
    adminCatalogWorkspace.includes("reviewAction") &&
    adminCatalogWorkspace.includes("approveCatalogReviewItem") &&
    adminCatalogWorkspace.includes("requestCatalogReviewItemNeedsChanges") &&
    adminCatalogWorkspace.includes("rejectCatalogReviewItem") &&
    adminCatalogWorkspace.includes("mergeCatalogReviewItem") &&
    adminCatalogWorkspace.includes("saveCatalogReviewDraft") &&
    adminCatalogWorkspace.includes("catalogAuditLabel(item)") &&
    adminCatalogWorkspace.includes("审核"),
  "admin web catalog workspace must provide pending review tab, draft save, review actions, and audit labels in normal lists"
);

assert(
  adminStoreDrawer.includes("reviewMode") &&
    adminStoreDrawer.includes("footer-actions") &&
    adminScriptDrawer.includes("footer-actions"),
  "admin web drawers must support review-mode footer actions"
);

assert(
  rootPackage.includes("node scripts/d33-private-catalog-review-check.js"),
  "root npm run check must include D33 private catalog review check"
);
