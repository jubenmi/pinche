SET @pinche_d26_add_script_npc_role_gender = (
  SELECT IF(
    NOT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = 'script_npc_roles'
        AND column_name = 'role_gender'
    ),
    'ALTER TABLE script_npc_roles ADD COLUMN role_gender VARCHAR(16) NOT NULL DEFAULT ''unlimited'' AFTER description',
    'SELECT 1'
  )
);

PREPARE pinche_d26_script_npc_role_gender_stmt FROM @pinche_d26_add_script_npc_role_gender;
EXECUTE pinche_d26_script_npc_role_gender_stmt;
DEALLOCATE PREPARE pinche_d26_script_npc_role_gender_stmt;

SET @pinche_d26_add_session_npc_role_gender = (
  SELECT IF(
    NOT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = 'session_npc_roles'
        AND column_name = 'role_gender'
    ),
    'ALTER TABLE session_npc_roles ADD COLUMN role_gender VARCHAR(16) NOT NULL DEFAULT ''unlimited'' AFTER description',
    'SELECT 1'
  )
);

PREPARE pinche_d26_session_npc_role_gender_stmt FROM @pinche_d26_add_session_npc_role_gender;
EXECUTE pinche_d26_session_npc_role_gender_stmt;
DEALLOCATE PREPARE pinche_d26_session_npc_role_gender_stmt;
