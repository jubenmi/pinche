import crypto from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { isModerationPublished } from "@pinche/shared";
import { config, publicConfig } from "./config/env.js";
import { checkDatabaseReadiness, withDatabaseConnection, withTransaction } from "./db/mysql.js";
import {
  AppError,
  badRequest,
  forbidden,
  notFound,
  phoneRequired,
  unauthorized
} from "./http/errors.js";
import {
  publicUser,
  updateUserPhone,
  updateUserProfile,
  updateUserProfileWithConnection
} from "./modules/auth/users.js";
import {
  approveAdminWebLoginTicket,
  createAdminWebLoginTicket,
  pollAdminWebLoginTicket
} from "./modules/auth/admin-web-login.js";
import {
  loginWithWechatCode,
  verifyBusinessToken
} from "./modules/auth/wechat.js";
import { routeExtensions } from "./modules/extensions/registry.js";
import { geocodeStoreLocation, reverseGeocodeCity } from "./modules/location/geocoding.js";
import {
  buildCosAuthorization,
  cosHost,
  cosQueryEntries,
  cosObjectKeyFromUploadPath,
  cosStorageEnabled,
  deleteCosObject,
  getCosObject,
  getCosImageInfo,
  headCosObject,
  isTrustedCosStorageError,
  readCosObjectRange,
  renderCosRequestQuery,
  putCosObject
} from "./storage/cos.js";
import {
  createLocalAlbumVideoResponse,
  inspectLocalAlbumVideoObject,
  inspectSessionAlbumVideoObject,
  validateCosAlbumVideoHeaders
} from "./modules/album-video/media.js";
import {
  finalizeLocalAlbumVideoUpload,
  parseMultipartAlbumVideoStream,
  uploadTempAlbumVideoToCos
} from "./modules/album-video/multipart-stream.js";
import { cleanupAlbumVideoBeforeDelete } from "./modules/album-video/lifecycle.js";
import {
  assertAdminOwnSessionAlbumAllowed,
  assertSessionAlbumImageUploadAllowed,
  assertSessionJoinInviteAllowed,
  assertSessionAlbumUploadAllowed,
  approveSignup,
  cancelSession,
  claimSessionNpcRole,
  claimSessionSeat,
  createSessionAlbumPhoto,
  createSessionAlbumVideo,
  createCatalogRequest,
  createEntityClaim,
  createPrivateScript,
  createPrivateScriptWithConnection,
  createPrivateStore,
  createPrivateStoreWithConnection,
  createScript,
  createSeat,
  createSession,
  createSessionWithConnection,
  createSessionNpcRole,
  createSessionNpcRoleWithConnection,
  createShareEvent,
  createSignup,
  createStore,
  createSubscriptionRequest,
  deleteAdminSession,
  prepareSessionAlbumPhotoDeletion,
  requestSessionAlbumImageDeletion,
  finalizeSessionAlbumPhotoDeletion,
  deleteScript,
  deleteStore,
  getPublicSessionAlbumPhotoForMedia,
  getPublicSessionAlbumVideoCoverForMedia,
  getSessionForViewer,
  getSessionAlbumShareSubject,
  getSessionShareStats,
  getMySessionAlbumPrivacy,
  getMySessionReview,
  getVisibleSessionAlbumPhotoForMedia,
  getVisibleSessionAlbumVideoForPlayback,
  getFinalizedSessionAlbumImage,
  hideMySignup,
  kickSessionSeat,
  leaveSessionOrganizer,
  approveCatalogReviewItem,
  listAdminScripts,
  listAdminCatalogReviewItems,
  listAdminSessions,
  listAdminStores,
  listActiveScripts,
  listActiveStores,
  listCatalogRequests,
  listMyCatalogReviewItems,
  listDiscoverableSessions,
  listPublicUpcomingSessions,
  listPublicSessionAlbumShare,
  listSessionAlbum,
  listSessionAlbumPeople,
  listSessionNpcRoles,
  listMySignups,
  listMySessions,
  listSessionReviews,
  listSessionSignups,
  listStoreScripts,
  lockSeat,
  markCatalogReviewItemNeedsChanges,
  mergeCatalogReviewItem,
  publishSession,
  rejectSignup,
  rejectCatalogReviewItem,
  relinkMySessionMembership,
  replaceStoreScripts,
  reviewCatalogRequest,
  transferSessionOrganizer,
  updateAdminCatalogReviewItem,
  updateDeposit,
  updateMyCatalogReviewItem,
  updateScript,
  updateSeat,
  updateSession,
  updateSessionWithConnection,
  updateSessionAlbumVideoProcessingResult,
  updateMySessionAlbumPrivacy,
  updateSessionAlbumPhotoTags,
  updateSessionNpcRole,
  updateSessionNpcRoleWithConnection,
  updateStore,
  upsertMySessionReview,
  upsertMySessionReviewWithConnection,
  upsertPerformerProfile,
  insertFinalizedSessionAlbumImage,
  serializeSessionAlbumImage
} from "./modules/core/service.js";
import { isAlbumImageKind } from "./modules/album-image/constants.js";
import {
  bindLegacyIntentByteSize,
  findAlbumImageIntent,
  findAlbumImageIntentByObjectKey,
  insertAlbumImageIntent,
  markAlbumImageIntentState,
  recordAlbumImageAuthorization
} from "./modules/album-image/repository.js";
import { createAlbumImageUploadService } from "./modules/album-image/upload-service.js";
import { emitAlbumImageEvent } from "./modules/album-image/telemetry.js";
import { validateStoredAlbumImage } from "./modules/album-image/validator.js";
import {
  buildAlbumImageUrls,
  buildSignedCosImageUrl,
  buildWechatImageModerationUrl
} from "./modules/album-image/signed-urls.js";
import {
  TENCENT_VIDEO_CALLBACK_MAX_BYTES,
  authenticateTencentCallback,
  parseTencentCallbackPayload,
  resolveTencentVideoCallback
} from "./modules/content-moderation/callback.js";
import {
  tryHandleProductionPreflightTencentCallback,
  tryHandleProductionPreflightWechatImageCallback
} from "./modules/content-moderation/production-preflight-callback.js";
import {
  assertProductionPreflightGuards
} from "./modules/content-moderation/production-preflight.js";
import {
  hasActiveProductionPreflightWechatImageRun,
  findProductionPreflightAttemptByAssociation,
  findProductionPreflightRun,
  finalizeProductionPreflightRun,
  recordProductionPreflightAssociation
} from "./modules/content-moderation/production-preflight-repository.js";
import {
  parseTencentProductionPreflightCallbackPayload
} from "./modules/content-moderation/tencent-video-client.js";
import {
  dispatchWechatImageModerationEvent,
  parseWechatSecureImageEvent,
  verifyWechatCallbackUrl
} from "./modules/content-moderation/wechat-callback.js";
import {
  claimInitialModerationLease,
  cancelModerationJobByUser,
  cancelTextProposalByAuthor,
  createModerationJob,
  createTextProposal,
  enqueueRejectedMediaCleanup,
  failModerationJob,
  findAuthorTextDraftById,
  findLatestAuthorTextProposal,
  findTextProposalByJobId,
  findCurrentModerationAttempt,
  findModerationAttemptByProviderJobId,
  findModerationJobById,
  findModerationJobByDataId,
  findModerationMedia,
  retireCurrentModerationAttempt,
  recordModerationSubmission,
  renewModerationLease,
  markTextProposalStatus,
  markTextProposalStale,
  createAuditLog,
  getAdminModerationJob,
  listAdminModerationJobs,
  requeueModerationJob,
  transitionMediaModeration,
  transitionModerationJob,
  supersedeRejectedTextProposal
} from "./modules/content-moderation/repository.js";
import { createContentModerationService } from "./modules/content-moderation/service.js";
import { createAuthorDraftService } from "./modules/content-moderation/author-drafts.js";
import { emitContentModerationEvent } from "./modules/content-moderation/telemetry.js";
import { createAdminModerationApi } from "./modules/content-moderation/admin-api.js";
import { createAdminModerationPreviewBuilder } from "./modules/content-moderation/admin-preview.js";
import {
  createTextBaseline,
  requireInitialTextModerationTarget
} from "./modules/content-moderation/text-baseline.js";
import { createTextProposalApplicator } from "./modules/content-moderation/text-proposal-applicator.js";
import {
  buildTextModerationDescriptor,
  buildTextProposalPayload,
  parseTextDraftReplacement
} from "./modules/content-moderation/text-boundaries.js";
import { projectSafeTextAppliedResult } from "./modules/content-moderation/text-applied-result.js";
import { isAuthorPrivateTextDto } from "./modules/content-moderation/author-dto.js";
import {
  createAuthorTextProjectionReader,
  mergeAuthorTextProjection
} from "./modules/content-moderation/author-text-read.js";
import {
  profilePatchFromProposalBody,
  profileTextSnapshot
} from "./modules/content-moderation/text-profile-patch.js";
import {
  createTextMutationIdentity,
  textCreationTargetSubjectId,
  textOperationSubjectId,
  textSessionNpcRoleTargetSubjectId
} from "./modules/content-moderation/text-request-identity.js";
import { createWechatContentSecurityClient } from "./modules/content-moderation/wechat-client.js";
import {
  createTencentVideoModerationClient,
  createTencentVideoModerationTransport
} from "./modules/content-moderation/tencent-video-client.js";
import { assertContentModerationIntake } from "./modules/content-moderation/intake-gate.js";
import {
  createSessionMessageWithConnection,
  updateSessionPinnedMessageWithConnection
} from "@jubenmi/talk/api";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const apiRoot = path.resolve(__dirname, "..");
const avatarUploadDir = path.join(apiRoot, "uploads", "avatars");
const sessionReviewUploadDir = path.join(apiRoot, "uploads", "session-reviews");
const sessionAlbumUploadDir = path.join(apiRoot, "uploads", "session-album");
const sessionAlbumDisplayUploadDir = path.join(sessionAlbumUploadDir, "display");
const sessionAlbumVideoUploadDir = path.join(sessionAlbumUploadDir, "videos");
const sessionAlbumVideoSourceUploadDir = path.join(sessionAlbumVideoUploadDir, "source");
const sessionAlbumVideoDisplayUploadDir = path.join(sessionAlbumVideoUploadDir, "display");
const sessionAlbumVideoCoverUploadDir = path.join(sessionAlbumVideoUploadDir, "cover");
const AVATAR_UPLOAD_MAX_BYTES = 2 * 1024 * 1024;
const AVATAR_MULTIPART_MAX_BYTES = AVATAR_UPLOAD_MAX_BYTES + 64 * 1024;
const SESSION_REVIEW_UPLOAD_MAX_BYTES = 4 * 1024 * 1024;
const SESSION_REVIEW_MULTIPART_MAX_BYTES = SESSION_REVIEW_UPLOAD_MAX_BYTES + 64 * 1024;
const SESSION_ALBUM_UPLOAD_MAX_BYTES = 4 * 1024 * 1024;
const SESSION_ALBUM_MULTIPART_MAX_BYTES = SESSION_ALBUM_UPLOAD_MAX_BYTES + 64 * 1024;
const SESSION_ALBUM_VIDEO_UPLOAD_MAX_BYTES = 100 * 1024 * 1024;
const SESSION_ALBUM_VIDEO_MULTIPART_MAX_BYTES = SESSION_ALBUM_VIDEO_UPLOAD_MAX_BYTES + 256 * 1024;
const SESSION_ALBUM_MEDIA_TOKEN_SECONDS = 10 * 60;
const SESSION_ALBUM_SHARE_TOKEN_SECONDS = 30 * 24 * 60 * 60;
const SESSION_JOIN_INVITE_TOKEN_SECONDS = 7 * 24 * 60 * 60;
const SESSION_ALBUM_PUBLIC_MEDIA_TOKEN_SECONDS = 10 * 60;
const SESSION_ALBUM_VIDEO_SNAPSHOT_PARAMS = {
  "ci-process": "snapshot",
  time: "1",
  format: "jpg"
};
const AVATAR_WEBP_RULE = "imageMogr2/auto-orient/thumbnail/512x512>/format/webp/quality/80";
const SESSION_ALBUM_DISPLAY_JPG_RULE =
  "imageMogr2/auto-orient/thumbnail/2048x2048>/format/jpg/quality/85/strip";
const SESSION_ALBUM_THUMBNAIL_RULE =
  "imageMogr2/auto-orient/thumbnail/640x640>/format/jpg/quality/75/strip";
const avatarMimeTypes = {
  "image/jpeg": ".jpg",
  "image/png": ".png"
};

const moderationTransport = createTencentVideoModerationTransport({
  config: config.contentModeration
});
const tencentVideoModerationClient = createTencentVideoModerationClient({
  config: config.contentModeration,
  transport: moderationTransport
});
const wechatContentSecurityClient = (
  config.contentModeration.wechatTextEnabled || config.contentModeration.wechatImageEnabled
)
  ? createWechatContentSecurityClient({ emit: emitContentModerationEvent })
  : {};
const moderationClient = {
  ...tencentVideoModerationClient,
  ...wechatContentSecurityClient
};
const wechatImageModerationEnabled = Boolean(
  config.contentModeration.enabled && config.contentModeration.wechatImageEnabled
);

function textProposalStale(message) {
  return new AppError(409, "CONTENT_MODERATION_PROPOSAL_STALE", message);
}

export function assertModeratedTextResult(result) {
  if (!projectSafeTextAppliedResult(result) && !isAuthorPrivateTextDto(result)) {
    throw new AppError(
      500,
      "CONTENT_MODERATION_CONFIGURATION_ERROR",
      "Content moderation did not return a safe application result"
    );
  }
  return result;
}

export function moderatedTextHttpStatus(result, publicStatusCode) {
  return isAuthorPrivateTextDto(result) ? 202 : publicStatusCode;
}

export function moderatedTextHeaders(result) {
  return isAuthorPrivateTextDto(result)
    ? { "cache-control": "private, no-store" }
    : {};
}

export function containsAuthorPrivateText(value, depth = 0) {
  if (depth > 6 || value === null || value === undefined) return false;
  if (isAuthorPrivateTextDto(value)) return true;
  if (Array.isArray(value)) {
    return value.some((entry) => containsAuthorPrivateText(entry, depth + 1));
  }
  if (typeof value !== "object") return false;
  return Object.values(value).some((entry) => containsAuthorPrivateText(entry, depth + 1));
}

function authorPrivateResponseHeaders(value) {
  return containsAuthorPrivateText(value)
    ? { "cache-control": "private, no-store" }
    : {};
}

function moderationBody(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return {};
  const {
    idempotencyKey: _idempotencyKey,
    idempotency_key: _idempotencyKeySnake,
    replacesDraftId: _replacesDraftId,
    replaces_draft_id: _replacesDraftIdSnake,
    ...rest
  } = body;
  return rest;
}

function textProposalTargetSubjectId({ action, actorUserId, subjectId, context = {} }) {
  const directTargetId = String(subjectId || "").trim();
  if (directTargetId) return directTargetId;
  if (action === "create_session_npc_role") {
    const sessionId = Number(context.sessionId);
    if (!Number.isInteger(sessionId) || sessionId <= 0) {
      throw badRequest("sessionId is required for session NPC role creation");
    }
    return textSessionNpcRoleTargetSubjectId(sessionId);
  }
  return textCreationTargetSubjectId({ action, actorUserId });
}

function expectedCreationBase(actorUserId) {
  return createTextBaseline({ kind: "creation", actor_id: Number(actorUserId) });
}

function sessionTextSnapshot(row = {}) {
  return {
    id: Number(row.id),
    organizer_user_id: Number(row.organizer_user_id),
    script_id: Number(row.script_id),
    store_id: Number(row.store_id),
    script_name_snapshot: String(row.script_name_snapshot || ""),
    store_name_snapshot: String(row.store_name_snapshot || ""),
    start_at: row.start_at || null,
    dm_user_id: row.dm_user_id ? Number(row.dm_user_id) : null,
    dm_name_snapshot: String(row.dm_name_snapshot || ""),
    npc_user_id: row.npc_user_id ? Number(row.npc_user_id) : null,
    npc_name_snapshot: String(row.npc_name_snapshot || ""),
    deposit_amount: Number(row.deposit_amount || 0),
    visibility: String(row.visibility || ""),
    join_policy: String(row.join_policy || ""),
    join_phone_required: Number(row.join_phone_required || 0),
    npc_join_enabled: Number(row.npc_join_enabled || 0),
    note: String(row.note || ""),
    status: String(row.status || ""),
    cancelled_at: row.cancelled_at || null
  };
}

async function currentActorTextSnapshot(connection, actorUserId, { forUpdate = false } = {}) {
  const lock = forUpdate ? " FOR UPDATE" : "";
  const [rows] = await connection.query(
    `SELECT id, nickname, avatar_url, gender, phone_verified_at
     FROM users WHERE id = ? LIMIT 1${lock}`,
    [Number(actorUserId)]
  );
  const user = rows[0];
  if (!user) return null;
  const [roleRows] = await connection.query(
    `SELECT role FROM user_roles
     WHERE user_id = ? AND status = 'active'
     ORDER BY role${lock}`,
    [Number(actorUserId)]
  );
  return {
    id: Number(user.id),
    nickname: String(user.nickname || ""),
    avatarUrl: user.avatar_url ? String(user.avatar_url) : null,
    gender: user.gender ? String(user.gender) : "",
    phone_verified: Boolean(user.phone_verified_at),
    roles: roleRows.map((row) => String(row.role))
  };
}

function actorAuthoritySnapshot(actor) {
  return {
    id: Number(actor.id),
    is_admin: actor.roles.includes("system_admin")
  };
}

function actorSessionCreateSnapshot(actor) {
  return {
    id: Number(actor.id),
    phone_verified: Boolean(actor.phone_verified)
  };
}

function actorIsAdmin(actor) {
  return actor.roles.includes("system_admin");
}

function assertSessionOwnerPreflight(session, actor) {
  if (!session) throw notFound("Session not found");
  if (!actorIsAdmin(actor) && Number(session.organizer_user_id) !== Number(actor.id)) {
    throw forbidden("Only the session organizer can perform this action");
  }
}

function assertSessionParticipantPreflight(session, actor, seats) {
  if (!session) throw notFound("Session not found");
  if (actorIsAdmin(actor) || Number(session.organizer_user_id) === Number(actor.id)) return;
  if (!seats.some((seat) => ["confirmed", "locked"].includes(String(seat.status)))) {
    throw forbidden("Only onboard players can use session messages");
  }
}

function catalogUsableForSessionPreflight(row, actor) {
  const visibility = String(row.visibility || "public");
  const reviewStatus = String(row.review_status || "approved");
  const active = String(row.status || "active") === "active";
  return (
    (visibility === "public" && reviewStatus === "approved" && active) ||
    (
      visibility === "private" &&
      Number(row.created_by_user_id) === Number(actor.id) &&
      ["pending", "needs_changes"].includes(reviewStatus) &&
      active
    )
  );
}

function assertCatalogSessionPreflight(row, actor, label) {
  if (!row) throw notFound(`${label} not found`);
  if (catalogUsableForSessionPreflight(row, actor)) return;
  if (String(row.visibility || "public") === "private" && Number(row.created_by_user_id) !== Number(actor.id)) {
    throw notFound(`${label} not found`);
  }
  throw badRequest(`${label} is not available for session creation`);
}

function assertReviewEligiblePreflight(session, signups) {
  const startAt = new Date(session.start_at).getTime();
  const cancelledAt = session.cancelled_at ? new Date(session.cancelled_at).getTime() : null;
  const reviewWindowOpen = Number.isFinite(startAt) && startAt <= Date.now() && (
    String(session.status) !== "cancelled" ||
    cancelledAt === null ||
    cancelledAt >= startAt
  );
  if (!reviewWindowOpen || !signups.some((signup) => Boolean(signup.review_eligible_at))) {
    throw forbidden("Only eligible session participants can write a review after start time");
  }
}

async function currentSessionTextBase(
  connection,
  sessionId,
  actorUserId,
  { forUpdate = false } = {}
) {
  const [rows] = await connection.query(
    `SELECT * FROM sessions WHERE id = ? LIMIT 1${forUpdate ? " FOR UPDATE" : ""}`,
    [Number(sessionId)]
  );
  const session = rows[0];
  const actor = await currentActorTextSnapshot(connection, actorUserId, { forUpdate });
  if (!session) {
    if (!forUpdate) requireInitialTextModerationTarget(session, "Session");
    return "";
  }
  if (!actor) {
    if (!forUpdate) requireInitialTextModerationTarget(actor, "User");
    return "";
  }
  if (!forUpdate) assertSessionOwnerPreflight(session, actor);
  return createTextBaseline({
    kind: "session",
    session: sessionTextSnapshot(session),
    actor: actorAuthoritySnapshot(actor)
  });
}

async function currentSessionCreateTextBase(
  connection,
  actorUserId,
  body,
  { forUpdate = false } = {}
) {
  const lock = forUpdate ? " FOR UPDATE" : "";
  const actor = await currentActorTextSnapshot(connection, actorUserId, { forUpdate });
  const [storeRows] = await connection.query(
    `SELECT id, name, status, visibility, review_status, created_by_user_id
     FROM stores WHERE id = ? LIMIT 1${lock}`,
    [Number(body?.storeId)]
  );
  const [scriptRows] = await connection.query(
    `SELECT id, name, status, visibility, review_status, created_by_user_id
     FROM scripts WHERE id = ? LIMIT 1${lock}`,
    [Number(body?.scriptId)]
  );
  const store = storeRows[0];
  const script = scriptRows[0];
  if (!actor) {
    if (!forUpdate) requireInitialTextModerationTarget(actor, "User");
    return "";
  }
  if (!store) {
    if (!forUpdate) requireInitialTextModerationTarget(store, "Store");
    return "";
  }
  if (!script) {
    if (!forUpdate) requireInitialTextModerationTarget(script, "Script");
    return "";
  }
  if (!forUpdate) {
    if (!actor.phone_verified) throw phoneRequired();
    assertCatalogSessionPreflight(store, actor, "Store");
    assertCatalogSessionPreflight(script, actor, "Script");
  }
  const [roleRows] = await connection.query(
    `SELECT id, script_id, name, description, role_gender, sort_order, status
     FROM script_npc_roles
     WHERE script_id = ? AND status = 'active'
     ORDER BY sort_order, id${lock}`,
    [Number(script.id)]
  );
  return createTextBaseline({
    kind: "session_create",
    actor: actorSessionCreateSnapshot(actor),
    store,
    script,
    script_npc_roles: roleRows
  });
}

