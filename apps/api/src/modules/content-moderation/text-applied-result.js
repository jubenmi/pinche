const TEXT_APPLIED_RESULT_ID_KEYS = Object.freeze([
  "id",
  "session_id",
  "store_id",
  "script_id",
  "review_id",
  "message_id",
  "pinned_message_id"
]);

const TEXT_APPLIED_RESULT_LABEL_KEYS = Object.freeze(["kind", "resourceType"]);
const TEXT_APPLIED_RESULT_KEYS = new Set([
  ...TEXT_APPLIED_RESULT_ID_KEYS,
  ...TEXT_APPLIED_RESULT_LABEL_KEYS
]);

export function projectSafeTextAppliedResult(value, { rejectUnknownKeys = false } = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (rejectUnknownKeys && Object.keys(value).some((key) => !TEXT_APPLIED_RESULT_KEYS.has(key))) {
    return null;
  }

  const safe = {};
  for (const key of TEXT_APPLIED_RESULT_ID_KEYS) {
    const number = Number(value[key]);
    if (Number.isSafeInteger(number) && number > 0) safe[key] = number;
  }
  for (const key of TEXT_APPLIED_RESULT_LABEL_KEYS) {
    if (typeof value[key] === "string" && value[key].trim()) {
      safe[key] = value[key].trim().slice(0, 128);
    }
  }
  return TEXT_APPLIED_RESULT_ID_KEYS.some((key) => safe[key] !== undefined) ? safe : null;
}
