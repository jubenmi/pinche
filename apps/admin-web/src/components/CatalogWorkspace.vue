<template>
  <section
    class="catalog"
    :class="{
      'drawer-open': drawer,
      'drawer-wide-open': drawer === 'script',
      busy: operationPending
    }"
  >
    <div class="catalog-panel">
      <div class="tabs">
        <button
          :class="{ active: tab === 'stores' }"
          type="button"
          :disabled="operationPending"
          @click="switchTab('stores')"
        >
          店家
        </button>
        <button
          :class="{ active: tab === 'scripts' }"
          type="button"
          :disabled="operationPending"
          @click="switchTab('scripts')"
        >
          剧本
        </button>
        <button
          :class="{ active: tab === 'sessions' }"
          type="button"
          :disabled="operationPending"
          @click="switchTab('sessions')"
        >
          车局
        </button>
        <button
          :class="{ active: tab === 'review' }"
          type="button"
          :disabled="operationPending"
          @click="switchTab('review')"
        >
          待审核
        </button>
      </div>

      <div class="toolbar toolbar-primary">
        <div class="filter-group">
          <input
            v-model.trim="keyword"
            name="catalogKeyword"
            :placeholder="keywordPlaceholder"
            :disabled="operationPending"
            @keyup.enter="load"
          />
          <select
            v-if="isCatalogEntityTab"
            v-model="status"
            name="catalogStatus"
            :disabled="operationPending"
            @change="load"
          >
            <option value="">全部状态</option>
            <option value="active">上架</option>
            <option value="inactive">下架</option>
          </select>
          <select
            v-else-if="tab === 'review'"
            v-model="status"
            name="catalogReviewStatus"
            :disabled="operationPending"
            @change="load"
          >
            <option value="pending">待审核</option>
            <option value="needs_changes">需要补充</option>
            <option value="approved">已公开</option>
            <option value="rejected">已拒绝</option>
            <option value="merged">已合并</option>
            <option value="">全部状态</option>
          </select>
          <select
            v-else
            v-model="status"
            name="sessionStatus"
            :disabled="operationPending"
            @change="load"
          >
            <option value="">全部状态</option>
            <option value="draft">草稿</option>
            <option value="recruiting">招募中</option>
            <option value="locked">已锁车</option>
            <option value="cancelled">已取消</option>
          </select>
          <button type="button" :disabled="operationPending" @click="load">
            {{ operationPending ? "处理中" : "搜索" }}
          </button>
        </div>
        <button
          v-if="isCatalogEntityTab"
          class="primary"
          type="button"
          :disabled="operationPending"
          @click="openCreate"
        >
          + 新增{{ tab === "stores" ? "店家" : "剧本" }}
        </button>
      </div>

      <div v-if="isCatalogEntityTab && selectedCount > 0" class="bulk-actions">
        <span>已选 {{ selectedCount }} 项</span>
        <button type="button" :disabled="operationPending" @click="batchUpdateStatus('active')">
          批量上架
        </button>
        <button type="button" :disabled="operationPending" @click="batchUpdateStatus('inactive')">
          批量下架
        </button>
        <button
          type="button"
          class="danger"
          :disabled="operationPending"
          @click="batchDeleteSelected"
        >
          批量删除
        </button>
      </div>
      <div v-if="tab === 'sessions' && selectedSessionCount > 0" class="bulk-actions">
        <span>已选 {{ selectedSessionCount }} 个车局</span>
        <button
          type="button"
          class="danger"
          :disabled="operationPending"
          @click="batchForceDeleteSessions"
        >
          批量强制删除
        </button>
      </div>
    </div>

    <p v-if="error" class="error">{{ error }}</p>
    <p v-if="operationPending" class="loading-strip">{{ operationText }}</p>

    <div class="table-card">
      <table class="data-table">
        <thead>
          <tr v-if="tab === 'stores'">
            <th class="selection-cell">
              <input
                type="checkbox"
                :checked="allVisibleSelected"
                :disabled="operationPending || visibleSelectableItems.length === 0"
                aria-label="选择全部店家"
                @change="toggleSelectAllVisible"
              />
            </th>
            <th>名称</th>
            <th>城市</th>
            <th>区域</th>
            <th>地址</th>
            <th>审核</th>
            <th>状态</th>
            <th>操作</th>
          </tr>
          <tr v-else-if="tab === 'scripts'">
            <th class="selection-cell">
              <input
                type="checkbox"
                :checked="allVisibleSelected"
                :disabled="operationPending || visibleSelectableItems.length === 0"
                aria-label="选择全部剧本"
                @change="toggleSelectAllVisible"
              />
            </th>
            <th>名称</th>
            <th>标签</th>
            <th>人数</th>
            <th>角色</th>
            <th>审核</th>
            <th>状态</th>
            <th>操作</th>
          </tr>
          <tr v-else-if="tab === 'review'">
            <th>类型</th>
            <th>名称</th>
            <th>提交人</th>
            <th>使用车局数</th>
            <th>状态</th>
            <th>创建时间</th>
            <th>操作</th>
          </tr>
          <tr v-else>
            <th class="selection-cell">
              <input
                type="checkbox"
                :checked="allVisibleSelected"
                :disabled="operationPending || visibleSelectableItems.length === 0"
                aria-label="选择全部车局"
                @change="toggleSelectAllVisible"
              />
            </th>
            <th>ID</th>
            <th>剧本</th>
            <th>店家</th>
            <th>车头</th>
            <th>开车时间</th>
            <th>座位/报名</th>
            <th>状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="item in items"
            :key="item.id"
            :class="{ 'selected-row': isSelected(item) }"
            @dblclick="openEdit(item)"
          >
            <template v-if="tab === 'stores'">
              <td class="selection-cell">
                <input
                  type="checkbox"
                  :checked="isItemSelected(item)"
                  :disabled="operationPending"
                  :aria-label="`选择店家${item.name}`"
                  @change="setItemSelected(item, $event.target.checked)"
                />
              </td>
              <td>
                <div class="cell-title">{{ item.name }}</div>
              </td>
              <td>{{ item.city }}</td>
              <td>{{ item.district || "-" }}</td>
              <td>{{ item.address || "-" }}</td>
              <td>
                <span class="status-pill" :class="catalogAuditStatus(item)">
                  {{ catalogAuditLabel(item) }}
                </span>
              </td>
              <td>
                <span class="status-pill" :class="item.status">
                  {{ statusLabel(item.status) }}
                </span>
              </td>
            </template>
            <template v-else-if="tab === 'scripts'">
              <td class="selection-cell">
                <input
                  type="checkbox"
                  :checked="isItemSelected(item)"
                  :disabled="operationPending"
                  :aria-label="`选择剧本${item.name}`"
                  @change="setItemSelected(item, $event.target.checked)"
                />
              </td>
              <td>
                <div class="cell-title">{{ item.name }}</div>
              </td>
              <td>{{ displayTags(item.type_tags) }}</td>
              <td>{{ item.player_count || 0 }}</td>
              <td>{{ roleCount(item.default_seat_template_json) }}</td>
              <td>
                <span class="status-pill" :class="catalogAuditStatus(item)">
                  {{ catalogAuditLabel(item) }}
                </span>
              </td>
              <td>
                <span class="status-pill" :class="item.status">
                  {{ statusLabel(item.status) }}
                </span>
              </td>
            </template>
            <template v-else-if="tab === 'review'">
              <td>{{ itemTypeLabel(item.type) }}</td>
              <td>
                <div class="cell-title">{{ item.name }}</div>
                <small class="muted-cell">{{ reviewItemMeta(item) }}</small>
              </td>
              <td>{{ item.created_by_user_name || item.created_by_user_id || "-" }}</td>
              <td>{{ item.session_count || 0 }}</td>
              <td>
                <span class="status-pill" :class="item.review_status">
                  {{ statusLabel(item.review_status) }}
                </span>
              </td>
              <td>{{ formatDateTime(item.created_at) }}</td>
            </template>
            <template v-else>
              <td class="selection-cell">
                <input
                  type="checkbox"
                  :checked="isItemSelected(item)"
                  :disabled="operationPending"
                  :aria-label="`选择车局${item.id}`"
                  @change="setItemSelected(item, $event.target.checked)"
                />
              </td>
              <td>#{{ item.id }}</td>
              <td>
                <div class="cell-title">{{ item.script_name_snapshot || "未命名车局" }}</div>
              </td>
              <td>{{ item.store_name_snapshot || "-" }}</td>
              <td>{{ organizerText(item) }}</td>
              <td>{{ formatDateTime(item.start_at) }}</td>
              <td>{{ sessionCountText(item) }}</td>
              <td>
                <span class="status-pill" :class="item.status">
                  {{ statusLabel(item.status) }}
                </span>
              </td>
            </template>
            <td v-if="isCatalogEntityTab" class="row-actions">
              <button
                class="action-button"
                type="button"
                :disabled="operationPending"
                @click="openEdit(item)"
              >
                编辑
              </button>
              <button
                type="button"
                class="action-button"
                :class="{ danger: item.status === 'active' }"
                :disabled="operationPending"
                @click="toggleStatus(item)"
              >
                {{ statusActionLabel(item) }}
              </button>
              <button
                v-if="item.status === 'inactive'"
                type="button"
                class="action-button danger"
                :disabled="operationPending"
                @click="deleteItem(item)"
              >
                {{ deleteActionLabel(item) }}
              </button>
            </td>
            <td v-else-if="tab === 'review'" class="row-actions">
              <button
                class="action-button"
                type="button"
                :disabled="operationPending"
                @click="openEdit(item)"
              >
                审核
              </button>
            </td>
            <td v-else class="row-actions">
              <button
                type="button"
                class="action-button danger"
                :disabled="operationPending"
                @click="forceDeleteSession(item)"
              >
                {{ forceDeleteSessionLabel(item) }}
              </button>
            </td>
          </tr>
          <tr v-if="items.length === 0">
            <td class="empty-cell" :colspan="emptyColspan">
              {{ tab === "sessions" ? "没有匹配的车局" : "没有匹配的数据" }}
            </td>
          </tr>
        </tbody>
      </table>
      <div class="table-footer">
        <span>共 {{ items.length }} 条</span>
        <span>当前最多显示 100 条</span>
      </div>
    </div>

    <StoreDrawer
      v-if="drawer === 'store'"
      :store="selected"
      :available-scripts="availableScripts"
      :linked-scripts="linkedScripts"
      :linked-script-ids="linkedScriptIds"
      :review-mode="tab === 'review'"
      :saving="operationPending"
      :title="tab === 'review' ? '审核店家资料' : ''"
      @save="saveStoreItem"
      @close="closeDrawer"
    >
      <template v-if="tab === 'review'" #footer-actions>
        <div class="review-footer">
          <div class="review-footer-fields">
            <input v-model.trim="reviewNote" name="reviewNote" placeholder="审核备注" />
            <input v-model.trim="mergeTargetId" name="mergeTargetId" placeholder="合并目标公共店家 ID" />
          </div>
          <div class="review-footer-actions">
            <button class="secondary-action" type="button" :disabled="operationPending" @click="closeDrawer">
              取消
            </button>
            <button type="button" :disabled="operationPending" @click="saveCatalogReviewDraft">
              保存修改
            </button>
            <button class="primary" type="button" :disabled="operationPending" @click="reviewAction('approve')">
              批准公开
            </button>
            <button type="button" :disabled="operationPending" @click="reviewAction('needs_changes')">
              需要补充
            </button>
            <button type="button" class="danger" :disabled="operationPending" @click="reviewAction('reject')">
              拒绝
            </button>
            <button type="button" :disabled="operationPending" @click="reviewAction('merge')">
              合并
            </button>
          </div>
        </div>
      </template>
    </StoreDrawer>
    <ScriptDrawer
      v-if="drawer === 'script'"
      :script="selected"
      :review-mode="tab === 'review'"
      :saving="operationPending"
      :title="tab === 'review' ? '审核剧本资料' : ''"
      @save="saveScriptItem"
      @close="closeDrawer"
    >
      <template v-if="tab === 'review'" #footer-actions>
        <div class="review-footer">
          <div class="review-footer-fields">
            <input v-model.trim="reviewNote" name="reviewNote" placeholder="审核备注" />
            <input v-model.trim="mergeTargetId" name="mergeTargetId" placeholder="合并目标公共剧本 ID" />
            <input v-model.trim="reviewStoreIdsText" name="reviewStoreIds" placeholder="批准后关联店家 ID，逗号分隔" />
          </div>
          <div class="review-footer-actions">
            <button class="secondary-action" type="button" :disabled="operationPending" @click="closeDrawer">
              取消
            </button>
            <button type="button" :disabled="operationPending" @click="saveCatalogReviewDraft">
              保存修改
            </button>
            <button class="primary" type="button" :disabled="operationPending" @click="reviewAction('approve')">
              批准公开
            </button>
            <button type="button" :disabled="operationPending" @click="reviewAction('needs_changes')">
              需要补充
            </button>
            <button type="button" class="danger" :disabled="operationPending" @click="reviewAction('reject')">
              拒绝
            </button>
            <button type="button" :disabled="operationPending" @click="reviewAction('merge')">
              合并
            </button>
          </div>
        </div>
      </template>
    </ScriptDrawer>
  </section>
