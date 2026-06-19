<template>
  <view class="page">
    <AuthIdentityBar />

    <view class="section">
      <view class="title">我的</view>
      <view class="text">{{ statusText }}</view>
      <view v-if="rolesText" class="meta">角色：{{ rolesText }}</view>
      <view class="actions">
        <button class="button" @tap="login">微信登录</button>
        <button v-if="isAdmin" class="button secondary" @tap="goAdmin">管理员</button>
        <button v-if="hasLogin" class="button ghost" @tap="logout">退出</button>
      </view>
    </view>

    <view v-if="hasLogin" class="section profile-section">
      <view class="section-head">
        <view class="section-title">个人信息</view>
        <button class="profile-edit" @tap="openProfileEditor">编辑资料</button>
      </view>
      <view class="profile-row">
        <image class="profile-avatar" :src="profileAvatarSrc" mode="aspectFill" />
        <view class="profile-copy">
          <view class="profile-name">{{ profileName }}</view>
          <view class="profile-meta">性别：{{ genderText }}</view>
        </view>
      </view>
    </view>

    <view v-if="hasLogin" class="section">
      <view class="section-title">我的性别</view>
      <view class="text">当前：{{ genderText }}</view>
      <view class="gender-actions">
        <button
          class="gender-toggle"
          :class="{ active: gender === 'male' }"
          @click="saveGender('male')"
        >
          男
        </button>
        <button
          class="gender-toggle"
          :class="{ active: gender === 'female' }"
          @click="saveGender('female')"
        >
          女
        </button>
      </view>
    </view>

    <view v-if="hasLogin" class="section">
      <view class="section-title">我发起</view>
      <view v-if="sessionStatusText" class="notice">{{ sessionStatusText }}</view>
      <view v-if="sessions.length === 0 && !sessionStatusText" class="empty">还没有发起过车。</view>
      <view v-for="session in sessions" :key="session.id" class="item">
        <view class="item-main">
          <view class="item-title">{{ session.script_name_snapshot }}</view>
          <view class="item-sub">{{ session.store_name_snapshot }} / {{ session.start_at }}</view>
          <view class="item-sub">
            {{ statusLabel(session.status) }} · {{ session.seat_count || 0 }}位 ·
            {{ session.pending_signup_count || 0 }}个待审
          </view>
        </view>
        <view class="item-actions">
          <button class="mini-button" @tap="goManage(session.id)">管理</button>
          <button class="mini-button muted" @tap="goDetail(session.id)">详情</button>
        </view>
      </view>
    </view>

    <view v-if="hasLogin" class="section">
      <view class="section-title">我参与</view>
      <view v-if="signupStatusText" class="notice">{{ signupStatusText }}</view>
      <view v-if="signups.length === 0 && !signupStatusText" class="empty">还没有参与过车。</view>
      <view v-for="signup in signups" :key="signup.id" class="item">
        <view class="item-main">
          <view class="item-title">{{ signup.script_name_snapshot }}</view>
          <view class="item-sub">{{ signup.store_name_snapshot }} / {{ signup.start_at }}</view>
          <view class="item-sub">
            {{ signupStatusLabel(signup.status) }} · {{ signup.seat_name || "座位" }}
            <text v-if="signup.seat_role_name"> · {{ signup.seat_role_name }}</text>
          </view>
        </view>
        <view class="item-actions">
          <button
            v-if="signup.can_review"
            class="mini-button"
            @tap="goReview(signup.session_id)"
          >
            {{ signup.has_review ? "编辑记录" : "写记录" }}
          </button>
          <button class="mini-button muted" @tap="goDetail(signup.session_id)">详情</button>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup>
import { computed, onMounted, onUnmounted, ref } from "vue";
import AuthIdentityBar from "../../components/AuthIdentityBar.vue";
import {
  AUTH_CHANGE_EVENT,
  AUTH_PROFILE_REQUEST_EVENT,
  assetUrl,
  dataOf,
  clearAuth,
  ensureLoggedIn,
  getCurrentUser,
  getToken,
  request,
  updateUserGender,
  userGenderLabel
} from "../../utils/api";

