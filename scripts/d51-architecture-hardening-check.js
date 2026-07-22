import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const specDir = path.join(repoRoot, "specs/d51-architecture-hardening-modularization");
const historicalDuplicatePrefixes = new Set(["0021", "0022", "0024", "0030", "0032"]);
const targetModuleEntries = [
  "apps/api/src/modules/auth/index.js",
  "apps/api/src/modules/catalog/index.js",
  "apps/api/src/modules/sessions/index.js",
  "apps/api/src/modules/signups/index.js",
  "apps/api/src/modules/album/index.js",
  "apps/api/src/modules/reviews/index.js",
  "apps/api/src/modules/notifications/index.js"
];

function finding(code, message) {
  return { code, message };
}

const LEGACY_ROUTE_LINE_LIMIT = 6_537;

export function validateHttpKernelBoundary({ entrypointSource, legacySource }) {
  const findings = [];
  const entrypointLines = entrypointSource.split(/\r?\n/).length;
  const legacyLines = legacySource.split(/\r?\n/).length;

  if (entrypointLines > 80) {
    findings.push(finding(
      "SERVER_ENTRYPOINT_GREW",
      `apps/api/src/server.js has ${entrypointLines} lines; the process entrypoint limit is 80`
    ));
  }
  if (/url\.pathname|["'`]\/api\/|\bwithTransaction\b|\breadBody\b/.test(entrypointSource)) {
    findings.push(finding(
      "SERVER_BUSINESS_ROUTE",
      "apps/api/src/server.js must not contain business routing, transactions, or body parsing"
    ));
  }
  if (!/export\s+(?:async\s+)?function\s+legacyRoute\b/.test(legacySource)) {
    findings.push(finding(
      "LEGACY_ROUTE_BOUNDARY_MISSING",
      "apps/api/src/legacy-app.js must expose the explicit legacyRoute fallback"
    ));
  }
  if (legacyLines > LEGACY_ROUTE_LINE_LIMIT) {
    findings.push(finding(
      "LEGACY_ROUTE_GREW",
      `apps/api/src/legacy-app.js has ${legacyLines} lines; new behavior must use a module router`
    ));
  }
  if (/\.listen\s*\(|\bcreateServer\s*\(/.test(legacySource)) {
    findings.push(finding(
      "LEGACY_OWNS_HTTP_LIFECYCLE",
      "apps/api/src/legacy-app.js must not own server creation or listening"
    ));
  }
  return findings;
}

export function validateMigrationFilenames(
  filenames,
  { historicalDuplicates = historicalDuplicatePrefixes } = {}
) {
  const findings = [];
  const byPrefix = new Map();

  for (const filename of filenames) {
    const match = /^(\d{4})_[a-z0-9][a-z0-9_]*\.sql$/.exec(filename);
    if (!match) {
      findings.push(finding(
        "INVALID_MIGRATION_FILENAME",
        `${filename} must use NNNN_snake_case.sql`
      ));
      continue;
    }
    const entries = byPrefix.get(match[1]) || [];
    entries.push(filename);
    byPrefix.set(match[1], entries);
  }

  for (const [prefix, entries] of byPrefix) {
    if (entries.length <= 1) continue;
    if (historicalDuplicates.has(prefix)) continue;
    findings.push(finding(
      "DUPLICATE_NEW_MIGRATION_PREFIX",
      `${prefix} is used by ${entries.join(", ")}`
    ));
  }

  return findings;
}

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

export function collectD51Findings() {
  const findings = [];
  const requiredSpecs = ["requirements.md", "design.md", "tasks.md"];

  for (const filename of requiredSpecs) {
    const absolutePath = path.join(specDir, filename);
    if (!fs.existsSync(absolutePath)) {
      findings.push(finding("MISSING_SPEC_FILE", filename));
    }
  }

  if (fs.existsSync(path.join(specDir, "design.md"))) {
    const design = fs.readFileSync(path.join(specDir, "design.md"), "utf8");
    for (const entry of targetModuleEntries) {
      const moduleName = entry.split("/").at(-2);
      if (!design.includes(`${moduleName}/`)) {
        findings.push(finding(
          "MISSING_TARGET_MODULE_DESIGN",
          `design.md does not declare the ${moduleName} module`
        ));
      }
    }
  }

  for (const entry of targetModuleEntries) {
    if (!fs.existsSync(path.join(repoRoot, entry))) {
      findings.push(finding("MISSING_MODULE_ENTRY", entry));
    }
  }

  const entrypoint = read("apps/api/docker-entrypoint.sh");
  const migrationIsExplicit = /RUN_MIGRATIONS_ON_START/.test(entrypoint);
  if (/npm run migrate/.test(entrypoint) && !migrationIsExplicit) {
    findings.push(finding(
      "PRODUCTION_API_RUNS_MIGRATIONS",
      "apps/api/docker-entrypoint.sh runs migrations without RUN_MIGRATIONS_ON_START=true"
    ));
  }

  const productionCompose = read("docker-compose.prod.example.yml");
  if (!/^\s{2}migrate:\s*$/m.test(productionCompose)) {
    findings.push(finding(
      "MISSING_PRODUCTION_MIGRATE_SERVICE",
      "docker-compose.prod.example.yml needs an independent migrate service"
    ));
  }

  const migrationDir = path.join(repoRoot, "apps/api/migrations");
  const migrations = fs.readdirSync(migrationDir)
    .filter((filename) => filename.endsWith(".sql"))
    .sort();
  findings.push(...validateMigrationFilenames(migrations));

  findings.push(...validateHttpKernelBoundary({
    entrypointSource: read("apps/api/src/server.js"),
    legacySource: read("apps/api/src/legacy-app.js")
  }));

  return findings;
}

export function runD51Check({ allowRed = false } = {}) {
  const findings = collectD51Findings();
  if (findings.length === 0) {
    process.stdout.write("D51 architecture hardening checks passed\n");
    return 0;
  }

  const lines = findings.map(({ code, message }) => `- ${code}: ${message}`).join("\n");
  const baselineOnlyCodes = new Set([
    "MISSING_MODULE_ENTRY",
    "PRODUCTION_API_RUNS_MIGRATIONS"
  ]);
  const unexpected = findings.filter(({ code }) => !baselineOnlyCodes.has(code));

  if (allowRed && unexpected.length === 0) {
    process.stdout.write(`D51 baseline gaps:\n${lines}\n`);
    return 0;
  }

  process.stderr.write(`D51 architecture hardening check failed:\n${lines}\n`);
  return 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  process.exitCode = runD51Check({ allowRed: process.argv.includes("--allow-red") });
}
