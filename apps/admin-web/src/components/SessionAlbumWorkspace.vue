<template>
  <section
    class="album-workspace"
    :class="{ 'drawer-open': tagDrawerOpen || privacyDrawerOpen }"
  >
    <div class="catalog-panel album-panel">
      <div class="album-panel-head">
        <div>
          <p class="eyebrow">车局相册</p>
          <h2>{{ selectedSession?.script_name_snapshot || "车局相册" }}</h2>
        </div>
        <p class="status">和微信小程序一致：从车详情进入单场相册，发车后同车成员可查看和上传。</p>
      </div>

      <div class="toolbar toolbar-primary">
        <div class="filter-group">
          <button type="button" :disabled="!selectedSession" @click="loadAlbum">刷新相册</button>
        </div>
        <button class="primary" type="button" :disabled="!selectedSession" @click="loadAlbum">
          刷新相册
        </button>
      </div>
    </div>

    <p v-if="error" class="error">{{ error }}</p>

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

          <div class="album-action-row">
            <div class="filter-chip-row">
              <button
                v-for="filter in albumFilters"
                :key="filter.value"
                type="button"
                class="filter-chip"
                :class="{ active: activeAlbumFilter === filter.value }"
                @click="activeAlbumFilter = filter.value"
              >
                {{ filter.label }}
              </button>
            </div>
            <button
              class="secondary-action"
              type="button"
              :disabled="albumLoading || Boolean(albumError)"
              @click="openPrivacyDrawer"
            >
              隐私设置
            </button>
          </div>

          <div
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
            <div>
              <strong>{{ uploading ? "正在上传照片" : "拖拽照片到这里" }}</strong>
              <span>支持 JPG、PNG，单张不超过 4MB。上传完成后只把图片路径写入相册。</span>
            </div>
            <button class="primary" type="button" :disabled="uploadDisabled" @click="openFilePicker">
              选择照片
            </button>
          </div>

          <div class="album-summary">
            <span>当前 {{ filteredPhotos.length }} 张 / 可见 {{ album?.photos?.length || 0 }} 张</span>
            <span v-if="Number(album?.hidden_count || 0) > 0">
              {{ album.hidden_count }} 张因隐私未展示
            </span>
            <span v-if="Number(album?.untagged_count || 0) > 0">
              {{ album.untagged_count }} 张待标注
            </span>
          </div>

          <div v-if="albumLoading" class="empty-block">正在加载相册...</div>
          <div v-else-if="!albumError && filteredPhotos.length === 0" class="empty-block">
            {{ album?.photos?.length ? "没有符合当前筛选的照片。" : "还没有可见照片，上传后会出现在这里。" }}
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
              <article class="admin-photo">
                <button class="photo-preview" type="button" @click="previewPhoto(photo)">
                  <AuthorizedLazyImage
                    :src="photo.thumbnail_url || photo.image_url"
                    :ratio="photoAspectRatio(photo)"
                    @loaded="rerenderAlbumWaterfall"
                  />
                </button>
              <div class="photo-info">
                <strong>{{ tagSummary(photo) }}</strong>
                <span>{{ photo.uploader_name || "车友" }} · {{ formatDate(photo.created_at) }}</span>
                <span>{{ imageMetaText(photo) }}</span>
              </div>
              <div class="photo-actions">
                <button
                  v-if="photo.can_tag"
                  type="button"
                  class="action-button"
                  @click="openTagDrawer(photo)"
                >
                  标注
                </button>
                <button
                  v-if="photo.is_mine"
                  type="button"
                  class="action-button danger"
                  @click="deletePhoto(photo)"
                >
                  删除
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
        <h2>标注照片</h2>
        <button class="close-button" type="button" @click="closeTagDrawer">关闭</button>
      </div>
      <div class="drawer-body">
        <img class="tag-preview" :src="taggingPhoto.display_url" alt="" />
        <p class="status">
          未标注照片只有上传者可见。标注座位、DM 或 NPC 后，会按成员隐私设置展示。
        </p>
        <div class="selected-tag-row">
          <button
            v-for="person in selectedPeople"
            :key="person.key"
            type="button"
            class="selected-tag"
            @click="toggleTag(person.key)"
          >
            {{ person.label }} ×
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
              <strong>{{ person.label }}</strong>
              <small>{{ person.note || tagTypeLabel(person.tag_type) }}</small>
            </span>
          </label>
          <div v-if="npcPeople.length" class="tag-group-title">DM / NPC</div>
          <label v-for="person in npcPeople" :key="person.key" class="tag-choice">
            <input
              type="checkbox"
              :checked="selectedTagKeys.includes(person.key)"
              @change="toggleTag(person.key)"
            />
            <span>
              <strong>{{ person.label }}</strong>
              <small>{{ person.note || tagTypeLabel(person.tag_type) }}</small>
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
        <h2>相册隐私设置</h2>
        <button class="close-button" type="button" @click="closePrivacyDrawer">关闭</button>
      </div>
      <div class="drawer-body">
        <p class="status">规则和小程序一致：可见照片可以保存，不可见照片不会出现。</p>
        <label class="privacy-toggle">
          <span>
            <strong>其他同车成员可以查看我上传的照片</strong>
            <small>关闭后，只有我能看我上传的照片。</small>
          </span>
          <input v-model="privacyForm.allowUploadedVisible" type="checkbox" />
        </label>
        <label class="privacy-toggle">
          <span>
            <strong>其他同车成员可以查看包含我的照片</strong>
            <small>关闭后，包含我的照片不会对外展示。</small>
          </span>
          <input v-model="privacyForm.allowTaggedVisible" type="checkbox" />
        </label>
        <div class="privacy-rule-list">
          <div>我上传的照片，我永远可见</div>
          <div>照片里的人都有保护权</div>
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
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { Waterfall } from "vue-waterfall-plugin-next";
import "vue-waterfall-plugin-next/dist/style.css";
import AuthorizedLazyImage from "./AuthorizedLazyImage.vue";
import {
  createSessionAlbumPhoto,
  deleteSessionAlbumPhoto,
  fetchAuthorizedMediaObjectUrl,
  getMySessionAlbumPrivacy,
  getSession,
  getSessionAlbum,
  getStoredAuth,
  listSessionAlbumPeople,
  updateMySessionAlbumPrivacy,
  updateSessionAlbumPhotoTags,
  uploadSessionAlbumPhoto
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
const activeAlbumFilter = ref("all");
const privacyDrawerOpen = ref(false);
const savingPrivacy = ref(false);
const albumWaterfall = ref(null);
const privacyForm = ref({
  allowUploadedVisible: true,
  allowTaggedVisible: true
});
const mediaObjectUrls = new Set();
const albumWaterfallBreakpoints = {
  1280: { rowPerView: 4 },
  960: { rowPerView: 3 },
  640: { rowPerView: 2 },
  420: { rowPerView: 1 }
};

const photos = computed(() => album.value?.photos || []);
const currentUserId = computed(() => getStoredAuth().user?.id || "");
const filteredPhotos = computed(() => {
  if (activeAlbumFilter.value === "mine") {
    return photos.value.filter((photo) => photo.is_mine);
  }
  if (activeAlbumFilter.value === "withMe") {
    return photos.value.filter((photo) =>
      (photo.tags || []).some((tag) => Number(tag.user_id) === Number(currentUserId.value))
    );
  }
  if (activeAlbumFilter.value === "untagged") {
    return photos.value.filter((photo) => (photo.tags || []).length === 0);
  }
  return photos.value;
});
const tagDrawerOpen = computed(() => Boolean(taggingPhoto.value));
const seatPeople = computed(() => people.value.filter((person) => person.tag_type === "seat"));
const npcPeople = computed(() =>
  people.value.filter((person) => ["dm", "npc"].includes(person.tag_type))
);
const selectedPeople = computed(() =>
  people.value.filter((person) => selectedTagKeys.value.includes(person.key))
);
const uploadDisabled = computed(
  () =>
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
    npc: "NPC"
  };
  return labels[value] || "成员";
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
  return `照片里：${photo.tags.map((tag) => tag.label).join("、")}`;
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

function photoAspectRatio(photo) {
  const width = Number(photo.image_width || 0);
  const height = Number(photo.image_height || 0);
  if (width > 0 && height > 0) {
    return Math.min(1.8, Math.max(0.68, width / height));
  }
  return 1;
}

function normalizeAlbumMedia(albumData) {
  return {
    ...albumData,
    photos: (albumData.photos || []).map((photo) => {
      const previewUrl = photo.preview_url || photo.image_url || "";
      return {
        ...photo,
        tags: photo.tags || [],
        image_url: previewUrl,
        preview_url: previewUrl,
        thumbnail_url: photo.thumbnail_url || previewUrl,
        display_url: ""
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

async function ensurePreviewMedia(photo) {
  if (photo.display_url) {
    return photo.display_url;
  }
  const displayUrl = await fetchAuthorizedMediaObjectUrl(photo.preview_url || photo.image_url);
  mediaObjectUrls.add(displayUrl);
  updatePhotoDisplayUrl(photo.id, displayUrl);
  return displayUrl;
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

async function loadSelectedSession() {
  error.value = "";
  albumError.value = "";
  albumStatus.value = "";
  revokeAlbumMedia();
  album.value = null;
  people.value = [];
  if (!props.sessionId) {
    selectedSession.value = null;
    return;
  }
  try {
    selectedSession.value = await getSession(props.sessionId);
    await loadAlbum();
  } catch (err) {
    error.value = err.message;
    selectedSession.value = null;
  }
}

async function loadAlbum() {
  if (!selectedSession.value) {
    return;
  }
  albumLoading.value = true;
  albumError.value = "";
  albumStatus.value = "";
  revokeAlbumMedia();
  album.value = null;
  people.value = [];
  try {
    const options = albumRequestOptions();
    const [albumData, peopleData] = await Promise.all([
      getSessionAlbum(selectedSession.value.id, options),
      listSessionAlbumPeople(selectedSession.value.id, options)
    ]);
    album.value = normalizeAlbumMedia(albumData || { photos: [] });
    people.value = peopleData?.people || [];
    activeAlbumFilter.value = "all";
    albumStatus.value = album.value.can_upload
      ? "可以上传。给照片标注后，其他同车成员才会按隐私规则看到。"
      : "你可以查看满足隐私条件的照片，但当前账号不能上传。";
  } catch (err) {
    albumError.value =
      err.status === 403
        ? "车局相册会在发车后开放。请确认这辆车已经到开始时间，且当前账号是车头或同车成员。"
        : err.message;
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
  { value: "all", label: "全部" },
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
  albumError.value = "";
  try {
    for (const [index, file] of validFiles.entries()) {
      albumStatus.value = `正在上传 ${index + 1}/${validFiles.length}：${file.name}`;
      const options = albumRequestOptions();
      const upload = await uploadSessionAlbumPhoto(selectedSession.value.id, file, options);
      await createSessionAlbumPhoto(selectedSession.value.id, upload.photoUrl, options);
    }
    albumStatus.value = skippedCount > 0
      ? `上传完成，已跳过 ${skippedCount} 个不符合要求的文件。`
      : "上传完成。";
    await loadAlbum();
  } catch (err) {
    albumError.value = err.message;
  } finally {
    uploading.value = false;
  }
}

async function previewPhoto(photo) {
  let displayUrl = "";
  try {
    displayUrl = await ensurePreviewMedia(photo);
  } catch (err) {
    albumError.value = "照片加载失败，请刷新后重试。";
    return;
  }
  if (!displayUrl) {
    albumError.value = "照片加载失败，请刷新后重试。";
    return;
  }
  window.open(displayUrl, "_blank", "noopener,noreferrer");
}

async function openTagDrawer(photo) {
  if (!photo.can_tag) {
    return;
  }
  try {
    const displayUrl = await ensurePreviewMedia(photo);
    taggingPhoto.value = {
      ...photo,
      display_url: displayUrl
    };
  } catch (err) {
    albumError.value = "照片加载失败，请刷新后重试。";
    return;
  }
  selectedTagKeys.value = (photo.tags || []).map((tag) => tag.key);
}

function closeTagDrawer() {
  taggingPhoto.value = null;
  selectedTagKeys.value = [];
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
  savingTags.value = true;
  try {
    await updateSessionAlbumPhotoTags(taggingPhoto.value.id, selectedTagKeys.value);
    closeTagDrawer();
    await loadAlbum();
  } catch (err) {
    albumError.value = err.message;
  } finally {
    savingTags.value = false;
  }
}

async function openPrivacyDrawer() {
  if (!selectedSession.value) {
    return;
  }
  albumError.value = "";
  privacyDrawerOpen.value = true;
  try {
    const privacy = await getMySessionAlbumPrivacy(selectedSession.value.id);
    privacyForm.value = {
      allowUploadedVisible: privacy?.allow_uploaded_visible !== false,
      allowTaggedVisible: privacy?.allow_tagged_visible !== false
    };
  } catch (err) {
    albumError.value = err.message;
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
    await loadAlbum();
  } catch (err) {
    albumError.value = err.message;
  } finally {
    savingPrivacy.value = false;
  }
}

async function deletePhoto(photo) {
  if (!photo.is_mine) {
    return;
  }
  if (!window.confirm("确认删除这张照片？")) {
    return;
  }
  try {
    await deleteSessionAlbumPhoto(photo.id);
    await loadAlbum();
  } catch (err) {
    albumError.value = err.message;
  }
}

onMounted(loadSelectedSession);
watch(() => props.sessionId, loadSelectedSession);
onBeforeUnmount(revokeAlbumMedia);
</script>
