import crypto from "node:crypto";

import {
  createResponseSummary,
  digestNormalizedText,
  normalizeTextFields
} from "./normalize.js";
import { buildTextProposalPayload } from "./text-boundaries.js";
import { projectSafeTextAppliedResult } from "./text-applied-result.js";
import { proposalStaleForRevalidationError } from "./text-proposal-applicator.js";
import {
  textMutationSubjectVersion,
  textOperationSubjectId
} from "./text-request-identity.js";
import { MODERATION_ERROR_CODES } from "./constants.js";
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

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${stableJson(value[key])}`
    )).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

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
    emit: () => {},
    ...dependencies
  };

  async function createVideoJob(connection, input) {
    const job = await deps.repository.createModerationJob(connection, {
      subjectType: "album_video",
      subjectId: String(input.media.id),
      subjectVersion: String(input.subjectVersion),
      provider: "tencent_ci_video",
      dataId: deps.randomUUID(),
      policyId: deps.config.tencentVideoPolicyId
    });
    return {
      ...job,
      kind: "video",
      objectKey: String(input.objectKey),
      dataId: job.data_id || job.dataId,
      status: job.status || "pending"
    };
  }

  async function submitVideoJob(job) {
    try {
      const response = await deps.client.submitVideo({
        objectKey: job.objectKey,
        dataId: job.data_id || job.dataId
      });
      const recorded = await deps.transaction((connection) =>
        deps.repository.recordModerationSubmission(connection, {
          jobId: job.id,
          provider: "tencent_ci_video",
          providerJobId: response.JobId,
          fromStatus: job.status || "pending",
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
      await deps.withDatabaseConnection((connection) =>
        deps.repository.transitionModerationJob(connection, {
          jobId: job.id,
          fromStatus: job.status || "pending",
          toStatus: "error",
          source: "provider",
          errorCode: error?.code || "CONTENT_MODERATION_UNAVAILABLE"
        })
      );
      deps.emit("moderation_submission_failure", {
        subjectType: "album_video",
        outcome: "hidden_retryable",
        errorCode: error?.code || "CONTENT_MODERATION_UNAVAILABLE"
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
    return {
      ...job,
      kind: "wechat_image",
      objectKey,
      uploaderUserId,
      status: job.status || "pending"
    };
  }

  async function submitWechatImageModeration(job) {
    const fromStatus = job?.status || "pending";
    try {
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
      await deps.withDatabaseConnection((connection) =>
        deps.repository.transitionModerationJob(connection, {
          jobId: job?.id,
          fromStatus,
          toStatus: "error",
          source: "provider",
          errorCode: error?.code || MODERATION_ERROR_CODES.unavailable
        })
      );
      deps.emit("moderation_submission_failure", {
        subjectType: "album_image",
        outcome: "hidden_retryable",
        errorCode: error?.code || MODERATION_ERROR_CODES.unavailable
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
        errorCode: nextStatus === "error" ? "CONTENT_MODERATION_INVALID_RESPONSE" : null
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
    const payloadDigest = digestNormalizedText(stableJson({
      action,
      baseVersion,
      normalizedText,
      payload: normalizedPayload
    }));

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
      return { job, proposal };
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

  async function resolveTextResult(prepared, providerResult) {
    const result = normalizeWechatTextResult(providerResult);
    const final = await deps.transaction(async (connection) => {
      const job = await deps.repository.findModerationJobById(
        connection,
        prepared.job.id,
        { forUpdate: true }
      );
      const proposal = await deps.repository.findTextProposalByJobId(
        connection,
        prepared.job.id,
        { forUpdate: true }
      );
      if (!job || !proposal) {
        throw textModerationError(
          409,
          MODERATION_ERROR_CODES.proposalStale,
          "text moderation proposal is stale"
        );
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
        result,
        responseSummary: createResponseSummary(result),
        errorCode: nextStatus === "error" ? MODERATION_ERROR_CODES.unavailable : null
      });
      if (!jobChanged) {
        throw textModerationError(409, MODERATION_ERROR_CODES.proposalStale, "text moderation job changed concurrently");
      }
      return { kind: "error", status: nextStatus };
    });
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
    let providerResult;
    try {
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
    } catch {
      providerResult = { suggestion: "error" };
    }
    const outcome = normalizeWechatTextResult(providerResult);
    const resolved = await resolveTextResult(prepared, providerResult);
    deps.emit(`moderation_decision_${outcome.decision}`, {
      subjectType: prepared.subjectType,
      outcome: moderationStatusForDecision(outcome.decision)
    });
    return resolved;
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
    textSceneForSubject
  };
}
