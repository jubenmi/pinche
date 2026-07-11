import { withDatabaseConnection, withTransaction } from "../../db/mysql.js";
import {
  AppError,
  badRequest,
  conflict,
  forbidden,
  notFound,
  phoneRequired
} from "../../http/errors.js";
import { ensureRole } from "../auth/users.js";
import { isAdmin, requireSessionOwner } from "./session-access.js";
import { runSessionExtensionHook } from "../extensions/registry.js";
import {
  notifySignupCreated,
  notifySignupReviewed
} from "../wechat/subscribe-message.js";
import { createIdempotentAlbumVideo } from "../album-video/lifecycle.js";

const ALBUM_VIDEO_MAX_DURATION_SECONDS = 60;
const ALBUM_VIDEO_MAX_DIMENSION = 4_294_967_295;
const ALBUM_VIDEO_PROCESSING_STATUSES = new Set(["processing", "ready", "failed"]);

function requireValue(body, key) {
  const value = body[key];
  if (value === undefined || value === null || value === "") {
    throw badRequest(`${key} is required`);
  }
  return value;
}

function intValue(value, fallback = 0) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    throw badRequest("Expected integer value");
  }
  return parsed;
}

function optionalText(value) {
  if (value === undefined || value === null) {
    return null;
  }
  return String(value);
}

function optionalCoordinate(value, fieldName, min, max) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw badRequest(`${fieldName} must be a finite number`);
  }
  if (number < min || number > max) {
    throw badRequest(`${fieldName} must be between ${min} and ${max}`);
  }
  return number;
}

function optionalLatitude(value) {
  return optionalCoordinate(value, "latitude", -90, 90);
}

function optionalLongitude(value) {
  return optionalCoordinate(value, "longitude", -180, 180);
}

function jsonText(value) {
  if (value === undefined || value === null) {
    return null;
  }
  return Array.isArray(value) ? JSON.stringify(value) : String(value);
}

function jsonColumn(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  if (typeof value === "string") {
    try {
      JSON.parse(value);
    } catch (error) {
      throw badRequest("Expected valid JSON value");
    }
    return value;
  }

  return JSON.stringify(value);
}

function likeKeyword(value) {
  return `%${String(value).trim()}%`;
}

function limitValue(value, fallback = 50) {
  const parsed = intValue(value, fallback);
  return Math.min(Math.max(parsed, 1), 100);
}

function positiveId(value, label = "id") {
  const parsed = intValue(value);
  if (parsed <= 0) {
    throw badRequest(`${label} must be a positive integer`);
  }
  return parsed;
}

function uniquePositiveIds(values, label = "ids") {
  if (!Array.isArray(values)) {
    throw badRequest(`${label} must be an array`);
  }

  const seen = new Set();
  const ids = [];
  for (const value of values) {
    const id = positiveId(value, label);
    if (!seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }
  return ids;
}

async function countRows(connection, sql, values) {
  const [rows] = await connection.query(sql, values);
  return Number(rows[0]?.count || rows[0]?.COUNT || 0);
}

function normalizeRequestType(value) {
  if (!["store", "script"].includes(value)) {
    throw badRequest("requestType must be store or script");
  }
  return value;
}

function normalizeEntityType(value) {
  if (!["store", "script"].includes(value)) {
    throw badRequest("entityType must be store or script");
  }
  return value;
}

function normalizeCatalogVisibility(value = "public") {
  const visibility = String(value || "public").trim();
  if (!["public", "private"].includes(visibility)) {
    throw badRequest("visibility must be public or private");
  }
  return visibility;
}

function normalizeSessionVisibility(value = "share_only") {
  const visibility = String(value).trim();
  if (!["public", "share_only"].includes(visibility)) {
    throw badRequest("visibility must be public or share_only");
  }
  return visibility;
}

function normalizeDiscoveryCity(value) {
  if (value === undefined || value === null || value === "") {
    return "";
  }
  const city = String(value).trim().replace(/\s+/g, " ");
  if (!city || Array.from(city).length > 64) {
    throw badRequest("city must be between 1 and 64 characters");
  }
  assertPublicTextSafe("city", city);
  return city;
}

function discoveryCityVariants(city) {
  if (!city) {
    return [];
  }
  const withoutCitySuffix = city.endsWith("市") ? city.slice(0, -1) : city;
  return [...new Set([city, withoutCitySuffix, `${withoutCitySuffix}市`])].filter(Boolean);
}

function normalizeCatalogReviewStatus(value = "approved") {
  const status = String(value || "approved").trim();
  if (!["pending", "needs_changes", "approved", "rejected", "merged"].includes(status)) {
    throw badRequest("reviewStatus must be pending, needs_changes, approved, rejected, or merged");
  }
  return status;
}

function catalogVisibility(row = {}) {
  return normalizeCatalogVisibility(row.visibility || "public");
}

function catalogReviewStatus(row = {}) {
  return normalizeCatalogReviewStatus(row.review_status || "approved");
}

function isPublicCatalogUsable(row = {}) {
  return (
    catalogVisibility(row) === "public" &&
    catalogReviewStatus(row) === "approved" &&
    String(row.status || "active") === "active"
  );
}

function isPrivateCatalogUsableByUser(row = {}, user) {
  return (
    user?.user?.id &&
    catalogVisibility(row) === "private" &&
    Number(row.created_by_user_id || 0) === Number(user.user.id) &&
    ["pending", "needs_changes"].includes(catalogReviewStatus(row)) &&
    String(row.status || "active") === "active"
  );
}

function assertCatalogUsableForSession(row, user, label) {
  if (!row) {
    throw notFound(`${label} not found`);
  }
  if (isPublicCatalogUsable(row) || isPrivateCatalogUsableByUser(row, user)) {
    return;
  }
  if (catalogVisibility(row) === "private" && Number(row.created_by_user_id || 0) !== Number(user.user.id)) {
    throw notFound(`${label} not found`);
  }
  throw badRequest(`${label} is not available for session creation`);
}

function catalogBadge(row = {}) {
  if (catalogVisibility(row) !== "private") {
    return "";
  }
  const status = catalogReviewStatus(row);
  if (status === "pending") {
    return "仅自己可用";
  }
  if (status === "needs_changes") {
    return "需补充";
  }
  return status;
}

function catalogResponse(row = {}) {
  return {
    ...row,
    visibility: catalogVisibility(row),
    review_status: catalogReviewStatus(row),
    catalog_badge: catalogBadge(row)
  };
}

function normalizeRoleGender(value) {
  const roleGender = String(value || "unlimited").trim();
  if (!["male", "female", "unlimited"].includes(roleGender)) {
    throw badRequest("roleGender must be male, female, or unlimited");
  }
  return roleGender;
}

function normalizeJoinPolicy(value) {
  const policy = String(value || "review_required").trim();
  if (!["direct", "review_required"].includes(policy)) {
    throw badRequest("joinPolicy must be direct or review_required");
  }
  return policy;
}

function normalizeJoinPhoneRequired(value) {
  if (value === undefined || value === null || value === "") {
    return true;
  }
  if (typeof value === "boolean") {
    return value;
  }
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "required", "enabled"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "optional", "disabled"].includes(normalized)) {
    return false;
  }
  throw badRequest("joinPhoneRequired must be true or false");
}

function normalizeNpcJoinEnabled(value) {
  if (value === undefined || value === null || value === "") {
    return true;
  }
  if (typeof value === "boolean") {
    return value;
  }
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "enabled"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "disabled"].includes(normalized)) {
    return false;
  }
  throw badRequest("npcJoinEnabled must be true or false");
}

const REMOVAL_REASON_LABELS = {
  normal_release: "普通释放",
  harassment: "恶意骚扰",
  spam: "垃圾信息",
  scam: "疑似诈骗",
  safety_other: "其他安全原因"
};
const BLOCKING_REMOVAL_REASONS = new Set([
  "harassment",
  "spam",
  "scam",
  "safety_other"
]);

function normalizeRemovalReasonType(value, report = false) {
  if (!report) {
    return "normal_release";
  }
  const reasonType = String(value || "harassment").trim();
  if (!Object.hasOwn(REMOVAL_REASON_LABELS, reasonType)) {
    throw badRequest("reasonType must be normal_release, harassment, spam, scam, or safety_other");
  }
  return reasonType;
}

function removalReasonLabel(reasonType) {
  return REMOVAL_REASON_LABELS[reasonType] || REMOVAL_REASON_LABELS.safety_other;
}

function nonNegativeIntValue(value, label) {
  const parsed = intValue(value, 0);
  if (parsed < 0) {
    throw badRequest(`${label} cannot be negative`);
  }
  return parsed;
}

function positiveIntValue(value, label) {
  const parsed = intValue(value, 0);
  if (parsed <= 0) {
    throw badRequest(`${label} must be a positive integer`);
  }
  return parsed;
}

function parseRoleTemplate(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  if (Array.isArray(value)) {
    return value;
  }

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return parsed;
      }
    } catch (error) {
      throw badRequest("defaultSeatTemplate must be a valid JSON array");
    }
  }

  throw badRequest("defaultSeatTemplate must be an array");
}

function normalizeRoleTemplateItem(role = {}, index = 0) {
  const name = String(
    role.name || role.roleName || role.role_name || `角色${index + 1}`
  ).trim();
  const description = String(
    role.description ||
      role.roleDescription ||
      role.role_description ||
      role.roleName ||
      role.role_name ||
      ""
  ).trim();

  return {
    ...(role.id ? { id: String(role.id) } : {}),
    name: name || `角色${index + 1}`,
    description,
    roleGender: normalizeRoleGender(role.roleGender || role.role_gender)
  };
}

function roleTemplateJson(value) {
  const parsed = parseRoleTemplate(value);
  if (parsed === null) {
    return null;
  }
  return JSON.stringify(parsed.map(normalizeRoleTemplateItem));
}

function defaultPrivateRoleTemplate(playerCount) {
  return Array.from({ length: playerCount }, (_, index) => ({
    name: `角色${index + 1}`,
    description: "",
    roleGender: "unlimited"
  }));
}

function privateRoleTemplateJson(value, playerCount) {
  const parsed = parseRoleTemplate(value) || defaultPrivateRoleTemplate(playerCount);
  const normalized = parsed.map(normalizeRoleTemplateItem);
  for (const role of normalized) {
    assertPublicTextSafe("roleName", role.name);
    assertPublicTextSafe("roleDescription", role.description);
  }
  return JSON.stringify(normalized);
}

function parseNpcRoles(value) {
  if (value === undefined || value === null || value === "") {
    return [];
  }
  if (Array.isArray(value)) {
    return value;
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return parsed;
      }
    } catch (error) {
      return String(value)
        .split(/\r?\n|[，,]/)
        .map((name) => ({ name }));
    }
  }
  throw badRequest("npcRoles must be an array");
}

function normalizeNpcRoleSource(value, fallback = "session") {
  const source = String(value || fallback).trim();
  if (!["script", "session"].includes(source)) {
    throw badRequest("npc role source must be script or session");
  }
  return source;
}

function normalizeNpcRole(role = {}, index = 0, options = {}) {
  const sourceRole = typeof role === "string" ? { name: role } : role || {};
  const name = String(
    sourceRole.name || sourceRole.roleName || sourceRole.role_name || sourceRole.label || ""
  ).trim();
  if (!name) {
    return null;
  }
  const boundUserValue =
    sourceRole.boundUserId ?? sourceRole.bound_user_id ?? sourceRole.userId ?? sourceRole.user_id;
  return {
    ...(sourceRole.id ? { id: Number(sourceRole.id) } : {}),
    ...(sourceRole.scriptNpcRoleId || sourceRole.script_npc_role_id
      ? {
          scriptNpcRoleId: positiveId(
            sourceRole.scriptNpcRoleId || sourceRole.script_npc_role_id,
            "scriptNpcRoleId"
          )
        }
      : {}),
    name,
    description: optionalText(
      sourceRole.description || sourceRole.note || sourceRole.roleDescription || ""
    ),
    roleGender: normalizeRoleGender(
      sourceRole.roleGender || sourceRole.role_gender || sourceRole.gender
    ),
    source: normalizeNpcRoleSource(sourceRole.source, options.source || "session"),
    boundUserId:
      boundUserValue === undefined || boundUserValue === null || boundUserValue === ""
        ? null
        : positiveId(boundUserValue, "boundUserId"),
    sortOrder: nonNegativeIntValue(sourceRole.sortOrder ?? sourceRole.sort_order ?? index, "sortOrder")
  };
}

function normalizeNpcRoles(value, options = {}) {
  return parseNpcRoles(value)
    .map((role, index) => normalizeNpcRole(role, index, options))
    .filter(Boolean);
}

function assertPayable(basePrice, adjustment) {
  const payablePrice = basePrice + adjustment;
  if (payablePrice < 0) {
    throw badRequest("payable_price cannot be negative");
  }
  return payablePrice;
}

function requireVerifiedPhone(user) {
  if (!user?.user?.phoneVerifiedAt) {
    throw phoneRequired();
  }
}

function requireJoinPhoneIfNeeded(user, sessionLike = {}) {
  if (Number(sessionLike.join_phone_required ?? 1) === 1) {
    requireVerifiedPhone(user);
  }
}

const PUBLIC_TEXT_REPLACEMENTS = [
  ["恋陪位", "情感沉浸位"],
  ["恋陪", "沉浸"],
  ["爱D", "指定DM/NPC"],
  ["主陪位", "主线互动位"]
];
const PUBLIC_TEXT_RISK_WORDS = [
  "红包",
  "返现",
  "提现",
  "现金奖励",
  "分享奖励",
  "拉人奖励",
  "拉新奖励",
  "抽奖",
  "优先锁座",
  "现实陪伴",
  "线下陪伴",
  "联系方式",
  "手机号",
  "微信号",
  "加微信",
  "牵手",
  "小黑屋",
  "恋陪",
  "爱D"
];
const MESSAGE_TEXT_RISK_WORDS = [
  "红包",
  "返现",
  "提现",
  "现金奖励",
  "分享奖励",
  "拉人奖励",
  "拉新奖励",
  "抽奖",
  "收款码",
  "平台代收"
];
const MAX_SESSION_REVIEW_PHOTOS = 9;
const SESSION_REVIEW_PHOTO_PREFIX = "/uploads/session-reviews/";

function reviewRating(value) {
  const rating = intValue(value);
  if (rating < 1 || rating > 5) {
    throw badRequest("rating must be between 1 and 5");
  }
  return rating;
}

function reviewContent(value) {
  const content = optionalText(value);
  if (content && content.length > 500) {
    throw badRequest("content must be 500 characters or fewer");
  }
  assertPublicTextSafe("content", content);
  return content;
}

function assertSessionReviewPhotoUrls(photoUrls) {
  const urls = photoUrls === undefined ? [] : photoUrls;
  if (!Array.isArray(urls)) {
    throw badRequest("photoUrls must be an array");
  }
  if (urls.length > MAX_SESSION_REVIEW_PHOTOS) {
    throw badRequest(`photoUrls cannot contain more than ${MAX_SESSION_REVIEW_PHOTOS} photos`);
  }
  return urls.map((url) => {
    const text = String(url || "").trim();
    if (!text.startsWith(SESSION_REVIEW_PHOTO_PREFIX)) {
      throw badRequest("photoUrls must contain uploaded session review photos");
    }
    if (!/^\/uploads\/session-reviews\/[A-Za-z0-9._-]+$/.test(text)) {
      throw badRequest("photoUrls contains an invalid file path");
    }
    return text;
  });
}

function booleanValue(value, fallback = true) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  if (value === true || value === 1 || value === "1") {
    return true;
  }
  if (value === false || value === 0 || value === "0") {
    return false;
  }
  const text = String(value).trim().toLowerCase();
  if (["true", "yes", "on"].includes(text)) {
    return true;
  }
  if (["false", "no", "off"].includes(text)) {
    return false;
  }
  throw badRequest("Expected boolean value");
}

function sessionAlbumPhotoUrl(sessionId, userId, value) {
  const text = String(value || "").trim();
  const sessionIdText = String(positiveId(sessionId, "sessionId"));
  const userIdText = String(positiveId(userId, "userId"));
  const pattern = new RegExp(
    `^\\/uploads\\/session-album\\/display\\/(?:admin-)?album-${sessionIdText}-${userIdText}-\\d+-[a-f0-9]{16}\\.jpg$`
  );
  if (!pattern.test(text)) {
    throw badRequest("photoUrl must contain an uploaded session album display photo");
  }
  return text;
}

function sessionAlbumVideoSourceUrl(sessionId, userId, value) {
  const text = String(value || "").trim();
  const sessionIdText = String(positiveId(sessionId, "sessionId"));
  const userIdText = String(positiveId(userId, "userId"));
  const pattern = new RegExp(
    `^\\/uploads\\/session-album\\/videos\\/source\\/admin-video-${sessionIdText}-${userIdText}-\\d+-[a-f0-9]{16}\\.mp4$`
  );
  if (!pattern.test(text)) {
    throw badRequest("sourceUrl must contain an uploaded session album video");
  }
  return text;
}

function albumMediaType(row = {}) {
  return row.media_type === "video" ? "video" : "image";
}

function albumMediaProcessingStatus(row = {}) {
  const status = row.processing_status || "ready";
  return ALBUM_VIDEO_PROCESSING_STATUSES.has(status) ? status : "processing";
}

function albumVideoDurationSeconds(value) {
  const durationSeconds = requiredPositiveInteger(value, "durationSeconds");
  if (durationSeconds > ALBUM_VIDEO_MAX_DURATION_SECONDS) {
    throw badRequest("durationSeconds must be at most 60 seconds");
  }
  return durationSeconds;
}

function albumVideoContentType(value) {
  const contentType = String(value || "video/mp4").trim().toLowerCase();
  if (contentType !== "video/mp4") {
    throw badRequest("videoContentType must be video/mp4");
  }
  return contentType;
}

function albumVideoProcessingCallbackStatus(value) {
  const status = String(value || "").trim().toLowerCase();
  if (["ready", "success", "succeeded", "complete", "completed", "done"].includes(status)) {
    return "ready";
  }
  if (status.includes("fail") || status.includes("error")) {
    return "failed";
  }
  return "processing";
}

function albumVideoUploadPath(value, allowedKinds, fieldName) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  let pathText = String(value).trim();
  if (/^https?:\/\//i.test(pathText)) {
    try {
      pathText = new URL(pathText).pathname;
    } catch {
      throw badRequest(`${fieldName} must be a valid album video object path`);
    }
  }
  pathText = pathText.split("?")[0];
  try {
    pathText = decodeURIComponent(pathText);
  } catch {
    throw badRequest(`${fieldName} must be a valid album video object path`);
  }
  if (!pathText.startsWith("/")) {
    pathText = `/${pathText}`;
  }

  const match = pathText.match(
    /^\/uploads\/session-album\/videos\/(source|display|cover)\/[A-Za-z0-9._-]+$/
  );
  if (!match || !allowedKinds.has(match[1])) {
    throw badRequest(`${fieldName} must be a valid album video ${[...allowedKinds].join("/")} path`);
  }
  if ((match[1] === "source" || match[1] === "display") && !pathText.endsWith(".mp4")) {
    throw badRequest(`${fieldName} must be an MP4 album video path`);
  }
  if (match[1] === "cover" && !/\.(?:jpg|jpeg)$/i.test(pathText)) {
    throw badRequest(`${fieldName} must be a JPG album video cover path`);
  }
  return pathText;
}

function deriveAlbumVideoDisplayUrl(sourceUrl) {
  const filename = String(sourceUrl || "").split("/").pop();
  if (!filename || !filename.endsWith(".mp4")) {
    return null;
  }
  return `/uploads/session-album/videos/display/${filename}`;
}

function deriveAlbumVideoCoverUrl(sourceUrl) {
  const filename = String(sourceUrl || "").split("/").pop();
  if (!filename || !filename.endsWith(".mp4")) {
    return null;
  }
  return `/uploads/session-album/videos/cover/${filename.replace(/\.mp4$/i, ".jpg")}`;
}

function albumVideoSnapshotSourceUrl(media) {
  return media.display_url || media.source_url || null;
}

function normalizeCiJobId(value) {
  const text = String(value || "").trim();
  return text ? text.replace(/,/g, "").slice(0, 128) : null;
}

function mergeCiJobIds(currentValue, nextValue) {
  const next = normalizeCiJobId(nextValue);
  const currentParts = String(currentValue || "")
    .split(",")
    .map((part) => normalizeCiJobId(part))
    .filter(Boolean);
  if (!next || currentParts.includes(next)) {
    return currentParts.join(",") || null;
  }
  const merged = [...currentParts, next].join(",");
  return merged.length <= 128 ? merged : currentParts.join(",") || next;
}

function albumVideoProcessingError(value) {
  const text = String(value || "").trim();
  return text ? text.slice(0, 255) : null;
}

async function findSessionAlbumVideoForProcessing(connection, { mediaId, sourceUrl, ciJobId }) {
  if (mediaId) {
    const media = await findById(connection, "session_album_photos", mediaId);
    if (media && media.status === "active" && albumMediaType(media) === "video") {
      return media;
    }
  }

  if (sourceUrl) {
    const [rows] = await connection.query(
      `
        SELECT *
        FROM session_album_photos
        WHERE media_type = 'video'
          AND status = 'active'
          AND source_url = ?
        LIMIT 1
      `,
      [sourceUrl]
    );
    if (rows[0]) {
      return rows[0];
    }
  }

  if (ciJobId) {
    const [rows] = await connection.query(
      `
        SELECT *
        FROM session_album_photos
        WHERE media_type = 'video'
          AND status = 'active'
          AND (
            ci_job_id = ?
            OR ci_job_id LIKE ?
            OR ci_job_id LIKE ?
            OR ci_job_id LIKE ?
          )
        LIMIT 1
      `,
      [ciJobId, `${ciJobId},%`, `%,${ciJobId}`, `%,${ciJobId},%`]
    );
    if (rows[0]) {
      return rows[0];
    }
  }

  return null;
}

function canViewAlbumVideoProcessingState(user, session, media) {
  if (Number(media.uploader_user_id) === Number(user.user.id)) {
    return true;
  }
  return isAdmin(user) && Number(session.organizer_user_id) === Number(user.user.id);
}

function albumMediaResponse(media, tags = [], options = {}) {
  const mediaType = albumMediaType(media);
  const base = {
    id: Number(media.id),
    session_id: Number(media.session_id),
    media_type: mediaType,
    processing_status: mediaType === "video" ? albumMediaProcessingStatus(media) : "ready",
    created_at: media.created_at,
    tags
  };

  if (options.publicShare) {
    if (mediaType === "video") {
      const snapshotSourceUrl =
        albumMediaProcessingStatus(media) === "ready" ? albumVideoSnapshotSourceUrl(media) : null;
      return {
        ...base,
        has_cover: Boolean(snapshotSourceUrl),
        video_cover_source_url: snapshotSourceUrl,
        duration_seconds: media.duration_seconds ? Number(media.duration_seconds) : null,
        video_width: media.video_width ? Number(media.video_width) : null,
        video_height: media.video_height ? Number(media.video_height) : null,
        video_byte_size: media.video_byte_size ? Number(media.video_byte_size) : null,
        video_content_type: media.video_content_type || "video/mp4"
      };
    }
    return {
      ...base,
      image_width: media.image_width ? Number(media.image_width) : null,
      image_height: media.image_height ? Number(media.image_height) : null,
      image_byte_size: media.image_byte_size ? Number(media.image_byte_size) : null,
      image_content_type: media.image_content_type || "image/jpeg"
    };
  }

  const common = {
    ...base,
    uploader_user_id: Number(media.uploader_user_id),
    uploader_name: media.uploader_nickname || media.uploader_open_id || "车友",
    is_mine: Number(media.uploader_user_id) === Number(options.userId),
    can_delete: Number(media.uploader_user_id) === Number(options.userId),
    can_tag: Number(media.uploader_user_id) === Number(options.userId)
  };

  if (mediaType === "video") {
    const snapshotSourceUrl =
      albumMediaProcessingStatus(media) === "ready" ? albumVideoSnapshotSourceUrl(media) : null;
    return {
      ...common,
      has_cover: Boolean(snapshotSourceUrl),
      video_cover_source_url: snapshotSourceUrl,
      duration_seconds: media.duration_seconds ? Number(media.duration_seconds) : null,
      video_width: media.video_width ? Number(media.video_width) : null,
      video_height: media.video_height ? Number(media.video_height) : null,
      video_byte_size: media.video_byte_size ? Number(media.video_byte_size) : null,
      video_content_type: media.video_content_type || "video/mp4",
      processing_error: media.processing_error || null
    };
  }

  return {
    ...common,
    storage_object_key: media.object_key || null,
    storage_object_etag: media.object_etag || null,
    image_width: media.image_width ? Number(media.image_width) : null,
    image_height: media.image_height ? Number(media.image_height) : null,
    image_byte_size: media.image_byte_size ? Number(media.image_byte_size) : null,
    image_content_type: media.image_content_type || "image/jpeg"
  };
}

function optionalPositiveInteger(value, fieldName) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    throw badRequest(`${fieldName} must be a positive integer`);
  }
  return number;
}

