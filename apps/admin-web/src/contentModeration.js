const PROVIDERS = Object.freeze([
  "wechat_sec_check",
  "tencent_ci_video"
]);

const WECHAT_SUBJECT_TYPES = Object.freeze([
  "user_nickname",
  "private_store",
  "private_script",
  "session_create",
  "session_update",
  "session_npc_role",
  "session_review",
  "session_message",
  "session_pinned_message",
  "album_image"
]);

const TENCENT_SUBJECT_TYPES = Object.freeze(["album_video"]);

export const moderationProviderOptions = Object.freeze([
  { value: "wechat_sec_check", label: "微信内容安全" },
  { value: "tencent_ci_video", label: "腾讯云视频审核" }
]);

export const moderationStatusOptions = Object.freeze([
  { value: "review", label: "待人工复核" },
  { value: "error", label: "审核异常" }
]);

export function moderationSubjectTypesForProvider(provider = "") {
  if (provider === "wechat_sec_check") return WECHAT_SUBJECT_TYPES;
  if (provider === "tencent_ci_video") return TENCENT_SUBJECT_TYPES;
  return [...WECHAT_SUBJECT_TYPES, ...TENCENT_SUBJECT_TYPES];
}

export function moderationProviderLabel(value) {
  return moderationProviderOptions.find((item) => item.value === value)?.label || "未知服务商";
}

export function moderationStatusLabel(value) {
  return moderationStatusOptions.find((item) => item.value === value)?.label || "未知状态";
}

export function moderationSubjectTypeLabel(value) {
  const labels = {
    user_nickname: "用户昵称",
    private_store: "私有店家资料",
    private_script: "私有剧本资料",
    session_create: "拼车创建",
    session_update: "拼车编辑",
    session_npc_role: "NPC 角色",
    session_review: "车局评价",
    session_message: "车局留言",
    session_pinned_message: "置顶留言",
    album_image: "相册图片",
    album_video: "相册视频"
  };
  return labels[value] || String(value || "未知内容");
}

export function isMediaModeration(job = {}) {
  return ["album_image", "album_video"].includes(String(job.subject_type || ""));
}

export function formatModerationScore(value) {
  if (value === undefined || value === null || value === "") return "-";
  const score = Number(value);
  return Number.isFinite(score) ? String(score) : "-";
}

function optionalText(value) {
  const text = String(value ?? "").trim();
  return text || "";
}

function listLimit(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= 200
    ? String(parsed)
    : "100";
}

// Never forward generic workspace filters such as keyword. The server rejects
// unknown query keys by design, so this keeps the UI within the D45.11 allowlist.
export function buildModerationListFilters(input = {}) {
  const result = {};
  for (const key of ["provider", "type", "status", "label", "dateFrom", "dateTo"]) {
    const value = optionalText(input[key]);
    if (value) result[key] = value;
  }
  result.limit = listLimit(input.limit);
  return result;
}

export function moderationDecisionBody(action, reason = "") {
  if (action === "approve" || action === "retry") return {};
  if (action !== "reject") throw new Error("不支持的审核操作。");
  const normalized = String(reason || "").trim();
  if (!normalized || [...normalized].length > 500) {
    throw new Error("拒绝原因不能为空且不能超过 500 个字符。");
  }
  return { reason: normalized };
}
