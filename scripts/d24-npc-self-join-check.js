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

const migrationPath = "apps/api/migrations/0017_npc_self_join.sql";
assert(exists(migrationPath), "D24 migration file must exist");
const migration = read(migrationPath);
for (const token of [
  "information_schema.columns",
  "table_name = 'sessions'",
  "column_name = 'npc_join_enabled'",
  "ALTER TABLE sessions ADD COLUMN npc_join_enabled TINYINT(1) NOT NULL DEFAULT 1 AFTER join_policy",
  "table_name = 'signups'",
  "column_name = 'session_npc_role_id'",
  "column_name = 'signup_type'",
  "MODIFY seat_id BIGINT UNSIGNED NULL",
  "ADD COLUMN session_npc_role_id BIGINT UNSIGNED NULL AFTER seat_id",
  "ADD COLUMN signup_type VARCHAR(32) NOT NULL DEFAULT ''seat'' AFTER session_npc_role_id",
  "uniq_signup_user_npc_role",
  "idx_signups_npc_role_status",
  "fk_signups_session_npc_role"
]) {
  assert(migration.includes(token), `D24 migration must include ${token}`);
}

const service = read("apps/api/src/modules/core/service.js");
for (const token of [
  "function normalizeNpcJoinEnabled",
  "npcJoinEnabled",
  "npc_join_enabled",
  "signup_type",
  "session_npc_role_id",
  "claimSessionNpcRole",
  'join_result: "npc_joined"',
  'join_result: "pending_review"',
  "NPC self join is disabled",
  "NPC role already has a bound user",
  "NPC role already has a pending signup",
  "npc_role_name"
]) {
  assert(service.includes(token), `service.js must include D24 token: ${token}`);
}

const normalizeNpcJoinEnabledBody = functionBody(service, "normalizeNpcJoinEnabled");
assert(
  normalizeNpcJoinEnabledBody.includes("true") &&
    normalizeNpcJoinEnabledBody.includes("false") &&
    normalizeNpcJoinEnabledBody.includes("badRequest"),
  "normalizeNpcJoinEnabled must default/parse booleans and reject invalid values"
);

const createSessionBody = functionBody(service, "createSession");
assert(
  createSessionBody.includes("npc_join_enabled") &&
    createSessionBody.includes("normalizeNpcJoinEnabled"),
  "createSession must persist normalized npcJoinEnabled"
);

const updateSessionBody = functionBody(service, "updateSession");
assert(
  updateSessionBody.includes("npcJoinEnabled") && updateSessionBody.includes("npc_join_enabled"),
  "updateSession must allow organizer/admin npcJoinEnabled updates"
);

const getSessionBody = functionBody(service, "getSession");
assert(
  getSessionBody.includes("npc_join_enabled") && getSessionBody.includes("Boolean"),
  "getSession must expose npc_join_enabled as a boolean-compatible value"
);

const claimSessionNpcRoleBody = functionBody(service, "claimSessionNpcRole");
assert(
  claimSessionNpcRoleBody.includes("requireJoinPhoneIfNeeded") &&
    claimSessionNpcRoleBody.includes("session_npc_roles") &&
    claimSessionNpcRoleBody.includes("FOR UPDATE"),
  "claimSessionNpcRole must apply session phone settings and lock the NPC role"
);
assert(
  claimSessionNpcRoleBody.includes('"direct"') &&
    claimSessionNpcRoleBody.includes("bound_user_id") &&
    claimSessionNpcRoleBody.includes("status = 'approved'"),
  "claimSessionNpcRole direct branch must bind the NPC role and approve signup"
);
assert(
  claimSessionNpcRoleBody.includes('"review_required"') &&
    claimSessionNpcRoleBody.includes("status = 'pending'") &&
    claimSessionNpcRoleBody.includes("session_npc_role"),
  "claimSessionNpcRole review branch must create pending NPC signup"
);

