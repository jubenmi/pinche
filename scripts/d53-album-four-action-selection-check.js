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
assert(album.includes('selectionModePurpose = "share"'), "share action must enter share selection directly");
assert(album.includes('selectionModePurpose = "download"'), "download action must enter download selection directly");
assert(album.includes("分享全部") && album.includes("分享选中"), "share toolbar must expose all and selected actions");
assert(album.includes("下载全部") && album.includes("下载选中"), "download toolbar must expose all and selected actions");
assert(album.includes('selectionModePurpose === "share"') && album.includes(":disabled"), "selected share must disable before a selection exists");
assert(album.includes("ShareIcon") && album.includes("UserAddIcon"), "share and recruitment must use distinct icons");
assert(album.includes("tag-action"), "tag action must retain its green primary style");
assert(album.includes("selectedPhotoIds.clear") === false || album.includes('selectionModePurpose === "tag"'), "share and download filter changes must preserve selection");
assert(album.includes("downloadablePhotos"), "selected downloads must resolve from the complete downloadable media set");
assert(album.includes("/pages/session/share?id=${this.sessionId}"), "recruitment must navigate to the invitation page");
assert(!album.includes("/pages/session/share?id=${this.sessionId}&entry=album"), "recruitment must not pass entry=album");

assert(service.includes("normalizeSessionAlbumPublicShareScope"), "service must normalize explicit share scopes");
assert(service.includes("ALBUM_PUBLIC_SHARE_SELECTION_INVALID"), "selected media failures need a stable error");
assert(!service.includes("mediaIds, { max: 30"), "snapshot digest must not cap media IDs at 30");
assert(server.includes("publicShareTokenOptions(body)"), "share token route must forward only explicit scope inputs");
assert(packageJson.includes("d53:unit") && packageJson.includes("d53:check") && packageJson.includes("d53:smoke"), "package scripts must expose D53 verification");

console.log("D53 album four-action and explicit share-scope checks passed");
