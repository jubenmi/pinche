<template>
  <view class="page mine-calendar-page">
    <AuthIdentityBar />
    <FeedbackHost />

    <t-notice-bar
      v-if="hasLogin && profileModerationText"
      class="notice"
      theme="warning"
      :visible="true"
      :content="profileModerationText"
    />

    <view v-if="!hasLogin" class="section login-section">
      <view class="title">我的</view>
      <view class="text">{{ statusText }}</view>
      <view class="actions">
        <t-button class="button" @tap="login">微信登录</t-button>
      </view>
    </view>

    <SessionCalendar
      v-else
      :sessions="sessions"
      :signups="signups"
      :loading="isCalendarLoading"
      :refreshing="isRefreshingCalendar"
      :status-text="calendarStatusText"
      :show-admin-button="isAdmin"
      @admin="goAdmin"
      @refresh="refreshCalendar"
      @auth-expired="handleAuthExpired"
    />

    <view v-if="hasLogin" class="section catalog-section">
      <view class="catalog-section-head">
        <view>
          <view class="section-title">我的资料提交</view>
          <view class="text">查看你添加的店家和剧本审核进度。</view>
        </view>
        <t-button class="mini-button" :disabled="catalogLoading" @tap="loadCatalogSubmissions">
          {{ catalogLoading ? "刷新中" : "刷新" }}
        </t-button>
      </view>
      <t-notice-bar
        v-if="catalogStatusText"
        class="notice"
        theme="warning"
        :visible="true"
        :content="catalogStatusText"
      />
      <view v-if="catalogItems.length === 0 && !catalogLoading" class="catalog-empty">
        还没有资料提交。创建车局选店或选剧本时，可以先添加给自己用。
      </view>
      <view v-for="item in catalogItems" :key="catalogKey(item)" class="catalog-card">
        <view class="catalog-card-head">
          <view>
            <view class="catalog-title">{{ itemTypeLabel(item.type) }}：{{ item.name }}</view>
            <view class="catalog-meta">{{ catalogMeta(item) }}</view>
          </view>
          <view class="review-badge" :class="item.review_status">
            {{ reviewStatusLabel(item.review_status) }}
          </view>
        </view>
        <view v-if="item.moderation_message" class="catalog-note">{{ item.moderation_message }}</view>
        <view v-if="item.review_note" class="catalog-note">审核备注：{{ item.review_note }}</view>
        <view v-if="item.merged_into_name" class="catalog-note">已合并到：{{ item.merged_into_name }}</view>
        <view v-if="canEditCatalogItem(item) && editingCatalogKey !== catalogKey(item)" class="catalog-actions">
          <t-button class="mini-button" @tap="startCatalogEdit(item)">编辑并重新提交</t-button>
        </view>
        <view v-if="editingCatalogKey === catalogKey(item)" class="catalog-edit-form">
          <t-input
            :value="editForm.name"
            class="field"
            placeholder="名称"
            @change="editForm.name = $event.detail.value"
          />
          <template v-if="editForm.type === 'store'">
            <view class="field-row">
              <t-input
                :value="editForm.city"
                class="field half"
                placeholder="城市"
                @change="editForm.city = $event.detail.value"
              />
              <t-input
                :value="editForm.district"
                class="field half"
                placeholder="区域"
                @change="editForm.district = $event.detail.value"
              />
            </view>
            <t-input
              :value="editForm.address"
              class="field"
              placeholder="地址"
              @change="editForm.address = $event.detail.value"
            />
            <t-textarea
              :value="editForm.contactNote"
              class="textarea"
              placeholder="补充备注"
              @change="editForm.contactNote = $event.detail.value"
            />
          </template>
          <template v-else>
            <view class="field-row">
              <t-input
                :value="editForm.playerCount"
                class="field half"
                type="number"
                placeholder="人数"
                @change="editForm.playerCount = $event.detail.value"
              />
              <t-input
                :value="editForm.typeTagsText"
                class="field half"
                placeholder="标签，逗号分隔"
                @change="editForm.typeTagsText = $event.detail.value"
              />
            </view>
            <t-textarea
              :value="editForm.summaryNoSpoiler"
              class="textarea"
              placeholder="无剧透简介"
              @change="editForm.summaryNoSpoiler = $event.detail.value"
            />
          </template>
          <view class="catalog-actions">
            <t-button class="mini-button" :disabled="catalogSaving" @tap="submitCatalogEdit">
              {{ catalogSaving ? "提交中" : "重新提交" }}
            </t-button>
            <t-button class="mini-button muted" :disabled="catalogSaving" @tap="cancelCatalogEdit">
              取消
            </t-button>
          </view>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup>
