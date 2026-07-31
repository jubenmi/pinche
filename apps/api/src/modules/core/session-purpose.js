import {
  FUTURE_CARPOOL,
  HISTORICAL_RECORD,
  normalizeSessionPurpose,
  parseBusinessDateTime
} from "@pinche/shared";
import { AppError } from "../../http/errors.js";

export function normalizeSessionCreationStartAt(startAt, sessionPurpose, now = new Date()) {
  const normalizedPurpose = normalizeSessionPurpose(sessionPurpose);
  if (!normalizedPurpose) {
    throw new AppError(400, "INVALID_SESSION_PURPOSE", "sessionPurpose is invalid");
  }

  const parsedStartAt = parseBusinessDateTime(startAt);
  if (!parsedStartAt) {
    throw new AppError(
      400,
      "INVALID_START_AT",
      "startAt must be a valid business timestamp"
    );
  }

  const date = new Date(Math.floor(parsedStartAt.getTime() / 1000) * 1000);
  const expectedSessionPurpose =
    date.getTime() > now.getTime() ? FUTURE_CARPOOL : HISTORICAL_RECORD;
  if (normalizedPurpose !== expectedSessionPurpose) {
    throw new AppError(
      409,
      "SESSION_PURPOSE_TIME_MISMATCH",
      "startAt no longer matches sessionPurpose",
      { expectedSessionPurpose }
    );
  }

  return {
    date,
    canonical: date.toISOString(),
    sessionPurpose: normalizedPurpose
  };
}