function optionalAlbumVideoDimension(value, fieldName) {
  const number = optionalPositiveInteger(value, fieldName);
  if (number !== null && number > ALBUM_VIDEO_MAX_DIMENSION) {
    throw badRequest(`${fieldName} must be at most ${ALBUM_VIDEO_MAX_DIMENSION}`);
  }
  return number;
}

function requiredPositiveInteger(value, fieldName) {
  const number = optionalPositiveInteger(value, fieldName);
  if (number === null) {
    throw badRequest(`${fieldName} is required`);
  }
  return number;
}

function albumPrivacy(row = {}) {
  return {
    allow_uploaded_visible: row.allow_uploaded_visible !== undefined
      ? Boolean(Number(row.allow_uploaded_visible))
      : true,
    allow_tagged_visible: row.allow_tagged_visible !== undefined
      ? Boolean(Number(row.allow_tagged_visible))
      : true
  };
}

function publicText(value) {
  if (value === undefined || value === null) {
    return value;
  }
  return PUBLIC_TEXT_REPLACEMENTS.reduce(
    (text, [from, to]) => text.replaceAll(from, to),
    String(value)
  );
}

function sanitizePublicValue(item) {
  if (typeof item === "string") {
    return publicText(item);
  }
  if (Array.isArray(item)) {
    return item.map(sanitizePublicValue);
  }
  if (item && typeof item === "object") {
    return Object.fromEntries(
      Object.entries(item).map(([key, entryValue]) => [
        key,
        sanitizePublicValue(entryValue)
      ])
    );
  }
  return item;
}

function publicJsonText(value) {
  if (value === undefined || value === null || value === "") {
    return value;
  }
  if (Array.isArray(value) || typeof value === "object") {
    return JSON.stringify(sanitizePublicValue(value));
  }

  try {
    const parsed = JSON.parse(value);
    return JSON.stringify(sanitizePublicValue(parsed));
  } catch (error) {
    return publicText(value);
  }
}

function publicScriptRow(row) {
  return {
    ...row,
    type_tags: publicJsonText(row.type_tags),
    summary_no_spoiler: publicText(row.summary_no_spoiler),
    default_seat_template_json: publicJsonText(row.default_seat_template_json)
  };
}

function scriptNpcRoleResponse(row = {}) {
  return {
    id: Number(row.id),
    script_id: Number(row.script_id),
    name: row.name,
    description: row.description || "",
    role_gender: row.role_gender || "unlimited",
    sort_order: Number(row.sort_order || 0),
    status: row.status || "active"
  };
}

function sessionNpcRoleResponse(row = {}) {
  return {
    id: Number(row.id),
    session_id: Number(row.session_id),
    script_npc_role_id: row.script_npc_role_id ? Number(row.script_npc_role_id) : null,
    name: row.name,
    description: row.description || "",
    role_gender: row.role_gender || "unlimited",
    source: row.source || "session",
    bound_user_id: row.bound_user_id ? Number(row.bound_user_id) : null,
    bound_user_name: row.bound_user_nickname || row.bound_user_open_id || "",
    bound_user_avatar_url: row.bound_user_avatar_url || "",
    bound_user_gender: row.bound_user_gender || "",
    pending_signup_id: row.pending_signup_id ? Number(row.pending_signup_id) : null,
    pending_signup_user_id: row.pending_signup_user_id
      ? Number(row.pending_signup_user_id)
      : null,
    pending_signup_user_name:
      row.pending_signup_user_nickname || row.pending_signup_user_open_id || "",
    pending_signup_user_avatar_url: row.pending_signup_user_avatar_url || "",
    pending_signup_user_gender: row.pending_signup_user_gender || "",
    sort_order: Number(row.sort_order || 0),
    status: row.status || "active"
  };
}

async function scriptNpcRolesByScriptIds(connection, scriptIds) {
  const ids = [...new Set(scriptIds.map(Number).filter(Boolean))];
  const rolesByScriptId = new Map(ids.map((id) => [id, []]));
  if (ids.length === 0) {
    return rolesByScriptId;
  }
  const placeholders = ids.map(() => "?").join(", ");
  const [rows] = await connection.query(
    `
      SELECT *
      FROM script_npc_roles
      WHERE script_id IN (${placeholders})
        AND status = 'active'
      ORDER BY script_id, sort_order, id
    `,
    ids
  );
  for (const row of rows) {
    const scriptId = Number(row.script_id);
    const roles = rolesByScriptId.get(scriptId) || [];
    roles.push(scriptNpcRoleResponse(row));
    rolesByScriptId.set(scriptId, roles);
  }
  return rolesByScriptId;
}

async function attachScriptNpcRoles(connection, scripts) {
  const rolesByScriptId = await scriptNpcRolesByScriptIds(
    connection,
    scripts.map((script) => script.id)
  );
  return scripts.map((script) => ({
    ...script,
    npc_roles: rolesByScriptId.get(Number(script.id)) || []
  }));
}

async function scriptWithNpcRoles(connection, script) {
  const [withRoles] = await attachScriptNpcRoles(connection, [script]);
  return withRoles;
}

async function insertScriptNpcRoles(connection, scriptId, roles = []) {
  for (const [index, role] of roles.entries()) {
    assertPublicTextSafe("npcRoleName", role.name);
    assertPublicTextSafe("npcRoleDescription", role.description);
    await connection.query(
      `
        INSERT INTO script_npc_roles
          (script_id, name, description, role_gender, sort_order, status)
        VALUES (?, ?, ?, ?, ?, 'active')
      `,
      [
        scriptId,
        role.name,
        role.description || null,
        role.roleGender,
        role.sortOrder ?? index
      ]
    );
  }
}

async function replaceScriptNpcRoles(connection, scriptId, roles = []) {
  await connection.query(
    "UPDATE script_npc_roles SET status = 'inactive' WHERE script_id = ?",
    [scriptId]
  );
  await insertScriptNpcRoles(connection, scriptId, roles);
}

async function insertSessionNpcRoles(connection, sessionId, roles = [], options = {}) {
  for (const [index, role] of roles.entries()) {
    assertPublicTextSafe("npcRoleName", role.name);
    assertPublicTextSafe("npcRoleDescription", role.description);
    await connection.query(
      `
        INSERT INTO session_npc_roles
          (
            session_id, script_npc_role_id, name, description, role_gender,
            source, bound_user_id, sort_order, status
          )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active')
      `,
      [
        sessionId,
        role.scriptNpcRoleId || options.scriptNpcRoleId || null,
        role.name,
        role.description || null,
        role.roleGender,
        normalizeNpcRoleSource(role.source, options.source || "session"),
        role.boundUserId || null,
        role.sortOrder ?? index
      ]
    );
  }
}

async function cloneScriptNpcRolesForSession(connection, sessionId, scriptId) {
  const rolesByScriptId = await scriptNpcRolesByScriptIds(connection, [scriptId]);
  const roles = (rolesByScriptId.get(Number(scriptId)) || []).map((role, index) => ({
    scriptNpcRoleId: role.id,
    name: role.name,
    description: role.description,
    roleGender: role.role_gender || "unlimited",
    source: "script",
    boundUserId: null,
    sortOrder: role.sort_order ?? index
  }));
  await insertSessionNpcRoles(connection, sessionId, roles, { source: "script" });
}

async function sessionNpcRolesForSession(connection, sessionId) {
  const [rows] = await connection.query(
    `
      SELECT
        role.*,
        user.nickname AS bound_user_nickname,
        user.open_id AS bound_user_open_id,
        user.avatar_url AS bound_user_avatar_url,
        user.gender AS bound_user_gender,
        (
          SELECT signup.id
          FROM signups signup
          WHERE signup.session_npc_role_id = role.id
            AND signup.status = 'pending'
          ORDER BY signup.id
          LIMIT 1
        ) AS pending_signup_id,
        (
          SELECT signup.user_id
          FROM signups signup
          WHERE signup.session_npc_role_id = role.id
            AND signup.status = 'pending'
          ORDER BY signup.id
          LIMIT 1
        ) AS pending_signup_user_id,
        (
          SELECT pending_user.nickname
          FROM signups signup
          JOIN users pending_user ON pending_user.id = signup.user_id
          WHERE signup.session_npc_role_id = role.id
            AND signup.status = 'pending'
          ORDER BY signup.id
          LIMIT 1
        ) AS pending_signup_user_nickname,
        (
          SELECT pending_user.open_id
          FROM signups signup
          JOIN users pending_user ON pending_user.id = signup.user_id
          WHERE signup.session_npc_role_id = role.id
            AND signup.status = 'pending'
          ORDER BY signup.id
          LIMIT 1
        ) AS pending_signup_user_open_id,
        (
          SELECT pending_user.avatar_url
          FROM signups signup
          JOIN users pending_user ON pending_user.id = signup.user_id
          WHERE signup.session_npc_role_id = role.id
            AND signup.status = 'pending'
          ORDER BY signup.id
          LIMIT 1
        ) AS pending_signup_user_avatar_url,
        (
          SELECT pending_user.gender
          FROM signups signup
          JOIN users pending_user ON pending_user.id = signup.user_id
          WHERE signup.session_npc_role_id = role.id
            AND signup.status = 'pending'
          ORDER BY signup.id
          LIMIT 1
        ) AS pending_signup_user_gender
      FROM session_npc_roles role
      LEFT JOIN users user ON user.id = role.bound_user_id
      WHERE role.session_id = ?
        AND role.status = 'active'
      ORDER BY role.sort_order, role.id
    `,
    [sessionId]
  );
  return rows.map(sessionNpcRoleResponse);
}

async function sessionNpcRoleById(connection, npcRoleId) {
  const [rows] = await connection.query(
    `
      SELECT
        role.*,
        user.nickname AS bound_user_nickname,
        user.open_id AS bound_user_open_id,
        user.avatar_url AS bound_user_avatar_url,
        user.gender AS bound_user_gender,
        (
          SELECT signup.id
          FROM signups signup
          WHERE signup.session_npc_role_id = role.id
            AND signup.status = 'pending'
          ORDER BY signup.id
          LIMIT 1
        ) AS pending_signup_id,
        (
          SELECT signup.user_id
          FROM signups signup
          WHERE signup.session_npc_role_id = role.id
            AND signup.status = 'pending'
          ORDER BY signup.id
          LIMIT 1
        ) AS pending_signup_user_id,
        (
          SELECT pending_user.nickname
          FROM signups signup
          JOIN users pending_user ON pending_user.id = signup.user_id
          WHERE signup.session_npc_role_id = role.id
            AND signup.status = 'pending'
          ORDER BY signup.id
          LIMIT 1
        ) AS pending_signup_user_nickname,
        (
          SELECT pending_user.open_id
          FROM signups signup
          JOIN users pending_user ON pending_user.id = signup.user_id
          WHERE signup.session_npc_role_id = role.id
            AND signup.status = 'pending'
          ORDER BY signup.id
          LIMIT 1
        ) AS pending_signup_user_open_id,
        (
          SELECT pending_user.avatar_url
          FROM signups signup
          JOIN users pending_user ON pending_user.id = signup.user_id
          WHERE signup.session_npc_role_id = role.id
            AND signup.status = 'pending'
          ORDER BY signup.id
          LIMIT 1
        ) AS pending_signup_user_avatar_url,
        (
          SELECT pending_user.gender
          FROM signups signup
          JOIN users pending_user ON pending_user.id = signup.user_id
          WHERE signup.session_npc_role_id = role.id
            AND signup.status = 'pending'
          ORDER BY signup.id
          LIMIT 1
        ) AS pending_signup_user_gender
      FROM session_npc_roles role
      LEFT JOIN users user ON user.id = role.bound_user_id
      WHERE role.id = ?
      LIMIT 1
    `,
    [npcRoleId]
  );
  return rows[0] ? sessionNpcRoleResponse(rows[0]) : null;
}

function publicTextRiskWord(value) {
  if (value === undefined || value === null || value === "") {
    return "";
  }
  const text = String(value);
  const keyword = PUBLIC_TEXT_RISK_WORDS.find((word) => text.includes(word));
  if (keyword) {
    return keyword;
  }
  if (/(^|[^\d])1[3-9]\d{9}($|[^\d])/.test(text)) {
    return "手机号";
  }
  return "";
}

function assertPublicTextSafe(label, value) {
  const riskWord = publicTextRiskWord(value);
  if (riskWord) {
    throw badRequest(`${label} contains public risk text: ${riskWord}`);
  }
}

function assertMessageTextSafe(label, value) {
  if (value === undefined || value === null || value === "") {
    return;
  }
  const text = String(value);
  const riskWord = MESSAGE_TEXT_RISK_WORDS.find((word) => text.includes(word));
  if (riskWord) {
    throw badRequest(`${label} contains transaction risk text: ${riskWord}`);
  }
}

async function findById(connection, table, id, options = {}) {
  const [rows] = await connection.query(
    `SELECT * FROM ${table} WHERE id = ?${options.forUpdate ? " FOR UPDATE" : ""}`,
    [id]
  );
  return rows[0] || null;
}

async function selectInserted(connection, table, insertResult) {
  return findById(connection, table, insertResult.insertId);
}

async function updateAllowed(connection, table, id, body, fields) {
  const sets = [];
  const values = [];

  for (const [bodyKey, column] of fields) {
    if (body[bodyKey] !== undefined) {
      sets.push(`${column} = ?`);
      values.push(body[bodyKey]);
    }
  }

  if (sets.length === 0) {
    return findById(connection, table, id);
  }

  values.push(id);
  await connection.query(`UPDATE ${table} SET ${sets.join(", ")} WHERE id = ?`, values);
  return findById(connection, table, id);
}

async function requireSeatOwner(connection, seatId, user) {
  const [rows] = await connection.query(
    `
      SELECT seat.*, session.organizer_user_id
      FROM session_seats seat
      JOIN sessions session ON session.id = seat.session_id
      WHERE seat.id = ?
    `,
    [seatId]
  );
  const seat = rows[0];
  if (!seat) {
    throw notFound("Seat not found");
  }
  if (!isAdmin(user) && Number(seat.organizer_user_id) !== Number(user.user.id)) {
    throw forbidden("Only the session organizer can perform this action");
  }
  return seat;
}

async function requireSignupOwner(connection, signupId, user) {
  const [rows] = await connection.query(
    `
      SELECT signup.*, session.organizer_user_id
      FROM signups signup
      JOIN sessions session ON session.id = signup.session_id
      WHERE signup.id = ?
    `,
    [signupId]
  );
  const signup = rows[0];
  if (!signup) {
    throw notFound("Signup not found");
  }
  if (!isAdmin(user) && Number(signup.organizer_user_id) !== Number(user.user.id)) {
    throw forbidden("Only the session organizer can perform this action");
  }
  return signup;
}

async function lockSessionSeats(connection, sessionId) {
  await connection.query(
    `
      SELECT id
      FROM session_seats
      WHERE session_id = ?
      ORDER BY id
      FOR UPDATE
    `,
    [sessionId]
  );
}

async function assertUserCanJoinSession(connection, sessionId, userId) {
  const [rows] = await connection.query(
    `
      SELECT id
      FROM session_member_removal_reports
      WHERE session_id = ?
        AND removed_user_id = ?
        AND block_rejoin = 1
      LIMIT 1
    `,
    [sessionId, userId]
  );
  if (rows.length > 0) {
    throw forbidden("User has been removed from this session");
  }
}

async function releaseUserOtherConfirmedSeats(
  connection,
  sessionId,
  userId,
  seatId
) {
  const [lockedRows] = await connection.query(
    `
      SELECT id, name
      FROM session_seats
      WHERE session_id = ?
        AND confirmed_user_id = ?
        AND id <> ?
        AND status = 'locked'
      LIMIT 1
    `,
    [sessionId, userId, seatId]
  );
  if (lockedRows.length > 0) {
    throw conflict("User already has a locked seat in this session", {
      seatId: lockedRows[0].id,
      seatName: lockedRows[0].name
    });
  }

  const [confirmedRows] = await connection.query(
    `
      SELECT id, name
      FROM session_seats
      WHERE session_id = ?
        AND confirmed_user_id = ?
        AND id <> ?
        AND status = 'confirmed'
    `,
    [sessionId, userId, seatId]
  );
  if (confirmedRows.length === 0) {
    return [];
  }

  await connection.query(
    `
      UPDATE signups
      SET status = 'cancelled'
      WHERE user_id = ?
        AND status IN ('pending', 'approved')
        AND seat_id IN (
          SELECT id
          FROM session_seats
          WHERE session_id = ?
            AND confirmed_user_id = ?
            AND id <> ?
            AND status = 'confirmed'
        )
    `,
    [userId, sessionId, userId, seatId]
  );
  for (const confirmedRow of confirmedRows) {
    await clearPreStartReviewEligibilityForSeat(connection, confirmedRow.id);
  }
  await connection.query(
    `
      UPDATE session_seats
      SET status = 'open',
          confirmed_user_id = NULL
      WHERE session_id = ?
        AND confirmed_user_id = ?
        AND id <> ?
        AND status = 'confirmed'
    `,
    [sessionId, userId, seatId]
  );

  return confirmedRows;
}

async function clearAppliedSeatsWithoutPending(connection, sessionId) {
  await connection.query(
    `
      UPDATE session_seats
      SET status = 'open'
      WHERE session_id = ?
        AND status = 'applied'
        AND confirmed_user_id IS NULL
        AND id NOT IN (
          SELECT pending_seat_id
          FROM (
            SELECT DISTINCT seat_id AS pending_seat_id
            FROM signups
            WHERE session_id = ?
              AND seat_id IS NOT NULL
              AND status = 'pending'
          ) pending_seats
        )
    `,
    [sessionId, sessionId]
  );
}

async function cancelUserOtherPendingSignups(
  connection,
  sessionId,
  userId,
  keepSeatId = 0,
  keepNpcRoleId = 0
) {
  await connection.query(
    `
      UPDATE signups
      SET status = 'cancelled'
      WHERE session_id = ?
        AND user_id = ?
        AND status = 'pending'
        AND NOT (
          COALESCE(seat_id, 0) = ?
          AND COALESCE(session_npc_role_id, 0) = ?
        )
    `,
    [sessionId, userId, keepSeatId || 0, keepNpcRoleId || 0]
  );
  await clearAppliedSeatsWithoutPending(connection, sessionId);
}

async function releaseUserOtherSessionNpcRoles(
  connection,
  sessionId,
  userId,
  npcRoleId = 0
) {
  const [boundRows] = await connection.query(
    `
      SELECT id, name
      FROM session_npc_roles
      WHERE session_id = ?
        AND bound_user_id = ?
        AND id <> ?
        AND status = 'active'
      FOR UPDATE
    `,
    [sessionId, userId, npcRoleId || 0]
  );

  await connection.query(
    `
      UPDATE signups
      SET status = 'cancelled'
      WHERE session_id = ?
        AND user_id = ?
        AND status IN ('pending', 'approved')
        AND session_npc_role_id IN (
          SELECT id
          FROM session_npc_roles
          WHERE session_id = ?
            AND id <> ?
        )
    `,
    [sessionId, userId, sessionId, npcRoleId || 0]
  );
  await connection.query(
    `
      UPDATE session_npc_roles
      SET bound_user_id = NULL
      WHERE session_id = ?
        AND bound_user_id = ?
        AND id <> ?
    `,
    [sessionId, userId, npcRoleId || 0]
  );

  return boundRows;
}

async function cleanupSessionExclusiveRoleSelections(connection, sessionId) {
  const [ordinaryMemberRows] = await connection.query(
    `
      SELECT DISTINCT confirmed_user_id AS user_id
      FROM session_seats
      WHERE session_id = ?
        AND confirmed_user_id IS NOT NULL
        AND confirmed_user_id > 0
        AND status IN ('confirmed', 'locked')
    `,
    [sessionId]
  );
  for (const row of ordinaryMemberRows) {
    await releaseUserOtherSessionNpcRoles(
      connection,
      sessionId,
      row.user_id,
      0
    );
  }

  const [duplicateNpcRoleRows] = await connection.query(
    `
      SELECT role.id
      FROM session_npc_roles role
      JOIN (
        SELECT bound_user_id, MIN(id) AS keep_id
        FROM session_npc_roles
        WHERE session_id = ?
          AND bound_user_id IS NOT NULL
          AND bound_user_id > 0
          AND status = 'active'
        GROUP BY bound_user_id
        HAVING COUNT(*) > 1
      ) duplicate_npc_roles ON duplicate_npc_roles.bound_user_id = role.bound_user_id
      WHERE role.session_id = ?
        AND role.id <> duplicate_npc_roles.keep_id
    `,
    [sessionId, sessionId]
  );
  const duplicateNpcRoleIds = duplicateNpcRoleRows.map((row) => row.id).filter(Boolean);
  if (duplicateNpcRoleIds.length === 0) {
    return;
  }

  const placeholders = duplicateNpcRoleIds.map(() => "?").join(", ");
  await connection.query(
    `
      UPDATE signups
      SET status = 'cancelled'
      WHERE session_id = ?
        AND status IN ('pending', 'approved')
        AND session_npc_role_id IN (${placeholders})
    `,
    [sessionId, ...duplicateNpcRoleIds]
  );
  await connection.query(
    `
      UPDATE session_npc_roles
      SET bound_user_id = NULL
      WHERE session_id = ?
        AND id IN (${placeholders})
    `,
    [sessionId, ...duplicateNpcRoleIds]
  );
}

function reviewWindowSql() {
  return `
    session.start_at <= CURRENT_TIMESTAMP
    AND (
      session.status <> 'cancelled'
      OR session.cancelled_at IS NULL
      OR session.cancelled_at >= session.start_at
    )
  `;
}

async function currentEligibleSignup(connection, sessionId, userId) {
  const [rows] = await connection.query(
    `
      SELECT
        signup.*,
        seat.name AS seat_name,
        seat.role_name AS seat_role_name,
        session.start_at,
        session.status AS session_status,
        session.cancelled_at
      FROM signups signup
      JOIN sessions session ON session.id = signup.session_id
      LEFT JOIN session_seats seat ON seat.id = signup.seat_id
      WHERE signup.session_id = ?
        AND signup.user_id = ?
        AND signup.review_eligible_at IS NOT NULL
        AND ${reviewWindowSql()}
      ORDER BY signup.review_eligible_at DESC, signup.id DESC
      LIMIT 1
    `,
    [sessionId, userId]
  );
  return rows[0] || null;
}

async function requireSessionAlbumOpen(connection, sessionId, options = {}) {
  const id = positiveId(sessionId, "sessionId");
  const lockClause = options.forUpdate === true ? "FOR UPDATE" : "";
  const [rows] = await connection.query(
    `
      SELECT session.*
      FROM sessions session
      WHERE session.id = ?
        AND ${reviewWindowSql()}
      LIMIT 1
      ${lockClause}
    `,
    [id]
  );
  if (rows[0]) {
    return rows[0];
  }

  let session;
  if (options.forUpdate === true) {
    const [sessionRows] = await connection.query(
      `
        SELECT *
        FROM sessions
        WHERE id = ?
        LIMIT 1
        FOR UPDATE
      `,
      [id]
    );
    session = sessionRows[0] || null;
  } else {
    session = await findById(connection, "sessions", id);
  }
  if (!session) {
    throw notFound("Session not found");
  }
  throw forbidden("Session album opens after the session starts");
}

async function isSessionAlbumMember(connection, session, userId, options = {}) {
  const id = Number(userId);
  if (!id) {
    return false;
  }
  if (
    Number(session.organizer_user_id) === id ||
    Number(session.dm_user_id || 0) === id ||
    Number(session.npc_user_id || 0) === id
  ) {
    return true;
  }

  const [rows] = await connection.query(
    `
      SELECT id
      FROM session_seats
      WHERE session_id = ?
        AND confirmed_user_id = ?
        AND status IN ('confirmed', 'locked')
      LIMIT 1
      ${options.forUpdate === true ? "FOR UPDATE" : ""}
    `,
    [session.id, id]
  );
  if (rows.length > 0) {
    return true;
  }

  const [npcRoleRows] = await connection.query(
    `
      SELECT id
      FROM session_npc_roles
      WHERE session_id = ?
        AND bound_user_id = ?
        AND status = 'active'
      LIMIT 1
      ${options.forUpdate === true ? "FOR UPDATE" : ""}
    `,
    [session.id, id]
  );
  return npcRoleRows.length > 0;
}

async function requireSessionAlbumMember(connection, session, user, options = {}) {
  if (!(await isSessionAlbumMember(connection, session, user.user.id, options))) {
    throw forbidden("Only session members can use the session album");
  }
}

async function sessionAlbumPersonalScope(connection, session, userId) {
  const currentUserId = Number(userId);
  if (!currentUserId) {
    return {
      userId: 0,
      seatIds: new Set(),
      sessionNpcRoleIds: new Set()
    };
  }

  const [seatRows] = await connection.query(
    `
      SELECT id
      FROM session_seats
      WHERE session_id = ?
        AND confirmed_user_id = ?
        AND status IN ('confirmed', 'locked')
    `,
    [session.id, currentUserId]
  );
  const [npcRoleRows] = await connection.query(
    `
      SELECT id
      FROM session_npc_roles
      WHERE session_id = ?
        AND bound_user_id = ?
        AND status = 'active'
    `,
    [session.id, currentUserId]
  );

  return {
    userId: currentUserId,
    seatIds: new Set(seatRows.map((row) => Number(row.id))),
    sessionNpcRoleIds: new Set(npcRoleRows.map((row) => Number(row.id)))
  };
}

