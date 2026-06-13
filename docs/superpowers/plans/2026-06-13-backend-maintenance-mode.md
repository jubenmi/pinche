# Backend Maintenance Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a global mini program maintenance mode so the frontend can be published before the backend is running.

**Architecture:** Keep the first version inside the existing UniApp frontend. `apps/miniprogram/src/utils/api.js` owns backend health state, maintenance events, request blocking, and deep-page redirects; `apps/miniprogram/src/pages/index/index.vue` owns the visible maintenance screen and recovery polling. Existing release checks are extended with static guards, and D9 release documentation is adjusted to distinguish frontend-first upload gates from backend online gates.

**Tech Stack:** UniApp, Vue 3 `<script setup>`, WeChat mini program `uni.request`, Node.js static check scripts.

---

## Source Of Truth

- Approved design: `docs/superpowers/specs/2026-06-13-backend-maintenance-mode-design.md`
- Current task board: this plan file.
- Pre-existing dirty file to preserve: `specs/d9-mvp-release/tasks.md`

## File Structure

- Modify `apps/miniprogram/src/utils/api.js`
  - Owns backend status state and event broadcast.
  - Adds `/health` checks with short timeout.
  - Blocks ordinary business requests while maintenance mode is active.
  - Marks maintenance mode on network-level request failures and routes users back to the homepage.
- Modify `apps/miniprogram/src/pages/index/index.vue`
  - Renders either maintenance UI or the existing homepage.
  - Starts/stops 5-second recovery polling only while maintenance mode is active.
  - Calls existing `ensureLoggedIn()` only after backend health is available.
- Modify `scripts/check-miniprogram.js`
  - Adds static checks for backend status exports, maintenance copy, retry action, and polling cleanup.
- Create `scripts/check-maintenance-mode.js`
  - Exercises backend status behavior in Node with mocked `uni` and `getApp`.
- Modify `package.json`
  - Wires the maintenance behavior check into `npm run check`.
- Modify `specs/d9-mvp-release/release-checklist.md`
  - Replaces the single upload gate with frontend-first upload gates and backend-online gates.
- Do not modify backend code, migrations, package dependencies, or unrelated pages.

## Task 1: Add Static Checks First

**Files:**
- Modify: `scripts/check-miniprogram.js`
- Read: `apps/miniprogram/src/utils/api.js`
- Read: `apps/miniprogram/src/pages/index/index.vue`

Status: completed.

- [x] **Step 1: Add failing maintenance guards to `scripts/check-miniprogram.js`**

  Add checks after the existing `apiSource` auth guard loop:

  ```js
  for (const requiredBackendStatusText of [
    "BACKEND_STATUS_CHANGE_EVENT",
    "export function getBackendStatus",
    "export function checkBackendHealth",
    "export function markBackendMaintenance",
    "export function clearBackendMaintenance",
    "export function shouldBlockBusinessRequests",
    "allowDuringMaintenance",
    "/health",
    "maintenance: true"
  ]) {
    if (!apiSource.includes(requiredBackendStatusText)) {
      fail(`Backend maintenance status support is missing ${requiredBackendStatusText}`);
    }
  }
  ```

  Add checks after the existing index page first-choice checks:

  ```js
  for (const requiredMaintenanceText of [
    "backendStatus.maintenance",
    "服务正在上线维护中",
    "我们正在准备后端服务，稍后会自动恢复。",
    "retryBackend",
    "startMaintenancePolling",
    "stopMaintenancePolling",
    "BACKEND_STATUS_CHANGE_EVENT",
    "checkBackendHealth"
  ]) {
    if (!indexSource.includes(requiredMaintenanceText)) {
      fail(`Entry page maintenance mode is missing ${requiredMaintenanceText}`);
    }
  }
  if (!/<view v-if="backendStatus\.maintenance" class="maintenance-state">/.test(indexSource)) {
    fail("Entry page must render a dedicated maintenance state before normal homepage content");
  }
  if (!/<view v-else class="home-normal">/.test(indexSource)) {
    fail("Entry page must hide normal homepage content while maintenance mode is active");
  }
  ```

- [x] **Step 2: Run the check and verify it fails**

  Run:

  ```bash
  node scripts/check-miniprogram.js
  ```

  Expected: exits non-zero with a message like `Backend maintenance status support is missing BACKEND_STATUS_CHANGE_EVENT` or `Entry page maintenance mode is missing backendStatus.maintenance`.

## Task 2: Implement Backend Status Logic

**Files:**
- Modify: `apps/miniprogram/src/utils/api.js`
- Test: `scripts/check-miniprogram.js`

Status: completed.

