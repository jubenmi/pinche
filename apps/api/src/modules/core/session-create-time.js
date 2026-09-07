import { parseBusinessDateTime } from "@pinche/shared";
import { AppError } from "../../http/errors.js";

function invalidStartAt() {
  return new AppError(400, "INVALID_START_AT", "startAt must be a valid business date time");
}

export function normalizeSessionCreationStartAt(value) {
  const parsed = parseBusinessDateTime(value);
  if (!parsed) {
    throw invalidStartAt();
  }
  return new Date(Math.floor(parsed.getTime() / 1000) * 1000);
}
