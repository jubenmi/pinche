<script>
const productionApiBaseUrl = "https://api.pinche.jubenmi.com";

export default {
  globalData: {
    apiBaseUrl: productionApiBaseUrl,
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
  --action-green: #1f6f5b;
  --action-green-active: #1a5d4d;
  --action-green-light: #eef7f4;
  --action-green-light-active: #e1f1ea;
  --action-green-border: rgba(31, 111, 91, 0.38);
  --action-disabled: #aeb8b1;
  --td-brand-color: var(--action-green);
  --td-brand-color-active: var(--action-green-active);
  --td-brand-color-light: var(--action-green-light);
  --td-brand-color-light-active: var(--action-green-light-active);
  --td-brand-color-disabled: var(--action-disabled);
  --td-button-default-bg-color: var(--action-green);
  --td-button-default-color: #ffffff;
  --td-button-default-border-color: var(--action-green-active);
  --td-button-default-active-bg-color: var(--action-green-active);
  --td-button-default-active-border-color: var(--action-green-active);
  --td-button-default-disabled-bg: var(--action-disabled);
  --td-button-default-disabled-color: #ffffff;
  --td-button-default-disabled-border-color: var(--action-disabled);
  --td-button-default-outline-color: var(--action-green);
  --td-button-default-outline-border-color: var(--action-green);
  --td-button-default-outline-active-bg-color: var(--action-green-light);
  --td-button-default-outline-active-border-color: var(--action-green-active);
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
  background: var(--action-green-light);
  color: var(--action-green);
  border: 1rpx solid var(--action-green-border);
  box-shadow: none;
  --td-button-default-bg-color: var(--action-green-light);
  --td-button-default-color: var(--action-green);
  --td-button-default-border-color: var(--action-green-border);
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

.button.disabled,
.button[disabled] {
  background: var(--action-disabled);
  color: #ffffff;
  box-shadow: none;
  --td-button-default-bg-color: var(--action-disabled);
  --td-button-default-color: #ffffff;
  --td-button-default-border-color: var(--action-disabled);
}

.button-icon,
.inline-icon {
  display: block;
  flex-shrink: 0;
  width: 34rpx;
  height: 34rpx;
}

.calendar-segmented-item {
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
  height: 52rpx !important;
  padding: 0 14rpx !important;
  box-sizing: border-box !important;
  color: #34443e !important;
  font-size: 23rpx !important;
  font-weight: 600 !important;
  line-height: 52rpx !important;
}

.calendar-segmented-thumb {
  background: #ffffff !important;
  border-radius: 10rpx !important;
  box-shadow: 0 8rpx 20rpx rgba(44, 61, 51, 0.08) !important;
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
