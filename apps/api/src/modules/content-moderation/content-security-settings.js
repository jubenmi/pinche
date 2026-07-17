import { badRequest } from "../../http/errors.js";
import { assertContentModerationIntake } from "./intake-gate.js";

const KEYS = Object.freeze([
  "blockWhenUnavailable",
  "blockImageWhenUnavailable",
  "blockVideoWhenUnavailable",
  "blockTextWhenUnavailable"
]);

const TYPE_BLOCK_KEYS = Object.freeze({
  image: "blockImageWhenUnavailable",
  video: "blockVideoWhenUnavailable",
  text: "blockTextWhenUnavailable"
});

export function defaultContentSecuritySettings() {
  return Object.fromEntries(KEYS.map((key) => [key, false]));
}

export function normalizeContentSecuritySettings(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw badRequest("content security settings must be an object");
  }
  if (Object.keys(value).length !== KEYS.length || KEYS.some((key) => typeof value[key] !== "boolean")) {
    throw badRequest("content security settings must include four booleans");
  }
  return Object.fromEntries(KEYS.map((key) => [key, value[key]]));
}

export function mapContentSecuritySettings(row) {
  if (!row) return defaultContentSecuritySettings();
  return {
    blockWhenUnavailable: Boolean(row.block_when_unavailable),
    blockImageWhenUnavailable: Boolean(row.block_image_when_unavailable),
    blockVideoWhenUnavailable: Boolean(row.block_video_when_unavailable),
    blockTextWhenUnavailable: Boolean(row.block_text_when_unavailable)
  };
}

export async function readContentSecuritySettings(connection, { forUpdate = false } = {}) {
  const [rows] = await connection.query(
    `SELECT * FROM content_security_settings WHERE id = 1${forUpdate ? " FOR UPDATE" : " LIMIT 1"}`
  );
  return mapContentSecuritySettings(rows[0]);
}

export function createContentSecurityIntakeResolver({
  moderationConfig,
  withDatabaseConnection
}) {
  return async function resolveContentSecurityIntake(type, { connection } = {}) {
    const settings = connection
      ? await readContentSecuritySettings(connection, { forUpdate: true })
      : await withDatabaseConnection((currentConnection) =>
          readContentSecuritySettings(currentConnection)
        );
    const typeBlockKey = TYPE_BLOCK_KEYS[type];
    return assertContentModerationIntake(moderationConfig, type, {
      fallbackBlocking: Boolean(
        settings.blockWhenUnavailable && typeBlockKey && settings[typeBlockKey]
      )
    });
  };
}

export async function updateContentSecuritySettings(connection, actorUserId, value) {
  const settings = normalizeContentSecuritySettings(value);
  const [rows] = await connection.query("SELECT * FROM content_security_settings WHERE id = 1 FOR UPDATE");
  const previous = mapContentSecuritySettings(rows[0]);
  await connection.query(
    `UPDATE content_security_settings
     SET block_when_unavailable = ?, block_image_when_unavailable = ?,
         block_video_when_unavailable = ?, block_text_when_unavailable = ?, updated_by_user_id = ?
     WHERE id = 1`,
    [settings.blockWhenUnavailable, settings.blockImageWhenUnavailable, settings.blockVideoWhenUnavailable, settings.blockTextWhenUnavailable, actorUserId]
  );
  await connection.query(
    `INSERT INTO content_security_settings_audit_logs (actor_user_id, previous_settings, next_settings)
     VALUES (?, ?, ?)`,
    [actorUserId, JSON.stringify(previous), JSON.stringify(settings)]
  );
  return settings;
}
