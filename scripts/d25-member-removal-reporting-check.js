import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

function filePath(relativePath) {
  return path.join(root, relativePath);
}

function exists(relativePath) {
  return fs.existsSync(filePath(relativePath));
}

function read(relativePath) {
  return exists(relativePath) ? fs.readFileSync(filePath(relativePath), "utf8") : "";
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

const specDir = "specs/d25-member-removal-reporting";
for (const file of ["requirements.md", "design.md", "tasks.md"]) {
  assert(exists(`${specDir}/${file}`), `D25 spec must include ${file}`);
}

const migrationPath = "apps/api/migrations/0018_session_member_removal_reports.sql";
assert(exists(migrationPath), "D25 migration file must exist");
const migration = read(migrationPath);
for (const token of [
  "CREATE TABLE IF NOT EXISTS session_member_removal_reports",
  "removed_user_id",
  "removed_by_user_id",
  "reason_type",
  "reason_text",
  "block_rejoin",
  "pending_review",
  "idx_member_removal_session_user",
  "idx_member_removal_status_created",
  "fk_member_removal_session",
  "fk_member_removal_seat",
  "fk_member_removal_removed_user",
  "fk_member_removal_removed_by"
]) {
  assert(migration.includes(token), `D25 migration must include ${token}`);
}

const service = read("apps/api/src/modules/core/service.js");
for (const token of [
  "function normalizeRemovalReasonType",
  "function removalReasonLabel",
  "async function assertUserCanJoinSession",
  "session_member_removal_reports",
  "User has been removed from this session",
  "removal_reported",
  "safety_other",
  "harassment",
  "spam",
  "scam"
]) {
  assert(service.includes(token), `service.js must include D25 token: ${token}`);
}

const createSignupBody = functionBody(service, "createSignup");
assert(
  createSignupBody.includes("assertUserCanJoinSession") &&
    createSignupBody.includes("seat.session_id") &&
    createSignupBody.includes("user.user.id"),
  "createSignup must block removed users before creating or restoring signups"
);

const claimSessionSeatBody = functionBody(service, "claimSessionSeat");
assert(
  claimSessionSeatBody.includes("assertUserCanJoinSession") &&
    claimSessionSeatBody.includes("seat.session_id") &&
    claimSessionSeatBody.includes("user.user.id"),
  "claimSessionSeat must block removed users before direct seat confirmation"
);

const kickSessionSeatBody = functionBody(service, "kickSessionSeat");
for (const token of [
  "normalizeRemovalReasonType",
  "removalReasonLabel",
  "confirmed_user_id",
  "removedUserId",
  "block_rejoin",
  "INSERT INTO session_member_removal_reports",
  "removed_by_user_id",
  "report",
  "removal_reported",
  "afterSessionSeatKicked"
]) {
  assert(kickSessionSeatBody.includes(token), `kickSessionSeat must include ${token}`);
}
assert(
  kickSessionSeatBody.includes("status IN ('confirmed', 'locked')") ||
    kickSessionSeatBody.includes('["confirmed", "locked"]'),
  "reported removal must require an onboard confirmed or locked seat"
);

const manage = read("apps/miniprogram/src/pages/session/manage.vue");
for (const token of [
  "移除成员",
  "关闭座位",
  "removeReasonOptions",
  "showActionSheet",
  "恶意骚扰",
  "垃圾信息",
  "疑似诈骗",
  "其他安全原因",
  "report: true",
  "reasonType",
  "不能再次加入本车"
]) {
  assert(manage.includes(token), `manage.vue must include D25 token: ${token}`);
}

const packageJson = JSON.parse(read("package.json"));
assert(
  packageJson.scripts.check.includes("scripts/d25-member-removal-reporting-check.js"),
  "root check should run d25 member removal reporting check"
);

console.log("D25 member removal reporting checks passed");
