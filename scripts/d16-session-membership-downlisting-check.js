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
assert(migration.includes("user_hidden_at"), "migration must add signup user hidden timestamp");

const service = read("apps/api/src/modules/core/service.js");
assert(service.includes("cancelSession"), "service must cancel organized sessions");
assert(service.includes("hideMySignup"), "service must hide signup membership");
assert(service.includes("relinkMySessionMembership"), "service must relink existing memberships");
assert(
  !service.includes("session.organizer_hidden_at IS NULL"),
  "created sessions list must not model organizer downlisting"
);
assert(
  service.includes("signup.user_hidden_at IS NULL"),
  "joined sessions list must hide downlisted signup entries"
);
assert(service.includes("user_hidden_at = NULL"), "relink must restore signup entry");

const server = read("apps/api/src/server.js");
assert(server.includes("hideMySignup"), "server must import signup hide service");
assert(server.includes("relinkMySessionMembership"), "server must import relink service");
assert(server.includes("/hide"), "server must expose hide routes");
assert(server.includes("/relink"), "server must expose relink route");

const mine = read("apps/miniprogram/src/pages/mine/index.vue");
assert(mine.includes("cancelOrganizedSession"), "Mine page must cancel created sessions");
assert(mine.includes("leaveOrganizedSession"), "Mine page must leave created sessions with onboard members");
assert(mine.includes("organizedRemovalActionText"), "Mine page must choose cancel or leave action text");
assert(mine.includes("/api/sessions/${session.id}/cancel"), "Mine page must cancel created sessions through cancel API");
assert(mine.includes("/api/sessions/${session.id}/organizer/leave"), "Mine page must leave organizer through organizer leave API");
assert(mine.includes("hideJoinedSession"), "Mine page must hide joined sessions");
assert(mine.includes("取消后这辆车会被直接删除"), "Mine page must explain organized session cancellation");
assert(mine.includes("已有玩家上车"), "Mine page must explain organizer leave when onboard members exist");
assert(mine.includes("hasActiveAlbumPhotos"), "Mine page must detect active album photos before cancellation");
assert(mine.includes("请先删除所有照片"), "Mine page must explain album photos must be deleted before session cancellation");
assert(mine.includes("只会从你的列表下架"), "Mine page must explain signup personal deletion");

const manage = read("apps/miniprogram/src/pages/session/manage.vue");
assert(manage.includes("hasOtherOnboardMembers"), "Manage page must detect other onboard members");
assert(manage.includes("hasActiveAlbumPhotos"), "Manage page must detect active album photos before cancellation");
assert(
  manage.includes("!hasOtherOnboardMembers && !hasActiveAlbumPhotos") &&
    manage.includes("!hasActiveAlbumPhotos") &&
    manage.includes("不能取消删除"),
  "Manage page must hide cancel deletion when other members are onboard"
);

const album = read("apps/miniprogram/src/pages/session/album.vue");
assert(album.includes("deletePhoto"), "Album page must let uploaders delete their photos");
assert(
  album.includes("/api/session-album/photos/${photo.id}") &&
    album.includes('method: "DELETE"'),
  "Album page must delete photos through the album photo delete API"
);

const detail = read("apps/miniprogram/src/pages/session/detail.vue");
assert(detail.includes("relinkSessionMembership"), "detail page must relink existing members");
assert(detail.includes("/relink"), "detail page must call relink endpoint");

const packageJson = JSON.parse(read("package.json"));
assert(
  packageJson.scripts.check.includes("scripts/d16-session-membership-downlisting-check.js"),
  "root check should run d16 session membership downlisting check"
);

console.log("D16 session membership downlisting check passed");
