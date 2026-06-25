<template>
  <view class="page mine-calendar-page">
    <AuthIdentityBar />

    <view v-if="!hasLogin" class="section login-section">
      <view class="title">我的</view>
      <view class="text">{{ statusText }}</view>
      <view class="actions">
        <button class="button" @tap="login">微信登录</button>
      </view>
    </view>

    <view v-else class="calendar-shell">
      <view class="calendar-hero">
        <image class="hero-art" src="/static/art/bamboo-corner.png" mode="aspectFit" />
        <view class="hero-main">
          <view>
            <view class="title">我的拼车日程</view>
            <view class="hero-subtitle">{{ totalCount }} 场车局 · {{ calendarUpdatedText }}</view>
            <view v-if="rolesText" class="hero-role">角色：{{ rolesText }}</view>
          </view>
          <view class="summary-grid">
            <view class="summary-card">
              <view class="summary-label">我发起</view>
              <view class="summary-value">{{ organizedCount }}</view>
            </view>
            <view class="summary-card">
              <view class="summary-label">我参与</view>
              <view class="summary-value blue">{{ joinedCount }}</view>
            </view>
          </view>
        </view>
        <view class="hero-actions">
          <button v-if="isAdmin" class="quiet-button" @tap="goAdmin">管理员</button>
          <button class="quiet-button" @tap="logout">退出</button>
        </view>
      </view>

      <view class="calendar-controls">
        <view class="filter-tabs">
          <button
            v-for="filter in filterTabs"
            :key="filter.value"
            class="filter-tab"
            :class="{ active: activeFilter === filter.value }"
            @tap="setFilter(filter.value)"
          >
            <text>{{ filter.label }}</text>
            <text class="filter-count">{{ filter.count }}</text>
          </button>
        </view>
        <view class="calendar-tools">
          <button class="today-reset-button" @tap="scrollToToday">归位</button>
          <picker mode="date" :value="selectedDatePickerValue" @change="selectCalendarDate">
            <view class="date-picker-button">{{ selectedDateText }}</view>
          </picker>
        </view>
      </view>

      <view v-if="calendarStatusText" class="notice calendar-notice">{{ calendarStatusText }}</view>

      <scroll-view
        class="calendar-scroll"
        scroll-y
        :scroll-into-view="scrollIntoViewId"
        :scroll-with-animation="true"
        :show-scrollbar="false"
        :refresher-enabled="true"
        :refresher-triggered="isRefreshingCalendar"
        upper-threshold="80"
        lower-threshold="80"
        @refresherrefresh="refreshCalendar"
        @scrolltolower="loadMoreDates"
      >
        <view class="load-hint top">下拉刷新最新车局</view>

        <view v-if="filteredCalendarItems.length === 0 && !isCalendarLoading" class="calendar-empty">
          <view class="calendar-empty-title">暂无符合条件的车局</view>
          <view class="calendar-empty-text">发起和参与的拼车会按日期汇总在这里。</view>
        </view>

        <view class="day-list">
          <view
            v-for="band in visibleDayBands"
            :key="band.key"
            :id="band.elementId"
            class="day-band"
            :class="{
              today: band.isToday,
              collapsed: band.kind === 'day' && isDayCollapsed(band.dateKey),
              gap: band.kind === 'gap'
            }"
          >
            <view class="timeline-rail"></view>
            <view class="day-marker">{{ band.markerText }}</view>

            <view v-if="band.kind === 'gap'" class="day-gap">
              <view class="gap-dots">...</view>
              <view class="gap-label">{{ band.gapLabel }}</view>
            </view>

            <view v-else class="day-card">
              <view class="day-head" @tap="toggleDayBand(band.dateKey)">
                <view class="day-title-row">
                  <text v-if="band.relativeLabel" class="day-title">{{ band.relativeLabel }}</text>
                  <text class="day-date">{{ band.dateLabel }}</text>
                  <text class="day-weekday">{{ band.weekday }}</text>
                </view>
                <view class="day-head-right">
                  <text class="day-count">{{ band.items.length }}</text>
                  <image
                    class="day-chevron"
                    :class="{ collapsed: isDayCollapsed(band.dateKey) }"
                    src="/static/icons/chevron.png"
                    mode="aspectFit"
                  />
                </view>
              </view>

              <view v-if="!isDayCollapsed(band.dateKey)" class="day-content">
                <view v-if="band.items.length === 0" class="empty-day-row">暂无车局</view>

                <view
                  v-for="item in band.items"
                  :key="item.key"
                  class="session-row"
                  :class="item.type"
                  @tap="goDetail(item.sessionId)"
                >
                  <view class="session-stripe"></view>

                  <view class="session-main">
                    <view class="session-title-line">
                      <text class="session-title">{{ item.title }}</text>
                      <text class="type-badge" :class="item.type">{{ item.typeLabel }}</text>
                    </view>
                    <view class="session-store-line">
                      <image class="row-icon" src="/static/icons/pin.png" mode="aspectFit" />
                      <text class="session-store">{{ item.storeName }}</text>
                    </view>
                    <view class="session-meta">{{ item.metaText }}</view>
                  </view>

                  <view class="session-side">
                    <view class="session-time">{{ item.timeText }}</view>
                    <view class="session-pills">
                      <text class="role-pill">{{ item.roleText }}</text>
                      <text class="status-pill" :class="item.statusTone">{{ item.statusText }}</text>
                    </view>
                  </view>

                  <view class="session-actions">
                    <button
                      v-if="item.actionLabel !== '详情'"
                      class="session-action"
                      @tap.stop="handleCalendarAction(item)"
                    >
                      <text>{{ item.actionLabel }}</text>
                      <image class="action-chevron" src="/static/icons/chevron.png" mode="aspectFit" />
                    </button>
                    <button class="session-delete" @tap.stop="hideCalendarItem(item)">删除</button>
                  </view>
                </view>
              </view>
            </view>
          </view>
        </view>

        <view
          class="load-more"
          :class="{ disabled: !hasOlderCalendarItems }"
          @tap="loadMoreDates"
        >
          <image class="load-more-art" src="/static/art/ink-home-landscape.jpg" mode="aspectFill" />
          <text>{{ calendarMoreHintText }}</text>
        </view>
      </scroll-view>
    </view>
  </view>
