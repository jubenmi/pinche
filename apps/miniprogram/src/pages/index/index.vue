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
      <t-image
        v-if="homeState !== 'calendar'"
        class="home-landscape"
        src="/static/art/ink-home-landscape.jpg"
        mode="widthFix"
      />

      <view v-if="homeState === 'first-session'" class="home-main first-session">
        <view class="home-copy">
          <view class="hero-title">发起第一辆车</view>
          <view class="hero-subtitle">先选店家和剧本，几步就能生成分享卡片。</view>
        </view>

        <view class="home-panel">
          <t-button class="primary-action" @tap="startFirstSession">
            <view class="primary-action-content">
              <t-image class="action-icon create-icon" src="/static/icons/user-plus-white.png" mode="aspectFit" />
              <text class="action-title">开始发车</text>
            </view>
          </t-button>
        </view>

        <view class="quiet-line">之后你的发车、报名和相册都会自动汇总到首页。</view>
        <t-notice-bar
          v-if="homeStatusText"
          class="home-status"
          theme="warning"
          :visible="true"
          :content="homeStatusText"
        />
        <view class="build-version">{{ buildVersion }}</view>
      </view>

      <view v-else-if="homeState === 'loading'" class="home-main">
        <view class="home-copy">
          <view class="hero-title">我的车局</view>
          <view class="hero-subtitle">正在整理你的车局...</view>
        </view>
        <view class="build-version">{{ buildVersion }}</view>
      </view>

      <view v-else-if="homeState === 'error'" class="home-main">
        <view class="home-copy">
          <view class="hero-title">我的车局</view>
          <view class="hero-subtitle">{{ homeStatusText || "车局加载失败，请稍后重试。" }}</view>
        </view>
        <view class="home-panel">
          <t-button class="primary-action" @tap="loadHomeCalendar">
            <view class="primary-action-content">
              <text class="action-title">重试</text>
            </view>
          </t-button>
        </view>
        <view class="build-version">{{ buildVersion }}</view>
      </view>

      <SessionCalendar
        v-else
        title="我的车局"
        :sessions="sessions"
        :signups="signups"
        :loading="isCalendarLoading"
        :refreshing="isRefreshingCalendar"
        :updated-at="lastLoadedAt"
        :status-text="homeStatusText"
        show-create-button
        create-button-label="发车"
        :show-admin-button="isAdmin"
        show-logout-button
        @create="goCreate"
        @admin="goAdmin"
        @logout="logout"
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
  BACKEND_STATUS_CHANGE_EVENT,
  clearAuth,
  dataOf,
  ensureLoggedIn,
  checkBackendHealth,
  goHomeAfterLogout,
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
const homeState = ref("first-session");
const homeStatusText = ref("");
const roles = ref([]);
const sessions = ref([]);
const signups = ref([]);
const loadingSessions = ref(false);
const loadingSignups = ref(false);
const isRefreshingCalendar = ref(false);
const lastLoadedAt = ref(null);
let maintenanceTimer = null;
let authExpiredToastActive = false;

const retryButtonText = computed(() => (backendStatus.checking ? "检查中..." : "重试"));
const isAdmin = computed(() => roles.value.includes("system_admin"));
const isCalendarLoading = computed(() => loadingSessions.value || loadingSignups.value);

function syncBackendStatus(status = getBackendStatus()) {
  Object.assign(backendStatus, status);
  if (backendStatus.maintenance) {
    startMaintenancePolling();
    homeState.value = "first-session";
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
    resetHomeCalendar();
    homeState.value = "first-session";
    return;
  }
  roles.value = auth.roles || [];
  if (!auth.user || !token) {
    resetHomeCalendar();
    homeState.value = "first-session";
    return;
  }
  loadHomeCalendar();
}

async function startFirstSession() {
  const auth = getCurrentUser();
  const token = getToken();
  if (!auth.user || !token) {
    const loggedInAuth = await ensureLoggedIn({
      devCode: "dev-admin-openid",
      content: "登录后开始发车，并同步你的车局日历。"
    });
    if (!loggedInAuth) {
      homeStatusText.value = "登录取消后仍可留在这里。";
      return;
    }
    roles.value = loggedInAuth.roles || [];
    const loaded = await loadHomeCalendar();
    if (!loaded) {
      return;
    }
    if (hasCalendarItems()) {
      homeState.value = "calendar";
      return;
    }
  }
  goCreate();
}

