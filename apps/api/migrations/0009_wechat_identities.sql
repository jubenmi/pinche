CREATE TABLE IF NOT EXISTS wechat_identities (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  app_id VARCHAR(128) NOT NULL,
  open_id VARCHAR(128) NOT NULL,
  union_id VARCHAR(128) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_wechat_identity_app_open (app_id, open_id),
  INDEX idx_wechat_identities_user (user_id),
  INDEX idx_wechat_identities_union_id (union_id),
  CONSTRAINT fk_wechat_identities_user
    FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

