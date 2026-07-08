SET @pinche_d33_add_stores_visibility = (
  SELECT IF(
    NOT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = 'stores'
        AND column_name = 'visibility'
    ),
    'ALTER TABLE stores ADD COLUMN visibility VARCHAR(32) NOT NULL DEFAULT ''public'' AFTER status',
    'SELECT 1'
  )
);

PREPARE pinche_d33_stores_visibility_stmt FROM @pinche_d33_add_stores_visibility;
EXECUTE pinche_d33_stores_visibility_stmt;
DEALLOCATE PREPARE pinche_d33_stores_visibility_stmt;

SET @pinche_d33_add_stores_review_status = (
  SELECT IF(
    NOT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = 'stores'
        AND column_name = 'review_status'
    ),
    'ALTER TABLE stores ADD COLUMN review_status VARCHAR(32) NOT NULL DEFAULT ''approved'' AFTER visibility',
    'SELECT 1'
  )
);

PREPARE pinche_d33_stores_review_status_stmt FROM @pinche_d33_add_stores_review_status;
EXECUTE pinche_d33_stores_review_status_stmt;
DEALLOCATE PREPARE pinche_d33_stores_review_status_stmt;

SET @pinche_d33_add_stores_created_by_user_id = (
  SELECT IF(
    NOT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = 'stores'
        AND column_name = 'created_by_user_id'
    ),
    'ALTER TABLE stores ADD COLUMN created_by_user_id BIGINT UNSIGNED NULL AFTER review_status',
    'SELECT 1'
  )
);

PREPARE pinche_d33_stores_created_by_user_id_stmt FROM @pinche_d33_add_stores_created_by_user_id;
EXECUTE pinche_d33_stores_created_by_user_id_stmt;
DEALLOCATE PREPARE pinche_d33_stores_created_by_user_id_stmt;

SET @pinche_d33_add_stores_reviewed_by_admin_user_id = (
  SELECT IF(
    NOT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = 'stores'
        AND column_name = 'reviewed_by_admin_user_id'
    ),
    'ALTER TABLE stores ADD COLUMN reviewed_by_admin_user_id BIGINT UNSIGNED NULL AFTER created_by_user_id',
    'SELECT 1'
  )
);

PREPARE pinche_d33_stores_reviewed_by_admin_user_id_stmt FROM @pinche_d33_add_stores_reviewed_by_admin_user_id;
EXECUTE pinche_d33_stores_reviewed_by_admin_user_id_stmt;
DEALLOCATE PREPARE pinche_d33_stores_reviewed_by_admin_user_id_stmt;

SET @pinche_d33_add_stores_review_note = (
  SELECT IF(
    NOT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = 'stores'
        AND column_name = 'review_note'
    ),
    'ALTER TABLE stores ADD COLUMN review_note TEXT NULL AFTER reviewed_by_admin_user_id',
    'SELECT 1'
  )
);

PREPARE pinche_d33_stores_review_note_stmt FROM @pinche_d33_add_stores_review_note;
EXECUTE pinche_d33_stores_review_note_stmt;
DEALLOCATE PREPARE pinche_d33_stores_review_note_stmt;

SET @pinche_d33_add_stores_reviewed_at = (
  SELECT IF(
    NOT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = 'stores'
        AND column_name = 'reviewed_at'
    ),
    'ALTER TABLE stores ADD COLUMN reviewed_at DATETIME NULL AFTER review_note',
    'SELECT 1'
  )
);

PREPARE pinche_d33_stores_reviewed_at_stmt FROM @pinche_d33_add_stores_reviewed_at;
EXECUTE pinche_d33_stores_reviewed_at_stmt;
DEALLOCATE PREPARE pinche_d33_stores_reviewed_at_stmt;

SET @pinche_d33_add_stores_merged_into_id = (
  SELECT IF(
    NOT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = 'stores'
        AND column_name = 'merged_into_id'
    ),
    'ALTER TABLE stores ADD COLUMN merged_into_id BIGINT UNSIGNED NULL AFTER reviewed_at',
    'SELECT 1'
  )
);

