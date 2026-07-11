<template>
  <section
    class="album-workspace"
    :class="{
      'drawer-open': tagDrawerOpen || privacyDrawerOpen,
      'bulk-selecting': bulkSelectionMode
    }"
  >
    <p v-if="error" class="error">{{ error }}</p>
    <p v-if="albumActionBusy" class="loading-strip">{{ albumBusyText }}</p>

    <div class="album-layout">
      <div class="table-card album-detail-card">
        <template v-if="selectedSession">
          <div class="section-head album-detail-head">
            <div>
              <h3>{{ selectedSession.script_name_snapshot || "车局相册" }}</h3>
              <span>
                {{ selectedSession.store_name_snapshot || "未选店家" }} ·
                {{ formatDate(selectedSession.start_at) }}
              </span>
            </div>
            <span class="status-pill" :class="selectedSession.status">
              {{ sessionStatusLabel(selectedSession.status) }}
            </span>
          </div>

          <p v-if="albumError" class="warning">{{ albumError }}</p>
          <p v-else-if="albumStatus" class="status album-status">{{ albumStatus }}</p>

          <div ref="albumCommandSentinel" class="album-command-sentinel" aria-hidden="true"></div>
          <div
            class="album-command-bar"
            :class="{ selecting: bulkSelectionMode, floating: albumCommandFloating }"
          >
            <div class="album-command-main">
              <div class="album-filter-group">
                <span class="album-control-label">筛选</span>
                <div class="filter-chip-row">
                  <button
                    v-for="filter in albumFilterOptions"
                    :key="filter.value"
                    type="button"
                    class="filter-chip"
                    :class="{ active: activeAlbumFilter === filter.value }"
                    :disabled="albumActionBusy"
                    @click="activeAlbumFilter = filter.value"
                  >
                    <span>{{ filter.label }}</span>
                    <small>{{ filter.count }}</small>
                  </button>
                </div>
                <select
                  v-model="selectedAlbumRoleFilter"
                  class="album-role-select"
                  :disabled="albumActionBusy || albumRoleFilterOptions.length <= 1"
                  aria-label="按标注角色筛选"
                >
                  <option
                    v-for="option in albumRoleFilterOptions"
                    :key="option.value"
                    :value="option.value"
                  >
                    {{ option.label }}
                  </option>
                </select>
              </div>
              <div class="album-command-actions">
                <button
                  v-if="!bulkSelectionMode"
                  class="secondary-action"
                  type="button"
                  :disabled="uploadDisabled"
                  @click="openFilePicker"
                >
                  上传
                </button>
                <button
                  v-if="!bulkSelectionMode"
                  class="secondary-action"
                  type="button"
                  :disabled="albumActionBusy || Boolean(albumError)"
                  @click="openPrivacyDrawer"
                >
                  {{ loadingPrivacy ? "载入中..." : "隐私" }}
                </button>
                <button
                  v-if="!bulkSelectionMode"
                  class="primary"
                  type="button"
                  :disabled="albumActionBusy || Boolean(albumError) || taggablePhotos.length === 0"
                  @click="toggleBulkSelectionMode"
                >
                  多选
                </button>
              </div>
            </div>
          </div>

          <div v-if="bulkSelectionMode" class="album-selection-toolbar">
            <div class="album-selection-status">
              <strong>已选 {{ selectedAlbumPhotoCount }} 张</strong>
              <span>当前筛选可标注 {{ taggablePhotos.length }} 张</span>
            </div>
            <div class="album-selection-actions">
              <button
                class="secondary-action"
                type="button"
                :disabled="albumActionBusy"
                @click="toggleBulkSelectionMode"
              >
                退出多选
              </button>
              <button
                class="secondary-action"
                type="button"
                :disabled="albumActionBusy || taggablePhotos.length === 0"
                @click="toggleSelectFilteredPhotos"
              >
                {{ allFilteredTaggableSelected ? "取消全选" : "全选当前筛选" }}
              </button>
              <button
                class="secondary-action"
                type="button"
                :disabled="albumActionBusy || selectedAlbumPhotoCount === 0"
                @click="clearBulkSelection"
              >
                清空
              </button>
              <button
                class="primary"
                type="button"
                :disabled="albumActionBusy || selectedAlbumPhotoCount === 0"
                @click="openBulkTagDrawer"
              >
                批量标注
              </button>
            </div>
          </div>

          <div class="album-workbench">
            <div
              v-if="!bulkSelectionMode"
              class="upload-zone"
              :class="{ dragging, disabled: uploadDisabled }"
              @dragenter.prevent="dragging = true"
              @dragover.prevent="dragging = true"
              @dragleave.prevent="dragging = false"
              @drop.prevent="handleDrop"
            >
              <input
                ref="fileInput"
                class="sr-only"
                type="file"
                accept="image/jpeg,image/png"
                multiple
                @change="handleFileChange"
              />
              <span class="album-upload-icon">+</span>
              <div>
                <strong>{{ uploading ? "正在上传照片" : "拖拽照片" }}</strong>
                <span>JPG / PNG，单张不超过 4MB</span>
              </div>
            </div>

            <div class="album-metrics">
              <div class="album-summary">
                <span>
                  当前筛选 {{ filteredPhotos.length }} 张 / 我的照片 {{ visiblePhotoCount }} 张 /
                  筛选已标注 {{ filteredTaggedPhotoCount }} 张 / 筛选待标注 {{ filteredUntaggedPhotoCount }} 张
                </span>
                <span v-if="Number(album?.hidden_count || 0) > 0">
                  {{ album.hidden_count }} 张非本人照片或受隐私保护未展示
                </span>
              </div>

              <div class="album-progress" aria-label="相册标注进度">
                <div class="album-progress-bar">
                  <span class="album-progress-fill" :style="{ width: `${filteredTagProgressPercent}%` }"></span>
                </div>
                <span>{{ filteredTagProgressPercent }}%</span>
              </div>
            </div>
          </div>

          <div v-if="albumLoading" class="empty-block">正在加载相册...</div>
          <div v-else-if="!albumError && filteredPhotos.length === 0" class="empty-block">
            {{ album?.photos?.length ? "没有符合当前筛选的照片。" : "还没有你的照片，上传后会出现在这里。" }}
          </div>
          <Waterfall
            v-else-if="!albumError"
            ref="albumWaterfall"
            class="admin-photo-waterfall"
            :list="filteredPhotos"
            row-key="id"
            img-selector="thumbnail_url"
            :breakpoints="albumWaterfallBreakpoints"
            :gutter="14"
            :space="14"
            :has-around-gutter="false"
            :lazyload="false"
            background-color="transparent"
          >
            <template #default="{ item: photo }">
              <article
                class="admin-photo"
                :class="{
                  'video-card': photo.media_type === 'video',
                  selectable: bulkSelectionMode && photo.can_tag,
                  selected: bulkSelectionMode && isAlbumPhotoSelected(photo),
                  disabled: bulkSelectionMode && !photo.can_tag
                }"
              >
                <button
                  class="photo-preview"
                  :class="{ 'video-preview': photo.media_type === 'video' }"
                  type="button"
                  :disabled="albumActionBusy || (bulkSelectionMode && !photo.can_tag)"
                  @click="bulkSelectionMode ? toggleAlbumPhotoSelection(photo) : previewMedia(photo)"
                >
                  <template v-if="photo.media_type === 'video'">
                    <AuthorizedLazyImage
                      v-if="photo.cover_url"
                      :media-key="photo.id"
                      :src="photo.cover_url"
                      :ratio="photoAspectRatio(photo)"
                      @loaded="rerenderAlbumWaterfall"
                      @error="handleVideoCoverError(photo, $event)"
                    />
                    <div v-else class="admin-video-placeholder">
                      {{ videoStateText(photo) }}
                    </div>
                    <span v-if="videoReady(photo)" class="admin-video-play">▶</span>
                    <span class="admin-video-state">
                      {{ videoReady(photo) ? formatVideoDuration(photo.duration_seconds) : videoStateText(photo) }}
                    </span>
                  </template>
                  <AuthorizedLazyImage
                    v-else
                    :media-key="photo.id"
                    :src="photo.thumbnail_url || photo.image_url"
                    :ratio="photoAspectRatio(photo)"
                    @loaded="rerenderAlbumWaterfall"
                    @error="handleImageThumbnailError(photo, $event)"
                  />
                  <span
                    v-if="bulkSelectionMode"
                    class="album-selection-checkbox"
                    :class="{ selected: isAlbumPhotoSelected(photo), disabled: !photo.can_tag }"
                  >
                    <span class="album-selection-checkbox-box">
                      {{ isAlbumPhotoSelected(photo) ? "✓" : "" }}
                    </span>
                  </span>
                </button>
              <div class="photo-info">
                <strong>{{ tagSummary(photo) }}</strong>
                <span>{{ photo.uploader_name || "车友" }} · {{ formatDate(photo.created_at) }}</span>
                <span>{{ mediaMetaText(photo) }}</span>
              </div>
              <div v-if="!bulkSelectionMode" class="photo-actions">
                <button
                  v-if="photo.can_tag"
                  type="button"
                  class="action-button"
                  :disabled="albumActionBusy"
                  @click="openTagDrawer(photo)"
                >
                  标注
                </button>
                <button
                  v-if="photo.can_delete"
                  type="button"
                  class="action-button danger"
                  :disabled="albumActionBusy"
                  @click="deletePhoto(photo)"
                >
                  {{ deletingPhotoId === photo.id ? "删除中..." : "删除" }}
                </button>
                <span v-if="!photo.can_tag && !photo.is_mine" class="status">
                  仅上传者可管理
                </span>
              </div>
              </article>
            </template>
          </Waterfall>
        </template>

        <div v-else class="empty-block">请先从车详情进入相册。</div>
      </div>
    </div>

    <aside v-if="tagDrawerOpen" class="drawer album-tag-drawer">
      <div class="drawer-head">
        <h2>{{ bulkTagging ? `给 ${selectedTagTargetCount} 张照片标注` : "标注照片" }}</h2>
        <button class="close-button" type="button" :disabled="savingTags" @click="closeTagDrawer">
          关闭
        </button>
      </div>
      <div class="drawer-body">
        <img
          v-if="!bulkTagging && taggingPhoto.display_url"
          class="tag-preview"
          :src="taggingPhoto.display_url"
          alt=""
        />
        <div v-else-if="!bulkTagging && taggingPhoto.media_type === 'video'" class="tag-preview video-tag-preview">
          {{ videoStateText(taggingPhoto) }}
        </div>
        <div v-else class="bulk-tag-summary">
          <strong>已选 {{ selectedAlbumPhotoCount }} 张照片</strong>
          <span>保存后，这些照片会替换成同一组标签。</span>
        </div>
        <p class="status">
          {{
            bulkTagging
              ? "批量标注会逐张保存，沿用单张照片权限校验。"
              : "未标注照片只有上传者可见；标注角色后只展示给上传者和对应被标注成员。"
          }}
        </p>
        <div class="selected-tag-row">
          <button
            v-for="person in selectedPeople"
            :key="person.key"
            type="button"
            class="selected-tag"
            @click="toggleTag(person.key)"
          >
            <span>{{ tagPersonTitle(person) }}</span>
            <span
              v-if="person.tag_type === 'session_npc_role'"
              class="npc-gender-mark"
              :class="npcRoleGenderClass(person.role_gender)"
            >
              {{ npcRoleGenderText(person.role_gender) }}
            </span>
            <span>×</span>
          </button>
          <span v-if="selectedPeople.length === 0">暂未标注，只有上传者可见</span>
        </div>
        <div class="tag-choice-list">
          <label v-for="person in seatPeople" :key="person.key" class="tag-choice">
            <input
              type="checkbox"
              :checked="selectedTagKeys.includes(person.key)"
              @change="toggleTag(person.key)"
            />
            <span>
              <strong>
                {{ tagPersonTitle(person) }}
                <span
                  class="npc-gender-mark"
                  :class="npcRoleGenderClass(person.role_gender)"
                >
                  {{ npcRoleGenderText(person.role_gender) }}
                </span>
              </strong>
              <small v-if="tagPersonSubtitle(person)">{{ tagPersonSubtitle(person) }}</small>
            </span>
          </label>
          <div v-if="npcPeople.length" class="tag-group-title">DM / NPC工作人员</div>
          <label v-for="person in npcPeople" :key="person.key" class="tag-choice">
            <input
              type="checkbox"
              :checked="selectedTagKeys.includes(person.key)"
              @change="toggleTag(person.key)"
            />
            <span>
              <strong>{{ tagPersonTitle(person) }}</strong>
              <small v-if="tagPersonSubtitle(person)">{{ tagPersonSubtitle(person) }}</small>
            </span>
          </label>
          <div v-if="npcRolePeople.length" class="tag-group-title">NPC角色</div>
          <label v-for="person in npcRolePeople" :key="person.key" class="tag-choice">
            <input
              type="checkbox"
              :checked="selectedTagKeys.includes(person.key)"
              @change="toggleTag(person.key)"
            />
            <span>
              <strong>{{ tagPersonTitle(person) }}</strong>
              <small v-if="tagPersonSubtitle(person)">{{ tagPersonSubtitle(person) }}</small>
            </span>
          </label>
          <div v-if="otherPeople.length" class="tag-group-title">其他</div>
          <label v-for="person in otherPeople" :key="person.key" class="tag-choice">
            <input
              type="checkbox"
              :checked="selectedTagKeys.includes(person.key)"
              @change="toggleTag(person.key)"
            />
            <span>
              <strong>{{ tagPersonTitle(person) }}</strong>
              <small v-if="tagPersonSubtitle(person)">{{ tagPersonSubtitle(person) }}</small>
            </span>
          </label>
          <div v-if="people.length === 0" class="empty-block">当前车局没有可标注对象。</div>
        </div>
      </div>
      <div class="drawer-footer">
        <button class="secondary-action" type="button" :disabled="savingTags" @click="closeTagDrawer">
          取消
        </button>
        <button class="primary" type="button" :disabled="savingTags" @click="saveTags">
          {{ savingTags ? "保存中..." : "保存标注" }}
        </button>
      </div>
    </aside>

    <aside v-if="privacyDrawerOpen" class="drawer album-privacy-drawer">
      <div class="drawer-head">
        <h2>相册分享隐私设置</h2>
        <button
          class="close-button"
          type="button"
          :disabled="savingPrivacy"
          @click="closePrivacyDrawer"
        >
          关闭
        </button>
      </div>
      <div class="drawer-body">
        <p class="status">规则和小程序一致：完整相册只展示本人相关照片，分享展示继续尊重隐私设置。</p>
        <label class="privacy-toggle">
          <span>
            <strong>允许我上传的照片出现在分享展示里</strong>
            <small>关闭后，别人分享相册时不会展示你上传的照片。</small>
          </span>
          <input v-model="privacyForm.allowUploadedVisible" type="checkbox" :disabled="savingPrivacy" />
        </label>
        <label class="privacy-toggle">
          <span>
            <strong>允许包含我的照片出现在分享展示里</strong>
            <small>关闭后，别人分享相册时不会展示包含你的照片。</small>
          </span>
          <input v-model="privacyForm.allowTaggedVisible" type="checkbox" :disabled="savingPrivacy" />
        </label>
        <div class="privacy-rule-list">
          <div>完整相册只展示你上传或标注了你的照片</div>
          <div>分享展示会继续尊重这两项设置</div>
          <div>车头也不能越权查看原图</div>
        </div>
      </div>
      <div class="drawer-footer">
        <button class="secondary-action" type="button" :disabled="savingPrivacy" @click="closePrivacyDrawer">
          取消
        </button>
        <button class="primary" type="button" :disabled="savingPrivacy" @click="savePrivacy">
          {{ savingPrivacy ? "保存中..." : "保存设置" }}
        </button>
      </div>
    </aside>
  </section>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { Waterfall } from "vue-waterfall-plugin-next";
