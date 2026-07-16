CREATE TABLE IF NOT EXISTS user_notifications (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  type VARCHAR(64) NOT NULL,
  session_id BIGINT UNSIGNED NULL,
  title VARCHAR(255) NOT NULL,
  payload_json JSON NULL,
  dedupe_key VARCHAR(191) NOT NULL,
  read_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_user_notifications_dedupe (user_id, dedupe_key),
  KEY idx_user_notifications_inbox (user_id, read_at, created_at),
  CONSTRAINT fk_user_notifications_user FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT fk_user_notifications_session FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