PREPARE pinche_d33_stores_merged_into_id_stmt FROM @pinche_d33_add_stores_merged_into_id;
EXECUTE pinche_d33_stores_merged_into_id_stmt;
DEALLOCATE PREPARE pinche_d33_stores_merged_into_id_stmt;

SET @pinche_d33_add_stores_visibility_review_index = (
  SELECT IF(
    NOT EXISTS (
      SELECT 1
      FROM information_schema.statistics
      WHERE table_schema = DATABASE()
        AND table_name = 'stores'
        AND index_name = 'idx_stores_visibility_review'
    ),
    'ALTER TABLE stores ADD INDEX idx_stores_visibility_review (visibility, review_status, status)',
    'SELECT 1'
  )
);

PREPARE pinche_d33_stores_visibility_review_index_stmt FROM @pinche_d33_add_stores_visibility_review_index;
EXECUTE pinche_d33_stores_visibility_review_index_stmt;
DEALLOCATE PREPARE pinche_d33_stores_visibility_review_index_stmt;

SET @pinche_d33_add_stores_created_by_review_index = (
  SELECT IF(
    NOT EXISTS (
      SELECT 1
      FROM information_schema.statistics
      WHERE table_schema = DATABASE()
        AND table_name = 'stores'
        AND index_name = 'idx_stores_created_by_review'
    ),
    'ALTER TABLE stores ADD INDEX idx_stores_created_by_review (created_by_user_id, review_status)',
    'SELECT 1'
  )
);

PREPARE pinche_d33_stores_created_by_review_index_stmt FROM @pinche_d33_add_stores_created_by_review_index;
EXECUTE pinche_d33_stores_created_by_review_index_stmt;
DEALLOCATE PREPARE pinche_d33_stores_created_by_review_index_stmt;

SET @pinche_d33_add_scripts_visibility = (
  SELECT IF(
    NOT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = 'scripts'
        AND column_name = 'visibility'
    ),
    'ALTER TABLE scripts ADD COLUMN visibility VARCHAR(32) NOT NULL DEFAULT ''public'' AFTER status',
    'SELECT 1'
  )
);

PREPARE pinche_d33_scripts_visibility_stmt FROM @pinche_d33_add_scripts_visibility;
EXECUTE pinche_d33_scripts_visibility_stmt;
DEALLOCATE PREPARE pinche_d33_scripts_visibility_stmt;

SET @pinche_d33_add_scripts_review_status = (
  SELECT IF(
    NOT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = 'scripts'
        AND column_name = 'review_status'
    ),
    'ALTER TABLE scripts ADD COLUMN review_status VARCHAR(32) NOT NULL DEFAULT ''approved'' AFTER visibility',
    'SELECT 1'
  )
);

PREPARE pinche_d33_scripts_review_status_stmt FROM @pinche_d33_add_scripts_review_status;
EXECUTE pinche_d33_scripts_review_status_stmt;
DEALLOCATE PREPARE pinche_d33_scripts_review_status_stmt;

SET @pinche_d33_add_scripts_created_by_user_id = (
  SELECT IF(
    NOT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = 'scripts'
        AND column_name = 'created_by_user_id'
    ),
    'ALTER TABLE scripts ADD COLUMN created_by_user_id BIGINT UNSIGNED NULL AFTER review_status',
    'SELECT 1'
  )
);

PREPARE pinche_d33_scripts_created_by_user_id_stmt FROM @pinche_d33_add_scripts_created_by_user_id;
EXECUTE pinche_d33_scripts_created_by_user_id_stmt;
DEALLOCATE PREPARE pinche_d33_scripts_created_by_user_id_stmt;

