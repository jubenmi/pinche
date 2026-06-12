<script>
export default {
  globalData: {
    apiBaseUrl: "http://127.0.0.1:3018",
    signupResultTemplateId: "",
    token: "",
    user: null,
    roles: []
  },
  onLaunch() {}
};
</script>

<style>
page {
  background: #f7f7f7;
  color: #1f2933;
  font-family: -apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif;
}

.page {
  min-height: 100vh;
  padding: 32rpx;
  box-sizing: border-box;
}

.section {
  margin-bottom: 24rpx;
  padding: 28rpx;
  background: #ffffff;
  border: 1rpx solid #e6e8eb;
  border-radius: 8rpx;
}

.title {
  margin-bottom: 12rpx;
  font-size: 36rpx;
  font-weight: 600;
}

.text {
  color: #52616f;
  font-size: 28rpx;
  line-height: 1.55;
}

.actions {
  display: flex;
  gap: 16rpx;
  margin-top: 24rpx;
}

.button {
  flex: 1;
  height: 80rpx;
  border-radius: 8rpx;
  background: #1f7a68;
  color: #ffffff;
  font-size: 28rpx;
  line-height: 80rpx;
}

.button.secondary {
  background: #455a64;
}
</style>
