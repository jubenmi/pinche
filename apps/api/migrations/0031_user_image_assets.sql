CREATE TABLE user_image_assets (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  owner_user_id BIGINT UNSIGNED NOT NULL,
  kind VARCHAR(32) NOT NULL,
  asset_path VARCHAR(512) NOT NULL,
  object_key VARCHAR(512) NULL,
  object_version VARCHAR(128) NOT NULL,
  moderation_status VARCHAR(32) NOT NULL DEFAULT 'approved_legacy',
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uniq_user_image_asset_owner_path (owner_user_id, asset_path),
  KEY idx_user_image_asset_path (asset_path),
  KEY idx_user_image_asset_object_key (object_key),
  KEY idx_user_image_asset_owner_kind (owner_user_id, kind, status, moderation_status),
  KEY idx_user_image_asset_moderation (moderation_status, status, created_at),
  CONSTRAINT fk_user_image_asset_owner
    FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT chk_user_image_asset_kind CHECK (kind IN ('avatar', 'review')),
  CONSTRAINT chk_user_image_asset_status CHECK (status IN ('active', 'deleted')),
  CONSTRAINT chk_user_image_asset_moderation CHECK (
    moderation_status IN ('pending', 'approved', 'approved_legacy', 'review', 'rejected', 'error')
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE users
  ADD COLUMN avatar_image_asset_id BIGINT UNSIGNED NULL AFTER avatar_url,
  ADD KEY idx_users_avatar_image_asset (avatar_image_asset_id);

ALTER TABLE session_review_photos
  ADD COLUMN image_asset_id BIGINT UNSIGNED NULL AFTER photo_url,
  ADD KEY idx_session_review_photo_asset (image_asset_id);

INSERT INTO user_image_assets
  (owner_user_id, kind, asset_path, object_key, object_version, moderation_status, status)
SELECT user.id, 'avatar', user.avatar_url, TRIM(LEADING '/' FROM user.avatar_url),
       CONCAT('legacy:', SHA2(user.avatar_url, 256)), 'approved_legacy', 'active'
FROM users AS user
WHERE user.avatar_url REGEXP '^/uploads/avatars/[A-Za-z0-9._-]+$'
ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id);

UPDATE users AS user
JOIN user_image_assets AS asset
  ON asset.owner_user_id = user.id
 AND asset.kind = 'avatar'
 AND asset.asset_path = user.avatar_url
SET user.avatar_image_asset_id = asset.id
WHERE user.avatar_url IS NOT NULL;

-- The migration reconciler rejects the migration before recording 0031 when
-- any trimmed non-empty avatar_url remains without avatar_image_asset_id. This
-- deliberately fail-closes legacy paths outside the served flat
-- /uploads/avatars/[A-Za-z0-9._-]+ namespace instead of publishing them.

INSERT INTO user_image_assets
  (owner_user_id, kind, asset_path, object_key, object_version, moderation_status, status)
SELECT review.user_id, 'review', photo.photo_url, TRIM(LEADING '/' FROM photo.photo_url),
       CONCAT('legacy:', SHA2(CONCAT(review.user_id, ':', photo.photo_url), 256)),
       'approved_legacy', 'active'
FROM session_review_photos AS photo
JOIN session_reviews AS review ON review.id = photo.review_id
WHERE photo.photo_url REGEXP '^/uploads/session-reviews/[A-Za-z0-9._-]+$'
GROUP BY review.user_id, photo.photo_url
ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id);

UPDATE session_review_photos AS photo
JOIN session_reviews AS review ON review.id = photo.review_id
JOIN user_image_assets AS asset
  ON asset.owner_user_id = review.user_id
 AND asset.kind = 'review'
 AND asset.asset_path = photo.photo_url
SET photo.image_asset_id = asset.id;

ALTER TABLE users
  ADD CONSTRAINT fk_users_avatar_image_asset
    FOREIGN KEY (avatar_image_asset_id) REFERENCES user_image_assets(id) ON DELETE SET NULL;