import { computed, onMounted, onUnmounted, ref } from "vue";
import AuthIdentityBar from "../../components/AuthIdentityBar.vue";
import SessionCalendar from "../../components/SessionCalendar.vue";
import FeedbackHost from "../../components/TDesignFeedbackHost.vue";
import {
  AUTH_CHANGE_EVENT,
  clearAuth,
  dataOf,
  ensureLoggedIn,
  goHomeAfterLogout,
  getCurrentUser,
  getToken,
  request
} from "../../utils/api";
import { showToast } from "../../utils/tdesignFeedback";
import {
  authorPrivateCatalogItem,
  authorPrivateStatusText,
  isAuthorPrivateText
} from "../../utils/authorPrivateText";

const statusText = ref("未登录");
const profileModerationText = ref("");
const roles = ref([]);
const hasLogin = ref(false);
const sessions = ref([]);
const sessionStatusText = ref("");
const signups = ref([]);
const signupStatusText = ref("");
const catalogItems = ref([]);
const catalogStatusText = ref("");
const catalogLoading = ref(false);
const catalogSaving = ref(false);
const editingCatalogKey = ref("");
const editForm = ref(defaultCatalogEditForm());
const loadingSessions = ref(false);
const loadingSignups = ref(false);
const isRefreshingCalendar = ref(false);
const lastLoadedAt = ref(null);
let authExpiredToastActive = false;

const isAdmin = computed(() => roles.value.includes("system_admin"));
const isCalendarLoading = computed(() => loadingSessions.value || loadingSignups.value);
const calendarStatusText = computed(() =>
  [sessionStatusText.value, signupStatusText.value].filter(Boolean).join(" ")
);

hydrateAuth();

onMounted(() => {
  if (typeof uni.$on === "function") {
    uni.$on(AUTH_CHANGE_EVENT, hydrateAuth);
  }
});

onUnmounted(() => {
  if (typeof uni.$off === "function") {
    uni.$off(AUTH_CHANGE_EVENT, hydrateAuth);
  }
});

function hydrateAuth() {
  const auth = getCurrentUser();
  const token = getToken();
  if (auth.user && !token) {
    clearAuth();
    resetLoggedOutState();
    return;
  }
  roles.value = auth.roles || [];
  hasLogin.value = Boolean(auth.user && token);
  statusText.value = auth.user ? loginName(auth.user) : "未登录";
  if (!hasLogin.value) {
    resetLoggedOutState();
    return;
  }
  loadCalendar();
  loadAuthorProfile();
  loadCatalogSubmissions();
}

async function loadAuthorProfile() {
  try {
    const response = await request({ url: "/api/users/me" });
    const auth = dataOf(response) || {};
    if (auth.user) {
      statusText.value = loginName(auth.user);
      profileModerationText.value = authorPrivateStatusText(auth.user.author_private);
    }
  } catch (error) {
    if (error?.statusCode === 401) handleAuthExpired(error);
  }
}

async function login() {
  const auth = await ensureLoggedIn({
    devCode: "dev-admin-openid",
    content: "登录后查看你的发车、报名和日程。"
  });
  if (!auth) {
    statusText.value = "登录失败";
    return;
  }
  hydrateAuth();
}

function logout() {
  clearAuth();
  resetLoggedOutState();
  goHomeAfterLogout();
}

function goAdmin() {
  uni.navigateTo({ url: "/pages/admin/catalog" });
}

async function loadCalendar() {
  await Promise.all([loadMySessions(), loadMySignups()]);
  lastLoadedAt.value = new Date();
}

function resetLoggedOutState() {
  roles.value = [];
  hasLogin.value = false;
  statusText.value = "未登录";
  profileModerationText.value = "";
  sessions.value = [];
  sessionStatusText.value = "";
  signups.value = [];
  signupStatusText.value = "";
  catalogItems.value = [];
  catalogStatusText.value = "";
  catalogLoading.value = false;
  catalogSaving.value = false;
  editingCatalogKey.value = "";
  editForm.value = defaultCatalogEditForm();
  lastLoadedAt.value = null;
}

function handleAuthExpired(error = {}) {
  clearAuth();
  resetLoggedOutState();
  if (!authExpiredToastActive) {
    authExpiredToastActive = true;
    showToast({
      title: error?.userMessage || "登录已过期，请重新登录。",
      icon: "none"
    });
    setTimeout(() => {
      authExpiredToastActive = false;
    }, 1000);
  }
}

