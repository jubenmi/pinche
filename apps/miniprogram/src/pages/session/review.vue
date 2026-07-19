<template>
  <view class="page review-page">
    <AuthIdentityBar />
    <FeedbackHost />

    <view class="review-intro">
      <view class="title">写记录</view>
      <view class="text">到发车时间后，你可以留下自己的星级、文字和相册素材。</view>
      <t-notice-bar
        v-if="statusText"
        class="notice"
        theme="warning"
        :visible="true"
        :content="statusText"
      />
    </view>

    <view class="section rating-section">
      <view class="section-title rating-title">星级</view>
      <view class="rating-row">
        <t-button
          v-for="value in [1, 2, 3, 4, 5]"
          :key="value"
          class="rating-button"
          :class="{ active: rating >= value }"
          :disabled="saving || !canEditDraft"
          @tap="rating = value"
        >
          <t-icon
            name="star-filled"
            size="50rpx"
            :color="rating >= value ? '#e4a313' : '#d5d0c7'"
          />
        </t-button>
      </view>
    </view>

    <view class="section writing-section">
      <view class="section-title">文字记录</view>
      <view class="textarea-shell">
        <t-textarea
          :value="content"
          class="textarea"
          maxlength="900"
          placeholder="这一场最让我难忘的是……"
          placeholder-class="placeholder"
          :disabled="saving || !canEditDraft"
          @input="onContentChange"
          @change="onContentChange"
        />
        <view class="counter">{{ content.length }}/900</view>
      </view>
    </view>

    <view class="section photo-section">
      <view class="section-title photo-title">
        照片 <text class="section-title-note">（最多 9 张）</text>
      </view>

      <view class="source-switch" :class="{ single: !hasAlbumSourceOption }">
        <view
          v-if="hasAlbumSourceOption"
          class="source-option"
          :class="{ active: photoState.source === 'album' }"
          @tap="selectPhotoSource('album')"
        >
          从本场相册选择
        </view>
        <view
          class="source-option"
          :class="{ active: photoState.source === 'upload' }"
          @tap="selectPhotoSource('upload')"
        >
          从手机上传
        </view>
      </view>

      <view class="photo-help">两种方式只能选一种 · 本地上传后自动加入本场相册</view>

      <view v-if="displayPhotos.length" class="photo-grid">
        <view v-for="(photo, index) in displayPhotos" :key="photo.key" class="photo-cell">
          <t-image class="photo-image" :src="photo.url" mode="aspectFill" />
          <t-button
            v-if="!photo.legacy"
            class="photo-remove"
            :disabled="saving || !canEditDraft"
            @tap="removeSelectedPhoto(photo.id)"
          >
            移除
          </t-button>
        </view>
      </view>

      <view v-if="photoState.legacyPhotoUrls.length" class="legacy-note">
        历史照片会继续保留；选择新的照片来源后将整体替换。
      </view>

      <view class="photo-count-row" @tap="openCurrentPhotoAction">
        <view class="photo-count">已选 {{ selectedPhotoCount }}/9 张</view>
        <view class="photo-count-action">{{ photoCountActionText }}</view>
      </view>
    </view>

    <view class="bottom-action review-bottom-action">
      <view class="share-help">发布后可分享给好友、群聊或朋友圈</view>
      <view :class="{ 'action-grid': activeDraft }">
        <t-button
          v-if="activeDraft"
          class="button secondary"
          :disabled="saving"
          @tap="cancelDraft"
        >
          取消这版
        </t-button>
        <t-button
          class="button publish-button"
          :class="{ disabled: saving || !canSave }"
          :custom-style="publishButtonStyle"
          :disabled="saving || !canSave"
          @tap="saveReview"
        >
          {{ saving ? "发布中..." : activeDraft?.can_resubmit ? "重新发布" : "发布并分享" }}
        </t-button>
      </view>
    </view>

    <t-popup
      :visible="albumPickerVisible"
      placement="bottom"
      :close-on-overlay-click="true"
      @visible-change="handleAlbumPickerVisibleChange"
    >
      <view class="album-picker" @tap.stop>
        <view class="sheet-bar"></view>
        <view class="album-picker-head">
          <view>
            <view class="album-picker-title">从本场相册选择</view>
            <view class="album-picker-note">最多选择 9 张当前可用照片</view>
          </view>
          <t-button class="album-picker-done" @tap="closeAlbumPicker">完成</t-button>
        </view>
        <scroll-view scroll-y class="album-picker-scroll">
          <view class="album-picker-grid">
            <view
              v-for="photo in albumPhotos"
              :key="photo.id"
              class="album-picker-cell"
              :class="{ selected: isAlbumPhotoSelected(photo.id) }"
              @tap="toggleAlbumPhoto(photo.id)"
            >
              <t-image class="album-picker-image" :src="albumPhotoUrl(photo)" mode="aspectFill" />
              <view v-if="isAlbumPhotoSelected(photo.id)" class="selected-mark">已选</view>
            </view>
          </view>
        </scroll-view>
        <view class="album-picker-footer">已选 {{ photoState.selectedAlbumPhotoIds.length }}/9 张</view>
      </view>
    </t-popup>
  </view>