</template>

<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref } from "vue";
import AuthIdentityBar from "../../components/AuthIdentityBar.vue";
import {
  AUTH_CHANGE_EVENT,
  clearAuth,
  dataOf,
  ensureLoggedIn,
  getCurrentUser,
  getToken,
  request
} from "../../utils/api";

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
const CALENDAR_PAGE_SIZE = 6;

const statusText = ref("未登录");
const roles = ref([]);
const hasLogin = ref(false);
const sessions = ref([]);
const sessionStatusText = ref("");
const signups = ref([]);
const signupStatusText = ref("");
const loadingSessions = ref(false);
const loadingSignups = ref(false);
const isRefreshingCalendar = ref(false);
const activeFilter = ref("all");
const loadedCalendarCount = ref(CALENDAR_PAGE_SIZE);
const collapsedDayKeys = ref([]);
const lastLoadedAt = ref(null);
const scrollIntoViewId = ref("");
const selectedDateKey = ref("");
let authExpiredToastActive = false;

const isAdmin = computed(() => roles.value.includes("system_admin"));
const rolesText = computed(() => roles.value.join(", "));
const organizedCount = computed(() => sessions.value.length);
const joinedCount = computed(() => signups.value.length);
const totalCount = computed(() => calendarItems.value.length);
const pendingCount = computed(
  () => calendarItems.value.filter((item) => item.isPending).length
);
const isCalendarLoading = computed(() => loadingSessions.value || loadingSignups.value);
const calendarUpdatedText = computed(() => {
  if (isCalendarLoading.value) {
    return "正在整理";
  }
  if (lastLoadedAt.value) {
    return "最近更新刚刚";
  }
  return "等待同步";
});
const calendarStatusText = computed(() => {
  if (isCalendarLoading.value) {
    return "正在整理你的拼车日程...";
  }
  return [sessionStatusText.value, signupStatusText.value].filter(Boolean).join(" ");
});
const filterTabs = computed(() => [
  { value: "all", label: "全部", count: totalCount.value },
  { value: "organized", label: "发起", count: organizedCount.value },
  { value: "joined", label: "参与", count: joinedCount.value },
  { value: "pending", label: "待处理", count: pendingCount.value }
]);
const calendarItems = computed(() => {
  const organizedItems = sessions.value.map((session) => normalizeOrganizedSession(session));
  const joinedItems = signups.value.map((signup) => normalizeJoinedSignup(signup));
  return [...organizedItems, ...joinedItems]
    .filter((item) => item.dateKey)
    .sort((left, right) => {
      if (left.sortValue !== right.sortValue) {
        return right.sortValue - left.sortValue;
      }
      return left.type === right.type ? 0 : left.type === "organized" ? -1 : 1;
    });
});
const filteredCalendarItems = computed(() => {
  if (activeFilter.value === "organized") {
    return calendarItems.value.filter((item) => item.type === "organized");
  }
  if (activeFilter.value === "joined") {
    return calendarItems.value.filter((item) => item.type === "joined");
  }
  if (activeFilter.value === "pending") {
    return calendarItems.value.filter((item) => item.isPending);
  }
  return calendarItems.value;
});
const visibleCalendarItems = computed(() =>
  filteredCalendarItems.value.slice(0, loadedCalendarCount.value)
);
const hasOlderCalendarItems = computed(
  () => loadedCalendarCount.value < filteredCalendarItems.value.length
);
const visibleDayBands = computed(() => {
  const itemsByDay = groupItemsByDay(visibleCalendarItems.value);
  const orderedDateKeys = visibleCalendarItems.value.reduce((keys, item) => {
    if (!keys.includes(item.dateKey)) {
      keys.push(item.dateKey);
    }
    return keys;
  }, []);
  const bands = [];
  orderedDateKeys.forEach((key, index) => {
    const date = dateFromKey(key);
    const previousDate = index > 0 ? dateFromKey(orderedDateKeys[index - 1]) : null;
    if (previousDate) {
      const gap = createDateGapBand(previousDate, date);
      if (gap) {
        bands.push(gap);
      }
    }
    bands.push(createDayBand(date, itemsByDay[key] || []));
  });
  return bands;
});
const todayScrollTargetId = computed(() => {
  const todayKey = dateKey(todayStart());
  const targetBand = visibleDayBands.value.find((band) => {
    if (band.kind === "gap") {
      return band.startDateKey <= todayKey && todayKey <= band.endDateKey;
    }
    return band.dateKey === todayKey;
  });
  return targetBand ? targetBand.elementId : "";
});

