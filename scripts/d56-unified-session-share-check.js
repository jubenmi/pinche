import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = process.cwd();
const servicePath = path.join(root, "apps/api/src/modules/core/service.js");
const helperPath = path.join(root, "apps/miniprogram/src/utils/sessionShare.js");
const sharePath = path.join(root, "apps/miniprogram/src/pages/session/share.vue");
const albumPath = path.join(root, "apps/miniprogram/src/pages/session/album.vue");
const pagesPath = path.join(root, "apps/miniprogram/src/pages.json");
const miniprogramRoot = path.join(root, "apps/miniprogram");
const fixedImagePath = path.join(
  root,
  "apps/miniprogram/src/static/art/photo-claim-share.jpg"
);
const failures = [];

function blockBodyAfterPattern(source, pattern) {
  const match = pattern.exec(source);
  if (!match) {
    return "";
  }
  const afterMatch = source.slice(match.index + match[0].length);
  const openBraceOffset = afterMatch.match(/^\s*\{/)?.[0].lastIndexOf("{") ?? -1;
  if (openBraceOffset < 0) {
    return "";
  }
  const openBrace = match.index + match[0].length + openBraceOffset;
  let depth = 1;
  for (let index = openBrace + 1; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(openBrace + 1, index);
  }
  return "";
}

export function invitePreparationContractFailures(source) {
  const contractFailures = [];
  const prepareSource = methodBody(source, "prepareJoinInviteToken");
  const retrySource = methodBody(source, "retryPrepareInvite");
  const tryIndex = prepareSource.indexOf("try");
  const prepareBeginSource =
    tryIndex >= 0 ? prepareSource.slice(0, tryIndex) : prepareSource;
  const emptyTokenSource = blockBodyAfterPattern(
    prepareSource,
    /if\s*\(\s*!this\.inviteToken\s*\)/
  );
  const networkCatchSource = blockBodyAfterPattern(
    prepareSource,
    /catch\s*\([^)]*\)/
  );
  const retryAwaitIndex = retrySource.indexOf("await this.prepareJoinInviteToken()");
  const retryBeginSource =
    retryAwaitIndex >= 0 ? retrySource.slice(0, retryAwaitIndex) : retrySource;
  const retrySuccessSource = blockBodyAfterPattern(
    retrySource,
    /if\s*\(\s*this\.inviteToken\s*\)/
  );

  if (!prepareBeginSource.includes("this.invitePrepareError = false")) {
    contractFailures.push("invite preparation begin must clear invitePrepareError");
  }
  if (!emptyTokenSource.includes("this.invitePrepareError = true")) {
    contractFailures.push("empty-token response must set invitePrepareError");
  }
  if (!networkCatchSource.includes("this.invitePrepareError = true")) {
    contractFailures.push("network catch must set invitePrepareError");
  }
  if (
    !retryBeginSource.includes("this.invitePrepareError = false") ||
    !retryBeginSource.includes('this.statusText = ""')
  ) {
    contractFailures.push("retry begin must clear invite failure state");
  }
  if (
    !retrySuccessSource.includes("this.invitePrepareError = false") ||
    !retrySuccessSource.includes('this.statusText = ""')
  ) {
    contractFailures.push("successful retry must clear invite failure state");
  }
  return contractFailures;
}

const JPEG_SOF_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3,
  0xc5, 0xc6, 0xc7,
  0xc9, 0xca, 0xcb,
  0xcd, 0xce, 0xcf
]);

export function jpegDimensions(input) {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input || []);
  if (
    buffer.length < 4 ||
    buffer[0] !== 0xff ||
    buffer[1] !== 0xd8
  ) {
    return null;
  }

  let offset = 2;
  while (offset < buffer.length) {
    if (buffer[offset] !== 0xff) {
      return null;
    }
    while (offset < buffer.length && buffer[offset] === 0xff) {
      offset += 1;
    }
    if (offset >= buffer.length) {
      return null;
    }

    const marker = buffer[offset];
    offset += 1;
    if (marker === 0xd9 || marker === 0xda) {
      return null;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      continue;
    }
    if (offset + 2 > buffer.length) {
      return null;
    }

    const segmentLength = buffer.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > buffer.length) {
      return null;
    }
    if (JPEG_SOF_MARKERS.has(marker)) {
      if (segmentLength < 7) {
        return null;
      }
      const height = buffer.readUInt16BE(offset + 3);
      const width = buffer.readUInt16BE(offset + 5);
      return width > 0 && height > 0 ? { width, height } : null;
    }
    offset += segmentLength;
  }
  return null;
}

