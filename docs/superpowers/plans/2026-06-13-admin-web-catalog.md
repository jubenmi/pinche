# Admin Web Catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Docker-deployable Vue3 Web admin frontend with WeChat mini-program scan login, hard-delete CRUD for stores/scripts/script role templates, and explicit store-to-script association so a selected store only shows its own scripts.

**Architecture:** Add a new `apps/admin-web` Vite app served by Nginx in production. Extend the existing Node API with persisted admin Web login tickets and hard-delete routes; keep script roles in `scripts.default_seat_template_json` and expose them through the Web editor. Add a mini-program scan-confirm action on the existing admin catalog page.

**Tech Stack:** Node.js HTTP API, MySQL migrations, Vue3, Vite, Nginx, Docker Compose, UniApp mini-program.

---

## Scope Check

This plan covers one deployable feature: an admin Web catalog app. It touches backend auth/delete APIs, one mini-program scan-confirm entry, the Vue admin frontend, Docker deployment, and verification scripts. These pieces are coupled by the login and catalog CRUD flows and should ship together.

## File Structure

- Create `apps/api/migrations/0007_admin_web_login.sql`: persisted login ticket table.
- Create `apps/api/src/modules/auth/admin-web-login.js`: ticket creation, polling, approval, and token handoff.
- Modify `apps/api/src/modules/auth/wechat.js`: export a token helper that can issue the same business token for approved Web login.
- Modify `apps/api/src/modules/core/service.js`: add hard-delete functions for stores and scripts.
- Modify `apps/api/src/server.js`: route Web login and DELETE endpoints.
- Modify `apps/api/src/db/mysql.js`: add `admin_web_login_tickets` to readiness tables.
- Create `apps/api/migrations/0008_store_script_links.sql`: explicit store-script association table.
- Modify `apps/api/src/modules/core/service.js`: add store-script association CRUD and filter public scripts by `storeId`.
- Modify `apps/api/src/server.js`: route store-script association endpoints.
- Modify `apps/api/src/db/mysql.js`: add `store_scripts` to readiness tables.
- Create `scripts/d12-admin-web-check.js`: static and source-level feature gate.
- Create `scripts/d12-admin-web-smoke.js`: API smoke for login ticket and hard delete.
- Modify `package.json`: add `apps/admin-web` workspace and scripts.
- Create `apps/admin-web/package.json`: Vue/Vite app dependencies and scripts.
- Create `apps/admin-web/index.html`: root HTML shell.
- Create `apps/admin-web/vite.config.js`: dev server proxy to the API.
- Create `apps/admin-web/src/main.js`: Vue app mount.
- Create `apps/admin-web/src/App.vue`: shell, login state, navigation.
- Create `apps/admin-web/src/api.js`: fetch wrapper, token storage, ticket polling API, catalog API.
- Create `apps/admin-web/src/components/LoginPanel.vue`: QR login surface.
- Create `apps/admin-web/src/components/CatalogWorkspace.vue`: store/script tabs and list orchestration.
- Create `apps/admin-web/src/components/StoreDrawer.vue`: create/edit store form.
- Create `apps/admin-web/src/components/ScriptDrawer.vue`: create/edit script form and role table.
- Create `apps/admin-web/src/styles.css`: restrained admin UI styling.
- Create `apps/admin-web/Dockerfile`: multi-stage build and Nginx runtime.
- Create `apps/admin-web/nginx.conf`: SPA serving and `/api` reverse proxy.
- Modify `apps/miniprogram/src/pages/admin/catalog.vue`: add scan-confirm button and handler.
- Modify `apps/miniprogram/src/pages/session/script.vue`: carry selected store ID into `/api/scripts`.
- Modify `docker-compose.prod.example.yml`: add `admin-web` service.

## Task 1: Add Failing Admin Web Checks

**Files:**
- Create: `scripts/d12-admin-web-check.js`
- Modify: `package.json`

- [ ] **Step 1: Write the failing static check**

Create `scripts/d12-admin-web-check.js`:

```js
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
  "apps/api/src/modules/auth/admin-web-login.js"
];

for (const file of requiredFiles) {
  assert(exists(file), `${file} should exist`);
}

const rootPackage = JSON.parse(read("package.json"));
assert(rootPackage.workspaces.includes("apps/admin-web"), "admin-web workspace should be registered");
assert(rootPackage.scripts["dev:admin-web"], "dev:admin-web script should exist");
assert(rootPackage.scripts["build:admin-web"], "build:admin-web script should exist");
assert(rootPackage.scripts.check.includes("scripts/d12-admin-web-check.js"), "root check should run d12 check");

const server = read("apps/api/src/server.js");
assert(server.includes("/api/admin/web-login/tickets"), "server should expose admin web login routes");
assert(server.includes("deleteStore"), "server should route store hard delete");
assert(server.includes("deleteScript"), "server should route script hard delete");

const service = read("apps/api/src/modules/core/service.js");
assert(service.includes("export async function deleteStore"), "service should export deleteStore");
assert(service.includes("export async function deleteScript"), "service should export deleteScript");
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

const miniProgramAdmin = read("apps/miniprogram/src/pages/admin/catalog.vue");
assert(miniProgramAdmin.includes("scanAdminWebLogin"), "mini-program admin page should scan Web login QR");
assert(miniProgramAdmin.includes("pinche-admin-login://ticket/"), "scan handler should validate admin login scheme");
assert(miniProgramAdmin.includes("/api/admin/web-login/tickets/"), "scan handler should approve tickets through API");

const webApi = read("apps/admin-web/src/api.js");
assert(webApi.includes("createLoginTicket"), "web API should create login tickets");
assert(webApi.includes("pollLoginTicket"), "web API should poll login tickets");
assert(webApi.includes("deleteStore"), "web API should call store DELETE");
assert(webApi.includes("deleteScript"), "web API should call script DELETE");

const loginPanel = read("apps/admin-web/src/components/LoginPanel.vue");
assert(loginPanel.includes("QRCode"), "login panel should generate a QR code");
assert(loginPanel.includes("pollLoginTicket"), "login panel should poll ticket status");

const scriptDrawer = read("apps/admin-web/src/components/ScriptDrawer.vue");
for (const token of ["addRole", "removeRole", "roleGender", "defaultSeatTemplate"]) {
  assert(scriptDrawer.includes(token), `script drawer should include ${token}`);
}

const compose = read("docker-compose.prod.example.yml");
assert(compose.includes("admin-web:"), "production compose should define admin-web");
assert(compose.includes("admin.pinche.jubenmi.com"), "admin-web should have Traefik host rule");

console.log("d12 admin web static checks passed");
```

- [ ] **Step 2: Wire the check and verify it fails**

Modify `package.json` so the check script includes `node scripts/d12-admin-web-check.js` before `node scripts/check-miniprogram.js`, and add:

```json
"dev:admin-web": "npm --workspace apps/admin-web run dev",
"build:admin-web": "npm --workspace apps/admin-web run build"
```

Run:

```bash
node scripts/d12-admin-web-check.js
```

Expected: FAIL with `apps/admin-web/package.json should exist`.

- [ ] **Step 3: Commit the failing check**

```bash
git add package.json scripts/d12-admin-web-check.js
git commit -m "test: add admin web feature checks"
```

## Task 2: Add Admin Web Login Backend

**Files:**
- Create: `apps/api/migrations/0007_admin_web_login.sql`
- Create: `apps/api/src/modules/auth/admin-web-login.js`
- Modify: `apps/api/src/modules/auth/wechat.js`
- Modify: `apps/api/src/db/mysql.js`
- Modify: `apps/api/src/server.js`
- Create: `scripts/d12-admin-web-smoke.js`

- [ ] **Step 1: Write the failing smoke test**

Create `scripts/d12-admin-web-smoke.js` with a login-ticket flow and hard-delete assertions. The first version should call endpoints that do not exist yet:

```js
const baseUrl = process.env.BASE_URL || "http://localhost:3018";
const suffix = Date.now();

async function request(method, path, body, token, expectedStatus = 200) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {})
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  if (response.status !== expectedStatus) {
    throw new Error(`${method} ${path} expected ${expectedStatus}, got ${response.status}: ${text}`);
  }
  return payload;
}

async function login(code) {
  const payload = await request("POST", "/api/auth/wechat/login", { code });
  return payload.data;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function main() {
  const admin = await login("dev-admin-openid");
  const normal = await login(`dev-d12-normal-${suffix}`);

  const ticket = await request("POST", "/api/admin/web-login/tickets", {
    userAgent: "d12-smoke"
  }, undefined, 201);

  assert(ticket.data.ticketId, "ticket should include ticketId");
  assert(ticket.data.ticketSecret, "ticket should include ticketSecret");
  assert(ticket.data.qrText.includes("pinche-admin-login://ticket/"), "ticket should include QR text");

  await request(
    "POST",
    `/api/admin/web-login/tickets/${ticket.data.ticketId}/approve`,
    { secret: ticket.data.ticketSecret },
    normal.token,
    403
  );

  await request(
    "POST",
    `/api/admin/web-login/tickets/${ticket.data.ticketId}/approve`,
    { secret: ticket.data.ticketSecret },
    admin.token
  );

  const approved = await request(
    "GET",
    `/api/admin/web-login/tickets/${ticket.data.ticketId}?secret=${encodeURIComponent(ticket.data.ticketSecret)}`
  );
  assert(approved.data.status === "approved", "poll should return approved");
  assert(approved.data.token, "approved poll should return token");
  assert(approved.data.roles.includes("system_admin"), "approved token should be admin");

  const consumed = await request(
    "GET",
    `/api/admin/web-login/tickets/${ticket.data.ticketId}?secret=${encodeURIComponent(ticket.data.ticketSecret)}`
  );
  assert(consumed.data.status === "consumed", "second poll should be consumed");

  console.log("d12 admin web smoke passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
```

- [ ] **Step 2: Run smoke and verify it fails**

Start API separately if needed, then run:

```bash
node scripts/d12-admin-web-smoke.js
```

Expected: FAIL on `POST /api/admin/web-login/tickets expected 201, got 404`.

- [ ] **Step 3: Add the migration**

Create `apps/api/migrations/0007_admin_web_login.sql`:

```sql
CREATE TABLE IF NOT EXISTS admin_web_login_tickets (
  id CHAR(36) NOT NULL PRIMARY KEY,
  secret_hash CHAR(64) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  approved_by_user_id BIGINT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NOT NULL,
  approved_at DATETIME NULL,
  consumed_at DATETIME NULL,
  user_agent VARCHAR(255) NULL,
  INDEX idx_admin_web_login_status_expires (status, expires_at),
  CONSTRAINT fk_admin_web_login_approved_by
    FOREIGN KEY (approved_by_user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

Modify `apps/api/src/db/mysql.js` and add `"admin_web_login_tickets"` to `requiredSchemaTables`.

- [ ] **Step 4: Export reusable token issuance**

Modify `apps/api/src/modules/auth/wechat.js` by extracting token generation:

```js
export function issueBusinessToken(user, roles, identity = {}) {
  const issuedAt = Math.floor(Date.now() / 1000);
  const expiresAt = issuedAt + 60 * 60 * 24 * 7;
  const token = tokenFor({
    sub: user.id,
    openid: identity.openid || user.open_id,
    roles,
    iat: issuedAt,
    exp: expiresAt
  });
  return { token, expiresAt };
}
```

Then make `loginWithWechatCode` call `issueBusinessToken(user, roles, { openid: identity.openid })` instead of duplicating token code.

- [ ] **Step 5: Implement the admin Web login module**

Create `apps/api/src/modules/auth/admin-web-login.js`:

```js
import crypto from "node:crypto";
import { createDatabaseConnection, withDatabaseConnection, withTransaction } from "../../db/mysql.js";
import { AppError, badRequest, forbidden } from "../../http/errors.js";
import { getUserWithRolesById } from "./users.js";
import { issueBusinessToken } from "./wechat.js";

const TICKET_TTL_MS = 5 * 60 * 1000;

