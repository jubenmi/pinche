ALTER TABLE session_album_photos
  ADD COLUMN tag_version BIGINT UNSIGNED NOT NULL DEFAULT 0;

ALTER TABLE session_album_public_shares
  ADD COLUMN implicit_untagged_media JSON NULL AFTER media_ids;
