<template>
  <view class="page">
    <view class="section">
      <view class="title">建车</view>
      <view class="text">选择店家、剧本、时间和座位。</view>
      <view class="actions">
        <button class="button" @tap="goDetail">预览车详情</button>
      </view>
    </view>

    <view class="section">
      <view class="section-title">店家</view>
      <view class="search-row">
        <input v-model="storeKeyword" class="field search" placeholder="搜索店家" />
        <button class="mini-button" @tap="loadStores">搜索</button>
      </view>
      <view v-for="store in stores" :key="store.id" class="item" @tap="selectStore(store)">
        <view class="item-main">
          <view class="item-title">{{ store.name }}</view>
          <view class="item-sub">{{ store.city }} {{ store.district || "" }} {{ store.address || "" }}</view>
        </view>
        <view v-if="selectedStoreId === store.id" class="selected">已选</view>
      </view>
    </view>

    <view class="section">
      <view class="section-title">剧本</view>
      <view class="search-row">
        <input v-model="scriptKeyword" class="field search" placeholder="搜索剧本" />
        <button class="mini-button" @tap="loadScripts">搜索</button>
      </view>
      <view v-for="script in scripts" :key="script.id" class="item" @tap="selectScript(script)">
        <view class="item-main">
          <view class="item-title">{{ script.name }}</view>
          <view class="item-sub">{{ displayTags(script.type_tags) }} / {{ script.player_count || 0 }}人</view>
          <view class="item-sub">{{ script.summary_no_spoiler || "暂无简介" }}</view>
        </view>
        <view v-if="selectedScriptId === script.id" class="selected">已选</view>
      </view>
    </view>

    <view class="section">
      <view class="section-title">补充资料申请</view>
      <view class="toggle-row">
        <button
          class="toggle"
          :class="{ active: requestForm.requestType === 'store' }"
          @tap="requestForm.requestType = 'store'"
        >
          店家
        </button>
        <button
          class="toggle"
          :class="{ active: requestForm.requestType === 'script' }"
          @tap="requestForm.requestType = 'script'"
        >
          剧本
        </button>
      </view>
      <input v-model="requestForm.name" class="field" placeholder="名称" />
      <view v-if="requestForm.requestType === 'store'" class="field-row">
        <input v-model="requestForm.city" class="field half" placeholder="城市" />
        <input v-model="requestForm.district" class="field half" placeholder="区域" />
      </view>
      <textarea v-model="requestForm.description" class="textarea" placeholder="补充说明" />
      <view class="actions">
        <button class="button" @tap="submitCatalogRequest">提交申请</button>
      </view>
      <view v-if="submitStatusText" class="notice">{{ submitStatusText }}</view>
    </view>
  </view>
</template>

<script setup>
import { onMounted, ref } from "vue";
import { dataOf, getCurrentUser, queryString, request } from "../../utils/api";

const storeKeyword = ref("");
const scriptKeyword = ref("");
const stores = ref([]);
const scripts = ref([]);
const selectedStoreId = ref("");
const selectedScriptId = ref("");
const requestForm = ref(defaultRequestForm());
const submitStatusText = ref("");

onMounted(() => {
  loadStores();
  loadScripts();
});

function defaultRequestForm() {
  return {
    requestType: "store",
    name: "",
    city: "北京",
    district: "",
    description: ""
  };
}

function showMessage(title) {
  uni.showToast({ title, icon: "none" });
}

function displayTags(value) {
  if (!value) {
    return "未标注";
  }
  if (Array.isArray(value)) {
    return value.join("、");
  }
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.join("、") : String(value);
  } catch (error) {
    return String(value);
  }
}

async function loadStores() {
  const response = await request({
    url: "/api/stores" + queryString({ keyword: storeKeyword.value, limit: 20 })
  });
  stores.value = dataOf(response) || [];
}

async function loadScripts() {
  const response = await request({
    url: "/api/scripts" + queryString({ keyword: scriptKeyword.value, limit: 20 })
  });
  scripts.value = dataOf(response) || [];
}

function selectStore(store) {
  selectedStoreId.value = store.id;
}

function selectScript(script) {
  selectedScriptId.value = script.id;
}

async function submitCatalogRequest() {
  const auth = getCurrentUser();
  if (!auth.user) {
    showMessage("请先在我的页登录");
    return;
  }
  if (!requestForm.value.name) {
    showMessage("请填写名称");
    return;
  }

  try {
    await request({
      url: "/api/catalog-requests",
      method: "POST",
      data: requestForm.value
    });
    showMessage("已提交");
    submitStatusText.value = "已提交，等待管理员处理。";
    requestForm.value = defaultRequestForm();
  } catch (error) {
    submitStatusText.value = "提交失败，请稍后重试。";
    showMessage("提交失败");
  }
}

function goDetail() {
  uni.navigateTo({ url: "/pages/session/detail?id=d1-demo" });
}
</script>

<style scoped>
.section-title {
  margin-bottom: 18rpx;
  font-size: 30rpx;
  font-weight: 600;
}

.search-row,
.toggle-row,
.field-row {
  display: flex;
  gap: 12rpx;
}

.field,
.textarea {
  width: 100%;
  min-height: 76rpx;
  margin-bottom: 16rpx;
  padding: 0 20rpx;
  box-sizing: border-box;
  border: 1rpx solid #d7dde5;
  border-radius: 8rpx;
  background: #ffffff;
  color: #1f2933;
  font-size: 28rpx;
}

.field.search,
.field.half {
  flex: 1;
}

.textarea {
  min-height: 156rpx;
  padding-top: 18rpx;
  line-height: 1.5;
}

.mini-button,
.toggle {
  min-width: 120rpx;
  height: 64rpx;
  padding: 0 18rpx;
  border-radius: 8rpx;
  background: #eef2f7;
  color: #334155;
  font-size: 24rpx;
  line-height: 64rpx;
}

.mini-button,
.toggle.active {
  background: #1f7a68;
  color: #ffffff;
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
  margin-bottom: 8rpx;
  color: #1f2933;
  font-size: 28rpx;
  font-weight: 600;
}

.item-sub {
  color: #64748b;
  font-size: 24rpx;
  line-height: 1.45;
}

.selected {
  min-width: 72rpx;
  color: #1f7a68;
  font-size: 24rpx;
  text-align: right;
}

.notice {
  margin-top: 16rpx;
  color: #1f7a68;
  font-size: 26rpx;
}
</style>