</template>

<script setup>
import { computed, onMounted, ref, watch } from "vue";
import { catalogTabs, writeAdminRoute } from "../adminRoute";
import {
  approveCatalogReviewItem,
  deleteAdminSession,
  deleteScript,
  deleteStore,
  listAdminSessions,
  listCatalogReviewItems,
  listScripts,
  listStoreScripts,
  listStores,
  mergeCatalogReviewItem,
  rejectCatalogReviewItem,
  requestCatalogReviewItemNeedsChanges,
  saveScript,
  saveStore,
  saveStoreScripts,
  updateCatalogReviewItem
} from "../api";
import ScriptDrawer from "./ScriptDrawer.vue";
import StoreDrawer from "./StoreDrawer.vue";

const props = defineProps({
  initialTab: { type: String, default: "stores" }
});

function tabPlaceholder(nextTab) {
  if (nextTab === "sessions") {
    return "搜索车局ID、剧本、店家、车头";
  }
  if (nextTab === "review") {
    return "搜索待审核资料名称或备注";
  }
  return "搜索名称、城市、标签";
}

const tab = ref(catalogTabs.has(props.initialTab) ? props.initialTab : "stores");
const keyword = ref("");
const status = ref("");
const items = ref([]);
const drawer = ref("");
const selected = ref({});
const availableScripts = ref([]);
const linkedScripts = ref([]);
const linkedScriptIds = ref([]);
const error = ref("");
const pendingOperation = ref("");
const pendingOperationText = ref("");
const selectedItemIds = ref([]);
const reviewNote = ref("");
const mergeTargetId = ref("");
const reviewStoreIdsText = ref("");