async function currentNpcRoleTextBase(
  connection,
  npcRoleId,
  actorUserId,
  { forUpdate = false } = {}
) {
  const [rows] = await connection.query(
    `SELECT role.id, role.session_id, role.script_npc_role_id, role.name,
            role.description, role.role_gender, role.source, role.bound_user_id,
            role.sort_order, role.status,
            session.id AS parent_session_id, session.organizer_user_id,
            session.script_id, session.store_id, session.script_name_snapshot,
            session.store_name_snapshot, session.start_at, session.dm_user_id,
            session.dm_name_snapshot, session.npc_user_id, session.npc_name_snapshot,
            session.deposit_amount, session.visibility, session.join_policy,
            session.join_phone_required, session.npc_join_enabled, session.note,
            session.status AS session_status, session.cancelled_at
     FROM session_npc_roles AS role
     JOIN sessions AS session ON session.id = role.session_id
     WHERE role.id = ? LIMIT 1${forUpdate ? " FOR UPDATE" : ""}`,
    [Number(npcRoleId)]
  );
  const role = rows[0];
  const actor = await currentActorTextSnapshot(connection, actorUserId, { forUpdate });
  if (!role) {
    if (!forUpdate) requireInitialTextModerationTarget(role, "Session NPC role");
    return "";
  }
  if (!actor) {
    if (!forUpdate) requireInitialTextModerationTarget(actor, "User");
    return "";
  }
  const parentSession = sessionTextSnapshot({
    ...role,
    id: role.parent_session_id,
    status: role.session_status
  });
  if (!forUpdate) assertSessionOwnerPreflight(parentSession, actor);
  return createTextBaseline({
    kind: "session_npc_role",
    actor: actorAuthoritySnapshot(actor),
    session: parentSession,
    role: {
      id: Number(role.id),
      session_id: Number(role.session_id),
      script_npc_role_id: role.script_npc_role_id ? Number(role.script_npc_role_id) : null,
      name: String(role.name || ""),
      description: String(role.description || ""),
      role_gender: String(role.role_gender || ""),
      source: String(role.source || ""),
      bound_user_id: role.bound_user_id ? Number(role.bound_user_id) : null,
      sort_order: Number(role.sort_order || 0),
      status: String(role.status || "")
    }
  });
}

async function currentReviewTextBase(connection, sessionId, actorUserId, { forUpdate = false } = {}) {
  const lock = forUpdate ? " FOR UPDATE" : "";
  const [sessionRows] = await connection.query(
    `SELECT * FROM sessions WHERE id = ? LIMIT 1${lock}`,
    [Number(sessionId)]
  );
  const actor = await currentActorTextSnapshot(connection, actorUserId, { forUpdate });
  const session = sessionRows[0];
  if (!session) {
    if (!forUpdate) requireInitialTextModerationTarget(session, "Session");
    return "";
  }
  if (!actor) {
    if (!forUpdate) requireInitialTextModerationTarget(actor, "User");
    return "";
  }
  const [signupRows] = await connection.query(
    `SELECT signup.id, signup.session_id, signup.user_id, signup.seat_id,
            signup.session_npc_role_id, signup.status, signup.review_eligible_at,
            seat.status AS seat_status
     FROM signups AS signup
     LEFT JOIN session_seats AS seat ON seat.id = signup.seat_id
     WHERE signup.session_id = ? AND signup.user_id = ?
     ORDER BY signup.id${lock}`,
    [Number(sessionId), Number(actorUserId)]
  );
  const [reviewRows] = await connection.query(
    `SELECT id, session_id, user_id, seat_id, rating, content, status
     FROM session_reviews
     WHERE session_id = ? AND user_id = ?
     ORDER BY id${lock}`,
    [Number(sessionId), Number(actorUserId)]
  );
  const reviewIds = reviewRows.map((row) => Number(row.id));
  let photoRows = [];
  if (reviewIds.length > 0) {
    const placeholders = reviewIds.map(() => "?").join(", ");
    [photoRows] = await connection.query(
      `SELECT id, review_id, photo_url, sort_order
       FROM session_review_photos
       WHERE review_id IN (${placeholders})
       ORDER BY review_id, sort_order, id${lock}`,
      reviewIds
    );
  }
  if (!forUpdate) assertReviewEligiblePreflight(session, signupRows);
  return createTextBaseline({
    kind: "session_review",
    actor: { id: Number(actor.id) },
    session: sessionTextSnapshot(session),
    signups: signupRows,
    reviews: reviewRows,
    photos: photoRows
  });
}

async function currentMessageTextBase(connection, sessionId, actorUserId, { forUpdate = false } = {}) {
  const lock = forUpdate ? " FOR UPDATE" : "";
  const [sessionRows] = await connection.query(
    `SELECT * FROM sessions WHERE id = ? LIMIT 1${lock}`,
    [Number(sessionId)]
  );
  const actor = await currentActorTextSnapshot(connection, actorUserId, { forUpdate });
  const session = sessionRows[0];
  if (!session) {
    if (!forUpdate) requireInitialTextModerationTarget(session, "Session");
    return "";
  }
  if (!actor) {
    if (!forUpdate) requireInitialTextModerationTarget(actor, "User");
    return "";
  }
  const [seatRows] = await connection.query(
    `SELECT id, session_id, confirmed_user_id, status
     FROM session_seats
     WHERE session_id = ? AND confirmed_user_id = ?
     ORDER BY id${lock}`,
    [Number(sessionId), Number(actorUserId)]
  );
  if (!forUpdate) {
    assertSessionParticipantPreflight(session, actor, seatRows);
    if (String(session.status) === "cancelled") {
      throw badRequest("Cancelled session cannot receive messages");
    }
  }
  return createTextBaseline({
    kind: "session_message",
    actor: actorAuthoritySnapshot(actor),
    session: sessionTextSnapshot(session),
    participant_seats: seatRows
  });
}

async function currentPinnedTextBase(connection, sessionId, actorUserId, { forUpdate = false } = {}) {
  const [rows] = await connection.query(
    `SELECT session.id AS session_id,
            session.organizer_user_id, session.script_id, session.store_id,
            session.script_name_snapshot, session.store_name_snapshot, session.start_at,
            session.dm_user_id, session.dm_name_snapshot, session.npc_user_id,
            session.npc_name_snapshot, session.deposit_amount, session.visibility,
            session.join_policy, session.join_phone_required, session.npc_join_enabled,
            session.note, session.status AS session_status, session.cancelled_at,
            room.pinned_message_id,
            room.id AS room_id, room.status AS room_status,
            message.id AS message_id, message.room_id AS message_room_id,
            message.sender_user_id, message.message_type,
            message.content, message.status AS message_status
     FROM sessions AS session
     LEFT JOIN session_chat_rooms AS room ON room.session_id = session.id
     LEFT JOIN session_messages AS message ON message.id = room.pinned_message_id
     WHERE session.id = ? LIMIT 1${forUpdate ? " FOR UPDATE" : ""}`,
    [Number(sessionId)]
  );
  const row = rows[0];
  const actor = await currentActorTextSnapshot(connection, actorUserId, { forUpdate });
  if (!row) {
    if (!forUpdate) requireInitialTextModerationTarget(row, "Session");
    return "";
  }
  if (!actor) {
    if (!forUpdate) requireInitialTextModerationTarget(actor, "User");
    return "";
  }
  if (!forUpdate) {
    assertSessionOwnerPreflight(
      sessionTextSnapshot({ ...row, id: row.session_id, status: row.session_status }),
      actor
    );
  }
  return createTextBaseline({
    kind: "session_pinned_message",
    actor: actorAuthoritySnapshot(actor),
    session: sessionTextSnapshot({ ...row, id: row.session_id, status: row.session_status }),
    room: {
      id: row.room_id ? Number(row.room_id) : null,
      status: String(row.room_status || ""),
      pinned_message_id: row.pinned_message_id ? Number(row.pinned_message_id) : null
    },
    message: {
      id: row.message_id ? Number(row.message_id) : null,
      room_id: row.message_room_id ? Number(row.message_room_id) : null,
      sender_user_id: row.sender_user_id ? Number(row.sender_user_id) : null,
      message_type: String(row.message_type || ""),
      content: String(row.content || ""),
      status: String(row.message_status || "")
    }
  });
}

async function captureTextModerationBase({ action, user, subjectId, body, context = {} }) {
  switch (action) {
    case "update_nickname":
      return withDatabaseConnection(async (connection) => {
        const actor = await currentActorTextSnapshot(connection, user?.user?.id);
        if (!actor) requireInitialTextModerationTarget(actor, "User");
        return createTextBaseline({
          kind: "user_profile",
          profile: profileTextSnapshot(actor)
        });
      });
    case "create_private_store":
    case "create_private_script":
      return expectedCreationBase(user?.user?.id);
    case "create_session":
      return withDatabaseConnection((connection) =>
        currentSessionCreateTextBase(connection, user?.user?.id, body)
      );
    case "update_session":
      return withDatabaseConnection((connection) =>
        currentSessionTextBase(connection, subjectId, user?.user?.id)
      );
    case "create_session_npc_role":
      return withDatabaseConnection((connection) =>
        currentSessionTextBase(connection, Number(context.sessionId), user?.user?.id)
      );
    case "update_session_npc_role":
      return withDatabaseConnection((connection) =>
        currentNpcRoleTextBase(connection, subjectId, user?.user?.id)
      );
    case "upsert_session_review":
      return withDatabaseConnection((connection) =>
        currentReviewTextBase(connection, subjectId, user?.user?.id)
      );
    case "create_session_message":
      return withDatabaseConnection((connection) =>
        currentMessageTextBase(connection, subjectId, user?.user?.id)
      );
    case "update_session_pinned_message":
      return withDatabaseConnection((connection) =>
        currentPinnedTextBase(connection, subjectId, user?.user?.id)
      );
    default:
      throw badRequest("unsupported text moderation action");
  }
}

async function moderateCoveredText({ request, user, action, subjectId, body, context = {} }) {
  if (config.contentModeration.textIntakeMode === "legacy") return null;
  const replacesDraftId = parseTextDraftReplacement(body);
  const cleanBody = moderationBody(body);
  const preflightDescriptor = buildTextModerationDescriptor({
    action,
    body: cleanBody,
    context
  });
  if (!preflightDescriptor) return null;
  const intake = assertContentModerationIntake(config.contentModeration, "text");
  if (!intake.moderationRequired) return null;
  const resolvedSubjectId = String(subjectId || "");
  const proposalTargetId = textProposalTargetSubjectId({
    action,
    actorUserId: user.user.id,
    subjectId: resolvedSubjectId,
    context
  });
  const canonicalPayload = buildTextProposalPayload(action, {
    body: cleanBody,
    context: { ...context, targetSubjectId: proposalTargetId }
  });
  const baseVersion = await captureTextModerationBase({
    action,
    user,
    subjectId: resolvedSubjectId,
    body: canonicalPayload.body,
    context: canonicalPayload.context
  });
  const identity = createTextMutationIdentity({
    request,
    rawBody: body,
    action,
    actorUserId: user.user.id,
    subjectId: resolvedSubjectId,
    baseVersion,
    payload: canonicalPayload
  });
  const targetSubjectId = textOperationSubjectId({
    action,
    actorUserId: user.user.id,
    idempotencyKey: identity.idempotencyKey
  });
  const descriptor = buildTextModerationDescriptor({
    action,
    subjectId: targetSubjectId,
    actorUserId: user.user.id,
    openid: user.user.openid,
    baseVersion,
    idempotencyKey: identity.idempotencyKey,
    idempotencyExplicit: identity.explicit,
    replacesDraftId,
    body: canonicalPayload.body,
    context: canonicalPayload.context
  });
  if (!descriptor) return null;
  return assertModeratedTextResult(await contentModeration.moderateTextMutation(descriptor));
}

async function loadTextProposalActor(connection, actorUserId) {
  const [users] = await connection.query(
    "SELECT * FROM users WHERE id = ? LIMIT 1 FOR UPDATE",
    [Number(actorUserId)]
  );
  if (!users[0]) return null;
  const [roleRows] = await connection.query(
    "SELECT role FROM user_roles WHERE user_id = ? AND status = 'active' ORDER BY role",
    [Number(actorUserId)]
  );
  return { user: publicUser(users[0]), roles: roleRows.map((row) => row.role) };
}

function proposalSessionId(payload) {
  const sessionId = Number(payload?.context?.sessionId);
  if (!Number.isInteger(sessionId) || sessionId <= 0) {
    throw textProposalStale("text moderation session target changed");
  }
  return sessionId;
}

function proposalContextSessionId(payload) {
  const sessionId = Number(payload?.context?.sessionId);
  if (!Number.isInteger(sessionId) || sessionId <= 0) {
    throw textProposalStale("text moderation session target changed");
  }
  return sessionId;
}

function assertProposalBase(proposal, actual) {
  if (!actual || String(proposal?.base_version) !== String(actual)) {
    throw textProposalStale("text moderation proposal base version changed");
  }
}

function assertProposalOperationTarget({ action, actor, job, proposal, payload, targetSubjectId }) {
  const target = String(targetSubjectId || "").trim();
  if (!target || String(payload?.targetSubjectId || "") !== target) {
    throw textProposalStale("text moderation proposal target changed");
  }
  const expectedSubjectId = textOperationSubjectId({
    action,
    actorUserId: actor?.user?.id,
    idempotencyKey: proposal?.idempotency_key
  });
  if (String(job?.subject_id || "") !== expectedSubjectId) {
    throw textProposalStale("text moderation proposal operation changed");
  }
}

async function applyNicknameProposal(connection, { actor, job, proposal, payload }) {
  assertProposalOperationTarget({
    action: "update_nickname",
    actor,
    job,
    proposal,
    payload,
    targetSubjectId: String(actor.user.id)
  });
  const currentActor = await currentActorTextSnapshot(connection, actor.user.id, { forUpdate: true });
  assertProposalBase(proposal, currentActor
    ? createTextBaseline({
      kind: "user_profile",
      profile: profileTextSnapshot(currentActor)
    })
    : "");
  return updateUserProfileWithConnection(
    connection,
    actor.user.id,
    profilePatchFromProposalBody(payload.body)
  );
}

function assertCreationProposal({ action, actor, job, proposal, payload }) {
  assertProposalOperationTarget({
    action,
    actor,
    job,
    proposal,
    payload,
    targetSubjectId: textCreationTargetSubjectId({ action, actorUserId: actor.user.id })
  });
  assertProposalBase(proposal, expectedCreationBase(actor.user.id));
}

async function applyPrivateStoreProposal(connection, { actor, job, proposal, payload }) {
  assertCreationProposal({ action: "create_private_store", actor, job, proposal, payload });
  return createPrivateStoreWithConnection(connection, actor, payload.body);
}

async function applyPrivateScriptProposal(connection, { actor, job, proposal, payload }) {
  assertCreationProposal({ action: "create_private_script", actor, job, proposal, payload });
  return createPrivateScriptWithConnection(connection, actor, payload.body);
}

async function applySessionCreateProposal(connection, { actor, job, proposal, payload }) {
  assertProposalOperationTarget({
    action: "create_session",
    actor,
    job,
    proposal,
    payload,
    targetSubjectId: textCreationTargetSubjectId({ action: "create_session", actorUserId: actor.user.id })
  });
  assertProposalBase(
    proposal,
    await currentSessionCreateTextBase(connection, actor.user.id, payload.body, { forUpdate: true })
  );
  return createSessionWithConnection(connection, actor, payload.body);
}

async function applySessionUpdateProposal(connection, { actor, job, proposal, payload }) {
  const sessionId = proposalSessionId(payload);
  assertProposalOperationTarget({
    action: "update_session",
    actor,
    job,
    proposal,
    payload,
    targetSubjectId: String(sessionId)
  });
  assertProposalBase(
    proposal,
    await currentSessionTextBase(connection, sessionId, actor.user.id, { forUpdate: true })
  );
  return updateSessionWithConnection(connection, actor, sessionId, payload.body);
}

async function applySessionNpcRoleCreateProposal(connection, { actor, job, proposal, payload }) {
  const sessionId = proposalContextSessionId(payload);
  assertProposalOperationTarget({
    action: "create_session_npc_role",
    actor,
    job,
    proposal,
    payload,
    targetSubjectId: textSessionNpcRoleTargetSubjectId(sessionId)
  });
  assertProposalBase(
    proposal,
    await currentSessionTextBase(connection, sessionId, actor.user.id, { forUpdate: true })
  );
  return createSessionNpcRoleWithConnection(connection, actor, sessionId, payload.body);
}

async function applySessionNpcRoleUpdateProposal(connection, { actor, job, proposal, payload }) {
  const npcRoleId = Number(payload?.targetSubjectId);
  if (!Number.isInteger(npcRoleId) || npcRoleId <= 0) {
    throw textProposalStale("text moderation NPC role target changed");
  }
  assertProposalOperationTarget({
    action: "update_session_npc_role",
    actor,
    job,
    proposal,
    payload,
    targetSubjectId: String(npcRoleId)
  });
  assertProposalBase(
    proposal,
    await currentNpcRoleTextBase(connection, npcRoleId, actor.user.id, { forUpdate: true })
  );
  return updateSessionNpcRoleWithConnection(connection, actor, npcRoleId, payload.body);
}

async function applySessionReviewProposal(connection, { actor, job, proposal, payload }) {
  const sessionId = proposalSessionId(payload);
  assertProposalOperationTarget({
    action: "upsert_session_review",
    actor,
    job,
    proposal,
    payload,
    targetSubjectId: String(sessionId)
  });
  assertProposalBase(
    proposal,
    await currentReviewTextBase(connection, sessionId, actor.user.id, { forUpdate: true })
  );
  return upsertMySessionReviewWithConnection(connection, actor, sessionId, payload.body);
}

async function applySessionMessageProposal(connection, { actor, job, proposal, payload }) {
  const sessionId = proposalSessionId(payload);
  assertProposalOperationTarget({
    action: "create_session_message",
    actor,
    job,
    proposal,
    payload,
    targetSubjectId: String(sessionId)
  });
  assertProposalBase(
    proposal,
    await currentMessageTextBase(connection, sessionId, actor.user.id, { forUpdate: true })
  );
  return createSessionMessageWithConnection(connection, actor, sessionId, payload.body);
}

async function applySessionPinnedMessageProposal(connection, { actor, job, proposal, payload }) {
  const sessionId = proposalSessionId(payload);
  assertProposalOperationTarget({
    action: "update_session_pinned_message",
    actor,
    job,
    proposal,
    payload,
    targetSubjectId: String(sessionId)
  });
  assertProposalBase(
    proposal,
    await currentPinnedTextBase(connection, sessionId, actor.user.id, { forUpdate: true })
  );
  const result = await updateSessionPinnedMessageWithConnection(connection, actor, sessionId, payload.body);
  return {
    ...result,
    id: result?.pinnedMessage?.id,
    kind: "session_pinned_message"
  };
}

const textProposalApplicator = createTextProposalApplicator({
  loadActor: loadTextProposalActor,
  handlers: {
    update_nickname: applyNicknameProposal,
    create_private_store: applyPrivateStoreProposal,
    create_private_script: applyPrivateScriptProposal,
    create_session: applySessionCreateProposal,
    update_session: applySessionUpdateProposal,
    create_session_npc_role: applySessionNpcRoleCreateProposal,
    update_session_npc_role: applySessionNpcRoleUpdateProposal,
    upsert_session_review: applySessionReviewProposal,
    create_session_message: applySessionMessageProposal,
    update_session_pinned_message: applySessionPinnedMessageProposal
  }
});
const authorTextProjectionReader = createAuthorTextProjectionReader({
  config: config.contentModeration,
  repository: { findLatestAuthorTextProposal }
});
const authorDrafts = createAuthorDraftService({
  transaction: withTransaction,
  repository: {
    findAuthorTextDraftById,
    cancelTextProposalByAuthor,
    cancelModerationJobByUser,
    retireCurrentModerationAttempt,
    supersedeRejectedTextProposal
  }
});
// The retry worker imports this controlled runtime. server.js only calls
// listen() behind its direct-main guard, so that import reuses the identical
// client/COS/openid/applicator wiring without opening an HTTP listener.
export const contentModeration = createContentModerationService({
  config: config.contentModeration,
  client: moderationClient,
  transaction: withTransaction,
  withDatabaseConnection,
  repository: {
    claimInitialModerationLease,
    createModerationJob,
    createTextProposal,
    enqueueRejectedMediaCleanup,
    failModerationJob,
    findTextProposalByJobId,
    findCurrentModerationAttempt,
    findModerationAttemptByProviderJobId,
    findModerationJobById,
    findModerationMedia,
    retireCurrentModerationAttempt,
    recordModerationSubmission,
    renewModerationLease,
    markTextProposalStatus,
    markTextProposalStale,
    createAuditLog,
    requeueModerationJob,
    transitionMediaModeration,
    transitionModerationJob
  },
  getVerifiedImageUploaderOpenid: async ({ uploaderUserId }) =>
    withDatabaseConnection(async (connection) => {
      const [users] = await connection.query(
        "SELECT open_id FROM users WHERE id = ? LIMIT 1",
        [Number(uploaderUserId)]
      );
      return users[0]?.open_id || "";
    }),
  buildWechatImageUrl: ({ objectKey }) => {
    if (!cosStorageEnabled(config.cos)) {
      throw new AppError(
        503,
        "CONTENT_MODERATION_CONFIGURATION_ERROR",
        "private COS storage is required for WeChat image moderation"
      );
    }
    return buildWechatImageModerationUrl({
      objectKey,
      nowSeconds: Math.floor(Date.now() / 1000),
      config: config.cos
    });
  },
  applyTextProposal: (connection, input) => textProposalApplicator.apply(connection, input),
  supersedeRejectedDraft: (connection, input) => authorDrafts.supersedeRejected(connection, input),
  emit: emitContentModerationEvent
});