const statusText = ref("未登录");
const roles = ref([]);
const hasLogin = ref(false);
const sessions = ref([]);
const sessionStatusText = ref("");
const signups = ref([]);
const signupStatusText = ref("");
const gender = ref("");
const currentUser = ref(null);

const isAdmin = computed(() => roles.value.includes("system_admin"));
const rolesText = computed(() => roles.value.join(", "));
const genderText = computed(() => userGenderLabel(gender.value));
const profileName = computed(() => loginName(currentUser.value));
const profileAvatarSrc = computed(() => {
  if (currentUser.value?.avatarUrl) {
    return assetUrl(currentUser.value.avatarUrl);
  }
  if (gender.value === "male") {
    return "/static/avatars/default-male.jpg";
  }
  if (gender.value === "female") {
    return "/static/avatars/default-female.jpg";
  }
  return "/static/icons/user.png";
});

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
    roles.value = [];
    hasLogin.value = false;
    gender.value = "";
    currentUser.value = null;
    statusText.value = "未登录";
    sessions.value = [];
    sessionStatusText.value = "";
    signups.value = [];
    signupStatusText.value = "";
    return;
  }
  roles.value = auth.roles || [];
  hasLogin.value = Boolean(auth.user && token);
  currentUser.value = auth.user || null;
  gender.value = auth.user?.gender || "";
  statusText.value = auth.user ? loginName(auth.user) : "未登录";
  if (hasLogin.value) {
    loadMySessions();
    loadMySignups();
  }
}

async function login() {
  const auth = await ensureLoggedIn({
    devCode: "dev-admin-openid",
    content: "登录后查看你的发车、报名和管理入口。",
    promptPhoneAfterLogin: true
  });
  if (!auth) {
    statusText.value = "登录失败";
    return;
  }
  hydrateAuth();
}

function logout() {
  clearAuth();
  roles.value = [];
  hasLogin.value = false;
  gender.value = "";
  currentUser.value = null;
  statusText.value = "未登录";
  sessions.value = [];
  sessionStatusText.value = "";
  signups.value = [];
  signupStatusText.value = "";
}

async function saveGender(nextGender) {
  if (!hasLogin.value || gender.value === nextGender) {
    return;
  }
  try {
    const auth = await updateUserGender(nextGender);
    if (!auth?.user) {
      throw new Error("Missing updated user");
    }
    hydrateAuth();
    uni.showToast({ title: "性别已更新", icon: "none" });
  } catch (error) {
    uni.showToast({ title: "性别保存失败", icon: "none" });
  }
}

