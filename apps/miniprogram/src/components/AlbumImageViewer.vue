<template>
  <view
    v-if="visible"
    class="album-image-viewer"
    @touchstart="handleTouchStart"
    @touchmove.stop="handleTouchMove"
    @touchend="handleTouchEnd"
    @tap.stop
  >
    <swiper
      v-for="generation in swiperGenerations"
      :key="generation"
      class="album-image-viewer__swiper"
      :current="swiperIndex"
      :data-generation="generation"
      :duration="swiperDuration"
      @change="handleSwiperChange"
      @animationfinish="handleSwiperAnimationFinish"
    >
      <swiper-item
        v-for="(photo, windowIndex) in windowPhotos"
        :key="photoKey(photo, logicalIndexForWindowIndex(windowIndex))"
        class="album-image-viewer__item"
      >
        <view
          class="album-image-viewer__slide"
          :class="{ 'album-image-viewer__slide--with-primary-action': primaryActionLabel }"
        >
          <image
            v-if="isImage(photo) && thumbnailUrl(photo) && !thumbnailFailed(photo)"
            class="album-image-viewer__image album-image-viewer__image--thumbnail"
            :src="thumbnailUrl(photo)"
            mode="aspectFit"
            @load="handleThumbnailLoad(photo)"
            @error="handleThumbnailError(photo)"
          />
          <image
            v-if="isImage(photo) && previewCanLoad(photo) && !previewFailed(photo)"
            class="album-image-viewer__image album-image-viewer__image--preview"
            :class="{ loaded: previewLoaded(photo) }"
            :src="previewUrl(photo)"
            mode="aspectFit"
            @load="handlePreviewLoad(photo)"
            @error="handlePreviewError(photo)"
          />
          <view v-if="isVideo(photo)" class="album-image-viewer__video-shell">
            <image
              v-if="videoPosterUrl(photo)"
              class="album-image-viewer__video-poster"
              :src="videoPosterUrl(photo)"
              mode="aspectFit"
            />
            <video
              v-if="isActiveVideo(logicalIndexForWindowIndex(windowIndex)) && videoUrl(photo)"
              :id="videoDomId(photo, logicalIndexForWindowIndex(windowIndex))"
              class="album-image-viewer__video"
              :src="videoUrl(photo)"
              :controls="true"
              :autoplay="false"
              object-fit="contain"
              @error="handleVideoError(photo)"
            />
            <view v-if="showVideoLoading(photo)" class="album-image-viewer__video-status">
              视频加载中
            </view>
            <view
              v-if="showVideoFailed(photo)"
              class="album-image-viewer__fallback album-image-viewer__video-retry"
              @tap.stop="retryVideo(photo)"
            >
              视频加载失败，点击重试
            </view>
          </view>
          <view v-if="isImage(photo) && showLoading(photo)" class="album-image-viewer__loading">
            <view class="album-image-viewer__loading-card">
              <view class="album-image-viewer__loading-dot"></view>
              <view class="album-image-viewer__loading-text">{{ loadingProgressText(photo) }}</view>
              <view class="album-image-viewer__loading-progress">
                <view
                  class="album-image-viewer__loading-progress-bar"
                  :style="loadingProgressStyle(photo)"
                ></view>
              </view>
            </view>
          </view>
          <view v-if="isImage(photo) && showPreviewFailed(photo)" class="album-image-viewer__status">
            展示图加载失败
          </view>
          <view v-if="isImage(photo) && showFallback(photo)" class="album-image-viewer__fallback">
            图片加载失败
          </view>
        </view>
      </swiper-item>
    </swiper>

    <view class="album-image-viewer__topbar">
      <view v-if="showCounter" class="album-image-viewer__counter">{{ counterText }}</view>
      <view class="album-image-viewer__actions">
        <button
          v-if="shareStatus === 'ready' && currentPhoto"
          class="album-image-viewer__icon-button album-image-viewer__share-button"
          open-type="share"
          :data-media-id="currentPhoto.id"
          aria-label="分享"
          @tap.stop
        >
          <t-image
            class="album-image-viewer__share-icon"
            src="/static/icons/share-light.svg"
            mode="aspectFit"
            width="32rpx"
            height="32rpx"
          />
        </button>
        <view
          v-else-if="shareStatus !== 'hidden' && currentPhoto"
          class="album-image-viewer__icon-button"
          :class="{ 'album-image-viewer__icon-button--disabled': ['blocked', 'failed'].includes(shareStatus) }"
          aria-role="button"
          aria-label="分享状态"
          @tap.stop="$emit('share-status-tap', { mediaId: currentPhoto.id, status: shareStatus })"
        >
          <t-image
            class="album-image-viewer__share-icon"
            src="/static/icons/share-light.svg"
            mode="aspectFit"
            width="32rpx"
            height="32rpx"
          />
        </view>
        <view
          v-if="allowDownload"
          class="album-image-viewer__icon-button"
          aria-role="button"
          aria-label="下载"
          @tap.stop="requestDownload('button')"
        >
          ↓
        </view>
        <view
          class="album-image-viewer__icon-button close"
          aria-role="button"
          aria-label="关闭"
          @tap.stop="close"
        >
          ×
        </view>
      </view>
    </view>
    <view
      v-if="primaryActionLabel"
      class="album-image-viewer__primary-action"
      aria-role="button"
      :aria-label="primaryActionLabel"
      @tap.stop="$emit('primary-action', { photo: currentPhoto })"
    >
      {{ primaryActionLabel }}
    </view>
  </view>
