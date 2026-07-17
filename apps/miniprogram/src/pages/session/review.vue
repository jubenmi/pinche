<template>
  <view class="page review-page">
    <AuthIdentityBar />
    <FeedbackHost />

    <view class="section">
      <view class="title">写记录</view>
      <view class="text">到发车时间后，你可以留下自己的星级、文字和照片。</view>
      <t-notice-bar
        v-if="statusText"
        class="notice"
        theme="warning"
        :visible="true"
        :content="statusText"
      />
    </view>

    <view class="section">
      <view class="section-title">星级</view>
      <view class="rating-row">
        <t-button
          v-for="value in [1, 2, 3, 4, 5]"
          :key="value"
          class="rating-button"
          :class="{ active: rating >= value }"
          @tap="rating = value"
        >
          ★
        </t-button>
      </view>
    </view>

    <view class="section">
      <view class="section-title">文字记录</view>
      <t-textarea
        :value="content"
        class="textarea"
        maxlength="500"
        placeholder="写一点这车的体验"
        placeholder-class="placeholder"
        @change="content = $event.detail.value"
      />
      <view class="counter">{{ content.length }}/500</view>
    </view>

    <view class="section">
      <view class="section-head">
        <view class="section-title">照片</view>
        <t-button
          class="photo-add"
          :disabled="photos.length + pendingPhotoCount >= 9 || saving"
          @tap="choosePhotos"
        >
          添加
        </t-button>
      </view>
      <view class="photo-grid">
        <view v-for="(photo, index) in photos" :key="photo" class="photo-cell">
          <t-image class="photo-image" :src="assetUrl(photo)" mode="aspectFill" />
          <t-button class="photo-remove" :disabled="saving" @tap="removePhoto(index)">移除</t-button>
        </view>
      </view>
    </view>

    <view class="bottom-action">
      <t-button class="button" :disabled="saving || !canSave" @tap="saveReview">
        {{ saving ? "保存中..." : "保存记录" }}
      </t-button>
    </view>
  </view>
</template>

<script>
import AuthIdentityBar from "../../components/AuthIdentityBar.vue";
import FeedbackHost from "../../components/TDesignFeedbackHost.vue";
import {
  acknowledgeSessionReviewPhotoAssociations,
  assetUrl,
  captureSessionReviewPhotoAssociationCutoff,
  dataOf,
  ensureLoggedIn,
  recoverPendingSessionReviewPhotos,
  request,
  uploadSessionReviewPhotos
} from "../../utils/api";
import { contentModerationErrorText } from "../../utils/contentModeration";
import { showToast } from "../../utils/tdesignFeedback";

