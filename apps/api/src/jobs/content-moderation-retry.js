import { config } from "../config/env.js";
import { withTransaction } from "../db/mysql.js";
import * as repository from "../modules/content-moderation/repository.js";
import { runContentModerationRetryBatch } from "../modules/content-moderation/retry.js";
import {
  createTencentVideoModerationClient,
  createTencentVideoModerationTransport
} from "../modules/content-moderation/tencent-video-client.js";

const client = createTencentVideoModerationClient({
  config: config.contentModeration,
  transport: createTencentVideoModerationTransport({ config: config.contentModeration })
});

async function processJob(job) {
  if (job.provider !== "tencent_ci_video" || job.subject_type !== "album_video") {
    const error = new Error("moderation provider retry handler is not installed");
    error.code = "CONTENT_MODERATION_PROVIDER_NOT_READY";
    throw error;
  }
  const response = await client.submitVideo({
    objectKey: String(job.media_source_url || "").replace(/^\//, ""),
    dataId: job.data_id
  });
  const recorded = await withTransaction(async (connection) => {
    return repository.recordModerationSubmission(connection, {
      jobId: job.id,
      provider: "tencent_ci_video",
      providerJobId: response.JobId,
      fromStatus: job.status,
      leaseToken: job.lease_token,
      responseSummary: { providerJobId: response.JobId || "" }
    });
  });
  if (!recorded) {
    const error = new Error("moderation submission changed before its provider attempt was recorded");
    error.code = "CONTENT_MODERATION_SUBMISSION_STALE";
    throw error;
  }
}

export async function run() {
  return runContentModerationRetryBatch({
    repository,
    withTransaction,
    processJob,
    claimFilter: {
      providers: ["tencent_ci_video"],
      subjectTypes: ["album_video"]
    },
    retryLimit: config.contentModeration.retryLimit,
    emit: (event, fields) => console.log(JSON.stringify({
      type: "content_moderation",
      event,
      at: new Date().toISOString(),
      ...fields
    }))
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run()
    .then((result) => console.log(JSON.stringify({ ok: true, ...result })))
    .catch((error) => {
      console.error(JSON.stringify({ ok: false, code: error?.code || "MODERATION_RETRY_FAILED" }));
      process.exitCode = 1;
    });
}