</template>

<script>
const ALBUM_VIEWER_WINDOW_SIZE = 5;

export default {
  props: {
    visible: {
      type: Boolean,
      default: false
    },
    photos: {
      type: Array,
      default: () => []
    },
    initialIndex: {
      type: Number,
      default: 0
    },
    allowDownload: {
      type: Boolean,
      default: false
    },
    shareStatus: {
      type: String,
      default: "hidden"
    },
    showCounter: {
      type: Boolean,
      default: true
    },
    primaryActionLabel: {
      type: String,
      default: ""
    },
    mediaProgress: {
      type: Object,
      default: () => ({})
    }
  },
  data() {
    return {
      currentIndex: 0,
      swiperIndex: 0,
      windowStart: 0,
      activeWindowIndex: 0,
      swiperGeneration: 0,
      internalRebaseGeneration: null,
      pendingWindowRebase: null,
      touchStartX: 0,
      touchStartY: 0,
      previewLoadedById: {},
      previewFailedById: {},
      thumbnailLoadedById: {},
      thumbnailFailedById: {},
      videoFailedById: {}
    };
  },
  computed: {
    swiperGenerations() {
      return [this.swiperGeneration];
    },
    swiperDuration() {
      return this.internalRebaseGeneration === this.swiperGeneration ? 0 : 220;
    },
    windowPhotos() {
      return this.photos.slice(
        this.windowStart,
        this.windowStart + ALBUM_VIEWER_WINDOW_SIZE
      );
    },
    currentPhoto() {
      return this.photos[this.currentIndex] || null;
    },
    counterText() {
      if (!this.photos.length) {
        return "";
      }
      return `${this.currentIndex + 1}/${this.photos.length}`;
    }
  },
  watch: {
    visible(nextValue, previousValue) {
      if (nextValue && !previousValue) {
        this.resetImageStates();
        this.syncInitialIndex(false);
        this.$nextTick(() => this.requestCurrentVideoIfNeeded());
      }
      if (!nextValue) {
        this.pendingWindowRebase = null;
        this.internalRebaseGeneration = null;
        if (previousValue) {
          this.swiperGeneration += 1;
        }
        this.touchStartX = 0;
        this.touchStartY = 0;
        this.pauseAllVideos();
      }
    },
    initialIndex() {
      if (this.visible) {
        this.syncInitialIndex(true);
        this.$nextTick(() => this.requestCurrentVideoIfNeeded());
      }
    },
    photos(nextPhotos, previousPhotos) {
      // Structural list changes replace the array; in-place item writes are media hydration
      // and intentionally must not rebuild the native swiper generation.
      if (this.visible) {
        this.syncCurrentIndexAfterPhotosChange(nextPhotos, previousPhotos);
        this.$nextTick(() => this.requestCurrentVideoIfNeeded());
      }
    }
  },
  methods: {
    clampIndex(index) {
      const maxIndex = Math.max(0, this.photos.length - 1);
      const parsed = Number(index);
      if (!Number.isFinite(parsed)) {
        return 0;
      }
      return Math.min(Math.max(0, Math.trunc(parsed)), maxIndex);
    },
    windowStartForIndex(index) {
      const logicalIndex = this.clampIndex(index);
      const maxStart = Math.max(0, this.photos.length - ALBUM_VIEWER_WINDOW_SIZE);
      const centeredStart = logicalIndex - Math.floor(ALBUM_VIEWER_WINDOW_SIZE / 2);
      return Math.min(Math.max(0, centeredStart), maxStart);
    },
    clampWindowIndex(index) {
      const maxIndex = Math.max(0, this.windowPhotos.length - 1);
      const parsed = Number(index);
      if (!Number.isFinite(parsed)) {
        return 0;
      }
      return Math.min(Math.max(0, Math.trunc(parsed)), maxIndex);
    },
    logicalIndexForWindowIndex(windowIndex) {
      return this.clampIndex(this.windowStart + this.clampWindowIndex(windowIndex));
    },
    logicalIndexForPhoto(photo) {
      if (!photo) {
        return -1;
      }
      const exactIndex = this.photos.indexOf(photo);
      if (exactIndex >= 0) {
        return exactIndex;
      }
      if (photo.id === undefined || photo.id === null) {
        return -1;
      }
      const key = String(photo.id);
      const index = this.photos.findIndex((item) => String(item?.id) === key);
      return index;
    },
    rebuildWindowAt(logicalIndex, { force = false, internalRebase = false } = {}) {
      const nextIndex = this.clampIndex(logicalIndex);
      const nextWindowStart = this.windowStartForIndex(nextIndex);
      const nextWindowIndex = nextIndex - nextWindowStart;
      const stateChanged =
        this.currentIndex !== nextIndex ||
        this.windowStart !== nextWindowStart ||
        this.activeWindowIndex !== nextWindowIndex ||
        this.swiperIndex !== nextWindowIndex;

      this.pendingWindowRebase = null;
      this.currentIndex = nextIndex;
      this.windowStart = nextWindowStart;
      this.activeWindowIndex = nextWindowIndex;
      this.swiperIndex = nextWindowIndex;
      if (force || stateChanged) {
        const nextGeneration = this.swiperGeneration + 1;
        this.internalRebaseGeneration = internalRebase ? nextGeneration : null;
        this.swiperGeneration = nextGeneration;
      }
    },
    syncInitialIndex(shouldPausePrevious = false) {
      const nextIndex = this.clampIndex(this.initialIndex);
      if (shouldPausePrevious && nextIndex !== this.currentIndex) {
        this.pauseVideoAt(this.currentIndex);
      }
      this.rebuildWindowAt(nextIndex);
    },
    photoIdentityKey(photo, index) {
      if (!photo) {
        return "";
      }
      if (photo.id !== undefined && photo.id !== null) {
        return "id:" + String(photo.id);
      }
      return "index:" + String(index);
    },
    samePhotoStructure(nextPhotos = [], previousPhotos = []) {
      if (nextPhotos === previousPhotos) {
        return true;
      }
      if (nextPhotos.length !== previousPhotos.length) {
        return false;
      }
      return nextPhotos.every(
        (photo, index) =>
          this.photoIdentityKey(photo, index) ===
          this.photoIdentityKey(previousPhotos[index], index)
      );
    },
    syncCurrentIndexAfterPhotosChange(nextPhotos = [], previousPhotos = []) {
      if (this.samePhotoStructure(nextPhotos, previousPhotos)) {
        return;
      }

      const previousIndex = this.currentIndex;
      const previousPhoto = previousPhotos[previousIndex] || null;
      const previousIdentity = this.photoIdentityKey(previousPhoto, previousIndex);
      let nextIndex = -1;
      if (previousIdentity) {
        nextIndex = nextPhotos.findIndex(
          (photo, index) =>
            this.photoIdentityKey(photo, index) === previousIdentity
        );
      }
      if (nextIndex < 0) {
        nextIndex = this.clampIndex(previousIndex);
      }

      const nextPhoto = nextPhotos[nextIndex] || null;
      const nextIdentity = this.photoIdentityKey(nextPhoto, nextIndex);
      if (previousPhoto && previousIdentity !== nextIdentity) {
        this.pauseVideoPhoto(previousPhoto, previousIndex);
      }
      this.rebuildWindowAt(nextIndex, { force: true });
    },
    resetImageStates() {
      this.previewLoadedById = {};
      this.previewFailedById = {};
      this.thumbnailLoadedById = {};
      this.thumbnailFailedById = {};
      this.videoFailedById = {};
    },
    photoKey(photo, index) {
      if (photo && photo.id !== undefined && photo.id !== null) {
        return String(photo.id);
      }
      return `photo-${index}`;
    },
    photoStateKey(photo) {
      if (photo && photo.id !== undefined && photo.id !== null) {
        return String(photo.id);
      }
      return this.previewUrl(photo) || this.thumbnailUrl(photo) || "";
    },
    isVideo(photo) {
      return photo?.media_type === "video";
    },
    isImage(photo) {
      return !this.isVideo(photo);
    },
    isActiveVideo(index) {
      return index === this.currentIndex;
    },
    thumbnailUrl(photo) {
      if (this.isVideo(photo)) {
        return photo?.thumbnail_display_url || photo?.cover_url || "";
      }
      const thumbnail = photo?.thumbnail_display_url || "";
      const preview = this.previewUrl(photo);
      return thumbnail && thumbnail !== preview ? thumbnail : "";
    },
    previewUrl(photo) {
      return photo?.preview_display_url || "";
    },
    videoUrl(photo) {
      return photo?.video_display_url || "";
    },
    videoPosterUrl(photo) {
      return this.thumbnailUrl(photo) || "";
    },
    videoDomId(photo, index) {
      const key =
        photo && photo.id !== undefined && photo.id !== null ? String(photo.id) : String(index);
      return `album-image-viewer-video-${key}`;
    },
    previewCanLoad(photo) {
      return Boolean(
        this.previewUrl(photo) &&
          (!this.thumbnailUrl(photo) || this.thumbnailLoaded(photo) || this.thumbnailFailed(photo))
      );
    },
    progressState(photo, variant = "preview") {
      const key = this.photoStateKey(photo);
      return key ? this.mediaProgress[`${key}:${variant}`] || null : null;
    },
    activeProgressState(photo) {
      const thumbnailProgress = this.progressState(photo, "thumbnail");
      if (thumbnailProgress?.loading || Number(thumbnailProgress?.progress || 0) > 0) {
        return thumbnailProgress;
      }
      return null;
    },
    loadingProgressValue(photo) {
      const progress = Number(this.activeProgressState(photo)?.progress || 0);
      if (!Number.isFinite(progress)) {
        return 0;
      }
      return Math.min(100, Math.max(0, Math.round(progress)));
    },
    loadingProgressText(photo) {
      const progress = this.loadingProgressValue(photo);
      return progress > 0 ? `加载中 ${progress}%` : "加载中";
    },
    loadingProgressStyle(photo) {
      return `width:${this.loadingProgressValue(photo)}%;`;
    },
    previewLoaded(photo) {
      return Boolean(this.previewLoadedById[this.photoStateKey(photo)]);
    },
    previewFailed(photo) {
      return Boolean(this.previewFailedById[this.photoStateKey(photo)]);
    },
    thumbnailLoaded(photo) {
      return Boolean(this.thumbnailLoadedById[this.photoStateKey(photo)]);
    },
    thumbnailFailed(photo) {
      return Boolean(this.thumbnailFailedById[this.photoStateKey(photo)]);
    },
    setPhotoState(collectionName, photo, value) {
      const key = this.photoStateKey(photo);
      if (!key) {
        return;
      }
      this[collectionName] = {
        ...this[collectionName],
        [key]: value
      };
    },
    handlePreviewLoad(photo) {
      this.setPhotoState("previewLoadedById", photo, true);
      this.setPhotoState("previewFailedById", photo, false);
    },
    handlePreviewError(photo) {
      this.setPhotoState("previewLoadedById", photo, false);
      this.setPhotoState("previewFailedById", photo, true);
    },
    handleThumbnailLoad(photo) {
      this.setPhotoState("thumbnailLoadedById", photo, true);
      this.setPhotoState("thumbnailFailedById", photo, false);
    },
    handleThumbnailError(photo) {
      this.setPhotoState("thumbnailFailedById", photo, true);
    },
    handleVideoError(photo) {
      const logicalIndex = this.logicalIndexForPhoto(photo);
      if (logicalIndex < 0) {
        return;
      }
      this.$emit("video-error", {
        index: logicalIndex,
        photo
      });
    },
    showVideoLoading(photo) {
      return Boolean(this.isVideo(photo) && !this.videoUrl(photo) && !this.showVideoFailed(photo));
    },
    showVideoFailed(photo) {
      return Boolean(this.isVideo(photo) && (photo?.video_load_failed || this.videoFailedById[this.photoStateKey(photo)]));
    },
    retryVideo(photo) {
      const logicalIndex = this.logicalIndexForPhoto(photo);
      if (logicalIndex < 0) {
        return;
      }
      this.setPhotoState("videoFailedById", photo, false);
      this.$emit("need-video", {
        index: logicalIndex,
        photo,
        retry: true
      });
    },
    requestCurrentVideoIfNeeded() {
      const photo = this.currentPhoto;
      if (!this.isVideo(photo) || this.videoUrl(photo) || this.showVideoFailed(photo)) {
        return;
      }
      this.$emit("need-video", {
        index: this.currentIndex,
        photo
      });
    },
    createVideoContext(photo, index) {
      const createVideoContext =
        (typeof uni !== "undefined" && typeof uni.createVideoContext === "function" && uni.createVideoContext) ||
        (typeof wx !== "undefined" && typeof wx.createVideoContext === "function" && wx.createVideoContext);
      if (!createVideoContext) {
        return null;
      }
      return createVideoContext(this.videoDomId(photo, index), this);
    },
    pauseVideoPhoto(photo, logicalIndex) {
      if (!this.isVideo(photo) || !this.videoUrl(photo)) {
        return;
      }
      const videoContext = this.createVideoContext(photo, logicalIndex);
      if (!videoContext || typeof videoContext.pause !== "function") {
        return;
      }
      try {
        videoContext.pause();
      } catch (error) {
        // Some mini program runtimes throw while the video node is being removed.
      }
    },
    pauseVideoAt(index) {
      this.pauseVideoPhoto(this.photos[index], index);
    },
    pauseAllVideos() {
      this.photos.forEach((photo, index) => {
        if (this.isVideo(photo)) {
          this.pauseVideoAt(index);
        }
      });
    },
    showLoading(photo) {
      const progress = this.activeProgressState(photo);
      const thumbnailReady =
        this.thumbnailUrl(photo) && this.thumbnailLoaded(photo) && !this.thumbnailFailed(photo);
      if (thumbnailReady) {
        return false;
      }
      return Boolean(
        !this.showFallback(photo) &&
          !this.previewLoaded(photo) &&
          !this.previewFailed(photo) &&
          (
            progress?.loading ||
            !this.thumbnailUrl(photo) ||
            this.thumbnailFailed(photo)
          )
      );
    },
    showPreviewFailed(photo) {
      return Boolean(this.previewFailed(photo) && this.thumbnailUrl(photo) && !this.thumbnailFailed(photo));
    },
    showFallback(photo) {
      if (this.activeProgressState(photo)?.loading) {
        return false;
      }
      const thumbnailUnavailable = !this.thumbnailUrl(photo) || this.thumbnailFailed(photo);
      const previewUnavailable = !this.previewUrl(photo) || this.previewFailed(photo);
      return thumbnailUnavailable && previewUnavailable;
    },
    isCurrentSwiperEvent(event) {
      const generation = Number(event?.currentTarget?.dataset?.generation);
      return Number.isFinite(generation) && generation === this.swiperGeneration;
    },
    updatePendingWindowRebase(windowIndex, logicalIndex) {
      const hasPhotosBeforeWindow = this.windowStart > 0;
      const hasPhotosAfterWindow =
        this.windowStart + this.windowPhotos.length < this.photos.length;
      const isRebaseEdge =
        (windowIndex === 0 && hasPhotosBeforeWindow) ||
        (windowIndex === this.windowPhotos.length - 1 && hasPhotosAfterWindow);
      if (!isRebaseEdge) {
        this.pendingWindowRebase = null;
        return;
      }
      this.pendingWindowRebase = {
        generation: this.swiperGeneration,
        logicalIndex
      };
    },
    handleSwiperChange(event) {
      if (!this.isCurrentSwiperEvent(event) || !this.windowPhotos.length) {
        return;
      }
      const windowIndex = this.clampWindowIndex(event?.detail?.current);
      const nextIndex = this.windowStart + windowIndex;
      this.activeWindowIndex = windowIndex;
      this.updatePendingWindowRebase(windowIndex, nextIndex);
      if (nextIndex === this.currentIndex) {
        return;
      }
      const previousIndex = this.currentIndex;
      this.pauseVideoAt(previousIndex);
      this.currentIndex = nextIndex;
      this.$emit("change", {
        index: nextIndex,
        photo: this.photos[nextIndex] || null
      });
      this.$nextTick(() => this.requestCurrentVideoIfNeeded());
    },
    handleSwiperAnimationFinish(event) {
      if (!this.isCurrentSwiperEvent(event) || !this.windowPhotos.length) {
        return;
      }
      if (this.internalRebaseGeneration === this.swiperGeneration) {
        this.internalRebaseGeneration = null;
        return;
      }
      const finishedWindowIndex = this.clampWindowIndex(event?.detail?.current);
      const finishedLogicalIndex = this.logicalIndexForWindowIndex(finishedWindowIndex);
      const pending = this.pendingWindowRebase;
      if (
        !pending ||
        pending.generation !== this.swiperGeneration ||
        pending.logicalIndex !== this.currentIndex ||
        finishedLogicalIndex !== pending.logicalIndex
      ) {
        return;
      }
      if (this.windowStartForIndex(this.currentIndex) !== this.windowStart) {
        this.rebuildWindowAt(this.currentIndex, { internalRebase: true });
      }
    },
    handleTouchStart(event) {
      const touch = event?.touches?.[0];
      if (!touch) {
        return;
      }
      this.touchStartX = Number(touch.clientX || 0);
      this.touchStartY = Number(touch.clientY || 0);
    },
    handleTouchMove() {},
    handleTouchEnd(event) {
      const touch = event?.changedTouches?.[0];
      if (!touch) {
        return;
      }
      const deltaX = Number(touch.clientX || 0) - this.touchStartX;
      const deltaY = Number(touch.clientY || 0) - this.touchStartY;
      if (deltaY > 90 && deltaY > Math.abs(deltaX) * 1.2) {
        this.close();
      }
    },
    requestDownload(trigger) {
      if (!this.allowDownload) {
        return;
      }
      const photo = this.currentPhoto;
      if (!photo) {
        return;
      }
      this.$emit("download", {
        index: this.currentIndex,
        photo,
        trigger
      });
    },
    close() {
      this.pendingWindowRebase = null;
      this.internalRebaseGeneration = null;
      this.pauseAllVideos();
      this.$emit("close");
    }
  }
};
</script>

