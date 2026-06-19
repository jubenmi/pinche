SET @pinche_d15_add_review_eligible_at = (
  SELECT IF(
    NOT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = 'signups'
        AND column_name = 'review_eligible_at'
    ),
    'ALTER TABLE signups ADD COLUMN review_eligible_at DATETIME NULL AFTER deposit_status',
    'SELECT 1'
  )
);

PREPARE pinche_d15_review_eligible_stmt FROM @pinche_d15_add_review_eligible_at;
EXECUTE pinche_d15_review_eligible_stmt;
DEALLOCATE PREPARE pinche_d15_review_eligible_stmt;

UPDATE signups
SET review_eligible_at = updated_at
WHERE status = 'approved'
  AND review_eligible_at IS NULL;

CREATE TABLE IF NOT EXISTS session_reviews (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  session_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  seat_id BIGINT UNSIGNED NULL,
  rating TINYINT UNSIGNED NOT NULL,
  content TEXT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_session_reviews_user (session_id, user_id),
  INDEX idx_session_reviews_session_status (session_id, status),
  INDEX idx_session_reviews_user (user_id),
  INDEX idx_session_reviews_seat (seat_id),
  CONSTRAINT fk_session_reviews_session FOREIGN KEY (session_id) REFERENCES sessions(id),
  CONSTRAINT fk_session_reviews_user FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT fk_session_reviews_seat FOREIGN KEY (seat_id) REFERENCES session_seats(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS session_review_photos (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  review_id BIGINT UNSIGNED NOT NULL,
  photo_url VARCHAR(512) NOT NULL,
  sort_order INT UNSIGNED NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_session_review_photos_review (review_id, sort_order),
  CONSTRAINT fk_session_review_photos_review FOREIGN KEY (review_id) REFERENCES session_reviews(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