const keywordPlaceholder = ref(tabPlaceholder(tab.value));
const operationPending = computed(() => Boolean(pendingOperation.value));
const operationText = computed(() => pendingOperationText.value || "正在处理，请稍候...");
const isCatalogEntityTab = computed(() => tab.value === "stores" || tab.value === "scripts");
const visibleSelectableItems = computed(() => (tab.value === "review" ? [] : items.value));
const emptyColspan = computed(() => (tab.value === "sessions" ? 9 : tab.value === "review" ? 7 : 8));
const selectedIdSet = computed(() => new Set(selectedItemIds.value));
const selectedItems = computed(() =>
  visibleSelectableItems.value.filter((item) => selectedIdSet.value.has(String(item.id)))
);
const selectedCount = computed(() => selectedItems.value.length);
const selectedSessionCount = computed(() =>
  tab.value === "sessions" ? selectedItems.value.length : 0
);
const allVisibleSelected = computed(
  () =>
    visibleSelectableItems.value.length > 0 &&
    visibleSelectableItems.value.every((item) => selectedIdSet.value.has(String(item.id)))
);

function beginOperation(key, text = "正在处理，请稍候...") {
  if (operationPending.value) {
    return false;
  }
  pendingOperation.value = key;
  pendingOperationText.value = text;
  return true;
}