ALTER TABLE session_review_photos
  ADD CONSTRAINT fk_session_review_photo_asset
    FOREIGN KEY (image_asset_id) REFERENCES user_image_assets(id) ON DELETE RESTRICT;

-- image_asset_id IS NULL causes the migration reconciler to reject owner-scoped
-- backfill before applying this mandatory association.
ALTER TABLE session_review_photos
  MODIFY COLUMN image_asset_id BIGINT UNSIGNED NOT NULL;

CREATE TABLE user_image_asset_cleanup_jobs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_image_asset_id BIGINT UNSIGNED NULL,
  owner_user_id BIGINT UNSIGNED NOT NULL,
  asset_path VARCHAR(512) NOT NULL,
  object_key VARCHAR(512) NOT NULL,
  storage_kind VARCHAR(16) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  attempts INT UNSIGNED NOT NULL DEFAULT 0,
  cleanup_not_before DATETIME NOT NULL,
  next_retry_at DATETIME NULL,
  last_error_code VARCHAR(64) NULL,
  lease_token CHAR(36) NULL,
  lease_expires_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  completed_at DATETIME NULL,
  UNIQUE KEY uniq_user_image_cleanup_asset (user_image_asset_id),
  UNIQUE KEY uniq_user_image_cleanup_owner_path (owner_user_id, asset_path),
  KEY idx_user_image_cleanup_claim (status, cleanup_not_before, next_retry_at, lease_expires_at),
  CONSTRAINT fk_user_image_cleanup_asset
    FOREIGN KEY (user_image_asset_id) REFERENCES user_image_assets(id) ON DELETE SET NULL,
  CONSTRAINT fk_user_image_cleanup_owner
    FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT chk_user_image_cleanup_storage CHECK (storage_kind IN ('cos', 'local')),
  CONSTRAINT chk_user_image_cleanup_status CHECK (
    status IN ('pending', 'leased', 'deleting', 'retry', 'cleaned', 'retained')
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE user_image_object_cleanup_jobs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  asset_path VARCHAR(512) NOT NULL,
  object_key VARCHAR(512) NOT NULL,
  storage_kind VARCHAR(16) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  attempts INT UNSIGNED NOT NULL DEFAULT 0,
  cleanup_not_before DATETIME NOT NULL,
  next_retry_at DATETIME NULL,
  last_error_code VARCHAR(64) NULL,
  lease_token CHAR(36) NULL,
  lease_expires_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  completed_at DATETIME NULL,
  UNIQUE KEY uniq_user_image_object_cleanup (storage_kind, object_key),
  KEY idx_user_image_object_cleanup_claim
    (status, cleanup_not_before, next_retry_at, lease_expires_at),
  CONSTRAINT chk_user_image_object_cleanup_storage CHECK (storage_kind IN ('cos', 'local')),
  CONSTRAINT chk_user_image_object_cleanup_status CHECK (
    status IN ('pending', 'leased', 'deleting', 'retry', 'cleaned')
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE user_image_upload_operations (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  owner_user_id BIGINT UNSIGNED NOT NULL,
  kind VARCHAR(32) NOT NULL,
  scope_key VARCHAR(256) NOT NULL,
  operation_id VARCHAR(128) NOT NULL,
  user_image_asset_id BIGINT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_user_image_upload_operation
    (owner_user_id, kind, scope_key, operation_id),
  KEY idx_user_image_upload_operation_asset (user_image_asset_id),
  CONSTRAINT fk_user_image_upload_operation_owner
    FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_user_image_upload_operation_asset
    FOREIGN KEY (user_image_asset_id) REFERENCES user_image_assets(id) ON DELETE RESTRICT,
  CONSTRAINT chk_user_image_upload_operation_kind CHECK (kind IN ('avatar', 'review'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
