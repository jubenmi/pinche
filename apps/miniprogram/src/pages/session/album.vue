<template>
  <view class="page album-page" :class="{ 'selection-active': !timelineMode && selectionMode }">
    <AuthIdentityBar v-if="!timelineMode" />

    <view class="section album-head">
      <view class="album-head-copy">
        <view class="album-kicker">{{ timelineMode ? "分享相册" : "车局影像" }}</view>
        <view class="album-title-row">
          <view class="title album-title">{{ albumTitle }}</view>
          <view v-if="!timelineMode" class="album-progress-badge">标注 {{ filteredTagProgressPercent }}%</view>
        </view>
        <view class="album-intro">{{ albumIntro }}</view>
      </view>

      <view v-if="operationText" class="notice album-notice">{{ operationText }}</view>

      <view class="album-metrics" :class="{ public: timelineMode }">
        <view class="album-metric primary">
          <text class="metric-value">{{ photos.length }}</text>
          <text class="metric-label">{{ timelineMode ? "展示照片" : "我的照片" }}</text>
        </view>
        <view v-if="!timelineMode" class="album-metric">
          <text class="metric-value">{{ filteredPhotos.length }}</text>
          <text class="metric-label">当前筛选</text>
        </view>
        <view v-if="!timelineMode" class="album-metric">
          <text class="metric-value">{{ filteredTaggedPhotoCount }}</text>
          <text class="metric-label">已标注</text>
        </view>
        <view v-if="!timelineMode" class="album-metric">
          <text class="metric-value">{{ filteredUntaggedPhotoCount }}</text>
          <text class="metric-label">待标注</text>
        </view>
      </view>

      <view v-if="!timelineMode && hiddenCount > 0" class="album-privacy-note">
        另有 {{ hiddenCount }} 张非本人照片或受隐私保护未展示
      </view>
    </view>

    <view
      v-if="!timelineMode && (canUpload || photos.length || taggablePhotos.length)"
      v-show="!selectionMode"
      class="album-actions-shell"
      :class="{ floating: topActionsFloating }"
    >
      <view class="album-actions album-sticky-actions" :class="{ floating: topActionsFloating }">
        <view v-if="canUpload" class="album-primary-actions">
          <button
            class="button album-action-primary"
            :class="{ disabled: albumBusy }"
            :disabled="albumBusy"
            @tap="choosePhotos"
          >
            {{ uploading ? "上传中..." : "上传照片" }}
          </button>
          <button
            class="button secondary album-privacy-action"
            :disabled="albumBusy"
            @tap="goPrivacy"
          >
            隐私设置
          </button>
        </view>

        <view
          v-if="photos.length || taggablePhotos.length"
          class="album-action-groups"
        >
          <view v-if="photos.length" class="album-action-group">
            <view class="album-action-group-title">保存到手机</view>
            <view class="album-command-rail">
              <button class="album-command" :disabled="albumBusy" @tap="downloadAllPhotos">
                全部下载
              </button>
              <button
                v-if="filteredPhotos.length"
                class="album-command"
                :disabled="albumBusy"
                @tap="openDownloadSelectionMode"
              >
                多选下载
              </button>
            </view>
          </view>

          <view v-if="taggablePhotos.length" class="album-action-group">
            <view class="album-action-group-title">整理标注</view>
            <view class="album-command-rail">
              <button class="album-command" :disabled="albumBusy" @tap="openTagSelectionMode">
                批量标注
              </button>
              <view class="album-action-hint">待标注 {{ filteredUntaggedPhotoCount }}</view>
            </view>
          </view>
        </view>

        <view class="album-filter-panel album-toolbar-filter-panel">
          <view class="filter-panel-head">
            <view class="filter-panel-title">查看照片</view>
            <view class="filter-panel-count">当前 {{ filteredPhotos.length }} 张</view>
          </view>

          <view class="filter-row">
            <button
              v-for="filter in albumFilterOptions"
              :key="filter.value"
              class="filter-chip"
              :class="{ active: activeFilter === filter.value }"
              :disabled="albumBusy"
              @tap="activeFilter = filter.value"
            >
              <text>{{ filter.label }}</text>
              <text class="filter-count">{{ filter.count }}</text>
            </button>
          </view>

          <view class="role-filter-row">
            <view class="role-filter-label">角色</view>
            <picker
              mode="selector"
              :range="albumRoleFilterLabels"
              :value="selectedRoleFilterIndex"
              :disabled="albumBusy || albumRoleFilterOptions.length <= 1"
              @change="handleRoleFilterChange"
            >
              <view
                class="role-filter-picker"
                :class="{ disabled: albumBusy || albumRoleFilterOptions.length <= 1 }"
              >
                {{ selectedRoleFilterLabel }}
              </view>
            </picker>
          </view>
        </view>
      </view>
    </view>

    <view v-if="filteredPhotos.length === 0" class="section empty-section">
      <view class="empty-title">还没有你的照片</view>
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
              selectable: !timelineMode && selectionMode && canSelectPhoto(photo),
              selected: !timelineMode && selectionMode && isPhotoSelected(photo),
              disabled: !timelineMode && selectionMode && !canSelectPhoto(photo)
            }"
            @tap="togglePhotoSelection(photo)"
          >
            <view
              class="photo-image-shell"
              :style="photoImageStyle(photo)"
              @tap.stop="selectionMode ? togglePhotoSelection(photo) : previewPhoto(photo)"
              @longpress.stop="showPhotoInfo(photo)"
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
                :class="{ selected: isPhotoSelected(photo), disabled: !canSelectPhoto(photo) }"
              >
                <view class="selection-checkbox-box">
                  {{ isPhotoSelected(photo) ? "✓" : "" }}
                </view>
              </view>
            </view>
            <view v-if="timelineMode" class="photo-meta public-photo-meta">
              <view class="photo-caption-body">
                <view class="photo-caption-title">{{ publicPhotoCaption }}</view>
              </view>
            </view>
            <view v-else class="photo-meta">
              <view class="photo-caption-body">
                <view class="photo-caption-title" :class="{ pending: photo.tags.length === 0 }">
                  {{ tagSummary(photo) }}
                </view>
              </view>
              <view
                v-if="!selectionMode"
                class="photo-actions-row"
                :class="{ 'has-danger': photo.is_mine }"
              >
                <view class="photo-status-slot">
                  <view class="photo-source-badge">
                    <image
                      class="photo-source-icon"
                      :src="photoSourceIcon(photo)"
                      mode="aspectFit"
                    />
                    <text class="photo-source-label">{{ photoSourceLabel(photo) }}</text>
                  </view>
                </view>
                <view class="photo-safe-actions">
                  <button
                    v-if="photo.can_tag"
                    class="photo-action-text primary"
                    :disabled="albumBusy"
                    @tap.stop="openTagSheet(photo)"
                  >
                    标注
                  </button>
                  <button
                    class="photo-action-text"
                    :disabled="albumBusy"
                    @tap.stop="downloadSinglePhoto(photo)"
                  >
                    下载
                  </button>
                </view>
                <button
                  v-if="photo.is_mine"
                  class="photo-action-text danger photo-danger-action"
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
              selectable: !timelineMode && selectionMode && canSelectPhoto(photo),
              selected: !timelineMode && selectionMode && isPhotoSelected(photo),
              disabled: !timelineMode && selectionMode && !canSelectPhoto(photo)
            }"
            @tap="togglePhotoSelection(photo)"
          >
            <view
              class="photo-image-shell"
              :style="photoImageStyle(photo)"
              @tap.stop="selectionMode ? togglePhotoSelection(photo) : previewPhoto(photo)"
              @longpress.stop="showPhotoInfo(photo)"
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
                :class="{ selected: isPhotoSelected(photo), disabled: !canSelectPhoto(photo) }"
              >
                <view class="selection-checkbox-box">
                  {{ isPhotoSelected(photo) ? "✓" : "" }}
                </view>
              </view>
            </view>
            <view v-if="timelineMode" class="photo-meta public-photo-meta">
              <view class="photo-caption-body">
                <view class="photo-caption-title">{{ publicPhotoCaption }}</view>
              </view>
            </view>
            <view v-else class="photo-meta">
              <view class="photo-caption-body">
                <view class="photo-caption-title" :class="{ pending: photo.tags.length === 0 }">
                  {{ tagSummary(photo) }}
                </view>
              </view>
              <view
                v-if="!selectionMode"
                class="photo-actions-row"
                :class="{ 'has-danger': photo.is_mine }"
              >
                <view class="photo-status-slot">
                  <view class="photo-source-badge">
                    <image
                      class="photo-source-icon"
                      :src="photoSourceIcon(photo)"
                      mode="aspectFit"
                    />
                    <text class="photo-source-label">{{ photoSourceLabel(photo) }}</text>
                  </view>
                </view>
                <view class="photo-safe-actions">
                  <button
                    v-if="photo.can_tag"
                    class="photo-action-text primary"
                    :disabled="albumBusy"
                    @tap.stop="openTagSheet(photo)"
                  >
                    标注
                  </button>
                  <button
                    class="photo-action-text"
                    :disabled="albumBusy"
                    @tap.stop="downloadSinglePhoto(photo)"
                  >
                    下载
                  </button>
                </view>
                <button
                  v-if="photo.is_mine"
                  class="photo-action-text danger photo-danger-action"
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

    <view v-if="!timelineMode && selectionMode && !tagSheetPhoto" class="album-floating-toolbar">
      <view class="floating-toolbar-button secondary" @tap="toggleSelectionMode">
        取消
      </view>
      <view class="bulk-count">已选 {{ selectedPhotoCount }} 张</view>
      <view
        v-if="selectionModePurpose === 'download'"
        class="floating-toolbar-button primary"
        :class="{ disabled: albumBusy || selectedPhotoCount === 0 }"
        @tap="downloadSelectedPhotos"
      >
        下载所选
      </view>
      <view
        v-else
        class="floating-toolbar-button primary"
        :class="{ disabled: albumBusy || selectedTagTargetCount === 0 }"
        @tap="openBulkTagSheet"
      >
        批量标注
      </view>
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
              : "标注后只会展示给上传者和对应被标注成员。"
          }}
        </view>

        <view class="selected-row">
          <view
            v-for="person in selectedPeople"
            :key="person.key"
            class="selected-chip"
            @tap="togglePerson(person.key)"
          >
            <text>{{ tagPersonTitle(person) }}</text>
            <text
              v-if="person.tag_type === 'session_npc_role'"
              class="npc-gender-mark"
              :class="npcRoleGenderClass(person.role_gender)"
            >
              {{ npcRoleGenderText(person.role_gender) }}
            </text>
            <text>×</text>
          </view>
          <view v-if="selectedPeople.length === 0" class="selected-empty">
            暂未标注，只有上传者可见
          </view>
        </view>

        <RoleSeatBoard
          :surface="false"
          :sections="albumTagSections"
          empty-text="暂无可标注角色。"
          @itemtap="handleAlbumTagTap"
        />

        <view class="privacy-impact">
          未标注只有上传者可见；标注角色后只展示给上传者和对应被标注成员。
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
import RoleSeatBoard from "../../components/RoleSeatBoard.vue";
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
import { normalizeRoleGender, roleGenderSymbol } from "../../utils/createFlow";
import { showWechatShareMenus } from "../../utils/share";

