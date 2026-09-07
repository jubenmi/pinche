import { AppError } from "../../http/errors.js";

export async function readSessionDatabaseNow(connection) {
  const [[{ database_now: databaseNow }]] = await connection.query("SELECT CURRENT_TIMESTAMP AS database_now");
  if (!(databaseNow instanceof Date) || !Number.isFinite(databaseNow.getTime())) {
    throw new Error("Database clock is unavailable");
  }
  return databaseNow;
}

export function assertFutureSessionStartAt(startAt, databaseNow) {
  if (!(databaseNow instanceof Date) || !Number.isFinite(databaseNow.getTime())) {
    throw new Error("Database clock is unavailable");
  }
  if (startAt.getTime() <= databaseNow.getTime()) {
    throw new AppError(400, "SESSION_START_AT_NOT_FUTURE", "startAt must be in the future");
  }
}
