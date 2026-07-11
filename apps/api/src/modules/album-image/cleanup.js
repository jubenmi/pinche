import crypto from "node:crypto";

import { emitAlbumImageEvent } from "./telemetry.js";

function retryAt(nowMs, attempts) {
  const delaySeconds = Math.min(6 * 60 * 60, 30 * (2 ** Math.min(attempts, 10)));
  return new Date(nowMs + delaySeconds * 1000);
}

function stableErrorCode(error) {
  return /^[A-Z0-9_]{1,64}$/.test(String(error?.code || ""))
    ? String(error.code)
    : "ALBUM_IMAGE_CLEANUP_FAILED";
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
    if (row.storage_kind === "cos") {
      try {
        await storage.delete(row.object_key);
      } catch (error) {
        if (error?.code !== "COS_OBJECT_NOT_FOUND") throw error;
      }
    } else if (row.storage_kind === "local") {
      try {
        await unlinkFile(row.local_path);
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
    } else {
      throw Object.assign(new Error("invalid storage kind"), {
        code: "ALBUM_IMAGE_STORAGE_KIND_INVALID"
      });
    }
    await withTransaction((connection) => repository.completeMediaCleanup(connection, {
      jobId: row.id,
      mediaId: row.media_id,
      leaseToken
    }));
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
  emit = emitAlbumImageEvent
}) {
  await withTransaction((connection) => repository.expireOverdueAlbumImageIntents(
    connection,
    new Date(now())
  ));
  const leaseToken = randomUUID();
  const claimTime = now();
  const claimed = await withTransaction((connection) => repository.claimAllCleanup(
    connection,
    {
      leaseToken,
      now: new Date(claimTime),
      leaseExpiresAt: new Date(claimTime + 60_000),
      limit
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
