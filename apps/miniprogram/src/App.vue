<script>
const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || "https://api.pinche.jubenmi.com";

export default {
  globalData: {
    apiBaseUrl,
    signupResultTemplateId: "",
    token: "",
    authBaseUrl: "",
    user: null,
    roles: []
  },
  onLaunch() {}
};
</script>

<style>
@font-face {
  font-family: "PincheBrand";
  src: url("/static/fonts/pinche-brand.ttf");
  font-weight: 600;
  font-style: normal;
}

page {
  background-color: #fbfaf6;
  color: #183d34;
  font-family: "Songti SC", "STSong", "PingFang SC", -apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif;
}

.page {
  min-height: 100vh;
  padding: 36rpx 30rpx 48rpx;
  box-sizing: border-box;
  background: linear-gradient(180deg, rgba(255, 255, 253, 0.9) 0%, rgba(251, 250, 246, 0.72) 62%, rgba(251, 250, 246, 0.36) 100%);
}

.section {
  margin-bottom: 24rpx;
  padding: 32rpx;
  background: rgba(255, 255, 252, 0.94);
  border: 1rpx solid rgba(222, 215, 202, 0.9);
  border-radius: 18rpx;
  box-shadow: 0 18rpx 48rpx rgba(51, 69, 59, 0.06);
}

.title {
  margin-bottom: 14rpx;
  color: #12382f;
  font-family: "PincheBrand", "Songti SC", "STSong", "PingFang SC", sans-serif;
  font-size: 42rpx;
  font-weight: 600;
  letter-spacing: 0;
}

.text {
  color: #738078;
  font-size: 28rpx;
  line-height: 1.6;
}

.actions {
  display: flex;
  gap: 16rpx;
  margin-top: 24rpx;
}

.button {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 14rpx;
  flex: 1;
  height: 88rpx;
  min-width: 0;
  padding: 0 28rpx;
  box-sizing: border-box;
  border-radius: 14rpx;
  background: linear-gradient(145deg, #1a5d4d 0%, #2b765f 100%);
  color: #ffffff;
  font-size: 28rpx;
  font-weight: 500;
  line-height: 1.2;
  box-shadow: 0 16rpx 34rpx rgba(31, 111, 91, 0.22);
}

.button.secondary {
  background: rgba(255, 255, 252, 0.96);
  color: #193d35;
  border: 1rpx solid #ded8ca;
  box-shadow: none;
}

.button.compact {
  flex: 0 0 128rpx;
  width: 128rpx;
  height: 64rpx;
  padding: 0 18rpx;
  border-radius: 12rpx;
  font-size: 24rpx;
  font-weight: 600;
  box-shadow: none;
}

.button.disabled {
  background: #aeb8b1;
  color: #ffffff;
  box-shadow: none;
}

.button-icon,
.inline-icon {
  display: block;
  flex-shrink: 0;
  width: 34rpx;
  height: 34rpx;
}

.bottom-action {
  position: fixed;
  right: 30rpx;
  bottom: 42rpx;
  left: 30rpx;
  z-index: 5;
}

.action-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16rpx;
}

button::after {
  border: none;
}
</style>
