ALTER TABLE session_album_photos
  ADD COLUMN image_width INT UNSIGNED NULL AFTER photo_url,
  ADD COLUMN image_height INT UNSIGNED NULL AFTER image_width,
  ADD COLUMN image_byte_size INT UNSIGNED NULL AFTER image_height,
  ADD COLUMN image_content_type VARCHAR(64) NOT NULL DEFAULT 'image/jpeg' AFTER image_byte_size;
