CREATE TABLE IF NOT EXISTS session_album_media_tags (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  media_id BIGINT UNSIGNED NOT NULL,
  kind VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  seat_id BIGINT UNSIGNED NULL,
  session_npc_role_id BIGINT UNSIGNED NULL,
  subject_ref_id BIGINT UNSIGNED
    GENERATED ALWAYS AS (
      CASE
        WHEN CAST(kind AS BINARY) = CAST('role' AS BINARY) THEN seat_id
        WHEN CAST(kind AS BINARY) = CAST('npc_role' AS BINARY)
          THEN session_npc_role_id
        ELSE 0
      END
    ) STORED,
  sort_order INT UNSIGNED NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT chk_album_media_tag_shape CHECK (
    (
      CAST(kind AS BINARY) = CAST('role' AS BINARY)
      AND seat_id IS NOT NULL
      AND session_npc_role_id IS NULL
    )
    OR (
      CAST(kind AS BINARY) = CAST('npc_role' AS BINARY)
      AND seat_id IS NULL
      AND session_npc_role_id IS NOT NULL
    )
    OR (
      CAST(kind AS BINARY) = CAST('other' AS BINARY)
      AND seat_id IS NULL
      AND session_npc_role_id IS NULL
    )
  ),
  UNIQUE KEY uniq_album_media_tag_subject (media_id, kind, subject_ref_id),
  CONSTRAINT fk_album_media_tag_media
    FOREIGN KEY (media_id) REFERENCES session_album_photos(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_album_media_tag_seat
    FOREIGN KEY (seat_id) REFERENCES session_seats(id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_album_media_tag_npc_role
    FOREIGN KEY (session_npc_role_id) REFERENCES session_npc_roles(id)
    ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS session_album_public_share_items (
  share_id BIGINT UNSIGNED NOT NULL,
  ordinal INT UNSIGNED NOT NULL,
  media_id BIGINT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (share_id, ordinal),
  UNIQUE KEY uniq_album_public_share_media (share_id, media_id),
  CONSTRAINT fk_album_public_share_item_share
    FOREIGN KEY (share_id) REFERENCES session_album_public_shares(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO session_album_media_tags
  (media_id, kind, seat_id, session_npc_role_id, sort_order)
SELECT
  incoming.media_id,
  incoming.kind,
  incoming.seat_id,
  incoming.session_npc_role_id,
  incoming.sort_order
FROM (
  SELECT
    trusted.media_id,
    trusted.kind,
    trusted.seat_id,
    trusted.session_npc_role_id,
    MIN(trusted.sort_order) AS sort_order
  FROM (
    SELECT
      legacy.photo_id AS media_id,
      CASE
        WHEN CAST(legacy.tag_type AS BINARY) = CAST('seat' AS BINARY)
          THEN 'role'
        WHEN CAST(legacy.tag_type AS BINARY)
          = CAST('session_npc_role' AS BINARY)
          THEN 'npc_role'
        ELSE 'other'
      END AS kind,
      CASE
        WHEN CAST(legacy.tag_type AS BINARY) = CAST('seat' AS BINARY)
          THEN seat.id
        ELSE NULL
      END AS seat_id,
      CASE
        WHEN CAST(legacy.tag_type AS BINARY)
          = CAST('session_npc_role' AS BINARY)
          THEN npc_role.id
        ELSE NULL
      END AS session_npc_role_id,
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
      (
        CAST(legacy.tag_type AS BINARY) = CAST('seat' AS BINARY)
        AND seat.id IS NOT NULL
      )
      OR (
        CAST(legacy.tag_type AS BINARY)
          = CAST('session_npc_role' AS BINARY)
        AND npc_role.id IS NOT NULL
      )
      OR CAST(legacy.tag_type AS BINARY) = CAST('other' AS BINARY)
  ) AS trusted
  GROUP BY
    trusted.media_id,
    trusted.kind,
    trusted.seat_id,
    trusted.session_npc_role_id
) AS incoming
ON DUPLICATE KEY UPDATE
  sort_order = LEAST(
    session_album_media_tags.sort_order,
    incoming.sort_order
  );

INSERT INTO session_album_public_share_items
  (share_id, ordinal, media_id)
SELECT
  candidate.share_id,
  candidate.ordinality - 1,
  candidate.media_id
FROM (
  SELECT
    parsed.share_id,
    parsed.ordinality,
    parsed.media_id,
    ROW_NUMBER() OVER (
      PARTITION BY parsed.share_id, parsed.media_id
      ORDER BY parsed.ordinality
    ) AS media_occurrence
  FROM (
    SELECT
      share.id AS share_id,
      expanded.ordinality,
      CASE
        WHEN JSON_TYPE(expanded.raw_media_id) = 'INTEGER'
          AND JSON_UNQUOTE(expanded.raw_media_id)
            REGEXP '^[1-9][0-9]{0,19}$'
          AND (
            CHAR_LENGTH(JSON_UNQUOTE(expanded.raw_media_id)) < 20
            OR (
              CHAR_LENGTH(JSON_UNQUOTE(expanded.raw_media_id)) = 20
              AND CAST(
                JSON_UNQUOTE(expanded.raw_media_id) AS BINARY
              ) <= CAST('18446744073709551615' AS BINARY)
            )
          )
        THEN CAST(JSON_UNQUOTE(expanded.raw_media_id) AS UNSIGNED)
        ELSE NULL
      END AS media_id
    FROM session_album_public_shares share
    CROSS JOIN JSON_TABLE(
      CASE
        WHEN JSON_VALID(share.media_ids) THEN share.media_ids
        ELSE JSON_ARRAY()
      END,
      '$[*]' COLUMNS (
        ordinality FOR ORDINALITY,
        raw_media_id JSON PATH '$' NULL ON EMPTY NULL ON ERROR
      )
    ) AS expanded
    ORDER BY share.id, expanded.ordinality
  ) AS parsed
  WHERE parsed.media_id IS NOT NULL
) AS candidate
LEFT JOIN session_album_public_share_items existing_ordinal
  ON existing_ordinal.share_id = candidate.share_id
 AND existing_ordinal.ordinal = candidate.ordinality - 1
LEFT JOIN session_album_public_share_items existing_media
  ON existing_media.share_id = candidate.share_id
 AND existing_media.media_id = candidate.media_id
WHERE candidate.media_occurrence = 1
  AND existing_ordinal.share_id IS NULL
  AND existing_media.share_id IS NULL
ORDER BY candidate.share_id, candidate.ordinality;
