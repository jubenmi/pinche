import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

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
