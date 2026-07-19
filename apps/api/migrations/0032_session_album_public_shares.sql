CREATE TABLE session_album_public_shares (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  session_id BIGINT UNSIGNED NOT NULL,
  sharer_user_id BIGINT UNSIGNED NOT NULL,
  seat_id BIGINT UNSIGNED NOT NULL,
  media_ids JSON NOT NULL,
  snapshot_digest CHAR(64) NOT NULL,
  cover_media_ids JSON NOT NULL,
  expires_at DATETIME NOT NULL,
  revoked_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_album_public_share_owner (
    session_id, sharer_user_id, seat_id, created_at
  ),
  INDEX idx_album_public_share_expiry (expires_at),
  CONSTRAINT fk_album_public_share_session
    FOREIGN KEY (session_id) REFERENCES sessions(id),
  CONSTRAINT fk_album_public_share_user
    FOREIGN KEY (sharer_user_id) REFERENCES users(id),
  CONSTRAINT fk_album_public_share_seat
    FOREIGN KEY (seat_id) REFERENCES session_seats(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