async function getAlbumPrivacy(connection, sessionId, userId) {
  const [rows] = await connection.query(
    `
      SELECT *
      FROM session_album_privacy
      WHERE session_id = ?
        AND user_id = ?
      LIMIT 1
    `,
    [sessionId, userId]
  );
  return albumPrivacy(rows[0] || {});
}

async function albumPrivacyMap(connection, sessionId, userIds) {
  const ids = [...new Set(userIds.map(Number).filter(Boolean))];
  const privacyByUser = new Map(ids.map((id) => [id, albumPrivacy()]));
  if (ids.length === 0) {
    return privacyByUser;
  }
  const placeholders = ids.map(() => "?").join(", ");
  const [rows] = await connection.query(
    `
      SELECT *
      FROM session_album_privacy
      WHERE session_id = ?
        AND user_id IN (${placeholders})
    `,
    [sessionId, ...ids]
  );
  for (const row of rows) {
    privacyByUser.set(Number(row.user_id), albumPrivacy(row));
  }
  return privacyByUser;
}

async function sessionAlbumPeople(connection, session) {
  const [seatRows] = await connection.query(
    `
      SELECT
        seat.id,
        seat.name,
        seat.role_name,
        seat.seat_type,
        seat.confirmed_user_id,
        user.nickname AS user_nickname,
        user.open_id AS user_open_id
      FROM session_seats seat
      LEFT JOIN users user ON user.id = seat.confirmed_user_id
      WHERE seat.session_id = ?
      ORDER BY seat.id
    `,
    [session.id]
  );

  const sessionUserIds = [
    session.dm_user_id,
    session.npc_user_id
  ]
    .map(Number)
    .filter(Boolean);
  const userNamesById = new Map();
  if (sessionUserIds.length > 0) {
    const placeholders = sessionUserIds.map(() => "?").join(", ");
    const [userRows] = await connection.query(
      `
        SELECT id, nickname, open_id
        FROM users
        WHERE id IN (${placeholders})
      `,
      sessionUserIds
    );
    for (const row of userRows) {
      userNamesById.set(Number(row.id), row.nickname || row.open_id || "");
    }
  }

  const people = [];
  const addPerson = (person) => {
    if (!person.key || people.some((item) => item.key === person.key)) {
      return;
    }
    people.push(person);
  };

  for (const seat of seatRows) {
    const roleLabel = seat.role_name || seat.name || "车友";
    const accountName = seat.confirmed_user_id
      ? seat.user_nickname || seat.user_open_id || ""
      : "";
    addPerson({
      key: `seat:${seat.id}`,
      tag_type: "seat",
      seat_id: Number(seat.id),
      user_id: seat.confirmed_user_id ? Number(seat.confirmed_user_id) : null,
      label: roleLabel,
      note: accountName,
      role_name: seat.role_name || "",
      seat_name: seat.name || "",
      account_name: accountName
    });
  }

  if (session.dm_user_id || session.dm_name_snapshot) {
    addPerson({
      key: "dm:session",
      tag_type: "dm",
      seat_id: null,
      user_id: session.dm_user_id ? Number(session.dm_user_id) : null,
      label:
        session.dm_name_snapshot ||
        userNamesById.get(Number(session.dm_user_id)) ||
        "DM",
      note: "DM"
    });
  }

  if (session.npc_user_id || session.npc_name_snapshot) {
    addPerson({
      key: "npc:session",
      tag_type: "npc",
      seat_id: null,
      user_id: session.npc_user_id ? Number(session.npc_user_id) : null,
      label:
        session.npc_name_snapshot ||
        userNamesById.get(Number(session.npc_user_id)) ||
        "NPC",
      note: "NPC"
    });
  }

  addPerson({
    key: "other:session",
    tag_type: "other",
    seat_id: null,
    user_id: null,
    label: "其他",
    note: "风景/主线外照片"
  });

  const sessionNpcRoles = await sessionNpcRolesForSession(connection, session.id);
  for (const role of sessionNpcRoles) {
    const accountName = role.bound_user_name || "";
    addPerson({
      key: `session-npc:${role.id}`,
      tag_type: "session_npc_role",
      seat_id: null,
      session_npc_role_id: Number(role.id),
      user_id: role.bound_user_id ? Number(role.bound_user_id) : null,
      label: role.name,
      role_gender: role.role_gender || "unlimited",
      note: accountName,
      account_name: accountName
    });
  }

  return people;
}

function normalizeAlbumTagKeys(body = {}) {
  const raw = Array.isArray(body.tagKeys)
    ? body.tagKeys
    : Array.isArray(body.tags)
      ? body.tags.map((tag) => tag.key || tag.tagKey || tag.id || tag)
      : [];
  const seen = new Set();
  const keys = [];
  for (const item of raw) {
    const key = String(item || "").trim();
    if (!key || seen.has(key)) {
      continue;
    }
    if (!/^(seat:\d+|dm:session|npc:session|other:session|session-npc:\d+)$/.test(key)) {
      throw badRequest("tags contains an invalid person key");
    }
    seen.add(key);
    keys.push(key);
  }
  return keys;
}

function tagsByPhotoId(rows = []) {
  const map = new Map();
  for (const row of rows) {
    const photoId = Number(row.photo_id);
    const list = map.get(photoId) || [];
    list.push({
      id: Number(row.id),
      key: row.tag_type === "seat" && row.seat_id
        ? `seat:${row.seat_id}`
        : row.tag_type === "session_npc_role" && row.session_npc_role_id
          ? `session-npc:${row.session_npc_role_id}`
          : ["organizer", "dm", "npc", "other"].includes(row.tag_type)
            ? `${row.tag_type}:session`
            : `${row.tag_type}:${row.id}`,
      tag_type: row.tag_type,
      seat_id: row.seat_id ? Number(row.seat_id) : null,
      session_npc_role_id: row.session_npc_role_id
        ? Number(row.session_npc_role_id)
        : null,
      user_id: row.user_id ? Number(row.user_id) : null,
      label: row.label
    });
    map.set(photoId, list);
  }
  return map;
}

async function albumTagsForPhotos(connection, photoIds) {
  if (photoIds.length === 0) {
    return new Map();
  }
  const placeholders = photoIds.map(() => "?").join(", ");
  const [rows] = await connection.query(
    `
      SELECT *
      FROM session_album_photo_tags
      WHERE photo_id IN (${placeholders})
      ORDER BY photo_id, sort_order, id
    `,
    photoIds
  );
  return tagsByPhotoId(rows);
}

function isAlbumTagInPersonalScope(tag, scope) {
  if (Number(tag.user_id || 0) === scope.userId) {
    return true;
  }
  if (tag.tag_type === "seat" && scope.seatIds.has(Number(tag.seat_id || 0))) {
    return true;
  }
  return (
    tag.tag_type === "session_npc_role" &&
    scope.sessionNpcRoleIds.has(Number(tag.session_npc_role_id || 0))
  );
}

function isAlbumMemberPublicTag(tag) {
  return ["other", "npc", "session_npc_role"].includes(tag.tag_type);
}

function hasOnlyAlbumMemberPublicTags(tags, privacyByUser) {
  if (tags.length === 0 || !tags.every((tag) => isAlbumMemberPublicTag(tag))) {
    return false;
  }
  for (const tag of tags) {
    if (!["npc", "session_npc_role"].includes(tag.tag_type)) {
      continue;
    }
    const taggedUserId = Number(tag.user_id || 0);
    if (!taggedUserId) {
      continue;
    }
    const taggedPrivacy = privacyByUser.get(taggedUserId) || albumPrivacy();
    if (!taggedPrivacy.allow_tagged_visible) {
      return false;
    }
  }
  return true;
}

function isAlbumPhotoVisibleToUser(photo, tags, privacyByUser, userId, personalScope = null) {
  const scope = personalScope || {
    userId: Number(userId),
    seatIds: new Set(),
    sessionNpcRoleIds: new Set()
  };
  const uploaderUserId = Number(photo.uploader_user_id);
  if (uploaderUserId === scope.userId) {
    return true;
  }

  if (tags.some((tag) => isAlbumTagInPersonalScope(tag, scope))) {
    return true;
  }
  if (hasOnlyAlbumMemberPublicTags(tags, privacyByUser)) {
    return true;
  }
  return false;
}

function normalizeAlbumShareClaims(claims = {}) {
  return {
    sessionId: positiveId(claims.sessionId ?? claims.session_id, "sessionId"),
    sharerUserId: positiveId(
      claims.sharerUserId ?? claims.sharer_user_id,
      "sharerUserId"
    ),
    seatId: positiveId(claims.seatId ?? claims.seat_id, "seatId")
  };
}

function albumShareSubjectForSeat(seat) {
  return {
    type: "seat",
    seat_id: Number(seat.id),
    role_name: seat.role_name || "",
    seat_name: seat.name || "",
    label: seat.role_name || seat.name || "车友"
  };
}

async function requirePublicAlbumShareSeat(connection, claims) {
  const normalized = normalizeAlbumShareClaims(claims);
  const [rows] = await connection.query(
    `
      SELECT id, name, role_name, confirmed_user_id, status
      FROM session_seats
      WHERE id = ?
        AND session_id = ?
        AND confirmed_user_id = ?
        AND status IN ('confirmed', 'locked')
      LIMIT 1
    `,
    [normalized.seatId, normalized.sessionId, normalized.sharerUserId]
  );
  const seat = rows[0];
  if (!seat) {
    throw forbidden("Album share is no longer available");
  }
  return { ...normalized, seat };
}

function isAlbumPhotoVisibleInPublicShare(photo, tags, privacyByUser, claims) {
  const { sessionId, sharerUserId, seatId } = normalizeAlbumShareClaims(claims);
  if (Number(photo.session_id) !== sessionId || tags.length === 0) {
    return false;
  }

  const hasSharerSeatTag = tags.some(
    (tag) => tag.tag_type === "seat" && Number(tag.seat_id) === seatId
  );
  if (!hasSharerSeatTag) {
    return false;
  }

  const uploaderUserId = Number(photo.uploader_user_id);
  if (uploaderUserId && uploaderUserId !== sharerUserId) {
    const uploaderPrivacy = privacyByUser.get(uploaderUserId) || albumPrivacy();
    if (!uploaderPrivacy.allow_uploaded_visible) {
      return false;
    }
  }

  const taggedUserIds = [
    ...new Set(tags.map((tag) => Number(tag.user_id || 0)).filter(Boolean))
  ];
  for (const taggedUserId of taggedUserIds) {
    if (taggedUserId === sharerUserId) {
      continue;
    }
    const taggedPrivacy = privacyByUser.get(taggedUserId) || albumPrivacy();
    if (!taggedPrivacy.allow_tagged_visible) {
      return false;
    }
  }
  return true;
}

async function markSignupReviewEligible(connection, signupId) {
  await connection.query(
    `
      UPDATE signups
      SET review_eligible_at = COALESCE(review_eligible_at, CURRENT_TIMESTAMP)
      WHERE id = ?
    `,
    [signupId]
  );
}

async function clearPreStartReviewEligibilityForSeat(connection, seatId) {
  await connection.query(
    `
      UPDATE signups signup
      JOIN sessions session ON session.id = signup.session_id
      SET signup.review_eligible_at = NULL
      WHERE signup.seat_id = ?
        AND session.start_at > CURRENT_TIMESTAMP
    `,
    [seatId]
  );
}

async function clearPreStartReviewEligibilityForSession(connection, sessionId) {
  await connection.query(
    `
      UPDATE signups signup
      JOIN sessions session ON session.id = signup.session_id
      SET signup.review_eligible_at = NULL
      WHERE signup.session_id = ?
        AND session.start_at > CURRENT_TIMESTAMP
    `,
    [sessionId]
  );
}

export async function listActiveStores(filters = {}, user = null) {
  return withDatabaseConnection(async (connection) => {
    const where = [
      `
        (
          (COALESCE(visibility, 'public') = 'public'
            AND COALESCE(review_status, 'approved') = 'approved'
            AND status = 'active')
          ${
            user?.user?.id
              ? `OR (visibility = 'private'
                  AND created_by_user_id = ?
                  AND review_status IN ('pending', 'needs_changes')
                  AND status = 'active')`
              : ""
          }
        )
      `
    ];
    const values = user?.user?.id ? [user.user.id] : [];

    if (filters.keyword) {
      where.push("(name LIKE ? OR city LIKE ? OR district LIKE ?)");
      const keyword = likeKeyword(filters.keyword);
      values.push(keyword, keyword, keyword);
    }
    if (filters.city) {
      where.push("city = ?");
      values.push(String(filters.city));
    }

    const [rows] = await connection.query(
      `SELECT * FROM stores WHERE ${where.join(" AND ")} ORDER BY id DESC LIMIT ${limitValue(filters.limit)} `,
      values
    );
    return rows
      .filter(
        (row) => isPublicCatalogUsable(row) || isPrivateCatalogUsableByUser(row, user)
      )
      .map(catalogResponse);
  });
}

export async function listActiveScripts(filters = {}, user = null) {
  return withDatabaseConnection(async (connection) => {
    const where = [];
    const values = [];
    let from = "scripts";
    let select = "scripts.*";

    if (filters.storeId !== undefined && filters.storeId !== null && filters.storeId !== "") {
      const storeId = positiveId(filters.storeId, "storeId");
      const store = await findById(connection, "stores", storeId);
      if (!store) {
        throw notFound("Store not found");
      }
      if (!isPublicCatalogUsable(store) && !isPrivateCatalogUsableByUser(store, user)) {
        throw notFound("Store not found");
      }

      if (isPublicCatalogUsable(store)) {
        from = "scripts LEFT JOIN store_scripts ss ON ss.script_id = scripts.id AND ss.store_id = ?";
        select = "scripts.*, ss.price_per_player";
        values.push(storeId);
        where.push(
          `
            (
              (COALESCE(scripts.visibility, 'public') = 'public'
                AND COALESCE(scripts.review_status, 'approved') = 'approved'
                AND scripts.status = 'active'
                AND ss.store_id IS NOT NULL)
              ${
                user?.user?.id
                  ? `OR (scripts.visibility = 'private'
                      AND scripts.created_by_user_id = ?
                      AND scripts.review_status IN ('pending', 'needs_changes')
                      AND scripts.status = 'active')`
                  : ""
              }
            )
          `
        );
        if (user?.user?.id) {
          values.push(user.user.id);
        }
      } else {
        where.push(
          `
            (
              (COALESCE(scripts.visibility, 'public') = 'public'
                AND COALESCE(scripts.review_status, 'approved') = 'approved'
                AND scripts.status = 'active')
              OR (scripts.visibility = 'private'
                AND scripts.created_by_user_id = ?
                AND scripts.review_status IN ('pending', 'needs_changes')
                AND scripts.status = 'active')
            )
          `
        );
        values.push(user.user.id);
      }
    } else {
      where.push(
        `
          (
            (COALESCE(scripts.visibility, 'public') = 'public'
              AND COALESCE(scripts.review_status, 'approved') = 'approved'
              AND scripts.status = 'active')
            ${
              user?.user?.id
                ? `OR (scripts.visibility = 'private'
                    AND scripts.created_by_user_id = ?
                    AND scripts.review_status IN ('pending', 'needs_changes')
                    AND scripts.status = 'active')`
                : ""
            }
          )
        `
      );
      if (user?.user?.id) {
        values.push(user.user.id);
      }
    }

    if (filters.keyword) {
      where.push("(scripts.name LIKE ? OR scripts.type_tags LIKE ?)");
      const keyword = likeKeyword(filters.keyword);
      values.push(keyword, keyword);
    }

    const [rows] = await connection.query(
      `SELECT ${select} FROM ${from} WHERE ${where.join(" AND ")} ORDER BY scripts.id DESC LIMIT ${limitValue(filters.limit)} `,
      values
    );
    return attachScriptNpcRoles(
      connection,
      rows
        .filter(
          (row) => isPublicCatalogUsable(row) || isPrivateCatalogUsableByUser(row, user)
        )
        .map((row) => catalogResponse(publicScriptRow(row)))
    );
  });
}

export async function listAdminStores(filters = {}) {
  return withDatabaseConnection(async (connection) => {
    const where = ["1 = 1"];
    const values = [];

    if (filters.status) {
      where.push("status = ?");
      values.push(String(filters.status));
    }
    if (filters.keyword) {
      where.push("(name LIKE ? OR city LIKE ? OR district LIKE ? OR address LIKE ?)");
      const keyword = likeKeyword(filters.keyword);
      values.push(keyword, keyword, keyword, keyword);
    }

    const [rows] = await connection.query(
      `SELECT * FROM stores WHERE ${where.join(" AND ")} ORDER BY id DESC LIMIT ${limitValue(filters.limit)} `,
      values
    );
    return rows.map(catalogResponse);
  });
}

export async function listAdminScripts(filters = {}) {
  return withDatabaseConnection(async (connection) => {
    const where = ["1 = 1"];
    const values = [];

    if (filters.status) {
      where.push("status = ?");
      values.push(String(filters.status));
    }
    if (filters.keyword) {
      where.push("(name LIKE ? OR type_tags LIKE ?)");
      const keyword = likeKeyword(filters.keyword);
      values.push(keyword, keyword);
    }

    const [rows] = await connection.query(
      `SELECT * FROM scripts WHERE ${where.join(" AND ")} ORDER BY id DESC LIMIT ${limitValue(filters.limit)} `,
      values
    );
    return attachScriptNpcRoles(connection, rows.map(catalogResponse));
  });
}

function normalizeStoreScriptLinks(body = {}) {
  const sourceLinks =
    body.scriptLinks !== undefined
      ? body.scriptLinks
      : body.scripts !== undefined
        ? body.scripts
        : (body.scriptIds ?? []).map((scriptId) => ({ scriptId, pricePerPlayer: 0 }));

  if (!Array.isArray(sourceLinks)) {
    throw badRequest("scriptLinks must be an array");
  }

  const seen = new Set();
  const links = [];
  for (const sourceLink of sourceLinks) {
    const isObject = sourceLink && typeof sourceLink === "object";
    const scriptId = positiveId(
      isObject ? sourceLink.scriptId ?? sourceLink.id : sourceLink,
      "scriptId"
    );
    if (seen.has(scriptId)) {
      continue;
    }
    seen.add(scriptId);
    links.push({
      scriptId,
      pricePerPlayer: nonNegativeIntValue(
        isObject ? sourceLink.pricePerPlayer ?? sourceLink.price_per_player : 0,
        "pricePerPlayer"
      )
    });
  }

  return links;
}

export async function listStoreScripts(storeId) {
  const id = positiveId(storeId, "storeId");
  return withDatabaseConnection(async (connection) => {
    const store = await findById(connection, "stores", id);
    if (!store) {
      throw notFound("Store not found");
    }

    const [rows] = await connection.query(
      `
        SELECT scripts.*, store_scripts.price_per_player
        FROM store_scripts
          INNER JOIN scripts ON scripts.id = store_scripts.script_id
        WHERE store_scripts.store_id = ?
          AND scripts.status = 'active'
        ORDER BY scripts.id DESC
      `,
      [id]
    );
    return rows;
  });
}

export async function replaceStoreScripts(storeId, body = {}) {
  const id = positiveId(storeId, "storeId");
  const scriptLinks = normalizeStoreScriptLinks(body);
  const scriptIds = scriptLinks.map((scriptLink) => scriptLink.scriptId);

  return withTransaction(async (connection) => {
    const store = await findById(connection, "stores", id);
    if (!store) {
      throw notFound("Store not found");
    }

    if (scriptIds.length > 0) {
      const placeholders = scriptIds.map(() => "?").join(", ");
      const [rows] = await connection.query(
        `SELECT id FROM scripts WHERE id IN (${placeholders}) AND status = 'active'`,
        scriptIds
      );
      const existingIds = new Set(rows.map((row) => Number(row.id)));
      const missingIds = scriptIds.filter((scriptId) => !existingIds.has(scriptId));
      if (missingIds.length > 0) {
        throw badRequest(`Unknown or inactive scriptIds: ${missingIds.join(", ")}`);
      }
    }

    await connection.query("DELETE FROM store_scripts WHERE store_id = ?", [id]);

    if (scriptIds.length > 0) {
      const values = scriptLinks.flatMap((scriptLink) => [
        id,
        scriptLink.scriptId,
        scriptLink.pricePerPlayer
      ]);
      const placeholders = scriptLinks.map(() => "(?, ?, ?)").join(", ");
      await connection.query(
        `INSERT INTO store_scripts (store_id, script_id, price_per_player) VALUES ${placeholders}`,
        values
      );
    }

    return { storeId: id, scriptIds, scriptLinks };
  });
}

export async function createPrivateStore(user, body) {
  return withDatabaseConnection(async (connection) => {
    const name = requireValue(body, "name");
    const city = requireValue(body, "city");
    const district = optionalText(body.district);
    const address = optionalText(body.address);
    const latitude = optionalLatitude(body.latitude);
    const longitude = optionalLongitude(body.longitude);
    const contactNote = optionalText(body.contactNote);

    assertPublicTextSafe("name", name);
    assertPublicTextSafe("city", city);
    assertPublicTextSafe("district", district);
    assertPublicTextSafe("address", address);
    assertPublicTextSafe("contactNote", contactNote);

    const [result] = await connection.query(
      `
        INSERT INTO stores
          (
            name, city, district, address, latitude, longitude, contact_note, status,
            visibility, review_status, created_by_user_id
          )
        VALUES (?, ?, ?, ?, ?, ?, ?, 'active', 'private', 'pending', ?)
      `,
      [name, city, district, address, latitude, longitude, contactNote, user.user.id]
    );
    return catalogResponse(await selectInserted(connection, "stores", result));
  });
}

export async function createStore(user, body) {
  return withDatabaseConnection(async (connection) => {
    const latitude = optionalLatitude(body.latitude);
    const longitude = optionalLongitude(body.longitude);
    const [result] = await connection.query(
      `
        INSERT INTO stores
          (
            name, city, district, address, latitude, longitude, contact_note,
            status, claim_status, created_by_admin_user_id
          )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        requireValue(body, "name"),
        requireValue(body, "city"),
        optionalText(body.district),
        optionalText(body.address),
        latitude,
        longitude,
        optionalText(body.contactNote),
        body.status || "active",
        body.claimStatus || "unclaimed",
        user.user.id
      ]
    );
    return selectInserted(connection, "stores", result);
  });
}

export async function updateStore(id, body) {
  const storeBody = { ...body };
  if (body.latitude !== undefined) {
    storeBody.latitude = optionalLatitude(body.latitude);
  }
  if (body.longitude !== undefined) {
    storeBody.longitude = optionalLongitude(body.longitude);
  }
  return withDatabaseConnection(async (connection) =>
    updateAllowed(connection, "stores", id, storeBody, [
      ["name", "name"],
      ["city", "city"],
      ["district", "district"],
      ["address", "address"],
      ["latitude", "latitude"],
      ["longitude", "longitude"],
      ["contactNote", "contact_note"],
      ["status", "status"],
      ["claimStatus", "claim_status"]
    ])
  );
}

async function hardDeleteCatalogEntity(
  connection,
  deleteSql,
  id,
  referenceSql,
  label,
  cleanupSqls = [],
  statusSql
) {
  const entityId = positiveId(id, `${label} id`);
  const [entityRows] = await connection.query(statusSql, [entityId]);
  const entity = entityRows[0];
  if (!entity) {
    throw notFound(`${label} not found`);
  }
  if (entity.status !== "inactive") {
    throw new AppError(
      409,
      "CATALOG_ENTITY_ACTIVE",
      `${label} must be inactive before deletion`
    );
  }

  const references = await countRows(connection, referenceSql, [entityId]);
  if (references > 0) {
    throw new AppError(409, "RESOURCE_IN_USE", `${label} is used by existing sessions`, {
      sessionCount: references
    });
  }

  for (const cleanupSql of cleanupSqls) {
    await connection.query(cleanupSql, [entityId]);
  }

  const [result] = await connection.query(deleteSql, [entityId]);
  if (result.affectedRows === 0) {
    throw notFound(`${label} not found`);
  }

  return { id: entityId, deleted: true };
}

export async function deleteStore(id) {
  return withTransaction((connection) =>
    hardDeleteCatalogEntity(
      connection,
      "DELETE FROM stores WHERE id = ?",
      id,
      "SELECT COUNT(*) AS count FROM sessions WHERE store_id = ?",
      "Store",
      ["DELETE FROM store_scripts WHERE store_id = ?"],
      "SELECT status FROM stores WHERE id = ?"
    )
  );
}

export async function createPrivateScript(user, body) {
  const name = requireValue(body, "name");
  const playerCount = positiveIntValue(requireValue(body, "playerCount"), "playerCount");
  const typeTags = body.typeTags;
  const summaryNoSpoiler = optionalText(body.summaryNoSpoiler);
  const defaultSeatTemplateJson = privateRoleTemplateJson(
    body.defaultSeatTemplate ?? body.defaultSeatTemplateJson,
    playerCount
  );

  assertPublicTextSafe("name", name);
  assertPublicTextSafe(
    "typeTags",
    Array.isArray(typeTags) ? typeTags.join(" ") : optionalText(typeTags)
  );
  assertPublicTextSafe("summaryNoSpoiler", summaryNoSpoiler);

  return withTransaction(async (connection) => {
    const [result] = await connection.query(
      `
        INSERT INTO scripts
          (
            name, type_tags, player_count, summary_no_spoiler,
            default_seat_template_json, status, visibility, review_status,
            created_by_user_id
          )
        VALUES (?, ?, ?, ?, ?, 'active', 'private', 'pending', ?)
      `,
      [
        name,
        jsonText(typeTags),
        playerCount,
        summaryNoSpoiler,
        defaultSeatTemplateJson,
        user.user.id
      ]
    );
    const script = await selectInserted(connection, "scripts", result);
    return scriptWithNpcRoles(connection, catalogResponse(publicScriptRow(script)));
  });
}

export async function createScript(user, body) {
  return withTransaction(async (connection) => {
    const [result] = await connection.query(
      `
        INSERT INTO scripts
          (
            name, type_tags, player_count, summary_no_spoiler,
            default_seat_template_json, status, claim_status, created_by_admin_user_id
          )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        requireValue(body, "name"),
        jsonText(body.typeTags),
        intValue(body.playerCount, 0),
        optionalText(body.summaryNoSpoiler),
        roleTemplateJson(body.defaultSeatTemplate ?? body.defaultSeatTemplateJson),
        body.status || "active",
        body.claimStatus || "unclaimed",
        user.user.id
      ]
    );
    const script = await selectInserted(connection, "scripts", result);
    await insertScriptNpcRoles(
      connection,
      script.id,
      normalizeNpcRoles(body.npcRoles ?? body.npc_roles, { source: "script" })
    );
    return scriptWithNpcRoles(connection, script);
  });
}

