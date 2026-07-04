<template>
  <view class="page album-page">
    <AuthIdentityBar v-if="!timelineMode" />

    <view class="section album-head">
      <view class="title">{{ albumTitle }}</view>
      <view class="text">{{ albumIntro }}</view>
      <view v-if="operationText" class="notice">{{ operationText }}</view>
      <view class="album-stats">
        <view class="stat-pill">{{ timelineMode ? "展示" : "你可见" }} {{ photos.length }} 张</view>
        <view v-if="!timelineMode && hiddenCount > 0" class="stat-pill muted">
          另有 {{ hiddenCount }} 张因成员隐私未展示
        </view>
      </view>
      <view v-if="!timelineMode" class="actions">
        <button
          v-if="canUpload"
          v-show="!selectionMode"
          class="button"
          :class="{ disabled: albumBusy }"
          :disabled="albumBusy"
          @tap="choosePhotos"
        >
          {{ uploading ? "上传中..." : "上传照片" }}
        </button>
        <button
          v-if="canUpload && !selectionMode"
          class="button secondary"
          :disabled="albumBusy"
          @tap="goPrivacy"
        >
          隐私设置
        </button>
        <button
          v-if="taggablePhotos.length"
          class="button secondary"
          :disabled="albumBusy"
          @tap="toggleSelectionMode"
        >
          {{ selectionMode ? "退出多选" : "多选" }}
        </button>
      </view>
    </view>

    <view v-if="!timelineMode" class="filter-row">
      <button
        v-for="filter in filters"
        :key="filter.value"
        class="filter-chip"
        :class="{ active: activeFilter === filter.value }"
        :disabled="albumBusy"
        @tap="activeFilter = filter.value"
      >
        {{ filter.label }}
      </button>
    </view>

    <view v-if="filteredPhotos.length === 0" class="section empty-section">
      <view class="empty-title">还没有可见照片</view>
      <view class="empty-text">
        {{ emptyText }}
      </view>
      <button
        v-if="canUpload && !timelineMode"
        class="button empty-upload-button"
        :class="{ disabled: albumBusy }"
        :disabled="albumBusy"
        @tap="choosePhotos"
      >
        {{ uploading ? "上传中..." : "上传第一张照片" }}
      </button>
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
            :class="{
              selectable: !timelineMode && selectionMode && photo.can_tag,
              selected: !timelineMode && selectionMode && isPhotoSelected(photo),
              disabled: !timelineMode && selectionMode && !photo.can_tag
            }"
            @tap="togglePhotoSelection(photo)"
          >
            <view
              class="photo-image-shell"
              :style="photoImageStyle(photo)"
              @tap.stop="selectionMode ? togglePhotoSelection(photo) : previewPhoto(photo)"
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
              <view
                v-if="!timelineMode && selectionMode"
                class="selection-checkbox"
                :class="{ selected: isPhotoSelected(photo), disabled: !photo.can_tag }"
              >
                <view class="selection-checkbox-box">
                  {{ isPhotoSelected(photo) ? "✓" : "" }}
                </view>
              </view>
            </view>
            <view v-if="timelineMode" class="photo-meta public-photo-meta">
              <view class="tag-line">{{ publicPhotoCaption }}</view>
            </view>
            <view v-else class="photo-meta">
              <view class="tag-line" :class="{ pending: photo.tags.length === 0 }">
                {{ tagSummary(photo) }}
              </view>
              <view v-if="!selectionMode" class="photo-actions">
                <view v-if="photo.is_mine" class="mine-badge">我上传</view>
                <button
                  v-if="photo.can_tag"
                  class="tag-button"
                  :disabled="albumBusy"
                  @tap.stop="openTagSheet(photo)"
                >
                  标注
                </button>
                <button
                  v-if="photo.is_mine"
                  class="tag-button danger"
                  :disabled="albumBusy"
                  @tap.stop="deletePhoto(photo)"
                >
                  {{ deletingPhotoId === photo.id ? "删除中" : "删除" }}
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
            :class="{
              selectable: !timelineMode && selectionMode && photo.can_tag,
              selected: !timelineMode && selectionMode && isPhotoSelected(photo),
              disabled: !timelineMode && selectionMode && !photo.can_tag
            }"
            @tap="togglePhotoSelection(photo)"
          >
            <view
              class="photo-image-shell"
              :style="photoImageStyle(photo)"
              @tap.stop="selectionMode ? togglePhotoSelection(photo) : previewPhoto(photo)"
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
              <view
                v-if="!timelineMode && selectionMode"
                class="selection-checkbox"
                :class="{ selected: isPhotoSelected(photo), disabled: !photo.can_tag }"
              >
                <view class="selection-checkbox-box">
                  {{ isPhotoSelected(photo) ? "✓" : "" }}
                </view>
              </view>
            </view>
            <view v-if="timelineMode" class="photo-meta public-photo-meta">
              <view class="tag-line">{{ publicPhotoCaption }}</view>
            </view>
            <view v-else class="photo-meta">
              <view class="tag-line" :class="{ pending: photo.tags.length === 0 }">
                {{ tagSummary(photo) }}
              </view>
              <view v-if="!selectionMode" class="photo-actions">
                <view v-if="photo.is_mine" class="mine-badge">我上传</view>
                <button
                  v-if="photo.can_tag"
                  class="tag-button"
                  :disabled="albumBusy"
                  @tap.stop="openTagSheet(photo)"
                >
                  标注
                </button>
                <button
                  v-if="photo.is_mine"
                  class="tag-button danger"
                  :disabled="albumBusy"
                  @tap.stop="deletePhoto(photo)"
                >
                  {{ deletingPhotoId === photo.id ? "删除中" : "删除" }}
                </button>
              </view>
            </view>
          </view>
        </view>
      </template>
    </uv-waterfall>

    <view v-if="!timelineMode && selectionMode" class="bulk-action-bar">
      <button class="button secondary" :disabled="albumBusy" @tap="toggleSelectionMode">取消</button>
      <view class="bulk-count">已选 {{ selectedPhotoCount }} 张</view>
      <button
        class="button"
        :class="{ disabled: albumBusy || selectedPhotoCount === 0 }"
        :disabled="albumBusy || selectedPhotoCount === 0"
        @tap="openBulkTagSheet"
      >
        批量标注
      </button>
    </view>

    <view v-if="!timelineMode && tagSheetPhoto" class="tag-mask" @tap="closeTagSheet">
      <view class="tag-sheet" @tap.stop>
        <view class="sheet-bar"></view>
        <view class="sheet-title">
          <text v-if="bulkTagging">给 {{ selectedTagTargetCount }} 张照片标注</text>
          <text v-else>这张照片里有谁</text>
        </view>
        <view class="sheet-note">
          {{
            bulkTagging
              ? "保存后，这些照片会替换成同一组标签。"
              : "标注后会按成员隐私自动决定谁可见。"
          }}
        </view>

        <view class="selected-row">
          <view
            v-for="person in selectedPeople"
            :key="person.key"
            class="selected-chip"
            @tap="togglePerson(person.key)"
          >
            {{ tagPersonTitle(person) }} ×
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
              <text>{{ tagPersonTitle(person) }}</text>
              <text v-if="tagPersonSubtitle(person)" class="person-note">{{ tagPersonSubtitle(person) }}</text>
            </button>
          </view>
        </view>

        <view v-if="npcPeople.length" class="people-group">
          <view class="group-title">DM / NPC工作人员</view>
          <view class="people-grid">
            <button
              v-for="person in npcPeople"
              :key="person.key"
              class="person-choice npc"
              :class="{ selected: selectedTagKeys.includes(person.key) }"
              @tap="togglePerson(person.key)"
            >
              <text>{{ tagPersonTitle(person) }}</text>
              <text v-if="tagPersonSubtitle(person)" class="person-note">{{ tagPersonSubtitle(person) }}</text>
            </button>
          </view>
        </view>

        <view v-if="npcRolePeople.length" class="people-group">
          <view class="group-title">NPC角色</view>
          <view class="people-grid">
            <button
              v-for="person in npcRolePeople"
              :key="person.key"
              class="person-choice npc"
              :class="{ selected: selectedTagKeys.includes(person.key) }"
              @tap="togglePerson(person.key)"
            >
              <text>{{ tagPersonTitle(person) }}</text>
              <text v-if="tagPersonSubtitle(person)" class="person-note">{{ tagPersonSubtitle(person) }}</text>
            </button>
          </view>
        </view>

        <view v-if="otherPeople.length" class="people-group">
          <view class="group-title">其他</view>
          <view class="people-grid">
            <button
              v-for="person in otherPeople"
              :key="person.key"
              class="person-choice"
              :class="{ selected: selectedTagKeys.includes(person.key) }"
              @tap="togglePerson(person.key)"
            >
              <text>{{ tagPersonTitle(person) }}</text>
              <text v-if="tagPersonSubtitle(person)" class="person-note">{{ tagPersonSubtitle(person) }}</text>
            </button>
          </view>
        </view>

        <view class="privacy-impact">
          标注“其他”或仅标 NPC 时，同车成员都可见；标注车友后会按成员隐私设置展示。
        </view>

        <view class="sheet-actions">
          <button class="button secondary" :disabled="savingTags" @tap="closeTagSheet">取消</button>
          <button
            class="button"
            :class="{ disabled: savingTags }"
            :disabled="savingTags"
            @tap="saveTags"
          >
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
  queryString,
  request,
  uploadSessionAlbumPhoto
} from "../../utils/api";
import { showWechatShareMenus } from "../../utils/share";

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
      timelineMode: false,
      albumShareToken: "",
      shareSubject: null,
      photos: [],
      people: [],
      hiddenCount: 0,
      canUpload: false,
      activeFilter: "all",
      statusText: "",
      loadingAlbum: false,
      uploading: false,
      savingTags: false,
      deletingPhotoId: null,
      currentUserId: "",
      mediaLoadSerial: 0,
      waterfallPhotos: [],
      waterfallList1: [],
      waterfallList2: [],
      visiblePhotoMedia: {},
      photoObservers: [],
      tagSheetPhoto: null,
      selectedTagKeys: [],
      selectionMode: false,
      selectedPhotoIds: [],
      bulkTagging: false,
      filters: [
        { value: "all", label: "全部" },
        { value: "mine", label: "我上传的" },
        { value: "withMe", label: "有我" },
        { value: "untagged", label: "待标注" }
      ]
    };
  },
  computed: {
    albumTitle() {
      if (!this.timelineMode) {
        return "车局相册";
      }
      return this.shareSubjectLabel ? `${this.shareSubjectLabel}的相册` : "分享相册";
    },
    albumIntro() {
      if (this.timelineMode) {
        return "朋友圈只读展示，不包含车内完整相册和上车入口。";
      }
      return "同车成员可保存可见照片；隐私照片不会展示。";
    },
    shareSubjectLabel() {
      return (
        this.shareSubject?.role_name ||
        this.shareSubject?.seat_name ||
        this.shareSubject?.label ||
        ""
      );
    },
    publicPhotoCaption() {
      return this.shareSubjectLabel ? `包含 ${this.shareSubjectLabel}` : "分享照片";
    },
    emptyText() {
      if (this.timelineMode) {
        return "当前没有可展示的分享照片。";
      }
      return this.canUpload
        ? "这场车还没人上传，来放第一张。标注照片里的人后会按隐私设置展示。"
        : "当前没有满足隐私条件的照片。";
    },
    filteredPhotos() {
      if (this.timelineMode) {
        return this.photos;
      }
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
    taggablePhotos() {
      return this.filteredPhotos.filter((photo) => photo.can_tag);
    },
    seatPeople() {
      return this.people.filter((person) => person.tag_type === "seat");
    },
    npcPeople() {
      return this.people.filter((person) => ["dm", "npc"].includes(person.tag_type));
    },
    npcRolePeople() {
      return this.people.filter((person) => person.tag_type === "session_npc_role");
    },
    otherPeople() {
      return this.people.filter((person) => person.tag_type === "other");
    },
    selectedPeople() {
      return this.people.filter((person) => this.selectedTagKeys.includes(person.key));
    },
    selectedPhotoCount() {
      return this.selectedPhotoIds.length;
    },
    selectedTagTargetCount() {
      if (this.bulkTagging) {
        return this.selectedPhotoCount;
      }
      return this.tagSheetPhoto ? 1 : 0;
    },
    albumBusy() {
      return (
        this.loadingAlbum ||
        this.uploading ||
        this.savingTags ||
        Boolean(this.deletingPhotoId)
      );
    },
    operationText() {
      if (this.loadingAlbum) {
        return "正在加载相册...";
      }
      if (this.uploading) {
        return this.statusText || "正在上传照片...";
      }
      if (this.savingTags) {
        return "正在保存标注...";
      }
      if (this.deletingPhotoId) {
        return "正在删除照片...";
      }
      if (this.albumBusy) {
        return "正在处理，请稍候...";
      }
      return this.statusText;
    }
  },
  async onLoad(options) {
    this.sessionId = options.id || "";
    this.timelineMode =
      options.source === "wechat_timeline" ||
      Boolean(options.albumShareToken || options.token);
    this.albumShareToken = options.albumShareToken || options.token || "";
    this.showShareMenus();
    if (this.timelineMode) {
      await this.loadPublicAlbum();
      return;
    }
    const auth = await ensureLoggedIn({
      content: "登录后可以查看车局相册。"
    });
    if (!auth?.user) {
      this.statusText = "登录后可继续查看相册。";
      return;
    }
    this.currentUserId = auth.user.id || "";
    await this.loadAlbum();
    await this.ensureAlbumShareToken();
  },
  async onShow() {
    if (this.timelineMode) {
      if (this.sessionId && this.albumShareToken) {
        await this.loadPublicAlbum();
      }
      return;
    }
    const auth = getCurrentUser();
    this.currentUserId = auth.user?.id || this.currentUserId;
    if (this.sessionId && this.currentUserId) {
      await this.loadAlbum();
      await this.ensureAlbumShareToken();
    }
  },
  onUnload() {
    this.disconnectPhotoObservers();
  },
  onShareAppMessage() {
    const shareCode = `s${this.sessionId}-${Date.now()}`;
    return {
      title: this.albumShareTitle(),
      path: `/pages/session/share?id=${this.sessionId}&entry=album&shareCode=${shareCode}&source=wechat_share`
    };
  },
  onShareTimeline() {
    return {
      title: this.albumTimelineTitle(),
      query: this.albumTimelineQuery()
    };
  },
  watch: {
    activeFilter() {
      this.selectionMode = false;
      this.selectedPhotoIds = [];
      this.refreshWaterfall();
    }
  },
  methods: {
    apiUrl,
    showShareMenus() {
      showWechatShareMenus({
        withShareTicket: true,
        menus: ["shareAppMessage", "shareTimeline"]
      });
    },
    albumShareTitle() {
      return this.timelineMode && this.shareSubjectLabel
        ? `${this.shareSubjectLabel}的车局相册`
        : "车局相册";
    },
    albumTimelineTitle() {
      return this.shareSubjectLabel
        ? `${this.shareSubjectLabel}的车局照片`
        : "车局相册";
    },
    albumTimelineQuery() {
      return queryString({
        id: this.sessionId,
        source: "wechat_timeline",
        albumShareToken: this.albumShareToken
      }).replace(/^\?/, "");
    },
    async ensureAlbumShareToken() {
      if (this.timelineMode || this.albumShareToken || !this.sessionId) {
        return;
      }
      try {
        const response = await request({
          url: `/api/sessions/${this.sessionId}/album/share-token`,
          method: "POST"
        });
        const data = dataOf(response) || {};
        this.albumShareToken = data.token || "";
        this.shareSubject = data.share_subject || null;
      } catch (error) {
        this.albumShareToken = "";
      }
    },
    inferredSeatRoleName(person) {
      return String(person?.note || "")
        .split(" · ")
        .map((part) => part.trim())
        .filter(Boolean)
        .slice(-1)[0] || "";
    },
    tagPersonTitle(person) {
      if (person?.tag_type !== "seat") {
        return person?.label || this.tagTypeLabel(person?.tag_type);
      }
      return person.role_name || this.inferredSeatRoleName(person) || person.label || "车友";
    },
    tagTypeLabel(value) {
      const labels = {
        seat: "车友",
        dm: "DM",
        npc: "NPC",
        session_npc_role: "NPC角色",
        other: "其他"
      };
      return labels[value] || "成员";
    },
    tagPersonSubtitle(person) {
      if (!person) {
        return "";
      }
      const title = this.tagPersonTitle(person);
      if (person.tag_type === "seat") {
        const accountName = String(person.account_name || person.account_nickname || "").trim();
        if (accountName && accountName !== title) {
          return accountName;
        }
        const legacyLabel = String(person.label || "").trim();
        return legacyLabel && legacyLabel !== title ? legacyLabel : "";
      }
      if (person.tag_type === "session_npc_role") {
        const accountName = String(person.account_name || person.bound_user_name || "").trim();
        if (accountName && accountName !== title) {
          return accountName;
        }
        const legacyBinding = String(person.note || "").split("绑定：")[1]?.split(" · ")[0]?.trim() || "";
        return legacyBinding && legacyBinding !== title ? legacyBinding : "";
      }
      const subtitle = String(person.account_name || person.note || "").trim();
      return subtitle && subtitle !== person.label ? subtitle : "";
    },
    async loadAlbum() {
      if (this.loadingAlbum) {
        return;
      }
      this.loadingAlbum = true;
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
      } finally {
        this.loadingAlbum = false;
      }
    },
    async loadPublicAlbum() {
      if (this.loadingAlbum) {
        return;
      }
      if (!this.sessionId || !this.albumShareToken) {
        this.statusText = "分享相册链接缺少访问凭证。";
        return;
      }
      this.loadingAlbum = true;
      try {
        const response = await request({
          url: `/api/sessions/${this.sessionId}/album/public-share${queryString({
            token: this.albumShareToken
          })}`
        });
        const data = dataOf(response) || {};
        this.disconnectPhotoObservers();
        this.visiblePhotoMedia = {};
        this.people = [];
        this.canUpload = false;
        this.hiddenCount = 0;
        this.shareSubject = data.share_subject || this.shareSubject;
        this.photos = (data.photos || []).map((photo) => this.normalizePhotoMedia(photo));
        this.statusText = "";
        this.refreshWaterfall();
      } catch (error) {
        this.photos = [];
        this.canUpload = false;
        this.statusText =
          error?.statusCode === 403
            ? "分享相册已过期或不可访问。"
            : "分享相册加载失败，请稍后重试。";
        this.refreshWaterfall();
      } finally {
        this.loadingAlbum = false;
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
      if ((!this.timelineMode && !token) || !filePath || !imageUrl) {
        return Promise.reject(new Error("album image auth unavailable"));
      }
      return new Promise((resolve, reject) => {
        const header = token ? { Authorization: `Bearer ${token}` } : {};
        uni.request({
          url: imageUrl,
          method: "GET",
          responseType: "arraybuffer",
          header,
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
        const targetListName = `waterfallList${event.name.slice(4)}`;
        if (!Array.isArray(this[targetListName])) {
          return;
        }
        this[targetListName].push(event.value);
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
        const accountName =
          seat.confirmed_user_name ||
          seat.user_nickname ||
          seat.user_open_id ||
          "";
        people.push({
          key: `seat:${seat.id}`,
          tag_type: "seat",
          seat_id: seat.id,
          user_id: seat.confirmed_user_id || null,
          label: seat.role_name || seat.name || "车友",
          note: accountName,
          role_name: seat.role_name || "",
          seat_name: seat.name || "",
          account_name: accountName
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

      people.push({
        key: "other:session",
        tag_type: "other",
        seat_id: null,
        user_id: null,
        label: "其他",
        note: "风景/主线外照片"
      });

      for (const role of session.session_npc_roles || []) {
        const accountName = role.bound_user_name || "";
        people.push({
          key: `session-npc:${role.id}`,
          tag_type: "session_npc_role",
          seat_id: null,
          session_npc_role_id: role.id,
          user_id: role.bound_user_id || null,
          label: role.name || "NPC角色",
          note: accountName,
          account_name: accountName
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
      if (this.timelineMode) {
        return this.publicPhotoCaption;
      }
      if (!photo.tags || photo.tags.length === 0) {
        return "待标注";
      }
      return `照片里：${photo.tags.map((tag) => tag.label).join("、")}`;
    },
    choosePhotos() {
      if (this.timelineMode || !this.canUpload || this.albumBusy) {
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
      if (this.albumBusy || paths.length === 0) {
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
    deletePhoto(photo) {
      if (this.timelineMode || this.albumBusy || !photo.is_mine) {
        return;
      }
      uni.showModal({
        title: "删除照片",
        content: "确认删除这张照片？删除后清空相册才能取消这辆车。",
        confirmText: "删除",
        cancelText: "再想想",
        success: async (result) => {
          if (!result.confirm) {
            return;
          }
          if (this.albumBusy) {
            return;
          }
          this.deletingPhotoId = photo.id;
          this.statusText = "正在删除照片...";
          try {
            await request({
              url: `/api/session-album/photos/${photo.id}`,
              method: "DELETE"
            });
            this.statusText = "";
            await this.loadAlbum();
          } catch (error) {
            this.statusText = error?.userMessage || "照片删除失败，请稍后重试。";
          } finally {
            this.deletingPhotoId = null;
          }
        }
      });
    },
    async previewPhoto(photo) {
      if (this.deletingPhotoId) {
        return;
      }
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
      if (this.timelineMode || this.albumBusy) {
        return;
      }
      uni.navigateTo({ url: `/pages/session/albumPrivacy?id=${this.sessionId}` });
    },
    openTagSheet(photo) {
      if (this.timelineMode || this.albumBusy || !photo.can_tag) {
        return;
      }
      this.tagSheetPhoto = photo;
      this.selectedTagKeys = (photo.tags || []).map((tag) => tag.key);
    },
    toggleSelectionMode() {
      if (this.timelineMode || this.albumBusy) {
        return;
      }
      this.selectionMode = !this.selectionMode;
      this.selectedPhotoIds = [];
    },
    isPhotoSelected(photo) {
      return this.selectedPhotoIds.includes(Number(photo.id));
    },
    togglePhotoSelection(photo) {
      if (this.timelineMode || !this.selectionMode || this.albumBusy || !photo.can_tag) {
        return;
      }
      const photoId = Number(photo.id);
      if (this.selectedPhotoIds.includes(photoId)) {
        this.selectedPhotoIds = this.selectedPhotoIds.filter((id) => id !== photoId);
        return;
      }
      this.selectedPhotoIds = [...this.selectedPhotoIds, photoId];
    },
    openBulkTagSheet() {
      if (this.timelineMode || this.albumBusy || this.selectedPhotoIds.length === 0) {
        return;
      }
      this.bulkTagging = true;
      this.tagSheetPhoto = { id: null };
      this.selectedTagKeys = [];
    },
    closeTagSheet(options = {}) {
      if (this.savingTags && !options.force) {
        return;
      }
      this.tagSheetPhoto = null;
      this.selectedTagKeys = [];
      this.bulkTagging = false;
    },
    togglePerson(key) {
      if (this.selectedTagKeys.includes(key)) {
        this.selectedTagKeys = this.selectedTagKeys.filter((item) => item !== key);
        return;
      }
      this.selectedTagKeys = [...this.selectedTagKeys, key];
    },
    async saveTags() {
      if (this.timelineMode || !this.tagSheetPhoto || this.albumBusy) {
        return;
      }
      const targetPhotoIds = this.bulkTagging
        ? [...this.selectedPhotoIds]
        : [Number(this.tagSheetPhoto.id)];
      if (targetPhotoIds.length === 0) {
        return;
      }
      this.savingTags = true;
      let failedCount = 0;
      try {
        for (const photoId of targetPhotoIds) {
          try {
            await request({
              url: `/api/session-album/photos/${photoId}/tags`,
              method: "PUT",
              data: { tagKeys: this.selectedTagKeys }
            });
          } catch (error) {
            failedCount += 1;
          }
        }
        const allFailed = failedCount === targetPhotoIds.length;
        this.closeTagSheet({ force: true });
        this.selectionMode = false;
        this.selectedPhotoIds = [];
        await this.loadAlbum();
        if (allFailed) {
          uni.showToast({ title: "标注保存失败", icon: "none" });
          return;
        }
        if (failedCount > 0) {
          uni.showToast({ title: "部分照片标注失败", icon: "none" });
        }
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

.photo-card.selectable {
  border-color: rgba(31, 111, 91, 0.45);
}

.photo-card.selected {
  border-color: #1f6f5b;
  box-shadow: 0 0 0 3rpx rgba(31, 111, 91, 0.12);
}

.photo-card.disabled {
  opacity: 0.62;
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

.selection-checkbox {
  position: absolute;
  top: 12rpx;
  right: 12rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 52rpx;
  height: 52rpx;
  border-radius: 10rpx;
  background: rgba(15, 23, 42, 0.32);
}

.selection-checkbox-box {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 34rpx;
  height: 34rpx;
  border: 3rpx solid rgba(255, 255, 255, 0.96);
  border-radius: 7rpx;
  background: rgba(255, 255, 255, 0.18);
  color: #fff;
  font-size: 26rpx;
  font-weight: 700;
  line-height: 34rpx;
}

.selection-checkbox.selected {
  background: #1f6f5b;
}

.selection-checkbox.selected .selection-checkbox-box {
  border-color: #ffffff;
  background: #1f6f5b;
}

.selection-checkbox.disabled {
  background: rgba(148, 163, 184, 0.64);
}

.selection-checkbox.disabled .selection-checkbox-box {
  background: rgba(255, 255, 255, 0.1);
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

.tag-button.danger {
  background: #fff2f0;
  color: #c23b32;
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

.empty-upload-button {
  width: 260rpx;
  margin: 22rpx auto 0;
}

.bulk-action-bar {
  position: fixed;
  right: 24rpx;
  bottom: 34rpx;
  left: 24rpx;
  z-index: 20;
  display: flex;
  align-items: center;
  gap: 14rpx;
  padding: 16rpx;
  border: 1rpx solid rgba(223, 216, 204, 0.92);
  border-radius: 10rpx;
  background: rgba(255, 255, 252, 0.98);
  box-shadow: 0 18rpx 42rpx rgba(32, 44, 38, 0.16);
}

.bulk-count {
  flex: 1;
  color: #334155;
  font-size: 25rpx;
  text-align: center;
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
