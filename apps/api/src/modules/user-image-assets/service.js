import { AppError } from "../../http/errors.js";
import { isModerationPublished } from "@pinche/shared";

const KIND_FACTS = Object.freeze({
  avatar: Object.freeze({
    subjectType: "avatar_image",
    path: /^\/uploads\/avatars\/[A-Za-z0-9._-]+$/,
    objectKey: /^uploads\/avatars\/[A-Za-z0-9._-]+$/
  }),
  review: Object.freeze({
    subjectType: "review_image",
    path: /^\/uploads\/session-reviews\/[A-Za-z0-9._-]+$/,
    objectKey: /^uploads\/session-reviews\/[A-Za-z0-9._-]+$/
  })
});

function configurationError(message) {
  return new AppError(500, "CONTENT_MODERATION_CONFIGURATION_ERROR", message);
}

function normalizeFacts(input = {}) {
  const ownerUserId = Number(input.ownerUserId);
  const kind = String(input.kind || "");
  const path = String(input.path || "");
  const objectKey = String(input.objectKey || "").replace(/^\//, "");
  const objectVersion = String(input.objectVersion || "").trim();
  const uploadOperationId = String(input.uploadOperationId || "");
  const uploadScopeKey = String(input.uploadScopeKey || "");
  const facts = KIND_FACTS[kind];
  if (
    !facts ||
    !Number.isSafeInteger(ownerUserId) || ownerUserId <= 0 ||
    !facts.path.test(path) ||
    !facts.objectKey.test(objectKey) ||
    !objectVersion || objectVersion.length > 128
  ) {
    throw new TypeError("image asset facts are invalid");
  }
  if (Boolean(uploadOperationId) !== Boolean(uploadScopeKey) ||
      (uploadOperationId && !/^[A-Za-z0-9_-]{16,128}$/.test(uploadOperationId)) ||
      uploadScopeKey.length > 256) {
    throw new TypeError("image upload operation facts are invalid");
  }
  return {
    ownerUserId,
    kind,
    path,
    objectKey,
    objectVersion,
    subjectType: facts.subjectType,
    uploadOperationId,
    uploadScopeKey
  };
}

function sameImmutableFacts(asset, facts) {
  return Number(asset?.owner_user_id) === facts.ownerUserId &&
    String(asset?.kind || "") === facts.kind &&
    String(asset?.asset_path || "") === facts.path &&
    String(asset?.object_key || "") === facts.objectKey &&
    String(asset?.object_version || "") === facts.objectVersion &&
    String(asset?.status || "") === "active";
}

export function projectUserImageAssetStatus(asset) {
  const result = {
    assetId: Number(asset.id),
    kind: String(asset.kind),
    moderationStatus: String(asset.moderation_status),
    status: String(asset.status)
  };
  if (String(asset.status) === "active" && isModerationPublished(asset.moderation_status)) {
    result.path = String(asset.asset_path);
  }
  return result;
}

export function createUserImageAssetUploadService(dependencies = {}) {
  const deps = { ...dependencies };
  if (typeof deps.probeUserImageAssetByOwnerPath !== "function" ||
      typeof deps.transaction !== "function" || typeof deps.assertImageIntake !== "function" ||
      typeof deps.repository?.insertUserImageAsset !== "function" ||
      typeof deps.repository?.findUserImageAssetByOwnerPath !== "function" ||
      typeof deps.repository?.protectUserImageUploadCleanup !== "function") {
    throw new TypeError("user image asset persistence dependencies are required");
  }

  return {
    async finalizeUploadedImage(input) {
      const facts = normalizeFacts(input);
      let moderationJob = null;
      const probed = await deps.probeUserImageAssetByOwnerPath({
        ownerUserId: facts.ownerUserId,
        path: facts.path
      });
      if (probed && !sameImmutableFacts(probed, facts)) {
        throw configurationError("existing image asset facts do not match");
      }
      const asset = await deps.transaction(async (connection) => {
        const persistedResult = async (persistedAsset, created) => {
          if (facts.uploadOperationId) {
            if (typeof deps.repository.bindUserImageUploadOperation !== "function" ||
                !await deps.repository.bindUserImageUploadOperation(connection, {
                  ownerUserId: facts.ownerUserId,
                  kind: facts.kind,
                  scopeKey: facts.uploadScopeKey,
                  operationId: facts.uploadOperationId,
                  assetId: persistedAsset.id
                })) {
              throw configurationError("image upload operation could not be bound");
            }
          }
          return { asset: persistedAsset, created };
        };
        if (probed) {
          const existing = await deps.repository.findUserImageAssetByOwnerPath(connection, {
            ownerUserId: facts.ownerUserId,
            path: facts.path
          }, { forUpdate: true });
          if (existing && sameImmutableFacts(existing, facts)) {
            const protectedCleanup = await deps.repository.protectUserImageUploadCleanup(connection, {
              ownerUserId: facts.ownerUserId,
              path: facts.path,
              assetId: existing.id
            });
            if (!protectedCleanup) {
              throw configurationError("image cleanup deletion is already committed");
            }
            return persistedResult(existing, false);
          }
          if (existing) throw configurationError("existing image asset facts do not match");
        }

        // New objects keep the global lock order: settings first, then the
        // owner/path row lock and insert. The transaction recheck closes the
        // race after the non-locking idempotency probe.
        let intake = null;
        let intakeError = null;
        try {
          intake = await deps.assertImageIntake(connection);
        } catch (error) {
          intakeError = error;
        }
        const existing = await deps.repository.findUserImageAssetByOwnerPath(connection, {
          ownerUserId: facts.ownerUserId,
          path: facts.path
        }, { forUpdate: true });
        if (existing) {
          if (!sameImmutableFacts(existing, facts)) {
            throw configurationError("existing image asset facts do not match");
          }
          const protectedCleanup = await deps.repository.protectUserImageUploadCleanup(connection, {
            ownerUserId: facts.ownerUserId,
            path: facts.path,
            assetId: existing.id
          });
          if (!protectedCleanup) {
            throw configurationError("image cleanup deletion is already committed");
          }
          return persistedResult(existing, false);
        }
        if (intakeError) throw intakeError;
        if (intake?.moderationRequired && (
          typeof deps.createWechatImageModerationJob !== "function" ||
          typeof deps.submitWechatImageModeration !== "function"
        )) {
          throw configurationError("required image moderation job hooks are missing");
        }
        let created;
        try {
          created = await deps.repository.insertUserImageAsset(connection, {
            ...facts,
            moderationStatus: intake?.moderationRequired ? "pending" : "approved_legacy"
          });
        } catch (error) {
          if (error?.code !== "ER_DUP_ENTRY") throw error;
          const winner = await deps.repository.findUserImageAssetByOwnerPath(connection, {
            ownerUserId: facts.ownerUserId,
            path: facts.path
          }, { forUpdate: true });
          if (!sameImmutableFacts(winner, facts)) throw error;
          const protectedCleanup = await deps.repository.protectUserImageUploadCleanup(connection, {
            ownerUserId: facts.ownerUserId,
            path: facts.path,
            assetId: winner.id
          });
          if (!protectedCleanup) {
            throw configurationError("image cleanup deletion is already committed");
          }
          return persistedResult(winner, false);
        }
        const protectedCleanup = await deps.repository.protectUserImageUploadCleanup(connection, {
          ownerUserId: facts.ownerUserId,
          path: facts.path,
          assetId: created.id
        });
        if (!protectedCleanup) {
          throw configurationError("image cleanup deletion is already committed");
        }
        if (intake?.moderationRequired) {
          moderationJob = await deps.createWechatImageModerationJob(connection, {
            subjectType: facts.subjectType,
            media: {
              id: created.id,
              uploader_user_id: facts.ownerUserId
            },
            objectKey: facts.objectKey,
            subjectVersion: facts.objectVersion
          });
          if (!moderationJob) {
            throw configurationError("required image moderation job could not be created");
          }
        }
        return persistedResult(created, true);
      });

      const persisted = asset.asset;
      if (!asset.created) return projectUserImageAssetStatus(persisted);

      if (moderationJob) {
        await deps.submitWechatImageModeration(moderationJob);
        return projectUserImageAssetStatus(persisted);
      }
      return projectUserImageAssetStatus(persisted);
    }
  };
}
