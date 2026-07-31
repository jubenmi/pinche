# Admin Web Token Expiry Redirect Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the admin web app clear an expired authenticated session and immediately render its existing login panel when a protected request returns HTTP 401, while preserving 403 and anonymous-request behavior.

**Architecture:** Keep expiry detection in the shared admin request layer, where every JSON and multipart response already passes through `parseResponse`. The request layer records whether the request started with a token, clears stored auth and dispatches a browser event only for authenticated 401 responses, while `App.vue` owns the reactive UI transition by listening for that event.

**Tech Stack:** Vue 3 Composition API, browser `localStorage` and `EventTarget`, Node.js built-in test runner, Vite, repository `d12` contract checks.

---

## File Map

- Create: `apps/admin-web/test/authExpiry.test.mjs` — executable regression tests for authenticated 401, 403, anonymous 401, concurrent 401, error shape, and root-component wiring.
- Modify: `apps/admin-web/src/api.js` — expose the expiry event name, carry request-time token context into response parsing, clear stored auth, and publish expiry.
- Modify: `apps/admin-web/src/App.vue` — subscribe/unsubscribe to expiry and reuse one UI reset function for automatic and manual logout.
- Modify: `apps/admin-web/package.json` — add the auth-expiry test command to the workspace check.
- Modify: `scripts/d12-admin-web-check.js` — preserve a release-gate contract for centralized 401 handling and root-component event wiring.

### Task 1: Add the failing auth-expiry regression tests

**Files:**
- Create: `apps/admin-web/test/authExpiry.test.mjs`
- Modify: `apps/admin-web/package.json`

- [ ] **Step 1: Create the executable test harness**

Create `apps/admin-web/test/authExpiry.test.mjs` with an in-memory storage object, a fresh browser event target per test, and a queued fetch response:

```js
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { readFile } from "node:fs/promises";

import {
  AUTH_EXPIRED_EVENT,
  apiRequest,
  getStoredAuth,
  setStoredAuth
} from "../src/api.js";

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

function errorResponse(status, code, message, details) {
  return new Response(JSON.stringify({
    ok: false,
    error: { code, message, ...(details ? { details } : {}) }
  }), {
    status,
    headers: { "content-type": "application/json" }
  });
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
```

- [ ] **Step 2: Add the authenticated 401 behavior test**

Append a test that proves the current implementation does not clear auth or notify the app:

```js
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
```

- [ ] **Step 3: Add the 403 and anonymous 401 boundary tests**

Append:

```js
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
```

- [ ] **Step 4: Add concurrency and App wiring tests**

Append:

```js
test("concurrent authenticated 401 responses remain idempotent", async () => {
  setStoredAuth({ token: "expired-token", user: { id: 7 }, roles: ["system_admin"] });
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

  assert.deepEqual(results.map((result) => result.status), ["rejected", "rejected"]);
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
```

- [ ] **Step 5: Register the test in the workspace check**

Update `apps/admin-web/package.json`:

```json
{
  "scripts": {
    "check": "npm run test:runtime-config && npm run test:content-security && npm run test:auth-expiry",
    "test:auth-expiry": "node --test test/authExpiry.test.mjs"
  }
}
```

Preserve every existing script; only append the new check and test command.

- [ ] **Step 6: Run the test and verify RED**

Run:

```bash
npm --workspace apps/admin-web run test:auth-expiry
```

Expected: FAIL because `AUTH_EXPIRED_EVENT` is not exported and `App.vue` does not yet subscribe to expiry.

### Task 2: Implement centralized authenticated-401 expiry

**Files:**
- Modify: `apps/admin-web/src/api.js`

- [ ] **Step 1: Export the event name and publish helper**

Add beside the storage keys:

```js
export const AUTH_EXPIRED_EVENT = "pinche-admin-web-auth-expired";
```

Add after `clearStoredAuth()`:

```js
function publishAuthExpired() {
  clearStoredAuth();
  window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
}
```

- [ ] **Step 2: Carry request-time token context through JSON requests**

Change response parsing to:

```js
async function parseResponse(response, { hadToken = false } = {}) {
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  if (!response.ok || payload?.ok === false) {
    if (response.status === 401 && hadToken) {
      publishAuthExpired();
    }
    const error = new Error(payload?.error?.message || `Request failed: ${response.status}`);
    error.status = response.status;
    error.statusCode = response.status;
    error.code = payload?.error?.code || "REQUEST_FAILED";
    error.details = payload?.error?.details;
    throw error;
  }
  return payload?.data;
}
```

In `apiRequest`, keep the request-start auth snapshot and pass it after fetch:

```js
export async function apiRequest(path, options = {}) {
  const auth = getStoredAuth();
  const hadToken = Boolean(auth.token);
  const response = await fetch(path, {
    method: options.method || "GET",
    headers: {
      "content-type": "application/json",
      ...(auth.token ? { authorization: `Bearer ${auth.token}` } : {})
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });
  return parseResponse(response, { hadToken });
}
```

- [ ] **Step 3: Apply the same rule to multipart requests**

Update `apiFormDataRequest`:

```js
async function apiFormDataRequest(path, formData, options = {}) {
  const auth = getStoredAuth();
  const hadToken = Boolean(auth.token);
  const response = await fetch(path, {
    method: options.method || "POST",
    headers: {
      ...(auth.token ? { authorization: `Bearer ${auth.token}` } : {})
    },
    body: formData
  });
  return parseResponse(response, { hadToken });
}
```

Do not change `fetchAuthorizedMediaObjectUrl`; its 401/403 handling represents expiring media authorization and must remain isolated.

- [ ] **Step 4: Run the focused test**

Run:

```bash
npm --workspace apps/admin-web run test:auth-expiry
```

Expected: API behavior tests PASS; the App wiring test still FAILS.

### Task 3: Make the root app return to login

**Files:**
- Modify: `apps/admin-web/src/App.vue`

- [ ] **Step 1: Import lifecycle APIs and the event constant**

Change the imports to:

```js
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import {
  AUTH_EXPIRED_EVENT,
  assetUrl,
  clearStoredAuth,
  getStoredAuth
} from "./api";
```

- [ ] **Step 2: Reuse one reset function for automatic and manual logout**

Replace the current `logout` body and add the expiry handler:

```js
function resetAuthView() {
  auth.value = getStoredAuth();
  avatarLoadFailed.value = false;
  profileDetailsOpen.value = false;
}

function handleAuthExpired() {
  resetAuthView();
}

function logout() {
  clearStoredAuth();
  resetAuthView();
}

onMounted(() => {
  window.addEventListener(AUTH_EXPIRED_EVENT, handleAuthExpired);
});

onBeforeUnmount(() => {
  window.removeEventListener(AUTH_EXPIRED_EVENT, handleAuthExpired);
});
```

- [ ] **Step 3: Run the focused test and verify GREEN**

Run:

```bash
npm --workspace apps/admin-web run test:auth-expiry
```

Expected: all auth-expiry tests PASS with zero failures.

- [ ] **Step 4: Commit the tested behavior**

```bash
git add apps/admin-web/test/authExpiry.test.mjs apps/admin-web/package.json \
  apps/admin-web/src/api.js apps/admin-web/src/App.vue
git commit -m "fix(admin-web): return to login when token expires"
```

### Task 4: Strengthen release checks and verify the build

**Files:**
- Modify: `scripts/d12-admin-web-check.js`

- [ ] **Step 1: Add static release-gate assertions**

After the existing `webApi` assertions, add:

```js
for (const token of [
  "AUTH_EXPIRED_EVENT",
  "response.status === 401 && hadToken",
  "publishAuthExpired()",
  "parseResponse(response, { hadToken })"
]) {
  assert(webApi.includes(token), `admin web API must centralize token expiry: ${token}`);
}
```

After the existing `appShell` assertions, add:

```js
for (const token of [
  "AUTH_EXPIRED_EVENT",
  "window.addEventListener(AUTH_EXPIRED_EVENT",
  "window.removeEventListener(AUTH_EXPIRED_EVENT",
  "resetAuthView"
]) {
  assert(appShell.includes(token), `admin shell must return expired sessions to login: ${token}`);
}
```

