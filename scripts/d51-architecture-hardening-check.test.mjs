import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { validateHttpKernelBoundary } from "./d51-architecture-hardening-check.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const checker = path.join(repoRoot, "scripts/d51-architecture-hardening-check.js");

function runChecker(...args) {
  return spawnSync(process.execPath, [checker, ...args], {
    cwd: repoRoot,
    encoding: "utf8"
  });
}

test("D51 baseline mode records known architecture gaps without hiding them", () => {
  const result = runChecker("--allow-red");
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /D51 baseline gaps:/);
  assert.match(result.stdout, /MISSING_MODULE_ENTRY/);
  assert.doesNotMatch(result.stdout, /PRODUCTION_API_RUNS_MIGRATIONS/);
});

test("D51 strict mode remains red while target architecture gaps exist", () => {
  const result = runChecker();
  assert.notEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(`${result.stdout}\n${result.stderr}`, /D51 architecture hardening check failed/);
});

test("D51 locks the process entrypoint and legacy fallback against new business routing", () => {
  assert.deepEqual(validateHttpKernelBoundary({
    entrypointSource: [
      'import { createApp } from "./app/create-app.js";',
      "export function startServer() {}",
      'export * from "./legacy-app.js";',
    ].join("\n"),
    legacySource: "export async function legacyRoute(context) { return false; }",
  }), []);

  const findings = validateHttpKernelBoundary({
    entrypointSource: [
      'import { createApp } from "./app/create-app.js";',
      "export function startServer() {}",
      'if (url.pathname === "/api/new-feature") {}',
    ].join("\n"),
    legacySource: `${"// legacy\n".repeat(6_537)}export async function route() {}`,
  });

  assert.deepEqual(findings.map(({ code }) => code), [
    "SERVER_BUSINESS_ROUTE",
    "LEGACY_ROUTE_BOUNDARY_MISSING",
    "LEGACY_ROUTE_GREW",
  ]);
});
