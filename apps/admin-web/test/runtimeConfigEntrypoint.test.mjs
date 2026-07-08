import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const outputDir = mkdtempSync(join(tmpdir(), "pinche-admin-config-"));
const outputPath = join(outputDir, "config.js");

execFileSync("sh", ["apps/admin-web/docker-entrypoint.d/40-admin-runtime-config.sh"], {
  cwd: new URL("../../..", import.meta.url),
  env: {
    ...process.env,
    ADMIN_CONFIG_OUTPUT: outputPath,
    VITE_TENCENT_MAP_KEY: "runtime-key"
  },
  stdio: "pipe"
});

const configSource = readFileSync(outputPath, "utf8");

assert.match(configSource, /window\.__PINCH_ADMIN_CONFIG__/);
assert.match(configSource, /TENCENT_MAP_KEY: "runtime-key"/);
