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
          @click="activeView = 'catalog'"
        >
          <span class="nav-icon">库</span>
          <span class="nav-text">资料库</span>
        </button>
        <button
          class="nav-item"
          :class="{ active: activeView === 'miniapp' }"
          type="button"
          @click="activeView = 'miniapp'"
        >
          <span class="nav-icon">用</span>
          <span class="nav-text">网页小程序</span>
        </button>
        <button
          class="nav-item"
          :class="{ active: activeView === 'album' }"
          type="button"
          @click="activeView = 'album'"
        >
          <span class="nav-icon">图</span>
          <span class="nav-text">车局相册</span>
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
          <span>{{ auth.user?.openid || auth.user?.open_id || "管理员" }}</span>
          <span class="user-avatar">管</span>
          <button type="button" @click="logout">退出</button>
        </div>
      </header>
      <CatalogWorkspace v-if="activeView === 'catalog'" />
      <MiniProgramWorkspace v-else-if="activeView === 'miniapp'" />
      <SessionAlbumWorkspace v-else />
      <div class="app-build-version">{{ buildVersion }}</div>
    </section>
  </div>
</template>

<script setup>
import { computed, ref } from "vue";
import { clearStoredAuth, getStoredAuth } from "./api";
import CatalogWorkspace from "./components/CatalogWorkspace.vue";
import LoginPanel from "./components/LoginPanel.vue";
import MiniProgramWorkspace from "./components/MiniProgramWorkspace.vue";
import SessionAlbumWorkspace from "./components/SessionAlbumWorkspace.vue";

const auth = ref(getStoredAuth());
const sidebarCollapsed = ref(false);
const initialSessionId = new URLSearchParams(window.location.search).get("sessionId");
const activeView = ref(initialSessionId ? "miniapp" : "catalog");
const buildVersion = `版本号 ${__PINCHE_BUILD_TIME__}`;
const pageTitle = computed(() => {
  if (activeView.value === "album") {
    return "我的车局相册";
  }
  if (activeView.value === "miniapp") {
    return "网页小程序";
  }
  return "剧本店与剧本管理";
});

function setAuth(nextAuth) {
  auth.value = nextAuth;
}

function logout() {
  clearStoredAuth();
  auth.value = getStoredAuth();
}
</script>
