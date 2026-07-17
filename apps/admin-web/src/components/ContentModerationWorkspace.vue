<template>
  <section class="moderation-workspace" :class="{ 'moderation-drawer-open': detail }">
    <div class="moderation-panel">
      <div class="moderation-heading">
        <div>
          <p class="eyebrow">CONTENT SAFETY</p>
          <h2>内容审核队列</h2>
          <p>仅显示仍需人工处理或重试的审核任务。</p>
        </div>
        <span class="moderation-count">当前 {{ rows.length }} 条</span>
      </div>

      <form class="toolbar toolbar-primary moderation-toolbar" @submit.prevent="loadQueue">
        <div class="filter-group">
          <select v-model="filters.provider" name="moderationProvider" aria-label="审核服务商" :disabled="busy" @change="changeProvider">
            <option value="">全部服务商</option>
            <option v-for="provider in moderationProviderOptions" :key="provider.value" :value="provider.value">
              {{ provider.label }}
            </option>
          </select>
          <select v-model="filters.type" name="moderationType" aria-label="审核内容类型" :disabled="busy">
            <option value="">全部内容类型</option>
            <option v-for="type in typeOptions" :key="type" :value="type">
              {{ moderationSubjectTypeLabel(type) }}
            </option>
          </select>
          <select v-model="filters.status" name="moderationStatus" aria-label="审核任务状态" :disabled="busy">
            <option value="">复核与异常</option>
            <option v-for="status in moderationStatusOptions" :key="status.value" :value="status.value">
              {{ status.label }}
            </option>
          </select>
          <input
            v-model.trim="filters.label"
            name="moderationLabel"
            aria-label="风险标签（精确匹配）"
            maxlength="64"
            placeholder="风险标签（精确）"
            :disabled="busy"
          />
          <label class="moderation-date-field">
            <span>创建自</span>
            <input v-model="filters.dateFrom" name="moderationDateFrom" type="date" :disabled="busy" />
          </label>
          <label class="moderation-date-field">
            <span>至</span>
            <input v-model="filters.dateTo" name="moderationDateTo" type="date" :disabled="busy" />
          </label>
          <button type="submit" :disabled="busy">{{ busy ? "加载中" : "筛选" }}</button>
        </div>
      </form>
    </div>

    <p v-if="error" class="error">{{ error }}</p>
    <p v-if="notice" class="loading-strip moderation-notice">{{ notice }}</p>

    <div class="table-card moderation-table-card">
      <div class="moderation-table-scroll">
        <table class="data-table moderation-table">
          <thead>
            <tr>
              <th>关联内容</th>
              <th>服务商</th>
              <th>提交者</th>
              <th>建议 / 标签</th>
              <th>状态</th>
              <th>尝试 / 错误</th>
              <th>提交 / 创建</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="item in rows"
              :key="item.id"
              :class="{ 'selected-row': Number(item.id) === Number(selectedJobId) }"
              @dblclick="openDetail(item)"
            >
              <td>
                <strong class="cell-title">{{ moderationSubjectTypeLabel(item.subject_type) }}</strong>
                <small class="muted-cell">{{ entitySummary(item) }}</small>
              </td>
              <td>{{ moderationProviderLabel(item.provider) }}</td>
              <td>用户 #{{ item.submitter_user_id || "-" }}</td>
              <td>
                <strong>{{ suggestionLabel(item.suggestion) }}</strong>
                <small class="muted-cell">{{ labelSummary(item) }}</small>
              </td>
              <td><span class="status-pill" :class="item.status">{{ moderationStatusLabel(item.status) }}</span></td>
              <td>
                <span>{{ Number(item.attempt_count || 0) }} 次</span>
                <small class="muted-cell">{{ retrySummary(item) }}</small>
              </td>
              <td>
                <span>{{ formatDateTime(item.submitted_at || item.created_at) }}</span>
                <small class="muted-cell">创建 {{ formatDateTime(item.created_at) }}</small>
              </td>
              <td class="row-actions">
                <button class="action-button" type="button" :disabled="busy" @click.stop="openDetail(item)">
                  查看
                </button>
              </td>
            </tr>
            <tr v-if="!busy && rows.length === 0">
              <td class="empty-cell" colspan="8">当前筛选下没有待处理审核任务。</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="table-footer">
        <span>队列最多展示 100 条当前任务，不代表历史全量。</span>
        <button type="button" :disabled="busy" @click="loadQueue">刷新</button>
      </div>
    </div>

    <aside v-if="detail" class="drawer moderation-drawer" aria-label="内容审核详情">
      <div class="drawer-head">
        <div>
          <p class="eyebrow">TASK #{{ detail.id }}</p>
          <h2>{{ moderationSubjectTypeLabel(detail.subject_type) }}</h2>
          <p>{{ entitySummary(detail) }}</p>
        </div>
        <button class="close-button" type="button" :disabled="busy" @click="closeDetail">关闭</button>
      </div>

      <div class="drawer-body moderation-drawer-body">
        <div class="moderation-detail-status">
          <span class="status-pill" :class="detail.status">{{ moderationStatusLabel(detail.status) }}</span>
          <span>{{ moderationProviderLabel(detail.provider) }}</span>
        </div>

        <dl class="moderation-detail-grid">
          <div><dt>提交者</dt><dd>用户 #{{ detail.submitter_user_id || "-" }}</dd></div>
          <div><dt>建议</dt><dd>{{ suggestionLabel(detail.suggestion) }}</dd></div>
          <div><dt>风险标签</dt><dd>{{ labelSummary(detail) }}</dd></div>
          <div><dt>评分</dt><dd>{{ formatModerationScore(detail.score) }}</dd></div>
          <div><dt>尝试次数</dt><dd>{{ Number(detail.attempt_count || 0) }}</dd></div>
          <div><dt>下次重试</dt><dd>{{ formatDateTime(detail.next_retry_at) }}</dd></div>
          <div><dt>上次错误</dt><dd>{{ detail.last_error_code || "无" }}</dd></div>
          <div><dt>提交时间</dt><dd>{{ formatDateTime(detail.submitted_at) }}</dd></div>
          <div><dt>创建时间</dt><dd>{{ formatDateTime(detail.created_at) }}</dd></div>
          <div><dt>更新时间</dt><dd>{{ formatDateTime(detail.updated_at) }}</dd></div>
        </dl>

        <section v-if="detail.text" class="moderation-detail-section">
          <div class="moderation-section-head">
            <h3>待审核文本</h3>
            <span>{{ detail.text.action }}</span>
          </div>
          <dl class="moderation-text-fields">
            <div v-for="([field, value]) in textFields" :key="field">
              <dt>{{ textFieldLabel(field) }}</dt>
              <dd>{{ value }}</dd>
            </div>
          </dl>
        </section>

        <section v-if="detail.media" class="moderation-detail-section">
          <div class="moderation-section-head">
            <h3>媒体预览</h3>
            <button class="action-button" type="button" :disabled="busy || detailLoading" @click="refreshDetail">
              {{ detailLoading ? "刷新中" : "刷新预览" }}
            </button>
          </div>
          <dl class="moderation-detail-grid moderation-media-meta">
            <div><dt>会话</dt><dd>#{{ detail.media.session_id || "-" }}</dd></div>
            <div><dt>上传者</dt><dd>用户 #{{ detail.media.uploader_user_id || "-" }}</dd></div>
            <div><dt>处理状态</dt><dd>{{ detail.media.processing_status || "-" }}</dd></div>
            <div><dt>审核状态</dt><dd>{{ detail.media.moderation_status || "-" }}</dd></div>
            <div><dt>预览到期</dt><dd>{{ formatDateTime(detail.media.preview_expires_at) }}</dd></div>
          </dl>
          <div v-if="detail.media.preview_url && !previewFailed" class="moderation-media-preview">
            <img
              v-if="detail.media.media_type === 'image'"
              :src="detail.media.preview_url"
              alt="待审核媒体预览"
              referrerpolicy="no-referrer"
              @error="previewFailed = true"
            />
            <video
              v-else-if="detail.media.media_type === 'video'"
              :src="detail.media.preview_url"
              controls
              preload="metadata"
              referrerpolicy="no-referrer"
              @error="previewFailed = true"
            ></video>
          </div>
          <p v-else class="warning">预览暂不可用或已过期，请刷新详情后重试。</p>
        </section>

        <section v-if="canDecide" class="moderation-detail-section moderation-decision-section">
          <div class="moderation-section-head">
            <h3>人工决定</h3>
            <span>操作后队列会重新加载</span>
          </div>
          <label class="moderation-reason-field">
            <span>拒绝原因（拒绝时必填）</span>
            <textarea
              v-model="rejectReason"
              name="moderationRejectReason"
              maxlength="500"
              rows="3"
              :disabled="busy"
              placeholder="说明拒绝该内容的原因"
            ></textarea>
          </label>
        </section>
      </div>

      <div class="drawer-footer moderation-drawer-footer">
        <button v-if="canApprove" class="primary" type="button" :disabled="busy" @click="runDecision('approve')">
          批准
        </button>
        <button v-if="canReject" class="action-button danger" type="button" :disabled="busy" @click="runDecision('reject')">
          拒绝
        </button>
        <button v-if="canRetry" class="secondary-action" type="button" :disabled="busy" @click="runDecision('retry')">
          重新审核
        </button>
      </div>
    </aside>
  </section>
