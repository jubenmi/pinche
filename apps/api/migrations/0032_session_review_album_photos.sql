ALTER TABLE session_review_photos
  MODIFY COLUMN photo_url VARCHAR(512) NULL,
  MODIFY COLUMN image_asset_id BIGINT UNSIGNED NULL,
  ADD COLUMN album_photo_id BIGINT UNSIGNED NULL AFTER image_asset_id,
  ADD KEY idx_session_review_photos_album_photo (album_photo_id),
  ADD CONSTRAINT fk_session_review_photos_album_photo
    FOREIGN KEY (album_photo_id) REFERENCES session_album_photos(id) ON DELETE CASCADE;