async function loginFromGuestBar() {
  if (backendStatus.maintenance) {
    return;
  }
  const auth = getCurrentUser();
  const token = getToken();
  if (auth.user && token) {
    routeHomeEntry();
    return;
  }

  const loggedInAuth = await ensureLoggedIn({
    devCode: "dev-admin-openid",
    content: "登录后查看你的车局日历。"
  });
  if (!loggedInAuth) {
    homeStatusText.value = "登录取消后仍可留在这里。";
    return;
  }

  roles.value = loggedInAuth.roles || [];
  await loadHomeCalendar();
}

async function loadHomeCalendar() {
  if (backendStatus.maintenance) {
    return false;
  }
  homeState.value = "loading";
  homeStatusText.value = "";
  try {
    await Promise.all([loadMySessions(), loadMySignups()]);
    lastLoadedAt.value = new Date();
    homeState.value = hasCalendarItems() ? "calendar" : "first-session";
    return true;
  } catch (error) {
    if (handleAuthExpired(error)) {
      return false;
    }
    homeStatusText.value = error?.userMessage || "车局加载失败，请稍后重试。";
    homeState.value = "error";
    return false;
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

function hasCalendarItems() {
  const sessionIds = new Set();
  sessions.value.forEach((session) => {
    if (session?.id) {
      sessionIds.add(String(session.id));
    }
  });
  signups.value.forEach((signup) => {
    if (signup?.session_id) {
      sessionIds.add(String(signup.session_id));
    }
  });
  return sessionIds.size > 0;
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
  homeStatusText.value = "";
  lastLoadedAt.value = null;
}

function handleAuthExpired(error = {}) {
  if (error?.statusCode !== 401) {
    return false;
  }
  clearAuth();
  resetHomeCalendar();
  homeState.value = "first-session";
  if (!authExpiredToastActive) {
    authExpiredToastActive = true;
    showToast({
      title: error?.userMessage || "登录已过期，请重新登录。",
      icon: "none"
    });
    setTimeout(() => {
      authExpiredToastActive = false;
    }, 1000);
  }
  return true;
}

function goCreate() {
  clearCreateFlow();
  uni.navigateTo({ url: "/pages/session/create" });
}

function goAdmin() {
  uni.navigateTo({ url: "/pages/admin/catalog" });
}

function logout() {
  clearAuth();
  resetHomeCalendar();
  homeState.value = "first-session";
  goHomeAfterLogout();
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

.home-main {
  position: relative;
  z-index: 1;
  display: flex;
  flex: 1;
  flex-direction: column;
  justify-content: center;
}

.home-landscape {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 0;
  width: 100%;
  opacity: 0.9;
}

.home-copy {
  position: relative;
  z-index: 1;
  padding: 28rpx 6rpx 70rpx;
  text-align: center;
}

.hero-title {
  color: #153f34;
  font-family: "PincheBrand", "Songti SC", "STSong", "PingFang SC", sans-serif;
  font-size: 58rpx;
  font-weight: 600;
  letter-spacing: 0;
}

.hero-subtitle {
  width: 520rpx;
  max-width: 100%;
  margin: 22rpx auto 0;
  color: #6f7b73;
  font-size: 28rpx;
  line-height: 1.65;
}

.home-panel {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  gap: 24rpx;
  width: 420rpx;
  max-width: 100%;
  margin: 0 auto;
}

.primary-action {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 18rpx;
  width: 100%;
  min-height: 92rpx;
  margin: 0;
  padding: 0 34rpx;
  box-sizing: border-box;
  border-radius: 18rpx;
  background: linear-gradient(145deg, #1a5d4d 0%, #2c775f 100%);
  color: #ffffff;
  text-align: center;
  box-shadow: 0 18rpx 42rpx rgba(31, 111, 91, 0.24);
}

.primary-action-content {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 18rpx;
  min-width: 0;
}

.action-icon {
  display: block;
  flex-shrink: 0;
  width: 38rpx;
  height: 38rpx;
}

.create-icon {
  width: 42rpx;
  height: 42rpx;
}

.action-title {
  font-family: "PincheBrand", "Songti SC", "STSong", "PingFang SC", sans-serif;
  font-size: 34rpx;
  font-weight: 600;
  line-height: 1.2;
}

.quiet-line,
.home-status {
  position: relative;
  z-index: 1;
  width: 560rpx;
  max-width: 100%;
  margin: 56rpx auto 0;
  color: #8f968f;
  font-size: 24rpx;
  line-height: 1.55;
  text-align: center;
}

.home-status {
  margin-top: 20rpx;
  color: #7b6d58;
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
