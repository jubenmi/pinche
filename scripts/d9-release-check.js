import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";

const releaseApiBaseUrl = process.env.RELEASE_API_BASE_URL || "";
const lockedApiBaseUrl = "https://api.pinche.jubenmi.com";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function read(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

function isHttpsUrl(value) {
  return /^https:\/\/[^/\s]+/.test(value);
}

function releaseUrl(pathname) {
  return `${releaseApiBaseUrl.replace(/\/+$/, "")}${pathname}`;
}

async function readReleaseJson(pathname) {
  const url = releaseUrl(pathname);
  const response = await fetch(url, {
    headers: {
      accept: "application/json"
    }
  });
  let payload = null;

  try {
    payload = await response.json();
  } catch (error) {
    throw new Error(`${url} should return JSON`);
  }

  assert(
    response.ok,
    `${url} should return 2xx, got ${response.status}: ${JSON.stringify(payload)}`
  );
  return payload;
}

async function assertProductionApiReady() {
  const health = await readReleaseJson("/health");
  assert(health.ok === true, "/health should report ok");
  assert(
    health.config?.wechatMockLogin === false,
    "/health should report production WeChat login"
  );

  const database = await readReleaseJson("/health/db");
  assert(database.ok === true, "/health/db should report ok");

  for (const pathname of ["/api/stores?limit=1", "/api/scripts?limit=1"]) {
    const payload = await readReleaseJson(pathname);
    assert(payload.ok === true, `${pathname} should report ok`);
    assert(Array.isArray(payload.data), `${pathname} should return a data array`);
  }
}

async function main() {
  const envExample = await read(".env.production.example");
  const manifest = JSON.parse(await read("apps/miniprogram/src/manifest.json"));
  const appSource = await read("apps/miniprogram/src/App.vue");
  const composeProd = await read("docker-compose.prod.example.yml");
  const buildAppJsPath = "apps/miniprogram/dist/build/mp-weixin/app.js";
  const buildAppJsonPath = "apps/miniprogram/dist/build/mp-weixin/app.json";

  assert(envExample.includes("NODE_ENV=production"), "production env should set NODE_ENV");
  assert(envExample.includes("WECHAT_MOCK_LOGIN=false"), "production env should disable mock login");
  assert(envExample.includes("WECHAT_APP_ID=wx2675a606d3bd242c"), "production env should use appid");
  assert(composeProd.includes("restart: unless-stopped"), "prod compose should restart services");
  assert(composeProd.includes("\n  migrate:"), "prod compose should include migration service");
  assert(composeProd.includes("npm run migrate"), "prod compose migration service should run migrations");
  assert(manifest["mp-weixin"]?.appid === "wx2675a606d3bd242c", "manifest appid should be set");
  assert(
    appSource.includes(`const productionApiBaseUrl = "${lockedApiBaseUrl}"`),
    "miniprogram should lock API base URL to production"
  );
  assert(
    !appSource.includes("import.meta.env.VITE_API_BASE_URL"),
    "miniprogram should not allow release env to override API base URL"
  );
  assert(existsSync(new URL(`../${buildAppJsPath}`, import.meta.url)), "mp-weixin build app.js missing");
  assert(existsSync(new URL(`../${buildAppJsonPath}`, import.meta.url)), "mp-weixin build app.json missing");

  if (releaseApiBaseUrl) {
    assert(isHttpsUrl(releaseApiBaseUrl), "RELEASE_API_BASE_URL should be an https URL");
    assert(
      releaseApiBaseUrl === lockedApiBaseUrl,
      `RELEASE_API_BASE_URL should match locked API base URL ${lockedApiBaseUrl}`
    );
    const buildAppJs = await read(buildAppJsPath);
    assert(
      buildAppJs.includes(lockedApiBaseUrl),
      "release build should include locked production API base URL"
    );
    assert(!buildAppJs.includes("http://127.0.0.1:3018"), "release build should not use local API");
    await assertProductionApiReady();
  }

  const isPlaceholderDomain = /(^|\/\/)(api\.)?example\.com($|[/:])/.test(
    releaseApiBaseUrl
  );
  console.log(
    JSON.stringify(
      {
        ok: true,
        releaseApiBaseUrl: releaseApiBaseUrl || null,
        uploadReady: Boolean(releaseApiBaseUrl && !isPlaceholderDomain),
        placeholderDomain: isPlaceholderDomain,
        checkedAt: new Date().toISOString()
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
