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
const calendar = read("apps/miniprogram/src/components/SessionCalendar.vue");
assert(mine.includes("SessionCalendar"), "Mine page must render the shared calendar component");
assert(calendar.includes("cancelOrganizedSession"), "Mine calendar must cancel created sessions");
assert(calendar.includes("leaveOrganizedSession"), "Mine calendar must leave created sessions with onboard members");
assert(calendar.includes("organizedRemovalActionText"), "Mine calendar must choose cancel or leave action text");
assert(calendar.includes("/api/sessions/${session.id}/cancel"), "Mine calendar must cancel created sessions through cancel API");
assert(calendar.includes("/api/sessions/${session.id}/organizer/leave"), "Mine calendar must leave organizer through organizer leave API");
assert(calendar.includes("hideJoinedSession"), "Mine calendar must hide joined sessions");
assert(calendar.includes("删除后这辆车会被直接删除"), "Mine calendar must explain organized session deletion");
assert(calendar.includes("已有玩家上车"), "Mine calendar must explain organizer leave when onboard members exist");
assert(calendar.includes("hasActiveAlbumPhotos"), "Mine calendar must detect active album photos before cancellation");
assert(
  calendar.includes("相册照片没有清空之前无法删除") && !calendar.includes("先删照片"),
  "Mine calendar must block album-backed deletion with a clear no-op message"
);
assert(calendar.includes("只会从你的列表下架"), "Mine calendar must explain signup personal deletion");

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
