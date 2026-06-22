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
assert(server.includes("parseRawAvatarUpload"), "server must parse raw avatar image upload");
assert(
  server.includes("contentType.includes(\"multipart/form-data\")") &&
    server.includes("parseRawAvatarUpload(contentType, body)"),
  "avatar upload endpoint must accept raw JPEG/PNG bodies for miniprogram request fallback"
);
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
assert(api.includes("uploadCosBackedFile"), "avatar upload must use the shared COS-backed upload path");
assert(api.includes('kind: "avatar"'), "avatar upload must request an avatar direct upload intent");
assert(api.includes("fallbackUploadUserAvatar"), "avatar upload must keep a backend fallback for local storage");
assert(api.includes("readFileAsArrayBuffer"), "avatar fallback must read local avatar files as bytes");
assert(api.includes("uploadBackendBinaryFile"), "avatar fallback must support request-based binary uploads");
assert(
  api.includes('contentType: imageContentTypeFromPath(filePath)') &&
    api.includes("bodyBytes: await readFileAsArrayBuffer(filePath)"),
  "avatar fallback must use request/raw upload so experience builds do not depend on uploadFile domains"
);
assert(api.includes("export async function updateUserProfile"), "miniprogram API must update profile");
assert(
  api.includes("return updateUserProfile({ gender })"),
  "updateUserGender must delegate to updateUserProfile"
);
assert(
  api.includes("export function clearCurrentUserAvatarUrl") &&
    api.includes("auth.user.avatarUrl !== avatarUrl") &&
    api.includes("avatarUrl: null"),
  "miniprogram API must clear stale cached avatar URLs after image load failure"
);
assert(
  api.includes("function rejectUnauthorizedResponse") &&
    api.includes("clearAuth()") &&
    api.includes('userMessage: "登录已过期，请重新登录。"') &&
    api.includes("rejectUnauthorizedResponse(response)"),
  "miniprogram API must clear cached auth and surface a relogin message on 401 responses"
);
assert(
  api.includes("const refreshedAuth = await refreshCurrentAuth();") &&
    api.includes("if (refreshedAuth) {") &&
    api.includes("ensureUserPhone(refreshedAuth, options)") &&
    !api.includes("refreshedAuth ||") &&
    !api.includes("if (!refreshedAuth) {\n      return null;\n    }"),
  "ensureLoggedIn must discard stale cached auth after refresh fails and continue to a fresh login flow"
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
  "chooseAvatar trigger must be disabled while avatar choosing is in progress"
);
assert(
  identityBar.includes("profile-avatar-button") &&
    identityBar.includes('class="profile-avatar profile-avatar-button"') &&
    !identityBar.includes('class="avatar-change"') &&
    !identityBar.includes("avatarButtonText") &&
    !identityBar.includes("更换头像"),
  "profile avatar itself must choose avatars without a separate change-avatar button"
);
assert(identityBar.includes("uploadUserAvatar"), "profile modal must upload selected avatars");
assert(identityBar.includes("updateUserProfile"), "profile modal must save profile patch");
assert(identityBar.includes("assetUrl"), "profile modal must render uploaded avatar URLs");
assert(
  identityBar.includes(":webp=\"true\""),
  "identity bar uploaded avatar images must enable WebP decoding"
);
assert(
  identityBar.includes("refreshCurrentAuth") &&
    identityBar.includes("refreshIdentityFromServer"),
  "identity bar must refresh cached auth from the server"
);
assert(
  identityBar.includes("clearCurrentUserAvatarUrl") &&
    identityBar.includes('@error="handleAvatarLoadError') &&
    identityBar.includes("handleAvatarLoadError") &&
    identityBar.includes("this.refreshIdentity()"),
  "identity bar must fall back and clear stale cached avatars when uploaded images fail"
);
assert(
  identityBar.includes('error?.statusCode === 401') &&
    identityBar.includes("this.finishProfileRequest(null)") &&
    identityBar.includes('error.userMessage || "登录已过期，请重新登录。"'),
  "profile modal must close stale auth requests and tell users to relogin after 401"
);
assert(
  identityBar.includes('error?.userMessage || "个人信息保存失败"'),
  "profile modal must surface avatar upload failure messages instead of only generic profile save failures"
);
assert(identityBar.includes("user.nickname"), "identity display must prefer nickname");
assert(
  identityBar.includes("profileNameWithGenderSymbol") &&
    identityBar.includes('return "♂";') &&
    identityBar.includes('return "♀";') &&
    identityBar.includes("profileNameWithGenderSymbol(this.user.nickname, this.user.gender)") &&
    identityBar.includes("profileGenderSymbol"),
  "identity profile names must prefix nickname with saved or drafted gender symbol"
);
assert(
  identityBar.includes("profileGenderSymbol") &&
    identityBar.includes('type="nickname"') &&
    identityBar.includes("handleNicknameInput"),
  "profile modal nickname text must use the native WeChat nickname input"
);
assert(
  identityBar.includes('class="profile-nickname-input"') &&
    identityBar.includes(':placeholder="profileNicknamePlaceholder"') &&
    identityBar.includes("@input=\"handleNicknameInput\"") &&
    identityBar.includes("@blur=\"handleNicknameBlur\""),
  "profile modal must use a visible WeChat nickname input so selected nicknames appear immediately"
);
assert(
  !identityBar.includes("nicknameSelectorVisible") &&
    !identityBar.includes("nicknameInputFocused") &&
    !identityBar.includes("nicknamePickerFocused") &&
    !identityBar.includes("activateWechatNicknameInput") &&
    !identityBar.includes("focusWechatNicknameInput") &&
    !identityBar.includes("openNicknameOptions") &&
    !identityBar.includes("nickname-picker-input") &&
    !identityBar.includes('itemList: ["选择微信昵称", "自己填写昵称"]') &&
    !identityBar.includes("@tap.stop=\"openNicknameOptions\""),
  "profile modal must not intercept the native nickname input"
);
assert(
  identityBar.includes('@change="handleNicknameInput"') &&
    identityBar.includes('@confirm="handleNicknameInput"'),
  "profile nickname picker must capture WeChat nickname commit events"
);
assert(
  identityBar.includes("keepCurrentOnEmpty: true"),
  "profile nickname blur must not clear a nickname already selected from WeChat"
);
assert(
  !identityBar.includes("this.user.open_id || this.user.openid") &&
    identityBar.includes("profileNameWithGenderSymbol(this.user.nickname, this.user.gender)"),
  "identity display must show fill nickname instead of falling back to openid"
);
assert(
  !identityBar.includes('class="profile-input"') &&
    !identityBar.includes('<view class="profile-field-label">昵称</view>'),
  "profile modal must remove the lower nickname input field"
);
assert(
  identityBar.includes("genderAvatarClass") &&
    identityBar.includes("genderAvatarClass(this.user?.gender)") &&
    !identityBar.includes('return "custom";'),
  "uploaded avatars must keep gender avatar classes instead of using a neutral custom class"
);
assert(
  identityBar.includes("--avatar-male-ring") &&
    identityBar.includes("--avatar-female-ring") &&
    identityBar.includes("border: 3rpx solid var(--avatar-unknown-ring)") &&
    identityBar.includes("border: 4rpx solid var(--avatar-unknown-ring)") &&
    identityBar.includes(".auth-avatar.male") &&
    identityBar.includes(".profile-avatar.female"),
  "identity avatar rings must use distinct male and female colors"
);

