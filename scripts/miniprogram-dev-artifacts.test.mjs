import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";

import {
  buildSourceSnapshot,
  inspectDevArtifacts,
  planRefresh,
  writeBuildFingerprint
} from "./miniprogram-dev-artifacts.js";
import { rebuildDevOutput } from "./devtools-refresh-hook.js";

const watchedPaths = ["src", "package.json"];
const requiredFiles = [
  "app.json",
  "pages/session/manage.js",
  "components/SessionCalendar.js",
  "common/vendor.js",
  "wxcomponents/tdesign-miniprogram/image/image.js"
];

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), "pinche-dev-artifacts-"));
  const devDist = path.join(root, "dist/dev/mp-weixin");
  mkdirSync(path.join(root, "src"), { recursive: true });
  writeFileSync(path.join(root, "src/main.js"), "export const value = 1;\n");
  writeFileSync(path.join(root, "package.json"), '{"name":"fixture"}\n');
  for (const requiredFile of requiredFiles) {
    const absolutePath = path.join(devDist, requiredFile);
    mkdirSync(path.dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, requiredFile.endsWith(".json") ? "{}\n" : "// built\n");
  }
  return {
    root,
    devDist,
    cleanup() {
      rmSync(root, { recursive: true, force: true });
    }
  };
}

test("existing output without a build fingerprint is stale", () => {
  const project = fixture();
  try {
    const result = inspectDevArtifacts({
      root: project.root,
      devDist: project.devDist,
      watchedPaths,
      requiredFiles
    });

    assert.equal(result.status, "stale");
    assert.equal(result.reason, "missing-fingerprint");
  } finally {
    project.cleanup();
  }
});

test("a fingerprint from older source content is stale", () => {
  const project = fixture();
  try {
    const snapshot = buildSourceSnapshot({ root: project.root, watchedPaths });
    writeBuildFingerprint({ devDist: project.devDist, snapshot });
    writeFileSync(path.join(project.root, "src/main.js"), "export const value = 2;\n");

    const result = inspectDevArtifacts({
      root: project.root,
      devDist: project.devDist,
      watchedPaths,
      requiredFiles
    });

    assert.equal(result.status, "stale");
    assert.equal(result.reason, "fingerprint-mismatch");
    assert.notEqual(result.builtFingerprint, result.currentFingerprint);
  } finally {
    project.cleanup();
  }
});

test("a missing required page makes otherwise matching output incomplete", () => {
  const project = fixture();
  try {
    const snapshot = buildSourceSnapshot({ root: project.root, watchedPaths });
    writeBuildFingerprint({ devDist: project.devDist, snapshot });
    rmSync(path.join(project.devDist, "pages/session/manage.js"));

    const result = inspectDevArtifacts({
      root: project.root,
      devDist: project.devDist,
      watchedPaths,
      requiredFiles
    });

    assert.equal(result.status, "incomplete");
    assert.equal(result.reason, "missing-required-files");
    assert.deepEqual(result.missingFiles, ["pages/session/manage.js"]);
  } finally {
    project.cleanup();
  }
});

test("matching source fingerprint and complete readable output is ready", () => {
  const project = fixture();
  try {
    const snapshot = buildSourceSnapshot({ root: project.root, watchedPaths });
    writeBuildFingerprint({ devDist: project.devDist, snapshot });

    const result = inspectDevArtifacts({
      root: project.root,
      devDist: project.devDist,
      watchedPaths,
      requiredFiles
    });

    assert.equal(result.status, "ready");
    assert.equal(result.builtFingerprint, snapshot.fingerprint);
    assert.equal(result.currentFingerprint, snapshot.fingerprint);
  } finally {
    project.cleanup();
  }
});

test("invalid required JSON makes output incomplete", () => {
  const project = fixture();
  try {
    const snapshot = buildSourceSnapshot({ root: project.root, watchedPaths });
    writeBuildFingerprint({ devDist: project.devDist, snapshot });
    writeFileSync(path.join(project.devDist, "app.json"), "not-json\n");

    const result = inspectDevArtifacts({
      root: project.root,
      devDist: project.devDist,
      watchedPaths,
      requiredFiles
    });

    assert.equal(result.status, "incomplete");
    assert.equal(result.reason, "invalid-required-json");
    assert.deepEqual(result.invalidJsonFiles, ["app.json"]);
  } finally {
    project.cleanup();
  }
});

test("automatic refresh refuses stale output without starting a build", () => {
  const decision = planRefresh({ artifactStatus: "stale", rebuild: false });

  assert.deepEqual(decision, {
    action: "skip",
    shouldBuild: false,
    shouldOpen: false,
    exitCode: 2,
    guidance: "Run npm run devtools:refresh to rebuild the latest miniprogram output."
  });
});

test("automatic refresh opens only already-ready output", () => {
  const decision = planRefresh({ artifactStatus: "ready", rebuild: false });

  assert.equal(decision.action, "open");
  assert.equal(decision.shouldBuild, false);
  assert.equal(decision.shouldOpen, true);
  assert.equal(decision.exitCode, 0);
});

class FakeBuildProcess extends EventEmitter {
  constructor() {
    super();
    this.stdout = new PassThrough();
    this.stderr = new PassThrough();
    this.exitCode = null;
    this.killedWith = [];
  }

  kill(signal) {
    this.killedWith.push(signal);
    this.exitCode = 0;
    queueMicrotask(() => this.emit("close", 0, signal));
    return true;
  }
}

test("explicit rebuild writes the current fingerprint only after initial output is complete", async () => {
  const child = new FakeBuildProcess();
  const events = [];
  const rebuilt = rebuildDevOutput({
    spawnBuild: () => child,
    inspectRequiredOutput: () => ({ status: "complete" }),
    captureSnapshot: () => {
      events.push("snapshot");
      return { fingerprint: "current" };
    },
    persistFingerprint: (snapshot) => events.push(`persist:${snapshot.fingerprint}`),
    timeoutMs: 1000,
    pollMs: 5,
    writeStdout: () => {},
    writeStderr: () => {}
  });

  child.stdout.write("DONE  Build complete. Watching for changes...\n");
  const result = await rebuilt;

  assert.deepEqual(events, ["snapshot", "persist:current"]);
  assert.equal(result.fingerprint, "current");
  assert.deepEqual(child.killedWith, ["SIGINT"]);
});

test("failed or timed-out rebuild terminates the watcher without writing a fingerprint", async () => {
  const child = new FakeBuildProcess();
  let persisted = false;

  await assert.rejects(
    rebuildDevOutput({
      spawnBuild: () => child,
      inspectRequiredOutput: () => ({ status: "incomplete" }),
      captureSnapshot: () => ({ fingerprint: "must-not-persist" }),
      persistFingerprint: () => {
        persisted = true;
      },
      timeoutMs: 20,
      pollMs: 5,
      writeStdout: () => {},
      writeStderr: () => {}
    }),
    /timed out/
  );

  assert.equal(persisted, false);
  assert.deepEqual(child.killedWith, ["SIGINT"]);
});

test("stale output with explicit rebuild requests build before open", () => {
  const decision = planRefresh({ artifactStatus: "stale", rebuild: true });

  assert.equal(decision.action, "build");
  assert.equal(decision.shouldBuild, true);
  assert.equal(decision.shouldOpen, false);
});
