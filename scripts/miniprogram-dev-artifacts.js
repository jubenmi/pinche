import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync
} from "node:fs";
import path from "node:path";

export const BUILD_FINGERPRINT_FILE = ".codex-source-fingerprint.json";
export const BUILD_FINGERPRINT_VERSION = 1;

export const DEFAULT_WATCHED_PATHS = [
  "apps/miniprogram/src",
  "apps/miniprogram/package.json",
  "apps/miniprogram/project.config.json",
  "apps/miniprogram/vite.config.js",
  "packages/shared/src",
  "packages/shared/package.json",
  "packages/talk/miniprogram",
  "packages/talk/package.json",
  "package.json"
];

export const DEFAULT_REQUIRED_DEV_FILES = [
  "app.js",
  "app.json",
  "project.config.json",
  "common/vendor.js",
  "pages/session/manage.js",
  "pages/session/manage.json",
  "pages/session/manage.wxml",
  "components/SessionCalendar.js",
  "components/SessionCalendar.json",
  "components/SessionCalendar.wxml",
  "wxcomponents/tdesign-miniprogram/image/image.json",
  "wxcomponents/tdesign-miniprogram/image/image.wxml",
  "wxcomponents/tdesign-miniprogram/image/image.js"
];

function normalizedRelativePath(root, target) {
  return path.relative(root, target).split(path.sep).join("/");
}

function collectFiles(root, target, files) {
  if (!existsSync(target)) {
    files.push({ path: normalizedRelativePath(root, target), missing: true });
    return;
  }

  const stats = statSync(target);
  if (!stats.isDirectory()) {
    files.push({ path: normalizedRelativePath(root, target), absolutePath: target });
    return;
  }

  for (const entry of readdirSync(target, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name)
  )) {
    if (entry.name === "node_modules" || entry.name === "dist") {
      continue;
    }
    collectFiles(root, path.join(target, entry.name), files);
  }
}

function fileContentHash(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

export function buildSourceSnapshot({ root, watchedPaths = DEFAULT_WATCHED_PATHS }) {
  const collectedFiles = [];
  for (const watchedPath of [...watchedPaths].sort()) {
    collectFiles(root, path.resolve(root, watchedPath), collectedFiles);
  }

  const entries = collectedFiles
    .map((file) =>
      file.missing
        ? { path: file.path, missing: true }
        : { path: file.path, sha256: fileContentHash(file.absolutePath) }
    )
    .sort((a, b) => a.path.localeCompare(b.path));
  const fingerprint = createHash("sha256")
    .update(JSON.stringify(entries))
    .digest("hex");

  return {
    version: BUILD_FINGERPRINT_VERSION,
    fingerprint,
    watchedPaths: [...watchedPaths],
    entries
  };
}

export function fingerprintPath(devDist) {
  return path.join(devDist, BUILD_FINGERPRINT_FILE);
}

export function writeBuildFingerprint({ devDist, snapshot, generatedAt = new Date() }) {
  mkdirSync(devDist, { recursive: true });
  const target = fingerprintPath(devDist);
  const temporary = `${target}.tmp-${process.pid}`;
  const manifest = {
    version: BUILD_FINGERPRINT_VERSION,
    fingerprint: snapshot.fingerprint,
    generatedAt: generatedAt.toISOString(),
    watchedPaths: snapshot.watchedPaths,
    entries: snapshot.entries
  };
  writeFileSync(temporary, `${JSON.stringify(manifest, null, 2)}\n`);
  renameSync(temporary, target);
  return manifest;
}

export function readBuildFingerprint(devDist) {
  try {
    return JSON.parse(readFileSync(fingerprintPath(devDist), "utf8"));
  } catch {
    return null;
  }
}

function invalidRequiredJsonFiles(devDist, requiredFiles) {
  const invalid = [];
  for (const requiredFile of requiredFiles.filter((file) => file.endsWith(".json"))) {
    try {
      JSON.parse(readFileSync(path.join(devDist, requiredFile), "utf8"));
    } catch {
      invalid.push(requiredFile);
    }
  }
  return invalid;
}

export function inspectDevArtifacts({
  root,
  devDist,
  watchedPaths = DEFAULT_WATCHED_PATHS,
  requiredFiles = DEFAULT_REQUIRED_DEV_FILES
}) {
  const missingFiles = requiredFiles.filter(
    (requiredFile) => !existsSync(path.join(devDist, requiredFile))
  );
  if (missingFiles.length > 0) {
    return { status: "incomplete", reason: "missing-required-files", missingFiles };
  }

  const invalidJsonFiles = invalidRequiredJsonFiles(devDist, requiredFiles);
  if (invalidJsonFiles.length > 0) {
    return { status: "incomplete", reason: "invalid-required-json", invalidJsonFiles };
  }

  const currentSnapshot = buildSourceSnapshot({ root, watchedPaths });
  const buildFingerprint = readBuildFingerprint(devDist);
  if (!buildFingerprint) {
    return {
      status: "stale",
      reason: "missing-fingerprint",
      currentFingerprint: currentSnapshot.fingerprint
    };
  }

  if (
    buildFingerprint.version !== BUILD_FINGERPRINT_VERSION ||
    buildFingerprint.fingerprint !== currentSnapshot.fingerprint
  ) {
    return {
      status: "stale",
      reason: "fingerprint-mismatch",
      builtFingerprint: buildFingerprint.fingerprint,
      currentFingerprint: currentSnapshot.fingerprint
    };
  }

  return {
    status: "ready",
    reason: "fingerprint-match",
    builtFingerprint: buildFingerprint.fingerprint,
    currentFingerprint: currentSnapshot.fingerprint,
    generatedAt: buildFingerprint.generatedAt
  };
}

export function planRefresh({ artifactStatus, rebuild }) {
  if (artifactStatus === "ready") {
    return {
      action: "open",
      shouldBuild: false,
      shouldOpen: true,
      exitCode: 0
    };
  }

  return {
    action: "skip",
    shouldBuild: false,
    shouldOpen: false,
    exitCode: 2,
    guidance: rebuild
      ? "Rebuild support is unavailable."
      : "Run npm run devtools:refresh to rebuild the latest miniprogram output."
  };
}
