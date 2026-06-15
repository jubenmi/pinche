CREATE TABLE IF NOT EXISTS admin_web_login_tickets (
  id CHAR(36) NOT NULL PRIMARY KEY,
  secret_hash CHAR(64) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  approved_by_user_id BIGINT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NOT NULL,
  approved_at DATETIME NULL,
  consumed_at DATETIME NULL,
  user_agent VARCHAR(255) NULL,
  INDEX idx_admin_web_login_status_expires (status, expires_at),
  CONSTRAINT fk_admin_web_login_approved_by
    FOREIGN KEY (approved_by_user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
