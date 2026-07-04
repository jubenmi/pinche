import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

function read(relativePath) {
  const fullPath = path.join(root, relativePath);
  if (!fs.existsSync(fullPath)) {
    return "";
  }
  return fs.readFileSync(fullPath, "utf8");
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const migration = read("apps/api/migrations/0020_npc_role_gender.sql");
for (const token of [
  "script_npc_roles",
  "session_npc_roles",
  "ADD COLUMN role_gender VARCHAR(16) NOT NULL DEFAULT ''unlimited''"
]) {
  assert(migration.includes(token), `npc role gender migration must include ${token}`);
}

const service = read("apps/api/src/modules/core/service.js");
for (const token of [
  "role_gender: row.role_gender || \"unlimited\"",
  "roleGender: normalizeRoleGender",
  "role.roleGender",
  "script_npc_roles",
  "session_npc_roles",
  "[\"roleGender\", \"role_gender\"]",
  "npc_role.role_gender AS npc_role_gender"
]) {
  assert(service.includes(token), `service must include ${token}`);
}

const scriptDrawer = read("apps/admin-web/src/components/ScriptDrawer.vue");
for (const token of [
  "NPC角色模板",
  "NPC性别",
  "npcRole.roleGender",
  "roleGender: role.roleGender"
]) {
  assert(scriptDrawer.includes(token), `script drawer must include ${token}`);
}

const adminMini = read("apps/admin-web/src/components/MiniProgramWorkspace.vue");
for (const token of [
  "parseExtraNpcRoleLine",
  "npcRoleGenderText",
  "roleGender: normalizeRoleGender",
  "不限"
]) {
  assert(adminMini.includes(token), `admin mini workspace must include ${token}`);
}

const roleSeatBoard = read("apps/miniprogram/src/components/RoleSeatBoard.vue");
for (const token of [
  "showGenderSymbol",
  "role-choice.unlimited",
  ".role-choice.unlimited .role-gender-symbol"
]) {
  assert(roleSeatBoard.includes(token), `shared role board must include ${token}`);
}

const miniSetup = read("apps/miniprogram/src/pages/session/setup.vue");
for (const token of [
  "parseExtraNpcRoleLine",
  "extraNpcRolesPlaceholder",
  "extraNpcRolesText",
  "extraNpcRoles:"
]) {
  assert(!miniSetup.includes(token), `mini setup must not expose extra NPC gender input yet: ${token}`);
}

const miniShare = read("apps/miniprogram/src/pages/session/share.vue");
for (const token of [
  "showGenderSymbol: true",
  "roleGender: role.role_gender || \"unlimited\"",
  "genderSymbol"
]) {
  assert(miniShare.includes(token), `mini share must include ${token}`);
}

const miniManage = read("apps/miniprogram/src/pages/session/manage.vue");
for (const token of [
  "npcRoleGenderText",
  "signup.npc_role_gender"
]) {
  assert(miniManage.includes(token), `mini manage must include ${token}`);
}

const miniAlbum = read("apps/miniprogram/src/pages/session/album.vue");
for (const token of [
  "role_gender: role.role_gender || \"unlimited\"",
  "showGenderSymbol: person.tag_type === \"session_npc_role\"",
  "npcRoleGenderText(person.role_gender"
]) {
  assert(miniAlbum.includes(token), `mini album must include ${token}`);
}

const adminAlbum = read("apps/admin-web/src/components/SessionAlbumWorkspace.vue");
for (const token of [
  "npcRoleGenderText",
  "person.role_gender",
  "npc-gender-mark"
]) {
  assert(adminAlbum.includes(token), `admin album workspace must include ${token}`);
}

const packageJson = JSON.parse(read("package.json"));
assert(
  packageJson.scripts.check.includes("scripts/d26-npc-role-gender-check.js"),
  "root check should run d26 npc role gender check"
);

console.log("D26 npc role gender check passed");
