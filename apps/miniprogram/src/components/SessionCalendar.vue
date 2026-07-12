<template>
  <view class="session-calendar">
    <view class="calendar-shell">
      <view
        v-if="showCalendarActions"
        class="calendar-action-bar"
        :class="{ 'calendar-action-bar--single': !showAdminButton }"
      >
        <t-button v-if="showCreateButton" class="primary-quiet-button" @tap="requestCreate">
          <view class="primary-action-inner">
            <t-image class="primary-action-icon" src="/static/icons/user-plus-white.png" mode="aspectFit" />
            <text>{{ createButtonLabel }}</text>
          </view>
        </t-button>
        <view
          v-if="showAdminButton"
          class="admin-icon-button"
          aria-label="管理"
          hover-class="admin-icon-button--active"
          @tap="requestAdmin"
        >
          <t-image class="admin-action-icon" src="/static/icons/settings-light.svg" mode="aspectFit" />
        </view>
      </view>

      <view class="calendar-controls">
        <t-segmented
          v-if="safeVisibleFilterSegmentOptions.length > 0"
          class="filter-tabs"
          t-class-item="calendar-segmented-item"
          t-class-thumb="calendar-segmented-thumb"
          block
          custom-style="width: 100%; height: 64rpx; box-sizing: border-box; --td-segmented-bg-color: rgba(239, 234, 224, 0.62); --td-segmented-item-active-bg: #ffffff; --td-segmented-item-color: #34443e; --td-segmented-item-active-color: #1f6f5b; --td-segmented-item-label-font: 600 23rpx / 52rpx sans-serif; --td-spacer: 24rpx; --td-spacer-1: 0rpx;"
          :value="activeCalendarFilter"
          :options="safeVisibleFilterSegmentOptions"
          @change="setFilter($event.detail.value)"
        />
        <view class="calendar-tools">
          <t-button class="today-reset-button" aria-label="归位到今天" @tap="scrollToToday">
            <t-image class="calendar-tool-icon" src="/static/icons/return-green.svg" mode="aspectFit" />
          </t-button>
          <t-button
            class="date-picker-button"
            aria-label="选择日期"
            @tap="openCalendarDatePicker"
          >
            <t-image class="calendar-tool-icon" src="/static/icons/calendar-green.svg" mode="aspectFit" />
          </t-button>
          <t-date-time-picker
            title="选择日期"
            mode="date"
            format="YYYY-MM-DD"
            :visible="calendarDatePickerVisible"
            :value="selectedDatePickerValue"
            @confirm="selectCalendarDate"
            @cancel="closeCalendarDatePicker"
            @close="closeCalendarDatePicker"
          />
        </view>
      </view>

      <t-notice-bar
        v-if="calendarStatusText"
        class="notice calendar-notice"
        theme="warning"
        :visible="true"
        :content="calendarStatusText"
      />

      <scroll-view
        class="calendar-scroll"
        scroll-y
        :scroll-into-view="scrollIntoViewId"
        :scroll-with-animation="true"
        :show-scrollbar="false"
        :refresher-enabled="true"
        :refresher-triggered="activeRefreshing"
        upper-threshold="80"
        lower-threshold="80"
        @refresherrefresh="refreshCalendar"
        @scrolltolower="loadMoreDates"
      >
        <view v-if="showCityLocationPrompt" class="city-location-prompt">
          <view class="city-location-copy">
            <text class="city-location-title">{{ cityLocationPromptTitle }}</text>
            <text class="city-location-text">{{ cityLocationPromptText }}</text>
          </view>
          <t-button class="city-location-action" @tap="requestCityLocationAccess">
            {{ cityLocationActionText }}
          </t-button>
        </view>

        <view
          v-if="filteredCalendarItems.length === 0 && !isCalendarLoading"
          class="day-band today calendar-empty-day-band"
        >
          <view class="timeline-rail"></view>
          <view class="day-marker">今</view>
          <view class="day-card calendar-empty-day-card">
            <t-image
              class="calendar-empty-day-art"
              src="/static/art/ink-home-landscape.jpg"
              mode="aspectFill"
            />
            <view class="calendar-empty-day-content">
              <view class="calendar-empty-day-title">{{ calendarEmptyTitle }}</view>
              <view class="calendar-empty-day-text">{{ calendarEmptyBody }}</view>
              <t-button class="calendar-empty-day-refresh" @tap="refreshCalendar">
                <view class="calendar-empty-day-action-inner">
                  <t-image
                    class="calendar-empty-day-action-icon"
                    src="/static/icons/return-green.svg"
                    mode="aspectFit"
                  />
                  <text>刷新车局</text>
                </view>
              </t-button>
            </view>
          </view>
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
                  <t-image
                    class="day-chevron"
                    :class="{ collapsed: isDayCollapsed(band.dateKey) }"
                    src="/static/icons/chevron.png"
                    mode="aspectFit"
                  />
                </view>
              </view>

              <view v-if="!isDayCollapsed(band.dateKey)" class="day-content">
                <t-empty v-if="band.items.length === 0" class="empty-day-row" description="暂无车局" />

                <view
                  v-for="item in band.items"
                  :key="item.key"
                  class="session-row"
                  :class="[item.type, { 'album-first-row': item.albumFirst }]"
                  @tap="handleCalendarCardTap(item)"
                >
                  <view class="session-stripe" :class="item.stripeTone"></view>

                  <view class="session-main">
                    <view class="session-title-line">
                      <text class="session-title">{{ item.title }}</text>
                      <t-tag
                        v-for="tag in item.identityTags"
                        :key="tag.key"
                        class="type-badge"
                        :class="tag.tone"
                        theme="primary"
                        variant="light"
                        size="small"
                      >
                        {{ tag.label }}
                      </t-tag>
                    </view>
                    <view class="session-store-line">
                      <t-image class="row-icon" src="/static/icons/pin.png" mode="aspectFit" />
                      <text class="session-store">{{ item.storeName }}</text>
                    </view>
                    <view class="session-detail-line">
                      <text class="session-time">{{ item.timeText }}</text>
                      <t-tag class="role-pill" theme="primary" variant="light" size="small">
                        {{ item.roleText }}
                      </t-tag>
                    </view>
                    <view class="session-state-line">
                      <text class="session-meta">{{ item.metaText }}</text>
                      <t-tag
                        class="status-pill"
                        :class="item.statusTone"
                        theme="primary"
                        variant="light"
                        size="small"
                      >
                        {{ item.statusText }}
                      </t-tag>
                    </view>
                    <view v-if="item.albumFirst" class="album-cta-row">
                      <text class="album-cta-note">{{ item.albumCtaNote }}</text>
                    </view>
                  </view>

                  <view v-if="item.canManage || item.canRemove" class="session-actions">
                    <t-button v-if="item.canManage" class="session-manage" @tap.stop="goManage(item.sessionId)">管理</t-button>
                    <t-button v-if="item.canRemove" class="session-delete" @tap.stop="hideCalendarItem(item)">
                      {{ item.isOrganized ? organizedRemovalActionText(item.session) : "删除" }}
                    </t-button>
                  </view>
                </view>
              </view>
            </view>
          </view>
        </view>

        <view
          v-if="filteredCalendarItems.length > 0"
          class="load-more"
          :class="{ disabled: !hasOlderCalendarItems }"
          @tap="loadMoreDates"
        >
          <t-image class="load-more-art" src="/static/art/ink-home-landscape.jpg" mode="aspectFill" />
          <text class="load-more-label">{{ calendarMoreHintText }}</text>
        </view>
      </scroll-view>
    </view>
  </view>
