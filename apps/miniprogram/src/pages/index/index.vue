<template>
  <view class="page">
    <view class="section">
      <view class="title">拼车发车</view>
      <view class="text">从店家、剧本、座位和申请开始。</view>
      <view class="actions">
        <button class="button" @tap="goCreate">建车</button>
        <button class="button secondary" @tap="goMine">我的</button>
      </view>
    </view>
  </view>
</template>

<script setup>
function goCreate() {
  uni.navigateTo({ url: "/pages/session/create" });
}

function goMine() {
  uni.navigateTo({ url: "/pages/mine/index" });
}
</script>