const mine = read("apps/miniprogram/src/pages/mine/index.vue");
assert(mine.includes("个人信息"), "mine page must show personal information");
assert(mine.includes("openProfileEditor"), "mine page must expose profile editor");
assert(mine.includes("AUTH_PROFILE_REQUEST_EVENT"), "mine page must request shared profile modal");
assert(mine.includes("profileAvatarSrc"), "mine page must render the current profile avatar");
assert(
  mine.includes(":webp=\"true\""),
  "mine uploaded avatar image must enable WebP decoding"
);
assert(
  !mine.includes("user?.open_id || user?.openid") &&
    mine.includes("profileNameWithGenderSymbol(user?.nickname, user?.gender)"),
  "mine profile display must show fill nickname instead of openid"
);
assert(
  mine.includes("profileNameWithGenderSymbol") &&
    mine.includes('return "♂";') &&
    mine.includes('return "♀";') &&
    mine.includes("profileNameWithGenderSymbol(user?.nickname, user?.gender)"),
  "mine profile name must prefix nickname with saved gender symbol"
);
assert(
  mine.includes(":class=\"profileAvatarClass\"") &&
    mine.includes("profileAvatarClass") &&
    mine.includes("border: 4rpx solid var(--avatar-unknown-ring)") &&
    mine.includes(".profile-avatar.male") &&
    mine.includes(".profile-avatar.female"),
  "mine profile avatar ring must reflect the current user gender"
);
assert(
  mine.includes("clearCurrentUserAvatarUrl") &&
    mine.includes('@error="handleProfileAvatarError"') &&
    mine.includes("handleProfileAvatarError") &&
    mine.includes("hydrateAuth()"),
  "mine profile avatar must fall back and clear stale cached avatars when uploaded images fail"
);

console.log("D14 profile check passed");
