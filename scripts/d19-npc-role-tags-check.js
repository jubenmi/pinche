import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

function read(file) {
  return fs.readFileSync(path.join(root, file), "utf8");
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const migration = read("apps/api/migrations/0015_npc_role_tags.sql");
for (const token of [
  "CREATE TABLE IF NOT EXISTS script_npc_roles",
  "CREATE TABLE IF NOT EXISTS session_npc_roles",
  "session_npc_role_id",
  "fk_session_album_photo_tags_session_npc_role"
]) {
  assert(migration.includes(token), `npc role migration must include ${token}`);
}

const service = read("apps/api/src/modules/core/service.js");
for (const token of [
  "normalizeNpcRoles",
  "script_npc_roles",
  "session_npc_roles",
  "extraNpcRoles",
  "session-npc:",
  "session_npc_role",
  "session_npc_role_id",
  "listSessionNpcRoles",
  "createSessionNpcRole",
  "updateSessionNpcRole"
]) {
  assert(service.includes(token), `service must include ${token}`);
}

const server = read("apps/api/src/server.js");
for (const token of [
  "listSessionNpcRoles",
  "createSessionNpcRole",
  "updateSessionNpcRole",
  "/npc-roles",
  "sessionNpcRoleId"
]) {
  assert(server.includes(token), `server must include ${token}`);
}

const adminApi = read("apps/admin-web/src/api.js");
for (const token of [
  "listSessionNpcRoles",
  "createSessionNpcRole",
  "updateSessionNpcRole"
]) {
  assert(adminApi.includes(token), `admin web API must expose ${token}`);
}

const scriptDrawer = read("apps/admin-web/src/components/ScriptDrawer.vue");
for (const token of [
  "NPC角色模板",
  "npcRoles",
  "addNpcRole",
  "removeNpcRole"
]) {
  assert(scriptDrawer.includes(token), `script drawer must include ${token}`);
}

const adminMini = read("apps/admin-web/src/components/MiniProgramWorkspace.vue");
for (const token of [
  "extraNpcRolesText",
  "extraNpcRoles",
  "本场额外NPC"
]) {
  assert(adminMini.includes(token), `admin mini workspace must include ${token}`);
}

const adminAlbum = read("apps/admin-web/src/components/SessionAlbumWorkspace.vue");
for (const token of [
  "npcRolePeople",
  "NPC角色",
  "session_npc_role"
]) {
  assert(adminAlbum.includes(token), `admin album workspace must include ${token}`);
}

const miniSetup = read("apps/miniprogram/src/pages/session/setup.vue");
for (const token of [
  "extraNpcRolesText",
  "extraNpcRoles",
  "本场额外NPC"
]) {
  assert(
    !miniSetup.includes(token),
    `mini-program setup must not expose per-session extra NPC creation yet: ${token}`
  );
}

const miniAlbum = read("apps/miniprogram/src/pages/session/album.vue");
for (const token of [
  "npcRolePeople",
  "NPC角色",
  "session_npc_role",
  "session_npc_roles"
]) {
  assert(miniAlbum.includes(token), `mini-program album must include ${token}`);
}

const smoke = read("scripts/d18-session-album-privacy-smoke.js");
for (const token of [
  "fixed NPC role should appear in album people",
  "extra NPC role should appear in album people",
  "bound NPC role user should see their album session",
  "album tags should save session NPC role"
]) {
  assert(smoke.includes(token), `album smoke must cover ${token}`);
}

const packageJson = JSON.parse(read("package.json"));
assert(
  packageJson.scripts.check.includes("scripts/d19-npc-role-tags-check.js"),
  "root check should run d19 npc role tag check"
);
