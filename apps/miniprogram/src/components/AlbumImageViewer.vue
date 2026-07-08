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
      class="album-image-viewer__swiper"
      :current="swiperIndex"
      :duration="220"
      @change="handleSwiperChange"
    >
      <swiper-item
        v-for="(photo, index) in photos"
        :key="photoKey(photo, index)"
        class="album-image-viewer__item"
      >
        <view class="album-image-viewer__slide">
          <image
            v-if="thumbnailUrl(photo) && !thumbnailFailed(photo)"
            class="album-image-viewer__image album-image-viewer__image--thumbnail"
            :src="thumbnailUrl(photo)"
            mode="aspectFit"
            @load="handleThumbnailLoad(photo)"
            @error="handleThumbnailError(photo)"
          />
          <image
            v-if="previewCanLoad(photo) && !previewFailed(photo)"
            class="album-image-viewer__image album-image-viewer__image--preview"
            :class="{ loaded: previewLoaded(photo) }"
            :src="previewUrl(photo)"
            mode="aspectFit"
            @load="handlePreviewLoad(photo)"
            @error="handlePreviewError(photo)"
          />
          <view v-if="showLoading(photo)" class="album-image-viewer__loading">
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
          <view v-if="showPreviewFailed(photo)" class="album-image-viewer__status">
            展示图加载失败
          </view>
          <view v-if="showFallback(photo)" class="album-image-viewer__fallback">
            图片加载失败
          </view>
        </view>
      </swiper-item>
    </swiper>

    <view class="album-image-viewer__topbar">
      <view class="album-image-viewer__counter">{{ counterText }}</view>
      <view class="album-image-viewer__actions">
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
  </view>
</template>

<script>
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
    mediaProgress: {
      type: Object,
      default: () => ({})
    }
  },
  data() {
    return {
      currentIndex: 0,
      swiperIndex: 0,
      touchStartX: 0,
      touchStartY: 0,
      previewLoadedById: {},
      previewFailedById: {},
      thumbnailLoadedById: {},
      thumbnailFailedById: {}
    };
  },
  computed: {
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
        this.syncInitialIndex();
      }
      if (!nextValue) {
        this.touchStartX = 0;
        this.touchStartY = 0;
      }
    },
    initialIndex() {
      if (this.visible) {
        this.syncInitialIndex();
      }
    },
    photos() {
      if (this.visible) {
        this.syncCurrentIndexAfterPhotosChange();
      }
    }
  },
  methods: {
    clampIndex(index) {
      const maxIndex = Math.max(0, this.photos.length - 1);
      const parsed = Number(index || 0);
      if (!Number.isFinite(parsed)) {
        return 0;
      }
      return Math.min(Math.max(0, parsed), maxIndex);
    },
    syncInitialIndex() {
      const nextIndex = this.clampIndex(this.initialIndex);
      this.currentIndex = nextIndex;
      this.swiperIndex = nextIndex;
    },
    syncCurrentIndexAfterPhotosChange() {
      const nextIndex = this.clampIndex(this.currentIndex);
      if (nextIndex === this.currentIndex) {
        return;
      }
      this.currentIndex = nextIndex;
      this.swiperIndex = nextIndex;
    },
    resetImageStates() {
      this.previewLoadedById = {};
      this.previewFailedById = {};
      this.thumbnailLoadedById = {};
      this.thumbnailFailedById = {};
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
    thumbnailUrl(photo) {
      const thumbnail = photo?.thumbnail_display_url || "";
      const preview = this.previewUrl(photo);
      return thumbnail && thumbnail !== preview ? thumbnail : "";
    },
    previewUrl(photo) {
      return photo?.preview_display_url || "";
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
    handleSwiperChange(event) {
      const nextIndex = this.clampIndex(event?.detail?.current || 0);
      this.currentIndex = nextIndex;
      this.swiperIndex = nextIndex;
      this.$emit("change", {
        index: nextIndex,
        photo: this.photos[nextIndex] || null
      });
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

@keyframes album-viewer-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
