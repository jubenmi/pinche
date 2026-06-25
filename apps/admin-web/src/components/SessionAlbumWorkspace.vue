<template>
  <section
    class="album-workspace"
    :class="{ 'drawer-open': tagDrawerOpen || privacyDrawerOpen }"
  >
    <div class="catalog-panel album-panel">
      <div class="album-panel-head">
        <div>
          <p class="eyebrow">车局相册</p>
          <h2>我的发车相册</h2>
        </div>
        <p class="status">仅展示当前管理员自己发起的车局。浏览器优先直传 COS，相册仍按发车后开放规则处理。</p>
      </div>

      <div class="toolbar toolbar-primary">
        <div class="filter-group">
          <select v-model="statusFilter" name="albumSessionStatus" @change="loadSessions">
            <option value="">全部车局</option>
            <option value="draft">草稿</option>
            <option value="recruiting">招募中</option>
            <option value="locked">已锁车</option>
            <option value="cancelled">已取消</option>
          </select>
          <button type="button" @click="loadSessions">刷新车局</button>
        </div>
        <button class="primary" type="button" :disabled="!selectedSession" @click="loadAlbum">
          刷新相册
        </button>
      </div>
    </div>

    <p v-if="error" class="error">{{ error }}</p>

    <div class="album-layout">
      <div class="table-card session-list-card">
        <div class="section-head">
          <h3>我的车</h3>
          <span>{{ sessions.length }} 场</span>
        </div>
        <div class="session-list">
          <button
            v-for="session in sessions"
            :key="session.id"
            class="session-row"
            :class="{ active: selectedSession?.id === session.id }"
            type="button"
            @click="selectSession(session)"
          >
            <span class="session-main">
              <strong>{{ session.script_name_snapshot || "未命名剧本" }}</strong>
              <small>{{ session.store_name_snapshot || "未选店家" }}</small>
            </span>
            <span class="session-meta">
              <span class="status-pill" :class="session.status">
                {{ sessionStatusLabel(session.status) }}
              </span>
              <span>{{ formatDate(session.start_at) }}</span>
            </span>
            <span class="session-counts">
              {{ session.seat_count || 0 }} 座 · {{ session.signup_count || 0 }} 申请
              <template v-if="Number(session.pending_signup_count || 0) > 0">
                · {{ session.pending_signup_count }} 待审
              </template>
            </span>
          </button>
          <div v-if="sessions.length === 0" class="empty-block">还没有符合条件的发车。</div>
        </div>
      </div>

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
          <div v-else-if="!albumError" class="admin-photo-grid">
            <article v-for="photo in filteredPhotos" :key="photo.id" class="admin-photo">
              <button class="photo-preview" type="button" @click="previewPhoto(photo)">
                <img :src="photo.image_url" alt="" />
              </button>
              <div class="photo-info">
                <strong>{{ tagSummary(photo) }}</strong>
                <span>{{ photo.uploader_name || "车友" }} · {{ formatDate(photo.created_at) }}</span>
                <span>{{ imageMetaText(photo) }}</span>
              </div>
              <div class="photo-actions">
                <button type="button" class="action-button" @click="openTagDrawer(photo)">
                  标注
                </button>
                <button type="button" class="action-button danger" @click="deletePhoto(photo)">
                  删除
                </button>
              </div>
            </article>
          </div>
        </template>

        <div v-else class="empty-block">先从左侧选择一辆自己发起的车。</div>
      </div>
    </div>

    <aside v-if="tagDrawerOpen" class="drawer album-tag-drawer">
      <div class="drawer-head">
        <h2>标注照片</h2>
        <button class="close-button" type="button" @click="closeTagDrawer">关闭</button>
      </div>
      <div class="drawer-body">
        <img class="tag-preview" :src="taggingPhoto.image_url" alt="" />
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
            <strong>别人可以查看我上传的照片</strong>
            <small>关闭后，只有我能看我上传的照片。</small>
          </span>
          <input v-model="privacyForm.allowUploadedVisible" type="checkbox" />
        </label>
        <label class="privacy-toggle">
          <span>
            <strong>别人可以查看包含我的照片</strong>
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
import { computed, onMounted, ref } from "vue";
import {
  createSessionAlbumPhoto,
  deleteSessionAlbumPhoto,
  getMySessionAlbumPrivacy,
  getSessionAlbum,
  getStoredAuth,
  listMySessions,
  listSessionAlbumPeople,
  updateMySessionAlbumPrivacy,
  updateSessionAlbumPhotoTags,
  uploadSessionAlbumPhoto
} from "../api";

const MAX_PHOTO_BYTES = 4 * 1024 * 1024;
const ACCEPTED_IMAGE_TYPES = new Set(["image/jpeg", "image/png"]);

const sessions = ref([]);
const selectedSession = ref(null);
const statusFilter = ref("");
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
const privacyForm = ref({
  allowUploadedVisible: true,
  allowTaggedVisible: true
});

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

function acceptedFile(file) {
  const typeAllowed = ACCEPTED_IMAGE_TYPES.has(file.type);
  const nameAllowed = /\.(jpe?g|png)$/i.test(file.name || "");
  return typeAllowed || nameAllowed;
}

async function loadSessions() {
  error.value = "";
  try {
    const rows = await listMySessions({
      status: statusFilter.value,
      limit: "100"
    });
    sessions.value = rows || [];
    if (
      !selectedSession.value ||
      !sessions.value.some((item) => Number(item.id) === Number(selectedSession.value.id))
    ) {
      selectedSession.value = sessions.value[0] || null;
    }
    if (selectedSession.value) {
      await loadAlbum();
    } else {
      album.value = null;
      people.value = [];
    }
  } catch (err) {
    error.value = err.message;
  }
}

async function selectSession(session) {
  selectedSession.value = session;
  await loadAlbum();
}

async function loadAlbum() {
  if (!selectedSession.value) {
    return;
  }
  albumLoading.value = true;
  albumError.value = "";
  albumStatus.value = "";
  album.value = null;
  people.value = [];
  try {
    const [albumData, peopleData] = await Promise.all([
      getSessionAlbum(selectedSession.value.id),
      listSessionAlbumPeople(selectedSession.value.id)
    ]);
    album.value = albumData || { photos: [] };
    people.value = peopleData?.people || [];
    activeAlbumFilter.value = "all";
    albumStatus.value = album.value.can_upload
      ? "可以上传。给照片标注后，其他成员才会按隐私规则看到。"
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
      const upload = await uploadSessionAlbumPhoto(selectedSession.value.id, file);
      await createSessionAlbumPhoto(selectedSession.value.id, upload.photoUrl);
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

function previewPhoto(photo) {
  window.open(photo.image_url, "_blank", "noopener,noreferrer");
}

function openTagDrawer(photo) {
  taggingPhoto.value = photo;
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

onMounted(loadSessions);
</script>