import "vue-waterfall-plugin-next/dist/style.css";
import AuthorizedLazyImage from "./AuthorizedLazyImage.vue";
import {
  createAdminAlbumRefreshController,
  normalizeAdminAlbumImage,
  RequestSerial,
  uploadAdminAlbumPhoto
} from "../albumMedia";
import {
  createSessionAlbumPhoto,
  clearAlbumPhotoAuthorization,
  deleteSessionAlbumPhoto,
  finalizeAlbumPhotoUpload,
  fetchAuthorizedMediaObjectUrl,
  getAlbumPhotoUploadStatus,
  getMySessionAlbumPrivacy,
  getSession,
  getSessionAlbum,
  getSessionAlbumVideoUrl,
  getStoredAuth,
  listSessionAlbumPeople,
  putAlbumPhotoToCos,
  reportAlbumMediaEvent,
  requestAlbumPhotoUploadIntent,
  updateMySessionAlbumPrivacy,
  updateSessionAlbumPhotoTags,
  uploadSessionAlbumPhotoLocal
} from "../api";

const MAX_PHOTO_BYTES = 4 * 1024 * 1024;
const ACCEPTED_IMAGE_TYPES = new Set(["image/jpeg", "image/png"]);

const props = defineProps({
  sessionId: { type: [String, Number], default: "" }
});