export async function updateScript(id, body) {
  const normalized = {
    ...body,
    typeTags: body.typeTags === undefined ? undefined : jsonText(body.typeTags),
    defaultSeatTemplateJson:
      body.defaultSeatTemplate === undefined && body.defaultSeatTemplateJson === undefined
        ? undefined
        : roleTemplateJson(body.defaultSeatTemplate ?? body.defaultSeatTemplateJson),
    playerCount:
      body.playerCount === undefined ? undefined : intValue(body.playerCount, 0)
  };

  const hasNpcRoles = body.npcRoles !== undefined || body.npc_roles !== undefined;

  return withTransaction(async (connection) => {
    const script = await updateAllowed(connection, "scripts", id, normalized, [
      ["name", "name"],
      ["typeTags", "type_tags"],
      ["playerCount", "player_count"],
      ["summaryNoSpoiler", "summary_no_spoiler"],
      ["defaultSeatTemplateJson", "default_seat_template_json"],
      ["status", "status"],
      ["claimStatus", "claim_status"]
    ]);
    if (hasNpcRoles) {
      await replaceScriptNpcRoles(
        connection,
        id,
        normalizeNpcRoles(body.npcRoles ?? body.npc_roles, { source: "script" })
      );
    }
    return scriptWithNpcRoles(connection, script);
  });
}

export async function deleteScript(id) {
  return withTransaction((connection) =>
    hardDeleteCatalogEntity(
      connection,
      "DELETE FROM scripts WHERE id = ?",
      id,
      "SELECT COUNT(*) AS count FROM sessions WHERE script_id = ?",
      "Script",
      [
        "DELETE FROM script_npc_roles WHERE script_id = ?",
        "DELETE FROM store_scripts WHERE script_id = ?"
      ],
      "SELECT status FROM scripts WHERE id = ?"
    )
  );
}

export async function createCatalogRequest(user, body) {
  return withDatabaseConnection(async (connection) => {
    const [result] = await connection.query(
      `
        INSERT INTO catalog_requests
          (request_type, requested_by_user_id, name, city, district, description)
        VALUES (?, ?, ?, ?, ?, ?)
      `,
      [
        normalizeRequestType(requireValue(body, "requestType")),
        user.user.id,
        requireValue(body, "name"),
        optionalText(body.city),
        optionalText(body.district),
        optionalText(body.description)
      ]
    );
    return selectInserted(connection, "catalog_requests", result);
  });
}

export async function listCatalogRequests(filters = {}) {
  return withDatabaseConnection(async (connection) => {
    const where = ["1 = 1"];
    const values = [];

    if (filters.status) {
      where.push("status = ?");
      values.push(String(filters.status));
    }
    if (filters.requestType) {
      where.push("request_type = ?");
      values.push(normalizeRequestType(filters.requestType));
    }
    if (filters.keyword) {
      where.push("(name LIKE ? OR city LIKE ? OR district LIKE ? OR description LIKE ?)");
      const keyword = likeKeyword(filters.keyword);
      values.push(keyword, keyword, keyword, keyword);
    }

    const [rows] = await connection.query(
      `SELECT * FROM catalog_requests WHERE ${where.join(" AND ")} ORDER BY id DESC LIMIT ${limitValue(filters.limit)} `,
      values
    );
    return rows;
  });
}

export async function reviewCatalogRequest(admin, id, body) {
  const status = requireValue(body, "status");
  if (!["approved", "rejected"].includes(status)) {
    throw badRequest("status must be approved or rejected");
  }

  return withTransaction(async (connection) => {
    const [rows] = await connection.query(
      "SELECT * FROM catalog_requests WHERE id = ? FOR UPDATE",
      [id]
    );
    const request = rows[0];
    if (!request) {
      throw notFound("Catalog request not found");
    }

    let createdEntityId = request.created_entity_id;
    if (status === "approved" && !createdEntityId) {
      if (request.request_type === "store") {
        const [result] = await connection.query(
          `
            INSERT INTO stores
              (name, city, district, address, contact_note, created_by_admin_user_id)
            VALUES (?, ?, ?, ?, ?, ?)
          `,
          [
            request.name,
            request.city || body.city || "北京",
            request.district || body.district || null,
            body.address || null,
            request.description,
            admin.user.id
          ]
        );
        createdEntityId = result.insertId;
      } else {
        const [result] = await connection.query(
          `
            INSERT INTO scripts
              (
                name, type_tags, player_count, summary_no_spoiler,
                default_seat_template_json, created_by_admin_user_id
              )
            VALUES (?, ?, ?, ?, ?, ?)
          `,
          [
            request.name,
            jsonText(body.typeTags),
            intValue(body.playerCount, 0),
            request.description,
            roleTemplateJson(body.defaultSeatTemplate ?? body.defaultSeatTemplateJson),
            admin.user.id
          ]
        );
        createdEntityId = result.insertId;
      }
    }

    await connection.query(
      `
        UPDATE catalog_requests
        SET status = ?,
            reviewed_by_admin_user_id = ?,
            review_note = ?,
            created_entity_id = ?,
            reviewed_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `,
      [status, admin.user.id, optionalText(body.reviewNote), createdEntityId, id]
    );

    return findById(connection, "catalog_requests", id);
  });
}

function catalogReviewConfig(type) {
  const entityType = normalizeEntityType(type);
  return entityType === "store"
    ? { type: "store", table: "stores", sessionColumn: "store_id", label: "Store" }
    : { type: "script", table: "scripts", sessionColumn: "script_id", label: "Script" };
}

function catalogReviewRow(type, row = {}) {
  return {
    ...catalogResponse(row),
    type,
    id: Number(row.id),
    created_by_user_id: row.created_by_user_id ? Number(row.created_by_user_id) : null,
    created_by_user_name: row.created_by_user_name || row.created_by_open_id || "",
    reviewed_by_admin_user_id: row.reviewed_by_admin_user_id
      ? Number(row.reviewed_by_admin_user_id)
      : null,
    merged_into_id: row.merged_into_id ? Number(row.merged_into_id) : null,
    merged_into_name: row.merged_into_name || "",
    session_count: Number(row.session_count || 0)
  };
}

async function catalogReviewRows(connection, config, whereSql, values, filters = {}) {
  const keywordValues = [];
  const conditions = [whereSql];
  if (filters.status) {
    conditions.push("item.review_status = ?");
    keywordValues.push(normalizeCatalogReviewStatus(filters.status));
  }
  if (filters.keyword) {
    conditions.push("(item.name LIKE ? OR item.review_note LIKE ?)");
    const keyword = likeKeyword(filters.keyword);
    keywordValues.push(keyword, keyword);
  }

  const [rows] = await connection.query(
    `
      SELECT
        item.*,
        submitter.nickname AS created_by_user_name,
        submitter.open_id AS created_by_open_id,
        merged.name AS merged_into_name,
        (
          SELECT COUNT(*)
          FROM sessions session
          WHERE session.${config.sessionColumn} = item.id
        ) AS session_count
      FROM ${config.table} item
      LEFT JOIN users submitter ON submitter.id = item.created_by_user_id
      LEFT JOIN ${config.table} merged ON merged.id = item.merged_into_id
      WHERE ${conditions.join(" AND ")}
      ORDER BY item.id DESC
      LIMIT ${limitValue(filters.limit)}
    `,
    [...values, ...keywordValues]
  );
  return rows.map((row) => catalogReviewRow(config.type, row));
}

export async function listMyCatalogReviewItems(user, filters = {}) {
  return withDatabaseConnection(async (connection) => {
    const stores = await catalogReviewRows(
      connection,
      catalogReviewConfig("store"),
      "item.created_by_user_id = ? AND item.visibility = 'private'",
      [user.user.id],
      filters
    );
    const scripts = await catalogReviewRows(
      connection,
      catalogReviewConfig("script"),
      "item.created_by_user_id = ? AND item.visibility = 'private'",
      [user.user.id],
      filters
    );
    return [...stores, ...scripts].sort((left, right) => Number(right.id) - Number(left.id));
  });
}

function catalogReviewPatch(config, body = {}, current = {}, options = {}) {
  const sets = [];
  const values = [];
  const add = (column, value) => {
    sets.push(`${column} = ?`);
    values.push(value);
  };

  if (body.name !== undefined) {
    const name = requireValue(body, "name");
    assertPublicTextSafe("name", name);
    add("name", name);
  }

  if (config.type === "store") {
    if (body.city !== undefined) {
      const city = requireValue(body, "city");
      assertPublicTextSafe("city", city);
      add("city", city);
    }
    for (const [bodyKey, column, label] of [
      ["district", "district", "district"],
      ["address", "address", "address"],
      ["contactNote", "contact_note", "contactNote"]
    ]) {
      if (body[bodyKey] !== undefined) {
        const value = optionalText(body[bodyKey]);
        assertPublicTextSafe(label, value);
        add(column, value);
      }
    }
    if (body.latitude !== undefined) {
      add("latitude", optionalLatitude(body.latitude));
    }
    if (body.longitude !== undefined) {
      add("longitude", optionalLongitude(body.longitude));
    }
  } else {
    if (body.typeTags !== undefined) {
      const value = body.typeTags;
      assertPublicTextSafe("typeTags", Array.isArray(value) ? value.join(" ") : optionalText(value));
      add("type_tags", jsonText(value));
    }
    let nextPlayerCount = current.player_count ? Number(current.player_count) : 0;
    if (body.playerCount !== undefined) {
      nextPlayerCount = positiveIntValue(body.playerCount, "playerCount");
      add("player_count", nextPlayerCount);
    }
    if (body.summaryNoSpoiler !== undefined) {
      const value = optionalText(body.summaryNoSpoiler);
      assertPublicTextSafe("summaryNoSpoiler", value);
      add("summary_no_spoiler", value);
    }
    if (body.defaultSeatTemplate !== undefined || body.defaultSeatTemplateJson !== undefined) {
      add(
        "default_seat_template_json",
        privateRoleTemplateJson(
          body.defaultSeatTemplate ?? body.defaultSeatTemplateJson,
          Math.max(nextPlayerCount, 1)
        )
      );
    }
  }

  if (options.allowReviewNote && body.reviewNote !== undefined) {
    add("review_note", optionalText(body.reviewNote));
  }

  return { sets, values };
}

async function lockCatalogReviewItem(connection, config, id) {
  const [rows] = await connection.query(
    `SELECT * FROM ${config.table} WHERE id = ? FOR UPDATE`,
    [positiveId(id, `${config.label} id`)]
  );
  const row = rows[0];
  if (!row) {
    throw notFound(`${config.label} not found`);
  }
  return row;
}

async function selectCatalogReviewItem(connection, config, id) {
  const rows = await catalogReviewRows(
    connection,
    config,
    "item.id = ?",
    [positiveId(id, `${config.label} id`)],
    { limit: 1 }
  );
  return rows[0] || null;
}

function assertPrivateReviewItem(row, config) {
  if (catalogVisibility(row) !== "private") {
    throw badRequest(`${config.label} is not a private review item`);
  }
}

export async function updateMyCatalogReviewItem(user, type, id, body = {}) {
  const config = catalogReviewConfig(type);
  return withTransaction(async (connection) => {
    const row = await lockCatalogReviewItem(connection, config, id);
    assertPrivateReviewItem(row, config);
    if (Number(row.created_by_user_id || 0) !== Number(user.user.id)) {
      throw notFound(`${config.label} not found`);
    }
    if (catalogReviewStatus(row) !== "needs_changes") {
      throw badRequest(`${config.label} can only be edited after changes are requested`);
    }

    const patch = catalogReviewPatch(config, body, row);
    const sets = [...patch.sets, "review_status = 'pending'", "review_note = NULL"];
    const values = [...patch.values, row.id];
    await connection.query(
      `UPDATE ${config.table} SET ${sets.join(", ")} WHERE id = ?`,
      values
    );
    return selectCatalogReviewItem(connection, config, row.id);
  });
}

export async function listAdminCatalogReviewItems(filters = {}) {
  return withDatabaseConnection(async (connection) => {
    const type = filters.type ? normalizeEntityType(filters.type) : "";
    const configs = type
      ? [catalogReviewConfig(type)]
      : [catalogReviewConfig("store"), catalogReviewConfig("script")];
    const rows = [];
    for (const config of configs) {
      rows.push(
        ...(await catalogReviewRows(
          connection,
          config,
          "item.visibility = 'private' AND item.review_status IN ('pending', 'needs_changes')",
          [],
          filters
        ))
      );
    }
    return rows.sort((left, right) => Number(right.id) - Number(left.id));
  });
}

export async function updateAdminCatalogReviewItem(admin, type, id, body = {}) {
  const config = catalogReviewConfig(type);
  return withTransaction(async (connection) => {
    const row = await lockCatalogReviewItem(connection, config, id);
    assertPrivateReviewItem(row, config);
    if (!["pending", "needs_changes"].includes(catalogReviewStatus(row))) {
      throw badRequest(`${config.label} cannot be edited in its current review status`);
    }
    const patch = catalogReviewPatch(config, body, row, { allowReviewNote: true });
    if (patch.sets.length > 0) {
      await connection.query(
        `UPDATE ${config.table} SET ${patch.sets.join(", ")} WHERE id = ?`,
        [...patch.values, row.id]
      );
    }
    if (config.type === "script" && (body.npcRoles !== undefined || body.npc_roles !== undefined)) {
      await replaceScriptNpcRoles(
        connection,
        row.id,
        normalizeNpcRoles(body.npcRoles ?? body.npc_roles, { source: "script" })
      );
    }
    return selectCatalogReviewItem(connection, config, row.id);
  });
}

function normalizeApprovedScriptStoreLinks(body = {}) {
  const links = [];
  if (Array.isArray(body.storeScriptLinks)) {
    for (const link of body.storeScriptLinks) {
      links.push({
        storeId: positiveId(link.storeId ?? link.store_id, "storeId"),
        pricePerPlayer: nonNegativeIntValue(
          link.pricePerPlayer ?? link.price_per_player ?? 0,
          "pricePerPlayer"
        )
      });
    }
  }
  if (Array.isArray(body.storeIds)) {
    for (const storeId of uniquePositiveIds(body.storeIds, "storeIds")) {
      links.push({ storeId, pricePerPlayer: 0 });
    }
  }
  const seen = new Set();
  return links.filter((link) => {
    if (seen.has(link.storeId)) {
      return false;
    }
    seen.add(link.storeId);
    return true;
  });
}

async function linkApprovedScriptToStores(connection, scriptId, body = {}) {
  const links = normalizeApprovedScriptStoreLinks(body);
  for (const link of links) {
    const store = await findById(connection, "stores", link.storeId);
    if (!isPublicCatalogUsable(store)) {
      throw badRequest(`storeId ${link.storeId} must be a public approved active store`);
    }
    await connection.query(
      `
        INSERT INTO store_scripts (store_id, script_id, price_per_player)
        VALUES (?, ?, ?)
        ON DUPLICATE KEY UPDATE price_per_player = VALUES(price_per_player)
      `,
      [link.storeId, scriptId, link.pricePerPlayer]
    );
  }
}

export async function approveCatalogReviewItem(admin, type, id, body = {}) {
  const config = catalogReviewConfig(type);
  return withTransaction(async (connection) => {
    const row = await lockCatalogReviewItem(connection, config, id);
    assertPrivateReviewItem(row, config);
    if (!["pending", "needs_changes"].includes(catalogReviewStatus(row))) {
      throw badRequest(`${config.label} cannot be approved in its current review status`);
    }
    const patch = catalogReviewPatch(config, body, row, { allowReviewNote: true });
    const sets = [
      ...patch.sets,
      "visibility = 'public'",
      "review_status = 'approved'",
      "status = 'active'",
      "reviewed_by_admin_user_id = ?",
      "reviewed_at = CURRENT_TIMESTAMP"
    ];
    const values = [...patch.values, admin.user.id, row.id];
    await connection.query(
      `UPDATE ${config.table} SET ${sets.join(", ")} WHERE id = ?`,
      values
    );
    if (config.type === "script") {
      if (body.npcRoles !== undefined || body.npc_roles !== undefined) {
        await replaceScriptNpcRoles(
          connection,
          row.id,
          normalizeNpcRoles(body.npcRoles ?? body.npc_roles, { source: "script" })
        );
      }
      await linkApprovedScriptToStores(connection, row.id, body);
    }
    return selectCatalogReviewItem(connection, config, row.id);
  });
}

export async function markCatalogReviewItemNeedsChanges(admin, type, id, body = {}) {
  const config = catalogReviewConfig(type);
  return withTransaction(async (connection) => {
    const row = await lockCatalogReviewItem(connection, config, id);
    assertPrivateReviewItem(row, config);
    await connection.query(
      `
        UPDATE ${config.table}
        SET review_status = 'needs_changes',
            review_note = ?,
            reviewed_by_admin_user_id = ?,
            reviewed_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `,
      [optionalText(body.reviewNote), admin.user.id, row.id]
    );
    return selectCatalogReviewItem(connection, config, row.id);
  });
}

export async function rejectCatalogReviewItem(admin, type, id, body = {}) {
  const config = catalogReviewConfig(type);
  return withTransaction(async (connection) => {
    const row = await lockCatalogReviewItem(connection, config, id);
    assertPrivateReviewItem(row, config);
    await connection.query(
      `
        UPDATE ${config.table}
        SET review_status = 'rejected',
            status = 'inactive',
            review_note = ?,
            reviewed_by_admin_user_id = ?,
            reviewed_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `,
      [optionalText(body.reviewNote), admin.user.id, row.id]
    );
    return selectCatalogReviewItem(connection, config, row.id);
  });
}

export async function mergeCatalogReviewItem(admin, type, id, body = {}) {
  const config = catalogReviewConfig(type);
  const targetId = positiveId(body.targetId ?? body.mergedIntoId, "targetId");
  return withTransaction(async (connection) => {
    const row = await lockCatalogReviewItem(connection, config, id);
    assertPrivateReviewItem(row, config);
    const target = await findById(connection, config.table, targetId);
    if (!isPublicCatalogUsable(target)) {
      throw badRequest("targetId must reference a public approved active item");
    }
    await connection.query(
      `
        UPDATE ${config.table}
        SET review_status = 'merged',
            status = 'inactive',
            merged_into_id = ?,
            review_note = ?,
            reviewed_by_admin_user_id = ?,
            reviewed_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `,
      [targetId, optionalText(body.reviewNote), admin.user.id, row.id]
    );
    return selectCatalogReviewItem(connection, config, row.id);
  });
}

export async function upsertPerformerProfile(user, body) {
  return withTransaction(async (connection) => {
    await ensureRole(connection, user.user.id, "performer");
    await connection.query(
      `
        INSERT INTO performer_profiles (user_id, display_name, city, bio)
        VALUES (?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          display_name = VALUES(display_name),
          city = VALUES(city),
          bio = VALUES(bio),
          status = 'active'
      `,
      [
        user.user.id,
        requireValue(body, "displayName"),
        optionalText(body.city),
        optionalText(body.bio)
      ]
    );

    const [rows] = await connection.query(
      "SELECT * FROM performer_profiles WHERE user_id = ?",
      [user.user.id]
    );
    return rows[0];
  });
}

export async function createEntityClaim(user, body) {
  return withDatabaseConnection(async (connection) => {
    const [result] = await connection.query(
      `
        INSERT INTO entity_claims (entity_type, entity_id, requested_by_user_id, note)
        VALUES (?, ?, ?, ?)
      `,
      [
        normalizeEntityType(requireValue(body, "entityType")),
        intValue(requireValue(body, "entityId")),
        user.user.id,
        optionalText(body.note)
      ]
    );
    return selectInserted(connection, "entity_claims", result);
  });
}

