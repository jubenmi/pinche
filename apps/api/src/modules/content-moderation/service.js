import crypto from "node:crypto";

import {
  createResponseSummary,
  normalizeTextFields
} from "./normalize.js";
import { buildTextProposalPayload } from "./text-boundaries.js";
import { projectSafeTextAppliedResult } from "./text-applied-result.js";
import { proposalStaleForRevalidationError } from "./text-proposal-applicator.js";
import { textProposalPayloadDigest } from "./text-proposal-digest.js";
import { classifyModerationError, moderationRetryAt } from "./retry.js";
import {
  textMutationSubjectVersion,
  textOperationSubjectId
} from "./text-request-identity.js";
import { MODERATION_ERROR_CODES, MODERATION_RETRY_LEASE_MIN_MS } from "./constants.js";
import { moderationStatusForDecision } from "./state-machine.js";

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

const TEXT_DECISION_BY_SUGGESTION = Object.freeze({
  pass: "pass",
  review: "review",
  risky: "block"
});

function boundedString(value, maxLength = 128) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function exactBoundedString(value, maxLength = 128) {
  const text = String(value ?? "").trim();
  return text && text.length <= maxLength ? text : "";
}

function textModerationError(statusCode, code, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function normalizeWechatTextResult(result) {
  const suggestion = boundedString(result?.suggestion, 32).toLowerCase();
  return {
    decision: TEXT_DECISION_BY_SUGGESTION[suggestion] || "error",
    suggestion,
    label: boundedString(result?.label, 64),
    score: Number.isFinite(Number(result?.score))
      ? Math.max(0, Math.min(100, Math.round(Number(result.score))))
      : null
  };
}

function boundedRetryLimit(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 20 ? parsed : 8;
}

function nowMilliseconds(now) {
  const value = typeof now === "function" ? now() : Date.now();
  const milliseconds = value instanceof Date ? value.getTime() : Number(value);
  return Number.isFinite(milliseconds) ? milliseconds : Date.now();
}

function providerErrorRetryState(job, config, now, random) {
  const recordedAttempts = Number(job?.attempt_count);
  const attempts = Number.isInteger(recordedAttempts) && recordedAttempts > 0
    ? recordedAttempts
    : 1;
  const exhausted = attempts >= boundedRetryLimit(config?.retryLimit);
  return {
    nextRetryAt: exhausted
      ? null
      : moderationRetryAt(nowMilliseconds(now), attempts, typeof random === "function" ? random : Math.random),
    exhausted
  };
}

function initialSubmissionFailurePlan(job, config, now, random, error) {
  const recordedAttempts = Number(job?.attempt_count);
  const attempts = (Number.isInteger(recordedAttempts) && recordedAttempts >= 0 ? recordedAttempts : 0) + 1;
  const classification = classifyModerationError(error);
  const exhausted = attempts >= boundedRetryLimit(config?.retryLimit) || !classification.retryable;
  return {
    attempts,
    errorCode: classification.code,
    alert: classification.alert,
    retry: {
      attempts,
      nextRetryAt: exhausted
        ? null
        : moderationRetryAt(nowMilliseconds(now), attempts, typeof random === "function" ? random : Math.random),
      exhausted
    }
  };
}

function submissionStaleError() {
  const error = new Error("content moderation submission lease is no longer live");
  error.code = "CONTENT_MODERATION_SUBMISSION_STALE";
  return error;
}

function isSubmissionStale(error) {
  return String(error?.code || "") === "CONTENT_MODERATION_SUBMISSION_STALE";
}

function retryTextIdentityMatches(job, proposal, expected) {
  if (!expected) return true;
  return (
    Number(job?.id) === Number(expected.jobId) &&
    String(job?.provider || "") === "wechat_sec_check" &&
    String(job?.subject_type || "") === String(expected.subjectType || "") &&
    String(job?.subject_id || "") === String(expected.subjectId || "") &&
    String(job?.subject_version || "") === String(expected.subjectVersion || "") &&
    Number(proposal?.id) === Number(expected.proposalId) &&
    String(proposal?.status || "") === "pending" &&
    String(proposal?.subject_type || "") === String(job?.subject_type || "") &&
    String(proposal?.subject_id || "") === String(job?.subject_id || "") &&
    String(proposal?.action || "") === String(expected.action || "") &&
    Number(proposal?.created_by_user_id) === Number(expected.actorUserId) &&
    String(proposal?.base_version || "") === String(expected.baseVersion || "") &&
    String(proposal?.idempotency_key || "") === String(expected.idempotencyKey || "") &&
    String(proposal?.payload_digest || "") === String(expected.payloadDigest || "")
  );
}

function retryTextPayloadDigestMatches(proposal, normalizedText) {
  try {
    const parsed = typeof proposal?.normalized_payload_json === "string"
      ? JSON.parse(proposal.normalized_payload_json)
      : proposal?.normalized_payload_json;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false;
    const actorUserId = Number(proposal?.created_by_user_id);
    if (!Number.isInteger(actorUserId) || actorUserId <= 0) return false;
    const allowedKeys = new Set(["body", "context", "actor_user_id"]);
    if (
      Object.keys(parsed).some((key) => !allowedKeys.has(key)) ||
      Number(parsed.actor_user_id) !== actorUserId
    ) return false;
    const normalizedPayload = {
      body: parsed.body && typeof parsed.body === "object" && !Array.isArray(parsed.body)
        ? parsed.body
        : {},
      context: parsed.context && typeof parsed.context === "object" && !Array.isArray(parsed.context)
        ? parsed.context
        : {},
      actor_user_id: actorUserId
    };
    return textProposalPayloadDigest({
      action: proposal.action,
      baseVersion: proposal.base_version,
      normalizedText,
      normalizedPayload
    }) === String(proposal.payload_digest || "");
  } catch {
    return false;
  }
}

function replayErrorForStatus(status) {
  if (status === "review") {
    return textModerationError(
      202,
      MODERATION_ERROR_CODES.reviewPending,
      "content is pending further moderation"
    );
  }
  if (status === "rejected") {
    return textModerationError(
      422,
      MODERATION_ERROR_CODES.rejected,
      "content did not pass moderation"
    );
  }
  return textModerationError(
    503,
    MODERATION_ERROR_CODES.unavailable,
    "content moderation is temporarily unavailable"
  );
}

function parseAppliedResult(proposal) {
  const raw = proposal?.applied_result_json;
  if (!raw) return null;
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    return projectSafeTextAppliedResult(parsed, { rejectUnknownKeys: true });
  } catch {
    return null;
  }
}