const selectedSession = ref(null);
const album = ref(null);
const people = ref([]);
const error = ref("");
const albumError = ref("");
const albumStatus = ref("");
const albumLoading = ref(false);
const uploading = ref(false);
const dragging = ref(false);
const fileInput = ref(null);
const taggingPhoto = ref(null);
const selectedTagKeys = ref([]);
const savingTags = ref(false);
const bulkSelectionMode = ref(false);
const selectedAlbumPhotoIds = ref([]);
const bulkTagging = ref(false);
const activeAlbumFilter = ref("all");
const selectedAlbumRoleFilter = ref("");
const privacyDrawerOpen = ref(false);
const savingPrivacy = ref(false);
const loadingPrivacy = ref(false);
const deletingPhotoId = ref("");
const albumWaterfall = ref(null);
const albumCommandSentinel = ref(null);
const albumCommandFloating = ref(false);
const privacyForm = ref({
  allowUploadedVisible: true,
  allowTaggedVisible: true
});
const mediaObjectUrls = new Set();
const tagPreviewSerial = new RequestSerial();
const mediaRefreshAttempts = new Set();
let albumRefreshController = null;
const albumPhotoApi = {
  requestAlbumPhotoUploadIntent,
  putAlbumPhotoToCos,
  getAlbumPhotoUploadStatus,
  finalizeAlbumPhotoUpload,
  clearAlbumPhotoAuthorization,
  uploadSessionAlbumPhotoLocal,
  createSessionAlbumPhoto,
  reportAlbumMediaEvent
};
const albumWaterfallBreakpoints = {
  1280: { rowPerView: 4 },
  960: { rowPerView: 3 },
  640: { rowPerView: 2 },
  420: { rowPerView: 1 }
};

