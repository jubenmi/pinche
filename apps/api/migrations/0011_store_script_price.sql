SET @pinche_d16_add_store_script_price = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE store_scripts ADD COLUMN price_per_player INT NOT NULL DEFAULT 0 AFTER script_id',
    'SELECT 1'
  )
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'store_scripts'
    AND column_name = 'price_per_player'
);

PREPARE pinche_d16_store_script_price_stmt FROM @pinche_d16_add_store_script_price;
EXECUTE pinche_d16_store_script_price_stmt;
DEALLOCATE PREPARE pinche_d16_store_script_price_stmt;

UPDATE scripts
JOIN (
  SELECT
    role_rows.script_id,
    CONCAT(
      '[',
      GROUP_CONCAT(
      JSON_OBJECT(
        'id', role_rows.role_id,
        'name', COALESCE(NULLIF(role_rows.role_name, ''), NULLIF(role_rows.role_position, ''), CONCAT('角色', role_rows.role_index)),
        'description', COALESCE(NULLIF(role_rows.role_description, ''), NULLIF(role_rows.role_position, ''), ''),
        'roleGender', CASE
          WHEN role_rows.role_gender IN ('male', 'female', 'unlimited') THEN role_rows.role_gender
          ELSE 'unlimited'
        END
      )
      ORDER BY role_rows.role_index
        SEPARATOR ','
      ),
      ']'
    ) AS cleaned_template
  FROM (
    SELECT
      source_scripts.id AS script_id,
      extracted_roles.role_index,
      extracted_roles.role_id,
      extracted_roles.role_name,
      COALESCE(extracted_roles.role_position, extracted_roles.role_position_snake) AS role_position,
      COALESCE(
        extracted_roles.role_description,
        extracted_roles.role_description_camel,
        extracted_roles.role_description_snake
      ) AS role_description,
      COALESCE(extracted_roles.role_gender, extracted_roles.role_gender_snake) AS role_gender
    FROM scripts source_scripts
    JOIN JSON_TABLE(
      source_scripts.default_seat_template_json,
      '$[*]' COLUMNS (
        role_index FOR ORDINALITY,
        role_id VARCHAR(128) PATH '$.id' NULL ON EMPTY NULL ON ERROR,
        role_name VARCHAR(128) PATH '$.name' NULL ON EMPTY NULL ON ERROR,
        role_position VARCHAR(128) PATH '$.roleName' NULL ON EMPTY NULL ON ERROR,
        role_position_snake VARCHAR(128) PATH '$.role_name' NULL ON EMPTY NULL ON ERROR,
        role_description VARCHAR(512) PATH '$.description' NULL ON EMPTY NULL ON ERROR,
        role_description_camel VARCHAR(512) PATH '$.roleDescription' NULL ON EMPTY NULL ON ERROR,
        role_description_snake VARCHAR(512) PATH '$.role_description' NULL ON EMPTY NULL ON ERROR,
        role_gender VARCHAR(16) PATH '$.roleGender' NULL ON EMPTY NULL ON ERROR,
        role_gender_snake VARCHAR(16) PATH '$.role_gender' NULL ON EMPTY NULL ON ERROR
      )
    ) extracted_roles
    WHERE source_scripts.default_seat_template_json IS NOT NULL
      AND JSON_TYPE(source_scripts.default_seat_template_json) = 'ARRAY'
  ) role_rows
  GROUP BY role_rows.script_id
) cleaned_scripts ON cleaned_scripts.script_id = scripts.id
SET scripts.default_seat_template_json = cleaned_scripts.cleaned_template
WHERE scripts.default_seat_template_json IS NOT NULL;