function requireSafeAppliedResult(result) {
  const safe = projectSafeTextAppliedResult(result);
  if (safe) return safe;
  throw textModerationError(
    500,
    MODERATION_ERROR_CODES.configuration,
    "text moderation proposal applicator did not return a safe replay identity"
  );
}

function preparedTerminalTextOutcome(job, proposal) {
  if (!job || !proposal || proposal.status === "stale") return { kind: "stale" };
  if (job.status === "approved") {
    if (proposal.status !== "approved") return { kind: "stale" };
    const result = parseAppliedResult(proposal);
    return result ? { kind: "replay", result } : { kind: "stale" };
  }
  if (["review", "rejected"].includes(job.status)) {
    return { kind: "error", status: job.status };
  }
  return null;
}

function returnPreparedTerminalTextOutcome(outcome) {
  if (!outcome) return null;
  if (outcome.kind === "replay") return outcome.result;
  if (outcome.kind === "stale") {
    throw textModerationError(
      409,
      MODERATION_ERROR_CODES.proposalStale,
      "text moderation proposal is stale"
    );
  }
  throw replayErrorForStatus(outcome.status);
}

export function createContentModerationService(dependencies) {
  const deps = {
    randomUUID: () => crypto.randomUUID(),
    now: () => Date.now(),
    random: Math.random,
    emit: () => {},
    ...dependencies
  };

  async function claimInitialSubmissionLease(connection, job) {
    const leaseToken = deps.randomUUID();
    const acquired = await deps.repository.claimInitialModerationLease(connection, {
      jobId: job.id,
      leaseToken,
      leaseExpiresAt: new Date(nowMilliseconds(deps.now) + MODERATION_RETRY_LEASE_MIN_MS)
    });
    return {
      initialLeaseAcquired: acquired,
      initialLeaseToken: acquired ? leaseToken : null
    };
  }

  async function requireLiveSubmissionLease({ jobId, leaseToken, fromStatus }) {
    const token = String(leaseToken || "").trim();
    if (!token) throw submissionStaleError();
    const current = await deps.withDatabaseConnection((connection) =>
      deps.repository.findModerationJobById(connection, jobId, {
        forUpdate: true,
        leaseToken: token
      })
    );
    if (!current || String(current.status) !== String(fromStatus)) throw submissionStaleError();
    return current;
  }

  async function renewSubmissionLease({ jobId, leaseToken, fromStatus }) {
    const token = String(leaseToken || "").trim();
    if (!token) throw submissionStaleError();
    const renewed = await deps.withDatabaseConnection((connection) =>
      deps.repository.renewModerationLease(connection, {
        jobId,
        leaseToken: token,
        fromStatus,
        leaseDurationMs: MODERATION_RETRY_LEASE_MIN_MS
      })
    );
    if (!renewed) throw submissionStaleError();
  }

  async function recordLeasedSubmissionFailure({ job, leaseToken, subjectType, error }) {
    const plan = initialSubmissionFailurePlan(job, deps.config, deps.now, deps.random, error);
    const changed = await deps.withDatabaseConnection((connection) =>
      deps.repository.failModerationJob(connection, {
        jobId: job?.id,
        leaseToken,
        attempts: plan.attempts,
        nextRetryAt: plan.retry.nextRetryAt,
        errorCode: plan.errorCode,
        exhausted: plan.retry.exhausted
      })
    );
    if (changed) {
      const event = plan.alert
        ? "moderation_operational_alert"
        : plan.retry.exhausted
          ? "moderation_retry_exhausted"
          : "moderation_submission_failure";
      deps.emit(event, {
        subjectType,
        outcome: plan.retry.exhausted ? "operator_required" : "retry_scheduled",
        errorCode: plan.errorCode,
        ...(plan.alert || plan.retry.exhausted ? { priority: "high" } : {})
      });
    }
    return { changed, plan };
  }

  async function createVideoJob(connection, input) {
    const job = await deps.repository.createModerationJob(connection, {
      subjectType: "album_video",
      subjectId: String(input.media.id),
      subjectVersion: String(input.subjectVersion),
      provider: "tencent_ci_video",
      dataId: deps.randomUUID(),
      policyId: deps.config.tencentVideoPolicyId
    });
    const initialLease = await claimInitialSubmissionLease(connection, job);
    if (!initialLease.initialLeaseAcquired) return null;
    return {
      ...job,
      ...initialLease,
      kind: "video",
      objectKey: String(input.objectKey),
      dataId: job.data_id || job.dataId,
      status: job.status || "pending"
    };
  }

  async function submitVideoJob(job) {
    const fromStatus = job?.status || "pending";
    const retrySubmission = Boolean(job?.retryFacts);
    const leaseToken = retrySubmission
      ? job?.leaseToken ?? job?.lease_token ?? null
      : job?.initialLeaseAcquired === true
        ? job?.initialLeaseToken
        : null;
    if (!leaseToken) throw submissionStaleError();
    try {
      await renewSubmissionLease({ jobId: job.id, leaseToken, fromStatus });
      const response = await deps.client.submitVideo({
        objectKey: job.objectKey,
        dataId: job.data_id || job.dataId
      });
      const recorded = await deps.transaction((connection) =>
        deps.repository.recordModerationSubmission(connection, {
          jobId: job.id,
          provider: "tencent_ci_video",
          providerJobId: response.JobId,
          fromStatus,
          leaseToken,
          ...(job?.retryFacts ? { retryFacts: job.retryFacts } : {}),
          responseSummary: {
            providerJobId: response.JobId || ""
          }
        })
      );
      if (!recorded) {
        const error = new Error("moderation submission changed before its provider attempt was recorded");
        error.code = "CONTENT_MODERATION_SUBMISSION_STALE";
        throw error;
      }
      deps.emit("moderation_submission_success", {
        subjectType: "album_video",
        outcome: "processing"
      });
      return response;
    } catch (error) {
      // A retry worker still owns this live lease.  It must be the component
      // that records backoff/exhaustion atomically with that lease; changing
      // the job here would clear the token before failModerationJob can do so.
      if (retrySubmission || isSubmissionStale(error)) throw error;
      await recordLeasedSubmissionFailure({
        job,
        leaseToken,
        subjectType: "album_video",
        error
      });
      throw error;
    }
  }

  async function createWechatImageModerationJob(connection, input) {
    const mediaId = Number(input?.media?.id);
    const uploaderUserId = Number(
      input?.media?.uploader_user_id ?? input?.media?.uploaderUserId
    );
    const objectKey = exactBoundedString(input?.objectKey, 1024);
    const subjectVersion = exactBoundedString(input?.subjectVersion, 512);
    if (!Number.isInteger(mediaId) || mediaId <= 0 || !Number.isInteger(uploaderUserId) ||
      uploaderUserId <= 0 || !objectKey || !subjectVersion) {
      throw textModerationError(
        500,
        MODERATION_ERROR_CODES.configuration,
        "image moderation job facts are incomplete"
      );
    }
    const job = await deps.repository.createModerationJob(connection, {
      subjectType: "album_image",
      subjectId: String(mediaId),
      subjectVersion,
      provider: "wechat_sec_check",
      dataId: deps.randomUUID(),
      policyId: null
    });
    const initialLease = await claimInitialSubmissionLease(connection, job);
    if (!initialLease.initialLeaseAcquired) return null;
    return {
      ...job,
      ...initialLease,
      kind: "wechat_image",
      objectKey,
      uploaderUserId,
      status: job.status || "pending"
    };
  }

  async function submitWechatImageModeration(job) {
    const fromStatus = job?.status || "pending";
    const retrySubmission = Boolean(job?.retryFacts);
    const leaseToken = retrySubmission
      ? job?.leaseToken ?? job?.lease_token ?? null
      : job?.initialLeaseAcquired === true
        ? job?.initialLeaseToken
        : null;
    if (!leaseToken) throw submissionStaleError();
    try {
      await requireLiveSubmissionLease({ jobId: job.id, leaseToken, fromStatus });
      if (typeof deps.getVerifiedImageUploaderOpenid !== "function") {
        throw textModerationError(
          500,
          MODERATION_ERROR_CODES.configuration,
          "verified image uploader lookup is missing"
        );
      }
      if (typeof deps.buildWechatImageUrl !== "function") {
        throw textModerationError(
          500,
          MODERATION_ERROR_CODES.configuration,
          "WeChat image URL builder is missing"
        );
      }
      if (typeof deps.client?.checkImage !== "function") {
        throw textModerationError(
          500,
          MODERATION_ERROR_CODES.configuration,
          "WeChat image moderation client is missing"
        );
      }

      const openid = boundedString(await deps.getVerifiedImageUploaderOpenid({
        uploaderUserId: job?.uploaderUserId
      }), 128);
      if (!openid) {
        throw textModerationError(
          422,
          MODERATION_ERROR_CODES.openidRequired,
          "a verified image uploader openid is required"
        );
      }
      // Database identity lookup and COS signing can block independently of
      // the provider request. Renew before issuing the short-lived URL so an
      // expired initial/worker lease cannot sign or submit a duplicate WeChat
      // moderation request, and the URL fetch window starts at submission.
      await renewSubmissionLease({ jobId: job.id, leaseToken, fromStatus });
      const mediaUrl = await deps.buildWechatImageUrl({ objectKey: job?.objectKey });
      const response = await deps.client.checkImage({ mediaUrl, openid, scene: 4 });
      const traceId = boundedString(response?.traceId, 128);
      if (!traceId) {
        throw textModerationError(
          502,
          MODERATION_ERROR_CODES.unavailable,
          "WeChat image moderation did not return a trace id"
        );
      }
      const submitted = await deps.transaction((connection) =>
        deps.repository.recordModerationSubmission(connection, {
          jobId: job.id,
          provider: "wechat_sec_check",
          providerJobId: traceId,
          fromStatus,
          leaseToken,
          ...(job?.retryFacts ? { retryFacts: job.retryFacts } : {}),
          responseSummary: { traceId }
        })
      );
      if (!submitted) {
        throw textModerationError(
          409,
          MODERATION_ERROR_CODES.callbackStale,
          "WeChat image moderation job changed before submission"
        );
      }
      deps.emit("moderation_submission_success", {
        subjectType: "album_image",
        outcome: "processing"
      });
      return { traceId };
    } catch (error) {
      // See submitVideoJob: a claimed retry leaves its lease intact for the
      // worker's single failure transition and alert decision.
      if (retrySubmission || isSubmissionStale(error)) throw error;
      await recordLeasedSubmissionFailure({
        job,
        leaseToken,
        subjectType: "album_image",
        error
      });
      throw error;
    }
  }

  function staleCallback(message) {
    const error = new Error(message);
    error.code = "CONTENT_MODERATION_CALLBACK_STALE";
    return error;
  }

  function staleResult(job, extra = {}) {
    return {
      status: job?.status || null,
      stale: true,
      duplicate: false,
      ...extra
    };
  }

  async function applyMediaResult(input) {
    return deps.transaction(async (connection) => {
      const job = await deps.repository.findModerationJobById(
        connection,
        input.jobId,
        { forUpdate: true }
      );
      if (!job) return staleResult(null);
      const provider = String(input.provider || "").trim();
      const providerJobId = String(input.providerJobId || "").trim();
      if (!provider || !providerJobId || provider !== String(job.provider)) {
        return staleResult(job);
      }
      const attempt = await deps.repository.findModerationAttemptByProviderJobId(
        connection,
        provider,
        providerJobId,
        { forUpdate: true }
      );
      const currentAttempt = await deps.repository.findCurrentModerationAttempt(
        connection,
        job.id,
        { forUpdate: true }
      );
      if (
        !attempt ||
        Number(attempt.moderation_job_id) !== Number(job.id) ||
        Number(attempt.is_current) !== 1 ||
        !currentAttempt ||
        Number(currentAttempt.id) !== Number(attempt.id)
      ) {
        return staleResult(job);
      }
      const nextStatus = moderationStatusForDecision(input.result?.decision || "error");
      const retry = nextStatus === "error"
        ? providerErrorRetryState(job, deps.config, deps.now, deps.random)
        : null;
      if (job.decided_by_admin_user_id !== null && job.decided_by_admin_user_id !== undefined) {
        return staleResult(job, { adminDecided: true });
      }
      if (["approved", "rejected", "review"].includes(job.status)) {
        return {
          status: job.status,
          duplicate: job.status === nextStatus,
          stale: job.status !== nextStatus
        };
      }
      if (String(job.subject_version) !== String(input.subjectVersion)) {
        return staleResult(job);
      }
      const media = await deps.repository.findModerationMedia(connection, job, { forUpdate: true });
      if (!media || media.status !== "active") return staleResult(job);
      if (
        media.moderation_object_version &&
        String(media.moderation_object_version) !== String(job.subject_version)
      ) {
        return staleResult(job);
      }
      const currentObjectKey = String(
        job.subject_type === "album_image" ? media.object_key : media.source_url
      ).replace(/^\//, "");
      if (
        provider === "wechat_sec_check" &&
        (
          String(job.subject_type) !== "album_image" ||
          !/^uploads\/session-album\/display\/[A-Za-z0-9._/-]+$/.test(currentObjectKey)
        )
      ) {
        return staleResult(job);
      }
      if (
        provider !== "wechat_sec_check" &&
        currentObjectKey !== String(input.objectKey).replace(/^\//, "")
      ) {
        return staleResult(job);
      }
      const changed = await deps.repository.transitionModerationJob(connection, {
        jobId: job.id,
        fromStatus: job.status,
        toStatus: nextStatus,
        source: "provider",
        decidedByAdminUserId: job.decided_by_admin_user_id,
        result: input.result,
        responseSummary: createResponseSummary(input.result),
        errorCode: nextStatus === "error" ? "CONTENT_MODERATION_INVALID_RESPONSE" : null,
        ...(retry ? { retry } : {})
      });
      if (!changed) return staleResult(job);
      const mediaChanged = await deps.repository.transitionMediaModeration(connection, {
        mediaId: media.id,
        fromStatuses: ["pending", "error"],
        toStatus: nextStatus
      });
      if (!mediaChanged) throw staleCallback("moderation media changed concurrently");
      if (nextStatus === "rejected") {
        await deps.repository.enqueueRejectedMediaCleanup(connection, media);
      }
      deps.emit(`moderation_decision_${input.result.decision}`, {
        subjectType: job.subject_type,
        outcome: nextStatus
      });
      if (retry) {
        deps.emit(retry.exhausted ? "moderation_retry_exhausted" : "moderation_submission_failure", {
          subjectType: job.subject_type,
          outcome: retry.exhausted ? "operator_required" : "retry_scheduled",
          errorCode: "CONTENT_MODERATION_INVALID_RESPONSE",
          ...(retry.exhausted ? { priority: "high" } : {})
        });
      }
      return { status: nextStatus, duplicate: false };
    });
  }

  function publicModerationError(statusCode, code, message) {
    const error = new Error(message);
    error.statusCode = statusCode;
    error.code = code;
    return error;
  }

  function textSceneForSubject(subjectType) {
    const scene = TEXT_SCENE_BY_SUBJECT[String(subjectType || "")];
    if (!scene) throw new TypeError("unsupported text moderation subject type");
    return scene;
  }

  async function prepareTextProposal(input) {
    const subjectType = boundedString(input?.subjectType, 64);
    const subjectId = boundedString(input?.subjectId, 128);
    const action = boundedString(input?.action, 128);
    const baseVersion = boundedString(input?.baseVersion, 128);
    const idempotencyKey = boundedString(input?.idempotencyKey, 128);
    const actorUserId = Number(input?.actorUserId);
    const openid = boundedString(input?.openid, 128);
    if (!openid) {
      throw textModerationError(
        422,
        MODERATION_ERROR_CODES.openidRequired,
        "a verified content producer openid is required"
      );
    }
    if (!subjectType || !subjectId || !action || !baseVersion || !idempotencyKey || !Number.isInteger(actorUserId) || actorUserId <= 0) {
      throw textModerationError(
        400,
        "BAD_REQUEST",
        "text moderation request is incomplete"
      );
    }
    const scene = textSceneForSubject(subjectType);
    const normalizedText = normalizeTextFields(input.fields);
    const subjectVersion = textMutationSubjectVersion({ normalizedText });
    const operationSubjectId = textOperationSubjectId({
      action,
      actorUserId,
      idempotencyKey
    });
    const payload = input.payload && typeof input.payload === "object" && !Array.isArray(input.payload)
      ? input.payload
      : {};
    const normalizedPayload = {
      ...buildTextProposalPayload(action, payload),
      actor_user_id: actorUserId
    };
    const payloadDigest = textProposalPayloadDigest({
      action,
      baseVersion,
      normalizedText,
      normalizedPayload
    });

    const prepared = await deps.transaction(async (connection) => {
      const job = await deps.repository.createModerationJob(connection, {
        subjectType,
        subjectId: operationSubjectId,
        subjectVersion,
        provider: "wechat_sec_check",
        dataId: deps.randomUUID(),
        policyId: null
      });
      await deps.repository.createTextProposal(connection, {
        jobId: job.id,
        subjectType,
        subjectId: operationSubjectId,
        baseVersion,
        action,
        normalizedPayload,
        payloadDigest,
        idempotencyKey,
        allowStaleIdempotencyReplay: input?.idempotencyExplicit === true,
        userId: actorUserId
      });
      const proposal = await deps.repository.findTextProposalByJobId(
        connection,
        job.id,
        { forUpdate: true }
      );
      if (!proposal) {
        throw textModerationError(
          500,
          MODERATION_ERROR_CODES.configuration,
          "text moderation proposal was not persisted"
        );
      }
      const initialLease = await claimInitialSubmissionLease(connection, job);
      return { job: { ...job, ...initialLease }, proposal };
    });

    return {
      ...prepared,
      subjectType,
      subjectId: operationSubjectId,
      action,
      scene,
      openid,
      normalizedText
    };
  }

  async function resolveTextResult(prepared, providerResult, options = {}) {
    const result = normalizeWechatTextResult(providerResult);
    const final = await deps.transaction(async (connection) => {
      const job = await deps.repository.findModerationJobById(
        connection,
        prepared.job.id,
        {
          forUpdate: true,
          ...(options.leaseToken !== null && options.leaseToken !== undefined
            ? { leaseToken: options.leaseToken }
            : {})
        }
      );
      const proposal = await deps.repository.findTextProposalByJobId(
        connection,
        prepared.job.id,
        { forUpdate: true }
      );
      if (!job || !proposal) {
        if (options.returnOutcome) return { kind: "stale" };
        throw textModerationError(
          409,
          MODERATION_ERROR_CODES.proposalStale,
          "text moderation proposal is stale"
        );
      }
      if (!retryTextIdentityMatches(job, proposal, options.expectedText)) {
        return { kind: "stale" };
      }
      if (options.expectedText && !retryTextPayloadDigestMatches(proposal, prepared.normalizedText)) {
        return { kind: "stale" };
      }
      if (proposal.status === "stale") return { kind: "stale" };
      if (job.status === "approved" && proposal.status === "approved") {
        const replayResult = parseAppliedResult(proposal);
        if (!replayResult) return { kind: "stale" };
        return { kind: "replay", result: replayResult };
      }
      if (job.decided_by_admin_user_id !== null) {
        throw textModerationError(
          409,
          MODERATION_ERROR_CODES.proposalStale,
          "text moderation proposal is stale"
        );
      }
      if (["review", "rejected"].includes(job.status)) {
        return { kind: "error", status: job.status };
      }
      if (!["pending", "error"].includes(job.status)) {
        return { kind: "error", status: "error" };
      }
      const nextStatus = moderationStatusForDecision(result.decision);
      if (nextStatus === job.status) {
        return { kind: "error", status: job.status };
      }
      if (nextStatus === "approved") {
        if (typeof deps.applyTextProposal !== "function") {
          throw textModerationError(
            500,
            MODERATION_ERROR_CODES.configuration,
            "text moderation proposal applicator is missing"
          );
        }
        let appliedResult;
        let safeAppliedResult;
        try {
          appliedResult = await deps.applyTextProposal(connection, { job, proposal });
          safeAppliedResult = requireSafeAppliedResult(appliedResult);
        } catch (error) {
          const staleError = proposalStaleForRevalidationError(error) || error;
          if (staleError?.code !== MODERATION_ERROR_CODES.proposalStale) throw error;
          const proposalChanged = await deps.repository.markTextProposalStale(connection, {
            jobId: job.id,
            fromStatus: proposal.status
          });
          if (!proposalChanged) {
            throw textModerationError(
              409,
              MODERATION_ERROR_CODES.proposalStale,
              "text moderation proposal changed concurrently"
            );
          }
          const jobChanged = await deps.repository.transitionModerationJob(connection, {
            jobId: job.id,
            fromStatus: job.status,
            toStatus: "rejected",
            source: "provider",
            leaseToken: options.leaseToken,
            result,
            responseSummary: createResponseSummary(result),
            errorCode: MODERATION_ERROR_CODES.proposalStale
          });
          if (!jobChanged) {
            throw textModerationError(
              409,
              MODERATION_ERROR_CODES.proposalStale,
              "text moderation job changed concurrently"
            );
          }
          return { kind: "stale" };
        }
        const proposalChanged = await deps.repository.markTextProposalStatus(connection, {
          jobId: job.id,
          fromStatus: proposal.status,
          toStatus: "approved",
          appliedResult: safeAppliedResult
        });
        if (!proposalChanged) {
          throw textModerationError(
            409,
            MODERATION_ERROR_CODES.proposalStale,
            "text moderation proposal changed concurrently"
          );
        }
        const jobChanged = await deps.repository.transitionModerationJob(connection, {
          jobId: job.id,
          fromStatus: job.status,
          toStatus: "approved",
          source: "provider",
          leaseToken: options.leaseToken,
          result,
          responseSummary: createResponseSummary(result)
        });
        if (!jobChanged) {
          throw textModerationError(
            409,
            MODERATION_ERROR_CODES.proposalStale,
            "text moderation job changed concurrently"
          );
        }
        return { kind: "approved", result: appliedResult };
      }

      if (nextStatus === "rejected") {
        const proposalChanged = await deps.repository.markTextProposalStatus(connection, {
          jobId: job.id,
          fromStatus: proposal.status,
          toStatus: "rejected"
        });
        if (!proposalChanged) {
          throw textModerationError(409, MODERATION_ERROR_CODES.proposalStale, "text moderation proposal changed concurrently");
        }
      }
      const jobChanged = await deps.repository.transitionModerationJob(connection, {
        jobId: job.id,
        fromStatus: job.status,
        toStatus: nextStatus,
        source: "provider",
        leaseToken: options.leaseToken,
        result,
        responseSummary: createResponseSummary(result),
        errorCode: nextStatus === "error" ? MODERATION_ERROR_CODES.unavailable : null
      });
      if (!jobChanged) {
        throw textModerationError(409, MODERATION_ERROR_CODES.proposalStale, "text moderation job changed concurrently");
      }
      return { kind: "error", status: nextStatus };
    });
    if (options.returnOutcome) return final;
    if (final.kind === "approved" || final.kind === "replay") return final.result;
    if (final.kind === "stale") {
      throw textModerationError(
        409,
        MODERATION_ERROR_CODES.proposalStale,
        "text moderation proposal is stale"
      );
    }
    throw replayErrorForStatus(final.status);
  }

  async function moderateTextMutation(input) {
    const prepared = await prepareTextProposal(input);
    const terminalResult = returnPreparedTerminalTextOutcome(
      preparedTerminalTextOutcome(prepared.job, prepared.proposal)
    );
    if (terminalResult) return terminalResult;
    const leaseToken = prepared.job.initialLeaseAcquired === true
      ? prepared.job.initialLeaseToken
      : null;
    if (!leaseToken) throw replayErrorForStatus("error");
    let providerResult;
    try {
      await renewSubmissionLease({
        jobId: prepared.job.id,
        leaseToken,
        fromStatus: prepared.job.status || "pending"
      });
      if (typeof deps.client?.checkText !== "function") {
        throw textModerationError(
          500,
          MODERATION_ERROR_CODES.configuration,
          "WeChat text moderation client is missing"
        );
      }
      providerResult = await deps.client.checkText({
        content: prepared.normalizedText,
        openid: prepared.openid,
        scene: prepared.scene
      });
    } catch (error) {
      if (isSubmissionStale(error)) throw replayErrorForStatus("error");
      await recordLeasedSubmissionFailure({
        job: prepared.job,
        leaseToken,
        subjectType: prepared.subjectType,
        error
      });
      throw replayErrorForStatus("error");
    }
    const outcome = normalizeWechatTextResult(providerResult);
    if (outcome.decision === "error") {
      const error = textModerationError(
        502,
        "WECHAT_CONTENT_SECURITY_RESPONSE_INVALID",
        "WeChat content security response is invalid"
      );
      await recordLeasedSubmissionFailure({
        job: prepared.job,
        leaseToken,
        subjectType: prepared.subjectType,
        error
      });
      throw replayErrorForStatus("error");
    }
    const resolved = await resolveTextResult(prepared, providerResult, { leaseToken });
    deps.emit(`moderation_decision_${outcome.decision}`, {
      subjectType: prepared.subjectType,
      outcome: moderationStatusForDecision(outcome.decision)
    });
    return resolved;
  }

  async function retryTextModeration(input = {}) {
    const job = input.job;
    const proposal = input.proposal;
    const leaseToken = String(input.leaseToken || "");
    const normalizedText = String(input.normalizedText || "");
    if (
      !job ||
      !proposal ||
      !leaseToken ||
      String(job.provider || "") !== "wechat_sec_check" ||
      !retryTextIdentityMatches(job, proposal, input.expectedText) ||
      !retryTextPayloadDigestMatches(proposal, normalizedText) ||
      textMutationSubjectVersion({ normalizedText }) !== String(job.subject_version || "")
    ) {
      return { kind: "stale" };
    }
    const scene = textSceneForSubject(job.subject_type);
    if (input.scene !== undefined && Number(input.scene) !== scene) return { kind: "stale" };
    const openid = boundedString(input.openid, 128);
    if (!openid) {
      throw textModerationError(
        422,
        MODERATION_ERROR_CODES.openidRequired,
        "a verified content producer openid is required"
      );
    }
    if (typeof deps.client?.checkText !== "function") {
      throw textModerationError(
        500,
        MODERATION_ERROR_CODES.configuration,
        "WeChat text moderation client is missing"
      );
    }
    await renewSubmissionLease({
      jobId: job.id,
      leaseToken,
      fromStatus: job.status || "error"
    });
    const providerResult = await deps.client.checkText({ content: normalizedText, openid, scene });
    const outcome = normalizeWechatTextResult(providerResult);
    if (outcome.decision === "error") {
      throw textModerationError(
        502,
        "WECHAT_CONTENT_SECURITY_RESPONSE_INVALID",
        "WeChat content security response is invalid"
      );
    }
    const final = await resolveTextResult({
      job,
      proposal,
      subjectType: job.subject_type,
      normalizedText,
      openid,
      scene
    }, providerResult, {
      leaseToken,
      expectedText: input.expectedText,
      returnOutcome: true
    });
    if (final.kind !== "stale") {
      deps.emit(`moderation_decision_${outcome.decision}`, {
        subjectType: job.subject_type,
        outcome: moderationStatusForDecision(outcome.decision)
      });
    }
    return final;
  }

  async function decideAsAdmin(input) {
    if (!input.admin?.roles?.includes("system_admin")) {
      throw publicModerationError(403, "FORBIDDEN", "system_admin role required");
    }
    const action = String(input.action || "");
    if (!["approve", "reject", "retry"].includes(action)) {
      throw publicModerationError(400, "BAD_REQUEST", "unsupported moderation action");
    }
    const reason = String(input.reason || "").trim();
    if (action === "reject" && !reason) {
      throw publicModerationError(400, "BAD_REQUEST", "rejection reason is required");
    }
    return deps.transaction(async (connection) => {
      const job = await deps.repository.findModerationJobById(
        connection,
        input.jobId,
        { forUpdate: true }
      );
      if (!job || !["review", "error"].includes(job.status)) {
        throw publicModerationError(409, "CONTENT_MODERATION_INVALID_TRANSITION", "job is not reviewable");
      }
      if (action === "retry") {
        if (job.status !== "error") {
          throw publicModerationError(409, "CONTENT_MODERATION_INVALID_TRANSITION", "only error jobs can retry");
        }
        await deps.repository.requeueModerationJob(connection, { jobId: job.id });
        await deps.repository.createAuditLog(connection, {
          jobId: job.id,
          adminUserId: input.admin.user.id,
          action,
          previousStatus: "error",
          nextStatus: "pending",
          reason: reason || null
        });
        return { id: Number(job.id), status: "pending" };
      }

      const nextStatus = action === "approve" ? "approved" : "rejected";
      const isMedia = ["album_image", "album_video"].includes(job.subject_type);
      if (isMedia) {
        const media = await deps.repository.findModerationMedia(connection, job, { forUpdate: true });
        if (!media) throw publicModerationError(409, "CONTENT_MODERATION_CALLBACK_STALE", "media is stale");
        await deps.repository.transitionMediaModeration(connection, {
          mediaId: media.id,
          fromStatuses: [job.status],
          toStatus: nextStatus
        });
        if (nextStatus === "rejected") {
          await deps.repository.enqueueRejectedMediaCleanup(connection, media);
        }
      } else {
        const proposal = await deps.repository.findTextProposalByJobId(
          connection,
          job.id,
          { forUpdate: true }
        );
        if (!proposal) throw publicModerationError(409, "CONTENT_MODERATION_CALLBACK_STALE", "proposal is stale");
        let appliedResult = null;
        let safeAppliedResult = null;
        if (nextStatus === "approved") {
          if (typeof input.applyTextProposal !== "function") {
            throw publicModerationError(500, "CONTENT_MODERATION_CONFIGURATION_ERROR", "text applicator missing");
          }
          try {
            appliedResult = await input.applyTextProposal(connection, { job, proposal });
            safeAppliedResult = requireSafeAppliedResult(appliedResult);
          } catch (error) {
            const staleError = proposalStaleForRevalidationError(error) || error;
            if (staleError?.code !== MODERATION_ERROR_CODES.proposalStale) throw error;
            const proposalChanged = await deps.repository.markTextProposalStale(connection, {
              jobId: job.id,
              fromStatus: proposal.status
            });
            if (!proposalChanged) {
              throw publicModerationError(409, "CONTENT_MODERATION_CALLBACK_STALE", "proposal changed concurrently");
            }
            await deps.repository.transitionModerationJob(connection, {
              jobId: job.id,
              fromStatus: job.status,
              toStatus: "rejected",
              source: "admin",
              adminUserId: input.admin.user.id,
              reason,
              errorCode: MODERATION_ERROR_CODES.proposalStale
            });
            await deps.repository.createAuditLog(connection, {
              jobId: job.id,
              adminUserId: input.admin.user.id,
              action: "stale",
              previousStatus: job.status,
              nextStatus: "rejected",
              reason: reason || null
            });
            return { id: Number(job.id), status: "rejected", stale: true };
          }
        }
        await deps.repository.markTextProposalStatus(connection, {
          jobId: job.id,
          fromStatus: proposal.status,
          toStatus: nextStatus,
          appliedResult: safeAppliedResult
        });
      }
      await deps.repository.transitionModerationJob(connection, {
        jobId: job.id,
        fromStatus: job.status,
        toStatus: nextStatus,
        source: "admin",
        adminUserId: input.admin.user.id,
        reason
      });
      await deps.repository.createAuditLog(connection, {
        jobId: job.id,
        adminUserId: input.admin.user.id,
        action,
        previousStatus: job.status,
        nextStatus,
        reason: reason || null
      });
      return { id: Number(job.id), status: nextStatus };
    });
  }

  return {
    createVideoJob,
    submitVideoJob,
    createWechatImageModerationJob,
    submitWechatImageModeration,
    applyMediaResult,
    decideAsAdmin,
    moderateTextMutation,
    retryTextModeration,
    textSceneForSubject
  };
}
