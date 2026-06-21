SET @pinche_d17_add_organizer_hidden_at = (
  SELECT IF(
    NOT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = 'sessions'
        AND column_name = 'organizer_hidden_at'
    ),
    'ALTER TABLE sessions ADD COLUMN organizer_hidden_at DATETIME NULL AFTER visibility',
    'SELECT 1'
  )
);

PREPARE pinche_d17_organizer_hidden_stmt FROM @pinche_d17_add_organizer_hidden_at;
EXECUTE pinche_d17_organizer_hidden_stmt;
DEALLOCATE PREPARE pinche_d17_organizer_hidden_stmt;

SET @pinche_d17_add_signup_user_hidden_at = (
  SELECT IF(
    NOT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = 'signups'
        AND column_name = 'user_hidden_at'
    ),
    'ALTER TABLE signups ADD COLUMN user_hidden_at DATETIME NULL AFTER review_eligible_at',
    'SELECT 1'
  )
);

PREPARE pinche_d17_signup_user_hidden_stmt FROM @pinche_d17_add_signup_user_hidden_at;
EXECUTE pinche_d17_signup_user_hidden_stmt;
DEALLOCATE PREPARE pinche_d17_signup_user_hidden_stmt;