function hashSecret(secret) {
  return crypto.createHash("sha256").update(secret).digest("hex");
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function ticketQrText(id, secret) {
  return `pinche-admin-login://ticket/${id}?secret=${encodeURIComponent(secret)}`;
}

function assertSecret(ticket, secret) {
  if (!secret || !safeEqual(ticket.secret_hash, hashSecret(secret))) {
    throw badRequest("Invalid ticket secret");
  }
}

function rowStatus(row) {
  if (row.status === "pending" && new Date(row.expires_at).getTime() <= Date.now()) {
    return "expired";
  }
  return row.status;
}

async function findTicket(connection, id, lock = false) {
  const [rows] = await connection.query(
    `SELECT * FROM admin_web_login_tickets WHERE id = ? ${lock ? "FOR UPDATE" : ""}`,
    [id]
  );
  if (!rows[0]) {
    throw new AppError(404, "NOT_FOUND", "Login ticket not found");
  }
  return rows[0];
}

export async function createAdminWebLoginTicket(body = {}) {
  const id = crypto.randomUUID();
  const secret = crypto.randomBytes(24).toString("base64url");
  const expiresAt = new Date(Date.now() + TICKET_TTL_MS);

  await withDatabaseConnection((connection) =>
    connection.query(
      `
        INSERT INTO admin_web_login_tickets (id, secret_hash, expires_at, user_agent)
        VALUES (?, ?, ?, ?)
      `,
      [id, hashSecret(secret), expiresAt, String(body.userAgent || "").slice(0, 255) || null]
    )
  );

  return {
    ticketId: id,
    ticketSecret: secret,
    qrText: ticketQrText(id, secret),
    expiresAt: expiresAt.toISOString()
  };
}

export async function approveAdminWebLoginTicket(user, id, body = {}) {
  if (!user.roles.includes("system_admin")) {
    throw forbidden("system_admin role required");
  }

  return withTransaction(async (connection) => {
    const ticket = await findTicket(connection, id, true);
    assertSecret(ticket, body.secret);
    const status = rowStatus(ticket);
    if (status !== "pending") {
      throw new AppError(409, "LOGIN_TICKET_NOT_PENDING", "Login ticket is not pending", { status });
    }

    await connection.query(
      `
        UPDATE admin_web_login_tickets
        SET status = 'approved',
            approved_by_user_id = ?,
            approved_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `,
      [user.user.id, id]
    );

    return { status: "approved" };
  });
}

export async function pollAdminWebLoginTicket(id, secret) {
  const connection = await createDatabaseConnection();
  try {
    await connection.beginTransaction();
    const ticket = await findTicket(connection, id, true);
    assertSecret(ticket, secret);
    const status = rowStatus(ticket);

    if (status === "approved") {
      const auth = await getUserWithRolesById(ticket.approved_by_user_id);
      if (!auth || !auth.roles.includes("system_admin")) {
        throw forbidden("system_admin role required");
      }
      const issued = issueBusinessToken(auth.user, auth.roles);
      await connection.query(
        "UPDATE admin_web_login_tickets SET status = 'consumed', consumed_at = CURRENT_TIMESTAMP WHERE id = ?",
        [id]
      );
      await connection.commit();
      return {
        status: "approved",
        user: auth.user,
        roles: auth.roles,
        token: issued.token,
        expiresAt: issued.expiresAt
      };
    }

    if (status === "expired" && ticket.status !== "expired") {
      await connection.query("UPDATE admin_web_login_tickets SET status = 'expired' WHERE id = ?", [id]);
    }

    await connection.commit();
    return { status };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    await connection.end();
  }
}
```

- [ ] **Step 6: Route the login endpoints**

Modify `apps/api/src/server.js` imports:

```js
import {
  approveAdminWebLoginTicket,
  createAdminWebLoginTicket,
  pollAdminWebLoginTicket
} from "./modules/auth/admin-web-login.js";
```

Add routes after `/api/auth/wechat/login`:

```js
if (request.method === "POST" && url.pathname === "/api/admin/web-login/tickets") {
  jsonResponse(response, 201, {
    ok: true,
    data: await createAdminWebLoginTicket({
      userAgent: request.headers["user-agent"] || body.userAgent
    })
  });
  return;
}

const adminWebLoginTicketId = url.pathname.match(/^\/api\/admin\/web-login\/tickets\/([^/]+)$/)?.[1];
if (request.method === "GET" && adminWebLoginTicketId) {
  jsonResponse(response, 200, {
    ok: true,
    data: await pollAdminWebLoginTicket(adminWebLoginTicketId, url.searchParams.get("secret"))
  });
  return;
}

const adminWebLoginApproveId = url.pathname.match(/^\/api\/admin\/web-login\/tickets\/([^/]+)\/approve$/)?.[1];
if (request.method === "POST" && adminWebLoginApproveId) {
  const user = await getAuthUser(request);
  jsonResponse(response, 200, {
    ok: true,
    data: await approveAdminWebLoginTicket(user, adminWebLoginApproveId, body)
  });
  return;
}
```

- [ ] **Step 7: Verify the login smoke passes**

Run migrations, start the API, then run:

```bash
node scripts/d12-admin-web-smoke.js
node scripts/d12-admin-web-check.js
```

Expected: login section passes; static check still fails on hard-delete and Web app files.

- [ ] **Step 8: Commit backend login**

```bash
git add apps/api/migrations/0007_admin_web_login.sql apps/api/src/db/mysql.js apps/api/src/modules/auth/admin-web-login.js apps/api/src/modules/auth/wechat.js apps/api/src/server.js scripts/d12-admin-web-smoke.js
git commit -m "feat: add admin web scan login api"
```

## Task 3: Add Hard Delete API

**Files:**
- Modify: `apps/api/src/modules/core/service.js`
- Modify: `apps/api/src/server.js`
- Modify: `scripts/d12-admin-web-smoke.js`

- [ ] **Step 1: Extend the failing smoke test**

Append this behavior to `main()` in `scripts/d12-admin-web-smoke.js` before the success log:

```js
const marker = `D12-${suffix}`;
const store = await request("POST", "/api/admin/stores", {
  name: `${marker}硬删店`,
  city: "北京",
  district: "朝阳",
  address: "D12硬删测试地址",
  status: "active"
}, admin.token, 201);

const script = await request("POST", "/api/admin/scripts", {
  name: `${marker}硬删本`,
  typeTags: ["情感", "测试"],
  playerCount: 2,
  summaryNoSpoiler: "D12硬删测试剧本",
  defaultSeatTemplate: [
    { name: "角色A", seatType: "normal", roleName: "男主", roleGender: "male", basePrice: 10000, adjustment: 0 },
    { name: "角色B", seatType: "normal", roleName: "女主", roleGender: "female", basePrice: 10000, adjustment: 0 }
  ],
  status: "active"
}, admin.token, 201);

await request("DELETE", `/api/admin/stores/${store.data.id}`, undefined, normal.token, 403);
await request("DELETE", `/api/admin/scripts/${script.data.id}`, undefined, normal.token, 403);
await request("DELETE", `/api/admin/stores/${store.data.id}`, undefined, admin.token);
await request("DELETE", `/api/admin/scripts/${script.data.id}`, undefined, admin.token);

const deletedStores = await request("GET", `/api/admin/stores?keyword=${encodeURIComponent(store.data.name)}`, undefined, admin.token);
const deletedScripts = await request("GET", `/api/admin/scripts?keyword=${encodeURIComponent(script.data.name)}`, undefined, admin.token);
assert(!deletedStores.data.some((item) => item.id === store.data.id), "hard-deleted store should disappear");
assert(!deletedScripts.data.some((item) => item.id === script.data.id), "hard-deleted script should disappear");

const referencedStore = await request("POST", "/api/admin/stores", {
  name: `${marker}引用店`,
  city: "北京",
  district: "海淀",
  address: "D12引用测试地址",
  status: "active"
}, admin.token, 201);
const referencedScript = await request("POST", "/api/admin/scripts", {
  name: `${marker}引用本`,
  typeTags: ["情感"],
  playerCount: 1,
  summaryNoSpoiler: "D12引用测试剧本",
  defaultSeatTemplate: [{ name: "角色", seatType: "normal", roleName: "角色", roleGender: "unlimited", basePrice: 10000, adjustment: 0 }],
  status: "active"
}, admin.token, 201);

await request("POST", "/api/sessions", {
  storeId: referencedStore.data.id,
  scriptId: referencedScript.data.id,
  startAt: "2030-01-01 12:00:00",
  depositAmount: 0,
  note: "D12 hard delete reference"
}, admin.token, 201);

const blockedStoreDelete = await request("DELETE", `/api/admin/stores/${referencedStore.data.id}`, undefined, admin.token, 409);
const blockedScriptDelete = await request("DELETE", `/api/admin/scripts/${referencedScript.data.id}`, undefined, admin.token, 409);
assert(blockedStoreDelete.error.code === "RESOURCE_IN_USE", "referenced store delete should be blocked");
assert(blockedScriptDelete.error.code === "RESOURCE_IN_USE", "referenced script delete should be blocked");
```

- [ ] **Step 2: Run smoke and verify it fails**

```bash
node scripts/d12-admin-web-smoke.js
```

Expected: FAIL on `DELETE /api/admin/stores/:id expected 200, got 404`.

- [ ] **Step 3: Implement service deletes**

Add to `apps/api/src/modules/core/service.js`:

```js
async function countRows(connection, sql, values) {
  const [rows] = await connection.query(sql, values);
  return Number(rows[0]?.count || rows[0]?.COUNT || 0);
}

async function hardDeleteCatalogEntity(connection, table, id, referenceSql, referenceLabel) {
  const references = await countRows(connection, referenceSql, [id]);
  if (references > 0) {
    throw new AppError(409, "RESOURCE_IN_USE", `${referenceLabel} is used by existing sessions`, {
      sessionCount: references
    });
  }

  const [result] = await connection.query(`DELETE FROM ${table} WHERE id = ?`, [id]);
  if (result.affectedRows === 0) {
    throw new AppError(404, "NOT_FOUND", `${referenceLabel} not found`);
  }
  return { id, deleted: true };
}

export async function deleteStore(id) {
  return withDatabaseConnection((connection) =>
    hardDeleteCatalogEntity(
      connection,
      "stores",
      id,
      "SELECT COUNT(*) AS count FROM sessions WHERE store_id = ?",
      "Store"
    )
  );
}

export async function deleteScript(id) {
  return withDatabaseConnection((connection) =>
    hardDeleteCatalogEntity(
      connection,
      "scripts",
      id,
      "SELECT COUNT(*) AS count FROM sessions WHERE script_id = ?",
      "Script"
    )
  );
}
```

If `countRows` already exists by the time this task runs, reuse it instead of duplicating the helper.

- [ ] **Step 4: Route DELETE endpoints**

Modify `apps/api/src/server.js` imports to include:

```js
deleteScript,
deleteStore,
```

Add after each `PATCH` route:

```js
if (request.method === "DELETE" && adminStoreId) {
  const user = await getAuthUser(request);
  requireRole(user, "system_admin");
  jsonResponse(response, 200, { ok: true, data: await deleteStore(adminStoreId) });
  return;
}
```

```js
if (request.method === "DELETE" && adminScriptId) {
  const user = await getAuthUser(request);
  requireRole(user, "system_admin");
  jsonResponse(response, 200, { ok: true, data: await deleteScript(adminScriptId) });
  return;
}
```

- [ ] **Step 5: Verify hard delete passes**

```bash
node scripts/d12-admin-web-smoke.js
node scripts/d12-admin-web-check.js
```

Expected: smoke passes through hard-delete tests; static check still fails on Web app files and mini-program scan.

- [ ] **Step 6: Commit hard delete**

```bash
git add apps/api/src/modules/core/service.js apps/api/src/server.js scripts/d12-admin-web-smoke.js
git commit -m "feat: hard delete admin catalog records"
```

## Task 4: Add Mini-Program Scan Approval

**Files:**
- Modify: `apps/miniprogram/src/pages/admin/catalog.vue`

- [ ] **Step 1: Run static check and confirm mini-program failure**

```bash
node scripts/d12-admin-web-check.js
```

Expected: FAIL with `mini-program admin page should scan Web login QR`.

- [ ] **Step 2: Add scan UI**

In `apps/miniprogram/src/pages/admin/catalog.vue`, inside the admin header section that currently shows `资料管理`, add a button in the existing action area:

```vue
<view class="actions">
  <button class="button" @tap="scanAdminWebLogin">扫码登录 Web 后台</button>
</view>
```

If the section already has an `.actions` block, add the button there instead of creating a nested card.

- [ ] **Step 3: Add scan helpers**

In the script block, add:

```js
function parseAdminWebLoginQr(rawValue) {
  const value = String(rawValue || "");
  const prefix = "pinche-admin-login://ticket/";
  if (!value.startsWith(prefix)) {
    return null;
  }
  const withoutPrefix = value.slice(prefix.length);
  const [ticketId, queryText = ""] = withoutPrefix.split("?");
  const params = new URLSearchParams(queryText);
  const secret = params.get("secret") || "";
  if (!ticketId || !secret) {
    return null;
  }
  return { ticketId, secret };
}

function confirmAdminWebLogin() {
  return new Promise((resolve) => {
    uni.showModal({
      title: "Web 后台登录",
      content: "确认登录 Web 管理后台？",
      confirmText: "确认登录",
      cancelText: "取消",
      success(result) {
        resolve(Boolean(result.confirm));
      },
      fail() {
        resolve(false);
      }
    });
  });
}

async function scanAdminWebLogin() {
  const result = await new Promise((resolve, reject) => {
    uni.scanCode({
      onlyFromCamera: false,
      success: resolve,
      fail: reject
    });
  }).catch(() => null);

  const parsed = parseAdminWebLoginQr(result?.result);
  if (!parsed) {
    showMessage("请扫描 Web 后台登录二维码");
    return;
  }

  const confirmed = await confirmAdminWebLogin();
  if (!confirmed) {
    return;
  }

  await request({
    url: `/api/admin/web-login/tickets/${parsed.ticketId}/approve`,
    method: "POST",
    data: { secret: parsed.secret }
  });
  showMessage("Web 后台已登录");
}
```

- [ ] **Step 4: Verify static check moves forward**

```bash
node scripts/d12-admin-web-check.js
```

Expected: mini-program assertions pass; static check still fails on Web app files.

- [ ] **Step 5: Commit mini-program scan approval**

```bash
git add apps/miniprogram/src/pages/admin/catalog.vue
git commit -m "feat: approve admin web login from miniprogram"
```

## Task 5: Scaffold Admin Web App and API Client

**Files:**
- Create: `apps/admin-web/package.json`
- Create: `apps/admin-web/index.html`
- Create: `apps/admin-web/vite.config.js`
- Create: `apps/admin-web/src/main.js`
- Create: `apps/admin-web/src/api.js`
- Create: `apps/admin-web/src/styles.css`

- [ ] **Step 1: Run static check and confirm app scaffold failure**

```bash
node scripts/d12-admin-web-check.js
```

Expected: FAIL with `apps/admin-web/package.json should exist`.

- [ ] **Step 2: Create package and Vite config**

Create `apps/admin-web/package.json`:

```json
{
  "name": "@pinche/admin-web",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite --host 0.0.0.0",
    "build": "vite build",
    "preview": "vite preview --host 0.0.0.0"
  },
  "dependencies": {
    "@vitejs/plugin-vue": "^5.2.4",
    "vite": "^6.3.5",
    "vue": "^3.5.16",
    "qrcode": "^1.5.4"
  },
  "devDependencies": {}
}
```

Create `apps/admin-web/vite.config.js`:

```js
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5178,
    proxy: {
      "/api": {
        target: process.env.VITE_API_PROXY_TARGET || "http://localhost:3018",
        changeOrigin: true
      },
      "/health": {
        target: process.env.VITE_API_PROXY_TARGET || "http://localhost:3018",
        changeOrigin: true
      }
    }
  }
});
```

- [ ] **Step 3: Create app shell files**

Create `apps/admin-web/index.html`:

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>剧本迷管理后台</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.js"></script>
  </body>
</html>
```

