<template>
  <view class="page">
    <AuthIdentityBar />
    <FeedbackHost />

    <view v-if="!isAdmin" class="section">
      <view class="title">资料管理</view>
      <view class="text">当前微信账号没有系统管理员权限。</view>
      <view class="actions">
        <t-button class="button" @tap="goMine">去登录</t-button>
      </view>
    </view>

    <view v-else>
      <view class="section">
        <view class="title">资料管理</view>
        <view class="text">维护店家、剧本和缺资料申请。</view>
        <view class="actions">
          <t-button class="button secondary" @tap="scanAdminWebLogin">扫码登录 Web 后台</t-button>
        </view>
        <t-tabs
          class="tabs"
          theme="tag"
          :value="activeTab"
          custom-style="width: 100%; --td-tab-item-height: 64rpx; --td-tab-item-tag-height: 56rpx; --td-tab-item-active-color: #1f7a68; --td-tab-item-tag-active-bg: #eef7f4; --td-tab-item-tag-bg: #eef2f7; --td-tab-nav-bg-color: transparent; --td-tab-font: 600 24rpx / 44rpx PingFang SC, Microsoft YaHei, sans-serif;"
          @change="activeTab = $event.detail.value"
        >
          <t-tab-panel
            v-for="tab in tabs"
            :key="tab.key"
            :label="tab.label"
            :value="tab.key"
          />
        </t-tabs>
      </view>

      <view v-if="activeTab === 'stores'" class="panel">
        <view class="section">
          <view class="section-title">{{ editingStoreId ? "编辑店家" : "新增店家" }}</view>
          <t-input
            :value="storeForm.name"
            class="field"
            placeholder="店家名称"
            @change="storeForm.name = $event.detail.value"
          />
          <view class="field-row">
            <t-input
              :value="storeForm.city"
              class="field half"
              placeholder="城市"
              @change="storeForm.city = $event.detail.value"
            />
            <t-input
              :value="storeForm.district"
              class="field half"
              placeholder="区域"
              @change="storeForm.district = $event.detail.value"
            />
          </view>
          <t-input
            :value="storeForm.address"
            class="field"
            placeholder="地址"
            @change="storeForm.address = $event.detail.value"
          />
          <view class="toggle-row">
            <t-button
              class="toggle"
              :class="{ active: storeForm.status === 'active' }"
              @tap="storeForm.status = 'active'"
            >
              上架
            </t-button>
            <t-button
              class="toggle"
              :class="{ active: storeForm.status === 'inactive' }"
              @tap="storeForm.status = 'inactive'"
            >
              下架
            </t-button>
          </view>
          <view class="actions">
            <t-button class="button" @tap="saveStore">{{ editingStoreId ? "保存" : "新增" }}</t-button>
            <t-button class="button secondary" @tap="resetStoreForm">清空</t-button>
          </view>
        </view>

        <view class="section">
          <view class="section-title">店家列表</view>
          <view class="search-row">
            <t-search
              :value="storeKeyword"
              class="field search"
              placeholder="搜索名称/城市/区域"
              action="搜索"
              shape="round"
              @change="storeKeyword = $event.detail.value"
              @submit="loadStores"
              @action-click="loadStores"
            />
          </view>
          <view class="toggle-row">
            <t-button
              v-for="item in statusFilters"
              :key="item.value"
              class="toggle"
              :class="{ active: storeStatus === item.value }"
              @tap="setStoreStatus(item.value)"
            >
              {{ item.label }}
            </t-button>
          </view>
          <view v-for="store in stores" :key="store.id" class="item">
            <view class="item-main">
              <view class="item-title">{{ store.name }}</view>
              <view class="item-sub">{{ store.city }} {{ store.district || "" }}</view>
              <view class="item-sub">{{ store.address || "暂无地址" }}</view>
              <view class="audit-row">
                <view class="audit-badge" :class="catalogAuditClass(store)">
                  {{ catalogAuditLabel(store) }}
                </view>
              </view>
            </view>
            <view class="item-actions">
              <t-button class="mini-button" @tap="editStore(store)">编辑</t-button>
              <t-button class="mini-button muted" @tap="toggleStore(store)">
                {{ store.status === "active" ? "下架" : "上架" }}
              </t-button>
            </view>
          </view>
        </view>
      </view>

      <view v-if="activeTab === 'scripts'" class="panel">
        <view class="section">
          <view class="section-title">{{ editingScriptId ? "编辑剧本" : "新增剧本" }}</view>
          <t-input
            :value="scriptForm.name"
            class="field"
            placeholder="剧本名称"
            @change="scriptForm.name = $event.detail.value"
          />
          <view class="field-row">
            <t-input
              :value="scriptForm.typeTagsText"
              class="field half"
              placeholder="标签，逗号分隔"
              @change="scriptForm.typeTagsText = $event.detail.value"
            />
            <t-input
              :value="scriptForm.playerCount"
              class="field half"
              type="number"
              placeholder="人数"
              @change="scriptForm.playerCount = $event.detail.value"
            />
          </view>
          <t-textarea
            :value="scriptForm.summaryNoSpoiler"
            class="textarea"
            placeholder="无剧透简介"
            @change="scriptForm.summaryNoSpoiler = $event.detail.value"
          />
          <t-textarea
            :value="scriptForm.defaultSeatTemplateText"
            class="textarea template"
            placeholder="默认座位模板 JSON"
            @change="scriptForm.defaultSeatTemplateText = $event.detail.value"
          />
          <view class="toggle-row">
            <t-button
              class="toggle"
              :class="{ active: scriptForm.status === 'active' }"
              @tap="scriptForm.status = 'active'"
            >
              上架
            </t-button>
            <t-button
              class="toggle"
              :class="{ active: scriptForm.status === 'inactive' }"
              @tap="scriptForm.status = 'inactive'"
            >
              下架
            </t-button>
          </view>
          <view class="actions">
            <t-button class="button" @tap="saveScript">{{ editingScriptId ? "保存" : "新增" }}</t-button>
            <t-button class="button secondary" @tap="resetScriptForm">清空</t-button>
          </view>
        </view>

        <view class="section">
          <view class="section-title">剧本列表</view>
          <view class="search-row">
            <t-search
              :value="scriptKeyword"
              class="field search"
              placeholder="搜索名称/标签"
              action="搜索"
              shape="round"
              @change="scriptKeyword = $event.detail.value"
              @submit="loadScripts"
              @action-click="loadScripts"
            />
          </view>
          <view class="toggle-row">
            <t-button
              v-for="item in statusFilters"
              :key="item.value"
              class="toggle"
              :class="{ active: scriptStatus === item.value }"
              @tap="setScriptStatus(item.value)"
            >
              {{ item.label }}
            </t-button>
          </view>
          <view v-for="script in scripts" :key="script.id" class="item">
            <view class="item-main">
              <view class="item-title">{{ script.name }}</view>
              <view class="item-sub">{{ displayTags(script.type_tags) }} / {{ script.player_count || 0 }}人</view>
              <view class="item-sub">{{ script.summary_no_spoiler || "暂无简介" }}</view>
              <view class="audit-row">
                <view class="audit-badge" :class="catalogAuditClass(script)">
                  {{ catalogAuditLabel(script) }}
                </view>
              </view>
            </view>
            <view class="item-actions">
              <t-button class="mini-button" @tap="editScript(script)">编辑</t-button>
              <t-button class="mini-button muted" @tap="toggleScript(script)">
                {{ script.status === "active" ? "下架" : "上架" }}
              </t-button>
            </view>
          </view>
        </view>
      </view>

      <view v-if="activeTab === 'requests'" class="panel">
        <view class="section">
          <view class="section-title">待审核资料</view>
          <view class="search-row">
            <t-search
              :value="requestKeyword"
              class="field search"
              placeholder="搜索申请名称"
              action="搜索"
              shape="round"
              @change="requestKeyword = $event.detail.value"
              @submit="loadRequests"
              @action-click="loadRequests"
            />
          </view>
          <view class="toggle-row">
            <t-button
              v-for="item in requestStatusFilters"
              :key="item.value"
              class="toggle"
              :class="{ active: requestStatus === item.value }"
              @tap="setRequestStatus(item.value)"
            >
              {{ item.label }}
            </t-button>
          </view>
          <t-input
            :value="reviewNote"
            class="field"
            placeholder="审核备注，会写入用户可见结果"
            @change="reviewNote = $event.detail.value"
          />
          <t-input
            :value="mergeTargetId"
            class="field"
            type="number"
            placeholder="合并目标公共资料 ID，仅合并时填写"
            @change="mergeTargetId = $event.detail.value"
          />
          <view v-for="item in requests" :key="item.id" class="item">
            <view class="item-main">
              <view class="item-title">{{ itemTypeLabel(item.type) }}：{{ item.name }}</view>
              <view class="item-sub">{{ reviewItemMeta(item) }} / {{ reviewStatusLabel(item.review_status) }}</view>
              <view class="item-sub">
                提交人：{{ item.created_by_user_name || item.created_by_user_id || "未知" }} · 使用车局数：{{ item.session_count || 0 }}
              </view>
              <view v-if="item.review_note" class="item-sub">备注：{{ item.review_note }}</view>
              <view v-if="item.merged_into_name" class="item-sub">合并到：{{ item.merged_into_name }}</view>
            </view>
            <view class="item-actions">
              <t-button class="mini-button" @tap="approveReviewItem(item)">批准公开</t-button>
              <t-button class="mini-button muted" @tap="needsChangesReviewItem(item)">需要补充</t-button>
              <t-button class="mini-button muted" @tap="rejectReviewItem(item)">拒绝</t-button>
              <t-button class="mini-button muted" @tap="mergeReviewItem(item)">合并</t-button>
            </view>
          </view>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup>
