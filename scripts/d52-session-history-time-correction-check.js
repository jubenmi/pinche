import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

function assertIncludes(source, token, message = `expected source to include: ${token}`) {
  assert(source.includes(token), message);
}

const migration = read("apps/api/migrations/0033_session_start_time_corrections.sql");
const database = read("apps/api/src/db/mysql.js");
const correctionHelper = read("apps/api/src/modules/core/session-time-correction.js");
const rescheduleHelper = read("apps/api/src/modules/core/session-reschedule.js");
const service = read("apps/api/src/modules/core/service.js");
const server = read("apps/api/src/server.js");
const miniCorrectionHelper = read("apps/miniprogram/src/utils/sessionTimeCorrection.js");
const managePage = read("apps/miniprogram/src/pages/session/manage.vue");
const apiPackage = JSON.parse(read("apps/api/package.json"));
const rootPackage = JSON.parse(read("package.json"));

assertIncludes(migration, "CREATE TABLE session_start_time_corrections");
assertIncludes(migration, "old_start_at DATETIME NOT NULL");
assertIncludes(migration, "new_start_at DATETIME NOT NULL");
assertIncludes(migration, "changed_by_user_id BIGINT UNSIGNED NOT NULL");
assertIncludes(migration, "ON DELETE CASCADE");
assertIncludes(database, '"session_start_time_corrections"');

assertIncludes(correctionHelper, "export function normalizeSessionTimeCorrectionStartAt");
assertIncludes(correctionHelper, '"CORRECTION_START_AT_NOT_PAST"');
assertIncludes(correctionHelper, '"UNCHANGED_START_AT"');
assertIncludes(rescheduleHelper, "normalizedTimestamp <= now");

assertIncludes(service, "export async function correctHistoricalSessionStartTime");
assertIncludes(service, "export async function correctHistoricalSessionStartTimeInTransaction");
assertIncludes(service, "CURRENT_TIMESTAMP AS database_now");
assertIncludes(service, "FROM sessions WHERE id = ? FOR UPDATE");
assertIncludes(service, "INSERT INTO session_start_time_corrections");

assertIncludes(
  server,
  "start-time-corrections",
  "D52 server must expose the independent historical time correction route"
);
const correctionRouteIndex = server.indexOf("start-time-corrections");
const genericSessionRouteIndex = server.indexOf(
  "const sessionId = idMatch(url.pathname, /^\\/api\\/sessions\\/(\\d+)$/)"
);
assert(correctionRouteIndex >= 0, "D52 correction route must exist");
assert(genericSessionRouteIndex >= 0, "generic session route must exist");
assert(
  correctionRouteIndex < genericSessionRouteIndex,
  "D52 correction route must be matched before the generic session route"
);
assertIncludes(server, "correctHistoricalSessionStartTime");

assert.match(
  apiPackage.scripts["test:session-time-correction"] || "",
  /session-time-correction\*\.test\.mjs/,
  "API package must expose the D52 test command"
);
assertIncludes(
  rootPackage.scripts["session-time-correction:verify"] || "",
  "test:session-time-correction",
  "root package must expose the D52 verification command"
);
assertIncludes(
  rootPackage.scripts.check || "",
  "npm run session-time-correction:verify",
  "root check must include D52 verification"
);

assertIncludes(miniCorrectionHelper, "export function canCorrectHistoricalSession");
assertIncludes(miniCorrectionHelper, "export function canCurrentOrganizerCorrectHistoricalSession");
assertIncludes(miniCorrectionHelper, "export function mergeHistoricalTimeCorrectionSession");
assertIncludes(miniCorrectionHelper, "export function validateHistoricalTimeCorrection");
assertIncludes(miniCorrectionHelper, "仅修正历史记录，不会重新发车");
assertIncludes(managePage, 'v-if="canReschedule"');
assertIncludes(managePage, 'v-if="canCorrectHistoricalTime"');
assertIncludes(managePage, "纠正时间");
assertIncludes(managePage, "openHistoricalCorrectionPicker");
assertIncludes(managePage, "historicalCorrectionPickerVisible");
assertIncludes(managePage, ':end="historicalCorrectionMaximum"');
assertIncludes(managePage, "buildHistoricalTimeCorrectionConfirmation");
assertIncludes(managePage, "validateHistoricalTimeCorrection");
assertIncludes(managePage, "historicalTimeCorrectionErrorText");
assertIncludes(managePage, "historicalTimeCorrectionErrorRequiresRefresh");
assertIncludes(managePage, "canCurrentOrganizerCorrectHistoricalSession");
assertIncludes(managePage, "mergeHistoricalTimeCorrectionSession");
assertIncludes(managePage, "`/api/sessions/${this.sessionId}/start-time-corrections`");

console.log("D52 session history time correction check passed");
