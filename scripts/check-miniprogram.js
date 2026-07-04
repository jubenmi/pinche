import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const miniprogramRoot = path.join(root, "apps/miniprogram");
const srcRoot = path.join(miniprogramRoot, "src");
const pagesJsonPath = path.join(srcRoot, "pages.json");
const manifestJsonPath = path.join(srcRoot, "manifest.json");
const miniprogramProjectConfigPath = path.join(miniprogramRoot, "project.config.json");
const miniprogramPrivateProjectConfigPath = path.join(
  miniprogramRoot,
  "project.private.config.json"
);
const srcProjectConfigPath = path.join(srcRoot, "project.config.json");
const viteConfigPath = path.join(miniprogramRoot, "vite.config.js");
const miniprogramDevEnvPath = path.join(miniprogramRoot, ".env.development");
const miniprogramProdEnvPath = path.join(miniprogramRoot, ".env.production");
const miniprogramDevRoot = path.join(miniprogramRoot, "dist/dev/mp-weixin");
const miniprogramBuildRoot = path.join(miniprogramRoot, "dist/build/mp-weixin");
const codexHooksPath = path.join(root, ".codex/hooks.json");
const devtoolsHookPath = path.join(root, "scripts/devtools-refresh-hook.js");
const productionApiBaseUrl = "https://api.pinche.jubenmi.com";
const productionWechatAppId = "wx2675a606d3bd242c";
const mainPackageLimitBytes = Math.floor(1.5 * 1024 * 1024);
const localMediaLimitBytes = 200 * 1024;
const localFontLimitBytes = 200 * 1024;
const localMediaPattern = /\.(?:png|jpe?g|gif|webp|mp3|m4a|aac|wav|mp4|mov)$/i;
const localFontPattern = /\.(?:ttf|otf|woff2?|eot)$/i;
const brandFontPath = "static/fonts/pinche-brand.ttf";

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

function walkFiles(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? walkFiles(file) : [file];
  });
}

