import assert from "node:assert/strict";
import fs from "node:fs";

function source(path) {
  return fs.readFileSync(path, "utf8");
}

const app = source("apps/miniprogram/src/App.vue");
const detail = source("apps/miniprogram/src/pages/session/detail.vue");
const chat = source("apps/miniprogram/src/extensions/session-pseudo-chat/ChatEntry.vue");
const setup = source("apps/miniprogram/src/pages/session/setup.vue");
const privacy = source("apps/miniprogram/src/pages/session/albumPrivacy.vue");
const album = source("apps/miniprogram/src/pages/session/album.vue");
const manage = source("apps/miniprogram/src/pages/session/manage.vue");
const service = source("apps/api/src/modules/core/service.js");
const migration = fs.existsSync("apps/api/migrations/0033_session_creation_idempotency.sql")
  ? source("apps/api/migrations/0033_session_creation_idempotency.sql")
  : "";

assert.match(app, /\.bottom-action\s*\{[\s\S]*bottom:\s*0;/);
assert.match(app, /\.bottom-action\s*\{[\s\S]*env\(safe-area-inset-bottom\)/);

const seatBoardIndex = detail.indexOf("<RoleSeatBoard");
const chatEntryIndex = detail.indexOf("<ChatEntry");
const reviewSectionIndex = detail.indexOf('<view v-if="session.id" class="section">', seatBoardIndex);
assert.ok(
  seatBoardIndex < chatEntryIndex && chatEntryIndex < reviewSectionIndex,
  "chat entry must appear before the review section and after the seat board"
);
const chatTriggerStyle = chat.slice(chat.indexOf(".chat-entry-button"), chat.indexOf(".chat-modal-mask"));
assert.ok(!/position:\s*fixed/.test(chatTriggerStyle), "chat trigger must stay in normal document flow");

assert.match(setup, /busyAction\s*=\s*true;[\s\S]*await ensureLoggedIn/);
assert.match(setup, /idempotencyKey:\s*this\.creationIdempotencyKey/);
assert.ok(!setup.includes("/chat/pin"), "initial creation already writes the pinned message");
assert.match(service, /replaySessionCreation/);
assert.match(migration, /uniq_sessions_organizer_creation_key/);

assert.match(chat, /isChatAccessDeniedError/);
assert.match(chat, /聊天刷新失败，正在重试/);

assert.match(privacy, /:disabled="!canSavePrivacy"/);
assert.match(privacy, /privacyLoaded/);
assert.match(privacy, /retryPrivacyLoad/);

assert.match(album, /albumLoadFailed/);
assert.match(album, /retryAlbumLoad/);
assert.match(album, /albumListPresentation/);

const publicAlbumRedirect = album.slice(
  album.indexOf("redirectUnavailablePublicAlbumHome()"),
  album.indexOf("async loadPublicAlbum()")
);
const publicAlbumLoadStart = album.indexOf("async loadPublicAlbum()");
const publicAlbumLoad = album.slice(
  publicAlbumLoadStart,
  album.indexOf("    resetPublicSharePagination() {", publicAlbumLoadStart)
);

assert.match(
  publicAlbumRedirect,
  /uni\.reLaunch\(\{\s*url:\s*"\/pages\/index\/index"\s*\}\)/
);
assert.match(
  publicAlbumLoad,
  /!hasPublicAlbumAccessCredentials\(this\.sessionId,\s*this\.albumShareToken\)[\s\S]*this\.redirectUnavailablePublicAlbumHome\(\);[\s\S]*return;/
);
assert.match(
  publicAlbumLoad,
  /isUnavailablePublicAlbumError\(error\)[\s\S]*this\.redirectUnavailablePublicAlbumHome\(\);[\s\S]*return;/
);
assert.match(
  publicAlbumLoad,
  /this\.statusText = "分享相册加载失败，请稍后重试。";[\s\S]*this\.albumLoadFailed = true;/
);

assert.match(manage, /otherOnboardSeatMemberCount\(this\.session\)/);

console.log("P1 mini program source contracts passed.");
