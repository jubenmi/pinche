<template>
  <view class="page album-page">
    <AuthIdentityBar />

    <view class="section album-head">
      <view class="title">车局相册</view>
      <view class="text">同车成员可保存可见照片；隐私照片不会展示。</view>
      <view v-if="statusText" class="notice">{{ statusText }}</view>
      <view class="album-stats">
        <view class="stat-pill">你可见 {{ photos.length }} 张</view>
        <view v-if="hiddenCount > 0" class="stat-pill muted">
          另有 {{ hiddenCount }} 张因成员隐私未展示
        </view>
      </view>
      <view class="actions">
        <button class="button" :class="{ disabled: !canUpload || uploading }" @tap="choosePhotos">
          {{ uploading ? "上传中..." : "上传照片" }}
        </button>
        <button v-if="canUpload" class="button secondary" @tap="goPrivacy">隐私设置</button>
      </view>
    </view>

    <view class="filter-row">
      <button
        v-for="filter in filters"
        :key="filter.value"
        class="filter-chip"
        :class="{ active: activeFilter === filter.value }"
        @tap="activeFilter = filter.value"
      >
        {{ filter.label }}
      </button>
    </view>

    <view v-if="filteredPhotos.length === 0" class="section empty-section">
      <view class="empty-title">还没有可见照片</view>
      <view class="empty-text">
        {{ canUpload ? "上传后先由你自己可见，标注照片里的人后会按隐私设置展示。" : "当前没有满足隐私条件的照片。" }}
      </view>
    </view>

    <uv-waterfall
      v-else
      ref="albumWaterfall"
      v-model="waterfallPhotos"
      class="photo-waterfall"
      id-key="id"
      :add-time="20"
      :column-count="2"
      column-gap="14rpx"
      @changeList="changeWaterfallList"
    >
      <template v-slot:list1>
        <view class="waterfall-column">
          <view
            v-for="photo in waterfallList1"
            :id="photoDomId(photo)"
            :key="photo.id"
            class="photo-card waterfall-photo-card"
          >
            <view
              class="photo-image-shell"
              :style="photoImageStyle(photo)"
              @tap="previewPhoto(photo)"
            >
              <image
                v-if="visiblePhotoMedia[photo.id]?.thumbnail"
                class="photo-image"
                :src="visiblePhotoMedia[photo.id].thumbnail"
                mode="aspectFill"
              />
              <view v-else class="photo-placeholder">
                <view class="photo-loading-dot"></view>
              </view>
            </view>
            <view class="photo-meta">
              <view class="tag-line" :class="{ pending: photo.tags.length === 0 }">
                {{ tagSummary(photo) }}
              </view>
              <view class="photo-actions">
                <view v-if="photo.is_mine" class="mine-badge">我上传</view>
                <button v-if="photo.can_tag" class="tag-button" @tap="openTagSheet(photo)">
                  标注
                </button>
              </view>
            </view>
          </view>
        </view>
      </template>
      <template v-slot:list2>
        <view class="waterfall-column">
          <view
            v-for="photo in waterfallList2"
            :id="photoDomId(photo)"
            :key="photo.id"
            class="photo-card waterfall-photo-card"
          >
            <view
              class="photo-image-shell"
              :style="photoImageStyle(photo)"
              @tap="previewPhoto(photo)"
            >
              <image
                v-if="visiblePhotoMedia[photo.id]?.thumbnail"
                class="photo-image"
                :src="visiblePhotoMedia[photo.id].thumbnail"
                mode="aspectFill"
              />
              <view v-else class="photo-placeholder">
                <view class="photo-loading-dot"></view>
              </view>
            </view>
            <view class="photo-meta">
              <view class="tag-line" :class="{ pending: photo.tags.length === 0 }">
                {{ tagSummary(photo) }}
              </view>
              <view class="photo-actions">
                <view v-if="photo.is_mine" class="mine-badge">我上传</view>
                <button v-if="photo.can_tag" class="tag-button" @tap="openTagSheet(photo)">
                  标注
                </button>
              </view>
            </view>
          </view>
        </view>
      </template>
    </uv-waterfall>

    <view v-if="tagSheetPhoto" class="tag-mask" @tap="closeTagSheet">
      <view class="tag-sheet" @tap.stop>
        <view class="sheet-bar"></view>
        <view class="sheet-title">这张照片里有谁</view>
        <view class="sheet-note">标注后会按成员隐私自动决定谁可见。</view>

        <view class="selected-row">
          <view
            v-for="person in selectedPeople"
            :key="person.key"
            class="selected-chip"
            @tap="togglePerson(person.key)"
          >
            {{ person.label }} ×
          </view>
          <view v-if="selectedPeople.length === 0" class="selected-empty">
            暂未标注，只有上传者可见
          </view>
        </view>

        <view class="people-group">
          <view class="group-title">车友</view>
          <view class="people-grid">
            <button
              v-for="person in seatPeople"
              :key="person.key"
              class="person-choice"
              :class="{ selected: selectedTagKeys.includes(person.key) }"
              @tap="togglePerson(person.key)"
            >
              <text>{{ person.label }}</text>
              <text class="person-note">{{ person.note }}</text>
            </button>
          </view>
        </view>

        <view v-if="npcPeople.length" class="people-group">
          <view class="group-title">DM / NPC</view>
          <view class="people-grid">
            <button
              v-for="person in npcPeople"
              :key="person.key"
              class="person-choice npc"
              :class="{ selected: selectedTagKeys.includes(person.key) }"
              @tap="togglePerson(person.key)"
            >
              <text>{{ person.label }}</text>
              <text class="person-note">{{ person.note }}</text>
            </button>
          </view>
        </view>

        <view class="privacy-impact">
          若其中有人关闭“包含我的照片可见”，其他同车成员将看不到这张照片。
        </view>

        <view class="sheet-actions">
          <button class="button secondary" @tap="closeTagSheet">取消</button>
          <button class="button" :class="{ disabled: savingTags }" @tap="saveTags">
            {{ savingTags ? "保存中..." : "保存标注" }}
          </button>
        </view>
      </view>
    </view>
  </view>