export async function createSession(user, body) {
  requireVerifiedPhone(user);

  return withTransaction(async (connection) => {
    assertPublicTextSafe("dmNameSnapshot", body.dmNameSnapshot);
    assertPublicTextSafe("npcNameSnapshot", body.npcNameSnapshot);

    const store = await findById(connection, "stores", requireValue(body, "storeId"));
    const script = await findById(connection, "scripts", requireValue(body, "scriptId"));
    assertCatalogUsableForSession(store, user, "Store");
    assertCatalogUsableForSession(script, user, "Script");

    await ensureRole(connection, user.user.id, "organizer");

    const [result] = await connection.query(
      `
        INSERT INTO sessions
          (
            organizer_user_id, script_id, script_name_snapshot, store_id,
            store_name_snapshot, start_at, dm_user_id, dm_name_snapshot,
            npc_user_id, npc_name_snapshot, deposit_amount, visibility,
            join_policy, join_phone_required, npc_join_enabled, note
          )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        user.user.id,
        script.id,
        script.name,
        store.id,
        store.name,
        requireValue(body, "startAt"),
        body.dmUserId || null,
        optionalText(body.dmNameSnapshot),
        body.npcUserId || null,
        optionalText(body.npcNameSnapshot),
        intValue(body.depositAmount, 0),
        normalizeSessionVisibility(body.visibility),
        normalizeJoinPolicy(body.joinPolicy ?? body.join_policy),
        normalizeJoinPhoneRequired(body.joinPhoneRequired ?? body.join_phone_required) ? 1 : 0,
        normalizeNpcJoinEnabled(body.npcJoinEnabled ?? body.npc_join_enabled) ? 1 : 0,
        optionalText(body.note)
      ]
    );

    const session = await findById(connection, "sessions", result.insertId);
    await cloneScriptNpcRolesForSession(connection, session.id, script.id);
    await insertSessionNpcRoles(
      connection,
      session.id,
      normalizeNpcRoles(body.extraNpcRoles ?? body.extra_npc_roles, { source: "session" }),
      { source: "session" }
    );
    await runSessionExtensionHook("afterSessionCreated", {
      connection,
      session,
      pinnedMessageText: body.pinnedMessageText
    });
    return session;
  });
}

function publicSessionAvailable(session) {
  const startAt = new Date(session.start_at).getTime();
  return (
    session.visibility === "public" &&
    session.status === "recruiting" &&
    Number.isFinite(startAt) &&
    startAt > Date.now()
  );
}

function publicSeatResponse(row = {}) {
  const {
    confirmed_user_id: _confirmedUserId,
    confirmed_user_nickname: _confirmedUserNickname,
    confirmed_user_open_id: _confirmedUserOpenId,
    confirmed_user_avatar_url: _confirmedUserAvatarUrl,
    confirmed_user_gender: _confirmedUserGender,
    ...seat
  } = row;
  return {
    ...seat,
    id: Number(seat.id),
    session_id: Number(seat.session_id)
  };
}

function publicSessionNpcRoleResponse(row = {}) {
  const {
    bound_user_id: boundUserId,
    bound_user_name: _boundUserName,
    bound_user_avatar_url: _boundUserAvatarUrl,
    bound_user_gender: _boundUserGender,
    pending_signup_id: pendingSignupId,
    pending_signup_user_id: _pendingSignupUserId,
    pending_signup_user_name: _pendingSignupUserName,
    pending_signup_user_avatar_url: _pendingSignupUserAvatarUrl,
    pending_signup_user_gender: _pendingSignupUserGender,
    ...role
  } = row;
  return {
    ...role,
    is_bound: Boolean(boundUserId),
    has_pending_signup: Boolean(pendingSignupId)
  };
}

async function memberSessionDetail(connection, session) {
  const id = Number(session.id);
  await cleanupSessionExclusiveRoleSelections(connection, id);
  const [seats] = await connection.query(
    `
      SELECT
        seat.*,
        user.nickname AS confirmed_user_nickname,
        user.open_id AS confirmed_user_open_id,
        user.avatar_url AS confirmed_user_avatar_url,
        user.gender AS confirmed_user_gender
      FROM session_seats seat
      LEFT JOIN users user ON user.id = seat.confirmed_user_id
      WHERE seat.session_id = ?
      ORDER BY seat.id
    `,
    [id]
  );
  const sessionNpcRoles = await sessionNpcRolesForSession(connection, id);
  const activeAlbumPhotoCount = await activeSessionAlbumPhotoCount(connection, id);
  const storeLocation = session.store_id
    ? await findById(connection, "stores", session.store_id)
    : null;
  const { note: _note, cancelled_by_user_id: _cancelledByUserId, ...safeSession } = session;
  return {
    ...safeSession,
    store_address: storeLocation?.address || null,
    store_latitude: storeLocation?.latitude ?? null,
    store_longitude: storeLocation?.longitude ?? null,
    join_policy: safeSession.join_policy || "review_required",
    join_phone_required: Boolean(Number(safeSession.join_phone_required ?? 1)),
    npc_join_enabled: Boolean(Number(safeSession.npc_join_enabled ?? 1)),
    active_album_photo_count: activeAlbumPhotoCount,
    photo_count: activeAlbumPhotoCount,
    seats,
    session_npc_roles: sessionNpcRoles
  };
}

async function publicSessionPreview(connection, session, accessScope = "public_preview") {
  const id = Number(session.id);
  const [seats] = await connection.query(
    `
      SELECT seat.*
      FROM session_seats seat
      WHERE seat.session_id = ?
      ORDER BY seat.id
    `,
    [id]
  );
  const sessionNpcRoles = await sessionNpcRolesForSession(connection, id);
  const storeLocation = session.store_id
    ? await findById(connection, "stores", session.store_id)
    : null;
  const {
    note: _note,
    cancelled_by_user_id: _cancelledByUserId,
    organizer_user_id: _organizerUserId,
    organizer_hidden_at: _organizerHiddenAt,
    dm_user_id: _dmUserId,
    npc_user_id: _npcUserId,
    ...safeSession
  } = session;
  return {
    ...safeSession,
    access_scope: accessScope,
    store_address: storeLocation?.address || null,
    store_latitude: storeLocation?.latitude ?? null,
    store_longitude: storeLocation?.longitude ?? null,
    join_policy: safeSession.join_policy || "review_required",
    join_phone_required: Boolean(Number(safeSession.join_phone_required ?? 1)),
    npc_join_enabled: Boolean(Number(safeSession.npc_join_enabled ?? 1)),
    seats: seats.map(publicSeatResponse),
    session_npc_roles: sessionNpcRoles.map(publicSessionNpcRoleResponse)
  };
}

export async function getSession(id) {
  const sessionId = positiveId(id, "sessionId");
  return withTransaction(async (connection) => {
    const session = await findById(connection, "sessions", sessionId);
    if (!session) {
      throw notFound("Session not found");
    }
    return memberSessionDetail(connection, session);
  });
}

export async function getSessionForViewer(id, options = {}) {
  const sessionId = positiveId(id, "sessionId");
  const viewer = options.viewer || null;
  const inviteClaims = options.inviteClaims || null;
  return withTransaction(async (connection) => {
    const session = await findById(connection, "sessions", sessionId);
    if (!session) {
      throw notFound("Session not found");
    }
    const memberAllowed = Boolean(
      viewer &&
        (isAdmin(viewer) || (await isSessionAlbumMember(connection, session, viewer.user.id)))
    );
    if (memberAllowed) {
      return {
        ...(await memberSessionDetail(connection, session)),
        access_scope: "member"
      };
    }
    if (publicSessionAvailable(session)) {
      return publicSessionPreview(connection, session);
    }
    if (
      inviteClaims &&
      Number(inviteClaims.sessionId) === sessionId &&
      session.status !== "cancelled"
    ) {
      return publicSessionPreview(connection, session, "invite_preview");
    }
    throw notFound("Session not found");
  });
}

export async function assertSessionJoinInviteAllowed(user, sessionId) {
  const id = positiveId(sessionId, "sessionId");
  return withDatabaseConnection(async (connection) => {
    const session = await findById(connection, "sessions", id);
    if (!session) {
      throw notFound("Session not found");
    }
    if (!(await isSessionAlbumMember(connection, session, user.user.id))) {
      throw forbidden("Only session members can share a join invitation");
    }
    return { session_id: id };
  });
}

export async function getSessionShareStats(sessionId) {
  return withDatabaseConnection(async (connection) => {
    const session = await findById(connection, "sessions", sessionId);
    if (!session) {
      throw notFound("Session not found");
    }

    const [eventRows] = await connection.query(
      `
        SELECT
          SUM(CASE WHEN event_type = 'view' THEN 1 ELSE 0 END) AS view_count,
          SUM(CASE WHEN event_type = 'convert' THEN 1 ELSE 0 END) AS convert_count,
          COUNT(DISTINCT CASE WHEN converted_signup_id IS NOT NULL THEN converted_signup_id END) AS converted_signup_count
        FROM share_events
        WHERE session_id = ?
      `,
      [sessionId]
    );
    const [signupRows] = await connection.query(
      `
        SELECT
          COUNT(*) AS signup_count,
          SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending_signup_count,
          SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) AS approved_signup_count
        FROM signups
        WHERE session_id = ?
      `,
      [sessionId]
    );
    const [seatRows] = await connection.query(
      `
        SELECT
          seat.id,
          seat.name,
          seat.status,
          COALESCE(event_stats.view_count, 0) AS view_count,
          COALESCE(event_stats.convert_count, 0) AS convert_count,
          COALESCE(signup_stats.signup_count, 0) AS signup_count
        FROM session_seats seat
        LEFT JOIN (
          SELECT
            seat_id,
            SUM(CASE WHEN event_type = 'view' THEN 1 ELSE 0 END) AS view_count,
            SUM(CASE WHEN event_type = 'convert' THEN 1 ELSE 0 END) AS convert_count
          FROM share_events
          WHERE session_id = ?
          GROUP BY seat_id
        ) event_stats ON event_stats.seat_id = seat.id
        LEFT JOIN (
          SELECT seat_id, COUNT(*) AS signup_count
          FROM signups
          WHERE session_id = ?
          GROUP BY seat_id
        ) signup_stats ON signup_stats.seat_id = seat.id
        WHERE seat.session_id = ?
        ORDER BY seat.id
      `,
      [sessionId, sessionId, sessionId]
    );

    const eventStats = eventRows[0] || {};
    const signupStats = signupRows[0] || {};

    return {
      session_id: Number(sessionId),
      view_count: Number(eventStats.view_count || 0),
      convert_count: Number(eventStats.convert_count || 0),
      converted_signup_count: Number(eventStats.converted_signup_count || 0),
      signup_count: Number(signupStats.signup_count || 0),
      pending_signup_count: Number(signupStats.pending_signup_count || 0),
      approved_signup_count: Number(signupStats.approved_signup_count || 0),
      seats: seatRows.map((seat) => ({
        ...seat,
        view_count: Number(seat.view_count || 0),
        convert_count: Number(seat.convert_count || 0),
        signup_count: Number(seat.signup_count || 0)
      }))
    };
  });
}

export async function listMySessions(user, filters = {}) {
  if (filters.scope === "album") {
    return listMyAlbumSessions(user, filters);
  }

  return withDatabaseConnection(async (connection) => {
    const where = [
      "session.organizer_user_id = ?"
    ];
    const values = [user.user.id];

    if (filters.status) {
      where.push("session.status = ?");
      values.push(String(filters.status));
    }

    const [rows] = await connection.query(
      `
        SELECT
          session.*,
          COUNT(DISTINCT seat.id) AS seat_count,
          COUNT(DISTINCT signup.id) AS signup_count,
          COUNT(DISTINCT CASE WHEN signup.status = 'pending' THEN signup.id END) AS pending_signup_count,
          COUNT(DISTINCT CASE
            WHEN seat.status IN ('confirmed', 'locked')
              AND seat.confirmed_user_id IS NOT NULL
              AND seat.confirmed_user_id <> session.organizer_user_id
            THEN seat.confirmed_user_id
          END) AS other_onboard_member_count,
          COUNT(DISTINCT album_photo.id) AS active_album_photo_count,
          COUNT(DISTINCT album_photo.id) AS photo_count
        FROM sessions session
        LEFT JOIN session_seats seat ON seat.session_id = session.id
        LEFT JOIN signups signup ON signup.session_id = session.id
        LEFT JOIN session_album_photos album_photo
          ON album_photo.session_id = session.id
          AND album_photo.status = 'active'
        WHERE ${where.join(" AND ")}
        GROUP BY session.id
        ORDER BY session.start_at DESC, session.id DESC
        LIMIT ${limitValue(filters.limit)}
      `,
      values
    );
    return rows;
  });
}

export async function listDiscoverableSessions(user, filters = {}) {
  const latitude = optionalLatitude(filters.latitude);
  const longitude = optionalLongitude(filters.longitude);
  if ((latitude === null) !== (longitude === null)) {
    throw badRequest("latitude and longitude must be provided together");
  }

  const city = normalizeDiscoveryCity(filters.city);
  const cityVariants = discoveryCityVariants(city);
  const hasCoordinates = latitude !== null && longitude !== null;
  const distanceSql = hasCoordinates
    ? `
        6371 * 2 * ASIN(
          SQRT(
            POWER(SIN(RADIANS(store.latitude - ?) / 2), 2)
            + COS(RADIANS(?)) * COS(RADIANS(store.latitude))
              * POWER(SIN(RADIANS(store.longitude - ?) / 2), 2)
          )
        )
      `
    : "NULL";
  const where = [
    "session.status = 'recruiting'",
    "session.start_at > CURRENT_TIMESTAMP",
    "session.visibility = 'public'",
    "session.organizer_user_id <> ?",
    `
      EXISTS (
        SELECT 1
        FROM session_seats open_seat
        WHERE open_seat.session_id = session.id
          AND open_seat.status = 'open'
      )
    `,
    `
      NOT EXISTS (
        SELECT 1
        FROM signups mine
        WHERE mine.session_id = session.id
          AND mine.user_id = ?
          AND mine.status IN ('pending', 'approved')
      )
    `
  ];
  const values = hasCoordinates ? [latitude, latitude, longitude] : [];
  values.push(user.user.id, user.user.id);
  if (cityVariants.length > 0) {
    where.push(`TRIM(store.city) IN (${cityVariants.map(() => "?").join(", ")})`);
    values.push(...cityVariants);
  }

  const orderSql = city
    ? `
        DATE(session.start_at) ASC,
        CASE WHEN distance_km IS NULL THEN 1 ELSE 0 END ASC,
        distance_km ASC,
        session.start_at ASC,
        session.id ASC
      `
    : "session.start_at ASC, session.id ASC";
  const rowLimit = city ? limitValue(filters.limit, 50) : 5;

  return withDatabaseConnection(async (connection) => {
    const [rows] = await connection.query(
      `
        SELECT
          session.id,
          session.script_name_snapshot,
          session.store_name_snapshot,
          session.start_at,
          session.status,
          store.city AS store_city,
          store.district AS store_district,
          (
            SELECT COUNT(*)
            FROM session_seats all_seat
            WHERE all_seat.session_id = session.id
          ) AS seat_count,
          (
            SELECT COUNT(*)
            FROM session_seats available_seat
            WHERE available_seat.session_id = session.id
              AND available_seat.status = 'open'
          ) AS available_seat_count,
          ${distanceSql} AS distance_km
        FROM sessions session
        JOIN stores store ON store.id = session.store_id
        WHERE ${where.join(" AND ")}
        ORDER BY ${orderSql}
        LIMIT ${rowLimit}
      `,
      values
    );

    return rows.map((row) => ({
      id: Number(row.id),
      script_name_snapshot: row.script_name_snapshot,
      store_name_snapshot: row.store_name_snapshot,
      store_city: row.store_city || null,
      store_district: row.store_district || null,
      start_at: row.start_at,
      status: row.status,
      seat_count: Number(row.seat_count || 0),
      available_seat_count: Number(row.available_seat_count || 0),
      distance_km:
        row.distance_km === null || row.distance_km === undefined
          ? null
          : Number(Number(row.distance_km).toFixed(1))
    }));
  });
}

export async function listPublicUpcomingSessions(filters = {}) {
  const rowLimit = Math.min(limitValue(filters.limit, 20), 20);
  return withDatabaseConnection(async (connection) => {
    const [rows] = await connection.query(
      `
        SELECT
          session.id,
          session.script_name_snapshot,
          session.store_name_snapshot,
          session.start_at,
          session.status,
          store.city AS store_city,
          store.district AS store_district,
          (
            SELECT COUNT(*)
            FROM session_seats all_seat
            WHERE all_seat.session_id = session.id
          ) AS seat_count,
          (
            SELECT COUNT(*)
            FROM session_seats available_seat
            WHERE available_seat.session_id = session.id
              AND available_seat.status = 'open'
          ) AS available_seat_count,
          (
            SELECT COUNT(*)
            FROM session_npc_roles available_npc
            WHERE available_npc.session_id = session.id
              AND available_npc.status = 'active'
              AND available_npc.bound_user_id IS NULL
              AND NOT EXISTS (
                SELECT 1
                FROM signups pending_npc_signup
                WHERE pending_npc_signup.session_npc_role_id = available_npc.id
                  AND pending_npc_signup.status = 'pending'
              )
          ) AS available_npc_count
        FROM sessions session
        JOIN stores store ON store.id = session.store_id
        WHERE session.visibility = 'public'
          AND session.status = 'recruiting'
          AND session.start_at > CURRENT_TIMESTAMP
          AND (
            EXISTS (
              SELECT 1
              FROM session_seats open_seat
              WHERE open_seat.session_id = session.id
                AND open_seat.status = 'open'
            )
            OR EXISTS (
              SELECT 1
              FROM session_npc_roles open_npc
              WHERE open_npc.session_id = session.id
                AND open_npc.status = 'active'
                AND open_npc.bound_user_id IS NULL
                AND NOT EXISTS (
                  SELECT 1
                  FROM signups pending_npc_signup
                  WHERE pending_npc_signup.session_npc_role_id = open_npc.id
                    AND pending_npc_signup.status = 'pending'
                )
            )
          )
        ORDER BY session.start_at ASC, session.id ASC
        LIMIT ${rowLimit}
      `
    );

    return rows.map((row) => ({
      id: Number(row.id),
      script_name_snapshot: row.script_name_snapshot,
      store_name_snapshot: row.store_name_snapshot,
      store_city: row.store_city || null,
      store_district: row.store_district || null,
      start_at: row.start_at,
      status: row.status,
      seat_count: Number(row.seat_count || 0),
      available_seat_count: Number(row.available_seat_count || 0),
      available_npc_count: Number(row.available_npc_count || 0)
    }));
  });
}

export async function listAdminSessions(filters = {}) {
  return withDatabaseConnection(async (connection) => {
    const where = [];
    const values = [];
    const keyword = String(filters.keyword || "").trim();

    if (keyword) {
      where.push(
        `
          (
            CAST(session.id AS CHAR) LIKE ?
            OR session.script_name_snapshot LIKE ?
            OR session.store_name_snapshot LIKE ?
            OR organizer.nickname LIKE ?
            OR organizer.open_id LIKE ?
          )
        `
      );
      const likeValue = likeKeyword(keyword);
      values.push(likeValue, likeValue, likeValue, likeValue, likeValue);
    }

    if (filters.status) {
      where.push("session.status = ?");
      values.push(String(filters.status));
    }

    const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
    const [rows] = await connection.query(
      `
        SELECT
          session.*,
          organizer.nickname AS organizer_nickname,
          organizer.open_id AS organizer_open_id,
          COUNT(DISTINCT seat.id) AS seat_count,
          COUNT(DISTINCT signup.id) AS signup_count,
          COUNT(DISTINCT CASE WHEN signup.status = 'pending' THEN signup.id END) AS pending_signup_count,
          COUNT(DISTINCT CASE
            WHEN seat.status IN ('confirmed', 'locked') AND seat.confirmed_user_id IS NOT NULL
            THEN seat.id
          END) AS confirmed_seat_count
        FROM sessions session
        JOIN users organizer ON organizer.id = session.organizer_user_id
        LEFT JOIN session_seats seat ON seat.session_id = session.id
        LEFT JOIN signups signup ON signup.session_id = session.id
        ${whereSql}
        GROUP BY session.id
        ORDER BY session.start_at DESC, session.id DESC
        LIMIT ${limitValue(filters.limit)}
      `,
      values
    );
    return rows;
  });
}

export async function listMyAlbumSessions(user, filters = {}) {
  const userId = user.user.id;
  return withDatabaseConnection(async (connection) => {
    const where = [
      `
        (
          session.organizer_user_id = ?
          OR session.dm_user_id = ?
          OR session.npc_user_id = ?
          OR EXISTS (
            SELECT 1
            FROM session_seats member_seat
            WHERE member_seat.session_id = session.id
              AND member_seat.confirmed_user_id = ?
              AND member_seat.status IN ('confirmed', 'locked')
          )
          OR EXISTS (
            SELECT 1
            FROM session_npc_roles member_npc_role
            WHERE member_npc_role.session_id = session.id
              AND member_npc_role.bound_user_id = ?
              AND member_npc_role.status = 'active'
          )
        )
      `
    ];
    const values = [userId, userId, userId, userId, userId];

    if (filters.status) {
      where.push("session.status = ?");
      values.push(String(filters.status));
    }

    const [rows] = await connection.query(
      `
        SELECT
          session.*,
          CASE
            WHEN session.organizer_user_id = ? THEN 'organizer'
            WHEN session.dm_user_id = ? THEN 'dm'
            WHEN session.npc_user_id = ? THEN 'npc'
            WHEN EXISTS (
              SELECT 1
              FROM session_npc_roles role_membership
              WHERE role_membership.session_id = session.id
                AND role_membership.bound_user_id = ?
                AND role_membership.status = 'active'
            ) THEN 'npc_role'
            ELSE 'seat'
          END AS album_membership_role,
          COUNT(DISTINCT seat.id) AS seat_count,
          COUNT(DISTINCT signup.id) AS signup_count,
          COUNT(DISTINCT CASE WHEN signup.status = 'pending' THEN signup.id END) AS pending_signup_count
        FROM sessions session
        LEFT JOIN session_seats seat ON seat.session_id = session.id
        LEFT JOIN signups signup ON signup.session_id = session.id
        WHERE ${where.join(" AND ")}
        GROUP BY session.id
        ORDER BY session.start_at DESC, session.id DESC
        LIMIT ${limitValue(filters.limit)}
      `,
      [userId, userId, userId, userId, ...values]
    );
    return rows;
  });
}

async function sessionOrganizerCandidates(connection, session, excludeUserId = null) {
  const excluded = Number(excludeUserId || 0);
  const seen = new Set();
  const candidates = [];

  function addCandidate(candidate) {
    const userId = Number(candidate.user_id || 0);
    if (!userId || userId === excluded || seen.has(userId)) {
      return;
    }
    seen.add(userId);
    candidates.push({
      ...candidate,
      user_id: userId
    });
  }

  const [seatRows] = await connection.query(
    `
      SELECT
        confirmed_user_id AS user_id,
        id AS seat_id,
        name,
        role_name
      FROM session_seats
      WHERE session_id = ?
        AND confirmed_user_id IS NOT NULL
        AND status IN ('confirmed', 'locked')
      ORDER BY id
    `,
    [session.id]
  );
  for (const seat of seatRows) {
    addCandidate({
      user_id: seat.user_id,
      source: "seat",
      label: seat.name || seat.role_name || "车友",
      seat_id: seat.seat_id
    });
  }

  const [npcRoleRows] = await connection.query(
    `
      SELECT
        bound_user_id AS user_id,
        id AS session_npc_role_id,
        name
      FROM session_npc_roles
      WHERE session_id = ?
        AND bound_user_id IS NOT NULL
        AND status = 'active'
      ORDER BY sort_order, id
    `,
    [session.id]
  );
  for (const role of npcRoleRows) {
    addCandidate({
      user_id: role.user_id,
      source: "npc_role",
      label: role.name || "NPC角色",
      seat_id: null,
      session_npc_role_id: role.session_npc_role_id
    });
  }

  addCandidate({
    user_id: session.npc_user_id,
    source: "npc",
    label: session.npc_name_snapshot || "NPC",
    seat_id: null
  });
  addCandidate({
    user_id: session.dm_user_id,
    source: "dm",
    label: session.dm_name_snapshot || "DM",
    seat_id: null
  });

  return candidates;
}

async function findSessionForOrganizerChange(connection, sessionId) {
  const [rows] = await connection.query("SELECT * FROM sessions WHERE id = ? FOR UPDATE", [
    sessionId
  ]);
  return rows[0] || null;
}

async function updateSessionOrganizer(connection, sessionId, targetUserId) {
  await ensureRole(connection, targetUserId, "organizer");
  await connection.query(
    `
      UPDATE sessions
      SET organizer_user_id = ?
      WHERE id = ?
    `,
    [targetUserId, sessionId]
  );
  return findById(connection, "sessions", sessionId);
}

export async function transferSessionOrganizer(user, sessionId, body = {}) {
  const id = positiveId(sessionId, "sessionId");
  const targetUserId = positiveId(
    body.targetUserId ?? body.target_user_id,
    "targetUserId"
  );

  return withTransaction(async (connection) => {
    const session = await findSessionForOrganizerChange(connection, id);
    if (!session) {
      throw notFound("Session not found");
    }
    if (!isAdmin(user) && Number(session.organizer_user_id) !== Number(user.user.id)) {
      throw forbidden("Only the session organizer can transfer this session");
    }
    if (Number(session.organizer_user_id) === targetUserId) {
      throw badRequest("targetUserId is already the session organizer");
    }

    const candidates = await sessionOrganizerCandidates(connection, session);
    if (!candidates.some((candidate) => candidate.user_id === targetUserId)) {
      throw forbidden("Only onboard session members can become organizer");
    }

    return updateSessionOrganizer(connection, id, targetUserId);
  });
}

export async function leaveSessionOrganizer(user, sessionId) {
  const id = positiveId(sessionId, "sessionId");

  return withTransaction(async (connection) => {
    const session = await findSessionForOrganizerChange(connection, id);
    if (!session) {
      throw notFound("Session not found");
    }
    if (Number(session.organizer_user_id) !== Number(user.user.id)) {
      throw forbidden("Only the current session organizer can leave as organizer");
    }

    const candidates = await sessionOrganizerCandidates(connection, session, user.user.id);
    if (candidates.length === 0) {
      throw conflict("No onboard session member can become organizer");
    }

    return updateSessionOrganizer(connection, id, candidates[0].user_id);
  });
}

export async function relinkMySessionMembership(user, sessionId) {
  const id = positiveId(sessionId, "sessionId");
  return withTransaction(async (connection) => {
    const session = await findById(connection, "sessions", id);
    if (!session) {
      throw notFound("Session not found");
    }

    const organizerRelinked = Number(session.organizer_user_id) === Number(user.user.id);
    const [signupRows] = await connection.query(
      `
        SELECT id
        FROM signups
        WHERE session_id = ?
          AND user_id = ?
      `,
      [id, user.user.id]
    );
    const signupRelinked = signupRows.length > 0;
    if (signupRelinked) {
      await connection.query(
        `
          UPDATE signups
          SET user_hidden_at = NULL
          WHERE session_id = ?
            AND user_id = ?
        `,
        [id, user.user.id]
      );
    }

    if (!organizerRelinked && !signupRelinked) {
      throw forbidden("Only existing session members can relink this session");
    }

    return {
      session_id: id,
      organizer_relinked: organizerRelinked,
      signup_relinked: signupRelinked
    };
  });
}

export async function updateSession(user, id, body) {
  return withDatabaseConnection(async (connection) => {
    await requireSessionOwner(connection, id, user);
    assertPublicTextSafe("dmNameSnapshot", body.dmNameSnapshot);
    assertPublicTextSafe("npcNameSnapshot", body.npcNameSnapshot);
    const normalized = {
      ...body,
      visibility:
        body.visibility === undefined
          ? undefined
          : normalizeSessionVisibility(body.visibility),
      joinPolicy:
        body.joinPolicy === undefined && body.join_policy === undefined
          ? undefined
          : normalizeJoinPolicy(body.joinPolicy ?? body.join_policy),
      joinPhoneRequired:
        body.joinPhoneRequired === undefined && body.join_phone_required === undefined
          ? undefined
          : normalizeJoinPhoneRequired(body.joinPhoneRequired ?? body.join_phone_required)
            ? 1
            : 0,
      npcJoinEnabled:
        body.npcJoinEnabled === undefined && body.npc_join_enabled === undefined
          ? undefined
          : normalizeNpcJoinEnabled(body.npcJoinEnabled ?? body.npc_join_enabled)
            ? 1
            : 0
    };
    return updateAllowed(connection, "sessions", id, normalized, [
      ["startAt", "start_at"],
      ["dmUserId", "dm_user_id"],
      ["dmNameSnapshot", "dm_name_snapshot"],
      ["npcUserId", "npc_user_id"],
      ["npcNameSnapshot", "npc_name_snapshot"],
      ["depositAmount", "deposit_amount"],
      ["visibility", "visibility"],
      ["joinPolicy", "join_policy"],
      ["joinPhoneRequired", "join_phone_required"],
      ["npcJoinEnabled", "npc_join_enabled"],
      ["note", "note"],
      ["status", "status"]
    ]);
  });
}

async function requireSessionNpcRoleOwner(connection, npcRoleId, user) {
  const [rows] = await connection.query(
    `
      SELECT role.*, session.organizer_user_id
      FROM session_npc_roles role
      JOIN sessions session ON session.id = role.session_id
      WHERE role.id = ?
    `,
    [npcRoleId]
  );
  const role = rows[0];
  if (!role) {
    throw notFound("Session NPC role not found");
  }
  if (!isAdmin(user) && Number(role.organizer_user_id) !== Number(user.user.id)) {
    throw forbidden("Only the session organizer can manage NPC roles");
  }
  return role;
}

function nullableBoundUserId(body = {}) {
  if (
    body.boundUserId === undefined &&
    body.bound_user_id === undefined &&
    body.userId === undefined &&
    body.user_id === undefined
  ) {
    return undefined;
  }
  const value = body.boundUserId ?? body.bound_user_id ?? body.userId ?? body.user_id;
  if (value === null || value === "") {
    return null;
  }
  return positiveId(value, "boundUserId");
}

function normalizeNpcRoleStatus(value) {
  if (value === undefined) {
    return undefined;
  }
  const status = String(value || "").trim();
  if (!["active", "inactive"].includes(status)) {
    throw badRequest("npc role status must be active or inactive");
  }
  return status;
}

export async function listSessionNpcRoles(user, sessionId) {
  const id = positiveId(sessionId, "sessionId");
  return withDatabaseConnection(async (connection) => {
    await requireSessionOwner(connection, id, user);
    return {
      session_id: id,
      npc_roles: await sessionNpcRolesForSession(connection, id)
    };
  });
}

export async function createSessionNpcRole(user, sessionId, body = {}) {
  const id = positiveId(sessionId, "sessionId");
  return withTransaction(async (connection) => {
    await requireSessionOwner(connection, id, user);
    const [role] = normalizeNpcRoles([body], { source: "session" });
    if (!role) {
      throw badRequest("npc role name is required");
    }
    await insertSessionNpcRoles(connection, id, [role], { source: "session" });
    const roles = await sessionNpcRolesForSession(connection, id);
    return roles[roles.length - 1] || null;
  });
}

export async function updateSessionNpcRole(user, npcRoleId, body = {}) {
  const id = positiveId(npcRoleId, "npcRoleId");
  return withDatabaseConnection(async (connection) => {
    const current = await requireSessionNpcRoleOwner(connection, id, user);
    assertPublicTextSafe("npcRoleName", body.name);
    assertPublicTextSafe("npcRoleDescription", body.description || body.note);
    const normalized = {
      ...body,
      description:
        body.description === undefined && body.note === undefined
          ? undefined
          : optionalText(body.description ?? body.note),
      source: body.source === undefined ? undefined : normalizeNpcRoleSource(body.source),
      roleGender:
        body.roleGender === undefined && body.role_gender === undefined && body.gender === undefined
          ? undefined
          : normalizeRoleGender(body.roleGender ?? body.role_gender ?? body.gender),
      boundUserId: nullableBoundUserId(body),
      sortOrder:
        body.sortOrder === undefined && body.sort_order === undefined
          ? undefined
          : nonNegativeIntValue(body.sortOrder ?? body.sort_order, "sortOrder"),
      status: normalizeNpcRoleStatus(body.status)
    };
    const updated = await updateAllowed(connection, "session_npc_roles", id, normalized, [
      ["name", "name"],
      ["description", "description"],
      ["roleGender", "role_gender"],
      ["source", "source"],
      ["boundUserId", "bound_user_id"],
      ["sortOrder", "sort_order"],
      ["status", "status"]
    ]);
    const [withUserRows] = await connection.query(
      `
        SELECT
          role.*,
          user.nickname AS bound_user_nickname,
          user.open_id AS bound_user_open_id,
          user.avatar_url AS bound_user_avatar_url,
          user.gender AS bound_user_gender
        FROM session_npc_roles role
        LEFT JOIN users user ON user.id = role.bound_user_id
        WHERE role.id = ?
      `,
      [updated.id || current.id]
    );
    return sessionNpcRoleResponse(withUserRows[0] || updated);
  });
}

export async function createSeat(user, sessionId, body) {
  return withDatabaseConnection(async (connection) => {
    await requireSessionOwner(connection, sessionId, user);
    assertPublicTextSafe("seatName", body.name);
    assertPublicTextSafe("roleName", body.roleName);
    const basePrice = intValue(body.basePrice, 0);
    const adjustment = intValue(body.adjustment, 0);
    const payablePrice = assertPayable(basePrice, adjustment);

    const [result] = await connection.query(
      `
        INSERT INTO session_seats
          (
            session_id, name, seat_type, role_name, role_gender,
            base_price, adjustment, payable_price
          )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        sessionId,
        requireValue(body, "name"),
        body.seatType || "normal",
        optionalText(body.roleName),
        normalizeRoleGender(body.roleGender),
        basePrice,
        adjustment,
        payablePrice
      ]
    );
    return selectInserted(connection, "session_seats", result);
  });
}