import { onLoad } from "@dcloudio/uni-app";
import { computed, ref } from "vue";
import AuthIdentityBar from "../../components/AuthIdentityBar.vue";
import FeedbackHost from "../../components/TDesignFeedbackHost.vue";
import { dataOf, getCurrentUser, queryString, request } from "../../utils/api";
import { showModal, showToast } from "../../utils/tdesignFeedback";

const tabs = [
  { key: "stores", label: "店家" },
  { key: "scripts", label: "剧本" },
  { key: "requests", label: "待审核" }
];
const statusFilters = [
  { value: "", label: "全部" },
  { value: "active", label: "上架" },
  { value: "inactive", label: "下架" }
];
const requestStatusFilters = [
  { value: "pending", label: "待审" },
  { value: "needs_changes", label: "补充" },
  { value: "approved", label: "公开" },
  { value: "rejected", label: "拒绝" },
  { value: "merged", label: "合并" },
  { value: "", label: "全部" }
];

const defaultSeatTemplate = JSON.stringify(
  [
    {
      name: "情感沉浸位",
      seatType: "love_companion",
      roleName: "主线互动位",
      roleGender: "unlimited",
      basePrice: 58000,
      adjustment: 20000
    },
    {
      name: "F4-1",
      seatType: "f4",
      roleName: "玩家CP",
      roleGender: "male",
      basePrice: 58000,
      adjustment: -5000
    },
    {
      name: "F4-2",
      seatType: "f4",
      roleName: "玩家CP",
      roleGender: "female",
      basePrice: 58000,
      adjustment: -5000
    },
    {
      name: "F4-3",
      seatType: "f4",
      roleName: "玩家CP",
      roleGender: "male",
      basePrice: 58000,
      adjustment: -5000
    },
    {
      name: "F4-4",
      seatType: "f4",
      roleName: "玩家CP",
      roleGender: "female",
      basePrice: 58000,
      adjustment: -5000
    }
  ],
  null,
  2
);