async function refreshCalendar() {
  if (isRefreshingCalendar.value) {
    return;
  }
  isRefreshingCalendar.value = true;
  try {
    await loadCalendar();
  } finally {
    isRefreshingCalendar.value = false;
  }
}

async function loadMySessions() {
  loadingSessions.value = true;
  sessionStatusText.value = "";
  try {
    const response = await request({ url: "/api/users/me/sessions?limit=50" });
    sessions.value = dataOf(response) || [];
  } catch (error) {
    if (error?.statusCode === 401) {
      handleAuthExpired(error);
      return;
    }
    sessionStatusText.value = "我的发车加载失败，请稍后重试。";
  } finally {
    loadingSessions.value = false;
  }
}

async function loadMySignups() {
  loadingSignups.value = true;
  signupStatusText.value = "";
  try {
    const response = await request({ url: "/api/users/me/signups" });
    signups.value = dataOf(response) || [];
  } catch (error) {
    if (error?.statusCode === 401) {
      handleAuthExpired(error);
      return;
    }
    signupStatusText.value = "我参与的车加载失败，请稍后重试。";
  } finally {
    loadingSignups.value = false;
  }
}

function defaultCatalogEditForm() {
  return {
    type: "",
    id: "",
    name: "",
    city: "",
    district: "",
    address: "",
    contactNote: "",
    playerCount: "6",
    typeTagsText: "",
    summaryNoSpoiler: ""
  };
}

async function loadCatalogSubmissions() {
  catalogLoading.value = true;
  catalogStatusText.value = "";
  try {
    const [reviewResponse, storeResponse, scriptResponse] = await Promise.all([
      request({ url: "/api/catalog-review-items/mine" }),
      request({ url: "/api/stores?limit=50" }),
      request({ url: "/api/scripts?limit=50" })
    ]);
    const drafts = [
      ...(dataOf(storeResponse) || [])
        .filter(isAuthorPrivateText)
        .map((item) => authorPrivateCatalogItem(item, "store")),
      ...(dataOf(scriptResponse) || [])
        .filter(isAuthorPrivateText)
        .map((item) => authorPrivateCatalogItem(item, "script"))
    ].filter(Boolean);
    catalogItems.value = [...drafts, ...(dataOf(reviewResponse) || [])];
  } catch (error) {
    if (error?.statusCode === 401) {
      handleAuthExpired(error);
      return;
    }
    catalogStatusText.value = "我的资料提交加载失败，请稍后重试。";
  } finally {
    catalogLoading.value = false;
  }
}

function catalogKey(item) {
  return item.draft_id ? `${item.type}:draft:${item.draft_id}` : `${item.type}:${item.id}`;
}

function itemTypeLabel(type) {
  return type === "script" ? "剧本" : "店家";
}

function reviewStatusLabel(status) {
  const labels = {
    pending: "待审核",
    processing: "审核中",
    review: "进一步审核",
    error: "审核中",
    needs_changes: "需要补充",
    approved: "已公开",
    rejected: "未通过",
    merged: "已合并"
  };
  return labels[status] || status || "-";
}

function parseJsonArray(value) {
  if (!value) {
    return [];
  }
  if (Array.isArray(value)) {
    return value;
  }
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
}

function typeTagsText(value) {
  return parseJsonArray(value).join(",");
}

