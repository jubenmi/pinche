export const SESSION_ALBUM_VIDEO_HARDENING_MIGRATION =
  "0022_session_album_video_hardening.sql";
export const SESSION_ALBUM_VIDEO_SOURCE_INDEX =
  "uniq_session_album_video_source_url";

export const DUPLICATE_SESSION_ALBUM_VIDEO_SOURCE_QUERY = `
  SELECT
    duplicates.source_url,
    album.id,
    duplicates.duplicate_count
  FROM session_album_photos AS album
  INNER JOIN (
    SELECT source_url, COUNT(*) AS duplicate_count
    FROM session_album_photos
    WHERE source_url IS NOT NULL
    GROUP BY source_url
    HAVING COUNT(*) > 1
  ) AS duplicates
    ON duplicates.source_url = album.source_url
  ORDER BY duplicates.source_url ASC, album.id ASC
`;

export const SESSION_ALBUM_VIDEO_SOURCE_INDEX_QUERY = `
  SELECT
    NON_UNIQUE AS non_unique,
    COLUMN_NAME AS column_name,
    SEQ_IN_INDEX AS seq_in_index,
    SUB_PART AS sub_part
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'session_album_photos'
    AND index_name = ?
  ORDER BY seq_in_index ASC
`;

const DUPLICATE_ERROR_DETAIL_LIMIT = 2048;

function duplicateSourceError(duplicates) {
  const details = duplicates.map(({ sourceUrl, count, ids }) => {
    return `source_url=${JSON.stringify(sourceUrl)} count=${count} ids=[${ids.join(",")}]`;
  }).join("; ");
  const humanDetails = details.length <= DUPLICATE_ERROR_DETAIL_LIMIT
    ? details
    : `${details.slice(0, DUPLICATE_ERROR_DETAIL_LIMIT)}… [truncated; full IDs in error.details]`;
  const structuredDuplicates = duplicates.map(({ sourceUrl, count, ids }) => ({
    sourceUrl,
    count,
    ids: [...ids]
  }));
  const error = new Error(
    `Cannot add ${SESSION_ALBUM_VIDEO_SOURCE_INDEX}; duplicate album video sources exist: ${humanDetails}`
  );
  error.code = "SESSION_ALBUM_VIDEO_DUPLICATE_SOURCE_URL";
  error.details = { duplicates: structuredDuplicates };
  error.duplicates = structuredDuplicates;
  return error;
}

export async function assertSessionAlbumVideoSourceUrlsUnique(connection) {
  const [rows] = await connection.query(DUPLICATE_SESSION_ALBUM_VIDEO_SOURCE_QUERY);
  if (rows.length > 0) {
    const duplicates = [];
    for (const row of rows) {
      const current = duplicates.at(-1);
      if (!current || current.sourceUrl !== row.source_url) {
        duplicates.push({
          sourceUrl: row.source_url,
          count: Number(row.duplicate_count),
          ids: [row.id]
        });
      } else {
        current.ids.push(row.id);
      }
    }
    throw duplicateSourceError(duplicates);
  }
}

function wrongIndexShapeError(rows) {
  const shape = rows.map((row) => ({
    nonUnique: Number(row.non_unique),
    column: row.column_name,
    position: Number(row.seq_in_index),
    prefixLength: row.sub_part == null ? null : Number(row.sub_part)
  }));
  const error = new Error(
    `${SESSION_ALBUM_VIDEO_SOURCE_INDEX} exists with an incompatible shape: ${JSON.stringify(shape)}`
  );
  error.code = "SESSION_ALBUM_VIDEO_SOURCE_INDEX_SHAPE_MISMATCH";
  error.details = { expected: { unique: true, columns: ["source_url"] }, actual: shape };
  return error;
}

export async function inspectSessionAlbumVideoSourceIndex(connection) {
  const [rows] = await connection.query(
    SESSION_ALBUM_VIDEO_SOURCE_INDEX_QUERY,
    [SESSION_ALBUM_VIDEO_SOURCE_INDEX]
  );
  if (rows.length === 0) {
    return { exists: false };
  }

  const exact = rows.length === 1 &&
    Number(rows[0].non_unique) === 0 &&
    rows[0].column_name === "source_url" &&
    Number(rows[0].seq_in_index) === 1 &&
    rows[0].sub_part == null;
  if (!exact) {
    throw wrongIndexShapeError(rows);
  }
  return { exists: true, exact: true };
}

export async function prepareMigration(connection, filename) {
  if (filename !== SESSION_ALBUM_VIDEO_HARDENING_MIGRATION) {
    return { skipStatements: false };
  }

  const index = await inspectSessionAlbumVideoSourceIndex(connection);
  if (index.exists) {
    return { skipStatements: true, reconciledExistingIndex: true };
  }
  await assertSessionAlbumVideoSourceUrlsUnique(connection);
  return { skipStatements: false, reconciledExistingIndex: false };
}
