<template>
  <view class="session-calendar">
    <view class="calendar-shell">
      <view class="calendar-hero">
        <t-image class="hero-art" src="/static/art/bamboo-corner.png" mode="aspectFit" />
        <view class="hero-main">
          <view>
            <view class="title">{{ title }}</view>
            <view class="hero-subtitle">{{ totalCount }} 场车局 · {{ calendarUpdatedText }}</view>
          </view>
        </view>
        <view class="hero-actions">
          <t-button v-if="showCreateButton" class="primary-quiet-button" @tap="$emit('create')">
            {{ createButtonLabel }}
          </t-button>
          <t-button v-if="showAdminButton" class="quiet-button" @tap="$emit('admin')">管理员</t-button>
          <t-button v-if="showLogoutButton" class="quiet-button" @tap="$emit('logout')">退出</t-button>
        </view>
      </view>

      <view class="calendar-controls">
        <t-segmented
          class="filter-tabs"
          t-class-item="calendar-segmented-item"
          t-class-thumb="calendar-segmented-thumb"
          block
          custom-style="width: 100%; --td-segmented-bg-color: rgba(239, 234, 224, 0.66); --td-segmented-item-active-bg: #ffffff; --td-segmented-item-color: #34443e; --td-segmented-item-active-color: #1f6f5b; --td-segmented-item-label-font: 500 20rpx / 38rpx sans-serif; --td-spacer-1: 16rpx;"
          :value="activeCalendarFilter"
          :options="visibleFilterSegmentOptions"
          @change="setFilter($event.detail.value)"
        />
        <view class="calendar-tools">
          <t-button class="today-reset-button" @tap="scrollToToday">归位</t-button>
          <view class="date-picker-button" @tap="openCalendarDatePicker">
            {{ selectedDateText }}
          </view>
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
        :refresher-triggered="refreshing"
        upper-threshold="80"
        lower-threshold="80"
        @refresherrefresh="refreshCalendar"
        @scrolltolower="loadMoreDates"
      >
        <t-empty
          v-if="filteredCalendarItems.length === 0 && !isCalendarLoading"
          class="calendar-empty"
          description="暂无符合条件的车局。发起和参与的拼车会按日期汇总在这里。"
        />

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

                  <view class="session-actions">
                    <t-button v-if="item.canManage" class="session-manage" @tap.stop="goManage(item.sessionId)">管理</t-button>
                    <t-button class="session-delete" @tap.stop="hideCalendarItem(item)">
                      {{ item.isOrganized ? organizedRemovalActionText(item.session) : "删除" }}
                    </t-button>
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
          <t-image class="load-more-art" src="/static/art/ink-home-landscape.jpg" mode="aspectFill" />
          <text>{{ calendarMoreHintText }}</text>
        </view>
      </scroll-view>
    </view>
  </view>
</template>

<script setup>
import { computed, nextTick, ref } from "vue";
import { request } from "../utils/api";
import { showModal, showToast } from "../utils/tdesignFeedback";

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
const CALENDAR_PAGE_SIZE = 6;

const props = defineProps({
  title: {
    type: String,
    default: "我的拼车日程"
  },
  sessions: {
    type: Array,
    default: () => []
  },
  signups: {
    type: Array,
    default: () => []
  },
  loading: {
    type: Boolean,
    default: false
  },
  refreshing: {
    type: Boolean,
    default: false
  },
  updatedAt: {
    type: [Date, String, Number],
    default: null
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
  },
  showLogoutButton: {
    type: Boolean,
    default: false
  }
});

const emit = defineEmits(["refresh", "create", "admin", "logout", "auth-expired"]);

const sessionStatusText = ref("");
const signupStatusText = ref("");
const activeFilter = ref("all");
const loadedCalendarCount = ref(CALENDAR_PAGE_SIZE);
const collapsedDayKeys = ref([]);
const scrollIntoViewId = ref("");
const selectedDateKey = ref("");
const calendarDatePickerVisible = ref(false);

const organizedCount = computed(
  () => calendarItems.value.filter((item) => item.isOrganized).length
);
const joinedCount = computed(
  () => calendarItems.value.filter((item) => item.isJoined).length
);
const totalCount = computed(() => calendarItems.value.length);
const pendingCount = computed(
  () => calendarItems.value.filter((item) => item.isPending).length
);
const isCalendarLoading = computed(() => props.loading);
const calendarUpdatedText = computed(() => {
  if (isCalendarLoading.value) {
    return "正在整理";
  }
  if (props.updatedAt) {
    return "最近更新刚刚";
  }
  return "等待同步";
});
const calendarStatusText = computed(() => {
  if (isCalendarLoading.value) {
    return "正在整理你的车局...";
  }
  return [props.statusText, sessionStatusText.value, signupStatusText.value].filter(Boolean).join(" ");
});
const filterTabs = computed(() => [
  { value: "all", label: "全部", count: totalCount.value },
  { value: "organized", label: "发起", count: organizedCount.value },
  { value: "joined", label: "参与", count: joinedCount.value },
  { value: "pending", label: "待处理", count: pendingCount.value }
]);
const visibleFilterTabs = computed(() =>
  filterTabs.value.filter((tab) => tab.value === "all" || tab.count > 0)
);
const visibleFilterSegmentOptions = computed(() =>
  visibleFilterTabs.value.map((tab) => ({
    value: tab.value,
    label: `${tab.label} ${tab.count}`
  }))
);
const activeCalendarFilter = computed(() =>
  visibleFilterTabs.value.some((tab) => tab.value === activeFilter.value) ? activeFilter.value : "all"
);
const calendarItems = computed(() => mergeCalendarItems(props.sessions, props.signups));
const filteredCalendarItems = computed(() => {
  if (activeCalendarFilter.value === "organized") {
    return calendarItems.value.filter((item) => item.isOrganized);
  }
  if (activeCalendarFilter.value === "joined") {
    return calendarItems.value.filter((item) => item.isJoined);
  }
  if (activeCalendarFilter.value === "pending") {
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

function handleAuthExpired(error) {
  if (error?.statusCode !== 401) {
    return false;
  }
  emit("auth-expired", error);
  return true;
}

async function refreshCalendar() {
  emit("refresh");
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
  if (item.albumFirst) {
    goAlbum(item.sessionId);
    return;
  }
  if (item.isOrganized) {
    goManage(item.sessionId);
    return;
  }
  if (isCalendarItemPostStart(item)) {
    goAlbum(item.sessionId);
    return;
  }
  if (item.canReview) {
    goReview(item.sessionId);
    return;
  }
  goDetail(item.sessionId);
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

function goDetail(id) {
  uni.navigateTo({ url: `/pages/session/detail?id=${id}` });
}

function goReview(id) {
  uni.navigateTo({ url: `/pages/session/review?id=${id}` });
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
  if (calendarItemFailed(item)) {
    return "red";
  }
  if (isCalendarItemPostStart(item)) {
    return "green";
  }
  return "amber";
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
}

.hero-subtitle {
  margin-top: 16rpx;
  color: #667985;
  font-size: 25rpx;
  line-height: 1.45;
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

.primary-quiet-button {
  flex: 0 0 148rpx;
  height: 60rpx;
  margin: 0;
  padding: 0 22rpx;
  border-radius: 12rpx;
  background: #24745f;
  color: #ffffff;
  font-size: 25rpx;
  font-weight: 600;
  line-height: 60rpx;
  box-shadow: 0 14rpx 28rpx rgba(36, 116, 95, 0.18);
}

.calendar-controls {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 220rpx;
  gap: 14rpx;
  align-items: center;
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