</template>

<script>
import { isModerationPublished } from "@pinche/shared";
import AuthIdentityBar from "../../components/AuthIdentityBar.vue";
import FeedbackHost from "../../components/TDesignFeedbackHost.vue";
import { uploadAlbumPhoto } from "../../utils/albumPhotoUpload";
import {
  assetUrl,
  dataOf,
  ensureLoggedIn,
  request
} from "../../utils/api";
import {
  buildSessionReviewPhotoRequest,
  createSessionReviewPhotoState,
  switchSessionReviewPhotoSource,
  toggleSessionReviewAlbumPhoto
} from "../../utils/sessionReviewPhotos";
import {
  contentModerationErrorText,
  contentModerationStatusText
} from "../../utils/contentModeration";
import {
  authorPrivateStatusText,
  isAuthorPrivateText
} from "../../utils/authorPrivateText";
import { showModal, showToast } from "../../utils/tdesignFeedback";

export default {
  components: { AuthIdentityBar, FeedbackHost },
  data() {
    return {
      sessionId: "",
      canReview: false,
      rating: 5,
      content: "",
      albumPhotos: [],
      photoState: createSessionReviewPhotoState(),
      albumPickerVisible: false,
      pendingPhotoCount: 0,
      activeDraft: null,
      statusText: "",
      saving: false
    };
  },
  computed: {
    canSave() {
      return this.canReview && this.rating >= 1 && this.rating <= 5 &&
        this.content.length <= 900 && this.canEditDraft;
    },
    canEditDraft() {
      return !this.activeDraft || this.activeDraft.can_edit === true;
    },
    publishButtonStyle() {
      const shared = "width: 100%; height: 94rpx; min-height: 94rpx; color: #ffffff; font-size: 31rpx;";
      if (this.saving || !this.canSave) {
        return `${shared} border-color: #aeb8b1; background: #aeb8b1; --td-button-default-bg-color: #aeb8b1; --td-button-default-color: #ffffff; --td-button-default-border-color: #aeb8b1;`;
      }
      return `${shared} border-color: #1a5d4d; background: linear-gradient(145deg, #1a5d4d 0%, #2b765f 100%); --td-button-default-bg-color: #1f6f5b; --td-button-default-color: #ffffff; --td-button-default-border-color: #1a5d4d;`;
    },
    hasAlbumSourceOption() {
      return this.albumPhotos.length > 0;
    },
    albumPhotosById() {
      return new Map(this.albumPhotos.map((photo) => [Number(photo.id), photo]));
    },
    selectedPhotos() {
      return this.photoState.selectedAlbumPhotoIds
        .map((id) => this.albumPhotosById.get(Number(id)))
        .filter(Boolean);
    },
    displayPhotos() {
      if (this.photoState.selectedAlbumPhotoIds.length) {
        return this.selectedPhotos.map((photo) => ({
          id: Number(photo.id),
          key: `album-${photo.id}`,
          url: this.albumPhotoUrl(photo),
          legacy: false
        }));
      }
      return this.photoState.legacyPhotoUrls.map((url, index) => ({
        id: null,
        key: `legacy-${index}-${url}`,
        url: assetUrl(url),
        legacy: true
      }));
    },
    selectedPhotoCount() {
      return this.photoState.selectedAlbumPhotoIds.length || this.photoState.legacyPhotoUrls.length;
    },
    photoCountActionText() {
      if (this.photoState.source === "album") return "继续选择";
      if (this.photoState.source === "upload") return "继续上传";
      return "";
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
    await Promise.all([this.loadMyReview(), this.loadReviewAlbum()]);
  },
  methods: {
    assetUrl,
    onContentChange(event) {
      this.content = String(event?.detail?.value ?? event?.detail ?? "").slice(0, 900);
    },
    isSelectableAlbumPhoto(photo) {
      return Boolean(
        photo &&
        Number(photo.id) > 0 &&
        photo.media_type !== "video" &&
        String(photo.status || "active") === "active" &&
        String(photo.processing_status || "ready") === "ready" &&
        isModerationPublished(photo.moderation_status)
      );
    },
    albumPhotoUrl(photo) {
      const path = photo?.thumbnail_display_url || photo?.thumbnail_load_url ||
        photo?.thumbnail_url || photo?.preview_display_url || photo?.preview_load_url ||
        photo?.preview_url || photo?.image_url || photo?.display_url || "";
      return assetUrl(path);
    },
    async loadMyReview() {
      if (!this.sessionId) {
        this.statusText = "请从车详情或我的车局进入记录页。";
        return;
      }
      try {
        const response = await request({ url: `/api/sessions/${this.sessionId}/review` });
        const data = dataOf(response) || {};
        this.canReview = Boolean(data.can_review);
        this.statusText = this.canReview ? "" : "到发车时间后，已上车玩家可以写记录。";
        if (!data.review) {
          this.activeDraft = null;
          this.photoState = createSessionReviewPhotoState();
          return;
        }
        this.rating = Number(data.review.rating || 5);
        this.content = String(data.review.content || "").slice(0, 900);
        this.photoState = createSessionReviewPhotoState({
          albumPhotoIds: data.review.album_photo_ids || [],
          legacyPhotoUrls: data.review.photos || []
        });
        this.activeDraft = isAuthorPrivateText(data.review.author_private)
          ? data.review.author_private
          : null;
        if (this.activeDraft) this.statusText = authorPrivateStatusText(this.activeDraft);
      } catch (error) {
        this.statusText = "记录加载失败，请稍后重试。";
      }
    },
    async loadReviewAlbum() {
      if (!this.sessionId) return;
      try {
        const response = await request({ url: `/api/sessions/${this.sessionId}/album` });
        const data = dataOf(response) || {};
        this.albumPhotos = (data.photos || []).filter((photo) => this.isSelectableAlbumPhoto(photo));
      } catch (error) {
        this.albumPhotos = [];
      }
    },
    hasCurrentPhotoSelection() {
      return this.photoState.selectedAlbumPhotoIds.length > 0 ||
        this.photoState.legacyPhotoUrls.length > 0;
    },
    selectPhotoSource(source) {
      if (this.saving || !this.canEditDraft) return;
      const switchNeeded = this.photoState.source !== source;
      if (switchNeeded && this.hasCurrentPhotoSelection()) {
        showModal({
          title: "切换照片来源",
          content: "两种方式只能选一种。切换后，当前已选照片会被清空。",
          confirmText: "切换",
          cancelText: "取消",
          success: (result) => {
            if (result.confirm) this.applyPhotoSource(source);
          }
        });
        return;
      }
      this.applyPhotoSource(source);
    },
    applyPhotoSource(source) {
      this.pendingPhotoCount = 0;
      this.photoState = switchSessionReviewPhotoSource(this.photoState, source);
      if (source === "album") {
        this.albumPickerVisible = true;
      } else {
        this.choosePhonePhotos();
      }
    },
    openCurrentPhotoAction() {
      if (this.photoState.source === "album") this.albumPickerVisible = true;
      if (this.photoState.source === "upload") this.choosePhonePhotos();
    },
    handleAlbumPickerVisibleChange(event) {
      const visible = Boolean(event?.detail?.visible ?? event?.detail);
      this.albumPickerVisible = visible;
    },
    closeAlbumPicker() {
      this.albumPickerVisible = false;
    },
    isAlbumPhotoSelected(photoId) {
      return this.photoState.selectedAlbumPhotoIds.includes(Number(photoId));
    },
    toggleAlbumPhoto(photoId) {
      try {
        this.photoState = toggleSessionReviewAlbumPhoto(this.photoState, photoId);
      } catch (error) {
        showToast({ title: "最多选择9张照片", icon: "none" });
      }
    },
    removeSelectedPhoto(photoId) {
      if (!this.isAlbumPhotoSelected(photoId)) return;
      this.photoState = toggleSessionReviewAlbumPhoto(this.photoState, photoId);
    },
    choosePhonePhotos() {
      const remaining = 9 - this.photoState.selectedAlbumPhotoIds.length;
      if (remaining <= 0) {
        showToast({ title: "最多上传9张照片", icon: "none" });
        return;
      }
      uni.chooseImage({
        count: remaining,
        sizeType: ["compressed"],
        sourceType: ["album", "camera"],
        success: async (result) => {
          const items = result.tempFiles?.length
            ? result.tempFiles
            : (result.tempFilePaths || []).map((path) => ({ path }));
          await this.uploadChosenPhotos(items);
        }
      });
    },
    photoFileInfo(item) {
      const filePath = item?.tempFilePath || item?.path || item?.filePath || "";
      const knownSize = Number(item?.size || 0);
      const contentType = /\.png(?:$|[?#])/i.test(filePath) ? "image/png" : "image/jpeg";
      if (knownSize > 0 || typeof uni.getFileInfo !== "function") {
        return Promise.resolve({ filePath, fileSize: knownSize, contentType });
      }
      return new Promise((resolve) => {
        uni.getFileInfo({
          filePath,
          success: (result) => resolve({ filePath, fileSize: Number(result.size || 0), contentType }),
          fail: () => resolve({ filePath, fileSize: 0, contentType })
        });
      });
    },
    async uploadChosenPhotos(items) {
      if (!items.length) return;
      this.saving = true;
      this.pendingPhotoCount = 0;
      let failedCount = 0;
      try {
        for (const [index, item] of items.entries()) {
          if (this.photoState.selectedAlbumPhotoIds.length >= 9) break;
          this.statusText = `正在上传照片 ${index + 1}/${items.length}...`;
          try {
            const prepared = await this.photoFileInfo(item);
            if (!prepared.filePath || !prepared.fileSize) throw new Error("photo size unavailable");
            const result = await uploadAlbumPhoto({
              sessionId: this.sessionId,
              ...prepared
            });
            const photo = result?.photo;
            if (this.isSelectableAlbumPhoto(photo)) {
              const photoId = Number(photo.id);
              this.albumPhotos = [
                photo,
                ...this.albumPhotos.filter((entry) => Number(entry.id) !== photoId)
              ];
              if (!this.isAlbumPhotoSelected(photoId)) {
                this.photoState = toggleSessionReviewAlbumPhoto(this.photoState, photoId);
              }
            } else {
              this.pendingPhotoCount += 1;
            }
          } catch (error) {
            failedCount += 1;
          }
        }
        if (this.pendingPhotoCount > 0) {
          this.statusText = contentModerationStatusText("review");
        } else if (failedCount > 0) {
          this.statusText = `${failedCount} 张照片上传失败，请稍后重试。`;
        } else {
          this.statusText = "";
        }
        await this.loadReviewAlbum();
      } finally {
        this.saving = false;
      }
    },
    async saveReview() {
      if (!this.canSave || this.saving) return;
      if (this.pendingPhotoCount > 0) {
        this.statusText = contentModerationStatusText("review");
        return;
      }
      this.saving = true;
      this.statusText = "正在发布记录...";
      try {
        const response = await request({
          url: `/api/sessions/${this.sessionId}/review`,
          method: "PUT",
          data: {
            rating: this.rating,
            content: this.content.trim(),
            ...buildSessionReviewPhotoRequest(this.photoState),
            ...(this.activeDraft?.can_resubmit
              ? { replaces_draft_id: this.activeDraft.draft_id }
              : {})
          }
        });
        const result = dataOf(response);
        if (isAuthorPrivateText(result)) {
          this.activeDraft = result;
          this.statusText = authorPrivateStatusText(result);
          showToast({ title: this.statusText, icon: "none" });
          return;
        }
        const reviewId = Number(result?.id || 0);
        this.activeDraft = null;
        showToast({ title: "记录已发布", icon: "success" });
        if (reviewId) {
          uni.redirectTo({
            url: `/pages/session/review-share?id=${reviewId}&published=1`
          });
        } else {
          this.statusText = "记录已发布，可从车局详情查看。";
        }
      } catch (error) {
        const moderationMessage = contentModerationErrorText(error);
        if (moderationMessage) {
          this.statusText = moderationMessage;
          return;
        }
        if (error?.statusCode === 403) {
          this.statusText = "只有已上车玩家可以写记录。";
        } else if (error?.statusCode === 400) {
          this.statusText = "请检查星级、文字和所选照片后再发布。";
        } else {
          this.statusText = "记录发布失败，请稍后重试。";
        }
      } finally {
        this.saving = false;
      }
    },
    async cancelDraft() {
      if (!this.activeDraft || this.saving) return;
      this.saving = true;
      try {
        await request({
          url: `/api/content-moderation/author-drafts/${this.activeDraft.draft_id}`,
          method: "DELETE"
        });
        this.activeDraft = null;
        await this.loadMyReview();
        showToast({ title: "已取消这版内容", icon: "none" });
      } catch (error) {
        this.statusText = error?.userMessage || "取消失败，请稍后重试。";
      } finally {
        this.saving = false;
      }
    }
  }
};
</script>

<style scoped>
.review-page {
  padding-bottom: 250rpx;
}

.review-intro {
  padding: 18rpx 16rpx 30rpx;
  text-align: center;
}

.review-intro .title {
  margin-bottom: 18rpx;
  font-size: 54rpx;
}

.review-intro .text {
  font-size: 27rpx;
}

.notice {
  margin-top: 20rpx;
  padding: 16rpx;
  border-radius: 10rpx;
  background: #eef7f4;
  color: #1f6e5b;
  font-size: 24rpx;
  line-height: 1.5;
  text-align: left;
}

.section {
  margin-bottom: 24rpx;
  padding: 30rpx;
  border-radius: 16rpx;
}

.section-title {
  margin-bottom: 22rpx;
  color: #0f5141;
  font-size: 31rpx;
  font-weight: 600;
}

.section-title-note {
  color: #747b78;
  font-size: 26rpx;
  font-weight: 400;
}

.rating-section {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 108rpx;
}

.rating-title {
  margin-bottom: 0;
}

.rating-row {
  display: flex;
  align-items: center;
  gap: 5rpx;
}

.rating-button {
  width: 66rpx;
  min-width: 66rpx;
  height: 66rpx;
  margin: 0;
  padding: 0;
  border-radius: 0;
  background: transparent;
  color: #d5d0c7;
  font-size: 50rpx;
  line-height: 66rpx;
  box-shadow: none;
}

.rating-button.active {
  background: transparent;
  color: #e4a313;
}

.textarea-shell {
  position: relative;
  overflow: hidden;
  border: 1rpx solid #ded8ca;
  border-radius: 14rpx;
  background: #fffefb;
}

.textarea {
  box-sizing: border-box;
  width: 100%;
  min-height: 340rpx;
  padding: 24rpx 24rpx 58rpx;
  color: #4e5552;
  font-size: 28rpx;
  line-height: 1.7;
  background: transparent;
}

.placeholder {
  color: #8a8d8b;
}

.counter {
  position: absolute;
  right: 24rpx;
  bottom: 18rpx;
  color: #777b79;
  font-size: 24rpx;
}

.source-switch {
  display: grid;
  grid-template-columns: 1fr 1fr;
  overflow: hidden;
  border: 1rpx solid #d9d3c8;
  border-radius: 12rpx;
}

.source-switch.single {
  grid-template-columns: 1fr;
}

.source-option {
  height: 72rpx;
  color: #737875;
  font-size: 27rpx;
  line-height: 72rpx;
  text-align: center;
  background: #fffefb;
}

.source-option + .source-option {
  border-left: 1rpx solid #d9d3c8;
}

.source-option.active {
  color: #0f5b49;
  background: #f4faf7;
  box-shadow: inset 0 0 0 1rpx #4b8a78;
}

.photo-help {
  margin: 14rpx 0 22rpx;
  color: #777d79;
  font-size: 23rpx;
  line-height: 1.5;
}

.photo-grid,
.album-picker-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12rpx;
}

.photo-cell,
.album-picker-cell {
  position: relative;
  aspect-ratio: 1;
  overflow: hidden;
  border-radius: 12rpx;
  background: #f0eee8;
}

.photo-image,
.album-picker-image {
  width: 100%;
  height: 100%;
}

.photo-remove {
  position: absolute;
  right: 8rpx;
  bottom: 8rpx;
  width: 78rpx;
  height: 42rpx;
  margin: 0;
  padding: 0;
  border-radius: 8rpx;
  background: rgba(18, 56, 47, 0.82);
  color: #ffffff;
  font-size: 20rpx;
  line-height: 42rpx;
}

.legacy-note {
  margin-top: 16rpx;
  color: #7d7160;
  font-size: 22rpx;
  line-height: 1.5;
}

.photo-count-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 62rpx;
  margin-top: 14rpx;
}

.photo-count {
  color: #0f5b49;
  font-size: 27rpx;
  font-weight: 600;
}

.photo-count-action {
  color: #737875;
  font-size: 24rpx;
}

.review-bottom-action {
  right: 0;
  bottom: 0;
  left: 0;
  padding: 20rpx 30rpx calc(28rpx + env(safe-area-inset-bottom));
  background: rgba(251, 250, 246, 0.97);
  border-top: 1rpx solid rgba(222, 215, 202, 0.72);
}

.share-help {
  margin-bottom: 14rpx;
  color: #777d79;
  font-size: 24rpx;
  text-align: center;
}

.publish-button {
  height: 94rpx;
  font-size: 31rpx;
}

.album-picker {
  padding: 18rpx 28rpx calc(30rpx + env(safe-area-inset-bottom));
  border-radius: 28rpx 28rpx 0 0;
  background: #fbfaf6;
}

.sheet-bar {
  width: 72rpx;
  height: 7rpx;
  margin: 0 auto 22rpx;
  border-radius: 999rpx;
  background: #d4d0c7;
}

.album-picker-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20rpx;
  margin-bottom: 22rpx;
}

.album-picker-title {
  color: #12382f;
  font-size: 31rpx;
  font-weight: 600;
}

.album-picker-note {
  margin-top: 6rpx;
  color: #777d79;
  font-size: 22rpx;
}

.album-picker-done {
  width: 106rpx;
  height: 58rpx;
  margin: 0;
  border-radius: 10rpx;
  background: #17614f;
  color: #ffffff;
  font-size: 24rpx;
  line-height: 58rpx;
}

.album-picker-scroll {
  max-height: 640rpx;
}

.album-picker-cell {
  border: 4rpx solid transparent;
  box-sizing: border-box;
}

.album-picker-cell.selected {
  border-color: #17614f;
}

.selected-mark {
  position: absolute;
  right: 8rpx;
  bottom: 8rpx;
  padding: 4rpx 10rpx;
  border-radius: 999rpx;
  background: #17614f;
  color: #ffffff;
  font-size: 19rpx;
}

.album-picker-footer {
  margin-top: 20rpx;
  color: #0f5b49;
  font-size: 26rpx;
  font-weight: 600;
  text-align: center;
}
</style>
