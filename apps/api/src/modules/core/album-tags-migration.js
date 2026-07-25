export const ALBUM_TAG_PUBLIC_SHARE_READ_MODEL_MIGRATION =
  "0035_album_tag_public_share_read_model.sql";

const LEGACY_ALBUM_PHOTO_TAGS_TABLE = "session_album_photo_tags";
const LEGACY_PHOTO_FOREIGN_KEY = "fk_session_album_photo_tags_photo";
const CASCADE_PHOTO_FOREIGN_KEY =
  "fk_session_album_photo_tags_photo_cascade";

function migrationError(code, details = {}) {
  const error = new Error(`album tag migration failed: ${code}`);
  error.code = code;
  error.details = details;
  return error;
}

async function inspectLegacyPhotoForeignKeys(connection) {
  const [rows] = await connection.query(
    `SELECT
       kcu.CONSTRAINT_NAME AS constraint_name,
       kcu.COLUMN_NAME AS column_name,
       kcu.REFERENCED_TABLE_NAME AS referenced_table_name,
       kcu.REFERENCED_COLUMN_NAME AS referenced_column_name,
       rc.DELETE_RULE AS delete_rule
     FROM information_schema.key_column_usage AS kcu
     INNER JOIN information_schema.referential_constraints AS rc
       ON rc.CONSTRAINT_SCHEMA = kcu.CONSTRAINT_SCHEMA
      AND rc.TABLE_NAME = kcu.TABLE_NAME
      AND rc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
     WHERE kcu.CONSTRAINT_SCHEMA = DATABASE()
       AND kcu.TABLE_NAME = ?
       AND kcu.COLUMN_NAME = 'photo_id'
       AND kcu.REFERENCED_TABLE_NAME IS NOT NULL
     ORDER BY kcu.CONSTRAINT_NAME`,
    [LEGACY_ALBUM_PHOTO_TAGS_TABLE],
  );
  return rows;
}

function isExpectedPhotoReference(row) {
  return String(row?.column_name) === "photo_id"
    && String(row?.referenced_table_name) === "session_album_photos"
    && String(row?.referenced_column_name) === "id";
}

export async function reconcileLegacyAlbumPhotoTagForeignKey(connection) {
  const rows = await inspectLegacyPhotoForeignKeys(connection);
  if (rows.length > 1 || rows.some((row) => !isExpectedPhotoReference(row))) {
    throw migrationError("ALBUM_TAG_LEGACY_PHOTO_FK_MISMATCH", { actual: rows });
  }
  const current = rows[0];
  if (current && String(current.delete_rule).toUpperCase() === "CASCADE") {
    return;
  }
  if (current) {
    if (
      String(current.constraint_name) !== LEGACY_PHOTO_FOREIGN_KEY
      || !["NO ACTION", "RESTRICT"].includes(
        String(current.delete_rule).toUpperCase(),
      )
    ) {
      throw migrationError("ALBUM_TAG_LEGACY_PHOTO_FK_MISMATCH", {
        actual: rows,
      });
    }
    await connection.query(
      `ALTER TABLE session_album_photo_tags
       DROP FOREIGN KEY fk_session_album_photo_tags_photo,
       ADD CONSTRAINT fk_session_album_photo_tags_photo_cascade
         FOREIGN KEY (photo_id) REFERENCES session_album_photos(id)
         ON DELETE CASCADE`,
    );
    return;
  }
  await connection.query(
    `ALTER TABLE session_album_photo_tags
     ADD CONSTRAINT fk_session_album_photo_tags_photo_cascade
       FOREIGN KEY (photo_id) REFERENCES session_album_photos(id)
       ON DELETE CASCADE`,
  );
}

export async function prepareAlbumTagMigration(connection, filename) {
  if (filename !== ALBUM_TAG_PUBLIC_SHARE_READ_MODEL_MIGRATION) {
    return { skipStatements: false };
  }
  await reconcileLegacyAlbumPhotoTagForeignKey(connection);
  return {
    skipStatements: false,
    reconciledLegacyPhotoForeignKey: true,
  };
}