function endOperation(key) {
  if (pendingOperation.value === key) {
    pendingOperation.value = "";
    pendingOperationText.value = "";
  }
}

function isRowOperation(item, action) {
  return pendingOperation.value === `${action}:${item.id}`;
}

function clearSelection() {
  selectedItemIds.value = [];
}

function isItemSelected(item) {
  return selectedIdSet.value.has(String(item.id));
}

function setItemSelected(item, checked) {
  const id = String(item.id);
  if (checked) {
    selectedItemIds.value = Array.from(new Set([...selectedItemIds.value, id]));
    return;
  }
  selectedItemIds.value = selectedItemIds.value.filter((itemId) => itemId !== id);
}

function toggleSelectAllVisible(event) {
  if (event.target.checked) {
    selectedItemIds.value = visibleSelectableItems.value.map((item) => String(item.id));
    return;
  }
  clearSelection();
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
  } catch (err) {
    return [];
  }
}

function displayTags(value) {
  const tags = parseJsonArray(value);
  return tags.length > 0 ? tags.join("、") : "未标注";
}

function roleCount(value) {
  return `${parseJsonArray(value).length} 个`;
}

function statusLabel(value) {
  const labels = {
    active: "上架",
    inactive: "下架",
    draft: "草稿",
    recruiting: "招募中",
    locked: "已锁车",
    cancelled: "已取消",
    pending: "待审核",
    needs_changes: "需要补充",
    approved: "已公开",
    rejected: "已拒绝",
    merged: "已合并"
  };
  return labels[value] || value || "-";
}

