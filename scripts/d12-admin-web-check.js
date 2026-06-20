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
  "apps/admin-web/Dockerfile",
  "apps/admin-web/nginx.conf",
  "apps/api/migrations/0007_admin_web_login.sql",
  "apps/api/migrations/0008_store_script_links.sql",
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
  server.includes("adminStoreScriptsId") &&
    server.includes("listStoreScripts") &&
    server.includes("replaceStoreScripts"),
  "server should route store-script association endpoints"
);

const service = read("apps/api/src/modules/core/service.js");
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
assert(service.includes("DELETE FROM stores"), "store delete should be physical");
assert(service.includes("DELETE FROM scripts"), "script delete should be physical");

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
assert(!webApi.includes("deleteStore"), "web API should not expose store hard delete");
assert(!webApi.includes("deleteScript"), "web API should not expose script hard delete");
assert(webApi.includes("listStoreScripts"), "web API should list store-script links");
assert(webApi.includes("saveStoreScripts"), "web API should save store-script links");

const adminViteConfigSource = read("apps/admin-web/vite.config.js");
assert(
  adminViteConfigSource.includes("__PINCHE_BUILD_TIME__"),
  "admin web Vite config must inject the build-time version constant"
);
assert(
  adminViteConfigSource.includes("Asia/Shanghai"),
  "admin web build time must be formatted in Beijing time"
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

const dockerWorkflow = read(".github/workflows/docker-publish.yml");
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

const appShell = read("apps/admin-web/src/App.vue");
for (const token of ["shell-toggle", "user-avatar", "sidebar-collapse"]) {
  assert(appShell.includes(token), `admin shell should include operator workspace ${token}`);
}
for (const token of ["buildVersion", "__PINCHE_BUILD_TIME__", "app-build-version"]) {
  assert(appShell.includes(token), `admin shell should render build-time version ${token}`);
}

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
assert(
  catalogWorkspace.includes("toggleStatus"),
  "catalog workspace should provide status-based archive toggle"
);
assert(
  catalogWorkspace.includes("saveStore") && catalogWorkspace.includes("saveScript"),
  "catalog workspace should archive through PATCH save APIs"
);
assert(
  !catalogWorkspace.includes("硬删除"),
  "catalog workspace should not expose hard delete copy"
);

const scriptDrawer = read("apps/admin-web/src/components/ScriptDrawer.vue");
for (const token of ["addRole", "removeRole", "roleGender", "defaultSeatTemplate"]) {
  assert(scriptDrawer.includes(token), `script drawer should include ${token}`);
}
for (const token of ["drawer-body", "drawer-footer", "secondary-action", "role-table-wrap"]) {
  assert(scriptDrawer.includes(token), `script drawer should use operator drawer ${token}`);
}

const storeDrawer = read("apps/admin-web/src/components/StoreDrawer.vue");
assert(storeDrawer.includes("关联剧本"), "store drawer should include script association section");
assert(storeDrawer.includes("scriptIds"), "store drawer should submit scriptIds");
for (const token of ["drawer-body", "drawer-footer", "secondary-action", "script-link-count"]) {
  assert(storeDrawer.includes(token), `store drawer should use operator drawer ${token}`);
}

const adminStyles = read("apps/admin-web/src/styles.css");
for (const token of [
  "--admin-sidebar",
  ".operator-topbar",
  ".app-build-version",
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