const calendarMoreHintText = computed(() => {
  if (hasOlderCalendarItems.value) {
    return "继续上滑加载更多车局";
  }
  return "已显示全部车局";
});
const selectedDatePickerValue = computed(() => selectedDateKey.value || dateKey(todayStart()));
const selectedDateText = computed(() =>
  selectedDateKey.value ? compactDateText(selectedDateKey.value) : "日期"
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
  resetCalendarWindow();
  loadCalendar();
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
  sessions.value = [];
  sessionStatusText.value = "";
  signups.value = [];
  signupStatusText.value = "";
  activeFilter.value = "all";
  lastLoadedAt.value = null;
  resetCalendarWindow();
}

function handleAuthExpired(error) {
  if (error?.statusCode !== 401) {
    return false;
  }
  clearAuth();
  resetLoggedOutState();
  if (!authExpiredToastActive) {
    authExpiredToastActive = true;
    uni.showToast({
      title: error?.userMessage || "登录已过期，请重新登录。",
      icon: "none"
    });
    setTimeout(() => {
      authExpiredToastActive = false;
    }, 1000);
  }
  return true;
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
    if (handleAuthExpired(error)) {
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
    if (handleAuthExpired(error)) {
      return;
    }
    signupStatusText.value = "我参与的车加载失败，请稍后重试。";
  } finally {
    loadingSignups.value = false;
  }
}

function setFilter(value) {
  activeFilter.value = value;
  loadedCalendarCount.value = CALENDAR_PAGE_SIZE;
  collapsedDayKeys.value = [];
  selectedDateKey.value = "";
  scrollIntoViewId.value = "";
}

function resetCalendarWindow() {
  loadedCalendarCount.value = CALENDAR_PAGE_SIZE;
  collapsedDayKeys.value = [];
  selectedDateKey.value = "";
  scrollIntoViewId.value = "";
}

function loadMoreDates() {
  if (!hasOlderCalendarItems.value) {
    return;
  }
  loadedCalendarCount.value = Math.min(
    filteredCalendarItems.value.length,
    loadedCalendarCount.value + CALENDAR_PAGE_SIZE
  );
}

function scrollToToday() {
  const todayKey = dateKey(todayStart());
  const todayIndex = filteredCalendarItems.value.findIndex((item) => item.dateKey === todayKey);
  selectedDateKey.value = "";
  if (todayIndex >= 0) {
    loadedCalendarCount.value = Math.max(CALENDAR_PAGE_SIZE, todayIndex + 1);
  } else {
    loadedCalendarCount.value = CALENDAR_PAGE_SIZE;
  }
  scrollIntoViewId.value = "";
  nextTick(() => {
    scrollIntoViewId.value = todayScrollTargetId.value || visibleDayBands.value[0]?.elementId || "";
  });
}

function selectCalendarDate(event) {
  const value = event?.detail?.value || "";
  if (!value) {
    return;
  }
  selectedDateKey.value = value;
  jumpToDate(value);
}

function jumpToDate(key) {
  const targetIndex = dateTargetIndex(key);
  if (targetIndex === -1) {
    loadedCalendarCount.value = CALENDAR_PAGE_SIZE;
    scrollToFirstVisibleBand();
    return;
  }
  loadedCalendarCount.value = Math.max(
    CALENDAR_PAGE_SIZE,
    Math.min(filteredCalendarItems.value.length, targetIndex + CALENDAR_PAGE_SIZE)
  );
  collapsedDayKeys.value = [];
  scrollIntoViewId.value = "";
  nextTick(() => {
    scrollIntoViewId.value = targetElementIdForDate(key) || visibleDayBands.value[0]?.elementId || "";
  });
}

function scrollToFirstVisibleBand() {
  scrollIntoViewId.value = "";
  nextTick(() => {
    scrollIntoViewId.value = visibleDayBands.value[0]?.elementId || "";
  });
}

function toggleDayBand(key) {
  if (collapsedDayKeys.value.includes(key)) {
    collapsedDayKeys.value = collapsedDayKeys.value.filter((item) => item !== key);
    return;
  }
  collapsedDayKeys.value = [...collapsedDayKeys.value, key];
}

