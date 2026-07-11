import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

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

const requiredFiles = [
  "apps/admin-web/package.json",
  "apps/admin-web/index.html",
  "apps/admin-web/vite.config.js",
  "apps/admin-web/src/App.vue",
  "apps/admin-web/src/api.js",
  "apps/admin-web/src/components/LoginPanel.vue",
  "apps/admin-web/src/components/CatalogWorkspace.vue",
  "apps/admin-web/src/components/StoreDrawer.vue",
  "apps/admin-web/src/components/ScriptDrawer.vue",
  "apps/admin-web/src/components/MiniProgramWorkspace.vue",
  "apps/admin-web/Dockerfile",
  "apps/admin-web/nginx.conf",
  "apps/api/docker-entrypoint.sh",
  "apps/api/migrations/0007_admin_web_login.sql",
  "apps/api/migrations/0008_store_script_links.sql",
  "apps/api/migrations/0011_store_script_price.sql",
  "apps/api/src/modules/auth/admin-web-login.js"
];

for (const file of requiredFiles) {
  assert(exists(file), `${file} should exist`);
}

const rootPackage = JSON.parse(read("package.json"));
assert(rootPackage.workspaces.includes("apps/admin-web"), "admin-web workspace should be registered");
assert(rootPackage.scripts["dev:admin-web"], "dev:admin-web script should exist");
assert(rootPackage.scripts["build:admin-web"], "build:admin-web script should exist");
assert(
  rootPackage.scripts.check.includes("scripts/d12-admin-web-check.js"),
  "root check should run d12 check"
);

const server = read("apps/api/src/server.js");
assert(server.includes("/api/admin/web-login/tickets"), "server should expose admin web login routes");
assert(server.includes("deleteStore"), "server should retain store hard delete route");
assert(server.includes("deleteScript"), "server should retain script hard delete route");
assert(
  server.includes("deleteUploadedSessionAlbumPhotoObject") &&
    server.includes("deleteCosObject"),
  "server should delete uploaded album media objects when album photos are deleted"
);
assert(
  server.includes("listAdminSessions") &&
    server.includes("/api/admin/sessions"),
  "server should expose admin session list route"
);
assert(
  !server.includes("restoreAdminSession") && !/api\/admin\/sessions\/.*restore/.test(server),
  "server should not expose admin session restore routes"
);
assert(
  server.includes("deleteAdminSession") &&
    server.includes("adminSessionId") &&
    server.includes('request.method === "DELETE" && adminSessionId') &&
    server.includes("deleteAdminSession(adminSessionId)"),
  "server should expose admin session force delete route"
);
assert(
  server.includes("adminStoreScriptsId") &&
    server.includes("listStoreScripts") &&
    server.includes("replaceStoreScripts"),
  "server should route store-script association endpoints"
);

const service = read("apps/api/src/modules/core/service.js");
const cancelSessionSource = service.slice(
  service.indexOf("export async function cancelSession"),
  service.indexOf("async function deleteAndCount")
);
assert(service.includes("export async function deleteStore"), "service should retain deleteStore");
assert(service.includes("export async function deleteScript"), "service should retain deleteScript");
assert(
  service.includes("export async function listStoreScripts"),
  "service should export listStoreScripts"
);
assert(
  service.includes("export async function replaceStoreScripts"),
  "service should export replaceStoreScripts"
);
assert(service.includes("store_scripts"), "service should use store_scripts");
assert(service.includes("filters.storeId"), "active script list should support storeId filtering");
assert(service.includes("RESOURCE_IN_USE"), "hard delete should report RESOURCE_IN_USE");
assert(
  service.includes("CATALOG_ENTITY_ACTIVE") && service.includes('status !== "inactive"'),
  "hard delete should require inactive catalog entities"
);
assert(service.includes("DELETE FROM stores"), "store delete should be physical");
assert(service.includes("DELETE FROM scripts"), "script delete should be physical");
assert(
  service.includes("DELETE FROM script_npc_roles WHERE script_id = ?"),
  "script delete should clear script NPC role templates before deleting the script row"
);
assert(
  service.includes("export async function listAdminSessions"),
  "service should export admin global session list"
);
assert(
  service.includes("export async function deleteAdminSession") &&
    service.includes("deleteSessionTree(connection, id)"),
  "service should export admin force session deletion through the session tree cleanup"
);
assert(
  service.includes("export async function cancelSession"),
  "service should retain the user session cancel entrypoint"
);
assert(
  service.includes("DELETE FROM session_messages") &&
    service.includes("DELETE FROM session_chat_rooms") &&
    service.includes("DELETE FROM session_album_photo_tags") &&
    service.includes("DELETE FROM session_album_photos") &&
    service.includes("DELETE FROM session_album_privacy") &&
    service.includes("DELETE FROM session_review_photos") &&
    service.includes("DELETE FROM session_reviews") &&
    service.includes("DELETE FROM session_npc_roles") &&
    service.includes("DELETE FROM share_events") &&
    service.includes("DELETE FROM signups") &&
    service.includes("DELETE FROM session_seats") &&
    service.includes("DELETE FROM sessions"),
  "user session cancel should physically delete the session and dependent records"
);
assert(
  service.includes("sessionOrganizerCandidates(connection, session, user.user.id)") &&
    service.includes("SESSION_HAS_ONBOARD_MEMBERS") &&
    service.includes("已有玩家上车"),
  "user session cancel should refuse deletion when other onboard members can inherit the session"
);
assert(
  service.includes("activeSessionAlbumPhotoCount") &&
    service.includes("SESSION_HAS_ALBUM_PHOTOS") &&
    service.includes("相册已有照片"),
  "user session cancel should refuse deletion while active album photos still belong to the session"
);
assert(
  service.includes("export async function deleteSessionAlbumPhoto") &&
    service.includes("DELETE FROM session_album_photo_tags WHERE photo_id = ?") &&
    service.includes("DELETE FROM session_album_photos WHERE id = ?") &&
    !service.includes("UPDATE session_album_photos SET status = 'deleted'"),
  "album photo deletion should clear the photo record instead of soft-hiding it"
);
assert(
  service.includes('candidate.source === "seat"'),
  "user session cancel should only treat confirmed or locked seats as onboard members"
);
assert(
  !service.includes("export async function restoreAdminSession") &&
    !service.includes("SESSION_NOT_DOWNLISTED") &&
    !service.includes("请先下架车局再删除"),
  "service should not model sessions as downlisted/restorable"
);
assert(
  !/UPDATE sessions[\s\S]{0,120}SET status = 'cancelled'/.test(cancelSessionSource) &&
    !/UPDATE sessions[\s\S]{0,120}SET organizer_hidden_at/.test(cancelSessionSource),
  "cancel session should delete the session instead of marking cancelled or downlisted"
);

