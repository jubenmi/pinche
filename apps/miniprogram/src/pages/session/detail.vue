<template>
  <view class="page">
    <view class="section">
      <view class="title">车详情</view>
      <view class="text">座位、价格调整和申请状态。</view>
      <view class="actions">
        <button class="button" @tap="goApply">申请上车</button>
        <button class="button secondary" open-type="share">分享</button>
      </view>
    </view>
  </view>
</template>

<script>
export default {
  onShareAppMessage() {
    return {
      title: "拼车发车",
      path: "/pages/session/detail?id=d1-demo"
    };
  },
  methods: {
    goApply() {
      uni.navigateTo({ url: "/pages/session/apply?id=d1-demo" });
    }
  }
};
</script>
