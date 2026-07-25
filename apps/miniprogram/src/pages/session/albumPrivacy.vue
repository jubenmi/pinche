<template>
  <view class="page privacy-page">
    <AuthIdentityBar />
    <FeedbackHost />

    <view class="section">
      <view class="title">相册分享隐私设置</view>
      <view class="text">完整相册会展示与你相关的照片，以及 NPC、其他/风景/主线外照片；这里控制分享展示里的可见性。</view>
      <t-notice-bar
        v-if="statusText"
        class="notice"
        theme="warning"
        :visible="true"
        :content="statusText"
      />
      <t-button
        v-if="privacyRetryable && !privacyLoading"
        class="retry-button"
        variant="outline"
        @tap="retryPrivacyLoad"
      >
        重新加载
      </t-button>
    </view>

    <view class="section stop-share-section">
      <view class="section-title">已经发出的公开相册</view>
      <view class="setting-note">停止后，你在本场生成的新版好友、群聊和朋友圈相册链接会立即失效；两项隐私开关不会改变。</view>
      <t-button
        class="stop-share-button"
        theme="danger"
        variant="outline"
        :disabled="revoking"
        @tap="stopMyAlbumShares"
      >
        {{ revoking ? "正在停止..." : "停止我的相册分享" }}
      </t-button>
    </view>

    <view class="section settings-section">
      <view class="setting-row">
        <view class="setting-copy">
          <view class="setting-title">允许我上传的照片出现在分享展示里</view>
          <view class="setting-note">关闭后，别人分享相册时不会展示你上传的照片。</view>
        </view>
        <t-switch
          color="#1f7a68"
          :value="allowUploadedVisible"
          :disabled="!privacyLoaded || privacyLoading || saving"
          @change="allowUploadedVisible = $event.detail.value"
        />
      </view>

      <view class="setting-row">
        <view class="setting-copy">
          <view class="setting-title">允许包含我的照片出现在分享展示里</view>
          <view class="setting-note">关闭后，别人分享相册时不会展示包含你的照片。</view>
        </view>
        <t-switch
          color="#1f7a68"
          :value="allowTaggedVisible"
          :disabled="!privacyLoaded || privacyLoading || saving"
          @change="allowTaggedVisible = $event.detail.value"
        />
      </view>
    </view>

    <view class="section rule-section">
      <view class="section-title">这套规则怎么生效</view>
      <view class="rule-row">完整相册会展示你上传、标注了你或标为 NPC/其他的照片</view>
      <view class="rule-row">分享展示会继续尊重这两项设置</view>
      <view class="rule-row">车头也不能越权查看原图</view>
      <view class="rule-note">能看到的照片可以保存；看不到的照片不会出现。</view>
    </view>

    <view class="bottom-action">
      <t-button
        class="button"
        theme="primary"
        :class="{ disabled: !canSavePrivacy }"
        :disabled="!canSavePrivacy"
        @tap="savePrivacy"
      >
        {{ privacyLoading ? "正在加载..." : saving ? "保存中..." : "保存设置" }}
      </t-button>
    </view>
  </view>
</template>

<script>
import AuthIdentityBar from "../../components/AuthIdentityBar.vue";
import FeedbackHost from "../../components/TDesignFeedbackHost.vue";
import { dataOf, ensureLoggedIn, request } from "../../utils/api";
import { canSaveAlbumPrivacy } from "../../utils/p1Safety.js";
import { showModal, showToast } from "../../utils/tdesignFeedback";

export default {
  components: { AuthIdentityBar, FeedbackHost },
  data() {
    return {
      sessionId: "",
      allowUploadedVisible: true,
      allowTaggedVisible: true,
      statusText: "",
      saving: false,
      revoking: false,
      privacyLoading: false,
      privacyLoaded: false,
      privacyRetryable: false
    };
  },
  computed: {
    canSavePrivacy() {
      return canSaveAlbumPrivacy({
        loaded: this.privacyLoaded,
        saving: this.saving,
        sessionId: this.sessionId
      });
    }
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
      if (this.privacyLoading || !this.sessionId) {
        return;
      }
      this.privacyLoading = true;
      this.privacyLoaded = false;
      this.privacyRetryable = false;
      try {
        const response = await request({
          url: `/api/sessions/${this.sessionId}/album/privacy`
        });
        const privacy = dataOf(response) || {};
        this.allowUploadedVisible = privacy.allow_uploaded_visible !== false;
        this.allowTaggedVisible = privacy.allow_tagged_visible !== false;
        this.privacyLoaded = true;
        this.statusText = "";
      } catch (error) {
        if (error?.statusCode === 403) {
          this.statusText = "只有发车后的同车成员可以设置相册隐私。";
        } else {
          this.statusText = "隐私设置加载失败，请稍后重试。";
          this.privacyRetryable = true;
        }
      } finally {
        this.privacyLoading = false;
      }
    },
    retryPrivacyLoad() {
      this.loadPrivacy();
    },
    async savePrivacy() {
      if (!this.canSavePrivacy) {
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
        showToast({ title: "设置已保存", icon: "none" });
        setTimeout(() => {
          uni.navigateBack();
        }, 300);
      } catch (error) {
        this.statusText = "保存失败，请稍后重试。";
      } finally {
        this.saving = false;
      }
    },
    async stopMyAlbumShares() {
      if (this.revoking || !this.sessionId) return;
      const confirmed = await new Promise((resolve) => {
        showModal({
          title: "停止我的相册分享？",
          content: "你在本场生成的新版公开相册链接会立即失效。此操作不会修改照片隐私设置。",
          confirmText: "停止分享",
          cancelText: "取消",
          success: (result) => resolve(Boolean(result.confirm)),
          fail: () => resolve(false)
        });
      });
      if (!confirmed) return;
      this.revoking = true;
      try {
        const response = await request({
          url: `/api/sessions/${this.sessionId}/album/public-shares`,
          method: "DELETE"
        });
        const revokedCount = Number(dataOf(response)?.revoked_count || 0);
        showToast({
          title: revokedCount > 0 ? "已停止相册分享" : "当前没有有效分享",
          icon: "none"
        });
      } catch (error) {
        this.statusText = "停止分享失败，请稍后重试。";
      } finally {
        this.revoking = false;
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

.retry-button {
  margin-top: 16rpx;
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

.stop-share-section {
  background: #fffefb;
}

.stop-share-button {
  margin-top: 22rpx;
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