</template>

<script setup>
import { computed, onMounted, ref } from "vue";
import {
  approveContentModerationJob,
  getContentModerationJob,
  listContentModerationJobs,
  rejectContentModerationJob,
  retryContentModerationJob
} from "../api";
import {
  formatModerationScore,
  isMediaModeration,
  moderationDecisionBody,
  moderationProviderLabel,
  moderationProviderOptions,
  moderationStatusLabel,
  moderationStatusOptions,
  moderationSubjectTypeLabel,
  moderationSubjectTypesForProvider
} from "../contentModeration";

const rows = ref([]);
const detail = ref(null);
const selectedJobId = ref(null);
const error = ref("");
const notice = ref("");
const listLoading = ref(false);
const detailLoading = ref(false);
const actionLoading = ref(false);
const rejectReason = ref("");
const previewFailed = ref(false);
const filters = ref({
  provider: "",
  type: "",
  status: "",
  label: "",
  dateFrom: "",
  dateTo: "",
  limit: "100"
});

const busy = computed(() => listLoading.value || detailLoading.value || actionLoading.value);
const typeOptions = computed(() => moderationSubjectTypesForProvider(filters.value.provider));
const canApprove = computed(() => ["review", "error"].includes(detail.value?.status));
const canReject = computed(() => ["review", "error"].includes(detail.value?.status));
const canRetry = computed(() => detail.value?.status === "error");
const canDecide = computed(() => canApprove.value || canReject.value || canRetry.value);
const textFields = computed(() => Object.entries(detail.value?.text?.fields || {}));