SET @pinche_d33_add_scripts_reviewed_by_admin_user_id = (
  SELECT IF(
    NOT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = 'scripts'
        AND column_name = 'reviewed_by_admin_user_id'
    ),
    'ALTER TABLE scripts ADD COLUMN reviewed_by_admin_user_id BIGINT UNSIGNED NULL AFTER created_by_user_id',
    'SELECT 1'
  )
);

PREPARE pinche_d33_scripts_reviewed_by_admin_user_id_stmt FROM @pinche_d33_add_scripts_reviewed_by_admin_user_id;
EXECUTE pinche_d33_scripts_reviewed_by_admin_user_id_stmt;
DEALLOCATE PREPARE pinche_d33_scripts_reviewed_by_admin_user_id_stmt;

SET @pinche_d33_add_scripts_review_note = (
  SELECT IF(
    NOT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = 'scripts'
        AND column_name = 'review_note'
    ),
    'ALTER TABLE scripts ADD COLUMN review_note TEXT NULL AFTER reviewed_by_admin_user_id',
    'SELECT 1'
  )
);

PREPARE pinche_d33_scripts_review_note_stmt FROM @pinche_d33_add_scripts_review_note;
EXECUTE pinche_d33_scripts_review_note_stmt;
DEALLOCATE PREPARE pinche_d33_scripts_review_note_stmt;

SET @pinche_d33_add_scripts_reviewed_at = (
  SELECT IF(
    NOT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = 'scripts'
        AND column_name = 'reviewed_at'
    ),
    'ALTER TABLE scripts ADD COLUMN reviewed_at DATETIME NULL AFTER review_note',
    'SELECT 1'
  )
);

PREPARE pinche_d33_scripts_reviewed_at_stmt FROM @pinche_d33_add_scripts_reviewed_at;
EXECUTE pinche_d33_scripts_reviewed_at_stmt;
DEALLOCATE PREPARE pinche_d33_scripts_reviewed_at_stmt;

SET @pinche_d33_add_scripts_merged_into_id = (
  SELECT IF(
    NOT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = 'scripts'
        AND column_name = 'merged_into_id'
    ),
    'ALTER TABLE scripts ADD COLUMN merged_into_id BIGINT UNSIGNED NULL AFTER reviewed_at',
    'SELECT 1'
  )
);

PREPARE pinche_d33_scripts_merged_into_id_stmt FROM @pinche_d33_add_scripts_merged_into_id;
EXECUTE pinche_d33_scripts_merged_into_id_stmt;
DEALLOCATE PREPARE pinche_d33_scripts_merged_into_id_stmt;

SET @pinche_d33_add_scripts_visibility_review_index = (
  SELECT IF(
    NOT EXISTS (
      SELECT 1
      FROM information_schema.statistics
      WHERE table_schema = DATABASE()
        AND table_name = 'scripts'
        AND index_name = 'idx_scripts_visibility_review'
    ),
    'ALTER TABLE scripts ADD INDEX idx_scripts_visibility_review (visibility, review_status, status)',
    'SELECT 1'
  )
);

PREPARE pinche_d33_scripts_visibility_review_index_stmt FROM @pinche_d33_add_scripts_visibility_review_index;
EXECUTE pinche_d33_scripts_visibility_review_index_stmt;
DEALLOCATE PREPARE pinche_d33_scripts_visibility_review_index_stmt;

SET @pinche_d33_add_scripts_created_by_review_index = (
  SELECT IF(
    NOT EXISTS (
      SELECT 1
      FROM information_schema.statistics
      WHERE table_schema = DATABASE()
        AND table_name = 'scripts'
        AND index_name = 'idx_scripts_created_by_review'
    ),
    'ALTER TABLE scripts ADD INDEX idx_scripts_created_by_review (created_by_user_id, review_status)',
    'SELECT 1'
  )
);

PREPARE pinche_d33_scripts_created_by_review_index_stmt FROM @pinche_d33_add_scripts_created_by_review_index;
EXECUTE pinche_d33_scripts_created_by_review_index_stmt;
DEALLOCATE PREPARE pinche_d33_scripts_created_by_review_index_stmt;