function createProductionPreflightCallbackRepository() {
  return {
    findAttemptByAssociation: (input) =>
      withDatabaseConnection((connection) =>
        findProductionPreflightAttemptByAssociation({ connection, ...input })
      ),
    findRun: (input) =>
      withDatabaseConnection((connection) =>
        findProductionPreflightRun({ connection, ...input })
      ),
    recordAssociation: (input) =>
      withDatabaseConnection((connection) =>
        recordProductionPreflightAssociation({ connection, ...input })
      ),
    finalizeRun: (input) =>
      withDatabaseConnection((connection) =>
        finalizeProductionPreflightRun({ connection, ...input })
      ),
    hasActiveWechatImagePreflight: () =>
      withDatabaseConnection((connection) =>
        hasActiveProductionPreflightWechatImageRun({ connection })
      ),
    findOrdinaryWechatImageAttempt: ({ traceId }) =>
      withDatabaseConnection((connection) =>
        findModerationAttemptByProviderJobId(connection, "wechat_sec_check", traceId)
      )
  };
}

async function cleanupProductionPreflightCallbackObject({ objectKey }) {
  await deleteCosObject({ key: objectKey, config: config.cos });
  try {
    await headCosObject({ key: objectKey, config: config.cos });
  } catch (error) {
    if (error?.code === "COS_OBJECT_NOT_FOUND") {
      return;
    }
    throw error;
  }
  throw new AppError(
    500,
    "CONTENT_MODERATION_PRODUCTION_PREFLIGHT_CLEANUP_FAILED",
    "production preflight object cleanup verification failed"
  );
}

async function buildProductionPreflightCallbackRuntime() {
  const operatorUserId = Number(config.contentModeration.productionPreflight?.operatorUserId || 0);
  const operatorStatus = await withDatabaseConnection(async (connection) => {
    const [rows] = await connection.query(
      "SELECT role, status FROM user_roles WHERE user_id = ? AND role = 'system_admin' LIMIT 1",
      [operatorUserId]
    );
    const row = rows[0];
    return row?.role === "system_admin" && row?.status === "active" ? "active" : "missing";
  });
  return {
    nodeEnv: config.contentModeration.nodeEnv,
    preflightEnabled: Boolean(config.contentModeration.productionPreflight?.enabled),
    confirmation: "",
    expectedConfirmation: config.contentModeration.productionPreflight?.confirmation || "",
    operatorUserId,
    operatorRole: "system_admin",
    operatorStatus,
    intakeModes: {
      text: config.contentModeration.textIntakeMode,
      image: config.contentModeration.imageIntakeMode,
      video: config.contentModeration.videoIntakeMode
    },
    providerConfig: {
      wechatText: Boolean(config.contentModeration.wechatTextEnabled && config.contentModeration.wechatAppId && config.contentModeration.wechatAppSecret),
      wechatImage: Boolean(config.contentModeration.wechatImageEnabled && config.contentModeration.wechatAppId && config.contentModeration.wechatAppSecret),
      tencentVideo: Boolean(config.contentModeration.tencentVideoEnabled && config.contentModeration.tencentVideoPolicyId),
      cos: Boolean(config.contentModeration.cosEnabled && config.contentModeration.bucket && config.contentModeration.cosRegion),
      redis: Boolean(config.contentModeration.redisEnabled && (config.contentModeration.redisUrl || config.contentModeration.redisHost)),
      callback: Boolean(config.contentModeration.tencentVideoCallbackToken || config.contentModeration.wechatEventToken)
    },
    releaseFingerprint: config.contentModeration.productionPreflight?.releaseFingerprint,
    appId: config.contentModeration.wechatAppId
  };
}

async function applyApprovedTextProposal(connection, { job, proposal }) {
  return textProposalApplicator.apply(connection, { job, proposal });
}

const buildAdminModerationPreview = createAdminModerationPreviewBuilder({
  cosConfig: config.cos,
  buildImageUrl: ({ objectKey, nowSeconds, expiresInSeconds, queryEntries }) => buildSignedCosImageUrl({
    objectKey,
    nowSeconds,
    expiresInSeconds,
    queryEntries,
    config: config.cos
  }),
  buildVideoUrl: ({ uploadPath, expiresInSeconds, queryEntries }) => signedCosAlbumVideoUrl(
    { display_url: uploadPath },
    "GET",
    expiresInSeconds,
    queryEntries
  )
});

const adminModerationApi = createAdminModerationApi({
  authorize: async (request) => {
    const user = await getAuthUser(request);
    requireRole(user, "system_admin");
    return user;
  },
  listJobs: (filters) => withDatabaseConnection((connection) =>
    listAdminModerationJobs(connection, filters)
  ),
  getJob: (jobId) => withDatabaseConnection((connection) =>
    getAdminModerationJob(connection, jobId)
  ),
  decide: (input) => contentModeration.decideAsAdmin(input),
  buildPreview: buildAdminModerationPreview,
  applyTextProposal: applyApprovedTextProposal
});

const albumImageUploads = createAlbumImageUploadService({
  cosConfig: config.cos,
  directUploadRequired: config.albumMedia.directUploadRequired,
  assertImageIntake: () => assertContentModerationIntake(config.contentModeration, "image"),
  transaction: withTransaction,
  access: assertSessionAlbumImageUploadAllowed,
  repository: {
    insert: insertAlbumImageIntent,
    find: findAlbumImageIntent,
    findByObjectKey: findAlbumImageIntentByObjectKey,
    bindByteSize: bindLegacyIntentByteSize,
    recordAuthorization: recordAlbumImageAuthorization,
    markState: markAlbumImageIntentState
  },
  withDatabaseConnection,
  validateStoredImage: (intent) => validateStoredAlbumImage({
    intent,
    storage: {
      head: async (key) => {
        const response = await headCosObject({ key, config: config.cos });
        return {
          etag: response.headers.etag || "",
          byteSize: Number(response.headers["content-length"] || 0),
          contentType: String(response.headers["content-type"] || "")
        };
      },
      imageInfo: ({ key, etag }) => getCosImageInfo({ key, etag, config: config.cos })
    }
  }),
  insertFinalizedImage: insertFinalizedSessionAlbumImage,
  getFinalizedImage: getFinalizedSessionAlbumImage,
  serializeImage: serializeSessionAlbumImage,
  createWechatImageModerationJob: wechatImageModerationEnabled
    ? (connection, input) => contentModeration.createWechatImageModerationJob(connection, input)
    : undefined,
  submitWechatImageModeration: wechatImageModerationEnabled
    ? (job) => contentModeration.submitWechatImageModeration(job)
    : undefined,
  emit: emitAlbumImageEvent
});

async function isPersistedAlbumImageAuthorization(user, body) {
  if (body.uploadId || body.upload_id) return true;
  const key = String(body.key || body.Key || "");
  if (!key) return false;
  return withDatabaseConnection(async (connection) => Boolean(
    await findAlbumImageIntentByObjectKey(connection, {
      userId: Number(user.user.id),
      objectKey: key
    })
  ));
}

function jsonResponse(response, statusCode, payload, headers = {}) {
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, {
    ...headers,
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body)
  });
  response.end(body);
}

function errorResponse(response, statusCode, code, message, details) {
  jsonResponse(response, statusCode, {
    ok: false,
    error: {
      code,
      message,
      ...(details ? { details } : {})
    }
  });
}

export function normalizeError(error) {
  if (error instanceof AppError) {
    return error;
  }

  if (isTrustedCosStorageError(error)) {
    const safeMessages = {
      COS_OBJECT_NOT_FOUND: "Album video source object was not found",
      COS_PRECONDITION_FAILED: "Album video source object changed during validation",
      COS_UPSTREAM_ERROR: "Object storage request failed",
      COS_NETWORK_ERROR: "Object storage network request failed",
      COS_REQUEST_TIMEOUT: "Object storage request timed out",
      COS_RESPONSE_ABORTED: "Object storage response was interrupted",
      COS_RESPONSE_TOO_LARGE: "Object storage returned an invalid response",
      COS_INVALID_CONTENT_LENGTH: "Object storage returned invalid metadata",
      COS_INVALID_RANGE_RESPONSE: "Object storage returned an invalid byte range"
    };
    return new AppError(
      Number(error.statusCode),
      error.code,
      safeMessages[error.code] || "Object storage request failed"
    );
  }

  if (error?.code === "WECHAT_CONFIG_MISSING") {
    return new AppError(502, "WECHAT_CONFIG_MISSING", "WeChat login configuration is missing");
  }

  if (error?.code === "WECHAT_LOGIN_FAILED") {
    return new AppError(502, "WECHAT_LOGIN_FAILED", error.message, error.details);
  }

  if (error?.code === "WECHAT_UPSTREAM_TIMEOUT") {
    return new AppError(504, "WECHAT_UPSTREAM_TIMEOUT", "WeChat login service timed out");
  }

  const moderationErrors = {
    CONTENT_MODERATION_OPENID_REQUIRED: [422, "A verified content producer is required"],
    CONTENT_MODERATION_REJECTED: [422, "Content did not pass moderation"],
    CONTENT_MODERATION_REVIEW_PENDING: [202, "Content is pending further moderation"],
    CONTENT_MODERATION_UNAVAILABLE: [503, "Content moderation is temporarily unavailable"],
    CONTENT_MODERATION_PROPOSAL_STALE: [409, "Content moderation proposal is stale"],
    CONTENT_MODERATION_IDEMPOTENCY_CONFLICT: [409, "Content moderation request conflicts with an existing request"],
    CONTENT_MODERATION_INVALID_TRANSITION: [409, "Content moderation state changed"],
    CONTENT_MODERATION_CALLBACK_STALE: [409, "Content moderation state changed"],
    CONTENT_MODERATION_CONFIGURATION_ERROR: [500, "Content moderation is not configured"],
    CONTENT_MODERATION_CALLBACK_UNAUTHORIZED: [401, "Content moderation callback is unauthorized"],
    CONTENT_MODERATION_INVALID_CALLBACK: [400, "Content moderation callback is invalid"]
  };
  if (moderationErrors[error?.code]) {
    const [statusCode, message] = moderationErrors[error.code];
    return new AppError(statusCode, error.code, message);
  }

  if (error?.code === "ER_DUP_ENTRY") {
    return new AppError(409, "CONFLICT", "Duplicate resource", error.sqlMessage);
  }

  return new AppError(500, "INTERNAL_ERROR", "Internal server error");
}

async function readRawBody(request, maxBytes = Infinity) {
  const chunks = [];
  let totalBytes = 0;
  for await (const chunk of request) {
    totalBytes += chunk.length;
    if (totalBytes > maxBytes) {
      throw badRequest("request body is too large");
    }
    chunks.push(chunk);
  }

  if (chunks.length === 0) {
    return Buffer.alloc(0);
  }

  return Buffer.concat(chunks);
}

async function readJsonBody(request) {
  const rawBody = await readRawBody(request);
  if (rawBody.length === 0) {
    return {};
  }

  const body = rawBody.toString("utf8");
  if (!body.trim()) {
    return {};
  }

  return JSON.parse(body);
}

function isBodyMethod(method) {
  return ["POST", "PATCH", "PUT"].includes(method);
}

async function bodyFor(request) {
  if (!isBodyMethod(request.method)) {
    return {};
  }

  try {
    return await readJsonBody(request);
  } catch (error) {
    throw new AppError(400, "INVALID_JSON", "Request body must be valid JSON");
  }
}

function safeTextEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ""));
  const rightBuffer = Buffer.from(String(right || ""));
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function verifyCosCiCallbackToken(url) {
  const expectedToken = config.cos.ciCallbackToken;
  if (!expectedToken) {
    if (config.nodeEnv === "production") {
      throw forbidden("COS CI callback token is not configured");
    }
    return;
  }

  const token = url.searchParams.get("token") || url.searchParams.get("callbackToken") || "";
  if (!safeTextEqual(token, expectedToken)) {
    throw forbidden("COS CI callback token is invalid");
  }
}

function xmlUnescape(value) {
  return String(value || "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function xmlTextValues(xml, tagName) {
  const pattern = new RegExp(`<${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tagName}>`, "gi");
  const values = [];
  let match = pattern.exec(xml);
  while (match) {
    values.push(xmlUnescape(match[1].trim()));
    match = pattern.exec(xml);
  }
  return values.filter(Boolean);
}

function parseJsonText(value) {
  const text = String(value || "").trim();
  if (!text) {
    return {};
  }
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function firstDeepValue(value, names) {
  const nameSet = new Set(names.map((name) => name.toLowerCase()));
  const stack = [value];
  while (stack.length > 0) {
    const current = stack.shift();
    if (!current || typeof current !== "object") {
      continue;
    }
    if (Array.isArray(current)) {
      stack.push(...current);
      continue;
    }
    for (const [key, item] of Object.entries(current)) {
      if (nameSet.has(key.toLowerCase()) && item !== undefined && item !== null && item !== "") {
        return item;
      }
      if (item && typeof item === "object") {
        stack.push(item);
      }
    }
  }
  return null;
}

function collectDeepValues(value, names) {
  const nameSet = new Set(names.map((name) => name.toLowerCase()));
  const stack = [value];
  const values = [];
  while (stack.length > 0) {
    const current = stack.shift();
    if (!current || typeof current !== "object") {
      continue;
    }
    if (Array.isArray(current)) {
      stack.push(...current);
      continue;
    }
    for (const [key, item] of Object.entries(current)) {
      if (nameSet.has(key.toLowerCase()) && item !== undefined && item !== null && item !== "") {
        values.push(item);
      }
      if (item && typeof item === "object") {
        stack.push(item);
      }
    }
  }
  return values;
}

function callbackObjectPath(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  let text = String(value).trim();
  if (/^https?:\/\//i.test(text)) {
    try {
      text = new URL(text).pathname;
    } catch {
      return null;
    }
  }
  text = text.split("?")[0];
  try {
    text = decodeURIComponent(text);
  } catch {
    return null;
  }
  if (!text.startsWith("/")) {
    text = `/${text}`;
  }
  return text.startsWith("/uploads/session-album/videos/") ? text : null;
}

function callbackStatus({ code, state, status }) {
  const codeText = String(code || "").trim();
  if (codeText && !/^success$/i.test(codeText)) {
    return "failed";
  }
  const value = String(state || status || code || "").trim();
  if (/success|ready|complete|done/i.test(value)) {
    return "ready";
  }
  if (/fail|error/i.test(value)) {
    return "failed";
  }
  return "processing";
}

function parseSessionAlbumVideoProcessingCallback(rawBody) {
  const text = Buffer.isBuffer(rawBody) ? rawBody.toString("utf8").trim() : String(rawBody || "");
  if (!text) {
    throw badRequest("COS CI callback body is required");
  }

  const jsonPayload = text.startsWith("{") || text.startsWith("[") ? parseJsonText(text) : {};
  const isJson = Object.keys(jsonPayload).length > 0 || Array.isArray(jsonPayload);
  const userDataText = isJson
    ? firstDeepValue(jsonPayload, ["UserData", "userData", "Userdata"])
    : xmlTextValues(text, "UserData")[0];
  const userData =
    userDataText && typeof userDataText === "object" ? userDataText : parseJsonText(userDataText);
  const objectValues = isJson
    ? collectDeepValues(jsonPayload, ["Object", "object"])
    : xmlTextValues(text, "Object");
  const objectPaths = objectValues.map(callbackObjectPath).filter(Boolean);
  const inputObject =
    callbackObjectPath(userData.sourceUrl || userData.source_url || userData.inputObject) ||
    objectPaths.find((item) => item.startsWith("/uploads/session-album/videos/source/")) ||
    objectPaths[0] ||
    null;
  const outputObject =
    objectPaths.length > 1 ? objectPaths[objectPaths.length - 1] : objectPaths[0] || null;
  const tag = String(
    userData.kind ||
      userData.tag ||
      (isJson
        ? firstDeepValue(jsonPayload, ["Tag", "tag", "Operation"])
        : xmlTextValues(text, "Tag")[0]) ||
      ""
  );
  const code = String(
    userData.code ||
      (isJson ? firstDeepValue(jsonPayload, ["Code", "code"]) : xmlTextValues(text, "Code")[0]) ||
      ""
  );
  const state = String(
    userData.state ||
      (isJson
        ? firstDeepValue(jsonPayload, ["State", "state"])
        : xmlTextValues(text, "State")[0]) ||
      ""
  );
  const message = String(
    userData.message ||
      (isJson
        ? firstDeepValue(jsonPayload, ["Message", "message", "ErrorMessage"])
        : xmlTextValues(text, "Message")[0]) ||
      ""
  );
  let displayObject =
    callbackObjectPath(userData.displayUrl || userData.display_url || userData.displayObject) ||
    null;
  let coverObject =
    callbackObjectPath(userData.coverUrl || userData.cover_url || userData.coverObject) || null;

  if (outputObject) {
    const lowerOutput = outputObject.toLowerCase();
    const lowerTag = tag.toLowerCase();
    if (
      lowerOutput.includes("/cover/") ||
      /\.(?:jpg|jpeg)$/.test(lowerOutput) ||
      lowerTag.includes("snapshot") ||
      lowerTag.includes("screenshot") ||
      lowerTag.includes("截帧")
    ) {
      coverObject = coverObject || outputObject;
    }
    if (
      lowerOutput.includes("/display/") ||
      lowerOutput.endsWith(".mp4") ||
      lowerTag.includes("transcode") ||
      lowerTag.includes("转码")
    ) {
      displayObject = displayObject || outputObject;
    }
  }

  return {
    mediaId: userData.mediaId || userData.media_id || firstDeepValue(jsonPayload, ["mediaId"]),
    ciJobId:
      userData.ciJobId ||
      userData.ci_job_id ||
      userData.jobId ||
      (isJson
        ? firstDeepValue(jsonPayload, ["JobId", "JobID", "jobId"])
        : xmlTextValues(text, "JobId")[0]),
    processingStatus: callbackStatus({
      code,
      state,
      status: userData.status || firstDeepValue(jsonPayload, ["Status", "status"])
    }),
    kind: tag,
    sourceUrl: inputObject,
    displayUrl: displayObject,
    coverUrl: coverObject,
    processingError: message || code || null
  };
}

async function handleSessionAlbumVideoProcessingCallback(url, request) {
  verifyCosCiCallbackToken(url);
  const rawBody = await readRawBody(request, 1024 * 1024);
  const callback = parseSessionAlbumVideoProcessingCallback(rawBody);
  return updateSessionAlbumVideoProcessingResult(callback);
}

function splitBuffer(buffer, separator) {
  const parts = [];
  let start = 0;
  let index = buffer.indexOf(separator, start);
  while (index !== -1) {
    parts.push(buffer.subarray(start, index));
    start = index + separator.length;
    index = buffer.indexOf(separator, start);
  }
  parts.push(buffer.subarray(start));
  return parts;
}

function trimMultipartPayload(payload) {
  let end = payload.length;
  if (end >= 2 && payload[end - 2] === 13 && payload[end - 1] === 10) {
    end -= 2;
  }
  return payload.subarray(0, end);
}

function avatarExtensionFromBytes(file) {
  if (file.length >= 3 && file[0] === 0xff && file[1] === 0xd8 && file[2] === 0xff) {
    return ".jpg";
  }
  if (
    file.length >= 8 &&
    file[0] === 0x89 &&
    file[1] === 0x50 &&
    file[2] === 0x4e &&
    file[3] === 0x47 &&
    file[4] === 0x0d &&
    file[5] === 0x0a &&
    file[6] === 0x1a &&
    file[7] === 0x0a
  ) {
    return ".png";
  }
  return "";
}

function parseMultipartImageUpload(contentType, body, options = {}) {
  const fieldName = options.fieldName || "avatar";
  const maxBytes = options.maxBytes || AVATAR_UPLOAD_MAX_BYTES;
  const label = options.label || fieldName;
  const boundary = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/)?.[1] ||
    contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/)?.[2];
  if (!boundary) {
    throw badRequest("multipart boundary is required");
  }

  const boundaryBuffer = Buffer.from(`--${boundary}`);
  for (const rawPart of splitBuffer(body, boundaryBuffer)) {
    let part = rawPart;
    if (part.length >= 2 && part[0] === 13 && part[1] === 10) {
      part = part.subarray(2);
    }
    if (part.length === 0 || part.subarray(0, 2).toString() === "--") {
      continue;
    }

    const headerEnd = part.indexOf(Buffer.from("\r\n\r\n"));
    if (headerEnd === -1) {
      continue;
    }

    const headersText = part.subarray(0, headerEnd).toString("utf8");
    const disposition = headersText.match(/^content-disposition:\s*(.+)$/im)?.[1] || "";
    if (!disposition.includes(`name="${fieldName}"`) || !/filename="/.test(disposition)) {
      continue;
    }

    const mimeType = headersText.match(/^content-type:\s*([^\r\n;]+)/im)?.[1]?.trim() || "";
    const file = trimMultipartPayload(part.subarray(headerEnd + 4));
    if (file.length === 0) {
      throw badRequest(`${label} file is required`);
    }
    if (file.length > maxBytes) {
      throw badRequest(`${label} file is too large`);
    }

    const extension = avatarExtensionFromBytes(file) || avatarMimeTypes[mimeType];
    if (!extension) {
      throw badRequest(`${label} must be a JPEG or PNG image`);
    }

    return { extension, file, mimeType };
  }

  throw badRequest(`${label} file is required`);
}

function parseMultipartAvatarUpload(contentType, body) {
  return parseMultipartImageUpload(contentType, body, {
    fieldName: "avatar",
    maxBytes: AVATAR_UPLOAD_MAX_BYTES,
    label: "avatar"
  });
}

function parseRawAvatarUpload(contentType, body) {
  const normalizedContentType = String(contentType || "").split(";")[0].trim().toLowerCase();
  if (body.length === 0) {
    throw badRequest("avatar file is required");
  }
  if (body.length > AVATAR_UPLOAD_MAX_BYTES) {
    throw badRequest("avatar file is too large");
  }

  const extension = avatarExtensionFromBytes(body) || avatarMimeTypes[normalizedContentType];
  if (!extension) {
    throw badRequest("avatar must be a JPEG or PNG image");
  }

  return {
    extension,
    file: body,
    mimeType: extension === ".png" ? "image/png" : "image/jpeg"
  };
}

function avatarContentType(filename) {
  const extension = path.extname(filename).toLowerCase();
  if (extension === ".jpg" || extension === ".jpeg") {
    return "image/jpeg";
  }
  if (extension === ".png") {
    return "image/png";
  }
  if (extension === ".webp") {
    return "image/webp";
  }
  if (extension === ".mp4") {
    return "video/mp4";
  }
  return "application/octet-stream";
}

