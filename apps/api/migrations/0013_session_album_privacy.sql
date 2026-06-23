CREATE TABLE IF NOT EXISTS session_album_privacy (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  session_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  allow_uploaded_visible TINYINT(1) NOT NULL DEFAULT 1,
  allow_tagged_visible TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_session_album_privacy_user (session_id, user_id),
  INDEX idx_session_album_privacy_user (user_id),
  CONSTRAINT fk_session_album_privacy_session FOREIGN KEY (session_id) REFERENCES sessions(id),
  CONSTRAINT fk_session_album_privacy_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS session_album_photos (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  session_id BIGINT UNSIGNED NOT NULL,
  uploader_user_id BIGINT UNSIGNED NOT NULL,
  photo_url VARCHAR(512) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_session_album_photos_session_status (session_id, status, created_at),
  INDEX idx_session_album_photos_uploader (uploader_user_id),
  CONSTRAINT fk_session_album_photos_session FOREIGN KEY (session_id) REFERENCES sessions(id),
  CONSTRAINT fk_session_album_photos_uploader FOREIGN KEY (uploader_user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS session_album_photo_tags (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  photo_id BIGINT UNSIGNED NOT NULL,
  tag_type VARCHAR(32) NOT NULL,
  seat_id BIGINT UNSIGNED NULL,
  user_id BIGINT UNSIGNED NULL,
  label VARCHAR(128) NOT NULL,
  sort_order INT UNSIGNED NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_session_album_photo_tags_photo (photo_id, sort_order),
  INDEX idx_session_album_photo_tags_user (user_id),
  INDEX idx_session_album_photo_tags_seat (seat_id),
  CONSTRAINT fk_session_album_photo_tags_photo FOREIGN KEY (photo_id) REFERENCES session_album_photos(id),
  CONSTRAINT fk_session_album_photo_tags_user FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT fk_session_album_photo_tags_seat FOREIGN KEY (seat_id) REFERENCES session_seats(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