<style scoped>
.album-image-viewer {
  position: fixed;
  inset: 0;
  z-index: 1400;
  overflow: hidden;
  background: #050505;
}

.album-image-viewer__swiper {
  width: 100%;
  height: 100vh;
}

.album-image-viewer__item,
.album-image-viewer__slide {
  width: 100%;
  height: 100%;
}

.album-image-viewer__slide {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #050505;
}

.album-image-viewer__image {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}

.album-image-viewer__image--thumbnail {
  opacity: 1;
  filter: saturate(0.94);
}

.album-image-viewer__image--preview {
  opacity: 0;
  transition: opacity 180ms ease;
}

.album-image-viewer__image--preview.loaded {
  opacity: 1;
}

.album-image-viewer__video-shell,
.album-image-viewer__video,
.album-image-viewer__video-poster {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}

.album-image-viewer__video-shell {
  display: flex;
  align-items: center;
  justify-content: center;
  background: #050505;
}

.album-image-viewer__slide--with-primary-action .album-image-viewer__video-shell {
  inset: 0 0 calc(174rpx + env(safe-area-inset-bottom));
  height: auto;
}

.album-image-viewer__video-poster {
  opacity: 0.76;
  filter: brightness(0.78);
}

.album-image-viewer__video {
  z-index: 1;
  background: #000000;
}

