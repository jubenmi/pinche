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

const packageJson = JSON.parse(read("package.json"));
assert(
  packageJson.scripts.check.includes("scripts/d14-profile-check.js"),
  "root check should run d14 profile check"
);

const usersModule = read("apps/api/src/modules/auth/users.js");
assert(usersModule.includes("updateUserProfile"), "users module must expose updateUserProfile");
assert(
  usersModule.includes("normalizeUserNickname") && usersModule.includes("nickname.length > 32"),
  "users module must normalize and limit nicknames"
);
assert(
  usersModule.includes("normalizeUserAvatarUrl") && usersModule.includes("/uploads/avatars/"),
  "users module must normalize uploaded avatar URLs"
);
assert(
  usersModule.includes("updateUserGender") && usersModule.includes("updateUserProfile(userId"),
  "gender updater must delegate to profile updater"
);

const server = read("apps/api/src/server.js");
assert(server.includes("AVATAR_UPLOAD_MAX_BYTES"), "server must define avatar upload limit");
assert(server.includes("parseMultipartAvatarUpload"), "server must parse multipart avatar upload");
assert(server.includes('/api/users/me/avatar'), "server must route avatar upload");
assert(server.includes('/uploads/avatars/'), "server must serve uploaded avatars");
assert(
  server.includes("path.basename") && server.includes("avatarFilename"),
  "avatar static route must constrain filenames"
);
assert(
  server.includes("updateUserProfile") && server.includes('url.pathname === "/api/users/me"'),
  "PATCH /api/users/me must use profile update"
);

const api = read("apps/miniprogram/src/utils/api.js");
assert(api.includes("export function assetUrl"), "miniprogram API must expose assetUrl");
assert(api.includes("export async function uploadUserAvatar"), "miniprogram API must upload avatars");
assert(api.includes("uni.uploadFile"), "avatar upload must use uni.uploadFile");
assert(api.includes('name: "avatar"'), "avatar upload must use avatar field name");
assert(api.includes("export async function updateUserProfile"), "miniprogram API must update profile");
assert(
  api.includes("return updateUserProfile({ gender })"),
  "updateUserGender must delegate to updateUserProfile"
);

const identityBar = read("apps/miniprogram/src/components/AuthIdentityBar.vue");
assert(identityBar.includes("draftNickname"), "profile modal must track draftNickname");
assert(identityBar.includes("draftAvatarTempPath"), "profile modal must track draft avatar path");
assert(identityBar.includes("avatarChoosing"), "profile modal must track avatar choose progress");
assert(identityBar.includes('open-type="chooseAvatar"'), "profile modal must use chooseAvatar");
assert(identityBar.includes("@chooseavatar"), "profile modal must handle chooseavatar event");
assert(identityBar.includes("markAvatarChoosing"), "profile modal must lock duplicate chooseAvatar taps");
assert(
  identityBar.includes(':disabled="avatarChoosing || savingProfile"'),
  "chooseAvatar button must be disabled while avatar choosing is in progress"
);
assert(identityBar.includes("uploadUserAvatar"), "profile modal must upload selected avatars");
assert(identityBar.includes("updateUserProfile"), "profile modal must save profile patch");
assert(identityBar.includes("assetUrl"), "profile modal must render uploaded avatar URLs");
assert(identityBar.includes("user.nickname"), "identity display must prefer nickname");

const mine = read("apps/miniprogram/src/pages/mine/index.vue");
assert(mine.includes("个人信息"), "mine page must show personal information");
assert(mine.includes("openProfileEditor"), "mine page must expose profile editor");
assert(mine.includes("AUTH_PROFILE_REQUEST_EVENT"), "mine page must request shared profile modal");
assert(mine.includes("profileAvatarSrc"), "mine page must render the current profile avatar");

console.log("D14 profile check passed");
