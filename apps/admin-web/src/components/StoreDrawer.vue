<template>
  <aside class="drawer">
    <header class="drawer-head">
      <h2>{{ model.id ? "编辑店家" : "新增店家" }}</h2>
      <button class="close-button" type="button" :disabled="saving" @click="$emit('close')">
        关闭
      </button>
    </header>
    <form class="drawer-form" @submit.prevent="submit">
      <div class="drawer-body">
        <div class="form-grid">
          <label>
            <span>名称</span>
            <input v-model.trim="model.name" name="storeName" required />
          </label>
          <label>
            <span>城市</span>
            <input v-model.trim="model.city" name="storeCity" required />
          </label>
          <label>
            <span>区域</span>
            <input v-model.trim="model.district" name="storeDistrict" />
          </label>
          <label>
            <span>地址</span>
            <input v-model.trim="model.address" name="storeAddress" />
          </label>
          <label class="full">
            <span>联系备注</span>
            <textarea v-model.trim="model.contactNote" name="storeContactNote" rows="3"></textarea>
          </label>
          <label>
            <span>状态</span>
            <select v-model="model.status" name="storeStatus">
              <option value="active">上架（active）</option>
              <option value="inactive">下架（inactive）</option>
            </select>
          </label>
        </div>

        <fieldset class="script-links">
          <div class="script-links-head">
            <div>
              <strong>关联剧本（可多选）</strong>
              <span>勾选后，该店开车时可选择这些剧本</span>
            </div>
            <span class="script-link-count">已选择 {{ model.scriptIds.length }} 个剧本</span>
          </div>
          <input
            v-model.trim="scriptKeyword"
            name="storeScriptKeyword"
            placeholder="搜索剧本名称"
          />
          <div class="script-choice-list">
            <div
              v-for="script in filteredScripts"
              :key="script.id"
              class="script-choice"
              :class="{ selected: isScriptSelected(script.id) }"
            >
              <label class="script-choice-main">
                <input v-model="model.scriptIds" type="checkbox" :value="Number(script.id)" />
                <span>
                  <strong>{{ script.name }}</strong>
                  <small>{{ displayTags(script.type_tags) }}</small>
                </span>
              </label>
              <label v-if="isScriptSelected(script.id)" class="store-script-price">
                <span>统一价（元/人）</span>
                <input
                  v-model.number="model.storeScriptPriceYuanById[Number(script.id)]"
                  :name="`storeScriptPrice-${script.id}`"
                  type="number"
                  min="0"
                  placeholder="0"
                />
              </label>
            </div>
            <p v-if="filteredScripts.length === 0" class="script-empty">没有匹配的剧本</p>
          </div>
        </fieldset>
      </div>

      <footer class="drawer-footer">
        <button class="secondary-action" type="button" :disabled="saving" @click="$emit('close')">
          取消
        </button>
        <button class="primary" type="submit" :disabled="saving">
          {{ saving ? "保存中..." : "保存店家" }}
        </button>
      </footer>
    </form>
  </aside>
</template>

<script setup>
import { computed, reactive, ref, watch } from "vue";

const props = defineProps({
  store: { type: Object, required: true },
  availableScripts: { type: Array, default: () => [] },
  linkedScripts: { type: Array, default: () => [] },
  linkedScriptIds: { type: Array, default: () => [] },
  saving: { type: Boolean, default: false }
});
const emit = defineEmits(["save", "close"]);

const model = reactive({});
const scriptKeyword = ref("");

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

function displayTags(value) {
  const tags = parseJsonArray(value);
  return tags.length > 0 ? tags.join("、") : "未标注";
}

const filteredScripts = computed(() => {
  const keyword = scriptKeyword.value.toLowerCase();
  return props.availableScripts.filter((script) => {
    if (!keyword) {
      return true;
    }
    return [script.name, displayTags(script.type_tags)].some((value) =>
      String(value || "").toLowerCase().includes(keyword)
    );
  });
});

function centsToYuan(value) {
  return Math.round(Number(value || 0) / 100);
}

function linkScriptId(link) {
  if (link && typeof link === "object") {
    return Number(link.scriptId || link.id);
  }
  return Number(link);
}

function linkPriceYuan(link) {
  if (!link || typeof link !== "object") {
    return 0;
  }
  return centsToYuan(link.pricePerPlayer ?? link.price_per_player);
}

function isScriptSelected(scriptId) {
  return (model.scriptIds || []).includes(Number(scriptId));
}

watch(
  [() => props.store, () => props.linkedScripts, () => props.linkedScriptIds],
  ([store, linkedScripts, linkedScriptIds]) => {
    const linkedSource =
      linkedScripts.length > 0 ? linkedScripts : store.scriptLinks || linkedScriptIds || [];
    const storeScriptPriceYuanById = {};
    linkedSource.forEach((link) => {
      const scriptId = linkScriptId(link);
      if (scriptId) {
        storeScriptPriceYuanById[scriptId] = linkPriceYuan(link);
      }
    });
    Object.assign(model, {
      id: store.id,
      name: store.name || "",
      city: store.city || "北京",
      district: store.district || "",
      address: store.address || "",
      contactNote: store.contact_note || store.contactNote || "",
      status: store.status || "active",
      scriptIds: linkedSource.map(linkScriptId).filter(Boolean),
      storeScriptPriceYuanById
    });
    scriptKeyword.value = "";
  },
  { immediate: true }
);

function submit() {
  if (props.saving) {
    return;
  }
  const scriptLinks = (model.scriptIds || []).map((scriptId) => ({
    scriptId: Number(scriptId),
    pricePerPlayer: Number(model.storeScriptPriceYuanById?.[Number(scriptId)] || 0) * 100
  }));
  emit("save", { ...model, scriptLinks });
}
</script>

<style scoped>
.script-links-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  color: #17211f;
}

.script-links-head div {
  display: grid;
  gap: 3px;
}

.script-link-count,
.script-links-head span,
.script-choice small,
.script-empty {
  color: #63716d;
  font-size: 12px;
  font-weight: 500;
}

.script-choice-list {
  display: grid;
  max-height: 280px;
  overflow: auto;
  border-top: 1px solid #edf2f0;
}

.script-choice {
  display: grid !important;
  grid-template-columns: minmax(0, 1fr) 160px;
  align-items: center;
  gap: 12px !important;
  padding: 10px 0;
  border-bottom: 1px solid #edf2f0;
}

.script-choice-main {
  display: flex !important;
  grid-template-columns: none !important;
  align-items: center;
  gap: 10px !important;
  min-width: 0;
}

.script-choice-main input {
  width: 18px;
  height: 18px;
}

.script-choice-main span {
  display: grid;
  gap: 3px;
  min-width: 0;
}

.script-choice strong {
  color: #17211f;
  font-size: 14px;
}

.store-script-price {
  display: grid !important;
  grid-template-columns: none !important;
  gap: 4px !important;
}

.store-script-price span {
  color: #63716d;
  font-size: 12px;
  font-weight: 600;
}

.store-script-price input {
  width: 100%;
}

.script-empty {
  margin: 12px 0 0;
}
</style>