const photos = computed(() => album.value?.photos || []);
const visiblePhotoCount = computed(() => photos.value.length);
const visibleUntaggedPhotoCount = computed(
  () => photos.value.filter((photo) => (photo.tags || []).length === 0).length
);
const visibleTaggedPhotoCount = computed(() => visiblePhotoCount.value - visibleUntaggedPhotoCount.value);
const albumTagProgressPercent = computed(() => {
  if (visiblePhotoCount.value === 0) {
    return 0;
  }
  return Math.round((visibleTaggedPhotoCount.value / visiblePhotoCount.value) * 100);
});
const currentUserId = computed(() => getStoredAuth().user?.id || "");
const filteredPhotos = computed(() => photosForAlbumFilter(activeAlbumFilter.value));
const filteredUntaggedPhotoCount = computed(
  () => filteredPhotos.value.filter((photo) => (photo.tags || []).length === 0).length
);
const filteredTaggedPhotoCount = computed(
  () => filteredPhotos.value.length - filteredUntaggedPhotoCount.value
);
const filteredTagProgressPercent = computed(() => {
  if (filteredPhotos.value.length === 0) {
    return 0;
  }
  return Math.round((filteredTaggedPhotoCount.value / filteredPhotos.value.length) * 100);
});
const albumFilterOptions = computed(() =>
  albumFilters.map((filter) => ({
    ...filter,
    count: countAlbumPhotosForFilter(filter.value)
  }))
);
const taggablePhotos = computed(() => filteredPhotos.value.filter((photo) => photo.can_tag));
const tagDrawerOpen = computed(() => Boolean(taggingPhoto.value));
const seatPeople = computed(() => people.value.filter((person) => person.tag_type === "seat"));
const npcPeople = computed(() =>
  people.value.filter((person) => ["dm", "npc"].includes(person.tag_type))
);
const npcRolePeople = computed(() =>
  people.value.filter((person) => person.tag_type === "session_npc_role")
);
const otherPeople = computed(() => people.value.filter((person) => person.tag_type === "other"));
const selectedPeople = computed(() =>
  people.value.filter((person) => selectedTagKeys.value.includes(person.key))
);
const albumRoleFilterOptions = computed(() => [
  { value: "", label: `全部角色 ${photos.value.length}` },
  ...people.value.map((person) => ({
    value: person.key,
    label: `${roleFilterOptionLabel(person)} ${countPhotosForRole(person.key)}`
  }))
]);
const selectedAlbumPhotoCount = computed(() => selectedAlbumPhotoIds.value.length);
const selectedTagTargetCount = computed(() =>
  bulkTagging.value ? selectedAlbumPhotoCount.value : taggingPhoto.value ? 1 : 0
);
const filteredTaggablePhotoIds = computed(() => taggablePhotos.value.map((photo) => Number(photo.id)));
const allFilteredTaggableSelected = computed(
  () =>
    filteredTaggablePhotoIds.value.length > 0 &&
    filteredTaggablePhotoIds.value.every((photoId) => selectedAlbumPhotoIds.value.includes(photoId))
);
const albumActionBusy = computed(
  () =>
    albumLoading.value ||
    uploading.value ||
    savingTags.value ||
    savingPrivacy.value ||
    loadingPrivacy.value ||
    Boolean(deletingPhotoId.value)
);
const albumBusyText = computed(() => {
  if (uploading.value) {
    return albumStatus.value || "正在上传照片...";
  }
  if (savingTags.value) {
    return "正在保存标注...";
  }
  if (savingPrivacy.value) {
    return "正在保存隐私设置...";
  }
  if (loadingPrivacy.value) {
    return "正在载入隐私设置...";
  }
  if (deletingPhotoId.value) {
    return "正在删除照片...";
  }
  return "正在加载相册...";
});
const uploadDisabled = computed(
  () =>
    albumActionBusy.value ||
    uploading.value ||
    albumLoading.value ||
    Boolean(albumError.value) ||
    !selectedSession.value ||
    !album.value?.can_upload
);

function sessionStatusLabel(value) {
  const labels = {
    draft: "草稿",
    recruiting: "招募中",
    locked: "已锁车",
    cancelled: "已取消"
  };
  return labels[value] || value || "-";
}

function tagTypeLabel(value) {
  const labels = {
    seat: "车友",
    dm: "DM",
    npc: "NPC",
    session_npc_role: "NPC角色",
    other: "其他"
  };
  return labels[value] || "成员";
}

function inferredSeatRoleName(person) {
  const parts = String(person?.note || "")
    .split(" · ")
    .map((part) => part.trim())
    .filter(Boolean);
  return parts[1] || parts[0] || "";
}

function tagPersonTitle(person) {
  if (person?.tag_type !== "seat") {
    return person?.label || tagTypeLabel(person?.tag_type);
  }
  return person.role_name || inferredSeatRoleName(person) || person.label || "车友";
}

function tagPersonSubtitle(person) {
  if (!person) {
    return "";
  }
  const title = tagPersonTitle(person);
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
}

function normalizeNpcRoleGender(value) {
  const gender = String(value || "unlimited").trim();
  if (["male", "男", "男位"].includes(gender)) {
    return "male";
  }
  if (["female", "女", "女位"].includes(gender)) {
    return "female";
  }
  return "unlimited";
}

function npcRoleGenderText(value) {
  const gender = normalizeNpcRoleGender(value);
  if (gender === "male") {
    return "♂";
  }
  if (gender === "female") {
    return "♀";
  }
  return "不限";
}

function npcRoleGenderClass(value) {
  return `gender-${normalizeNpcRoleGender(value)}`;
}

function roleFilterOptionLabel(person) {
  const title = tagPersonTitle(person);
  const subtitle = tagPersonSubtitle(person);
  const genderText =
    person?.tag_type === "session_npc_role" ? ` ${npcRoleGenderText(person.role_gender)}` : "";
  return subtitle ? `${title}${genderText} / ${subtitle}` : `${title}${genderText}`;
}

function photosForAlbumFilter(filterValue, { includeRole = true } = {}) {
  let scopedPhotos = photos.value;
  if (filterValue === "mine") {
    scopedPhotos = scopedPhotos.filter((photo) => photo.is_mine);
  }
  if (filterValue === "withMe") {
    scopedPhotos = scopedPhotos.filter((photo) =>
      (photo.tags || []).some((tag) => Number(tag.user_id) === Number(currentUserId.value))
    );
  }
  if (filterValue === "untagged") {
    scopedPhotos = scopedPhotos.filter((photo) => (photo.tags || []).length === 0);
  }
  return includeRole ? scopedPhotos.filter((photo) => photoMatchesSelectedRole(photo)) : scopedPhotos;
}

function countAlbumPhotosForFilter(filterValue) {
  return photosForAlbumFilter(filterValue).length;
}

function countPhotosForRole(roleKey) {
  if (!roleKey) {
    return photos.value.length;
  }
  return photosForAlbumFilter(activeAlbumFilter.value, { includeRole: false }).filter((photo) =>
    photoMatchesRole(photo, roleKey)
  ).length;
}

