SET @pinche_d24_add_session_npc_join_enabled = (
  SELECT IF(
    NOT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = 'sessions'
        AND column_name = 'npc_join_enabled'
    ),
    'ALTER TABLE sessions ADD COLUMN npc_join_enabled TINYINT(1) NOT NULL DEFAULT 1 AFTER join_policy',
    'SELECT 1'
  )
);

PREPARE pinche_d24_session_npc_join_enabled_stmt FROM @pinche_d24_add_session_npc_join_enabled;
EXECUTE pinche_d24_session_npc_join_enabled_stmt;
DEALLOCATE PREPARE pinche_d24_session_npc_join_enabled_stmt;

SET @pinche_d24_nullable_signup_seat_id = (
  SELECT IF(
    EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = 'signups'
        AND column_name = 'seat_id'
        AND is_nullable = 'NO'
    ),
    'ALTER TABLE signups MODIFY seat_id BIGINT UNSIGNED NULL',
    'SELECT 1'
  )
);

PREPARE pinche_d24_signup_seat_id_stmt FROM @pinche_d24_nullable_signup_seat_id;
EXECUTE pinche_d24_signup_seat_id_stmt;
DEALLOCATE PREPARE pinche_d24_signup_seat_id_stmt;

SET @pinche_d24_add_signup_session_npc_role_id = (
  SELECT IF(
    NOT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = 'signups'
        AND column_name = 'session_npc_role_id'
    ),
    'ALTER TABLE signups ADD COLUMN session_npc_role_id BIGINT UNSIGNED NULL AFTER seat_id',
    'SELECT 1'
  )
);

PREPARE pinche_d24_signup_session_npc_role_id_stmt FROM @pinche_d24_add_signup_session_npc_role_id;
EXECUTE pinche_d24_signup_session_npc_role_id_stmt;
DEALLOCATE PREPARE pinche_d24_signup_session_npc_role_id_stmt;

SET @pinche_d24_add_signup_type = (
  SELECT IF(
    NOT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = 'signups'
        AND column_name = 'signup_type'
    ),
    'ALTER TABLE signups ADD COLUMN signup_type VARCHAR(32) NOT NULL DEFAULT ''seat'' AFTER session_npc_role_id',
    'SELECT 1'
  )
);

PREPARE pinche_d24_signup_type_stmt FROM @pinche_d24_add_signup_type;
EXECUTE pinche_d24_signup_type_stmt;
DEALLOCATE PREPARE pinche_d24_signup_type_stmt;

SET @pinche_d24_add_signup_npc_role_unique = (
  SELECT IF(
    NOT EXISTS (
      SELECT 1
      FROM information_schema.statistics
      WHERE table_schema = DATABASE()
        AND table_name = 'signups'
        AND index_name = 'uniq_signup_user_npc_role'
    ),
    'ALTER TABLE signups ADD UNIQUE KEY uniq_signup_user_npc_role (session_npc_role_id, user_id)',
    'SELECT 1'
  )
);

PREPARE pinche_d24_signup_npc_role_unique_stmt FROM @pinche_d24_add_signup_npc_role_unique;
EXECUTE pinche_d24_signup_npc_role_unique_stmt;
DEALLOCATE PREPARE pinche_d24_signup_npc_role_unique_stmt;

SET @pinche_d24_add_signup_npc_role_index = (
  SELECT IF(
    NOT EXISTS (
      SELECT 1
      FROM information_schema.statistics
      WHERE table_schema = DATABASE()
        AND table_name = 'signups'
        AND index_name = 'idx_signups_npc_role_status'
    ),
    'ALTER TABLE signups ADD INDEX idx_signups_npc_role_status (session_npc_role_id, status)',
    'SELECT 1'
  )
);

PREPARE pinche_d24_signup_npc_role_index_stmt FROM @pinche_d24_add_signup_npc_role_index;
EXECUTE pinche_d24_signup_npc_role_index_stmt;
DEALLOCATE PREPARE pinche_d24_signup_npc_role_index_stmt;

SET @pinche_d24_add_signup_npc_role_fk = (
  SELECT IF(
    NOT EXISTS (
      SELECT 1
      FROM information_schema.table_constraints
      WHERE table_schema = DATABASE()
        AND table_name = 'signups'
        AND constraint_name = 'fk_signups_session_npc_role'
    ),
    'ALTER TABLE signups ADD CONSTRAINT fk_signups_session_npc_role FOREIGN KEY (session_npc_role_id) REFERENCES session_npc_roles(id)',
    'SELECT 1'
  )
);

PREPARE pinche_d24_signup_npc_role_fk_stmt FROM @pinche_d24_add_signup_npc_role_fk;
EXECUTE pinche_d24_signup_npc_role_fk_stmt;
DEALLOCATE PREPARE pinche_d24_signup_npc_role_fk_stmt;
