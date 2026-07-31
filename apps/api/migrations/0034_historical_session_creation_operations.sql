CREATE TABLE IF NOT EXISTS historical_session_creation_operations (
  organizer_user_id BIGINT UNSIGNED NOT NULL,
  creation_key_hash BINARY(32) NOT NULL,
  payload_hash BINARY(32) NOT NULL,
  session_id BIGINT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (organizer_user_id, creation_key_hash),
  UNIQUE KEY uniq_historical_creation_session (session_id),
  CONSTRAINT fk_historical_creation_organizer
    FOREIGN KEY (organizer_user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