function catalogAuditStatus(item) {
  return item.review_status || "approved";
}

function catalogAuditLabel(item) {
  return statusLabel(catalogAuditStatus(item));
}

function itemTypeLabel(type) {
  return type === "script" ? "剧本" : "店家";
}

function reviewItemMeta(item) {
  if (item.type === "script") {
    return `${displayTags(item.type_tags)} / ${item.player_count || 0}人`;
  }
  return [item.city || "城市待补充", item.district, item.address].filter(Boolean).join(" · ");
}

function isSelected(item) {
  return selected.value?.id && Number(selected.value.id) === Number(item.id);
}

function switchTab(nextTab) {
  if (operationPending.value || tab.value === nextTab) {
    return;
  }
  closeDrawer();
  clearSelection();
  status.value = nextTab === "review" ? "pending" : "";
  tab.value = nextTab;
  keywordPlaceholder.value = tabPlaceholder(nextTab);
  writeAdminRoute({ activeView: "catalog", catalogTab: nextTab });
}

async function load() {
  if (!beginOperation("load", "正在加载列表...")) {
    return;
  }
  try {
    await loadItems();
  } finally {
    endOperation("load");
  }
}

async function loadItems() {
  error.value = "";
  clearSelection();
  const filters = { keyword: keyword.value, status: status.value, limit: "100" };
  try {
    if (tab.value === "stores") {
      items.value = await listStores(filters);
    } else if (tab.value === "scripts") {
      items.value = await listScripts(filters);
    } else if (tab.value === "review") {
      items.value = await listCatalogReviewItems(filters);
    } else {
      items.value = await listAdminSessions(filters);
    }
  } catch (err) {
    error.value = err.message;
  }
}

async function refreshScriptOptions() {
  availableScripts.value = await listScripts({ keyword: "", status: "active", limit: "100" });
}

async function openCreate() {
  if (operationPending.value || !isCatalogEntityTab.value) {
    return;
  }
  selected.value = {};
  linkedScripts.value = [];
  linkedScriptIds.value = [];
  if (tab.value === "stores") {
    if (!beginOperation("create:store", "正在准备店家表单...")) {
      return;
    }
    error.value = "";
    try {
      await refreshScriptOptions();
      drawer.value = "store";
    } catch (err) {
      error.value = err.message;
    } finally {
      endOperation("create:store");
    }
    return;
  }
  drawer.value = "script";
}

