SET @session_purpose_exists = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'sessions'
    AND COLUMN_NAME = 'session_purpose'
);
SET @session_purpose_sql = IF(
  @session_purpose_exists = 0,
  'ALTER TABLE sessions ADD COLUMN session_purpose VARCHAR(32) NOT NULL DEFAULT ''future_carpool'' AFTER start_at',
  'SELECT 1'
);
PREPARE session_purpose_statement FROM @session_purpose_sql;
EXECUTE session_purpose_statement;
DEALLOCATE PREPARE session_purpose_statement;

SET @session_purpose_index_exists = (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'sessions'
    AND INDEX_NAME = 'idx_sessions_public_purpose_status_start'
);
SET @session_purpose_index_sql = IF(
  @session_purpose_index_exists = 0,
  'ALTER TABLE sessions ADD INDEX idx_sessions_public_purpose_status_start (session_purpose, visibility, status, start_at)',
  'SELECT 1'
);
PREPARE session_purpose_index_statement FROM @session_purpose_index_sql;
EXECUTE session_purpose_index_statement;
DEALLOCATE PREPARE session_purpose_index_statement;
