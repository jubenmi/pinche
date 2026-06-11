<template>
  <view class="page">
    <view class="section">
      <view class="title">建车</view>
      <view class="text">选择店家、剧本、时间和座位。</view>
      <view class="actions">
        <button class="button" @tap="goDetail">预览车详情</button>
      </view>
    </view>
  </view>
</template>

<script setup>
function goDetail() {
  uni.navigateTo({ url: "/pages/session/detail?id=d1-demo" });
}
</script>
