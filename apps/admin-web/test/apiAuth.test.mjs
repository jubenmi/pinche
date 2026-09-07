import assert from "node:assert/strict";
import test from "node:test";
import * as api from "../src/api.js";
import { deferred, loadScriptSetup } from "./helpers/scriptSetup.mjs";

const expiredEvent = api.AUTH_EXPIRED_EVENT;
const oldAuth = { token: "expired-token", user: { id: 1 }, roles: ["system_admin"] };
const newAuth = { token: "new-token", user: { id: 2 }, roles: ["system_admin"] };

function setup(t, auth = oldAuth) {
  const entries = new Map();
  const storage = {
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => entries.set(key, String(value)),
    removeItem: (key) => entries.delete(key)
  };
  const window = new EventTarget();
  window.location = { origin: "http://localhost", search: "?view=miniapp" };
  t.mock.method(globalThis, "fetch", async () => { throw new Error("Unexpected fetch"); });
  const oldStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
  Object.defineProperty(globalThis, "window", { configurable: true, value: window });
  t.after(() => {
    if (oldStorage) Object.defineProperty(globalThis, "localStorage", oldStorage);
    else delete globalThis.localStorage;
    if (oldWindow) Object.defineProperty(globalThis, "window", oldWindow);
    else delete globalThis.window;
  });
  api.setStoredAuth(auth);
  const events = [];
  window.addEventListener(expiredEvent, (event) => events.push(event));
  return { entries, events, window };
}

function failure(status = 401) {
  return new Response(JSON.stringify({
    ok: false,
    error: { message: "Token expired", code: "TOKEN_EXPIRED", details: { expiredAt: 10 } }
  }), { status });
}

test("same-origin authenticated media 401 expires the current login", async (t) => {
  const { events } = setup(t);
  t.mock.method(globalThis, "fetch", async (_path, options) => {
    assert.equal(options.headers.authorization, "Bearer expired-token");
    return failure();
  });
  await assert.rejects(api.fetchAuthorizedMediaObjectUrl("/api/session-album/media/1/cover"), { status: 401 });
  assert.equal(api.getStoredAuth().token, "");
  assert.equal(events.length, 1);
});

test("a same-origin media redirect to COS does not expire the login", async (t) => {
  const { events } = setup(t);
  t.mock.method(globalThis, "fetch", async () => {
    const response = failure();
    Object.defineProperty(response, "url", { value: "https://bucket.myqcloud.com/media" });
    return response;
  });
  await assert.rejects(api.fetchAuthorizedMediaObjectUrl("/api/session-album/media/1/cover"), { status: 401 });
  assert.deepEqual(api.getStoredAuth(), oldAuth);
  assert.equal(events.length, 0);
});

test("authenticated JSON 401 clears all cached auth and keeps structured error fields", async (t) => {
  const { entries, events } = setup(t);
  t.mock.method(globalThis, "fetch", async (_path, options) => {
    assert.equal(options.headers.authorization, "Bearer expired-token");
    return failure();
  });
  await assert.rejects(api.apiRequest("/api/admin/stores"), {
    message: "Token expired", status: 401, statusCode: 401,
    code: "TOKEN_EXPIRED", details: { expiredAt: 10 }
  });
  assert.deepEqual(api.getStoredAuth(), { token: "", user: null, roles: [] });
  assert.equal(entries.size, 0);
  assert.equal(events.length, 1);
});

test("multipart 401 expires the same cached session", async (t) => {
  const { events } = setup(t);
  t.mock.method(globalThis, "fetch", async (_path, options) => {
    assert.ok(options.body instanceof FormData);
    assert.equal(options.headers.authorization, "Bearer expired-token");
    return failure();
  });
  await assert.rejects(api.uploadSessionAlbumPhotoLocal(1, new Blob(["photo"])), { status: 401 });
  assert.equal(api.getStoredAuth().token, "");
  assert.equal(events.length, 1);
});

test("non-JSON 401 still clears auth and carries HTTP status", async (t) => {
  const { events } = setup(t);
  t.mock.method(globalThis, "fetch", async () => new Response("<html>Unauthorized</html>", { status: 401 }));
  await assert.rejects(api.apiRequest("/api/admin/stores"), {
    status: 401, statusCode: 401, code: "REQUEST_FAILED"
  });
  assert.equal(api.getStoredAuth().token, "");
  assert.equal(events.length, 1);
});

