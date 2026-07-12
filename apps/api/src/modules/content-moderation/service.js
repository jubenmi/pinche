import crypto from "node:crypto";

import { createResponseSummary } from "./normalize.js";
import { moderationStatusForDecision } from "./state-machine.js";

export function createContentModerationService(dependencies) {
  const deps = {
    randomUUID: () => crypto.randomUUID(),
    emit: () => {},
    ...dependencies
  };

  async function createMediaJob(connection, kind, input) {
    const subjectType = kind === "image" ? "album_image" : "album_video";
    const policyId = kind === "image"
      ? deps.config.imagePolicyId
      : deps.config.videoPolicyId;
    const job = await deps.repository.createModerationJob(connection, {
      subjectType,
      subjectId: String(input.media.id),
      subjectVersion: String(input.subjectVersion),
      provider: "tencent_ci",
      dataId: deps.randomUUID(),
      policyId
    });
    return {
      ...job,
      kind,
      objectKey: String(input.objectKey),
      dataId: job.data_id || job.dataId,
      status: job.status || "pending"
    };
  }

  async function submitMediaJob(kind, job) {
    const method = kind === "image" ? "submitImage" : "submitVideo";
    try {
      const response = await deps.client[method]({
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
        subjectType: kind === "image" ? "album_image" : "album_video",
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
        subjectType: kind === "image" ? "album_image" : "album_video",
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

  return {
    createImageJob: (connection, input) => createMediaJob(connection, "image", input),
    createVideoJob: (connection, input) => createMediaJob(connection, "video", input),
    submitImageJob: (job) => submitMediaJob("image", job),
    submitVideoJob: (job) => submitMediaJob("video", job),
    applyMediaResult
  };
}
