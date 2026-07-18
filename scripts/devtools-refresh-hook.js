import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_REQUIRED_DEV_FILES,
  DEFAULT_WATCHED_PATHS,
  inspectDevArtifacts,
  planRefresh
} from "./miniprogram-dev-artifacts.js";

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
const rebuild = process.argv.includes("--rebuild");
const devOutputReadyTimeoutMs = 8000;
const devOutputReadyPollMs = 250;

function readState() {
  try {
    return JSON.parse(readFileSync(statePath, "utf8"));
  } catch {
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

function inspectCurrentOutput() {
  return inspectDevArtifacts({
    root,
    devDist,
    watchedPaths: DEFAULT_WATCHED_PATHS,
    requiredFiles: DEFAULT_REQUIRED_DEV_FILES
  });
}

async function waitForDevOutput() {
  const deadline = Date.now() + devOutputReadyTimeoutMs;
  while (Date.now() <= deadline) {
    const result = inspectCurrentOutput();
    if (result.status === "ready") {
      return result;
    }
    await sleep(devOutputReadyPollMs);
  }
  return inspectCurrentOutput();
}

async function openDevToolsProject() {
  if (!existsSync(cliPath)) {
    warn(`WeChat DevTools CLI not found: ${cliPath}`);
    warn("Set WECHAT_DEVTOOLS_CLI if your CLI is installed elsewhere.");
    return false;
  }

  const output = await waitForDevOutput();
  if (output.status !== "ready") {
    warn(`Refusing to open ${devDist}: ${output.reason}.`);
    warn("Run npm run devtools:refresh to rebuild the latest miniprogram output.");
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

  log("WeChat DevTools refresh triggered with current source fingerprint.");
  return true;
}

export async function main() {
  const state = readState();
  const output = inspectCurrentOutput();
  const decision = planRefresh({ artifactStatus: output.status, rebuild });

  if (decision.action === "skip") {
    warn(`Refusing stale or incomplete dev output: ${output.reason}.`);
    warn(decision.guidance);
    writeState({
      fingerprint: state.fingerprint || null,
      lastStatus: "skipped",
      artifactStatus: output.status,
      artifactReason: output.reason,
      cliPath,
      projectPath: devDist,
      devDist
    });
    process.exitCode = decision.exitCode;
    return false;
  }

  const shouldRefresh =
    force ||
    state.lastStatus !== "refreshed" ||
    state.fingerprint !== output.currentFingerprint;
  if (!shouldRefresh) {
    return true;
  }

  const ok = await openDevToolsProject();
  writeState({
    fingerprint: ok ? output.currentFingerprint : state.fingerprint || null,
    watchedPaths: DEFAULT_WATCHED_PATHS,
    lastStatus: ok ? "refreshed" : "skipped",
    artifactStatus: output.status,
    artifactReason: output.reason,
    cliPath,
    projectPath: devDist,
    devDist
  });
  if (!ok) {
    process.exitCode = 2;
  }
  return ok;
}

if (path.resolve(process.argv[1] || "") === __filename) {
  await main();
}
