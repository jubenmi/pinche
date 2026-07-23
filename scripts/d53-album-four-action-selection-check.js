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

function sourceSection(source, startPattern, endMarker, label) {
  const startMatch = source.match(startPattern);
  assert(startMatch?.index !== undefined, `${label} start must be executable source`);
  const start = startMatch.index;
  const end = source.indexOf(endMarker, start + startMatch[0].length);
  assert(end > start, `${label} must have a bounded source section`);
  return source.slice(start, end);
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

const shareScopeNormalizer = sourceSection(
  service,
  /^export function normalizeSessionAlbumPublicShareScope\(options = \{\}\) \{/m,
  "export function selectEligiblePublicShareMedia",
  "public share scope normalizer"
);
assert(
  /const specifiedCount = Number\(hasScope\) \+ Number\(hasMediaIds\) \+ Number\(hasFocusMediaId\)/.test(shareScopeNormalizer) &&
    /if \(specifiedCount > 1\) throw publicShareSelectionInvalid\(\)/.test(shareScopeNormalizer),
  "scope, mediaIds, and focusMediaId must be mutually exclusive"
);
assert(
  /return \{ mode: "all", focusMediaId: null, mediaIds: \[\] \}/.test(shareScopeNormalizer) &&
    /return \{ mode: "selected", focusMediaId: null, mediaIds \}/.test(shareScopeNormalizer),
  "scope normalizer must emit explicit all and selected modes"
);
assert(
  /throw publicShareSelectionInvalid\(\)/.test(shareScopeNormalizer),
  "selected input failures must use the stable selection-invalid error"
);
const snapshotNormalizer = sourceSection(
  service,
  /^export function normalizePublicShareSnapshotIds\(value, options = \{\}\) \{/m,
  "export function isPublicShareSnapshotMediaId",
  "snapshot ID normalizer"
);
assert(
  /options\.max === undefined \? Number\.POSITIVE_INFINITY/.test(snapshotNormalizer) &&
    !/const max = Number\(options\.max \|\| 30\)/.test(snapshotNormalizer),
  "snapshot media IDs must not retain the legacy 30-item default cap"
);
const shareTokenOptions = sourceSection(
  server,
  /^export function publicShareTokenOptions\(body\) \{/m,
  "function safeTextEqual",
  "share token option forwarding"
);
assert(
  /Object\.prototype\.hasOwnProperty\.call\(body, key\)/.test(shareTokenOptions) &&
    /\["scope", "mediaIds", "focusMediaId"\]/.test(shareTokenOptions),
  "share-token forwarding must copy only explicitly supplied scope fields"
);
const shareTokenRoute = sourceSection(
  server,
  /^  const sessionAlbumShareTokenId = idMatch\(/m,
  "  const sessionAlbumPublicSharesId = idMatch",
  "share-token route"
);
assert(
  /const shareOptions = publicShareTokenOptions\(body\)/.test(shareTokenRoute) &&
    /createOrReuseSessionAlbumPublicShare\([\s\S]*?shareOptions/.test(shareTokenRoute),
  "share-token route must pass its own-field options into the service"
);
const packageScripts = JSON.parse(packageJson).scripts || {};
assert(
  packageScripts["d53:unit"] === "node --test apps/api/test/album-share-selection.test.mjs" &&
    packageScripts["d53:check"] === "node scripts/d53-album-four-action-selection-check.js" &&
    packageScripts["d53:smoke"] === "node scripts/d53-album-four-action-selection-smoke.js" &&
    String(packageScripts.check || "").includes("node scripts/d53-album-four-action-selection-check.js"),
  "package scripts must expose D53 verification and include its static check"
);

console.log("D53 album four-action and explicit share-scope checks passed");
