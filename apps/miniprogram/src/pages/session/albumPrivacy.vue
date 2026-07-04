<template>
  <view class="page privacy-page">
    <AuthIdentityBar />

    <view class="section">
      <view class="title">相册分享隐私设置</view>
      <view class="text">完整相册只展示与你相关的照片；这里控制分享展示里的可见性。</view>
      <view v-if="statusText" class="notice">{{ statusText }}</view>
    </view>

    <view class="section settings-section">
      <view class="setting-row">
        <view class="setting-copy">
          <view class="setting-title">允许我上传的照片出现在分享展示里</view>
          <view class="setting-note">关闭后，别人分享相册时不会展示你上传的照片。</view>
        </view>
        <switch
          color="#1f7a68"
          :checked="allowUploadedVisible"
          @change="allowUploadedVisible = $event.detail.value"
        />
      </view>

      <view class="setting-row">
        <view class="setting-copy">
          <view class="setting-title">允许包含我的照片出现在分享展示里</view>
          <view class="setting-note">关闭后，别人分享相册时不会展示包含你的照片。</view>
        </view>
        <switch
          color="#1f7a68"
          :checked="allowTaggedVisible"
          @change="allowTaggedVisible = $event.detail.value"
        />
      </view>
    </view>

    <view class="section rule-section">
      <view class="section-title">这套规则怎么生效</view>
      <view class="rule-row">完整相册只展示你上传或标注了你的照片</view>
      <view class="rule-row">分享展示会继续尊重这两项设置</view>
      <view class="rule-row">车头也不能越权查看原图</view>
      <view class="rule-note">能看到的照片可以保存；看不到的照片不会出现。</view>
    </view>

    <view class="bottom-action">
      <button class="button" :class="{ disabled: saving }" @tap="savePrivacy">
        {{ saving ? "保存中..." : "保存设置" }}
      </button>
    </view>
  </view>
</template>

<script>
import AuthIdentityBar from "../../components/AuthIdentityBar.vue";
import { dataOf, ensureLoggedIn, request } from "../../utils/api";

export default {
  components: { AuthIdentityBar },
  data() {
    return {
      sessionId: "",
      allowUploadedVisible: true,
      allowTaggedVisible: true,
      statusText: "",
      saving: false
    };
  },
  async onLoad(options) {
    this.sessionId = options.id || "";
    const auth = await ensureLoggedIn({
      content: "登录后可以设置相册隐私。"
    });
    if (!auth?.user) {
      this.statusText = "登录后可继续设置相册隐私。";
      return;
    }
    await this.loadPrivacy();
  },
  methods: {
    async loadPrivacy() {
      try {
        const response = await request({
          url: `/api/sessions/${this.sessionId}/album/privacy`
        });
        const privacy = dataOf(response) || {};
        this.allowUploadedVisible = privacy.allow_uploaded_visible !== false;
        this.allowTaggedVisible = privacy.allow_tagged_visible !== false;
        this.statusText = "";
      } catch (error) {
        if (error?.statusCode === 403) {
          this.statusText = "只有发车后的同车成员可以设置相册隐私。";
        } else {
          this.statusText = "隐私设置加载失败，请稍后重试。";
        }
      }
    },
    async savePrivacy() {
      if (this.saving || !this.sessionId) {
        return;
      }
      this.saving = true;
      try {
        await request({
          url: `/api/sessions/${this.sessionId}/album/privacy`,
          method: "PUT",
          data: {
            allowUploadedVisible: this.allowUploadedVisible,
            allowTaggedVisible: this.allowTaggedVisible
          }
        });
        uni.showToast({ title: "设置已保存", icon: "none" });
        setTimeout(() => {
          uni.navigateBack();
        }, 300);
      } catch (error) {
        this.statusText = "保存失败，请稍后重试。";
      } finally {
        this.saving = false;
      }
    }
  }
};
</script>

<style scoped>
.privacy-page {
  padding-bottom: 150rpx;
}

.notice {
  margin-top: 14rpx;
  padding: 16rpx;
  border-radius: 8rpx;
  background: #eef7f4;
  color: #1f7a68;
  font-size: 24rpx;
  line-height: 1.5;
}

.settings-section {
  padding: 0 32rpx;
}

.setting-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24rpx;
  padding: 28rpx 0;
  border-bottom: 1rpx solid #edf1f5;
}

.setting-row:last-child {
  border-bottom: none;
}

.setting-copy {
  flex: 1;
  min-width: 0;
}

.setting-title,
.section-title {
  color: #153f34;
  font-size: 29rpx;
  font-weight: 600;
  line-height: 1.35;
}

.setting-note,
.rule-note {
  margin-top: 8rpx;
  color: #7a857d;
  font-size: 24rpx;
  line-height: 1.45;
}

.rule-section {
  background: #fffefb;
}

.rule-row {
  margin-top: 18rpx;
  padding: 16rpx;
  border-radius: 8rpx;
  background: #eef5ef;
  color: #1f6f5b;
  font-size: 25rpx;
  line-height: 1.4;
}

.rule-note {
  padding-top: 6rpx;
  color: #8d7b55;
}
</style>