- [ ] **Step 2: Run the focused admin checks**

Run:

```bash
npm --workspace apps/admin-web run check
npm run d12:check
npm --workspace apps/admin-web run build
```

Expected: all commands exit 0; auth-expiry tests pass, `d12` reports success, and Vite creates `apps/admin-web/dist`.

- [ ] **Step 3: Run the repository release gate**

Run:

```bash
npm run check
```

Expected: exit 0 with no failing workspace, unit, contract, or build checks.

- [ ] **Step 4: Commit the release-gate update**

```bash
git add scripts/d12-admin-web-check.js
git commit -m "test(admin-web): guard expired-session redirect"
```

### Task 5: Publish through guarded CI and verify production

**Files:**
- No additional source files.

- [ ] **Step 1: Push the verified implementation to develop**

From the isolated feature worktree, merge or fast-forward the verified commits into a clean temporary worktree based on `origin/develop`, then:

```bash
git push origin HEAD:develop
DEVELOP_SHA="$(git rev-parse HEAD)"
gh run list --repo jubenmi/pinche --commit "$DEVELOP_SHA" \
  --json databaseId,workflowName,status,conclusion
for RUN_ID in $(gh run list --repo jubenmi/pinche --commit "$DEVELOP_SHA" \
  --json databaseId,workflowName \
  --jq '.[] | select(.workflowName == "CI" or .workflowName == "Docker Publish") | .databaseId'); do
  gh run watch "$RUN_ID" --repo jubenmi/pinche --exit-status
done
```

Expected: both develop CI and Docker Publish runs succeed.

- [ ] **Step 2: Promote the verified develop commit to main**

Create a clean temporary worktree from `origin/main`, merge the verified develop SHA with `--no-ff`, run `npm run check`, push to main, and watch both branch runs:

```bash
git push origin HEAD:main
MAIN_SHA="$(git rev-parse HEAD)"
for RUN_ID in $(gh run list --repo jubenmi/pinche --commit "$MAIN_SHA" \
  --json databaseId,workflowName \
  --jq '.[] | select(.workflowName == "CI" or .workflowName == "Docker Publish") | .databaseId'); do
  gh run watch "$RUN_ID" --repo jubenmi/pinche --exit-status
done
```

Expected: local check, main CI, and main Docker Publish all succeed.

- [ ] **Step 3: Promote main to publish**

Create a clean temporary worktree from `origin/publish`, merge the verified main SHA with `--no-ff`, run `npm run check`, push to publish, and watch both publish runs:

```bash
git push origin HEAD:publish
PUBLISH_SHA="$(git rev-parse HEAD)"
for RUN_ID in $(gh run list --repo jubenmi/pinche --commit "$PUBLISH_SHA" \
  --json databaseId,workflowName \
  --jq '.[] | select(.workflowName == "CI" or .workflowName == "Docker Publish") | .databaseId'); do
  gh run watch "$RUN_ID" --repo jubenmi/pinche --exit-status
done
```

Expected: local check, publish CI, and publish Docker Publish all succeed.

- [ ] **Step 4: Deploy only the new admin-web image**

Obtain the immutable admin-web digest from the successful publish Docker run, update only the `admin-web` image reference in the Portainer `pinche` stack, keep API, workers, migration, networks, environment variables, labels, and Traefik unchanged, and confirm only `pinche-admin-web-1` receives a new container ID and creation time.

- [ ] **Step 5: Verify the live expired-token behavior**

Verify:

```bash
curl -sS -o /tmp/pinche-admin-health.json -w '%{http_code} %{content_type}\n' \
  https://admin.pinche.jubenmi.com/health
```

Expected: `200 application/json`.

In the browser, load the admin app with an expired stored token and confirm:

- the business workspace does not remain visible;
- `Token expired` is not rendered;
- the existing login panel is visible;
- the expired token, user, and roles are absent from local storage;
- the browser console has no application errors.

Then log in normally and confirm the catalog and mini-app home load without red error banners.
