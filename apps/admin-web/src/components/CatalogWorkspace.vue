<template>
  <section
    class="catalog"
    :class="{ 'drawer-open': drawer, 'drawer-wide-open': drawer === 'script' }"
  >
    <div class="catalog-panel">
      <div class="tabs">
        <button :class="{ active: tab === 'stores' }" type="button" @click="switchTab('stores')">
          店家
        </button>
        <button :class="{ active: tab === 'scripts' }" type="button" @click="switchTab('scripts')">
          剧本
        </button>
      </div>

      <div class="toolbar toolbar-primary">
        <div class="filter-group">
          <input
            v-model.trim="keyword"
            name="catalogKeyword"
            placeholder="搜索名称、城市、标签"
            @keyup.enter="load"
          />
          <select v-model="status" name="catalogStatus" @change="load">
            <option value="">全部状态</option>
            <option value="active">上架</option>
            <option value="inactive">下架</option>
          </select>
          <button type="button" @click="load">搜索</button>
        </div>
        <button class="primary" type="button" @click="openCreate">
          + 新增{{ tab === "stores" ? "店家" : "剧本" }}
        </button>
      </div>
    </div>

    <p v-if="error" class="error">{{ error }}</p>

    <div class="table-card">
      <table class="data-table">
        <thead>
          <tr v-if="tab === 'stores'">
            <th>名称</th>
            <th>城市</th>
            <th>区域</th>
            <th>地址</th>
            <th>状态</th>
            <th>操作</th>
          </tr>
          <tr v-else>
            <th>名称</th>
            <th>标签</th>
            <th>人数</th>
            <th>角色</th>
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
              <td>
                <div class="cell-title">{{ item.name }}</div>
              </td>
              <td>{{ item.city }}</td>
              <td>{{ item.district || "-" }}</td>
              <td>{{ item.address || "-" }}</td>
              <td>
                <span class="status-pill" :class="item.status">
                  {{ statusLabel(item.status) }}
                </span>
              </td>
            </template>
            <template v-else>
              <td>
                <div class="cell-title">{{ item.name }}</div>
              </td>
              <td>{{ displayTags(item.type_tags) }}</td>
              <td>{{ item.player_count || 0 }}</td>
              <td>{{ roleCount(item.default_seat_template_json) }}</td>
              <td>
                <span class="status-pill" :class="item.status">
                  {{ statusLabel(item.status) }}
                </span>
              </td>
            </template>
            <td class="row-actions">
              <button class="action-button" type="button" @click="openEdit(item)">编辑</button>
              <button
                type="button"
                class="action-button"
                :class="{ danger: item.status === 'active' }"
                @click="toggleStatus(item)"
              >
                {{ item.status === "active" ? "下架" : "上架" }}
              </button>
            </td>
          </tr>
          <tr v-if="items.length === 0">
            <td class="empty-cell" colspan="6">没有匹配的数据</td>
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
      @save="saveStoreItem"
      @close="closeDrawer"
    />
    <ScriptDrawer
      v-if="drawer === 'script'"
      :script="selected"
      @save="saveScriptItem"
      @close="closeDrawer"
    />
  </section>
</template>

<script setup>
import { onMounted, ref, watch } from "vue";
import {
  listScripts,
  listStoreScripts,
  listStores,
  saveScript,
  saveStore,
  saveStoreScripts
} from "../api";
import ScriptDrawer from "./ScriptDrawer.vue";
import StoreDrawer from "./StoreDrawer.vue";

const tab = ref("stores");
const keyword = ref("");
const status = ref("");
const items = ref([]);
const drawer = ref("");
const selected = ref({});
const availableScripts = ref([]);
const linkedScripts = ref([]);
const linkedScriptIds = ref([]);
const error = ref("");

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
    inactive: "下架"
  };
  return labels[value] || value || "-";
}

function isSelected(item) {
  return selected.value?.id && Number(selected.value.id) === Number(item.id);
}

function switchTab(nextTab) {
  if (tab.value === nextTab) {
    return;
  }
  closeDrawer();
  tab.value = nextTab;
}

async function load() {
  error.value = "";
  const filters = { keyword: keyword.value, status: status.value, limit: "100" };
  try {
    items.value = tab.value === "stores" ? await listStores(filters) : await listScripts(filters);
  } catch (err) {
    error.value = err.message;
  }
}

async function refreshScriptOptions() {
  availableScripts.value = await listScripts({ keyword: "", status: "active", limit: "100" });
}

async function openCreate() {
  selected.value = {};
  linkedScripts.value = [];
  linkedScriptIds.value = [];
  if (tab.value === "stores") {
    error.value = "";
    try {
      await refreshScriptOptions();
      drawer.value = "store";
    } catch (err) {
      error.value = err.message;
    }
    return;
  }
  drawer.value = "script";
}

async function openEdit(item) {
  selected.value = { ...item };
  if (tab.value === "stores") {
    error.value = "";
    try {
      await refreshScriptOptions();
      const scripts = await listStoreScripts(item.id);
      linkedScripts.value = scripts;
      linkedScriptIds.value = scripts.map((script) => Number(script.id));
      drawer.value = "store";
    } catch (err) {
      error.value = err.message;
    }
    return;
  }
  drawer.value = "script";
}

function closeDrawer() {
  drawer.value = "";
  selected.value = {};
  linkedScripts.value = [];
  linkedScriptIds.value = [];
}

async function saveStoreItem(store) {
  error.value = "";
  const { scriptIds = [], scriptLinks = [], storeScriptPriceYuanById, ...payload } = store;
  try {
    const saved = await saveStore(payload);
    await saveStoreScripts(saved.id, scriptLinks.length > 0 ? scriptLinks : scriptIds);
    closeDrawer();
    await load();
  } catch (err) {
    error.value = err.message;
  }
}

async function saveScriptItem(script) {
  error.value = "";
  try {
    await saveScript(script);
    closeDrawer();
    await load();
  } catch (err) {
    error.value = err.message;
  }
}

async function toggleStatus(item) {
  const nextStatus = item.status === "active" ? "inactive" : "active";
  const actionLabel = nextStatus === "inactive" ? "下架" : "上架";
  if (!window.confirm(`确认${actionLabel}「${item.name}」？`)) {
    return;
  }
  error.value = "";
  try {
    if (tab.value === "stores") {
      await saveStore({ id: item.id, status: nextStatus });
    } else {
      await saveScript({ id: item.id, status: nextStatus });
    }
    await load();
  } catch (err) {
    error.value = err.message;
  }
}

watch(tab, load);
onMounted(load);
</script>
