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
      <view class="section-title">我的发车</view>
      <view v-if="sessionStatusText" class="notice">{{ sessionStatusText }}</view>
      <view v-if="sessions.length === 0 && !sessionStatusText" class="empty">还没有创建过车。</view>
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
  </view>
</template>

<script setup>
import { onLoad } from "@dcloudio/uni-app";
import { computed, ref } from "vue";
import AuthIdentityBar from "../../components/AuthIdentityBar.vue";
import {
  dataOf,
  clearAuth,
  ensureLoggedIn,
  getCurrentUser,
  request,
  updateUserGender,
  userGenderLabel
} from "../../utils/api";

const statusText = ref("未登录");
const roles = ref([]);
const hasLogin = ref(false);
const sessions = ref([]);
const sessionStatusText = ref("");
const gender = ref("");

const isAdmin = computed(() => roles.value.includes("system_admin"));
const rolesText = computed(() => roles.value.join(", "));
const genderText = computed(() => userGenderLabel(gender.value));

hydrateAuth();

onLoad(async () => {
  await ensureLoggedIn({
    devCode: "dev-admin-openid",
    content: "登录后查看你的发车、报名和管理入口。"
  });
  hydrateAuth();
});

function hydrateAuth() {
  const auth = getCurrentUser();
  roles.value = auth.roles || [];
  hasLogin.value = Boolean(auth.user);
  gender.value = auth.user?.gender || "";
  statusText.value = auth.user ? loginName(auth.user) : "未登录";
  if (hasLogin.value) {
    loadMySessions();
  }
}

async function login() {
  const auth = await ensureLoggedIn({
    devCode: "dev-admin-openid",
    content: "登录后查看你的发车、报名和管理入口。"
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
  statusText.value = "未登录";
  sessions.value = [];
  sessionStatusText.value = "";
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

function goManage(id) {
  uni.navigateTo({ url: `/pages/session/manage?id=${id}` });
}

function goDetail(id) {
  uni.navigateTo({ url: `/pages/session/detail?id=${id}` });
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

function loginName(user) {
  return user?.open_id || user?.openid || "已登录";
}
</script>

<style scoped>
.section-title {
  margin-bottom: 18rpx;
  font-size: 30rpx;
  font-weight: 600;
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