function uploadedObjectContentType(filename, fallbackContentType = "") {
  const filenameContentType = avatarContentType(filename);
  if (filenameContentType !== "application/octet-stream") {
    return filenameContentType;
  }
  return fallbackContentType || filenameContentType;
}

function isCosUploadStorageEnabled() {
  return cosStorageEnabled(config.cos);
}

function uploadFilenameBase(prefix, userId) {
  return `${prefix}-${userId}-${Date.now()}-${crypto.randomBytes(8).toString("hex")}`;
}

function avatarWebpPicOperations(key) {
  return JSON.stringify({
    is_pic_info: 1,
    rules: [
      {
        bucket: config.cos.bucket,
        fileid: `/${key}`,
        rule: AVATAR_WEBP_RULE
      }
    ]
  });
}

function sessionAlbumDisplayJpgPicOperations(key) {
  return JSON.stringify({
    is_pic_info: 1,
    rules: [
      {
        bucket: config.cos.bucket,
        fileid: `/${key}`,
        rule: SESSION_ALBUM_DISPLAY_JPG_RULE
      }
    ]
  });
}

function normalizeUploadExtension(extension) {
  const normalized = String(extension || "").trim().toLowerCase();
  if (normalized === "jpg" || normalized === "jpeg" || normalized === "png") {
    return `.${normalized}`;
  }
  if (normalized === ".jpg" || normalized === ".jpeg" || normalized === ".png") {
    return normalized;
  }
  return ".jpg";
}

function normalizeVideoUploadExtension(extension) {
  const normalized = String(extension || "").trim().toLowerCase();
  if (normalized === "mp4" || normalized === ".mp4") {
    return ".mp4";
  }
  return ".mp4";
}

async function createCosDirectUploadIntent({ kind, extension, user, userId, sessionId }) {
  if (!isCosUploadStorageEnabled()) {
    return { direct: false };
  }

  const uploadUserId = user?.user?.id || userId;
  if (kind === "adminSessionAlbumVideo") {
    requireRole(user, "system_admin");
    normalizeVideoUploadExtension(extension);
    const session = await assertSessionAlbumUploadAllowed(user, sessionId);
    assertContentModerationIntake(config.contentModeration, "video");
    const key = `uploads/session-album/videos/source/${uploadFilenameBase(
      `admin-video-${session.id}`,
      uploadUserId
    )}.mp4`;
    return {
      direct: true,
      kind,
      sessionId: Number(session.id),
      bucket: config.cos.bucket,
      region: config.cos.region,
      key,
      uploadPath: `/${key}`,
      maxBytes: SESSION_ALBUM_VIDEO_UPLOAD_MAX_BYTES,
      contentType: "video/mp4",
      headers: { "x-cos-forbid-overwrite": "true" }
    };
  }

  const sourceExtension = normalizeUploadExtension(extension);
  if (kind === "avatar") {
    const key = `uploads/avatars/${uploadFilenameBase("user", uploadUserId)}.webp`;
    return {
      direct: true,
      kind,
      bucket: config.cos.bucket,
      region: config.cos.region,
      key,
      uploadPath: `/${key}`,
      maxBytes: AVATAR_UPLOAD_MAX_BYTES,
      contentType: avatarContentType(`source${sourceExtension}`),
      picOperations: avatarWebpPicOperations(key)
    };
  }

  if (kind === "sessionReviewPhoto") {
    const key = `uploads/session-reviews/${uploadFilenameBase("review", uploadUserId)}${sourceExtension}`;
    return {
      direct: true,
      kind,
      bucket: config.cos.bucket,
      region: config.cos.region,
      key,
      uploadPath: `/${key}`,
      maxBytes: SESSION_REVIEW_UPLOAD_MAX_BYTES,
      contentType: avatarContentType(key)
    };
  }

  if (kind === "sessionAlbumPhoto" || kind === "adminSessionAlbumPhoto") {
    const isAdminAlbumUpload = kind === "adminSessionAlbumPhoto";
    const session = isAdminAlbumUpload
      ? await assertAdminOwnSessionAlbumAllowed(user, sessionId)
      : await assertSessionAlbumUploadAllowed(user, sessionId);
    assertContentModerationIntake(config.contentModeration, "image");
    const filenamePrefix = isAdminAlbumUpload ? `admin-album-${session.id}` : `album-${session.id}`;
    const key = `uploads/session-album/display/${uploadFilenameBase(
      filenamePrefix,
      uploadUserId
    )}.jpg`;
    return {
      direct: true,
      kind,
      sessionId: Number(session.id),
      bucket: config.cos.bucket,
      region: config.cos.region,
      key,
      uploadPath: `/${key}`,
      maxBytes: SESSION_ALBUM_UPLOAD_MAX_BYTES,
      contentType: avatarContentType(`source${sourceExtension}`),
      picOperations: sessionAlbumDisplayJpgPicOperations(key)
    };
  }

  throw badRequest("unsupported upload kind");
}

function normalizeCosHeaders(headers = {}) {
  return Object.fromEntries(
    Object.entries(headers || {})
      .filter(([, value]) => value !== undefined && value !== null && value !== "")
      .map(([name, value]) => [String(name).toLowerCase(), String(value)])
  );
}

export function validateAlbumVideoCosUploadHeaders(headers = {}) {
  const normalized = normalizeCosHeaders(headers);
  if (normalized["x-cos-forbid-overwrite"] !== "true") {
    throw forbidden("album video upload must forbid object overwrite");
  }
  validateCosAlbumVideoHeaders({
    contentLength: normalized["content-length"],
    contentType: normalized["content-type"]
  });
  return normalized;
}

export function sanitizeCosDirectUploadHeaders({
  directUpload,
  key,
  headers = {},
  cosConfig = config.cos
} = {}) {
  const normalized = normalizeCosHeaders(headers);
  const allowed = new Set(["host", "content-type", "content-length"]);
  if (
    directUpload?.kind === "avatar" ||
    directUpload?.kind === "sessionAlbumPhoto" ||
    directUpload?.kind === "adminSessionAlbumPhoto"
  ) {
    allowed.add("pic-operations");
  }
  if (directUpload?.kind === "adminSessionAlbumVideo") {
    allowed.add("x-cos-forbid-overwrite");
  }
  for (const name of Object.keys(normalized)) {
    if (!allowed.has(name)) {
      throw forbidden(`unsupported COS upload header: ${name}`);
    }
  }

  const safeHeaders = Object.fromEntries(
    Object.entries(normalized).filter(([name]) => name !== "host")
  );
  safeHeaders.host = cosHost(cosConfig);
  if (directUpload?.kind === "adminSessionAlbumVideo") {
    validateAlbumVideoCosUploadHeaders(safeHeaders);
  }
  if (
    directUpload?.kind === "avatar" &&
    safeHeaders["pic-operations"] !== avatarWebpPicOperations(key)
  ) {
    throw forbidden("avatar upload must include the server-issued WebP processing rule");
  }
  if (
    (directUpload?.kind === "sessionAlbumPhoto" ||
      directUpload?.kind === "adminSessionAlbumPhoto") &&
    safeHeaders["pic-operations"] !== sessionAlbumDisplayJpgPicOperations(key)
  ) {
    throw forbidden("album upload must include the server-issued JPG processing rule");
  }
  return safeHeaders;
}

function directUploadKindForKey(key, userId) {
  const userIdText = String(userId);
  const avatarPattern = new RegExp(
    `^uploads/avatars/user-${userIdText}-\\d+-[a-f0-9]{16}\\.webp$`
  );
  if (avatarPattern.test(key)) {
    return { kind: "avatar" };
  }

  const reviewPattern = new RegExp(
    `^uploads/session-reviews/review-${userIdText}-\\d+-[a-f0-9]{16}\\.(?:jpg|jpeg|png)$`
  );
  if (reviewPattern.test(key)) {
    return { kind: "sessionReviewPhoto" };
  }

  const albumMatch = key.match(
    new RegExp(
      `^uploads/session-album/display/album-(\\d+)-${userIdText}-\\d+-[a-f0-9]{16}\\.jpg$`
    )
  );
  if (albumMatch) {
    return { kind: "sessionAlbumPhoto", sessionId: Number(albumMatch[1]) };
  }

  const adminAlbumMatch = key.match(
    new RegExp(
      `^uploads/session-album/display/admin-album-(\\d+)-${userIdText}-\\d+-[a-f0-9]{16}\\.jpg$`
    )
  );
  if (adminAlbumMatch) {
    return { kind: "adminSessionAlbumPhoto", sessionId: Number(adminAlbumMatch[1]) };
  }

  const adminAlbumVideoMatch = key.match(
    new RegExp(
      `^uploads/session-album/videos/source/admin-video-(\\d+)-${userIdText}-\\d+-[a-f0-9]{16}\\.mp4$`
    )
  );
  if (adminAlbumVideoMatch) {
    return { kind: "adminSessionAlbumVideo", sessionId: Number(adminAlbumVideoMatch[1]) };
  }

  throw forbidden("upload object key is not allowed");
}

async function authorizeCosDirectUpload({ body, user }) {
  if (!isCosUploadStorageEnabled()) {
    throw badRequest("COS storage is not enabled");
  }

  const userId = user.user.id;
  const bucket = String(body.bucket || body.Bucket || "");
  const region = String(body.region || body.Region || "");
  const method = String(body.method || body.Method || "").toUpperCase();
  const key = String(body.key || body.Key || "");

  if (bucket !== config.cos.bucket || region !== config.cos.region) {
    throw forbidden("COS bucket or region is not allowed");
  }
  if (method !== "PUT") {
    throw badRequest("only COS PUT uploads can be signed");
  }

  const directUpload = directUploadKindForKey(key, userId);
  const headers = sanitizeCosDirectUploadHeaders({
    directUpload,
    key,
    headers: body.headers || body.Headers,
    cosConfig: config.cos
  });
  if (directUpload.kind === "sessionAlbumPhoto") {
    await assertSessionAlbumUploadAllowed(
      { user: { id: userId }, roles: [] },
      directUpload.sessionId
    );
    assertContentModerationIntake(config.contentModeration, "image");
  }
  if (directUpload.kind === "adminSessionAlbumPhoto") {
    await assertAdminOwnSessionAlbumAllowed(user, directUpload.sessionId);
    assertContentModerationIntake(config.contentModeration, "image");
  }
  if (directUpload.kind === "adminSessionAlbumVideo") {
    requireRole(user, "system_admin");
    await assertSessionAlbumUploadAllowed(user, directUpload.sessionId);
    assertContentModerationIntake(config.contentModeration, "video");
  }
  return {
    authorization: buildCosAuthorization({
      method,
      key,
      headers,
      config: config.cos
    })
  };
}

async function saveUploadedObject({
  key,
  filename,
  file,
  contentType,
  localDir,
  picOperations,
  forbidOverwrite = false
}) {
  if (isCosUploadStorageEnabled()) {
    await putCosObject({
      key,
      body: file,
      contentType,
      picOperations,
      forbidOverwrite,
      config: config.cos
    });
    return `/${key}`;
  }

  await fs.mkdir(localDir, { recursive: true });
  await fs.writeFile(path.join(localDir, filename), file);
  return `/${key}`;
}

async function saveUploadedAvatar(request, userId) {
  const contentType = request.headers["content-type"] || "";
  const isMultipart = contentType.includes("multipart/form-data");
  const body = await readRawBody(
    request,
    isMultipart ? AVATAR_MULTIPART_MAX_BYTES : AVATAR_UPLOAD_MAX_BYTES
  );
  const { extension, file, mimeType } = isMultipart
    ? parseMultipartAvatarUpload(contentType, body)
    : parseRawAvatarUpload(contentType, body);
  const avatarFilenameBase = uploadFilenameBase("user", userId);
  const originalAvatarFilename = `${avatarFilenameBase}${extension}`;
  const avatarFilename = isCosUploadStorageEnabled()
    ? `${avatarFilenameBase}.webp`
    : originalAvatarFilename;
  const key = `uploads/avatars/${avatarFilename}`;
  return saveUploadedObject({
    key,
    filename: avatarFilename,
    file,
    contentType: mimeType || avatarContentType(originalAvatarFilename),
    picOperations: isCosUploadStorageEnabled() ? avatarWebpPicOperations(key) : "",
    localDir: avatarUploadDir
  });
}

async function saveUploadedSessionReviewPhoto(request, userId) {
  const contentType = request.headers["content-type"] || "";
  if (!contentType.includes("multipart/form-data")) {
    throw badRequest("review photo upload must be multipart/form-data");
  }

  const body = await readRawBody(request, SESSION_REVIEW_MULTIPART_MAX_BYTES);
  const { extension, file, mimeType } = parseMultipartImageUpload(contentType, body, {
    fieldName: "photo",
    maxBytes: SESSION_REVIEW_UPLOAD_MAX_BYTES,
    label: "review photo"
  });
  const photoFilename = `${uploadFilenameBase("review", userId)}${extension}`;
  return saveUploadedObject({
    key: `uploads/session-reviews/${photoFilename}`,
    filename: photoFilename,
    file,
    contentType: mimeType || avatarContentType(photoFilename),
    localDir: sessionReviewUploadDir
  });
}

async function processSessionAlbumDisplayJpg(file) {
  const { data, info } = await sharp(file, { failOn: "none" })
    .rotate()
    .resize({
      width: 2048,
      height: 2048,
      fit: "inside",
      withoutEnlargement: true
    })
    .jpeg({
      quality: 85,
      mozjpeg: true
    })
    .toBuffer({ resolveWithObject: true });
  return {
    file: data,
    width: info.width,
    height: info.height,
    byteSize: data.length,
    contentType: "image/jpeg"
  };
}

async function saveUploadedSessionAlbumPhoto(request, userId, sessionId, options = {}) {
  const contentType = request.headers["content-type"] || "";
  if (!contentType.includes("multipart/form-data")) {
    throw badRequest("album photo upload must be multipart/form-data");
  }

  const body = await readRawBody(request, SESSION_ALBUM_MULTIPART_MAX_BYTES);
  const { extension, file, mimeType } = parseMultipartImageUpload(contentType, body, {
    fieldName: "photo",
    maxBytes: SESSION_ALBUM_UPLOAD_MAX_BYTES,
    label: "album photo"
  });
  const filenamePrefix = options.filenamePrefix || `album-${sessionId}`;
  const photoFilename = `${uploadFilenameBase(filenamePrefix, userId)}.jpg`;
  const key = `uploads/session-album/display/${photoFilename}`;

  if (isCosUploadStorageEnabled()) {
    return saveUploadedObject({
      key,
      filename: photoFilename,
      file,
      contentType: mimeType || avatarContentType(`source${extension}`),
      picOperations: sessionAlbumDisplayJpgPicOperations(key),
      localDir: sessionAlbumDisplayUploadDir
    });
  }

  const display = await processSessionAlbumDisplayJpg(file);
  return saveUploadedObject({
    key,
    filename: photoFilename,
    file: display.file,
    contentType: display.contentType,
    localDir: sessionAlbumDisplayUploadDir
  });
}

async function saveUploadedSessionAlbumVideo(request, userId, sessionId) {
  const contentType = request.headers["content-type"] || "";
  if (!contentType.includes("multipart/form-data")) {
    throw badRequest("album video upload must be multipart/form-data");
  }

  const upload = await parseMultipartAlbumVideoStream({
    request,
    contentType,
    tempDir: sessionAlbumVideoSourceUploadDir,
    maxFileBytes: SESSION_ALBUM_VIDEO_UPLOAD_MAX_BYTES,
    maxRequestBytes: SESSION_ALBUM_VIDEO_MULTIPART_MAX_BYTES
  });
  try {
    const videoFilename = `${uploadFilenameBase(`admin-video-${sessionId}`, userId)}.mp4`;
    const key = `uploads/session-album/videos/source/${videoFilename}`;
    if (isCosUploadStorageEnabled()) {
      await uploadTempAlbumVideoToCos({
        tempPath: upload.tempPath,
        key,
        byteSize: upload.byteSize,
        contentType: upload.contentType,
        config: config.cos
      });
    } else {
      await finalizeLocalAlbumVideoUpload({
        tempPath: upload.tempPath,
        destinationPath: path.join(sessionAlbumVideoSourceUploadDir, videoFilename)
      });
    }
    return `/${key}`;
  } finally {
    await upload.cleanup();
  }
}

function sessionAlbumMediaSignature(photoId, expires) {
  return crypto
    .createHmac("sha256", config.sessionSecret)
    .update(`${photoId}:${expires}`)
    .digest("hex");
}

function sessionAlbumMediaPath(photoId, variant = "preview") {
  const expires = Math.floor(Date.now() / 1000) + SESSION_ALBUM_MEDIA_TOKEN_SECONDS;
  const signature = sessionAlbumMediaSignature(photoId, expires);
  const path = `/api/session-album/photos/${photoId}/image?expires=${encodeURIComponent(
    expires
  )}&signature=${encodeURIComponent(signature)}`;
  return variant === "thumbnail" ? `${path}&variant=thumbnail` : path;
}

function attachAlbumImageUrls(photo, legacyUrls, options) {
  const {
    storage_object_key: objectKey,
    storage_object_etag: ignoredEtag,
    photo_url: ignoredPhotoUrl,
    source_url: ignoredSourceUrl,
    display_url: ignoredDisplayUrl,
    cover_url: ignoredCoverUrl,
    object_key: ignoredObjectKey,
    object_etag: ignoredObjectEtag,
    ...safePhoto
  } = photo;
  void ignoredEtag;
  void ignoredPhotoUrl;
  void ignoredSourceUrl;
  void ignoredDisplayUrl;
  void ignoredCoverUrl;
  void ignoredObjectKey;
  void ignoredObjectEtag;
  const moderationStatus = String(photo.moderation_status || "");
  if (!isModerationPublished(moderationStatus)) {
    return {
      ...safePhoto,
      moderation_status: moderationStatus,
      moderation_message: moderationStatus === "review"
        ? "内容需要进一步审核"
        : moderationStatus === "rejected"
          ? "内容未通过安全审核，如有疑问请联系客服"
          : "内容正在审核",
      image_url: null,
      preview_url: null,
      thumbnail_url: null,
      preview_load_url: null,
      thumbnail_load_url: null,
      preview_display_url: null,
      thumbnail_display_url: null,
      download_url: null,
      media_url_expires_at: null
    };
  }
  const signed = options.directMediaUrls && objectKey && cosStorageEnabled(options.cosConfig)
    ? options.buildUrls({
        objectKey,
        mediaId: photo.id,
        nowSeconds: options.nowSeconds,
        config: options.cosConfig
      })
    : {
        thumbnail_display_url: legacyUrls.thumbnail,
        preview_display_url: legacyUrls.preview,
        download_url: legacyUrls.preview,
        media_url_expires_at: null
      };
  return {
    ...safePhoto,
    image_url: legacyUrls.preview,
    preview_url: legacyUrls.preview,
    thumbnail_url: legacyUrls.thumbnail,
    preview_load_url: legacyUrls.previewLoad || legacyUrls.preview,
    thumbnail_load_url: legacyUrls.thumbnailLoad || legacyUrls.thumbnail,
    ...signed
  };
}

function albumImageUrlOptions(options = {}) {
  return {
    directMediaUrls: options.directMediaUrls ?? config.albumMedia.directMediaUrls,
    nowSeconds: options.nowSeconds ?? Math.floor(Date.now() / 1000),
    cosConfig: options.cosConfig || config.cos,
    buildUrls: options.buildUrls || buildAlbumImageUrls
  };
}

function attachLegacyFinalizedAlbumImageUrls(finalized, options = {}) {
  const resolved = albumImageUrlOptions(options);
  if (!isModerationPublished(finalized.photo.moderation_status)) {
    return {
      uploadId: finalized.uploadId,
      photo: attachAlbumImageUrls(finalized.photo, {}, resolved)
    };
  }
  const preview = sessionAlbumMediaPath(finalized.photo.id, "preview");
  const thumbnail = sessionAlbumMediaPath(finalized.photo.id, "thumbnail");
  return {
    uploadId: finalized.uploadId,
    photo: attachAlbumImageUrls(finalized.photo, { preview, thumbnail }, resolved)
  };
}

function sessionAlbumVideoUrlPath(mediaId) {
  return `/api/session-album/media/${mediaId}/video-url`;
}

function sessionAlbumVideoCoverPath(mediaId) {
  const expires = Math.floor(Date.now() / 1000) + SESSION_ALBUM_MEDIA_TOKEN_SECONDS;
  const signature = sessionAlbumMediaSignature(mediaId, expires);
  return `/api/session-album/media/${mediaId}/cover?expires=${encodeURIComponent(
    expires
  )}&signature=${encodeURIComponent(signature)}`;
}

function sessionAlbumVideoFilePath(media, userId) {
  const token = signSignedPayload("session-album-video-file", {
    sessionId: tokenPositiveInteger(media.session_id, "sessionId"),
    userId: tokenPositiveInteger(userId, "userId"),
    mediaId: tokenPositiveInteger(media.id, "mediaId"),
    exp: Math.floor(Date.now() / 1000) + SESSION_ALBUM_MEDIA_TOKEN_SECONDS
  });
  return `/api/session-album/media/${media.id}/video-file?token=${encodeURIComponent(token)}`;
}

function verifySessionAlbumVideoFileQuery(mediaId, query) {
  const payload = verifySignedPayload(
    "session-album-video-file",
    query.get("token") || "",
    "album video token"
  );
  const tokenMediaId = tokenPositiveInteger(payload.mediaId, "mediaId");
  if (tokenMediaId !== Number(mediaId)) {
    throw forbidden("album video token is invalid");
  }
  const exp = tokenPositiveInteger(payload.exp, "exp");
  if (exp < Math.floor(Date.now() / 1000)) {
    throw forbidden("album video token expired");
  }
  return {
    sessionId: tokenPositiveInteger(payload.sessionId, "sessionId"),
    userId: tokenPositiveInteger(payload.userId, "userId"),
    mediaId: tokenMediaId,
    exp
  };
}

function encodeCosObjectKey(key) {
  return String(key || "").split("/").map(encodeURIComponent).join("/");
}

const SESSION_ALBUM_VIDEO_SOURCE_PREFIX = "/uploads/session-album/videos/source/";

