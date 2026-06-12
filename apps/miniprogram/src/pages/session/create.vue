<template>
  <view class="page">
    <view class="section">
      <view class="title">建车</view>
      <view class="text">选择店家、剧本、时间和座位，补贴配平后发布。</view>
      <view v-if="catalogLoadStatus" class="notice">{{ catalogLoadStatus }}</view>
      <view v-if="publishStatusText" class="notice">{{ publishStatusText }}</view>
      <view v-if="lastSessionId" class="actions">
        <button class="button secondary" @tap="goDetail(lastSessionId)">查看已发布车</button>
      </view>
    </view>

    <view class="section">
      <view class="section-title">店家</view>
      <view class="search-row">
        <input v-model="storeKeyword" class="field search" placeholder="搜索店家" />
        <button class="mini-button" @tap="loadStores">搜索</button>
      </view>
      <view v-for="store in stores" :key="store.id" class="item" @tap="selectStore(store)">
        <view class="item-main">
          <view class="item-title">{{ store.name }}</view>
          <view class="item-sub">{{ store.city }} {{ store.district || "" }} {{ store.address || "" }}</view>
        </view>
        <view v-if="selectedStoreId === store.id" class="selected">已选</view>
      </view>
    </view>

    <view class="section">
      <view class="section-title">剧本</view>
      <view class="search-row">
        <input v-model="scriptKeyword" class="field search" placeholder="搜索剧本" />
        <button class="mini-button" @tap="loadScripts">搜索</button>
      </view>
      <view v-for="script in scripts" :key="script.id" class="item" @tap="selectScript(script)">
        <view class="item-main">
          <view class="item-title">{{ script.name }}</view>
          <view class="item-sub">{{ displayTags(script.type_tags) }} / {{ script.player_count || 0 }}人</view>
          <view class="item-sub">{{ script.summary_no_spoiler || "暂无简介" }}</view>
        </view>
        <view v-if="selectedScriptId === script.id" class="selected">已选</view>
      </view>
    </view>

    <view class="section">
      <view class="section-title">开车信息</view>
      <input v-model="sessionForm.startAt" class="field" placeholder="开车时间，如 2026-06-12 19:30:00" />
      <view class="field-row">
        <input v-model="sessionForm.dmNameSnapshot" class="field half" placeholder="指定DM，可不填" />
        <input v-model="sessionForm.npcNameSnapshot" class="field half" placeholder="指定NPC，可不填" />
      </view>
      <input v-model="sessionForm.depositAmountYuan" class="field" placeholder="线下锁位押金，元，可填0" />
      <textarea v-model="sessionForm.note" class="textarea" placeholder="备注，不填写联系方式或高风险承诺" />
    </view>

    <view class="section">
      <view class="section-title">座位与实付</view>
      <view class="summary">
        <view :class="{ danger: adjustmentSumCents !== 0 }">补贴合计：{{ formatCents(adjustmentSumCents) }}</view>
        <view>玩家实付合计：{{ formatCents(payableTotalCents) }}</view>
        <view v-if="adjustmentSumCents !== 0" class="danger">
          补贴还未配平，当前差额 {{ formatCents(adjustmentSumCents) }}
        </view>
        <view v-if="hasNegativePayable" class="danger">存在实付价小于0的座位，不能发布。</view>
      </view>
      <view class="actions compact">
        <button class="mini-button" @tap="applyScriptTemplate">剧本模板</button>
        <button class="mini-button" @tap="applyDefaultTemplate">默认5人</button>
        <button class="mini-button" @tap="addSeat">新增座位</button>
        <button class="mini-button ghost" @tap="clearSeats">清空</button>
      </view>

      <view v-for="(seat, index) in seats" :key="seat.localId" class="seat-card">
        <view class="seat-header">
          <view class="seat-title">{{ seat.name || "未命名座位" }}</view>
          <button class="mini-button danger-button" @tap="removeSeat(index)">删除</button>
        </view>
        <input
          :value="seat.name"
          class="field"
          placeholder="座位名，如 情感沉浸位、F4-1"
          @input="updateSeat(index, 'name', $event.detail.value)"
        />
        <view class="field-row">
          <input
            :value="seat.seatType"
            class="field half"
            placeholder="类型 love_companion/f4/cp"
            @input="updateSeat(index, 'seatType', $event.detail.value)"
          />
          <input
            :value="seat.roleName"
            class="field half"
            placeholder="角色名/位置说明"
            @input="updateSeat(index, 'roleName', $event.detail.value)"
          />
        </view>
        <view class="field-row">
          <input
            :value="seat.basePriceYuan"
            class="field half"
            placeholder="原价 元"
            @input="updateSeat(index, 'basePriceYuan', $event.detail.value)"
          />
          <input
            :value="seat.adjustmentYuan"
            class="field half"
            placeholder="调整 元，可为负"
            @input="updateSeat(index, 'adjustmentYuan', $event.detail.value)"
          />
        </view>
        <view class="item-sub">实付价：{{ formatCents(payableCents(seat)) }}</view>
      </view>

      <view v-if="validationMessages.length" class="validation">
        <view v-for="message in validationMessages" :key="message" class="danger">{{ message }}</view>
      </view>
      <view class="actions">
        <button class="button" :class="{ disabled: !canPublish }" :disabled="publishBusy" @tap="publishSession">
          {{ publishBusy ? "发布中..." : "发布车" }}
        </button>
      </view>
    </view>

    <view class="section">
      <view class="section-title">补充资料申请</view>
      <view class="toggle-row">
        <button
          class="toggle"
          :class="{ active: requestForm.requestType === 'store' }"
          @tap="requestForm.requestType = 'store'"
        >
          店家
        </button>
        <button
          class="toggle"
          :class="{ active: requestForm.requestType === 'script' }"
          @tap="requestForm.requestType = 'script'"
        >
          剧本
        </button>
      </view>
      <input v-model="requestForm.name" class="field" placeholder="名称" />
      <view v-if="requestForm.requestType === 'store'" class="field-row">
        <input v-model="requestForm.city" class="field half" placeholder="城市" />
        <input v-model="requestForm.district" class="field half" placeholder="区域" />
      </view>
      <textarea v-model="requestForm.description" class="textarea" placeholder="补充说明" />
      <view class="actions">
        <button class="button" @tap="submitCatalogRequest">提交申请</button>
      </view>
      <view v-if="submitStatusText" class="notice">{{ submitStatusText }}</view>
    </view>
  </view>
