SET @pinche_d25_add_session_join_phone_required = (
  SELECT IF(
    NOT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = 'sessions'
        AND column_name = 'join_phone_required'
    ),
    'ALTER TABLE sessions ADD COLUMN join_phone_required TINYINT(1) NOT NULL DEFAULT 1 AFTER join_policy',
    'SELECT 1'
  )
);
PREPARE pinche_d25_session_join_phone_required_stmt FROM @pinche_d25_add_session_join_phone_required;
EXECUTE pinche_d25_session_join_phone_required_stmt;
DEALLOCATE PREPARE pinche_d25_session_join_phone_required_stmt;