function typeTagsFromText(value) {
  return String(value || "")
    .split(/[，,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function catalogMeta(item) {
  if (item.type === "script") {
    return `${Number(item.player_count || 0)}人 · ${typeTagsText(item.type_tags) || "未标注"}`;
  }
  return [item.city || "城市待补充", item.district, item.address].filter(Boolean).join(" · ");
}

function canEditCatalogItem(item) {
  return item.review_status === "needs_changes";
}

function startCatalogEdit(item) {
  editingCatalogKey.value = catalogKey(item);
  editForm.value = {
    ...defaultCatalogEditForm(),
    type: item.type,
    id: item.id,
    name: item.name || "",
    city: item.city || "北京",
    district: item.district || "",
    address: item.address || "",
    contactNote: item.contact_note || item.contactNote || "",
    playerCount: String(item.player_count || 6),
    typeTagsText: typeTagsText(item.type_tags),
    summaryNoSpoiler: item.summary_no_spoiler || ""
  };
}

function cancelCatalogEdit() {
  editingCatalogKey.value = "";
  editForm.value = defaultCatalogEditForm();
}

async function submitCatalogEdit() {
  if (catalogSaving.value) {
    return;
  }
  if (!editForm.value.name) {
    showToast({ title: "请填写名称", icon: "none" });
    return;
  }

  const body =
    editForm.value.type === "store"
      ? {
          name: editForm.value.name,
          city: editForm.value.city,
          district: editForm.value.district,
          address: editForm.value.address,
          contactNote: editForm.value.contactNote
        }
      : {
          name: editForm.value.name,
          playerCount: Number(editForm.value.playerCount || 0),
          typeTags: typeTagsFromText(editForm.value.typeTagsText),
          summaryNoSpoiler: editForm.value.summaryNoSpoiler
        };

  if (editForm.value.type === "script" && (!Number.isInteger(body.playerCount) || body.playerCount <= 0)) {
    showToast({ title: "请填写正确人数", icon: "none" });
    return;
  }

  catalogSaving.value = true;
  try {
    await request({
      url: `/api/catalog-review-items/${editForm.value.type}/${editForm.value.id}`,
      method: "PATCH",
      data: body
    });
    showToast({ title: "已重新提交", icon: "none" });
    cancelCatalogEdit();
    await loadCatalogSubmissions();
  } catch (error) {
    showToast({ title: error?.userMessage || "重新提交失败", icon: "none" });
  } finally {
    catalogSaving.value = false;
  }
}

function loginName(user) {
  return profileNameWithGenderSymbol(user?.nickname, user?.gender);
}

function genderSymbol(value) {
  if (value === "male") {
    return "♂";
  }
  if (value === "female") {
    return "♀";
  }
  return "";
}

function profileNameWithGenderSymbol(nickname, value) {
  const name = (nickname || "").trim() || "填写昵称";
  const symbol = genderSymbol(value);
  return symbol ? `${symbol} ${name}` : name;
}
</script>

<style scoped>
.mine-calendar-page {
  padding-bottom: 30rpx;
}

.login-section {
  margin-top: 22rpx;
}

.catalog-section {
  margin-top: 22rpx;
}

.catalog-section-head,
.catalog-card-head,
.catalog-actions,
.field-row {
  display: flex;
  gap: 14rpx;
}

.catalog-section-head,
.catalog-card-head {
  align-items: flex-start;
  justify-content: space-between;
}

.section-title {
  color: #153f34;
  font-size: 30rpx;
  font-weight: 700;
}

.mini-button {
  min-width: 128rpx;
  height: 64rpx;
  padding: 0 18rpx;
  border-radius: 8rpx;
  background: #1f7a68;
  color: #ffffff;
  font-size: 24rpx;
  line-height: 64rpx;
}

.mini-button.muted {
  background: #64748b;
}

.notice {
  margin-top: 18rpx;
}

.catalog-empty {
  margin-top: 20rpx;
  color: #7a857d;
  font-size: 25rpx;
  line-height: 1.5;
}

.catalog-card {
  margin-top: 22rpx;
  padding-top: 22rpx;
  border-top: 1rpx solid #edf1f5;
}

.catalog-title {
  color: #1f2933;
  font-size: 28rpx;
  font-weight: 700;
  line-height: 1.35;
}

.catalog-meta,
.catalog-note {
  margin-top: 8rpx;
  color: #64748b;
  font-size: 24rpx;
  line-height: 1.45;
}

.review-badge {
  flex-shrink: 0;
  padding: 6rpx 14rpx;
  border-radius: 6rpx;
  background: #eef2f7;
  color: #334155;
  font-size: 22rpx;
  font-weight: 700;
}

.review-badge.pending {
  background: #fbf6e9;
  color: #967139;
}

.review-badge.needs_changes {
  background: #fff1f2;
  color: #be123c;
}

.review-badge.approved {
  background: #eef7f4;
  color: #1f7a68;
}

.catalog-actions {
  margin-top: 18rpx;
}

.catalog-edit-form {
  margin-top: 18rpx;
}

.field,
.textarea {
  width: 100%;
  margin-bottom: 16rpx;
  box-sizing: border-box;
  border: 1rpx solid #d7dde5;
  border-radius: 8rpx;
  background: #ffffff;
}

.field.half {
  flex: 1;
}

.textarea {
  min-height: 132rpx;
  padding: 18rpx 20rpx;
  color: #1f2933;
  font-size: 26rpx;
  line-height: 1.45;
}
</style>