function photoMatchesSelectedRole(photo) {
  if (!selectedAlbumRoleFilter.value) {
    return true;
  }
  return photoMatchesRole(photo, selectedAlbumRoleFilter.value);
}

function photoMatchesRole(photo, roleKey) {
  return (photo.tags || []).some((tag) => tag.key === roleKey);
}

function formatDate(value) {
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
  return formatShanghaiDate(date);
}

function formatShanghaiDate(date) {
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day} ${values.hour}:${values.minute}`;
}

function tagSummary(photo) {
  if (!photo.tags || photo.tags.length === 0) {
    return "待标注";
  }
  return `${photo.media_type === "video" ? "视频" : "照片"}里：${photo.tags.map((tag) => tag.label).join("、")}`;
}

function tagsFromSelectedKeys() {
  return selectedTagKeys.value
    .map((key) => people.value.find((person) => person.key === key))
    .filter(Boolean)
    .map((person) => ({
      key: person.key,
      tag_type: person.tag_type,
      seat_id: person.seat_id || null,
      session_npc_role_id: person.session_npc_role_id || null,
      user_id: person.user_id || null,
      label: tagPersonTitle(person)
    }));
}

function applyAlbumTagUpdates(updatedPhotoIds, tags) {
  if (!album.value?.photos || updatedPhotoIds.length === 0) {
    return;
  }
  const updatedIdSet = new Set(updatedPhotoIds.map((photoId) => Number(photoId)));
  let untaggedCount = 0;
  const nextPhotos = album.value.photos.map((photo) => {
    if (!updatedIdSet.has(Number(photo.id))) {
      if ((photo.tags || []).length === 0) {
        untaggedCount += 1;
      }
      return photo;
    }
    const nextPhoto = {
      ...photo,
      tags: tags.map((tag) => ({ ...tag }))
    };
    if (nextPhoto.tags.length === 0) {
      untaggedCount += 1;
    }
    return nextPhoto;
  });
  album.value = {
    ...album.value,
    photos: nextPhotos,
    untagged_count: untaggedCount
  };
}

function imageMetaText(photo) {
  const width = Number(photo.image_width || 0);
  const height = Number(photo.image_height || 0);
  const byteSize = Number(photo.image_byte_size || 0);
  const sizeText = byteSize > 0 ? `${Math.max(1, Math.round(byteSize / 1024))}KB` : "大小未知";
  if (width > 0 && height > 0) {
    return `${width}x${height} · ${sizeText}`;
  }
  return sizeText;
}

function formatFileSize(byteSize) {
  const size = Number(byteSize || 0);
  if (size >= 1024 * 1024) {
    return `${Math.max(0.1, size / 1024 / 1024).toFixed(1)}MB`;
  }
  return `${Math.max(1, Math.round(size / 1024))}KB`;
}

function formatVideoDuration(seconds) {
  const totalSeconds = Math.max(0, Math.round(Number(seconds || 0)));
  const minutes = Math.floor(totalSeconds / 60);
  const remainder = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${remainder}`;
}

function videoReady(photo) {
  return photo?.media_type === "video" && photo.processing_status === "ready";
}

function videoStateText(photo) {
  if (photo?.media_type !== "video") {
    return "";
  }
  if (photo.processing_status === "processing") {
    return "处理中";
  }
  if (photo.processing_status === "failed") {
    return "处理失败";
  }
  return "短视频";
}

function videoMetaText(photo) {
  const width = Number(photo.video_width || 0);
  const height = Number(photo.video_height || 0);
  const byteSize = Number(photo.video_byte_size || 0);
  const sizeText = byteSize > 0 ? formatFileSize(byteSize) : "大小未知";
  const durationText = formatVideoDuration(photo.duration_seconds);
  if (width > 0 && height > 0) {
    return `${durationText} · ${width}x${height} · ${sizeText}`;
  }
  return `${durationText} · ${sizeText}`;
}

function mediaMetaText(photo) {
  return photo.media_type === "video" ? videoMetaText(photo) : imageMetaText(photo);
}

function photoAspectRatio(photo) {
  const width = Number(photo.media_type === "video" ? photo.video_width || 0 : photo.image_width || 0);
  const height = Number(photo.media_type === "video" ? photo.video_height || 0 : photo.image_height || 0);
  if (width > 0 && height > 0) {
    return Math.min(1.8, Math.max(0.68, width / height));
  }
  return 1;
}

function normalizeAlbumMedia(albumData) {
  return {
    ...albumData,
    photos: (albumData.photos || []).map((photo) => {
      if (photo.media_type === "video") {
        return {
          ...photo,
          media_type: "video",
          processing_status: photo.processing_status || "processing",
          tags: photo.tags || [],
          cover_url: photo.cover_url || "",
          video_url: photo.video_url || "",
          thumbnail_url: photo.cover_url || "",
          image_url: photo.cover_url || "",
          display_url: photo.display_url || ""
        };
      }
      return {
        ...normalizeAdminAlbumImage(photo),
        media_type: "image",
        processing_status: photo.processing_status || "ready",
        tags: photo.tags || []
      };
    })
  };
}

function updatePhotoDisplayUrl(photoId, displayUrl) {
  if (!album.value?.photos) {
    return;
  }
  album.value = {
    ...album.value,
    photos: album.value.photos.map((photo) =>
      Number(photo.id) === Number(photoId)
        ? {
            ...photo,
            display_url: displayUrl
          }
        : photo
    )
  };
}

function refreshedMediaUrl(photo, refreshedPhoto) {
  if (!refreshedPhoto) {
    return "";
  }
  if (photo.media_type === "video") {
    return refreshedPhoto.cover_url || "";
  }
  return refreshedPhoto.preview_url || refreshedPhoto.image_url || "";
}

async function refreshAlbumMedia(photo, failedUrl) {
  const photoId = Number(photo?.id || 0);
  const sessionId = Number(selectedSession.value?.id || 0);
  const attemptKey = `${photoId}:${failedUrl}`;
  if (!photoId || !sessionId || !failedUrl) {
    return null;
  }
  if (mediaRefreshAttempts.has(attemptKey)) {
    const retryError = new Error("图片地址刷新后仍不可用");
    retryError.code = "MEDIA_URL_EXPIRED";
    retryError.status = 403;
    throw retryError;
  }
  mediaRefreshAttempts.add(attemptKey);
  await albumRefreshController?.refresh();
  if (Number(selectedSession.value?.id || 0) !== sessionId) {
    return null;
  }
  return (album.value?.photos || []).find(
    (item) => Number(item.id) === photoId
  );
}