export function fixedClaimImageFailures(buffer, maxBytes = 200 * 1024) {
  const imageFailures = [];
  if (!buffer?.length) {
    imageFailures.push("fixed claim share image must be nonempty");
    return imageFailures;
  }
  if (buffer.length >= maxBytes) {
    imageFailures.push(
      `fixed claim share image must remain below 200 KB, found ${buffer.length} bytes`
    );
  }
  const dimensions = jpegDimensions(buffer);
  if (!dimensions) {
    imageFailures.push("fixed claim share image must be a valid JPEG with SOF dimensions");
    return imageFailures;
  }
  if (dimensions.width * 4 !== dimensions.height * 5) {
    imageFailures.push(
      `fixed claim share image must keep a 5:4 ratio, found ${dimensions.width}x${dimensions.height}`
    );
  } else if (dimensions.width !== 560 || dimensions.height !== 448) {
    imageFailures.push(
      `fixed claim share image must be exactly 560x448, found ${dimensions.width}x${dimensions.height}`
    );
  }
  return imageFailures;
}

export function pagesUseSkylineRenderer(pagesJson) {
  if (Array.isArray(pagesJson)) {
    return pagesJson.some(pagesUseSkylineRenderer);
  }
  if (!pagesJson || typeof pagesJson !== "object") {
    return false;
  }
  return Object.entries(pagesJson).some(([key, value]) => {
    if (
      key === "renderer" &&
      typeof value === "string" &&
      value.trim().toLowerCase() === "skyline"
    ) {
      return true;
    }
    if (key === "skylineRenderEnable" && value === true) {
      return true;
    }
    return pagesUseSkylineRenderer(value);
  });
}

export function sourceUsesSkylineRenderer(source = "") {
  return (
    /(?:^|[,{;\s])renderer\s*[:=]\s*["'`]skyline["'`]/im.test(source) ||
    /(?:^|[,{;\s])skylineRenderEnable\s*[:=]\s*true\b/im.test(source)
  );
}

export function skylineFileFailures(files = []) {
  const skylineFailures = [];
  for (const file of files) {
    const filePath = String(file?.path || "");
    const source = String(file?.source || "");
    if (path.extname(filePath).toLowerCase() === ".json") {
      try {
        if (pagesUseSkylineRenderer(JSON.parse(source))) {
          skylineFailures.push(`${filePath} must not enable the Skyline renderer`);
        }
      } catch {
        skylineFailures.push(`${filePath} must contain valid JSON`);
      }
      continue;
    }
    if (sourceUsesSkylineRenderer(source)) {
      skylineFailures.push(`${filePath} must not enable the Skyline renderer`);
    }
  }
  return skylineFailures;
}

function relevantMiniprogramFiles(directory = miniprogramRoot) {
  const ignoredDirectories = new Set(["node_modules", "dist", "unpackage", "test"]);
  const relevantExtensions = new Set([".json", ".js", ".mjs", ".cjs", ".ts", ".vue"]);
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name.startsWith(".") && entry.isDirectory()) {
      continue;
    }
    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name)) {
        files.push(...relevantMiniprogramFiles(path.join(directory, entry.name)));
      }
      continue;
    }
    if (entry.isFile() && relevantExtensions.has(path.extname(entry.name).toLowerCase())) {
      files.push(path.join(directory, entry.name));
    }
  }
  return files.sort();
}

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

export function runD56Check() {
failures.length = 0;
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
  [/\bposter\b|generatePoster|createPoster/i, "poster"]
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
for (const contractFailure of invitePreparationContractFailures(shareSource)) {
  fail(`Invite retry contract: ${contractFailure}`);
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
if (pagesUseSkylineRenderer(pagesJson)) {
  fail("pages.json must not select the Skyline renderer or enable Skyline rendering");
}

const skylineFiles = relevantMiniprogramFiles().map((filePath) => ({
  path: path.relative(root, filePath),
  source: fs.readFileSync(filePath, "utf8")
}));
for (const skylineFailure of skylineFileFailures(skylineFiles)) {
  fail(skylineFailure);
}

if (!fs.existsSync(fixedImagePath)) {
  fail("Fixed claim share image is missing");
} else {
  const imageBuffer = fs.readFileSync(fixedImagePath);
  for (const imageFailure of fixedClaimImageFailures(imageBuffer)) {
    fail(imageFailure);
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
return [...failures];
}

const directEntryPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (directEntryPath === fileURLToPath(import.meta.url)) {
  runD56Check();
}