function changeProvider() {
  if (!typeOptions.value.includes(filters.value.type)) {
    filters.value.type = "";
  }
}

function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
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

function suggestionLabel(value) {
  const labels = {
    pass: "建议通过",
    review: "建议复核",
    risky: "建议拦截",
    block: "建议拦截",
    error: "结果异常"
  };
  return labels[value] || value || "-";
}

function labelSummary(item) {
  return [item.label, item.sub_label].filter(Boolean).join(" / ") || "未标注";
}

function retrySummary(item) {
  if (item.last_error_code) return item.last_error_code;
  if (item.next_retry_at) return `下次 ${formatDateTime(item.next_retry_at)}`;
  return "无";
}

function entitySummary(item) {
  const summary = [`#${item.subject_id || "-"}`];
  if (isMediaModeration(item) && item.media?.session_id) {
    summary.push(`会话 #${item.media.session_id}`);
  }
  return summary.join(" · ");
}

function textFieldLabel(value) {
  return String(value || "").replaceAll("_", " ");
}

function closeDetail() {
  detail.value = null;
  selectedJobId.value = null;
  rejectReason.value = "";
  previewFailed.value = false;
}

async function loadQueue() {
  if (busy.value) return;
  listLoading.value = true;
  error.value = "";
  notice.value = "";
  closeDetail();
  try {
    rows.value = await listContentModerationJobs(filters.value);
  } catch (err) {
    rows.value = [];
    error.value = err.message || "内容审核队列加载失败。";
  } finally {
    listLoading.value = false;
  }
}

async function openDetail(item) {
  if (busy.value || !item?.id) return;
  selectedJobId.value = item.id;
  detailLoading.value = true;
  error.value = "";
  notice.value = "";
  previewFailed.value = false;
  try {
    detail.value = await getContentModerationJob(item.id);
  } catch (err) {
    selectedJobId.value = null;
    detail.value = null;
    error.value = err.message || "审核详情加载失败。";
  } finally {
    detailLoading.value = false;
  }
}

function refreshDetail() {
  if (detail.value?.id) {
    openDetail({ id: detail.value.id });
  }
}

function decisionLabel(action) {
  return {
    approve: "批准",
    reject: "拒绝",
    retry: "重新审核"
  }[action] || "处理";
}

async function reloadAfterConflict() {
  closeDetail();
  listLoading.value = true;
  try {
    rows.value = await listContentModerationJobs(filters.value);
  } catch (err) {
    rows.value = [];
    error.value = err.message || "内容审核队列刷新失败。";
  } finally {
    listLoading.value = false;
  }
}

async function runDecision(action) {
  if (busy.value || !detail.value?.id) return;
  let body;
  try {
    body = moderationDecisionBody(action, rejectReason.value);
  } catch (err) {
    error.value = err.message;
    return;
  }
  const label = decisionLabel(action);
  if (!window.confirm(`确认${label}此审核任务吗？`)) return;

  actionLoading.value = true;
  error.value = "";
  notice.value = "";
  const jobId = detail.value.id;
  try {
    const result = action === "approve"
      ? await approveContentModerationJob(jobId)
      : action === "reject"
        ? await rejectContentModerationJob(jobId, body.reason)
        : await retryContentModerationJob(jobId);
    notice.value = result.stale
      ? "内容基线已变化，批准未应用，任务已按当前状态关闭。"
      : `${label}成功，队列已刷新。`;
    await reloadAfterConflict();
  } catch (err) {
    const statusCode = Number(err.statusCode || err.status || 0);
    if (statusCode === 404 || statusCode === 409) {
      notice.value = "任务状态已变化，已刷新队列。";
      await reloadAfterConflict();
    } else {
      error.value = err.message || `${label}失败。`;
    }
  } finally {
    actionLoading.value = false;
  }
}

onMounted(loadQueue);
</script>
