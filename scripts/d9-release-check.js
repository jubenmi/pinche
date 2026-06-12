import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";

const releaseApiBaseUrl = process.env.RELEASE_API_BASE_URL || "";

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

async function main() {
  const envExample = await read(".env.production.example");
  const manifest = JSON.parse(await read("apps/miniprogram/src/manifest.json"));
  const appSource = await read("apps/miniprogram/src/App.vue");
  const composeProd = await read("docker-compose.prod.example.yml");
  const buildAppJsPath = "apps/miniprogram/dist/build/mp-weixin/app.js";
  const buildAppJsonPath = "apps/miniprogram/dist/build/mp-weixin/app.json";

  assert(envExample.includes("NODE_ENV=production"), "production env should set NODE_ENV");
  assert(envExample.includes("WECHAT_MOCK_LOGIN=false"), "production env should disable mock login");
  assert(envExample.includes("WECHAT_APP_ID=wxe0421039631a9c2a"), "production env should use appid");
  assert(composeProd.includes("restart: unless-stopped"), "prod compose should restart services");
  assert(manifest["mp-weixin"]?.appid === "wxe0421039631a9c2a", "manifest appid should be set");
  assert(appSource.includes("VITE_API_BASE_URL"), "miniprogram should support release API base URL");
  assert(existsSync(new URL(`../${buildAppJsPath}`, import.meta.url)), "mp-weixin build app.js missing");
  assert(existsSync(new URL(`../${buildAppJsonPath}`, import.meta.url)), "mp-weixin build app.json missing");

  if (releaseApiBaseUrl) {
    assert(isHttpsUrl(releaseApiBaseUrl), "RELEASE_API_BASE_URL should be an https URL");
    const buildAppJs = await read(buildAppJsPath);
    assert(
      buildAppJs.includes(releaseApiBaseUrl),
      "release build should include RELEASE_API_BASE_URL"
    );
    assert(!buildAppJs.includes("http://127.0.0.1:3018"), "release build should not use local API");
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