function isDayCollapsed(key) {
  return collapsedDayKeys.value.includes(key);
}

function handleCalendarAction(item) {
  if (item.type === "organized") {
    goManage(item.sessionId);
    return;
  }
  if (item.canReview) {
    goReview(item.sessionId);
    return;
  }
  goDetail(item.sessionId);
}

function hideCalendarItem(item) {
  if (item.type === "organized") {
    hideOrganizedSession(item.raw);
    return;
  }
  hideJoinedSession(item.raw);
}

function goManage(id) {
  uni.navigateTo({ url: `/pages/session/manage?id=${id}` });
}

function goDetail(id) {
  uni.navigateTo({ url: `/pages/session/detail?id=${id}` });
}

function goReview(id) {
  uni.navigateTo({ url: `/pages/session/review?id=${id}` });
}

function confirmPersonalDownlist(content, onConfirm) {
  uni.showModal({
    title: "删除记录",
    content,
    confirmText: "删除",
    cancelText: "再想想",
    success: (result) => {
      if (result.confirm) {
        onConfirm();
      }
    }
  });
}

function hideOrganizedSession(session) {
  confirmPersonalDownlist(
    "只会从你的列表下架，不会取消车，也不会影响其他车友。之后可以通过车友分享链接重新链接。",
    async () => {
      sessionStatusText.value = "正在从我的发起下架...";
      try {
        await request({
          url: `/api/sessions/${session.id}/hide`,
          method: "PATCH"
        });
        await loadCalendar();
        uni.showToast({ title: "已从列表下架", icon: "none" });
      } catch (error) {
        if (handleAuthExpired(error)) {
          return;
        }
        sessionStatusText.value = "删除失败，请稍后重试。";
      }
    }
  );
}

function hideJoinedSession(signup) {
  confirmPersonalDownlist(
    "只会从你的列表下架，不会影响这台车或其他车友。之后可以通过车友分享链接重新链接。",
    async () => {
      signupStatusText.value = "正在从我参与下架...";
      try {
        await request({
          url: `/api/signups/${signup.id}/hide`,
          method: "PATCH"
        });
        await loadCalendar();
        uni.showToast({ title: "已从列表下架", icon: "none" });
      } catch (error) {
        if (handleAuthExpired(error)) {
          return;
        }
        signupStatusText.value = "删除失败，请稍后重试。";
      }
    }
  );
}

function normalizeOrganizedSession(session) {
  const startDate = parseStartAt(session.start_at);
  const pendingSignupCount = Number(session.pending_signup_count || 0);
  return {
    key: `organized-${session.id}`,
    type: "organized",
    typeLabel: "发起",
    sessionId: session.id,
    raw: session,
    title: session.script_name_snapshot || "未命名车局",
    storeName: session.store_name_snapshot || "店家待定",
    dateKey: startDate ? dateKey(startDate) : "",
    sortValue: startDate ? startDate.getTime() : 0,
    timeText: startDate ? timeText(startDate) : "时间待定",
    roleText: "车头",
    metaText: `${Number(session.seat_count || 0)}位 · ${pendingSignupCount}个待审`,
    statusText: statusLabel(session.status),
    statusTone: sessionStatusTone(session.status),
    actionLabel: "管理",
    isPending: pendingSignupCount > 0 || session.status === "draft",
    canReview: false
  };
}

function normalizeJoinedSignup(signup) {
  const startDate = parseStartAt(signup.start_at);
  return {
    key: `joined-${signup.id}`,
    type: "joined",
    typeLabel: "参与",
    sessionId: signup.session_id,
    raw: signup,
    title: signup.script_name_snapshot || "未命名车局",
    storeName: signup.store_name_snapshot || "店家待定",
    dateKey: startDate ? dateKey(startDate) : "",
    sortValue: startDate ? startDate.getTime() : 0,
    timeText: startDate ? timeText(startDate) : "时间待定",
    roleText: signupRoleText(signup),
    metaText: signup.seat_role_name ? `角色：${signup.seat_role_name}` : "角色待定",
    statusText: signupStatusLabel(signup.status),
    statusTone: signupStatusTone(signup.status),
    actionLabel: signup.can_review ? signup.has_review ? "编辑记录" : "写记录" : "详情",
    isPending: signup.status === "pending",
    canReview: Boolean(signup.can_review)
  };
}

function groupItemsByDay(items) {
  return items.reduce((groups, item) => {
    if (!groups[item.dateKey]) {
      groups[item.dateKey] = [];
    }
    groups[item.dateKey].push(item);
    return groups;
  }, {});
}

function createDayBand(date, items) {
  const offset = dayOffset(date);
  const key = dateKey(date);
  return {
    kind: "day",
    key,
    elementId: dayBandElementId(key),
    dateKey: key,
    relativeLabel: relativeDayLabel(offset),
    markerText: markerText(offset),
    dateLabel: `${date.getMonth() + 1}/${date.getDate()}`,
    weekday: WEEKDAYS[date.getDay()],
    isToday: offset === 0,
    items
  };
}

