import crypto from "node:crypto";

import { emitAlbumImageEvent } from "./telemetry.js";

const LOCAL_ALBUM_CLEANUP_PATH = /^\/uploads\/session-album\/(?:display\/[A-Za-z0-9._-]+|videos\/(?:source|display|cover)\/[A-Za-z0-9._-]+)$/;

export function assertLocalAlbumCleanupPath(localPath) {
  const normalized = String(localPath || "");
  if (!LOCAL_ALBUM_CLEANUP_PATH.test(normalized)) {
    throw Object.assign(new Error("invalid cleanup local path"), {
      code: "ALBUM_IMAGE_LOCAL_PATH_INVALID"
    });
  }
  return normalized;
}

function retryAt(nowMs, attempts) {
  const delaySeconds = Math.min(6 * 60 * 60, 30 * (2 ** Math.min(attempts, 10)));
  return new Date(nowMs + delaySeconds * 1000);
}

function stableErrorCode(error) {
  return /^[A-Z0-9_]{1,64}$/.test(String(error?.code || ""))
    ? String(error.code)
    : "ALBUM_IMAGE_CLEANUP_FAILED";
}

function scopedMediaCleanupJobIds(value) {
  if (value === undefined) return null;
  if (!Array.isArray(value) || value.length === 0) {
    throw new TypeError("media cleanup job ids must be a non-empty array");
  }
  const ids = value.map((item) => Number(item));
  if (!ids.every((id) => Number.isSafeInteger(id) && id > 0)) {
    throw new TypeError("media cleanup job ids must be positive integers");
  }
  return [...new Set(ids)];
}

async function cleanupIntent({ row, leaseToken, repository, storage, withTransaction, now, emit }) {
  try {
    try {
      await storage.head(row.object_key);
    } catch (error) {
      if (error?.code !== "COS_OBJECT_NOT_FOUND") throw error;
      await withTransaction((connection) => repository.completeIntentCleanup(connection, {
        id: row.id, leaseToken
      }));
      emit("orphan_cleaned", { outcome: "already-missing" });
      return;
    }
    await storage.delete(row.object_key);
    await withTransaction((connection) => repository.completeIntentCleanup(connection, {
      id: row.id, leaseToken
    }));
    emit("orphan_cleaned", { outcome: "deleted" });
  } catch (error) {
    const attempts = Number(row.cleanup_attempts || 0) + 1;
    await withTransaction((connection) => repository.failIntentCleanup(connection, {
      id: row.id,
      leaseToken,
      attempts,
      nextRetryAt: retryAt(now(), attempts),
      errorCode: stableErrorCode(error)
    }));
    emit("cleanup_retry", { outcome: "intent", errorCode: stableErrorCode(error), retryCount: attempts });
  }
}

async function cleanupMedia({
  row, leaseToken, repository, storage, unlinkFile, withTransaction, now, emit
}) {
  try {
    const cleanupOne = async ({ storageKind, objectKey, localPath }) => {
      if (storageKind === "cos") {
        try {
          await storage.delete(objectKey);
        } catch (error) {
          if (error?.code !== "COS_OBJECT_NOT_FOUND") throw error;
        }
        return;
      }
      if (storageKind === "local") {
        try {
          await unlinkFile(localPath);
        } catch (error) {
          if (error?.code !== "ENOENT") throw error;
        }
        return;
      }
      throw Object.assign(new Error("invalid storage kind"), {
        code: "ALBUM_IMAGE_STORAGE_KIND_INVALID"
      });
    };
    if (row.storage_kind === "multi") {
      let entries;
      try {
        entries = typeof row.object_urls_json === "string"
          ? JSON.parse(row.object_urls_json)
          : row.object_urls_json;
      } catch {
        entries = null;
      }
      if (!Array.isArray(entries) || entries.length === 0) {
        throw Object.assign(new Error("invalid multi-object cleanup payload"), {
          code: "ALBUM_IMAGE_STORAGE_KIND_INVALID"
        });
      }
      const unique = new Map();
      for (const entry of entries) {
        const normalized = {
          storageKind: String(entry?.storageKind || ""),
          objectKey: entry?.objectKey ? String(entry.objectKey) : null,
          localPath: entry?.localPath ? String(entry.localPath) : null
        };
        unique.set(JSON.stringify(normalized), normalized);
      }
      for (const entry of unique.values()) await cleanupOne(entry);
    } else {
      await cleanupOne({
        storageKind: row.storage_kind,
        objectKey: row.object_key,
        localPath: row.local_path
      });
    }
    const completed = await withTransaction((connection) => repository.completeMediaCleanup(connection, {
      jobId: row.id,
      mediaId: row.media_id,
      leaseToken
    }));
    if (!completed) return;
    emit("media_deleted", { sessionId: Number(row.session_id), mediaId: Number(row.media_id), outcome: "cleaned" });
  } catch (error) {
    const attempts = Number(row.attempts || 0) + 1;
    await withTransaction((connection) => repository.failMediaCleanup(connection, {
      jobId: row.id,
      leaseToken,
      attempts,
      nextRetryAt: retryAt(now(), attempts),
      errorCode: stableErrorCode(error)
    }));
    emit("cleanup_retry", {
      sessionId: Number(row.session_id), mediaId: Number(row.media_id),
      outcome: "media", errorCode: stableErrorCode(error), retryCount: attempts
    });
  }
}

export async function runAlbumImageCleanupBatch({
  repository,
  storage,
  unlinkFile = async () => {},
  withTransaction,
  now = () => Date.now(),
  randomUUID = () => crypto.randomUUID(),
  limit = 25,
  emit = emitAlbumImageEvent,
  mediaCleanupJobIds
}) {
  const scopedJobIds = scopedMediaCleanupJobIds(mediaCleanupJobIds);
  if (scopedJobIds === null) {
    await withTransaction((connection) => repository.expireOverdueAlbumImageIntents(
      connection,
      new Date(now())
    ));
  }
  const leaseToken = randomUUID();
  const claimTime = now();
  const claimed = await withTransaction((connection) => repository.claimAllCleanup(
    connection,
    {
      leaseToken,
      now: new Date(claimTime),
      leaseExpiresAt: new Date(claimTime + 60_000),
      limit,
      mediaCleanupJobIds: scopedJobIds || undefined
    }
  ));
  for (const item of claimed) {
    const input = {
      row: item.row,
      leaseToken,
      repository,
      storage,
      unlinkFile,
      withTransaction,
      now,
      emit
    };
    if (item.type === "intent") await cleanupIntent(input);
    else await cleanupMedia(input);
  }
  return { claimed: claimed.length };
}
