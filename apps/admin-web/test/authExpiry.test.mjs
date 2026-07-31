import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { after, afterEach, beforeEach, test } from "node:test";

const apiFixtureDir = await mkdtemp(join(tmpdir(), "pinche-admin-auth-expiry-"));
const apiSource = (await readFile(new URL("../src/api.js", import.meta.url), "utf8"))
  .replace('from "./albumMedia";', 'from "./albumMedia.mjs";')
  .replace('from "./contentModeration";', 'from "./contentModeration.mjs";')
  .replace('from "./contentSecurity";', 'from "./contentSecurity.mjs";');
await Promise.all([
  writeFile(join(apiFixtureDir, "api.mjs"), apiSource),
  writeFile(
    join(apiFixtureDir, "albumMedia.mjs"),
    "export function shouldAttachAdminAuthorization() { return false; }\n"
  ),
  writeFile(
    join(apiFixtureDir, "contentModeration.mjs"),
    "export function buildModerationListFilters() { return {}; }\n"
  ),
  writeFile(
    join(apiFixtureDir, "contentSecurity.mjs"),
    "export function createContentSecuritySettingsClient() { return {}; }\n"
  )
]);
const api = await import(pathToFileURL(join(apiFixtureDir, "api.mjs")));

const {
  apiRequest,
  getStoredAuth,
  setStoredAuth
} = api;
const AUTH_EXPIRED_EVENT =
  api.AUTH_EXPIRED_EVENT || "__missing_pinche_admin_web_auth_expired_event__";

class MemoryStorage {
  #values = new Map();

  getItem(key) {
    return this.#values.has(key) ? this.#values.get(key) : null;
  }

  setItem(key, value) {
    this.#values.set(key, String(value));
  }

  removeItem(key) {
    this.#values.delete(key);
  }
}

const originalFetch = globalThis.fetch;
const originalLocalStorage = globalThis.localStorage;
const originalWindow = globalThis.window;

after(async () => {
  await rm(apiFixtureDir, { recursive: true, force: true });
});

function errorResponse(status, code, message, details) {
  return new Response(
    JSON.stringify({
      ok: false,
      error: { code, message, ...(details ? { details } : {}) }
    }),
    {
      status,
      headers: { "content-type": "application/json" }
    }
  );
}

beforeEach(() => {
  globalThis.localStorage = new MemoryStorage();
  globalThis.window = new EventTarget();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  globalThis.localStorage = originalLocalStorage;
  globalThis.window = originalWindow;
});

test("admin API exposes one stable auth-expiry event", () => {
  assert.equal(api.AUTH_EXPIRED_EVENT, "pinche-admin-web-auth-expired");
});

test("authenticated 401 clears stored auth and publishes expiry", async () => {
  setStoredAuth({
    token: "expired-token",
    user: { id: 7, nickname: "管理员" },
    roles: ["system_admin"]
  });
  let expiryEvents = 0;
  window.addEventListener(AUTH_EXPIRED_EVENT, () => {
    expiryEvents += 1;
  });
  globalThis.fetch = async () =>
    errorResponse(401, "UNAUTHORIZED", "Token expired", { reason: "expired" });

  await assert.rejects(
    apiRequest("/api/admin/stores"),
    (error) =>
      error.status === 401 &&
      error.statusCode === 401 &&
      error.code === "UNAUTHORIZED" &&
      error.message === "Token expired" &&
      error.details.reason === "expired"
  );

  assert.deepEqual(getStoredAuth(), { token: "", user: null, roles: [] });
  assert.equal(expiryEvents, 1);
});

test("authenticated 403 preserves the session and does not publish expiry", async () => {
  const auth = {
    token: "valid-token",
    user: { id: 7 },
    roles: ["organizer"]
  };
  setStoredAuth(auth);
  let expiryEvents = 0;
  window.addEventListener(AUTH_EXPIRED_EVENT, () => {
    expiryEvents += 1;
  });
  globalThis.fetch = async () =>
    errorResponse(403, "FORBIDDEN", "Insufficient permissions");

  await assert.rejects(apiRequest("/api/admin/stores"), {
    status: 403,
    code: "FORBIDDEN"
  });
  assert.deepEqual(getStoredAuth(), auth);
  assert.equal(expiryEvents, 0);
});

test("anonymous 401 does not publish a global expiry", async () => {
  let expiryEvents = 0;
  window.addEventListener(AUTH_EXPIRED_EVENT, () => {
    expiryEvents += 1;
  });
  globalThis.fetch = async () =>
    errorResponse(401, "UNAUTHORIZED", "Authentication required");

  await assert.rejects(apiRequest("/api/admin/web-login/tickets/missing"), {
    status: 401,
    code: "UNAUTHORIZED"
  });
  assert.deepEqual(getStoredAuth(), { token: "", user: null, roles: [] });
  assert.equal(expiryEvents, 0);
});

test("concurrent authenticated 401 responses remain idempotent", async () => {
  setStoredAuth({
    token: "expired-token",
    user: { id: 7 },
    roles: ["system_admin"]
  });
  let expiryEvents = 0;
  window.addEventListener(AUTH_EXPIRED_EVENT, () => {
    expiryEvents += 1;
  });
  globalThis.fetch = async () =>
    errorResponse(401, "UNAUTHORIZED", "Token expired");

  const results = await Promise.allSettled([
    apiRequest("/api/admin/stores"),
    apiRequest("/api/admin/scripts")
  ]);

  assert.deepEqual(
    results.map((result) => result.status),
    ["rejected", "rejected"]
  );
  assert.deepEqual(getStoredAuth(), { token: "", user: null, roles: [] });
  assert.equal(expiryEvents, 2);
});

test("root app listens for expiry and returns to the existing login panel", async () => {
  const app = await readFile(new URL("../src/App.vue", import.meta.url), "utf8");

  assert.match(app, /onMounted/);
  assert.match(app, /onBeforeUnmount/);
  assert.match(app, /AUTH_EXPIRED_EVENT/);
  assert.match(app, /addEventListener\(AUTH_EXPIRED_EVENT/);
  assert.match(app, /removeEventListener\(AUTH_EXPIRED_EVENT/);
  assert.match(app, /function resetAuthView/);
  assert.match(app, /<LoginPanel v-if="!auth\.token"/);
});