function createDateGapBand(firstVisibleDate, nextVisibleDate) {
  const gapDays = Math.abs(dayOffset(nextVisibleDate, firstVisibleDate)) - 1;
  if (gapDays <= 0) {
    return null;
  }

  const firstGapDate =
    firstVisibleDate.getTime() > nextVisibleDate.getTime()
      ? addDays(firstVisibleDate, -1)
      : addDays(firstVisibleDate, 1);
  const lastGapDate =
    firstVisibleDate.getTime() > nextVisibleDate.getTime()
      ? addDays(nextVisibleDate, 1)
      : addDays(nextVisibleDate, -1);
  const first = createDayBand(firstGapDate, []);
  const last = createDayBand(lastGapDate, []);
  const key = `gap-${first.dateKey}-${last.dateKey}`;
  const firstTime = firstGapDate.getTime();
  const lastTime = lastGapDate.getTime();
  const todayTime = todayStart().getTime();
  const containsToday =
    Math.min(firstTime, lastTime) <= todayTime && todayTime <= Math.max(firstTime, lastTime);
  return {
    kind: "gap",
    key,
    elementId: dayBandElementId(key),
    startDateKey: dateKey(firstTime < lastTime ? firstGapDate : lastGapDate),
    endDateKey: dateKey(firstTime < lastTime ? lastGapDate : firstGapDate),
    markerText: containsToday ? "今" : "...",
    isToday: containsToday,
    gapLabel: gapLabel(first, last, gapDays)
  };
}

function gapLabel(first, last, count) {
  if (count === 1) {
    return `${dayBandName(first)} 暂无车局`;
  }
  return `${dayBandName(first)} - ${dayBandName(last)} 暂无车局`;
}

function dayBandName(band) {
  return [band.relativeLabel, band.dateLabel, band.weekday].filter(Boolean).join(" ");
}

function dayBandElementId(key) {
  return `calendar-band-${key}`;
}

function dateTargetIndex(key) {
  if (filteredCalendarItems.value.length === 0) {
    return -1;
  }
  const exactIndex = filteredCalendarItems.value.findIndex((item) => item.dateKey === key);
  if (exactIndex >= 0) {
    return exactIndex;
  }
  const nearestOlderIndex = filteredCalendarItems.value.findIndex((item) => item.dateKey <= key);
  if (nearestOlderIndex >= 0) {
    return nearestOlderIndex;
  }
  return filteredCalendarItems.value.length - 1;
}

function targetElementIdForDate(key) {
  const exactBand = visibleDayBands.value.find((band) => {
    if (band.kind === "gap") {
      return band.startDateKey <= key && key <= band.endDateKey;
    }
    return band.dateKey === key;
  });
  if (exactBand) {
    return exactBand.elementId;
  }

  const dayBands = visibleDayBands.value.filter((band) => band.kind === "day");
  const nearestOlderBand = dayBands.find((band) => band.dateKey <= key);
  return nearestOlderBand?.elementId || dayBands[dayBands.length - 1]?.elementId || "";
}

function parseStartAt(value) {
  if (!value) {
    return null;
  }
  if (value instanceof Date) {
    return value;
  }
  const raw = String(value);
  const localMatch = raw.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/
  );
  if (localMatch) {
    return new Date(
      Number(localMatch[1]),
      Number(localMatch[2]) - 1,
      Number(localMatch[3]),
      Number(localMatch[4] || 0),
      Number(localMatch[5] || 0),
      Number(localMatch[6] || 0)
    );
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function todayStart() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
}

