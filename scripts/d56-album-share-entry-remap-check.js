import fs from "node:fs";
import path from "node:path";
import { parse as parseJavaScript, parseExpression } from "@babel/parser";
import { parse as parseSfc } from "@vue/compiler-sfc";

const root = process.cwd();
const failures = [];

function check(condition, message) {
  if (!condition) failures.push(message);
}

function read(relativePath) {
  const absolutePath = path.join(root, relativePath);
  check(fs.existsSync(absolutePath), `D56 required file is missing: ${relativePath}`);
  return fs.existsSync(absolutePath) ? fs.readFileSync(absolutePath, "utf8") : "";
}

function walk(relativePath) {
  const absolutePath = path.join(root, relativePath);
  if (!fs.existsSync(absolutePath)) return [];
  return fs.readdirSync(absolutePath, { withFileTypes: true }).flatMap((entry) => {
    const child = path.join(relativePath, entry.name).replaceAll(path.sep, "/");
    return entry.isDirectory() ? [child, ...walk(child)] : [child];
  });
}

function parseModule(source, label) {
  try {
    return parseJavaScript(source, { sourceType: "module" });
  } catch (error) {
    failures.push(`D56 ${label} must parse as JavaScript: ${error.message}`);
    return null;
  }
}

function parseTemplateExpression(expression, label) {
  if (!expression?.content) {
    failures.push(`D56 ${label} must have an expression`);
    return null;
  }
  try {
    return expression.ast || parseExpression(expression.content);
  } catch (error) {
    failures.push(`D56 ${label} must parse as an expression: ${error.message}`);
    return null;
  }
}

function walkNode(node, visit) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const child of node) walkNode(child, visit);
    return;
  }
  if (typeof node.type !== "string") return;
  visit(node);
  for (const [key, value] of Object.entries(node)) {
    if (["comments", "end", "extra", "loc", "start", "tokens"].includes(key)) continue;
    if (value && typeof value === "object") walkNode(value, visit);
  }
}

function findNodes(node, predicate) {
  const matches = [];
  walkNode(node, (candidate) => {
    if (predicate(candidate)) matches.push(candidate);
  });
  return matches;
}

function walkTemplate(node, visit) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const child of node) walkTemplate(child, visit);
    return;
  }
  if (node.type === 1) visit(node);
  if (node.children) walkTemplate(node.children, visit);
  if (node.branches) walkTemplate(node.branches, visit);
}

function findTemplateElements(node, predicate) {
  const matches = [];
  walkTemplate(node, (element) => {
    if (predicate(element)) matches.push(element);
  });
  return matches;
}

function keyName(node) {
  if (!node) return null;
  if (node.type === "Identifier") return node.name;
  if (node.type === "StringLiteral" || node.type === "NumericLiteral") return String(node.value);
  return null;
}

function literalValue(node) {
  if (
    node?.type === "StringLiteral" ||
    node?.type === "NumericLiteral" ||
    node?.type === "BooleanLiteral"
  ) {
    return node.value;
  }
  if (node?.type === "NullLiteral") return null;
  return undefined;
}

function isIdentifier(node, name) {
  return node?.type === "Identifier" && node.name === name;
}

function isThisMember(node, name) {
  return (
    node?.type === "MemberExpression" &&
    node.object?.type === "ThisExpression" &&
    ((!node.computed && isIdentifier(node.property, name)) ||
      (node.computed && literalValue(node.property) === name))
  );
}

function objectProperty(object, name) {
  if (object?.type !== "ObjectExpression") return null;
  return object.properties
    .filter(
      (property) =>
        (property.type === "ObjectProperty" || property.type === "ObjectMethod") &&
        keyName(property.key) === name
    )
    .at(-1) || null;
}

function sourceFor(node, source, label) {
  if (!Number.isInteger(node?.start) || !Number.isInteger(node?.end)) {
    failures.push(`D56 ${label} must have source positions`);
    return "";
  }
  return source.slice(node.start, node.end);
}

