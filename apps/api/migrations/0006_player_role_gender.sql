SET @pinche_d11_add_user_gender = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE users ADD COLUMN gender VARCHAR(16) NULL AFTER avatar_url',
    'SELECT 1'
  )
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'users'
    AND column_name = 'gender'
);
PREPARE pinche_d11_user_gender_stmt FROM @pinche_d11_add_user_gender;
EXECUTE pinche_d11_user_gender_stmt;
DEALLOCATE PREPARE pinche_d11_user_gender_stmt;

SET @pinche_d11_add_seat_role_gender = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE session_seats ADD COLUMN role_gender VARCHAR(16) NOT NULL DEFAULT ''unlimited'' AFTER role_name',
    'SELECT 1'
  )
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'session_seats'
    AND column_name = 'role_gender'
);
PREPARE pinche_d11_seat_role_gender_stmt FROM @pinche_d11_add_seat_role_gender;
EXECUTE pinche_d11_seat_role_gender_stmt;
DEALLOCATE PREPARE pinche_d11_seat_role_gender_stmt;
