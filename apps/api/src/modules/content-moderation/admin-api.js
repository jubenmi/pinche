import { badRequest, notFound } from "../../http/errors.js";
import { MODERATION_PROVIDERS, MODERATION_RETRY_ROUTES } from "./constants.js";
import { buildTextModerationDescriptor } from "./text-boundaries.js";

const DEFAULT_LIST_LIMIT = 100;
const MAX_LIST_LIMIT = 200;
const MAX_LABEL_LENGTH = 64;
const MAX_REJECTION_REASON_LENGTH = 500;
const ADMIN_QUEUE_STATUSES = new Set(["review", "error"]);
const ADMIN_LIST_QUERY_KEYS = new Set([
  "provider",
  "type",
  "status",
  "label",
  "dateFrom",
  "dateTo",
  "limit"
]);
const ADMIN_SUBJECT_TYPES = new Set(
  MODERATION_RETRY_ROUTES.map((route) => route.subjectType)
);
const ADMIN_PROVIDER_TYPE_ROUTES = new Set(
  MODERATION_RETRY_ROUTES.map((route) => `${route.provider}:${route.subjectType}`)
);
const CALENDAR_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

function optionalQueryValue(searchParams, key) {
  return searchParams.has(key) ? searchParams.get(key) : undefined;
}

function assertUniqueKnownQueryKeys(searchParams) {
  if (!(searchParams instanceof URLSearchParams)) {
    throw badRequest("moderation filters must be URL query parameters");
  }

  const seen = new Set();
  for (const [key] of searchParams) {
    if (!ADMIN_LIST_QUERY_KEYS.has(key)) {
      throw badRequest(`unsupported moderation filter: ${key}`);
    }
    if (seen.has(key)) {
      throw badRequest(`duplicate moderation filter: ${key}`);
    }
    seen.add(key);
  }
}

function parseEnum(value, values, key) {
  if (value === undefined) return undefined;
  if (!values.has(value)) {
    throw badRequest(`invalid moderation filter: ${key}`);
  }
  return value;
}

function parseLabel(value) {
  if (value === undefined) return undefined;
  if (
    !value ||
    value.trim() !== value ||
    [...value].length > MAX_LABEL_LENGTH ||
    /[\u0000-\u001F\u007F-\u009F]/.test(value)
  ) {
    throw badRequest("invalid moderation filter: label");
  }
  return value;
}

function daysInMonth(year, month) {
  if (month === 2) {
    return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function parseCalendarDay(value, key) {
  if (value === undefined) return undefined;
  const match = value.match(CALENDAR_DAY);
  if (!match) throw badRequest(`invalid moderation filter: ${key}`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    throw badRequest(`invalid moderation filter: ${key}`);
  }
  return value;
}

function parseLimit(value) {
  if (value === undefined) return DEFAULT_LIST_LIMIT;
  if (!/^[1-9]\d*$/.test(value) || value.length > 3) {
    throw badRequest("invalid moderation filter: limit");
  }
  const limit = Number(value);
  if (!Number.isSafeInteger(limit) || limit > MAX_LIST_LIMIT) {
    throw badRequest("invalid moderation filter: limit");
  }
  return limit;
}

function isPlainRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function parseAdminModerationJobId(value) {
  if (typeof value === "number") {
    if (Number.isSafeInteger(value) && value > 0) return value;
    throw badRequest("moderation job id must be a positive safe integer");
  }

  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) {
    throw badRequest("moderation job id must be a positive safe integer");
  }
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw badRequest("moderation job id must be a positive safe integer");
  }
  return id;
}

export function parseAdminModerationDecisionBody(action, body = {}) {
  if (!["approve", "reject", "retry"].includes(action) || !isPlainRecord(body)) {
    throw badRequest("invalid moderation decision request");
  }

  const keys = Object.keys(body);
  if (action !== "reject") {
    if (keys.length !== 0) {
      throw badRequest("approval and retry requests cannot include a reason");
    }
    return {};
  }

  if (keys.length !== 1 || keys[0] !== "reason" || typeof body.reason !== "string") {
    throw badRequest("rejection reason is required");
  }

  const reason = body.reason.trim();
  if (
    !reason ||
    [...reason].length > MAX_REJECTION_REASON_LENGTH ||
    /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/.test(reason)
  ) {
    throw badRequest("rejection reason is invalid");
  }
  return { reason };
}

