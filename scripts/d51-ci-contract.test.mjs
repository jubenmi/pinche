import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rootUrl = new URL("../", import.meta.url);

async function read(relativePath) {
  return readFile(new URL(relativePath, rootUrl), "utf8");
}

test("root scripts expose fast, unit, contract, integration, build, and local aggregate gates", async () => {
  const packageJson = JSON.parse(await read("package.json"));
  const scripts = packageJson.scripts;

  for (const name of [
    "check:fast",
    "test:unit",
    "test:contracts",
    "test:integration",
    "build:all",
    "check",
  ]) {
    assert.equal(typeof scripts[name], "string", `${name} must be defined`);
    assert.notEqual(scripts[name].trim(), "", `${name} must not be empty`);
  }

  assert.equal(
    scripts.check,
    "npm run check:fast && npm run test:unit && npm run test:contracts",
  );
  assert.equal(Object.hasOwn(scripts, "precheck"), false, "npm lifecycle must not run the old gate twice");
  assert.match(scripts["test:unit"], /d51:migrations/);
  assert.match(scripts["test:unit"], /d51:security/);
  assert.match(scripts["test:contracts"], /node --check/);
  assert.match(scripts["test:integration"], /docker compose -f docker-compose\.d51-test\.yml/);
  assert.match(scripts["test:integration"], /--exit-code-from acceptance/);
  assert.match(scripts["build:all"], /build:admin-web/);
  assert.match(scripts["build:all"], /build:mp-weixin/);
  assert.match(scripts["build:all"], /docker build/);
  assert.match(scripts["build:all"], /apps\/api\/Dockerfile/);
});

test("D51 integration compose owns an isolated MySQL 8.4 lifecycle", async () => {
  const compose = await read("docker-compose.d51-test.yml");

  assert.match(compose, /image:\s*mysql:8\.4/);
  assert.match(compose, /image:\s*redis:7(?:\.\d+)?-alpine/);
  for (const service of ["mysql", "redis", "migrate", "api", "acceptance"]) {
    assert.match(compose, new RegExp(`\\n  ${service}:`), `missing ${service} service`);
  }
  assert.match(compose, /MYSQL_DATABASE:\s*pinche_d51_test/);
  assert.match(
    compose,
    /migrate:[\s\S]*command:\s*\["\/bin\/sh",\s*"-c",\s*"npm run migrate && npm run migrate"\]/,
  );
  assert.match(compose, /api:[\s\S]*migrate:[\s\S]*condition:\s*service_completed_successfully/);
  assert.match(compose, /acceptance:[\s\S]*scripts\/d51-integration-smoke\.js/);
  assert.doesNotMatch(compose, /RUN_MIGRATIONS_ON_START:\s*["']?true/);
});

test("PR CI runs every D51 gate on Node 24 before a reusable publish dependency", async () => {
  const [ci, publish] = await Promise.all([
    read(".github/workflows/ci.yml"),
    read(".github/workflows/docker-publish.yml"),
  ]);

  assert.match(ci, /pull_request:/);
  assert.match(ci, /push:/);
  assert.match(ci, /workflow_call:/);
  assert.match(ci, /node-version:\s*["']?24["']?/);
  assert.match(ci, /run:\s*npm ci/);
  for (const command of [
    "npm run check:fast",
    "npm run test:unit",
    "npm run test:contracts",
    "npm run test:integration",
    "npm run build:all",
  ]) {
    assert.match(ci, new RegExp(`run:\\s*${command.replaceAll(" ", "\\s+")}`));
  }
  assert.doesNotMatch(ci, /dist\/|\.docker\/mysql|node_modules\/\.cache/);

  assert.match(publish, /ci:[\s\S]*uses:\s*\.\/\.github\/workflows\/ci\.yml/);
  assert.match(publish, /publish-images:[\s\S]*needs:\s*ci/);
  const login = publish.indexOf("docker/login-action");
  const dependency = publish.indexOf("needs: ci");
  assert.ok(dependency >= 0 && login > dependency, "registry login must remain after the CI dependency");
});