- [x] **Step 1: Add status constants and helpers near the existing auth event constants**

  Add:

  ```js
  export const BACKEND_STATUS_CHANGE_EVENT = "pinche-backend-status-change";

  const BACKEND_HEALTH_TIMEOUT = 3000;
  const MAINTENANCE_USER_MESSAGE = "服务正在上线维护中，请稍后再试。";
  const backendStatus = {
    checking: false,
    available: null,
    maintenance: false,
    lastCheckedAt: "",
    lastErrorMessage: ""
  };
  ```

- [x] **Step 2: Add status copy and event functions**

  Add:

  ```js
  function copyBackendStatus() {
    return { ...backendStatus };
  }

  function notifyBackendStatusChange() {
    if (typeof uni !== "undefined" && typeof uni.$emit === "function") {
      uni.$emit(BACKEND_STATUS_CHANGE_EVENT, copyBackendStatus());
    }
  }

  function friendlyBackendError(error) {
    const message = error?.userMessage || error?.errMsg || error?.message || "";
    if (message.includes("timeout")) {
      return "当前连接超时，服务可能正在上线中。";
    }
    return "当前连接暂不可用。";
  }

  function redirectToMaintenanceHome() {
    if (typeof uni === "undefined" || typeof uni.reLaunch !== "function") {
      return;
    }
    uni.reLaunch({ url: "/pages/index/index?maintenance=1" });
  }
  ```

- [x] **Step 3: Add exported status functions**

  Add:

  ```js
  export function getBackendStatus() {
    return copyBackendStatus();
  }

  export function shouldBlockBusinessRequests() {
    return backendStatus.maintenance === true;
  }

  export function markBackendMaintenance(error = {}) {
    const wasMaintenance = backendStatus.maintenance;
    backendStatus.checking = false;
    backendStatus.available = false;
    backendStatus.maintenance = true;
    backendStatus.lastCheckedAt = new Date().toISOString();
    backendStatus.lastErrorMessage = friendlyBackendError(error);
    notifyBackendStatusChange();
    if (!wasMaintenance) {
      redirectToMaintenanceHome();
    }
    return copyBackendStatus();
  }

  export function clearBackendMaintenance() {
    backendStatus.checking = false;
    backendStatus.available = true;
    backendStatus.maintenance = false;
    backendStatus.lastCheckedAt = new Date().toISOString();
    backendStatus.lastErrorMessage = "";
    notifyBackendStatusChange();
    return copyBackendStatus();
  }
  ```

- [x] **Step 4: Add `/health` request function**

  Add:

  ```js
  export function checkBackendHealth(options = {}) {
    backendStatus.checking = true;
    notifyBackendStatusChange();

    return new Promise((resolve) => {
      uni.request({
        url: getApiBaseUrl() + "/health",
        method: "GET",
        data: {},
        header: {},
        timeout: options.timeout || BACKEND_HEALTH_TIMEOUT,
        success(response) {
          const responseData = response.data || {};
          if (response.statusCode >= 200 && response.statusCode < 300 && responseData.ok === true) {
            resolve(clearBackendMaintenance());
            return;
          }
          resolve(markBackendMaintenance({
            errMsg: `health check failed: ${response.statusCode}`,
            userMessage: "当前连接暂不可用。"
          }));
        },
        fail(error) {
          resolve(markBackendMaintenance(error));
        }
      });
    });
  }
  ```

- [x] **Step 5: Block ordinary requests during maintenance**

  At the start of `request(options)`, before token/header work, add:

  ```js
  if (shouldBlockBusinessRequests() && options.allowDuringMaintenance !== true) {
    return Promise.reject({
      statusCode: 0,
      maintenance: true,
      errMsg: "backend maintenance",
      userMessage: MAINTENANCE_USER_MESSAGE
    });
  }
  ```

- [x] **Step 6: Mark maintenance from request fail**

  In `request(options)` `fail(error)` branch, before `reject(...)`, add:

  ```js
  markBackendMaintenance(error);
  ```

- [x] **Step 7: Run the static check**

  Run:

  ```bash
  node scripts/check-miniprogram.js
  ```

  Expected: status export checks pass; the command still fails on homepage maintenance UI checks until Task 3 is complete.

## Task 3: Implement Homepage Maintenance UI

**Files:**
- Modify: `apps/miniprogram/src/pages/index/index.vue`
- Test: `scripts/check-miniprogram.js`

Status: completed.

- [x] **Step 1: Import backend status helpers**

  Replace the existing API import with:

  ```js
  import {
    BACKEND_STATUS_CHANGE_EVENT,
    checkBackendHealth,
    ensureLoggedIn,
    getBackendStatus
  } from "../../utils/api";
  ```

  Also import lifecycle hooks:

  ```js
  import { onLoad, onShow, onUnload } from "@dcloudio/uni-app";
  import { computed, reactive, ref } from "vue";
  ```

