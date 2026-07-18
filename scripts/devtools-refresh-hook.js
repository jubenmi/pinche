import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildSourceSnapshot,
  DEFAULT_REQUIRED_DEV_FILES,
  DEFAULT_WATCHED_PATHS,
  inspectDevArtifacts,
  inspectRequiredArtifacts,
  planRefresh,
  writeBuildFingerprint
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
const buildTimeoutMs = 120000;
const initialBuildCompletePattern = /DONE\s+Build complete\. Watching for changes\.\.\./;

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

function inspectCurrentRequiredOutput() {
  return inspectRequiredArtifacts({
    devDist,
    requiredFiles: DEFAULT_REQUIRED_DEV_FILES
  });
}

function terminateBuildProcess(child) {
  if (child.exitCode !== null || child.killed) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(forceKillTimer);
      child.off("close", finish);
      resolve();
    };
    const forceKillTimer = setTimeout(() => {
      if (child.exitCode === null) {
        child.kill("SIGTERM");
      }
      finish();
    }, 2000);
    child.once("close", finish);
    child.kill("SIGINT");
  });
}

export async function rebuildDevOutput({
  spawnBuild = () =>
    spawn("npm", ["--workspace", "apps/miniprogram", "run", "dev:mp-weixin"], {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"]
    }),
  inspectRequiredOutput = inspectCurrentRequiredOutput,
  captureSnapshot = () =>
    buildSourceSnapshot({ root, watchedPaths: DEFAULT_WATCHED_PATHS }),
  persistFingerprint = (snapshot) => writeBuildFingerprint({ devDist, snapshot }),
  timeoutMs = buildTimeoutMs,
  pollMs = devOutputReadyPollMs,
  writeStdout = (chunk) => process.stdout.write(chunk),
  writeStderr = (chunk) => process.stderr.write(chunk)
} = {}) {
  const child = spawnBuild();
  let buildReportedComplete = false;
  let stdoutBuffer = "";

  try {
    return await new Promise((resolve, reject) => {
      let settled = false;
      const finish = (callback, value) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        clearInterval(poll);
        callback(value);
      };
      const tryComplete = () => {
        if (!buildReportedComplete || inspectRequiredOutput().status !== "complete") {
          return;
        }
        try {
          const snapshot = captureSnapshot();
          persistFingerprint(snapshot);
          finish(resolve, snapshot);
        } catch (error) {
          finish(reject, error);
        }
      };
      const timeout = setTimeout(
        () => finish(reject, new Error(`Miniprogram dev build timed out after ${timeoutMs}ms`)),
        timeoutMs
      );
      const poll = setInterval(tryComplete, pollMs);

      child.stdout?.on("data", (chunk) => {
        writeStdout(chunk);
        stdoutBuffer = `${stdoutBuffer}${chunk.toString()}`.slice(-4096);
        if (initialBuildCompletePattern.test(stdoutBuffer)) {
          buildReportedComplete = true;
          tryComplete();
        }
      });
      child.stderr?.on("data", writeStderr);
      child.once("error", (error) => finish(reject, error));
      child.once("close", (code, signal) => {
        if (!settled) {
          finish(
            reject,
            new Error(`Miniprogram dev build exited before completion (${code ?? signal ?? "unknown"})`)
          );
        }
      });
    });
  } finally {
    await terminateBuildProcess(child);
  }
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
  let output = inspectCurrentOutput();
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

  if (decision.action === "build") {
    try {
      log("Building current miniprogram source before refresh...");
      await rebuildDevOutput();
      output = inspectCurrentOutput();
    } catch (error) {
      warn(error.message);
      writeState({
        fingerprint: state.fingerprint || null,
        lastStatus: "build-failed",
        artifactStatus: output.status,
        artifactReason: output.reason,
        cliPath,
        projectPath: devDist,
        devDist
      });
      process.exitCode = 2;
      return false;
    }

    if (output.status !== "ready") {
      warn(`Build completed but current output is ${output.status}: ${output.reason}.`);
      process.exitCode = 2;
      return false;
    }
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
