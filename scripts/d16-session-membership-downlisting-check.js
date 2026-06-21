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

const migration = read("apps/api/migrations/0012_session_membership_downlisting.sql");
assert(migration.includes("organizer_hidden_at"), "migration must add organizer hidden timestamp");
assert(migration.includes("user_hidden_at"), "migration must add signup user hidden timestamp");

const service = read("apps/api/src/modules/core/service.js");
assert(service.includes("hideMyOrganizedSession"), "service must hide organizer membership");
assert(service.includes("hideMySignup"), "service must hide signup membership");
assert(service.includes("relinkMySessionMembership"), "service must relink existing memberships");
assert(
  service.includes("session.organizer_hidden_at IS NULL"),
  "created sessions list must hide downlisted organizer entries"
);
assert(
  service.includes("signup.user_hidden_at IS NULL"),
  "joined sessions list must hide downlisted signup entries"
);
assert(service.includes("organizer_hidden_at = NULL"), "relink must restore organizer entry");
assert(service.includes("user_hidden_at = NULL"), "relink must restore signup entry");

const server = read("apps/api/src/server.js");
assert(server.includes("hideMyOrganizedSession"), "server must import organizer hide service");
assert(server.includes("hideMySignup"), "server must import signup hide service");
assert(server.includes("relinkMySessionMembership"), "server must import relink service");
assert(server.includes("/hide"), "server must expose hide routes");
assert(server.includes("/relink"), "server must expose relink route");

const mine = read("apps/miniprogram/src/pages/mine/index.vue");
assert(mine.includes("hideOrganizedSession"), "Mine page must hide created sessions");
assert(mine.includes("hideJoinedSession"), "Mine page must hide joined sessions");
assert(mine.includes("只会从你的列表下架"), "Mine page must explain personal downlisting");

const detail = read("apps/miniprogram/src/pages/session/detail.vue");
assert(detail.includes("relinkSessionMembership"), "detail page must relink existing members");
assert(detail.includes("/relink"), "detail page must call relink endpoint");

const packageJson = JSON.parse(read("package.json"));
assert(
  packageJson.scripts.check.includes("scripts/d16-session-membership-downlisting-check.js"),
  "root check should run d16 session membership downlisting check"
);

console.log("D16 session membership downlisting check passed");