const listSessionSignupsBody = functionBody(service, "listSessionSignups");
assert(
  listSessionSignupsBody.includes("session_npc_roles") &&
    listSessionSignupsBody.includes("npc_role_name") &&
    listSessionSignupsBody.includes("signup_type"),
  "listSessionSignups must include NPC role signup metadata"
);
assert(
  listSessionSignupsBody.includes("LEFT JOIN users applicant ON applicant.id = signup.user_id") &&
    listSessionSignupsBody.includes("applicant.nickname AS applicant_nickname") &&
    listSessionSignupsBody.includes("applicant.open_id AS applicant_open_id"),
  "listSessionSignups must include applicant identity for approval decisions"
);

const approveSignupBody = functionBody(service, "approveSignup");
assert(
  approveSignupBody.includes("signup_type") &&
    approveSignupBody.includes("session_npc_role") &&
    approveSignupBody.includes("bound_user_id") &&
    approveSignupBody.includes("session_npc_role_id"),
  "approveSignup must support NPC role signup approval"
);

const rejectSignupBody = functionBody(service, "rejectSignup");
assert(
  rejectSignupBody.includes("signup_type") &&
    rejectSignupBody.includes("session_npc_role") &&
    rejectSignupBody.includes("seat_id"),
  "rejectSignup must handle NPC role signups without touching seat status"
);

const server = read("apps/api/src/server.js");
assert(
  server.includes("claimSessionNpcRole") &&
    server.includes("sessionNpcRoleClaimId") &&
    server.includes("^\\/api\\/session-npc-roles\\/(\\d+)\\/claim$") &&
    server.includes("claimSessionNpcRole(user, sessionNpcRoleClaimId"),
  "server.js must expose POST /api/session-npc-roles/:id/claim"
);

const miniSetup = read("apps/miniprogram/src/pages/session/setup.vue");
for (const token of [
  "npcJoinEnabled",
  "允许NPC工作人员自选角色",
  "关闭后由车头手动安排NPC角色",
  "npcJoinEnabled: this.npcJoinEnabled"
]) {
  assert(miniSetup.includes(token), `mini setup must include ${token}`);
}

const miniShare = read("apps/miniprogram/src/pages/session/share.vue");
for (const token of [
  "npcRoleCards",
  "chooseNpcRole",
  "/api/session-npc-roles/",
  "/claim",
  "npc_join_enabled",
  "NPC角色",
  "本场NPC由车头安排",
  "已提交NPC角色申请，等待车头审核",
  "npc_joined",
  "pending_review"
]) {
  assert(miniShare.includes(token), `mini share page must include ${token}`);
}

const miniManage = read("apps/miniprogram/src/pages/session/manage.vue");
for (const token of ["signup_type", "session_npc_role", "npc_role_name", "NPC角色"]) {
  assert(miniManage.includes(token), `mini manage page must include ${token}`);
}
for (const token of ["applicantName", "applicant_nickname", 'label: "申请目标"']) {
  assert(miniManage.includes(token), `mini manage signup cards must show applicant identity: ${token}`);
}
for (const token of [
  "npcRoleActionText",
  'label: this.npcRoleActionText(role)',
  'key: "manageNpcRole"',
  "handleNpcRoleManagement",
  "关闭角色",
  "开放角色",
  "移除成员"
]) {
  assert(miniManage.includes(token), `mini manage NPC role actions must mirror seat management: ${token}`);
}

const adminMini = read("apps/admin-web/src/components/MiniProgramWorkspace.vue");
for (const token of [
  "npcJoinEnabled",
  "允许NPC工作人员自选角色",
  "signup_type",
  "session_npc_role",
  "npc_role_name"
]) {
  assert(adminMini.includes(token), `admin mini workspace must include ${token}`);
}

const packageJson = JSON.parse(read("package.json"));
assert(
  packageJson.scripts.check.includes("scripts/d24-npc-self-join-check.js"),
  "root check should run d24 npc self join check"
);

console.log("D24 NPC self join checks passed");