function formatSize(bytes) {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function relativePath(file) {
  return path.relative(root, file);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function readEnv(file) {
  const values = {};
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const separator = trimmed.indexOf("=");
    if (separator === -1) {
      continue;
    }
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim().replace(/^["']|["']$/g, "");
    values[key] = value;
  }
  return values;
}

function methodBody(source, name) {
  const patterns = [
    new RegExp(`async\\s+function\\s+${name}\\s*\\([^)]*\\)\\s*\\{`),
    new RegExp(`function\\s+${name}\\s*\\([^)]*\\)\\s*\\{`),
    new RegExp(`async\\s+${name}\\s*\\([^)]*\\)\\s*\\{`),
    new RegExp(`${name}\\s*\\([^)]*\\)\\s*\\{`)
  ];
  for (const pattern of patterns) {
    const match = source.match(pattern);
    if (!match || match.index === undefined) {
      continue;
    }
    const start = match.index + match[0].length;
    let depth = 1;
    for (let i = start; i < source.length; i += 1) {
      if (source[i] === "{") {
        depth += 1;
      } else if (source[i] === "}") {
        depth -= 1;
      }
      if (depth === 0) {
        return source.slice(start, i);
      }
    }
  }
  return "";
}

function callbackObjectBody(source, name) {
  const pattern = new RegExp(`${name}\\s*\\(\\s*\\(\\)\\s*=>\\s*\\(\\{([\\s\\S]*?)\\}\\)\\s*\\)`);
  return source.match(pattern)?.[1] || "";
}

function assertBefore(source, first, second, message) {
  const firstIndex = source.indexOf(first);
  const secondIndex = source.indexOf(second);
  if (firstIndex === -1 || secondIndex === -1 || firstIndex > secondIndex) {
    fail(message);
  }
}

function builtMainPackageSize(buildRoot) {
  const appJsonPath = path.join(buildRoot, "app.json");
  const appJson = fs.existsSync(appJsonPath) ? readJson(appJsonPath) : {};
  const subpackages = appJson.subPackages || appJson.subpackages || [];
  const subpackageRoots = subpackages
    .map((subpackage) => subpackage.root)
    .filter(Boolean)
    .map((subpackageRoot) => subpackageRoot.replace(/^\/+|\/+$/g, ""))
    .filter(Boolean);

  return walkFiles(buildRoot).reduce((total, file) => {
    const relative = path.relative(buildRoot, file).replaceAll(path.sep, "/");
    const isSubpackageFile = subpackageRoots.some(
      (subpackageRoot) => relative === subpackageRoot || relative.startsWith(`${subpackageRoot}/`)
    );
    return isSubpackageFile ? total : total + fs.statSync(file).size;
  }, 0);
}

function assertMinifiedEnabled(file, setting) {
  if (setting?.minified !== true) {
    fail(`${relativePath(file)} must enable setting.minified for WeChat JS compression`);
  }
}

function isDevelopmentApiBaseUrl(value) {
  return value === productionApiBaseUrl;
}

function assertMediaAssetsUnderLimit(rootDir, label, { skipDist = false } = {}) {
  if (!fs.existsSync(rootDir)) {
    return;
  }
  for (const file of walkFiles(rootDir)) {
    const relative = path.relative(rootDir, file).replaceAll(path.sep, "/");
    if (skipDist && relative.startsWith("dist/")) {
      continue;
    }
    if (!localMediaPattern.test(file)) {
      continue;
    }
    const size = fs.statSync(file).size;
    if (size > localMediaLimitBytes) {
      fail(`${label} media asset exceeds 200 KB: ${relativePath(file)} (${formatSize(size)})`);
    }
  }
}

function assertFontAssetsUnderLimit(rootDir, label, { skipDist = false } = {}) {
  if (!fs.existsSync(rootDir)) {
    return;
  }
  for (const file of walkFiles(rootDir)) {
    const relative = path.relative(rootDir, file).replaceAll(path.sep, "/");
    if (skipDist && relative.startsWith("dist/")) {
      continue;
    }
    if (!localFontPattern.test(file)) {
      continue;
    }
    const size = fs.statSync(file).size;
    if (size > localFontLimitBytes) {
      fail(`${label} font asset exceeds 200 KB: ${relativePath(file)} (${formatSize(size)})`);
    }
  }
}

function assertBrandFontAsset(rootDir, label) {
  if (!fs.existsSync(rootDir)) {
    return;
  }
  const fontPath = path.join(rootDir, brandFontPath);
  if (!fs.existsSync(fontPath)) {
    fail(`${label} must include brand font asset: ${path.relative(root, fontPath)}`);
  }
}

function assertNoWebpAssets(rootDir, label) {
  if (!fs.existsSync(rootDir)) {
    return;
  }
  for (const file of walkFiles(rootDir)) {
    if (/\.webp$/i.test(file)) {
      fail(`${label} must use JPG/PNG instead of WebP for Mini Program device compatibility: ${relativePath(file)}`);
    }
  }
}

function assertNoWebpStaticReferences(rootDir) {
  if (!fs.existsSync(rootDir)) {
    return;
  }
  const sourcePattern = /\.(?:vue|js|ts|json|css|scss|wxss|wxml)$/i;
  for (const file of walkFiles(rootDir)) {
    if (!sourcePattern.test(file)) {
      continue;
    }
    const source = fs.readFileSync(file, "utf8");
    if (/\/static\/[^"'`\s?]+\.webp/i.test(source)) {
      fail(`Source must reference JPG/PNG static assets instead of WebP: ${relativePath(file)}`);
    }
  }
}

function assertNoDcloudPreloadImageCode(rootDir, label) {
  if (!fs.existsSync(rootDir)) {
    return;
  }
  for (const file of walkFiles(rootDir)) {
    if (!/\.js$/i.test(file)) {
      continue;
    }
    const source = fs.readFileSync(file, "utf8");
    if (
      source.includes("shadow-grey.png") ||
      source.includes("__UNI_PRELOAD_SHADOW_IMAGE__") ||
      source.includes("wx.preloadAssets")
    ) {
      fail(`${label} must not include DCloud preload image code: ${relativePath(file)}`);
    }
  }
}

if (!fs.existsSync(pagesJsonPath)) {
  fail("apps/miniprogram/src/pages.json is missing");
} else {
  let manifestJson = null;
  if (fs.existsSync(miniprogramProjectConfigPath)) {
    const projectConfig = readJson(miniprogramProjectConfigPath);
    assertMinifiedEnabled(miniprogramProjectConfigPath, projectConfig.setting);
    if (projectConfig.appid !== productionWechatAppId) {
      fail(`Miniprogram project.config.json must use appid ${productionWechatAppId}`);
    }
  }
  if (fs.existsSync(miniprogramPrivateProjectConfigPath)) {
    const privateProjectConfig = readJson(miniprogramPrivateProjectConfigPath);
    if (privateProjectConfig.appid && privateProjectConfig.appid !== productionWechatAppId) {
      fail("Miniprogram project.private.config.json must not override appid");
    }
  }
  if (fs.existsSync(srcProjectConfigPath)) {
    const srcProjectConfig = readJson(srcProjectConfigPath);
    assertMinifiedEnabled(srcProjectConfigPath, srcProjectConfig.setting);
    if (srcProjectConfig.appid !== productionWechatAppId) {
      fail(`Miniprogram src/project.config.json must use appid ${productionWechatAppId}`);
    }
  }
  if (fs.existsSync(manifestJsonPath)) {
    manifestJson = readJson(manifestJsonPath);
    assertMinifiedEnabled(manifestJsonPath, manifestJson["mp-weixin"]?.setting);
    if (manifestJson["mp-weixin"]?.appid !== productionWechatAppId) {
      fail(`Miniprogram manifest must use appid ${productionWechatAppId}`);
    }
  }

  const pagesJson = readJson(pagesJsonPath);
  const pages = pagesJson.pages || [];

  if (manifestJson?.["mp-weixin"]?.lazyCodeLoading !== "requiredComponents") {
    fail('Miniprogram manifest must enable lazyCodeLoading: "requiredComponents" for component lazy injection');
  }

  assertMediaAssetsUnderLimit(miniprogramRoot, "Miniprogram project", { skipDist: true });
  assertMediaAssetsUnderLimit(miniprogramDevRoot, "Dev package");
  assertMediaAssetsUnderLimit(miniprogramBuildRoot, "Build package");
  assertFontAssetsUnderLimit(miniprogramRoot, "Miniprogram project", { skipDist: true });
  assertFontAssetsUnderLimit(miniprogramDevRoot, "Dev package");
  assertFontAssetsUnderLimit(miniprogramBuildRoot, "Build package");
  assertBrandFontAsset(srcRoot, "Miniprogram source");
  assertBrandFontAsset(miniprogramDevRoot, "Dev package");
  assertBrandFontAsset(miniprogramBuildRoot, "Build package");
  assertNoWebpAssets(path.join(srcRoot, "static"), "Miniprogram static assets");
  assertNoWebpStaticReferences(srcRoot);
  assertNoWebpAssets(miniprogramDevRoot, "Dev package");
  assertNoWebpAssets(miniprogramBuildRoot, "Build package");
  assertNoWebpStaticReferences(miniprogramDevRoot);
  assertNoWebpStaticReferences(miniprogramBuildRoot);
  assertNoDcloudPreloadImageCode(miniprogramDevRoot, "Dev package");
  assertNoDcloudPreloadImageCode(miniprogramBuildRoot, "Build package");

  if (fs.existsSync(miniprogramBuildRoot)) {
    const builtAppJsonPath = path.join(miniprogramBuildRoot, "app.json");
    if (fs.existsSync(builtAppJsonPath)) {
      const builtAppJson = readJson(builtAppJsonPath);
      if (builtAppJson.lazyCodeLoading !== "requiredComponents") {
        fail('Built app.json must include lazyCodeLoading: "requiredComponents"');
      }
    }

    const mainPackageSize = builtMainPackageSize(miniprogramBuildRoot);
    if (mainPackageSize > mainPackageLimitBytes) {
      fail(
        `Built main package exceeds 1.5 MB: ${formatSize(mainPackageSize)} in ${relativePath(miniprogramBuildRoot)}`
      );
    }
  }

  for (const page of pages) {
    const pagePath = typeof page === "string" ? page : page.path;
    const file = path.join(srcRoot, `${pagePath}.vue`);
    if (!fs.existsSync(file)) {
      fail(`Missing UniApp page file: ${file}`);
    }
  }

  for (const required of ["App.vue", "main.js", "manifest.json"]) {
    const file = path.join(srcRoot, required);
    if (!fs.existsSync(file)) {
      fail(`Missing UniApp source file: ${file}`);
    }
  }

  const pagePaths = pages.map((page) => (typeof page === "string" ? page : page.path));
  const firstFlowPages = [
    "pages/index/index",
    "pages/mine/index",
    "pages/session/create",
    "pages/session/script",
    "pages/session/role",
    "pages/session/setup",
    "pages/session/share"
  ];

  for (const firstFlowPage of firstFlowPages) {
    if (!pagePaths.includes(firstFlowPage)) {
      fail(`First creation flow page is not registered: ${firstFlowPage}`);
    }
  }
  if (pagePaths.includes("pages/session/apply")) {
    fail("Apply page must not be registered because the share page is the final role-selection page");
  }
  if (fs.existsSync(path.join(srcRoot, "pages/session/apply.vue"))) {
    fail("Apply page file should be removed because the share page is the final role-selection page");
  }

  const firstFlowFiles = {
    "entry page": path.join(srcRoot, "pages/index/index.vue"),
    "store step": path.join(srcRoot, "pages/session/create.vue"),
    "script step": path.join(srcRoot, "pages/session/script.vue"),
    "role step": path.join(srcRoot, "pages/session/role.vue"),
    "setup step": path.join(srcRoot, "pages/session/setup.vue"),
    "share step": path.join(srcRoot, "pages/session/share.vue")
  };

  for (const [label, file] of Object.entries(firstFlowFiles)) {
    if (!fs.existsSync(file)) {
      fail(`Missing first creation flow ${label}: ${file}`);
    }
  }

  const indexSource = fs.existsSync(firstFlowFiles["entry page"])
    ? fs.readFileSync(firstFlowFiles["entry page"], "utf8")
    : "";
  for (const requiredHomeEntryText of ["发起第一辆车", "开始发车", "我的车局", "发车"]) {
    if (!indexSource.includes(requiredHomeEntryText)) {
      fail(`Entry page must support D22 home entry routing UI: ${requiredHomeEntryText}`);
    }
  }
  for (const requiredHomeRoutingText of [
    "SessionCalendar",
    "ensureLoggedIn",
    "getCurrentUser",
    "getToken",
    "loadHomeCalendar",
    "/api/users/me/sessions?limit=50",
    "/api/users/me/signups",
    "homeState",
    "first-session",
    "calendar"
  ]) {
    if (!indexSource.includes(requiredHomeRoutingText)) {
      fail(`Entry page must support D22 home entry routing behavior: ${requiredHomeRoutingText}`);
    }
  }
  for (const requiredMaintenanceText of [
    "backendStatus.maintenance",
    "服务正在上线维护中",
    "我们正在准备后端服务，稍后会自动恢复。",
    "retryBackend",
    "startMaintenancePolling",
    "stopMaintenancePolling",
    "BACKEND_STATUS_CHANGE_EVENT",
    "checkBackendHealth"
  ]) {
    if (!indexSource.includes(requiredMaintenanceText)) {
      fail(`Entry page maintenance mode is missing ${requiredMaintenanceText}`);
    }
  }
  if (!/<view v-if="backendStatus\.maintenance" class="maintenance-state">/.test(indexSource)) {
    fail("Entry page must render a dedicated maintenance state before normal homepage content");
  }
  if (!/<view v-else class="home-normal">/.test(indexSource)) {
    fail("Entry page must hide normal homepage content while maintenance mode is active");
  }
  if (!indexSource.includes("buildVersion") || !indexSource.includes("__PINCHE_BUILD_TIME__")) {
    fail("Entry page must display the injected build-time version label");
  }
  if (!/<view class="build-version">\{\{ buildVersion \}\}<\/view>/.test(indexSource)) {
    fail("Entry page must render the build-time version label on the first screen");
  }
  if (!indexSource.includes('menus: ["shareAppMessage", "shareTimeline"]')) {
    fail("Entry page share menu must enable both friend/group and Moments sharing");
  }
  if (!indexSource.includes("showHomeShareMenus")) {
    fail("Entry page must enable the WeChat share menu when it loads or becomes visible");
  }
  const homeShareAppMessageSource = callbackObjectBody(indexSource, "onShareAppMessage");
  if (!homeShareAppMessageSource) {
    fail("Entry page must support friend/group sharing with onShareAppMessage");
  }
  if (!homeShareAppMessageSource.includes("path: HOME_SHARE_PATH")) {
    fail("Entry page friend/group sharing must open the home page path");
  }
  if (!homeShareAppMessageSource.includes("imageUrl: HOME_SHARE_IMAGE")) {
    fail("Entry page friend/group sharing must use the home landscape share image");
  }
  const homeShareTimelineSource = callbackObjectBody(indexSource, "onShareTimeline");
  if (!homeShareTimelineSource) {
    fail("Entry page must support WeChat Moments sharing with onShareTimeline");
  }
  if (!homeShareTimelineSource.includes('query: ""')) {
    fail("Entry page Moments sharing must return an empty home-page query");
  }
  if (homeShareTimelineSource.includes("path:")) {
    fail("Entry page Moments sharing must use query instead of path");
  }
  if (!homeShareTimelineSource.includes("imageUrl: HOME_SHARE_IMAGE")) {
    fail("Entry page Moments sharing must use the home landscape share image");
  }
  const maintenanceArtPath = path.join(srcRoot, "static/art/maintenance-landscape.jpg");
  if (!fs.existsSync(maintenanceArtPath)) {
    fail("Entry page maintenance state must have a dedicated complete art asset: static/art/maintenance-landscape.jpg");
  }
  if (!indexSource.includes('/static/art/maintenance-landscape.jpg')) {
    fail("Entry page maintenance state must use the dedicated maintenance landscape art asset");
  }
  if (/class="maintenance-art"\s+src="\/static\/art\/ticket-landscape\.(?:webp|jpe?g|png)"/.test(indexSource)) {
    fail("Entry page maintenance state must not reuse the ticket footer landscape art asset");
  }
  if (!indexSource.includes("<AuthIdentityBar passive-guest")) {
    fail("Entry page identity bar must stay in passive guest mode before users choose login");
  }
  if (!indexSource.includes('@guest-login="loginFromGuestBar"')) {
    fail("Entry page passive guest identity bar must allow users to login from the bar");
  }
  if (!/\.home-panel\s*\{[\s\S]*width:\s*420rpx;[\s\S]*margin:\s*0 auto;/.test(indexSource)) {
    fail("Entry page must keep the first-session action stack aligned to one fixed width");
  }
  if (!/\.primary-action\s*\{[\s\S]*width:\s*100%;[\s\S]*margin:\s*0;[\s\S]*box-sizing:\s*border-box;/.test(indexSource)) {
    fail("Entry page first-session action button must keep one full-width button box model");
  }
  const startFirstSessionSource = methodBody(indexSource, "startFirstSession");
  if (!startFirstSessionSource.includes("ensureLoggedIn")) {
    fail("Entry page first-session button must request login before starting the first car");
  }
  if (!startFirstSessionSource.includes("loadHomeCalendar")) {
    fail("Entry page first-session button must reload my sessions after login before deciding where to go");
  }
  assertBefore(
    startFirstSessionSource,
    "loadHomeCalendar",
    "goCreate",
    "Entry page first-session button must reload my sessions before entering creation"
  );
  const loginFromGuestBarSource = methodBody(indexSource, "loginFromGuestBar");
  if (!loginFromGuestBarSource.includes("ensureLoggedIn")) {
    fail("Entry page passive guest identity bar must request login when tapped");
  }
  if (!loginFromGuestBarSource.includes("loadHomeCalendar")) {
    fail("Entry page passive guest identity bar must reload my sessions after login");
  }
  if (loginFromGuestBarSource.includes("goCreate")) {
    fail("Entry page passive guest identity bar must login without entering creation directly");
  }
  const goCreateSource = methodBody(indexSource, "goCreate");
  assertBefore(
    goCreateSource,
    "clearCreateFlow",
    "uni.navigateTo",
    "Entry page calendar 发车 button must start a fresh create flow before navigating"
  );
  const indexLogoutSource = methodBody(indexSource, "logout");
  if (!indexLogoutSource.includes("goHomeAfterLogout")) {
    fail("Entry page logout must relaunch the home entry after clearing auth");
  }

  const mineSource = fs.existsSync(path.join(srcRoot, "pages/mine/index.vue"))
    ? fs.readFileSync(path.join(srcRoot, "pages/mine/index.vue"), "utf8")
    : "";
  const sessionCalendarPath = path.join(srcRoot, "components/SessionCalendar.vue");
  if (!fs.existsSync(sessionCalendarPath)) {
    fail("D22 must extract the shared session calendar component: components/SessionCalendar.vue");
  }
  const sessionCalendarSource = fs.existsSync(sessionCalendarPath)
    ? fs.readFileSync(sessionCalendarPath, "utf8")
    : "";
  if (
    !sessionCalendarSource.includes('v-if="item.canManage"') ||
    !sessionCalendarSource.includes('@tap.stop="goManage(item.sessionId)"') ||
    !sessionCalendarSource.includes(">管理</button>")
  ) {
    fail("Session calendar cards must expose a direct management button when the user can manage the session");
  }
  if (!sessionCalendarSource.includes("item.canManage = item.isOrganized")) {
    fail("Session calendar management button must only appear for sessions the user organizes");
  }
  for (const requiredCalendarStripeText of [
    ':class="item.stripeTone"',
    "calendarStripeTone",
    ".session-stripe.amber",
    ".session-stripe.green",
    ".session-stripe.red",
    "return \"green\"",
    "return \"amber\"",
    "return \"red\""
  ]) {
    if (!sessionCalendarSource.includes(requiredCalendarStripeText)) {
      fail(`Session calendar stripe must use traffic-light session status colors: ${requiredCalendarStripeText}`);
    }
  }
  if (sessionCalendarSource.includes(".session-row.joined .session-stripe")) {
    fail("Session calendar stripe must represent car state, not joined/organized identity");
  }
  if (!mineSource.includes("SessionCalendar")) {
    fail("Mine page must reuse the shared SessionCalendar component");
  }
  if (/onLoad\s*\(\s*async\s*\(\)\s*=>\s*\{[\s\S]*ensureLoggedIn\s*\(/.test(mineSource)) {
    fail("Mine page must wait for an explicit login tap before requesting login");
  }
  if (!mineSource.includes("getToken")) {
    fail("Mine page must include token state when deciding whether to load private sessions");
  }
  if (/hasLogin\.value\s*=\s*Boolean\(\s*auth\.user\s*\)/.test(mineSource)) {
    fail("Mine page must not treat cached user data without token as a logged-in session");
  }
  const mineLoginSource = methodBody(mineSource, "login");
  if (mineLoginSource.includes("promptPhoneAfterLogin: true")) {
    fail("Mine page login must not request phone authorization before a protected action");
  }
  const mineLogoutSource = methodBody(mineSource, "logout");
  if (!mineLogoutSource.includes("goHomeAfterLogout")) {
    fail("Mine page logout must relaunch the home entry after clearing auth");
  }

  const createSource = fs.existsSync(firstFlowFiles["store step"])
    ? fs.readFileSync(firstFlowFiles["store step"], "utf8")
    : "";
  for (const forbiddenText of [
    "补贴",
    "押金",
    "座位与实付",
    "补充资料申请",
    "发布车"
  ]) {
    if (createSource.includes(forbiddenText)) {
      fail(`Store selection step still contains unrelated creation responsibility: ${forbiddenText}`);
    }
  }
  if (
    !/selectStore\(store\)\s*\{[\s\S]*this\.isSelectedStore\(store\)[\s\S]*this\.goNext\(\);[\s\S]*return;[\s\S]*writeCreateFlow\(\{ store, script: null, role: null \}\);/.test(createSource)
  ) {
    fail("Store selection should confirm and continue when tapping the selected store again");
  }
  const selectStoreSource = methodBody(createSource, "selectStore");
  const createGoNextSource = methodBody(createSource, "goNext");
  if (createSource.includes("ensureCreateStepLogin") || selectStoreSource.includes("ensureLoggedIn")) {
    fail("Store selection must be browsable before login");
  }
  if (createGoNextSource.includes("ensureLoggedIn")) {
    fail("Store next button must let users continue browsing before login");
  }

  const scriptSource = fs.existsSync(firstFlowFiles["script step"])
    ? fs.readFileSync(firstFlowFiles["script step"], "utf8")
    : "";
  if (
    !/selectScript\(script\)\s*\{[\s\S]*this\.isSelectedScript\(script\)[\s\S]*this\.goNext\(\);[\s\S]*return;[\s\S]*writeCreateFlow\(\{ script, role: null \}\);/.test(scriptSource)
  ) {
    fail("Script selection should confirm and continue when tapping the selected script again");
  }
  const selectScriptSource = methodBody(scriptSource, "selectScript");
  const scriptGoNextSource = methodBody(scriptSource, "goNext");
  if (scriptSource.includes("ensureScriptStepLogin") || selectScriptSource.includes("ensureLoggedIn")) {
    fail("Script selection must be browsable before login");
  }
  if (scriptGoNextSource.includes("ensureLoggedIn")) {
    fail("Script next button must let users continue browsing before login");
  }

  const shareSource = fs.existsSync(firstFlowFiles["share step"])
    ? fs.readFileSync(firstFlowFiles["share step"], "utf8")
    : "";
  const sharedRoleSeatBoardSourceForShare = fs.existsSync(
    path.join(srcRoot, "components/RoleSeatBoard.vue")
  )
    ? fs.readFileSync(path.join(srcRoot, "components/RoleSeatBoard.vue"), "utf8")
    : "";
  for (const requiredShareText of ["角色状态", "可选", "我选", "已选", "换选"]) {
    if (!shareSource.includes(requiredShareText)) {
      fail(`Share page must let invited players inspect and choose open roles: ${requiredShareText}`);
    }
  }
  if (shareSource.includes('class="button role-action"') || shareSource.includes("role-action")) {
    fail("Share page must not render a separate confirm role button; tapping a role card should act directly");
  }
  if (shareSource.includes(">确认选择<") || shareSource.includes('"确认选择"')) {
    fail("Share page must not show legacy confirm selection copy");
  }
  for (const requiredSwitchingText of [
    "switchingCount",
    'stateKind === "switching"',
    ".role-choice.switching"
  ]) {
    const switchingSource = requiredSwitchingText.startsWith(".role-choice")
      ? sharedRoleSeatBoardSourceForShare
      : shareSource;
    if (!switchingSource.includes(requiredSwitchingText)) {
      fail(`Share page must distinguish switching roles from current roles: ${requiredSwitchingText}`);
    }
  }
  const shareButtonCount = (shareSource.match(/open-type="share"/g) || []).length;
  if (shareButtonCount !== 1) {
    fail(`Share page must keep a single share button, found ${shareButtonCount}`);
  }
  if (!shareSource.includes("分享给好友或群聊")) {
    fail("Share page must use one combined friend/group share button");
  }
  const shareTimelineSource = methodBody(shareSource, "onShareTimeline");
  if (!shareTimelineSource) {
    fail("Share page must support WeChat Moments sharing with onShareTimeline");
  }
  if (!shareTimelineSource.includes("query:")) {
    fail("Share page Moments sharing must return a query for the current share page route");
  }
  if (!shareTimelineSource.includes("title: this.timelineShareTitle()")) {
    fail("Share page Moments sharing must use a dedicated attractive timeline title");
  }
  const shareAppMessageSource = methodBody(shareSource, "onShareAppMessage");
  if (!shareAppMessageSource.includes("title: this.shareCardTitle()")) {
    fail("Share page friend/group sharing must use the shared session title with script, store, and time");
  }
  const shareCardTitleSource = methodBody(shareSource, "shareCardTitle");
  if (
    !shareCardTitleSource.includes("this.scriptName") ||
    !shareCardTitleSource.includes("this.storeName") ||
    !shareCardTitleSource.includes("this.startText")
  ) {
    fail("Share page title copy must include script name, store, and time");
  }
  const timelineShareTitleSource = methodBody(shareSource, "timelineShareTitle");
  if (
    !timelineShareTitleSource.includes("this.scriptName") ||
    !timelineShareTitleSource.includes("this.storeName") ||
    !timelineShareTitleSource.includes("this.startText")
  ) {
    fail("Share page Moments copy must include script name, store, and time");
  }
  if (!shareSource.includes("timelineShareTitle")) {
    fail("Share page must keep Moments copy separate from friend/group share copy");
  }
  if (!shareSource.includes("还差") || !shareSource.includes("沉浸一局")) {
    fail("Share page Moments copy must read like an inviting carpool pitch");
  }
  if (shareTimelineSource.includes("path:")) {
    fail("Share page Moments sharing must use query instead of path");
  }
  if (!shareSource.includes('menus: ["shareAppMessage", "shareTimeline"]')) {
    fail("Share page share menu must enable both friend/group and Moments sharing");
  }
  for (const requiredFinalShareText of ["claimSeat", "/api/signups", "loadPublishedSession"]) {
    if (!shareSource.includes(requiredFinalShareText)) {
      fail(`Share page must be the final role-selection page: ${requiredFinalShareText}`);
    }
  }
  for (const requiredAlbumEntryText of [
    "entry",
    "isAlbumEntry",
    "redirectAlbumMemberIfNeeded",
    "/pages/session/album?id=",
    "join_policy",
    "/api/session-seats/${seatId}/claim",
    "join_result",
    "已提交申请，等待车头审核"
  ]) {
    if (!shareSource.includes(requiredAlbumEntryText)) {
      fail(`Share page must support D23 album-entry join flow: ${requiredAlbumEntryText}`);
    }
  }
  const claimSeatSource = methodBody(shareSource, "claimSeat");
  if (!claimSeatSource.includes('this.session.join_policy === "direct"')) {
    fail("Share page album entry must branch direct join by session.join_policy");
  }
  assertBefore(
    claimSeatSource,
    'this.session.join_policy === "direct"',
    'url: "/api/signups"',
    "Share page must try direct claim before falling back to review signup"
  );
  if (/onLoad\s*\(\s*options\s*\)\s*\{\s*const auth = await ensureLoggedIn\s*\(/.test(shareSource)) {
    fail("Share page must let invited users browse before login");
  }
  if (!/async confirmRole\(\)\s*\{[\s\S]*ensureSeatSelectionLogin\s*\(/.test(shareSource)) {
    fail("Share page must require login before applying a role selection");
  }
  const shareChooseRoleSource = methodBody(shareSource, "chooseRole");
  const shareConfirmRoleSource = methodBody(shareSource, "confirmRole");
  const shareOnLoadSource = methodBody(shareSource, "onLoad");
  const refreshCurrentUserGenderSource = methodBody(shareSource, "refreshCurrentUserGender");
  const clearSeatSelectionWhenLoggedOutSource = methodBody(shareSource, "clearSeatSelectionWhenLoggedOut");
  if (!shareSource.includes("clearSeatSelectionWhenLoggedOut")) {
    fail("Share page must clear pending role selection when the user is logged out");
  }
  if (!refreshCurrentUserGenderSource.includes("clearSeatSelectionWhenLoggedOut")) {
    fail("Share page auth refresh must clear pending role selection when logged out");
  }
  if (!clearSeatSelectionWhenLoggedOutSource.includes("this.pendingRole = null")) {
    fail("Share page logged-out cleanup must clear pending role selection");
  }
  if (!clearSeatSelectionWhenLoggedOutSource.includes('this.confirmedCrossCastRoleKey = ""')) {
    fail("Share page logged-out cleanup must clear cross-cast confirmation state");
  }
  if (!shareOnLoadSource.includes("seatRole && this.currentUserId && !seatRole.taken")) {
    fail("Share page must not preselect a shared seat before login");
  }
  assertBefore(
    shareChooseRoleSource,
    "ensureSeatSelectionLogin",
    "confirmCrossCastRole",
    "Share role selection must not show cross-cast confirmation before login"
  );
  assertBefore(
    shareChooseRoleSource,
    "ensureSeatSelectionLogin",
    "this.pendingRole = targetRole",
    "Share role selection must not set a pending role before login"
  );
  assertBefore(
    shareConfirmRoleSource,
    "ensureSeatSelectionLogin",
    "claimSeat",
    "Share role application must request login before claiming a role"
  );
  assertBefore(
    shareConfirmRoleSource,
    "ensureSeatSelectionLogin",
    "this.role = this.pendingRole",
    "Share role application must request login before updating local role state"
  );
  if (!shareConfirmRoleSource.includes("requirePhone: this.joinRequiresPhone")) {
    fail("Share role application must use the session phone setting before claiming a role");
  }
  assertBefore(
    shareConfirmRoleSource,
    "requirePhone: this.joinRequiresPhone",
    "claimSeat",
    "Share role application must apply the session phone setting before claiming a role"
  );
  if (
    !/async chooseRole\(role\)\s*\{[\s\S]*ensureSeatSelectionLogin[\s\S]*confirmCrossCastRole[\s\S]*this\.pendingRole = targetRole[\s\S]*await this\.confirmRole\(\);/.test(shareSource)
  ) {
    fail("Share role selection should apply immediately after tapping a role card");
  }
  if (!shareSource.includes("confirmSwitchRole")) {
    fail("Share role selection must keep a confirmation dialog before switching away from the current role");
  }
  for (const forbiddenShareActionText of [
    "分享到群",
    "复制文案",
    "copyInviteText",
    "setClipboardData",
    '@click="shareTimeline"',
    "share-actions action-grid",
    "/pages/session/apply"
  ]) {
    if (shareSource.includes(forbiddenShareActionText)) {
      fail(`Share page should not keep extra share action: ${forbiddenShareActionText}`);
    }
  }
  for (const forbiddenTicketRowText of [
    '<view class="ticket-label">已选</view>',
    '<view class="ticket-label">我选</view>',
    '<view class="ticket-label">沟通</view>',
    "note-row"
  ]) {
    if (shareSource.includes(forbiddenTicketRowText)) {
      fail(`Share ticket should only keep basic session info, remove: ${forbiddenTicketRowText}`);
    }
  }

  const createFlowSource = fs.readFileSync(path.join(srcRoot, "utils/createFlow.js"), "utf8");
  for (const requiredStateText of [
    "selectedRoles",
    "roleOptions",
    "mergeSelectedRoles",
    "pinnedMessageText",
    "startAt"
  ]) {
    if (!createFlowSource.includes(requiredStateText)) {
      fail(`Share flow state must preserve role availability across shares: ${requiredStateText}`);
    }
  }

  const roleSource = fs.existsSync(firstFlowFiles["role step"])
    ? fs.readFileSync(firstFlowFiles["role step"], "utf8")
    : "";
  if (!roleSource.includes("/pages/session/setup")) {
    fail("Role step must continue to the time and pinned-message setup page");
  }
  if (
    !/async selectRole\(role\)\s*\{[\s\S]*this\.isSelectedRole\(role\)[\s\S]*this\.goNext\(\);[\s\S]*return;[\s\S]*confirmCrossCastRole/.test(roleSource)
  ) {
    fail("Role selection should confirm and continue when tapping the selected role again");
  }
  const selectRoleSource = methodBody(roleSource, "selectRole");
  const roleGoNextSource = methodBody(roleSource, "goNext");
  if (roleSource.includes("ensureRoleStepLogin") || selectRoleSource.includes("ensureLoggedIn")) {
    fail("Role selection must be browsable before login");
  }
  if (roleGoNextSource.includes("ensureLoggedIn")) {
    fail("Role next button must let users continue browsing before login");
  }

  const setupSource = fs.existsSync(firstFlowFiles["setup step"])
    ? fs.readFileSync(firstFlowFiles["setup step"], "utf8")
    : "";
  for (const requiredSetupText of [
    'mode="date"',
    'mode="time"',
    "pinnedMessageText",
    "defaultPinnedMessage",
    "createPublishedSession",
    'time: "14:00"',
    "/api/sessions",
    "/chat/pin"
  ]) {
    if (!setupSource.includes(requiredSetupText)) {
      fail(`Setup step must collect and persist start time plus pinned chat info: ${requiredSetupText}`);
    }
  }
  for (const forbiddenSetupExtraNpcText of [
    "本场额外NPC",
    "extraNpcRolesPlaceholder",
    "extraNpcRolesText",
    "extraNpcRoles:"
  ]) {
    if (setupSource.includes(forbiddenSetupExtraNpcText)) {
      fail(`Setup step must not expose per-session extra NPC creation yet: ${forbiddenSetupExtraNpcText}`);
    }
  }
  for (const requiredJoinPolicyText of [
    "joinPolicy",
    "review_required",
    "direct",
    "setJoinPolicy",
    "上车审核",
    "需要审核",
    "直接上车"
  ]) {
    if (!setupSource.includes(requiredJoinPolicyText)) {
      fail(`Setup step must expose D23 join policy control: ${requiredJoinPolicyText}`);
    }
  }
  for (const requiredSetupSettingsSwitchText of [
    "setting-switch-row",
    "setting-switch-meta",
    "<switch",
    'color="#1f7a68"',
    ':checked="joinPolicy === \'review_required\'"',
    '@change="setJoinPolicy($event.detail.value ? \'review_required\' : \'direct\')"',
    ':checked="joinPhoneRequired"',
    "@change=\"setJoinPhoneRequired($event.detail.value)\"",
    ':checked="npcJoinEnabled"',
    "@change=\"setNpcJoinEnabled($event.detail.value)\""
  ]) {
    if (!setupSource.includes(requiredSetupSettingsSwitchText)) {
      fail(`Setup step settings must use unified native switches: ${requiredSetupSettingsSwitchText}`);
    }
  }
  for (const forbiddenSetupSettingsToggleText of [
    "policy-toggle",
    "policy-option",
    "npc-join-toggle",
    "toggleJoinPhoneRequired",
    "toggleNpcJoinEnabled"
  ]) {
    if (setupSource.includes(forbiddenSetupSettingsToggleText)) {
      fail(`Setup step settings must not keep legacy button toggles: ${forbiddenSetupSettingsToggleText}`);
    }
  }
  if (/placeholder="[^"]*(?:&#10;|\n)[^"]*"/.test(setupSource)) {
    fail("Setup step must bind multiline textarea placeholders so WeChat upload compilation does not receive literal newlines in WXML attributes");
  }
  const createPublishedSessionSource = methodBody(setupSource, "createPublishedSession");
  if (!createPublishedSessionSource.includes("ensureLoggedIn")) {
    fail("Setup publish button must request login before publishing");
  }
  if (!createPublishedSessionSource.includes("requirePhone: true")) {
    fail("Setup publish button must require phone before publishing");
  }
  assertBefore(
    createPublishedSessionSource,
    "ensureLoggedIn",
    "this.busyAction = true",
    "Setup publish button must not mark busy before login"
  );
  assertBefore(
    createPublishedSessionSource,
    "ensureLoggedIn",
    "request",
    "Setup publish button must request login before publishing"
  );
  assertBefore(
    createPublishedSessionSource,
    "requirePhone: true",
    "this.busyAction = true",
    "Setup publish button must require phone before marking busy"
  );
  assertBefore(
    createPublishedSessionSource,
    "requirePhone: true",
    "request",
    "Setup publish button must require phone before publishing requests"
  );

  const extensionFiles = {
    "session extension registry": path.join(srcRoot, "extensions/sessionExtensions.js"),
    "pseudo chat miniprogram adapter": path.join(
      srcRoot,
      "extensions/session-pseudo-chat/index.js"
    ),
    "talk chat entry": path.join(root, "packages/talk/miniprogram/ChatEntry.vue"),
    "talk pinned-message manager": path.join(
      root,
      "packages/talk/miniprogram/ManagePinnedMessage.vue"
    )
  };
  for (const [label, file] of Object.entries(extensionFiles)) {
    if (!fs.existsSync(file)) {
      fail(`Missing ${label}: ${file}`);
    }
  }

  const detailSource = fs.existsSync(path.join(srcRoot, "pages/session/detail.vue"))
    ? fs.readFileSync(path.join(srcRoot, "pages/session/detail.vue"), "utf8")
    : "";
  const roleSeatBoardPath = path.join(srcRoot, "components/RoleSeatBoard.vue");
  const roleSeatBoardSource = fs.existsSync(roleSeatBoardPath)
    ? fs.readFileSync(roleSeatBoardPath, "utf8")
    : "";
  if (!fs.existsSync(roleSeatBoardPath)) {
    fail("Seat and role displays must share components/RoleSeatBoard.vue");
  }
  for (const requiredRoleSeatBoardText of [
    "role-board",
    "role-choice",
    "role-choice-top",
    "role-choice-name",
    "role-choice-title",
    "role-state",
    "role-choice-note",
    "role-actions",
    "role-meta",
    "role-meta-line",
    "mine",
    "switching",
    "pending",
    "taken",
    "unavailable",
    "male",
    "female"
  ]) {
    if (!roleSeatBoardSource.includes(requiredRoleSeatBoardText)) {
      fail(`Shared role seat board must render the approved visual system: ${requiredRoleSeatBoardText}`);
    }
  }
  for (const requiredRoleSeatBoardOverflowText of [
    ".role-choice-title",
    "overflow: hidden",
    "text-overflow: ellipsis",
    "white-space: nowrap"
  ]) {
    if (!roleSeatBoardSource.includes(requiredRoleSeatBoardOverflowText)) {
      fail(`Shared role seat board must truncate overflowing names: ${requiredRoleSeatBoardOverflowText}`);
    }
  }
  for (const [pageLabel, pagePath] of Object.entries({
    "role page": path.join(srcRoot, "pages/session/role.vue"),
    "share page": path.join(srcRoot, "pages/session/share.vue"),
    "detail page": path.join(srcRoot, "pages/session/detail.vue"),
    "manage page": path.join(srcRoot, "pages/session/manage.vue"),
    "album page": path.join(srcRoot, "pages/session/album.vue")
  })) {
    const pageSource = fs.existsSync(pagePath) ? fs.readFileSync(pagePath, "utf8") : "";
    if (!pageSource.includes("RoleSeatBoard") || !pageSource.includes("<RoleSeatBoard")) {
      fail(`${pageLabel} must use the shared RoleSeatBoard component`);
    }
  }
  if (detailSource.includes('class="seat-card"')) {
    fail("Detail page role and seat list must use RoleSeatBoard instead of legacy seat-card layout");
  }
  for (const requiredDetailNpcRoleSeatText of [
    ':sections="detailRoleSeatSections"',
    "detailNpcRoleCards",
    "session.session_npc_roles",
    'key: "npc"',
    'title: "NPC角色"'
  ]) {
    if (!detailSource.includes(requiredDetailNpcRoleSeatText)) {
      fail(`Detail page role and seat board must include NPC role section: ${requiredDetailNpcRoleSeatText}`);
    }
  }
  for (const requiredDetailExtensionText of [
    "sessionDetailExtensions",
    "sessionDetailExtensionRefs",
    "stopDetailExtensions",
    "authTools"
  ]) {
    if (!detailSource.includes(requiredDetailExtensionText)) {
      fail(`Detail page must mount session extensions: ${requiredDetailExtensionText}`);
    }
  }
  if (/onLoad\s*\(\s*options\s*\)\s*\{\s*const auth = await ensureLoggedIn\s*\(/.test(detailSource)) {
    fail("Detail page must let shared users browse before login");
  }
  if (!/async ensureProtectedActionLogin\(\)\s*\{[\s\S]*ensureLoggedIn\s*\(/.test(detailSource)) {
    fail("Detail page must provide a login guard for protected buttons");
  }
  if (!/async goShare\(seat\)\s*\{[\s\S]*ensureProtectedActionLogin\s*\(/.test(detailSource)) {
    fail("Detail page must require login before choosing a role");
  }
  if (!/async goManage\(\)\s*\{[\s\S]*ensureProtectedActionLogin\s*\(/.test(detailSource)) {
    fail("Detail page must require login before opening management");
  }

  const manageSource = fs.existsSync(path.join(srcRoot, "pages/session/manage.vue"))
    ? fs.readFileSync(path.join(srcRoot, "pages/session/manage.vue"), "utf8")
    : "";
  for (const requiredManageExtensionText of [
    "sessionManageExtensions",
    "authTools",
    "@updated=\"reload\"",
    "@status=\"setStatus\""
  ]) {
    if (!manageSource.includes(requiredManageExtensionText)) {
      fail(`Manage page must mount session extensions: ${requiredManageExtensionText}`);
    }
  }
  if (!/ensureManageActionLogin/.test(manageSource)) {
    fail("Manage action buttons must guard login before requests or confirmation dialogs");
  }
  for (const requiredManageOverviewText of [
    "车局总览",
    "overview-card",
    "overview-actions",
    "overview-pinned",
    ':embedded="true"',
    "车局详情"
  ]) {
    if (!manageSource.includes(requiredManageOverviewText)) {
      fail(`Manage page must integrate top actions, status, and pinned message into one overview block: ${requiredManageOverviewText}`);
    }
  }
  if (/section-title">\s*车况/.test(manageSource)) {
    fail("Manage page must not keep a separate 车况 section after overview consolidation");
  }
  if (manageSource.includes('class="seat-card"')) {
    fail("Manage page seat status list must use RoleSeatBoard instead of legacy seat-card layout");
  }
  for (const requiredManageNpcRoleSeatText of [
    ':sections="manageRoleSeatSections"',
    "manageNpcRoleCards",
    "session.session_npc_roles",
    'key: "npc"',
    'title: "NPC角色"',
    "releaseNpcRole"
  ]) {
    if (!manageSource.includes(requiredManageNpcRoleSeatText)) {
      fail(`Manage page seat status board must include NPC role section and actions: ${requiredManageNpcRoleSeatText}`);
    }
  }
  if (manageSource.includes('class="signup-card"') || manageSource.includes("seat-header")) {
    fail("Manage page signup target cards must use RoleSeatBoard instead of legacy signup-card layout");
  }
  for (const requiredManageSettingsSwitchText of [
    "setting-switch-row",
    "setting-switch-meta",
    "<switch",
    'color="#1f7a68"',
    ':checked="joinPolicy === \'review_required\'"',
    '@change="setJoinPolicy($event.detail.value ? \'review_required\' : \'direct\')"',
    ':checked="joinPhoneRequired"',
    "@change=\"setJoinPhoneRequired($event.detail.value)\"",
    ':checked="npcJoinEnabled"',
    "@change=\"setNpcJoinEnabled($event.detail.value)\""
  ]) {
    if (!manageSource.includes(requiredManageSettingsSwitchText)) {
      fail(`Manage page settings must use unified native switches: ${requiredManageSettingsSwitchText}`);
    }
  }
  for (const forbiddenManageSettingsToggleText of [
    "settings-toggle",
    "setting-option",
    "setting-toggle",
    "toggleJoinPhoneRequired",
    "toggleNpcJoinEnabled"
  ]) {
    if (manageSource.includes(forbiddenManageSettingsToggleText)) {
      fail(`Manage page settings must not keep legacy button toggles: ${forbiddenManageSettingsToggleText}`);
    }
  }
  const pinnedManagerSource = fs.existsSync(path.join(root, "packages/talk/miniprogram/ManagePinnedMessage.vue"))
    ? fs.readFileSync(path.join(root, "packages/talk/miniprogram/ManagePinnedMessage.vue"), "utf8")
    : "";
  for (const requiredPinnedManagerText of [
    "embedded",
    "pinned-manager",
    ".pinned-manager.embedded",
    "保存置顶"
  ]) {
    if (!pinnedManagerSource.includes(requiredPinnedManagerText)) {
      fail(`Pinned-message manager must support embedded overview rendering: ${requiredPinnedManagerText}`);
    }
  }
  const manageButtonChecks = [
    ["reload", "loadSession", "Manage refresh button must request login before loading data"],
    ["goDetail", "uni.navigateTo", "Manage detail button must request login before navigating"],
    ["approve", "runAction", "Manage approve button must request login before requests"],
    ["reject", "runAction", "Manage reject button must request login before requests"],
    ["kickSeat", "confirmAction", "Manage kick button must not show confirmation before login"],
    ["cancelSession", "confirmAction", "Manage cancel button must not show confirmation before login"]
  ];
  for (const [methodName, nextAction, message] of manageButtonChecks) {
    assertBefore(methodBody(manageSource, methodName), "ensureManageActionLogin", nextAction, message);
  }
  for (const requiredManageBusyText of [
    "operationText",
    "正在处理，请稍候",
    ':disabled="busyAction"',
    "{{ busyAction ?",
    "this.busyAction = true",
    "this.busyAction = false"
  ]) {
    if (!manageSource.includes(requiredManageBusyText)) {
      fail(`Manage page must lock related controls while busy: ${requiredManageBusyText}`);
    }
  }

  const albumSource = fs.existsSync(path.join(srcRoot, "pages/session/album.vue"))
    ? fs.readFileSync(path.join(srcRoot, "pages/session/album.vue"), "utf8")
    : "";
  for (const requiredAlbumRoleSeatBoardText of [
    "albumTagSections",
    "albumTagSection",
    "albumTagCard",
    "handleAlbumTagTap",
    'role_gender: seat.role_gender || "unlimited"',
    '<RoleSeatBoard'
  ]) {
    if (!albumSource.includes(requiredAlbumRoleSeatBoardText)) {
      fail(`Album tag role picker must use RoleSeatBoard: ${requiredAlbumRoleSeatBoardText}`);
    }
  }
  for (const forbiddenAlbumTagCardText of [
    "people-grid",
    "person-choice",
    "person-note",
    'class="group-title"'
  ]) {
    if (albumSource.includes(forbiddenAlbumTagCardText)) {
      fail(`Album tag role picker must not keep legacy person card styles: ${forbiddenAlbumTagCardText}`);
    }
  }
  for (const requiredAlbumBusyText of [
    "albumBusy",
    "loadingAlbum",
    "deletingPhotoId",
    "operationText",
    "正在处理，请稍候",
    ':disabled="albumBusy"',
    "this.deletingPhotoId = photo.id",
    "this.deletingPhotoId = null"
  ]) {
    if (!albumSource.includes(requiredAlbumBusyText)) {
      fail(`Album page must lock related controls while busy: ${requiredAlbumBusyText}`);
    }
  }
  const deletePhotoSource = methodBody(albumSource, "deletePhoto");
  if (!deletePhotoSource.includes("this.albumBusy")) {
    fail("Album delete action must refuse duplicate deletes while another album action is busy");
  }
  const changeWaterfallListSource = methodBody(albumSource, "changeWaterfallList");
  if (changeWaterfallListSource.includes("this[event.name].push")) {
    fail("Album waterfall callback must not push into uv-waterfall internal list names directly");
  }
  const uvWaterfallSource = fs.existsSync(
    path.join(srcRoot, "uni_modules/uv-ui-tools/components/uv-waterfall/uv-waterfall.vue")
  )
    ? fs.readFileSync(
        path.join(srcRoot, "uni_modules/uv-ui-tools/components/uv-waterfall/uv-waterfall.vue"),
        "utf8"
      )
    : "";
  for (const requiredWaterfallWidthText of [
    ".photo-waterfall",
    "display: flex",
    "width: 100%",
    "max-width: 100%",
    "overflow-x: hidden",
    ".waterfall-column",
    ".waterfall-photo-card",
    "box-sizing: border-box",
    "flex: 1 1 0",
    "min-width: 0"
  ]) {
    if (!albumSource.includes(requiredWaterfallWidthText) && !uvWaterfallSource.includes(requiredWaterfallWidthText)) {
      fail(`Album waterfall must clamp columns after operation reflow: ${requiredWaterfallWidthText}`);
    }
  }
  if (/\.photo-waterfall\s*\{[^}]*display:\s*block;/.test(albumSource)) {
    fail("Album waterfall root must not override uv-waterfall flex layout with display:block");
  }
  for (const requiredWaterfallCallbackText of [
    "targetListName",
    "waterfallList",
    "Array.isArray(this[targetListName])",
    "this[targetListName].push(event.value)"
  ]) {
    if (!changeWaterfallListSource.includes(requiredWaterfallCallbackText)) {
      fail(`Album waterfall callback must map uv-waterfall names to page lists: ${requiredWaterfallCallbackText}`);
    }
  }
  for (const requiredAlbumBulkTagText of [
    "selectionMode",
    "selectedPhotoIds",
    "bulkTagging",
    "toggleSelectionMode",
    "togglePhotoSelection",
    "openBulkTagSheet",
    "selectedPhotoCount",
    "selectedTagTargetCount",
    "album-floating-toolbar",
    "safe-area-inset-bottom",
    "selection-checkbox",
    "selection-checkbox-box",
    "部分照片标注失败",
    "给 {{ selectedTagTargetCount }} 张照片标注",
    "for (const photoId of targetPhotoIds)",
    "url: `/api/session-album/photos/${photoId}/tags`",
    "data: { tagKeys: this.selectedTagKeys }",
    "tagPersonTitle",
    "tagPersonSubtitle",
    "note: this.tagPersonSubtitle(person)",
    "account_name: accountName"
  ]) {
    if (!albumSource.includes(requiredAlbumBulkTagText)) {
      fail(`Album page must support bulk tagging: ${requiredAlbumBulkTagText}`);
    }
  }
  const albumFloatingToolbarStyle =
    albumSource.match(/\.album-floating-toolbar\s*\{[\s\S]*?\n\}/)?.[0] || "";
  const albumFloatingToolbarDisabledStyle =
    albumSource.match(/\.floating-toolbar-button\.disabled\s*\{[\s\S]*?\n\}/)?.[0] || "";
  const albumActionsStyle =
    albumSource.match(/\.album-actions\s*\{[\s\S]*?\n\}/)?.[0] || "";
  const albumStickyActionsFloatingStyle =
    albumSource.match(/\.album-sticky-actions\.floating\s*\{[\s\S]*?\n\}/)?.[0] || "";
  const albumActionsShellFloatingStyle =
    albumSource.match(/\.album-actions-shell\.floating\s*\{[\s\S]*?\n\}/)?.[0] || "";
  const albumSelectionPageStyle =
    albumSource.match(/\.album-page\.selection-active\s*\{[\s\S]*?\n\}/)?.[0] || "";
  const albumToolbarFilterPanelStyle =
    albumSource.match(/\.album-toolbar-filter-panel\s*\{[\s\S]*?\n\}/)?.[0] || "";
  if (/(^|[;{\n\r])\s*bottom:\s*calc\(/.test(albumFloatingToolbarStyle)) {
    fail("Album floating toolbar must keep a plain bottom fallback so it appears immediately in WeChat DevTools");
  }
  if (
    albumSource.includes('<scroll-view scroll-y class="album-scroll">') ||
    albumSource.includes('class="album-scroll-content"')
  ) {
    fail("Album page must use native page scrolling; wrapping the album in scroll-view hides the fixed selection toolbar in WeChat DevTools");
  }
  if (
    !albumSource.includes('<view v-if="!timelineMode && selectionMode && !tagSheetPhoto" class="album-floating-toolbar">')
  ) {
    fail("Album selection toolbar must be a root-level fixed view so it appears immediately above the photo list");
  }
  if (
    !albumFloatingToolbarStyle.includes("height: 132rpx") ||
    !/(^|[;{\n\r])\s*position:\s*fixed/.test(albumFloatingToolbarStyle) ||
    !/(^|[;{\n\r])\s*bottom:\s*0/.test(albumFloatingToolbarStyle) ||
    !/(^|[;{\n\r])\s*left:\s*0/.test(albumFloatingToolbarStyle) ||
    !/(^|[;{\n\r])\s*right:\s*0/.test(albumFloatingToolbarStyle) ||
    !/(^|[;{\n\r])\s*z-index:\s*1000/.test(albumFloatingToolbarStyle) ||
    !/(^|[;{\n\r])\s*display:\s*flex/.test(albumFloatingToolbarStyle) ||
    !/(^|[;{\n\r])\s*gap:/.test(albumFloatingToolbarStyle) ||
    !albumFloatingToolbarStyle.includes("box-shadow:")
  ) {
    fail("Album selection toolbar must be a fixed bottom toolbar that paints immediately in WeChat DevTools");
  }
  if (!albumSelectionPageStyle.includes("padding-bottom: 190rpx")) {
    fail("Album selection mode must reserve scroll content space behind the fixed bottom toolbar");
  }
  if (
    !albumFloatingToolbarDisabledStyle.includes("background-color: #d7dbd6") ||
    !albumFloatingToolbarDisabledStyle.includes("color: #7a857d") ||
    !albumFloatingToolbarDisabledStyle.includes("opacity: 1")
  ) {
    fail("Album bulk toolbar action must be gray while disabled and become green after selecting photos");
  }
  const selectedTagTargetCountSource = methodBody(albumSource, "selectedTagTargetCount");
  if (
    !selectedTagTargetCountSource.includes('this.selectionModePurpose === "tag"') ||
    !selectedTagTargetCountSource.includes("return this.selectedTaggablePhotoIds.length")
  ) {
    fail("Album bulk tag button must become active after selecting taggable photos");
  }
  for (const requiredAlbumAdminParityText of [
    "albumFilterOptions",
    "countAlbumPhotosForFilter",
    "selectedRoleFilter",
    "albumRoleFilterOptions",
    "handleRoleFilterChange",
    "photoMatchesSelectedRole",
    "roleFilterOptionLabel",
    "album-metrics",
    "metric-value",
    "{{ filteredPhotos.length }}",
    "{{ filteredTaggedPhotoCount }}",
    "{{ filteredUntaggedPhotoCount }}",
    "当前筛选",
    "已标注",
    "待标注",
    "标注 {{ filteredTagProgressPercent }}%",
    "photoDetailText",
    "formatDate(photo.created_at)",
    "album-filter-panel",
    "查看照片",
    "角色"
  ]) {
    if (!albumSource.includes(requiredAlbumAdminParityText)) {
      fail(`Album page must match admin album filter and info affordances: ${requiredAlbumAdminParityText}`);
    }
  }
  for (const outdatedAlbumCardText of [
    "photo-info-grid",
    "photo-info-item",
    "photo-info-label",
    "photo-info-value",
    "photo-action-rail",
    "photo-caption-facts",
    "photo-caption-meta"
  ]) {
    if (albumSource.includes(outdatedAlbumCardText)) {
      fail(`Album photo cards must not use the bulky Info Ledger footer layout: ${outdatedAlbumCardText}`);
    }
  }
  for (const requiredAlbumCardCaptionText of [
    "photo-caption-body",
    "photo-caption-title",
    "photo-actions-row",
    "photo-status-slot",
    "photo-source-badge",
    "photo-source-icon",
    "photo-source-label",
    "photoSourceIcon(photo)",
    "/static/icons/user.png",
    "/static/icons/group.png",
    "photo-safe-actions",
    "photo-action-text",
    "photo-danger-action",
    "showPhotoInfo(photo)",
    '@longpress.stop="showPhotoInfo(photo)"',
    "图片信息",
    "上传者",
    "时间",
    "尺寸",
    "photoActionDateText(photo)"
  ]) {
    if (!albumSource.includes(requiredAlbumCardCaptionText)) {
      fail(`Album photo cards must use the compact caption footer layout: ${requiredAlbumCardCaptionText}`);
    }
  }
  if (/\.photo-meta\s*\{[\s\S]*min-height:\s*116rpx;/.test(albumSource)) {
    fail("Album photo card footer must not keep fixed 116rpx min-height after compact footer redesign");
  }
  if (/\.photo-upload-source\s*\{[\s\S]*line-height:\s*52rpx;/.test(albumSource)) {
    fail("Album photo source indicator must not rely on 52rpx text line-height that truncates in narrow cards");
  }
  assertBefore(
    albumSource,
    'class="photo-safe-actions"',
    'class="photo-action-text danger photo-danger-action"',
    "Album download and delete actions must be separated into safe and danger zones"
  );
  assertBefore(
    albumSource,
    'class="filter-row"',
    'class="role-filter-row"',
    "Album photo scope filters must appear before the role picker in the grouped filter panel"
  );
  for (const requiredAlbumDownloadText of [
    "downloading",
    "downloadProgressText",
    "downloadSinglePhoto",
    "downloadSelectedPhotos",
    "downloadAllPhotos",
    "confirmDownloadPhotos",
    "openDownloadSelectionMode",
    "saveImageToPhotosAlbum",
    "scope.writePhotosAlbum",
    "ensurePhotosAlbumPermission",
    "saveAlbumImageToPhotosAlbum",
    "全部下载",
    "多选下载",
    "下载所选",
    "下载照片",
    "this.downloading = true",
    "this.downloadProgressText = `正在保存 ${index + 1}/${photos.length} 张照片...`"
  ]) {
    if (!albumSource.includes(requiredAlbumDownloadText)) {
      fail(`Album page must support single, selected and all-photo downloads: ${requiredAlbumDownloadText}`);
    }
  }
  for (const requiredAlbumActionGroupText of [
    "album-primary-actions",
    "album-actions-shell",
    "album-sticky-actions",
    "topActionsFloating",
    "onPageScroll",
    "updateTopActionsFloating",
    "album-action-groups",
    "album-action-group",
    "album-action-group-title",
    "保存到手机",
    "整理标注",
    "album-filter-panel",
    "filter-panel-head",
    "查看照片",
    "角色",
    "openDownloadSelectionMode",
    "openTagSelectionMode"
  ]) {
    if (!albumSource.includes(requiredAlbumActionGroupText)) {
      fail(`Album page must group header actions by user task: ${requiredAlbumActionGroupText}`);
    }
  }
  if (
    !albumSource.includes(':class="{ floating: topActionsFloating }"') ||
    !albumActionsShellFloatingStyle.includes("min-height:") ||
    !/(^|[;{\n\r])\s*position:\s*fixed/.test(albumStickyActionsFloatingStyle) ||
    !/(^|[;{\n\r])\s*top:\s*0/.test(albumStickyActionsFloatingStyle) ||
    !/(^|[;{\n\r])\s*left:\s*20rpx/.test(albumStickyActionsFloatingStyle) ||
    !/(^|[;{\n\r])\s*right:\s*20rpx/.test(albumStickyActionsFloatingStyle) ||
    !/(^|[;{\n\r])\s*z-index:\s*900/.test(albumStickyActionsFloatingStyle) ||
    !albumActionsStyle.includes("box-shadow:")
  ) {
    fail("Album header actions must become a fixed top toolbar while scrolling the photo list");
  }
  const albumStickyActionsIndex = albumSource.indexOf('class="album-actions album-sticky-actions"');
  const albumToolbarFilterIndex = albumSource.indexOf(
    'class="album-filter-panel album-toolbar-filter-panel"'
  );
  if (
    albumStickyActionsIndex < 0 ||
    albumToolbarFilterIndex < albumStickyActionsIndex ||
    !albumSource.includes(".album-toolbar-filter-panel") ||
    !albumToolbarFilterPanelStyle.includes("border-top:") ||
    !albumToolbarFilterPanelStyle.includes("background: transparent")
  ) {
    fail("Album filters must be attached to the fixed top toolbar while scrolling");
  }
  const downloadPhotosSource = methodBody(albumSource, "downloadPhotos");
  const confirmDownloadPhotosSource = methodBody(albumSource, "confirmDownloadPhotos");
  if (!downloadPhotosSource.includes("await this.confirmDownloadPhotos")) {
    fail("Album downloads must ask for confirmation before saving photos");
  }
  assertBefore(
    downloadPhotosSource,
    "await this.confirmDownloadPhotos",
    "this.downloading = true",
    "Album download confirmation must happen before entering downloading state"
  );
  for (const requiredDownloadConfirmText of [
    "uni.showModal",
    "确认下载",
    "confirmText: \"下载\"",
    "resolve(Boolean(result.confirm))",
    "将保存这张照片到系统相册",
    "将保存所选",
    "将保存我的相册中"
  ]) {
    if (!confirmDownloadPhotosSource.includes(requiredDownloadConfirmText) && !albumSource.includes(requiredDownloadConfirmText)) {
      fail(`Album downloads must confirm every download entry point: ${requiredDownloadConfirmText}`);
    }
  }
  for (const requiredAlbumShareText of [
    "timelineMode",
    "albumShareToken",
    "loadPublicAlbum",
    "localAlbumShareSubject",
    "canRequestAlbumShareToken",
    "/album/public-share",
    "/album/share-token",
    "entry=album",
    "source: \"wechat_timeline\"",
    "albumTimelineQuery",
    "showWechatShareMenus",
    "(!this.timelineMode && !token)"
  ]) {
    if (!albumSource.includes(requiredAlbumShareText)) {
      fail(`Album page must support D23 group/Moments album sharing: ${requiredAlbumShareText}`);
    }
  }
  const albumOnLoadSource = methodBody(albumSource, "onLoad");
  const albumOnShowSource = methodBody(albumSource, "onShow");
  const previewPhotoSource = methodBody(albumSource, "previewPhoto");
  assertBefore(
    albumOnLoadSource,
    "if (this.timelineMode)",
    "ensureLoggedIn",
    "Album timeline mode must load public album before any login prompt"
  );
  for (const requiredAlbumPreviewLifecycleText of [
    "skipNextAlbumRefreshOnShow",
    "consumePreviewReturnRefreshSkip",
    "this.skipNextAlbumRefreshOnShow = true",
    "this.skipNextAlbumRefreshOnShow = false"
  ]) {
    if (!albumSource.includes(requiredAlbumPreviewLifecycleText)) {
      fail(`Album photo preview must not refresh the whole album after closing: ${requiredAlbumPreviewLifecycleText}`);
    }
  }
  assertBefore(
    albumOnShowSource,
    "consumePreviewReturnRefreshSkip",
    "loadAlbum",
    "Album onShow must consume photo-preview return before refreshing the member album"
  );
  assertBefore(
    albumOnShowSource,
    "consumePreviewReturnRefreshSkip",
    "loadPublicAlbum",
    "Album onShow must consume photo-preview return before refreshing the public album"
  );
  assertBefore(
    previewPhotoSource,
    "this.skipNextAlbumRefreshOnShow = true",
    "uni.previewImage",
    "Album preview must mark the next onShow before opening the system image viewer"
  );
  const albumShareAppMessageSource = methodBody(albumSource, "onShareAppMessage");
  if (
    !albumShareAppMessageSource.includes("/pages/session/share") ||
    !albumShareAppMessageSource.includes("entry=album") ||
    !albumShareAppMessageSource.includes("source=wechat_share")
  ) {
    fail("Album friend/group sharing must route to the album-entry share page");
  }
  if (
    albumShareAppMessageSource.includes('"车局相册"') ||
    albumShareAppMessageSource.includes("'车局相册'")
  ) {
    fail("Album friend/group sharing title must include script and store names, not generic 车局相册");
  }
  if (!albumShareAppMessageSource.includes("imageUrl:")) {
    fail("Album friend/group sharing must set a privacy-safe imageUrl instead of using the live page screenshot");
  }
  const albumShareTitleSource = methodBody(albumSource, "albumShareTitle");
  if (
    !albumShareTitleSource.includes("albumShareSessionTitle") ||
    !albumShareTitleSource.includes("相册邀请")
  ) {
    fail("Album friend/group sharing title must include script and store names with 相册邀请");
  }
  const albumShareSessionTitleSource = methodBody(albumSource, "albumShareSessionTitle");
  if (
    !albumShareSessionTitleSource.includes("albumScriptName") ||
    !albumShareSessionTitleSource.includes("albumStoreName")
  ) {
    fail("Album sharing session title must be built from script and store names");
  }
  const albumShareTimelineSource = methodBody(albumSource, "onShareTimeline");
  if (!albumShareTimelineSource.includes("query:") || albumShareTimelineSource.includes("path:")) {
    fail("Album Moments sharing must return query only");
  }
  const ensureAlbumShareTokenSource = methodBody(albumSource, "ensureAlbumShareToken");
  assertBefore(
    ensureAlbumShareTokenSource,
    "canRequestAlbumShareToken",
    "/album/share-token",
    "Album share token prefetch must check for a confirmed local seat before requesting the token endpoint"
  );
  if (!ensureAlbumShareTokenSource.includes("this.shareSubject = null")) {
    fail("Album share token prefetch must clear share subject when the current user cannot create a seat-scoped token");
  }
  for (const requiredAlbumReadOnlyText of [
    'v-if="!timelineMode && (canUpload || photos.length || taggablePhotos.length)"',
    'class="album-filter-panel album-toolbar-filter-panel"',
    'v-if="!timelineMode && selectionMode"',
    'v-if="!timelineMode && tagSheetPhoto"'
  ]) {
    if (!albumSource.includes(requiredAlbumReadOnlyText)) {
      fail(`Album timeline mode must hide member-only controls: ${requiredAlbumReadOnlyText}`);
    }
  }

  const apiSource = fs.readFileSync(path.join(srcRoot, "utils/api.js"), "utf8");
  for (const requiredAuthGuardText of [
    "export async function ensureLoggedIn",
    "uni.showModal",
    "uni.login",
    "setAuth(data)",
    "pinche-auth-change"
  ]) {
    if (!apiSource.includes(requiredAuthGuardText)) {
      fail(`Shared auth guard is missing ${requiredAuthGuardText}`);
    }
  }
  for (const requiredBackendStatusText of [
    "BACKEND_STATUS_CHANGE_EVENT",
    "export function getBackendStatus",
    "export function checkBackendHealth",
    "export function markBackendMaintenance",
    "export function clearBackendMaintenance",
    "export function shouldBlockBusinessRequests",
    "allowDuringMaintenance",
    "/health",
    "maintenance: true"
  ]) {
    if (!apiSource.includes(requiredBackendStatusText)) {
      fail(`Backend maintenance status support is missing ${requiredBackendStatusText}`);
    }
  }
  for (const requiredPhoneAuthText of [
    "AUTH_PHONE_REQUEST_EVENT",
    "AUTH_PHONE_RESPONSE_EVENT",
    "refreshCurrentAuth",
    "updateUserPhoneFromWechatPhoneCode",
    "ensureUserPhone",
    "requirePhone === true",
    "/api/auth/wechat/phone"
  ]) {
    if (!apiSource.includes(requiredPhoneAuthText)) {
      fail(`Shared phone authorization support is missing ${requiredPhoneAuthText}`);
    }
  }
  const ensureLoggedInSource = methodBody(apiSource, "ensureLoggedIn");
  if (ensureLoggedInSource.includes("promptPhoneAfterLogin: true")) {
    fail("Shared login must not force phone authorization immediately after fresh login");
  }
  if (!ensureLoggedInSource.includes("options.requireGender === true")) {
    fail("Shared login must only request profile gender when a protected action explicitly requires it");
  }
  const logoutRedirectSource = methodBody(apiSource, "goHomeAfterLogout");
  if (!logoutRedirectSource.includes('uni.reLaunch({ url: "/pages/index/index" })')) {
    fail("Shared logout helper must relaunch the home entry page");
  }

  const identityBarPath = path.join(srcRoot, "components/AuthIdentityBar.vue");
  if (!fs.existsSync(identityBarPath)) {
    fail(`Missing shared auth identity bar: ${identityBarPath}`);
  } else {
    const identityBarSource = fs.readFileSync(identityBarPath, "utf8");
    for (const requiredIdentityText of [
      "已登录",
      "退出登录",
      "clearAuth",
      "logoutProfile",
      "rolesText",
      "AUTH_CHANGE_EVENT",
      "getCurrentUser",
      "goLoginPage",
      "passiveGuest",
      "handleIdentityTap",
      "overflow: hidden",
      "white-space: nowrap"
    ]) {
      if (!identityBarSource.includes(requiredIdentityText)) {
        fail(`Auth identity bar must display and refresh identity: ${requiredIdentityText}`);
      }
    }
    if (identityBarSource.includes("loginFromIdentityBar") || identityBarSource.includes("ensureLoggedIn")) {
      fail("Logged-out identity bar must link to the login page instead of opening authorization directly");
    }
    const identityTapSource = methodBody(identityBarSource, "handleIdentityTap");
    if (!identityTapSource.includes('this.$emit("guest-login")')) {
      fail("Passive guest identity bar must emit a login request when tapped");
    }
    const identityLogoutSource = methodBody(identityBarSource, "logoutProfile");
    if (!identityLogoutSource.includes("goHomeAfterLogout")) {
      fail("Auth identity bar logout must relaunch the home entry after clearing auth");
    }
    for (const requiredPhoneModalText of [
      "phoneVisible",
      "handlePhoneRequest",
      'open-type="getPhoneNumber"',
      "getphonenumber",
      "创建车或上车前需要授权手机号"
    ]) {
      if (!identityBarSource.includes(requiredPhoneModalText)) {
        fail(`Auth identity bar phone authorization is missing ${requiredPhoneModalText}`);
      }
    }
    const identityBarStyle = identityBarSource.match(/\.auth-identity-bar\s*\{([\s\S]*?)\n\}/)?.[1] || "";
    if (!/\n\s*height:\s*56rpx;/.test(`\n${identityBarStyle}`)) {
      fail("Auth identity bar must use the fixed second-page height: 56rpx");
    }
    if (/\n\s*min-height:/.test(`\n${identityBarStyle}`)) {
      fail("Auth identity bar must not rely on min-height because it can vary across pages");
    }
  }

  const loginOptionalPages = new Set([
    "pages/index/index",
    "pages/session/create",
    "pages/session/script",
    "pages/session/role",
    "pages/admin/catalog"
  ]);
  for (const pagePath of pagePaths) {
    const source = fs.readFileSync(path.join(srcRoot, `${pagePath}.vue`), "utf8");
    if (!loginOptionalPages.has(pagePath) && !source.includes("ensureLoggedIn")) {
      fail(`Page must require login before use: ${pagePath}`);
    }
    if (!source.includes("<AuthIdentityBar")) {
      fail(`Page must show the shared auth identity bar: ${pagePath}`);
    }
    const rootViewMatch = source.match(/<template>\s*<view\b[^>]*class="[^"]*\bpage\b[^"]*"[^>]*>([\s\S]*?)\n\s*<view|\n\s*<image|\n\s*<AuthIdentityBar/);
    const rootStart = source.match(/<template>\s*<view\b[^>]*class="[^"]*\bpage\b[^"]*"[^>]*>/);
    if (rootStart) {
      const afterRoot = source.slice(rootStart.index + rootStart[0].length);
      const authIsFirstRootChild = /^\s*<AuthIdentityBar\b/.test(afterRoot);
      const authIsFirstScrollContentChild =
        /^\s*<scroll-view\b[^>]*>\s*<view\b[^>]*>\s*<AuthIdentityBar\b/.test(afterRoot);
      if (!authIsFirstRootChild && !authIsFirstScrollContentChild) {
        fail(`Auth identity bar must be the first page element: ${pagePath}`);
      }
    } else if (rootViewMatch) {
      fail(`Unable to verify root page element for auth identity bar: ${pagePath}`);
    }
  }

  for (const pagePath of [
    "pages/session/create",
    "pages/session/script",
    "pages/session/role",
    "pages/session/setup"
  ]) {
    const source = fs.readFileSync(path.join(srcRoot, `${pagePath}.vue`), "utf8");
    const onLoadSource = methodBody(source, "onLoad");
    if (onLoadSource.includes("ensureLoggedIn")) {
      fail(`Creation browse page must not request login on load: ${pagePath}`);
    }
  }
  const adminCatalogSource = fs.readFileSync(path.join(srcRoot, "pages/admin/catalog.vue"), "utf8");
  if (/onLoad\s*\(\s*(?:async\s*)?\([^)]*\)\s*=>\s*\{[\s\S]*ensureLoggedIn\s*\(/.test(adminCatalogSource)) {
    fail("Admin catalog page must wait for an explicit login tap before requesting login");
  }

  const appSource = fs.readFileSync(path.join(srcRoot, "App.vue"), "utf8");
  if (!fs.existsSync(miniprogramDevEnvPath)) {
    fail("Miniprogram development env is missing: apps/miniprogram/.env.development");
  } else if (!isDevelopmentApiBaseUrl(readEnv(miniprogramDevEnvPath).VITE_API_BASE_URL)) {
    fail(
      `Miniprogram development API base URL must be ${productionApiBaseUrl}`
    );
  }
  if (!fs.existsSync(miniprogramProdEnvPath)) {
    fail("Miniprogram production env is missing: apps/miniprogram/.env.production");
  } else if (readEnv(miniprogramProdEnvPath).VITE_API_BASE_URL !== productionApiBaseUrl) {
    fail(`Miniprogram production API base URL must be ${productionApiBaseUrl}`);
  }
  if (!appSource.includes("import.meta.env.VITE_API_BASE_URL")) {
    fail("App.vue must read API base URL from VITE_API_BASE_URL");
  }
  if (!appSource.includes("@font-face") || !appSource.includes("/static/fonts/pinche-brand.ttf")) {
    fail("App.vue must load the packaged brand font from /static/fonts/pinche-brand.ttf");
  }
  if (!appSource.includes("PincheBrand")) {
    fail("App.vue must expose the packaged brand font as PincheBrand");
  }
  if (/url\(\s*["']?\/?static\/[^)"']+\.(?:png|jpe?g|gif|webp|svg)/.test(appSource)) {
    fail("Global App.vue styles must not use local /static images in CSS url(); use <image> instead");
  }
  const staticReferenceFiles = walkFiles(srcRoot).filter((file) =>
    /\.(?:vue|js|json)$/.test(file)
  );
  const staticAssetPattern = /["'`]((?:\/static\/)[^"'`?#]+\.(?:png|jpe?g|gif|webp|svg|ttf|otf|woff2?))(?:[?#][^"'`]*)?["'`]/g;
  for (const file of staticReferenceFiles) {
    const source = fs.readFileSync(file, "utf8");
    for (const match of source.matchAll(staticAssetPattern)) {
      const assetPath = path.join(srcRoot, match[1].slice(1));
      if (!fs.existsSync(assetPath)) {
        fail(`Missing static image asset referenced by ${path.relative(root, file)}: ${match[1]}`);
      }
    }
  }
  for (const requiredButtonSystemText of [
    ".button.compact",
    ".button.disabled",
    ".bottom-action",
    ".action-grid"
  ]) {
    if (!appSource.includes(requiredButtonSystemText)) {
      fail(`Global button system is missing ${requiredButtonSystemText}`);
    }
  }

  const viteConfigSource = fs.existsSync(viteConfigPath) ? fs.readFileSync(viteConfigPath, "utf8") : "";
  if (!viteConfigSource.includes("__PINCHE_BUILD_TIME__")) {
    fail("Vite config must define the build-time version constant");
  }
  if (!/define:\s*\{[\s\S]*__PINCHE_BUILD_TIME__/.test(viteConfigSource)) {
    fail("Vite config must inject the build-time constant through define");
  }
  if (!/formatBuildTime/.test(viteConfigSource) || !/padStart\(2,\s*"0"\)/.test(viteConfigSource)) {
    fail("Vite config must format the build time as a stable YYYY-MM-DD HH:mm label");
  }

  for (const [label, file] of Object.entries(firstFlowFiles)) {
    const source = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
    if (/<button[^>]*@tap=/.test(source)) {
      fail(`${label} buttons should use @click for consistent UniApp button handling`);
    }
    for (const localButtonRule of [
      ".search-button {",
      ".share-button {",
      ".confirm-button {",
      ".bottom-action {",
      ".button.disabled {"
    ]) {
      if (source.includes(localButtonRule)) {
        fail(`${label} should use the shared button system instead of local ${localButtonRule}`);
      }
    }
  }

  if (!process.exitCode) {
    console.log(`UniApp miniprogram check passed: ${pages.length} pages`);
  }
}

if (!fs.existsSync(devtoolsHookPath)) {
  fail("Missing WeChat DevTools refresh hook script: scripts/devtools-refresh-hook.js");
} else {
  const devtoolsHookSource = fs.readFileSync(devtoolsHookPath, "utf8");
  for (const requiredHookText of [
    "wechatwebdevtools.app/Contents/MacOS/cli",
    "apps/miniprogram",
    "dist/dev/mp-weixin",
    "open",
    "pinche-devtools-refresh-state.json"
  ]) {
    if (!devtoolsHookSource.includes(requiredHookText)) {
      fail(`WeChat DevTools refresh hook is missing ${requiredHookText}`);
    }
  }
}

if (fs.existsSync(codexHooksPath)) {
  const codexHooks = JSON.parse(fs.readFileSync(codexHooksPath, "utf8"));
  const stopHooks = codexHooks.hooks?.Stop || [];
  const hasDevtoolsStopHook = stopHooks.some((entry) =>
    (entry.hooks || []).some(
      (hook) =>
        hook.type === "command" &&
        hook.command?.includes("scripts/devtools-refresh-hook.js")
    )
  );
  if (!hasDevtoolsStopHook) {
    fail("Codex Stop hook must run scripts/devtools-refresh-hook.js");
  }
}