</template>

<script setup>
import { computed, nextTick, ref, watch } from "vue";
import { dataOf, request } from "../utils/api";
import {
  discoveryRequestBody,
  getCityDiscoveryLocation,
  locationFailureState,
  readCityDiscoveryCache,
  writeCityDiscoveryCache
} from "../utils/cityDiscovery";
import { sessionCalendarStripeTone } from "../utils/sessionCalendarStripe";
import { showModal, showToast } from "../utils/tdesignFeedback";

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
const CALENDAR_PAGE_SIZE = 6;

const props = defineProps({
  sessions: {
    type: Array,
    default: () => []
  },
  signups: {
    type: Array,
    default: () => []
  },
  guestSessions: {
    type: Array,
    default: () => []
  },
  calendarMode: {
    type: String,
    default: "member"
  },
  loading: {
    type: Boolean,
    default: false
  },
  refreshing: {
    type: Boolean,
    default: false
  },
  statusText: {
    type: String,
    default: ""
  },
  showCreateButton: {
    type: Boolean,
    default: false
  },
  createButtonLabel: {
    type: String,
    default: "发车"
  },
  showAdminButton: {
    type: Boolean,
    default: false
  }
});

const emit = defineEmits(["refresh", "create", "admin", "identity-required", "auth-expired"]);

const sessionStatusText = ref("");
const signupStatusText = ref("");
const activeFilter = ref("mine");
const loadedCalendarCount = ref(CALENDAR_PAGE_SIZE);
const collapsedDayKeys = ref([]);
const scrollIntoViewId = ref("");
const selectedDateKey = ref("");
const calendarDatePickerVisible = ref(false);
const citySessions = ref([]);
const cityLoading = ref(false);
const cityRefreshing = ref(false);
const cityLoaded = ref(false);
const cityMode = ref("");
const cityName = ref("");
const cityLocationState = ref("idle");
const cityStatusText = ref("");