export async function updateSeat(user, seatId, body) {
  return withDatabaseConnection(async (connection) => {
    const current = await requireSeatOwner(connection, seatId, user);
    assertPublicTextSafe("seatName", body.name);
    assertPublicTextSafe("roleName", body.roleName);
    const basePrice =
      body.basePrice === undefined ? current.base_price : intValue(body.basePrice, 0);
    const adjustment =
      body.adjustment === undefined ? current.adjustment : intValue(body.adjustment, 0);
    const payablePrice = assertPayable(basePrice, adjustment);

    return updateAllowed(
      connection,
      "session_seats",
      seatId,
      {
        ...body,
        basePrice,
        adjustment,
        payablePrice,
        roleGender:
          body.roleGender === undefined ? undefined : normalizeRoleGender(body.roleGender)
      },
      [
        ["name", "name"],
        ["seatType", "seat_type"],
        ["roleName", "role_name"],
        ["roleGender", "role_gender"],
        ["basePrice", "base_price"],
        ["adjustment", "adjustment"],
        ["payablePrice", "payable_price"],
        ["status", "status"]
      ]
    );
  });
}

export async function publishSession(user, sessionId) {
  return withTransaction(async (connection) => {
    await requireSessionOwner(connection, sessionId, user);
    const [seats] = await connection.query(
      "SELECT * FROM session_seats WHERE session_id = ? FOR UPDATE",
      [sessionId]
    );
    if (seats.length === 0) {
      throw badRequest("At least one seat is required before publish");
    }

    const adjustmentSum = seats.reduce((sum, seat) => sum + Number(seat.adjustment), 0);
    if (adjustmentSum !== 0) {
      throw badRequest("Seat adjustments must sum to 0");
    }

    const negativeSeat = seats.find((seat) => Number(seat.payable_price) < 0);
    if (negativeSeat) {
      throw badRequest("Seat payable price cannot be negative");
    }

    await connection.query(
      "UPDATE sessions SET status = 'recruiting' WHERE id = ?",
      [sessionId]
    );
    return findById(connection, "sessions", sessionId);
  });
}

async function signupNotificationPayload(connection, signupId) {
  const [rows] = await connection.query(
    `
      SELECT
        signup.id,
        signup.session_id,
        signup.status,
        session.script_name_snapshot,
        session.start_at,
        seat.name AS seat_name,
        seat.role_name,
        npc_role.name AS npc_role_name,
        npc_role.role_gender AS npc_role_gender,
        organizer.open_id AS organizer_open_id,
        applicant.open_id AS applicant_open_id,
        applicant.nickname AS applicant_nickname
      FROM signups signup
      JOIN sessions session ON session.id = signup.session_id
      LEFT JOIN session_seats seat ON seat.id = signup.seat_id
      LEFT JOIN session_npc_roles npc_role ON npc_role.id = signup.session_npc_role_id
      JOIN users organizer ON organizer.id = session.organizer_user_id
      JOIN users applicant ON applicant.id = signup.user_id
      WHERE signup.id = ?
    `,
    [signupId]
  );
  const row = rows[0];
  if (!row) {
    return null;
  }
  return {
    signupId: Number(row.id),
    sessionId: Number(row.session_id),
    status: row.status,
    scriptName: row.script_name_snapshot,
    seatName: row.role_name || row.seat_name || row.npc_role_name || "NPC角色",
    startAt: row.start_at,
    organizerOpenId: row.organizer_open_id,
    applicantOpenId: row.applicant_open_id,
    actorName: row.applicant_nickname || "新申请"
  };
}

async function tryNotify(label, sendNotification) {
  try {
    return await sendNotification();
  } catch (error) {
    console.warn(`${label} failed`, {
      message: error?.message || String(error)
    });
    return {
      ok: false,
      skipped: false,
      error: error?.message || String(error)
    };
  }
}

export async function createSignup(user, body) {
  const { signup, notification } = await withTransaction(async (connection) => {
    const seatId = requireValue(body, "seatId");
    const [rows] = await connection.query(
      `
        SELECT
          seat.*,
          session.status AS session_status,
          COALESCE(session.join_phone_required, 1) AS join_phone_required,
          (session.start_at <= CURRENT_TIMESTAMP) AS session_started
        FROM session_seats seat
        JOIN sessions session ON session.id = seat.session_id
        WHERE seat.id = ?
        FOR UPDATE
      `,
      [seatId]
    );
    const seat = rows[0];
    if (!seat) {
      throw notFound("Seat not found");
    }
    const acceptsSignup =
      seat.session_status === "recruiting" ||
      (
        seat.session_status === "locked" &&
        Number(seat.session_started || 0) === 1
      );
    if (!acceptsSignup) {
      throw badRequest("Session is not recruiting");
    }
    if (["confirmed", "locked", "cancelled"].includes(seat.status)) {
      throw conflict("Seat is not open for signup");
    }
    await assertUserCanJoinSession(connection, seat.session_id, user.user.id);
    requireJoinPhoneIfNeeded(user, seat);
    await releaseUserOtherConfirmedSeats(
      connection,
      seat.session_id,
      user.user.id,
      seat.id
    );
    await releaseUserOtherSessionNpcRoles(
      connection,
      seat.session_id,
      user.user.id,
      0
    );
    await cancelUserOtherPendingSignups(
      connection,
      seat.session_id,
      user.user.id,
      seat.id,
      0
    );

    const contactText = optionalText(body.contactText);
    const note = optionalText(body.note);
    const [existingRows] = await connection.query(
      `
        SELECT *
        FROM signups
        WHERE seat_id = ? AND user_id = ?
        FOR UPDATE
      `,
      [seat.id, user.user.id]
    );
    let signup;
    const existingSignup = existingRows[0];
    if (existingSignup) {
      if (!["rejected", "cancelled"].includes(existingSignup.status)) {
        throw conflict("Signup already exists");
      }
      await connection.query(
        `
          UPDATE signups
          SET status = 'pending',
              deposit_status = 'unpaid',
              contact_text = ?,
              note = ?,
              review_eligible_at = NULL,
              user_hidden_at = NULL
          WHERE id = ?
        `,
        [contactText, note, existingSignup.id]
      );
      signup = await findById(connection, "signups", existingSignup.id);
    } else {
      const [result] = await connection.query(
        `
          INSERT INTO signups
            (session_id, seat_id, session_npc_role_id, signup_type, user_id, contact_text, note)
          VALUES (?, ?, NULL, 'seat', ?, ?, ?)
        `,
        [
          seat.session_id,
          seat.id,
          user.user.id,
          contactText,
          note
        ]
      );
      signup = await findById(connection, "signups", result.insertId);
    }

    if (seat.status === "open") {
      await connection.query("UPDATE session_seats SET status = 'applied' WHERE id = ?", [
        seat.id
      ]);
    }

    return {
      signup,
      notification: await signupNotificationPayload(connection, signup.id)
    };
  });
  await tryNotify("notifySignupCreated", () => notifySignupCreated(notification));
  return signup;
}

function forbidPlayerDirectClaim(user, seat) {
  if (isAdmin(user) || Number(seat.organizer_user_id) === Number(user.user.id)) {
    return;
  }
  if ((seat.join_policy || "review_required") === "direct") {
    return;
  }
  throw forbidden("Seat claim requires organizer review");
}

export async function claimSessionSeat(user, seatId, body = {}) {
  return withTransaction(async (connection) => {
    const [seatRefs] = await connection.query(
      "SELECT session_id FROM session_seats WHERE id = ?",
      [seatId]
    );
    const seatRef = seatRefs[0];
    if (!seatRef) {
      throw notFound("Seat not found");
    }

    await lockSessionSeats(connection, seatRef.session_id);

    const [rows] = await connection.query(
      `
        SELECT
          seat.*,
          session.organizer_user_id,
          session.join_policy,
          COALESCE(session.join_phone_required, 1) AS join_phone_required,
          session.status AS session_status,
          (session.start_at <= CURRENT_TIMESTAMP) AS session_started
        FROM session_seats seat
        JOIN sessions session ON session.id = seat.session_id
        WHERE seat.id = ?
      `,
      [seatId]
    );
    const seat = rows[0];
    if (!seat) {
      throw notFound("Seat not found");
    }
    await assertUserCanJoinSession(connection, seat.session_id, user.user.id);
    forbidPlayerDirectClaim(user, seat);
    requireJoinPhoneIfNeeded(user, seat);
    const canClaimStartedOpenSeat =
      seat.session_status === "locked" &&
      Number(seat.session_started || 0) === 1 &&
      seat.status === "open";
    const isCurrentUserSeat =
      seat.confirmed_user_id &&
      Number(seat.confirmed_user_id) === Number(user.user.id);
    if (
      seat.session_status !== "recruiting" &&
      !canClaimStartedOpenSeat &&
      !isCurrentUserSeat
    ) {
      throw badRequest("Session is not recruiting");
    }
    if (seat.status === "cancelled") {
      throw conflict("Seat is not open for claim");
    }
    if (
      seat.confirmed_user_id &&
      Number(seat.confirmed_user_id) !== Number(user.user.id)
    ) {
      throw conflict("Seat already has a confirmed user");
    }
    if (seat.status === "locked") {
      throw conflict("Seat is locked");
    }
    await releaseUserOtherConfirmedSeats(
      connection,
      seat.session_id,
      user.user.id,
      seat.id
    );
    await releaseUserOtherSessionNpcRoles(
      connection,
      seat.session_id,
      user.user.id,
      0
    );
    await cancelUserOtherPendingSignups(
      connection,
      seat.session_id,
      user.user.id,
      seat.id,
      0
    );

    await connection.query(
      `
        INSERT INTO signups
          (
            session_id, seat_id, session_npc_role_id, signup_type,
            user_id, contact_text, note, status, review_eligible_at
          )
        VALUES (?, ?, NULL, 'seat', ?, ?, ?, 'approved', CURRENT_TIMESTAMP)
        ON DUPLICATE KEY UPDATE
          signup_type = 'seat',
          status = 'approved',
          contact_text = VALUES(contact_text),
          note = VALUES(note),
          review_eligible_at = COALESCE(review_eligible_at, CURRENT_TIMESTAMP)
      `,
      [
        seat.session_id,
        seat.id,
        user.user.id,
        optionalText(body.contactText),
        optionalText(body.note)
      ]
    );
    await connection.query(
      `
        UPDATE signups
        SET status = 'rejected'
        WHERE seat_id = ?
          AND user_id <> ?
          AND status = 'pending'
      `,
      [seat.id, user.user.id]
    );
    await connection.query(
      `
        UPDATE session_seats
        SET status = 'confirmed',
            confirmed_user_id = ?
        WHERE id = ?
      `,
      [user.user.id, seat.id]
    );

    const claimedSeat = await findById(connection, "session_seats", seat.id);
    return {
      join_result: "joined",
      ...claimedSeat
    };
  });
}

export async function claimSessionNpcRole(user, npcRoleId, body = {}) {
  const id = positiveId(npcRoleId, "npcRoleId");

  return withTransaction(async (connection) => {
    const [rows] = await connection.query(
      `
        SELECT
          role.*,
          session.organizer_user_id,
          session.status AS session_status,
          session.join_policy,
          COALESCE(session.join_phone_required, 1) AS join_phone_required,
          COALESCE(session.npc_join_enabled, 1) AS npc_join_enabled
        FROM session_npc_roles role
        JOIN sessions session ON session.id = role.session_id
        WHERE role.id = ?
        FOR UPDATE
      `,
      [id]
    );
    const role = rows[0];
    if (!role) {
      throw notFound("Session NPC role not found");
    }
    if (role.status !== "active") {
      throw conflict("NPC role is not available");
    }
    if (role.session_status === "cancelled") {
      throw badRequest("Session is not available");
    }
    const currentUserId = Number(user.user.id);
    const isOwnerOrAdmin = isAdmin(user) || Number(role.organizer_user_id) === currentUserId;
    if (!Number(role.npc_join_enabled || 0) && !isOwnerOrAdmin) {
      throw forbidden("NPC self join is disabled");
    }
    if (role.bound_user_id && Number(role.bound_user_id) !== currentUserId) {
      throw conflict("NPC role already has a bound user");
    }
    requireJoinPhoneIfNeeded(user, role);

    const [currentSignupRows] = await connection.query(
      `
        SELECT *
        FROM signups
        WHERE session_npc_role_id = ?
          AND user_id = ?
        FOR UPDATE
      `,
      [id, currentUserId]
    );
    const currentSignup = currentSignupRows[0] || null;

    const [otherPendingRows] = await connection.query(
      `
        SELECT id
        FROM signups
        WHERE session_npc_role_id = ?
          AND user_id <> ?
          AND status = 'pending'
        LIMIT 1
        FOR UPDATE
      `,
      [id, currentUserId]
    );
    if (otherPendingRows.length > 0 && !role.bound_user_id) {
      throw conflict("NPC role already has a pending signup");
    }
    await releaseUserOtherConfirmedSeats(
      connection,
      role.session_id,
      currentUserId,
      0
    );
    await releaseUserOtherSessionNpcRoles(
      connection,
      role.session_id,
      currentUserId,
      id
    );
    await cancelUserOtherPendingSignups(
      connection,
      role.session_id,
      currentUserId,
      0,
      id
    );

    const contactText = optionalText(body.contactText);
    const note = optionalText(body.note);
    if (role.bound_user_id && Number(role.bound_user_id) === currentUserId) {
      await connection.query(
        `
          INSERT INTO signups
            (
              session_id, seat_id, session_npc_role_id, signup_type,
              user_id, contact_text, note, status, review_eligible_at
            )
          VALUES (?, NULL, ?, 'session_npc_role', ?, ?, ?, 'approved', CURRENT_TIMESTAMP)
          ON DUPLICATE KEY UPDATE
            signup_type = 'session_npc_role',
            status = 'approved',
            contact_text = VALUES(contact_text),
            note = VALUES(note),
            review_eligible_at = COALESCE(review_eligible_at, CURRENT_TIMESTAMP),
            user_hidden_at = NULL
        `,
        [role.session_id, id, currentUserId, contactText, note]
      );
      return {
        join_result: "npc_joined",
        npc_role: await sessionNpcRoleById(connection, id)
      };
    }

    if ((role.join_policy || "review_required") === "direct") {
      await connection.query(
        `
          UPDATE session_npc_roles
          SET bound_user_id = ?
          WHERE id = ?
        `,
        [currentUserId, id]
      );
      await connection.query(
        `
          INSERT INTO signups
            (
              session_id, seat_id, session_npc_role_id, signup_type,
              user_id, contact_text, note, status, review_eligible_at
            )
          VALUES (?, NULL, ?, 'session_npc_role', ?, ?, ?, 'approved', CURRENT_TIMESTAMP)
          ON DUPLICATE KEY UPDATE
            signup_type = 'session_npc_role',
            status = 'approved',
            contact_text = VALUES(contact_text),
            note = VALUES(note),
            review_eligible_at = COALESCE(review_eligible_at, CURRENT_TIMESTAMP),
            user_hidden_at = NULL
        `,
        [role.session_id, id, currentUserId, contactText, note]
      );
      await connection.query(
        `
          UPDATE signups
          SET status = 'rejected'
          WHERE session_npc_role_id = ?
            AND user_id <> ?
            AND status = 'pending'
        `,
        [id, currentUserId]
      );
      return {
        join_result: "npc_joined",
        npc_role: await sessionNpcRoleById(connection, id)
      };
    }

    if (currentSignup && currentSignup.status === "pending") {
      return {
        join_result: "pending_review",
        signup: currentSignup
      };
    }

    if (
      currentSignup &&
      !["rejected", "cancelled"].includes(currentSignup.status)
    ) {
      throw conflict("Signup already exists");
    }

    let signup;
    if (currentSignup) {
      await connection.query(
        `
          UPDATE signups
          SET signup_type = 'session_npc_role',
              status = 'pending',
              deposit_status = 'unpaid',
              contact_text = ?,
              note = ?,
              review_eligible_at = NULL,
              user_hidden_at = NULL
          WHERE id = ?
        `,
        [contactText, note, currentSignup.id]
      );
      signup = await findById(connection, "signups", currentSignup.id);
    } else {
      const [result] = await connection.query(
        `
          INSERT INTO signups
            (
              session_id, seat_id, session_npc_role_id, signup_type,
              user_id, contact_text, note, status
            )
          VALUES (?, NULL, ?, 'session_npc_role', ?, ?, ?, 'pending')
        `,
        [role.session_id, id, currentUserId, contactText, note]
      );
      signup = await findById(connection, "signups", result.insertId);
    }

    return {
      join_result: "pending_review",
      signup
    };
  });
}

export async function listMySignups(user) {
  return withDatabaseConnection(async (connection) => {
    const [rows] = await connection.query(
      `
        SELECT
          signup.*,
          session.script_name_snapshot,
          session.store_name_snapshot,
          session.start_at,
          session.status AS session_status,
          session.cancelled_at,
          seat.name AS seat_name,
          seat.role_name AS seat_role_name,
          seat.status AS seat_status,
          npc_role.id AS session_npc_role_id,
          npc_role.name AS npc_role_name,
          npc_role.role_gender AS npc_role_gender,
          npc_role.status AS npc_role_status,
          EXISTS (
            SELECT 1
            FROM session_reviews review
            WHERE review.session_id = signup.session_id
              AND review.user_id = signup.user_id
              AND review.status = 'active'
          ) AS has_review,
          (
            signup.review_eligible_at IS NOT NULL
            AND ${reviewWindowSql()}
          ) AS can_review
        FROM signups signup
        JOIN sessions session ON session.id = signup.session_id
        LEFT JOIN session_seats seat ON seat.id = signup.seat_id
        LEFT JOIN session_npc_roles npc_role ON npc_role.id = signup.session_npc_role_id
        WHERE signup.user_id = ?
          AND signup.user_hidden_at IS NULL
          AND signup.status IN ('pending', 'approved')
        ORDER BY session.start_at DESC, signup.id DESC
      `,
      [user.user.id]
    );
    return rows.map((row) => ({
      ...row,
      can_review: Boolean(row.can_review),
      has_review: Boolean(row.has_review)
    }));
  });
}

export async function hideMySignup(user, signupId) {
  const id = positiveId(signupId, "signupId");
  return withDatabaseConnection(async (connection) => {
    const signup = await findById(connection, "signups", id);
    if (!signup) {
      throw notFound("Signup not found");
    }
    if (Number(signup.user_id) !== Number(user.user.id)) {
      throw forbidden("Only the signup user can hide this session membership");
    }

    await connection.query(
      "UPDATE signups SET user_hidden_at = CURRENT_TIMESTAMP WHERE id = ?",
      [id]
    );

    return {
      id,
      session_id: Number(signup.session_id),
      hidden: true
    };
  });
}

export async function listSessionSignups(user, sessionId) {
  return withDatabaseConnection(async (connection) => {
    await requireSessionOwner(connection, sessionId, user);
    const [rows] = await connection.query(
      `
        SELECT
          signup.*,
          COALESCE(signup.signup_type, 'seat') AS signup_type,
          seat.name AS seat_name,
          seat.role_name AS seat_role_name,
          seat.status AS seat_status,
          npc_role.name AS npc_role_name,
          npc_role.role_gender AS npc_role_gender,
          npc_role.status AS npc_role_status,
          npc_role.bound_user_id AS npc_role_bound_user_id,
          applicant.nickname AS applicant_nickname,
          applicant.open_id AS applicant_open_id
        FROM signups signup
        LEFT JOIN session_seats seat ON seat.id = signup.seat_id
        LEFT JOIN session_npc_roles npc_role ON npc_role.id = signup.session_npc_role_id
        LEFT JOIN users applicant ON applicant.id = signup.user_id
        WHERE signup.session_id = ?
        ORDER BY signup.id DESC
      `,
      [sessionId]
    );
    return rows;
  });
}