</template>

<script setup>
import { computed, onMounted, ref } from "vue";
import { dataOf, getCurrentUser, queryString, request } from "../../utils/api";

const storeKeyword = ref("");
const scriptKeyword = ref("");
const stores = ref([]);
const scripts = ref([]);
const selectedStoreId = ref("");
const selectedScriptId = ref("");
const selectedStore = ref(null);
const selectedScript = ref(null);
const requestForm = ref(defaultRequestForm());
const submitStatusText = ref("");
const catalogLoadStatus = ref("");
const publishStatusText = ref("");
const publishBusy = ref(false);
const lastSessionId = ref("");
const seats = ref([]);
const sessionForm = ref({
  startAt: defaultStartAt(),
  dmNameSnapshot: "",
  npcNameSnapshot: "",
  depositAmountYuan: "0",
  note: ""
});

const adjustmentSumCents = computed(() => {
  return seats.value.reduce((sum, seat) => sum + yuanToCents(seat.adjustmentYuan), 0);
});
const payableTotalCents = computed(() => {
  return seats.value.reduce((sum, seat) => sum + payableCents(seat), 0);
});
const hasNegativePayable = computed(() => seats.value.some((seat) => payableCents(seat) < 0));
const validationMessages = computed(() => {
  const messages = [];
  if (!selectedStoreId.value) {
    messages.push("请选择店家。");
  }
  if (!selectedScriptId.value) {
    messages.push("请选择剧本。");
  }
  if (!sessionForm.value.startAt) {
    messages.push("请填写开车时间。");
  }
  if (yuanToCents(sessionForm.value.depositAmountYuan) < 0) {
    messages.push("押金不能小于0。");
  }
  if (seats.value.length === 0) {
    messages.push("至少需要一个座位。");
  }
  if (adjustmentSumCents.value !== 0) {
    messages.push("补贴合计必须为0。");
  }
  if (hasNegativePayable.value) {
    messages.push("座位实付价不能小于0。");
  }
  const risk = findPublicTextRisk();
  if (risk) {
    messages.push(`公开展示字段包含高风险词「${risk.word}」，请改写${risk.label}。`);
  }
  return messages;
});
const canPublish = computed(() => validationMessages.value.length === 0 && !publishBusy.value);

