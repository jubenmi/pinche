import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

function read(relativePath) {
  const absolutePath = path.join(root, relativePath);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`D50 required file is missing: ${relativePath}`);
  }
  return fs.readFileSync(absolutePath, "utf8");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const requirements = read("specs/d50-album-single-media-sharing/requirements.md");
const design = read("specs/d50-album-single-media-sharing/design.md");
const tasks = read("specs/d50-album-single-media-sharing/tasks.md");
const spec = `${requirements}\n${design}`;

for (const token of ["最多 30", "最多 3", "Range", "查看完整相册"]) {
  assert(spec.includes(token), `D50 spec must define: ${token}`);
}

for (const nonGoal of [
  "不新增数据库表或新的小程序页面路由。",
  "不直接分享原始图片/视频文件，不开放公开下载。",
  "不新增评论、点赞、收藏、报名、角色认领或公开广场。",
  "不新增分享奖励、诱导分享、传播排名或新的 analytics 管线。",
  "不改变现有整册好友/群分享与朋友圈分享语义。",
  "不新增视频转码、播放器或额外自动重试。",
  "不重构无关相册布局、上传、标注、瀑布流或 viewer windowing。"
]) {
  assert(requirements.includes(nonGoal), `D50 requirements must retain non-goal: ${nonGoal}`);
}

assert(tasks.includes("D50.2"), "D50 tasks must retain the red-light contract phase");

const service = read("apps/api/src/modules/core/service.js");
assert(
  service.includes("ALBUM_PUBLIC_SHARE_MEDIA_UNAVAILABLE"),
  "D50 service must reject an unavailable focused media item with ALBUM_PUBLIC_SHARE_MEDIA_UNAVAILABLE"
);

const server = read("apps/api/src/server.js");
for (const token of [
  "focusMediaId",
  "focus_media_id",
  "/api/session-album/public-share/media/${mediaId}/video-url",
  "/api/session-album/public-share/media/${mediaId}/video-file",
  "session-album-public-video-file"
]) {
  assert(server.includes(token), `D50 server contract is missing: ${token}`);
}

const albumPage = read("apps/miniprogram/src/pages/session/album.vue");
assert(
  albumPage.includes('source === "single_media_share"'),
  'D50 album page must enable focused public mode only for source === "single_media_share"'
);
assert(
  albumPage.includes('primary-action-label="查看完整相册"'),
  "D50 album page must pass the focused-mode 查看完整相册 primary action"
);

const viewer = read("apps/miniprogram/src/components/AlbumImageViewer.vue");
assert(
  viewer.includes('open-type="share"'),
  "D50 album viewer must render a native open-type=share button"
);

console.log("D50 album single-media sharing checks passed");
