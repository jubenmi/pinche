import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { buildAdminRouteQuery, parseAdminRouteQuery } from "../src/adminRoute.js";

test("content security navigation has an isolated stable route", () => {
  assert.equal(parseAdminRouteQuery("?view=content-security").activeView, "content-security");
  assert.equal(
    buildAdminRouteQuery({ activeView: "content-security" }),
    "?view=content-security"
  );
  assert.equal(parseAdminRouteQuery("?view=unknown").activeView, "catalog");
});

test("content security API reads settings and saves only the four boolean fields", async () => {
  const module = await import("../src/contentSecurity.js").catch(() => ({}));
  assert.equal(typeof module.createContentSecuritySettingsClient, "function");

  const calls = [];
  const client = module.createContentSecuritySettingsClient((path, options) => {
    calls.push({ path, options });
    return Promise.resolve({ ok: true });
  });
  await client.get();
  await client.update({
    blockWhenUnavailable: true,
    blockImageWhenUnavailable: false,
    blockVideoWhenUnavailable: true,
    blockTextWhenUnavailable: false,
    capabilities: { image: { available: false } },
    ignored: "must not be sent"
  });

  assert.deepEqual(calls, [
    {
      path: "/api/admin/content-security-settings",
      options: undefined
    },
    {
      path: "/api/admin/content-security-settings",
      options: {
        method: "PUT",
        body: {
          blockWhenUnavailable: true,
          blockImageWhenUnavailable: false,
          blockVideoWhenUnavailable: true,
          blockTextWhenUnavailable: false
        }
      }
    }
  ]);

  assert.throws(
    () => client.update({
      blockWhenUnavailable: "false",
      blockImageWhenUnavailable: false,
      blockVideoWhenUnavailable: false,
      blockTextWhenUnavailable: false
    }),
    /four boolean settings/
  );
});

test("only system administrators see and open the content security workspace", async () => {
  const app = await readFile(new URL("../src/App.vue", import.meta.url), "utf8");

  assert.match(app, /ContentSecurityWorkspace/);
  assert.match(app, /v-if="canManageContentSecurity"/);
  assert.match(app, /activeView === 'content-security'/);
  assert.match(app, /activeView === 'content-security' && canManageContentSecurity/);
  assert.match(app, /roles\.value\.includes\("system_admin"\)/);
  assert.match(app, />内容安全</);
  assert.match(app, /内容安全仅限系统管理员使用/);
});

test("content security workspace renders four switches, read-only capabilities, and saves settings", async () => {
  const workspace = await readFile(
    new URL("../src/components/ContentSecurityWorkspace.vue", import.meta.url),
    "utf8"
  ).catch(() => "");

  assert.match(workspace, /getContentSecuritySettings/);
  assert.match(workspace, /updateContentSecuritySettings/);
  assert.match(workspace, /blockWhenUnavailable/);
  assert.match(workspace, /blockImageWhenUnavailable/);
  assert.match(workspace, /blockVideoWhenUnavailable/);
  assert.match(workspace, /blockTextWhenUnavailable/);
  assert.match(workspace, /contentSecurityLoadSucceeded/);
  assert.match(workspace, /contentSecurityLoadFailed/);
  assert.match(workspace, /canSaveContentSecurity/);
  assert.match(workspace, /contentSecurityCapabilityLabel/);
  assert.match(workspace, />总开关</);
  assert.match(workspace, />图片</);
  assert.match(workspace, />视频</);
  assert.match(workspace, />文本</);
  assert.match(workspace, /"保存设置"/);
  assert.doesNotMatch(workspace, /v-html/);
});

test("content security trust follows the latest load result", async () => {
  const module = await import("../src/contentSecurity.js").catch(() => ({}));
  for (const name of [
    "createContentSecurityState",
    "contentSecurityLoadSucceeded",
    "contentSecurityLoadFailed",
    "canSaveContentSecurity",
    "contentSecurityCapabilityLabel"
  ]) {
    assert.equal(typeof module[name], "function", `${name} must be executable`);
  }

  let state = module.createContentSecurityState();
  assert.equal(module.canSaveContentSecurity(state), false);
  assert.equal(module.contentSecurityCapabilityLabel(state, "image"), "未知");

  state = module.contentSecurityLoadFailed(state);
  assert.equal(module.canSaveContentSecurity(state), false);
  assert.equal(module.contentSecurityCapabilityLabel(state, "image"), "加载失败");

  state = module.contentSecurityLoadSucceeded(state, {
    settings: {
      blockWhenUnavailable: true,
      blockImageWhenUnavailable: true,
      blockVideoWhenUnavailable: false,
      blockTextWhenUnavailable: false
    },
    capabilities: {
      image: { available: true },
      video: { available: false },
      text: { available: true }
    }
  });
  assert.equal(module.canSaveContentSecurity(state), true);
  assert.equal(module.contentSecurityCapabilityLabel(state, "image"), "可用");
  assert.equal(module.contentSecurityCapabilityLabel(state, "video"), "不可用");

  state = module.contentSecurityLoadFailed(state);
  assert.equal(state.settings.blockWhenUnavailable, true, "stale values may remain visible");
  assert.equal(module.canSaveContentSecurity(state), false, "stale values must not be saved");
  assert.equal(module.contentSecurityCapabilityLabel(state, "image"), "加载失败");
});

test("admin web check aggregation includes content security tests", async () => {
  const packageJson = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8")
  );
  assert.match(packageJson.scripts.check || "", /test:content-security/);
});

test("root check delegates admin web verification to the workspace check", async () => {
  const rootPackage = JSON.parse(
    await readFile(new URL("../../../package.json", import.meta.url), "utf8")
  );
  assert.match(
    rootPackage.scripts.check || "",
    /npm --workspace apps\/admin-web run check/
  );
  assert.doesNotMatch(
    rootPackage.scripts.check || "",
    /npm --workspace apps\/admin-web run test:runtime-config/
  );
});
