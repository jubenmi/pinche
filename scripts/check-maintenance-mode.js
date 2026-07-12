import assert from "node:assert/strict";

const app = {
  globalData: {
    apiBaseUrl: "https://api.pinche.test",
    token: "",
    user: null,
    roles: []
  }
};
const emitted = [];
const redirects = [];
const requests = [];

let requestHandler = null;

globalThis.getApp = () => app;
globalThis.wx = {
  canIUse: () => false,
  getFileSystemManager: () => ({})
};
globalThis.uni = {
  $emit(event, payload) {
    emitted.push({ event, payload });
  },
  reLaunch(options) {
    redirects.push(options);
  },
  request(options) {
    requests.push(options);
    requestHandler?.(options);
  },
  getStorageSync() {
    return "";
  },
  setStorageSync() {},
  removeStorageSync() {}
};

const api = await import("../apps/miniprogram/src/utils/api.js");

function setRequestHandler(handler) {
  requestHandler = handler;
}

async function assertRejectsMaintenance(promise) {
  try {
    await promise;
  } catch (error) {
    assert.equal(error.maintenance, true);
    return error;
  }
  throw new Error("Expected maintenance rejection");
}

assert.deepEqual(api.getBackendStatus(), {
  checking: false,
  available: null,
  maintenance: false,
  lastCheckedAt: "",
  lastErrorMessage: ""
});

setRequestHandler((options) => {
  assert.equal(options.url, "https://api.pinche.test/health");
  assert.equal(options.timeout, 10000);
  options.success({
    statusCode: 200,
    data: { ok: true }
  });
});
const healthyStatus = await api.checkBackendHealth();
assert.equal(healthyStatus.available, true);
assert.equal(healthyStatus.maintenance, false);

api.markBackendMaintenance({ errMsg: "request:fail timeout" });
const maintenanceStatus = api.getBackendStatus();
assert.equal(maintenanceStatus.available, false);
assert.equal(maintenanceStatus.maintenance, true);
assert.match(maintenanceStatus.lastErrorMessage, /超时/);
assert.equal(redirects.at(-1)?.url, "/pages/index/index?maintenance=1");
await assertRejectsMaintenance(api.request({ url: "/api/sessions" }));

api.clearBackendMaintenance();
setRequestHandler((options) => {
  options.fail({ errMsg: "request:fail" });
});
const failedHealthStatus = await api.checkBackendHealth();
assert.equal(failedHealthStatus.available, false);
assert.equal(failedHealthStatus.maintenance, true);

api.clearBackendMaintenance();
setRequestHandler((options) => {
  assert.equal(options.url, "https://api.pinche.test/api/sessions");
  options.fail({ errMsg: "request:fail" });
});
const businessError = await assertRejectsMaintenance(api.request({ url: "/api/sessions" }));
assert.equal(businessError.userMessage, "网络请求失败，请稍后重试。");
assert.equal(api.getBackendStatus().maintenance, true);
assert.ok(
  emitted.some((entry) => entry.event === api.BACKEND_STATUS_CHANGE_EVENT),
  "backend status changes should be emitted"
);

console.log("Maintenance mode check passed");
