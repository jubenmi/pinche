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

    <view v-else class="photo-grid">
      <view v-for="photo in filteredPhotos" :key="photo.id" class="photo-card">
        <image
          class="photo-image"
          :src="photo.display_url || ''"
          mode="aspectFill"
          @tap="previewPhoto(photo)"
        />
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

function albumMediaCachePath(photoId) {
  const root =
    (typeof wx !== "undefined" && wx.env?.USER_DATA_PATH) ||
    (typeof uni !== "undefined" && uni.env?.USER_DATA_PATH) ||
    "";
  return root ? `${root}/session-album-${photoId}.jpg` : "";
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
  methods: {
    apiUrl,
    async loadAlbum() {
      try {
        const response = await request({ url: `/api/sessions/${this.sessionId}/album` });
        const data = dataOf(response) || {};
        this.photos = data.photos || [];
        this.hiddenCount = Number(data.hidden_count || 0);
        this.canUpload = Boolean(data.can_upload);
        this.statusText = "";
        await this.preparePhotoMedia();
        if (this.canUpload) {
          await this.loadPeople();
        }
      } catch (error) {
        if (error?.statusCode === 403) {
          this.photos = [];
          this.canUpload = false;
          this.statusText = "车局相册发车后仅同车成员可查看。";
        } else {
          this.statusText = "相册加载失败，请稍后重试。";
        }
      }
    },
    downloadAlbumImage(photo) {
      const token = getToken();
      const filePath = albumMediaCachePath(photo.id);
      if (!token || !filePath || !photo.image_url) {
        return Promise.reject(new Error("album image auth unavailable"));
      }
      return new Promise((resolve, reject) => {
        uni.request({
          url: apiUrl(photo.image_url),
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
      let previewUrl = photo.display_url;
      let loadFailed = false;
      if (!previewUrl) {
        uni.showLoading({ title: "加载中" });
        try {
          previewUrl = await this.downloadAlbumImage(photo);
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

.photo-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 14rpx;
}

.photo-card {
  min-width: 0;
}

.photo-image {
  width: 100%;
  aspect-ratio: 1;
  border-radius: 8rpx;
  background: #f1f5f9;
}

.photo-meta {
  min-height: 96rpx;
  padding-top: 10rpx;
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
