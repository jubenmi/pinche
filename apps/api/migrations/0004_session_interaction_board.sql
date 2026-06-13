ALTER TABLE sessions
  ADD COLUMN cancelled_by_user_id BIGINT UNSIGNED NULL AFTER note;

ALTER TABLE sessions
  ADD COLUMN cancelled_at DATETIME NULL AFTER cancelled_by_user_id;

CREATE TABLE IF NOT EXISTS session_chat_rooms (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  session_id BIGINT UNSIGNED NOT NULL,
  pinned_message_id BIGINT UNSIGNED NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_session_chat_rooms_session (session_id),
  INDEX idx_session_chat_rooms_status (status),
  INDEX idx_session_chat_rooms_pinned (pinned_message_id),
  CONSTRAINT fk_session_chat_rooms_session FOREIGN KEY (session_id) REFERENCES sessions(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS session_messages (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  room_id BIGINT UNSIGNED NOT NULL,
  sender_user_id BIGINT UNSIGNED NOT NULL,
  message_type VARCHAR(32) NOT NULL DEFAULT 'normal',
  content TEXT NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_session_messages_room_created (room_id, created_at),
  INDEX idx_session_messages_room_type_status (room_id, message_type, status),
  INDEX idx_session_messages_sender (sender_user_id),
  CONSTRAINT fk_session_messages_room FOREIGN KEY (room_id) REFERENCES session_chat_rooms(id),
  CONSTRAINT fk_session_messages_sender FOREIGN KEY (sender_user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE session_chat_rooms
  ADD CONSTRAINT fk_session_chat_rooms_pinned_message
  FOREIGN KEY (pinned_message_id) REFERENCES session_messages(id);
