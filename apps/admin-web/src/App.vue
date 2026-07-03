<template>
  <LoginPanel v-if="!auth.token" :build-version="buildVersion" @authenticated="setAuth" />
  <div v-else class="app-shell" :class="{ 'sidebar-collapsed': sidebarCollapsed }">
    <aside class="sidebar">
      <div class="brand">
        <span class="brand-mark">剧</span>
        <span class="brand-text">剧本迷管理</span>
      </div>
      <nav>
        <button
          class="nav-item"
          :class="{ active: activeView === 'catalog' }"
          type="button"
          @click="switchActiveView('catalog')"
        >
          <span class="nav-icon">管</span>
          <span class="nav-text">管理界面</span>
        </button>
        <button
          class="nav-item"
          :class="{ active: activeView === 'miniapp' }"
          type="button"
          @click="switchActiveView('miniapp')"
        >
          <span class="nav-icon">用</span>
          <span class="nav-text">网页小程序</span>
        </button>
      </nav>
      <button class="sidebar-collapse" type="button" @click="sidebarCollapsed = !sidebarCollapsed">
        {{ sidebarCollapsed ? "展开" : "收起" }}
      </button>
    </aside>
    <section class="workspace">
      <header class="operator-topbar">
        <div class="title-group">
          <button class="shell-toggle" type="button" @click="sidebarCollapsed = !sidebarCollapsed">
            {{ sidebarCollapsed ? "展开导航" : "收起导航" }}
          </button>
          <h1>{{ pageTitle }}</h1>
        </div>
        <div class="user-box">
          <div class="user-profile-wrap">
            <button
              class="user-profile-trigger"
              type="button"
              :aria-expanded="profileDetailsOpen"
              aria-haspopup="dialog"
              @click="profileDetailsOpen = !profileDetailsOpen"
            >
              <span class="user-avatar" :class="avatarGenderClass">
                <img
                  v-if="profileAvatarSrc"
                  class="user-avatar-image"
                  :src="profileAvatarSrc"
                  alt=""
                  @error="handleAvatarError"
                />
                <span v-else class="user-avatar-fallback">{{ avatarFallbackText }}</span>
              </span>
              <span class="user-summary">
                <span class="user-name">{{ displayName }}</span>
                <span class="user-meta">{{ userMetaText }}</span>
              </span>
            </button>

            <div v-if="profileDetailsOpen" class="profile-detail-popover" role="dialog">
              <div class="profile-detail-head">
                <strong>管理员资料</strong>
                <button class="profile-detail-close" type="button" @click="profileDetailsOpen = false">
                  关闭
                </button>
              </div>
              <dl class="profile-detail-list">
                <div
                  v-for="row in fullProfileRows"
                  :key="row.label"
                  class="profile-detail-row"
                >
                  <dt>{{ row.label }}</dt>
                  <dd>{{ row.value }}</dd>
                </div>
              </dl>
            </div>
          </div>
          <button type="button" @click="logout">退出</button>
        </div>
      </header>
      <CatalogWorkspace v-if="activeView === 'catalog'" :initial-tab="initialRoute.catalogTab" />
      <MiniProgramWorkspace
        v-else
        :initial-screen="initialRoute.miniScreen"
        :initial-session-id="initialRoute.sessionId"
        :initial-seat-id="initialRoute.seatId"
        :initial-share-code="initialRoute.shareCode"
        :initial-source="initialRoute.source"
      />
      <div class="app-build-version">{{ buildVersion }}</div>
    </section>
  </div>
</template>

<script setup>
import { computed, ref } from "vue";
import { assetUrl, clearStoredAuth, getStoredAuth } from "./api";
import { parseAdminRouteQuery, writeAdminRoute } from "./adminRoute";
import CatalogWorkspace from "./components/CatalogWorkspace.vue";
import LoginPanel from "./components/LoginPanel.vue";
import MiniProgramWorkspace from "./components/MiniProgramWorkspace.vue";