export function parseAdminModerationListQuery(searchParams) {
  assertUniqueKnownQueryKeys(searchParams);
  const dateFrom = parseCalendarDay(optionalQueryValue(searchParams, "dateFrom"), "dateFrom");
  const dateTo = parseCalendarDay(optionalQueryValue(searchParams, "dateTo"), "dateTo");
  if (dateFrom && dateTo && dateFrom > dateTo) {
    throw badRequest("dateFrom must not be after dateTo");
  }

  const provider = parseEnum(
    optionalQueryValue(searchParams, "provider"),
    new Set(MODERATION_PROVIDERS),
    "provider"
  );
  const subjectType = parseEnum(
    optionalQueryValue(searchParams, "type"),
    ADMIN_SUBJECT_TYPES,
    "type"
  );
  if (
    provider &&
    subjectType &&
    !ADMIN_PROVIDER_TYPE_ROUTES.has(`${provider}:${subjectType}`)
  ) {
    throw badRequest("provider and type are not a supported moderation route");
  }

  return {
    provider,
    subjectType,
    status: parseEnum(
      optionalQueryValue(searchParams, "status"),
      ADMIN_QUEUE_STATUSES,
      "status"
    ),
    label: parseLabel(optionalQueryValue(searchParams, "label")),
    dateFrom,
    dateTo,
    limit: parseLimit(optionalQueryValue(searchParams, "limit"))
  };
}

function nullableString(value) {
  if (value === undefined || value === null) return null;
  return typeof value === "string" ? value : String(value);
}

