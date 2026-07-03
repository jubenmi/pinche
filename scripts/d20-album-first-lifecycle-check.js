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
for (const token of [
  "isCalendarItemPostStart",
  "calendarPrimaryActionLabel",
  "calendarSecondaryActionLabel",
  "goAlbum",
  "回看相册",
  "已发车 · 相册开放"
]) {
  assert(mine.includes(token), `mini-program mine page must include ${token}`);
}

const detail = read("apps/miniprogram/src/pages/session/detail.vue");
for (const token of [
  "isPostStart",
  "post-start-album-card",
  "相册已开放",
  "albumPrimaryText",
  "打开相册"
]) {
  assert(detail.includes(token), `mini-program detail page must include ${token}`);
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