const activeTab = ref("stores");
const roles = ref(getCurrentUser().roles || []);
const isAdmin = computed(() => roles.value.includes("system_admin"));

const stores = ref([]);
const storeKeyword = ref("");
const storeStatus = ref("");
const editingStoreId = ref("");
const storeForm = ref(defaultStoreForm());

const scripts = ref([]);
const scriptKeyword = ref("");
const scriptStatus = ref("");
const editingScriptId = ref("");
const scriptForm = ref(defaultScriptForm());

const requests = ref([]);
const requestKeyword = ref("");
const requestStatus = ref("pending");
const reviewNote = ref("");
const mergeTargetId = ref("");

onLoad(() => {
  roles.value = getCurrentUser().roles || [];
  if (isAdmin.value) {
    loadStores();
    loadScripts();
    loadRequests();
  }
});

function defaultStoreForm() {
  return {
    name: "",
    city: "北京",
    district: "",
    address: "",
    status: "active"
  };
}

function defaultScriptForm() {
  return {
    name: "",
    typeTagsText: "情感,沉浸",
    playerCount: "6",
    summaryNoSpoiler: "",
    defaultSeatTemplateText: defaultSeatTemplate,
    status: "active"
  };
}

function showMessage(title) {
  showToast({ title, icon: "none" });
}