function albumVideoSourceObjectKey(sourceUrl) {
  try {
    return cosObjectKeyFromUploadPath(sourceUrl, SESSION_ALBUM_VIDEO_SOURCE_PREFIX);
  } catch {
    throw badRequest("sourceUrl must contain an uploaded session album video");
  }
}

export function createSessionAlbumVideoStorageAdapter(options = {}) {
  const cosEnabled = options.cosEnabled ?? isCosUploadStorageEnabled();
  const cosConfig = options.cosConfig || config.cos;
  const headObject = options.headObject || headCosObject;
  const readObjectRange = options.readObjectRange || readCosObjectRange;
  const openFile = options.openFile || fs.open;
  const sourceDir = options.sourceDir || sessionAlbumVideoSourceUploadDir;

  if (!cosEnabled) {
    return {
      inspectObject: async (sourceUrl) => {
        const key = albumVideoSourceObjectKey(sourceUrl);
        const filename = key.slice(SESSION_ALBUM_VIDEO_SOURCE_PREFIX.length - 1);
        return inspectLocalAlbumVideoObject({
          filePath: path.join(sourceDir, filename),
          sourceUrl,
          openFile
        });
      }
    };
  }

  let inspectedKey = "";
  let inspectedEtag = "";
  let inspectedByteSize;
  return {
    getMetadata: async (sourceUrl) => {
      const key = albumVideoSourceObjectKey(sourceUrl);
      const object = await headObject({ key, config: cosConfig });
      const etag = String(object.headers?.etag || "").trim();
      if (!etag) {
        throw new AppError(
          502,
          "COS_OBJECT_VERSION_MISSING",
          "COS album video HEAD response did not include an ETag"
        );
      }
      const metadata = validateCosAlbumVideoHeaders({
        contentLength: object.headers?.["content-length"],
        contentType: object.headers?.["content-type"]
      });
      inspectedKey = key;
      inspectedEtag = etag;
      inspectedByteSize = metadata.byteSize;
      return { ...metadata, etag };
    },
    readRange: async (sourceUrl, start, end) => {
      const key = albumVideoSourceObjectKey(sourceUrl);
      if (!inspectedEtag || key !== inspectedKey) {
        throw new AppError(
          502,
          "COS_OBJECT_VERSION_MISSING",
          "COS album video object version was not established before reading"
        );
      }
      return readObjectRange({
        key,
        start,
        end,
        ifMatch: inspectedEtag,
        expectedByteSize: inspectedByteSize,
        config: cosConfig
      });
    }
  };
}

function albumVideoObjectKey(uploadPath) {
  const pathText = String(uploadPath || "");
  const prefixes = [
    "/uploads/session-album/videos/display/",
    "/uploads/session-album/videos/source/"
  ];
  const prefix = prefixes.find((candidate) => pathText.startsWith(candidate));
  if (!prefix) {
    throw notFound("Album video file not found");
  }
  return cosObjectKeyFromUploadPath(pathText, prefix);
}

function signedCosAlbumVideoUrl(media, method = "GET", expiresInSeconds, queryEntries = []) {
  const key = albumVideoObjectKey(media.display_url || media.source_url);
  const host = cosHost(config.cos);
  const entries = cosQueryEntries(queryEntries);
  const authorization = buildCosAuthorization({
    method,
    key,
    headers: { host },
    urlParams: entries,
    ...(Number.isSafeInteger(expiresInSeconds) && expiresInSeconds > 0
      ? { expiresInSeconds }
      : {}),
    config: config.cos
  });
  const dataQuery = renderCosRequestQuery(entries);
  return `https://${host}/${encodeCosObjectKey(key)}?${
    dataQuery ? `${dataQuery}&` : ""
  }${authorization}`;
}

function signedAlbumVideoUrl(media, userId) {
  return sessionAlbumVideoFilePath(media, userId);
}

function albumVideoSnapshotObjectKey(media) {
  return albumVideoObjectKey(media.video_cover_source_url || media.display_url || media.source_url);
}

function snapshotQueryString() {
  return new URLSearchParams(SESSION_ALBUM_VIDEO_SNAPSHOT_PARAMS).toString();
}

function signedAlbumVideoSnapshotUrl(media, userId) {
  void userId;
  if (!isCosUploadStorageEnabled()) {
    return "";
  }
  if (!media.video_cover_source_url && !media.display_url && !media.source_url) {
    return "";
  }
  const snapshotQuery = snapshotQueryString();
  const key = albumVideoSnapshotObjectKey(media);
  const host = cosHost(config.cos);
  const authorization = buildCosAuthorization({
    method: "GET",
    key,
    headers: { host },
    urlParams: SESSION_ALBUM_VIDEO_SNAPSHOT_PARAMS,
    config: config.cos
  });
  return `https://${host}/${encodeCosObjectKey(key)}?${snapshotQuery}&${authorization}`;
}

function signedPublicAlbumVideoSnapshotUrl(media, claims, albumShareToken) {
  void claims;
  void albumShareToken;
  if (!isCosUploadStorageEnabled()) {
    return "";
  }
  if (!media.video_cover_source_url && !media.display_url && !media.source_url) {
    return "";
  }
  const snapshotQuery = snapshotQueryString();
  const key = albumVideoSnapshotObjectKey(media);
  const host = cosHost(config.cos);
  const authorization = buildCosAuthorization({
    method: "GET",
    key,
    headers: { host },
    urlParams: SESSION_ALBUM_VIDEO_SNAPSHOT_PARAMS,
    config: config.cos
  });
  return `https://${host}/${encodeCosObjectKey(key)}?${snapshotQuery}&${authorization}`;
}

function stripAlbumVideoInternalFields(photo) {
  const {
    video_cover_source_url,
    photo_url,
    source_url,
    display_url,
    cover_url,
    object_key,
    object_etag,
    storage_object_key,
    storage_object_etag,
    ...safePhoto
  } = photo;
  void video_cover_source_url;
  void photo_url;
  void source_url;
  void display_url;
  void cover_url;
  void object_key;
  void object_etag;
  void storage_object_key;
  void storage_object_etag;
  return safePhoto;
}

function mediaVariant(query) {
  const variant = query.get("variant") || "preview";
  if (variant === "thumbnail") {
    return "thumbnail";
  }
  if (variant === "preview") {
    return "preview";
  }
  throw badRequest("unsupported album media variant");
}

function verifySessionAlbumMediaQuery(photoId, query) {
  const expires = Number.parseInt(query.get("expires") || "", 10);
  const signature = query.get("signature") || "";
  if (!expires || !signature) {
    throw forbidden("album media token is required");
  }
  if (expires < Math.floor(Date.now() / 1000)) {
    throw forbidden("album media token expired");
  }
  const expected = sessionAlbumMediaSignature(photoId, expires);
  const signatureBuffer = Buffer.from(signature, "hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  if (
    signatureBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)
  ) {
    throw forbidden("album media token is invalid");
  }
}

function signSessionAlbumDirectMediaToken(payload) {
  const exp = payload.exp ||
    Math.floor(Date.now() / 1000) + SESSION_ALBUM_MEDIA_TOKEN_SECONDS;
  return signSignedPayload("session-album-media", {
    sessionId: tokenPositiveInteger(payload.sessionId, "sessionId"),
    userId: tokenPositiveInteger(payload.userId, "userId"),
    photoId: tokenPositiveInteger(payload.photoId, "photoId"),
    variant: mediaVariantName(payload.variant || "preview"),
    exp: tokenPositiveInteger(exp, "exp")
  });
}

function sessionAlbumDirectMediaPath(photoId, album, userId, variant = "preview") {
  const normalizedVariant = mediaVariantName(variant);
  const token = signSessionAlbumDirectMediaToken({
    sessionId: album.session_id,
    userId,
    photoId,
    variant: normalizedVariant
  });
  return `/api/session-album/photos/${photoId}/image?token=${encodeURIComponent(
    token
  )}&variant=${encodeURIComponent(normalizedVariant)}`;
}

function verifySessionAlbumDirectMediaQuery(photoId, query) {
  const payload = verifySignedPayload(
    "session-album-media",
    query.get("token") || "",
    "album media token"
  );
  const tokenPhotoId = tokenPositiveInteger(payload.photoId, "photoId");
  if (tokenPhotoId !== Number(photoId)) {
    throw forbidden("album media token is invalid");
  }
  return {
    sessionId: tokenPositiveInteger(payload.sessionId, "sessionId"),
    userId: tokenPositiveInteger(payload.userId, "userId"),
    photoId: tokenPhotoId,
    variant: mediaVariantName(payload.variant || "preview"),
    exp: tokenPositiveInteger(payload.exp, "exp")
  };
}

function mediaVariantName(variant) {
  if (variant === "thumbnail") {
    return "thumbnail";
  }
  if (variant === "preview") {
    return "preview";
  }
  throw badRequest("unsupported album media variant");
}

export function attachSessionAlbumMediaUrls(album, userId, options = {}) {
  const resolved = albumImageUrlOptions(options);
  let signedImageCount = 0;
  const photos = album.photos.map((photo) => {
      if (photo.media_type === "video") {
        const safePhoto = stripAlbumVideoInternalFields(photo);
        const approved = isModerationPublished(photo.moderation_status);
        return {
          ...safePhoto,
          cover_url: approved && photo.has_cover ? signedAlbumVideoSnapshotUrl(photo, userId) : "",
          video_url: approved && photo.processing_status === "ready"
            ? sessionAlbumVideoUrlPath(photo.id)
            : ""
        };
      }
      if (!isModerationPublished(photo.moderation_status)) {
        return attachAlbumImageUrls(photo, {}, resolved);
      }
      const preview = sessionAlbumMediaPath(photo.id, "preview");
      const thumbnail = sessionAlbumMediaPath(photo.id, "thumbnail");
      const willSign = resolved.directMediaUrls && photo.storage_object_key &&
        cosStorageEnabled(resolved.cosConfig);
      if (willSign) signedImageCount += 1;
      return attachAlbumImageUrls(photo, {
        preview,
        thumbnail,
        previewLoad: sessionAlbumDirectMediaPath(photo.id, album, userId, "preview"),
        thumbnailLoad: sessionAlbumDirectMediaPath(photo.id, album, userId, "thumbnail")
      }, resolved);
    });
  (options.emit || emitAlbumImageEvent)("media_urls_signed", {
    sessionId: Number(album.session_id),
    outcome: options.routeKind || "member",
    signedImageCount
  });
  return {
    ...album,
    photos,
    media: photos
  };
}

function signedPayloadSignature(purpose, payloadText) {
  return crypto
    .createHmac("sha256", config.sessionSecret)
    .update(`${purpose}:${payloadText}`)
    .digest("hex");
}

function tokenPositiveInteger(value, label) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw forbidden(`${label} is invalid`);
  }
  return parsed;
}

function signSignedPayload(purpose, payload) {
  const payloadText = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = signedPayloadSignature(purpose, payloadText);
  return `${payloadText}.${signature}`;
}

function verifySignedPayload(purpose, token, label) {
  const [payloadText, signature, extra] = String(token || "").split(".");
  if (!payloadText || !signature || extra !== undefined) {
    throw forbidden(`${label} is required`);
  }

  const expected = signedPayloadSignature(purpose, payloadText);
  const signatureBuffer = Buffer.from(signature, "hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  if (
    signatureBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)
  ) {
    throw forbidden(`${label} is invalid`);
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(payloadText, "base64url").toString("utf8"));
  } catch (error) {
    throw forbidden(`${label} is invalid`);
  }
  if (tokenPositiveInteger(payload.exp, "exp") < Math.floor(Date.now() / 1000)) {
    throw forbidden(`${label} expired`);
  }
  return payload;
}

function normalizeSessionAlbumShareClaims(payload) {
  return {
    sessionId: tokenPositiveInteger(payload.sessionId, "sessionId"),
    sharerUserId: tokenPositiveInteger(payload.sharerUserId, "sharerUserId"),
    seatId: tokenPositiveInteger(payload.seatId, "seatId"),
    exp: tokenPositiveInteger(payload.exp, "exp")
  };
}

function signSessionAlbumShareToken(payload) {
  const exp = payload.exp ||
    Math.floor(Date.now() / 1000) + SESSION_ALBUM_SHARE_TOKEN_SECONDS;
  return signSignedPayload(
    "session-album-share",
    normalizeSessionAlbumShareClaims({ ...payload, exp })
  );
}

function verifySessionAlbumShareToken(token) {
  return normalizeSessionAlbumShareClaims(
    verifySignedPayload("session-album-share", token, "album share token")
  );
}

function normalizeSessionJoinInviteClaims(payload) {
  if (payload.purpose !== "session_join_invite") {
    throw forbidden("session join invite token is invalid");
  }
  return {
    purpose: "session_join_invite",
    sessionId: tokenPositiveInteger(payload.sessionId, "sessionId"),
    inviterUserId: tokenPositiveInteger(payload.inviterUserId, "inviterUserId"),
    exp: tokenPositiveInteger(payload.exp, "exp")
  };
}

function signSessionJoinInviteToken(payload) {
  const exp = payload.exp || Math.floor(Date.now() / 1000) + SESSION_JOIN_INVITE_TOKEN_SECONDS;
  return signSignedPayload(
    "session-join-invite",
    normalizeSessionJoinInviteClaims({
      ...payload,
      purpose: "session_join_invite",
      exp
    })
  );
}

function verifySessionJoinInviteToken(token) {
  return normalizeSessionJoinInviteClaims(
    verifySignedPayload("session-join-invite", token, "session join invite token")
  );
}

function sessionAlbumTokenDigest(token) {
  return crypto
    .createHash("sha256")
    .update(String(token || ""))
    .digest("hex");
}

function signSessionAlbumPublicMediaToken(payload) {
  const exp = payload.exp ||
    Math.floor(Date.now() / 1000) + SESSION_ALBUM_PUBLIC_MEDIA_TOKEN_SECONDS;
  return signSignedPayload("session-album-public-media", {
    sessionId: tokenPositiveInteger(payload.sessionId, "sessionId"),
    sharerUserId: tokenPositiveInteger(payload.sharerUserId, "sharerUserId"),
    seatId: tokenPositiveInteger(payload.seatId, "seatId"),
    photoId: tokenPositiveInteger(payload.photoId, "photoId"),
    shareTokenDigest: String(payload.shareTokenDigest || ""),
    exp: tokenPositiveInteger(exp, "exp")
  });
}

function sessionAlbumPublicMediaPath(
  photoId,
  claims,
  albumShareToken,
  variant = "preview"
) {
  const token = signSessionAlbumPublicMediaToken({
    ...claims,
    photoId,
    shareTokenDigest: sessionAlbumTokenDigest(albumShareToken)
  });
  const path = `/api/session-album/public-share/photos/${photoId}/image?token=${encodeURIComponent(
    token
  )}`;
  return variant === "thumbnail" ? `${path}&variant=thumbnail` : path;
}

function sessionAlbumPublicVideoCoverPath(mediaId, claims, albumShareToken) {
  const token = signSessionAlbumPublicMediaToken({
    ...claims,
    photoId: mediaId,
    shareTokenDigest: sessionAlbumTokenDigest(albumShareToken)
  });
  return `/api/session-album/public-share/media/${mediaId}/cover?token=${encodeURIComponent(
    token
  )}`;
}

function verifySessionAlbumPublicMediaQuery(photoId, query) {
  const payload = verifySignedPayload(
    "session-album-public-media",
    query.get("token") || "",
    "album public media token"
  );
  const tokenPhotoId = tokenPositiveInteger(payload.photoId, "photoId");
  if (tokenPhotoId !== Number(photoId)) {
    throw forbidden("album public media token is invalid");
  }
  if (!payload.shareTokenDigest) {
    throw forbidden("album public media token is invalid");
  }
  return normalizeSessionAlbumShareClaims(payload);
}

export function attachPublicSessionAlbumMediaUrls(
  album,
  claims,
  albumShareToken,
  options = {}
) {
  const resolved = albumImageUrlOptions(options);
  let signedImageCount = 0;
  const photos = album.photos.map((photo) => {
      if (photo.media_type === "video") {
        const safePhoto = stripAlbumVideoInternalFields(photo);
        const approved = isModerationPublished(photo.moderation_status);
        return {
          ...safePhoto,
          cover_url: approved && photo.has_cover
            ? signedPublicAlbumVideoSnapshotUrl(photo, claims, albumShareToken)
            : ""
        };
      }
      if (!isModerationPublished(photo.moderation_status)) {
        return attachAlbumImageUrls(photo, {}, resolved);
      }
      const preview = sessionAlbumPublicMediaPath(photo.id, claims, albumShareToken, "preview");
      const thumbnail = sessionAlbumPublicMediaPath(photo.id, claims, albumShareToken, "thumbnail");
      const willSign = resolved.directMediaUrls && photo.storage_object_key &&
        cosStorageEnabled(resolved.cosConfig);
      if (willSign) signedImageCount += 1;
      return attachAlbumImageUrls(photo, { preview, thumbnail }, resolved);
    });
  (options.emit || emitAlbumImageEvent)("media_urls_signed", {
    sessionId: Number(album.session_id), outcome: "public-share", signedImageCount
  });
  return {
    ...album,
    photos,
    media: photos
  };
}

async function sessionAlbumThumbnailBuffer(file) {
  return sharp(file, { failOn: "none" })
    .rotate()
    .resize({
      width: 640,
      height: 640,
      fit: "inside",
      withoutEnlargement: true
    })
    .jpeg({ quality: 75 })
    .toBuffer();
}

async function serveLocalUploadedObject({ filePath, filename, response, cacheControl, ciProcess }) {
  let file;
  try {
    file = await fs.readFile(filePath);
  } catch (error) {
    throw notFound();
  }
  const isSessionAlbumThumbnail = ciProcess === SESSION_ALBUM_THUMBNAIL_RULE;
  if (isSessionAlbumThumbnail) {
    file = await sessionAlbumThumbnailBuffer(file);
    filename = "album-thumbnail.jpg";
  }

  response.writeHead(200, {
    "cache-control": cacheControl || "public, max-age=31536000, immutable",
    "content-length": file.length,
    "content-type": uploadedObjectContentType(filename)
  });
  response.end(file);
  return file.length;
}

async function serveCosUploadedObject({ key, filename, response, cacheControl, ciProcess }) {
  const object = await getCosObject({
    key,
    ciProcess,
    config: config.cos
  });

  response.writeHead(200, {
    "cache-control": cacheControl || "public, max-age=31536000, immutable",
    "content-length": object.body.length,
    "content-type": uploadedObjectContentType(filename, object.headers["content-type"])
  });
  response.end(object.body);
  return object.body.length;
}

async function serveUploadedObject({ url, prefix, localDir, response, cacheControl, ciProcess }) {
  const requestedName = decodeURIComponent(url.pathname.slice(prefix.length));
  const filename = path.basename(requestedName);
  if (!filename || filename !== requestedName || !/^[A-Za-z0-9._-]+$/.test(filename)) {
    throw notFound();
  }

  const key = cosObjectKeyFromUploadPath(`${prefix}${filename}`, prefix);
  if (isCosUploadStorageEnabled()) {
    try {
      return await serveCosUploadedObject({ key, filename, response, cacheControl, ciProcess });
    } catch (error) {
      if (error.statusCode && error.statusCode !== 404) {
        throw new AppError(502, "COS_STORAGE_ERROR", "COS storage request failed", error.body);
      }
    }
  }

  return serveLocalUploadedObject({
    filePath: path.join(localDir, filename),
    filename,
    response,
    cacheControl,
    ciProcess
  });
}

function hasObjectNotFoundStatus(error) {
  return [error?.statusCode, error?.status, error?.httpStatus]
    .some((value) => Number(value) === 404);
}

export async function deleteUploadedObject({
  url,
  prefix,
  localDir,
  cosEnabled = isCosUploadStorageEnabled(),
  cosConfig = config.cos,
  deleteCos = deleteCosObject,
  unlinkFile = fs.unlink,
  strictCosErrors = false
}) {
  const requestedName = decodeURIComponent(url.pathname.slice(prefix.length));
  const filename = path.basename(requestedName);
  if (!filename || filename !== requestedName || !/^[A-Za-z0-9._-]+$/.test(filename)) {
    return;
  }

  const key = cosObjectKeyFromUploadPath(`${prefix}${filename}`, prefix);
  if (cosEnabled) {
    try {
      await deleteCos({ key, config: cosConfig });
      return;
    } catch (error) {
      if (strictCosErrors) {
        // COS can make an already-cleaned object idempotent only when the 404
        // originated from our signed storage client. Every other COS failure
        // remains retryable and must keep the video row as the cleanup anchor.
        if (isTrustedCosStorageError(error) && Number(error.statusCode) === 404) return;
        // cleanupAlbumVideoBeforeDelete intentionally treats generic 404s as
        // idempotent for injected/local adapters. Do not let an untrusted COS
        // 404 reach that generic boundary and finalize the video row.
        if (hasObjectNotFoundStatus(error)) {
          throw new AppError(502, "COS_STORAGE_ERROR", "COS storage request failed");
        }
        throw error;
      }
      // Preserve the established image cleanup behavior: known COS failures
      // are reported, while legacy/unknown failures may still try local files.
      if (error.statusCode && error.statusCode !== 404) {
        throw new AppError(502, "COS_STORAGE_ERROR", "COS storage request failed", error.body);
      }
    }
  }

  try {
    await unlinkFile(path.join(localDir, filename));
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }
}

async function readUploadedObject({ url, prefix, localDir }) {
  const requestedName = decodeURIComponent(url.pathname.slice(prefix.length));
  const filename = path.basename(requestedName);
  if (!filename || filename !== requestedName || !/^[A-Za-z0-9._-]+$/.test(filename)) {
    throw notFound();
  }

  const key = cosObjectKeyFromUploadPath(`${prefix}${filename}`, prefix);
  if (isCosUploadStorageEnabled()) {
    const object = await getCosObject({
      key,
      config: config.cos
    });
    return {
      filename,
      body: object.body,
      contentType: uploadedObjectContentType(filename, object.headers["content-type"])
    };
  }

  try {
    const body = await fs.readFile(path.join(localDir, filename));
    return {
      filename,
      body,
      contentType: uploadedObjectContentType(filename)
    };
  } catch (error) {
    throw notFound();
  }
}