function albumMediaCachePath(photoId, variant = "preview") {
  const root =
    (typeof wx !== "undefined" && wx.env?.USER_DATA_PATH) ||
    (typeof uni !== "undefined" && uni.env?.USER_DATA_PATH) ||
    "";
  return root ? `${root}/session-album-${photoId}-${variant}.jpg` : "";
}

export default {
  components: { AuthIdentityBar, RoleSeatBoard },
  data() {
    return {
      sessionId: "",
      timelineMode: false,
      albumShareToken: "",
      shareSubject: null,
      albumSession: null,
      photos: [],
      people: [],
      hiddenCount: 0,
      canUpload: false,
      activeFilter: "all",
      selectedRoleFilter: "",
      statusText: "",
      loadingAlbum: false,
      skipNextAlbumRefreshOnShow: false,
      albumScrollTop: 0,
      topActionsFloating: false,
      uploading: false,
      downloading: false,
      downloadProgressText: "",
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
      selectionModePurpose: "tag",
      selectedPhotoIds: [],
      bulkTagging: false,
      filters: [
        { value: "all", label: "我的照片" },
        { value: "mine", label: "我上传的" },
        { value: "withMe", label: "有我" },
        { value: "untagged", label: "待标注" }
      ]
    };
  },
  computed: {
    albumTitle() {
      if (this.timelineMode) {
        return this.shareSubjectLabel ? `${this.shareSubjectLabel}的相册` : "分享相册";
      }
      return this.albumDisplayTitle || "相册";
    },
    albumDisplayTitle() {
      if (!this.currentAlbumRoleName || !this.albumScriptName) {
        return "";
      }
      return `[${this.currentAlbumRoleName}·${this.albumScriptName}] 相册`;
    },
    albumScriptName() {
      return String(this.albumSession?.script_name_snapshot || "").trim();
    },
    albumStoreName() {
      return String(this.albumSession?.store_name_snapshot || "").trim();
    },
    currentAlbumRoleName() {
      const userId = Number(this.currentUserId || 0);
      if (!userId) {
        return "";
      }
      const matchingPeople = this.people.filter(
        (person) => Number(person?.user_id || 0) === userId
      );
      const person =
        matchingPeople.find(
          (item) => item.tag_type === "seat" && Number(item.seat_id || 0) > 0
        ) ||
        matchingPeople.find((item) => item.tag_type === "session_npc_role") ||
        matchingPeople.find((item) => ["dm", "npc"].includes(item.tag_type)) ||
        matchingPeople[0];
      return person ? this.tagPersonTitle(person) : this.albumRoleNameFromMineTags();
    },
    albumIntro() {
      if (this.timelineMode) {
        return "朋友圈只读展示，不包含车内完整相册和上车入口。";
      }
      return "仅展示你上传或标注了你角色的照片；其他车友照片不会展示。";
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
        ? "这场车还没有与你相关的照片。你可以上传照片，标注后只展示给对应的人。"
        : "当前没有与你相关或满足隐私条件的照片。";
    },
    filteredPhotos() {
      if (this.timelineMode) {
        return this.photos;
      }
      return this.photosForAlbumFilter(this.activeFilter);
    },
    filteredUntaggedPhotoCount() {
      return this.filteredPhotos.filter((photo) => photo.tags.length === 0).length;
    },
    filteredTaggedPhotoCount() {
      return this.filteredPhotos.length - this.filteredUntaggedPhotoCount;
    },
    filteredTagProgressPercent() {
      if (this.filteredPhotos.length === 0) {
        return 0;
      }
      return Math.round((this.filteredTaggedPhotoCount / this.filteredPhotos.length) * 100);
    },
    albumFilterOptions() {
      return this.filters.map((filter) => ({
        ...filter,
        count: this.countAlbumPhotosForFilter(filter.value)
      }));
    },
    albumRoleFilterOptions() {
      if (this.timelineMode) {
        return [];
      }
      const activeFilterCount = this.photosForAlbumFilter(this.activeFilter, { includeRole: false }).length;
      return [
        { value: "", label: `全部角色 ${activeFilterCount}` },
        ...this.people.map((person) => ({
          value: person.key,
          label: `${this.roleFilterOptionLabel(person)} ${this.countPhotosForRole(person.key)}`
        }))
      ];
    },
    albumRoleFilterLabels() {
      return this.albumRoleFilterOptions.map((option) => option.label);
    },
    selectedRoleFilterIndex() {
      const index = this.albumRoleFilterOptions.findIndex(
        (option) => option.value === this.selectedRoleFilter
      );
      return index >= 0 ? index : 0;
    },
    selectedRoleFilterLabel() {
      return this.albumRoleFilterOptions[this.selectedRoleFilterIndex]?.label || "全部角色 0";
    },
    taggablePhotos() {
      return this.filteredPhotos.filter((photo) => photo.can_tag);
    },
    selectedTaggablePhotoIds() {
      return this.selectedPhotoIds.filter((photoId) =>
        this.taggablePhotos.some((photo) => Number(photo.id) === Number(photoId))
      );
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
    albumTagSections() {
      return [
        this.albumTagSection("seat", "车友", this.seatPeople),
        this.albumTagSection("staff", "DM / NPC工作人员", this.npcPeople),
        this.albumTagSection("npcRole", "NPC角色", this.npcRolePeople),
        this.albumTagSection("other", "其他", this.otherPeople)
      ].filter((section) => section.items.length);
    },
    selectedPeople() {
      return this.people.filter((person) => this.selectedTagKeys.includes(person.key));
    },
    selectedPhotoCount() {
      return this.selectedPhotoIds.length;
    },
    selectedTagTargetCount() {
      if (this.bulkTagging || (this.selectionMode && this.selectionModePurpose === "tag")) {
        return this.selectedTaggablePhotoIds.length;
      }
      return this.tagSheetPhoto ? 1 : 0;
    },
    albumBusy() {
      return (
        this.loadingAlbum ||
        this.uploading ||
        this.downloading ||
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
      if (this.downloading) {
        return this.downloadProgressText || "正在保存照片...";
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
    this.applyAlbumNavigationTitle();
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
    if (this.consumePreviewReturnRefreshSkip()) {
      return;
    }
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
  onPageScroll(event) {
    this.albumScrollTop = Number(event?.scrollTop || 0);
    this.updateTopActionsFloating();
  },
  onShareAppMessage() {
    const shareCode = `s${this.sessionId}-${Date.now()}`;
    return {
      title: this.albumShareTitle(),
      path: `/pages/session/share?id=${this.sessionId}&entry=album&shareCode=${shareCode}&source=wechat_share`,
      imageUrl: this.albumShareImage()
    };
  },
  onShareTimeline() {
    return {
      title: this.albumTimelineTitle(),
      query: this.albumTimelineQuery(),
      imageUrl: this.albumShareImage()
    };
  },
  watch: {
    activeFilter() {
      this.selectionMode = false;
      this.selectionModePurpose = "tag";
      this.selectedPhotoIds = [];
      this.updateTopActionsFloating();
      this.refreshWaterfall();
    },
    selectedRoleFilter() {
      this.selectionMode = false;
      this.selectionModePurpose = "tag";
      this.selectedPhotoIds = [];
      this.updateTopActionsFloating();
      this.refreshWaterfall();
    }
  },
  methods: {
    apiUrl,
    showShareMenus() {
      const menus = ["shareAppMessage"];
      if (this.timelineMode || this.albumShareToken) {
        menus.push("shareTimeline");
      }
      showWechatShareMenus({
        withShareTicket: true,
        menus
      });
    },
    albumShareTitle() {
      return `${this.albumShareSessionTitle()}｜相册邀请`;
    },
    albumTimelineTitle() {
      return `${this.albumShareSessionTitle()}｜相册`;
    },
    albumShareSessionTitle() {
      return `${this.albumScriptName || "剧本待定"}｜${this.albumStoreName || "店家待定"}`;
    },
    albumShareImage() {
      return "/static/art/ticket-landscape.jpg";
    },
    albumTimelineQuery() {
      return queryString({
        id: this.sessionId,
        source: "wechat_timeline",
        albumShareToken: this.albumShareToken
      }).replace(/^\?/, "");
    },
    albumSessionSummary(data = {}) {
      return {
        id: Number(data.session_id || data.id || this.sessionId || 0) || this.sessionId,
        script_name_snapshot: data.script_name_snapshot || "",
        store_name_snapshot: data.store_name_snapshot || "",
        start_at: data.start_at || ""
      };
    },
    applyAlbumSessionFallback(session) {
      if (!session || this.albumScriptName) {
        return;
      }
      this.albumSession = this.albumSessionSummary(session);
    },
    applyAlbumNavigationTitle() {
      if (
        typeof uni === "undefined" ||
        typeof uni.setNavigationBarTitle !== "function"
      ) {
        return;
      }
      uni.setNavigationBarTitle({
        title: this.albumTitle || "相册"
      });
    },
    consumePreviewReturnRefreshSkip() {
      if (!this.skipNextAlbumRefreshOnShow) {
        return false;
      }
      this.skipNextAlbumRefreshOnShow = false;
      return true;
    },
    updateTopActionsFloating() {
      const canShowActions = this.canUpload || this.photos.length || this.taggablePhotos.length;
      this.topActionsFloating = Boolean(
        !this.timelineMode &&
        !this.selectionMode &&
        canShowActions &&
        this.albumScrollTop > 180
      );
    },
    localAlbumShareSubject() {
      const userId = Number(this.currentUserId || 0);
      if (!userId) {
        return null;
      }
      const seat = this.people.find(
        (person) =>
          person.tag_type === "seat" &&
          Number(person.user_id || 0) === userId &&
          Number(person.seat_id || 0) > 0
      );
      if (!seat) {
        return null;
      }
      return {
        type: "seat",
        seat_id: Number(seat.seat_id),
        role_name: seat.role_name || "",
        seat_name: seat.seat_name || "",
        label: seat.role_name || seat.seat_name || seat.label || "车友"
      };
    },
    canRequestAlbumShareToken() {
      return Boolean(this.localAlbumShareSubject());
    },
    async ensureAlbumShareToken() {
      if (this.timelineMode || this.albumShareToken || !this.sessionId) {
        return;
      }
      if (!this.canRequestAlbumShareToken()) {
        this.shareSubject = null;
        this.showShareMenus();
        return;
      }
      try {
        const response = await request({
          url: `/api/sessions/${this.sessionId}/album/share-token`,
          method: "POST"
        });
        const data = dataOf(response) || {};
        this.albumShareToken = data.token || "";
        this.shareSubject = data.share_subject || this.localAlbumShareSubject();
      } catch (error) {
        this.albumShareToken = "";
        this.shareSubject = null;
      }
      this.showShareMenus();
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
    roleFilterOptionLabel(person) {
      const title = this.tagPersonTitle(person);
      const subtitle = this.tagPersonSubtitle(person);
      const genderText =
        person?.tag_type === "session_npc_role"
          ? ` ${this.npcRoleGenderText(person.role_gender)}`
          : "";
      return subtitle ? `${title}${genderText} / ${subtitle}` : `${title}${genderText}`;
    },
    albumRoleNameFromMineTags() {
      const roleCounts = new Map();
      for (const photo of this.photos || []) {
        if (!photo.is_mine) {
          continue;
        }
        for (const tag of photo.tags || []) {
          if (tag.tag_type === "seat") {
            const label = String(tag.label || "").trim();
            if (!label) {
              continue;
            }
            const key = tag.key || (tag.seat_id ? `seat:${tag.seat_id}` : label);
            const current = roleCounts.get(key) || { label, count: 0 };
            roleCounts.set(key, {
              label: current.label || label,
              count: current.count + 1
            });
            continue;
          }
        }
      }
      return (
        [...roleCounts.values()].sort((left, right) => right.count - left.count)[0]?.label || ""
      );
    },
    npcRoleGenderText(roleGender) {
      return roleGenderSymbol(roleGender) || "不限";
    },
    npcRoleGenderClass(roleGender) {
      return normalizeRoleGender(roleGender);
    },
    albumTagSection(key, title, people) {
      return {
        key,
        title,
        items: people.map((person) => this.albumTagCard(person))
      };
    },
    albumTagCard(person) {
      const selected = this.selectedTagKeys.includes(person.key);
      return {
        key: person.key,
        id: person.key,
        raw: person,
        name: this.tagPersonTitle(person),
        note: this.tagPersonSubtitle(person),
        roleGender: person.role_gender || person.roleGender || person.gender || "unlimited",
        genderSymbol:
          person.tag_type === "session_npc_role"
            ? this.npcRoleGenderText(person.role_gender)
            : "",
        showGenderSymbol: person.tag_type === "session_npc_role",
        selected,
        checked: selected,
        stateKind: selected ? "mine" : "available",
        stateLabel: selected ? "已选" : "可选"
      };
    },
    handleAlbumTagTap(payload) {
      this.togglePerson(payload.item.key);
    },
    photosForAlbumFilter(filterValue, options = {}) {
      const includeRole = options.includeRole !== false;
      let scopedPhotos = this.photos;
      if (filterValue === "mine") {
        scopedPhotos = scopedPhotos.filter((photo) => photo.is_mine);
      }
      if (filterValue === "withMe") {
        scopedPhotos = scopedPhotos.filter((photo) =>
          photo.tags.some((tag) => Number(tag.user_id) === Number(this.currentUserId))
        );
      }
      if (filterValue === "untagged") {
        scopedPhotos = scopedPhotos.filter((photo) => photo.tags.length === 0);
      }
      return includeRole
        ? scopedPhotos.filter((photo) => this.photoMatchesSelectedRole(photo))
        : scopedPhotos;
    },
    countAlbumPhotosForFilter(filterValue) {
      return this.photosForAlbumFilter(filterValue).length;
    },
    countPhotosForRole(roleKey) {
      if (!roleKey) {
        return this.photosForAlbumFilter(this.activeFilter, { includeRole: false }).length;
      }
      return this.photosForAlbumFilter(this.activeFilter, { includeRole: false }).filter((photo) =>
        this.photoMatchesRole(photo, roleKey)
      ).length;
    },
    photoMatchesSelectedRole(photo) {
      if (!this.selectedRoleFilter) {
        return true;
      }
      return this.photoMatchesRole(photo, this.selectedRoleFilter);
    },
    photoMatchesRole(photo, roleKey) {
      return (photo.tags || []).some((tag) => tag.key === roleKey);
    },
    handleRoleFilterChange(event) {
      const index = Number(event?.detail?.value || 0);
      this.selectedRoleFilter = this.albumRoleFilterOptions[index]?.value || "";
    },
    ensureSelectedRoleFilter() {
      if (!this.selectedRoleFilter) {
        return;
      }
      const availableRoleKeys = new Set(this.people.map((person) => person.key));
      if (!availableRoleKeys.has(this.selectedRoleFilter)) {
        this.selectedRoleFilter = "";
      }
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
        this.albumSession = this.albumSessionSummary(data);
        this.hiddenCount = Number(data.hidden_count || 0);
        this.canUpload = Boolean(data.can_upload);
        this.statusText = "";
        this.refreshWaterfall();
        if (this.canUpload) {
          await this.loadPeople();
          this.ensureSelectedRoleFilter();
        } else {
          this.people = [];
          this.selectedRoleFilter = "";
        }
        this.applyAlbumNavigationTitle();
      } catch (error) {
        if (error?.statusCode === 403) {
          this.photos = [];
          this.albumSession = null;
          this.canUpload = false;
          this.statusText = "车局相册发车后仅同车成员可查看。";
          this.refreshWaterfall();
        } else {
          this.statusText = "相册加载失败，请稍后重试。";
        }
        this.applyAlbumNavigationTitle();
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
        this.albumSession = this.albumSessionSummary(data);
        this.shareSubject = data.share_subject || this.shareSubject;
        this.photos = (data.photos || []).map((photo) => this.normalizePhotoMedia(photo));
        this.statusText = "";
        this.refreshWaterfall();
        this.applyAlbumNavigationTitle();
      } catch (error) {
        this.photos = [];
        this.albumSession = null;
        this.canUpload = false;
        this.statusText =
          error?.statusCode === 403
            ? "分享相册已过期或不可访问。"
            : "分享相册加载失败，请稍后重试。";
        this.refreshWaterfall();
        this.applyAlbumNavigationTitle();
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
    ensurePhotosAlbumPermission() {
      return new Promise((resolve) => {
        if (
          typeof uni === "undefined" ||
          typeof uni.saveImageToPhotosAlbum !== "function"
        ) {
          resolve(false);
          return;
        }
        if (
          typeof uni.getSetting !== "function" ||
          typeof uni.authorize !== "function"
        ) {
          resolve(true);
          return;
        }
        uni.getSetting({
          success: (settings) => {
            const authSetting = settings.authSetting || {};
            if (authSetting["scope.writePhotosAlbum"]) {
              resolve(true);
              return;
            }
            uni.authorize({
              scope: "scope.writePhotosAlbum",
              success: () => resolve(true),
              fail: () => {
                if (
                  typeof uni.showModal !== "function" ||
                  typeof uni.openSetting !== "function"
                ) {
                  resolve(false);
                  return;
                }
                uni.showModal({
                  title: "需要相册权限",
                  content: "请允许保存图片到系统相册。",
                  confirmText: "去设置",
                  cancelText: "取消",
                  success: (result) => {
                    if (!result.confirm) {
                      resolve(false);
                      return;
                    }
                    uni.openSetting({
                      success: (openResult) =>
                        resolve(Boolean(openResult.authSetting?.["scope.writePhotosAlbum"])),
                      fail: () => resolve(false)
                    });
                  },
                  fail: () => resolve(false)
                });
              }
            });
          },
          fail: () => resolve(true)
        });
      });
    },
    saveAlbumImageToPhotosAlbum(filePath) {
      return new Promise((resolve, reject) => {
        if (
          typeof uni === "undefined" ||
          typeof uni.saveImageToPhotosAlbum !== "function"
        ) {
          reject(new Error("saveImageToPhotosAlbum unavailable"));
          return;
        }
        uni.saveImageToPhotosAlbum({
          filePath,
          success: resolve,
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
        const session = dataOf(response) || {};
        this.applyAlbumSessionFallback(session);
        return this.sessionDetailPeople(session);
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
          role_gender: seat.role_gender || "unlimited",
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
          role_gender: role.role_gender || "unlimited",
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
    photoDetailText(photo) {
      return `${photo.uploader_name || "车友"} · ${this.formatDate(photo.created_at)}`;
    },
    photoActionDateText(photo) {
      const formatted = this.formatDate(photo.created_at);
      if (!formatted || formatted === "-") {
        return "-";
      }
      return formatted.length > 10 ? formatted.slice(5) : formatted;
    },
    photoSourceIcon(photo) {
      return photo?.is_mine ? "/static/icons/user.png" : "/static/icons/group.png";
    },
    photoSourceLabel(photo) {
      return photo?.is_mine ? "我" : "友";
    },
    showPhotoInfo(photo) {
      if (!photo) {
        return;
      }
      const uploader = photo.uploader_name || "车友";
      const createdAt = this.formatDate(photo.created_at);
      const dimensions = this.imageMetaText(photo);
      uni.showModal({
        title: "图片信息",
        content: `${this.tagSummary(photo)}\n上传者：${uploader}\n时间：${createdAt}\n尺寸：${dimensions}`,
        showCancel: false,
        confirmText: "知道了"
      });
    },
    imageMetaText(photo) {
      const width = Number(photo.image_width || 0);
      const height = Number(photo.image_height || 0);
      const byteSize = Number(photo.image_byte_size || 0);
      const sizeText = byteSize > 0 ? `${Math.max(1, Math.round(byteSize / 1024))}KB` : "大小未知";
      if (width > 0 && height > 0) {
        return `${width}x${height} · ${sizeText}`;
      }
      return sizeText;
    },
    formatDate(value) {
      if (!value) {
        return "-";
      }
      const text = String(value);
      const hasTimeZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(text);
      if (!hasTimeZone) {
        return text.replace("T", " ").slice(0, 16);
      }
      const date = new Date(text);
      if (!Number.isFinite(date.getTime())) {
        return text;
      }
      const pad = (number) => String(number).padStart(2, "0");
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
        date.getHours()
      )}:${pad(date.getMinutes())}`;
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
      this.skipNextAlbumRefreshOnShow = true;
      uni.previewImage({
        urls: [previewUrl],
        current: previewUrl,
        fail: () => {
          this.skipNextAlbumRefreshOnShow = false;
        }
      });
    },
    async downloadSinglePhoto(photo) {
      await this.downloadPhotos([photo], {
        confirmContent: "将保存这张照片到系统相册，是否继续？"
      });
    },
    async downloadSelectedPhotos() {
      const selectedIdSet = new Set(this.selectedPhotoIds.map((photoId) => Number(photoId)));
      const photos = this.filteredPhotos.filter((photo) => selectedIdSet.has(Number(photo.id)));
      await this.downloadPhotos(photos, {
        exitSelection: true,
        confirmContent: `将保存所选 ${photos.length} 张照片到系统相册，是否继续？`
      });
    },
    async downloadAllPhotos() {
      await this.downloadPhotos(this.photos, {
        confirmContent: `将保存我的相册中 ${this.photos.length} 张照片到系统相册，是否继续？`
      });
    },
    confirmDownloadPhotos(content) {
      return new Promise((resolve) => {
        uni.showModal({
          title: "确认下载",
          content,
          confirmText: "下载",
          cancelText: "取消",
          success(result) {
            resolve(Boolean(result.confirm));
          },
          fail() {
            resolve(false);
          }
        });
      });
    },
    async downloadPhotos(photos, options = {}) {
      if (this.timelineMode || this.albumBusy) {
        return;
      }
      const targets = (photos || []).filter((photo) => this.mediaUrlForPhoto(photo));
      if (targets.length === 0) {
        uni.showToast({ title: "暂无可下载照片", icon: "none" });
        return;
      }
      const confirmed = await this.confirmDownloadPhotos(
        options.confirmContent || `将保存 ${targets.length} 张照片到系统相册，是否继续？`
      );
      if (!confirmed || this.albumBusy) {
        return;
      }
      this.downloading = true;
      let savedCount = 0;
      let failedCount = 0;
      try {
        const allowed = await this.ensurePhotosAlbumPermission();
        if (!allowed) {
          this.statusText = "未获得相册保存权限。";
          uni.showToast({ title: "未获得保存权限", icon: "none" });
          return;
        }
        for (const [index, photo] of targets.entries()) {
          this.downloadProgressText = `正在保存 ${index + 1}/${photos.length} 张照片...`;
          try {
            const cachedPreview = this.visiblePhotoMedia[photo.id]?.preview || photo.display_url;
            const filePath = cachedPreview || (await this.loadVisiblePhotoMedia(photo, "preview"));
            if (!filePath) {
              throw new Error("album photo unavailable");
            }
            await this.saveAlbumImageToPhotosAlbum(filePath);
            savedCount += 1;
          } catch (error) {
            failedCount += 1;
          }
        }
        this.statusText = "";
        if (options.exitSelection) {
          this.selectionMode = false;
          this.selectionModePurpose = "tag";
          this.selectedPhotoIds = [];
          this.updateTopActionsFloating();
        }
        if (savedCount > 0 && failedCount === 0) {
          uni.showToast({ title: `已保存 ${savedCount} 张`, icon: "none" });
          return;
        }
        if (savedCount > 0) {
          uni.showToast({ title: "部分照片保存失败", icon: "none" });
          return;
        }
        uni.showToast({ title: "下载照片失败", icon: "none" });
      } finally {
        this.downloading = false;
        this.downloadProgressText = "";
      }
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
    openDownloadSelectionMode() {
      if (this.timelineMode || this.albumBusy || this.filteredPhotos.length === 0) {
        return;
      }
      this.selectionMode = true;
      this.selectionModePurpose = "download";
      this.selectedPhotoIds = [];
      this.topActionsFloating = false;
    },
    openTagSelectionMode() {
      if (this.timelineMode || this.albumBusy || this.taggablePhotos.length === 0) {
        return;
      }
      this.selectionMode = true;
      this.selectionModePurpose = "tag";
      this.selectedPhotoIds = [];
      this.topActionsFloating = false;
    },
    toggleSelectionMode() {
      if (this.timelineMode || this.albumBusy) {
        return;
      }
      if (!this.selectionMode) {
        this.openTagSelectionMode();
        return;
      }
      this.selectionMode = false;
      this.selectionModePurpose = "tag";
      this.selectedPhotoIds = [];
      this.updateTopActionsFloating();
    },
    canSelectPhoto(photo) {
      if (!this.selectionMode) {
        return false;
      }
      if (this.selectionModePurpose === "download") {
        return Boolean(this.mediaUrlForPhoto(photo));
      }
      return Boolean(photo.can_tag);
    },
    isPhotoSelected(photo) {
      return this.selectedPhotoIds.includes(Number(photo.id));
    },
    togglePhotoSelection(photo) {
      if (this.timelineMode || !this.selectionMode || this.albumBusy || !this.canSelectPhoto(photo)) {
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
      if (
        this.timelineMode ||
        this.albumBusy ||
        this.selectionModePurpose !== "tag" ||
        this.selectedTaggablePhotoIds.length === 0
      ) {
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
        ? [...this.selectedTaggablePhotoIds]
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
        this.updateTopActionsFloating();
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
  overflow-x: hidden;
  box-sizing: border-box;
}

.album-head {
  padding: 30rpx 32rpx 28rpx;
  border-color: rgba(222, 215, 202, 0.74);
  border-radius: 20rpx;
  background: rgba(255, 255, 252, 0.96);
  box-shadow: 0 14rpx 36rpx rgba(42, 58, 49, 0.05);
}

.album-head-copy {
  display: flex;
  flex-direction: column;
  gap: 8rpx;
}

.album-kicker {
  color: #8a7c63;
  font-size: 22rpx;
  line-height: 1.2;
}

.album-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18rpx;
}

.album-title {
  margin-bottom: 0;
  font-size: 40rpx;
  line-height: 1.12;
}

.album-progress-badge {
  flex-shrink: 0;
  padding: 8rpx 14rpx;
  border-radius: 999rpx;
  background: rgba(31, 111, 91, 0.08);
  color: #1f6f5b;
  font-size: 22rpx;
  line-height: 1.2;
}

.album-intro {
  color: #738078;
  font-size: 25rpx;
  line-height: 1.5;
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

.album-notice {
  margin-top: 18rpx;
  padding: 14rpx 16rpx;
  border-radius: 10rpx;
  font-size: 23rpx;
}

.album-metrics {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0;
  margin-top: 24rpx;
  padding: 18rpx 0;
  border-top: 1rpx solid rgba(222, 215, 202, 0.62);
  border-bottom: 1rpx solid rgba(222, 215, 202, 0.62);
}

.album-metrics.public {
  grid-template-columns: minmax(0, 1fr);
}

.album-metric {
  min-width: 0;
  padding: 0 16rpx;
  border-left: 1rpx solid rgba(222, 215, 202, 0.62);
}

.album-metric:first-child {
  border-left: 0;
  padding-left: 0;
}

.album-metric:last-child {
  padding-right: 0;
}

.metric-value,
.metric-label {
  display: block;
}

.metric-value {
  color: #153f34;
  font-size: 30rpx;
  font-weight: 600;
  line-height: 1.1;
}

.album-metric.primary .metric-value {
  color: #1f6f5b;
}

.metric-label {
  margin-top: 6rpx;
  color: #839087;
  font-size: 20rpx;
  line-height: 1.2;
}

.album-privacy-note {
  margin-top: 14rpx;
  color: #9b8d70;
  font-size: 22rpx;
  line-height: 1.4;
}

.album-actions-shell {
  margin: 0 0 20rpx;
}

.album-actions-shell.floating {
  min-height: 430rpx;
}

.album-actions {
  display: flex;
  flex-direction: column;
  gap: 12rpx;
  padding: 14rpx;
  border: 1rpx solid rgba(223, 216, 204, 0.9);
  border-radius: 14rpx;
  background: rgba(255, 255, 252, 0.98);
  box-shadow: 0 12rpx 28rpx rgba(32, 44, 38, 0.12);
  box-sizing: border-box;
}

.album-sticky-actions.floating {
  position: fixed;
  top: 0;
  right: 20rpx;
  left: 20rpx;
  z-index: 900;
  max-height: 64vh;
  overflow-y: auto;
}

.album-primary-actions {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 180rpx;
  gap: 12rpx;
}

.album-action-primary,
.album-privacy-action {
  height: 78rpx;
  margin: 0;
  border-radius: 12rpx;
  font-size: 26rpx;
}

.album-action-primary {
  box-shadow: 0 12rpx 24rpx rgba(31, 111, 91, 0.18);
}

.album-privacy-action {
  padding: 0 18rpx;
}

.album-action-groups {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14rpx;
}

.album-action-group {
  min-width: 0;
}

.album-action-group-title {
  margin-bottom: 8rpx;
  color: #8a7c63;
  font-size: 21rpx;
  line-height: 1.2;
}

.album-command-rail {
  display: flex;
  min-width: 0;
  min-height: 70rpx;
  padding: 4rpx;
  border: 1rpx solid rgba(222, 215, 202, 0.82);
  border-radius: 14rpx;
  background: rgba(250, 248, 241, 0.72);
}

.album-command,
.album-action-hint {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1;
  min-width: 0;
  min-height: 62rpx;
  margin: 0;
  padding: 0 8rpx;
  border: 0;
  border-radius: 10rpx;
  background: transparent;
  color: #23483f;
  font-size: 22rpx;
  font-weight: 500;
  line-height: 1.16;
  box-shadow: none;
}

.album-command::after {
  border: 0;
}

.album-command + .album-command {
  border-left: 1rpx solid rgba(222, 215, 202, 0.76);
  border-radius: 0;
}

.album-command[disabled] {
  color: #9aa39c;
}

.album-action-hint {
  color: #839087;
  font-weight: 400;
}

.album-filter-panel {
  margin-bottom: 20rpx;
  padding: 18rpx;
  border: 1rpx solid rgba(223, 216, 204, 0.82);
  border-radius: 12rpx;
  background: rgba(255, 255, 252, 0.8);
}

.album-toolbar-filter-panel {
  margin: 2rpx 0 0;
  padding: 14rpx 0 0;
  border: 0;
  border-top: 1rpx solid rgba(223, 216, 204, 0.9);
  border-radius: 0;
  background: transparent;
}

.filter-panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16rpx;
  margin-bottom: 14rpx;
}

.filter-panel-title {
  color: #153f34;
  font-size: 25rpx;
  font-weight: 600;
}

.filter-panel-count {
  flex-shrink: 0;
  color: #839087;
  font-size: 21rpx;
}

.filter-row {
  display: flex;
  flex-wrap: wrap;
  gap: 12rpx;
}

.filter-chip {
  display: inline-flex;
  align-items: center;
  gap: 8rpx;
  margin: 0;
  padding: 10rpx 18rpx;
  border: 1rpx solid rgba(223, 216, 204, 0.92);
  border-radius: 8rpx;
  background: rgba(255, 255, 252, 0.96);
  color: #607068;
  font-size: 23rpx;
  line-height: 1.2;
}

.filter-chip.active {
  border-color: #1f6f5b;
  background: #eef5ef;
  color: #1f6f5b;
  font-weight: 600;
}

.filter-count {
  color: inherit;
  font-size: 20rpx;
  opacity: 0.74;
}

.role-filter-row {
  display: flex;
  align-items: center;
  gap: 14rpx;
  margin-top: 16rpx;
}

.role-filter-label {
  flex-shrink: 0;
  color: #607068;
  font-size: 23rpx;
}

.role-filter-row picker {
  flex: 1;
  min-width: 0;
}

.role-filter-picker {
  overflow: hidden;
  padding: 14rpx 18rpx;
  border: 1rpx solid rgba(223, 216, 204, 0.92);
  border-radius: 8rpx;
  background: rgba(255, 255, 252, 0.96);
  color: #153f34;
  font-size: 24rpx;
  line-height: 1.2;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.role-filter-picker.disabled {
  color: #9aa39c;
  background: #f7f4ee;
}

.photo-waterfall {
  display: flex;
  width: 100%;
  max-width: 100%;
  overflow-x: hidden;
  box-sizing: border-box;
  align-items: flex-start;
}

.waterfall-column {
  width: 100%;
  max-width: 100%;
  overflow: hidden;
  min-width: 0;
  box-sizing: border-box;
}

.waterfall-photo-card {
  width: 100%;
  max-width: 100%;
  box-sizing: border-box;
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
  padding: 14rpx 14rpx 12rpx;
}

@keyframes album-spin {
  to {
    transform: rotate(360deg);
  }
}

.photo-caption-body {
  min-width: 0;
}

.photo-caption-title {
  overflow: hidden;
  color: #163f35;
  font-size: 23rpx;
  font-weight: 700;
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.photo-caption-title.pending {
  color: #9c7440;
}

.photo-actions-row {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  column-gap: 12rpx;
  margin-top: 10rpx;
}

.photo-actions-row.has-danger {
  grid-template-columns: auto minmax(0, 1fr) 64rpx;
  column-gap: 12rpx;
}

.photo-status-slot {
  display: flex;
  align-items: center;
  min-width: 54rpx;
}

.photo-source-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5rpx;
  width: 54rpx;
  height: 40rpx;
  border-radius: 999rpx;
  background: rgba(31, 122, 104, 0.09);
  color: #1f7a68;
}

.photo-source-icon {
  width: 20rpx;
  height: 20rpx;
}

.photo-source-label {
  color: #1f7a68;
  font-size: 19rpx;
  font-weight: 600;
  line-height: 1;
}

.photo-safe-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 12rpx;
  min-width: 0;
}

.photo-action-text {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 50rpx;
  height: 42rpx;
  margin: 0;
  padding: 0 6rpx;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: #2c7f6e;
  font-size: 20rpx;
  font-weight: 600;
  line-height: 1.2;
  box-shadow: none;
}

.photo-action-text::after {
  border: 0;
}

.photo-action-text.primary {
  color: #0f5f50;
}

.photo-action-text.danger {
  width: 64rpx;
  padding: 0;
  color: #c44a42;
  font-weight: 600;
}

.photo-action-text[disabled] {
  color: #9aa39c;
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

.album-page.selection-active {
  padding-bottom: 190rpx;
}

.album-floating-toolbar {
  position: fixed;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 1000;
  display: flex;
  align-items: flex-start;
  gap: 12rpx;
  height: 132rpx;
  padding: 14rpx 20rpx 0;
  padding-bottom: env(safe-area-inset-bottom);
  border-top: 1rpx solid #dfd8cc;
  border-radius: 16rpx 16rpx 0 0;
  background-color: #fffefc;
  box-shadow: 0 -12rpx 30rpx rgba(15, 23, 42, 0.12);
  box-sizing: border-box;
}

.floating-toolbar-button {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 184rpx;
  min-width: 0;
  height: 76rpx;
  border-radius: 12rpx;
  background-color: #1f6f5b;
  color: #ffffff;
  font-size: 26rpx;
  font-weight: 500;
  line-height: 1.2;
  text-align: center;
  box-sizing: border-box;
}

.floating-toolbar-button.secondary {
  flex-basis: 132rpx;
  border: 1rpx solid #ded8ca;
  background-color: #fffefc;
  color: #193d35;
}

.floating-toolbar-button.disabled {
  background-color: #d7dbd6;
  color: #7a857d;
  opacity: 1;
}

.bulk-count {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1;
  min-width: 0;
  height: 76rpx;
  color: #334155;
  font-size: 25rpx;
  line-height: 1.2;
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
  display: inline-flex;
  align-items: center;
  gap: 8rpx;
  padding: 9rpx 14rpx;
  border-radius: 8rpx;
  background: #eef5ef;
  color: #1f6f5b;
  font-size: 23rpx;
}

.npc-gender-mark {
  padding: 1rpx 8rpx;
  border-radius: 999rpx;
  background: #ecefec;
  color: #747b74;
  font-size: 20rpx;
  font-weight: 700;
  line-height: 1.35;
}

.npc-gender-mark.male {
  background: #e5f1ee;
  color: #316f62;
}

.npc-gender-mark.female {
  background: #fae7ef;
  color: #b34c75;
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
