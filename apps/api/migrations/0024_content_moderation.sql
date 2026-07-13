CREATE TABLE content_moderation_jobs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  subject_type VARCHAR(64) NOT NULL,
  subject_id VARCHAR(128) NOT NULL,
  subject_version VARCHAR(128) NOT NULL,
  provider VARCHAR(32) NOT NULL,
  provider_job_id VARCHAR(128) NULL,
  data_id VARCHAR(128) NOT NULL,
  policy_id VARCHAR(128) NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  suggestion VARCHAR(32) NULL,
  label VARCHAR(64) NULL,
  sub_label VARCHAR(128) NULL,
  score INT NULL,
  response_summary_json JSON NULL,
  attempt_count INT UNSIGNED NOT NULL DEFAULT 0,
  next_retry_at DATETIME NULL,
  lease_token VARCHAR(64) NULL,
  lease_expires_at DATETIME NULL,
  last_error_code VARCHAR(128) NULL,
  submitted_at DATETIME NULL,
  completed_at DATETIME NULL,
  decided_by_admin_user_id BIGINT UNSIGNED NULL,
  decision_reason VARCHAR(500) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_moderation_subject_version (subject_type, subject_id, subject_version),
  UNIQUE KEY uniq_moderation_data_id (data_id),
  INDEX idx_moderation_queue (status, next_retry_at, created_at),
  INDEX idx_moderation_provider_job (provider, provider_job_id),
  CONSTRAINT fk_moderation_decided_admin
    FOREIGN KEY (decided_by_admin_user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE content_moderation_text_proposals (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  moderation_job_id BIGINT UNSIGNED NOT NULL,
  subject_type VARCHAR(64) NOT NULL,
  subject_id VARCHAR(128) NOT NULL,
  base_version VARCHAR(128) NOT NULL,
  normalized_payload_json JSON NOT NULL,
  payload_digest CHAR(64) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  created_by_user_id BIGINT UNSIGNED NOT NULL,
  applied_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_moderation_text_job (moderation_job_id),
  INDEX idx_moderation_text_subject (subject_type, subject_id, status),
  CONSTRAINT fk_moderation_text_job
    FOREIGN KEY (moderation_job_id) REFERENCES content_moderation_jobs(id) ON DELETE CASCADE,
  CONSTRAINT fk_moderation_text_user
    FOREIGN KEY (created_by_user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE content_moderation_audit_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  moderation_job_id BIGINT UNSIGNED NOT NULL,
  admin_user_id BIGINT UNSIGNED NOT NULL,
  action VARCHAR(32) NOT NULL,
  previous_status VARCHAR(32) NOT NULL,
  next_status VARCHAR(32) NOT NULL,
  reason VARCHAR(500) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_moderation_audit_job (moderation_job_id, created_at),
  CONSTRAINT fk_moderation_audit_job
    FOREIGN KEY (moderation_job_id) REFERENCES content_moderation_jobs(id) ON DELETE CASCADE,
  CONSTRAINT fk_moderation_audit_admin
    FOREIGN KEY (admin_user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE session_album_photos
  ADD COLUMN moderation_status VARCHAR(32) NOT NULL DEFAULT 'approved_legacy' AFTER processing_status,
  ADD COLUMN moderation_object_version VARCHAR(128) NULL AFTER moderation_status,
  ADD INDEX idx_album_moderation (session_id, status, moderation_status, created_at);

ALTER TABLE session_album_object_cleanup_jobs
  ADD COLUMN object_urls_json JSON NULL AFTER local_path;
