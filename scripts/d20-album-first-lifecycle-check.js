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

const spec = read("docs/superpowers/specs/2026-07-03-album-first-lifecycle-design.md");
assert(spec.includes("用户主路径只理解两个阶段"), "spec must keep the two-stage user model");
assert(!spec.includes("24h"), "spec must not reintroduce a 24h memory transition");

const mine = read("apps/miniprogram/src/pages/mine/index.vue");
const calendar = read("apps/miniprogram/src/components/SessionCalendar.vue");
assert(mine.includes("SessionCalendar"), "mini-program mine page must render the shared calendar component");
for (const token of [
  "isCalendarItemPostStart",
  "albumFirst",
  "album-first-row",
  "albumCtaText",
  "handleCalendarCardTap",
  "calendarPostStartText",
  "goAlbum",
  "上传照片",
  "已发车 · 相册开放"
]) {
  assert(calendar.includes(token), `mini-program mine calendar must include ${token}`);
}
assert(
  !calendar.includes("calendarPrimaryActionLabel") && !calendar.includes("calendarSecondaryActionLabel"),
  "mini-program mine calendar must not reintroduce separate lifecycle action buttons"
);

const detail = read("apps/miniprogram/src/pages/session/detail.vue");
for (const token of [
  "isPostStart",
  "post-start-album-card",
  "post-start-album-stats",
  "albumContentCount",
  "相册已开放",
  "albumPrimaryText",
  "回看相册",
  "上传照片"
]) {
  assert(detail.includes(token), `mini-program detail page must include ${token}`);
}

const album = read("apps/miniprogram/src/pages/session/album.vue");
for (const token of [
  "empty-upload-button",
  "上传第一张照片",
  "@tap=\"choosePhotos\""
]) {
  assert(album.includes(token), `mini-program album empty state must include ${token}`);
}

const webMini = read("apps/admin-web/src/components/MiniProgramWorkspace.vue");
for (const token of [
  "isPostStartSession",
  "sessionLifecycleLabel",
  "webAlbumPrimaryActionLabel",
  "打开相册",
  "已发车 · 相册开放"
]) {
  assert(webMini.includes(token), `web mini-program must include ${token}`);
}
