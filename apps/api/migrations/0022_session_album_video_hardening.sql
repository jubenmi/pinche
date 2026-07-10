ALTER TABLE session_album_photos
  ADD UNIQUE KEY uniq_session_album_video_source_url (source_url);
