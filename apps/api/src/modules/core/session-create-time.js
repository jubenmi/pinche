import { parseBusinessDateTime } from "@pinche/shared";

function invalidStartAt() {
  const error = new Error("startAt must be a valid business date time");
  error.code = "INVALID_START_AT";
  return error;
}

export function normalizeSessionCreationStartAt(value) {
  const parsed = parseBusinessDateTime(value);
  if (!parsed) {
    throw invalidStartAt();
  }
  return new Date(Math.floor(parsed.getTime() / 1000) * 1000);
}