async function deleteUploadedSessionAlbumPhotoObject(photoUrl) {
  const url = new URL(photoUrl, "http://localhost");
  if (url.pathname.startsWith("/uploads/session-album/videos/source/")) {
    await deleteUploadedObject({
      url,
      prefix: "/uploads/session-album/videos/source/",
      localDir: sessionAlbumVideoSourceUploadDir,
      strictCosErrors: true
    });
    return;
  }
  if (url.pathname.startsWith("/uploads/session-album/videos/display/")) {
    await deleteUploadedObject({
      url,
      prefix: "/uploads/session-album/videos/display/",
      localDir: sessionAlbumVideoDisplayUploadDir,
      strictCosErrors: true
    });
    return;
  }
  if (url.pathname.startsWith("/uploads/session-album/videos/cover/")) {
    await deleteUploadedObject({
      url,
      prefix: "/uploads/session-album/videos/cover/",
      localDir: sessionAlbumVideoCoverUploadDir,
      strictCosErrors: true
    });
    return;
  }
  if (url.pathname.startsWith("/uploads/session-album/display/")) {
    await deleteUploadedObject({
      url,
      prefix: "/uploads/session-album/display/",
      localDir: sessionAlbumDisplayUploadDir
    });
    return;
  }
  if (url.pathname.startsWith("/uploads/session-album/")) {
    await deleteUploadedObject({
      url,
      prefix: "/uploads/session-album/",
      localDir: sessionAlbumUploadDir
    });
  }
}

async function cleanupUploadedSessionAlbumPhotoObject(photoUrl) {
  if (!photoUrl) {
    return;
  }
  try {
    await deleteUploadedSessionAlbumPhotoObject(photoUrl);
  } catch (error) {
    console.warn("session album COS cleanup failed", {
      code: error?.code || error?.name || "UNKNOWN",
      statusCode: error?.statusCode || null,
      message: error?.message || String(error),
      path: new URL(photoUrl, "http://localhost").pathname
    });
  }
}

async function cleanupUploadedSessionAlbumMediaObjects(urls = []) {
  for (const url of urls) {
    await cleanupUploadedSessionAlbumPhotoObject(url);
  }
}

async function serveUploadedAvatar(url, response) {
  try {
    await serveUploadedObject({
      url,
      prefix: "/uploads/avatars/",
      localDir: avatarUploadDir,
      response
    });
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    throw notFound();
  }
}

async function serveUploadedSessionReviewPhoto(url, response) {
  try {
    await serveUploadedObject({
      url,
      prefix: "/uploads/session-reviews/",
      localDir: sessionReviewUploadDir,
      response
    });
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    throw notFound();
  }
}

async function serveUploadedSessionAlbumPhoto(photo, response, options = {}) {
  const cacheControl = "private, no-store";
  const ciProcess =
    options.variant === "thumbnail" ? SESSION_ALBUM_THUMBNAIL_RULE : undefined;
  try {
    const photoUrl = new URL(photo.photo_url, "http://localhost");
    if (photoUrl.pathname.startsWith("/uploads/session-album/display/")) {
      const byteCount = await serveUploadedObject({
        url: photoUrl,
        prefix: "/uploads/session-album/display/",
        localDir: sessionAlbumDisplayUploadDir,
        response,
        cacheControl,
        ciProcess
      });
      emitAlbumImageEvent("legacy_proxy_read", {
        sessionId: Number(photo.session_id),
        mediaId: Number(photo.id),
        outcome: "success",
        variant: options.variant || "preview",
        byteCount
      });
      return byteCount;
    }
    const byteCount = await serveUploadedObject({
      url: photoUrl,
      prefix: "/uploads/session-album/",
      localDir: sessionAlbumUploadDir,
      response,
      cacheControl,
      ciProcess
    });
    emitAlbumImageEvent("legacy_proxy_read", {
      sessionId: Number(photo.session_id),
      mediaId: Number(photo.id),
      outcome: "success",
      variant: options.variant || "preview",
      byteCount
    });
    return byteCount;
  } catch (error) {
    emitAlbumImageEvent("legacy_proxy_read", {
      sessionId: Number(photo.session_id),
      mediaId: Number(photo.id),
      outcome: "failure",
      variant: options.variant || "preview",
      errorCode: error?.code || "LEGACY_PROXY_READ_FAILED"
    });
    if (error instanceof AppError) {
      throw error;
    }
    throw notFound();
  }
}

async function serveUploadedSessionAlbumVideoCover(media, response) {
  if (!media.cover_url) {
    throw notFound("Album video cover not found");
  }
  const cacheControl = "private, no-store";
  try {
    const coverUrl = new URL(media.cover_url, "http://localhost");
    await serveUploadedObject({
      url: coverUrl,
      prefix: "/uploads/session-album/videos/cover/",
      localDir: sessionAlbumVideoCoverUploadDir,
      response,
      cacheControl
    });
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    throw notFound();
  }
}

function localAlbumVideoFilePath(videoPath, options = {}) {
  const prefixes = [
    [
      "/uploads/session-album/videos/display/",
      options.displayDir || sessionAlbumVideoDisplayUploadDir
    ],
    [SESSION_ALBUM_VIDEO_SOURCE_PREFIX, options.sourceDir || sessionAlbumVideoSourceUploadDir]
  ];
  for (const [prefix, localDir] of prefixes) {
    if (!String(videoPath).startsWith(prefix)) continue;
    try {
      const key = cosObjectKeyFromUploadPath(videoPath, prefix);
      const filename = key.slice(prefix.length - 1);
      return path.join(localDir, filename);
    } catch {
      throw notFound("Album video file not found");
    }
  }
  throw notFound("Album video file not found");
}

export async function serveUploadedSessionAlbumVideoFile(media, response, options = {}) {
  const videoPath = media.display_url || media.source_url;
  if (!videoPath) {
    throw notFound("Album video file not found");
  }
  const cacheControl = "private, no-store";
  const method = String(options.method || "GET").toUpperCase();
  const range = options.range;
  const cosEnabled = options.cosEnabled ?? isCosUploadStorageEnabled();
  if (cosEnabled) {
    if (method === "HEAD") {
      const headObject = options.headObject || headCosObject;
      const object = await headObject({
        key: albumVideoObjectKey(videoPath),
        config: options.cosConfig || config.cos
      });
      const metadata = validateCosAlbumVideoHeaders({
        contentLength: object.headers?.["content-length"],
        contentType: object.headers?.["content-type"]
      });
      if (!Number.isSafeInteger(metadata.byteSize) || !metadata.contentType) {
        throw new AppError(
          502,
          "COS_VIDEO_METADATA_MISSING",
          "COS album video HEAD response is missing playback metadata"
        );
      }
      response.writeHead(200, {
        "content-type": metadata.contentType,
        "content-length": metadata.byteSize,
        "accept-ranges": "bytes",
        "cache-control": cacheControl
      });
      response.end();
      return;
    }
    response.writeHead(302, {
      "cache-control": cacheControl,
      location: signedCosAlbumVideoUrl(media, method)
    });
    response.end();
    return;
  }
  const localResponse = await createLocalAlbumVideoResponse({
    filePath: localAlbumVideoFilePath(videoPath, options),
    method,
    range
  });
  response.writeHead(localResponse.statusCode, {
    ...localResponse.headers,
    "cache-control": cacheControl
  });
  if (!localResponse.body) {
    response.end();
    return;
  }
  try {
    await pipeline(localResponse.body, response);
  } catch (error) {
    response.destroy(error);
  }
}

async function getSessionAlbumDisplayMetadata(photoUrl) {
  const url = new URL(photoUrl, "http://localhost");
  if (!url.pathname.startsWith("/uploads/session-album/display/")) {
    throw badRequest("album photo must use the display image path");
  }
  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const object = await readUploadedObject({
        url,
        prefix: "/uploads/session-album/display/",
        localDir: sessionAlbumDisplayUploadDir
      });
      const metadata = await sharp(object.body, { failOn: "none" }).metadata();
      if (metadata.format !== "jpeg") {
        throw badRequest("album display photo must be a processed JPEG");
      }
      if (Number(metadata.width || 0) > 2048 || Number(metadata.height || 0) > 2048) {
        throw badRequest("album display photo exceeds the 2048px size limit");
      }
      return {
        imageWidth: metadata.width || null,
        imageHeight: metadata.height || null,
        imageByteSize: object.body.length,
        imageContentType: "image/jpeg"
      };
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 180 * (attempt + 1)));
    }
  }
  throw lastError || notFound("Album display photo not found");
}

function idMatch(pathname, pattern) {
  const match = pathname.match(pattern);
  return match ? Number(match[1]) : null;
}

function stringMatch(pathname, pattern) {
  const match = pathname.match(pattern);
  return match ? match[1] : null;
}

async function getAuthUser(request) {
  const header = request.headers.authorization || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    throw unauthorized();
  }
  return verifyBusinessToken(match[1]);
}

async function optionalAuthUser(request) {
  try {
    return await getAuthUser(request);
  } catch (error) {
    return null;
  }
}

function requireRole(user, role) {
  if (!user.roles.includes(role)) {
    throw forbidden(`${role} role required`);
  }
}

function d40SmokeDatabaseIsIsolated() {
  const host = String(config.mysql.host || "").trim().toLowerCase();
  const localHost = ["127.0.0.1", "localhost", "::1"].includes(host);
  return (
    config.nodeEnv !== "production" &&
    config.wechat.mockLogin === true &&
    process.env.D40_SMOKE_ISOLATED === "1" &&
    localHost &&
    config.mysql.database === "pinche_d40_test"
  );
}

