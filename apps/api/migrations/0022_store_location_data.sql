SET @pinche_d34_add_stores_latitude = (
  SELECT IF(
    NOT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = 'stores'
        AND column_name = 'latitude'
    ),
    'ALTER TABLE stores ADD COLUMN latitude DECIMAL(10, 7) NULL AFTER address',
    'SELECT 1'
  )
);

PREPARE pinche_d34_stores_latitude_stmt FROM @pinche_d34_add_stores_latitude;
EXECUTE pinche_d34_stores_latitude_stmt;
DEALLOCATE PREPARE pinche_d34_stores_latitude_stmt;

SET @pinche_d34_add_stores_longitude = (
  SELECT IF(
    NOT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = 'stores'
        AND column_name = 'longitude'
    ),
    'ALTER TABLE stores ADD COLUMN longitude DECIMAL(10, 7) NULL AFTER latitude',
    'SELECT 1'
  )
);

PREPARE pinche_d34_stores_longitude_stmt FROM @pinche_d34_add_stores_longitude;
EXECUTE pinche_d34_stores_longitude_stmt;
DEALLOCATE PREPARE pinche_d34_stores_longitude_stmt;
