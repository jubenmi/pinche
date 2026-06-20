<template>
  <LoginPanel v-if="!auth.token" @authenticated="setAuth" />
  <div v-else class="app-shell" :class="{ 'sidebar-collapsed': sidebarCollapsed }">
    <aside class="sidebar">
      <div class="brand">
        <span class="brand-mark">剧</span>
        <span class="brand-text">剧本迷管理</span>
      </div>
      <nav>
        <button class="nav-item active" type="button">
          <span class="nav-icon">库</span>
          <span class="nav-text">资料库</span>
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
          <h1>剧本店与剧本管理</h1>
        </div>
        <div class="user-box">
          <span>{{ auth.user?.openid || auth.user?.open_id || "管理员" }}</span>
          <span class="user-avatar">管</span>
          <button type="button" @click="logout">退出</button>
        </div>
      </header>
      <CatalogWorkspace />
      <div class="app-build-version">{{ buildVersion }}</div>
    </section>
  </div>
</template>

<script setup>
import { ref } from "vue";
import { clearStoredAuth, getStoredAuth } from "./api";
import CatalogWorkspace from "./components/CatalogWorkspace.vue";
import LoginPanel from "./components/LoginPanel.vue";

const auth = ref(getStoredAuth());
const sidebarCollapsed = ref(false);
const buildVersion = `版本 ${__PINCHE_BUILD_TIME__}`;

function setAuth(nextAuth) {
  auth.value = nextAuth;
}

function logout() {
  clearStoredAuth();
  auth.value = getStoredAuth();
}
</script>