async function openEdit(item) {
  if (operationPending.value || tab.value === "sessions") {
    return;
  }
  selected.value = { ...item };
  if (tab.value === "review") {
    reviewNote.value = item.review_note || "";
    mergeTargetId.value = item.merged_into_id ? String(item.merged_into_id) : "";
    reviewStoreIdsText.value = "";
    drawer.value = item.type === "script" ? "script" : "store";
    return;
  }
  if (tab.value === "stores") {
    if (!beginOperation(`edit:${item.id}`, "正在载入店家关联剧本...")) {
      return;
    }
    error.value = "";
    try {
      await refreshScriptOptions();
      const scripts = await listStoreScripts(item.id);
      linkedScripts.value = scripts;
      linkedScriptIds.value = scripts.map((script) => Number(script.id));
      drawer.value = "store";
    } catch (err) {
      error.value = err.message;
    } finally {
      endOperation(`edit:${item.id}`);
    }
    return;
  }
  drawer.value = "script";
}

function closeDrawer(force = false) {
  if (operationPending.value && !force) {
    return;
  }
  drawer.value = "";
  selected.value = {};
  linkedScripts.value = [];
  linkedScriptIds.value = [];
  reviewNote.value = "";
  mergeTargetId.value = "";
  reviewStoreIdsText.value = "";
}

async function saveStoreItem(store) {
  if (tab.value === "review") {
    await saveCatalogReviewDraft(store);
    return;
  }
  if (!beginOperation("save:store", "正在保存店家...")) {
    return;
  }
  error.value = "";
  const { scriptIds = [], scriptLinks = [], storeScriptPriceYuanById, ...payload } = store;
  try {
    const saved = await saveStore(payload);
    await saveStoreScripts(saved.id, scriptLinks.length > 0 ? scriptLinks : scriptIds);
    closeDrawer(true);
    await loadItems();
  } catch (err) {
    error.value = err.message;
  } finally {
    endOperation("save:store");
  }
}

async function saveScriptItem(script) {
  if (tab.value === "review") {
    await saveCatalogReviewDraft(script);
    return;
  }
  if (!beginOperation("save:script", "正在保存剧本...")) {
    return;
  }
  error.value = "";
  try {
    await saveScript(script);
    closeDrawer(true);
    await loadItems();
  } catch (err) {
    error.value = err.message;
  } finally {
    endOperation("save:script");
  }
}

function reviewItemType() {
  return selected.value?.type === "script" ? "script" : "store";
}

function reviewItemId() {
  return Number(selected.value?.id || 0);
}

function reviewNoteBody(defaultNote) {
  return { reviewNote: reviewNote.value || defaultNote };
}

function parseIdList(value) {
  return String(value || "")
    .split(/[，,]/)
    .map((item) => Number(item.trim()))
    .filter((id) => Number.isInteger(id) && id > 0);
}

async function saveCatalogReviewDraft(payload = selected.value) {
  const type = reviewItemType();
  const id = reviewItemId();
  if (!id || tab.value !== "review") {
    return;
  }
  if (!beginOperation(`reviewDraft:${id}`, "正在保存待审核资料...")) {
    return;
  }
  error.value = "";
  const { scriptIds, scriptLinks, storeScriptPriceYuanById, ...body } = payload;
  try {
    await updateCatalogReviewItem(type, id, body);
    await loadItems();
  } catch (err) {
    error.value = err.message;
  } finally {
    endOperation(`reviewDraft:${id}`);
  }
}