function exportDefaultObject(program) {
  const declaration = program?.program.body.find(
    (statement) =>
      statement.type === "ExportDefaultDeclaration" &&
      statement.declaration?.type === "ObjectExpression"
  );
  check(declaration, "D56 album script must export a default options object");
  return declaration?.declaration || null;
}

function objectMethod(options, section, name, scriptSource) {
  const sectionProperty = objectProperty(options, section);
  const sectionObject = sectionProperty?.type === "ObjectProperty" ? sectionProperty.value : null;
  check(sectionObject?.type === "ObjectExpression", `D56 album ${section} must be an object`);
  const property = objectProperty(sectionObject, name);
  check(property, `D56 album ${section}.${name}() is required`);
  const node = property?.type === "ObjectMethod" ? property : property?.value;
  check(
    ["ObjectMethod", "FunctionExpression", "ArrowFunctionExpression"].includes(node?.type),
    `D56 album ${section}.${name} must be a function`
  );
  return { node, source: sourceFor(node, scriptSource, `album ${section}.${name}`) };
}

function rootMethod(options, name, scriptSource) {
  const property = objectProperty(options, name);
  check(property, `D56 album ${name}() lifecycle hook is required`);
  const node = property?.type === "ObjectMethod" ? property : property?.value;
  check(
    ["ObjectMethod", "FunctionExpression", "ArrowFunctionExpression"].includes(node?.type),
    `D56 album ${name} must be a function`
  );
  return { node, source: sourceFor(node, scriptSource, `album ${name}`) };
}

function dataObject(options) {
  const property = objectProperty(options, "data");
  const node = property?.type === "ObjectMethod" ? property : property?.value;
  const statement = findNodes(node?.body, (candidate) => candidate.type === "ReturnStatement" && candidate.argument?.type === "ObjectExpression").at(-1);
  check(statement, "D56 album data() must return an object");
  return statement?.argument || null;
}

function memberProperty(object, name) {
  return objectProperty(object, name)?.type === "ObjectProperty"
    ? objectProperty(object, name).value
    : null;
}

function directive(element, name, argument) {
  return element?.props?.find(
    (property) =>
      property.type === 7 &&
      property.name === name &&
      property.arg?.isStatic &&
      property.arg.content === argument
  ) || null;
}

function staticAttribute(element, name, value) {
  return element?.props?.some(
    (property) =>
      property.type === 6 &&
      property.name === name &&
      property.value?.content === value
  ) === true;
}

function hasStaticClass(element, className) {
  return element?.props?.some(
    (property) =>
      property.type === 6 &&
      property.name === "class" &&
      property.value?.content.split(/\s+/).includes(className)
  ) === true;
}

function templateText(node) {
  if (!node || typeof node !== "object") return "";
  if (Array.isArray(node)) return node.map(templateText).join("");
  if (node.type === 2) return node.content;
  return templateText(node.children || []);
}

function tapBindsMethod(element, method) {
  const tap = directive(element, "on", "tap");
  const expression = parseTemplateExpression(tap?.exp, `@tap for ${method}`);
  return (
    isIdentifier(expression, method) ||
    (expression?.type === "CallExpression" && isIdentifier(expression.callee, method))
  );
}

function findAction(actions, label, method) {
  const matches = actions.filter(
    (element) => templateText(element).trim().includes(label) && tapBindsMethod(element, method)
  );
  check(matches.length === 1, `D56 ${label} must bind ${method} exactly once in the action bar`);
  return matches[0] || null;
}

function expressionIsRecruitShare(expression) {
  return (
    expression?.type === "ConditionalExpression" &&
    isIdentifier(expression.test, "recruitInviteToken") &&
    literalValue(expression.consequent) === "share" &&
    literalValue(expression.alternate) === ""
  );
}

function hasThisAssignment(node, name) {
  return findNodes(
    node?.body || node,
    (candidate) => candidate.type === "AssignmentExpression" && isThisMember(candidate.left, name)
  ).length > 0;
}

function callsMethod(node, name) {
  return findNodes(node?.body || node, (candidate) =>
    candidate.type === "CallExpression" &&
    (isIdentifier(candidate.callee, name) || isThisMember(candidate.callee, name))
  ).length > 0;
}

