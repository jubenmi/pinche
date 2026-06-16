CREATE TABLE IF NOT EXISTS store_scripts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  store_id BIGINT UNSIGNED NOT NULL,
  script_id BIGINT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_store_script (store_id, script_id),
  INDEX idx_store_scripts_store (store_id),
  INDEX idx_store_scripts_script (script_id),
  CONSTRAINT fk_store_scripts_store
    FOREIGN KEY (store_id) REFERENCES stores(id),
  CONSTRAINT fk_store_scripts_script
    FOREIGN KEY (script_id) REFERENCES scripts(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
