import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = (await readFile(new URL("../src/utils/api.js", import.meta.url), "utf8"))
  .replace(/^import .*;\s*$/gm, "")
  .replace(/^export /gm, "");
function fixture() {
  const requests = [];
  const uploads = [];
  const logins = [];
  const storage = new Map();
  const app = { globalData: { apiBaseUrl: "https://api.example.test" } };
  let authEvents = 0;
  const context = vm.createContext({
    getApp: () => app,
    createSafeFeedback: () => ({}), tdesignFeedback: {},
    contentModerationErrorText: () => "", isContentModerationError: () => false,
    uni: {
      getStorageSync: (key) => storage.get(key),
      setStorageSync: (key, value) => storage.set(key, value),
      removeStorageSync: (key) => storage.delete(key),
      $emit: (name) => { if (name === "pinche-auth-change") authEvents++; },
      request: (options) => requests.push(options),
      uploadFile: (options) => uploads.push(options),
      login: (options) => logins.push(options)
    }
  });
  vm.runInContext(source, context);
  const login = (token = "first", id = 1) => context.setAuth({ token, user: { id }, roles: ["player"] });
  login();
  return { context, requests, uploads, logins, app, login, events: () => authEvents };
}
const response = (statusCode, data = {}) => ({ statusCode, data });

for (const kind of ["request", "uploadBackendFile", "uploadBackendBinaryFile"]) {
  for (const replacement of [false, true]) {
    test(`${kind}: a 401 ${replacement ? "from an old login preserves new auth" : "expires only the current login"}`, async () => {
      const f = fixture();
      const request = f.context[kind]({ url: "/api/test", filePath: "/tmp/fixture.jpg", name: "file", responseField: "url", bodyBytes: new ArrayBuffer(1) });
      const rejected = assert.rejects(request, (error) => error.statusCode === 401);
      if (replacement) f.login("second", 2);
      (f.requests[0] || f.uploads[0]).success(response(401, { ok: false }));
      await rejected;
      assert.equal(f.context.getToken(), replacement ? "second" : "");
      assert.equal(f.context.getCurrentUser().user?.id, replacement ? 2 : undefined);
    });
  }
}

for (const kind of ["uploadBackendFile", "uploadBackendBinaryFile"]) {
  test(`${kind}: unreadable 401 bodies still expire current auth`, async () => {
    const f = fixture();
    const rejected = assert.rejects(f.context[kind]({ url: "/api/test" }), (error) => error.statusCode === 401);
    (f.requests[0] || f.uploads[0]).success(response(401, "<html>Unauthorized</html>"));
    await rejected;
    assert.equal(f.context.getToken(), "");
  });
}

test("anonymous 401 cannot revoke a login established after the request", async () => {
  const f = fixture();
  f.context.clearAuth();
  const rejected = assert.rejects(f.context.request({ url: "/api/test" }), (error) => error.statusCode === 401);
  f.login("second", 2);
  f.requests[0].success(response(401));
  await rejected;
  assert.equal(f.context.getToken(), "second");
});

test("a response from a previous backend cannot clear the current backend's auth", async () => {
  const f = fixture();
  const rejected = assert.rejects(f.context.request({ url: "/api/test" }), (error) => error.statusCode === 401);
  f.app.globalData.apiBaseUrl = "https://other.example.test";
  f.login("first", 2);
  f.requests[0].success(response(401));
  await rejected;
  assert.equal(f.context.getToken(), "first");
  assert.equal(f.context.getCurrentUser().user.id, 2);
});

test("403 preserves auth and concurrent current-token 401 responses expire it only once", async () => {
  const f = fixture();
  const forbidden = assert.rejects(f.context.request({ url: "/api/test" }), (error) => error.statusCode === 403);
  f.requests[0].success(response(403));
  await forbidden;
  assert.equal(f.context.getToken(), "first");
  const before = f.events();
  const first = assert.rejects(f.context.request({ url: "/api/a" }), (error) => error.statusCode === 401);
  const second = assert.rejects(f.context.request({ url: "/api/b" }), (error) => error.statusCode === 401);
  f.requests[1].success(response(401));
  f.requests[2].success(response(401));
  await Promise.all([first, second]);
  assert.equal(f.events() - before, 1);
});

