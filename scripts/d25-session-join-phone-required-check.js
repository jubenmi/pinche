import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function exists(relativePath) {
  return fs.existsSync(path.join(root, relativePath));
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function functionBody(source, name) {
  const pattern = new RegExp(`(?:export\\s+)?(?:async\\s+)?function\\s+${name}\\s*\\([^)]*\\)\\s*\\{`);
  const match = source.match(pattern);
  if (!match || match.index === undefined) {
    return "";
  }
  const start = match.index + match[0].length;
  let depth = 1;
  for (let index = start; index < source.length; index += 1) {
    if (source[index] === "{") {
      depth += 1;
    } else if (source[index] === "}") {
      depth -= 1;
    }
    if (depth === 0) {
      return source.slice(start, index);
    }
  }
  return "";
}

const migrationPath = "apps/api/migrations/0019_session_join_settings.sql";
assert(exists(migrationPath), "D25 migration file must add session join settings");
const migration = read(migrationPath);
for (const token of [
  "information_schema.columns",
  "table_name = 'sessions'",
  "column_name = 'join_phone_required'",
  "ALTER TABLE sessions ADD COLUMN join_phone_required TINYINT(1) NOT NULL DEFAULT 1 AFTER join_policy"
]) {
  assert(migration.includes(token), `D25 migration must include ${token}`);
}

const service = read("apps/api/src/modules/core/service.js");
for (const token of [
  "function normalizeJoinPhoneRequired",
  "joinPhoneRequired",
  "join_phone_required"
]) {
  assert(service.includes(token), `service.js must include join phone setting token: ${token}`);
}

const normalizeBody = functionBody(service, "normalizeJoinPhoneRequired");
assert(
  normalizeBody.includes("true") &&
    normalizeBody.includes("false") &&
    normalizeBody.includes("badRequest"),
  "normalizeJoinPhoneRequired must parse boolean-compatible values and reject invalid input"
);

const createSessionBody = functionBody(service, "createSession");
assert(
  createSessionBody.includes("join_phone_required") &&
    createSessionBody.includes("normalizeJoinPhoneRequired(body.joinPhoneRequired"),
  "createSession must persist normalized joinPhoneRequired"
);

const updateSessionBody = functionBody(service, "updateSession");
assert(
  updateSessionBody.includes("joinPhoneRequired") &&
    updateSessionBody.includes("join_phone_required"),
  "updateSession must allow organizer/admin joinPhoneRequired updates"
);

const getSessionBody = functionBody(service, "getSession");
assert(
  getSessionBody.includes("join_phone_required") &&
    getSessionBody.includes("Boolean") &&
    getSessionBody.includes("?? 1"),
  "getSession must expose join_phone_required with true fallback"
);

const requirePhoneBody = functionBody(service, "requireJoinPhoneIfNeeded");
assert(
  requirePhoneBody.includes("join_phone_required") &&
    requirePhoneBody.includes("requireVerifiedPhone") &&
    requirePhoneBody.includes("Number("),
  "requireJoinPhoneIfNeeded must skip phone verification when the session disables the requirement"
);

const createSignupBody = functionBody(service, "createSignup");
assert(
  createSignupBody.includes("join_phone_required") &&
    createSignupBody.includes("requireJoinPhoneIfNeeded"),
  "createSignup must load join_phone_required before enforcing phone verification"
);

const claimSessionSeatBody = functionBody(service, "claimSessionSeat");
assert(
  claimSessionSeatBody.includes("join_phone_required") &&
    claimSessionSeatBody.includes("requireJoinPhoneIfNeeded"),
  "claimSessionSeat must load join_phone_required before enforcing phone verification"
);

const miniManage = read("apps/miniprogram/src/pages/session/manage.vue");
assert(
  miniManage.includes("joinPhoneRequired") &&
    miniManage.includes("join_phone_required") &&
    miniManage.includes(":checked=\"joinPhoneRequired\""),
  "Manage page must expose and save the join phone required switch"
);

console.log("D25 session join phone required checks passed");