const loginModule = read("apps/api/src/modules/auth/admin-web-login.js");
assert(loginModule.includes("createAdminWebLoginTicket"), "login module should create tickets");
assert(loginModule.includes("pollAdminWebLoginTicket"), "login module should poll tickets");
assert(loginModule.includes("approveAdminWebLoginTicket"), "login module should approve tickets");
assert(loginModule.includes("secret_hash"), "login tickets should store secret hash");

const migration = read("apps/api/migrations/0007_admin_web_login.sql");
assert(migration.includes("admin_web_login_tickets"), "migration should create login ticket table");
assert(migration.includes("secret_hash"), "migration should store only secret hash");

const linkMigration = read("apps/api/migrations/0008_store_script_links.sql");
assert(linkMigration.includes("store_scripts"), "migration should create store_scripts table");
assert(linkMigration.includes("UNIQUE KEY uniq_store_script"), "store_scripts should be unique by pair");
assert(linkMigration.includes("FOREIGN KEY (store_id)"), "store_scripts should reference stores");
assert(linkMigration.includes("FOREIGN KEY (script_id)"), "store_scripts should reference scripts");

const storeScriptPriceMigration = read("apps/api/migrations/0011_store_script_price.sql");
assert(
  storeScriptPriceMigration.includes("price_per_player"),
  "store-script migration should add a per-store script price"
);
assert(
  storeScriptPriceMigration.includes("default_seat_template_json") &&
    storeScriptPriceMigration.includes("GROUP_CONCAT") &&
    storeScriptPriceMigration.includes("description"),
  "store-script migration should clean legacy role template fields into role descriptions"
);

const mysql = read("apps/api/src/db/mysql.js");
assert(mysql.includes("store_scripts"), "database readiness should require store_scripts");

const miniProgramAdmin = read("apps/miniprogram/src/pages/admin/catalog.vue");
assert(miniProgramAdmin.includes("scanAdminWebLogin"), "mini-program admin page should scan Web login QR");
assert(
  miniProgramAdmin.includes("pinche-admin-login://ticket/"),
  "scan handler should validate admin login scheme"
);
assert(
  miniProgramAdmin.includes("/api/admin/web-login/tickets/"),
  "scan handler should approve tickets through API"
);

const miniProgramScript = read("apps/miniprogram/src/pages/session/script.vue");
assert(miniProgramScript.includes("storeId:"), "mini-program script page should pass storeId");
assert(
  miniProgramScript.includes("this.store?.id"),
  "mini-program script page should use selected store id"
);

const webApi = read("apps/admin-web/src/api.js");
assert(webApi.includes("createLoginTicket"), "web API should create login tickets");
assert(webApi.includes("pollLoginTicket"), "web API should poll login tickets");
assert(webApi.includes("export function assetUrl"), "web API should expose assetUrl helper");
for (const token of [
  "pinSessionChatMessage",
  "getSessionChat",
  "sendSessionMessage",
  "trackShareView"
]) {
  assert(webApi.includes(`export function ${token}`), `web API should export ${token}`);
}
assert(webApi.includes("export function deleteStore"), "web API should expose store hard delete");
assert(webApi.includes("export function deleteScript"), "web API should expose script hard delete");
assert(webApi.includes("listStoreScripts"), "web API should list store-script links");
assert(webApi.includes("saveStoreScripts"), "web API should save store-script links");
assert(webApi.includes("export function listAdminSessions"), "web API should list admin sessions");
assert(webApi.includes("export function deleteAdminSession"), "web API should force delete sessions as admin");
for (const token of [
  "listCatalogReviewItems",
  "updateCatalogReviewItem",
  "approveCatalogReviewItem",
  "requestCatalogReviewItemNeedsChanges",
  "rejectCatalogReviewItem",
  "mergeCatalogReviewItem"
]) {
  assert(webApi.includes(`export function ${token}`), `web API should export D33 review helper ${token}`);
}
assert(!webApi.includes("restoreAdminSession"), "web API should not restore sessions as admin");
assert(!webApi.includes("downlistSession"), "web API should not expose session downlisting");

