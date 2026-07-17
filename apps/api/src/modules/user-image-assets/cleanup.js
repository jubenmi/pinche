import crypto from "node:crypto";

const USER_IMAGE_CLEANUP_PATH = /^\/uploads\/(?:avatars|session-reviews)\/[A-Za-z0-9._-]+$/;

export function assertUserImageCleanupPath(value) {
  const path = String(value || "");
  if (!USER_IMAGE_CLEANUP_PATH.test(path) || path.includes("..")) {
    throw Object.assign(new Error("invalid user image cleanup path"), {
      code: "USER_IMAGE_CLEANUP_PATH_INVALID"
    });
  }
  return path;
}

function retryAt(nowMs, attempts) {
  return new Date(nowMs + Math.min(6 * 60 * 60, 30 * (2 ** Math.min(attempts, 10))) * 1000);
}

function stableErrorCode(error) {
  return /^[A-Z0-9_]{1,64}$/.test(String(error?.code || ""))
    ? String(error.code)
    : "USER_IMAGE_CLEANUP_FAILED";
}

async function deleteStoredUserImage({ row, storage, unlinkFile }) {
  const path = assertUserImageCleanupPath(row.asset_path);
  if (String(row.storage_kind) === "cos") {
    try {
      await storage.delete(String(row.object_key));
    } catch (error) {
      if (error?.code !== "COS_OBJECT_NOT_FOUND") throw error;
    }
  } else if (String(row.storage_kind) === "local") {
    try {
      await unlinkFile(path);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  } else {
    throw Object.assign(new Error("invalid user image storage kind"), {
      code: "USER_IMAGE_STORAGE_KIND_INVALID"
    });
  }
}

export async function runUserImageCleanupBatch({
  repository,
  storage,
  unlinkFile = async () => {},
  withTransaction,
  randomUUID = () => crypto.randomUUID(),
  now = () => Date.now(),
  limit = 25
}) {
  const leaseToken = randomUUID();
  const claimTime = now();
  const rows = await withTransaction((connection) => repository.claimUserImageCleanupJobs(
    connection,
    {
      leaseToken,
      now: new Date(claimTime),
      leaseExpiresAt: new Date(claimTime + 60_000),
      limit
    }
  ));
  for (const row of rows) {
    try {
      const decision = await withTransaction((connection) =>
        repository.prepareUserImageCleanupDeletion(connection, {
          jobId: row.id,
          leaseToken,
          assetId: row.user_image_asset_id || null,
          ownerUserId: row.owner_user_id,
          assetPath: row.asset_path,
          deferUntil: new Date(now() + 5 * 60 * 1000)
        })
      );
      if (decision?.action !== "delete") {
        continue;
      }
      await deleteStoredUserImage({ row, storage, unlinkFile });
      await withTransaction((connection) => repository.completeUserImageCleanup(connection, {
        jobId: row.id,
        leaseToken,
        status: "cleaned"
      }));
    } catch (error) {
      const attempts = Number(row.attempts || 0) + 1;
      await withTransaction((connection) => repository.failUserImageCleanup(connection, {
        jobId: row.id,
        leaseToken,
        attempts,
        nextRetryAt: retryAt(now(), attempts),
        errorCode: stableErrorCode(error)
      }));
    }
  }

  let objectRows = [];
  if (typeof repository.claimUserImageObjectCleanupJobs === "function") {
    objectRows = await withTransaction((connection) =>
      repository.claimUserImageObjectCleanupJobs(connection, {
        leaseToken,
        now: new Date(claimTime),
        leaseExpiresAt: new Date(claimTime + 60_000),
        limit
      })
    );
  }
  for (const row of objectRows) {
    try {
      const decision = await withTransaction((connection) =>
        repository.prepareUserImageObjectCleanupDeletion(connection, {
          jobId: row.id,
          leaseToken,
          assetPath: row.asset_path,
          objectKey: row.object_key,
          storageKind: row.storage_kind,
          deferUntil: new Date(now() + 5 * 60 * 1000)
        })
      );
      if (decision?.action !== "delete") continue;
      await deleteStoredUserImage({ row, storage, unlinkFile });
      await withTransaction((connection) =>
        repository.completeUserImageObjectCleanup(connection, {
          jobId: row.id,
          leaseToken,
          status: "cleaned"
        })
      );
    } catch (error) {
      const attempts = Number(row.attempts || 0) + 1;
      await withTransaction((connection) =>
        repository.failUserImageObjectCleanup(connection, {
          jobId: row.id,
          leaseToken,
          attempts,
          nextRetryAt: retryAt(now(), attempts),
          errorCode: stableErrorCode(error)
        })
      );
    }
  }
  return { claimed: rows.length + objectRows.length };
}
