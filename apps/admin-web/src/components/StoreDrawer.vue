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
          <section class="location-panel full">
            <div class="location-panel-head">
              <div>
                <strong>位置设置</strong>
                <span>admin web 和微信小程序共用 GCJ-02 坐标</span>
              </div>
              <button
                v-if="hasTencentMapKey"
                class="secondary-action location-map-button"
                type="button"
                :disabled="saving || mapLoading"
                @click="toggleMapPicker"
              >
                {{ mapVisible ? "收起地图" : "地图选点" }}
              </button>
            </div>
            <div class="coordinate-grid">
              <label>
                <span>纬度（GCJ-02）</span>
                <input
                  v-model.trim="model.latitude"
                  name="storeLatitude"
                  inputmode="decimal"
                  placeholder="39.9042000"
                />
              </label>
              <label>
                <span>经度（GCJ-02）</span>
                <input
                  v-model.trim="model.longitude"
                  name="storeLongitude"
                  inputmode="decimal"
                  placeholder="116.4074000"
                />
              </label>
            </div>
            <p v-if="!hasTencentMapKey" class="location-hint">
              未配置腾讯位置服务 Key，可手填 GCJ-02 坐标。
            </p>
            <div v-if="mapVisible" class="map-picker-shell">
              <div ref="mapContainer" class="tencent-map-picker"></div>
              <p class="location-hint">{{ mapStatus }}</p>
              <p v-if="mapError" class="location-error">{{ mapError }}</p>
            </div>
          </section>
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
import { computed, nextTick, onBeforeUnmount, reactive, ref, watch } from "vue";

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
const tencentMapKey = import.meta.env.VITE_TENCENT_MAP_KEY || "";
const mapContainer = ref(null);
const mapVisible = ref(false);
const mapLoading = ref(false);
const mapStatus = ref("");
const mapError = ref("");
let tencentMapPromise = null;
let mapInstance = null;
let mapMarker = null;

const hasTencentMapKey = computed(() => Boolean(tencentMapKey));

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

function coordinateText(value) {
  return value === undefined || value === null || value === "" ? "" : String(value);
}

function coordinateNumber(value, min, max) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max ? number : null;
}

function fixedCoordinate(value) {
  return Number(value).toFixed(7);
}

function validMapPoint(TMap) {
  const latitude = coordinateNumber(model.latitude, -90, 90);
  const longitude = coordinateNumber(model.longitude, -180, 180);
  if (latitude !== null && longitude !== null) {
    return new TMap.LatLng(latitude, longitude);
  }
  return null;
}

function currentMapPoint(TMap) {
  const point = validMapPoint(TMap);
  if (point) {
    return point;
  }
  return new TMap.LatLng(39.9042, 116.4074);
}

function loadTencentMapSdk() {
  if (window.TMap) {
    return Promise.resolve(window.TMap);
  }
  if (!tencentMapPromise) {
    tencentMapPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = `https://map.qq.com/api/gljs?v=1.exp&key=${encodeURIComponent(tencentMapKey)}`;
      script.async = true;
      script.onload = () => (window.TMap ? resolve(window.TMap) : reject(new Error("TMap missing")));
      script.onerror = () => reject(new Error("Tencent map script failed"));
      document.head.appendChild(script);
    });
  }
  return tencentMapPromise;
}

function syncMapMarker(TMap, point) {
  if (!mapMarker) {
    mapMarker = new TMap.MultiMarker({
      map: mapInstance,
      geometries: [{ id: "store-location", position: point }]
    });
    return;
  }
  mapMarker.updateGeometries([{ id: "store-location", position: point }]);
}

function latLngValue(point, key) {
  const value = typeof point[key] === "function" ? point[key]() : point[key];
  return Number(value);
}

function applyMapPoint(point) {
  model.latitude = fixedCoordinate(latLngValue(point, "lat"));
  model.longitude = fixedCoordinate(latLngValue(point, "lng"));
  mapStatus.value = "已回填地图点选坐标";
}

function handleMapClick(event) {
  if (!window.TMap || !event?.latLng) {
    return;
  }
  applyMapPoint(event.latLng);
  syncMapMarker(window.TMap, event.latLng);
}

async function ensureMapPicker() {
  if (!hasTencentMapKey.value || mapLoading.value) {
    return;
  }
  mapLoading.value = true;
  mapError.value = "";
  mapStatus.value = "地图加载中...";
  try {
    const TMap = await loadTencentMapSdk();
    await nextTick();
    if (!mapContainer.value) {
      return;
    }
    const center = currentMapPoint(TMap);
    if (!mapInstance) {
      mapInstance = new TMap.Map(mapContainer.value, {
        center,
        zoom: 16
      });
      mapInstance.on("click", handleMapClick);
    } else {
      mapInstance.setCenter(center);
    }
    syncMapMarker(TMap, center);
    mapStatus.value = "点击地图选择店家位置";
  } catch (error) {
    mapError.value = "腾讯地图加载失败，可继续手填 GCJ-02 坐标。";
    mapStatus.value = "";
  } finally {
    mapLoading.value = false;
  }
}

async function toggleMapPicker() {
  mapVisible.value = !mapVisible.value;
  if (mapVisible.value) {
    await ensureMapPicker();
  }
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
      latitude: coordinateText(store.latitude),
      longitude: coordinateText(store.longitude),
      contactNote: store.contact_note || store.contactNote || "",
      status: store.status || "active",
      scriptIds: linkedSource.map(linkScriptId).filter(Boolean),
      storeScriptPriceYuanById
    });
    scriptKeyword.value = "";
    mapError.value = "";
    if (mapVisible.value) {
      nextTick(() => ensureMapPicker());
    }
  },
  { immediate: true }
);

watch(
  [() => model.latitude, () => model.longitude],
  () => {
    if (!mapInstance || !window.TMap) {
      return;
    }
    const point = validMapPoint(window.TMap);
    if (!point) {
      return;
    }
    mapInstance.setCenter(point);
    syncMapMarker(window.TMap, point);
  }
);

onBeforeUnmount(() => {
  if (mapInstance?.destroy) {
    mapInstance.destroy();
  }
  mapInstance = null;
  mapMarker = null;
});

function submit() {
  if (props.saving) {
    return;
  }
  const scriptLinks = (model.scriptIds || []).map((scriptId) => ({
    scriptId: Number(scriptId),
    pricePerPlayer: Number(model.storeScriptPriceYuanById?.[Number(scriptId)] || 0) * 100
  }));
  emit("save", {
    ...model,
    latitude: model.latitude,
    longitude: model.longitude,
    scriptLinks
  });
}
</script>

<style scoped>
.location-panel {
  display: grid;
  gap: 12px;
  padding: 14px;
  border: 1px solid #dfe8e4;
  border-radius: 8px;
  background: #f8fbfa;
}

.location-panel-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.location-panel-head div {
  display: grid;
  gap: 3px;
}

.location-panel-head strong {
  color: #17211f;
  font-size: 14px;
}

.location-panel-head span,
.location-hint,
.location-error {
  margin: 0;
  color: #63716d;
  font-size: 12px;
  font-weight: 500;
}

.location-error {
  color: #b42318;
}

.location-map-button {
  min-width: 88px;
}

.coordinate-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.map-picker-shell {
  display: grid;
  gap: 8px;
}

.tencent-map-picker {
  width: 100%;
  min-height: 260px;
  overflow: hidden;
  border: 1px solid #dce6e2;
  border-radius: 8px;
  background: #eef5f2;
}

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

@media (max-width: 680px) {
  .coordinate-grid {
    grid-template-columns: 1fr;
  }

  .location-panel-head {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>
