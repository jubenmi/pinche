CREATE TABLE IF NOT EXISTS script_npc_roles (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  script_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(128) NOT NULL,
  description VARCHAR(512) NULL,
  sort_order INT UNSIGNED NOT NULL DEFAULT 0,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_script_npc_roles_script_status (script_id, status, sort_order),
  CONSTRAINT fk_script_npc_roles_script FOREIGN KEY (script_id) REFERENCES scripts(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS session_npc_roles (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  session_id BIGINT UNSIGNED NOT NULL,
  script_npc_role_id BIGINT UNSIGNED NULL,
  name VARCHAR(128) NOT NULL,
  description VARCHAR(512) NULL,
  source VARCHAR(32) NOT NULL DEFAULT 'script',
  bound_user_id BIGINT UNSIGNED NULL,
  sort_order INT UNSIGNED NOT NULL DEFAULT 0,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_session_npc_roles_session_status (session_id, status, sort_order),
  INDEX idx_session_npc_roles_bound_user (bound_user_id),
  INDEX idx_session_npc_roles_script_role (script_npc_role_id),
  CONSTRAINT fk_session_npc_roles_session FOREIGN KEY (session_id) REFERENCES sessions(id),
  CONSTRAINT fk_session_npc_roles_script_role FOREIGN KEY (script_npc_role_id) REFERENCES script_npc_roles(id),
  CONSTRAINT fk_session_npc_roles_bound_user FOREIGN KEY (bound_user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE session_album_photo_tags
  ADD COLUMN session_npc_role_id BIGINT UNSIGNED NULL AFTER seat_id,
  ADD INDEX idx_session_album_photo_tags_session_npc_role (session_npc_role_id),
  ADD CONSTRAINT fk_session_album_photo_tags_session_npc_role FOREIGN KEY (session_npc_role_id) REFERENCES session_npc_roles(id);
