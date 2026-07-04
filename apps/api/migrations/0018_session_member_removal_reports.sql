CREATE TABLE IF NOT EXISTS session_member_removal_reports (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  session_id BIGINT UNSIGNED NOT NULL,
  seat_id BIGINT UNSIGNED NOT NULL,
  removed_user_id BIGINT UNSIGNED NOT NULL,
  removed_by_user_id BIGINT UNSIGNED NOT NULL,
  reason_type VARCHAR(64) NOT NULL,
  reason_text TEXT NULL,
  block_rejoin TINYINT(1) NOT NULL DEFAULT 1,
  status VARCHAR(32) NOT NULL DEFAULT 'pending_review',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_member_removal_session_user (session_id, removed_user_id, block_rejoin),
  INDEX idx_member_removal_status_created (status, created_at),
  CONSTRAINT fk_member_removal_session FOREIGN KEY (session_id) REFERENCES sessions(id),
  CONSTRAINT fk_member_removal_seat FOREIGN KEY (seat_id) REFERENCES session_seats(id),
  CONSTRAINT fk_member_removal_removed_user FOREIGN KEY (removed_user_id) REFERENCES users(id),
  CONSTRAINT fk_member_removal_removed_by FOREIGN KEY (removed_by_user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
