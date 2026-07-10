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

function methodBody(source, name) {
  const patterns = [
    new RegExp(`async\\s+${name}\\s*\\([^)]*\\)\\s*\\{`),
    new RegExp(`${name}\\s*\\([^)]*\\)\\s*\\{`)
  ];
  for (const pattern of patterns) {
    const match = source.match(pattern);
    if (!match || match.index === undefined) {
      continue;
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
  }
  return "";
}

function sourceSliceAfter(source, marker, length = 700) {
  const index = source.indexOf(marker);
  if (index === -1) {
    return "";
  }
  return source.slice(index, index + length);
}

const migrationPath = "apps/api/migrations/0019_session_join_settings.sql";
assert(exists(migrationPath), "D25 migration file must exist");
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
  "function requireJoinPhoneIfNeeded",
  "joinPhoneRequired",
  "join_phone_required",
  "normalizeJoinPhoneRequired",
  "requireJoinPhoneIfNeeded"
]) {
  assert(service.includes(token), `service.js must include join phone setting token: ${token}`);
}

const normalizeJoinPhoneRequiredBody = functionBody(service, "normalizeJoinPhoneRequired");
assert(
  normalizeJoinPhoneRequiredBody.includes("true") &&
    normalizeJoinPhoneRequiredBody.includes("false") &&
    normalizeJoinPhoneRequiredBody.includes("badRequest"),
  "normalizeJoinPhoneRequired must default/parse booleans and reject invalid values"
);

const requireJoinPhoneIfNeededBody = functionBody(service, "requireJoinPhoneIfNeeded");
assert(
  requireJoinPhoneIfNeededBody.includes("join_phone_required") &&
    requireJoinPhoneIfNeededBody.includes("requireVerifiedPhone"),
  "requireJoinPhoneIfNeeded must gate phone verification from session.join_phone_required"
);

const createSessionBody = functionBody(service, "createSession");
assert(
  createSessionBody.includes("join_phone_required") &&
    createSessionBody.includes("normalizeJoinPhoneRequired"),
  "createSession must persist normalized joinPhoneRequired"
);

const updateSessionBody = functionBody(service, "updateSession");
assert(
  updateSessionBody.includes("joinPhoneRequired") &&
    updateSessionBody.includes("join_phone_required"),
  "updateSession must allow organizer/admin joinPhoneRequired updates"
);

const getSessionBody = functionBody(service, "getSession");
const memberSessionDetailBody = functionBody(service, "memberSessionDetail");
const publicSessionPreviewBody = functionBody(service, "publicSessionPreview");
assert(
  memberSessionDetailBody.includes("join_phone_required") &&
    memberSessionDetailBody.includes("Boolean") &&
    publicSessionPreviewBody.includes("join_phone_required") &&
    publicSessionPreviewBody.includes("Boolean"),
  "member and public session detail must expose join_phone_required as a boolean-compatible value"
);
assert(getSessionBody.includes("memberSessionDetail"), "getSession must use the member detail serializer");

const createSignupBody = functionBody(service, "createSignup");
assert(
  createSignupBody.includes("join_phone_required") &&
    createSignupBody.includes("requireJoinPhoneIfNeeded(user, seat)"),
  "createSignup must enforce phone only when the session requires it"
);

const claimSessionSeatBody = functionBody(service, "claimSessionSeat");
assert(
  !claimSessionSeatBody.trimStart().startsWith("requireVerifiedPhone(user);") &&
    claimSessionSeatBody.includes("join_phone_required") &&
    claimSessionSeatBody.includes("requireJoinPhoneIfNeeded(user, seat)"),
  "claimSessionSeat must use dynamic join phone requirement instead of unconditional phone gating"
);

const claimSessionNpcRoleBody = functionBody(service, "claimSessionNpcRole");
assert(
  !claimSessionNpcRoleBody.trimStart().startsWith("requireVerifiedPhone(user);") &&
    claimSessionNpcRoleBody.includes("join_phone_required") &&
    claimSessionNpcRoleBody.includes("requireJoinPhoneIfNeeded(user, role)"),
  "claimSessionNpcRole must use dynamic join phone requirement instead of unconditional phone gating"
);

