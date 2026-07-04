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

const miniSetup = read("apps/miniprogram/src/pages/session/setup.vue");
for (const forbiddenToken of [
  "本场额外NPC",
  "extraNpcRolesPlaceholder",
  "extraNpcRolesText",
  "parseExtraNpcRoleLine",
  "extraNpcRoles()",
  "extraNpcRoles:"
]) {
  assert(
    !miniSetup.includes(forbiddenToken),
    `mini setup must not expose extra NPC creation yet: ${forbiddenToken}`
  );
}

console.log("D28 remove extra NPC setup checks passed");