async function reviewAction(action) {
  const type = reviewItemType();
  const id = reviewItemId();
  if (!id || tab.value !== "review") {
    return;
  }
  const labels = {
    approve: "批准公开",
    needs_changes: "标记需要补充",
    reject: "拒绝",
    merge: "合并"
  };
  if (!window.confirm(`确认${labels[action]}「${selected.value.name}」？`)) {
    return;
  }
  const operationKey = `reviewAction:${action}:${id}`;
  if (!beginOperation(operationKey, `正在${labels[action]}...`)) {
    return;
  }
  error.value = "";
  try {
    if (action === "approve") {
      const body = reviewNoteBody("通过，已公开");
      const storeIds = type === "script" ? parseIdList(reviewStoreIdsText.value) : [];
      if (storeIds.length > 0) {
        body.storeIds = storeIds;
      }
      await approveCatalogReviewItem(type, id, body);
    } else if (action === "needs_changes") {
      await requestCatalogReviewItemNeedsChanges(type, id, reviewNoteBody("请补充资料"));
    } else if (action === "reject") {
      await rejectCatalogReviewItem(type, id, reviewNoteBody("资料不完整，未通过"));
    } else if (action === "merge") {
      const mergedIntoId = Number(mergeTargetId.value || 0);
      if (!Number.isInteger(mergedIntoId) || mergedIntoId <= 0) {
        throw new Error("请填写合并目标公共资料 ID。");
      }
      await mergeCatalogReviewItem(type, id, {
        ...reviewNoteBody("已合并到已有公共资料"),
        mergedIntoId
      });
    }
    closeDrawer(true);
    await loadItems();
  } catch (err) {
    error.value = err.message;
  } finally {
    endOperation(operationKey);
  }
}

async function toggleStatus(item) {
  if (operationPending.value) {
    return;
  }
  const nextStatus = item.status === "active" ? "inactive" : "active";
  const actionLabel = nextStatus === "inactive" ? "下架" : "上架";
  if (!window.confirm(`确认${actionLabel}「${item.name}」？`)) {
    return;
  }
  const operationKey = `status:${item.id}`;
  if (!beginOperation(operationKey, `正在${actionLabel}...`)) {
    return;
  }
  error.value = "";
  try {
    if (tab.value === "stores") {
      await saveStore({ id: item.id, status: nextStatus });
    } else {
      await saveScript({ id: item.id, status: nextStatus });
    }
    await loadItems();
  } catch (err) {
    error.value = err.message;
  } finally {
    endOperation(operationKey);
  }
}

async function deleteItem(item) {
  if (operationPending.value) {
    return;
  }
  if (item.status !== "inactive") {
    error.value = "只有下架后的资料可以删除。";
    return;
  }

  const entityLabel = tab.value === "stores" ? "店家" : "剧本";
  if (!window.confirm(`确认删除下架${entityLabel}「${item.name}」？已有车引用时不会删除。`)) {
    return;
  }

  const operationKey = `delete:${item.id}`;
  if (!beginOperation(operationKey, "正在删除...")) {
    return;
  }
  error.value = "";
  try {
    if (tab.value === "stores") {
      await deleteStore(item.id);
    } else {
      await deleteScript(item.id);
    }
    if (isSelected(item)) {
      closeDrawer(true);
    }
    await loadItems();
  } catch (err) {
    error.value =
      err.code === "RESOURCE_IN_USE" || err.status === 409
        ? `已有车引用，不能删除该${entityLabel}，请保留下架状态。`
        : err.message;
  } finally {
    endOperation(operationKey);
  }
}

async function batchUpdateStatus(nextStatus) {
  if (operationPending.value || tab.value === "sessions") {
    return;
  }
  const rows = [...selectedItems.value];
  if (rows.length === 0) {
    return;
  }
  const entityLabel = tab.value === "stores" ? "店家" : "剧本";
  const actionLabel = nextStatus === "active" ? "上架" : "下架";
  if (!window.confirm(`确认批量${actionLabel}${rows.length}个${entityLabel}？`)) {
    return;
  }
  if (!beginOperation("batchStatus", `正在批量${actionLabel}...`)) {
    return;
  }
  error.value = "";
  try {
    for (const item of rows) {
      try {
        if (tab.value === "stores") {
          await saveStore({ id: item.id, status: nextStatus });
        } else {
          await saveScript({ id: item.id, status: nextStatus });
        }
      } catch (err) {
        throw new Error(`${item.name || item.id}${actionLabel}失败：${err.message}`);
      }
    }
    await loadItems();
  } catch (err) {
    error.value = err.message;
  } finally {
    endOperation("batchStatus");
  }
}