for (const operation of ["refreshCurrentAuth", "updateUserProfile", "updateUserPhoneFromWechatPhoneCode"]) {
  for (const logout of [false, true]) {
    test(`${operation}: late success cannot ${logout ? "restore logged-out auth" : "overwrite a newer login"}`, async () => {
      const f = fixture();
      const pending = f.context[operation]({ nickname: "updated" });
      if (logout) f.context.clearAuth(); else f.login("second", 2);
      f.requests[0].success(response(200, { data: { user: { id: 1, nickname: "old" }, roles: ["organizer"] } }));
      assert.equal(await pending, null);
      assert.equal(f.context.getToken(), logout ? "" : "second");
      assert.equal(f.context.getCurrentUser().user?.id, logout ? undefined : 2);
    });
  }
}
test("refreshCurrentAuth late 401 cannot clear a newer login in its catch handler", async () => {
  const f = fixture();
  const pending = f.context.refreshCurrentAuth();
  f.login("second", 2);
  f.requests[0].success(response(401));
  assert.equal(await pending, null);
  assert.equal(f.context.getToken(), "second");
});

test("request success and profile refresh still update the current login", async () => {
  const f = fixture();
  const pending = f.context.refreshCurrentAuth();
  f.requests[0].success(response(200, { data: { user: { id: 1, nickname: "updated" }, roles: ["organizer"] } }));
  assert.equal((await pending).user.nickname, "updated");
  assert.equal(f.context.getToken(), "first");
});

const settle = () => new Promise(setImmediate);
for (const status of [200, 401]) {
  for (const logout of [false, true]) {
    test(`ensureLoggedIn cannot restart login after ${logout ? "logout" : "replacement login"} and stale ${status}`, async () => {
      const f = fixture();
      const pending = f.context.ensureLoggedIn({ prompt: false, showToast: false });
      if (logout) f.context.clearAuth(); else f.login("second", 2);
      f.requests[0].success(response(status, { data: { user: { id: 1 }, roles: [] } }));
      await settle();
      assert.equal(f.logins.length, 0);
      assert.equal(await pending, null);
      assert.equal(f.context.getToken(), logout ? "" : "second");
    });
  }
}

test("ensureLoggedIn can still renew credentials after its own current-token 401", async () => {
  const f = fixture();
  const pending = f.context.ensureLoggedIn({ prompt: false, showToast: false });
  f.requests[0].success(response(401));
  await settle();
  assert.equal(f.logins.length, 1);
  f.logins[0].success({ code: "fresh-code" });
  await settle();
  f.requests[1].success(response(200, { data: { token: "fresh", user: { id: 1 }, roles: [] } }));
  assert.equal((await pending).token, "fresh");
});

test("a pending WeChat login response cannot restore explicitly logged-out auth", async () => {
  const f = fixture();
  f.context.clearAuth();
  const pending = f.context.loginWithWechat();
  f.logins[0].success({ code: "fresh-code" });
  await settle();
  f.context.clearAuth();
  f.requests[0].success(response(200, { data: { token: "late", user: { id: 1 } } }));
  assert.equal(await pending, null);
  assert.equal(f.context.getToken(), "");
});

test("logout and relogin with the same token still invalidates old requests", async () => {
  const f = fixture();
  const rejected = assert.rejects(f.context.request({ url: "/api/test" }), (error) => error.statusCode === 401);
  f.context.clearAuth();
  f.login("first", 1);
  f.requests[0].success(response(401));
  await rejected;
  assert.equal(f.context.getToken(), "first");
});

test("a late WeChat code callback cannot start a login request after logout", async () => {
  const f = fixture();
  const pending = f.context.loginWithWechat();
  f.context.clearAuth();
  f.logins[0].success({ code: "late-code" });
  assert.equal(await pending, null);
  assert.equal(f.requests.length, 0);
  assert.equal(f.context.getToken(), "");
});