.album-image-viewer__video-status {
  position: relative;
  z-index: 2;
  padding: 14rpx 20rpx;
  border-radius: 999rpx;
  background: rgba(0, 0, 0, 0.5);
  color: rgba(255, 255, 255, 0.86);
  font-size: 24rpx;
  line-height: 1;
}

.album-image-viewer__loading,
.album-image-viewer__fallback {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(255, 255, 255, 0.78);
  font-size: 26rpx;
}

.album-image-viewer__loading {
  background: rgba(5, 5, 5, 0.56);
}

.album-image-viewer__fallback {
  background: #111111;
}

.album-image-viewer__loading-card {
  display: flex;
  align-items: center;
  flex-direction: column;
  min-width: 168rpx;
  padding: 28rpx 30rpx;
  border: 1rpx solid rgba(255, 255, 255, 0.12);
  border-radius: 8rpx;
  background: rgba(17, 17, 17, 0.82);
  box-sizing: border-box;
}

.album-image-viewer__loading-dot {
  width: 36rpx;
  height: 36rpx;
  border: 4rpx solid rgba(255, 255, 255, 0.22);
  border-top-color: rgba(255, 255, 255, 0.82);
  border-radius: 999rpx;
  animation: album-viewer-spin 0.9s linear infinite;
}