function goMine() {
  uni.navigateTo({ url: "/pages/mine/index" });
}

function parseAdminWebLoginQr(rawValue) {
  const value = String(rawValue || "");
  const prefix = "pinche-admin-login://ticket/";
  if (!value.startsWith(prefix)) {
    return null;
  }

  const withoutPrefix = value.slice(prefix.length);
  const [ticketId, queryText = ""] = withoutPrefix.split("?");
  const secretPair = queryText
    .split("&")
    .map((item) => item.split("="))
    .find(([key]) => key === "secret");
  const secret = secretPair ? decodeURIComponent(secretPair[1] || "") : "";
  if (!ticketId || !secret) {
    return null;
  }

  return { ticketId, secret };
}

function confirmAdminWebLogin() {
  return new Promise((resolve) => {
    showModal({
      title: "Web 后台登录",
      content: "确认登录 Web 管理后台？",
      confirmText: "确认登录",
      cancelText: "取消",
      success(result) {
        resolve(Boolean(result.confirm));
      },
      fail() {
        resolve(false);
      }
    });
  });
}

async function scanAdminWebLogin() {
  const result = await new Promise((resolve, reject) => {
    uni.scanCode({
      onlyFromCamera: false,
      success: resolve,
      fail: reject
    });
  }).catch(() => null);

  const parsed = parseAdminWebLoginQr(result?.result);
  if (!parsed) {
    showMessage("请扫描 Web 后台登录二维码");
    return;
  }

  const confirmed = await confirmAdminWebLogin();
  if (!confirmed) {
    return;
  }

  await request({
    url: `/api/admin/web-login/tickets/${parsed.ticketId}/approve`,
    method: "POST",
    data: { secret: parsed.secret }
  });
  showMessage("Web 后台已登录");
}

function displayTags(value) {
  if (!value) {
    return "未标注";
  }
  if (Array.isArray(value)) {
    return value.join("、");
  }
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.join("、") : String(value);
  } catch (error) {
    return String(value);
  }
}

function formatJson(value) {
  if (!value) {
    return defaultSeatTemplate;
  }
  if (typeof value === "string") {
    try {
      return JSON.stringify(JSON.parse(value), null, 2);
    } catch (error) {
      return value;
    }
  }
  return JSON.stringify(value, null, 2);
}

