SET @pinche_d23_add_session_join_policy = (
  SELECT IF(
    NOT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = 'sessions'
        AND column_name = 'join_policy'
    ),
    'ALTER TABLE sessions ADD COLUMN join_policy VARCHAR(32) NOT NULL DEFAULT ''review_required'' AFTER visibility',
    'SELECT 1'
  )
);

PREPARE pinche_d23_session_join_policy_stmt FROM @pinche_d23_add_session_join_policy;
EXECUTE pinche_d23_session_join_policy_stmt;
DEALLOCATE PREPARE pinche_d23_session_join_policy_stmt;
