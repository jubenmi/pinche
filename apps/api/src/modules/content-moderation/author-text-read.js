import {
  createAuthorPrivateTextDto,
  isAuthorPrivateTextDto
} from "./author-dto.js";
import { resolveAuthorVisibility } from "./author-visibility.js";
import { projectAuthorTextProposal } from "./text-author-projection.js";

const PENDING_JOB_STATUSES = new Set(["pending", "processing", "review", "error"]);

export function authorPrivateTextActionEnabled(config, action) {
  if (config?.authorPrivateTextEnabled !== true) return false;
  const configured = config?.authorPrivateTextActions;
  const actions = configured instanceof Set
    ? configured
    : Array.isArray(configured)
      ? new Set(configured)
      : new Set();
  return actions.has(String(action || ""));
}

function positiveUserId(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function proposalModerationStatus(row) {
  const proposalStatus = String(row?.proposal_status || row?.status || "");
  const jobStatus = String(row?.job_status || "");
  if (proposalStatus === "pending" && PENDING_JOB_STATUSES.has(jobStatus)) return jobStatus;
  if (proposalStatus === "rejected" && jobStatus === "rejected") return "rejected";
  return null;
}

function parsedPayload(row) {
  try {
    const value = typeof row?.normalized_payload_json === "string"
      ? JSON.parse(row.normalized_payload_json)
      : row?.normalized_payload_json;
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

export function createAuthorTextProjectionReader({ config, repository } = {}) {
  if (typeof repository?.findLatestAuthorTextProposal !== "function") {
    throw new TypeError("author text projection repository is required");
  }

  async function find(connection, { userId, action, targetSubjectId } = {}) {
    const authorId = positiveUserId(userId);
    const normalizedAction = String(action || "");
    const target = String(targetSubjectId || "");
    if (
      authorId === null ||
      !target ||
      !authorPrivateTextActionEnabled(config, normalizedAction)
    ) return null;

    const row = await repository.findLatestAuthorTextProposal(connection, {
      userId: authorId,
      action: normalizedAction,
      targetSubjectId: target
    });
    const moderationStatus = proposalModerationStatus(row);
    if (
      !row ||
      moderationStatus === null ||
      Number(row.created_by_user_id) !== authorId ||
      String(row.action || "") !== normalizedAction ||
      String(row.target_subject_id || "") !== target ||
      Number(row.author_visibility_version) !== 1
    ) return null;

    const payload = parsedPayload(row);
    if (
      !payload ||
      Number(payload.actor_user_id) !== authorId ||
      String(payload?.context?.targetSubjectId || "") !== target ||
      !payload.body ||
      typeof payload.body !== "object" ||
      Array.isArray(payload.body)
    ) return null;

    const visibility = resolveAuthorVisibility({
      viewerUserId: authorId,
      authorUserId: row.created_by_user_id,
      moderationStatus,
      authorVisibilityVersion: Number(row.author_visibility_version),
      recordStatus: "active",
      contentKind: "text"
    });
    if (visibility.scope !== "author_only") return null;

    try {
      const projection = projectAuthorTextProposal({
        action: normalizedAction,
        targetSubjectId: target,
        body: payload.body
      });
      return createAuthorPrivateTextDto({
        draftId: row.id,
        action: normalizedAction,
        moderationStatus,
        publishedId: projection.publishedId,
        content: projection.content,
        visibility
      });
    } catch {
      return null;
    }
  }

  return { find };
}

export function mergeAuthorTextProjection(entity, projection) {
  if (!isAuthorPrivateTextDto(projection)) return entity;
  const base = entity && typeof entity === "object" && !Array.isArray(entity) ? entity : {};
  return {
    ...base,
    ...projection.content,
    author_private: projection
  };
}
