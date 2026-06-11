<template>
  <view class="page">
    <view class="section">
      <view class="title">我的</view>
      <view class="text">{{ statusText }}</view>
      <view class="actions">
        <button class="button" @tap="login">微信登录</button>
        <button class="button secondary" @tap="goAdmin">管理员</button>
      </view>
    </view>
  </view>
</template>

<script setup>
import { ref } from "vue";
import { request, setToken } from "../../utils/api";

const statusText = ref("未登录");

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
          const data = response.data && response.data.data;
          if (!data) {
            statusText.value = "登录失败";
            return;
          }

          setToken(data.token);
          statusText.value = data.openid + " / " + data.roles.join(", ");
        })
        .catch(() => {
          statusText.value = "登录失败";
        });
    }
  });
}

function goAdmin() {
  uni.navigateTo({ url: "/pages/admin/catalog" });
}
</script>