export async function approveSignup(user, signupId) {
  const { signup, notification } = await withTransaction(async (connection) => {
    const signup = await requireSignupOwner(connection, signupId, user);
    if (signup.status !== "pending") {
      throw badRequest("Only pending signup can be approved");
    }

    if ((signup.signup_type || "seat") === "session_npc_role") {
      const [roleRows] = await connection.query(
        `
          SELECT *
          FROM session_npc_roles
          WHERE id = ?
          FOR UPDATE
        `,
        [signup.session_npc_role_id]
      );
      const role = roleRows[0];
      if (!role) {
        throw notFound("Session NPC role not found");
      }
      if (role.status !== "active") {
        throw conflict("NPC role is not available");
      }
      if (
        role.bound_user_id &&
        Number(role.bound_user_id) !== Number(signup.user_id)
      ) {
        throw conflict("NPC role already has a bound user");
      }
      await lockSessionSeats(connection, signup.session_id);
      await releaseUserOtherConfirmedSeats(
        connection,
        signup.session_id,
        signup.user_id,
        0
      );
      await releaseUserOtherSessionNpcRoles(
        connection,
        signup.session_id,
        signup.user_id,
        signup.session_npc_role_id
      );
      await cancelUserOtherPendingSignups(
        connection,
        signup.session_id,
        signup.user_id,
        0,
        signup.session_npc_role_id
      );
      await connection.query(
        `
          UPDATE session_npc_roles
          SET bound_user_id = ?
          WHERE id = ?
        `,
        [signup.user_id, signup.session_npc_role_id]
      );
      await connection.query(
        `
          UPDATE signups
          SET status = 'rejected'
          WHERE session_npc_role_id = ?
            AND id <> ?
            AND status = 'pending'
        `,
        [signup.session_npc_role_id, signupId]
      );
      await connection.query("UPDATE signups SET status = 'approved' WHERE id = ?", [
        signupId
      ]);
      await markSignupReviewEligible(connection, signupId);
      const approvedSignup = await findById(connection, "signups", signupId);
      return {
        signup: approvedSignup,
        notification: {
          ...(await signupNotificationPayload(connection, signupId)),
          resultText: "已通过"
        }
      };
    }

    await lockSessionSeats(connection, signup.session_id);

    const [seatRows] = await connection.query(
      "SELECT * FROM session_seats WHERE id = ?",
      [signup.seat_id]
    );
    const seat = seatRows[0];
    if (!seat) {
      throw notFound("Seat not found");
    }
    if (seat.confirmed_user_id && Number(seat.confirmed_user_id) !== Number(signup.user_id)) {
      throw conflict("Seat already has a confirmed user");
    }
    await releaseUserOtherConfirmedSeats(
      connection,
      signup.session_id,
      signup.user_id,
      signup.seat_id
    );
    await releaseUserOtherSessionNpcRoles(
      connection,
      signup.session_id,
      signup.user_id,
      0
    );
    await cancelUserOtherPendingSignups(
      connection,
      signup.session_id,
      signup.user_id,
      signup.seat_id,
      0
    );

    await connection.query(
      `
        UPDATE signups
        SET status = 'rejected'
        WHERE seat_id = ? AND id <> ? AND status = 'pending'
      `,
      [signup.seat_id, signupId]
    );
    await connection.query("UPDATE signups SET status = 'approved' WHERE id = ?", [
      signupId
    ]);
    await markSignupReviewEligible(connection, signupId);
    await connection.query(
      `
        UPDATE session_seats
        SET status = 'confirmed', confirmed_user_id = ?
        WHERE id = ?
      `,
      [signup.user_id, signup.seat_id]
    );

    const approvedSignup = await findById(connection, "signups", signupId);
    return {
      signup: approvedSignup,
      notification: {
        ...(await signupNotificationPayload(connection, signupId)),
        resultText: "已通过"
      }
    };
  });
  await tryNotify("notifySignupReviewed", () => notifySignupReviewed(notification));
  return signup;
}

export async function rejectSignup(user, signupId) {
  const { signup, notification } = await withTransaction(async (connection) => {
    const signup = await requireSignupOwner(connection, signupId, user);
    await connection.query("UPDATE signups SET status = 'rejected' WHERE id = ?", [
      signupId
    ]);

    if ((signup.signup_type || "seat") === "session_npc_role") {
      const rejectedSignup = await findById(connection, "signups", signupId);
      return {
        signup: rejectedSignup,
        notification: {
          ...(await signupNotificationPayload(connection, signupId)),
          resultText: "已拒绝"
        }
      };
    }

    const [activeRows] = await connection.query(
      `
        SELECT COUNT(*) AS active_count
        FROM signups
        WHERE seat_id = ? AND status IN ('pending', 'approved')
      `,
      [signup.seat_id]
    );
    if (Number(activeRows[0]?.active_count || 0) === 0) {
      await connection.query(
        `
          UPDATE session_seats
          SET status = 'open'
          WHERE id = ? AND status = 'applied'
        `,
        [signup.seat_id]
      );
    }

    const rejectedSignup = await findById(connection, "signups", signupId);
    return {
      signup: rejectedSignup,
      notification: {
        ...(await signupNotificationPayload(connection, signupId)),
        resultText: "已拒绝"
      }
    };
  });
  await tryNotify("notifySignupReviewed", () => notifySignupReviewed(notification));
  return signup;
}

export async function updateDeposit(user, signupId, body) {
  const status = requireValue(body, "depositStatus");
  if (!["unpaid", "pending_confirm", "confirmed", "refunded"].includes(status)) {
    throw badRequest("Invalid depositStatus");
  }

  return withDatabaseConnection(async (connection) => {
    await requireSignupOwner(connection, signupId, user);
    await connection.query("UPDATE signups SET deposit_status = ? WHERE id = ?", [
      status,
      signupId
    ]);
    return findById(connection, "signups", signupId);
  });
}

export async function lockSeat(user, seatId) {
  return withTransaction(async (connection) => {
    const seat = await requireSeatOwner(connection, seatId, user);
    if (seat.status !== "confirmed") {
      throw badRequest("Only confirmed seat can be locked");
    }

    await connection.query("UPDATE session_seats SET status = 'locked' WHERE id = ?", [
      seatId
    ]);
    return findById(connection, "session_seats", seatId);
  });
}