.album-image-viewer__loading-text {
  margin-top: 16rpx;
  color: rgba(255, 255, 255, 0.84);
  font-size: 24rpx;
  line-height: 1.2;
}

.album-image-viewer__loading-progress {
  overflow: hidden;
  width: 126rpx;
  height: 6rpx;
  margin-top: 14rpx;
  border-radius: 999rpx;
  background: rgba(255, 255, 255, 0.2);
}

.album-image-viewer__loading-progress-bar {
  width: 0;
  height: 100%;
  border-radius: inherit;
  background: rgba(255, 255, 255, 0.86);
  transition: width 120ms ease;
}

.album-image-viewer__status {
  position: absolute;
  right: 28rpx;
  bottom: calc(36rpx + env(safe-area-inset-bottom));
  z-index: 2;
  padding: 12rpx 18rpx;
  border-radius: 999rpx;
  background: rgba(0, 0, 0, 0.48);
  color: rgba(255, 255, 255, 0.86);
  font-size: 23rpx;
  line-height: 1;
}

.album-image-viewer__topbar {
  position: absolute;
  top: 0;
  right: 0;
  left: 0;
  z-index: 3;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 28rpx 28rpx 0;
  padding-top: calc(28rpx + env(safe-area-inset-top));
  pointer-events: none;
  box-sizing: border-box;
}

