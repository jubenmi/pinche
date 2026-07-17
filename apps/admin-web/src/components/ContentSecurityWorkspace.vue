<template>
  <section class="content-security-workspace">
    <header class="content-security-heading">
      <div>
        <p class="eyebrow">CONTENT SAFETY</p>
        <h2>内容安全</h2>
        <p>配置启动时未启用对应审核能力时，是否暂停接收新内容。</p>
      </div>
      <button class="secondary-action" type="button" :disabled="busy" @click="loadSettings">
        {{ loading ? "刷新中" : "刷新配置状态" }}
      </button>
    </header>

    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <p v-if="notice" class="loading-strip content-security-notice" role="status">{{ notice }}</p>

    <section class="capability-section" aria-labelledby="capability-heading">
      <div class="section-heading">
        <div>
          <p class="eyebrow">SERVICE STATUS</p>
          <h3 id="capability-heading">自动审核启动时配置状态</h3>
        </div>
        <span class="readonly-label">只读状态</span>
      </div>
      <dl class="capability-list">
        <div>
          <dt>图片</dt>
          <dd :class="capabilityClass('image')">
            {{ capabilityLabel("image") }}
          </dd>
        </div>
        <div>
          <dt>视频</dt>
          <dd :class="capabilityClass('video')">
            {{ capabilityLabel("video") }}
          </dd>
        </div>
        <div>
          <dt>文本</dt>
          <dd :class="capabilityClass('text')">
            {{ capabilityLabel("text") }}
          </dd>
        </div>
      </dl>
    </section>

    <form class="settings-form" @submit.prevent="saveSettings">
      <div class="section-heading">
        <div>
          <p class="eyebrow">FALLBACK POLICY</p>
          <h3>启动时未启用能力时的发布策略</h3>
        </div>
      </div>

      <label class="security-toggle master-toggle">
        <span class="toggle-copy">
          <strong>总开关</strong>
          <small>开启后，才会按下面各内容类型的设置执行拦截。</small>
        </span>
        <input
          v-model="securityState.settings.blockWhenUnavailable"
          type="checkbox"
          :disabled="busy || !canSave"
          aria-label="启动时能力未配置时拦截总开关"
        />
      </label>

      <fieldset class="type-settings" :disabled="busy || !canSave">
        <legend>内容类型</legend>
        <label class="security-toggle">
          <span class="toggle-copy">
            <strong>图片</strong>
            <small>图片 provider 未启用并重启后暂停新图片发布。</small>
          </span>
          <input
            v-model="securityState.settings.blockImageWhenUnavailable"
            type="checkbox"
            aria-label="启动时图片能力未配置时拦截"
          />
        </label>
        <label class="security-toggle">
          <span class="toggle-copy">
            <strong>视频</strong>
            <small>视频 provider 未启用并重启后暂停新视频发布。</small>
          </span>
          <input
            v-model="securityState.settings.blockVideoWhenUnavailable"
            type="checkbox"
            aria-label="启动时视频能力未配置时拦截"
          />
        </label>
        <label class="security-toggle">
          <span class="toggle-copy">
            <strong>文本</strong>
            <small>文本 provider 未启用并重启后暂停受约束文本发布。</small>
          </span>
          <input
            v-model="securityState.settings.blockTextWhenUnavailable"
            type="checkbox"
            aria-label="启动时文本能力未配置时拦截"
          />
        </label>
      </fieldset>

      <div class="settings-footer">
        <p>任务创建后发生的权限、额度或网络失败会保持隐藏并重试，不会改走直发；状态切换需修改 provider 配置并重启。</p>
        <button class="primary" type="submit" :disabled="busy || !canSave">
          {{ saving ? "保存中..." : "保存设置" }}
        </button>
      </div>
    </form>
  </section>
</template>