Create `apps/admin-web/src/main.js`:

```js
import { createApp } from "vue";
import App from "./App.vue";
import "./styles.css";

createApp(App).mount("#app");
```

- [ ] **Step 4: Create API client**

Create `apps/admin-web/src/api.js`:

```js
const TOKEN_KEY = "pinche_admin_web_token";
const USER_KEY = "pinche_admin_web_user";
const ROLES_KEY = "pinche_admin_web_roles";

export function getStoredAuth() {
  return {
    token: localStorage.getItem(TOKEN_KEY) || "",
    user: JSON.parse(localStorage.getItem(USER_KEY) || "null"),
    roles: JSON.parse(localStorage.getItem(ROLES_KEY) || "[]")
  };
}

export function setStoredAuth(auth) {
  localStorage.setItem(TOKEN_KEY, auth.token || "");
  localStorage.setItem(USER_KEY, JSON.stringify(auth.user || null));
  localStorage.setItem(ROLES_KEY, JSON.stringify(auth.roles || []));
}

export function clearStoredAuth() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  localStorage.removeItem(ROLES_KEY);
}

async function parseResponse(response) {
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  if (!response.ok || payload?.ok === false) {
    const error = new Error(payload?.error?.message || `Request failed: ${response.status}`);
    error.status = response.status;
    error.code = payload?.error?.code || "REQUEST_FAILED";
    error.details = payload?.error?.details;
    throw error;
  }
  return payload?.data;
}

export async function apiRequest(path, options = {}) {
  const auth = getStoredAuth();
  const response = await fetch(path, {
    method: options.method || "GET",
    headers: {
      "content-type": "application/json",
      ...(auth.token ? { authorization: `Bearer ${auth.token}` } : {})
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });
  return parseResponse(response);
}

export function createLoginTicket() {
  return apiRequest("/api/admin/web-login/tickets", {
    method: "POST",
    body: { userAgent: navigator.userAgent }
  });
}

export function pollLoginTicket(ticket) {
  return apiRequest(`/api/admin/web-login/tickets/${ticket.ticketId}?secret=${encodeURIComponent(ticket.ticketSecret)}`);
}

export function listStores(filters) {
  return apiRequest(`/api/admin/stores?${new URLSearchParams(filters)}`);
}

export function saveStore(store) {
  const method = store.id ? "PATCH" : "POST";
  const path = store.id ? `/api/admin/stores/${store.id}` : "/api/admin/stores";
  return apiRequest(path, { method, body: store });
}

export function deleteStore(id) {
  return apiRequest(`/api/admin/stores/${id}`, { method: "DELETE" });
}

export function listScripts(filters) {
  return apiRequest(`/api/admin/scripts?${new URLSearchParams(filters)}`);
}

export function saveScript(script) {
  const method = script.id ? "PATCH" : "POST";
  const path = script.id ? `/api/admin/scripts/${script.id}` : "/api/admin/scripts";
  return apiRequest(path, { method, body: script });
}

export function deleteScript(id) {
  return apiRequest(`/api/admin/scripts/${id}`, { method: "DELETE" });
}
```

- [ ] **Step 5: Add base CSS**

Create `apps/admin-web/src/styles.css` with:

```css
:root {
  color: #17211f;
  background: #f5f7f6;
  font-family: Inter, "PingFang SC", "Microsoft YaHei", system-ui, sans-serif;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  min-width: 320px;
}

button,
input,
textarea,
select {
  font: inherit;
}

button {
  cursor: pointer;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
```

- [ ] **Step 6: Verify scaffold check moves forward**

```bash
node scripts/d12-admin-web-check.js
```

Expected: static check fails on missing `App.vue` or component files, not package/config/API client.

- [ ] **Step 7: Commit admin web scaffold**

```bash
git add apps/admin-web/package.json apps/admin-web/index.html apps/admin-web/vite.config.js apps/admin-web/src/main.js apps/admin-web/src/api.js apps/admin-web/src/styles.css package.json
git commit -m "feat: scaffold admin web app"
```

## Task 6: Build QR Login UI and App Shell

**Files:**
- Create: `apps/admin-web/src/App.vue`
- Create: `apps/admin-web/src/components/LoginPanel.vue`

- [ ] **Step 1: Run check and confirm login UI failure**

```bash
node scripts/d12-admin-web-check.js
```

Expected: FAIL on `apps/admin-web/src/App.vue should exist` or `apps/admin-web/src/components/LoginPanel.vue should exist`.

- [ ] **Step 2: Implement LoginPanel**

Create `apps/admin-web/src/components/LoginPanel.vue`:

```vue
<template>
  <main class="login-page">
    <section class="login-panel">
      <div>
        <p class="eyebrow">剧本迷管理后台</p>
        <h1>微信扫码登录</h1>
        <p class="login-copy">使用小程序管理员账号扫描二维码，在手机上确认后进入后台。</p>
      </div>

      <div class="qr-frame">
        <canvas ref="qrCanvas" width="220" height="220" aria-label="Web 后台登录二维码"></canvas>
      </div>

      <p class="status">{{ statusText }}</p>
      <button class="primary" type="button" :disabled="loading" @click="refreshTicket">
        {{ loading ? "生成中" : "刷新二维码" }}
      </button>
    </section>
  </main>
</template>

<script setup>
import QRCode from "qrcode";
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { createLoginTicket, pollLoginTicket, setStoredAuth } from "../api";

const emit = defineEmits(["authenticated"]);
const qrCanvas = ref(null);
const ticket = ref(null);
const status = ref("loading");
const loading = ref(false);
let pollTimer = 0;

const statusText = computed(() => {
  const labels = {
    loading: "正在生成登录二维码",
    pending: "等待小程序扫码确认",
    approved: "登录成功，正在进入后台",
    consumed: "二维码已使用，请刷新",
    expired: "二维码已过期，请刷新",
    failed: "登录失败，请刷新后重试"
  };
  return labels[status.value] || labels.pending;
});

function stopPolling() {
  if (pollTimer) {
    window.clearInterval(pollTimer);
    pollTimer = 0;
  }
}

async function drawTicketQr(nextTicket) {
  await QRCode.toCanvas(qrCanvas.value, nextTicket.qrText, {
    width: 220,
    margin: 1,
    color: { dark: "#17211f", light: "#ffffff" }
  });
}

async function checkTicket() {
  if (!ticket.value) {
    return;
  }
  try {
    const result = await pollLoginTicket(ticket.value);
    status.value = result.status;
    if (result.status === "approved" && result.token) {
      setStoredAuth(result);
      stopPolling();
      emit("authenticated", result);
    }
    if (["consumed", "expired"].includes(result.status)) {
      stopPolling();
    }
  } catch (error) {
    status.value = "failed";
    stopPolling();
  }
}

async function refreshTicket() {
  loading.value = true;
  status.value = "loading";
  stopPolling();
  try {
    ticket.value = await createLoginTicket();
    await drawTicketQr(ticket.value);
    status.value = "pending";
    pollTimer = window.setInterval(checkTicket, 2000);
  } catch (error) {
    status.value = "failed";
  } finally {
    loading.value = false;
  }
}

onMounted(refreshTicket);
onBeforeUnmount(stopPolling);
</script>
```

- [ ] **Step 3: Implement App shell**

Create `apps/admin-web/src/App.vue`:

```vue
<template>
  <LoginPanel v-if="!auth.token" @authenticated="setAuth" />
  <div v-else class="app-shell">
    <aside class="sidebar">
      <div class="brand">剧本迷管理</div>
      <nav>
        <button class="nav-item active" type="button">资料库</button>
      </nav>
    </aside>
    <section class="workspace">
      <header class="topbar">
        <div>
          <p class="eyebrow">Catalog Admin</p>
          <h1>剧本店与剧本管理</h1>
        </div>
        <div class="user-box">
          <span>{{ auth.user?.open_id || "管理员" }}</span>
          <button type="button" @click="logout">退出</button>
        </div>
      </header>
      <CatalogWorkspace />
    </section>
  </div>
</template>

<script setup>
import { ref } from "vue";
import { clearStoredAuth, getStoredAuth } from "./api";
import CatalogWorkspace from "./components/CatalogWorkspace.vue";
import LoginPanel from "./components/LoginPanel.vue";

const auth = ref(getStoredAuth());

function setAuth(nextAuth) {
  auth.value = nextAuth;
}

function logout() {
  clearStoredAuth();
  auth.value = getStoredAuth();
}
</script>
```

- [ ] **Step 4: Add app-shell CSS**

Append to `apps/admin-web/src/styles.css`:

```css
.login-page,
.app-shell {
  min-height: 100vh;
}

.login-page {
  display: grid;
  place-items: center;
  padding: 32px;
}

.login-panel {
  width: min(420px, 100%);
  display: grid;
  gap: 20px;
  padding: 32px;
  background: #ffffff;
  border: 1px solid #dfe7e4;
  border-radius: 8px;
  box-shadow: 0 18px 48px rgba(23, 33, 31, 0.08);
}

.eyebrow {
  margin: 0 0 8px;
  color: #568077;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0;
}

h1 {
  margin: 0;
  font-size: 26px;
  line-height: 1.2;
}

.login-copy,
.status {
  margin: 0;
  color: #63716d;
  line-height: 1.6;
}

.qr-frame {
  display: grid;
  place-items: center;
  width: 244px;
  height: 244px;
  margin: 0 auto;
  border: 1px solid #dfe7e4;
  border-radius: 8px;
}

.primary,
.nav-item,
.user-box button {
  border: 0;
  border-radius: 6px;
  padding: 10px 14px;
  background: #0b7f6b;
  color: #ffffff;
}

.app-shell {
  display: grid;
  grid-template-columns: 220px 1fr;
}

.sidebar {
  padding: 24px 16px;
  background: #14201e;
  color: #ffffff;
}

.brand {
  margin-bottom: 24px;
  font-weight: 700;
}

.nav-item {
  width: 100%;
  background: rgba(255, 255, 255, 0.12);
  text-align: left;
}

.workspace {
  min-width: 0;
  padding: 24px;
}

.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 20px;
}

.user-box {
  display: flex;
  align-items: center;
  gap: 12px;
  color: #63716d;
}

@media (max-width: 800px) {
  .app-shell {
    grid-template-columns: 1fr;
  }

  .sidebar {
    display: none;
  }

  .topbar {
    align-items: flex-start;
    flex-direction: column;
  }
}
```

- [ ] **Step 5: Verify login UI check moves forward**

```bash
node scripts/d12-admin-web-check.js
```

Expected: login panel assertions pass; static check fails on missing catalog components.

- [ ] **Step 6: Commit login UI**

```bash
git add apps/admin-web/src/App.vue apps/admin-web/src/components/LoginPanel.vue apps/admin-web/src/styles.css
git commit -m "feat: add admin web qr login shell"
```

## Task 7: Build Catalog Workspace, Store CRUD, and Script Role CRUD

**Files:**
- Create: `apps/admin-web/src/components/CatalogWorkspace.vue`
- Create: `apps/admin-web/src/components/StoreDrawer.vue`
- Create: `apps/admin-web/src/components/ScriptDrawer.vue`
- Modify: `apps/admin-web/src/styles.css`