const server = read("apps/api/src/server.js");
const claimNpcRoleRoute = sourceSliceAfter(server, "const sessionNpcRoleClaimId = idMatch");
assert(
  claimNpcRoleRoute.includes("const user = await getAuthUser(request)") &&
    claimNpcRoleRoute.includes("claimSessionNpcRole(user"),
  "NPC role claim route must still require login when phone is optional"
);
const claimSeatRoute = sourceSliceAfter(server, "const claimSeatId = idMatch");
assert(
  claimSeatRoute.includes("const user = await getAuthUser(request)") &&
    claimSeatRoute.includes("claimSessionSeat(user"),
  "seat direct claim route must still require login when phone is optional"
);
const createSignupRoute = sourceSliceAfter(
  server,
  'if (request.method === "POST" && url.pathname === "/api/signups")'
);
assert(
  createSignupRoute.includes("const user = await getAuthUser(request)") &&
    createSignupRoute.includes("createSignup(user"),
  "signup route must still require login when phone is optional"
);

const miniSetup = read("apps/miniprogram/src/pages/session/setup.vue");
for (const token of [
  "joinPhoneRequired",
  "上车必须留电话",
  "仍需登录",
  "joinPhoneRequired: this.joinPhoneRequired"
]) {
  assert(miniSetup.includes(token), `mini setup must include ${token}`);
}

const miniManage = read("apps/miniprogram/src/pages/session/manage.vue");
for (const token of [
  "车局设置",
  "joinPolicy",
  "joinPhoneRequired",
  "仍需登录",
  "npcJoinEnabled",
  "updateSessionSettings",
  "/api/sessions/${this.sessionId}",
  "joinPhoneRequired: this.joinPhoneRequired",
  "join_phone_required",
  "npcJoinEnabled: this.npcJoinEnabled"
]) {
  assert(miniManage.includes(token), `mini manage page must include ${token}`);
}
assert(
  miniManage.includes("已保存") &&
    miniManage.includes(":class=\"{ disabled: busyAction || !settingsDirty }\"") &&
    (miniManage.includes(".mini-button.disabled") || miniManage.includes(".mini-button[disabled]")),
  "mini manage save button must show a clear saved/disabled state"
);
assert(
  miniManage.includes("车局设置没有生效") &&
    miniManage.includes("settingsUpdatePersisted"),
  "mini manage save must detect when backend accepts but does not persist settings"
);

const miniShare = read("apps/miniprogram/src/pages/session/share.vue");
for (const token of [
  "joinRequiresPhone",
  "join_phone_required",
  "requirePhone: this.joinRequiresPhone"
]) {
  assert(miniShare.includes(token), `mini share page must include ${token}`);
}
const shareEnsureSeatSelectionLoginBody = methodBody(miniShare, "ensureSeatSelectionLogin");
assert(
  shareEnsureSeatSelectionLoginBody.includes("ensureLoggedIn") &&
    shareEnsureSeatSelectionLoginBody.includes("登录后可以选择角色"),
  "share seat selection must require login before applying the phone requirement"
);
const shareConfirmRoleBody = methodBody(miniShare, "confirmRole");
assert(
  shareConfirmRoleBody.includes("await this.ensureSeatSelectionLogin({") &&
    shareConfirmRoleBody.includes("requirePhone: this.joinRequiresPhone"),
  "share confirmRole must pass the session-level phone requirement"
);
const shareChooseNpcRoleBody = methodBody(miniShare, "chooseNpcRole");
assert(
  shareChooseNpcRoleBody.includes("await this.ensureSeatSelectionLogin({") &&
    shareChooseNpcRoleBody.includes("requirePhone: this.joinRequiresPhone"),
  "share chooseNpcRole must pass the session-level phone requirement"
);

const packageJson = JSON.parse(read("package.json"));
assert(
  packageJson.scripts.check.includes("scripts/d25-session-join-settings-check.js"),
  "root check should run d25 session join settings check"
);

console.log("D25 session join settings checks passed");