<script setup>
import { computed, onMounted, ref } from "vue";
import { getContentSecuritySettings, updateContentSecuritySettings } from "../api";
import {
  canSaveContentSecurity,
  contentSecurityCapabilityClass,
  contentSecurityCapabilityLabel,
  contentSecurityLoadFailed,
  contentSecurityLoadSucceeded,
  createContentSecurityState
} from "../contentSecurity";

const securityState = ref(createContentSecurityState());
const loading = ref(false);
const saving = ref(false);
const error = ref("");
const notice = ref("");
const busy = computed(() => loading.value || saving.value);
const canSave = computed(() => canSaveContentSecurity(securityState.value));

function capabilityLabel(type) {
  return contentSecurityCapabilityLabel(securityState.value, type);
}

function capabilityClass(type) {
  return contentSecurityCapabilityClass(securityState.value, type);
}

async function loadSettings() {
  loading.value = true;
  error.value = "";
  notice.value = "";
  try {
    securityState.value = contentSecurityLoadSucceeded(
      securityState.value,
      await getContentSecuritySettings()
    );
  } catch (err) {
    securityState.value = contentSecurityLoadFailed(securityState.value);
    error.value = err.message || "内容安全设置加载失败，请重试。";
  } finally {
    loading.value = false;
  }
}

async function saveSettings() {
  if (!canSave.value || busy.value) {
    return;
  }
  saving.value = true;
  error.value = "";
  notice.value = "";
  try {
    securityState.value = contentSecurityLoadSucceeded(
      securityState.value,
      await updateContentSecuritySettings(securityState.value.settings)
    );
    notice.value = "内容安全设置已保存。";
  } catch (err) {
    error.value = err.message || "内容安全设置保存失败，请重试。";
  } finally {
    saving.value = false;
  }
}

onMounted(loadSettings);
</script>

<style scoped>
.content-security-workspace {
  display: grid;
  gap: 18px;
  padding: 24px;
}

.content-security-heading,
.section-heading,
.settings-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
}

.content-security-heading h2,
.section-heading h3,
.content-security-heading p,
.settings-footer p {
  margin: 0;
}

.content-security-heading > div > p:last-child {
  margin-top: 8px;
  color: #68707b;
}

.capability-section,
.settings-form {
  border: 1px solid #dfe3e8;
  border-radius: 14px;
  background: #fff;
  padding: 20px;
}

.readonly-label {
  color: #68707b;
  font-size: 13px;
}

.capability-list {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  margin: 18px 0 0;
  border-top: 1px solid #eceff2;
}

.capability-list > div {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 18px 20px 0 0;
}

.capability-list dt {
  font-weight: 700;
}

.capability-list dd {
  margin: 0;
  font-weight: 700;
}

.capability-available {
  color: #17824d;
}

.capability-unavailable {
  color: #9b3c34;
}

.capability-unknown {
  color: #68707b;
}

.settings-form {
  display: grid;
  gap: 0;
}

.security-toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  min-height: 72px;
  border-bottom: 1px solid #eceff2;
}

.master-toggle {
  margin-top: 12px;
}

.toggle-copy {
  display: grid;
  gap: 5px;
}

.toggle-copy small,
.settings-footer p {
  color: #68707b;
}

.security-toggle input {
  width: 20px;
  height: 20px;
  flex: 0 0 auto;
  accent-color: #255fef;
}

.type-settings {
  margin: 18px 0 0;
  padding: 0;
  border: 0;
}

.type-settings legend {
  padding: 0;
  color: #68707b;
  font-size: 13px;
  font-weight: 700;
}

.settings-footer {
  align-items: flex-end;
  padding-top: 20px;
}

.content-security-notice {
  margin: 0;
}

@media (max-width: 720px) {
  .content-security-workspace {
    padding: 16px;
  }

  .content-security-heading,
  .settings-footer {
    align-items: stretch;
    flex-direction: column;
  }

  .capability-list {
    grid-template-columns: 1fr;
  }
}
</style>
