ALTER TABLE content_moderation_jobs
  ADD COLUMN IF NOT EXISTS retry_exhausted_at DATETIME NULL AFTER next_retry_at;
