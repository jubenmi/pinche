<template>
  <section class="mini-app-workspace">
    <div class="catalog-panel mini-app-panel">
      <div class="album-panel-head">
        <div>
          <p class="eyebrow">网页小程序</p>
          <h2>管理员内测版</h2>
        </div>
        <p class="status">
          复刻小程序业务流程，当前仅 admin-web 登录后的管理员可用。跑稳后可升级为用户网页版。
        </p>
      </div>
      <div class="mini-app-tabs">
        <button
          v-for="item in tabs"
          :key="item.value"
          type="button"
          :class="{ active: screen === item.value }"
          @click="switchScreen(item.value)"
        >
          {{ item.label }}
        </button>
      </div>
    </div>

    <p v-if="statusText" class="warning">{{ statusText }}</p>
    <p v-if="errorText" class="error">{{ errorText }}</p>

    <div v-if="screen === 'home'" class="mini-grid two">
      <section class="table-card mini-section">
        <div class="section-head">
          <h3>入口</h3>
          <span>小程序首页</span>
        </div>
        <div class="mini-body">
          <div class="mini-hero">
            <h2>剧本迷·拼车</h2>
            <p>一起玩好本，轻松出发。</p>
          </div>
          <div class="mini-action-grid">
            <button class="primary" type="button" @click="startCreate">创建车局</button>
            <button class="secondary-action" type="button" @click="openMine">我的</button>
            <button class="secondary-action" type="button" @click="switchScreen('album')">
              车局相册
            </button>
          </div>
        </div>
      </section>

      <section class="table-card mini-section">
        <div class="section-head">
          <h3>对等范围</h3>
          <span>管理员内测</span>
        </div>
        <div class="mini-body parity-list">
          <div>创建车局：选店、选本、选角色、设置时间、发布并占位</div>
          <div>车详情：基础信息、座位、选择角色、记录、相册入口</div>
          <div>我的：我的发车、我参与的车、下架自己的列表记录</div>
          <div>车头管理：申请审核、定金状态、锁座、释放、转让、取消</div>
          <div>车友记录：星级、文字、照片上传，沿用 COS 直传策略</div>
          <div>相册：上传、标注、删除、隐私设置，沿用 admin owner-only 约束</div>
        </div>
      </section>
    </div>

    <div v-else-if="screen === 'create'" class="table-card mini-section">
      <div class="section-head">
        <h3>创建车局</h3>
        <span>{{ createStepLabel }}</span>
      </div>
      <div class="mini-flow">
        <div class="mini-stepper">
          <button
            v-for="item in createSteps"
            :key="item.value"
            type="button"
            :class="{ active: createStep === item.value }"
            @click="createStep = item.value"
          >
            {{ item.label }}
          </button>
        </div>

        <section v-if="createStep === 'store'" class="mini-body">
          <div class="toolbar toolbar-primary mini-toolbar">
            <div class="filter-group">
              <input v-model="storeKeyword" placeholder="搜索店名或商圈" @keydown.enter="loadStores" />
              <button type="button" @click="loadStores">搜索店家</button>
            </div>
            <button class="primary" type="button" :disabled="!selectedStore" @click="createStep = 'script'">
              下一步
            </button>
          </div>
          <div class="mini-list">
            <button
              v-for="store in stores"
              :key="store.id"
              class="mini-list-row"
              :class="{ active: selectedStore?.id === store.id }"
              type="button"
              @click="selectStore(store)"
            >
              <strong>{{ store.name }}</strong>
              <span>{{ storeMeta(store) }}</span>
            </button>
            <div v-if="stores.length === 0" class="empty-block">暂无店家。</div>
          </div>
        </section>

        <section v-if="createStep === 'script'" class="mini-body">
          <div class="toolbar toolbar-primary mini-toolbar">
            <div class="filter-group">
              <input v-model="scriptKeyword" placeholder="搜索剧本" @keydown.enter="loadScripts" />
              <button type="button" @click="loadScripts">搜索剧本</button>
            </div>
            <button class="primary" type="button" :disabled="!selectedScript" @click="createStep = 'role'">
              下一步
            </button>
          </div>
          <div class="mini-list">
            <button
              v-for="script in scripts"
              :key="script.id"
              class="mini-list-row"
              :class="{ active: selectedScript?.id === script.id }"
              type="button"
              @click="selectScript(script)"
            >
              <strong>{{ script.name }}</strong>
              <span>{{ script.player_count || 0 }}人 · {{ displayTags(script.type_tags) }}</span>
              <small>{{ script.summary_no_spoiler || "暂无简介" }}</small>
            </button>
            <div v-if="scripts.length === 0" class="empty-block">暂无可选剧本。</div>
          </div>
        </section>

        <section v-if="createStep === 'role'" class="mini-body">
          <div class="role-card-grid">
            <button
              v-for="role in roleOptions"
              :key="role.id"
              class="role-card"
              :class="[role.roleGender, { active: selectedRole?.id === role.id }]"
              type="button"
              @click="selectedRole = role"
            >
              <strong>{{ role.name }} {{ roleGenderSymbol(role.roleGender) }}</strong>
              <span>{{ role.note || "角色位" }}</span>
            </button>
          </div>
          <div class="mini-bottom-actions">
            <button class="secondary-action" type="button" @click="createStep = 'script'">上一步</button>
            <button class="primary" type="button" :disabled="!selectedRole" @click="createStep = 'setup'">
              下一步
            </button>
          </div>
        </section>

        <section v-if="createStep === 'setup'" class="mini-body">
          <div class="mini-form-grid">
            <label>
              <span>店家</span>
              <input :value="selectedStore?.name || ''" disabled />
            </label>
            <label>
              <span>剧本</span>
              <input :value="selectedScript?.name || ''" disabled />
            </label>
            <label>
              <span>日期</span>
              <input v-model="createDate" type="date" />
            </label>
            <label>
              <span>时间</span>
              <input v-model="createTime" type="time" />
            </label>
            <label class="full">
              <span>聊天置顶信息</span>
              <textarea v-model="pinnedMessageText" :placeholder="defaultPinnedMessage"></textarea>
            </label>
          </div>
          <div class="mini-bottom-actions">
            <button class="secondary-action" type="button" @click="createStep = 'role'">上一步</button>
            <button class="primary" type="button" :disabled="busy || !canCreate" @click="createPublishedSession">
              {{ busy ? "创建中..." : "创建车局并占位" }}
            </button>
          </div>
        </section>
      </div>
    </div>

    <div v-else-if="screen === 'mine'" class="mini-grid two">
      <section class="table-card mini-section">
        <div class="section-head">
          <h3>我的发车</h3>
          <button type="button" class="action-button" @click="loadMine">刷新</button>
        </div>
        <div class="mini-list">
          <div v-for="session in mySessions" :key="session.id" class="mini-item">
            <strong>{{ session.script_name_snapshot || "未命名车局" }}</strong>
            <span>{{ session.store_name_snapshot || "店家待定" }} · {{ formatDate(session.start_at) }}</span>
            <small>{{ sessionStatusLabel(session.status) }} · {{ session.pending_signup_count || 0 }} 待审</small>
            <div class="mini-row-actions">
              <button type="button" class="action-button" @click="openDetail(session.id)">详情</button>
              <button type="button" class="action-button" @click="openManage(session.id)">管理</button>
              <button type="button" class="action-button danger" @click="hideOrganized(session)">下架</button>
            </div>
          </div>
          <div v-if="mySessions.length === 0" class="empty-block">还没有发车。</div>
        </div>
      </section>

      <section class="table-card mini-section">
        <div class="section-head">
          <h3>我参与的车</h3>
          <span>{{ mySignups.length }} 条</span>
        </div>
        <div class="mini-list">
          <div v-for="signup in mySignups" :key="signup.id" class="mini-item">
            <strong>{{ signup.script_name_snapshot || "车局" }}</strong>
            <span>{{ signup.store_name_snapshot || "店家待定" }} · {{ formatDate(signup.start_at) }}</span>
            <small>{{ signupStatusLabel(signup.status) }} · {{ signup.seat_name || "座位" }}</small>
            <div class="mini-row-actions">
              <button type="button" class="action-button" @click="openDetail(signup.session_id)">详情</button>
              <button type="button" class="action-button" @click="openReview(signup.session_id)">记录</button>
              <button type="button" class="action-button danger" @click="hideSignup(signup)">下架</button>
            </div>
          </div>
          <div v-if="mySignups.length === 0" class="empty-block">还没有参与的车。</div>
        </div>
      </section>
    </div>

    <div v-else-if="screen === 'detail'" class="mini-grid two">
      <section class="table-card mini-section">
        <div class="section-head">
          <h3>{{ detailSession.script_name_snapshot || "车详情" }}</h3>
          <span>{{ sessionStatusLabel(detailSession.status) }}</span>
        </div>
        <div class="mini-body">
          <div class="detail-line">店家：{{ detailSession.store_name_snapshot || "-" }}</div>
          <div class="detail-line">时间：{{ formatDate(detailSession.start_at) }}</div>
          <div class="detail-line">DM：{{ detailSession.dm_name_snapshot || "未指定" }}</div>
          <div class="detail-line">NPC：{{ detailSession.npc_name_snapshot || "未指定" }}</div>
          <div class="detail-line" v-if="shareStats.view_count !== undefined">
            浏览 {{ shareStats.view_count || 0 }} · 申请 {{ shareStats.signup_count || 0 }}
          </div>
          <div class="mini-action-grid">
            <button class="secondary-action" type="button" @click="copySessionLink">复制详情链接</button>
            <button class="secondary-action" type="button" @click="openManage(detailSession.id)">车头管理</button>
            <button class="secondary-action" type="button" @click="openReview(detailSession.id)">写记录</button>
            <button class="secondary-action" type="button" @click="switchScreen('album')">车局相册</button>
          </div>
        </div>
      </section>

      <section class="table-card mini-section">
        <div class="section-head">
          <h3>角色与座位</h3>
          <span>{{ detailSession.seats?.length || 0 }} 位</span>
        </div>
        <div class="mini-list">
          <div v-for="seat in detailSession.seats || []" :key="seat.id" class="mini-item">
            <strong>{{ seat.name }}</strong>
            <span>{{ seat.role_name || "角色位" }} · {{ seatTypeLabel(seat.seat_type) }}</span>
            <small>{{ seatStatusLabel(seat.status) }}</small>
            <div class="mini-row-actions">
              <button
                type="button"
                class="action-button"
                :disabled="busy || !canClaimSeat(seat)"
                @click="claimSeat(seat)"
              >
                选择此位
              </button>
            </div>
          </div>
        </div>
      </section>

      <section class="table-card mini-section span-all">
        <div class="section-head">
          <h3>车友记录</h3>
          <span>{{ sessionReviews.length }} 条</span>
        </div>
        <div class="review-list">
          <article v-for="review in sessionReviews" :key="review.id" class="review-mini-card">
            <strong>{{ review.user_nickname || review.user_open_id || "车友" }}</strong>
            <span>{{ starText(review.rating) }} · {{ review.seat_name || "座位" }}</span>
            <p v-if="review.content">{{ review.content }}</p>
            <div v-if="review.photos?.length" class="review-photo-strip">
              <img v-for="photo in review.photos" :key="photo" :src="assetUrl(photo)" alt="" />
            </div>
          </article>
          <div v-if="sessionReviews.length === 0" class="empty-block">还没有记录。</div>
        </div>
      </section>
    </div>

    <div v-else-if="screen === 'manage'" class="mini-grid two">
      <section class="table-card mini-section">
        <div class="section-head">
          <h3>车头管理</h3>
          <button type="button" class="action-button" @click="loadManage">刷新</button>
        </div>
        <div class="mini-body">
          <div class="detail-line">车局：{{ detailSession.script_name_snapshot || "-" }}</div>
          <div class="detail-line">座位：{{ seatSummary }}</div>
          <label class="mini-textarea-label">
            <span>取消原因</span>
            <textarea v-model="cancelReason" placeholder="可选"></textarea>
          </label>
          <div class="mini-action-grid">
            <button class="secondary-action danger" type="button" :disabled="busy" @click="cancelCurrentSession">
              取消本车
            </button>
            <button class="secondary-action" type="button" @click="openDetail(detailSession.id)">
              返回详情
            </button>
          </div>
        </div>
      </section>

      <section class="table-card mini-section">
        <div class="section-head">
          <h3>上车申请</h3>
          <span>{{ signups.length }} 条</span>
        </div>
        <div class="mini-list">
          <div v-for="signup in signups" :key="signup.id" class="mini-item">
            <strong>{{ seatName(signup.seat_id) }}</strong>
            <span>{{ signup.contact_text || "车内聊天沟通" }}</span>
            <small>{{ signupStatusLabel(signup.status) }} · 定金 {{ signup.deposit_status || "unpaid" }}</small>
            <div class="mini-row-actions">
              <button type="button" class="action-button" :disabled="busy || signup.status !== 'pending'" @click="approve(signup)">
                通过
              </button>
              <button type="button" class="action-button" :disabled="busy || signup.status !== 'pending'" @click="reject(signup)">
                拒绝
              </button>
              <button type="button" class="action-button" :disabled="busy" @click="markDeposit(signup, 'confirmed')">
                定金确认
              </button>
            </div>
          </div>
          <div v-if="signups.length === 0" class="empty-block">暂无申请。</div>
        </div>
      </section>

      <section class="table-card mini-section span-all">
        <div class="section-head">
          <h3>座位状态</h3>
          <span>{{ detailSession.seats?.length || 0 }} 位</span>
        </div>
        <div class="seat-admin-grid">
          <article v-for="seat in detailSession.seats || []" :key="seat.id" class="seat-admin-card">
            <strong>{{ seat.name }}</strong>
            <span>{{ seat.role_name || "角色位" }} · {{ seatStatusLabel(seat.status) }}</span>
            <div class="mini-row-actions">
              <button type="button" class="action-button" :disabled="busy || seat.status !== 'confirmed'" @click="lockSeat(seat)">
                锁座
              </button>
              <button type="button" class="action-button danger" :disabled="busy" @click="kickSeat(seat)">
                释放
              </button>
              <button
                type="button"
                class="action-button"
                :disabled="busy || !canTransferToSeat(seat)"
                @click="transferOrganizer(seat)"
              >
                转让车头
              </button>
            </div>
          </article>
        </div>
      </section>
    </div>

    <div v-else-if="screen === 'review'" class="table-card mini-section">
      <div class="section-head">
        <h3>写记录</h3>
        <span>{{ reviewState.can_review ? "可保存" : "发车后已上车可写" }}</span>
      </div>
      <div class="mini-body">
        <div class="rating-row-web">
          <button
            v-for="value in [1, 2, 3, 4, 5]"
            :key="value"
            type="button"
            :class="{ active: reviewForm.rating >= value }"
            @click="reviewForm.rating = value"
          >
            ★
          </button>
        </div>
        <label class="mini-textarea-label">
          <span>文字记录</span>
          <textarea v-model="reviewForm.content" maxlength="500" placeholder="写一点这车的体验"></textarea>
        </label>
        <div class="review-upload-row">
          <input ref="reviewFileInput" class="sr-only" type="file" accept="image/jpeg,image/png" multiple @change="handleReviewFiles" />
          <button class="secondary-action" type="button" :disabled="busy || reviewForm.photos.length >= 9" @click="reviewFileInput?.click()">
            添加照片
          </button>
          <span>{{ reviewForm.photos.length }}/9</span>
        </div>
        <div class="review-photo-strip editable">
          <button v-for="(photo, index) in reviewForm.photos" :key="photo" type="button" @click="removeReviewPhoto(index)">
            <img :src="assetUrl(photo)" alt="" />
            <span>移除</span>
          </button>
        </div>
        <div class="mini-bottom-actions">
          <button class="secondary-action" type="button" @click="openDetail(activeSessionId)">返回详情</button>
          <button class="primary" type="button" :disabled="busy || !reviewState.can_review" @click="saveReview">
            {{ busy ? "保存中..." : "保存记录" }}
          </button>
        </div>
      </div>
    </div>

    <SessionAlbumWorkspace v-else-if="screen === 'album'" />
  </section>