- [x] **Step 2: Add reactive state and lifecycle**

  Add:

  ```js
  const backendStatus = reactive(getBackendStatus());
  const hasStartedLogin = ref(false);
  let maintenanceTimer = null;

  const retryButtonText = computed(() => (backendStatus.checking ? "检查中..." : "重试"));

  function syncBackendStatus(status = getBackendStatus()) {
    Object.assign(backendStatus, status);
    if (backendStatus.maintenance) {
      startMaintenancePolling();
      return;
    }
    stopMaintenancePolling();
    runLoginWhenReady();
  }

  async function refreshBackendStatus() {
    const status = await checkBackendHealth();
    syncBackendStatus(status);
  }

  function runLoginWhenReady() {
    if (backendStatus.maintenance || backendStatus.available !== true || hasStartedLogin.value) {
      return;
    }
    hasStartedLogin.value = true;
    ensureLoggedIn();
  }

  function startMaintenancePolling() {
    if (maintenanceTimer) {
      return;
    }
    maintenanceTimer = setInterval(refreshBackendStatus, 5000);
  }

  function stopMaintenancePolling() {
    if (!maintenanceTimer) {
      return;
    }
    clearInterval(maintenanceTimer);
    maintenanceTimer = null;
  }

  function retryBackend() {
    if (backendStatus.checking) {
      return;
    }
    refreshBackendStatus();
  }
  ```

- [x] **Step 3: Replace the `onLoad` login call**

  Replace:

  ```js
  onLoad(() => {
    ensureLoggedIn();
  });
  ```

  With:

  ```js
  onLoad(() => {
    if (typeof uni.$on === "function") {
      uni.$on(BACKEND_STATUS_CHANGE_EVENT, syncBackendStatus);
    }
    refreshBackendStatus();
  });

  onShow(() => {
    syncBackendStatus();
    if (backendStatus.available !== true) {
      refreshBackendStatus();
    }
  });

  onUnload(() => {
    stopMaintenancePolling();
    if (typeof uni.$off === "function") {
      uni.$off(BACKEND_STATUS_CHANGE_EVENT, syncBackendStatus);
    }
  });
  ```

- [x] **Step 4: Wrap template with maintenance and normal states**

  Inside `<view class="page home-page">`, keep `<AuthIdentityBar />` first, then add:

  ```vue
  <view v-if="backendStatus.maintenance" class="maintenance-state">
    <image class="maintenance-art" src="/static/art/ticket-landscape.png" mode="widthFix" />
    <view class="maintenance-title">服务正在上线维护中</view>
    <view class="maintenance-text">我们正在准备后端服务，稍后会自动恢复。</view>
    <view v-if="backendStatus.lastCheckedAt" class="maintenance-meta">
      最近检查：{{ backendStatus.lastCheckedAt }}
    </view>
    <view v-if="backendStatus.lastErrorMessage" class="maintenance-meta">
      {{ backendStatus.lastErrorMessage }}
    </view>
    <button class="maintenance-retry" :class="{ disabled: backendStatus.checking }" :disabled="backendStatus.checking" @click="retryBackend">
      {{ retryButtonText }}
    </button>
  </view>

  <view v-else class="home-normal">
    <!-- existing landscape, home-main, buttons, quiet line, and build version -->
  </view>
  ```

- [x] **Step 5: Add maintenance styles**

  Add scoped styles:

  ```css
  .home-normal {
    position: relative;
    display: flex;
    flex: 1;
    flex-direction: column;
  }

  .maintenance-state {
    position: relative;
    z-index: 1;
    display: flex;
    flex: 1;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-height: 760rpx;
    padding: 72rpx 24rpx;
    box-sizing: border-box;
    text-align: center;
  }

  .maintenance-art {
    width: 420rpx;
    max-width: 100%;
    margin-bottom: 42rpx;
  }

  .maintenance-title {
    color: #153f34;
    font-size: 42rpx;
    font-weight: 600;
    line-height: 1.3;
  }

  .maintenance-text {
    width: 540rpx;
    max-width: 100%;
    margin-top: 20rpx;
    color: #6f7b73;
    font-size: 28rpx;
    line-height: 1.65;
  }

  .maintenance-meta {
    width: 540rpx;
    max-width: 100%;
    margin-top: 14rpx;
    color: #9aa19b;
    font-size: 22rpx;
    line-height: 1.5;
  }

  .maintenance-retry {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 280rpx;
    height: 82rpx;
    margin-top: 36rpx;
    border-radius: 14rpx;
    background: linear-gradient(145deg, #1a5d4d 0%, #2c775f 100%);
    color: #ffffff;
    font-size: 28rpx;
    font-weight: 600;
    line-height: 1.2;
    box-shadow: 0 16rpx 34rpx rgba(31, 111, 91, 0.2);
  }

  .maintenance-retry.disabled {
    background: #aeb8b1;
    box-shadow: none;
  }
  ```

