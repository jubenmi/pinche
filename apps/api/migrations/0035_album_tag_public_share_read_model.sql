CREATE TABLE session_album_media_tags (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  media_id BIGINT UNSIGNED NOT NULL,
  kind VARCHAR(32) NOT NULL,
  seat_id BIGINT UNSIGNED NULL,
  session_npc_role_id BIGINT UNSIGNED NULL,
  subject_ref_id BIGINT UNSIGNED
    GENERATED ALWAYS AS (
      CASE
        WHEN kind = 'role' THEN seat_id
        WHEN kind = 'npc_role' THEN session_npc_role_id
        ELSE 0
      END
    ) STORED,
  sort_order INT UNSIGNED NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT chk_album_media_tag_shape CHECK (
    (kind = 'role' AND seat_id IS NOT NULL AND session_npc_role_id IS NULL)
    OR (kind = 'npc_role' AND seat_id IS NULL AND session_npc_role_id IS NOT NULL)
    OR (kind = 'other' AND seat_id IS NULL AND session_npc_role_id IS NULL)
  ),
  UNIQUE KEY uniq_album_media_tag_subject (media_id, kind, subject_ref_id),
  CONSTRAINT fk_album_media_tag_media
    FOREIGN KEY (media_id) REFERENCES session_album_photos(id),
  CONSTRAINT fk_album_media_tag_seat
    FOREIGN KEY (seat_id) REFERENCES session_seats(id),
  CONSTRAINT fk_album_media_tag_npc_role
    FOREIGN KEY (session_npc_role_id) REFERENCES session_npc_roles(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE session_album_public_share_items (
  share_id BIGINT UNSIGNED NOT NULL,
  ordinal INT UNSIGNED NOT NULL,
  media_id BIGINT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (share_id, ordinal),
  UNIQUE KEY uniq_album_public_share_media (share_id, media_id),
  CONSTRAINT fk_album_public_share_item_share
    FOREIGN KEY (share_id) REFERENCES session_album_public_shares(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO session_album_media_tags
  (media_id, kind, seat_id, session_npc_role_id, sort_order)
SELECT
  legacy.photo_id,
  CASE
    WHEN legacy.tag_type = 'seat' THEN 'role'
    WHEN legacy.tag_type = 'session_npc_role' THEN 'npc_role'
    ELSE 'other'
  END,
  CASE WHEN legacy.tag_type = 'seat' THEN seat.id ELSE NULL END,
  CASE
    WHEN legacy.tag_type = 'session_npc_role' THEN npc_role.id
    ELSE NULL
  END,
  legacy.sort_order
FROM session_album_photo_tags legacy
JOIN session_album_photos media ON media.id = legacy.photo_id
LEFT JOIN session_seats seat
  ON seat.id = legacy.seat_id
 AND seat.session_id = media.session_id
LEFT JOIN session_npc_roles npc_role
  ON npc_role.id = legacy.session_npc_role_id
 AND npc_role.session_id = media.session_id
WHERE
  (legacy.tag_type = 'seat' AND seat.id IS NOT NULL)
  OR (legacy.tag_type = 'session_npc_role' AND npc_role.id IS NOT NULL)
  OR legacy.tag_type = 'other';

INSERT IGNORE INTO session_album_public_share_items
  (share_id, ordinal, media_id)
SELECT
  share.id,
  expanded.ordinality - 1,
  expanded.media_id
FROM session_album_public_shares share
CROSS JOIN JSON_TABLE(
  CASE
    WHEN JSON_VALID(share.media_ids) THEN share.media_ids
    ELSE JSON_ARRAY()
  END,
  '$[*]' COLUMNS (
    ordinality FOR ORDINALITY,
    media_id BIGINT UNSIGNED PATH '$' NULL ON EMPTY NULL ON ERROR
  )
) AS expanded
WHERE expanded.media_id IS NOT NULL
  AND expanded.media_id > 0
ORDER BY share.id, expanded.ordinality;