const adminViteConfigSource = read("apps/admin-web/vite.config.js");
const adminNginxConfig = read("apps/admin-web/nginx.conf");
assert(
  adminViteConfigSource.includes("__PINCHE_BUILD_TIME__"),
  "admin web Vite config must inject the build-time version constant"
);
assert(
  adminViteConfigSource.includes("Asia/Shanghai"),
  "admin web build time must be formatted in Beijing time"
);
assert(
  adminViteConfigSource.includes('"/uploads"'),
  "admin web dev server should proxy uploaded media paths"
);
assert(
  adminNginxConfig.includes("location /uploads/") &&
    adminNginxConfig.includes("proxy_pass http://api:3018/uploads/"),
  "admin web nginx should proxy uploaded media paths"
);
const adminViteConfig = await import(
  pathToFileURL(path.join(root, "apps/admin-web/vite.config.js")).href
);
assert(
  typeof adminViteConfig.formatBuildTime === "function",
  "admin web Vite config should export the build-time formatter for checks"
);
assert(
  adminViteConfig.formatBuildTime(new Date("2026-06-19T16:05:00.000Z")) ===
    "2026-06-20 00:05",
  "admin web build-time formatter should convert UTC build moments to Beijing time"
);

const adminRoute = await import(
  pathToFileURL(path.join(root, "apps/admin-web/src/adminRoute.js")).href
);
const {
  buildAdminRouteQuery,
  parseAdminRouteQuery,
  sessionBackedMiniScreens
} = adminRoute;
const catalogSessionsRoute = parseAdminRouteQuery("?view=catalog&catalogTab=sessions");
assert(catalogSessionsRoute.activeView === "catalog", "route parser should keep catalog view");
assert(catalogSessionsRoute.catalogTab === "sessions", "route parser should keep catalog tab");
const catalogReviewRoute = parseAdminRouteQuery("?view=catalog&catalogTab=review");
assert(catalogReviewRoute.catalogTab === "review", "route parser should keep review catalog tab");
assert(
  parseAdminRouteQuery("?view=miniapp&screen=album&sessionId=12").miniScreen === "album",
  "route parser should keep session-backed mini screen"
);
assert(
  parseAdminRouteQuery("?sessionId=12").miniScreen === "detail",
  "legacy session links should open mini detail"
);
assert(
  parseAdminRouteQuery("?view=miniapp&screen=album").miniScreen === "home",
  "session-backed mini screens without sessionId should fall back to home"
);
assert(
  buildAdminRouteQuery({ activeView: "catalog", catalogTab: "sessions" }) ===
    "?view=catalog&catalogTab=sessions",
  "route builder should serialize catalog tab"
);
assert(
  buildAdminRouteQuery({ activeView: "miniapp", miniScreen: "manage", sessionId: "12" }) ===
    "?view=miniapp&screen=manage&sessionId=12",
  "route builder should serialize session-backed mini screen"
);
assert(
  sessionBackedMiniScreens.has("album") && !sessionBackedMiniScreens.has("home"),
  "route helper should expose session-backed mini screen set"
);

const dockerWorkflow = read(".github/workflows/docker-publish.yml");
const apiDockerfile = read("apps/api/Dockerfile");
const apiEntrypoint = read("apps/api/docker-entrypoint.sh");
assert(
  apiDockerfile.includes("docker-entrypoint.sh") && apiDockerfile.includes("ENTRYPOINT"),
  "API Dockerfile should start through an entrypoint"
);
assert(
  apiEntrypoint.includes("npm run migrate") && apiEntrypoint.includes('exec "$@"'),
  "API entrypoint should run migrations before starting the API process"
);
assert(
  dockerWorkflow.includes("API_IMAGE_NAME: hkccr.ccs.tencentyun.com/murder/pinche"),
  "docker workflow should define API image name"
);
assert(
  dockerWorkflow.includes("ADMIN_WEB_IMAGE_NAME: hkccr.ccs.tencentyun.com/murder/pinche-admin-web"),
  "docker workflow should define admin web image name"
);
assert(
  dockerWorkflow.includes("file: apps/api/Dockerfile"),
  "docker workflow should build API Dockerfile"
);
assert(
  dockerWorkflow.includes("file: apps/admin-web/Dockerfile"),
  "docker workflow should build admin-web Dockerfile"
);
assert(
  (dockerWorkflow.match(/docker\/build-push-action@v6/g) || []).length >= 2,
  "docker workflow should run docker build-push action for both images"
);

const loginPanel = read("apps/admin-web/src/components/LoginPanel.vue");
assert(loginPanel.includes("QRCode"), "login panel should generate a QR code");
assert(loginPanel.includes("pollLoginTicket"), "login panel should poll ticket status");
assert(
  loginPanel.includes("buildVersion") && loginPanel.includes("app-build-version"),
  "login panel should show the build-time version on the public home page"
);

const appShell = read("apps/admin-web/src/App.vue");
for (const token of ["shell-toggle", "user-avatar", "sidebar-collapse"]) {
  assert(appShell.includes(token), `admin shell should include operator workspace ${token}`);
}
assert(appShell.includes("管理界面"), "admin shell should name the management area");
assert(appShell.includes("网页小程序"), "admin shell should name the web miniapp area");
assert(
  !appShell.includes("activeView === 'album'"),
  "album should not be a top-level admin shell area"
);
for (const token of [
  "displayName",
  "avatarUrl",
  "genderLabel",
  "profileDetailsOpen",
  "profile-detail-popover",
  "fullProfileRows"
]) {
  assert(appShell.includes(token), `admin shell should render profile detail ${token}`);
}
assert(
  appShell.includes("assetUrl") && appShell.includes("handleAvatarError"),
  "admin shell should resolve uploaded avatars and handle avatar load failures"
);
for (const token of ["MiniProgramWorkspace", "网页小程序", "activeView === 'miniapp'"]) {
  assert(appShell.includes(token), `admin shell should expose the admin mini app ${token}`);
}
for (const token of [
  "parseAdminRouteQuery",
  "writeAdminRoute",
  "switchActiveView",
  ':initial-tab="initialRoute.catalogTab"',
  ':initial-screen="initialRoute.miniScreen"',
  ':initial-session-id="initialRoute.sessionId"'
]) {
  assert(appShell.includes(token), `admin shell should keep route state in URL with ${token}`);
}
for (const token of ["buildVersion", "__PINCHE_BUILD_TIME__", "app-build-version"]) {
  assert(appShell.includes(token), `admin shell should render build-time version ${token}`);
}
assert(
  appShell.includes(':build-version="buildVersion"') &&
    appShell.includes("版本号 ${__PINCHE_BUILD_TIME__}"),
  "admin shell should pass the Beijing build-time version to the login home page"
);