async function ensurePreviewMedia(photo) {
  if (photo.display_url) {
    return photo.display_url;
  }
  if (photo.media_type === "video") {
    if (!photo.cover_url) {
      return "";
    }
    const displayUrl = await fetchAdminMediaWithRetry(photo, photo.cover_url);
    mediaObjectUrls.add(displayUrl);
    updatePhotoDisplayUrl(photo.id, displayUrl);
    return displayUrl;
  }
  const displayUrl = await fetchAdminMediaWithRetry(photo, photo.preview_url || photo.image_url);
  mediaObjectUrls.add(displayUrl);
  updatePhotoDisplayUrl(photo.id, displayUrl);
  return displayUrl;
}

async function fetchAdminMediaWithRetry(photo, url) {
  try {
    return await fetchAuthorizedMediaObjectUrl(url);
  } catch (error) {
    if (![401, 403].includes(Number(error?.status)) && error?.code !== "MEDIA_URL_EXPIRED") {
      throw error;
    }
    const refreshedPhoto = await refreshAlbumMedia(photo, url);
    const refreshedUrl = refreshedMediaUrl(photo, refreshedPhoto);
    if (!refreshedUrl) {
      throw error;
    }
    try {
      return await fetchAuthorizedMediaObjectUrl(refreshedUrl);
    } catch (retryError) {
      const terminal = new Error(retryError?.message || "图片地址刷新后仍不可用");
      terminal.code = retryError?.code || "MEDIA_URL_EXPIRED";
      terminal.status = Number(retryError?.status || 0);
      terminal.details = retryError?.details;
      throw terminal;
    }
  }
}

async function handleImageThumbnailError(photo, event) {
  const failedUrl = event?.src || photo.thumbnail_url || photo.image_url || "";
  if (![401, 403].includes(Number(event?.status)) && event?.code !== "MEDIA_URL_EXPIRED") {
    albumStatus.value = event?.code
      ? `${event.message || "照片加载失败"} [${event.code}]`
      : "照片加载失败，请重试。";
    return;
  }
  try {
    await refreshAlbumMedia(photo, failedUrl);
  } catch (refreshError) {
    albumStatus.value = refreshError?.code
      ? `${refreshError.message} [${refreshError.code}]`
      : refreshError?.message || "照片加载失败，请重试。";
  }
}

async function handleVideoCoverError(photo, event) {
  const failedUrl = event?.src || photo.cover_url || "";
  if (![401, 403].includes(Number(event?.status))) {
    albumStatus.value = "视频封面加载失败，请重试。";
    return;
  }
  try {
    const refreshedPhoto = await refreshAlbumMedia(photo, failedUrl);
    const refreshedUrl = refreshedMediaUrl(photo, refreshedPhoto);
    if (!refreshedUrl || refreshedUrl === failedUrl) {
      albumStatus.value = "视频封面加载失败，请重试。";
    }
  } catch (error) {
    albumStatus.value = "视频封面加载失败，请重试。";
  }
}

function rerenderAlbumWaterfall() {
  albumWaterfall.value?.renderer?.();
}

function acceptedFile(file) {
  const typeAllowed = ACCEPTED_IMAGE_TYPES.has(file.type);
  const nameAllowed = /\.(jpe?g|png)$/i.test(file.name || "");
  return typeAllowed || nameAllowed;
}

function isOrganizerAlbumSession(session) {
  return (
    session?.album_membership_role === "organizer" ||
    Number(session?.organizer_user_id || 0) === Number(currentUserId.value || 0)
  );
}

function albumRequestOptions(session = selectedSession.value) {
  return {
    adminOwner: isOrganizerAlbumSession(session)
  };
}

function disposeAlbumRefreshController() {
  albumRefreshController?.dispose();
  albumRefreshController = null;
}

function createAlbumRefreshController() {
  disposeAlbumRefreshController();
  if (!selectedSession.value) return;
  const sessionId = Number(selectedSession.value.id);
  albumRefreshController = createAdminAlbumRefreshController({
    readAlbum: () => album.value || { photos: [] },
    writeAlbum: (next) => {
      if (Number(selectedSession.value?.id || 0) !== sessionId) return;
      album.value = normalizeAlbumMedia(next || { photos: [] });
      void nextTick(rerenderAlbumWaterfall);
    },
    reloadAlbum: async () => {
      try {
        const next = await getSessionAlbum(sessionId, albumRequestOptions());
        reportAlbumMediaEvent("media_refresh_success", { sessionId });
        return normalizeAlbumMedia(next || { photos: [] });
      } catch (refreshError) {
        reportAlbumMediaEvent("media_refresh_failure", {
          sessionId,
          errorCode: refreshError?.code || "MEDIA_REFRESH_FAILED"
        });
        throw refreshError;
      }
    },
    setTimer: window.setTimeout.bind(window),
    clearTimer: window.clearTimeout.bind(window),
    now: Date.now
  });
}

function handleAlbumVisibilityChange() {
  if (document.visibilityState === "visible") {
    void albumRefreshController?.checkNow();
  }
}

async function loadSelectedSession() {
  error.value = "";
  albumError.value = "";
  albumStatus.value = "";
  tagPreviewSerial.invalidate();
  mediaRefreshAttempts.clear();
  disposeAlbumRefreshController();
  revokeAlbumMedia();
  album.value = null;
  people.value = [];
  resetBulkSelection();
  if (!props.sessionId) {
    selectedSession.value = null;
    return;
  }
  try {
    selectedSession.value = await getSession(props.sessionId);
    createAlbumRefreshController();
    await loadAlbum();
  } catch (err) {
    error.value = err.message;
    selectedSession.value = null;
    disposeAlbumRefreshController();
  }
}

