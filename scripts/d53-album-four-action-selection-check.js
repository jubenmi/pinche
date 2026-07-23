import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

function read(relativePath) {
  const absolutePath = path.join(root, relativePath);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`D53 required file is missing: ${relativePath}`);
  }
  return fs.readFileSync(absolutePath, "utf8");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function methodSource(name) {
  const start = album.indexOf(`${name}()`);
  assert(start >= 0, `album methods must define ${name}()`);
  const end = album.indexOf("\n    },", start);
  assert(end > start, `album method ${name}() must have a bounded body`);
  return album.slice(start, end);
}

function actionElement(methodName) {
  const tap = album.indexOf(`@tap=\"${methodName}\"`);
  assert(tap >= 0, `toolbar must bind ${methodName}`);
  const starts = [album.lastIndexOf("<view", tap), album.lastIndexOf("<t-button", tap)]
    .filter((index) => index >= 0);
  const start = Math.max(...starts);
  const tag = /^<(view|t-button)\b/.exec(album.slice(start))?.[1];
  assert(tag, `${methodName} must be attached to a view or button`);
  const end = album.indexOf(`</${tag}>`, tap);
  assert(end > tap, `${methodName} action element must close`);
  return album.slice(start, end + tag.length + 3);
}

function filterWatcherSource(name, nextMarker) {
  const start = album.indexOf(`    ${name}() {`);
  const end = album.indexOf(nextMarker, start + 1);
  assert(start >= 0 && end > start, `${name} watcher must be separately defined`);
  return album.slice(start, end);
}

function assertSelectionPersistsAcrossFilter(watcher, name) {
  const tagGuard = watcher.indexOf('selectionModePurpose === "tag"');
  assert(tagGuard >= 0, `${name} may clear selection only for tag mode`);
  for (const reset of ["this.selectionMode = false", "this.selectedPhotoIds = []"]) {
    const resetAt = watcher.indexOf(reset);
    assert(
      resetAt === -1 || resetAt > tagGuard,
      `${name} must not clear share/download selection outside its tag-only branch`
    );
  }
}

const requirements = read(".kiro/specs/album-four-action-selection-workbench/requirements.md");
const design = read(".kiro/specs/album-four-action-selection-workbench/design.md");
const album = read("apps/miniprogram/src/pages/session/album.vue");
const service = read("apps/api/src/modules/core/service.js");
const server = read("apps/api/src/server.js");
const packageJson = read("package.json");

for (const token of ["scope: \"all\"", "mediaIds", "ALBUM_PUBLIC_SHARE_SELECTION_INVALID"]) {
  assert(requirements.includes(token) || design.includes(token), `D53 spec must define ${token}`);
}

const actions = ["分享", "下载", "标注", "招募"];
let previous = -1;
for (const action of actions) {
  const index = album.indexOf(`>${action}<`);
  assert(index > previous, `album actions must include ${actions.join("、")} in order`);
  previous = index;
}
for (const legacyLabel of ["预览并分享", "全部下载", "多选下载", "批量标注"]) {
  assert(!album.includes(`>${legacyLabel}<`), `${legacyLabel} must not remain a normal action button`);
}
const openShareSelection = methodSource("openShareSelectionMode");
assert(
  /selectionModePurpose\s*=\s*["']share["']/.test(openShareSelection),
  "share action must enter share selection directly"
);
const openDownloadSelection = methodSource("openDownloadSelectionMode");
assert(
  /selectionModePurpose\s*=\s*["']download["']/.test(openDownloadSelection),
  "download action must enter download selection directly"
);

const shareAllAction = actionElement("shareAllAlbumMedia");
const shareSelectedAction = actionElement("shareSelectedAlbumMedia");
assert(shareAllAction.includes("分享全部"), "share toolbar must expose 分享全部");
assert(shareSelectedAction.includes("分享选中"), "share toolbar must expose 分享选中");
assert(
  /:disabled="[^"]*selectedPhotoCount\s*===\s*0[^"]*"/.test(shareSelectedAction),
  "分享选中 must disable only when the share selection is empty"
);
const downloadAllAction = actionElement("downloadAllPhotos");
const downloadSelectedAction = actionElement("downloadSelectedPhotos");
assert(downloadAllAction.includes("下载全部"), "download toolbar must expose 下载全部");
assert(downloadSelectedAction.includes("下载选中"), "download toolbar must expose 下载选中");
assert(
  /:disabled="[^"]*selectedPhotoCount\s*===\s*0[^"]*"/.test(downloadSelectedAction),
  "下载选中 must disable only when the download selection is empty"
);

const shareAllMethod = methodSource("shareAllAlbumMedia");
assert(/scope\s*:\s*["']all["']/.test(shareAllMethod), "分享全部 must submit scope: all");
const shareSelectedMethod = methodSource("shareSelectedAlbumMedia");
assert(/mediaIds\s*:/.test(shareSelectedMethod), "分享选中 must submit selected mediaIds");
const downloadSelectedMethod = methodSource("async downloadSelectedPhotos");
assert(
  /this\.downloadablePhotos\.filter/.test(downloadSelectedMethod) &&
    !/this\.filteredDownloadablePhotos\.filter/.test(downloadSelectedMethod),
  "下载选中 must resolve from complete downloadablePhotos, not the current filter"
);
assertSelectionPersistsAcrossFilter(
  filterWatcherSource("activeFilter", "selectedRoleFilter"),
  "activeFilter"
);
assertSelectionPersistsAcrossFilter(
  filterWatcherSource("selectedRoleFilter", "    methods: {"),
  "selectedRoleFilter"
);
assert(album.includes("ShareIcon") && album.includes("UserAddIcon"), "share and recruitment must use distinct icons");
assert(album.includes("tag-action"), "tag action must retain its green primary style");
const recruitmentMethod = methodSource("openRecruitment");
assert(
  recruitmentMethod.includes("/pages/session/share?id=${this.sessionId}"),
  "recruitment must navigate to the invitation page"
);
assert(
  !recruitmentMethod.includes("entry=album"),
  "recruitment must not pass entry=album"
);

assert(service.includes("normalizeSessionAlbumPublicShareScope"), "service must normalize explicit share scopes");
assert(service.includes("ALBUM_PUBLIC_SHARE_SELECTION_INVALID"), "selected media failures need a stable error");
assert(!service.includes("mediaIds, { max: 30"), "snapshot digest must not cap media IDs at 30");
assert(server.includes("publicShareTokenOptions(body)"), "share token route must forward only explicit scope inputs");
assert(packageJson.includes("d53:unit") && packageJson.includes("d53:check") && packageJson.includes("d53:smoke"), "package scripts must expose D53 verification");

console.log("D53 album four-action and explicit share-scope checks passed");