async function route(request, response) {
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);

  if (request.method === "GET" && url.pathname.startsWith("/uploads/avatars/")) {
    await serveUploadedAvatar(url, response);
    return;
  }

  if (request.method === "GET" && url.pathname.startsWith("/uploads/session-reviews/")) {
    await serveUploadedSessionReviewPhoto(url, response);
    return;
  }

  const publicSessionAlbumMediaPhotoId = idMatch(
    url.pathname,
    /^\/api\/session-album\/public-share\/photos\/(\d+)\/image$/
  );
  if (request.method === "GET" && publicSessionAlbumMediaPhotoId) {
    const claims = verifySessionAlbumPublicMediaQuery(
      publicSessionAlbumMediaPhotoId,
      url.searchParams
    );
    const variant = mediaVariant(url.searchParams);
    const photo = await getPublicSessionAlbumPhotoForMedia(
      claims,
      publicSessionAlbumMediaPhotoId
    );
    await serveUploadedSessionAlbumPhoto(photo, response, { variant });
    return;
  }

  const publicSessionAlbumVideoCoverId = idMatch(
    url.pathname,
    /^\/api\/session-album\/public-share\/media\/(\d+)\/cover$/
  );
  if (request.method === "GET" && publicSessionAlbumVideoCoverId) {
    const claims = verifySessionAlbumPublicMediaQuery(
      publicSessionAlbumVideoCoverId,
      url.searchParams
    );
    const media = await getPublicSessionAlbumVideoCoverForMedia(
      claims,
      publicSessionAlbumVideoCoverId
    );
    await serveUploadedSessionAlbumVideoCover(media, response);
    return;
  }

  const sessionAlbumMediaPhotoId = idMatch(
    url.pathname,
    /^\/api\/session-album\/photos\/(\d+)\/image$/
  );
  if (request.method === "GET" && sessionAlbumMediaPhotoId) {
    const variant = mediaVariant(url.searchParams);
    const directMediaToken = url.searchParams.get("token") || "";
    if (directMediaToken) {
      const claims = verifySessionAlbumDirectMediaQuery(
        sessionAlbumMediaPhotoId,
        url.searchParams
      );
      if (claims.variant !== variant) {
        throw forbidden("album media token is invalid");
      }
      const photo = await getVisibleSessionAlbumPhotoForMedia(
        claims.userId,
        sessionAlbumMediaPhotoId
      );
      if (Number(photo.session_id) !== claims.sessionId) {
        throw forbidden("album media token is invalid");
      }
      await serveUploadedSessionAlbumPhoto(photo, response, { variant });
      return;
    }
    const user = await getAuthUser(request);
    verifySessionAlbumMediaQuery(sessionAlbumMediaPhotoId, url.searchParams);
    const photo = await getVisibleSessionAlbumPhotoForMedia(
      user.user.id,
      sessionAlbumMediaPhotoId
    );
    await serveUploadedSessionAlbumPhoto(photo, response, { variant });
    return;
  }

  const sessionAlbumMediaVideoCoverId = idMatch(
    url.pathname,
    /^\/api\/session-album\/media\/(\d+)\/cover$/
  );
  if (request.method === "GET" && sessionAlbumMediaVideoCoverId) {
    const user = await getAuthUser(request);
    verifySessionAlbumMediaQuery(sessionAlbumMediaVideoCoverId, url.searchParams);
    const media = await getVisibleSessionAlbumVideoForPlayback(
      user,
      sessionAlbumMediaVideoCoverId
    );
    await serveUploadedSessionAlbumVideoCover(media, response);
    return;
  }

  const sessionAlbumMediaVideoFileId = idMatch(
    url.pathname,
    /^\/api\/session-album\/media\/(\d+)\/video-file$/
  );
  if ((request.method === "GET" || request.method === "HEAD") && sessionAlbumMediaVideoFileId) {
    const claims = verifySessionAlbumVideoFileQuery(
      sessionAlbumMediaVideoFileId,
      url.searchParams
    );
    const media = await getVisibleSessionAlbumVideoForPlayback(
      { user: { id: claims.userId }, roles: [] },
      sessionAlbumMediaVideoFileId
    );
    if (Number(media.session_id) !== claims.sessionId) {
      throw forbidden("album video token is invalid");
    }
    await serveUploadedSessionAlbumVideoFile(media, response, {
      method: request.method,
      range: request.headers.range
    });
    return;
  }

  const sessionAlbumMediaVideoUrlId = idMatch(
    url.pathname,
    /^\/api\/session-album\/media\/(\d+)\/video-url$/
  );
  if (request.method === "GET" && sessionAlbumMediaVideoUrlId) {
    const user = await getAuthUser(request);
    const media = await getVisibleSessionAlbumVideoForPlayback(
      user,
      sessionAlbumMediaVideoUrlId
    );
    jsonResponse(response, 200, {
      ok: true,
      data: {
        url: signedAlbumVideoUrl(media, user.user.id),
        expiresInSeconds: SESSION_ALBUM_MEDIA_TOKEN_SECONDS
      }
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/users/me/avatar") {
    const user = await getAuthUser(request);
    const avatarUrl = await saveUploadedAvatar(request, user.user.id);
    jsonResponse(response, 201, {
      ok: true,
      data: { avatarUrl }
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/session-reviews/photos") {
    const user = await getAuthUser(request);
    const photoUrl = await saveUploadedSessionReviewPhoto(request, user.user.id);
    jsonResponse(response, 201, {
      ok: true,
      data: { photoUrl }
    });
    return;
  }

  const sessionAlbumUploadId = idMatch(
    url.pathname,
    /^\/api\/sessions\/(\d+)\/album\/uploads$/
  );
  if (request.method === "POST" && sessionAlbumUploadId) {
    const user = await getAuthUser(request);
    await assertSessionAlbumUploadAllowed(user, sessionAlbumUploadId);
    assertContentModerationIntake(config.contentModeration, "image");
    if (config.albumMedia.directUploadRequired) {
      throw new AppError(
        409,
        "DIRECT_UPLOAD_REQUIRED",
        "Production album images must be uploaded directly to COS"
      );
    }
    const photoUrl = await saveUploadedSessionAlbumPhoto(
      request,
      user.user.id,
      sessionAlbumUploadId
    );
    jsonResponse(response, 201, {
      ok: true,
      data: { photoUrl }
    });
    return;
  }

  const adminSessionAlbumUploadId = idMatch(
    url.pathname,
    /^\/api\/admin\/sessions\/(\d+)\/album\/uploads$/
  );
  if (request.method === "POST" && adminSessionAlbumUploadId) {
    const user = await getAuthUser(request);
    const session = await assertAdminOwnSessionAlbumAllowed(user, adminSessionAlbumUploadId);
    assertContentModerationIntake(config.contentModeration, "image");
    if (config.albumMedia.directUploadRequired) {
      throw new AppError(
        409,
        "DIRECT_UPLOAD_REQUIRED",
        "Production album images must be uploaded directly to COS"
      );
    }
    const photoUrl = await saveUploadedSessionAlbumPhoto(
      request,
      user.user.id,
      adminSessionAlbumUploadId,
      { filenamePrefix: `admin-album-${session.id}` }
    );
    jsonResponse(response, 201, {
      ok: true,
      data: { photoUrl }
    });
    return;
  }

  const adminSessionAlbumVideoUploadId = idMatch(
    url.pathname,
    /^\/api\/admin\/sessions\/(\d+)\/album\/videos\/uploads$/
  );
  if (request.method === "POST" && adminSessionAlbumVideoUploadId) {
    const user = await getAuthUser(request);
    requireRole(user, "system_admin");
    await assertSessionAlbumUploadAllowed(user, adminSessionAlbumVideoUploadId);
    assertContentModerationIntake(config.contentModeration, "video");
    const sourceUrl = await saveUploadedSessionAlbumVideo(
      request,
      user.user.id,
      adminSessionAlbumVideoUploadId
    );
    jsonResponse(response, 201, {
      ok: true,
      data: { sourceUrl }
    });
    return;
  }

  if (
    request.method === "POST" &&
    url.pathname === "/api/internal/content-moderation/tencent-video/callback"
  ) {
    const providedToken =
      url.searchParams.get("token") || request.headers["x-content-moderation-token"] || "";
    if (!authenticateTencentCallback(
      providedToken,
      [
        config.contentModeration.tencentVideoCallbackToken,
        config.contentModeration.tencentVideoCallbackPreviousToken
      ]
    )) {
      emitContentModerationEvent("moderation_callback_failure", {
        provider: "tencent_ci_video",
        subjectType: "album_video",
        outcome: "unauthorized",
        errorCode: "CONTENT_MODERATION_CALLBACK_UNAUTHORIZED"
      });
      throw new AppError(
        401,
        "CONTENT_MODERATION_CALLBACK_UNAUTHORIZED",
        "content moderation callback is unauthorized"
      );
    }
    const rawCallback = await readRawBody(request, TENCENT_VIDEO_CALLBACK_MAX_BYTES);
    if (config.contentModeration.productionPreflight?.referenceHmacKey) {
      try {
        const preflightResult = await tryHandleProductionPreflightTencentCallback({
          payload: parseTencentProductionPreflightCallbackPayload(rawCallback),
          runtime: await buildProductionPreflightCallbackRuntime(),
          hmacKey: config.contentModeration.productionPreflight.referenceHmacKey,
          guards: assertProductionPreflightGuards,
          repository: createProductionPreflightCallbackRepository(),
          cleanupObject: cleanupProductionPreflightCallbackObject,
          onCleanupFailure: () => emitContentModerationEvent("moderation_operational_alert", {
            outcome: "error",
            errorCode: "CONTENT_MODERATION_PRODUCTION_PREFLIGHT_CLEANUP_FAILED",
            priority: "high"
          })
        });
        if (preflightResult.status === "handled") {
          jsonResponse(response, 200, { ok: true, data: { preflight: true } });
          return;
        }
        if (preflightResult.status === "retry") {
          errorResponse(
            response,
            503,
            "CONTENT_MODERATION_CALLBACK_RETRY",
            "content moderation preflight callback is waiting for submission"
          );
          return;
        }
      } catch (error) {
        if (!/production preflight Tencent callback missing DataId or JobId/.test(String(error?.message || error))) {
          throw error;
        }
      }
    }
    const callback = parseTencentCallbackPayload(rawCallback);
    const callbackLookup = await resolveTencentVideoCallback({
      callback,
      withDatabaseConnection,
      repository: {
        findModerationJobByDataId,
        findModerationAttemptByProviderJobId
      }
    });
    if (callbackLookup.retryable) {
      errorResponse(
        response,
        503,
        "CONTENT_MODERATION_CALLBACK_RETRY",
        "content moderation callback is waiting for submission"
      );
      return;
    }
    if (callbackLookup.stale) {
      jsonResponse(response, 200, { ok: true, data: { stale: true, duplicate: false } });
      return;
    }
    const job = callbackLookup.job;
    const callbackResult = await contentModeration.applyMediaResult({
      jobId: job.id,
      provider: "tencent_ci_video",
      providerJobId: callback.providerJobId,
      subjectVersion: job.subject_version,
      objectKey: callback.objectKey,
      result: callback.result
    });
    jsonResponse(response, 200, { ok: true, data: callbackResult });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/cos/ci/session-album-video-callback") {
    const callbackResult = await handleSessionAlbumVideoProcessingCallback(url, request);
    jsonResponse(response, 200, {
      ok: true,
      data: callbackResult
    });
    return;
  }

  if (
    request.method === "GET" &&
    url.pathname === "/api/internal/content-moderation/wechat-image/callback"
  ) {
    let echo;
    try {
      echo = verifyWechatCallbackUrl({
        token: config.contentModeration.wechatEventToken,
        signature: url.searchParams.get("signature"),
        timestamp: url.searchParams.get("timestamp"),
        nonce: url.searchParams.get("nonce"),
        echostr: url.searchParams.get("echostr")
      });
    } catch (error) {
      const unauthorized = error?.code === "CONTENT_MODERATION_CALLBACK_UNAUTHORIZED";
      emitContentModerationEvent("moderation_callback_failure", {
        provider: "wechat_sec_check",
        subjectType: "album_image",
        outcome: unauthorized ? "unauthorized" : "invalid",
        errorCode: unauthorized
          ? "CONTENT_MODERATION_CALLBACK_UNAUTHORIZED"
          : "CONTENT_MODERATION_INVALID_CALLBACK"
      });
      throw error;
    }
    response.writeHead(200, {
      "cache-control": "no-store",
      "content-type": "text/plain; charset=utf-8",
      "content-length": Buffer.byteLength(echo)
    });
    response.end(echo);
    return;
  }

  if (
    request.method === "POST" &&
    url.pathname === "/api/internal/content-moderation/wechat-image/callback"
  ) {
    const rawCallback = await readRawBody(request, 256 * 1024);
    let callback;
    try {
      callback = parseWechatSecureImageEvent({
        rawBody: rawCallback,
        token: config.contentModeration.wechatEventToken,
        aesKey: config.contentModeration.wechatEventAesKey,
        appId: config.contentModeration.wechatAppId,
        msgSignature: url.searchParams.get("msg_signature") || "",
        timestamp: url.searchParams.get("timestamp") || "",
        nonce: url.searchParams.get("nonce") || ""
      });
    } catch (error) {
      const unauthorized = error?.code === "CONTENT_MODERATION_CALLBACK_UNAUTHORIZED";
      emitContentModerationEvent("moderation_callback_failure", {
        provider: "wechat_sec_check",
        subjectType: "album_image",
        outcome: unauthorized ? "unauthorized" : "invalid",
        errorCode: unauthorized
          ? "CONTENT_MODERATION_CALLBACK_UNAUTHORIZED"
          : "CONTENT_MODERATION_INVALID_CALLBACK"
      });
      throw error;
    }
    if (config.contentModeration.productionPreflight?.referenceHmacKey) {
      const preflightResult = await tryHandleProductionPreflightWechatImageCallback({
        event: callback,
        runtime: await buildProductionPreflightCallbackRuntime(),
        hmacKey: config.contentModeration.productionPreflight.referenceHmacKey,
        guards: assertProductionPreflightGuards,
        repository: createProductionPreflightCallbackRepository(),
        cleanupObject: cleanupProductionPreflightCallbackObject,
        onCleanupFailure: () => emitContentModerationEvent("moderation_operational_alert", {
          outcome: "error",
          errorCode: "CONTENT_MODERATION_PRODUCTION_PREFLIGHT_CLEANUP_FAILED",
          priority: "high"
        })
      });
      if (preflightResult.status === "handled") {
        jsonResponse(response, 200, { ok: true, data: { preflight: true } });
        return;
      }
      if (preflightResult.status === "retry") {
        errorResponse(
          response,
          503,
          "CONTENT_MODERATION_CALLBACK_RETRY",
          "content moderation preflight callback is waiting for trace association"
        );
        return;
      }
    }
    const callbackResult = await dispatchWechatImageModerationEvent({
      event: callback,
      withDatabaseConnection,
      repository: {
        findModerationAttemptByProviderJobId,
        findModerationJobById
      },
      applyMediaResult: (input) => contentModeration.applyMediaResult(input)
    });
    jsonResponse(response, 200, { ok: true, data: callbackResult });
    return;
  }

  const body = await bodyFor(request);

  const adminModerationRoute = await adminModerationApi({
    request,
    method: request.method,
    pathname: url.pathname,
    searchParams: url.searchParams,
    body
  });
  if (adminModerationRoute) {
    jsonResponse(response, adminModerationRoute.statusCode, {
      ok: true,
      data: adminModerationRoute.data
    }, {
      "cache-control": "private, no-store"
    });
    return;
  }

  const authorDraftId = idMatch(
    url.pathname,
    /^\/api\/content-moderation\/author-drafts\/(\d+)$/
  );
  if (request.method === "DELETE" && authorDraftId) {
    const user = await getAuthUser(request);
    jsonResponse(response, 200, {
      ok: true,
      data: await authorDrafts.cancel({ user, draftId: authorDraftId })
    }, {
      "cache-control": "private, no-store"
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/uploads/cos-intent") {
    const user = await getAuthUser(request);
    const upload = isAlbumImageKind(body.kind)
      ? await albumImageUploads.createIntent({ user, body })
      : await createCosDirectUploadIntent({
          kind: body.kind,
          extension: body.extension,
          user,
          userId: user.user.id,
          sessionId: body.sessionId || body.session_id
        });
    jsonResponse(response, 200, {
      ok: true,
      data: {
        upload
      }
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/uploads/cos-authorization") {
    const user = await getAuthUser(request);
    const useAlbumImageAuthorization = await isPersistedAlbumImageAuthorization(user, body);
    jsonResponse(response, 200, {
      ok: true,
      data: useAlbumImageAuthorization
        ? await albumImageUploads.authorize({ body, user })
        : await authorizeCosDirectUpload({ body, user })
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/telemetry/album-media") {
    await getAuthUser(request);
    const allowedEvents = new Set([
      "upload_retry",
      "upload_failure",
      "media_refresh_success",
      "media_refresh_failure"
    ]);
    const event = String(body.event || "");
    if (!allowedEvents.has(event)) throw badRequest("unsupported album media event");
    const sessionId = Number(body.sessionId ?? body.session_id ?? 0);
    const retryCount = Number(body.retryCount ?? body.retry_count ?? 0);
    if (
      (sessionId && (!Number.isSafeInteger(sessionId) || sessionId < 0)) ||
      (!Number.isSafeInteger(retryCount) || retryCount < 0)
    ) {
      throw badRequest("invalid album media telemetry fields");
    }
    const errorCode = body.errorCode ?? body.error_code;
    if (errorCode !== undefined && !/^[A-Z0-9_]{1,64}$/.test(String(errorCode))) {
      throw badRequest("invalid album media telemetry error code");
    }
    emitAlbumImageEvent(event, {
      sessionId,
      retryCount,
      errorCode: errorCode ? String(errorCode) : undefined
    });
    jsonResponse(response, 202, { ok: true });
    return;
  }

  if (request.method === "GET" && url.pathname === "/health") {
    const database = await checkDatabaseReadiness();
    jsonResponse(response, database.ok ? 200 : 503, {
      ok: database.ok,
      service: "pinche-api",
      config: publicConfig(),
      database,
      now: new Date().toISOString()
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/health/db") {
    const database = await checkDatabaseReadiness();
    jsonResponse(response, database.ok ? 200 : 503, {
      ok: database.ok,
      database: config.mysql.database,
      connected: database.connected,
      schemaReady: database.schemaReady,
      missingTables: database.missingTables,
      ...(database.error ? { error: database.error } : {})
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/testing/d40-smoke-target") {
    if (!d40SmokeDatabaseIsIsolated()) {
      throw new AppError(
        409,
        "SMOKE_DATABASE_NOT_ISOLATED",
        "D40 smoke requires the dedicated local pinche_d40_test database"
      );
    }
    jsonResponse(response, 200, {
      ok: true,
      data: {
        mode: "d40",
        isolated: true,
        database: config.mysql.database
      }
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/auth/wechat/login") {
    const result = await loginWithWechatCode(body.code);
    jsonResponse(response, 200, {
      ok: true,
      data: result
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/admin/web-login/tickets") {
    jsonResponse(response, 201, {
      ok: true,
      data: await createAdminWebLoginTicket({
        userAgent: request.headers["user-agent"] || body.userAgent
      })
    });
    return;
  }

  const adminWebLoginTicketId = url.pathname.match(
    /^\/api\/admin\/web-login\/tickets\/([^/]+)$/
  )?.[1];
  if (request.method === "GET" && adminWebLoginTicketId) {
    jsonResponse(response, 200, {
      ok: true,
      data: await pollAdminWebLoginTicket(
        adminWebLoginTicketId,
        url.searchParams.get("secret")
      )
    });
    return;
  }

  const adminWebLoginApproveId = url.pathname.match(
    /^\/api\/admin\/web-login\/tickets\/([^/]+)\/approve$/
  )?.[1];
  if (request.method === "POST" && adminWebLoginApproveId) {
    const user = await getAuthUser(request);
    jsonResponse(response, 200, {
      ok: true,
      data: await approveAdminWebLoginTicket(user, adminWebLoginApproveId, body)
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/auth/wechat/phone") {
    const user = await getAuthUser(request);
    const phoneCredential = body.code || body.phoneCode || body.phoneEncrypted || body.phone;
    if (!phoneCredential) {
      throw badRequest("phone authorization code is required");
    }
    const updated = await updateUserPhone(user.user.id, phoneCredential);
    jsonResponse(response, 200, {
      ok: true,
      data: {
        user: updated,
        roles: user.roles
      }
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/users/me") {
    const user = await getAuthUser(request);
    const projection = await withDatabaseConnection((connection) =>
      authorTextProjectionReader.find(connection, {
        userId: user.user.id,
        action: "update_nickname",
        targetSubjectId: String(user.user.id)
      })
    );
    jsonResponse(response, 200, {
      ok: true,
      data: projection
        ? { ...user, user: mergeAuthorTextProjection(user.user, projection) }
        : user
    }, projection ? { "cache-control": "private, no-store" } : {});
    return;
  }

  if (request.method === "PATCH" && url.pathname === "/api/users/me") {
    const user = await getAuthUser(request);
    const moderated = await moderateCoveredText({
      request,
      user,
      action: "update_nickname",
      subjectId: String(user.user.id),
      body
    });
    const updatedUser = moderated ?? await updateUserProfile(user.user.id, body);
    jsonResponse(response, moderatedTextHttpStatus(moderated, 200), {
      ok: true,
      data: isAuthorPrivateTextDto(moderated) ? moderated : {
        user: updatedUser,
        roles: user.roles
      }
    }, moderatedTextHeaders(moderated));
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/stores") {
    const user = await optionalAuthUser(request);
    const stores = await listActiveStores(
      Object.fromEntries(url.searchParams),
      user,
      { authorTextReader: authorTextProjectionReader }
    );
    jsonResponse(response, 200, {
      ok: true,
      data: stores
    }, stores.some(isAuthorPrivateTextDto) ? { "cache-control": "private, no-store" } : {});
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/stores") {
    const user = await getAuthUser(request);
    const moderated = await moderateCoveredText({
      request,
      user,
      action: "create_private_store",
      body
    });
    jsonResponse(response, moderatedTextHttpStatus(moderated, 201), {
      ok: true,
      data: moderated ?? await createPrivateStore(user, body)
    }, moderatedTextHeaders(moderated));
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/scripts") {
    const user = await optionalAuthUser(request);
    const scripts = await listActiveScripts(
      Object.fromEntries(url.searchParams),
      user,
      { authorTextReader: authorTextProjectionReader }
    );
    jsonResponse(response, 200, {
      ok: true,
      data: scripts
    }, scripts.some(isAuthorPrivateTextDto) ? { "cache-control": "private, no-store" } : {});
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/scripts") {
    const user = await getAuthUser(request);
    const moderated = await moderateCoveredText({
      request,
      user,
      action: "create_private_script",
      body
    });
    jsonResponse(response, moderatedTextHttpStatus(moderated, 201), {
      ok: true,
      data: moderated ?? await createPrivateScript(user, body)
    }, moderatedTextHeaders(moderated));
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/catalog-review-items/mine") {
    const user = await getAuthUser(request);
    jsonResponse(response, 200, {
      ok: true,
      data: await listMyCatalogReviewItems(user, Object.fromEntries(url.searchParams))
    });
    return;
  }

  const myCatalogReviewItemMatch = url.pathname.match(
    /^\/api\/catalog-review-items\/(store|script)\/(\d+)$/
  );
  if (request.method === "PATCH" && myCatalogReviewItemMatch) {
    const user = await getAuthUser(request);
    jsonResponse(response, 200, {
      ok: true,
      data: await updateMyCatalogReviewItem(
        user,
        myCatalogReviewItemMatch[1],
        Number(myCatalogReviewItemMatch[2]),
        body
      )
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/admin/stores") {
    const user = await getAuthUser(request);
    requireRole(user, "system_admin");
    jsonResponse(response, 200, {
      ok: true,
      data: await listAdminStores(Object.fromEntries(url.searchParams))
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/admin/stores") {
    const user = await getAuthUser(request);
    requireRole(user, "system_admin");
    jsonResponse(response, 201, { ok: true, data: await createStore(user, body) });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/admin/location/geocode") {
    const user = await getAuthUser(request);
    requireRole(user, "system_admin");
    jsonResponse(response, 200, { ok: true, data: await geocodeStoreLocation(body) });
    return;
  }

  const adminStoreScriptsId = idMatch(url.pathname, /^\/api\/admin\/stores\/(\d+)\/scripts$/);
  if (request.method === "GET" && adminStoreScriptsId) {
    const user = await getAuthUser(request);
    requireRole(user, "system_admin");
    jsonResponse(response, 200, {
      ok: true,
      data: await listStoreScripts(adminStoreScriptsId)
    });
    return;
  }

  if (request.method === "PUT" && adminStoreScriptsId) {
    const user = await getAuthUser(request);
    requireRole(user, "system_admin");
    jsonResponse(response, 200, {
      ok: true,
      data: await replaceStoreScripts(adminStoreScriptsId, body)
    });
    return;
  }

  const adminStoreId = idMatch(url.pathname, /^\/api\/admin\/stores\/(\d+)$/);
  if (request.method === "PATCH" && adminStoreId) {
    const user = await getAuthUser(request);
    requireRole(user, "system_admin");
    jsonResponse(response, 200, { ok: true, data: await updateStore(adminStoreId, body) });
    return;
  }

  if (request.method === "DELETE" && adminStoreId) {
    const user = await getAuthUser(request);
    requireRole(user, "system_admin");
    jsonResponse(response, 200, { ok: true, data: await deleteStore(adminStoreId) });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/admin/scripts") {
    const user = await getAuthUser(request);
    requireRole(user, "system_admin");
    jsonResponse(response, 201, { ok: true, data: await createScript(user, body) });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/admin/scripts") {
    const user = await getAuthUser(request);
    requireRole(user, "system_admin");
    jsonResponse(response, 200, {
      ok: true,
      data: await listAdminScripts(Object.fromEntries(url.searchParams))
    });
    return;
  }

  const adminScriptId = idMatch(url.pathname, /^\/api\/admin\/scripts\/(\d+)$/);
  if (request.method === "PATCH" && adminScriptId) {
    const user = await getAuthUser(request);
    requireRole(user, "system_admin");
    jsonResponse(response, 200, {
      ok: true,
      data: await updateScript(adminScriptId, body)
    });
    return;
  }

  if (request.method === "DELETE" && adminScriptId) {
    const user = await getAuthUser(request);
    requireRole(user, "system_admin");
    jsonResponse(response, 200, {
      ok: true,
      data: await deleteScript(adminScriptId)
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/admin/catalog-review-items") {
    const user = await getAuthUser(request);
    requireRole(user, "system_admin");
    jsonResponse(response, 200, {
      ok: true,
      data: await listAdminCatalogReviewItems(Object.fromEntries(url.searchParams))
    });
    return;
  }

  const adminCatalogReviewItemMatch = url.pathname.match(
    /^\/api\/admin\/catalog-review-items\/(store|script)\/(\d+)$/
  );
  if (request.method === "PATCH" && adminCatalogReviewItemMatch) {
    const user = await getAuthUser(request);
    requireRole(user, "system_admin");
    jsonResponse(response, 200, {
      ok: true,
      data: await updateAdminCatalogReviewItem(
        user,
        adminCatalogReviewItemMatch[1],
        Number(adminCatalogReviewItemMatch[2]),
        body
      )
    });
    return;
  }

  const adminCatalogReviewApproveMatch = url.pathname.match(
    /^\/api\/admin\/catalog-review-items\/(store|script)\/(\d+)\/approve$/
  );
  if (request.method === "POST" && adminCatalogReviewApproveMatch) {
    const user = await getAuthUser(request);
    requireRole(user, "system_admin");
    jsonResponse(response, 200, {
      ok: true,
      data: await approveCatalogReviewItem(
        user,
        adminCatalogReviewApproveMatch[1],
        Number(adminCatalogReviewApproveMatch[2]),
        body
      )
    });
    return;
  }

  const adminCatalogReviewNeedsChangesMatch = url.pathname.match(
    /^\/api\/admin\/catalog-review-items\/(store|script)\/(\d+)\/needs-changes$/
  );
  if (request.method === "POST" && adminCatalogReviewNeedsChangesMatch) {
    const user = await getAuthUser(request);
    requireRole(user, "system_admin");
    jsonResponse(response, 200, {
      ok: true,
      data: await markCatalogReviewItemNeedsChanges(
        user,
        adminCatalogReviewNeedsChangesMatch[1],
        Number(adminCatalogReviewNeedsChangesMatch[2]),
        body
      )
    });
    return;
  }

  const adminCatalogReviewRejectMatch = url.pathname.match(
    /^\/api\/admin\/catalog-review-items\/(store|script)\/(\d+)\/reject$/
  );
  if (request.method === "POST" && adminCatalogReviewRejectMatch) {
    const user = await getAuthUser(request);
    requireRole(user, "system_admin");
    jsonResponse(response, 200, {
      ok: true,
      data: await rejectCatalogReviewItem(
        user,
        adminCatalogReviewRejectMatch[1],
        Number(adminCatalogReviewRejectMatch[2]),
        body
      )
    });
    return;
  }

  const adminCatalogReviewMergeMatch = url.pathname.match(
    /^\/api\/admin\/catalog-review-items\/(store|script)\/(\d+)\/merge$/
  );
  if (request.method === "POST" && adminCatalogReviewMergeMatch) {
    const user = await getAuthUser(request);
    requireRole(user, "system_admin");
    jsonResponse(response, 200, {
      ok: true,
      data: await mergeCatalogReviewItem(
        user,
        adminCatalogReviewMergeMatch[1],
        Number(adminCatalogReviewMergeMatch[2]),
        body
      )
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/admin/sessions") {
    const user = await getAuthUser(request);
    requireRole(user, "system_admin");
    jsonResponse(response, 200, {
      ok: true,
      data: await listAdminSessions(Object.fromEntries(url.searchParams))
    });
    return;
  }

  const adminSessionId = idMatch(url.pathname, /^\/api\/admin\/sessions\/(\d+)$/);
  if (request.method === "DELETE" && adminSessionId) {
    const user = await getAuthUser(request);
    requireRole(user, "system_admin");
    jsonResponse(response, 200, {
      ok: true,
      data: await deleteAdminSession(adminSessionId)
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/admin/catalog-requests") {
    const user = await getAuthUser(request);
    requireRole(user, "system_admin");
    jsonResponse(response, 200, {
      ok: true,
      data: await listCatalogRequests(Object.fromEntries(url.searchParams))
    });
    return;
  }

  const adminCatalogRequestId = idMatch(
    url.pathname,
    /^\/api\/admin\/catalog-requests\/(\d+)$/
  );
  if (request.method === "PATCH" && adminCatalogRequestId) {
    const user = await getAuthUser(request);
    requireRole(user, "system_admin");
    jsonResponse(response, 200, {
      ok: true,
      data: await reviewCatalogRequest(user, adminCatalogRequestId, body)
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/catalog-requests") {
    const user = await getAuthUser(request);
    jsonResponse(response, 201, {
      ok: true,
      data: await createCatalogRequest(user, body)
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/performer-profiles") {
    const user = await getAuthUser(request);
    jsonResponse(response, 200, {
      ok: true,
      data: await upsertPerformerProfile(user, body)
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/entity-claims") {
    const user = await getAuthUser(request);
    jsonResponse(response, 201, {
      ok: true,
      data: await createEntityClaim(user, body)
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/sessions/public/upcoming") {
    jsonResponse(response, 200, {
      ok: true,
      data: {
        sessions: await listPublicUpcomingSessions(Object.fromEntries(url.searchParams))
      }
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/sessions/discovery") {
    const user = await getAuthUser(request);
    const hasLatitude = body.latitude !== undefined && body.latitude !== null && body.latitude !== "";
    const hasLongitude =
      body.longitude !== undefined && body.longitude !== null && body.longitude !== "";
    if (hasLatitude !== hasLongitude) {
      throw badRequest("latitude and longitude must be provided together");
    }

    let city = String(body.city || "").trim();
    let locationProvider = city ? "cache" : null;
    let discoveryFilters = city ? { ...body, city } : { limit: body.limit };
    if (!city && hasLatitude && hasLongitude) {
      try {
        const location = await reverseGeocodeCity({
          latitude: body.latitude,
          longitude: body.longitude
        });
        city = location.city;
        locationProvider = location.provider;
        discoveryFilters = {
          ...body,
          city
        };
      } catch (error) {
        if (error?.code !== "LOCATION_REVERSE_GEOCODE_FAILED") {
          throw error;
        }
        discoveryFilters = { limit: body.limit };
      }
    }

    jsonResponse(response, 200, {
      ok: true,
      data: {
        mode: city ? "city" : "time_fallback",
        city: city || null,
        location_provider: locationProvider,
        sessions: await listDiscoverableSessions(user, discoveryFilters)
      }
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/sessions") {
    const user = await getAuthUser(request);
    const moderated = await moderateCoveredText({
      request,
      user,
      action: "create_session",
      body
    });
    jsonResponse(
      response,
      moderatedTextHttpStatus(moderated, 201),
      { ok: true, data: moderated ?? await createSession(user, body) },
      moderatedTextHeaders(moderated)
    );
    return;
  }

  const sessionId = idMatch(url.pathname, /^\/api\/sessions\/(\d+)$/);
  if (request.method === "GET" && sessionId) {
    const viewer = await optionalAuthUser(request);
    const inviteToken = url.searchParams.get("inviteToken") || "";
    const inviteClaims = inviteToken ? verifySessionJoinInviteToken(inviteToken) : null;
    if (inviteClaims && Number(inviteClaims.sessionId) !== Number(sessionId)) {
      throw forbidden("session join invite token is invalid");
    }
    const session = await getSessionForViewer(sessionId, {
      viewer,
      inviteClaims,
      authorTextReader: authorTextProjectionReader
    });
    jsonResponse(response, 200, {
      ok: true,
      data: session
    }, authorPrivateResponseHeaders(session));
    return;
  }
  if (request.method === "PATCH" && sessionId) {
    const user = await getAuthUser(request);
    const moderated = await moderateCoveredText({
      request,
      user,
      action: "update_session",
      subjectId: String(sessionId),
      body,
      context: { sessionId: Number(sessionId) }
    });
    jsonResponse(response, moderatedTextHttpStatus(moderated, 200), {
      ok: true,
      data: moderated ?? await updateSession(user, sessionId, body)
    }, moderatedTextHeaders(moderated));
    return;
  }

  const sessionNpcRolesId = idMatch(url.pathname, /^\/api\/sessions\/(\d+)\/npc-roles$/);
  if (request.method === "GET" && sessionNpcRolesId) {
    const user = await getAuthUser(request);
    const npcRoles = await listSessionNpcRoles(user, sessionNpcRolesId, {
      authorTextReader: authorTextProjectionReader
    });
    jsonResponse(response, 200, {
      ok: true,
      data: npcRoles
    }, authorPrivateResponseHeaders(npcRoles));
    return;
  }
  if (request.method === "POST" && sessionNpcRolesId) {
    const user = await getAuthUser(request);
    const moderated = await moderateCoveredText({
      request,
      user,
      action: "create_session_npc_role",
      body,
      context: { sessionId: Number(sessionNpcRolesId) }
    });
    jsonResponse(response, moderatedTextHttpStatus(moderated, 201), {
      ok: true,
      data: moderated ?? await createSessionNpcRole(user, sessionNpcRolesId, body)
    }, moderatedTextHeaders(moderated));
    return;
  }

  const sessionNpcRoleId = idMatch(url.pathname, /^\/api\/session-npc-roles\/(\d+)$/);
  if (request.method === "PATCH" && sessionNpcRoleId) {
    const user = await getAuthUser(request);
    const moderated = await moderateCoveredText({
      request,
      user,
      action: "update_session_npc_role",
      subjectId: String(sessionNpcRoleId),
      body
    });
    jsonResponse(response, moderatedTextHttpStatus(moderated, 200), {
      ok: true,
      data: moderated ?? await updateSessionNpcRole(user, sessionNpcRoleId, body)
    }, moderatedTextHeaders(moderated));
    return;
  }

  const sessionNpcRoleClaimId = idMatch(
    url.pathname,
    /^\/api\/session-npc-roles\/(\d+)\/claim$/
  );
  if (request.method === "POST" && sessionNpcRoleClaimId) {
    const user = await getAuthUser(request);
    jsonResponse(response, 200, {
      ok: true,
      data: await claimSessionNpcRole(user, sessionNpcRoleClaimId, body)
    });
    return;
  }

  const relinkSessionId = idMatch(url.pathname, /^\/api\/sessions\/(\d+)\/relink$/);
  if (request.method === "PATCH" && relinkSessionId) {
    const user = await getAuthUser(request);
    jsonResponse(response, 200, {
      ok: true,
      data: await relinkMySessionMembership(user, relinkSessionId)
    });
    return;
  }

  const transferOrganizerSessionId = idMatch(
    url.pathname,
    /^\/api\/sessions\/(\d+)\/organizer\/transfer$/
  );
  if (request.method === "PATCH" && transferOrganizerSessionId) {
    const user = await getAuthUser(request);
    jsonResponse(response, 200, {
      ok: true,
      data: await transferSessionOrganizer(user, transferOrganizerSessionId, body)
    });
    return;
  }

  const leaveOrganizerSessionId = idMatch(
    url.pathname,
    /^\/api\/sessions\/(\d+)\/organizer\/leave$/
  );
  if (request.method === "PATCH" && leaveOrganizerSessionId) {
    const user = await getAuthUser(request);
    jsonResponse(response, 200, {
      ok: true,
      data: await leaveSessionOrganizer(user, leaveOrganizerSessionId)
    });
    return;
  }

  const sessionJoinInviteTokenId = idMatch(
    url.pathname,
    /^\/api\/sessions\/(\d+)\/join-invite-token$/
  );
  if (request.method === "POST" && sessionJoinInviteTokenId) {
    const user = await getAuthUser(request);
    await assertSessionJoinInviteAllowed(user, sessionJoinInviteTokenId);
    const exp = Math.floor(Date.now() / 1000) + SESSION_JOIN_INVITE_TOKEN_SECONDS;
    jsonResponse(response, 201, {
      ok: true,
      data: {
        token: signSessionJoinInviteToken({
          sessionId: Number(sessionJoinInviteTokenId),
          inviterUserId: Number(user.user.id),
          exp
        }),
        expires_at: new Date(exp * 1000).toISOString()
      }
    });
    return;
  }

  const sessionAlbumShareTokenId = idMatch(
    url.pathname,
    /^\/api\/sessions\/(\d+)\/album\/share-token$/
  );
  if (request.method === "POST" && sessionAlbumShareTokenId) {
    const user = await getAuthUser(request);
    const subject = await getSessionAlbumShareSubject(user, sessionAlbumShareTokenId);
    const exp = Math.floor(Date.now() / 1000) + SESSION_ALBUM_SHARE_TOKEN_SECONDS;
    const claims = {
      sessionId: Number(sessionAlbumShareTokenId),
      sharerUserId: Number(user.user.id),
      seatId: Number(subject.share_subject.seat_id),
      exp
    };
    jsonResponse(response, 200, {
      ok: true,
      data: {
        ...subject,
        token: signSessionAlbumShareToken(claims),
        expires_at: new Date(exp * 1000).toISOString()
      }
    });
    return;
  }

  const publicSessionAlbumShareId = idMatch(
    url.pathname,
    /^\/api\/sessions\/(\d+)\/album\/public-share$/
  );
  if (request.method === "GET" && publicSessionAlbumShareId) {
    const albumShareToken =
      url.searchParams.get("token") || url.searchParams.get("albumShareToken") || "";
    const claims = verifySessionAlbumShareToken(albumShareToken);
    if (claims.sessionId !== Number(publicSessionAlbumShareId)) {
      throw forbidden("album share token is invalid");
    }
    const album = await listPublicSessionAlbumShare(claims);
    jsonResponse(response, 200, {
      ok: true,
      data: attachPublicSessionAlbumMediaUrls(album, claims, albumShareToken)
    });
    return;
  }

  const albumUploadStatusId = stringMatch(
    url.pathname,
    /^\/api\/uploads\/([0-9a-f-]{36})\/status$/i
  );
  if (request.method === "GET" && albumUploadStatusId) {
    const user = await getAuthUser(request);
    jsonResponse(response, 200, {
      ok: true,
      data: await albumImageUploads.status({ user, uploadId: albumUploadStatusId })
    });
    return;
  }

  const albumUploadFinalizeId = stringMatch(
    url.pathname,
    /^\/api\/uploads\/([0-9a-f-]{36})\/finalize$/i
  );
  if (request.method === "POST" && albumUploadFinalizeId) {
    const user = await getAuthUser(request);
    const finalized = await albumImageUploads.finalize({
      user,
      uploadId: albumUploadFinalizeId
    });
    jsonResponse(response, 200, {
      ok: true,
      data: attachLegacyFinalizedAlbumImageUrls(finalized)
    });
    return;
  }

  const sessionAlbumId = idMatch(url.pathname, /^\/api\/sessions\/(\d+)\/album$/);
  if (request.method === "GET" && sessionAlbumId) {
    const user = await getAuthUser(request);
    const album = await listSessionAlbum(user, sessionAlbumId);
    jsonResponse(response, 200, {
      ok: true,
      data: attachSessionAlbumMediaUrls(album, user.user.id)
    });
    return;
  }

  const adminSessionAlbumId = idMatch(
    url.pathname,
    /^\/api\/admin\/sessions\/(\d+)\/album$/
  );
  if (request.method === "GET" && adminSessionAlbumId) {
    const user = await getAuthUser(request);
    await assertAdminOwnSessionAlbumAllowed(user, adminSessionAlbumId);
    const album = await listSessionAlbum(user, adminSessionAlbumId);
    jsonResponse(response, 200, {
      ok: true,
      data: attachSessionAlbumMediaUrls(album, user.user.id, { routeKind: "admin" })
    });
    return;
  }

  const sessionAlbumPrivacyId = idMatch(
    url.pathname,
    /^\/api\/sessions\/(\d+)\/album\/privacy$/
  );
  if (request.method === "GET" && sessionAlbumPrivacyId) {
    const user = await getAuthUser(request);
    jsonResponse(response, 200, {
      ok: true,
      data: await getMySessionAlbumPrivacy(user, sessionAlbumPrivacyId)
    });
    return;
  }
  if (request.method === "PUT" && sessionAlbumPrivacyId) {
    const user = await getAuthUser(request);
    jsonResponse(response, 200, {
      ok: true,
      data: await updateMySessionAlbumPrivacy(user, sessionAlbumPrivacyId, body)
    });
    return;
  }

  const sessionAlbumPeopleId = idMatch(
    url.pathname,
    /^\/api\/sessions\/(\d+)\/album\/people$/
  );
  if (request.method === "GET" && sessionAlbumPeopleId) {
    const user = await getAuthUser(request);
    jsonResponse(response, 200, {
      ok: true,
      data: await listSessionAlbumPeople(user, sessionAlbumPeopleId)
    });
    return;
  }

  const adminSessionAlbumPeopleId = idMatch(
    url.pathname,
    /^\/api\/admin\/sessions\/(\d+)\/album\/people$/
  );
  if (request.method === "GET" && adminSessionAlbumPeopleId) {
    const user = await getAuthUser(request);
    await assertAdminOwnSessionAlbumAllowed(user, adminSessionAlbumPeopleId);
    jsonResponse(response, 200, {
      ok: true,
      data: await listSessionAlbumPeople(user, adminSessionAlbumPeopleId)
    });
    return;
  }

  const sessionAlbumPhotosId = idMatch(
    url.pathname,
    /^\/api\/sessions\/(\d+)\/album\/photos$/
  );
  if (request.method === "POST" && sessionAlbumPhotosId) {
    const user = await getAuthUser(request);
    await assertSessionAlbumUploadAllowed(user, sessionAlbumPhotosId);
    assertContentModerationIntake(config.contentModeration, "image");
    const photoUrl = body.photoUrl || body.photo_url;
    if (isCosUploadStorageEnabled()) {
      const finalized = attachLegacyFinalizedAlbumImageUrls(
        await albumImageUploads.finalizeLegacy({
          user,
          sessionId: sessionAlbumPhotosId,
          kind: "sessionAlbumPhoto",
          photoUrl
        })
      );
      jsonResponse(response, 201, { ok: true, data: finalized.photo });
      return;
    }
    const metadata = await getSessionAlbumDisplayMetadata(photoUrl);
    const photo = await createSessionAlbumPhoto(user, sessionAlbumPhotosId, {
      ...body,
      photoUrl,
      ...metadata
    });
    jsonResponse(response, 201, {
      ok: true,
      data: photo
    });
    return;
  }

  const adminSessionAlbumPhotosId = idMatch(
    url.pathname,
    /^\/api\/admin\/sessions\/(\d+)\/album\/photos$/
  );
  if (request.method === "POST" && adminSessionAlbumPhotosId) {
    const user = await getAuthUser(request);
    await assertAdminOwnSessionAlbumAllowed(user, adminSessionAlbumPhotosId);
    assertContentModerationIntake(config.contentModeration, "image");
    const photoUrl = body.photoUrl || body.photo_url;
    if (isCosUploadStorageEnabled()) {
      const finalized = attachLegacyFinalizedAlbumImageUrls(
        await albumImageUploads.finalizeLegacy({
          user,
          sessionId: adminSessionAlbumPhotosId,
          kind: "adminSessionAlbumPhoto",
          photoUrl
        })
      );
      jsonResponse(response, 201, { ok: true, data: finalized.photo });
      return;
    }
    const metadata = await getSessionAlbumDisplayMetadata(photoUrl);
    const photo = await createSessionAlbumPhoto(user, adminSessionAlbumPhotosId, {
      ...body,
      photoUrl,
      ...metadata
    });
    jsonResponse(response, 201, {
      ok: true,
      data: photo
    });
    return;
  }

  const adminSessionAlbumVideosId = idMatch(
    url.pathname,
    /^\/api\/admin\/sessions\/(\d+)\/album\/videos$/
  );
  if (request.method === "POST" && adminSessionAlbumVideosId) {
    const user = await getAuthUser(request);
    requireRole(user, "system_admin");
    await assertSessionAlbumUploadAllowed(user, adminSessionAlbumVideosId);
    assertContentModerationIntake(config.contentModeration, "video");
    const storageAdapter = createSessionAlbumVideoStorageAdapter();
    const inspectObject = (sourceUrl) =>
      inspectSessionAlbumVideoObject({ sourceUrl, storageAdapter });
    const video = await createSessionAlbumVideo(user, adminSessionAlbumVideosId, body, {
      inspectObject,
      readyOnCreate: true,
      assertVideoIntake: () => assertContentModerationIntake(config.contentModeration, "video"),
      createVideoModerationJob: (connection, input) =>
        contentModeration.createVideoJob(connection, input),
      submitVideoModeration: (job) => contentModeration.submitVideoJob(job)
    });
    jsonResponse(response, 201, {
      ok: true,
      data: video
    });
    return;
  }

  const sessionAlbumPhotoId = idMatch(
    url.pathname,
    /^\/api\/session-album\/photos\/(\d+)$/
  );
  if (request.method === "DELETE" && sessionAlbumPhotoId) {
    const user = await getAuthUser(request);
    const deletionSnapshot = await prepareSessionAlbumPhotoDeletion(user, sessionAlbumPhotoId);
    if (deletionSnapshot.media_type === "video") {
      const deletedVideo = await cleanupAlbumVideoBeforeDelete({
        urls: deletionSnapshot.object_urls,
        deleteObject: deleteUploadedSessionAlbumPhotoObject,
        finalizeSnapshot: (snapshot) => finalizeSessionAlbumPhotoDeletion(
          user,
          sessionAlbumPhotoId,
          { object_urls: snapshot }
        )
      });
      jsonResponse(response, 200, { ok: true, data: { id: deletedVideo.id, deleted: true } });
      return;
    }
    const deletion = await requestSessionAlbumImageDeletion(user, sessionAlbumPhotoId);
    jsonResponse(response, 202, {
      ok: true,
      data: {
        id: deletion.id,
        deleted: false,
        deletionPending: true
      }
    });
    return;
  }

  const sessionAlbumPhotoTagsId = idMatch(
    url.pathname,
    /^\/api\/session-album\/photos\/(\d+)\/tags$/
  );
  if (request.method === "PUT" && sessionAlbumPhotoTagsId) {
    const user = await getAuthUser(request);
    jsonResponse(response, 200, {
      ok: true,
      data: await updateSessionAlbumPhotoTags(user, sessionAlbumPhotoTagsId, body)
    });
    return;
  }

  const sessionReviewsId = idMatch(url.pathname, /^\/api\/sessions\/(\d+)\/reviews$/);
  if (request.method === "GET" && sessionReviewsId) {
    const viewer = await optionalAuthUser(request);
    const inviteToken = url.searchParams.get("inviteToken") || "";
    const inviteClaims = inviteToken ? verifySessionJoinInviteToken(inviteToken) : null;
    const access = await getSessionForViewer(sessionReviewsId, { viewer, inviteClaims });
    jsonResponse(response, 200, {
      ok: true,
      data: access.access_scope === "member" ? await listSessionReviews(sessionReviewsId) : []
    });
    return;
  }

  const mySessionReviewId = idMatch(url.pathname, /^\/api\/sessions\/(\d+)\/review$/);
  if (request.method === "GET" && mySessionReviewId) {
    const user = await getAuthUser(request);
    const review = await getMySessionReview(user, mySessionReviewId, {
      authorTextReader: authorTextProjectionReader
    });
    jsonResponse(response, 200, {
      ok: true,
      data: review
    }, authorPrivateResponseHeaders(review));
    return;
  }
  if (request.method === "PUT" && mySessionReviewId) {
    const user = await getAuthUser(request);
    const moderated = await moderateCoveredText({
      request,
      user,
      action: "upsert_session_review",
      subjectId: String(mySessionReviewId),
      body,
      context: { sessionId: Number(mySessionReviewId) }
    });
    jsonResponse(response, moderatedTextHttpStatus(moderated, 200), {
      ok: true,
      data: moderated ?? await upsertMySessionReview(user, mySessionReviewId, body)
    }, moderatedTextHeaders(moderated));
    return;
  }

  const moderatedSessionMessageId = idMatch(
    url.pathname,
    /^\/api\/sessions\/(\d+)\/messages$/
  );
  if (request.method === "POST" && moderatedSessionMessageId) {
    await getAuthUser(request);
  }
  const moderatedPinnedMessageId = idMatch(
    url.pathname,
    /^\/api\/sessions\/(\d+)\/chat\/pin$/
  );
  if (request.method === "PATCH" && moderatedPinnedMessageId) {
    await getAuthUser(request);
  }

  if (
    await routeExtensions({
      authorPrivateResponseHeaders,
      authorTextReader: authorTextProjectionReader,
      body,
      getAuthUser,
      idMatch,
      jsonResponse,
      moderateCoveredText,
      moderatedTextHeaders,
      moderatedTextHttpStatus,
      request,
      response,
      url
    })
  ) {
    return;
  }

  const cancelSessionId = idMatch(url.pathname, /^\/api\/sessions\/(\d+)\/cancel$/);
  if (request.method === "PATCH" && cancelSessionId) {
    const user = await getAuthUser(request);
    jsonResponse(response, 200, {
      ok: true,
      data: await cancelSession(user, cancelSessionId, body)
    });
    return;
  }

  const shareStatsSessionId = idMatch(
    url.pathname,
    /^\/api\/sessions\/(\d+)\/share-stats$/
  );
  if (request.method === "GET" && shareStatsSessionId) {
    jsonResponse(response, 200, {
      ok: true,
      data: await getSessionShareStats(shareStatsSessionId)
    });
    return;
  }

  const publishSessionId = idMatch(url.pathname, /^\/api\/sessions\/(\d+)\/publish$/);
  if (request.method === "POST" && publishSessionId) {
    const user = await getAuthUser(request);
    jsonResponse(response, 200, {
      ok: true,
      data: await publishSession(user, publishSessionId)
    });
    return;
  }

  const sessionSeatSessionId = idMatch(
    url.pathname,
    /^\/api\/sessions\/(\d+)\/seats$/
  );
  if (request.method === "POST" && sessionSeatSessionId) {
    const user = await getAuthUser(request);
    jsonResponse(response, 201, {
      ok: true,
      data: await createSeat(user, sessionSeatSessionId, body)
    });
    return;
  }

  const seatId = idMatch(url.pathname, /^\/api\/session-seats\/(\d+)$/);
  if (request.method === "PATCH" && seatId) {
    const user = await getAuthUser(request);
    jsonResponse(response, 200, { ok: true, data: await updateSeat(user, seatId, body) });
    return;
  }

  const lockSeatId = idMatch(url.pathname, /^\/api\/session-seats\/(\d+)\/lock$/);
  if (request.method === "POST" && lockSeatId) {
    const user = await getAuthUser(request);
    jsonResponse(response, 200, { ok: true, data: await lockSeat(user, lockSeatId) });
    return;
  }

  const claimSeatId = idMatch(url.pathname, /^\/api\/session-seats\/(\d+)\/claim$/);
  if (request.method === "POST" && claimSeatId) {
    const user = await getAuthUser(request);
    jsonResponse(response, 200, {
      ok: true,
      data: await claimSessionSeat(user, claimSeatId, body)
    });
    return;
  }

  const kickSeatId = idMatch(url.pathname, /^\/api\/session-seats\/(\d+)\/kick$/);
  if (request.method === "PATCH" && kickSeatId) {
    const user = await getAuthUser(request);
    jsonResponse(response, 200, {
      ok: true,
      data: await kickSessionSeat(user, kickSeatId, body)
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/signups") {
    const user = await getAuthUser(request);
    jsonResponse(response, 201, { ok: true, data: await createSignup(user, body) });
    return;
  }

  const hideSignupId = idMatch(url.pathname, /^\/api\/signups\/(\d+)\/hide$/);
  if (request.method === "PATCH" && hideSignupId) {
    const user = await getAuthUser(request);
    jsonResponse(response, 200, {
      ok: true,
      data: await hideMySignup(user, hideSignupId)
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/users/me/signups") {
    const user = await getAuthUser(request);
    jsonResponse(response, 200, { ok: true, data: await listMySignups(user) });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/users/me/sessions") {
    const user = await getAuthUser(request);
    const sessions = await listMySessions(
      user,
      Object.fromEntries(url.searchParams),
      { authorTextReader: authorTextProjectionReader }
    );
    jsonResponse(response, 200, {
      ok: true,
      data: sessions
    }, authorPrivateResponseHeaders(sessions));
    return;
  }

  const sessionSignupsId = idMatch(url.pathname, /^\/api\/sessions\/(\d+)\/signups$/);
  if (request.method === "GET" && sessionSignupsId) {
    const user = await getAuthUser(request);
    jsonResponse(response, 200, {
      ok: true,
      data: await listSessionSignups(user, sessionSignupsId)
    });
    return;
  }

  const approveSignupId = idMatch(url.pathname, /^\/api\/signups\/(\d+)\/approve$/);
  if (request.method === "PATCH" && approveSignupId) {
    const user = await getAuthUser(request);
    jsonResponse(response, 200, {
      ok: true,
      data: await approveSignup(user, approveSignupId)
    });
    return;
  }

  const rejectSignupId = idMatch(url.pathname, /^\/api\/signups\/(\d+)\/reject$/);
  if (request.method === "PATCH" && rejectSignupId) {
    const user = await getAuthUser(request);
    jsonResponse(response, 200, {
      ok: true,
      data: await rejectSignup(user, rejectSignupId)
    });
    return;
  }

  const depositSignupId = idMatch(url.pathname, /^\/api\/signups\/(\d+)\/deposit$/);
  if (request.method === "PATCH" && depositSignupId) {
    const user = await getAuthUser(request);
    jsonResponse(response, 200, {
      ok: true,
      data: await updateDeposit(user, depositSignupId, body)
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/share-events/view") {
    jsonResponse(response, 201, {
      ok: true,
      data: await createShareEvent("view", body)
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/share-events/convert") {
    const user = await optionalAuthUser(request);
    jsonResponse(response, 201, {
      ok: true,
      data: await createShareEvent("convert", {
        ...body,
        viewedUserId: body.viewedUserId || user?.user.id || null
      })
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/subscriptions/request-result") {
    const user = await getAuthUser(request);
    jsonResponse(response, 201, {
      ok: true,
      data: await createSubscriptionRequest(user, body)
    });
    return;
  }

  errorResponse(response, 404, "NOT_FOUND", "Route not found");
}

export function createApp() {
  return http.createServer((request, response) => {
    route(request, response).catch((error) => {
      if (error?.contentModerationDenied === true) {
        try {
          emitContentModerationEvent("moderation_access_denied", {
            provider: error.contentModerationProvider,
            subjectType: error.contentModerationSubjectType,
            outcome: "unpublished"
          });
        } catch {
          // Telemetry must not change the external 404 gate response.
        }
      }
      const normalized = normalizeError(error);
      errorResponse(
        response,
        normalized.statusCode,
        normalized.code,
        normalized.message,
        normalized.details
      );
    });
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const server = createApp();
  server.listen(config.port, () => {
    console.log(
      JSON.stringify({
        ok: true,
        service: "pinche-api",
        port: config.port,
        nodeEnv: config.nodeEnv
      })
    );
  });
}
