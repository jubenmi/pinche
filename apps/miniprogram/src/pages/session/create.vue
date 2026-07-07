<template>
  <view class="page flow-page">
    <AuthIdentityBar />
    <FeedbackHost />

    <view class="flow-top">
      <view class="step-label">1 / 4</view>
      <view class="title">选择店家</view>
      <view class="text">先确定这局在哪家店玩。这里只做一件事：选店。</view>
    </view>

    <t-search
      :value="keyword"
      class="search-surface"
      placeholder="搜索店名或商圈"
      shape="round"
      @change="keyword = $event.detail.value"
      @submit="loadStores"
    />

    <view class="list-surface">
      <t-notice-bar
        v-if="statusText"
        class="notice"
        theme="warning"
        :visible="true"
        :content="statusText"
      />
      <view
        v-for="store in stores"
        :key="store.id"
        class="list-row"
        :class="{ selected: isSelectedStore(store) }"
        @tap="selectStore(store)"
      >
        <t-image class="store-icon" src="/static/icons/store.png" mode="aspectFit" />
        <view class="row-main">
          <view class="row-title">{{ store.name }}</view>
          <view class="row-meta">{{ storeMeta(store) }}</view>
        </view>
        <t-image
          class="row-status-icon"
          :src="isSelectedStore(store) ? '/static/icons/check.png' : '/static/icons/pin.png'"
          mode="aspectFit"
        />
      </view>
    </view>

    <view class="bottom-action">
      <t-button class="button" :class="{ disabled: !selectedStore }" @tap="goNext">下一步</t-button>
    </view>
  </view>
</template>

<script>
import AuthIdentityBar from "../../components/AuthIdentityBar.vue";
import FeedbackHost from "../../components/TDesignFeedbackHost.vue";
import { dataOf, queryString, request } from "../../utils/api";
import { writeCreateFlow } from "../../utils/createFlow";
import { showToast } from "../../utils/tdesignFeedback";

const FALLBACK_STORES = [
  { id: "demo-store-1", name: "谜雾剧场（国贸店）", city: "北京", district: "朝阳", area: "国贸商圈", distance: "1.2km" },
  { id: "demo-store-2", name: "浮生剧社（三里屯店）", city: "北京", district: "朝阳", area: "三里屯", distance: "2.3km" },
  { id: "demo-store-3", name: "拾光沉浸馆（望京店）", city: "北京", district: "朝阳", area: "望京", distance: "3.1km" },
  { id: "demo-store-4", name: "零隐推理社（西单店）", city: "北京", district: "西城", area: "西单", distance: "4.0km" },
  { id: "demo-store-5", name: "时光机沉浸馆（中关村店）", city: "北京", district: "海淀", area: "中关村", distance: "5.2km" }
];

export default {
  components: { AuthIdentityBar, FeedbackHost },
  data() {
    return {
      keyword: "",
      stores: [],
      selectedStore: null,
      statusText: ""
    };
  },
  onLoad() {
    this.loadStores();
  },
  methods: {
    async loadStores() {
      this.statusText = "正在加载店家...";
      try {
        const response = await request({
          url: "/api/stores" + queryString({ keyword: this.keyword, limit: 20 })
        });
        const stores = dataOf(response) || [];
        this.stores = stores.length > 0 ? stores : FALLBACK_STORES;
        this.statusText = "";
      } catch (error) {
        this.stores = FALLBACK_STORES;
        this.statusText = "已展示演示店家，本地服务启动后会显示真实数据。";
      }
    },
    async selectStore(store) {
      if (this.isSelectedStore(store)) {
        await this.goNext();
        return;
      }
      this.selectedStore = store;
      writeCreateFlow({ store, script: null, role: null });
    },
    isSelectedStore(store) {
      return (
        this.selectedStore &&
        String(this.selectedStore.id) === String(store.id)
      );
    },
    storeMeta(store) {
      const district = store.district ? `${store.district}区` : store.city || "位置待定";
      const area = store.area || store.business_area || "商圈待定";
      return [district, area, store.distance].filter(Boolean).join(" · ");
    },
    async goNext() {
      if (!this.selectedStore) {
        showToast({ title: "先选择一家店", icon: "none" });
        return;
      }
      const query = queryString({
        storeId: this.selectedStore.id,
        storeName: this.selectedStore.name,
        storeDistrict: this.selectedStore.district
      });
      uni.navigateTo({ url: `/pages/session/script${query}` });
    }
  }
};
</script>

<style scoped>
.flow-page {
  padding-bottom: 150rpx;
}

.flow-top {
  display: none;
}

.step-label {
  color: #b89458;
  font-size: 24rpx;
  font-weight: 600;
}

.search-surface {
  display: block;
  margin-bottom: 24rpx;
  border-radius: 12rpx;
  overflow: hidden;
}

.search-input {
  flex: 1;
  height: 72rpx;
  color: #183d34;
  font-size: 26rpx;
}

.placeholder {
  color: #9ba39c;
}

.list-surface {
  overflow: hidden;
  border: 1rpx solid rgba(223, 216, 204, 0.9);
  border-radius: 16rpx;
  background: rgba(255, 255, 252, 0.94);
  box-shadow: 0 16rpx 42rpx rgba(51, 69, 59, 0.05);
}

.notice {
  color: #8d7b55;
  font-size: 24rpx;
  line-height: 1.5;
}

.list-row {
  display: flex;
  align-items: center;
  min-height: 128rpx;
  padding: 0 22rpx;
  border-top: 1rpx solid #eee8da;
}

.list-row:first-child {
  border-top: none;
}

.list-row.selected {
  background: linear-gradient(90deg, rgba(231, 239, 232, 0.94), rgba(247, 248, 244, 0.84));
}

.store-icon {
  width: 48rpx;
  height: 48rpx;
  margin-right: 18rpx;
}

.row-main {
  flex: 1;
  min-width: 0;
}

.row-title {
  color: #153f34;
  font-size: 29rpx;
  font-weight: 600;
  line-height: 1.28;
}

.row-meta {
  margin-top: 10rpx;
  color: #7a857d;
  font-size: 24rpx;
}

.row-status-icon {
  width: 34rpx;
  height: 34rpx;
  margin-left: 18rpx;
}

</style>