</template>

<script setup>
import { computed, onMounted, ref } from "vue";
import {
  approveSignup,
  cancelSession,
  claimSessionSeat,
  createSessionSeat,
  createUserSession,
  getSession,
  getSessionShareStats,
  getMySessionReview,
  getStoredAuth,
  hideMyOrganizedSession,
  hideMySignup,
  kickSessionSeat,
  listActiveScripts,
  listActiveStores,
  listMySessions,
  listMySignups,
  listSessionReviews,
  listSessionSignups,
  lockSessionSeat,
  publishSession,
  rejectSignup,
  saveMySessionReview,
  transferSessionOrganizer,
  updateSignupDeposit,
  uploadSessionReviewPhoto
} from "../api";
import SessionAlbumWorkspace from "./SessionAlbumWorkspace.vue";

const tabs = [
  { value: "home", label: "首页" },
  { value: "create", label: "发车" },
  { value: "mine", label: "我的" },
  { value: "album", label: "相册" }
];
const createSteps = [
  { value: "store", label: "选店" },
  { value: "script", label: "选本" },
  { value: "role", label: "选角色" },
  { value: "setup", label: "设置" }
];

const screen = ref("home");
const createStep = ref("store");
const busy = ref(false);
const statusText = ref("");
const errorText = ref("");
const storeKeyword = ref("");
const scriptKeyword = ref("");
const stores = ref([]);
const scripts = ref([]);
const selectedStore = ref(null);
const selectedScript = ref(null);
const roleOptions = ref([]);
const selectedRole = ref(null);
const createDate = ref(defaultDate());
const createTime = ref("14:00");
const pinnedMessageText = ref("");
const mySessions = ref([]);
const mySignups = ref([]);
const activeSessionId = ref("");
const detailSession = ref({});
const shareStats = ref({});
const sessionReviews = ref([]);
const signups = ref([]);
const cancelReason = ref("");
const reviewState = ref({ can_review: false, review: null });
const reviewForm = ref({ rating: 5, content: "", photos: [] });
const reviewFileInput = ref(null);