export async function kickSessionSeat(user, seatId, body = {}) {
  return withTransaction(async (connection) => {
    const [rows] = await connection.query(
      `
        SELECT seat.*, session.organizer_user_id, session.status AS session_status
        FROM session_seats seat
        JOIN sessions session ON session.id = seat.session_id
        WHERE seat.id = ?
        FOR UPDATE
      `,
      [seatId]
    );
    const seat = rows[0];
    if (!seat) {
      throw notFound("Seat not found");
    }
    if (!isAdmin(user) && Number(seat.organizer_user_id) !== Number(user.user.id)) {
      throw forbidden("Only the session organizer can perform this action");
    }

    const report = booleanValue(body.report, false);
    const reasonType = normalizeRemovalReasonType(
      body.reasonType ?? body.reason_type,
      report
    );
    const reason = optionalText(body.reason);
    assertMessageTextSafe("reason", reason);
    const removedUserId = seat.confirmed_user_id ? Number(seat.confirmed_user_id) : null;
    if (
      report &&
      (!removedUserId || !["confirmed", "locked"].includes(seat.status))
    ) {
      throw conflict("Reported removal requires an onboard member");
    }

    await connection.query(
      `
        UPDATE signups
        SET status = 'cancelled'
        WHERE seat_id = ? AND status IN ('pending', 'approved')
      `,
      [seatId]
    );
    if (removedUserId) {
      await connection.query(
        `
          UPDATE signups
          SET status = 'cancelled'
          WHERE session_id = ?
            AND user_id = ?
            AND COALESCE(signup_type, 'seat') = 'seat'
            AND status IN ('pending', 'approved')
        `,
        [seat.session_id, removedUserId]
      );
    }
    await clearPreStartReviewEligibilityForSeat(connection, seatId);
    const nextSeatStatus = seat.session_status === "cancelled" ? "cancelled" : "open";
    await connection.query(
      `
        UPDATE session_seats
        SET status = ?,
            confirmed_user_id = NULL
        WHERE id = ?
      `,
      [nextSeatStatus, seatId]
    );

    const blockRejoin = BLOCKING_REMOVAL_REASONS.has(reasonType);
    let removalReport = null;
    if (report) {
      const [result] = await connection.query(
        `
          INSERT INTO session_member_removal_reports
            (
              session_id, seat_id, removed_user_id, removed_by_user_id,
              reason_type, reason_text, block_rejoin
            )
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
        [
          seat.session_id,
          seat.id,
          removedUserId,
          user.user.id,
          reasonType,
          reason,
          blockRejoin ? 1 : 0
        ]
      );
      removalReport = await findById(
        connection,
        "session_member_removal_reports",
        result.insertId
      );
    }

    const content = report
      ? `车头已将「${seat.name}」移出本车，原因：${removalReasonLabel(reasonType)}`
      : reason
        ? `车头已释放「${seat.name}」：${reason}`
        : `车头已释放「${seat.name}」`;
    await runSessionExtensionHook("afterSessionSeatKicked", {
      connection,
      sessionId: seat.session_id,
      senderUserId: user.user.id,
      content
    });

    return {
      ...(await findById(connection, "session_seats", seatId)),
      removal_reported: Boolean(removalReport),
      removal_report: removalReport
    };
  });
}

export async function cancelSession(user, sessionId, body = {}) {
  return withTransaction(async (connection) => {
    const id = positiveId(sessionId, "sessionId");
    const [rows] = await connection.query("SELECT * FROM sessions WHERE id = ? FOR UPDATE", [
      id
    ]);
    const session = rows[0];
    if (!session) {
      throw notFound("Session not found");
    }
    if (Number(session.organizer_user_id) !== Number(user.user.id)) {
      throw forbidden("Only the session organizer can cancel this session");
    }
    const inheritingCandidates = await sessionOrganizerCandidates(
      connection,
      session,
      user.user.id
    );
    const hasOtherOnboardMembers = inheritingCandidates.some(
      (candidate) => candidate.source === "seat"
    );
    if (hasOtherOnboardMembers) {
      throw new AppError(
        409,
        "SESSION_HAS_ONBOARD_MEMBERS",
        "已有玩家上车，不能取消删除。请退出车头，系统会转给下一位已上车成员。"
      );
    }
    if ((await activeSessionAlbumPhotoCount(connection, id)) > 0) {
      throw new AppError(
        409,
        "SESSION_HAS_ALBUM_PHOTOS",
        "相册已有照片，不能取消删除。请先删除所有照片。"
      );
    }
    const reason = optionalText(body.reason);
    assertMessageTextSafe("reason", reason);
    return {
      id,
      deleted: await deleteSessionTree(connection, id)
    };
  });
}

export async function deleteAdminSession(sessionId) {
  return withTransaction(async (connection) => {
    const id = positiveId(sessionId, "sessionId");
    const [rows] = await connection.query("SELECT id FROM sessions WHERE id = ? FOR UPDATE", [
      id
    ]);
    if (!rows[0]) {
      throw notFound("Session not found");
    }
    return {
      id,
      deleted: await deleteSessionTree(connection, id)
    };
  });
}

async function deleteAndCount(connection, key, sql, values) {
  const [result] = await connection.query(sql, values);
  return [key, Number(result.affectedRows || 0)];
}

async function activeSessionAlbumPhotoCount(connection, sessionId) {
  return countRows(
    connection,
    "SELECT COUNT(*) AS count FROM session_album_photos WHERE session_id = ? AND status = 'active'",
    [sessionId]
  );
}

async function deleteSessionTree(connection, id) {
  const deletedCounts = {};
  const cleanupSteps = [
    [
      "chatPinnedReferences",
      `
          UPDATE session_chat_rooms
          SET pinned_message_id = NULL
          WHERE session_id = ?
        `
    ],
    [
      "sessionMessages",
      `
          DELETE FROM session_messages
          WHERE room_id IN (
            SELECT id FROM session_chat_rooms WHERE session_id = ?
          )
        `
    ],
    ["sessionChatRooms", "DELETE FROM session_chat_rooms WHERE session_id = ?"],
    [
      "sessionReviewPhotos",
      `
          DELETE FROM session_review_photos
          WHERE review_id IN (
            SELECT id FROM session_reviews WHERE session_id = ?
          )
        `
    ],
    [
      "albumPhotoTagsForPhotos",
      `
          DELETE FROM session_album_photo_tags
          WHERE photo_id IN (
            SELECT id FROM session_album_photos WHERE session_id = ?
          )
        `
    ],
    [
      "albumPhotoTagsForSessionPeople",
      `
          DELETE FROM session_album_photo_tags
          WHERE seat_id IN (
            SELECT id FROM session_seats WHERE session_id = ?
          )
          OR session_npc_role_id IN (
            SELECT id FROM session_npc_roles WHERE session_id = ?
          )
        `,
      [id, id]
    ],
    ["sessionAlbumPhotos", "DELETE FROM session_album_photos WHERE session_id = ?"],
    ["sessionAlbumPrivacy", "DELETE FROM session_album_privacy WHERE session_id = ?"],
    ["sessionReviews", "DELETE FROM session_reviews WHERE session_id = ?"],
    ["signups", "DELETE FROM signups WHERE session_id = ?"],
    ["sessionNpcRoles", "DELETE FROM session_npc_roles WHERE session_id = ?"],
    ["shareEvents", "DELETE FROM share_events WHERE session_id = ?"],
    ["sessionSeats", "DELETE FROM session_seats WHERE session_id = ?"],
    ["sessions", "DELETE FROM sessions WHERE id = ?"]
  ];

  for (const [key, sql, values] of cleanupSteps) {
    const [countKey, count] = await deleteAndCount(connection, key, sql, values || [id]);
    deletedCounts[countKey] = count;
  }

  return { ...deletedCounts };
}

export async function assertSessionAlbumUploadAllowed(user, sessionId) {
  const id = positiveId(sessionId, "sessionId");
  return withDatabaseConnection(async (connection) => {
    return assertSessionAlbumImageUploadAllowed(connection, user, {
      sessionId: id,
      kind: "sessionAlbumPhoto"
    });
  });
}

export async function assertAdminOwnSessionAlbumAllowed(user, sessionId) {
  const id = positiveId(sessionId, "sessionId");
  if (!isAdmin(user)) {
    throw forbidden("system_admin role required");
  }
  return withDatabaseConnection(async (connection) => {
    return assertSessionAlbumImageUploadAllowed(connection, user, {
      sessionId: id,
      kind: "adminSessionAlbumPhoto"
    });
  });
}

export async function assertSessionAlbumImageUploadAllowed(
  connection,
  user,
  { sessionId, kind, forUpdate = false }
) {
  const session = await requireSessionAlbumOpen(connection, sessionId, { forUpdate });
  if (kind === "adminSessionAlbumPhoto") {
    if (!isAdmin(user) || Number(session.organizer_user_id) !== Number(user.user.id)) {
      throw forbidden("Only the session organizer can use admin album upload");
    }
    return session;
  }
  await requireSessionAlbumMember(connection, session, user, { forUpdate });
  return session;
}

export async function insertFinalizedSessionAlbumImage(connection, { intent, metadata }) {
  const [result] = await connection.query(
    `INSERT INTO session_album_photos
      (session_id, uploader_user_id, media_type, photo_url, object_key, object_etag,
       image_width, image_height, image_byte_size, image_content_type,
       processing_status, status)
     VALUES (?, ?, 'image', ?, ?, ?, ?, ?, ?, 'image/jpeg', 'ready', 'active')`,
    [
      Number(intent.session_id),
      Number(intent.user_id),
      `/${intent.object_key}`,
      intent.object_key,
      metadata.etag,
      metadata.width,
      metadata.height,
      metadata.byteSize
    ]
  );
  return findById(connection, "session_album_photos", result.insertId);
}

export async function getFinalizedSessionAlbumImage(connection, { mediaId, user }) {
  const photo = await findById(connection, "session_album_photos", mediaId);
  if (!photo || albumMediaType(photo) !== "image" || photo.status !== "active") {
    throw notFound("Album photo not found");
  }
  const session = await requireSessionAlbumOpen(connection, photo.session_id);
  await requireSessionAlbumMember(connection, session, user);
  return albumMediaResponse(photo, [], { userId: user.user.id });
}

export function serializeSessionAlbumImage(media, userId) {
  return albumMediaResponse(media, [], { userId });
}

export async function getMySessionAlbumPrivacy(user, sessionId) {
  const id = positiveId(sessionId, "sessionId");
  return withDatabaseConnection(async (connection) => {
    const session = await requireSessionAlbumOpen(connection, id);
    await requireSessionAlbumMember(connection, session, user);
    return {
      session_id: id,
      user_id: user.user.id,
      ...(await getAlbumPrivacy(connection, id, user.user.id))
    };
  });
}

export async function updateMySessionAlbumPrivacy(user, sessionId, body = {}) {
  const id = positiveId(sessionId, "sessionId");
  const allowUploadedVisible = booleanValue(
    body.allowUploadedVisible ?? body.allow_uploaded_visible,
    true
  );
  const allowTaggedVisible = booleanValue(
    body.allowTaggedVisible ?? body.allow_tagged_visible,
    true
  );
  return withTransaction(async (connection) => {
    const session = await requireSessionAlbumOpen(connection, id);
    await requireSessionAlbumMember(connection, session, user);
    await connection.query(
      `
        INSERT INTO session_album_privacy
          (session_id, user_id, allow_uploaded_visible, allow_tagged_visible)
        VALUES (?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          allow_uploaded_visible = VALUES(allow_uploaded_visible),
          allow_tagged_visible = VALUES(allow_tagged_visible)
      `,
      [
        id,
        user.user.id,
        allowUploadedVisible ? 1 : 0,
        allowTaggedVisible ? 1 : 0
      ]
    );
    return {
      session_id: id,
      user_id: user.user.id,
      allow_uploaded_visible: allowUploadedVisible,
      allow_tagged_visible: allowTaggedVisible
    };
  });
}

export async function listSessionAlbumPeople(user, sessionId) {
  const id = positiveId(sessionId, "sessionId");
  return withDatabaseConnection(async (connection) => {
    const session = await requireSessionAlbumOpen(connection, id);
    await requireSessionAlbumMember(connection, session, user);
    return {
      session_id: id,
      people: await sessionAlbumPeople(connection, session)
    };
  });
}

export async function getSessionAlbumShareSubject(user, sessionId) {
  const id = positiveId(sessionId, "sessionId");
  return withDatabaseConnection(async (connection) => {
    const session = await requireSessionAlbumOpen(connection, id);
    await requireSessionAlbumMember(connection, session, user);
    const [rows] = await connection.query(
      `
        SELECT id, name, role_name, confirmed_user_id, status
        FROM session_seats
        WHERE session_id = ?
          AND confirmed_user_id = ?
          AND status IN ('confirmed', 'locked')
        ORDER BY id
        LIMIT 1
      `,
      [id, user.user.id]
    );
    const seat = rows[0];
    if (!seat) {
      throw forbidden("Confirmed seat is required for album sharing");
    }
    return {
      session_id: id,
      share_subject: albumShareSubjectForSeat(seat)
    };
  });
}

export async function listSessionAlbum(user, sessionId) {
  const id = positiveId(sessionId, "sessionId");
  return withDatabaseConnection(async (connection) => {
    const session = await requireSessionAlbumOpen(connection, id);
    await requireSessionAlbumMember(connection, session, user);
    const privacy = await getAlbumPrivacy(connection, id, user.user.id);
    const personalScope = await sessionAlbumPersonalScope(connection, session, user.user.id);
    const [photoRows] = await connection.query(
      `
        SELECT
          photo.*,
          user.nickname AS uploader_nickname,
          user.open_id AS uploader_open_id
        FROM session_album_photos photo
        JOIN users user ON user.id = photo.uploader_user_id
        WHERE photo.session_id = ?
          AND photo.status = 'active'
        ORDER BY photo.created_at DESC, photo.id DESC
      `,
      [id]
    );
    const photoIds = photoRows.map((photo) => Number(photo.id));
    const tagsMap = await albumTagsForPhotos(connection, photoIds);
    const privacyUserIds = [];
    for (const photo of photoRows) {
      privacyUserIds.push(photo.uploader_user_id);
      for (const tag of tagsMap.get(Number(photo.id)) || []) {
        if (tag.user_id) {
          privacyUserIds.push(tag.user_id);
        }
      }
    }
    const privacyByUser = await albumPrivacyMap(connection, id, privacyUserIds);
    const photos = [];
    let hiddenCount = 0;
    let untaggedCount = 0;
    for (const photo of photoRows) {
      const tags = tagsMap.get(Number(photo.id)) || [];
      const mediaType = albumMediaType(photo);
      const processingStatus = albumMediaProcessingStatus(photo);
      if (
        mediaType === "video" &&
        processingStatus !== "ready" &&
        !canViewAlbumVideoProcessingState(user, session, photo)
      ) {
        continue;
      }
      if (tags.length === 0) {
        untaggedCount += 1;
      }
      const isVisibleByAlbumPrivacy = isAlbumPhotoVisibleToUser(
        photo,
        tags,
        privacyByUser,
        user.user.id,
        personalScope
      );
      if (
        mediaType === "video" &&
        processingStatus !== "ready" &&
        canViewAlbumVideoProcessingState(user, session, photo)
      ) {
        photos.push(albumMediaResponse(photo, tags, { userId: user.user.id }));
        continue;
      }
      if (!isVisibleByAlbumPrivacy) {
        hiddenCount += 1;
        continue;
      }
      photos.push(albumMediaResponse(photo, tags, { userId: user.user.id }));
    }
    return {
      session_id: id,
      script_name_snapshot: session.script_name_snapshot,
      store_name_snapshot: session.store_name_snapshot,
      start_at: session.start_at,
      can_upload: true,
      privacy,
      visible_count: photos.length,
      hidden_count: hiddenCount,
      untagged_count: untaggedCount,
      photos,
      media: photos
    };
  });
}

export async function listPublicSessionAlbumShare(claims) {
  const normalizedClaims = normalizeAlbumShareClaims(claims);
  return withDatabaseConnection(async (connection) => {
    const session = await requireSessionAlbumOpen(connection, normalizedClaims.sessionId);
    const { seat } = await requirePublicAlbumShareSeat(connection, normalizedClaims);
    const [photoRows] = await connection.query(
      `
        SELECT photo.*
        FROM session_album_photos photo
        WHERE photo.session_id = ?
          AND photo.status = 'active'
        ORDER BY photo.created_at DESC, photo.id DESC
      `,
      [normalizedClaims.sessionId]
    );
    const photoIds = photoRows.map((photo) => Number(photo.id));
    const tagsMap = await albumTagsForPhotos(connection, photoIds);
    const privacyUserIds = [];
    for (const photo of photoRows) {
      privacyUserIds.push(photo.uploader_user_id);
      for (const tag of tagsMap.get(Number(photo.id)) || []) {
        if (tag.user_id) {
          privacyUserIds.push(tag.user_id);
        }
      }
    }
    const privacyByUser = await albumPrivacyMap(
      connection,
      normalizedClaims.sessionId,
      privacyUserIds
    );
    const photos = [];
    for (const photo of photoRows) {
      const tags = tagsMap.get(Number(photo.id)) || [];
      if (albumMediaType(photo) === "video" && albumMediaProcessingStatus(photo) !== "ready") {
        continue;
      }
      if (
        !isAlbumPhotoVisibleInPublicShare(
          photo,
          tags,
          privacyByUser,
          normalizedClaims
        )
      ) {
        continue;
      }
      photos.push(albumMediaResponse(photo, tags, { publicShare: true }));
    }
    return {
      session_id: normalizedClaims.sessionId,
      script_name_snapshot: session.script_name_snapshot,
      store_name_snapshot: session.store_name_snapshot,
      start_at: session.start_at,
      share_subject: albumShareSubjectForSeat(seat),
      visible_count: photos.length,
      photos,
      media: photos
    };
  });
}

export async function createSessionAlbumPhoto(user, sessionId, body = {}) {
  const id = positiveId(sessionId, "sessionId");
  const photoUrl = sessionAlbumPhotoUrl(id, user.user.id, body.photoUrl || body.photo_url);
  const imageWidth = requiredPositiveInteger(body.imageWidth ?? body.image_width, "imageWidth");
  const imageHeight = requiredPositiveInteger(body.imageHeight ?? body.image_height, "imageHeight");
  const imageByteSize = requiredPositiveInteger(
    body.imageByteSize ?? body.image_byte_size,
    "imageByteSize"
  );
  const imageContentType = String(body.imageContentType || body.image_content_type || "image/jpeg")
    .trim()
    .toLowerCase();
  if (imageContentType !== "image/jpeg") {
    throw badRequest("imageContentType must be image/jpeg");
  }
  return withTransaction(async (connection) => {
    const session = await requireSessionAlbumOpen(connection, id);
    await requireSessionAlbumMember(connection, session, user);
    const [result] = await connection.query(
      `
        INSERT INTO session_album_photos
          (
            session_id,
            uploader_user_id,
            media_type,
            photo_url,
            image_width,
            image_height,
            image_byte_size,
            image_content_type,
            processing_status,
            status
          )
        VALUES (?, ?, 'image', ?, ?, ?, ?, ?, 'ready', 'active')
      `,
      [
        id,
        user.user.id,
        photoUrl,
        imageWidth,
        imageHeight,
        imageByteSize,
        imageContentType
      ]
    );
    const photo = await findById(connection, "session_album_photos", result.insertId);
    return {
      id: Number(photo.id),
      session_id: Number(photo.session_id),
      media_type: "image",
      processing_status: "ready",
      uploader_user_id: Number(photo.uploader_user_id),
      is_mine: true,
      can_delete: true,
      can_tag: true,
      image_width: photo.image_width ? Number(photo.image_width) : null,
      image_height: photo.image_height ? Number(photo.image_height) : null,
      image_byte_size: photo.image_byte_size ? Number(photo.image_byte_size) : null,
      image_content_type: photo.image_content_type || "image/jpeg",
      created_at: photo.created_at,
      tags: []
    };
  });
}

async function requireSessionAlbumVideoCreateAllowed(connection, sessionId, user, options = {}) {
  const session = await requireSessionAlbumOpen(connection, sessionId, options);
  await requireSessionAlbumMember(connection, session, user, options);
  return session;
}

async function findActiveSessionAlbumVideoBySource(
  connection,
  sessionId,
  sourceUrl,
  options = {}
) {
  const [rows] = await connection.query(
    `
      SELECT photo.*
      FROM session_album_photos photo
      WHERE photo.session_id = ?
        AND photo.source_url = ?
        AND photo.media_type = 'video'
        AND photo.status = 'active'
      LIMIT 1
      ${options.forUpdate === true ? "FOR UPDATE" : ""}
    `,
    [sessionId, sourceUrl]
  );
  return rows[0] || null;
}

function inspectedAlbumVideoMetadata(value) {
  const byteSize = requiredPositiveInteger(value?.byteSize, "inspected video byteSize");
  if (value?.contentType === undefined || value?.contentType === null || value.contentType === "") {
    throw badRequest("inspected video contentType is required");
  }
  return {
    byteSize,
    contentType: albumVideoContentType(value.contentType)
  };
}

function sessionAlbumVideoCreateResponse(media, fallbackProcessingStatus, userId) {
  const isMine = Number(media.uploader_user_id) === Number(userId);
  return {
    id: Number(media.id),
    session_id: Number(media.session_id),
    media_type: "video",
    processing_status: media.processing_status || fallbackProcessingStatus,
    uploader_user_id: Number(media.uploader_user_id),
    is_mine: isMine,
    can_delete: isMine,
    can_tag: isMine,
    duration_seconds: media.duration_seconds ? Number(media.duration_seconds) : null,
    video_width: media.video_width ? Number(media.video_width) : null,
    video_height: media.video_height ? Number(media.video_height) : null,
    video_byte_size: media.video_byte_size ? Number(media.video_byte_size) : null,
    video_content_type: media.video_content_type || "video/mp4",
    processing_error: media.processing_error || null,
    created_at: media.created_at,
    tags: []
  };
}

export async function createSessionAlbumVideo(user, sessionId, body = {}, options = {}) {
  const id = positiveId(sessionId, "sessionId");
  if (!isAdmin(user)) {
    throw forbidden("system_admin role required");
  }
  const sourceUrl = sessionAlbumVideoSourceUrl(
    id,
    user.user.id,
    body.sourceUrl || body.source_url
  );
  const durationSeconds = albumVideoDurationSeconds(
    body.durationSeconds ?? body.duration_seconds
  );
  const videoWidth = optionalAlbumVideoDimension(
    body.videoWidth ?? body.video_width,
    "videoWidth"
  );
  const videoHeight = optionalAlbumVideoDimension(
    body.videoHeight ?? body.video_height,
    "videoHeight"
  );
  const inspectObject = options.inspectObject;
  if (typeof inspectObject !== "function") {
    throw new TypeError("createSessionAlbumVideo requires options.inspectObject");
  }
  const runWithDatabaseConnection = options.withDatabaseConnection || withDatabaseConnection;
  const runWithTransaction = options.withTransaction || withTransaction;
  const authorize =
    options.authorizeSessionAlbumVideoCreate || requireSessionAlbumVideoCreateAllowed;

  // Authorize before any storage I/O, while deliberately releasing the read
  // connection before HEAD/Range inspection. The insert transaction repeats
  // this check below so a membership/session-state change cannot win a race.
  await runWithDatabaseConnection((connection) =>
    authorize(connection, id, user, { forUpdate: false })
  );
  const { byteSize: videoByteSize, contentType: videoContentType } =
    inspectedAlbumVideoMetadata(await inspectObject(sourceUrl));

  const readyOnCreate = options.readyOnCreate === true || options.localFallbackReady === true;
  const processingStatus = readyOnCreate ? "ready" : "processing";
  const displayUrl = options.displayUrl || (readyOnCreate ? sourceUrl : null);
  const coverUrl = options.coverUrl || null;
  const ciJobId = options.ciJobId || null;

  const media = await createIdempotentAlbumVideo({
    sourceUrl,
    findExisting: (candidateSourceUrl) =>
      runWithTransaction(async (connection) => {
        await authorize(connection, id, user, { forUpdate: true });
        return findActiveSessionAlbumVideoBySource(connection, id, candidateSourceUrl, {
          forUpdate: true
        });
      }),
    insert: (candidateSourceUrl) => runWithTransaction(async (connection) => {
      await authorize(connection, id, user, { forUpdate: true });
      const [result] = await connection.query(
        `
          INSERT INTO session_album_photos
            (
              session_id,
              uploader_user_id,
              media_type,
              photo_url,
              source_url,
              display_url,
              cover_url,
              duration_seconds,
              video_width,
              video_height,
              video_byte_size,
              video_content_type,
              ci_job_id,
              processing_status,
              status
            )
          VALUES (?, ?, 'video', NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')
        `,
        [
          id,
          user.user.id,
          candidateSourceUrl,
          displayUrl,
          coverUrl,
          durationSeconds,
          videoWidth,
          videoHeight,
          videoByteSize,
          videoContentType,
          ciJobId,
          processingStatus
        ]
      );
      return findById(connection, "session_album_photos", result.insertId);
    }),
    // This is intentionally a different callback from findExisting. The
    // lifecycle helper invokes it only after the insert transaction wrapper
    // has rejected, so its rollback is complete before this fresh transaction
    // performs locked current-read authorization and reads the winner.
    findAfterDuplicateOnFreshConnection: (candidateSourceUrl) =>
      runWithTransaction(async (connection) => {
        await authorize(connection, id, user, { forUpdate: true });
        return findActiveSessionAlbumVideoBySource(connection, id, candidateSourceUrl, {
          forUpdate: true
        });
      })
  });

  return sessionAlbumVideoCreateResponse(media, processingStatus, user.user.id);
}

export async function updateSessionAlbumVideoProcessingResult(body = {}) {
  const mediaId = optionalPositiveInteger(body.mediaId ?? body.media_id, "mediaId");
  const ciJobId = normalizeCiJobId(body.ciJobId || body.ci_job_id || body.jobId || body.job_id);
  const status = albumVideoProcessingCallbackStatus(
    body.processingStatus || body.processing_status || body.status || body.state || body.code
  );
  const sourceUrl = albumVideoUploadPath(
    body.sourceUrl || body.source_url || body.inputObject || body.input_object,
    new Set(["source"]),
    "sourceUrl"
  );
  let displayUrl = albumVideoUploadPath(
    body.displayUrl || body.display_url || body.displayObject || body.display_object,
    new Set(["display"]),
    "displayUrl"
  );
  let coverUrl = albumVideoUploadPath(
    body.coverUrl || body.cover_url || body.coverObject || body.cover_object,
    new Set(["cover"]),
    "coverUrl"
  );

  if (status === "ready" && sourceUrl) {
    const kind = String(body.kind || body.operation || body.tag || "").trim().toLowerCase();
    if (!displayUrl && (kind.includes("transcode") || kind.includes("转码"))) {
      displayUrl = deriveAlbumVideoDisplayUrl(sourceUrl);
    }
    if (
      !coverUrl &&
      (kind.includes("snapshot") || kind.includes("screenshot") || kind.includes("截帧"))
    ) {
      coverUrl = deriveAlbumVideoCoverUrl(sourceUrl);
    }
    if (!displayUrl && !coverUrl && !kind) {
      displayUrl = deriveAlbumVideoDisplayUrl(sourceUrl);
      coverUrl = deriveAlbumVideoCoverUrl(sourceUrl);
    }
  }

  if (!mediaId && !sourceUrl && !ciJobId) {
    throw badRequest("video processing callback must include mediaId, sourceUrl, or ciJobId");
  }

  return withTransaction(async (connection) => {
    const media = await findSessionAlbumVideoForProcessing(connection, {
      mediaId,
      sourceUrl,
      ciJobId
    });
    if (!media) {
      throw notFound("Album video not found for processing callback");
    }

    const nextCiJobId = mergeCiJobIds(media.ci_job_id, ciJobId);
    const nextDisplayUrl = displayUrl || media.display_url || null;
    const nextCoverUrl = coverUrl || media.cover_url || null;
    const nextStatus =
      status === "failed"
        ? "failed"
        : nextDisplayUrl
          ? "ready"
          : "processing";
    const nextError =
      nextStatus === "failed"
        ? albumVideoProcessingError(
            body.processingError ||
              body.processing_error ||
              body.error ||
              body.message ||
              body.code ||
              "Video processing failed"
          )
        : null;

    await connection.query(
      `
        UPDATE session_album_photos
        SET
          display_url = ?,
          cover_url = ?,
          ci_job_id = ?,
          processing_status = ?,
          processing_error = ?
        WHERE id = ?
      `,
      [
        nextDisplayUrl,
        nextCoverUrl,
        nextCiJobId,
        nextStatus,
        nextError,
        media.id
      ]
    );

    const updated = await findById(connection, "session_album_photos", media.id);
    return {
      id: Number(updated.id),
      session_id: Number(updated.session_id),
      media_type: "video",
      processing_status: albumMediaProcessingStatus(updated),
      source_url: updated.source_url,
      display_url: updated.display_url,
      cover_url: updated.cover_url,
      duration_seconds: updated.duration_seconds ? Number(updated.duration_seconds) : null,
      video_width: updated.video_width ? Number(updated.video_width) : null,
      video_height: updated.video_height ? Number(updated.video_height) : null,
      video_byte_size: updated.video_byte_size ? Number(updated.video_byte_size) : null,
      video_content_type: updated.video_content_type || "video/mp4",
      ci_job_id: updated.ci_job_id || null,
      processing_error: updated.processing_error || null
    };
  });
}

export async function updateSessionAlbumPhotoTags(user, photoId, body = {}) {
  const id = positiveId(photoId, "photoId");
  const tagKeys = normalizeAlbumTagKeys(body);
  return withTransaction(async (connection) => {
    const photo = await findById(connection, "session_album_photos", id);
    if (!photo || photo.status !== "active") {
      throw notFound("Album photo not found");
    }
    if (Number(photo.uploader_user_id) !== Number(user.user.id)) {
      throw forbidden("Only the photo uploader can tag this photo");
    }
    const session = await requireSessionAlbumOpen(connection, photo.session_id);
    const people = await sessionAlbumPeople(connection, session);
    const peopleByKey = new Map(people.map((person) => [person.key, person]));
    const tags = tagKeys.map((key) => {
      const person = peopleByKey.get(key);
      if (!person) {
        throw badRequest("tags contains a person outside this session");
      }
      return person;
    });

    await connection.query("DELETE FROM session_album_photo_tags WHERE photo_id = ?", [id]);
    for (const [index, tag] of tags.entries()) {
      await connection.query(
        `
          INSERT INTO session_album_photo_tags
            (
              photo_id, tag_type, seat_id, session_npc_role_id,
              user_id, label, sort_order
            )
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
        [
          id,
          tag.tag_type,
          tag.seat_id || null,
          tag.session_npc_role_id || null,
          tag.user_id || null,
          tag.label,
          index
        ]
      );
    }

    return {
      id,
      tags: tags.map((tag) => ({
        key: tag.key,
        tag_type: tag.tag_type,
        seat_id: tag.seat_id,
        session_npc_role_id: tag.session_npc_role_id || null,
        user_id: tag.user_id,
        label: tag.label
      }))
    };
  });
}

export async function deleteSessionAlbumPhoto(user, photoId) {
  const id = positiveId(photoId, "photoId");
  return withTransaction(async (connection) => {
    const photo = await findById(connection, "session_album_photos", id);
    if (!photo || photo.status !== "active") {
      throw notFound("Album photo not found");
    }
    if (Number(photo.uploader_user_id) !== Number(user.user.id)) {
      throw forbidden("Only the photo uploader can delete this photo");
    }
    await connection.query("DELETE FROM session_album_photo_tags WHERE photo_id = ?", [id]);
    await connection.query("DELETE FROM session_album_photos WHERE id = ?", [id]);
    return {
      id,
      media_type: albumMediaType(photo),
      photo_url: photo.photo_url,
      source_url: photo.source_url,
      display_url: photo.display_url,
      cover_url: photo.cover_url,
      object_urls: [
        photo.photo_url,
        photo.source_url,
        photo.display_url,
        photo.cover_url
      ].filter(Boolean),
      deleted: true
    };
  });
}

export async function prepareSessionAlbumPhotoDeletion(user, photoId) {
  const id = positiveId(photoId, "photoId");
  return withDatabaseConnection(async (connection) => {
    const photo = await findById(connection, "session_album_photos", id);
    if (!photo || photo.status !== "active") throw notFound("Album photo not found");
    if (Number(photo.uploader_user_id) !== Number(user.user.id)) {
      throw forbidden("Only the photo uploader can delete this photo");
    }
    return {
      id,
      media_type: albumMediaType(photo),
      object_urls: [photo.photo_url, photo.source_url, photo.display_url, photo.cover_url].filter(Boolean)
    };
  });
}

export async function finalizeSessionAlbumPhotoDeletion(user, photoId, snapshot) {
  const id = positiveId(photoId, "photoId");
  const canonicalUrls = (urls) => [...new Set((urls || []).filter(Boolean))].sort();
  const expected = JSON.stringify(canonicalUrls(snapshot?.object_urls));
  return withTransaction(async (connection) => {
    const photo = await findById(connection, "session_album_photos", id, { forUpdate: true });
    if (!photo || photo.status !== "active") throw notFound("Album photo not found");
    if (Number(photo.uploader_user_id) !== Number(user.user.id)) {
      throw forbidden("Only the photo uploader can delete this photo");
    }
    const current = JSON.stringify(canonicalUrls([photo.photo_url, photo.source_url, photo.display_url, photo.cover_url]));
    if (current !== expected) return { deleted: false, reason: "snapshot_changed" };
    await connection.query("DELETE FROM session_album_photo_tags WHERE photo_id = ?", [id]);
    await connection.query("DELETE FROM session_album_photos WHERE id = ?", [id]);
    return { id, deleted: true };
  });
}

export async function getVisibleSessionAlbumPhotoForMedia(userId, photoId) {
  const id = positiveId(photoId, "photoId");
  const currentUserId = positiveId(userId, "userId");
  return withDatabaseConnection(async (connection) => {
    const photo = await findById(connection, "session_album_photos", id);
    if (!photo || photo.status !== "active") {
      throw notFound("Album photo not found");
    }
    if (albumMediaType(photo) !== "image") {
      throw notFound("Album photo not found");
    }
    const session = await requireSessionAlbumOpen(connection, photo.session_id);
    if (!(await isSessionAlbumMember(connection, session, currentUserId))) {
      throw forbidden("Only session members can view the session album");
    }
    const personalScope = await sessionAlbumPersonalScope(connection, session, currentUserId);
    const tagsMap = await albumTagsForPhotos(connection, [id]);
    const tags = tagsMap.get(id) || [];
    const privacyByUser = await albumPrivacyMap(
      connection,
      photo.session_id,
      [
        photo.uploader_user_id,
        ...tags.map((tag) => tag.user_id).filter(Boolean)
      ]
    );
    if (!isAlbumPhotoVisibleToUser(photo, tags, privacyByUser, currentUserId, personalScope)) {
      throw forbidden("Album photo is not visible");
    }
    return photo;
  });
}

export async function getPublicSessionAlbumPhotoForMedia(claims, photoId) {
  const id = positiveId(photoId, "photoId");
  const normalizedClaims = normalizeAlbumShareClaims(claims);
  return withDatabaseConnection(async (connection) => {
    const photo = await findById(connection, "session_album_photos", id);
    if (!photo || photo.status !== "active") {
      throw notFound("Album photo not found");
    }
    if (albumMediaType(photo) !== "image") {
      throw notFound("Album photo not found");
    }
    if (Number(photo.session_id) !== normalizedClaims.sessionId) {
      throw forbidden("Album photo is outside this public share");
    }
    await requireSessionAlbumOpen(connection, normalizedClaims.sessionId);
    await requirePublicAlbumShareSeat(connection, normalizedClaims);
    const tagsMap = await albumTagsForPhotos(connection, [id]);
    const tags = tagsMap.get(id) || [];
    const privacyByUser = await albumPrivacyMap(
      connection,
      normalizedClaims.sessionId,
      [
        photo.uploader_user_id,
        ...tags.map((tag) => tag.user_id).filter(Boolean)
      ]
    );
    if (!isAlbumPhotoVisibleInPublicShare(photo, tags, privacyByUser, normalizedClaims)) {
      throw forbidden("Album photo is not visible in this public share");
    }
    return photo;
  });
}

export async function getVisibleSessionAlbumVideoForPlayback(user, mediaId) {
  const id = positiveId(mediaId, "mediaId");
  return withDatabaseConnection(async (connection) => {
    const media = await findById(connection, "session_album_photos", id);
    if (!media || media.status !== "active" || albumMediaType(media) !== "video") {
      throw notFound("Album video not found");
    }
    if (albumMediaProcessingStatus(media) !== "ready" || !media.display_url) {
      throw forbidden("Album video is not ready");
    }
    const session = await requireSessionAlbumOpen(connection, media.session_id);
    if (!(await isSessionAlbumMember(connection, session, user.user.id))) {
      throw forbidden("Only session members can view the session album");
    }
    const personalScope = await sessionAlbumPersonalScope(connection, session, user.user.id);
    const tagsMap = await albumTagsForPhotos(connection, [id]);
    const tags = tagsMap.get(id) || [];
    const privacyByUser = await albumPrivacyMap(
      connection,
      media.session_id,
      [
        media.uploader_user_id,
        ...tags.map((tag) => tag.user_id).filter(Boolean)
      ]
    );
    if (!isAlbumPhotoVisibleToUser(media, tags, privacyByUser, user.user.id, personalScope)) {
      throw forbidden("Album video is not visible");
    }
    return media;
  });
}

export async function getPublicSessionAlbumVideoCoverForMedia(claims, mediaId) {
  const id = positiveId(mediaId, "mediaId");
  const normalizedClaims = normalizeAlbumShareClaims(claims);
  return withDatabaseConnection(async (connection) => {
    const media = await findById(connection, "session_album_photos", id);
    if (!media || media.status !== "active" || albumMediaType(media) !== "video") {
      throw notFound("Album video not found");
    }
    if (albumMediaProcessingStatus(media) !== "ready" || !media.cover_url) {
      throw notFound("Album video cover not found");
    }
    if (Number(media.session_id) !== normalizedClaims.sessionId) {
      throw forbidden("Album video is outside this public share");
    }
    await requireSessionAlbumOpen(connection, normalizedClaims.sessionId);
    await requirePublicAlbumShareSeat(connection, normalizedClaims);
    const tagsMap = await albumTagsForPhotos(connection, [id]);
    const tags = tagsMap.get(id) || [];
    const privacyByUser = await albumPrivacyMap(
      connection,
      normalizedClaims.sessionId,
      [
        media.uploader_user_id,
        ...tags.map((tag) => tag.user_id).filter(Boolean)
      ]
    );
    if (!isAlbumPhotoVisibleInPublicShare(media, tags, privacyByUser, normalizedClaims)) {
      throw forbidden("Album video is not visible in this public share");
    }
    return media;
  });
}

async function reviewPhotos(connection, reviewIds) {
  if (reviewIds.length === 0) {
    return new Map();
  }
  const placeholders = reviewIds.map(() => "?").join(", ");
  const [rows] = await connection.query(
    `
      SELECT review_id, photo_url
      FROM session_review_photos
      WHERE review_id IN (${placeholders})
      ORDER BY review_id, sort_order, id
    `,
    reviewIds
  );
  const photosByReview = new Map();
  for (const row of rows) {
    const list = photosByReview.get(Number(row.review_id)) || [];
    list.push(row.photo_url);
    photosByReview.set(Number(row.review_id), list);
  }
  return photosByReview;
}

export async function listSessionReviews(sessionId) {
  const id = positiveId(sessionId, "sessionId");
  return withDatabaseConnection(async (connection) => {
    const session = await findById(connection, "sessions", id);
    if (!session) {
      throw notFound("Session not found");
    }
    const [rows] = await connection.query(
      `
        SELECT
          review.*,
          user.nickname AS user_nickname,
          user.avatar_url AS user_avatar_url,
          user.open_id AS user_open_id,
          seat.name AS seat_name,
          seat.role_name AS seat_role_name
        FROM session_reviews review
        JOIN users user ON user.id = review.user_id
        LEFT JOIN session_seats seat ON seat.id = review.seat_id
        WHERE review.session_id = ?
          AND review.status = 'active'
        ORDER BY review.updated_at DESC, review.id DESC
      `,
      [id]
    );
    const photosByReview = await reviewPhotos(connection, rows.map((row) => Number(row.id)));
    return rows.map((row) => ({
      ...row,
      photos: photosByReview.get(Number(row.id)) || []
    }));
  });
}

export async function getMySessionReview(user, sessionId) {
  const id = positiveId(sessionId, "sessionId");
  return withDatabaseConnection(async (connection) => {
    const eligibleSignup = await currentEligibleSignup(connection, id, user.user.id);
    const [rows] = await connection.query(
      `
        SELECT *
        FROM session_reviews
        WHERE session_id = ?
          AND user_id = ?
          AND status = 'active'
        LIMIT 1
      `,
      [id, user.user.id]
    );
    const review = rows[0] || null;
    const photosByReview = review
      ? await reviewPhotos(connection, [Number(review.id)])
      : new Map();
    return {
      can_review: Boolean(eligibleSignup),
      review: review
        ? {
            ...review,
            photos: photosByReview.get(Number(review.id)) || []
          }
        : null
    };
  });
}

export async function upsertMySessionReview(user, sessionId, body = {}) {
  const id = positiveId(sessionId, "sessionId");
  const rating = reviewRating(body.rating);
  const content = reviewContent(body.content);
  const photoUrls = assertSessionReviewPhotoUrls(body.photoUrls);

  return withTransaction(async (connection) => {
    const eligibleSignup = await currentEligibleSignup(connection, id, user.user.id);
    if (!eligibleSignup) {
      throw forbidden("Only eligible session participants can write a review after start time");
    }

    await connection.query(
      `
        INSERT INTO session_reviews
          (session_id, user_id, seat_id, rating, content, status)
        VALUES (?, ?, ?, ?, ?, 'active')
        ON DUPLICATE KEY UPDATE
          seat_id = VALUES(seat_id),
          rating = VALUES(rating),
          content = VALUES(content),
          status = 'active'
      `,
      [id, user.user.id, eligibleSignup.seat_id || null, rating, content]
    );

    const [reviewRows] = await connection.query(
      `
        SELECT *
        FROM session_reviews
        WHERE session_id = ?
          AND user_id = ?
        LIMIT 1
      `,
      [id, user.user.id]
    );
    const review = reviewRows[0];
    await connection.query("DELETE FROM session_review_photos WHERE review_id = ?", [
      review.id
    ]);
    for (const [index, photoUrl] of photoUrls.entries()) {
      await connection.query(
        `
          INSERT INTO session_review_photos (review_id, photo_url, sort_order)
          VALUES (?, ?, ?)
        `,
        [review.id, photoUrl, index]
      );
    }
    return {
      ...review,
      rating,
      content,
      photos: photoUrls
    };
  });
}

export async function createShareEvent(eventType, body) {
  return withDatabaseConnection(async (connection) => {
    const [result] = await connection.query(
      `
        INSERT INTO share_events
          (
            session_id, inviter_user_id, share_code, source, event_type, path,
            seat_id, viewed_user_id, converted_signup_id, raw_payload_json
          )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        body.sessionId || null,
        body.inviterUserId || null,
        optionalText(body.shareCode),
        optionalText(body.source),
        eventType,
        optionalText(body.path),
        body.seatId || null,
        body.viewedUserId || null,
        body.convertedSignupId || null,
        JSON.stringify(body.rawPayload || body)
      ]
    );
    return selectInserted(connection, "share_events", result);
  });
}

export async function createSubscriptionRequest(user, body) {
  return withDatabaseConnection(async (connection) => {
    const [result] = await connection.query(
      `
        INSERT INTO subscription_requests
          (user_id, template_id, scene, accepted, raw_result_json)
        VALUES (?, ?, ?, ?, ?)
      `,
      [
        user.user.id,
        optionalText(body.templateId),
        optionalText(body.scene),
        body.accepted ? 1 : 0,
        JSON.stringify(body.rawResult || body)
      ]
    );
    return selectInserted(connection, "subscription_requests", result);
  });
}