async function loadAlbum(options = {}) {
  if (!selectedSession.value) {
    return;
  }
  const fatal = options.fatal !== false;
  albumLoading.value = true;
  tagPreviewSerial.invalidate();
  mediaRefreshAttempts.clear();
  albumStatus.value = "";
  if (fatal) {
    albumError.value = "";
    revokeAlbumMedia();
    album.value = null;
    people.value = [];
    resetBulkSelection();
  }
  try {
    const options = albumRequestOptions();
    const [albumData, peopleData] = await Promise.all([
      getSessionAlbum(selectedSession.value.id, options),
      listSessionAlbumPeople(selectedSession.value.id, options)
    ]);
    const displayById = new Map(
      (album.value?.photos || []).map((photo) => [Number(photo.id), photo.display_url || ""])
    );
    const normalizedAlbum = normalizeAlbumMedia(albumData || { photos: [] });
    album.value = fatal
      ? normalizedAlbum
      : {
          ...normalizedAlbum,
          photos: normalizedAlbum.photos.map((photo) => ({
            ...photo,
            display_url: displayById.get(Number(photo.id)) || photo.display_url || ""
          }))
        };
    people.value = peopleData?.people || [];
    if (fatal) {
      activeAlbumFilter.value = "all";
      selectedAlbumRoleFilter.value = "";
    }
    albumRefreshController?.schedule();
  } catch (err) {
    const message =
      err.status === 403
        ? "车局相册会在发车后开放。请确认这辆车已经到开始时间，且当前账号是车头或同车成员。"
        : err.message;
    if (fatal) {
      albumError.value = message;
    } else {
      albumStatus.value = message || "相册刷新失败，请重试。";
    }
  } finally {
    albumLoading.value = false;
  }
}

function revokeAlbumMedia() {
  for (const url of mediaObjectUrls) {
    URL.revokeObjectURL(url);
  }
  mediaObjectUrls.clear();
}

const albumFilters = [
  { value: "all", label: "我的照片" },
  { value: "mine", label: "我上传的" },
  { value: "withMe", label: "有我" },
  { value: "untagged", label: "待标注" }
];

function openFilePicker() {
  if (uploadDisabled.value) {
    return;
  }
  fileInput.value?.click();
}

function handleFileChange(event) {
  const files = Array.from(event.target.files || []);
  event.target.value = "";
  uploadFiles(files);
}

function handleDrop(event) {
  dragging.value = false;
  if (uploadDisabled.value) {
    return;
  }
  uploadFiles(Array.from(event.dataTransfer?.files || []));
}

async function uploadFiles(files) {
  if (!selectedSession.value || files.length === 0) {
    return;
  }
  const validFiles = files.filter((file) => acceptedFile(file) && file.size <= MAX_PHOTO_BYTES);
  const skippedCount = files.length - validFiles.length;
  if (validFiles.length === 0) {
    albumStatus.value = "没有可上传的文件，请选择 4MB 以内的 JPG 或 PNG。";
    return;
  }

  uploading.value = true;
  try {
    const phaseLabels = {
      preparing: "准备上传",
      uploading: "上传中",
      validating: "校验中",
      complete: "完成"
    };
    for (const [index, file] of validFiles.entries()) {
      const options = albumRequestOptions();
      const result = await uploadAdminAlbumPhoto({
        sessionId: selectedSession.value.id,
        file,
        adminOwner: options.adminOwner,
        api: albumPhotoApi,
        onPhase: ({ phase, retry }) => {
          const retryText = phase === "uploading" && retry > 0 ? `（重试 ${retry}/2）` : "";
          albumStatus.value = `${phaseLabels[phase] || phase}${retryText} ${index + 1}/${validFiles.length}`;
        }
      });
      if (!result?.photo?.id) {
        const responseError = new Error("上传完成但缺少相册记录");
        responseError.code = "UPLOAD_FINALIZE_RESPONSE_INVALID";
        throw responseError;
      }
    }
    albumStatus.value = skippedCount > 0
      ? `上传完成，已跳过 ${skippedCount} 个不符合要求的文件。`
      : "上传完成。";
    await loadAlbum({ fatal: false });
  } catch (err) {
    albumStatus.value = err?.code
      ? `${err.message || "上传失败"} [${err.code}]`
      : err.message || "上传失败，请重试。";
  } finally {
    uploading.value = false;
  }
}

function previewMedia(photo) {
  if (photo.media_type === "video") {
    previewVideo(photo);
    return;
  }
  previewPhoto(photo);
}

async function previewVideo(photo) {
  if (!videoReady(photo)) {
    albumStatus.value = videoStateText(photo) || "视频暂不可播放。";
    return;
  }
  try {
    let data;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        data = await getSessionAlbumVideoUrl(photo.id);
        break;
      } catch (err) {
        if (attempt === 1 || ![401, 403].includes(Number(err.status))) throw err;
      }
    }
    if (!data?.url) {
      throw new Error("video url missing");
    }
    window.open(data.url, "_blank", "noopener,noreferrer");
  } catch (err) {
    albumStatus.value = "视频播放地址获取失败，请重试。";
  }
}

async function previewPhoto(photo) {
  let displayUrl = "";
  try {
    displayUrl = await ensurePreviewMedia(photo);
  } catch (err) {
    albumStatus.value = err?.code
      ? `${err.message || "照片加载失败"} [${err.code}]`
      : err?.message || "照片加载失败，请重试。";
    return;
  }
  if (!displayUrl) {
    albumStatus.value = "照片加载失败，请重试。";
    return;
  }
  window.open(displayUrl, "_blank", "noopener,noreferrer");
}

function resetBulkSelection() {
  bulkSelectionMode.value = false;
  selectedAlbumPhotoIds.value = [];
  bulkTagging.value = false;
}

async function openTagDrawer(photo) {
  if (albumActionBusy.value || !photo.can_tag) {
    return;
  }
  const requestId = tagPreviewSerial.next();
  try {
    const displayUrl = await ensurePreviewMedia(photo);
    if (!tagPreviewSerial.isCurrent(requestId)) return;
    taggingPhoto.value = {
      ...photo,
      display_url: displayUrl
    };
  } catch (err) {
    if (tagPreviewSerial.isCurrent(requestId)) albumStatus.value = "照片加载失败，请重试。";
    return;
  }
  if (!tagPreviewSerial.isCurrent(requestId)) return;
  selectedTagKeys.value = (photo.tags || []).map((tag) => tag.key);
}

function toggleBulkSelectionMode() {
  if (albumActionBusy.value || taggablePhotos.value.length === 0) {
    return;
  }
  bulkSelectionMode.value = !bulkSelectionMode.value;
  selectedAlbumPhotoIds.value = [];
}

function isAlbumPhotoSelected(photo) {
  return selectedAlbumPhotoIds.value.includes(Number(photo.id));
}

function toggleAlbumPhotoSelection(photo) {
  if (!bulkSelectionMode.value || albumActionBusy.value || !photo.can_tag) {
    return;
  }
  const photoId = Number(photo.id);
  if (selectedAlbumPhotoIds.value.includes(photoId)) {
    selectedAlbumPhotoIds.value = selectedAlbumPhotoIds.value.filter((id) => id !== photoId);
    return;
  }
  selectedAlbumPhotoIds.value = [...selectedAlbumPhotoIds.value, photoId];
}

