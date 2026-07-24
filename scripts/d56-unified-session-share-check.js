import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const servicePath = path.join(root, "apps/api/src/modules/core/service.js");
const helperPath = path.join(root, "apps/miniprogram/src/utils/sessionShare.js");
const sharePath = path.join(root, "apps/miniprogram/src/pages/session/share.vue");
const albumPath = path.join(root, "apps/miniprogram/src/pages/session/album.vue");
const pagesPath = path.join(root, "apps/miniprogram/src/pages.json");
const fixedImagePath = path.join(
  root,
  "apps/miniprogram/src/static/art/photo-claim-share.jpg"
);
const privateConfigPaths = [
  path.join(root, "apps/miniprogram/project.private.config.json"),
  path.join(root, "apps/miniprogram/src/project.private.config.json")
];

const failures = [];

function fail(message) {
  failures.push(message);
}

function read(file) {
  if (!fs.existsSync(file)) {
    fail(`Missing required file: ${path.relative(root, file)}`);
    return "";
  }
  return fs.readFileSync(file, "utf8");
}

function methodBody(source, methodName) {
  const signature = new RegExp(`(?:async\\s+)?${methodName}\\s*\\([^)]*\\)\\s*\\{`, "m");
  const match = signature.exec(source);
  if (!match) {
    return "";
  }
  const start = match.index + match[0].length;
  let depth = 1;
  for (let index = start; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(start, index);
  }
  return "";
}

function hasTrueSkylineRenderEnable(value) {
  if (!value || typeof value !== "object") {
    return false;
  }
  if (value.skylineRenderEnable === true) {
    return true;
  }
  return Object.values(value).some(hasTrueSkylineRenderEnable);
}

