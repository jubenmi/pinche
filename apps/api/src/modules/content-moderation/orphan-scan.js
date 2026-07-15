import crypto from "node:crypto";
import { shouldRetainRejectedMedia } from "./media-retention.js";

const SESSION_ALBUM_PREFIX = "uploads/session-album/";
const SESSION_ALBUM_OBJECT_KEY = /^uploads\/session-album\/(?:display\/[A-Za-z0-9._-]+|videos\/(?:source|display|cover)\/[A-Za-z0-9._-]+)$/;
const MIN_RETENTION_MS = 24 * 60 * 60 * 1000;
const MAX_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const DEFAULT_LEASE_MS = 5 * 60 * 1000;

export const CONTENT_MODERATION_ORPHAN_SCAN_NAMES = Object.freeze([
  "cos_session_album",
  "media_session_album",
  "job_session_album"
]);

function boundedInteger(value, { minimum, maximum, name }) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new TypeError(`${name} must be an integer from ${minimum} to ${maximum}`);
  }
  return parsed;
}

function asMilliseconds(now) {
  const value = typeof now === "function" ? now() : now;
  const parsed = value instanceof Date ? value.getTime() : Number(value);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function scanObjectKey(value) {
  const key = String(value || "").replace(/^\//, "");
  return SESSION_ALBUM_OBJECT_KEY.test(key) ? key : null;
}

function expectedMediaModeration(media) {
  const mediaType = String(media?.media_type || "");
  if (mediaType === "image") {
    return { provider: "wechat_sec_check", subjectType: "album_image" };
  }
  if (mediaType === "video") {
    return { provider: "tencent_ci_video", subjectType: "album_video" };
  }
  return null;
}

export function isRetainedAuthorPrivateMediaRecord(media) {
  return (
    String(media?.moderation_status || "") === "rejected" &&
    shouldRetainRejectedMedia(media)
  );
}

function cosObjectKeysForMedia(media) {
  if (String(media?.moderation_object_version || "").startsWith("local:")) return [];
  const values = String(media?.media_type || "") === "video"
    ? [media?.source_url, media?.display_url, media?.cover_url]
    : [media?.object_key];
  return [...new Set(values.map(scanObjectKey).filter(Boolean))];
}

function latestCursor(rows, limit) {
  if (!Array.isArray(rows) || rows.length < limit) return null;
  const id = Number(rows.at(-1)?.id);
  return Number.isSafeInteger(id) && id > 0 ? String(id) : null;
}

function isMissingCosObject(error) {
  return String(error?.code || "") === "COS_OBJECT_NOT_FOUND";
}

function orphanScanLeaseLostError() {
  const error = new Error("content moderation orphan scan lease is no longer live");
  error.code = "CONTENT_MODERATION_ORPHAN_SCAN_LEASE_LOST";
  return error;
}

function mediaHasExpectedJob(media, expected) {
  const version = String(media?.moderation_object_version || "");
  return Array.isArray(media?.moderation_jobs) && media.moderation_jobs.some((job) => (
    String(job?.provider || "") === expected.provider &&
    String(job?.subject_type || "") === expected.subjectType &&
    String(job?.subject_version || "") === version
  ));
}

function jobMatchesMedia(job) {
  const expected = String(job?.subject_type || "") === "album_image"
    ? { provider: "wechat_sec_check", mediaType: "image" }
    : String(job?.subject_type || "") === "album_video"
      ? { provider: "tencent_ci_video", mediaType: "video" }
      : null;
  if (!expected) return true;
  return (
    Number(job?.media_id) === Number(job?.subject_id) &&
    String(job?.media_type || "") === expected.mediaType &&
    ["active", "deleting"].includes(String(job?.media_status || "")) &&
    String(job?.provider || "") === expected.provider &&
    String(job?.media_moderation_object_version || "") === String(job?.subject_version || "")
  );
}

function emitAggregate(emit, entries) {
  for (const entry of entries.values()) {
    emit("moderation_orphan_detected", {
      ...(entry.provider ? { provider: entry.provider } : {}),
      ...(entry.subjectType ? { subjectType: entry.subjectType } : {}),
      outcome: entry.outcome,
      orphanCount: entry.count,
      priority: "high"
    });
  }
}

function incrementAggregate(entries, { provider, subjectType, outcome }) {
  const key = `${provider || ""}:${subjectType || ""}:${outcome}`;
  const current = entries.get(key) || { provider, subjectType, outcome, count: 0 };
  current.count += 1;
  entries.set(key, current);
}

async function scanState({
  repository,
  withTransaction,
  scanName,
  randomUUID,
  now,
  leaseMs,
  work
}) {
  const leaseToken = randomUUID();
  const startedAt = asMilliseconds(now);
  const state = await withTransaction((connection) => repository.claimOrphanScanState(connection, {
    scanName,
    leaseToken,
    now: new Date(startedAt),
    leaseExpiresAt: new Date(startedAt + leaseMs)
  }));
  if (!state) return null;
  const cursorValue = state.cursor_value ?? state.cursorValue ?? null;
  const renewLease = async () => {
    const renewedAt = asMilliseconds(now);
    const renewed = await withTransaction((connection) => repository.renewOrphanScanState(connection, {
      scanName,
      leaseToken,
      now: new Date(renewedAt),
      leaseExpiresAt: new Date(renewedAt + leaseMs)
    }));
    if (!renewed) throw orphanScanLeaseLostError();
  };
  try {
    await renewLease();
    const result = await work({ cursorValue, renewLease });
    await renewLease();
    const completed = await withTransaction((connection) => repository.completeOrphanScanState(connection, {
      scanName,
      leaseToken,
      cursorValue: result.cursorValue,
      now: new Date(asMilliseconds(now))
    }));
    if (!completed) throw orphanScanLeaseLostError();
    return result;
  } catch (error) {
    await withTransaction((connection) => repository.releaseOrphanScanState(connection, {
      scanName,
      leaseToken
    }));
    throw error;
  }
}

export async function runContentModerationOrphanScanBatch({
  repository,
  storage,
  withTransaction,
  emit = () => {},
  now = () => Date.now(),
  randomUUID = () => crypto.randomUUID(),
  limit = 100,
  leaseMs = DEFAULT_LEASE_MS,
  retentionMs = 48 * 60 * 60 * 1000,
  cleanupEnabled = false
} = {}) {
  if (!repository || !storage || typeof withTransaction !== "function") {
    throw new TypeError("orphan scan requires repository, storage, and transaction adapters");
  }
  for (const method of [
    "claimOrphanScanState",
    "completeOrphanScanState",
    "renewOrphanScanState",
    "releaseOrphanScanState",
    "findContentModerationObjectReferences",
    "listModerationMediaForReconciliation",
    "listMediaModerationJobsForReconciliation"
  ]) {
    if (typeof repository[method] !== "function") {
      throw new TypeError(`orphan scan repository.${method} is required`);
    }
  }
  for (const method of ["list", "head"]) {
    if (typeof storage[method] !== "function") {
      throw new TypeError(`orphan scan storage.${method} is required`);
    }
  }
  if (cleanupEnabled && typeof storage.delete !== "function") {
    throw new TypeError("orphan scan storage.delete is required when cleanup is enabled");
  }
  if (typeof emit !== "function" || typeof randomUUID !== "function") {
    throw new TypeError("orphan scan emit and randomUUID adapters must be functions");
  }
  const batchLimit = boundedInteger(limit, { minimum: 1, maximum: 1000, name: "orphan scan limit" });
  const duration = boundedInteger(leaseMs, { minimum: 60_000, maximum: 30 * 60 * 1000, name: "orphan scan lease" });
  const retention = boundedInteger(retentionMs, {
    minimum: MIN_RETENTION_MS,
    maximum: MAX_RETENTION_MS,
    name: "orphan scan retention"
  });
  const scanStartedAt = asMilliseconds(now);

  try {
    const cosResult = await scanState({
      repository,
      withTransaction,
      scanName: CONTENT_MODERATION_ORPHAN_SCAN_NAMES[0],
      randomUUID,
      now,
      leaseMs: duration,
      work: async ({ cursorValue, renewLease }) => {
        await renewLease();
        const page = await storage.list({
          prefix: SESSION_ALBUM_PREFIX,
          ...(cursorValue ? { marker: cursorValue } : {}),
          maxKeys: batchLimit
        });
        const objects = Array.isArray(page?.objects) ? page.objects.filter((object) => scanObjectKey(object?.key)) : [];
        const objectKeys = objects.map((object) => scanObjectKey(object.key));
        let referenced = new Set();
        if (objectKeys.length > 0) {
          await renewLease();
          referenced = new Set(await withTransaction((connection) => repository.findContentModerationObjectReferences(
            connection,
            { objectKeys }
          )));
        }
        const cutoff = scanStartedAt - retention;
        const candidates = objects.filter((object) => (
          !referenced.has(scanObjectKey(object.key)) &&
          Number.isFinite(Date.parse(object.lastModified)) &&
          Date.parse(object.lastModified) <= cutoff
        ));
        if (candidates.length > 0) {
          emit("moderation_orphan_detected", {
            outcome: "cos_unreferenced",
            orphanCount: candidates.length,
            priority: "high"
          });
        }
        let deleted = 0;
        if (cleanupEnabled) {
          for (const candidate of candidates) {
            const key = scanObjectKey(candidate.key);
            await renewLease();
            const stillReferenced = await withTransaction((connection) => repository.findContentModerationObjectReferences(
              connection,
              { objectKeys: [key] }
            ));
            if (stillReferenced.includes(key)) continue;
            await renewLease();
            try {
              await storage.delete(key);
            } catch (error) {
              if (!isMissingCosObject(error)) throw error;
            }
            deleted += 1;
          }
          if (deleted > 0) {
            emit("moderation_orphan_cleaned", {
              outcome: "cos_unreferenced",
              orphanCount: deleted
            });
          }
        }
        return {
          cursorValue: page?.nextMarker || null,
          scanned: objects.length,
          candidates: candidates.length,
          deleted
        };
      }
    });

    const mediaResult = await scanState({
      repository,
      withTransaction,
      scanName: CONTENT_MODERATION_ORPHAN_SCAN_NAMES[1],
      randomUUID,
      now,
      leaseMs: duration,
      work: async ({ cursorValue, renewLease }) => {
        await renewLease();
        const rows = await withTransaction((connection) => repository.listModerationMediaForReconciliation(
          connection,
          { afterId: Number(cursorValue || 0), limit: batchLimit }
        ));
        const aggregates = new Map();
        for (const media of rows) {
          const expected = expectedMediaModeration(media);
          if (!expected) continue;
          const retainedAuthorPrivate = isRetainedAuthorPrivateMediaRecord(media);
          for (const key of cosObjectKeysForMedia(media)) {
            await renewLease();
            try {
              await storage.head(key);
            } catch (error) {
              if (!isMissingCosObject(error)) throw error;
              incrementAggregate(aggregates, {
                provider: expected.provider,
                subjectType: expected.subjectType,
                outcome: retainedAuthorPrivate
                  ? "retained_media_object_missing"
                  : "media_object_missing"
              });
            }
          }
          if (
            String(media.moderation_status || "") !== "approved_legacy" &&
            !mediaHasExpectedJob(media, expected)
          ) {
            incrementAggregate(aggregates, {
              provider: expected.provider,
              subjectType: expected.subjectType,
              outcome: "media_without_job"
            });
          }
        }
        emitAggregate(emit, aggregates);
        return {
          cursorValue: latestCursor(rows, batchLimit),
          scanned: rows.length,
          inconsistencies: [...aggregates.values()].reduce((total, entry) => total + entry.count, 0)
        };
      }
    });

    const jobResult = await scanState({
      repository,
      withTransaction,
      scanName: CONTENT_MODERATION_ORPHAN_SCAN_NAMES[2],
      randomUUID,
      now,
      leaseMs: duration,
      work: async ({ cursorValue, renewLease }) => {
        await renewLease();
        const rows = await withTransaction((connection) => repository.listMediaModerationJobsForReconciliation(
          connection,
          { afterId: Number(cursorValue || 0), limit: batchLimit }
        ));
        const aggregates = new Map();
        for (const job of rows) {
          const subjectType = String(job?.subject_type || "");
          if (!['album_image', 'album_video'].includes(subjectType)) continue;
          if (!job?.media_id) {
            incrementAggregate(aggregates, {
              provider: job.provider,
              subjectType,
              outcome: "job_media_missing"
            });
            continue;
          }
          if (!jobMatchesMedia(job)) {
            incrementAggregate(aggregates, {
              provider: job.provider,
              subjectType,
              outcome: "job_media_mismatch"
            });
          }
          if (String(job.status || "") === "processing" && !job.current_attempt_id) {
            incrementAggregate(aggregates, {
              provider: job.provider,
              subjectType,
              outcome: "job_missing_current_attempt"
            });
          }
        }
        emitAggregate(emit, aggregates);
        return {
          cursorValue: latestCursor(rows, batchLimit),
          scanned: rows.length,
          inconsistencies: [...aggregates.values()].reduce((total, entry) => total + entry.count, 0)
        };
      }
    });

    return {
      cos: cosResult
        ? { scanned: cosResult.scanned, candidates: cosResult.candidates, deleted: cosResult.deleted }
        : { scanned: 0, candidates: 0, deleted: 0 },
      media: mediaResult
        ? { scanned: mediaResult.scanned, inconsistencies: mediaResult.inconsistencies }
        : { scanned: 0, inconsistencies: 0 },
      jobs: jobResult
        ? { scanned: jobResult.scanned, inconsistencies: jobResult.inconsistencies }
        : { scanned: 0, inconsistencies: 0 }
    };
  } catch (error) {
    emit("moderation_operational_alert", {
      outcome: "scan_failed",
      errorCode: "CONTENT_MODERATION_ORPHAN_SCAN_FAILED",
      priority: "high"
    });
    throw error;
  }
}
