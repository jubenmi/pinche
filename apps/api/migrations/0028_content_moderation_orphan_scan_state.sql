CREATE TABLE IF NOT EXISTS content_moderation_orphan_scan_state (
  scan_name VARCHAR(64) NOT NULL PRIMARY KEY,
  cursor_value VARCHAR(1024) NULL,
  lease_token VARCHAR(128) NULL,
  lease_expires_at DATETIME NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_content_moderation_orphan_scan_lease (lease_expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