const serviceSource = read(servicePath);
if (!/export\s+function\s+sessionHasStarted\s*\(/.test(serviceSource)) {
  fail("API service must export sessionHasStarted");
}
for (const serializerName of ["memberSessionDetail", "publicSessionPreview"]) {
  const serializerSource = methodBody(serviceSource, serializerName);
  if (!serializerSource.includes("has_started: sessionHasStarted(safeSession)")) {
    fail(`${serializerName} must serialize has_started from sessionHasStarted(safeSession)`);
  }
}

const helperSource = read(helperPath);
for (const requiredText of [
  "join: Object.freeze({",
  "claim: Object.freeze({",
  "imageUrl: '/static/art/photo-claim-share.jpg'",
  "typeof session?.has_started === 'boolean'",
  "return session.has_started ? 'claim' : 'join'"
]) {
  if (!helperSource.includes(requiredText)) {
    fail(`Session share helper is missing: ${requiredText}`);
  }
}
const booleanPriorityIndex = helperSource.indexOf("typeof session?.has_started === 'boolean'");
const dateFallbackIndex = helperSource.indexOf("Date.parse(session?.start_at)");
if (
  booleanPriorityIndex < 0 ||
  dateFallbackIndex < 0 ||
  booleanPriorityIndex > dateFallbackIndex
) {
  fail("Session share mode must prioritize the server boolean before the date fallback");
}

const shareSource = read(sharePath);
for (const requiredText of [
  "<RoleSeatBoard",
  'import RoleSeatBoard from "../../components/RoleSeatBoard.vue";',
  "components: { AuthIdentityBar, RoleSeatBoard, FeedbackHost }",
  "resolveSessionShareMode(this.session)",
  "buildSessionSharePayload({",
  "sessionLoaded",
  "shareReady()",
  "if (!this.shareReady || !payload)",
  "invitePrepareError: false"
]) {
  if (!shareSource.includes(requiredText)) {
    fail(`Unified share page is missing: ${requiredText}`);
  }
}
if (!/<button\b[^>]*\bopen-type=["']share["'][^>]*>/.test(shareSource)) {
  fail("Unified share page must use a native open-type=share button");
}
const nativeShareButtonSource =
  shareSource.match(/<button\b[^>]*\bopen-type=["']share["'][^>]*>/)?.[0] || "";
if (!nativeShareButtonSource.includes(':disabled="!shareReady"')) {
  fail("Unified share button must stay disabled until shareReady is authoritative");
}
if (/<t-button\b[^>]*\bopen-type=["']share["']/.test(shareSource)) {
  fail("Unified share page must not use a TDesign open-type=share button");
}
if (
  /(?:data-(?:mode|source)|dataset)[\s\S]{0,120}(?:shareMode|share_mode|claim|join)/i.test(
    shareSource
  )
) {
  fail("Unified share mode must not be selected from route datasets");
}
for (const forbiddenPattern of [
  [/\bcanvas\b|createCanvasContext|canvasToTempFilePath/i, "Canvas"],
  [/\bsnapshot\s*\(|takeSnapshot|screen(?:shot|capture)/i, "snapshot"],
  [/\bposter\b|generatePoster|createPoster/i, "poster"],
  [/\bskyline\b/i, "Skyline"]
]) {
  if (forbiddenPattern[0].test(shareSource)) {
    fail(`Unified share page must not use ${forbiddenPattern[1]}`);
  }
}
const showInviteRetrySource = methodBody(shareSource, "showInviteRetry");
for (const requiredRetryGate of [
  "this.sessionLoaded",
  'this.session.access_scope === "member"',
  "!this.inviteToken",
  "!this.invitePreparing",
  "this.invitePrepareError"
]) {
  if (!showInviteRetrySource.includes(requiredRetryGate)) {
    fail(`Invite retry must be member-only and error-driven: ${requiredRetryGate}`);
  }
}
const shareReadySource = methodBody(shareSource, "shareReady");
const onShareAppMessageSource = methodBody(shareSource, "onShareAppMessage");
if (
  !shareReadySource.includes("this.sessionLoaded") ||
  !shareReadySource.includes("this.inviteToken") ||
  !onShareAppMessageSource.includes("if (!this.shareReady || !payload)")
) {
  fail("Published-session sharing must be gated by loaded session state and a ready payload");
}
const prepareInviteSource = methodBody(shareSource, "prepareJoinInviteToken");
const retryInviteSource = methodBody(shareSource, "retryPrepareInvite");
if (
  !prepareInviteSource.includes("this.invitePrepareError = true") ||
  !retryInviteSource.includes("this.invitePrepareError = false") ||
  !retryInviteSource.includes('this.statusText = ""') ||
  !retryInviteSource.includes("await this.prepareJoinInviteToken()")
) {
  fail("Invite retry must clear stale failure state and only reappear after a new preparation error");
}

const albumSource = read(albumPath);
const claimActionSource =
  [...albumSource.matchAll(/<t-button\b[^>]*>[\s\S]*?<\/t-button>/g)]
    .map((match) => match[0])
    .find((source) => /@tap=["']openClaimShare["']/.test(source)) || "";
if (!claimActionSource.includes("邀请认领")) {
  fail("Album must render the 邀请认领 action through openClaimShare");
} else if (/open-type=["']share["']/.test(claimActionSource)) {
  fail("Album 邀请认领 navigation action must not be an open-type share action");
}
const openClaimShareSource = methodBody(albumSource, "openClaimShare");
if (
  !openClaimShareSource.includes(
    'uni.navigateTo({ url: `/pages/session/share?id=${this.sessionId}&entry=album` });'
  )
) {
  fail("Album 邀请认领 must navigate to the exact unified share route");
}

const pagesSource = read(pagesPath);
let pagesJson = {};
try {
  pagesJson = JSON.parse(pagesSource);
} catch {
  fail("pages.json must contain valid JSON");
}
const shareRouteCount = (pagesJson.pages || []).filter(
  (page) => (typeof page === "string" ? page : page.path) === "pages/session/share"
).length;
if (shareRouteCount !== 1) {
  fail(`pages.json must register pages/session/share exactly once, found ${shareRouteCount}`);
}
if (/skyline/i.test(pagesSource) || hasTrueSkylineRenderEnable(pagesJson)) {
  fail("pages.json must not enable or select Skyline");
}

for (const configPath of privateConfigPaths) {
  if (!fs.existsSync(configPath)) {
    continue;
  }
  try {
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    if (hasTrueSkylineRenderEnable(config)) {
      fail(`${path.relative(root, configPath)} must not enable skylineRenderEnable`);
    }
  } catch {
    fail(`${path.relative(root, configPath)} must contain valid JSON`);
  }
}

if (!fs.existsSync(fixedImagePath)) {
  fail("Fixed claim share image is missing");
} else {
  const imageSize = fs.statSync(fixedImagePath).size;
  if (imageSize <= 0) {
    fail("Fixed claim share image must be nonempty");
  }
  if (imageSize >= 200 * 1024) {
    fail(`Fixed claim share image must remain below 200 KB, found ${imageSize} bytes`);
  }
}

if (failures.length) {
  for (const failure of failures) {
    console.error(`D56 unified session share check failed: ${failure}`);
  }
  process.exitCode = 1;
} else {
  console.log("D56 unified session share check passed");
}