const isGuestMode = computed(() => props.calendarMode === "guest");
const mineCalendarItems = computed(() => mergeCalendarItems(props.sessions, props.signups));
const cityCalendarItems = computed(() => createDiscoveryCalendarItems(citySessions.value));
const guestCalendarItems = computed(() => createDiscoveryCalendarItems(props.guestSessions, "guest"));
const activeCalendarFilter = computed(() => (isGuestMode.value ? "guest" : activeFilter.value));
const filteredCalendarItems = computed(() => {
  if (activeCalendarFilter.value === "guest") {
    return guestCalendarItems.value;
  }
  return activeCalendarFilter.value === "city" ? cityCalendarItems.value : mineCalendarItems.value;
});
const isCalendarLoading = computed(() =>
  activeCalendarFilter.value === "city" ? cityLoading.value : props.loading
);
const activeRefreshing = computed(() =>
  activeCalendarFilter.value === "city" ? cityRefreshing.value : props.refreshing
);
const showCalendarActions = computed(() => props.showCreateButton || props.showAdminButton);
const calendarStatusText = computed(() => {
  if (activeCalendarFilter.value === "guest") {
    return isCalendarLoading.value ? "正在加载近期车局..." : props.statusText;
  }
  if (activeCalendarFilter.value === "city") {
    if (cityLoading.value) {
      return "正在查找可参加的同城车局...";
    }
    if (cityStatusText.value) {
      return cityStatusText.value;
    }
    if (cityMode.value === "time_fallback") {
      return "定位未开启，暂按开本时间推荐。";
    }
    return "";
  }
  if (isCalendarLoading.value) {
    return "正在整理你的车局...";
  }
  return [props.statusText, sessionStatusText.value, signupStatusText.value].filter(Boolean).join(" ");
});
const filterTabs = computed(() =>
  isGuestMode.value
    ? [{ value: "guest", label: "近期车局", count: guestCalendarItems.value.length }]
    : [
        { value: "mine", label: "我的", count: mineCalendarItems.value.length },
        { value: "city", label: "同城", count: cityCalendarItems.value.length }
      ]
);
const visibleFilterSegmentOptions = computed(() =>
  filterTabs.value.map((tab) => ({
    value: tab.value,
    label: `${tab.label} ${tab.count}`
  }))
);
const safeVisibleFilterSegmentOptions = computed(() =>
  Array.isArray(visibleFilterSegmentOptions.value) ? visibleFilterSegmentOptions.value : []
);
const showCityLocationPrompt = computed(
  () =>
    activeCalendarFilter.value === "city" &&
    cityMode.value === "time_fallback" &&
    ["denied", "unavailable"].includes(cityLocationState.value)
);
const cityLocationPromptTitle = computed(() =>
  cityLocationState.value === "denied" ? "开启定位，查看同城车局" : "暂时无法识别所在城市"
);
const cityLocationPromptText = computed(() => {
  if (cityLocationState.value === "denied") {
    return "你尚未授权位置，当前先按开本时间展示最近 5 辆可报名车局。";
  }
  return "当前先按开本时间展示最近 5 辆可报名车局，稍后可重试定位。";
});
const cityLocationActionText = computed(() =>
  cityLocationState.value === "denied" ? "开启定位" : "重试定位"
);
const calendarEmptyTitle = computed(() => {
  if (activeCalendarFilter.value === "guest") {
    return "暂无公开车局";
  }
  if (activeCalendarFilter.value !== "city") {
    return "今天还没有你的车局";
  }
  if (cityMode.value === "city" && cityName.value) {
    return `${cityName.value}暂时没有可报名车局`;
  }
  return "附近暂时没有可报名车局";
});
const calendarEmptyBody = computed(() => {
  if (activeCalendarFilter.value === "guest") {
    return "新的公开车局发布后，会显示在这里";
  }
  if (activeCalendarFilter.value === "mine") {
    return "创建或加入车局后，会按日期出现在这里";
  }
  return "新的同城车局发布后，会按日期出现在这里";
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

watch(
  () => props.calendarMode,
  (mode) => {
    activeFilter.value = mode === "guest" ? "guest" : "mine";
    resetCalendarWindow();
  }
);

function requestCreate() {
  if (isGuestMode.value) {
    emit("identity-required", "登录后可创建车局。");
    return;
  }
  emit("create");
}

function requestAdmin() {
  if (isGuestMode.value) {
    emit("identity-required", "登录后可进入车包。");
    return;
  }
  emit("admin");
}

function handleAuthExpired(error) {
  if (error?.statusCode !== 401) {
    return false;
  }
  emit("auth-expired", error);
  return true;
}

async function loadCitySessions(options = {}) {
  if (cityLoading.value || cityRefreshing.value) {
    return;
  }

  const refreshing = Boolean(options.refreshing);
  cityLoading.value = !refreshing;
  cityRefreshing.value = refreshing;
  cityStatusText.value = "";
  let location = null;
  let locationFromCache = false;

  try {
    if (!options.ignoreCache) {
      location = readCityDiscoveryCache();
      locationFromCache = Boolean(location);
    }
    if (location) {
      cityLocationState.value = "located";
    } else {
      cityLocationState.value = "locating";
      try {
        location = await getCityDiscoveryLocation();
        cityLocationState.value = "located";
      } catch (error) {
        cityLocationState.value = locationFailureState(error);
      }
    }

    const response = await request({
      url: "/api/sessions/discovery",
      method: "POST",
      data: discoveryRequestBody(location),
      timeout: 12000
    });
    const payload = dataOf(response) || {};
    citySessions.value = Array.isArray(payload.sessions) ? payload.sessions : [];
    cityMode.value = payload.mode === "city" ? "city" : "time_fallback";
    cityName.value = cityMode.value === "city" ? String(payload.city || "").trim() : "";
    cityLoaded.value = true;

    if (cityMode.value === "city") {
      cityLocationState.value = "located";
      if (cityName.value && location && !locationFromCache) {
        writeCityDiscoveryCache({
          city: cityName.value,
          latitude: location.latitude,
          longitude: location.longitude
        });
      }
    } else if (cityLocationState.value !== "denied") {
      cityLocationState.value = "unavailable";
    }

    if (activeCalendarFilter.value === "city") {
      resetCalendarWindow();
    }
  } catch (error) {
    if (handleAuthExpired(error)) {
      return;
    }
    cityStatusText.value = "同城车局加载失败，请稍后重试。";
    cityLoaded.value = citySessions.value.length > 0;
  } finally {
    cityLoading.value = false;
    cityRefreshing.value = false;
  }
}

async function refreshCalendar() {
  if (activeCalendarFilter.value === "city") {
    await loadCitySessions({ refreshing: true });
    return;
  }
  emit("refresh");
}

function setFilter(value) {
  const allowedFilters = isGuestMode.value ? ["guest"] : ["mine", "city"];
  if (!allowedFilters.includes(value)) {
    return;
  }
  activeFilter.value = value;
  resetCalendarWindow();
  if (value === "city" && !cityLoaded.value) {
    void loadCitySessions();
  }
}

function requestCityLocationAccess() {
  cityStatusText.value = "";
  if (cityLocationState.value !== "denied" || typeof uni.openSetting !== "function") {
    void loadCitySessions({ ignoreCache: true });
    return;
  }

  uni.openSetting({
    success(result = {}) {
      if (result.authSetting?.["scope.userLocation"]) {
        void loadCitySessions({ ignoreCache: true });
        return;
      }
      cityLocationState.value = "denied";
    },
    fail() {
      void loadCitySessions({ ignoreCache: true });
    }
  });
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

function openCalendarDatePicker() {
  calendarDatePickerVisible.value = true;
}

function closeCalendarDatePicker() {
  calendarDatePickerVisible.value = false;
}

function selectCalendarDate(event) {
  const value = event?.detail?.value || "";
  calendarDatePickerVisible.value = false;
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

function handleCalendarCardTap(item) {
  handleCalendarAction(item);
}

function handleCalendarAction(item) {
  if (item.type === "guest") {
    goGuestDetail(item.sessionId);
    return;
  }
  if (item.type === "city") {
    goDetail(item.sessionId);
    return;
  }
  if (isCalendarItemPostStart(item)) {
    goAlbum(item.sessionId);
    return;
  }
  goShare(item.sessionId);
}

function hideCalendarItem(item) {
  if (item.isOrganized) {
    if (hasOtherOnboardMembers(item.session)) {
      leaveOrganizedSession(item.session);
      return;
    }
    if (hasActiveAlbumPhotos(item.session)) {
      requireAlbumCleanupBeforeCancel(item.session);
      return;
    }
    cancelOrganizedSession(item.session);
    return;
  }
  hideJoinedSession(item.signup);
}

function organizedRemovalActionText(session) {
  return hasOtherOnboardMembers(session) ? "退出" : "删除";
}

function goManage(id) {
  uni.navigateTo({ url: `/pages/session/manage?id=${id}` });
}

function goShare(id) {
  uni.navigateTo({ url: `/pages/session/share?id=${id}` });
}

function goDetail(id) {
  uni.navigateTo({ url: `/pages/session/detail?id=${id}&entry=city` });
}

function goGuestDetail(id) {
  uni.navigateTo({ url: `/pages/session/detail?id=${id}&entry=guest` });
}

function goAlbum(id) {
  uni.navigateTo({ url: `/pages/session/album?id=${id}` });
}

function confirmPersonalRemoval(content, confirmText, onConfirm) {
  showModal({
    title: "确认操作",
    content,
    confirmText,
    cancelText: "再想想",
    success: (result) => {
      if (result.confirm) {
        onConfirm();
      }
    }
  });
}

function cancelOrganizedSession(session) {
  confirmPersonalRemoval(
    "删除后这辆车会被直接删除，座位、报名、聊天和相册记录会一起删除。",
    "删除",
    async () => {
      sessionStatusText.value = "正在删除这辆车...";
      try {
        await request({
          url: `/api/sessions/${session.id}/cancel`,
          method: "PATCH"
        });
        emit("refresh");
        showToast({ title: "已删除", icon: "none" });
      } catch (error) {
        if (handleAuthExpired(error)) {
          return;
        }
        sessionStatusText.value =
          error?.data?.error?.code === "SESSION_HAS_ALBUM_PHOTOS"
            ? "相册照片没有清空之前无法删除。"
            : "删除失败，请稍后重试。";
      }
    }
  );
}

function requireAlbumCleanupBeforeCancel() {
  showModal({
    title: "无法删除",
    content: "相册照片没有清空之前无法删除。",
    confirmText: "知道了",
    showCancel: false
  });
}

function leaveOrganizedSession(session) {
  confirmPersonalRemoval(
    "已有玩家上车，不能取消删除。退出车头后，系统会转给下一位已上车成员。",
    "退出",
    async () => {
      sessionStatusText.value = "正在退出车头...";
      try {
        await request({
          url: `/api/sessions/${session.id}/organizer/leave`,
          method: "PATCH"
        });
        emit("refresh");
        showToast({ title: "已退出车头", icon: "none" });
      } catch (error) {
        if (handleAuthExpired(error)) {
          return;
        }
        sessionStatusText.value = "退出失败，请稍后重试。";
      }
    }
  );
}

function hasOtherOnboardMembers(session = {}) {
  if (Array.isArray(session.seats)) {
    return session.seats.some(
      (seat) =>
        ["confirmed", "locked"].includes(seat.status) &&
        seat.confirmed_user_id &&
        Number(seat.confirmed_user_id) !== Number(session.organizer_user_id)
    );
  }
  return Number(session.other_onboard_member_count || 0) > 0;
}

function hasActiveAlbumPhotos(session = {}) {
  return Number(session.active_album_photo_count || session.photo_count || 0) > 0;
}

function hideJoinedSession(signup) {
  confirmPersonalRemoval(
    "只会从你的列表下架，不会影响这台车或其他车友。之后可以通过车友分享链接重新链接。",
    "删除",
    async () => {
      signupStatusText.value = "正在从我参与下架...";
      try {
        await request({
          url: `/api/signups/${signup.id}/hide`,
          method: "PATCH"
        });
        emit("refresh");
        showToast({ title: "已从列表下架", icon: "none" });
      } catch (error) {
        if (handleAuthExpired(error)) {
          return;
        }
        signupStatusText.value = "删除失败，请稍后重试。";
      }
    }
  );
}

function createDiscoveryCalendarItems(rows = [], itemType = "city") {
  return (rows || [])
    .map((session) => {
      const sessionId = session?.id;
      const startDate = parseStartAt(session?.start_at);
      if (!sessionId || !startDate) {
        return null;
      }
      const availableSeatCount = Math.max(Number(session.available_seat_count || 0), 0);
      return {
        session: null,
        signup: null,
        sessionId,
        key: `${itemType}-${sessionId}`,
        isOrganized: false,
        canManage: false,
        canRemove: false,
        isJoined: false,
        type: itemType,
        raw: session,
        sessionStatus: session.status || "recruiting",
        signupStatus: "",
        title: session.script_name_snapshot || "未命名车局",
        storeName: session.store_name_snapshot || "店家待定",
        dateKey: dateKey(startDate),
        sortValue: startDate.getTime(),
        timeText: timeText(startDate),
        roleText: `剩余 ${availableSeatCount} 位`,
        metaText:
          itemType === "guest"
            ? [session.store_city, session.store_district].filter(Boolean).join(" · ") || "公开招募"
            : discoveryDistanceText(session.distance_km),
        statusText: "招募中",
        statusTone: "amber",
        postStart: false,
        hasReview: false,
        canReview: false,
        identityTags: [],
        isPending: false,
        albumFirst: false,
        albumCtaNote: "",
        stripeTone: "amber"
      };
    })
    .filter(Boolean);
}

function discoveryDistanceText(value) {
  if (value === null || value === undefined || value === "") {
    return "同城可报名";
  }
  const distance = Number(value);
  if (!Number.isFinite(distance) || distance < 0) {
    return "同城可报名";
  }
  if (distance < 0.1) {
    return "距离 <100m";
  }
  if (distance < 1) {
    return `距离 ${Math.round(distance * 1000)}m`;
  }
  return `距离 ${distance.toFixed(1)}km`;
}

function mergeCalendarItems(createdSessions = [], joinedSignups = []) {
  const itemsBySession = new Map();

  (createdSessions || []).forEach((session) => {
    const sessionId = String(session?.id || "");
    if (!sessionId) {
      return;
    }
    itemsBySession.set(sessionId, createCalendarItem({ session }));
  });

  (joinedSignups || []).forEach((signup) => {
    const sessionId = String(signup?.session_id || "");
    if (!sessionId) {
      return;
    }
    const existing = itemsBySession.get(sessionId);
    if (existing) {
      existing.signup = signup;
      refreshCalendarItem(existing);
      return;
    }
    itemsBySession.set(sessionId, createCalendarItem({ signup }));
  });

  return Array.from(itemsBySession.values())
    .map((item) => refreshCalendarItem(item))
    .filter((item) => item.dateKey)
    .sort((left, right) => {
      if (left.sortValue !== right.sortValue) {
        return right.sortValue - left.sortValue;
      }
      return Number(right.sessionId || 0) - Number(left.sessionId || 0);
    });
}

function createCalendarItem({ session = null, signup = null }) {
  return refreshCalendarItem({ session, signup });
}

function refreshCalendarItem(item) {
  const source = item.session || item.signup || {};
  const startDate = parseStartAt(source.start_at);
  item.sessionId = item.session?.id || item.signup?.session_id || "";
  item.key = `calendar-${item.sessionId}`;
  item.isOrganized = Boolean(item.session);
  item.canManage = item.isOrganized;
  item.canRemove = true;
  item.isJoined = Boolean(item.signup);
  item.type = item.isOrganized ? "organized" : "joined";
  item.raw = item.session || item.signup || {};
  item.sessionStatus = item.session?.status || item.signup?.session_status || "";
  item.signupStatus = item.signup?.status || "";
  item.title = source.script_name_snapshot || "未命名车局";
  item.storeName = source.store_name_snapshot || "店家待定";
  item.dateKey = startDate ? dateKey(startDate) : "";
  item.sortValue = startDate ? startDate.getTime() : 0;
  item.timeText = startDate ? timeText(startDate) : "时间待定";
  item.roleText = item.isJoined ? compactSignupRoleText(item.signup) : "车头";
  item.metaText = calendarMetaText(item);
  item.statusText = "";
  item.statusTone = item.isOrganized
    ? sessionStatusTone(item.sessionStatus)
    : signupStatusTone(item.signupStatus);
  item.postStart = isStartedAt(source.start_at);
  item.hasReview = Boolean(item.signup?.has_review);
  item.canReview = Boolean(item.signup?.can_review);
  item.identityTags = calendarIdentityTags(item);
  item.isPending = calendarItemIsPending(item);
  item.albumFirst = isCalendarItemPostStart(item);
  item.albumCtaNote = item.albumFirst ? calendarAlbumCtaNote(item.raw) : "";
  item.stripeTone = calendarStripeTone(item);
  item.statusText = calendarItemStatusText(item);
  if (item.albumFirst) {
    item.statusTone = "green";
  }
  return item;
}

function calendarStripeTone(item) {
  return sessionCalendarStripeTone({
    failed: calendarItemFailed(item),
    postStart: isCalendarItemPostStart(item),
    albumMediaCount: item.raw?.album_media_count
  });
}

function calendarItemFailed(item) {
  return (
    item.sessionStatus === "cancelled" ||
    item.signupStatus === "rejected" ||
    item.signupStatus === "cancelled"
  );
}

function calendarIdentityTags(item) {
  const tags = [];
  if (item.isOrganized) {
    tags.push({ key: "organized", label: "发起", tone: "organized" });
  }
  return tags;
}

function calendarItemIsPending(item) {
  return (
    Number(item.session?.pending_signup_count || 0) > 0 ||
    item.sessionStatus === "draft" ||
    item.signupStatus === "pending"
  );
}

function calendarMetaText(item) {
  if (item.isOrganized) {
    const pendingSignupCount = Number(item.session?.pending_signup_count || 0);
    const metaParts = [`${Number(item.session?.seat_count || 0)}位`];
    if (pendingSignupCount > 0) {
      metaParts.push(`${pendingSignupCount}个待审核`);
    }
    return metaParts.join(" · ");
  }
  return item.signup?.seat_role_name ? `角色：${item.signup.seat_role_name}` : "角色待定";
}

function calendarItemStatusText(item) {
  if (isCalendarItemPostStart(item)) {
    return calendarPostStartText(item.raw);
  }
  if (item.isOrganized) {
    return statusLabel(item.sessionStatus);
  }
  if (item.isJoined) {
    return signupStatusLabel(item.signupStatus);
  }
  return "-";
}

function isCalendarItemPostStart(item) {
  if (!item?.postStart) {
    return false;
  }
  if (item.sessionStatus === "cancelled" || item.signupStatus === "rejected") {
    return false;
  }
  return item.isOrganized || item.signupStatus === "approved";
}

function isStartedAt(startAt) {
  const startDate = parseStartAt(startAt);
  return Boolean(startDate && startDate.getTime() <= Date.now());
}

function hasAlbumContent(source = {}) {
  return (
    Number(source.visible_photo_count || source.photo_count || source.review_count || 0) > 0 ||
    Boolean(source.has_review)
  );
}

function calendarAlbumCtaNote(source = {}) {
  return hasAlbumContent(source) ? "这场车已沉淀下来" : "发车后相册已开放";
}

function calendarPostStartText(source = {}) {
  const visibleCount = Number(source.visible_photo_count || source.photo_count || 0);
  if (visibleCount > 0) {
    return `已发车 · ${visibleCount} 张可见`;
  }
  return "已发车 · 相册开放";
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
  const nearestIndex = filteredCalendarItems.value.findIndex((item) =>
    activeCalendarFilter.value === "city" ? item.dateKey >= key : item.dateKey <= key
  );
  if (nearestIndex >= 0) {
    return nearestIndex;
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
  const nearestBand = dayBands.find((band) =>
    activeCalendarFilter.value === "city" ? band.dateKey >= key : band.dateKey <= key
  );
  return nearestBand?.elementId || dayBands[dayBands.length - 1]?.elementId || "";
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

function compactSignupRoleText(signup) {
  const roleName = String(signup?.seat_role_name || "").trim();
  const seatName = String(signup?.seat_name || "").trim();
  if (roleName) {
    return roleName;
  }
  return seatName || "玩家";
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
  gap: 18rpx;
}

.calendar-action-bar {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 12rpx;
  align-items: center;
}

.calendar-action-bar--single {
  grid-template-columns: minmax(0, 1fr);
}

.primary-quiet-button {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  min-height: 92rpx;
  margin: 0;
  padding: 0 34rpx;
  box-sizing: border-box;
  border-radius: 18rpx;
  background: linear-gradient(145deg, #1a5d4d 0%, #2c775f 100%);
  color: #ffffff;
  font-size: 32rpx;
  font-weight: 600;
  line-height: 1.2;
  text-align: center;
  box-shadow: 0 18rpx 42rpx rgba(31, 111, 91, 0.24);
}

.admin-icon-button {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 92rpx;
  height: 92rpx;
  box-sizing: border-box;
  border: 1rpx solid rgba(255, 255, 255, 0.28);
  border-radius: 18rpx;
  background: linear-gradient(145deg, #2d8069 0%, #1f6f5b 100%);
  box-shadow: 0 18rpx 42rpx rgba(31, 111, 91, 0.2);
}

.admin-icon-button--active {
  background: #1b5f4f;
}

.admin-action-icon {
  width: 46rpx;
  height: 46rpx;
}

.primary-action-inner {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 18rpx;
  width: 100%;
  height: 100%;
}

.primary-action-icon {
  width: 42rpx;
  height: 42rpx;
}

.calendar-controls {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 216rpx;
  gap: 12rpx;
  align-items: stretch;
}

.filter-tabs {
  display: block;
  width: 100%;
  min-width: 0;
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
  border-radius: 10rpx;
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
  gap: 12rpx;
}

.today-reset-button,
.date-picker-button {
  height: 64rpx;
  margin: 0;
  padding: 0;
  border: 1rpx solid rgba(36, 116, 95, 0.42);
  border-radius: 12rpx;
  background: rgba(255, 255, 252, 0.94);
  color: #24745f;
  font-size: 24rpx;
  font-weight: 600;
  line-height: 64rpx;
  text-align: center;
  box-sizing: border-box;
  box-shadow: 0 10rpx 22rpx rgba(36, 116, 95, 0.08);
}

.today-reset-button:active,
.date-picker-button:active {
  background: rgba(238, 247, 244, 0.96);
}

.calendar-tool-icon {
  display: inline-block;
  width: 34rpx;
  height: 34rpx;
  vertical-align: middle;
}

.calendar-notice {
  margin-top: 0;
}

.calendar-scroll {
  height: calc(100vh - 356rpx);
  min-height: 640rpx;
}

.city-location-prompt {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20rpx;
  margin: 12rpx 0 20rpx 64rpx;
  padding: 22rpx 20rpx;
  border-top: 1rpx solid rgba(213, 190, 145, 0.72);
  border-bottom: 1rpx solid rgba(213, 190, 145, 0.72);
  background: rgba(255, 249, 236, 0.82);
}

.city-location-copy {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: 8rpx;
}

.city-location-title {
  color: #4f4433;
  font-size: 26rpx;
  font-weight: 600;
  line-height: 1.35;
}

.city-location-text {
  color: #81725c;
  font-size: 22rpx;
  line-height: 1.5;
}

.city-location-action {
  flex: 0 0 148rpx;
  width: 148rpx;
  height: 60rpx;
  margin: 0;
  padding: 0 12rpx;
  border: 1rpx solid rgba(36, 116, 95, 0.46);
  border-radius: 10rpx;
  background: #ffffff;
  color: #24745f;
  font-size: 23rpx;
  line-height: 60rpx;
}

.load-more {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 74rpx;
  color: #5f7792;
  font-size: 25rpx;
  line-height: 1.4;
}

.load-more.disabled {
  color: #9aa8b3;
  opacity: 0.72;
}

.calendar-empty-day-band {
  position: relative;
  min-height: 680rpx;
  margin-top: 14rpx;
}

.calendar-empty-day-band .timeline-rail {
  bottom: 0;
}

.day-card.calendar-empty-day-card {
  position: relative;
  overflow: hidden;
  min-height: 640rpx;
  border: 0 !important;
  border-radius: 0 !important;
  background: transparent !important;
  box-shadow: none !important;
}

.calendar-empty-day-art {
  position: absolute;
  right: -30rpx;
  bottom: -8rpx;
  width: 680rpx;
  height: 380rpx;
  opacity: 0.18;
}

.calendar-empty-day-content {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  min-height: 640rpx;
  padding: 72rpx 12rpx 150rpx 30rpx;
  box-sizing: border-box;
  text-align: center;
}

.calendar-empty-day-title {
  color: #175f4d;
  font-family: "PincheBrand", "Songti SC", "STSong", "PingFang SC", sans-serif;
  font-size: 40rpx;
  font-weight: 700;
  line-height: 1.36;
  letter-spacing: 1rpx;
}

.calendar-empty-day-text {
  width: 100%;
  margin-top: 20rpx;
  color: #746f67;
  font-size: 22rpx;
  line-height: 1.65;
  white-space: nowrap;
}

.calendar-empty-day-refresh {
  width: 268rpx;
  height: 72rpx;
  margin: 48rpx 0 0;
  padding: 0 20rpx;
  border: 1rpx solid rgba(36, 116, 95, 0.52);
  border-radius: 12rpx;
  background: rgba(255, 255, 252, 0.92);
  color: #1f6f5b;
  font-size: 25rpx;
  font-weight: 600;
  line-height: 72rpx;
}

.calendar-empty-day-action-inner {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 14rpx;
}

.calendar-empty-day-action-icon {
  width: 30rpx;
  height: 30rpx;
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
  grid-template-columns: minmax(0, 1fr) 92rpx;
  gap: 16rpx;
  min-height: 132rpx;
  padding: 22rpx 14rpx 22rpx 28rpx;
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
  background: #d6a33a;
}

.session-stripe.amber {
  background: #d6a33a;
  box-shadow: 0 0 0 4rpx rgba(214, 163, 58, 0.14);
}

.session-stripe.green {
  background: #24745f;
  box-shadow: 0 0 0 4rpx rgba(36, 116, 95, 0.12);
}

.session-stripe.red {
  background: #c25b4a;
  box-shadow: 0 0 0 4rpx rgba(194, 91, 74, 0.12);
}

.session-row.album-first-row {
  background: linear-gradient(180deg, rgba(241, 248, 245, 0.96), rgba(255, 255, 252, 0.94));
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

.session-detail-line,
.session-state-line {
  display: flex;
  align-items: center;
  gap: 10rpx;
  min-width: 0;
}

.session-detail-line {
  margin-top: 10rpx;
}

.session-state-line {
  margin-top: 10rpx;
}

.session-time {
  flex: 0 0 auto;
  color: #283a32;
  font-size: 25rpx;
  font-weight: 500;
  line-height: 1.24;
}

.session-meta {
  overflow: hidden;
  min-width: 0;
  color: #7f715f;
  font-size: 22rpx;
  line-height: 1.3;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.role-pill,
.status-pill {
  display: inline-flex;
  max-width: 210rpx;
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

.album-cta-row {
  display: flex;
  align-items: center;
  gap: 14rpx;
  margin-top: 14rpx;
  min-width: 0;
}

.album-cta-note {
  overflow: hidden;
  min-width: 0;
  color: #5b7068;
  font-size: 22rpx;
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.session-actions {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: 10rpx;
}

.session-manage,
.session-delete {
  width: 88rpx;
  height: 44rpx;
  margin: 0;
  padding: 0;
  border-radius: 8rpx;
  font-size: 21rpx;
  line-height: 44rpx;
}

.session-manage {
  border: 1rpx solid rgba(36, 116, 95, 0.18);
  background: #edf8f3;
  color: #24745f;
  font-weight: 600;
}

.session-delete {
  background: rgba(255, 247, 237, 0.86);
  color: #9f3f33;
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

.load-more-label {
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

</style>