.album-image-viewer__counter,
.album-image-viewer__icon-button {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 58rpx;
  border-radius: 999rpx;
  background: rgba(0, 0, 0, 0.42);
  color: #ffffff;
  line-height: 1;
}

.album-image-viewer__counter {
  min-width: 92rpx;
  padding: 0 20rpx;
  font-size: 24rpx;
}

.album-image-viewer__actions {
  display: flex;
  align-items: center;
  gap: 14rpx;
  pointer-events: auto;
}

.album-image-viewer__icon-button {
  width: 58rpx;
  font-size: 32rpx;
  font-weight: 700;
}

.album-image-viewer__icon-button.close {
  font-size: 42rpx;
  font-weight: 500;
}

.album-image-viewer__share-button {
  margin: 0;
  padding: 0;
  border: 0;
  background: rgba(0, 0, 0, 0.42);
}

.album-image-viewer__share-button::after {
  border: 0;
}

.album-image-viewer__share-icon {
  width: 32rpx;
  height: 32rpx;
}

.album-image-viewer__icon-button--disabled {
  opacity: 0.38;
}

.album-image-viewer__primary-action {
  position: absolute;
  right: 32rpx;
  bottom: calc(24rpx + env(safe-area-inset-bottom));
  left: 32rpx;
  z-index: 8;
  min-height: 88rpx;
  padding: 22rpx 28rpx;
  border-radius: 999rpx;
  background: #1f6f5b;
  color: #ffffff;
  font-size: 28rpx;
  font-weight: 700;
  text-align: center;
  box-sizing: border-box;
}

@keyframes album-viewer-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