const createStepLabel = computed(
  () => createSteps.find((item) => item.value === createStep.value)?.label || "创建"
);
const startAt = computed(() => `${createDate.value} ${createTime.value}:00`);
const defaultPinnedMessage = computed(() => {
  const script = selectedScript.value?.name || "剧本";
  const store = selectedStore.value?.name || "店家";
  return `置顶：${script} ${createDate.value} ${createTime.value}，${store}集合。`;
});
const canCreate = computed(() => selectedStore.value?.id && selectedScript.value?.id);
const seatSummary = computed(() => {
  const seats = detailSession.value.seats || [];
  const open = seats.filter((seat) => seat.status === "open").length;
  const applied = seats.filter((seat) => seat.status === "applied").length;
  const confirmed = seats.filter((seat) => ["confirmed", "locked"].includes(seat.status)).length;
  return `${seats.length}位，${open}空位，${applied}待审，${confirmed}已上车`;
});

function defaultDate() {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  return date.toISOString().slice(0, 10);
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

function displayTags(value) {
  const tags = parseJsonArray(value);
  return tags.length ? tags.slice(0, 2).join(" / ") : "未标注";
}

function normalizeRoleGender(value) {
  const text = String(value || "unlimited").trim();
  if (["male", "男", "男位"].includes(text)) {
    return "male";
  }
  if (["female", "女", "女位"].includes(text)) {
    return "female";
  }
  return "unlimited";
}

function roleGenderSymbol(value) {
  const gender = normalizeRoleGender(value);
  if (gender === "male") {
    return "♂";
  }
  if (gender === "female") {
    return "♀";
  }
  return "";
}

function rolesFromScript(script) {
  const template = parseJsonArray(script?.default_seat_template_json);
  if (template.length > 0) {
    return template.map((item, index) => {
      const name = item.name || item.roleName || `角色${index + 1}`;
      return {
        id: `${script.id}-${index}`,
        name,
        note:
          item.description ||
          item.roleDescription ||
          item.role_description ||
          (item.roleName && item.roleName !== name ? item.roleName : ""),
        roleGender: normalizeRoleGender(item.roleGender || item.role_gender || item.gender),
        seatType: item.seatType || item.seat_type || "normal"
      };
    });
  }
  const count = Math.max(1, Number(script?.player_count || 6));
  return Array.from({ length: count }, (_, index) => ({
    id: `${script?.id || "script"}-${index}`,
    name: `角色${index + 1}`,
    note: "角色位",
    roleGender: "unlimited",
    seatType: "normal"
  }));
}

function switchScreen(nextScreen) {
  screen.value = nextScreen;
  errorText.value = "";
  statusText.value = "";
  if (nextScreen === "mine") {
    loadMine();
  }
}

function startCreate() {
  screen.value = "create";
  createStep.value = "store";
  loadStores();
}

function openMine() {
  screen.value = "mine";
  loadMine();
}

async function loadStores() {
  errorText.value = "";
  try {
    stores.value = await listActiveStores({ keyword: storeKeyword.value, limit: "30" });
  } catch (error) {
    errorText.value = error.message;
  }
}

async function loadScripts() {
  errorText.value = "";
  try {
    scripts.value = await listActiveScripts({
      keyword: scriptKeyword.value,
      storeId: selectedStore.value?.id || "",
      limit: "50"
    });
  } catch (error) {
    errorText.value = error.message;
  }
}

function selectStore(store) {
  selectedStore.value = store;
  selectedScript.value = null;
  roleOptions.value = [];
  loadScripts();
}

function selectScript(script) {
  selectedScript.value = script;
  roleOptions.value = rolesFromScript(script);
  selectedRole.value = roleOptions.value[0] || null;
}

async function createPublishedSession() {
  if (busy.value || !canCreate.value) {
    return;
  }
  busy.value = true;
  errorText.value = "";
  statusText.value = "";
  try {
    const session = await createUserSession({
      storeId: Number(selectedStore.value.id),
      scriptId: Number(selectedScript.value.id),
      startAt: startAt.value,
      depositAmount: 0,
      note: "剧本迷·拼车，一起沉浸好本。",
      pinnedMessageText: pinnedMessageText.value.trim() || defaultPinnedMessage.value
    });
    const createdSeats = [];
    for (const role of roleOptions.value) {
      createdSeats.push(
        await createSessionSeat(session.id, {
          name: role.name,
          seatType: role.seatType || "normal",
          roleName: role.note || role.name,
          roleGender: role.roleGender || "unlimited",
          basePrice: Number(selectedScript.value.price_per_player || selectedScript.value.pricePerPlayer || 0),
          adjustment: 0
        })
      );
    }
    await publishSession(session.id);
    const selectedSeat = createdSeats.find((seat) => seat.name === selectedRole.value?.name);
    if (selectedSeat) {
      await claimSessionSeat(selectedSeat.id, { note: "网页小程序创建时选择角色" });
    }
    statusText.value = "车局已创建。";
    await openDetail(session.id);
  } catch (error) {
    errorText.value = error.message;
  } finally {
    busy.value = false;
  }
}

async function loadMine() {
  errorText.value = "";
  try {
    const [sessions, signups] = await Promise.all([
      listMySessions({ limit: "50" }),
      listMySignups()
    ]);
    mySessions.value = sessions || [];
    mySignups.value = signups || [];
  } catch (error) {
    errorText.value = error.message;
  }
}

async function openDetail(sessionId) {
  activeSessionId.value = sessionId;
  screen.value = "detail";
  await loadDetail();
}

async function loadDetail() {
  if (!activeSessionId.value) {
    return;
  }
  errorText.value = "";
  try {
    const [session, stats, reviews] = await Promise.all([
      getSession(activeSessionId.value),
      getSessionShareStats(activeSessionId.value).catch(() => ({})),
      listSessionReviews(activeSessionId.value).catch(() => [])
    ]);
    detailSession.value = session || {};
    shareStats.value = stats || {};
    sessionReviews.value = reviews || [];
  } catch (error) {
    errorText.value = error.message;
  }
}

async function openManage(sessionId) {
  activeSessionId.value = sessionId;
  screen.value = "manage";
  await loadManage();
}

async function loadManage() {
  if (!activeSessionId.value) {
    return;
  }
  errorText.value = "";
  try {
    const [session, rows] = await Promise.all([
      getSession(activeSessionId.value),
      listSessionSignups(activeSessionId.value)
    ]);
    detailSession.value = session || {};
    signups.value = rows || [];
  } catch (error) {
    errorText.value = error.message;
  }
}

async function openReview(sessionId) {
  activeSessionId.value = sessionId;
  screen.value = "review";
  errorText.value = "";
  try {
    const state = await getMySessionReview(sessionId);
    reviewState.value = state || { can_review: false, review: null };
    reviewForm.value = {
      rating: Number(state?.review?.rating || 5),
      content: state?.review?.content || "",
      photos: state?.review?.photos || []
    };
  } catch (error) {
    errorText.value = error.message;
  }
}

async function handleReviewFiles(event) {
  const files = Array.from(event.target.files || []).slice(0, 9 - reviewForm.value.photos.length);
  event.target.value = "";
  if (files.length === 0) {
    return;
  }
  busy.value = true;
  try {
    for (const file of files) {
      const photoUrl = await uploadSessionReviewPhoto(file);
      reviewForm.value.photos.push(photoUrl);
    }
  } catch (error) {
    errorText.value = error.message;
  } finally {
    busy.value = false;
  }
}

function removeReviewPhoto(index) {
  reviewForm.value.photos.splice(index, 1);
}

async function saveReview() {
  if (busy.value || !reviewState.value.can_review) {
    return;
  }
  busy.value = true;
  try {
    await saveMySessionReview(activeSessionId.value, {
      rating: reviewForm.value.rating,
      content: reviewForm.value.content.trim(),
      photoUrls: reviewForm.value.photos
    });
    statusText.value = "记录已保存。";
    await openDetail(activeSessionId.value);
  } catch (error) {
    errorText.value = error.message;
  } finally {
    busy.value = false;
  }
}

async function claimSeat(seat) {
  if (busy.value || !canClaimSeat(seat)) {
    return;
  }
  busy.value = true;
  try {
    await claimSessionSeat(seat.id, { note: "网页小程序选择角色" });
    statusText.value = "角色已选择。";
    await loadDetail();
  } catch (error) {
    errorText.value = error.message;
  } finally {
    busy.value = false;
  }
}

async function approve(signup) {
  await runManageAction(() => approveSignup(signup.id), "已通过申请。");
}

async function reject(signup) {
  await runManageAction(() => rejectSignup(signup.id), "已拒绝申请。");
}

async function markDeposit(signup, depositStatus) {
  await runManageAction(() => updateSignupDeposit(signup.id, depositStatus), "定金状态已更新。");
}

async function lockSeat(seat) {
  await runManageAction(() => lockSessionSeat(seat.id), "座位已锁定。");
}

async function kickSeat(seat) {
  if (!window.confirm(`确认释放「${seat.name}」吗？`)) {
    return;
  }
  await runManageAction(() => kickSessionSeat(seat.id), "座位已释放。");
}

async function transferOrganizer(seat) {
  if (!window.confirm(`确认把车头转让给「${seat.name}」吗？`)) {
    return;
  }
  await runManageAction(
    () => transferSessionOrganizer(activeSessionId.value, seat.confirmed_user_id),
    "车头已转让。"
  );
}

async function cancelCurrentSession() {
  if (!window.confirm("确认取消本车吗？")) {
    return;
  }
  await runManageAction(
    () => cancelSession(activeSessionId.value, cancelReason.value.trim()),
    "本车已取消。"
  );
}

async function runManageAction(action, successMessage) {
  if (busy.value) {
    return;
  }
  busy.value = true;
  errorText.value = "";
  try {
    await action();
    statusText.value = successMessage;
    await loadManage();
  } catch (error) {
    errorText.value = error.message;
  } finally {
    busy.value = false;
  }
}

async function hideOrganized(session) {
  if (!window.confirm("只从我的列表下架，不会取消车。确认下架？")) {
    return;
  }
  await hideMyOrganizedSession(session.id);
  await loadMine();
}

async function hideSignup(signup) {
  if (!window.confirm("只从你的参与列表下架，不影响车局。确认下架？")) {
    return;
  }
  await hideMySignup(signup.id);
  await loadMine();
}

function canClaimSeat(seat) {
  if (detailSession.value.status === "recruiting") {
    return ["open", "applied"].includes(seat.status);
  }
  return detailSession.value.status === "locked" && seat.status === "open" && isSessionStarted();
}

function isSessionStarted() {
  const startAtValue = Date.parse(String(detailSession.value.start_at || "").replace(" ", "T"));
  return Number.isFinite(startAtValue) && startAtValue <= Date.now();
}

function canTransferToSeat(seat) {
  return (
    seat.confirmed_user_id &&
    Number(seat.confirmed_user_id) !== Number(detailSession.value.organizer_user_id)
  );
}

function seatName(seatId) {
  return (detailSession.value.seats || []).find((seat) => Number(seat.id) === Number(seatId))?.name || `座位 ${seatId}`;
}

function storeMeta(store) {
  return [store.district || store.city, store.area || store.business_area, store.distance]
    .filter(Boolean)
    .join(" · ");
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

function sessionStatusLabel(value) {
  return {
    draft: "草稿",
    recruiting: "招募中",
    locked: "已锁车",
    cancelled: "已取消"
  }[value] || value || "-";
}

function seatStatusLabel(value) {
  return {
    open: "开放",
    applied: "待审核",
    confirmed: "已上车",
    locked: "已锁定",
    cancelled: "已取消"
  }[value] || value || "-";
}

function signupStatusLabel(value) {
  return {
    pending: "待审核",
    approved: "已通过",
    rejected: "已拒绝",
    cancelled: "已取消"
  }[value] || value || "-";
}

function seatTypeLabel(value) {
  return {
    love_companion: "情感沉浸位",
    f4: "互动位",
    cp: "CP位",
    normal: "普通位"
  }[value] || "普通位";
}

function starText(rating) {
  const value = Math.max(0, Math.min(5, Number(rating || 0)));
  return "★★★★★".slice(0, value) + "☆☆☆☆☆".slice(0, 5 - value);
}

function assetUrl(path) {
  return String(path || "");
}

async function copySessionLink() {
  const url = `${window.location.origin}/?sessionId=${encodeURIComponent(activeSessionId.value)}`;
  await navigator.clipboard?.writeText(url);
  statusText.value = "详情链接已复制。";
}

onMounted(() => {
  const auth = getStoredAuth();
  if (!auth.roles?.includes("system_admin")) {
    errorText.value = "当前入口仅管理员可用。";
  }
  const sessionId = new URLSearchParams(window.location.search).get("sessionId");
  if (sessionId) {
    openDetail(sessionId);
  }
});
</script>