async function batchDeleteSelected() {
  if (operationPending.value || tab.value === "sessions") {
    return;
  }
  const rows = [...selectedItems.value];
  if (rows.length === 0) {
    return;
  }
  if (rows.some((item) => item.status !== "inactive")) {
    error.value = "请先下架后删除。";
    return;
  }
  const entityLabel = tab.value === "stores" ? "店家" : "剧本";
  if (!window.confirm(`确认批量删除${rows.length}个下架${entityLabel}？已有车引用的项目会删除失败。`)) {
    return;
  }
  if (!beginOperation("batchDelete", "正在批量删除...")) {
    return;
  }
  error.value = "";
  try {
    for (const item of rows) {
      try {
        if (tab.value === "stores") {
          await deleteStore(item.id);
        } else {
          await deleteScript(item.id);
        }
      } catch (err) {
        const message =
          err.code === "RESOURCE_IN_USE" || err.status === 409
            ? `已有车引用，不能删除该${entityLabel}，请保留下架状态。`
            : err.message;
        throw new Error(`${item.name || item.id}删除失败：${message}`);
      }
    }
    await loadItems();
  } catch (err) {
    error.value = err.message;
  } finally {
    endOperation("batchDelete");
  }
}

async function batchForceDeleteSessions() {
  if (operationPending.value || tab.value !== "sessions") {
    return;
  }
  const rows = [...selectedItems.value];
  if (rows.length === 0) {
    return;
  }
  if (
    !window.confirm(
      `确认批量强制删除${rows.length}个车局？这会删除车局、座位、报名、聊天、记录和相册记录等数据库关联数据。`
    )
  ) {
    return;
  }
  if (!beginOperation("batchForceDeleteSessions", "正在批量强制删除车局...")) {
    return;
  }
  error.value = "";
  try {
    for (const item of rows) {
      try {
        await deleteAdminSession(item.id);
      } catch (err) {
        const sessionName = item.script_name_snapshot || `#${item.id}`;
        throw new Error(`${sessionName}删除失败：${err.message}`);
      }
    }
    await loadItems();
  } catch (err) {
    error.value = err.message;
  } finally {
    endOperation("batchForceDeleteSessions");
  }
}

async function forceDeleteSession(item) {
  if (operationPending.value || tab.value !== "sessions") {
    return;
  }
  const sessionName = item.script_name_snapshot || `#${item.id}`;
  if (
    !window.confirm(
      `确认强制删除车局「${sessionName}」？这会删除车局、座位、报名、聊天、记录和相册记录等数据库关联数据。`
    )
  ) {
    return;
  }
  const operationKey = `forceDeleteSession:${item.id}`;
  if (!beginOperation(operationKey, "正在强制删除车局...")) {
    return;
  }
  error.value = "";
  try {
    await deleteAdminSession(item.id);
    if (isSelected(item)) {
      closeDrawer(true);
    }
    await loadItems();
  } catch (err) {
    error.value = err.message;
  } finally {
    endOperation(operationKey);
  }
}

function statusActionLabel(item) {
  if (isRowOperation(item, "status")) {
    return item.status === "active" ? "下架中" : "上架中";
  }
  return item.status === "active" ? "下架" : "上架";
}

function deleteActionLabel(item) {
  return isRowOperation(item, "delete") ? "删除中" : "删除";
}

function forceDeleteSessionLabel(item) {
  return isRowOperation(item, "forceDeleteSession") ? "删除中" : "强制删除";
}

function organizerText(item) {
  return item.organizer_nickname || item.organizer_open_id || `用户${item.organizer_user_id}`;
}

function sessionCountText(item) {
  const seatCount = Number(item.seat_count || 0);
  const confirmedCount = Number(item.confirmed_seat_count || 0);
  const pendingCount = Number(item.pending_signup_count || 0);
  return `${seatCount}座 / ${confirmedCount}已上车 / ${pendingCount}待审`;
}

function formatDateTime(value) {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).format(date);
}

watch(tab, load);
onMounted(load);
</script>
