import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const miniprogramRoot = path.join(root, "apps/miniprogram");
const srcRoot = path.join(miniprogramRoot, "src");
const pagesJsonPath = path.join(srcRoot, "pages.json");
const viteConfigPath = path.join(miniprogramRoot, "vite.config.js");
const codexHooksPath = path.join(root, ".codex/hooks.json");
const devtoolsHookPath = path.join(root, "scripts/devtools-refresh-hook.js");

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

if (!fs.existsSync(pagesJsonPath)) {
  fail("apps/miniprogram/src/pages.json is missing");
} else {
  const pagesJson = JSON.parse(fs.readFileSync(pagesJsonPath, "utf8"));
  const pages = pagesJson.pages || [];

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
  for (const requiredText of ["创建", "我的"]) {
    if (!indexSource.includes(requiredText)) {
      fail(`Entry page must expose the simple first choice: ${requiredText}`);
    }
  }
  if (!indexSource.includes("buildVersion") || !indexSource.includes("__PINCHE_BUILD_TIME__")) {
    fail("Entry page must display the injected build-time version label");
  }
  if (!/<view class="build-version">\{\{ buildVersion \}\}<\/view>/.test(indexSource)) {
    fail("Entry page must render the build-time version label on the first screen");
  }
  if (!/\.home-panel\s*\{[\s\S]*width:\s*420rpx;[\s\S]*margin:\s*0 auto;/.test(indexSource)) {
    fail("Entry page must keep the Create/Mine action stack aligned to one fixed width");
  }
  if (!/\.primary-action,\s*\n\.secondary-action\s*\{[\s\S]*width:\s*100%;[\s\S]*margin:\s*0;[\s\S]*box-sizing:\s*border-box;/.test(indexSource)) {
    fail("Entry page action buttons must share one full-width button box model");
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

  const shareSource = fs.existsSync(firstFlowFiles["share step"])
    ? fs.readFileSync(firstFlowFiles["share step"], "utf8")
    : "";
  for (const requiredShareText of ["角色状态", "可选", "我选", "已选", "确认选择", "换选"]) {
    if (!shareSource.includes(requiredShareText)) {
      fail(`Share page must let invited players inspect and choose open roles: ${requiredShareText}`);
    }
  }
  for (const requiredSwitchingText of [
    "switchingCount",
    'stateKind === "switching"',
    ".role-choice.switching"
  ]) {
    if (!shareSource.includes(requiredSwitchingText)) {
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
  for (const requiredFinalShareText of ["claimSeat", "/claim", "loadPublishedSession"]) {
    if (!shareSource.includes(requiredFinalShareText)) {
      fail(`Share page must be the final role-selection page: ${requiredFinalShareText}`);
    }
  }
  for (const forbiddenShareActionText of [
    "分享到群",
    "复制文案",
    "copyInviteText",
    "setClipboardData",
    '@click="shareTimeline"',
    "onShareTimeline",
    '"shareTimeline"',
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

  const identityBarPath = path.join(srcRoot, "components/AuthIdentityBar.vue");
  if (!fs.existsSync(identityBarPath)) {
    fail(`Missing shared auth identity bar: ${identityBarPath}`);
  } else {
    const identityBarSource = fs.readFileSync(identityBarPath, "utf8");
    for (const requiredIdentityText of [
      "已登录",
      "rolesText",
      "AUTH_CHANGE_EVENT",
      "getCurrentUser",
      "overflow: hidden",
      "white-space: nowrap"
    ]) {
      if (!identityBarSource.includes(requiredIdentityText)) {
        fail(`Auth identity bar must display and refresh identity: ${requiredIdentityText}`);
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

  for (const pagePath of pagePaths) {
    const source = fs.readFileSync(path.join(srcRoot, `${pagePath}.vue`), "utf8");
    if (!source.includes("ensureLoggedIn")) {
      fail(`Page must require login before use: ${pagePath}`);
    }
    if (!source.includes("<AuthIdentityBar")) {
      fail(`Page must show the shared auth identity bar: ${pagePath}`);
    }
    const rootViewMatch = source.match(/<template>\s*<view\b[^>]*class="[^"]*\bpage\b[^"]*"[^>]*>([\s\S]*?)\n\s*<view|\n\s*<image|\n\s*<AuthIdentityBar/);
    const rootStart = source.match(/<template>\s*<view\b[^>]*class="[^"]*\bpage\b[^"]*"[^>]*>/);
    if (rootStart) {
      const afterRoot = source.slice(rootStart.index + rootStart[0].length);
      if (!/^\s*<AuthIdentityBar\b/.test(afterRoot)) {
        fail(`Auth identity bar must be the first page element: ${pagePath}`);
      }
    } else if (rootViewMatch) {
      fail(`Unable to verify root page element for auth identity bar: ${pagePath}`);
    }
  }

  const appSource = fs.readFileSync(path.join(srcRoot, "App.vue"), "utf8");
  if (/url\(\s*["']?\/?static\/[^)"']+\.(?:png|jpe?g|gif|webp|svg)/.test(appSource)) {
    fail("Global App.vue styles must not use local /static images in CSS url(); use <image> instead");
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
