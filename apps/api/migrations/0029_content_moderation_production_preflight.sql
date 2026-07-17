CREATE TABLE IF NOT EXISTS content_moderation_production_preflight_provider_locks (
  provider VARCHAR(32) NOT NULL PRIMARY KEY,
  last_started_at DATETIME(3) NULL,
  active_run_id CHAR(36) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS content_moderation_production_preflight_runs (
  id CHAR(36) NOT NULL PRIMARY KEY,
  case_id VARCHAR(64) NOT NULL,
  provider VARCHAR(32) NOT NULL,
  state VARCHAR(32) NOT NULL,
  operator_user_id BIGINT UNSIGNED NOT NULL,
  config_fingerprint VARCHAR(128) NOT NULL,
  asset_fingerprint VARCHAR(128) NOT NULL,
  result_category VARCHAR(32) NULL,
  cleanup_status VARCHAR(32) NOT NULL DEFAULT 'not_required',
  elapsed_ms INT UNSIGNED NULL,
  failure_code VARCHAR(64) NULL,
  failure_message VARCHAR(255) NULL,
  started_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  completed_at DATETIME(3) NULL,
  KEY idx_cmppr_provider_state (provider, state),
  KEY idx_cmppr_started_at (started_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS content_moderation_production_preflight_attempts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  run_id CHAR(36) NOT NULL,
  provider VARCHAR(32) NOT NULL,
  association_kind VARCHAR(32) NOT NULL,
  association_hmac CHAR(64) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_cmppa_association (provider, association_kind, association_hmac),
  KEY idx_cmppa_run_id (run_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
