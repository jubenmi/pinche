import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync
} from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");
const stateFileName = "pinche-devtools-refresh-state.json";
const statePath = path.join(tmpdir(), stateFileName);
const miniprogramProject = path.join(root, "apps/miniprogram");
const devDist = path.join(miniprogramProject, "dist/dev/mp-weixin");
const defaultCli = "/Applications/wechatwebdevtools.app/Contents/MacOS/cli";
const cliPath = process.env.WECHAT_DEVTOOLS_CLI || defaultCli;
const force = process.argv.includes("--force");
const devOutputReadyTimeoutMs = 8000;
const devOutputReadyPollMs = 250;
const devOutputReadyFiles = [
  "app.json",
  "project.config.json",
  "wxcomponents/tdesign-miniprogram/image/image.json",
  "wxcomponents/tdesign-miniprogram/image/image.wxml",
  "wxcomponents/tdesign-miniprogram/image/image.js"
];

const watchedPaths = [
  "apps/miniprogram/src",
  "apps/miniprogram/package.json",
  "apps/miniprogram/project.config.json",
  "apps/miniprogram/vite.config.js",
  "package.json"
];

function readState() {
  try {
    return JSON.parse(readFileSync(statePath, "utf8"));
  } catch (error) {
    return {};
  }
}

function writeState(patch) {
  mkdirSync(path.dirname(statePath), { recursive: true });
  writeFileSync(
    statePath,
    JSON.stringify(
      {
        ...readState(),
        ...patch,
        updatedAt: new Date().toISOString()
      },
      null,
      2
    )
  );
}

function latestMtimeMs(target) {
  const absolutePath = path.join(root, target);
  if (!existsSync(absolutePath)) {
    return 0;
  }

  const stats = statSync(absolutePath);
  if (!stats.isDirectory()) {
    return stats.mtimeMs;
  }

  return readdirSync(absolutePath, { withFileTypes: true }).reduce(
    (latest, entry) => {
      if (entry.name === "node_modules" || entry.name === "dist") {
        return latest;
      }
      return Math.max(latest, latestMtimeMs(path.join(target, entry.name)));
    },
    stats.mtimeMs
  );
}

function relevantSnapshot() {
  const latestMtime = Math.max(...watchedPaths.map(latestMtimeMs));
  return {
    latestMtime,
    watchedPaths
  };
}

function log(message) {
  console.log(`[devtools-refresh] ${message}`);
}

function warn(message) {
  console.warn(`[devtools-refresh] ${message}`);
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function canReadJson(file) {
  try {
    JSON.parse(readFileSync(file, "utf8"));
    return true;
  } catch (error) {
    return false;
  }
}

function isDevOutputReady() {
  for (const readyFile of devOutputReadyFiles) {
    if (!existsSync(path.join(devDist, readyFile))) {
      return false;
    }
  }
  return canReadJson(path.join(devDist, "app.json"));
}

async function waitForDevOutput() {
  const deadline = Date.now() + devOutputReadyTimeoutMs;
  while (Date.now() <= deadline) {
    if (isDevOutputReady()) {
      return true;
    }
    await sleep(devOutputReadyPollMs);
  }
  return false;
}

async function openDevToolsProject() {
  if (!existsSync(cliPath)) {
    warn(`WeChat DevTools CLI not found: ${cliPath}`);
    warn("Set WECHAT_DEVTOOLS_CLI if your CLI is installed elsewhere.");
    return false;
  }

  if (!(await waitForDevOutput())) {
    warn(`Dev build output is missing: ${path.join(devDist, "app.json")}`);
    warn("Run npm run dev:mp-weixin once so WeChat DevTools has dev output to load.");
    warn("Skipped refresh so DevTools does not load a half-written UniApp output directory.");
    return false;
  }

  try {
    const child = spawn(cliPath, ["open", "--project", devDist], {
      cwd: root,
      detached: true,
      stdio: "ignore"
    });
    child.unref();
  } catch (error) {
    warn(error.message);
    return false;
  }

  log("WeChat DevTools refresh triggered.");
  return true;
}

const state = readState();
const snapshot = relevantSnapshot();
const shouldRefresh =
  force ||
  state.lastStatus !== "refreshed" ||
  snapshot.latestMtime > Number(state.latestMtime || 0);

if (!shouldRefresh) {
  process.exit(0);
}

const ok = await openDevToolsProject();
writeState({
  latestMtime: ok ? snapshot.latestMtime : Number(state.latestMtime || 0),
  watchedPaths: snapshot.watchedPaths,
  lastStatus: ok ? "refreshed" : "skipped",
  cliPath,
  projectPath: devDist,
  devDist
});