function branchForIntent(node, intent, scriptSource) {
  const branch = findNodes(node?.body, (candidate) => {
    if (candidate.type !== "IfStatement") return false;
    return findNodes(candidate.test, (part) =>
      part.type === "MemberExpression" &&
      isIdentifier(part.object, "ALBUM_SHARE_INTENT") &&
      keyName(part.property) === intent
    ).length > 0;
  }).at(-1);
  check(branch, `D56 onShareAppMessage must have an ${intent} branch`);
  return sourceFor(branch, scriptSource, `onShareAppMessage ${intent} branch`);
}

function hasScopeAllTokenRequest(node) {
  return findNodes(node?.body, (candidate) => {
    if (candidate.type !== "CallExpression" || !isIdentifier(candidate.callee, "request")) return false;
    const requestOptions = candidate.arguments[0];
    const url = memberProperty(requestOptions, "url");
    const method = memberProperty(requestOptions, "method");
    const data = memberProperty(requestOptions, "data");
    const scope = memberProperty(data, "scope");
    const urlSource = sourceFor(url, albumScript, "default share request URL");
    return (
      /\/api\/sessions\/\$\{this\.sessionId\}\/album\/share-token/.test(urlSource) &&
      literalValue(method) === "POST" &&
      literalValue(scope) === "all" &&
      data?.type === "ObjectExpression" &&
      data.properties.filter((property) => property.type === "ObjectProperty").length === 1
    );
  }).length > 0;
}

const albumSource = read("apps/miniprogram/src/pages/session/album.vue");
const packageJson = JSON.parse(read("package.json") || "{}");
const albumSfc = parseSfc(albumSource, { filename: "apps/miniprogram/src/pages/session/album.vue" });
check(albumSfc.errors.length === 0, "D56 album SFC must parse without errors");
check(albumSfc.descriptor.template?.ast, "D56 album must contain a compiled template");
check(albumSfc.descriptor.script?.content, "D56 album must contain an executable script");
check(albumSfc.descriptor.styles.length > 0, "D56 album must contain a scoped style block");

const albumTemplate = albumSfc.descriptor.template?.ast;
const albumScript = albumSfc.descriptor.script?.content || "";
const albumStyle = albumSfc.descriptor.styles.map((style) => style.content).join("\n");
const albumProgram = parseModule(albumScript, "album script");
const albumOptions = exportDefaultObject(albumProgram);
const albumData = dataObject(albumOptions);

