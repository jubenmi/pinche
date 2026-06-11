<template>
  <view class="page">
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
  </view>
</template>

<script setup>
import { computed, ref } from "vue";
import { dataOf, clearAuth, getCurrentUser, request, setAuth } from "../../utils/api";

const statusText = ref("未登录");
const roles = ref([]);
const hasLogin = ref(false);

const isAdmin = computed(() => roles.value.includes("system_admin"));
const rolesText = computed(() => roles.value.join(", "));

hydrateAuth();

function hydrateAuth() {
  const auth = getCurrentUser();
  roles.value = auth.roles || [];
  hasLogin.value = Boolean(auth.user);
  statusText.value = auth.user
    ? `${auth.user.openid || "已登录"}`
    : "未登录";
}

function login() {
  uni.login({
    provider: "weixin",
    success(loginResult) {
      request({
        url: "/api/auth/wechat/login",
        method: "POST",
        data: {
          code: loginResult.code || "dev-admin-openid"
        }
      })
        .then((response) => {
          const data = dataOf(response);
          if (!data) {
            statusText.value = "登录失败";
            return;
          }

          setAuth(data);
          roles.value = data.roles || [];
          hasLogin.value = true;
          statusText.value = data.openid || "已登录";
        })
        .catch(() => {
          statusText.value = "登录失败";
        });
    }
  });
}

function logout() {
  clearAuth();
  roles.value = [];
  hasLogin.value = false;
  statusText.value = "未登录";
}

function goAdmin() {
  uni.navigateTo({ url: "/pages/admin/catalog" });
}
</script>

<style scoped>
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
</style>