</template>

<script>
import AuthIdentityBar from "../../components/AuthIdentityBar.vue";
import {
  apiUrl,
  dataOf,
  ensureLoggedIn,
  getCurrentUser,
  getToken,
  request,
  uploadSessionAlbumPhoto
} from "../../utils/api";

function albumMediaCachePath(photoId, variant = "preview") {
  const root =
    (typeof wx !== "undefined" && wx.env?.USER_DATA_PATH) ||
    (typeof uni !== "undefined" && uni.env?.USER_DATA_PATH) ||
    "";
  return root ? `${root}/session-album-${photoId}-${variant}.jpg` : "";
}

export default {
  components: { AuthIdentityBar },
  data() {
    return {
      sessionId: "",
      photos: [],
      people: [],
      hiddenCount: 0,
      canUpload: false,
      activeFilter: "all",
      statusText: "",
      uploading: false,
      savingTags: false,
      currentUserId: "",
      mediaLoadSerial: 0,
      waterfallPhotos: [],
      waterfallList1: [],
      waterfallList2: [],
      visiblePhotoMedia: {},
      photoObservers: [],
      tagSheetPhoto: null,
      selectedTagKeys: [],
      filters: [
        { value: "all", label: "全部" },
        { value: "mine", label: "我上传的" },
        { value: "withMe", label: "有我" },
        { value: "untagged", label: "待标注" }
      ]
    };
  },
  computed: {
    filteredPhotos() {
      if (this.activeFilter === "mine") {
        return this.photos.filter((photo) => photo.is_mine);
      }
      if (this.activeFilter === "withMe") {
        return this.photos.filter((photo) =>
          photo.tags.some((tag) => Number(tag.user_id) === Number(this.currentUserId))
        );
      }
      if (this.activeFilter === "untagged") {
        return this.photos.filter((photo) => photo.tags.length === 0);
      }
      return this.photos;
    },
    seatPeople() {
      return this.people.filter((person) => person.tag_type === "seat");
    },
    npcPeople() {
      return this.people.filter((person) => ["dm", "npc"].includes(person.tag_type));
    },
    selectedPeople() {
      return this.people.filter((person) => this.selectedTagKeys.includes(person.key));
    }
  },
  async onLoad(options) {
    this.sessionId = options.id || "";
    const auth = await ensureLoggedIn({
      content: "登录后可以查看车局相册。"
    });
    if (!auth?.user) {
      this.statusText = "登录后可继续查看相册。";
      return;
    }
    this.currentUserId = auth.user.id || "";
    await this.loadAlbum();
  },
  async onShow() {
    const auth = getCurrentUser();
    this.currentUserId = auth.user?.id || this.currentUserId;
    if (this.sessionId && this.currentUserId) {
      await this.loadAlbum();
    }
  },
  onUnload() {
    this.disconnectPhotoObservers();
  },
  watch: {
    activeFilter() {
      this.refreshWaterfall();
    }
  },
  methods: {
    apiUrl,
    async loadAlbum() {
      try {
        const response = await request({ url: `/api/sessions/${this.sessionId}/album` });
        const data = dataOf(response) || {};
        this.disconnectPhotoObservers();
        this.visiblePhotoMedia = {};
        this.photos = (data.photos || []).map((photo) => this.normalizePhotoMedia(photo));
        this.hiddenCount = Number(data.hidden_count || 0);
        this.canUpload = Boolean(data.can_upload);
        this.statusText = "";
        this.refreshWaterfall();
        if (this.canUpload) {
          await this.loadPeople();
        }
      } catch (error) {
        if (error?.statusCode === 403) {
          this.photos = [];
          this.canUpload = false;
          this.statusText = "车局相册发车后仅同车成员可查看。";
          this.refreshWaterfall();
        } else {
          this.statusText = "相册加载失败，请稍后重试。";
        }
      }
    },
    normalizePhotoMedia(photo) {
      const previewUrl = photo.preview_url || photo.image_url || "";
      return {
        ...photo,
        tags: photo.tags || [],
        image_url: previewUrl,
        preview_url: previewUrl,
        thumbnail_url: photo.thumbnail_url || previewUrl,
        display_url: ""
      };
    },
    mediaUrlForPhoto(photo, variant = "preview") {
      if (variant === "thumbnail") {
        return photo.thumbnail_url || photo.preview_url || photo.image_url || "";
      }
      return photo.preview_url || photo.image_url || "";
    },
    downloadAlbumImage(photo, variant = "preview") {
      const token = getToken();
      const filePath = albumMediaCachePath(photo.id, variant);
      const imageUrl = apiUrl(this.mediaUrlForPhoto(photo, variant));
      if (!token || !filePath || !imageUrl) {
        return Promise.reject(new Error("album image auth unavailable"));
      }
      return new Promise((resolve, reject) => {
        uni.request({
          url: imageUrl,
          method: "GET",
          responseType: "arraybuffer",
          header: {
            Authorization: `Bearer ${token}`
          },
          success(response) {
            if (response.statusCode < 200 || response.statusCode >= 300) {
              reject(new Error(`album image request failed: ${response.statusCode}`));
              return;
            }
            uni.getFileSystemManager().writeFile({
              filePath,
              data: response.data,
              success() {
                resolve(filePath);
              },
              fail: reject
            });
          },
          fail: reject
        });
      });
    },
    async preparePhotoMedia() {
      const serial = this.mediaLoadSerial + 1;
      this.mediaLoadSerial = serial;
      const photos = this.photos || [];
      const hydrated = await Promise.all(
        photos.map(async (photo) => {
          try {
            return {
              ...photo,
              display_url: await this.downloadAlbumImage(photo)
            };
          } catch (error) {
            return {
              ...photo,
              display_url: ""
            };
          }
        })
      );
      if (serial === this.mediaLoadSerial) {
        this.photos = hydrated;
      }
    },
    updatePhotoDisplayUrl(photoId, displayUrl) {
      this.photos = this.photos.map((photo) =>
        Number(photo.id) === Number(photoId)
          ? {
              ...photo,
              display_url: displayUrl
            }
          : photo
      );
    },
    setVisiblePhotoMedia(photoId, values) {
      const key = String(photoId);
      this.visiblePhotoMedia = {
        ...this.visiblePhotoMedia,
        [key]: {
          ...(this.visiblePhotoMedia[key] || {}),
          ...values
        }
      };
    },
    async loadVisiblePhotoMedia(photo, variant = "thumbnail") {
      const key = String(photo.id);
      const current = this.visiblePhotoMedia[key] || {};
      if (current[variant]) {
        return current[variant];
      }
      const loadingKey = `${variant}Loading`;
      if (current[loadingKey]) {
        return "";
      }
      this.setVisiblePhotoMedia(photo.id, { [loadingKey]: true, [`${variant}Failed`]: false });
      try {
        const displayUrl = await this.downloadAlbumImage(photo, variant);
        this.setVisiblePhotoMedia(photo.id, {
          [variant]: displayUrl,
          [loadingKey]: false
        });
        if (variant === "preview") {
          this.updatePhotoDisplayUrl(photo.id, displayUrl);
        }
        return displayUrl;
      } catch (error) {
        this.setVisiblePhotoMedia(photo.id, {
          [loadingKey]: false,
          [`${variant}Failed`]: true
        });
        return "";
      }
    },
    onPhotoVisible(photo) {
      this.loadVisiblePhotoMedia(photo, "thumbnail");
    },
    disconnectPhotoObservers() {
      for (const observer of this.photoObservers || []) {
        if (observer && typeof observer.disconnect === "function") {
          observer.disconnect();
        }
      }
      this.photoObservers = [];
    },
    observeVisiblePhotos() {
      this.disconnectPhotoObservers();
      const photos = [...this.waterfallList1, ...this.waterfallList2];
      if (!photos.length) {
        return;
      }
      if (typeof uni === "undefined" || typeof uni.createIntersectionObserver !== "function") {
        photos.slice(0, 12).forEach((photo) => this.onPhotoVisible(photo));
        return;
      }
      this.$nextTick(() => {
        const observers = [];
        for (const photo of photos) {
          if (this.visiblePhotoMedia[photo.id]?.thumbnail) {
            continue;
          }
          const observer = uni.createIntersectionObserver(this);
          observer.relativeToViewport({ bottom: 600 }).observe(`#${this.photoDomId(photo)}`, (entry) => {
            if (entry.intersectionRatio > 0) {
              this.onPhotoVisible(photo);
              observer.disconnect();
            }
          });
          observers.push(observer);
        }
        this.photoObservers = observers;
      });
    },
    refreshWaterfall() {
      this.disconnectPhotoObservers();
      const nextPhotos = this.filteredPhotos.map((photo) => ({ ...photo }));
      this.waterfallList1 = [];
      this.waterfallList2 = [];
      if (this.$refs.albumWaterfall && typeof this.$refs.albumWaterfall.clear === "function") {
        this.$refs.albumWaterfall.clear();
      }
      this.waterfallPhotos = [];
      this.$nextTick(() => {
        this.waterfallPhotos = nextPhotos;
        this.$nextTick(() => this.observeVisiblePhotos());
      });
    },
    changeWaterfallList(event) {
      if (event?.name === "list1" || event?.name === "list2") {
        this[event.name].push(event.value);
        this.$nextTick(() => this.observeVisiblePhotos());
      }
    },
    photoDomId(photo) {
      return `album-photo-${photo.id}`;
    },
    photoImageStyle(photo) {
      const columnWidth = Number(photo.width || 0);
      const imageWidth = Number(photo.image_width || 0);
      const imageHeight = Number(photo.image_height || 0);
      if (columnWidth > 0 && imageWidth > 0 && imageHeight > 0) {
        const ratio = Math.min(1.8, Math.max(0.68, imageHeight / imageWidth));
        return `height:${Math.round(columnWidth * ratio)}px;`;
      }
      return "height:328rpx;";
    },
    async loadPeople() {
      let people = [];
      try {
        const response = await request({ url: `/api/sessions/${this.sessionId}/album/people` });
        people = dataOf(response)?.people || [];
      } catch (error) {
        people = [];
      }
      this.people = this.mergePeople([...people, ...(await this.loadSessionPeopleFallback())]);
    },
    async loadSessionPeopleFallback() {
      try {
        const response = await request({ url: `/api/sessions/${this.sessionId}` });
        return this.sessionDetailPeople(dataOf(response) || {});
      } catch (error) {
        return [];
      }
    },
    sessionDetailPeople(session) {
      const people = [];
      for (const seat of session.seats || []) {
        people.push({
          key: `seat:${seat.id}`,
          tag_type: "seat",
          seat_id: seat.id,
          user_id: seat.confirmed_user_id || null,
          label: seat.role_name || seat.name || "车友",
          note: [seat.name, seat.role_name].filter(Boolean).join(" · ") || "车友"
        });
      }

      if (session.dm_user_id || session.dm_name_snapshot) {
        people.push({
          key: "dm:session",
          tag_type: "dm",
          seat_id: null,
          user_id: session.dm_user_id || null,
          label: session.dm_name_snapshot || "DM",
          note: "DM"
        });
      }
      if (session.npc_user_id || session.npc_name_snapshot) {
        people.push({
          key: "npc:session",
          tag_type: "npc",
          seat_id: null,
          user_id: session.npc_user_id || null,
          label: session.npc_name_snapshot || "NPC",
          note: "NPC"
        });
      }

      return people;
    },
    mergePeople(people) {
      const peopleByKey = new Map();
      for (const person of people) {
        if (person?.key && !peopleByKey.has(person.key)) {
          peopleByKey.set(person.key, person);
        }
      }
      return [...peopleByKey.values()];
    },
    tagSummary(photo) {
      if (!photo.tags || photo.tags.length === 0) {
        return "待标注";
      }
      return `照片里：${photo.tags.map((tag) => tag.label).join("、")}`;
    },
    choosePhotos() {
      if (!this.canUpload || this.uploading) {
        uni.showToast({ title: "发车后同车成员可上传", icon: "none" });
        return;
      }
      uni.chooseImage({
        count: 9,
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
      this.uploading = true;
      this.statusText = "正在上传照片...";
      try {
        for (const filePath of paths) {
          const photoUrl = await uploadSessionAlbumPhoto(this.sessionId, filePath);
          await request({
            url: `/api/sessions/${this.sessionId}/album/photos`,
            method: "POST",
            data: { photoUrl }
          });
        }
        this.statusText = "";
        await this.loadAlbum();
      } catch (error) {
        this.statusText = error?.userMessage || "相册照片上传失败，请稍后重试。";
      } finally {
        this.uploading = false;
      }
    },
    async previewPhoto(photo) {
      let previewUrl = this.visiblePhotoMedia[photo.id]?.preview || photo.display_url;
      let loadFailed = false;
      if (!previewUrl) {
        uni.showLoading({ title: "加载中" });
        try {
          previewUrl = await this.loadVisiblePhotoMedia(photo, "preview");
          this.updatePhotoDisplayUrl(photo.id, previewUrl);
        } catch (error) {
          loadFailed = true;
        } finally {
          uni.hideLoading();
        }
      }
      if (loadFailed || !previewUrl) {
        uni.showToast({ title: "照片加载失败", icon: "none" });
        return;
      }
      uni.previewImage({
        urls: [previewUrl],
        current: previewUrl
      });
    },
    goPrivacy() {
      uni.navigateTo({ url: `/pages/session/albumPrivacy?id=${this.sessionId}` });
    },
    openTagSheet(photo) {
      if (!photo.can_tag) {
        return;
      }
      this.tagSheetPhoto = photo;
      this.selectedTagKeys = (photo.tags || []).map((tag) => tag.key);
    },
    closeTagSheet() {
      this.tagSheetPhoto = null;
      this.selectedTagKeys = [];
    },
    togglePerson(key) {
      if (this.selectedTagKeys.includes(key)) {
        this.selectedTagKeys = this.selectedTagKeys.filter((item) => item !== key);
        return;
      }
      this.selectedTagKeys = [...this.selectedTagKeys, key];
    },
    async saveTags() {
      if (!this.tagSheetPhoto || this.savingTags) {
        return;
      }
      this.savingTags = true;
      try {
        await request({
          url: `/api/session-album/photos/${this.tagSheetPhoto.id}/tags`,
          method: "PUT",
          data: { tagKeys: this.selectedTagKeys }
        });
        this.closeTagSheet();
        await this.loadAlbum();
      } catch (error) {
        uni.showToast({ title: "标注保存失败", icon: "none" });
      } finally {
        this.savingTags = false;
      }
    }
  }
};
</script>

<style scoped>
.album-page {
  padding-bottom: 150rpx;
}

.album-head .text {
  margin-bottom: 16rpx;
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

.album-stats,
.filter-row {
  display: flex;
  flex-wrap: wrap;
  gap: 12rpx;
}

.stat-pill,
.filter-chip {
  margin: 0;
  padding: 10rpx 18rpx;
  border-radius: 8rpx;
  background: #eef5ef;
  color: #1f6f5b;
  font-size: 23rpx;
  line-height: 1.2;
}

.stat-pill.muted {
  background: #f7f4ee;
  color: #9b8d70;
}

.filter-row {
  margin-bottom: 20rpx;
}

.filter-chip {
  border: 1rpx solid rgba(223, 216, 204, 0.92);
  background: rgba(255, 255, 252, 0.96);
  color: #607068;
}

.filter-chip.active {
  border-color: #1f6f5b;
  background: #eef5ef;
  color: #1f6f5b;
  font-weight: 600;
}

.photo-waterfall {
  display: block;
}

.waterfall-column {
  min-width: 0;
}

.photo-card {
  overflow: hidden;
  min-width: 0;
  margin-bottom: 14rpx;
  border: 1rpx solid rgba(223, 216, 204, 0.88);
  border-radius: 10rpx;
  background: rgba(255, 255, 252, 0.96);
}

.photo-image-shell {
  position: relative;
  overflow: hidden;
  width: 100%;
  background: #eef5ef;
}

.photo-image {
  display: block;
  width: 100%;
  height: 100%;
}

.photo-placeholder {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(145deg, #eef5ef 0%, #f7f4ee 100%);
}

.photo-loading-dot {
  width: 34rpx;
  height: 34rpx;
  border: 4rpx solid rgba(31, 122, 104, 0.18);
  border-top-color: rgba(31, 122, 104, 0.72);
  border-radius: 999rpx;
  animation: album-spin 0.9s linear infinite;
}

.photo-meta {
  min-height: 104rpx;
  padding: 12rpx 12rpx 14rpx;
}

@keyframes album-spin {
  to {
    transform: rotate(360deg);
  }
}

.tag-line {
  color: #334155;
  font-size: 21rpx;
  line-height: 1.35;
}

.tag-line.pending {
  color: #b89458;
  font-weight: 600;
}

.photo-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8rpx;
  margin-top: 8rpx;
}

.mine-badge {
  color: #1f7a68;
  font-size: 20rpx;
}

.tag-button {
  width: 72rpx;
  height: 40rpx;
  margin: 0;
  padding: 0;
  border-radius: 6rpx;
  background: #1f7a68;
  color: #ffffff;
  font-size: 20rpx;
  line-height: 40rpx;
}

.empty-section {
  text-align: center;
}

.empty-title {
  color: #153f34;
  font-size: 30rpx;
  font-weight: 600;
}

.empty-text {
  margin-top: 12rpx;
  color: #7a857d;
  font-size: 25rpx;
  line-height: 1.5;
}

.tag-mask {
  position: fixed;
  inset: 0;
  z-index: 20;
  display: flex;
  align-items: flex-end;
  background: rgba(15, 23, 42, 0.34);
}

.tag-sheet {
  width: 100%;
  max-height: 78vh;
  overflow-y: auto;
  padding: 18rpx 30rpx 38rpx;
  border-radius: 24rpx 24rpx 0 0;
  background: #fffefb;
  box-sizing: border-box;
}

.sheet-bar {
  width: 72rpx;
  height: 8rpx;
  margin: 0 auto 24rpx;
  border-radius: 999rpx;
  background: #ded8ca;
}

.sheet-title {
  color: #153f34;
  font-size: 32rpx;
  font-weight: 600;
}

.sheet-note,
.privacy-impact,
.selected-empty {
  margin-top: 8rpx;
  color: #7a857d;
  font-size: 24rpx;
  line-height: 1.45;
}

.selected-row {
  display: flex;
  flex-wrap: wrap;
  gap: 10rpx;
  min-height: 54rpx;
  margin-top: 20rpx;
}

.selected-chip {
  padding: 9rpx 14rpx;
  border-radius: 8rpx;
  background: #eef5ef;
  color: #1f6f5b;
  font-size: 23rpx;
}

.people-group {
  margin-top: 24rpx;
}

.group-title {
  margin-bottom: 12rpx;
  color: #153f34;
  font-size: 26rpx;
  font-weight: 600;
}

.people-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12rpx;
}

.person-choice {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  min-height: 92rpx;
  margin: 0;
  padding: 16rpx;
  border: 1rpx solid rgba(223, 216, 204, 0.92);
  border-radius: 12rpx;
  background: rgba(255, 255, 252, 0.96);
  color: #153f34;
  font-size: 25rpx;
  line-height: 1.3;
  text-align: left;
}

.person-choice.npc {
  background: #fff8ef;
}

.person-choice.selected {
  box-shadow:
    0 0 0 3rpx rgba(216, 167, 61, 0.86),
    inset 0 0 0 1rpx rgba(216, 167, 61, 0.26);
}

.person-note {
  margin-top: 6rpx;
  color: #7a857d;
  font-size: 21rpx;
}

.privacy-impact {
  margin-top: 24rpx;
  padding: 16rpx;
  border-radius: 8rpx;
  background: #f7f4ee;
  color: #8d7b55;
}

.sheet-actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14rpx;
  margin-top: 24rpx;
}
</style>