function nullableFiniteNumber(value) {
  if (value === undefined || value === null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function nullableSafePositiveInteger(value) {
  if (value === undefined || value === null || value === "") return null;
  const number = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function nullableTimestamp(value) {
  return value === undefined ? null : value;
}

function isMediaSubject(subjectType) {
  return subjectType === "album_image" || subjectType === "album_video";
}

function mediaMetadata(row, { previewUrl = null, previewExpiresAt = null } = {}) {
  if (!isMediaSubject(nullableString(row.subject_type))) return null;
  return {
    session_id: nullableSafePositiveInteger(row.session_id),
    uploader_user_id: nullableSafePositiveInteger(row.uploader_user_id),
    media_type: nullableString(row.media_type),
    processing_status: nullableString(row.processing_status),
    moderation_status: nullableString(row.moderation_status),
    preview_url: typeof previewUrl === "string" && previewUrl.trim() ? previewUrl.trim() : null,
    preview_expires_at: nullableTimestamp(previewExpiresAt)
  };
}

function commonModerationDto(row) {
  const media = mediaMetadata(row);
  return {
    id: nullableSafePositiveInteger(row.id),
    provider: nullableString(row.provider),
    subject_type: nullableString(row.subject_type),
    subject_id: nullableString(row.subject_id),
    subject_version: nullableString(row.subject_version),
    status: nullableString(row.status),
    suggestion: nullableString(row.suggestion),
    label: nullableString(row.label),
    sub_label: nullableString(row.sub_label),
    score: nullableFiniteNumber(row.score),
    attempt_count: nullableFiniteNumber(row.attempt_count),
    next_retry_at: nullableTimestamp(row.next_retry_at),
    last_error_code: nullableString(row.last_error_code),
    submitted_at: nullableTimestamp(row.submitted_at),
    completed_at: nullableTimestamp(row.completed_at),
    created_at: nullableTimestamp(row.created_at),
    updated_at: nullableTimestamp(row.updated_at),
    submitter_user_id: nullableSafePositiveInteger(
      media ? row.uploader_user_id : row.created_by_user_id
    ),
    media
  };
}

function normalizedPayload(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function textDescriptor(row) {
  if (isMediaSubject(nullableString(row.subject_type))) return null;
  const action = nullableString(row.proposal_action ?? row.action);
  const payload = normalizedPayload(row.normalized_payload_json);
  if (!action || !payload) return null;
  try {
    const descriptor = buildTextModerationDescriptor({
      action,
      subjectId: row.subject_id,
      actorUserId: row.created_by_user_id,
      baseVersion: row.base_version,
      idempotencyKey: row.idempotency_key,
      body: payload.body,
      context: payload.context
    });
    if (!descriptor || descriptor.subjectType !== nullableString(row.subject_type)) return null;
    return {
      action: descriptor.action,
      fields: descriptor.fields
    };
  } catch {
    return null;
  }
}

export function serializeAdminModerationListItem(row = {}) {
  return commonModerationDto(row);
}

export function serializeAdminModerationDetail(row = {}, preview = {}) {
  const detail = commonModerationDto(row);
  return {
    ...detail,
    media: mediaMetadata(row, preview),
    text: textDescriptor(row)
  };
}

function moderationRoute(method, pathname) {
  const normalizedMethod = String(method || "").toUpperCase();
  const path = String(pathname || "");
  const base = "/api/admin/content-moderation";
  if (normalizedMethod === "GET" && path === base) return { kind: "list" };

  const detail = path.match(/^\/api\/admin\/content-moderation\/([^/]+)$/);
  if (normalizedMethod === "GET" && detail) return { kind: "detail", rawJobId: detail[1] };

  const decision = path.match(
    /^\/api\/admin\/content-moderation\/([^/]+)\/(approve|reject|retry)$/
  );
  if (normalizedMethod === "POST" && decision) {
    return { kind: "decision", rawJobId: decision[1], action: decision[2] };
  }
  return null;
}

function requiredFunction(value, name) {
  if (typeof value !== "function") throw new TypeError(`${name} is required`);
  return value;
}

// This is deliberately HTTP-framework agnostic so its authorization and DTO
// boundaries can be exercised without importing the production server. The
// server supplies only already-authenticated data access and a controlled
// preview builder; no request-provided object key or action reaches storage.
export function createAdminModerationApi({
  authorize,
  listJobs,
  getJob,
  decide,
  buildPreview = async () => ({}),
  applyTextProposal
} = {}) {
  const authorizeAdmin = requiredFunction(authorize, "authorize");
  const list = requiredFunction(listJobs, "listJobs");
  const get = requiredFunction(getJob, "getJob");
  const decideAsAdmin = requiredFunction(decide, "decide");
  const previewFor = requiredFunction(buildPreview, "buildPreview");
  const applyProposal = requiredFunction(applyTextProposal, "applyTextProposal");

  return async function handleAdminModerationRequest({
    request,
    method,
    pathname,
    searchParams = new URLSearchParams(),
    body = {}
  } = {}) {
    const match = moderationRoute(method, pathname);
    if (!match) return null;

    // Authorize before parsing a concrete job ID or querying storage so a
    // non-admin cannot use IDs to learn which moderation jobs exist.
    const admin = await authorizeAdmin(request);

    if (match.kind === "list") {
      const filters = parseAdminModerationListQuery(searchParams);
      const rows = await list(filters);
      if (!Array.isArray(rows)) throw new TypeError("listJobs must return an array");
      return {
        statusCode: 200,
        data: rows.map((row) => serializeAdminModerationListItem(row))
      };
    }

    const jobId = parseAdminModerationJobId(match.rawJobId);
    if (match.kind === "detail") {
      const row = await get(jobId);
      if (!row) throw notFound("Content moderation job not found");
      const preview = isMediaSubject(nullableString(row.subject_type))
        ? await previewFor(row)
        : {};
      return {
        statusCode: 200,
        data: serializeAdminModerationDetail(row, preview || {})
      };
    }

    const decision = parseAdminModerationDecisionBody(match.action, body);
    const result = await decideAsAdmin({
      admin,
      jobId,
      action: match.action,
      ...decision,
      applyTextProposal: applyProposal
    });
    return { statusCode: 200, data: result };
  };
}
