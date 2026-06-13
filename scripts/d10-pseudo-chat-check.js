import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

function read(relativePath) {
  const filePath = path.join(root, relativePath);
  if (!fs.existsSync(filePath)) {
    fail(`${relativePath} is missing`);
    return "";
  }
  return fs.readFileSync(filePath, "utf8");
}

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

function mustInclude(file, text, label = text) {
  const source = read(file);
  if (!source.includes(text)) {
    fail(`${file} is missing ${label}`);
  }
}

function mustMatch(file, pattern, label = pattern.source) {
  const source = read(file);
  if (!pattern.test(source)) {
    fail(`${file} is missing ${label}`);
  }
}

const migrationPath = "apps/api/migrations/0004_session_interaction_board.sql";
if (!fs.existsSync(path.join(root, migrationPath))) {
  fail(`${migrationPath} is missing`);
} else {
  mustInclude(migrationPath, "session_chat_rooms");
  mustInclude(migrationPath, "session_messages");
  mustInclude(migrationPath, "pinned_message_id");
  mustInclude(migrationPath, "room_id");
  mustInclude(migrationPath, "message_type");
  mustMatch(migrationPath, /UNIQUE KEY\s+uniq_session_chat_rooms_session\s*\(session_id\)/);
  mustInclude(migrationPath, "cancelled");
}

mustInclude(".gitmodules", "packages/talk");
mustInclude(".gitmodules", "git@github.com:jubenmi/talk.git");
mustInclude("package.json", "packages/talk");
mustInclude("apps/api/package.json", "@jubenmi/talk");
mustInclude("apps/miniprogram/package.json", "@jubenmi/talk");
mustInclude("packages/talk/package.json", "@jubenmi/talk");

for (const exportedName of ["claimSessionSeat", "kickSessionSeat", "cancelSession"]) {
  mustInclude("apps/api/src/modules/core/service.js", `export async function ${exportedName}`);
}

for (const chatExtensionText of [
  "sessionPseudoChatExtension",
  "afterSessionCreated",
  "afterSessionSeatKicked",
  "afterSessionCancelled"
]) {
  mustInclude("packages/talk/api/index.js", chatExtensionText);
}

for (const serviceText of [
  "getSessionChat",
  "listSessionMessages",
  "createSessionMessage",
  "updateSessionPinnedMessage",
  "createSystemSessionMessage",
  "ensureDefaultPinnedMessage",
  "session_chat_rooms",
  "session_messages"
]) {
  mustInclude("packages/talk/api/service.js", serviceText);
}

for (const routeText of ["/chat", "/messages"]) {
  mustInclude("packages/talk/api/routes.js", routeText);
}
mustMatch("packages/talk/api/routes.js", /chat\\\/pin/, "chat/pin route");
mustInclude("apps/api/src/modules/extensions/registry.js", "sessionExtensions");
mustInclude("apps/api/src/modules/extensions/registry.js", "routeExtensions");
mustInclude("apps/api/src/modules/extensions/registry.js", "runSessionExtensionHook");
mustInclude("apps/api/src/modules/extensions/session-pseudo-chat/index.js", "@jubenmi/talk/api");
mustInclude("apps/api/src/server.js", "routeExtensions");

for (const routeText of ["/claim", "/kick", "/cancel"]) {
  mustInclude("apps/api/src/server.js", routeText);
}

for (const detailExtensionText of [
  "sessionDetailExtensions",
  "sessionDetailExtensionRefs",
  "authTools",
  "stopDetailExtensions"
]) {
  mustInclude("apps/miniprogram/src/pages/session/detail.vue", detailExtensionText);
}

for (const chatComponentText of [
  "messages",
  "pinnedMessage",
  "loadChat",
  "sendMessage",
  "chat-float-button",
  "chat-unread-badge",
  "chat-modal-mask",
  "chatModalOpen",
  "unreadCount",
  "openChatModal",
  "closeChatModal",
  "updateUnreadCount"
]) {
  mustInclude("packages/talk/miniprogram/ChatEntry.vue", chatComponentText);
}
mustMatch(
  "packages/talk/miniprogram/ChatEntry.vue",
  /setInterval\([^)]*3000/s,
  "3 second message polling"
);
if (read("apps/miniprogram/src/pages/session/detail.vue").includes("pinned_message_text")) {
  fail("detail page must not read sessions.pinned_message_text");
}
for (const forbiddenDetailText of [
  "chat-float-button",
  "chat-modal-mask",
  "chatModalOpen",
  "openChatModal",
  "sendMessage"
]) {
  if (read("apps/miniprogram/src/pages/session/detail.vue").includes(forbiddenDetailText)) {
    fail(`detail page should mount chat extension instead of keeping ${forbiddenDetailText}`);
  }
}

mustInclude("apps/miniprogram/src/extensions/sessionExtensions.js", "sessionDetailExtensions");
mustInclude("apps/miniprogram/src/extensions/sessionExtensions.js", "sessionManageExtensions");
mustInclude("apps/miniprogram/src/extensions/session-pseudo-chat/index.js", "@jubenmi/talk/miniprogram");
mustInclude("packages/talk/miniprogram/index.js", "ChatEntry");
mustInclude("packages/talk/miniprogram/index.js", "ManagePinnedMessage");
mustInclude("packages/talk/miniprogram/ManagePinnedMessage.vue", "pinnedMessageText");
mustInclude("packages/talk/miniprogram/api.js", "chat/pin");
mustInclude("packages/talk/miniprogram/ManagePinnedMessage.vue", "savePinnedMessage");
mustInclude("apps/miniprogram/src/pages/session/manage.vue", "sessionManageExtensions");
mustInclude("apps/miniprogram/src/pages/session/manage.vue", "authTools");
mustInclude("apps/miniprogram/src/pages/session/manage.vue", "kickSeat");
mustInclude("apps/miniprogram/src/pages/session/manage.vue", "cancelSession");
if (read("apps/miniprogram/src/pages/session/manage.vue").includes("pinned_message_text")) {
  fail("manage page must not read sessions.pinned_message_text");
}
for (const forbiddenManageText of ["pinnedMessageText", "/chat/pin", "savePinnedMessage"]) {
  if (read("apps/miniprogram/src/pages/session/manage.vue").includes(forbiddenManageText)) {
    fail(`manage page should mount pinned-message extension instead of keeping ${forbiddenManageText}`);
  }
}

const shareSource = read("apps/miniprogram/src/pages/session/share.vue");
if (shareSource.includes("分享前补充")) {
  fail("share page should not keep the old 分享前补充 surface");
}

if (!process.exitCode) {
  console.log("D10 pseudo chat check passed");
}
