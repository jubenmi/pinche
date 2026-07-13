import { normalizeTextFields } from "./normalize.js";
import { textMutationSubjectVersion } from "./text-request-identity.js";
import { buildTextModerationDescriptor } from "./text-boundaries.js";
import { textProposalPayloadDigest } from "./text-proposal-digest.js";

const TEXT_SCENE_BY_SUBJECT = Object.freeze({
  user_nickname: 1,
  private_store: 1,
  private_script: 1,
  session_review: 2,
  session_message: 2,
  session_pinned_message: 2,
  forum_post: 3,
  session_create: 4,
  session_update: 4,
  session_npc_role: 4
});

function parsedProposalPayload(proposal) {
  try {
    const parsed = typeof proposal?.normalized_payload_json === "string"
      ? JSON.parse(proposal.normalized_payload_json)
      : proposal?.normalized_payload_json;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const allowedKeys = new Set(["body", "context", "actor_user_id"]);
    if (Object.keys(parsed).some((key) => !allowedKeys.has(key))) return null;
    const actorUserId = Number(proposal?.created_by_user_id);
    if (!Number.isInteger(actorUserId) || Number(parsed.actor_user_id) !== actorUserId) return null;
    const body = parsed.body && typeof parsed.body === "object" && !Array.isArray(parsed.body)
      ? parsed.body
      : {};
    const context = parsed.context && typeof parsed.context === "object" && !Array.isArray(parsed.context)
      ? parsed.context
      : {};
    return { body, context, normalizedPayload: { body, context, actor_user_id: actorUserId } };
  } catch {
    return null;
  }
}

export function buildTextRetryDescriptor({ job, proposal, actorOpenid } = {}) {
  const payload = parsedProposalPayload(proposal);
  const actorUserId = Number(proposal?.created_by_user_id);
  const scene = TEXT_SCENE_BY_SUBJECT[String(job?.subject_type || "")];
  if (
    !payload ||
    !scene ||
    String(job?.provider || "") !== "wechat_sec_check" ||
    !Number.isInteger(actorUserId) || actorUserId <= 0 ||
    !String(actorOpenid || "").trim() ||
    String(proposal?.subject_type || "") !== String(job?.subject_type || "") ||
    String(proposal?.subject_id || "") !== String(job?.subject_id || "")
  ) {
    return null;
  }
  try {
    const descriptor = buildTextModerationDescriptor({
      action: proposal.action,
      subjectId: job.subject_id,
      actorUserId,
      openid: actorOpenid,
      baseVersion: proposal.base_version,
      idempotencyKey: proposal.idempotency_key,
      body: payload.body,
      context: payload.context
    });
    if (
      !descriptor ||
      descriptor.subjectType !== String(job.subject_type) ||
      descriptor.subjectId !== String(job.subject_id)
    ) {
      return null;
    }
    const normalizedText = normalizeTextFields(descriptor.fields);
    if (textMutationSubjectVersion({ normalizedText }) !== String(job.subject_version || "")) {
      return null;
    }
    const payloadDigest = textProposalPayloadDigest({
      action: proposal.action,
      baseVersion: proposal.base_version,
      normalizedText,
      normalizedPayload: payload.normalizedPayload
    });
    if (payloadDigest !== String(proposal.payload_digest || "")) return null;
    return {
      normalizedText,
      openid: descriptor.openid,
      scene,
      expectedText: {
        jobId: Number(job.id),
        proposalId: Number(proposal.id),
        subjectType: String(job.subject_type),
        subjectId: String(job.subject_id),
        subjectVersion: String(job.subject_version),
        action: String(proposal.action),
        actorUserId,
        baseVersion: String(proposal.base_version),
        idempotencyKey: String(proposal.idempotency_key),
        payloadDigest: String(proposal.payload_digest)
      }
    };
  } catch {
    return null;
  }
}

function requiredRuntimeMethod(runtime, name) {
  if (typeof runtime?.[name] !== "function") {
    const error = new Error("content moderation retry runtime is unavailable");
    error.code = "CONTENT_MODERATION_CONFIGURATION_ERROR";
    throw error;
  }
  return runtime[name].bind(runtime);
}

function invalidRetryFactsError() {
  const error = new Error("content moderation retry facts are invalid");
  error.code = "CONTENT_MODERATION_RETRY_FACTS_INVALID";
  return error;
}

export function createContentModerationRetryProcessor({
  repository,
  withTransaction,
  contentModerationRuntime
} = {}) {
  if (!repository || typeof repository.rehydrateModerationRetryJob !== "function") {
    throw new TypeError("repository.rehydrateModerationRetryJob is required");
  }
  if (typeof withTransaction !== "function") throw new TypeError("withTransaction is required");

  return {
    async processJob(job) {
      const jobId = Number(job?.id);
      const leaseToken = String(job?.lease_token || "");
      if (!Number.isInteger(jobId) || jobId <= 0 || !leaseToken) {
        const error = new Error("content moderation retry job is stale");
        error.code = "CONTENT_MODERATION_SUBMISSION_STALE";
        throw error;
      }
      const retry = await withTransaction((connection) => repository.rehydrateModerationRetryJob(
        connection,
        { jobId, leaseToken }
      ));
      if (!retry) return { kind: "stale" };

      if (retry.kind === "text") {
        const text = buildTextRetryDescriptor(retry);
        // A missing descriptor after a successful leased rehydration means that
        // persisted facts no longer form a valid retry request.  It is not a
        // lease loss: surface the safe terminal code so the worker records the
        // failure instead of silently leaving the job claimable forever.
        if (!text) throw invalidRetryFactsError();
        return requiredRuntimeMethod(contentModerationRuntime, "retryTextModeration")({
          job: retry.job,
          proposal: retry.proposal,
          normalizedText: text.normalizedText,
          openid: text.openid,
          scene: text.scene,
          leaseToken,
          expectedText: text.expectedText
        });
      }
      if (retry.kind === "wechat_image") {
        return requiredRuntimeMethod(contentModerationRuntime, "submitWechatImageModeration")({
          ...retry.job,
          objectKey: retry.objectKey,
          uploaderUserId: retry.uploaderUserId,
          leaseToken,
          retryFacts: retry.retryFacts
        });
      }
      if (retry.kind === "tencent_video") {
        return requiredRuntimeMethod(contentModerationRuntime, "submitVideoJob")({
          ...retry.job,
          objectKey: retry.objectKey,
          uploaderUserId: retry.uploaderUserId,
          leaseToken,
          retryFacts: retry.retryFacts
        });
      }
      throw invalidRetryFactsError();
    }
  };
}