function toggleSelectFilteredPhotos() {
  if (!bulkSelectionMode.value || albumActionBusy.value || filteredTaggablePhotoIds.value.length === 0) {
    return;
  }
  const filteredIdSet = new Set(filteredTaggablePhotoIds.value);
  if (allFilteredTaggableSelected.value) {
    selectedAlbumPhotoIds.value = selectedAlbumPhotoIds.value.filter((photoId) => !filteredIdSet.has(photoId));
    return;
  }
  const selectedIdSet = new Set(selectedAlbumPhotoIds.value);
  for (const photoId of filteredTaggablePhotoIds.value) {
    selectedIdSet.add(photoId);
  }
  selectedAlbumPhotoIds.value = Array.from(selectedIdSet);
}

function clearBulkSelection() {
  if (albumActionBusy.value) {
    return;
  }
  selectedAlbumPhotoIds.value = [];
}

function openBulkTagDrawer() {
  if (albumActionBusy.value || selectedAlbumPhotoIds.value.length === 0) {
    return;
  }
  bulkTagging.value = true;
  taggingPhoto.value = { id: null, display_url: "" };
  selectedTagKeys.value = [];
}

function closeTagDrawer() {
  if (savingTags.value) {
    return;
  }
  tagPreviewSerial.invalidate();
  taggingPhoto.value = null;
  selectedTagKeys.value = [];
  bulkTagging.value = false;
}

function toggleTag(key) {
  if (selectedTagKeys.value.includes(key)) {
    selectedTagKeys.value = selectedTagKeys.value.filter((item) => item !== key);
    return;
  }
  selectedTagKeys.value = [...selectedTagKeys.value, key];
}

async function saveTags() {
  if (!taggingPhoto.value) {
    return;
  }
  const targetPhotoIds = bulkTagging.value
    ? [...selectedAlbumPhotoIds.value]
    : [Number(taggingPhoto.value.id)];
  if (targetPhotoIds.length === 0) {
    return;
  }
  savingTags.value = true;
  let failedCount = 0;
  const updatedPhotoIds = [];
  const nextTags = tagsFromSelectedKeys();
  try {
    for (const photoId of targetPhotoIds) {
      try {
        await updateSessionAlbumPhotoTags(photoId, selectedTagKeys.value);
        updatedPhotoIds.push(photoId);
      } catch (err) {
        failedCount += 1;
      }
    }
    const allFailed = failedCount === targetPhotoIds.length;
    applyAlbumTagUpdates(updatedPhotoIds, nextTags);
    taggingPhoto.value = null;
    selectedTagKeys.value = [];
    bulkTagging.value = false;
    bulkSelectionMode.value = false;
    selectedAlbumPhotoIds.value = [];
    if (allFailed) {
      albumStatus.value = "标注保存失败，请重试。";
      return;
    }
    if (failedCount > 0) {
      albumStatus.value = `部分照片标注失败：${failedCount} 张`;
    }
  } finally {
    savingTags.value = false;
  }
}

async function openPrivacyDrawer() {
  if (albumActionBusy.value || !selectedSession.value) {
    return;
  }
  privacyDrawerOpen.value = true;
  loadingPrivacy.value = true;
  try {
    const privacy = await getMySessionAlbumPrivacy(selectedSession.value.id);
    privacyForm.value = {
      allowUploadedVisible: privacy?.allow_uploaded_visible !== false,
      allowTaggedVisible: privacy?.allow_tagged_visible !== false
    };
  } catch (err) {
    albumStatus.value = err.message || "隐私设置加载失败，请重试。";
  } finally {
    loadingPrivacy.value = false;
  }
}

function closePrivacyDrawer() {
  privacyDrawerOpen.value = false;
}

async function savePrivacy() {
  if (!selectedSession.value) {
    return;
  }
  savingPrivacy.value = true;
  try {
    await updateMySessionAlbumPrivacy(selectedSession.value.id, privacyForm.value);
    albumStatus.value = "隐私设置已保存。";
    closePrivacyDrawer();
    await loadAlbum({ fatal: false });
  } catch (err) {
    albumStatus.value = err.message || "隐私设置保存失败，请重试。";
  } finally {
    savingPrivacy.value = false;
  }
}

async function deletePhoto(photo) {
  if (albumActionBusy.value || !photo.can_delete) {
    return;
  }
  const mediaLabel = photo.media_type === "video" ? "视频" : "照片";
  if (!window.confirm(`确认删除这${mediaLabel === "视频" ? "段" : "张"}${mediaLabel}？`)) {
    return;
  }
  deletingPhotoId.value = photo.id;
  try {
    await deleteSessionAlbumPhoto(photo.id);
    await loadAlbum({ fatal: false });
  } catch (err) {
    albumStatus.value = err.message || "删除失败，请重试。";
  } finally {
    deletingPhotoId.value = "";
  }
}

function albumCommandStickyTop() {
  const rawValue = getComputedStyle(document.documentElement)
    .getPropertyValue("--admin-album-command-toolbar-top")
    .trim();
  return Number.parseFloat(rawValue) || 0;
}

function updateAlbumCommandFloating() {
  const sentinel = albumCommandSentinel.value;
  if (!sentinel) {
    albumCommandFloating.value = false;
    return;
  }
  albumCommandFloating.value = sentinel.getBoundingClientRect().top <= albumCommandStickyTop();
}

function queueAlbumCommandFloatingUpdate() {
  window.requestAnimationFrame(updateAlbumCommandFloating);
}

onMounted(() => {
  loadSelectedSession();
  document.addEventListener("visibilitychange", handleAlbumVisibilityChange);
  window.addEventListener("scroll", queueAlbumCommandFloatingUpdate, { passive: true });
  window.addEventListener("resize", queueAlbumCommandFloatingUpdate);
  queueAlbumCommandFloatingUpdate();
});
watch(() => props.sessionId, loadSelectedSession);
watch(activeAlbumFilter, resetBulkSelection);
watch(selectedSession, () => nextTick(updateAlbumCommandFloating));
onBeforeUnmount(() => {
  tagPreviewSerial.invalidate();
  mediaRefreshAttempts.clear();
  disposeAlbumRefreshController();
  document.removeEventListener("visibilitychange", handleAlbumVisibilityChange);
  window.removeEventListener("scroll", queueAlbumCommandFloatingUpdate);
  window.removeEventListener("resize", queueAlbumCommandFloatingUpdate);
  revokeAlbumMedia();
});
</script>
