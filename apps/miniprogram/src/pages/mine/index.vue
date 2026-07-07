<template>
  <view class="page mine-calendar-page">
    <AuthIdentityBar />
    <FeedbackHost />

    <view v-if="!hasLogin" class="section login-section">
      <view class="title">我的</view>
      <view class="text">{{ statusText }}</view>
      <view class="actions">
        <t-button class="button" @tap="login">微信登录</t-button>
      </view>
    </view>

    <SessionCalendar
      v-else
      title="我的拼车日程"
      :sessions="sessions"
      :signups="signups"
      :loading="isCalendarLoading"
      :refreshing="isRefreshingCalendar"
      :updated-at="lastLoadedAt"
      :status-text="calendarStatusText"
      :show-admin-button="isAdmin"
      show-logout-button
      @admin="goAdmin"
      @logout="logout"
      @refresh="refreshCalendar"
      @auth-expired="handleAuthExpired"
    />
  </view>
</template>

<script setup>
import { computed, onMounted, onUnmounted, ref } from "vue";
import AuthIdentityBar from "../../components/AuthIdentityBar.vue";
import SessionCalendar from "../../components/SessionCalendar.vue";
import FeedbackHost from "../../components/TDesignFeedbackHost.vue";
import {
  AUTH_CHANGE_EVENT,
  clearAuth,
  dataOf,
  ensureLoggedIn,
  goHomeAfterLogout,
  getCurrentUser,
  getToken,
  request
} from "../../utils/api";
import { showToast } from "../../utils/tdesignFeedback";

const statusText = ref("未登录");
const roles = ref([]);
const hasLogin = ref(false);
const sessions = ref([]);
const sessionStatusText = ref("");
const signups = ref([]);
const signupStatusText = ref("");
const loadingSessions = ref(false);
const loadingSignups = ref(false);
const isRefreshingCalendar = ref(false);
const lastLoadedAt = ref(null);
let authExpiredToastActive = false;

const isAdmin = computed(() => roles.value.includes("system_admin"));
const isCalendarLoading = computed(() => loadingSessions.value || loadingSignups.value);
const calendarStatusText = computed(() =>
  [sessionStatusText.value, signupStatusText.value].filter(Boolean).join(" ")
);

hydrateAuth();

onMounted(() => {
  if (typeof uni.$on === "function") {
    uni.$on(AUTH_CHANGE_EVENT, hydrateAuth);
  }
});

onUnmounted(() => {
  if (typeof uni.$off === "function") {
    uni.$off(AUTH_CHANGE_EVENT, hydrateAuth);
  }
});

function hydrateAuth() {
  const auth = getCurrentUser();
  const token = getToken();
  if (auth.user && !token) {
    clearAuth();
    resetLoggedOutState();
    return;
  }
  roles.value = auth.roles || [];
  hasLogin.value = Boolean(auth.user && token);
  statusText.value = auth.user ? loginName(auth.user) : "未登录";
  if (!hasLogin.value) {
    resetLoggedOutState();
    return;
  }
  loadCalendar();
}

async function login() {
  const auth = await ensureLoggedIn({
    devCode: "dev-admin-openid",
    content: "登录后查看你的发车、报名和日程。"
  });
  if (!auth) {
    statusText.value = "登录失败";
    return;
  }
  hydrateAuth();
}

function logout() {
  clearAuth();
  resetLoggedOutState();
  goHomeAfterLogout();
}

function goAdmin() {
  uni.navigateTo({ url: "/pages/admin/catalog" });
}

async function loadCalendar() {
  await Promise.all([loadMySessions(), loadMySignups()]);
  lastLoadedAt.value = new Date();
}

function resetLoggedOutState() {
  roles.value = [];
  hasLogin.value = false;
  statusText.value = "未登录";
  sessions.value = [];
  sessionStatusText.value = "";
  signups.value = [];
  signupStatusText.value = "";
  lastLoadedAt.value = null;
}

function handleAuthExpired(error = {}) {
  clearAuth();
  resetLoggedOutState();
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
}

async function refreshCalendar() {
  if (isRefreshingCalendar.value) {
    return;
  }
  isRefreshingCalendar.value = true;
  try {
    await loadCalendar();
  } finally {
    isRefreshingCalendar.value = false;
  }
}

async function loadMySessions() {
  loadingSessions.value = true;
  sessionStatusText.value = "";
  try {
    const response = await request({ url: "/api/users/me/sessions?limit=50" });
    sessions.value = dataOf(response) || [];
  } catch (error) {
    if (error?.statusCode === 401) {
      handleAuthExpired(error);
      return;
    }
    sessionStatusText.value = "我的发车加载失败，请稍后重试。";
  } finally {
    loadingSessions.value = false;
  }
}

async function loadMySignups() {
  loadingSignups.value = true;
  signupStatusText.value = "";
  try {
    const response = await request({ url: "/api/users/me/signups" });
    signups.value = dataOf(response) || [];
  } catch (error) {
    if (error?.statusCode === 401) {
      handleAuthExpired(error);
      return;
    }
    signupStatusText.value = "我参与的车加载失败，请稍后重试。";
  } finally {
    loadingSignups.value = false;
  }
}

function loginName(user) {
  return profileNameWithGenderSymbol(user?.nickname, user?.gender);
}

function genderSymbol(value) {
  if (value === "male") {
    return "♂";
  }
  if (value === "female") {
    return "♀";
  }
  return "";
}

function profileNameWithGenderSymbol(nickname, value) {
  const name = (nickname || "").trim() || "填写昵称";
  const symbol = genderSymbol(value);
  return symbol ? `${symbol} ${name}` : name;
}
</script>

<style scoped>
.mine-calendar-page {
  padding-bottom: 30rpx;
}

.login-section {
  margin-top: 22rpx;
}
</style>