const miniProgramWorkspace = read("apps/admin-web/src/components/MiniProgramWorkspace.vue");
const miniProgramStartCreateSource = miniProgramWorkspace.slice(
  miniProgramWorkspace.indexOf("function startCreate"),
  miniProgramWorkspace.indexOf("async function loadStores")
);
const miniProgramSelectStoreSource = miniProgramWorkspace.slice(
  miniProgramWorkspace.indexOf("function selectStore"),
  miniProgramWorkspace.indexOf("function selectScript")
);
const miniProgramSelectScriptSource = miniProgramWorkspace.slice(
  miniProgramWorkspace.indexOf("function selectScript"),
  miniProgramWorkspace.indexOf("function extraNpcRoles")
);
for (const token of [
  "screen === 'share'",
  "openAlbum",
  "openShare",
  "shareRoleCards",
  "pendingShareRole",
  "confirmShareRole",
  "confirmedCrossCastRoleKey",
  "copyShareLink",
  "copySeatShareLink",
  "trackShareView",
  "getSessionChat",
  "sendSessionMessage",
  "pinSessionChatMessage",
  "leaveOrganizer"
]) {
  assert(miniProgramWorkspace.includes(token), `web miniapp should include parity token ${token}`);
}
for (const token of [
  "defineProps",
  "initialScreen",
  "initialSessionId",
  "writeAdminRoute",
  "updateMiniRoute",
  "openInitialRoute"
]) {
  assert(miniProgramWorkspace.includes(token), `web miniapp should restore URL state with ${token}`);
}
assert(
  /screen\.value = "create"[\s\S]{0,220}loadStores\(\)/.test(miniProgramStartCreateSource),
  "web miniapp should load active stores when entering the create flow"
);
assert(
  miniProgramWorkspace.includes(':disabled="busy || !canEnterCreateStep(item.value)"') &&
    miniProgramWorkspace.includes('@click="enterCreateStep(item.value)"'),
  "web miniapp create stepper should disable locked steps and route clicks through a guard"
);
assert(
  miniProgramWorkspace.includes("function canEnterCreateStep") &&
    /case "script":[\s\S]{0,80}selectedStore\.value\?\.id/.test(miniProgramWorkspace) &&
    /case "role":[\s\S]{0,80}selectedScript\.value\?\.id/.test(miniProgramWorkspace) &&
    /case "setup":[\s\S]{0,80}selectedRole\.value/.test(miniProgramWorkspace),
  "web miniapp create stepper should require each previous choice before entering later steps"
);
assert(
  miniProgramWorkspace.includes("function enterCreateStep") &&
    miniProgramWorkspace.includes("if (!canEnterCreateStep(nextStep))") &&
    miniProgramWorkspace.includes("createStep.value = nextStep"),
  "web miniapp create stepper should refuse guarded jumps in code, not just through disabled buttons"
);
assert(
  miniProgramSelectStoreSource.includes("selectedRole.value = null"),
  "web miniapp should clear the selected role when the store changes"
);
assert(
  miniProgramSelectScriptSource.includes("selectedRole.value = null") &&
    !miniProgramSelectScriptSource.includes("selectedRole.value = roleOptions.value[0]"),
  "web miniapp should not auto-pick a role after choosing a script"
);
assert(
  /const canCreate = computed\(\(\) =>[\s\S]{0,120}selectedRole\.value/.test(miniProgramWorkspace),
  "web miniapp should require an explicitly selected role before publishing"
);

const catalogWorkspace = read("apps/admin-web/src/components/CatalogWorkspace.vue");
for (const token of [
  "catalog-panel",
  "drawer-open",
  "drawer-wide-open",
  "toolbar-primary",
  "status-pill",
  "selected-row",
  "table-footer"
]) {
  assert(catalogWorkspace.includes(token), `catalog workspace should include ${token}`);
}
for (const token of [
  "defineProps",
  "initialTab",
  "writeAdminRoute",
  "activeView: \"catalog\""
]) {
  assert(catalogWorkspace.includes(token), `catalog workspace should restore URL tab with ${token}`);
}
for (const token of [
  "selectedItemIds",
  "selectedCount",
  "toggleSelectAllVisible",
  "batchUpdateStatus",
  "batchDeleteSelected",
  "批量上架",
  "批量下架",
  "批量删除"
]) {
  assert(catalogWorkspace.includes(token), `catalog workspace should support batch catalog actions with ${token}`);
}
assert(
  catalogWorkspace.includes("isCatalogEntityTab") &&
    catalogWorkspace.includes("clearSelection()"),
  "catalog batch controls should be scoped to catalog entities and clear selection on context changes"
);
for (const token of [
  "switchTab('review')",
  "listCatalogReviewItems",
  "saveCatalogReviewDraft",
  "reviewAction",
  "approveCatalogReviewItem",
  "requestCatalogReviewItemNeedsChanges",
  "rejectCatalogReviewItem",
  "mergeCatalogReviewItem",
  "待审核"
]) {
  assert(catalogWorkspace.includes(token), `catalog workspace should include D33 review flow ${token}`);
}
for (const token of [
  'aria-label="选择全部车局"',
  "`选择车局${item.id}`",
  "batchForceDeleteSessions",
  "批量强制删除",
  "selectedSessionCount"
]) {
  assert(
    catalogWorkspace.includes(token),
    `catalog workspace should support bulk session deletion with ${token}`
  );
}
assert(
  catalogWorkspace.includes('visibleSelectableItems = computed(() => (tab.value === "review" ? [] : items.value))') &&
    catalogWorkspace.includes('v-if="tab === \'sessions\' && selectedSessionCount > 0"'),
  "catalog workspace should let session rows be selected, exclude review rows, and expose session-specific bulk actions"
);
assert(
  catalogWorkspace.includes("toggleStatus"),
  "catalog workspace should provide status-based archive toggle"
);
assert(
  catalogWorkspace.includes("saveStore") && catalogWorkspace.includes("saveScript"),
  "catalog workspace should archive through PATCH save APIs"
);
assert(
  catalogWorkspace.includes("deleteItem") &&
    catalogWorkspace.includes("deleteStore") &&
    catalogWorkspace.includes("deleteScript"),
  "catalog workspace should expose a separate delete action"
);
assert(
  catalogWorkspace.includes("item.status === 'inactive'") &&
    catalogWorkspace.includes('item.status !== "inactive"'),
  "catalog delete action should only be available after downlisting"
);
assert(
  catalogWorkspace.includes("已有车引用"),
  "catalog delete failure should explain that referenced items cannot be deleted"
);
assert(
  catalogWorkspace.includes("车局") &&
    catalogWorkspace.includes("tab === 'sessions'") &&
    catalogWorkspace.includes("listAdminSessions"),
  "catalog workspace should show an admin session list"
);
assert(
  catalogWorkspace.includes("deleteAdminSession") &&
    catalogWorkspace.includes("强制删除") &&
    catalogWorkspace.includes("forceDeleteSession"),
  "catalog workspace should expose explicit admin force delete for sessions"
);
assert(
  !catalogWorkspace.includes("restoreAdminSession") &&
    !catalogWorkspace.includes("downlistAdminSession") &&
    !catalogWorkspace.includes("isSessionDownlisted") &&
    !catalogWorkspace.includes("请先下架车局再删除"),
  "catalog workspace should not expose session downlist or restore actions"
);
assert(
  !catalogWorkspace.includes("硬删除"),
  "catalog workspace should not expose hard delete copy"
);
assert(
  catalogWorkspace.includes('status: "active"') &&
    catalogWorkspace.includes("refreshScriptOptions"),
  "store script picker should always refresh active script options"
);
assert(
  !catalogWorkspace.includes("if (availableScripts.value.length > 0)"),
  "store script picker should not reuse stale script option cache"
);
for (const token of [
  "operationPending",
  "operationText",
  "beginOperation",
  'class="loading-strip"',
  ':disabled="operationPending"',
  ':saving="operationPending"'
]) {
  assert(catalogWorkspace.includes(token), `catalog workspace should lock actions while busy: ${token}`);
}

assert(
  /WHERE store_scripts\.store_id = \?[\s\S]*AND scripts\.status = 'active'/.test(service),
  "store-script list should only return active linked scripts"
);
assert(
  /SELECT id FROM scripts WHERE id IN \(\$\{placeholders\}\) AND status = 'active'/.test(service),
  "store-script replacement should only accept active script ids"
);
assert(
  /store_scripts\.price_per_player/.test(service),
  "store-script list should expose the per-store script price"
);
assert(
  service.includes("scriptLinks") && service.includes("pricePerPlayer"),
  "store-script replacement should accept scriptLinks with pricePerPlayer"
);
assert(
  /INSERT INTO store_scripts \(store_id, script_id, price_per_player\)/.test(service),
  "store-script replacement should persist the per-store script price"
);
assert(
  /ss\.price_per_player|store_scripts\.price_per_player/.test(service) &&
    service.includes("filters.storeId"),
  "active script list should include the store-script price when filtered by store"
);

const scriptDrawer = read("apps/admin-web/src/components/ScriptDrawer.vue");
for (const token of ["addRole", "removeRole", "roleGender", "defaultSeatTemplate"]) {
  assert(scriptDrawer.includes(token), `script drawer should include ${token}`);
}
for (const token of ["saving", ':disabled="saving"', 'saving ? "保存中..." : "保存剧本"']) {
  assert(scriptDrawer.includes(token), `script drawer should lock save controls while busy: ${token}`);
}
for (const token of ["drawer-body", "drawer-footer", "secondary-action", "role-table-wrap"]) {
  assert(scriptDrawer.includes(token), `script drawer should use operator drawer ${token}`);
}
assert(scriptDrawer.includes("footer-actions"), "script drawer should expose review footer actions slot");
assert(scriptDrawer.includes("角色介绍"), "script roles should use a role introduction field");
for (const removedRoleToken of [
  "<th>类型</th>",
  "<th>定位</th>",
  "<th>基础价</th>",
  "<th>调整</th>",
  "roleSeatType",
  "rolePosition",
  "roleBasePrice",
  "roleAdjustment",
  "basePriceYuan",
  "adjustmentYuan"
]) {
  assert(
    !scriptDrawer.includes(removedRoleToken),
    `script roles should not expose legacy role field ${removedRoleToken}`
  );
}
assert(
  !/defaultSeatTemplate:[\s\S]*seatType:/.test(scriptDrawer) &&
    !/defaultSeatTemplate:[\s\S]*roleName:/.test(scriptDrawer) &&
    !/defaultSeatTemplate:[\s\S]*basePrice:/.test(scriptDrawer) &&
    !/defaultSeatTemplate:[\s\S]*adjustment:/.test(scriptDrawer),
  "script role submissions should not send type, position, base price, or adjustment"
);

const storeDrawer = read("apps/admin-web/src/components/StoreDrawer.vue");
assert(storeDrawer.includes("关联剧本"), "store drawer should include script association section");
assert(storeDrawer.includes("scriptIds"), "store drawer should submit scriptIds");
assert(storeDrawer.includes("storeScriptPrice"), "store drawer should collect per-script store prices");
assert(storeDrawer.includes("pricePerPlayer"), "store drawer should submit per-script store prices");
for (const token of ["saving", ':disabled="saving"', 'saving ? "保存中..." : "保存店家"']) {
  assert(storeDrawer.includes(token), `store drawer should lock save controls while busy: ${token}`);
}
for (const token of ["drawer-body", "drawer-footer", "secondary-action", "script-link-count"]) {
  assert(storeDrawer.includes(token), `store drawer should use operator drawer ${token}`);
}
assert(
  storeDrawer.includes("reviewMode") && storeDrawer.includes("footer-actions"),
  "store drawer should support D33 review mode footer actions"
);
for (const token of [
  "纬度（GCJ-02）",
  "经度（GCJ-02）",
  "getTencentMapKey",
  "map.qq.com/api/gljs",
  "TMap.Map",
  "TMap.MultiMarker",
  "地点搜索",
  "searchPoiByKeyword",
  "applyPoiResult",
  "latitude: model.latitude",
  "longitude: model.longitude"
]) {
  assert(storeDrawer.includes(token), `store drawer should support D34 location field: ${token}`);
}

assert(webApi.includes("scriptLinks"), "web API should save store-script link prices");
for (const token of [
  'import("cos-js-sdk-v5")',
  "/api/uploads/cos-intent",
  "/api/uploads/cos-authorization",
  "uploadCosBackedFile",
  "uploadCosObject",
  "putAlbumPhotoToCos",
  "getCosClient",
  "client.putObject",
  "uploadSessionAlbumPhotoLocal",
  "albumAuthorizationErrorsByKey",
  "adminSessionAlbumPhoto",
  "sessionReviewPhoto",
  "/api/admin/sessions/",
  "sessionAlbumBasePath",
  "}/uploads"
]) {
  assert(webApi.includes(token), `admin album upload should use COS-backed upload flow with ${token}`);
}
assert(
  /async function uploadCosBackedFile\(\{ kind, file, fallbackUpload, intentData = \{\} \}\) \{[\s\S]*?return fallbackUpload\(file\);[\s\S]*?return await uploadCosObject\(upload, file\);[\s\S]*?return fallbackUpload\(file\);[\s\S]*?\n\}/.test(webApi),
  "generic admin media upload should preserve the existing video fallback strategy"
);
const adminAlbumMedia = read("apps/admin-web/src/albumMedia.js");
for (const token of [
  "uploadAdminAlbumPhoto",
  "cos-direct-v2",
  "fallbackAllowed === true",
  "executeAlbumCosUpload",
  "DIRECT_UPLOAD_REQUIRED"
]) {
  assert(adminAlbumMedia.includes(token), `admin image upload adapter must include ${token}`);
}

const miniAppWorkspace = read("apps/admin-web/src/components/MiniProgramWorkspace.vue");
const miniAppMineTemplate = miniAppWorkspace.slice(
  miniAppWorkspace.indexOf("screen === 'home' || screen === 'mine'"),
  miniAppWorkspace.indexOf('screen === \'detail\'')
);
for (const token of [
  "mini-dashboard",
  "mini-workbench-actions",
  "创建车局",
  "我的拼车日程",
  "车详情",
  "车头管理",
  "写记录",
  "SessionAlbumWorkspace",
  "createUserSession",
  "createSessionSeat",
  "publishSession",
  "claimSessionSeat",
  "listMySessions",
  "listMySignups",
  "listSessionSignups",
  "approveSignup",
  "rejectSignup",
  "lockSessionSeat",
  "kickSessionSeat",
  "saveMySessionReview",
  "uploadSessionReviewPhoto"
]) {
  assert(miniAppWorkspace.includes(token), `admin mini app should include ${token}`);
}
for (const token of [
  "mineCalendarItems",
  "mineCalendarFilterTabs",
  "mineDayGroups",
  "mergeMineCalendarItems",
  "mineCalendarIdentityTags",
  "handleMineCalendarPrimaryAction"
]) {
  assert(miniAppWorkspace.includes(token), `admin mini app Mine should use calendar parity logic with ${token}`);
}
for (const token of [
  "mini-dashboard-title",
  "mini-dashboard-metrics",
  "mineCalendarOrganizedCount",
  "mineCalendarJoinedCount",
  "mini-create-action",
  "mini-refresh-action"
]) {
  assert(miniAppWorkspace.includes(token), `admin mini app Mine dashboard should use compact workbench layout token ${token}`);
}
const adminMiniStyles = read("apps/admin-web/src/styles.css");
assert(
  /\.mine-calendar-head\s*\{[\s\S]*min-height: 76px;/.test(adminMiniStyles) &&
    /\.mini-workbench-actions\s*\{[\s\S]*flex-wrap: nowrap;/.test(adminMiniStyles) &&
    /\.mini-workbench-actions \.mini-create-action,[\s\S]*\.mini-workbench-actions \.mini-refresh-action\s*\{[\s\S]*width: auto;/.test(adminMiniStyles),
  "admin mini app Mine dashboard header actions should stay compact instead of stacking into large blocks"
);
assert(
  /\.mine-calendar-toolbar\s*\{[\s\S]*padding: 8px 14px 10px;/.test(adminMiniStyles) &&
    /\.mine-filter-tab\s*\{[\s\S]*min-height: 32px;/.test(adminMiniStyles),
  "admin mini app Mine filter toolbar should be compact and scannable"
);
assert(
  !miniAppMineTemplate.includes("我的发车") && !miniAppMineTemplate.includes("我参与的车"),
  "admin mini app Mine should render one combined calendar instead of separate organized and joined sections"
);
assert(
  !miniAppWorkspace.includes("管理员内测版") &&
    !miniAppWorkspace.includes("复刻小程序业务流程") &&
    !miniAppWorkspace.includes("跑稳后可升级") &&
    !miniAppWorkspace.includes("mini-app-tab-shell") &&
    !miniAppWorkspace.includes("mini-app-tabs") &&
    !miniAppWorkspace.includes("const tabs") &&
    !miniAppWorkspace.includes("小程序首页") &&
    !miniAppWorkspace.includes("对等范围") &&
    !read("apps/admin-web/src/styles.css").includes(".mini-app-tab-shell") &&
    !read("apps/admin-web/src/styles.css").includes(".mini-app-tabs"),
  "admin mini app should be a single dashboard page without top-level tabs or intro cards"
);
for (const token of [
  "busyText",
  'class="loading-strip"',
  ':disabled="busy"',
  "if (busy.value)",
  'busyText.value = "'
]) {
  assert(miniAppWorkspace.includes(token), `admin mini app should lock related controls while busy: ${token}`);
}
assert(
  miniAppWorkspace.includes(':session-id="activeSessionId"') &&
    !miniAppWorkspace.includes("switchScreen('album')"),
  "admin mini app album entry should match mini-program detail-only album logic"
);

const sessionAlbumWorkspace = read("apps/admin-web/src/components/SessionAlbumWorkspace.vue");
const sessionAlbumSaveTagsSource = sessionAlbumWorkspace.slice(
  sessionAlbumWorkspace.indexOf("async function saveTags"),
  sessionAlbumWorkspace.indexOf("async function openPrivacyDrawer")
);
for (const token of [
  "albumActionBusy",
  "deletingPhotoId",
  "loadingPrivacy",
  'class="loading-strip"',
  ':disabled="albumActionBusy"',
  'deletingPhotoId === photo.id ? "删除中..." : "删除"'
]) {
  assert(sessionAlbumWorkspace.includes(token), `admin album should lock related controls while busy: ${token}`);
}
for (const token of [
  "bulkSelectionMode",
  "selectedAlbumPhotoIds",
  "album-selection-checkbox",
  "album-command-sentinel",
  "album-command-bar",
  "albumCommandFloating",
  "album-selection-toolbar",
  "toggleBulkSelectionMode",
  "toggleAlbumPhotoSelection",
  "toggleSelectFilteredPhotos",
  "allFilteredTaggableSelected",
  "clearBulkSelection",
  "全选当前筛选",
  "openBulkTagDrawer",
  "selectedAlbumPhotoCount",
  "selectedTagTargetCount",
  "visibleTaggedPhotoCount",
  "visibleUntaggedPhotoCount",
  "filteredTaggedPhotoCount",
  "filteredUntaggedPhotoCount",
  "filteredTagProgressPercent",
  "album-workbench",
  "album-metrics",
  "album-upload-icon",
  "albumTagProgressPercent",
  "album-progress-bar",
  "album-progress-fill",
  "部分照片标注失败",
  "applyAlbumTagUpdates",
  "selectedAlbumRoleFilter",
  "albumFilterOptions",
  "albumRoleFilterOptions",
  "countAlbumPhotosForFilter",
  "countPhotosForRole",
  "photoMatchesSelectedRole",
  "全部角色",
  "for (const photoId of targetPhotoIds)",
  "await updateSessionAlbumPhotoTags(photoId, selectedTagKeys.value)",
  "tagPersonTitle",
  "tagPersonSubtitle",
  'v-if="tagPersonSubtitle(person)"'
]) {
  assert(sessionAlbumWorkspace.includes(token), `admin mini album should support bulk tagging: ${token}`);
}
assert(
  !sessionAlbumSaveTagsSource.includes("await loadAlbum()"),
  "admin mini album tag save should patch local photo data instead of refreshing the whole album"
);
const adminWebStyles = read("apps/admin-web/src/styles.css");
const albumCommandBarStyle = (
  adminWebStyles.match(/\.album-command-bar\s*\{[\s\S]*?\n\}/) || [""]
)[0];
assert(
  !sessionAlbumWorkspace.includes('class="catalog-panel album-panel"') &&
    !sessionAlbumWorkspace.includes("album-top-toolbar") &&
    !sessionAlbumWorkspace.includes("album-top-count") &&
    !adminWebStyles.includes(".album-top-toolbar") &&
    !adminWebStyles.includes(".album-top-count"),
  "admin mini album should avoid the duplicate top album summary panel"
);
assert(
  !sessionAlbumWorkspace.includes("album-bulk-action-bar") &&
    !sessionAlbumWorkspace.includes("album-action-row") &&
    !read("apps/admin-web/src/styles.css").includes(".album-bulk-action-bar"),
  "admin mini album bulk actions should avoid the waterfall-bottom action bar"
);
assert(
  sessionAlbumWorkspace.includes("'bulk-selecting': bulkSelectionMode"),
  "admin mini album should add bottom padding while the fixed bulk toolbar is visible"
);
assert(
  !sessionAlbumWorkspace.includes("command-floating") &&
    !adminWebStyles.includes(".album-workspace.command-floating"),
  "admin mini album command toolbar should stay in page flow before it sticks"
);
assert(
  albumCommandBarStyle.includes("position: sticky;") &&
    albumCommandBarStyle.includes("top: var(--admin-album-command-toolbar-top);") &&
    !albumCommandBarStyle.includes("position: fixed;") &&
    !adminWebStyles.includes(".sidebar-collapsed .album-command-bar"),
  "admin mini album command controls should become sticky below the header only after scrolling"
);
assert(
  sessionAlbumWorkspace.includes("updateAlbumCommandFloating") &&
    /\.album-command-bar\.floating\s*\{[\s\S]*box-shadow:/.test(adminWebStyles) &&
    /\.album-command-sentinel\s*\{[\s\S]*height: 1px;/.test(adminWebStyles),
  "admin mini album command controls should only get floating treatment after sticking"
);
assert(
  !sessionAlbumWorkspace.includes("可以上传。给照片标注后") &&
    !sessionAlbumWorkspace.includes("你可以查看满足隐私条件的照片"),
  "admin mini album should avoid persistent explanatory copy in the album workbench"
);
assert(
  /\.album-workbench\s*\{[\s\S]*background: #fbfdfc;/.test(adminWebStyles) &&
    /\.album-metrics\s*\{[\s\S]*grid-template-columns: minmax\(0, 1fr\) minmax\(220px, 0\.55fr\);/.test(adminWebStyles) &&
    /\.album-upload-icon\s*\{[\s\S]*border-radius: 50%;/.test(adminWebStyles),
  "admin mini album workbench should use a compact designed upload and progress layout"
);
assert(
  sessionAlbumWorkspace.includes("当前筛选 {{ filteredPhotos.length }} 张") &&
    sessionAlbumWorkspace.includes("我的照片 {{ visiblePhotoCount }} 张") &&
    sessionAlbumWorkspace.includes("筛选已标注 {{ filteredTaggedPhotoCount }} 张") &&
    sessionAlbumWorkspace.includes("筛选待标注 {{ filteredUntaggedPhotoCount }} 张") &&
    sessionAlbumWorkspace.includes("width: `${filteredTagProgressPercent}%`"),
  "admin mini album summary should not mix filtered current count with global tagged counts"
);
assert(
  /\.album-command-bar \.secondary-action,[\s\S]*\.album-command-bar \.primary\s*\{[\s\S]*width: auto;/.test(adminWebStyles) &&
    /\.album-command-actions\s*\{[\s\S]*flex-wrap: nowrap;/.test(adminWebStyles) &&
    /\.album-command-bar \.filter-chip\s*\{[\s\S]*white-space: nowrap;/.test(adminWebStyles),
  "admin mini album command toolbar actions should stay compact in one row"
);
assert(
  /v-for="filter in albumFilterOptions"[\s\S]*filter\.count/.test(sessionAlbumWorkspace) &&
    /<select[\s\S]*v-model="selectedAlbumRoleFilter"[\s\S]*album-role-select/.test(sessionAlbumWorkspace) &&
    sessionAlbumWorkspace.includes("const filteredPhotos = computed(() => photosForAlbumFilter(activeAlbumFilter.value))") &&
    sessionAlbumWorkspace.includes("count: countAlbumPhotosForFilter(filter.value)") &&
    /function photoMatchesSelectedRole\(photo\)[\s\S]*photoMatchesRole\(photo, selectedAlbumRoleFilter\.value\)/.test(sessionAlbumWorkspace) &&
    /function photoMatchesRole\(photo, roleKey\)[\s\S]*tag\.key === roleKey/.test(sessionAlbumWorkspace),
  "admin mini album should support counted filter chips plus role dropdown filtering by exact photo tag key"
);
assert(
  /\.album-role-select\s*\{[\s\S]*height: 34px;/.test(adminWebStyles),
  "admin mini album role dropdown should stay compact in the command toolbar"
);
assert(
  /\.album-selection-toolbar\s*\{[\s\S]*position: fixed;[\s\S]*bottom: 16px/.test(adminWebStyles),
  "admin mini album selection controls should use a fixed bottom toolbar while scrolling"
);
assert(
  /\.album-selection-actions\s*\{[\s\S]*flex-wrap: nowrap;/.test(adminWebStyles) &&
    /\.album-selection-toolbar \.secondary-action,[\s\S]*\.album-selection-toolbar \.primary\s*\{[\s\S]*width: auto;/.test(adminWebStyles),
  "admin mini album bottom toolbar actions should stay compact in one row"
);
assert(
  /\.album-detail-card\s*\{[\s\S]*overflow: visible;[\s\S]*\}/.test(adminWebStyles),
  "admin mini album detail card should not clip sticky selection controls"
);
assert(
  (adminWebStyles.match(/\.album-detail-card\s*\{[\s\S]*?overflow: visible;[\s\S]*?\}/g) || []).length >= 2,
  "admin mini album detail card should keep overflow visible in desktop and narrow layouts"
);

const setupPage = read("apps/miniprogram/src/pages/session/setup.vue");
assert(
  setupPage.includes("storeScriptPrice") && setupPage.includes("price_per_player"),
  "mini-program session setup should use store-script price for seat base price"
);

const createFlow = read("apps/miniprogram/src/utils/createFlow.js");
assert(
  createFlow.includes("description") &&
    /note:\s*item\.description/.test(createFlow),
  "mini-program role options should show script role descriptions instead of role type/position"
);

const adminStyles = read("apps/admin-web/src/styles.css");
for (const token of [
  "--admin-sidebar",
  ".operator-topbar",
  ".app-build-version",
  ".loading-strip",
  ".catalog-panel",
  ".status-pill.active",
  ".data-table tbody tr.selected-row",
  ".drawer-footer"
]) {
  assert(adminStyles.includes(token), `admin styles should include ${token}`);
}

const compose = read("docker-compose.prod.example.yml");
assert(compose.includes("admin-web:"), "production compose should define admin-web");
assert(compose.includes("admin.pinche.jubenmi.com"), "admin-web should have Traefik host rule");

console.log("d12 admin web static checks passed");