onMounted(() => {
  loadInitialCatalog();
});

function defaultRequestForm() {
  return {
    requestType: "store",
    name: "",
    city: "北京",
    district: "",
    description: ""
  };
}

function defaultStartAt() {
  const date = new Date(Date.now() + 24 * 60 * 60 * 1000);
  date.setHours(19, 30, 0, 0);
  return formatDateTime(date);
}

function formatDateTime(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:00`;
}

function showMessage(title) {
  uni.showToast({ title, icon: "none" });
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

function parseJson(value, fallback) {
  if (!value) {
    return fallback;
  }
  if (Array.isArray(value)) {
    return value;
  }
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : fallback;
  } catch (error) {
    return fallback;
  }
}

function firstRiskWord(value) {
  if (!value) {
    return "";
  }
  const riskWords = [
    "红包",
    "返现",
    "提现",
    "现金奖励",
    "分享奖励",
    "拉人奖励",
    "拉新奖励",
    "抽奖",
    "优先锁座",
    "现实陪伴",
    "线下陪伴",
    "联系方式",
    "手机号",
    "微信号",
    "加微信",
    "牵手",
    "小黑屋",
    "恋陪",
    "爱D"
  ];
  const text = String(value);
  const keyword = riskWords.find((word) => text.includes(word));
  if (keyword) {
    return keyword;
  }
  if (/(^|[^\d])1[3-9]\d{9}($|[^\d])/.test(text)) {
    return "手机号";
  }
  return "";
}

function findPublicTextRisk() {
  const fields = [
    { label: "指定DM", value: sessionForm.value.dmNameSnapshot },
    { label: "指定NPC", value: sessionForm.value.npcNameSnapshot }
  ];
  seats.value.forEach((seat, index) => {
    fields.push({ label: `第${index + 1}个座位名`, value: seat.name });
    fields.push({ label: `第${index + 1}个角色说明`, value: seat.roleName });
  });

  for (const field of fields) {
    const word = firstRiskWord(field.value);
    if (word) {
      return { ...field, word };
    }
  }
  return null;
}

function normalizeSeat(item = {}, index = 0) {
  return {
    localId: `${Date.now()}-${index}-${Math.random().toString(16).slice(2)}`,
    name: item.name || `座位${index + 1}`,
    seatType: item.seatType || item.seat_type || "normal",
    roleName: item.roleName || item.role_name || "",
    basePriceYuan: centsToYuanText(item.basePrice ?? item.base_price ?? 0),
    adjustmentYuan: centsToYuanText(item.adjustment ?? 0)
  };
}

function defaultTemplate() {
  return [
    { name: "情感沉浸位", seatType: "love_companion", roleName: "主线互动位", basePrice: 58000, adjustment: 20000 },
    { name: "F4-1", seatType: "f4", roleName: "玩家CP位", basePrice: 58000, adjustment: -5000 },
    { name: "F4-2", seatType: "f4", roleName: "玩家CP位", basePrice: 58000, adjustment: -5000 },
    { name: "F4-3", seatType: "f4", roleName: "玩家CP位", basePrice: 58000, adjustment: -5000 },
    { name: "F4-4", seatType: "f4", roleName: "玩家CP位", basePrice: 58000, adjustment: -5000 }
  ];
}

function applyTemplate(template) {
  seats.value = template.map((item, index) => normalizeSeat(item, index));
}

function applyDefaultTemplate() {
  applyTemplate(defaultTemplate());
}

function applyScriptTemplate() {
  const template = parseJson(selectedScript.value?.default_seat_template_json, []);
  applyTemplate(template.length > 0 ? template : defaultTemplate());
}

function addSeat() {
  seats.value.push(
    normalizeSeat(
      {
        name: `座位${seats.value.length + 1}`,
        seatType: "normal",
        roleName: "",
        basePrice: 58000,
        adjustment: 0
      },
      seats.value.length
    )
  );
}

function removeSeat(index) {
  seats.value.splice(index, 1);
}

function clearSeats() {
  seats.value = [];
}

function updateSeat(index, key, value) {
  seats.value[index] = {
    ...seats.value[index],
    [key]: value
  };
}

function yuanToCents(value) {
  if (value === undefined || value === null || value === "") {
    return 0;
  }
  const parsed = Number(value);
  if (Number.isNaN(parsed)) {
    return 0;
  }
  return Math.round(parsed * 100);
}

function centsToYuanText(value) {
  const cents = Number(value || 0);
  if (cents % 100 === 0) {
    return String(cents / 100);
  }
  return (cents / 100).toFixed(2);
}

function formatCents(value) {
  const prefix = value < 0 ? "-¥" : "¥";
  return `${prefix}${centsToYuanText(Math.abs(value))}`;
}

function payableCents(seat) {
  return yuanToCents(seat.basePriceYuan) + yuanToCents(seat.adjustmentYuan);
}

async function loadStores() {
  try {
    const response = await request({
      url: "/api/stores" + queryString({ keyword: storeKeyword.value, limit: 20 })
    });
    stores.value = dataOf(response) || [];
  } catch (error) {
    catalogLoadStatus.value = "店家加载失败，请稍后重试。";
    showMessage("店家加载失败");
  }
}

async function loadScripts() {
  try {
    const response = await request({
      url: "/api/scripts" + queryString({ keyword: scriptKeyword.value, limit: 20 })
    });
    scripts.value = dataOf(response) || [];
  } catch (error) {
    catalogLoadStatus.value = "剧本加载失败，请稍后重试。";
    showMessage("剧本加载失败");
  }
}

async function loadInitialCatalog() {
  catalogLoadStatus.value = "";
  await Promise.allSettled([loadStores(), loadScripts()]);
  if (!selectedScriptId.value && scripts.value.length > 0) {
    selectScript(scripts.value[0]);
  }
}

function selectStore(store) {
  selectedStoreId.value = store.id;
  selectedStore.value = store;
}

function selectScript(script) {
  selectedScriptId.value = script.id;
  selectedScript.value = script;
  applyScriptTemplate();
}

async function submitCatalogRequest() {
  const auth = getCurrentUser();
  if (!auth.user) {
    showMessage("请先在我的页登录");
    return;
  }
  if (!requestForm.value.name) {
    showMessage("请填写名称");
    return;
  }

  try {
    await request({
      url: "/api/catalog-requests",
      method: "POST",
      data: requestForm.value
    });
    showMessage("已提交");
    submitStatusText.value = "已提交，等待管理员处理。";
    requestForm.value = defaultRequestForm();
  } catch (error) {
    submitStatusText.value = "提交失败，请稍后重试。";
    showMessage("提交失败");
  }
}

async function publishSession() {
  const auth = getCurrentUser();
  if (!auth.user) {
    showMessage("请先在我的页登录");
    return;
  }
  if (!canPublish.value) {
    showMessage(validationMessages.value[0] || "请完善建车信息");
    return;
  }

  publishBusy.value = true;
  publishStatusText.value = "正在创建车...";
  try {
    const sessionResponse = await request({
      url: "/api/sessions",
      method: "POST",
      data: {
        storeId: selectedStoreId.value,
        scriptId: selectedScriptId.value,
        startAt: sessionForm.value.startAt,
        dmNameSnapshot: sessionForm.value.dmNameSnapshot,
        npcNameSnapshot: sessionForm.value.npcNameSnapshot,
        depositAmount: yuanToCents(sessionForm.value.depositAmountYuan),
        note: sessionForm.value.note,
        visibility: "share_only"
      }
    });
    const session = dataOf(sessionResponse);

    for (const seat of seats.value) {
      await request({
        url: `/api/sessions/${session.id}/seats`,
        method: "POST",
        data: {
          name: seat.name,
          seatType: seat.seatType || "normal",
          roleName: seat.roleName,
          basePrice: yuanToCents(seat.basePriceYuan),
          adjustment: yuanToCents(seat.adjustmentYuan)
        }
      });
    }

    await request({
      url: `/api/sessions/${session.id}/publish`,
      method: "POST"
    });
    lastSessionId.value = session.id;
    publishStatusText.value = "发布成功，正在打开车详情。";
    showMessage("发布成功");
    goDetail(session.id);
  } catch (error) {
    publishStatusText.value = "发布失败，请检查信息后重试。";
    showMessage("发布失败");
  } finally {
    publishBusy.value = false;
  }
}

function goDetail(id) {
  uni.navigateTo({ url: `/pages/session/detail?id=${id}` });
}
</script>

<style scoped>
.section-title {
  margin-bottom: 18rpx;
  font-size: 30rpx;
  font-weight: 600;
}

.search-row,
.toggle-row,
.field-row {
  display: flex;
  gap: 12rpx;
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

.field.search,
.field.half {
  flex: 1;
  min-width: 0;
}

.textarea {
  min-height: 156rpx;
  padding-top: 18rpx;
  line-height: 1.5;
}

.mini-button,
.toggle {
  min-width: 120rpx;
  height: 64rpx;
  padding: 0 18rpx;
  border-radius: 8rpx;
  background: #eef2f7;
  color: #334155;
  font-size: 24rpx;
  line-height: 64rpx;
}

.mini-button,
.toggle.active {
  background: #1f7a68;
  color: #ffffff;
}

.mini-button.ghost {
  background: #ffffff;
  color: #455a64;
  border: 1rpx solid #cbd5e1;
}

.danger-button {
  min-width: 96rpx;
  background: #b42318;
}

.item {
  display: flex;
  gap: 16rpx;
  align-items: flex-start;
  justify-content: space-between;
  padding: 20rpx 0;
  border-top: 1rpx solid #edf1f5;
}

.item-main {
  flex: 1;
  min-width: 0;
}

.item-title {
  font-size: 28rpx;
  font-weight: 600;
}

.item-sub {
  margin-top: 6rpx;
  color: #64748b;
  font-size: 24rpx;
  line-height: 1.45;
}

.selected {
  flex-shrink: 0;
  color: #1f7a68;
  font-size: 24rpx;
}

.notice,
.validation {
  margin-top: 14rpx;
  padding: 16rpx;
  border-radius: 8rpx;
  background: #eef7f4;
  color: #1f7a68;
  font-size: 24rpx;
  line-height: 1.5;
}

.summary {
  margin-bottom: 16rpx;
  color: #334155;
  font-size: 26rpx;
  line-height: 1.7;
}

.danger {
  color: #b42318;
}

.actions.compact {
  flex-wrap: wrap;
  margin-top: 8rpx;
  margin-bottom: 16rpx;
}

.seat-card {
  margin-top: 18rpx;
  padding: 20rpx;
  border: 1rpx solid #e6e8eb;
  border-radius: 8rpx;
  background: #fbfcfd;
}

.seat-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12rpx;
  margin-bottom: 14rpx;
}

.seat-title {
  min-width: 0;
  color: #1f2933;
  font-size: 28rpx;
  font-weight: 600;
}

.button.disabled {
  background: #94a3b8;
}
</style>