function typeTagsFromText(value) {
  return String(value || "")
    .split(/[，,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

async function loadStores() {
  const response = await request({
    url: "/api/admin/stores" + queryString({
      keyword: storeKeyword.value,
      status: storeStatus.value,
      limit: 80
    })
  });
  stores.value = dataOf(response) || [];
}

function setStoreStatus(status) {
  storeStatus.value = status;
  loadStores();
}

function resetStoreForm() {
  editingStoreId.value = "";
  storeForm.value = defaultStoreForm();
}

function editStore(store) {
  editingStoreId.value = store.id;
  storeForm.value = {
    name: store.name || "",
    city: store.city || "北京",
    district: store.district || "",
    address: store.address || "",
    status: store.status || "active"
  };
}

async function saveStore() {
  if (!storeForm.value.name || !storeForm.value.city) {
    showMessage("请填写店家名称和城市");
    return;
  }

  const method = editingStoreId.value ? "PATCH" : "POST";
  const url = editingStoreId.value
    ? `/api/admin/stores/${editingStoreId.value}`
    : "/api/admin/stores";
  await request({ url, method, data: storeForm.value });
  showMessage("已保存");
  resetStoreForm();
  loadStores();
}

async function toggleStore(store) {
  await request({
    url: `/api/admin/stores/${store.id}`,
    method: "PATCH",
    data: { status: store.status === "active" ? "inactive" : "active" }
  });
  loadStores();
}

async function loadScripts() {
  const response = await request({
    url: "/api/admin/scripts" + queryString({
      keyword: scriptKeyword.value,
      status: scriptStatus.value,
      limit: 80
    })
  });
  scripts.value = dataOf(response) || [];
}

function setScriptStatus(status) {
  scriptStatus.value = status;
  loadScripts();
}

function resetScriptForm() {
  editingScriptId.value = "";
  scriptForm.value = defaultScriptForm();
}

function editScript(script) {
  editingScriptId.value = script.id;
  scriptForm.value = {
    name: script.name || "",
    typeTagsText: displayTags(script.type_tags).replaceAll("、", ","),
    playerCount: String(script.player_count || "6"),
    summaryNoSpoiler: script.summary_no_spoiler || "",
    defaultSeatTemplateText: formatJson(script.default_seat_template_json),
    status: script.status || "active"
  };
}

async function saveScript() {
  if (!scriptForm.value.name) {
    showMessage("请填写剧本名称");
    return;
  }

  let defaultSeatTemplateJson;
  try {
    defaultSeatTemplateJson = JSON.parse(scriptForm.value.defaultSeatTemplateText);
  } catch (error) {
    showMessage("座位模板 JSON 不合法");
    return;
  }

  const method = editingScriptId.value ? "PATCH" : "POST";
  const url = editingScriptId.value
    ? `/api/admin/scripts/${editingScriptId.value}`
    : "/api/admin/scripts";
  await request({
    url,
    method,
    data: {
      name: scriptForm.value.name,
      typeTags: typeTagsFromText(scriptForm.value.typeTagsText),
      playerCount: Number(scriptForm.value.playerCount || 0),
      summaryNoSpoiler: scriptForm.value.summaryNoSpoiler,
      defaultSeatTemplate: defaultSeatTemplateJson,
      status: scriptForm.value.status
    }
  });
  showMessage("已保存");
  resetScriptForm();
  loadScripts();
}

async function toggleScript(script) {
  await request({
    url: `/api/admin/scripts/${script.id}`,
    method: "PATCH",
    data: { status: script.status === "active" ? "inactive" : "active" }
  });
  loadScripts();
}

async function loadRequests() {
  const response = await request({
    url: "/api/admin/catalog-review-items" + queryString({
      keyword: requestKeyword.value,
      status: requestStatus.value,
      limit: 80
    })
  });
  requests.value = dataOf(response) || [];
}

function setRequestStatus(status) {
  requestStatus.value = status;
  loadRequests();
}

function itemTypeLabel(type) {
  return type === "script" ? "剧本" : "店家";
}

function reviewStatusLabel(status) {
  const labels = {
    pending: "待审核",
    needs_changes: "需要补充",
    approved: "已公开",
    rejected: "已拒绝",
    merged: "已合并"
  };
  return labels[status] || status || "-";
}

function catalogAuditStatus(item) {
  return item.review_status || "approved";
}

function catalogAuditLabel(item) {
  return reviewStatusLabel(catalogAuditStatus(item));
}

function catalogAuditClass(item) {
  return catalogAuditStatus(item);
}

function reviewItemMeta(item) {
  if (item.type === "script") {
    return `${displayTags(item.type_tags)} / ${item.player_count || 0}人`;
  }
  return `${item.city || "北京"} ${item.district || ""}`;
}

function reviewPayload(defaultNote) {
  return {
    reviewNote: reviewNote.value || defaultNote
  };
}

async function finishReviewAction(message) {
  showMessage(message);
  reviewNote.value = "";
  mergeTargetId.value = "";
  await loadRequests();
  await loadStores();
  await loadScripts();
}

async function approveReviewItem(item) {
  await request({
    url: `/api/admin/catalog-review-items/${item.type}/${item.id}/approve`,
    method: "POST",
    data: reviewPayload("通过，已公开")
  });
  await finishReviewAction("已批准公开");
}

async function needsChangesReviewItem(item) {
  await request({
    url: `/api/admin/catalog-review-items/${item.type}/${item.id}/needs-changes`,
    method: "POST",
    data: reviewPayload("请补充资料")
  });
  await finishReviewAction("已标记需要补充");
}

async function rejectReviewItem(item) {
  await request({
    url: `/api/admin/catalog-review-items/${item.type}/${item.id}/reject`,
    method: "POST",
    data: reviewPayload("资料不完整，未通过")
  });
  await finishReviewAction("已拒绝");
}

async function mergeReviewItem(item) {
  const targetId = Number(mergeTargetId.value || 0);
  if (!Number.isInteger(targetId) || targetId <= 0) {
    showMessage("请填写合并目标公共资料 ID");
    return;
  }
  await request({
    url: `/api/admin/catalog-review-items/${item.type}/${item.id}/merge`,
    method: "POST",
    data: {
      ...reviewPayload("已合并到已有公共资料"),
      mergedIntoId: targetId
    }
  });
  await finishReviewAction("已合并");
}
</script>

<style scoped>
.panel {
  display: block;
}

.section-title {
  margin-bottom: 18rpx;
  font-size: 30rpx;
  font-weight: 600;
}

.toggle-row,
.field-row,
.search-row,
.item-actions {
  display: flex;
  gap: 12rpx;
}

.tabs {
  display: block;
  width: 100%;
  min-width: 0;
  margin-top: 24rpx;
}

.tab,
.toggle,
.mini-button {
  min-width: 120rpx;
  height: 64rpx;
  padding: 0 18rpx;
  border-radius: 8rpx;
  background: #eef2f7;
  color: #334155;
  font-size: 24rpx;
  line-height: 64rpx;
}

.tab.active,
.toggle.active,
.mini-button {
  background: #1f7a68;
  color: #ffffff;
}

.mini-button.muted {
  background: #64748b;
}

.field,
.textarea {
  width: 100%;
  min-height: 76rpx;
  margin-bottom: 16rpx;
  padding: 0 20rpx;
  box-sizing: border-box;
  border: 1rpx solid #d7dde5;
  border-radius: 8rpx;
  background: #ffffff;
  color: #1f2933;
  font-size: 28rpx;
}

.textarea {
  min-height: 156rpx;
  padding-top: 18rpx;
  line-height: 1.5;
}

.textarea.template {
  min-height: 260rpx;
  font-family: Menlo, Consolas, monospace;
  font-size: 24rpx;
}

.field.half {
  flex: 1;
}

.field.search {
  flex: 1;
}

.item {
  display: flex;
  gap: 16rpx;
  align-items: flex-start;
  justify-content: space-between;
  margin-top: 18rpx;
  padding: 20rpx 0;
  border-top: 1rpx solid #edf1f5;
}

.item-main {
  flex: 1;
  min-width: 0;
}

.item-title {
  margin-bottom: 8rpx;
  color: #1f2933;
  font-size: 28rpx;
  font-weight: 600;
}

.item-sub {
  color: #64748b;
  font-size: 24rpx;
  line-height: 1.45;
}

.audit-row {
  display: flex;
  margin-top: 10rpx;
}

.audit-badge {
  padding: 5rpx 12rpx;
  border-radius: 6rpx;
  background: #eef2f7;
  color: #334155;
  font-size: 22rpx;
  font-weight: 700;
  line-height: 1.35;
}

.audit-badge.pending {
  background: #fbf6e9;
  color: #967139;
}

.audit-badge.needs_changes {
  background: #fff1f2;
  color: #be123c;
}

.audit-badge.approved {
  background: #eef7f4;
  color: #1f7a68;
}

.audit-badge.rejected {
  background: #fff1f2;
  color: #be123c;
}

.audit-badge.merged {
  background: #eef2f7;
  color: #64748b;
}

.item-actions {
  flex-direction: column;
}
</style>
