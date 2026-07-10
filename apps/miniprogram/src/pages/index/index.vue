<template>
  <view class="page home-page">
    <AuthIdentityBar passive-guest @guest-login="loginFromGuestBar" />
    <FeedbackHost />

    <view v-if="backendStatus.maintenance" class="maintenance-state">
      <t-image class="maintenance-art" src="/static/art/maintenance-landscape.jpg" mode="widthFix" />
      <view class="maintenance-title">服务正在上线维护中</view>
      <view class="maintenance-text">我们正在准备后端服务，稍后会自动恢复。</view>
      <view v-if="backendStatus.lastCheckedAt" class="maintenance-meta">
        最近检查：{{ backendStatus.lastCheckedAt }}
      </view>
      <view v-if="backendStatus.lastErrorMessage" class="maintenance-meta">
        {{ backendStatus.lastErrorMessage }}
      </view>
      <view class="build-version">{{ buildVersion }}</view>
      <t-button
        class="maintenance-retry"
        :class="{ disabled: backendStatus.checking }"
        :disabled="backendStatus.checking"
        @tap="retryBackend"
      >
        {{ retryButtonText }}
      </t-button>
    </view>

    <view v-else class="home-normal">
      <SessionCalendar
        :sessions="sessions"
        :signups="signups"
        :guest-sessions="guestSessions"
        :calendar-mode="calendarMode"
        :loading="isCalendarLoading"
        :refreshing="isRefreshingCalendar"
        :status-text="homeStatusText"
        show-create-button
        :create-button-label="createButtonLabel"
        :show-admin-button="showAdminAction"
        @create="handleCreateAction"
        @admin="handleAdminAction"
        @identity-required="loginFromIdentityAction"
        @refresh="refreshCalendar"
        @auth-expired="handleAuthExpired"
      />
    </view>
  </view>
</template>

<script setup>
import { onLoad, onShareAppMessage, onShareTimeline, onShow, onUnload } from "@dcloudio/uni-app";
import { computed, reactive, ref } from "vue";
import AuthIdentityBar from "../../components/AuthIdentityBar.vue";
import SessionCalendar from "../../components/SessionCalendar.vue";
import FeedbackHost from "../../components/TDesignFeedbackHost.vue";
import {
  AUTH_CHANGE_EVENT,
  BACKEND_STATUS_CHANGE_EVENT,
  clearAuth,
  dataOf,
  ensureLoggedIn,
  checkBackendHealth,
  getBackendStatus,
  getCurrentUser,
  getToken,
  request
} from "../../utils/api";
import { clearCreateFlow } from "../../utils/createFlow";
import { showWechatShareMenus } from "../../utils/share";
import { showToast } from "../../utils/tdesignFeedback";

const buildVersion = `版本 ${__PINCHE_BUILD_TIME__}`;
const HOME_SHARE_FRIEND_TITLE = "剧本迷·拼车";
const HOME_SHARE_TIMELINE_TITLE = "剧本迷·拼车，一起玩好本";
const HOME_SHARE_PATH = "/pages/index/index";
const HOME_SHARE_IMAGE = "/static/art/ink-home-landscape.jpg";
const backendStatus = reactive(getBackendStatus());
const homeStatusText = ref("");
const roles = ref([]);
const sessions = ref([]);
const signups = ref([]);
const guestSessions = ref([]);
const isAuthenticated = ref(false);
const loadingSessions = ref(false);
const loadingSignups = ref(false);
const loadingGuestSessions = ref(false);
const isRefreshingCalendar = ref(false);
const lastLoadedAt = ref(null);
let maintenanceTimer = null;
let authExpiredToastActive = false;

const retryButtonText = computed(() => (backendStatus.checking ? "检查中..." : "重试"));
const isAdmin = computed(() => roles.value.includes("system_admin"));
const calendarMode = computed(() => (isAuthenticated.value ? "member" : "guest"));
const createButtonLabel = computed(() =>
  isAuthenticated.value ? "我的车局（点击创建）" : "我的车局（点击登录）"
);
const showAdminAction = computed(() => isAdmin.value);
const isCalendarLoading = computed(() =>
  isAuthenticated.value
    ? loadingSessions.value || loadingSignups.value
    : loadingGuestSessions.value
);

