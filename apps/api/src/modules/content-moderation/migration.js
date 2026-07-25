import {
  AUTHOR_PRIVATE_CONTENT_VISIBILITY_MIGRATION,
  CONTENT_MODERATION_PROVIDER_ATTEMPTS_MIGRATION,
  CONTENT_MODERATION_RETRY_EXHAUSTION_MIGRATION,
  CONTENT_MODERATION_TEXT_PROPOSAL_RESULT_MIGRATION,
  reconcileAuthorPrivateContentVisibility,
  reconcileContentModerationProviderAttempts,
  reconcileContentModerationRetryExhaustion,
  reconcileContentModerationTextProposalResult,
} from "../album-video/migration.js";

export {
  AUTHOR_PRIVATE_CONTENT_VISIBILITY_MIGRATION,
  CONTENT_MODERATION_PROVIDER_ATTEMPTS_MIGRATION,
  CONTENT_MODERATION_RETRY_EXHAUSTION_MIGRATION,
  CONTENT_MODERATION_TEXT_PROPOSAL_RESULT_MIGRATION,
  reconcileAuthorPrivateContentVisibility,
  reconcileContentModerationProviderAttempts,
  reconcileContentModerationRetryExhaustion,
  reconcileContentModerationTextProposalResult,
};

export const CONTENT_MODERATION_MIGRATIONS = Object.freeze(new Set([
  CONTENT_MODERATION_PROVIDER_ATTEMPTS_MIGRATION,
  CONTENT_MODERATION_TEXT_PROPOSAL_RESULT_MIGRATION,
  CONTENT_MODERATION_RETRY_EXHAUSTION_MIGRATION,
  AUTHOR_PRIVATE_CONTENT_VISIBILITY_MIGRATION,
]));

export async function prepareContentModerationMigration(connection, filename) {
  if (filename === CONTENT_MODERATION_PROVIDER_ATTEMPTS_MIGRATION) {
    await reconcileContentModerationProviderAttempts(connection);
    return { skipStatements: true, reconciledContentModeration: true };
  }
  if (filename === CONTENT_MODERATION_TEXT_PROPOSAL_RESULT_MIGRATION) {
    await reconcileContentModerationTextProposalResult(connection);
    return { skipStatements: true, reconciledContentModeration: true };
  }
  if (filename === CONTENT_MODERATION_RETRY_EXHAUSTION_MIGRATION) {
    await reconcileContentModerationRetryExhaustion(connection);
    return { skipStatements: true, reconciledContentModeration: true };
  }
  if (filename === AUTHOR_PRIVATE_CONTENT_VISIBILITY_MIGRATION) {
    return {
      skipStatements: true,
      ...(await reconcileAuthorPrivateContentVisibility(connection)),
    };
  }
  return { skipStatements: false };
}
