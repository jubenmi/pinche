import crypto from "node:crypto";

import {
  createResponseSummary
} from "./normalize.js";
import { moderationStatusForDecision } from "./state-machine.js";

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
      await deps.withDatabaseConnection((connection) =>
        deps.repository.recordModerationSubmission(connection, {
          jobId: job.id,
          providerJobId: response.JobId || response.jobId || response.TaskId || response.taskId,
          fromStatus: job.status || "pending"
        })
      );
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

  function staleCallback(message) {
    const error = new Error(message);
    error.code = "CONTENT_MODERATION_CALLBACK_STALE";
    return error;
  }

  async function applyMediaResult(input) {
    return deps.transaction(async (connection) => {
      const job = await deps.repository.findModerationJobById(
        connection,
        input.jobId,
        { forUpdate: true }
      );
      if (!job) throw staleCallback("moderation job was not found");
      if (String(job.subject_version) !== String(input.subjectVersion)) {
        throw staleCallback("moderation subject version is stale");
      }
      const media = await deps.repository.findModerationMedia(connection, job, { forUpdate: true });
      if (!media || media.status !== "active") throw staleCallback("moderation media is stale");
      if (
        media.moderation_object_version &&
        String(media.moderation_object_version) !== String(job.subject_version)
      ) {
        throw staleCallback("moderation media object version is stale");
      }
      const currentObjectKey = String(
        job.subject_type === "album_image" ? media.object_key : media.source_url
      ).replace(/^\//, "");
      if (currentObjectKey !== String(input.objectKey).replace(/^\//, "")) {
        throw staleCallback("moderation object key is stale");
      }
      const nextStatus = moderationStatusForDecision(input.result?.decision || "error");
      if (["approved", "rejected"].includes(job.status)) {
        if (job.status === nextStatus) return { status: job.status, duplicate: true };
        throw staleCallback("moderation job already has a terminal decision");
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
      if (!changed) throw staleCallback("moderation job changed concurrently");
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
        if (nextStatus === "approved") {
          if (typeof input.applyTextProposal !== "function") {
            throw publicModerationError(500, "CONTENT_MODERATION_CONFIGURATION_ERROR", "text applicator missing");
          }
          await input.applyTextProposal(connection, { job, proposal });
        }
        await deps.repository.markTextProposalStatus(connection, {
          jobId: job.id,
          fromStatus: job.status,
          toStatus: nextStatus
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
    applyMediaResult,
    decideAsAdmin
  };
}