function syncBackendStatus(status = getBackendStatus()) {
  Object.assign(backendStatus, status);
  if (backendStatus.maintenance) {
    startMaintenancePolling();
    return;
  }
  stopMaintenancePolling();
}

async function refreshBackendStatus() {
  const status = await checkBackendHealth();
  syncBackendStatus(status);
  if (!status.maintenance) {
    routeHomeEntry();
  }
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

function showHomeShareMenus() {
  showWechatShareMenus({
    withShareTicket: true,
    menus: ["shareAppMessage", "shareTimeline"]
  });
}

onLoad(() => {
  showHomeShareMenus();
  if (typeof uni.$on === "function") {
    uni.$on(BACKEND_STATUS_CHANGE_EVENT, syncBackendStatus);
    uni.$on(AUTH_CHANGE_EVENT, routeHomeEntry);
  }
  refreshBackendStatus();
});

onShow(() => {
  showHomeShareMenus();
  syncBackendStatus();
  if (backendStatus.available !== true) {
    refreshBackendStatus();
    return;
  }
  routeHomeEntry();
});

onUnload(() => {
  stopMaintenancePolling();
  if (typeof uni.$off === "function") {
    uni.$off(BACKEND_STATUS_CHANGE_EVENT, syncBackendStatus);
    uni.$off(AUTH_CHANGE_EVENT, routeHomeEntry);
  }
});

function routeHomeEntry() {
  if (backendStatus.maintenance) {
    return;
  }
  const auth = getCurrentUser();
  const token = getToken();
  if (auth.user && !token) {
    clearAuth();
  }
  const currentAuth = getCurrentUser();
  const currentToken = getToken();
  isAuthenticated.value = Boolean(currentAuth.user && currentToken);
  roles.value = isAuthenticated.value ? currentAuth.roles || [] : [];
  if (isAuthenticated.value) {
    guestSessions.value = [];
  } else {
    sessions.value = [];
    signups.value = [];
  }
  void loadHomeCalendar();
}

async function loginFromGuestBar() {
  await loginFromIdentityAction("登录后查看你的车局日历。");
}

async function loginFromIdentityAction(content = "登录后继续使用此功能。") {
  if (backendStatus.maintenance) {
    return null;
  }
  const auth = getCurrentUser();
  const token = getToken();
  if (auth.user && token) {
    routeHomeEntry();
    return auth;
  }

  const loggedInAuth = await ensureLoggedIn({
    devCode: "dev-admin-openid",
    content
  });
  if (!loggedInAuth) {
    homeStatusText.value = "登录取消后仍可继续浏览。";
    return null;
  }

  isAuthenticated.value = true;
  roles.value = loggedInAuth.roles || [];
  await loadHomeCalendar();
  return loggedInAuth;
}

async function handleCreateAction() {
  if (!isAuthenticated.value) {
    await loginFromIdentityAction("登录后可创建车局。");
    return;
  }
  goCreate();
}

async function handleAdminAction() {
  if (!isAuthenticated.value) {
    await loginFromIdentityAction("登录后可进入车包。");
    return;
  }
  if (isAdmin.value) {
    goAdmin();
  }
}

async function loadHomeCalendar() {
  if (backendStatus.maintenance) {
    return false;
  }
  homeStatusText.value = "";
  try {
    if (isAuthenticated.value) {
      await Promise.all([loadMySessions(), loadMySignups()]);
    } else {
      await loadGuestSessions();
    }
    lastLoadedAt.value = new Date();
    return true;
  } catch (error) {
    if (handleAuthExpired(error)) {
      return false;
    }
    homeStatusText.value =
      error?.userMessage ||
      (isAuthenticated.value
        ? "车局加载失败，请稍后重试。"
        : "近期车局加载失败，请稍后重试。");
    return false;
  }
}

async function loadGuestSessions() {
  loadingGuestSessions.value = true;
  try {
    const response = await request({ url: "/api/sessions/public/upcoming?limit=20" });
    const payload = dataOf(response) || {};
    guestSessions.value = Array.isArray(payload.sessions) ? payload.sessions : [];
  } finally {
    loadingGuestSessions.value = false;
  }
}

async function loadMySessions() {
  loadingSessions.value = true;
  try {
    const response = await request({ url: "/api/users/me/sessions?limit=50" });
    sessions.value = dataOf(response) || [];
  } finally {
    loadingSessions.value = false;
  }
}

async function loadMySignups() {
  loadingSignups.value = true;
  try {
    const response = await request({ url: "/api/users/me/signups" });
    signups.value = dataOf(response) || [];
  } finally {
    loadingSignups.value = false;
  }
}

async function refreshCalendar() {
  if (isRefreshingCalendar.value) {
    return;
  }
  isRefreshingCalendar.value = true;
  try {
    await loadHomeCalendar();
  } finally {
    isRefreshingCalendar.value = false;
  }
}

function resetHomeCalendar() {
  roles.value = [];
  sessions.value = [];
  signups.value = [];
  guestSessions.value = [];
  homeStatusText.value = "";
  lastLoadedAt.value = null;
}

function handleAuthExpired(error = {}) {
  if (error?.statusCode !== 401) {
    return false;
  }
  clearAuth();
  resetHomeCalendar();
  isAuthenticated.value = false;
  if (!authExpiredToastActive) {
    authExpiredToastActive = true;
    showToast({
      title: error?.userMessage || "登录已过期，可继续游客浏览。",
      icon: "none"
    });
    setTimeout(() => {
      authExpiredToastActive = false;
    }, 1000);
  }
  void loadHomeCalendar();
  return true;
}

function goCreate() {
  clearCreateFlow();
  uni.navigateTo({ url: "/pages/session/create" });
}

function goAdmin() {
  uni.navigateTo({ url: "/pages/admin/catalog" });
}

onShareAppMessage(() => ({
  title: HOME_SHARE_FRIEND_TITLE,
  path: HOME_SHARE_PATH,
  imageUrl: HOME_SHARE_IMAGE
}));

onShareTimeline(() => ({
  title: HOME_SHARE_TIMELINE_TITLE,
  query: "",
  imageUrl: HOME_SHARE_IMAGE
}));
</script>

<style scoped>
.home-page {
  position: relative;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  padding-top: 16rpx;
  padding-bottom: 72rpx;
}

.home-normal {
  position: relative;
  display: flex;
  flex: 1;
  flex-direction: column;
}

.build-version {
  position: relative;
  z-index: 1;
  margin-top: 16rpx;
  color: #a6aaa4;
  font-size: 20rpx;
  line-height: 1.4;
  text-align: center;
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
  width: 560rpx;
  max-width: 92%;
  margin-bottom: 40rpx;
  opacity: 0.96;
}

.maintenance-title {
  color: #183d34;
  font-size: 34rpx;
  font-weight: 700;
  line-height: 1.35;
}

.maintenance-text {
  width: 560rpx;
  max-width: 92%;
  margin-top: 18rpx;
  color: #6f7b73;
  font-size: 26rpx;
  line-height: 1.6;
}

.maintenance-meta {
  width: 560rpx;
  max-width: 92%;
  margin-top: 14rpx;
  color: #9aa19a;
  font-size: 22rpx;
  line-height: 1.45;
  word-break: break-all;
}

.maintenance-retry {
  width: 260rpx;
  height: 72rpx;
  margin-top: 28rpx;
  border-radius: 14rpx;
  background: #1d5d4e;
  color: #ffffff;
  font-size: 26rpx;
  line-height: 72rpx;
}

.maintenance-retry.disabled {
  background: #9da9a2;
}
</style>
