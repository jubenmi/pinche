CREATE TABLE session_start_time_corrections (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  session_id BIGINT UNSIGNED NOT NULL,
  changed_by_user_id BIGINT UNSIGNED NOT NULL,
  old_start_at DATETIME NOT NULL,
  new_start_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_session_start_time_corrections_session_created (session_id, created_at, id),
  CONSTRAINT fk_session_start_time_corrections_session
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  CONSTRAINT fk_session_start_time_corrections_user
    FOREIGN KEY (changed_by_user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