const privacyActions = findTemplateElements(
  albumTemplate,
  (element) => hasStaticClass(element, "album-privacy-action")
);
check(privacyActions.length === 1, "D56 privacy entry must have exactly one .album-privacy-action button");
const privacyAction = privacyActions[0];
check(privacyAction?.tag === "t-button", "D56 privacy entry must be a button");
check(staticAttribute(privacyAction, "aria-label", "相册隐私"), "D56 privacy entry needs aria-label=相册隐私");
check(!templateText(privacyAction).includes("隐私"), "D56 privacy entry must not render visible 隐私 text");
check(tapBindsMethod(privacyAction, "goPrivacy"), "D56 privacy entry must retain goPrivacy navigation");
check(
  /\.album-primary-actions\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)\s+78rpx/.test(albumStyle),
  "D56 privacy layout must reserve a 78rpx square column"
);
check(
  /\.album-action-primary\s*,\s*\.album-privacy-action\s*\{[\s\S]*?height:\s*78rpx[\s\S]*?border-radius:\s*12rpx/.test(albumStyle) &&
    /\.album-privacy-action\s*\{[\s\S]*?width:\s*78rpx[\s\S]*?height:\s*78rpx[\s\S]*?padding:\s*0/.test(albumStyle),
  "D56 privacy entry must remain a rounded 78rpx icon-only square"
);

const actionGroups = findTemplateElements(albumTemplate, (element) => hasStaticClass(element, "album-action-groups"));
check(actionGroups.length === 1, "D56 album must contain exactly one four-action group");
const groupActions = (actionGroups[0]?.children || []).filter((child) => child.type === 1);
const actionSpecs = [
  ["分享", "openShareSelectionMode"],
  ["下载", "openDownloadSelectionMode"],
  ["招募", "handleRecruitShareTap"],
  ["标注", "openTagSelectionMode"]
];
const actionElements = actionSpecs.map(([label, method]) => findAction(groupActions, label, method));
const actionIndexes = actionElements.map((element) => groupActions.indexOf(element));
check(
  actionIndexes.every((index, position) => index >= 0 && (position === 0 || actionIndexes[position - 1] < index)),
  "D56 action DOM order must be 分享、下载、招募、标注"
);
check(groupActions.length === 4, "D56 action bar must retain exactly four equal-width actions");
check(/\.album-action-groups\s*\{[\s\S]*?grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)/.test(albumStyle), "D56 action bar must keep four equal columns");
check(hasStaticClass(actionElements[3], "tag-action"), "D56 rightmost 标注 action must retain the green tag-action class");
check(/\.album-tag-command\s*\{[\s\S]*?(?:background|border-color):\s*#1f6f5b/.test(albumStyle), "D56 标注 action must retain its green emphasis style");

const recruitAction = actionElements[2];
const recruitOpenType = directive(recruitAction, "bind", "open-type");
check(staticAttribute(recruitAction, "data-album-share", "recruit"), "D56 招募 action needs data-album-share=recruit");
check(
  expressionIsRecruitShare(parseTemplateExpression(recruitOpenType?.exp, "招募 :open-type")),
  "D56 招募 action must dynamically enable only native open-type=share after its invite token is ready"
);
check(!objectProperty(objectProperty(albumOptions, "methods")?.value, "openRecruitment"), "D56 must remove the legacy openRecruitment navigation method");
check(!/navigateTo\s*\([\s\S]{0,240}\/pages\/session\/share/.test(albumScript), "D56 招募 must not navigate to the invitation page before sharing");

for (const field of [
  "defaultAlbumShareToken",
  "defaultAlbumShareFriendCoverUrl",
  "defaultAlbumShareTimelineCoverUrl",
  "defaultAlbumShareFriendCoverPrepared",
  "defaultAlbumShareTimelineCoverPrepared",
  "defaultAlbumShareGeneration",
  "defaultAlbumSharePromise",
  "defaultAlbumShareAuthority",
  "recruitInviteToken",
  "recruitInviteGeneration",
  "recruitInvitePromise",
  "recruitInviteAuthority"
]) {
  check(memberProperty(albumData, field) !== null, `D56 data() must keep isolated ${field} state`);
}
check(
  memberProperty(albumData, "albumShareCanvasCoordinator")?.type === "CallExpression" &&
    isIdentifier(memberProperty(albumData, "albumShareCanvasCoordinator")?.callee, "createAlbumShareEntryCoordinator"),
  "D56 default and active covers must share one albumShareCanvasCoordinator"
);

const loadAlbum = objectMethod(albumOptions, "methods", "loadAlbum", albumScript);
const primeEntries = objectMethod(albumOptions, "methods", "primeAlbumShareEntries", albumScript);
const prepareDefault = objectMethod(albumOptions, "methods", "prepareDefaultAlbumShare", albumScript);
const prepareRecruit = objectMethod(albumOptions, "methods", "prepareRecruitInvite", albumScript);
const prepareCanvas = objectMethod(albumOptions, "methods", "prepareAlbumShareCanvasCover", albumScript);
check(callsMethod(loadAlbum.node, "invalidateDefaultAlbumShare"), "D56 member loads must invalidate the previous default snapshot");
check(callsMethod(loadAlbum.node, "invalidateRecruitInviteShare"), "D56 member loads must invalidate the previous recruit authority");
check(callsMethod(loadAlbum.node, "primeAlbumShareEntries"), "D56 member loads must non-blockingly reprime share entries");
check(
  loadAlbum.source.indexOf("this.primeAlbumShareEntries()") > loadAlbum.source.indexOf("this.photos ="),
  "D56 member loads must prime only after applying current album media"
);
check(callsMethod(primeEntries.node, "prepareRecruitInvite") && callsMethod(primeEntries.node, "prepareDefaultAlbumShare"), "D56 member prewarm must independently start recruit and default-all preparation");
check(!/activeAlbumShare/.test(primeEntries.source), "D56 member prewarm must not depend on active share state");
check(hasScopeAllTokenRequest(prepareDefault.node), "D56 default prewarm must POST the existing album token endpoint with exactly { scope: 'all' }");
check(callsMethod(prepareDefault.node, "beginDefaultAlbumShareRequest"), "D56 default prewarm must use its own request authority");
check(
  !["albumBusy", "statusText", "albumSharePreparing", "albumShareReadyVisible", "showToast"].some((token) => prepareDefault.source.includes(token)),
  "D56 default prewarm must remain background-only: no busy state, status, ready popup, or toast"
);
check(
  /join-invite-token/.test(prepareRecruit.source) &&
    /method:\s*"POST"/.test(prepareRecruit.source) &&
    /data:\s*\{\s*\}/.test(prepareRecruit.source) &&
    callsMethod(prepareRecruit.node, "isCurrentRecruitInviteRequest"),
  "D56 recruit prewarm must use its isolated current join-invite-token request"
);
check(
  /albumShareCanvasCoordinator\.enqueue/.test(prepareCanvas.source) &&
    /canvasPreparation\.prepare/.test(prepareCanvas.source),
  "D56 default and active cover work must be serialized through the shared Canvas coordinator"
);
const canvasNodes = findTemplateElements(albumTemplate, (element) => element.tag === "canvas");
check(canvasNodes.length === 2, "D56 must retain exactly the two existing hidden Canvas nodes");
for (const id of ["album-share-friend-canvas", "album-share-timeline-canvas"]) {
  check(canvasNodes.some((element) => staticAttribute(element, "id", id) && staticAttribute(element, "canvas-id", id)), `D56 Canvas node ${id} must remain available`);
}

const onShow = rootMethod(albumOptions, "onShow", albumScript);
const onHide = rootMethod(albumOptions, "onHide", albumScript);
const onUnload = rootMethod(albumOptions, "onUnload", albumScript);
const authChange = objectMethod(albumOptions, "methods", "handleAlbumAuthChange", albumScript);
for (const [label, hook] of [["onHide", onHide], ["onUnload", onUnload]]) {
  check(callsMethod(hook.node, "invalidateDefaultAlbumShare"), `D56 ${label} must invalidate default-all sharing`);
  check(callsMethod(hook.node, "invalidateRecruitInviteShare"), `D56 ${label} must invalidate recruit sharing`);
  check(callsMethod(hook.node, "disposeAlbumShareCanvasPreparation"), `D56 ${label} must release Canvas temporary paths`);
  check(/albumShareCanvasCoordinator\?\.invalidate\(\)/.test(hook.source), `D56 ${label} must invalidate queued Canvas work`);
}
check(callsMethod(authChange.node, "invalidateDefaultAlbumShare") && callsMethod(authChange.node, "invalidateRecruitInviteShare"), "D56 identity changes must clear both entry authorities");
check(callsMethod(onShow.node, "primeAlbumShareEntries") && !/await this\.primeAlbumShareEntries\(\)/.test(onShow.source), "D56 onShow must silently reprime missing member entry state without blocking the page");

const onShareAppMessage = rootMethod(albumOptions, "onShareAppMessage", albumScript);
const onShareTimeline = rootMethod(albumOptions, "onShareTimeline", albumScript);
const showShareMenus = objectMethod(albumOptions, "methods", "showShareMenus", albumScript);
const defaultPayload = objectMethod(albumOptions, "methods", "defaultAlbumSharePayload", albumScript);
const activePayload = objectMethod(albumOptions, "methods", "activeAlbumSharePayload", albumScript);
check(callsMethod(onShareAppMessage.node, "albumShareAppMessageIntent"), "D56 onShareAppMessage must route by explicit entry intent");
const recruitBranch = branchForIntent(onShareAppMessage.node, "RECRUIT", albumScript);
const activeBranch = branchForIntent(onShareAppMessage.node, "ACTIVE", albumScript);
const defaultBranch = branchForIntent(onShareAppMessage.node, "DEFAULT_ALL", albumScript);
const unknownBranch = branchForIntent(onShareAppMessage.node, "UNKNOWN", albumScript);
check(/recruitmentSharePayload/.test(recruitBranch) && /recruitInviteToken/.test(recruitBranch) && /singleMediaShareFailClosedPayload/.test(recruitBranch), "D56 recruit app-message branch must use only its invite token and fail closed");
check(!/activeAlbumShare|defaultAlbumShare|albumShareToken|singleMediaShareAuthority/.test(recruitBranch), "D56 recruit app-message branch must not fall back to another sharing source");
check(/activeAlbumSharePayload\(\)/.test(activeBranch) && !/defaultAlbumShare|recruitInviteToken/.test(activeBranch), "D56 active button must remain isolated from member-default and recruit state");
check(/defaultAlbumSharePayload\(\)/.test(defaultBranch), "D56 member menu app-message must use the default all-photo payload");
check(!/activeAlbumShare|recruitInviteToken|singleMediaShareAuthority/.test(defaultBranch), "D56 member menu app-message must not fall back to active, recruit, or single state");
check(/singleMediaShareFailClosedPayload\(\)/.test(unknownBranch), "D56 unknown sharing buttons must fail closed");
check(/defaultAlbumShareTimelinePayload\(\)/.test(onShareTimeline.source) && !/activeAlbumShareToken/.test(onShareTimeline.source), "D56 member timeline menu must use only the default-all timeline payload");
check(/albumShareToken/.test(onShareTimeline.source), "D56 public timeline mode must retain its routed public token behavior");
check(/defaultAlbumShareToken/.test(showShareMenus.source) && /defaultAlbumShareFriendCoverPrepared/.test(showShareMenus.source) && /defaultAlbumShareTimelineCoverPrepared/.test(showShareMenus.source), "D56 member menus must stay hidden until their default cover channel is ready");
check(!/activeAlbumShareToken|recruitInviteToken|singleMediaShareAuthority/.test(showShareMenus.source), "D56 member menu visibility must not reuse active, recruit, or single state");
check(!/activeAlbumShare|recruitInviteToken|singleMediaShareAuthority/.test(defaultPayload.source), "D56 default payload must fail closed rather than borrowing an active, recruit, or single token");
check(!/defaultAlbumShare/.test(activePayload.source), "D56 active payload must remain button-only and independent of default-all state");

const apiFiles = walk("apps/api/src");
check(!apiFiles.some((file) => /(^|\/)album-share-cover(?:\/|$)/i.test(file)), "D56 must not reintroduce apps/api/src/modules/album-share-cover");
for (const file of apiFiles.filter((candidate) => /\.(?:[cm]?js)$/i.test(candidate))) {
  const source = read(file);
  check(!/album-share-cover/i.test(source), `D56 server source must not reintroduce an album-share-cover service (${file})`);
  check(!/\.composite\s*\(/.test(source), `D56 server source must not compose a share cover with Sharp (${file})`);
  check(
    !/\/api\/(?:session-album\/public-shares?|sessions\/[^/]+\/album\/(?:share|public-share))(?:\/(?!media\/)[^"'`\\\s]*)?\/cover/.test(source),
    `D56 server source must not add an album share-cover route (${file})`
  );
}

const expectedPostcheck = "npm run d54:unit && npm run d54:check && npm run d55:unit && npm run d55:check && npm run d56:unit && npm run d56:check";
check(packageJson.scripts?.["d56:unit"] === "node --test apps/miniprogram/test/albumShareEntry.test.mjs", "D56 package wiring must define the focused d56:unit command");
check(packageJson.scripts?.["d56:check"] === "node scripts/d56-album-share-entry-remap-check.js", "D56 package wiring must define the focused d56:check command");
check(packageJson.scripts?.postcheck === expectedPostcheck, "D56 postcheck must run D54, D55, then D56 unit and static gates in order");

if (failures.length > 0) {
  throw new Error(`D56 album share entry remap check failed:\n- ${failures.join("\n- ")}`);
}

console.log("D56 album share entry remap checks passed");
