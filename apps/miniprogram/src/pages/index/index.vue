<template>
  <view class="page home-page">
    <AuthIdentityBar />
    <image class="home-landscape" src="/static/art/ink-home-landscape.png" mode="widthFix" />

    <view class="home-main">
      <view class="home-copy">
        <view class="hero-title">剧本迷·拼车</view>
        <view class="hero-subtitle">一起玩好本 · 轻松出发</view>
      </view>

      <view class="home-panel">
        <button class="primary-action" @click="goCreate">
          <image class="action-icon create-icon" src="/static/icons/user-plus-white.png" mode="aspectFit" />
          <text class="action-title">创建</text>
        </button>
        <button class="secondary-action" @click="goMine">
          <image class="action-icon" src="/static/icons/user.png" mode="aspectFit" />
          <text class="action-title">我的</text>
        </button>
      </view>

      <view class="quiet-line">简单五步，快速创建并分享你的剧本局</view>
      <view class="build-version">{{ buildVersion }}</view>
    </view>
  </view>
</template>

<script setup>
import { onLoad } from "@dcloudio/uni-app";
import AuthIdentityBar from "../../components/AuthIdentityBar.vue";
import { ensureLoggedIn } from "../../utils/api";
import { clearCreateFlow } from "../../utils/createFlow";

const buildVersion = `版本 ${__PINCHE_BUILD_TIME__}`;

onLoad(() => {
  ensureLoggedIn();
});

function goCreate() {
  clearCreateFlow();
  uni.navigateTo({ url: "/pages/session/create" });
}

function goMine() {
  uni.navigateTo({ url: "/pages/mine/index" });
}
</script>

<style scoped>
.home-page {
  position: relative;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  padding-top: 72rpx;
  padding-bottom: 72rpx;
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
  font-size: 58rpx;
  font-weight: 600;
  letter-spacing: 10rpx;
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

.primary-action,
.secondary-action {
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
  text-align: center;
}

.primary-action {
  background: linear-gradient(145deg, #1a5d4d 0%, #2c775f 100%);
  color: #ffffff;
  box-shadow: 0 18rpx 42rpx rgba(31, 111, 91, 0.24);
}

.secondary-action {
  background: rgba(255, 255, 252, 0.94);
  color: #193d35;
  border: 1rpx solid #e5dece;
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
  font-size: 34rpx;
  font-weight: 600;
  line-height: 1.2;
}

.quiet-line {
  position: relative;
  z-index: 1;
  margin-top: 56rpx;
  color: #8f968f;
  font-size: 24rpx;
  text-align: center;
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
</style>
