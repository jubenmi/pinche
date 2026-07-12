ALTER TABLE content_moderation_text_proposals
  ADD COLUMN IF NOT EXISTS applied_result_json JSON NULL AFTER applied_at;