function startOfDay(date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function addDays(date, amount) {
  return new Date(date.getTime() + amount * DAY_MS);
}

function dateKey(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function dateFromKey(key) {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function compactDateText(key) {
  const date = dateFromKey(key);
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function dayOffset(date, baseDate = todayStart()) {
  return Math.round((startOfDay(date).getTime() - startOfDay(baseDate).getTime()) / DAY_MS);
}

function timeText(date) {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function relativeDayLabel(offset) {
  if (offset === 0) {
    return "今天";
  }
  if (offset === 1) {
    return "明天";
  }
  if (offset === -1) {
    return "昨天";
  }
  return "";
}

function markerText(offset) {
  if (offset === 0) {
    return "今";
  }
  if (offset === 1) {
    return "明";
  }
  return "";
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function signupRoleText(signup) {
  const seatName = signup.seat_name || "玩家";
  return signup.seat_role_name ? `${seatName} ${signup.seat_role_name}` : seatName;
}

function sessionStatusTone(status) {
  const tones = {
    draft: "muted",
    recruiting: "amber",
    locked: "green",
    cancelled: "gray"
  };
  return tones[status] || "muted";
}

function signupStatusTone(status) {
  const tones = {
    pending: "amber",
    approved: "green",
    rejected: "red",
    cancelled: "gray"
  };
  return tones[status] || "muted";
}

function statusLabel(status) {
  const labels = {
    draft: "草稿",
    recruiting: "招募中",
    locked: "已锁车",
    cancelled: "已取消"
  };
  return labels[status] || status || "未知";
}

function signupStatusLabel(status) {
  const labels = {
    pending: "待审核",
    approved: "已上车",
    rejected: "已拒绝",
    cancelled: "已取消"
  };
  return labels[status] || status || "未知";
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

.calendar-shell {
  display: flex;
  flex-direction: column;
  gap: 22rpx;
}

.calendar-hero {
  position: relative;
  overflow: hidden;
  padding: 34rpx 28rpx 26rpx;
  border: 1rpx solid rgba(222, 215, 202, 0.94);
  border-radius: 18rpx;
  background: rgba(255, 255, 252, 0.96);
  box-shadow: 0 18rpx 48rpx rgba(51, 69, 59, 0.06);
}

.hero-art {
  position: absolute;
  right: -24rpx;
  bottom: -28rpx;
  width: 178rpx;
  height: 178rpx;
  opacity: 0.2;
  transform: rotate(10deg);
}

.hero-main {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 24rpx;
}

.hero-subtitle {
  margin-top: 16rpx;
  color: #667985;
  font-size: 25rpx;
  line-height: 1.45;
}

.hero-role {
  margin-top: 10rpx;
  color: #7b6d58;
  font-size: 23rpx;
  line-height: 1.4;
}

.summary-grid {
  display: grid;
  grid-template-columns: repeat(2, 96rpx);
  gap: 14rpx;
  flex-shrink: 0;
}

.summary-card {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  height: 118rpx;
  border: 1rpx solid rgba(221, 202, 171, 0.92);
  border-radius: 16rpx;
  background: rgba(255, 253, 248, 0.82);
}

.summary-label {
  color: #756653;
  font-size: 23rpx;
  line-height: 1.1;
}

.summary-value {
  margin-top: 10rpx;
  color: #1f7a68;
  font-family: "PincheBrand", "Songti SC", "STSong", "PingFang SC", sans-serif;
  font-size: 46rpx;
  font-weight: 600;
  line-height: 1;
}

.summary-value.blue {
  color: #436e91;
}

.hero-actions {
  position: relative;
  z-index: 1;
  display: flex;
  gap: 14rpx;
  margin-top: 24rpx;
}

.quiet-button {
  flex: 0 0 136rpx;
  height: 56rpx;
  margin: 0;
  padding: 0 18rpx;
  border: 1rpx solid rgba(210, 199, 181, 0.96);
  border-radius: 10rpx;
  background: rgba(255, 255, 255, 0.72);
  color: #415766;
  font-size: 24rpx;
  line-height: 56rpx;
}

.calendar-controls {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 220rpx;
  gap: 14rpx;
  align-items: center;
}

.filter-tabs {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 14rpx;
}

.filter-tab {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8rpx;
  height: 62rpx;
  margin: 0;
  padding: 0 8rpx;
  border: 1rpx solid rgba(199, 179, 144, 0.86);
  border-radius: 999rpx;
  background: rgba(255, 255, 252, 0.82);
  color: #6d604f;
  font-size: 24rpx;
  line-height: 1;
}

.filter-tab.active {
  border-color: #24745f;
  background: #24745f;
  color: #ffffff;
  font-weight: 600;
  box-shadow: 0 14rpx 28rpx rgba(36, 116, 95, 0.18);
}

.filter-count {
  min-width: 26rpx;
  color: inherit;
  font-size: 22rpx;
  opacity: 0.78;
}

.calendar-tools {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10rpx;
}

.today-reset-button,
.date-picker-button {
  height: 62rpx;
  margin: 0;
  padding: 0;
  border: 1rpx solid rgba(36, 116, 95, 0.36);
  border-radius: 999rpx;
  background: rgba(255, 255, 252, 0.9);
  color: #24745f;
  font-size: 24rpx;
  font-weight: 600;
  line-height: 62rpx;
  text-align: center;
  box-sizing: border-box;
  box-shadow: 0 10rpx 24rpx rgba(36, 116, 95, 0.1);
}

.today-reset-button:active,
.date-picker-button:active {
  background: rgba(238, 247, 244, 0.96);
}

.calendar-notice {
  margin-top: 0;
}

.calendar-scroll {
  height: calc(100vh - 466rpx);
  min-height: 560rpx;
}

.load-hint,
.load-more {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 74rpx;
  color: #5f7792;
  font-size: 25rpx;
  line-height: 1.4;
}

.load-hint.top {
  border-top: 1rpx solid rgba(220, 210, 194, 0.72);
}

.load-hint.disabled,
.load-more.disabled {
  color: #9aa8b3;
  opacity: 0.72;
}

.calendar-empty {
  margin: 12rpx 0 22rpx 64rpx;
  padding: 30rpx 28rpx;
  border: 1rpx solid rgba(226, 217, 204, 0.9);
  border-radius: 16rpx;
  background: rgba(255, 255, 252, 0.84);
  text-align: center;
}

.calendar-empty-title {
  color: #23483e;
  font-size: 28rpx;
  font-weight: 700;
}

.calendar-empty-text {
  margin-top: 10rpx;
  color: #708090;
  font-size: 24rpx;
  line-height: 1.55;
}

.day-list {
  padding-bottom: 22rpx;
}

.day-band {
  position: relative;
  padding: 0 0 22rpx 64rpx;
}

.timeline-rail {
  position: absolute;
  top: 0;
  bottom: -22rpx;
  left: 30rpx;
  width: 2rpx;
  background: rgba(213, 200, 176, 0.74);
}

.day-marker {
  position: absolute;
  top: 12rpx;
  left: 4rpx;
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 52rpx;
  height: 52rpx;
  border: 4rpx solid rgba(250, 248, 241, 0.96);
  border-radius: 50%;
  background: #c3ad7e;
  color: #ffffff;
  font-family: "PincheBrand", "Songti SC", "STSong", "PingFang SC", sans-serif;
  font-size: 24rpx;
  font-weight: 600;
  line-height: 1;
  box-shadow: 0 10rpx 20rpx rgba(54, 65, 57, 0.08);
}

.day-band:not(.today) .day-marker {
  width: 18rpx;
  height: 18rpx;
  top: 30rpx;
  left: 22rpx;
  border: 0;
  color: transparent;
  box-shadow: none;
}

.day-band.today .day-marker {
  background: #26745f;
}

.day-band.gap {
  padding-bottom: 12rpx;
}

.day-band.gap .timeline-rail {
  bottom: -12rpx;
}

.day-band.gap .day-marker {
  width: 28rpx;
  height: 28rpx;
  top: 20rpx;
  left: 16rpx;
  border: 0;
  background: transparent;
  color: #c4ad7a;
  font-family: "PingFang SC", sans-serif;
  font-size: 24rpx;
  font-weight: 700;
  box-shadow: none;
}

.day-band.gap.today .day-marker {
  width: 52rpx;
  height: 52rpx;
  top: 4rpx;
  left: 4rpx;
  border: 4rpx solid rgba(250, 248, 241, 0.96);
  background: #26745f;
  color: #ffffff;
  font-family: "PincheBrand", "Songti SC", "STSong", "PingFang SC", sans-serif;
  font-weight: 600;
  box-shadow: 0 10rpx 20rpx rgba(54, 65, 57, 0.08);
}

.day-gap {
  display: flex;
  align-items: center;
  gap: 18rpx;
  min-height: 60rpx;
  padding: 0 22rpx;
  border: 1rpx dashed rgba(213, 200, 176, 0.72);
  border-radius: 14rpx;
  background: rgba(255, 253, 248, 0.56);
}

.gap-dots {
  color: #b99f68;
  font-family: "PincheBrand", "Songti SC", "STSong", "PingFang SC", sans-serif;
  font-size: 34rpx;
  font-weight: 700;
  line-height: 1;
}

.gap-label {
  color: #8a98a6;
  font-size: 23rpx;
  line-height: 1.35;
}

.day-card {
  overflow: hidden;
  border: 1rpx solid rgba(222, 215, 202, 0.92);
  border-radius: 16rpx;
  background: rgba(255, 255, 252, 0.96);
}

.day-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 70rpx;
  padding: 0 20rpx 0 24rpx;
  background: linear-gradient(180deg, rgba(255, 253, 248, 0.95), rgba(250, 247, 239, 0.72));
}

.day-title-row {
  display: flex;
  align-items: baseline;
  gap: 14rpx;
  min-width: 0;
}

.day-title {
  color: #203f38;
  font-size: 31rpx;
  font-weight: 700;
}

.day-date {
  color: #273a33;
  font-size: 29rpx;
  font-weight: 500;
}

.day-weekday {
  color: #51636c;
  font-size: 25rpx;
}

.day-head-right {
  display: flex;
  align-items: center;
  gap: 12rpx;
  flex-shrink: 0;
}

.day-count {
  min-width: 42rpx;
  height: 42rpx;
  border: 1rpx solid rgba(216, 202, 180, 0.94);
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.82);
  color: #5b6a72;
  font-size: 22rpx;
  font-weight: 600;
  line-height: 42rpx;
  text-align: center;
}

.day-chevron {
  width: 22rpx;
  height: 22rpx;
  opacity: 0.54;
  transform: rotate(90deg);
  transition: transform 0.18s ease;
}

.day-chevron.collapsed {
  transform: rotate(0deg);
}

.day-content {
  background: rgba(255, 255, 252, 0.92);
}

.empty-day-row {
  min-height: 90rpx;
  color: #8a98a6;
  font-size: 25rpx;
  line-height: 90rpx;
  text-align: center;
}

.session-row {
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 168rpx 112rpx;
  gap: 14rpx;
  min-height: 132rpx;
  padding: 22rpx 16rpx 22rpx 28rpx;
  border-top: 1rpx solid rgba(232, 226, 215, 0.86);
  box-sizing: border-box;
}

.session-row:active {
  background: rgba(238, 247, 244, 0.72);
}

.session-stripe {
  position: absolute;
  top: 24rpx;
  bottom: 24rpx;
  left: 12rpx;
  width: 7rpx;
  border-radius: 999rpx;
  background: #24745f;
}

.session-row.joined .session-stripe {
  background: #4c789d;
}

.session-main {
  min-width: 0;
}

.session-title-line {
  display: flex;
  align-items: center;
  gap: 10rpx;
  min-width: 0;
}

.session-title {
  overflow: hidden;
  color: #164339;
  font-size: 30rpx;
  font-weight: 700;
  line-height: 1.24;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.type-badge {
  flex-shrink: 0;
  padding: 4rpx 10rpx;
  border-radius: 999rpx;
  background: rgba(36, 116, 95, 0.11);
  color: #24745f;
  font-size: 20rpx;
  font-weight: 600;
  line-height: 1.1;
}

.type-badge.joined {
  background: rgba(76, 120, 157, 0.13);
  color: #3f6f99;
}

.session-store-line {
  display: flex;
  align-items: center;
  gap: 8rpx;
  margin-top: 12rpx;
  min-width: 0;
}

.row-icon {
  flex: 0 0 24rpx;
  width: 24rpx;
  height: 24rpx;
  opacity: 0.46;
}

.session-store {
  overflow: hidden;
  color: #7b8288;
  font-size: 24rpx;
  line-height: 1.25;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.session-meta {
  overflow: hidden;
  margin-top: 9rpx;
  color: #7f715f;
  font-size: 22rpx;
  line-height: 1.3;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.session-side {
  min-width: 0;
}

.session-time {
  color: #283a32;
  font-size: 27rpx;
  font-weight: 500;
  line-height: 1.24;
}

.session-pills {
  display: flex;
  flex-wrap: wrap;
  gap: 9rpx;
  margin-top: 16rpx;
}

.role-pill,
.status-pill {
  display: inline-flex;
  max-width: 156rpx;
  min-height: 40rpx;
  align-items: center;
  justify-content: center;
  padding: 0 12rpx;
  border: 1rpx solid rgba(220, 207, 187, 0.9);
  border-radius: 10rpx;
  background: rgba(255, 253, 249, 0.86);
  color: #6f604e;
  font-size: 22rpx;
  line-height: 40rpx;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.status-pill.amber {
  border-color: rgba(234, 176, 74, 0.48);
  background: #fff7e7;
  color: #a45f00;
}

.status-pill.green {
  border-color: rgba(38, 116, 95, 0.24);
  background: #edf8f3;
  color: #24745f;
}

.status-pill.red {
  border-color: rgba(194, 91, 74, 0.24);
  background: #fff1ef;
  color: #a5483b;
}

.status-pill.gray,
.status-pill.muted {
  border-color: rgba(190, 200, 207, 0.56);
  background: #f3f6f8;
  color: #60707b;
}

.session-actions {
  display: flex;
  align-items: flex-end;
  justify-content: center;
  flex-direction: column;
  gap: 14rpx;
}

.session-action {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8rpx;
  width: 112rpx;
  height: 46rpx;
  margin: 0;
  padding: 0;
  background: transparent;
  color: #235a4d;
  font-size: 25rpx;
  font-weight: 600;
  line-height: 46rpx;
}

.action-chevron {
  width: 18rpx;
  height: 18rpx;
  opacity: 0.62;
}

.session-delete {
  width: 88rpx;
  height: 38rpx;
  margin: 0;
  padding: 0;
  border-radius: 8rpx;
  background: rgba(255, 247, 237, 0.86);
  color: #9f3f33;
  font-size: 21rpx;
  line-height: 38rpx;
}

.load-more {
  position: relative;
  overflow: hidden;
  min-height: 82rpx;
  margin: 2rpx 10rpx 0 74rpx;
  border: 1rpx solid rgba(225, 216, 201, 0.86);
  border-radius: 16rpx;
  background: rgba(255, 255, 252, 0.92);
}

.load-more-art {
  position: absolute;
  right: 0;
  bottom: -18rpx;
  width: 260rpx;
  height: 110rpx;
  opacity: 0.13;
}

.load-more text {
  position: relative;
  z-index: 1;
}

.title {
  margin-bottom: 0;
}

.text {
  color: #738078;
  font-size: 28rpx;
  line-height: 1.6;
}

.actions {
  display: flex;
  gap: 16rpx;
  margin-top: 24rpx;
}

.meta {
  margin-top: 12rpx;
  color: #64748b;
  font-size: 24rpx;
}

.notice,
.empty {
  margin-top: 14rpx;
  padding: 16rpx;
  border-radius: 8rpx;
  background: #eef7f4;
  color: #1f7a68;
  font-size: 24rpx;
  line-height: 1.5;
}

.empty {
  background: #f8fafc;
  color: #64748b;
}

button::after {
  border: none;
}
</style>
