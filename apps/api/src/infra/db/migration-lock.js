import {
  migrationLockName,
  withMigrationLock as withLegacyMigrationLock
} from "../../db/migrate.js";

export { migrationLockName };

export function withMigrationLock(
  connection,
  { database, timeoutSeconds = 30 },
  work
) {
  return withLegacyMigrationLock(connection, database, work, { timeoutSeconds });
}