const initialRoute = ref(parseAdminRouteQuery(window.location.search));
const auth = ref(getStoredAuth());
const sidebarCollapsed = ref(false);
const profileDetailsOpen = ref(false);
const avatarLoadFailed = ref(false);
const activeView = ref(initialRoute.value.activeView);
const buildVersion = `版本号 ${__PINCHE_BUILD_TIME__}`;
const user = computed(() => auth.value.user || {});
const roles = computed(() => auth.value.roles || []);
const rolesText = computed(() => (roles.value.length > 0 ? roles.value.join(" / ") : "无"));
const avatarUrl = computed(() => user.value.avatarUrl || user.value.avatar_url || "");
const displayName = computed(() => {
  const current = user.value;
  return (
    String(current.nickname || "").trim() ||
    current.openid ||
    current.open_id ||
    (current.id ? `用户${current.id}` : "管理员")
  );
});
const genderLabel = computed(() => {
  const labels = {
    male: "男",
    female: "女"
  };
  return labels[user.value.gender] || "未选择";
});
const avatarGenderClass = computed(() =>
  ["male", "female"].includes(user.value.gender) ? `gender-${user.value.gender}` : "gender-unknown"
);
const profileAvatarSrc = computed(() => {
  if (avatarLoadFailed.value || !avatarUrl.value) {
    return "";
  }
  return assetUrl(avatarUrl.value);
});
const avatarFallbackText = computed(() => {
  const nickname = String(user.value.nickname || "").trim();
  if (nickname) {
    return nickname.slice(0, 1);
  }
  if (user.value.gender === "male") {
    return "男";
  }
  if (user.value.gender === "female") {
    return "女";
  }
  return "管";
});
const userMetaText = computed(() =>
  [genderLabel.value, roles.value.length > 0 ? rolesText.value : ""].filter(Boolean).join(" / ")
);
const fullProfileRows = computed(() => [
  { label: "昵称", value: formatField(user.value.nickname) },
  { label: "性别", value: genderLabel.value },
  { label: "头像地址", value: formatField(avatarUrl.value) },
  { label: "用户 ID", value: formatField(user.value.id, "无") },
  { label: "OpenID", value: formatField(user.value.openid || user.value.open_id, "无") },
  { label: "UnionID", value: formatField(user.value.unionid || user.value.union_id, "无") },
  {
    label: "手机授权时间",
    value: formatDateTime(user.value.phoneVerifiedAt || user.value.phone_verified_at)
  },
  { label: "创建时间", value: formatDateTime(user.value.createdAt || user.value.created_at) },
  { label: "更新时间", value: formatDateTime(user.value.updatedAt || user.value.updated_at) },
  { label: "角色", value: rolesText.value }
]);
const pageTitle = computed(() => {
  if (activeView.value === "miniapp") {
    return "网页小程序";
  }
  return "管理界面";
});

function formatField(value, emptyText = "未填写") {
  if (value === 0) {
    return "0";
  }
  const text = String(value || "").trim();
  return text || emptyText;
}

function formatDateTime(value) {
  if (!value) {
    return "无";
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

function setAuth(nextAuth) {
  auth.value = nextAuth;
  avatarLoadFailed.value = false;
  profileDetailsOpen.value = false;
}

function handleAvatarError() {
  avatarLoadFailed.value = true;
}

function switchActiveView(nextView) {
  if (activeView.value === nextView) {
    return;
  }
  const currentRoute = parseAdminRouteQuery(window.location.search);
  initialRoute.value = {
    ...currentRoute,
    activeView: nextView,
    miniScreen: nextView === "miniapp" ? "home" : currentRoute.miniScreen,
    sessionId: nextView === "miniapp" ? "" : currentRoute.sessionId,
    seatId: nextView === "miniapp" ? "" : currentRoute.seatId,
    shareCode: nextView === "miniapp" ? "" : currentRoute.shareCode,
    source: nextView === "miniapp" ? "" : currentRoute.source
  };
  activeView.value = nextView;
  profileDetailsOpen.value = false;
  writeAdminRoute(initialRoute.value);
}

function logout() {
  clearStoredAuth();
  auth.value = getStoredAuth();
  avatarLoadFailed.value = false;
  profileDetailsOpen.value = false;
}
</script>
