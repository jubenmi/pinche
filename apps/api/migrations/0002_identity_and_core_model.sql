CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  open_id VARCHAR(128) NOT NULL UNIQUE,
  union_id VARCHAR(128) NULL,
  nickname VARCHAR(128) NULL,
  avatar_url VARCHAR(512) NULL,
  phone_encrypted TEXT NULL,
  phone_verified_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_users_union_id (union_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_roles (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  role VARCHAR(64) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_user_role (user_id, role),
  INDEX idx_user_roles_role_status (role, status),
  CONSTRAINT fk_user_roles_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS performer_profiles (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL UNIQUE,
  display_name VARCHAR(128) NOT NULL,
  city VARCHAR(64) NULL,
  bio TEXT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_performer_profiles_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS stores (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(160) NOT NULL,
  city VARCHAR(64) NOT NULL,
  district VARCHAR(64) NULL,
  address VARCHAR(255) NULL,
  contact_note TEXT NULL,
  claim_status VARCHAR(32) NOT NULL DEFAULT 'unclaimed',
  created_by_admin_user_id BIGINT UNSIGNED NULL,
  claimed_by_user_id BIGINT UNSIGNED NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_stores_city_status (city, status),
  INDEX idx_stores_status (status),
  CONSTRAINT fk_stores_created_by FOREIGN KEY (created_by_admin_user_id) REFERENCES users(id),
  CONSTRAINT fk_stores_claimed_by FOREIGN KEY (claimed_by_user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS scripts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(160) NOT NULL,
  type_tags TEXT NULL,
  player_count INT UNSIGNED NULL,
  summary_no_spoiler TEXT NULL,
  claim_status VARCHAR(32) NOT NULL DEFAULT 'unclaimed',
  created_by_admin_user_id BIGINT UNSIGNED NULL,
  claimed_by_user_id BIGINT UNSIGNED NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_scripts_status (status),
  INDEX idx_scripts_player_count (player_count),
  CONSTRAINT fk_scripts_created_by FOREIGN KEY (created_by_admin_user_id) REFERENCES users(id),
  CONSTRAINT fk_scripts_claimed_by FOREIGN KEY (claimed_by_user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS catalog_requests (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  request_type VARCHAR(32) NOT NULL,
  requested_by_user_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(160) NOT NULL,
  city VARCHAR(64) NULL,
  district VARCHAR(64) NULL,
  description TEXT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  reviewed_by_admin_user_id BIGINT UNSIGNED NULL,
  review_note TEXT NULL,
  created_entity_id BIGINT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_at DATETIME NULL,
  INDEX idx_catalog_requests_status (status),
  INDEX idx_catalog_requests_requested_by (requested_by_user_id),
  CONSTRAINT fk_catalog_requests_requested_by FOREIGN KEY (requested_by_user_id) REFERENCES users(id),
  CONSTRAINT fk_catalog_requests_reviewed_by FOREIGN KEY (reviewed_by_admin_user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS entity_claims (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  entity_type VARCHAR(32) NOT NULL,
  entity_id BIGINT UNSIGNED NOT NULL,
  requested_by_user_id BIGINT UNSIGNED NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  note TEXT NULL,
  reviewed_by_admin_user_id BIGINT UNSIGNED NULL,
  review_note TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_at DATETIME NULL,
  INDEX idx_entity_claims_entity (entity_type, entity_id),
  INDEX idx_entity_claims_status (status),
  CONSTRAINT fk_entity_claims_requested_by FOREIGN KEY (requested_by_user_id) REFERENCES users(id),
  CONSTRAINT fk_entity_claims_reviewed_by FOREIGN KEY (reviewed_by_admin_user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sessions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  organizer_user_id BIGINT UNSIGNED NOT NULL,
  script_id BIGINT UNSIGNED NOT NULL,
  script_name_snapshot VARCHAR(160) NOT NULL,
  store_id BIGINT UNSIGNED NOT NULL,
  store_name_snapshot VARCHAR(160) NOT NULL,
  start_at DATETIME NOT NULL,
  dm_user_id BIGINT UNSIGNED NULL,
  dm_name_snapshot VARCHAR(128) NULL,
  npc_user_id BIGINT UNSIGNED NULL,
  npc_name_snapshot VARCHAR(128) NULL,
  deposit_amount INT NOT NULL DEFAULT 0,
  status VARCHAR(32) NOT NULL DEFAULT 'draft',
  visibility VARCHAR(32) NOT NULL DEFAULT 'share_only',
  note TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_sessions_organizer_status (organizer_user_id, status),
  INDEX idx_sessions_start_at (start_at),
  CONSTRAINT fk_sessions_organizer FOREIGN KEY (organizer_user_id) REFERENCES users(id),
  CONSTRAINT fk_sessions_script FOREIGN KEY (script_id) REFERENCES scripts(id),
  CONSTRAINT fk_sessions_store FOREIGN KEY (store_id) REFERENCES stores(id),
  CONSTRAINT fk_sessions_dm FOREIGN KEY (dm_user_id) REFERENCES users(id),
  CONSTRAINT fk_sessions_npc FOREIGN KEY (npc_user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS session_seats (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  session_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(128) NOT NULL,
  seat_type VARCHAR(64) NOT NULL DEFAULT 'normal',
  role_name VARCHAR(128) NULL,
  base_price INT NOT NULL DEFAULT 0,
  adjustment INT NOT NULL DEFAULT 0,
  payable_price INT NOT NULL DEFAULT 0,
  status VARCHAR(32) NOT NULL DEFAULT 'open',
  confirmed_user_id BIGINT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_session_seats_session (session_id),
  INDEX idx_session_seats_status (status),
  CONSTRAINT fk_session_seats_session FOREIGN KEY (session_id) REFERENCES sessions(id),
  CONSTRAINT fk_session_seats_confirmed_user FOREIGN KEY (confirmed_user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS signups (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  session_id BIGINT UNSIGNED NOT NULL,
  seat_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  contact_text TEXT NULL,
  note TEXT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  deposit_status VARCHAR(32) NOT NULL DEFAULT 'unpaid',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_signup_user_seat (seat_id, user_id),
  INDEX idx_signups_session_status (session_id, status),
  INDEX idx_signups_user (user_id),
  CONSTRAINT fk_signups_session FOREIGN KEY (session_id) REFERENCES sessions(id),
  CONSTRAINT fk_signups_seat FOREIGN KEY (seat_id) REFERENCES session_seats(id),
  CONSTRAINT fk_signups_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS share_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  session_id BIGINT UNSIGNED NULL,
  inviter_user_id BIGINT UNSIGNED NULL,
  share_code VARCHAR(128) NULL,
  source VARCHAR(64) NULL,
  event_type VARCHAR(32) NOT NULL,
  path VARCHAR(255) NULL,
  seat_id BIGINT UNSIGNED NULL,
  viewed_user_id BIGINT UNSIGNED NULL,
  converted_signup_id BIGINT UNSIGNED NULL,
  raw_payload_json JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_share_events_session_type (session_id, event_type),
  INDEX idx_share_events_created_at (created_at),
  CONSTRAINT fk_share_events_session FOREIGN KEY (session_id) REFERENCES sessions(id),
  CONSTRAINT fk_share_events_inviter FOREIGN KEY (inviter_user_id) REFERENCES users(id),
  CONSTRAINT fk_share_events_seat FOREIGN KEY (seat_id) REFERENCES session_seats(id),
  CONSTRAINT fk_share_events_viewed_user FOREIGN KEY (viewed_user_id) REFERENCES users(id),
  CONSTRAINT fk_share_events_signup FOREIGN KEY (converted_signup_id) REFERENCES signups(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS subscription_requests (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  template_id VARCHAR(128) NULL,
  scene VARCHAR(64) NULL,
  accepted TINYINT(1) NOT NULL DEFAULT 0,
  raw_result_json JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_subscription_requests_user (user_id),
  CONSTRAINT fk_subscription_requests_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
