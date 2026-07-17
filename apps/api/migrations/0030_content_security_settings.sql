CREATE TABLE IF NOT EXISTS content_security_settings (
  id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
  block_when_unavailable BOOLEAN NOT NULL DEFAULT FALSE,
  block_image_when_unavailable BOOLEAN NOT NULL DEFAULT FALSE,
  block_video_when_unavailable BOOLEAN NOT NULL DEFAULT FALSE,
  block_text_when_unavailable BOOLEAN NOT NULL DEFAULT FALSE,
  updated_by_user_id BIGINT UNSIGNED NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT chk_content_security_settings_singleton CHECK (id = 1),
  CONSTRAINT fk_content_security_settings_updated_by FOREIGN KEY (updated_by_user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO content_security_settings (id) VALUES (1)
ON DUPLICATE KEY UPDATE id = VALUES(id);

CREATE TABLE IF NOT EXISTS content_security_settings_audit_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  actor_user_id BIGINT UNSIGNED NOT NULL,
  previous_settings JSON NOT NULL,
  next_settings JSON NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_content_security_settings_audit_actor FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE RESTRICT,
  KEY idx_content_security_settings_audit_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
