import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const AUTOMATOR_VERSION = "0.12.1";
const CLI_PATH =
  process.env.PINCHE_WECHAT_CLI_PATH ||
  "/Applications/wechatwebdevtools.app/Contents/MacOS/cli";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const projectPath = path.resolve(
  process.env.PINCHE_MINIPROGRAM_PROJECT_PATH ||
    path.join(root, "apps/miniprogram/dist/build/mp-weixin")
);
const automatorRoot = path.resolve(
  process.env.PINCHE_MINIPROGRAM_AUTOMATOR_CACHE ||
    path.join(os.tmpdir(), `pinche-miniprogram-automator-${AUTOMATOR_VERSION}`)
);

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function withTimeout(promise, milliseconds, message) {
  return Promise.race([
    promise,
    delay(milliseconds).then(() => {
      throw new Error(message);
    })
  ]);
}

function printable(value) {
  if (value instanceof Error) {
    return value.stack || value.message;
  }
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function ensureAutomator() {
  const packageJsonPath = path.join(
    automatorRoot,
    "node_modules/miniprogram-automator/package.json"
  );
  let installedVersion = "";
  if (fs.existsSync(packageJsonPath)) {
    installedVersion = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")).version || "";
  }
  if (installedVersion !== AUTOMATOR_VERSION) {
    fs.mkdirSync(automatorRoot, { recursive: true });
    const result = spawnSync(
      "npm",
      [
        "install",
        "--prefix",
        automatorRoot,
        "--no-save",
        `miniprogram-automator@${AUTOMATOR_VERSION}`
      ],
      { stdio: "inherit" }
    );
    assert.equal(result.status, 0, "Failed to install miniprogram-automator in the temp cache");
  }

  const require = createRequire(import.meta.url);
  const packageRoot = path.join(automatorRoot, "node_modules/miniprogram-automator");
  const MiniProgram = require(path.join(packageRoot, "out/MiniProgram.js")).default;
  const originalCheckVersion = MiniProgram.prototype.checkVersion;
  MiniProgram.prototype.checkVersion = async function checkCurrentDevToolsVersion() {
    const info = await this.send("Tool.getInfo");
    assert.ok(info && typeof info === "object", "WeChat DevTools automation info is unavailable");
    if (info.SDKVersion) {
      return originalCheckVersion.call(this);
    }
    return undefined;
  };
  return require(packageRoot);
}

async function readHomeAction(page) {
  const calendar = await page.$("session-calendar");
  if (!calendar) {
    return { calendar: null, button: null, text: "", wxml: "" };
  }
  const button = await calendar.$(".primary-quiet-button");
  let text = "";
  let wxml = "";
  if (button) {
    try {
      text = String((await button.text()) || "").trim();
    } catch {
      text = "";
    }
  }
  try {
    wxml = String((await calendar.wxml()) || "");
  } catch {
    wxml = "";
  }
  return { calendar, button, text, wxml };
}

async function waitForHomeAction(page, expectedText, timeout = 30000) {
  const deadline = Date.now() + timeout;
  let lastState = { text: "", wxml: "" };
  while (Date.now() < deadline) {
    lastState = await readHomeAction(page);
    if (lastState.text.includes(expectedText) || lastState.wxml.includes(expectedText)) {
      return lastState;
    }
    await delay(500);
  }
  throw new Error(
    `Timed out waiting for home action “${expectedText}”; last text=${JSON.stringify(
      lastState.text
    )}`
  );
}

async function confirmLogin(page, miniProgram) {
  const deadline = Date.now() + 15000;
  let attempt = 0;
  while (Date.now() < deadline) {
    const currentState = await readHomeAction(page);
    if (
      currentState.text.includes("我的车局（点击创建）") ||
      currentState.wxml.includes("我的车局（点击创建）")
    ) {
      return;
    }

    if (attempt > 0 && currentState.button) {
      await currentState.button.tap();
    }
    attempt += 1;
    await delay(500);

    try {
      await miniProgram.native().confirmModal();
      return;
    } catch {
      // Keep polling: the page can rerender or the native modal can appear late.
    }

    const feedbackHost = await page.$("feedback-host");
    const dialog = feedbackHost ? await feedbackHost.$("#t-dialog") : null;
    if (dialog && typeof dialog.callMethod === "function") {
      await dialog.callMethod("onConfirm");
      return;
    }
  }

  throw new Error("Login confirmation dialog could not be confirmed within 15 seconds");
}

assert.ok(fs.existsSync(CLI_PATH), `WeChat DevTools CLI is missing: ${CLI_PATH}`);
assert.ok(fs.existsSync(projectPath), `Production miniprogram build is missing: ${projectPath}`);

const builtAppPath = path.join(projectPath, "app.js");
assert.ok(fs.existsSync(builtAppPath), "Production app.js is missing; run the build first");
const builtApp = fs.readFileSync(builtAppPath, "utf8");
assert.match(
  builtApp,
  /https:\/\/api\.pinche\.jubenmi\.com/,
  "Smoke test must run a production bundle configured for the production API"
);
assert.doesNotMatch(
  builtApp,
  /apiBaseUrl:\s*["']https?:\/\/(?:localhost|127\.0\.0\.1)/,
  "Smoke test must not run against a local API"
);

const automator = ensureAutomator();
const exceptions = [];
let miniProgram = null;

try {
  miniProgram = await automator.launch({
    cliPath: CLI_PATH,
    projectPath,
    timeout: 60000,
    trustProject: true
  });
  miniProgram.on("exception", (exception) => {
    exceptions.push(printable(exception));
  });

  console.log(`WeChat DevTools opened production bundle: ${projectPath}`);
  console.log("If the simulator shows the welcome screen, click “编译” once within 120 seconds.");
  const initialPage = await withTimeout(
    miniProgram.reLaunch("/pages/index/index"),
    120000,
    "WeChat DevTools simulator is not running. Click “编译” once for this production-build path, then rerun the smoke test."
  );
  assert.ok(initialPage, "Production miniprogram did not start");
  await miniProgram.evaluate(() => {
    const app = getApp();
    app.globalData.token = "";
    app.globalData.authBaseUrl = "";
    app.globalData.user = null;
    app.globalData.roles = [];
    wx.clearStorageSync();
    return true;
  });

  const page = await miniProgram.reLaunch("/pages/index/index");
  assert.ok(page, "Home page did not open");

  const guestState = await waitForHomeAction(page, "我的车局（点击登录）");
  assert.ok(guestState.button, "Guest login button is missing");
  console.log("Fresh guest state confirmed; starting real wx.login");
  await guestState.button.tap();
  await confirmLogin(page, miniProgram);

  await waitForHomeAction(page, "我的车局（点击创建）", 30000);
  const auth = await miniProgram.evaluate(() => {
    const app = getApp();
    return {
      apiBaseUrl: app.globalData.apiBaseUrl,
      hasToken: Boolean(app.globalData.token || wx.getStorageSync("pinche_token")),
      userId: Number((app.globalData.user || wx.getStorageSync("pinche_user") || {}).id || 0)
    };
  });

  assert.equal(auth.apiBaseUrl, "https://api.pinche.jubenmi.com");
  assert.equal(auth.hasToken, true, "Real WeChat login did not persist an auth token");
  assert.ok(auth.userId > 0, "Real WeChat login did not load a user");
  assert.deepEqual(exceptions, [], `Runtime exceptions occurred:\n${exceptions.join("\n")}`);

  console.log(
    `Miniprogram production real-login smoke passed (user ${auth.userId}, API ${auth.apiBaseUrl})`
  );
} catch (error) {
  if (miniProgram) {
    const screenshotPath = path.join(os.tmpdir(), `pinche-production-login-${Date.now()}.png`);
    try {
      await withTimeout(miniProgram.screenshot({ path: screenshotPath }), 5000, "screenshot timeout");
      console.error(`Failure screenshot: ${screenshotPath}`);
    } catch {
      // Keep the original failure when a screenshot is unavailable.
    }
  }
  if (exceptions.length > 0) {
    console.error(`Runtime exceptions:\n${exceptions.join("\n")}`);
  }
  throw error;
} finally {
  if (miniProgram) {
    if (process.env.PINCHE_CLOSE_DEVTOOLS === "1") {
      try {
        await withTimeout(miniProgram.close(), 5000, "close timeout");
      } catch {
        miniProgram.disconnect();
      }
    } else {
      miniProgram.disconnect();
    }
  }
}
