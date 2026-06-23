<template>
  <view class="page home-page">
    <AuthIdentityBar />

    <view v-if="backendStatus.maintenance" class="maintenance-state">
      <image class="maintenance-art" src="/static/art/maintenance-landscape.jpg" mode="widthFix" />
      <view class="maintenance-title">服务正在上线维护中</view>
      <view class="maintenance-text">我们正在准备后端服务，稍后会自动恢复。</view>
      <view v-if="backendStatus.lastCheckedAt" class="maintenance-meta">
        最近检查：{{ backendStatus.lastCheckedAt }}
      </view>
      <view v-if="backendStatus.lastErrorMessage" class="maintenance-meta">
        {{ backendStatus.lastErrorMessage }}
      </view>
      <view class="build-version">{{ buildVersion }}</view>
      <button
        class="maintenance-retry"
        :class="{ disabled: backendStatus.checking }"
        :disabled="backendStatus.checking"
        @click="retryBackend"
      >
        {{ retryButtonText }}
      </button>
    </view>

    <view v-else class="home-normal">
      <image class="home-landscape" src="/static/art/ink-home-landscape.jpg" mode="widthFix" />

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
  </view>
</template>

<script setup>
import { onLoad, onShareAppMessage, onShareTimeline, onShow, onUnload } from "@dcloudio/uni-app";
import { computed, reactive } from "vue";
import AuthIdentityBar from "../../components/AuthIdentityBar.vue";
import {
  BACKEND_STATUS_CHANGE_EVENT,
  checkBackendHealth,
  getBackendStatus
} from "../../utils/api";
import { clearCreateFlow } from "../../utils/createFlow";
import { showWechatShareMenus } from "../../utils/share";

const buildVersion = `版本 ${__PINCHE_BUILD_TIME__}`;
const HOME_SHARE_FRIEND_TITLE = "剧本迷·拼车";
const HOME_SHARE_TIMELINE_TITLE = "剧本迷·拼车，一起玩好本";
const HOME_SHARE_PATH = "/pages/index/index";
const HOME_SHARE_IMAGE = "/static/art/ink-home-landscape.jpg";
const backendStatus = reactive(getBackendStatus());
let maintenanceTimer = null;

const retryButtonText = computed(() => (backendStatus.checking ? "检查中..." : "重试"));

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
  }
});

onUnload(() => {
  stopMaintenancePolling();
  if (typeof uni.$off === "function") {
    uni.$off(BACKEND_STATUS_CHANGE_EVENT, syncBackendStatus);
  }
});

function goCreate() {
  clearCreateFlow();
  uni.navigateTo({ url: "/pages/session/create" });
}

function goMine() {
  uni.navigateTo({ url: "/pages/mine/index" });
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
  padding-top: 72rpx;
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
  font-family: "PincheBrand", "Songti SC", "STSong", "PingFang SC", sans-serif;
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
  color: #153f34;
  font-family: "PincheBrand", "Songti SC", "STSong", "PingFang SC", sans-serif;
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
</style>