test("401 expires auth before waiting for its response body", async (t) => {
  setup(t);
  const body = deferred();
  const responseRead = deferred();
  t.mock.method(globalThis, "fetch", async () => ({
    status: 401, ok: false,
    text: () => { responseRead.resolve(); return body.promise; }
  }));
  const request = api.apiRequest("/api/admin/stores");
  const rejected = assert.rejects(request, { status: 401 });
  await responseRead.promise;
  const currentToken = api.getStoredAuth().token;
  body.resolve("");
  await rejected;
  assert.equal(currentToken, "");
});

test("403 preserves auth and error fields", async (t) => {
  const { events } = setup(t);
  t.mock.method(globalThis, "fetch", async () => failure(403));
  await assert.rejects(api.apiRequest("/api/admin/stores"), { status: 403 });
  assert.deepEqual(api.getStoredAuth(), oldAuth);
  assert.equal(events.length, 0);
});

test("anonymous 401 cannot remove a login completed while the request was in flight", async (t) => {
  const { events } = setup(t, { token: "" });
  const response = deferred();
  t.mock.method(globalThis, "fetch", (_path, options) => {
    assert.equal(options.headers.authorization, undefined);
    return response.promise;
  });
  const request = api.apiRequest("/api/admin/web-login/tickets/test");
  api.setStoredAuth(newAuth);
  response.resolve(failure());
  await assert.rejects(request, { status: 401 });
  assert.deepEqual(api.getStoredAuth(), newAuth);
  assert.equal(events.length, 0);
});

test("delayed old-token 401 cannot expire a newer login", async (t) => {
  const { events } = setup(t);
  const response = deferred();
  t.mock.method(globalThis, "fetch", () => response.promise);
  const request = api.apiRequest("/api/admin/stores");
  api.setStoredAuth(newAuth);
  response.resolve(failure());
  await assert.rejects(request, { status: 401 });
  assert.deepEqual(api.getStoredAuth(), newAuth);
  assert.equal(events.length, 0);
});

test("concurrent 401 responses expire one session only once", async (t) => {
  const { events } = setup(t);
  t.mock.method(globalThis, "fetch", async () => failure());
  await Promise.all([
    assert.rejects(api.apiRequest("/api/admin/stores"), { status: 401 }),
    assert.rejects(api.apiRequest("/api/admin/scripts"), { status: 401 })
  ]);
  assert.equal(api.getStoredAuth().token, "");
  assert.equal(events.length, 1);
});

test("COS media 401 and 403 retain media-expiry behavior and the logged-in session", async (t) => {
  const { events } = setup(t);
  for (const status of [401, 403]) {
    t.mock.method(globalThis, "fetch", async () => failure(status));
    await assert.rejects(api.fetchAuthorizedMediaObjectUrl("https://images.myqcloud.com/photo"), {
      status, code: "MEDIA_URL_EXPIRED"
    });
  }
  assert.deepEqual(api.getStoredAuth(), oldAuth);
  assert.equal(events.length, 0);
});

test("network failures preserve the logged-in session", async (t) => {
  const { events } = setup(t);
  t.mock.method(globalThis, "fetch", async () => { throw new TypeError("Failed to fetch"); });
  await assert.rejects(api.apiRequest("/api/admin/stores"), /Failed to fetch/);
  assert.deepEqual(api.getStoredAuth(), oldAuth);
  assert.equal(events.length, 0);
});

test("App reacts to expiry by resetting auth/profile state and removes its listener on unmount", async (t) => {
  const { window } = setup(t);
  const app = await loadScriptSetup(new URL("../src/App.vue", import.meta.url), {
    ...api, window, __PINCHE_BUILD_TIME__: "test",
    parseAdminRouteQuery: () => ({ activeView: "miniapp" }),
    writeAdminRoute: () => {},
    formatBeijingDateTime: (value) => value
  }, ["auth", "profileDetailsOpen", "avatarLoadFailed", "activeView", "logout"]);
  await app.mount();
  app.profileDetailsOpen.value = true;
  app.avatarLoadFailed.value = true;
  t.mock.method(globalThis, "fetch", async () => failure());
  await assert.rejects(api.apiRequest("/api/admin/stores"), { status: 401 });
  assert.equal(app.auth.value.token, "");
  assert.equal(app.profileDetailsOpen.value, false);
  assert.equal(app.avatarLoadFailed.value, false);
  assert.equal(app.activeView.value, "miniapp");
  app.unmount();
  app.auth.value = newAuth;
  window.dispatchEvent(new Event(expiredEvent));
  assert.equal(app.auth.value.token, newAuth.token);
});
