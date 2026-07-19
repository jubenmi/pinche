import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

function read(relativePath) {
  const absolutePath = path.join(root, relativePath);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`D48 required file is missing: ${relativePath}`);
  }
  return fs.readFileSync(absolutePath, "utf8");
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const requirements = read("specs/d48-album-sharing-role-claim-separation/requirements.md");
const design = read("specs/d48-album-sharing-role-claim-separation/design.md");
const tasks = read("specs/d48-album-sharing-role-claim-separation/tasks.md");

for (const token of [
  "相册分享与角色邀请",
  "好友/群聊",
  "朋友圈",
  "一票否决",
  "最多 30",
  "9 张",
  "4 | `2 + 2`",
  "6 | `3 + 3`"
]) {
  assert(
    requirements.includes(token) || design.includes(token),
    `D48 spec must define: ${token}`
  );
}
assert(tasks.includes("D48.10"), "D48 tasks must contain the complete execution checklist");

const migration = read("apps/api/migrations/0032_session_album_public_shares.sql");
for (const token of [
  "CREATE TABLE session_album_public_shares",
  "media_ids JSON NOT NULL",
  "snapshot_digest CHAR(64) NOT NULL",
  "cover_media_ids JSON NOT NULL",
  "expires_at DATETIME NOT NULL",
  "revoked_at DATETIME NULL",
  "idx_album_public_share_owner",
  "idx_album_public_share_expiry",
  "fk_album_public_share_session",
  "fk_album_public_share_user",
  "fk_album_public_share_seat"
]) {
  assert(migration.includes(token), `D48 migration must include: ${token}`);
}

const service = read("apps/api/src/modules/core/service.js");
for (const token of [
  "isAlbumPhotoVisibleInPublicShare",
  "selectPublicShareMedia",
  "selectPublicShareCoverMedia",
  "createOrReuseSessionAlbumPublicShare",
  "loadSessionAlbumPublicShare",
  "revokeMySessionAlbumPublicShares"
]) {
  assert(service.includes(token), `D48 service contract is missing: ${token}`);
}

const server = read("apps/api/src/server.js");
for (const token of [
  "version: 2",
  "shareId",
  "ALBUM_PUBLIC_SHARE_EMPTY",
  "/api/session-album/public-shares/",
  "/cover",
  "revokeMySessionAlbumPublicShares"
]) {
  assert(server.includes(token), `D48 server contract is missing: ${token}`);
}

const albumPage = read("apps/miniprogram/src/pages/session/album.vue");
assert(
  albumPage.includes("/pages/session/album") &&
    albumPage.includes("source=wechat_share") &&
    albumPage.includes("source=wechat_timeline"),
  "album sharing must route friend/group and timeline recipients to the public album page"
);
assert(
  albumPage.includes("shareCoverUrl") && albumPage.includes("ticket-landscape.jpg"),
  "album sharing must use a safe generated cover with ticket fallback"
);

const invitePage = read("apps/miniprogram/src/pages/session/share.vue");
assert(invitePage.includes("join-invite-token"), "role invitation must keep join-invite-token");
assert(
  !invitePage.includes('"shareTimeline"') && !invitePage.includes("onShareTimeline("),
  "role invitation must not expose the timeline share channel"
);

const packageJson = read("package.json");
assert(
  packageJson.includes("d48-album-sharing-role-claim-separation-check.js") &&
    packageJson.includes("d48-album-sharing-role-claim-separation-smoke.js"),
  "root check must include D48 static and smoke syntax checks"
);

console.log("D48 album sharing and role claim separation checks passed");
