import crypto from "node:crypto";

const OPERATIONAL_ERROR = /auth|unauthor|permission|balance|quota|biztype|policy|cam/i;
const TRANSIENT_ERROR = /network|timeout|requestlimit|ratelimit|internal|upstream|5\d\d/i;

export function classifyModerationError(error) {
  const code = String(error?.code || "CONTENT_MODERATION_UNAVAILABLE");
  if (OPERATIONAL_ERROR.test(code)) return { retryable: false, alert: true, code };
  return { retryable: TRANSIENT_ERROR.test(code) || !error?.code, alert: false, code };
}
export function moderationRetryAt(nowMs, attempts, random = Math.random) {
  const base = Math.min(6 * 60 * 60 * 1000, 30_000 * (2 ** Math.max(0, attempts - 1)));
  const jittered = Math.min(6 * 60 * 60 * 1000, Math.round(base * (1 + 0.25 * random())));
  return new Date(nowMs + jittered);
}

export async function runContentModerationRetryBatch({
  repository,
  withTransaction,
  processJob,
  claimFilter = {},
  now = () => Date.now(),
  randomUUID = () => crypto.randomUUID(),
  random = Math.random,
  retryLimit = 8,
  limit = 25,
  emit = () => {}
}) {
  const leaseToken = randomUUID();
  const claimedAt = now();
  const jobs = await withTransaction((connection) => repository.claimModerationRetryJobs(
    connection,
    {
      ...(claimFilter && typeof claimFilter === "object" ? claimFilter : {}),
      leaseToken,
      now: new Date(claimedAt),
      leaseExpiresAt: new Date(claimedAt + 60_000),
      retryLimit,
      limit
    }
  ));
  let failed = 0;
  for (const job of jobs) {
    try {
      await processJob(job);
    } catch (error) {
      failed += 1;
      const attempts = Number(job.attempt_count || 0) + 1;
      const classification = classifyModerationError(error);
      const exhausted = attempts >= retryLimit || !classification.retryable;
      await withTransaction((connection) => repository.failModerationJob(connection, {
        jobId: job.id,
        leaseToken,
        attempts,
        nextRetryAt: moderationRetryAt(now(), attempts, random),
        errorCode: classification.code,
        exhausted
      }));
      emit(exhausted ? "moderation_retry_exhausted" : "moderation_submission_failure", {
        subjectType: job.subject_type,
        outcome: exhausted ? "operator_required" : "retry_scheduled",
        errorCode: classification.code
      });
    }
  }
  return { claimed: jobs.length, failed };
}