export default {
  components: { AuthIdentityBar, FeedbackHost },
  data() {
    return {
      sessionId: "",
      canReview: false,
      rating: 5,
      content: "",
      photos: [],
      pendingPhotoCount: 0,
      statusText: "",
      saving: false
    };
  },
  computed: {
    canSave() {
      return this.canReview && this.rating >= 1 && this.rating <= 5 &&
        this.pendingPhotoCount === 0;
    }
  },
  async onLoad(options) {
    this.sessionId = options.id || "";
    const auth = await ensureLoggedIn({
      content: "登录后可以写自己的车局记录。"
    });
    if (!auth) {
      this.statusText = "登录后可继续写记录。";
      return;
    }
    await this.loadMyReview();
  },
  methods: {
    assetUrl,
    async loadMyReview() {
      if (!this.sessionId) {
        this.statusText = "请从车详情或我的车局进入记录页。";
        return;
      }
      try {
        const response = await request({ url: `/api/sessions/${this.sessionId}/review` });
        const data = dataOf(response) || {};
        this.canReview = Boolean(data.can_review);
        if (!this.canReview) {
          this.statusText = "到发车时间后，已上车玩家可以写记录。";
        } else {
          this.statusText = "";
        }
        if (data.review) {
          this.rating = Number(data.review.rating || 5);
          this.content = data.review.content || "";
          this.photos = data.review.photos || [];
        }
        const recovered = await recoverPendingSessionReviewPhotos({ sessionId: this.sessionId });
        this.photos = [...new Set([...this.photos, ...recovered.approvedPaths])].slice(0, 9);
        this.pendingPhotoCount = Math.min(recovered.pendingCount, 9 - this.photos.length);
        if (this.pendingPhotoCount > 0) {
          this.statusText = "内容正在安全审核";
        }
      } catch (error) {
        this.statusText = "记录加载失败，请稍后重试。";
      }
    },
    choosePhotos() {
      const remaining = 9 - this.photos.length - this.pendingPhotoCount;
      if (remaining <= 0) {
        showToast({ title: "最多上传9张照片", icon: "none" });
        return;
      }
      uni.chooseImage({
        count: remaining,
        sizeType: ["compressed"],
        sourceType: ["album", "camera"],
        success: async (result) => {
          await this.uploadChosenPhotos(result.tempFilePaths || []);
        }
      });
    },
    async uploadChosenPhotos(paths) {
      if (paths.length === 0) {
        return;
      }
      this.saving = true;
      this.statusText = "正在上传照片...";
      try {
        const batch = await uploadSessionReviewPhotos(
          paths.slice(0, 9 - this.photos.length - this.pendingPhotoCount),
          { sessionId: this.sessionId }
        );
        const recovered = await recoverPendingSessionReviewPhotos({ sessionId: this.sessionId });
        const approvedPaths = [...batch.approvedPaths, ...recovered.approvedPaths];
        this.photos = [...new Set([...this.photos, ...approvedPaths])].slice(0, 9);
        this.pendingPhotoCount = Math.min(recovered.pendingCount, 9 - this.photos.length);
        if (batch.error) throw batch.error;
        this.statusText = this.pendingPhotoCount > 0 ? "内容正在安全审核" : "";
      } catch (error) {
        this.statusText = error?.userMessage || "照片上传失败，请稍后重试。";
      } finally {
        this.saving = false;
      }
    },
    removePhoto(index) {
      this.photos.splice(index, 1);
    },
    async saveReview() {
      if (this.pendingPhotoCount > 0) {
        this.statusText = "内容正在安全审核";
        return;
      }
      if (!this.canSave || this.saving) {
        return;
      }
      this.saving = true;
      this.statusText = "正在保存记录...";
      try {
        const reviewAssociationCutoff = captureSessionReviewPhotoAssociationCutoff({
          sessionId: this.sessionId
        });
        await request({
          url: `/api/sessions/${this.sessionId}/review`,
          method: "PUT",
          data: {
            rating: this.rating,
            content: this.content.trim(),
            photoUrls: this.photos
          }
        });
        acknowledgeSessionReviewPhotoAssociations(this.photos,
          { sessionId: this.sessionId },
          reviewAssociationCutoff
        );
        showToast({ title: "记录已保存", icon: "none" });
        setTimeout(() => {
          uni.navigateBack();
        }, 350);
      } catch (error) {
        const moderationMessage = contentModerationErrorText(error);
        if (moderationMessage) {
          this.statusText = moderationMessage;
          return;
        }
        if (error?.statusCode === 403) {
          this.statusText = "只有已上车玩家可以写记录。";
        } else if (error?.statusCode === 400) {
          this.statusText = "请检查星级、文字和照片后再保存。";
        } else {
          this.statusText = "记录保存失败，请稍后重试。";
        }
      } finally {
        this.saving = false;
      }
    }
  }
};
</script>

<style scoped>
.review-page {
  padding-bottom: 150rpx;
}

.section-title {
  margin-bottom: 18rpx;
  color: #153f34;
  font-size: 30rpx;
  font-weight: 600;
}

.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18rpx;
}

.section-head .section-title {
  margin-bottom: 0;
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

.rating-row {
  display: flex;
  gap: 12rpx;
}

.rating-button {
  width: 76rpx;
  height: 76rpx;
  margin: 0;
  padding: 0;
  border-radius: 8rpx;
  background: #f8fafc;
  color: #cbd5e1;
  font-size: 42rpx;
  line-height: 76rpx;
}

.rating-button.active {
  background: #fff7ed;
  color: #d97706;
}

.textarea {
  box-sizing: border-box;
  width: 100%;
  min-height: 220rpx;
  padding: 20rpx;
  border: 1rpx solid #e2e8f0;
  border-radius: 8rpx;
  color: #1f2933;
  font-size: 26rpx;
  line-height: 1.55;
  background: #ffffff;
}

.placeholder {
  color: #94a3b8;
}

.counter {
  margin-top: 10rpx;
  color: #94a3b8;
  font-size: 22rpx;
  text-align: right;
}

.photo-add {
  width: 112rpx;
  height: 56rpx;
  margin: 0;
  border-radius: 8rpx;
  background: #1f7a68;
  color: #ffffff;
  font-size: 24rpx;
  line-height: 56rpx;
}

.photo-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12rpx;
}

.photo-cell {
  position: relative;
  aspect-ratio: 1;
  overflow: hidden;
  border-radius: 8rpx;
  background: #f1f5f9;
}

.photo-image {
  width: 100%;
  height: 100%;
}

.photo-remove {
  position: absolute;
  right: 8rpx;
  bottom: 8rpx;
  width: 76rpx;
  height: 42rpx;
  margin: 0;
  padding: 0;
  border-radius: 6rpx;
  background: rgba(15, 23, 42, 0.72);
  color: #ffffff;
  font-size: 20rpx;
  line-height: 42rpx;
}
</style>