async function openProfileEditor() {
  if (!hasLogin.value) {
    await login();
    return;
  }
  if (typeof uni.$emit !== "function") {
    return;
  }
  uni.$emit(AUTH_PROFILE_REQUEST_EVENT, {
    requestId: `mine-profile-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    required: false,
    route: currentPageRoute()
  });
}

function currentPageRoute() {
  if (typeof getCurrentPages !== "function") {
    return "";
  }
  const pages = getCurrentPages();
  return pages.length > 0 ? pages[pages.length - 1].route || "" : "";
}

function goAdmin() {
  uni.navigateTo({ url: "/pages/admin/catalog" });
}

async function loadMySessions() {
  sessionStatusText.value = "正在加载我的发车...";
  try {
    const response = await request({ url: "/api/users/me/sessions?limit=20" });
    sessions.value = dataOf(response) || [];
    sessionStatusText.value = "";
  } catch (error) {
    sessionStatusText.value = "我的发车加载失败，请稍后重试。";
  }
}

async function loadMySignups() {
  signupStatusText.value = "正在加载我参与的车...";
  try {
    const response = await request({ url: "/api/users/me/signups" });
    signups.value = dataOf(response) || [];
    signupStatusText.value = "";
  } catch (error) {
    signupStatusText.value = "我参与的车加载失败，请稍后重试。";
  }
}

function goManage(id) {
  uni.navigateTo({ url: `/pages/session/manage?id=${id}` });
}

function goDetail(id) {
  uni.navigateTo({ url: `/pages/session/detail?id=${id}` });
}

function goReview(id) {
  uni.navigateTo({ url: `/pages/session/review?id=${id}` });
}

function statusLabel(status) {
  const labels = {
    draft: "草稿",
    recruiting: "招募中",
    locked: "已锁车",
    cancelled: "已取消"
  };
  return labels[status] || status || "未知";
}

function signupStatusLabel(status) {
  const labels = {
    pending: "待审核",
    approved: "已上车",
    rejected: "已拒绝",
    cancelled: "已取消"
  };
  return labels[status] || status || "未知";
}

function loginName(user) {
  return user?.nickname || user?.open_id || user?.openid || "已登录";
}
</script>

<style scoped>
.section-title {
  margin-bottom: 18rpx;
  font-size: 30rpx;
  font-weight: 600;
}

.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18rpx;
  margin-bottom: 18rpx;
}

.section-head .section-title {
  margin-bottom: 0;
}

.profile-edit {
  flex: 0 0 140rpx;
  width: 140rpx;
  height: 56rpx;
  margin: 0;
  padding: 0;
  border: 1rpx solid #cbd5e1;
  border-radius: 8rpx;
  background: #ffffff;
  color: #1f7a68;
  font-size: 24rpx;
  font-weight: 600;
  line-height: 56rpx;
}

.profile-row {
  display: flex;
  align-items: center;
  gap: 18rpx;
}

.profile-avatar {
  flex: 0 0 96rpx;
  width: 96rpx;
  height: 96rpx;
  border-radius: 50%;
  border: 2rpx solid rgba(31, 122, 104, 0.18);
  background: #eef7f4;
}

.profile-copy {
  min-width: 0;
}

.profile-name {
  overflow: hidden;
  color: #1f2933;
  font-size: 30rpx;
  font-weight: 700;
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.profile-meta {
  margin-top: 8rpx;
  color: #64748b;
  font-size: 24rpx;
}

.meta {
  margin-top: 12rpx;
  color: #64748b;
  font-size: 24rpx;
}

.button.ghost {
  background: #ffffff;
  color: #455a64;
  border: 1rpx solid #cbd5e1;
}

.gender-actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16rpx;
  margin-top: 22rpx;
}

.gender-toggle {
  height: 72rpx;
  border-radius: 10rpx;
  background: #f8fafc;
  color: #334155;
  font-size: 26rpx;
  line-height: 72rpx;
}

.gender-toggle.active {
  background: #1f7a68;
  color: #ffffff;
  font-weight: 600;
}

.notice,
.empty {
  margin-top: 14rpx;
  padding: 16rpx;
  border-radius: 8rpx;
  background: #eef7f4;
  color: #1f7a68;
  font-size: 24rpx;
  line-height: 1.5;
}

.empty {
  background: #f8fafc;
  color: #64748b;
}

.item {
  display: flex;
  gap: 16rpx;
  align-items: flex-start;
  justify-content: space-between;
  padding: 20rpx 0;
  border-top: 1rpx solid #edf1f5;
}

.item-main {
  flex: 1;
  min-width: 0;
}

.item-title {
  color: #1f2933;
  font-size: 28rpx;
  font-weight: 600;
}

.item-sub {
  margin-top: 6rpx;
  color: #64748b;
  font-size: 24rpx;
  line-height: 1.45;
}

.item-actions {
  display: flex;
  flex-direction: column;
  gap: 10rpx;
  flex-shrink: 0;
}

.mini-button {
  min-width: 108rpx;
  height: 56rpx;
  padding: 0 16rpx;
  border-radius: 8rpx;
  background: #1f7a68;
  color: #ffffff;
  font-size: 24rpx;
  line-height: 56rpx;
}

.mini-button.muted {
  background: #eef2f7;
  color: #334155;
}
</style>
