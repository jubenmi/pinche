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

SET @pinche_d10_add_room_id = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE session_messages ADD COLUMN room_id BIGINT UNSIGNED NULL AFTER id',
    'SELECT 1'
  )
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'session_messages'
    AND column_name = 'room_id'
);
PREPARE pinche_d10_stmt FROM @pinche_d10_add_room_id;
EXECUTE pinche_d10_stmt;
DEALLOCATE PREPARE pinche_d10_stmt;

SET @pinche_d10_add_message_type = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE session_messages ADD COLUMN message_type VARCHAR(32) NOT NULL DEFAULT ''normal'' AFTER sender_user_id',
    'SELECT 1'
  )
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'session_messages'
    AND column_name = 'message_type'
);
PREPARE pinche_d10_stmt FROM @pinche_d10_add_message_type;
EXECUTE pinche_d10_stmt;
DEALLOCATE PREPARE pinche_d10_stmt;

SET @pinche_d10_add_message_updated = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE session_messages ADD COLUMN updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at',
    'SELECT 1'
  )
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'session_messages'
    AND column_name = 'updated_at'
);
PREPARE pinche_d10_stmt FROM @pinche_d10_add_message_updated;
EXECUTE pinche_d10_stmt;
DEALLOCATE PREPARE pinche_d10_stmt;

INSERT IGNORE INTO session_chat_rooms (session_id)
SELECT id FROM sessions;

SET @pinche_d10_has_message_session_id = (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'session_messages'
    AND column_name = 'session_id'
);
SET @pinche_d10_backfill_room_id = IF(
  @pinche_d10_has_message_session_id > 0,
  'UPDATE session_messages message JOIN session_chat_rooms room ON room.session_id = message.session_id SET message.room_id = room.id WHERE message.room_id IS NULL',
  'SELECT 1'
);
PREPARE pinche_d10_stmt FROM @pinche_d10_backfill_room_id;
EXECUTE pinche_d10_stmt;
DEALLOCATE PREPARE pinche_d10_stmt;

SET @pinche_d10_session_nullable = (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'session_messages'
    AND column_name = 'session_id'
    AND is_nullable = 'NO'
);
SET @pinche_d10_allow_legacy_session_null = IF(
  @pinche_d10_session_nullable > 0,
  'ALTER TABLE session_messages MODIFY COLUMN session_id BIGINT UNSIGNED NULL',
  'SELECT 1'
);
PREPARE pinche_d10_stmt FROM @pinche_d10_allow_legacy_session_null;
EXECUTE pinche_d10_stmt;
DEALLOCATE PREPARE pinche_d10_stmt;

SET @pinche_d10_room_nullable = (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'session_messages'
    AND column_name = 'room_id'
    AND is_nullable = 'YES'
);
SET @pinche_d10_require_room_id = IF(
  @pinche_d10_room_nullable > 0,
  'ALTER TABLE session_messages MODIFY COLUMN room_id BIGINT UNSIGNED NOT NULL',
  'SELECT 1'
);
PREPARE pinche_d10_stmt FROM @pinche_d10_require_room_id;
EXECUTE pinche_d10_stmt;
DEALLOCATE PREPARE pinche_d10_stmt;

SET @pinche_d10_room_index = (
  SELECT IF(
    COUNT(*) = 0,
    'CREATE INDEX idx_session_messages_room_created ON session_messages (room_id, created_at)',
    'SELECT 1'
  )
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'session_messages'
    AND index_name = 'idx_session_messages_room_created'
);
PREPARE pinche_d10_stmt FROM @pinche_d10_room_index;
EXECUTE pinche_d10_stmt;
DEALLOCATE PREPARE pinche_d10_stmt;

SET @pinche_d10_room_type_index = (
  SELECT IF(
    COUNT(*) = 0,
    'CREATE INDEX idx_session_messages_room_type_status ON session_messages (room_id, message_type, status)',
    'SELECT 1'
  )
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'session_messages'
    AND index_name = 'idx_session_messages_room_type_status'
);
PREPARE pinche_d10_stmt FROM @pinche_d10_room_type_index;
EXECUTE pinche_d10_stmt;
DEALLOCATE PREPARE pinche_d10_stmt;

SET @pinche_d10_room_fk = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE session_messages ADD CONSTRAINT fk_session_messages_room FOREIGN KEY (room_id) REFERENCES session_chat_rooms(id)',
    'SELECT 1'
  )
  FROM information_schema.referential_constraints
  WHERE constraint_schema = DATABASE()
    AND constraint_name = 'fk_session_messages_room'
);
PREPARE pinche_d10_stmt FROM @pinche_d10_room_fk;
EXECUTE pinche_d10_stmt;
DEALLOCATE PREPARE pinche_d10_stmt;

SET @pinche_d10_has_session_pin = (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'sessions'
    AND column_name = 'pinned_message_text'
);
SET @pinche_d10_insert_pinned = IF(
  @pinche_d10_has_session_pin > 0,
  'INSERT INTO session_messages (room_id, sender_user_id, message_type, content) SELECT room.id, session.organizer_user_id, ''pinned'', COALESCE(NULLIF(TRIM(session.pinned_message_text), ''''), CONCAT(''置顶：'', session.script_name_snapshot, '' '', DATE_FORMAT(session.start_at, ''%Y-%m-%d %H:%i''), ''，'', session.store_name_snapshot, ''集合。'')) FROM session_chat_rooms room JOIN sessions session ON session.id = room.session_id LEFT JOIN session_messages existing ON existing.room_id = room.id AND existing.message_type = ''pinned'' AND existing.status = ''active'' WHERE existing.id IS NULL',
  'INSERT INTO session_messages (room_id, sender_user_id, message_type, content) SELECT room.id, session.organizer_user_id, ''pinned'', CONCAT(''置顶：'', session.script_name_snapshot, '' '', DATE_FORMAT(session.start_at, ''%Y-%m-%d %H:%i''), ''，'', session.store_name_snapshot, ''集合。'') FROM session_chat_rooms room JOIN sessions session ON session.id = room.session_id LEFT JOIN session_messages existing ON existing.room_id = room.id AND existing.message_type = ''pinned'' AND existing.status = ''active'' WHERE existing.id IS NULL'
);
PREPARE pinche_d10_stmt FROM @pinche_d10_insert_pinned;
EXECUTE pinche_d10_stmt;
DEALLOCATE PREPARE pinche_d10_stmt;

UPDATE session_chat_rooms room
JOIN (
  SELECT room_id, MIN(id) AS pinned_message_id
  FROM session_messages
  WHERE message_type = 'pinned'
    AND status = 'active'
  GROUP BY room_id
) pinned ON pinned.room_id = room.id
SET room.pinned_message_id = pinned.pinned_message_id
WHERE room.pinned_message_id IS NULL;

SET @pinche_d10_pinned_fk = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE session_chat_rooms ADD CONSTRAINT fk_session_chat_rooms_pinned_message FOREIGN KEY (pinned_message_id) REFERENCES session_messages(id)',
    'SELECT 1'
  )
  FROM information_schema.referential_constraints
  WHERE constraint_schema = DATABASE()
    AND constraint_name = 'fk_session_chat_rooms_pinned_message'
);
PREPARE pinche_d10_stmt FROM @pinche_d10_pinned_fk;
EXECUTE pinche_d10_stmt;
DEALLOCATE PREPARE pinche_d10_stmt;
