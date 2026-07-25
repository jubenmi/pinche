ALTER TABLE sessions
  ADD COLUMN creation_idempotency_key VARCHAR(128) NULL AFTER organizer_user_id,
  ADD UNIQUE KEY uniq_sessions_organizer_creation_key
    (organizer_user_id, creation_idempotency_key);