- [x] **Step 6: Run the static check**

  Run:

  ```bash
  node scripts/check-miniprogram.js
  ```

  Expected: command passes.

## Task 3A: Add Maintenance Behavior Check

**Files:**
- Create: `scripts/check-maintenance-mode.js`
- Modify: `package.json`

Status: completed.

- [x] **Step 1: Add a Node behavior check**

  Create a script that mocks `uni`, `getApp`, and `uni.request`, then imports `apps/miniprogram/src/utils/api.js`.

- [x] **Step 2: Cover maintenance behavior**

  Verify initial backend status, successful `/health`, failed `/health`, maintenance request fast-fail, business request failure, homepage redirect, and status event emission.

- [x] **Step 3: Run the behavior check**

  Run:

  ```bash
  node scripts/check-maintenance-mode.js
  ```

  Expected: `Maintenance mode check passed`.

- [x] **Step 4: Wire the behavior check into `npm run check`**

  Add `node scripts/check-maintenance-mode.js` after `node scripts/check-miniprogram.js` in the root `package.json` check script.

## Task 4: Update Release Gates

**Files:**
- Modify: `specs/d9-mvp-release/release-checklist.md`

Status: completed.

- [x] **Step 1: Replace upload gates**

  Replace `## 上传前门禁` with:

  ```markdown
  ## 小程序先发布上传门禁

  - 微信后台 request 合法域名已配置为生产 HTTPS API 域名。
  - 生产构建已注入真实 HTTPS API 域名。
  - 小程序维护态已通过 `npm run check` 静态检查。
  - `d9:release-check` 输出 `uploadReady: true`。
  - 用户已登录微信开发者工具目标小程序账号。
  - 用户确认可以上传体验版。

  ## 后端上线后门禁

  - 后端线上 `/health` 返回 `ok: true`。
  - 后端线上 `/health/db` 返回 `ok: true`。
  - 生产登录配置 `/health` 中 `wechatMockLogin` 为 `false`。
  - iOS 微信主链路通过。
  - Android 微信主链路通过。
  - 主链路覆盖登录、建车、分享、报名、审核、锁座。
  ```

- [x] **Step 2: Run a targeted grep check**

  Run:

  ```bash
  rg -n "小程序先发布上传门禁|后端上线后门禁|后端线上 /health" specs/d9-mvp-release/release-checklist.md
  ```

  Expected: all three patterns are present.

## Task 5: Final Verification

**Files:**
- Read: all modified files

Status: completed.

- [x] **Step 1: Run the full repository check**

  Run:

  ```bash
  npm run check
  ```

  Expected: exits `0`.

- [x] **Step 2: Build the mini program with a sample production origin**

  Run:

  ```bash
  VITE_API_BASE_URL=https://api.pinche.example npm run build:mp-weixin
  ```

  Expected: `apps/miniprogram/dist/build/mp-weixin/app.js` and `apps/miniprogram/dist/build/mp-weixin/app.json` exist.

- [x] **Step 3: Run release check with a sample production origin**

  Run:

  ```bash
  RELEASE_API_BASE_URL=https://api.pinche.example npm run d9:release-check
  ```

  Expected: exits `0`, JSON contains `"ok": true`, `"uploadReady": true`, and `"placeholderDomain": false`.

- [x] **Step 4: Review worktree**

  Run:

  ```bash
  git status --short
  git diff -- apps/miniprogram/src/utils/api.js apps/miniprogram/src/pages/index/index.vue scripts/check-miniprogram.js specs/d9-mvp-release/release-checklist.md docs/superpowers/plans/2026-06-13-backend-maintenance-mode.md
  ```

  Expected: only planned files plus the pre-existing `specs/d9-mvp-release/tasks.md` dirty file appear.

## Self-Review Against Spec

- Global maintenance mode maps to Tasks 2 and 3.
- Manual retry and automatic polling map to Task 3.
- Business request fast-fail maps to Task 2.
- Homepage business-entry hiding maps to Task 3.
- Frontend-first release gate maps to Task 4.
- Static and full checks map to Tasks 1 and 5.
- No backend changes, no new route, and no deep-link auto-return are included.
