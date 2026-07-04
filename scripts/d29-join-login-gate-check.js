import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function functionBody(source, name) {
  let start = source.indexOf(`async ${name}(`);
  if (start < 0) {
    start = source.indexOf(`${name}(`);
  }
  assert(start >= 0, `Missing function: ${name}`);
  const parametersEnd = source.indexOf(")", start);
  assert(parametersEnd >= 0, `Missing function parameters: ${name}`);
  const braceStart = source.indexOf("{", parametersEnd);
  assert(braceStart >= 0, `Missing function body: ${name}`);
  let depth = 0;
  for (let index = braceStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(braceStart + 1, index);
      }
    }
  }
  throw new Error(`Unclosed function body: ${name}`);
}

function assertBefore(source, before, after, message) {
  const beforeIndex = source.indexOf(before);
  const afterIndex = source.indexOf(after);
  assert(beforeIndex >= 0, `${message}: missing ${before}`);
  assert(afterIndex >= 0, `${message}: missing ${after}`);
  assert(beforeIndex < afterIndex, message);
}

function assertNotIncludes(source, token, message) {
  assert(!source.includes(token), message);
}

const packageJson = JSON.parse(read("package.json"));
const share = read("apps/miniprogram/src/pages/session/share.vue");
const ensureSeatSelectionLoginBody = functionBody(share, "ensureSeatSelectionLogin");
const chooseRoleBody = functionBody(share, "chooseRole");
const confirmRoleBody = functionBody(share, "confirmRole");
const chooseNpcRoleBody = functionBody(share, "chooseNpcRole");

assert(
  share.includes("getToken"),
  "Share page must inspect the current auth token before protected join actions"
);
assert(
  share.includes("hasSeatSelectionLogin"),
  "Share page must distinguish an existing login from a fresh login triggered by tapping join"
);
assert(
  ensureSeatSelectionLoginBody.includes("wasLoggedIn") &&
    ensureSeatSelectionLoginBody.includes("refreshAfterFreshLogin") &&
    ensureSeatSelectionLoginBody.includes("loadPublishedSession(this.sessionId)") &&
    ensureSeatSelectionLoginBody.includes("redirectAlbumMemberIfNeeded") &&
    ensureSeatSelectionLoginBody.includes("return auth"),
  "Share login guard must refresh session state after a fresh login and then continue the selected join action"
);
assertNotIncludes(
  ensureSeatSelectionLoginBody,
  "请再次选择角色上车",
  "Share login guard must not require users to choose the same role again after login"
);
assertBefore(
  chooseRoleBody,
  "refreshAfterFreshLogin: true",
  "this.pendingRole = targetRole",
  "Seat role selection must refresh login/session state before continuing with the originally selected role"
);
assert(
  chooseRoleBody.includes("const selectedRoleKey = this.roleKey(role)") &&
    chooseRoleBody.includes("this.roleCards.find") &&
    chooseRoleBody.includes("targetRole"),
  "Seat role selection must re-resolve the originally selected role after login refresh"
);
assertBefore(
  confirmRoleBody,
  "refreshAfterFreshLogin: true",
  "claimSeat",
  "Seat role confirmation must require login before claiming a seat"
);
assertBefore(
  chooseNpcRoleBody,
  "refreshAfterFreshLogin: true",
  "if (npcRole.mine)",
  "NPC role mine shortcut must require login before entering the album"
);
assertBefore(
  chooseNpcRoleBody,
  "refreshAfterFreshLogin: true",
  'url: `/api/session-npc-roles/${npcRole.id}/claim`',
  "NPC role selection must require login before claiming the NPC role"
);
assert(
  packageJson.scripts.check.includes("scripts/d29-join-login-gate-check.js"),
  "Root check must run D29 join login gate check"
);

console.log("D29 join login gate check passed");