- [ ] **Step 1: Run check and confirm catalog failure**

```bash
node scripts/d12-admin-web-check.js
```

Expected: FAIL on missing `CatalogWorkspace.vue`, `StoreDrawer.vue`, or `ScriptDrawer.vue`.

- [ ] **Step 2: Implement StoreDrawer**

Create `apps/admin-web/src/components/StoreDrawer.vue`:

```vue
<template>
  <aside class="drawer">
    <header class="drawer-head">
      <h2>{{ model.id ? "编辑店家" : "新增店家" }}</h2>
      <button type="button" @click="$emit('close')">关闭</button>
    </header>
    <form class="form-grid" @submit.prevent="submit">
      <label>名称<input v-model.trim="model.name" required /></label>
      <label>城市<input v-model.trim="model.city" required /></label>
      <label>区域<input v-model.trim="model.district" /></label>
      <label>地址<input v-model.trim="model.address" /></label>
      <label>联系备注<textarea v-model.trim="model.contactNote" rows="3"></textarea></label>
      <label>状态<select v-model="model.status"><option value="active">上架</option><option value="inactive">下架</option></select></label>
      <button class="primary" type="submit">保存店家</button>
    </form>
  </aside>
</template>

<script setup>
import { reactive, watch } from "vue";

const props = defineProps({ store: { type: Object, required: true } });
const emit = defineEmits(["save", "close"]);

const model = reactive({});

watch(
  () => props.store,
  (store) => {
    Object.assign(model, {
      id: store.id,
      name: store.name || "",
      city: store.city || "北京",
      district: store.district || "",
      address: store.address || "",
      contactNote: store.contact_note || store.contactNote || "",
      status: store.status || "active"
    });
  },
  { immediate: true }
);

function submit() {
  emit("save", { ...model });
}
</script>
```

- [ ] **Step 3: Implement ScriptDrawer with role CRUD**

Create `apps/admin-web/src/components/ScriptDrawer.vue` with role functions named exactly for the static gate:

```vue
<template>
  <aside class="drawer wide">
    <header class="drawer-head">
      <h2>{{ model.id ? "编辑剧本" : "新增剧本" }}</h2>
      <button type="button" @click="$emit('close')">关闭</button>
    </header>
    <form class="form-grid" @submit.prevent="submit">
      <label>名称<input v-model.trim="model.name" required /></label>
      <label>标签<input v-model.trim="model.typeTagsText" placeholder="情感,沉浸" /></label>
      <label>人数<input v-model.number="model.playerCount" type="number" min="1" /></label>
      <label>状态<select v-model="model.status"><option value="active">上架</option><option value="inactive">下架</option></select></label>
      <label class="full">无剧透简介<textarea v-model.trim="model.summaryNoSpoiler" rows="3"></textarea></label>

      <section class="full role-editor">
        <div class="role-head">
          <h3>角色模板</h3>
          <button type="button" @click="addRole">新增角色</button>
        </div>
        <table>
          <thead>
            <tr><th>角色</th><th>类型</th><th>定位</th><th>性别</th><th>基础价</th><th>调整</th><th>操作</th></tr>
          </thead>
          <tbody>
            <tr v-for="(role, index) in model.defaultSeatTemplate" :key="role.id">
              <td><input v-model.trim="role.name" required /></td>
              <td><select v-model="role.seatType"><option value="normal">普通</option><option value="love_companion">沉浸</option><option value="f4">F4</option><option value="cp">CP</option></select></td>
              <td><input v-model.trim="role.roleName" /></td>
              <td><select v-model="role.roleGender"><option value="unlimited">不限</option><option value="male">男位</option><option value="female">女位</option></select></td>
              <td><input v-model.number="role.basePriceYuan" type="number" min="0" /></td>
              <td><input v-model.number="role.adjustmentYuan" type="number" /></td>
              <td class="row-actions">
                <button type="button" @click="moveRole(index, -1)">上移</button>
                <button type="button" @click="moveRole(index, 1)">下移</button>
                <button type="button" class="danger" @click="removeRole(index)">删除</button>
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      <p v-if="roleCountWarning" class="warning full">角色数与人数不一致，可保存，但建议检查。</p>
      <button class="primary" type="submit">保存剧本</button>
    </form>
  </aside>
</template>

<script setup>
import { computed, reactive, watch } from "vue";

const props = defineProps({ script: { type: Object, required: true } });
const emit = defineEmits(["save", "close"]);
const model = reactive({ defaultSeatTemplate: [] });

function parseJsonArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
}

function toEditorRole(role = {}, index = 0) {
  return {
    id: role.id || `${Date.now()}-${index}`,
    name: role.name || role.roleName || `角色${index + 1}`,
    seatType: role.seatType || role.seat_type || "normal",
    roleName: role.roleName || role.role_name || "",
    roleGender: role.roleGender || role.role_gender || "unlimited",
    basePriceYuan: Math.round(Number(role.basePrice || role.base_price || 0) / 100),
    adjustmentYuan: Math.round(Number(role.adjustment || 0) / 100)
  };
}

function typeTagsText(value) {
  const tags = parseJsonArray(value);
  return tags.join(",");
}

watch(
  () => props.script,
  (script) => {
    Object.assign(model, {
      id: script.id,
      name: script.name || "",
      typeTagsText: Array.isArray(script.typeTags) ? script.typeTags.join(",") : typeTagsText(script.type_tags),
      playerCount: Number(script.player_count || script.playerCount || 6),
      summaryNoSpoiler: script.summary_no_spoiler || script.summaryNoSpoiler || "",
      status: script.status || "active",
      defaultSeatTemplate: parseJsonArray(script.default_seat_template_json || script.defaultSeatTemplate).map(toEditorRole)
    });
  },
  { immediate: true }
);

const roleCountWarning = computed(() => Number(model.playerCount || 0) !== model.defaultSeatTemplate.length);

function addRole() {
  model.defaultSeatTemplate.push(toEditorRole({}, model.defaultSeatTemplate.length));
}

function removeRole(index) {
  model.defaultSeatTemplate.splice(index, 1);
}

function moveRole(index, delta) {
  const nextIndex = index + delta;
  if (nextIndex < 0 || nextIndex >= model.defaultSeatTemplate.length) return;
  const [role] = model.defaultSeatTemplate.splice(index, 1);
  model.defaultSeatTemplate.splice(nextIndex, 0, role);
}

function tagsFromText(value) {
  return String(value || "").split(/[，,]/).map((item) => item.trim()).filter(Boolean);
}

function submit() {
  emit("save", {
    id: model.id,
    name: model.name,
    typeTags: tagsFromText(model.typeTagsText),
    playerCount: Number(model.playerCount || 0),
    summaryNoSpoiler: model.summaryNoSpoiler,
    status: model.status,
    defaultSeatTemplate: model.defaultSeatTemplate.map((role) => ({
      id: role.id,
      name: role.name,
      seatType: role.seatType,
      roleName: role.roleName,
      roleGender: role.roleGender,
      basePrice: Number(role.basePriceYuan || 0) * 100,
      adjustment: Number(role.adjustmentYuan || 0) * 100
    }))
  });
}
</script>
```

- [ ] **Step 4: Implement CatalogWorkspace**

Create `apps/admin-web/src/components/CatalogWorkspace.vue`:

```vue
<template>
  <section class="catalog">
    <div class="tabs">
      <button :class="{ active: tab === 'stores' }" @click="tab = 'stores'">店家</button>
      <button :class="{ active: tab === 'scripts' }" @click="tab = 'scripts'">剧本</button>
    </div>

    <div class="toolbar">
      <input v-model.trim="keyword" placeholder="搜索名称、城市、标签" @keyup.enter="load" />
      <select v-model="status" @change="load">
        <option value="">全部状态</option>
        <option value="active">上架</option>
        <option value="inactive">下架</option>
      </select>
      <button type="button" @click="load">搜索</button>
      <button class="primary" type="button" @click="openCreate">新增{{ tab === "stores" ? "店家" : "剧本" }}</button>
    </div>

    <p v-if="error" class="error">{{ error }}</p>

    <table class="data-table">
      <thead>
        <tr v-if="tab === 'stores'"><th>名称</th><th>城市</th><th>区域</th><th>地址</th><th>状态</th><th>操作</th></tr>
        <tr v-else><th>名称</th><th>标签</th><th>人数</th><th>角色</th><th>状态</th><th>操作</th></tr>
      </thead>
      <tbody>
        <tr v-for="item in items" :key="item.id">
          <template v-if="tab === 'stores'">
            <td>{{ item.name }}</td><td>{{ item.city }}</td><td>{{ item.district || "-" }}</td><td>{{ item.address || "-" }}</td><td>{{ item.status }}</td>
          </template>
          <template v-else>
            <td>{{ item.name }}</td><td>{{ displayTags(item.type_tags) }}</td><td>{{ item.player_count || 0 }}</td><td>{{ roleCount(item.default_seat_template_json) }}</td><td>{{ item.status }}</td>
          </template>
          <td class="row-actions">
            <button type="button" @click="openEdit(item)">编辑</button>
            <button type="button" class="danger" @click="remove(item)">硬删除</button>
          </td>
        </tr>
      </tbody>
    </table>

    <StoreDrawer v-if="drawer === 'store'" :store="selected" @save="saveStoreItem" @close="closeDrawer" />
    <ScriptDrawer v-if="drawer === 'script'" :script="selected" @save="saveScriptItem" @close="closeDrawer" />
  </section>
</template>

<script setup>
import { onMounted, ref, watch } from "vue";
import { deleteScript, deleteStore, listScripts, listStores, saveScript, saveStore } from "../api";
import ScriptDrawer from "./ScriptDrawer.vue";
import StoreDrawer from "./StoreDrawer.vue";

const tab = ref("stores");
const keyword = ref("");
const status = ref("");
const items = ref([]);
const drawer = ref("");
const selected = ref({});
const error = ref("");

function parseJsonArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
}

function displayTags(value) {
  const tags = parseJsonArray(value);
  return tags.length > 0 ? tags.join("、") : "未标注";
}

function roleCount(value) {
  return `${parseJsonArray(value).length} 个`;
}

async function load() {
  error.value = "";
  const filters = { keyword: keyword.value, status: status.value, limit: "100" };
  try {
    items.value = tab.value === "stores" ? await listStores(filters) : await listScripts(filters);
  } catch (err) {
    error.value = err.message;
  }
}

function openCreate() {
  selected.value = {};
  drawer.value = tab.value === "stores" ? "store" : "script";
}

function openEdit(item) {
  selected.value = { ...item };
  drawer.value = tab.value === "stores" ? "store" : "script";
}

function closeDrawer() {
  drawer.value = "";
  selected.value = {};
}

async function saveStoreItem(store) {
  await saveStore(store);
  closeDrawer();
  await load();
}

async function saveScriptItem(script) {
  await saveScript(script);
  closeDrawer();
  await load();
}

async function remove(item) {
  if (!window.confirm(`确认硬删除「${item.name}」？该操作不可恢复。`)) return;
  error.value = "";
  try {
    if (tab.value === "stores") {
      await deleteStore(item.id);
    } else {
      await deleteScript(item.id);
    }
    await load();
  } catch (err) {
    error.value = err.code === "RESOURCE_IN_USE" ? "已有历史车局使用，不能硬删除。" : err.message;
  }
}

watch(tab, load);
onMounted(load);
</script>
```

- [ ] **Step 5: Add catalog CSS**

Append to `apps/admin-web/src/styles.css`:

```css
.catalog {
  display: grid;
  gap: 16px;
}

.tabs,
.toolbar,
.drawer-head,
.role-head,
.row-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.tabs button,
.toolbar button,
.toolbar input,
.toolbar select,
.form-grid input,
.form-grid select,
.form-grid textarea,
.row-actions button,
.drawer-head button,
.role-head button {
  border: 1px solid #d6e1dd;
  border-radius: 6px;
  padding: 9px 10px;
  background: #ffffff;
  color: #17211f;
}

.tabs button.active {
  background: #dff3ee;
  border-color: #91cfc0;
  color: #0b7f6b;
}

.toolbar {
  flex-wrap: wrap;
}

.toolbar input {
  min-width: 240px;
}

.data-table,
.role-editor table {
  width: 100%;
  border-collapse: collapse;
  background: #ffffff;
  border: 1px solid #dfe7e4;
  border-radius: 8px;
  overflow: hidden;
}

th,
td {
  padding: 12px;
  border-bottom: 1px solid #edf2f0;
  text-align: left;
  vertical-align: top;
}

th {
  color: #63716d;
  font-size: 13px;
  font-weight: 700;
}

.danger {
  color: #b42318 !important;
}

.error,
.warning {
  margin: 0;
  padding: 10px 12px;
  border-radius: 6px;
}

.error {
  background: #fff0ed;
  color: #b42318;
}

.warning {
  background: #fff8e5;
  color: #8a5a00;
}

.drawer {
  position: fixed;
  inset: 0 0 0 auto;
  width: min(520px, 100vw);
  padding: 24px;
  overflow: auto;
  background: #ffffff;
  border-left: 1px solid #dfe7e4;
  box-shadow: -24px 0 60px rgba(23, 33, 31, 0.12);
}

.drawer.wide {
  width: min(920px, 100vw);
}

.drawer-head {
  justify-content: space-between;
  margin-bottom: 20px;
}

.drawer h2,
.role-editor h3 {
  margin: 0;
}

.form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}

.form-grid label {
  display: grid;
  gap: 6px;
  color: #63716d;
  font-size: 13px;
  font-weight: 700;
}

.form-grid .full,
.role-editor {
  grid-column: 1 / -1;
}

.role-head {
  justify-content: space-between;
  margin-bottom: 10px;
}
```

- [ ] **Step 6: Verify catalog check passes except Docker if pending**

```bash
node scripts/d12-admin-web-check.js
```

Expected: app and role assertions pass; static check fails only if Docker files or compose service are not yet implemented.

- [ ] **Step 7: Commit catalog UI**

```bash
git add apps/admin-web/src/components/CatalogWorkspace.vue apps/admin-web/src/components/StoreDrawer.vue apps/admin-web/src/components/ScriptDrawer.vue apps/admin-web/src/styles.css
git commit -m "feat: add admin catalog workspace"
```

## Task 8: Add Docker Deployment

**Files:**
- Create: `apps/admin-web/Dockerfile`
- Create: `apps/admin-web/nginx.conf`
- Modify: `docker-compose.prod.example.yml`

- [ ] **Step 1: Run static check and confirm Docker failure**

```bash
node scripts/d12-admin-web-check.js
```

Expected: FAIL on `apps/admin-web/Dockerfile should exist` or `production compose should define admin-web`.

- [ ] **Step 2: Create Dockerfile**

Create `apps/admin-web/Dockerfile`:

```dockerfile
FROM node:24-alpine AS build

WORKDIR /app

COPY package.json package-lock.json* ./
COPY apps/api/package.json apps/api/package.json
COPY apps/miniprogram/package.json apps/miniprogram/package.json
COPY apps/admin-web/package.json apps/admin-web/package.json
COPY packages/talk/package.json packages/talk/package.json
COPY packages/shared/package.json packages/shared/package.json

RUN npm install --workspace apps/admin-web

COPY apps/admin-web apps/admin-web

RUN npm --workspace apps/admin-web run build

FROM nginx:1.27-alpine

COPY apps/admin-web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/admin-web/dist /usr/share/nginx/html

EXPOSE 8080
```

- [ ] **Step 3: Create Nginx config**

Create `apps/admin-web/nginx.conf`:

```nginx
server {
  listen 8080;
  server_name _;

  root /usr/share/nginx/html;
  index index.html;

  location /api/ {
    proxy_pass http://api:3018/api/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }

  location /health {
    proxy_pass http://api:3018/health;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }

  location / {
    try_files $uri $uri/ /index.html;
  }
}
```

- [ ] **Step 4: Add production compose service**

Modify `docker-compose.prod.example.yml` and add:

```yaml
  admin-web:
    image: hkccr.ccs.tencentyun.com/murder/pinche-admin-web:latest
    expose:
      - "8080"
    networks:
      - proxy
      - internal
    labels:
      - traefik.enable=true
      - traefik.docker.network=proxy
      - traefik.http.routers.pinche-admin-web.rule=Host(`admin.pinche.jubenmi.com`)
      - traefik.http.routers.pinche-admin-web.entrypoints=websecure
      - traefik.http.routers.pinche-admin-web.tls=true
      - traefik.http.routers.pinche-admin-web.tls.certresolver=letsencrypt
      - traefik.http.routers.pinche-admin-web.service=pinche-admin-web
      - traefik.http.services.pinche-admin-web.loadbalancer.server.port=8080
    depends_on:
      - api
    restart: unless-stopped
```

- [ ] **Step 5: Verify Docker config**

```bash
node scripts/d12-admin-web-check.js
docker compose -f docker-compose.prod.example.yml config
```

Expected: static check passes; compose renders successfully.

- [ ] **Step 6: Commit Docker deployment**

```bash
git add apps/admin-web/Dockerfile apps/admin-web/nginx.conf docker-compose.prod.example.yml
git commit -m "feat: add admin web docker deployment"
```

## Task 9: Build, Verify, and Final Polish

**Files:**
- Modify if required: `apps/admin-web/**`
- Modify if required: `scripts/d12-admin-web-check.js`
- Modify if required: `scripts/d12-admin-web-smoke.js`

- [ ] **Step 1: Install dependencies if needed**

Run:

```bash
npm install
```

Expected: lockfile includes `apps/admin-web` and `qrcode` dependencies.

- [ ] **Step 2: Run static checks**

```bash
node scripts/d12-admin-web-check.js
npm --workspace apps/api run check
```

Expected: both pass.

- [ ] **Step 3: Build admin Web**

```bash
npm --workspace apps/admin-web run build
```

Expected: Vite build succeeds and writes `apps/admin-web/dist`.

- [ ] **Step 4: Run full project check**

```bash
npm run check
```

Expected: all existing and new static checks pass.

- [ ] **Step 5: Run API smoke with local services**

With MySQL/API running and migrations applied:

```bash
npm run migrate
node scripts/d12-admin-web-smoke.js
```

Expected: login ticket, hard delete, and referenced-delete conflict tests pass.

- [ ] **Step 6: Start local admin Web dev server**

```bash
npm run dev:admin-web
```

Expected: Vite serves the app on `http://localhost:5178`.

- [ ] **Step 7: Browser verify the UI**

Open `http://localhost:5178` in the in-app Browser. Verify:

- QR login page renders without overlapping text.
- Refresh QR button works.
- After manually setting a valid token in localStorage or completing the scan flow, the catalog workspace renders.
- Store and script drawers fit at desktop width.
- Role editor supports add, delete, and gender selection.

- [ ] **Step 8: Commit final polish**

```bash
git add apps/admin-web package.json package-lock.json scripts/d12-admin-web-check.js scripts/d12-admin-web-smoke.js
git commit -m "chore: verify admin web catalog"
```

## Task 10: Add Store-Script Association Visibility

**Files:**
- Create: `apps/api/migrations/0008_store_script_links.sql`
- Modify: `apps/api/src/db/mysql.js`
- Modify: `apps/api/src/modules/core/service.js`
- Modify: `apps/api/src/server.js`
- Modify: `apps/admin-web/src/api.js`
- Modify: `apps/admin-web/src/components/CatalogWorkspace.vue`
- Modify: `apps/admin-web/src/components/StoreDrawer.vue`
- Modify: `apps/miniprogram/src/pages/session/script.vue`
- Modify: `scripts/d12-admin-web-check.js`
- Modify: `scripts/d12-admin-web-smoke.js`

- [x] **Step 1: Extend failing checks**

Update `scripts/d12-admin-web-check.js` so it fails unless:

- `apps/api/migrations/0008_store_script_links.sql` exists and creates `store_scripts`.
- `apps/api/src/db/mysql.js` includes `store_scripts` in readiness tables.
- `apps/api/src/modules/core/service.js` exports `listStoreScripts` and `replaceStoreScripts`.
- `listActiveScripts` supports `storeId` filtering through `store_scripts`.
- `apps/api/src/server.js` exposes `/api/admin/stores/:id/scripts`.
- `apps/admin-web/src/api.js` exports store-script association helpers.
- `StoreDrawer.vue` contains a visible `关联剧本` section and emits `scriptIds`.
- `apps/miniprogram/src/pages/session/script.vue` requests `/api/scripts` with `storeId`.

Run:

```bash
node scripts/d12-admin-web-check.js
```

Expected: FAIL on missing `0008_store_script_links.sql`.

- [x] **Step 2: Add database migration**

Create `store_scripts` with `store_id`, `script_id`, unique `(store_id, script_id)`, indexes for both sides, and foreign keys to `stores` and `scripts`.

- [x] **Step 3: Add backend behavior**

Add service functions:

- `listStoreScripts(storeId)`: returns scripts linked to a store.
- `replaceStoreScripts(storeId, { scriptIds })`: validates IDs, clears current links, inserts the new set.

Update public `listActiveScripts(filters)`:

- Without `storeId`, keep returning all active scripts.
- With `storeId`, return only active scripts linked through `store_scripts`.

Update hard delete:

- Store delete removes `store_scripts` rows for the store after session-reference checks.
- Script delete removes `store_scripts` rows for the script after session-reference checks.

- [x] **Step 4: Add admin Web association UI**

Add API helpers:

- `listStoreScripts(storeId)`
- `saveStoreScripts(storeId, scriptIds)`

In the store drawer, show searchable script checkboxes. Saving a store also saves `scriptIds` via `PUT /api/admin/stores/:id/scripts`.

- [x] **Step 5: Add mini-program store filtering**

Update `apps/miniprogram/src/pages/session/script.vue` so `loadScripts()` includes the selected `storeId` in the query. This makes unassociated scripts invisible after a user has chosen a store.

- [x] **Step 6: Extend smoke coverage**

Update `scripts/d12-admin-web-smoke.js` to:

- Create two stores and multiple scripts.
- Associate store A with script A, and store B with script B.
- Assert `GET /api/scripts?storeId=<storeA>` returns script A and not script B or an unassociated script.
- Replace store A links and assert the old script disappears.
- Hard-delete an unreferenced linked script and assert its association row is gone.

- [x] **Step 7: Verify**

Run:

```bash
node scripts/d12-admin-web-check.js
npm run check
npm --workspace apps/admin-web run build
npm run migrate
node scripts/d12-admin-web-smoke.js
docker compose -f docker-compose.prod.example.yml config
```

Expected: all checks pass; smoke proves store-scoped script visibility and association cleanup.

## Self-Review

- Spec coverage: Tasks 2 and 4 cover WeChat mini-program scan login; Tasks 3 and 7 cover hard-delete CRUD for stores/scripts and role template CRUD; Task 8 covers Docker/Nginx deployment; Task 9 covers baseline verification; Task 10 covers store-scoped script visibility.
- Placeholder scan: this plan contains no unresolved placeholder markers. Every task has concrete file paths, commands, and expected outcomes.
- Type consistency: ticket APIs use `ticketId`, `ticketSecret`, and `qrText` consistently across backend, smoke, and Web frontend. Role template fields use `name`, `seatType`, `roleName`, `roleGender`, `basePrice`, and `adjustment` consistently. Store-script association APIs use `storeId` and `scriptIds` consistently.
