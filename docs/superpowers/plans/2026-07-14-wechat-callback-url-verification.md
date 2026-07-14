# 微信回调 URL 官方验证修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将图片审核回调同一路由的 GET 保存验证改为微信官方三参数签名协议，使微信后台能够保存安全模式 JSON 回调，同时保持安全模式 POST、状态机和三个生产 intake 不变。

**Architecture:** 为 GET 增加独立的 `verifyWechatCallbackUrl`，只校验 `signature = SHA1(sort(Token, timestamp, nonce))` 并精确回显明文 `echostr`。现有 `verifyWechatCallbackSignature`、AES 解密和 `parseWechatSecureImageEvent` 继续只服务安全模式 POST；不兼容首版错误的“加密 echostr + msg_signature”GET。发布沿 develop → main → publish 逐级验证，生产部署设 API-only 硬门禁并在动作前再次确认。

**Tech Stack:** Node.js ESM、`node:crypto`、Node.js `node:test`、GitHub Actions、Tencent Cloud Container Registry、Docker/Portainer、微信小程序消息推送

---

## 已确认范围与文件边界

- 已批准规格：
  - `specs/d45-hybrid-content-moderation/requirements.md` v1.3
  - `specs/d45-hybrid-content-moderation/design.md` v1.3
  - `specs/d45-hybrid-content-moderation/tasks.md` v1.2
  - `docs/runbooks/hybrid-content-moderation-release.md`
- Modify: `apps/api/test/content-moderation-wechat-callback.test.mjs` — 锁定官方 GET、错误 GET 拒绝和 GET/POST 路由分界。
- Modify: `apps/api/src/modules/content-moderation/wechat-callback.js` — 新增独立 GET 验证器并删除错误握手函数。
- Modify: `apps/api/src/server.js` — GET 改读 `signature`，POST 保持 `msg_signature`、AESKey、AppID 和 raw body。
- Modify: `specs/d45-hybrid-content-moderation/tasks.md` — 持续记录本地、CI、API-only 部署和微信真实保存证据。
- Create: `docs/superpowers/plans/2026-07-14-wechat-callback-url-verification.md` — 本计划。
- 不修改数据库迁移、Redis、COS、预演状态机、图片审核 POST、腾讯视频、管理员流程、小程序或任何 intake 配置。

### Task 1: 固化已批准的规格与执行基线

**Files:**
- Modify: `specs/d45-hybrid-content-moderation/requirements.md`
- Modify: `specs/d45-hybrid-content-moderation/design.md`
- Modify: `specs/d45-hybrid-content-moderation/tasks.md`
- Modify: `docs/runbooks/hybrid-content-moderation-release.md`
- Create: `docs/superpowers/plans/2026-07-14-wechat-callback-url-verification.md`

- [ ] **Step 1: 核对文档只表达官方 GET 与安全 POST 两条协议**

Run:

```bash
rg -n 'signature.*timestamp.*nonce|安全模式.*POST|POST.*msg_signature|原样返回|原样回显' \
  specs/d45-hybrid-content-moderation/requirements.md \
  specs/d45-hybrid-content-moderation/design.md \
  specs/d45-hybrid-content-moderation/tasks.md \
  docs/runbooks/hybrid-content-moderation-release.md
git diff --check
```

Expected: GET 只出现三参数 `signature` 与明文 `echostr`；安全 POST 仍出现 `msg_signature`、Encrypt、AESKey 和 AppID；`git diff --check` 退出 0。

- [ ] **Step 2: 核对任务状态没有提前完成**

Run:

```bash
sed -n '175,205p' specs/d45-hybrid-content-moderation/tasks.md
```

Expected: 文档复核子项为 `[x]`；GET 实现、本地测试、CI、API-only 部署和微信真实保存均为 `[ ]`；D45.18A、D45.18 和最终生产验收仍为 `[ ]`，三个 intake 明确保持 `closed`。

- [ ] **Step 3: 提交已批准的文档基线**

```bash
git add \
  specs/d45-hybrid-content-moderation/requirements.md \
  specs/d45-hybrid-content-moderation/design.md \
  specs/d45-hybrid-content-moderation/tasks.md \
  docs/runbooks/hybrid-content-moderation-release.md \
  docs/superpowers/plans/2026-07-14-wechat-callback-url-verification.md
git commit -m "docs: correct WeChat callback URL verification spec"
```

Expected: 仅提交上述五个文件，提交成功且工作树干净。

### Task 2: 用失败测试锁定微信官方 GET 协议

**Files:**
- Modify: `apps/api/test/content-moderation-wechat-callback.test.mjs:56-110`
- Modify: `apps/api/test/content-moderation-wechat-callback.test.mjs:240-270`

- [ ] **Step 1: 用官方样例替换错误的加密 GET helper**

在 `wechatSignature` 后增加官方固定样例和新 GET helper：

```js
const officialUrlVerification = Object.freeze({
  token: "AAAAA",
  signature: "f464b24fc39322e44b38aa78f5edd27bd1441696",
  timestamp: "1714036504",
  nonce: "1514711492",
  echostr: "4375120948345356249"
});

function verifyUrlHandshake(input) {
  return wechatCallback.verifyWechatCallbackUrl(input);
}
```

删除旧 `verifyUrlHandshake(raw)` 对 `raw.Encrypt`、`raw.msgSignature`、AESKey 和 AppID 的传递。

- [ ] **Step 2: 写官方正例与精确回显测试**

```js
test("WeChat URL verification accepts the official plaintext GET example", () => {
  assert.equal(
    verifyUrlHandshake(officialUrlVerification),
    officialUrlVerification.echostr
  );
});

test("WeChat URL verification returns echostr without trimming or decrypting it", () => {
  const echostr = " 4375120948345356249 ";
  assert.equal(
    verifyUrlHandshake({ ...officialUrlVerification, echostr }),
    echostr
  );
});
```

- [ ] **Step 3: 写关闭式失败与错误旧协议拒绝测试**

```js
test("WeChat URL verification rejects forged and missing GET parameters", () => {
  assert.throws(
    () => verifyUrlHandshake({
      ...officialUrlVerification,
      signature: "0".repeat(40)
    }),
    { code: "CONTENT_MODERATION_CALLBACK_UNAUTHORIZED" }
  );

  for (const field of ["signature", "timestamp", "nonce", "echostr"]) {
    const invalid = { ...officialUrlVerification, [field]: "" };
    assert.throws(
      () => verifyUrlHandshake(invalid),
      { code: "CONTENT_MODERATION_INVALID_CALLBACK" }
    );
  }
});

test("WeChat URL verification rejects the legacy encrypted GET protocol", () => {
  const legacy = encryptWechatSecurePayload("legacy-encrypted-echo");
  assert.throws(
    () => verifyUrlHandshake({
      token,
      msgSignature: legacy.msgSignature,
      timestamp: legacy.timestamp,
      nonce: legacy.nonce,
      echostr: legacy.Encrypt
    }),
    { code: "CONTENT_MODERATION_INVALID_CALLBACK" }
  );
});
```

- [ ] **Step 4: 将静态路由测试拆成 GET 与 POST 两段**

用两次回调 path 出现位置切片，避免当前测试把 GET/POST 混在一起造成假绿：

```js
const callbackPath = '"/api/internal/content-moderation/wechat-image/callback"';
const getPath = server.indexOf(callbackPath);
const postPath = server.indexOf(callbackPath, getPath + callbackPath.length);
const getStart = server.lastIndexOf("  if (", getPath);
const postStart = server.lastIndexOf("  if (", postPath);
const genericBody = server.indexOf("const body = await bodyFor(request)");
const getRouteBody = server.slice(getStart, postStart);
const postRouteBody = server.slice(postStart, genericBody);

assert.match(getRouteBody, /request\.method === "GET"/);
assert.match(getRouteBody, /verifyWechatCallbackUrl/);
assert.match(getRouteBody, /searchParams\.get\("signature"\)/);
assert.match(getRouteBody, /searchParams\.get\("echostr"\)/);
assert.match(getRouteBody, /"content-type": "text\/plain; charset=utf-8"/);
assert.match(getRouteBody, /response\.end\(echo\)/);
assert.doesNotMatch(getRouteBody, /msg_signature|wechatEventAesKey|wechatAppId|readRawBody|parseWechatSecureImageEvent/);

assert.match(postRouteBody, /request\.method === "POST"/);
assert.match(postRouteBody, /searchParams\.get\("msg_signature"\)/);
assert.match(postRouteBody, /wechatEventAesKey/);
assert.match(postRouteBody, /wechatAppId/);
assert.match(postRouteBody, /readRawBody\(request, 256 \* 1024\)/);
assert.match(postRouteBody, /parseWechatSecureImageEvent/);
```

保留原测试中预演回调优先级、清理失败告警、状态机分发、错误码映射和敏感字段禁止项，并让这些断言只针对 `postRouteBody` 或整个 `server` 的正确范围。

- [ ] **Step 5: 运行测试并证明是协议红灯**

Run:

```bash
node --test apps/api/test/content-moderation-wechat-callback.test.mjs
```

Expected: 非零退出；官方 GET 测试因 `verifyWechatCallbackUrl` 尚不存在而失败，GET 路由因仍读取 `msg_signature` 而失败；现有安全模式 POST 解析、验签、事件归一化和分发测试继续通过。若失败来自依赖或环境而不是上述协议差异，先停止并修复测试环境。

### Task 3: 实现独立 GET 验证器并保持 POST 不变

**Files:**
- Modify: `apps/api/src/modules/content-moderation/wechat-callback.js:18-31`
- Modify: `apps/api/src/modules/content-moderation/wechat-callback.js:158-201`
- Modify: `apps/api/src/server.js:198-203`
- Modify: `apps/api/src/server.js:3854-3894`
- Test: `apps/api/test/content-moderation-wechat-callback.test.mjs`

- [ ] **Step 1: 增加不裁剪输入的有界 helper**

在 `requiredString` 后增加，现有会 `.trim()` 的 `requiredString` 保持不变，继续服务 POST：

```js
function requiredExactString(value, maxBytes = MAX_IDENTIFIER_LENGTH) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    Buffer.byteLength(value, "utf8") > maxBytes
  ) {
    throw invalidCallback();
  }
  return value;
}
```

- [ ] **Step 2: 用官方三参数验证器替换错误握手函数**

删除 `verifyWechatSecureCallbackHandshake`，新增：

```js
export function verifyWechatCallbackUrl({
  token,
  signature,
  timestamp,
  nonce,
  echostr
} = {}) {
  const expectedToken = requiredExactString(token);
  const expectedTimestamp = requiredExactString(timestamp);
  const expectedNonce = requiredExactString(nonce);
  const echo = requiredExactString(echostr, MAX_CALLBACK_BYTES);
  const providedSignature = requiredExactString(signature, 40).toLowerCase();
  if (!/^[a-f0-9]{40}$/.test(providedSignature)) throw invalidCallback();

  const expectedSignature = crypto.createHash("sha1")
    .update([expectedToken, expectedTimestamp, expectedNonce].sort().join(""), "utf8")
    .digest("hex");
  if (!safeEqual(providedSignature, expectedSignature)) {
    throw callbackError(
      "CONTENT_MODERATION_CALLBACK_UNAUTHORIZED",
      "WeChat content moderation callback is unauthorized"
    );
  }
  return echo;
}
```

不得修改紧邻的 `verifyWechatCallbackSignature` 与 `parseWechatSecureImageEvent`；它们继续使用 Token、timestamp、nonce、Encrypt、`msg_signature`、AESKey 和 AppID 处理安全 POST。

- [ ] **Step 3: 将 server GET 路由切到新验证器**

导入改为：

```js
import {
  dispatchWechatImageModerationEvent,
  parseWechatSecureImageEvent,
  verifyWechatCallbackUrl
} from "./modules/content-moderation/wechat-callback.js";
```

GET 调用改为：

```js
echo = verifyWechatCallbackUrl({
  token: config.contentModeration.wechatEventToken,
  signature: url.searchParams.get("signature") || "",
  timestamp: url.searchParams.get("timestamp") || "",
  nonce: url.searchParams.get("nonce") || "",
  echostr: url.searchParams.get("echostr") || ""
});
```

保留 `no-store`、`text/plain; charset=utf-8`、正确字节长度、`response.end(echo)` 和既有脱敏失败指标。GET 不再传 AESKey、AppID 或 `msg_signature`；POST 路由不改。

- [ ] **Step 4: 运行定向测试并证明转绿**

Run:

```bash
node --test apps/api/test/content-moderation-wechat-callback.test.mjs
node --check apps/api/src/modules/content-moderation/wechat-callback.js
node --check apps/api/src/server.js
```

Expected: 全部退出 0；官方样例、精确回显、伪造/缺参、错误旧协议拒绝和安全 POST 回归全部通过。

- [ ] **Step 5: 检查最小差异并提交实现**

Run:

```bash
git diff --check
git diff -- \
  apps/api/test/content-moderation-wechat-callback.test.mjs \
  apps/api/src/modules/content-moderation/wechat-callback.js \
  apps/api/src/server.js
```

Expected: 只有计划内 GET 测试、GET 验证器和 GET 路由变化；安全 POST 逻辑无语义差异。

```bash
git add \
  apps/api/test/content-moderation-wechat-callback.test.mjs \
  apps/api/src/modules/content-moderation/wechat-callback.js \
  apps/api/src/server.js
git commit -m "fix: verify official WeChat callback URL"
```

### Task 4: 完成本地全量验证并更新 Kiro 风格任务状态

**Files:**
- Modify: `specs/d45-hybrid-content-moderation/tasks.md`
- Inspect: all files changed since Task 1

- [ ] **Step 1: 运行 D45 验证链**

Run in this order:

```bash
npm run d45:unit
npm run d45:check
npm run d45:smoke
```

Expected: 三条命令均退出 0；任何安全 POST、预演、门禁或媒体回归失败都阻止继续。

- [ ] **Step 2: 运行根级完整检查**

Run:

```bash
npm run check
```

Expected: 退出 0；不得以跳过测试、修改门禁或放宽断言换取通过。

- [ ] **Step 3: 更新 tasks.md 的本地证据**

仅在上述红—绿过程和全部检查真实通过后：

- 将“先补失败测试……”子项改为 `[x]`。
- 在 GET 父项下追加 2026-07-14 记录，写入实际定向测试数量、`d45:unit` 数量、`d45:smoke` 数量、`npm run check` 结果和 `git rev-parse --short HEAD` 输出。
- 同一记录明确“尚未发布、尚未操作生产、三个 intake 仍为 closed”。
- GET 父项、CI、API-only 部署、微信真实保存、D45.18A、D45.18 和最终生产验收继续 `[ ]`。

- [ ] **Step 4: 提交本地验证证据**

```bash
git add specs/d45-hybrid-content-moderation/tasks.md
git commit -m "docs: record WeChat callback URL verification"
git status --short
```

Expected: 提交成功，工作树干净。

### Task 5: 受控 CI 发布 develop → main → publish

**Files:**
- No source changes expected.
- Inspect: `.github/workflows/docker-publish.yml`
- Update after evidence: `specs/d45-hybrid-content-moderation/tasks.md`

进入本任务前必须使用 `ci-release` skill。禁止 force-push、reset、rebase 或重写共享分支；任一级 CI 失败立即停止。

- [ ] **Step 1: 获取远端真相并复核待发布范围**

```bash
git fetch origin
git status --short --branch
git log --oneline --left-right origin/develop...codex/d45-content-moderation-release-candidate
git diff --stat origin/develop...codex/d45-content-moderation-release-candidate
```

Expected: 工作树干净；差异仅包含已发布 D45 祖先差异和本计划的文档、测试、GET 验证器及 GET 路由修复。若出现其他功能文件，停止并重新界定发布范围。

- [ ] **Step 2: 从远端 develop 建临时工作树并推送**

```bash
git worktree add --detach /private/tmp/pinche-d45-get-develop-20260714 origin/develop
git -C /private/tmp/pinche-d45-get-develop-20260714 merge --no-ff codex/d45-content-moderation-release-candidate -m "Merge WeChat callback URL verification fix into develop"
DEVELOP_SHA="$(git -C /private/tmp/pinche-d45-get-develop-20260714 rev-parse HEAD)"
git -C /private/tmp/pinche-d45-get-develop-20260714 push origin HEAD:develop
```

Expected: merge 无冲突、push 为 fast-forward 更新远端 develop；若 push 被拒绝，重新 fetch 并停止，不得强推。

- [ ] **Step 3: 等待 develop Docker Publish 成功**

```bash
DEVELOP_RUN_ID="$(gh run list --repo jubenmi/pinche --workflow docker-publish.yml --branch develop --commit "$DEVELOP_SHA" --event push --limit 1 --json databaseId --jq '.[0].databaseId')"
test -n "$DEVELOP_RUN_ID"
gh run watch "$DEVELOP_RUN_ID" --repo jubenmi/pinche --exit-status
```

Expected: run conclusion 为 success；失败时记录 run id 与首个有效错误并停止，不创建 main/publish 提升。

- [ ] **Step 4: 从远端 main 合并已验证 develop 并等待 CI**

```bash
git fetch origin
git worktree add --detach /private/tmp/pinche-d45-get-main-20260714 origin/main
git -C /private/tmp/pinche-d45-get-main-20260714 merge --no-ff origin/develop -m "Merge develop into main"
MAIN_SHA="$(git -C /private/tmp/pinche-d45-get-main-20260714 rev-parse HEAD)"
git -C /private/tmp/pinche-d45-get-main-20260714 push origin HEAD:main
MAIN_RUN_ID="$(gh run list --repo jubenmi/pinche --workflow docker-publish.yml --branch main --commit "$MAIN_SHA" --event push --limit 1 --json databaseId --jq '.[0].databaseId')"
test -n "$MAIN_RUN_ID"
gh run watch "$MAIN_RUN_ID" --repo jubenmi/pinche --exit-status
```

Expected: main CI success；失败立即停止，不推 publish。

- [ ] **Step 5: 发布 latest 前完成 Watchtower/API-only 风险检查**

在 Portainer 只读检查 Watchtower 的命令、label 过滤范围，以及 `pinche-api-1`、admin-web 和三个内容审核 Worker 的更新策略。由于 publish workflow 同时推送 API 与 admin-web 的 `latest`：

- 只有能够证明 publish 不会自动重启任何容器时，才按普通 CI 提升继续，生产确认留到 Task 6。
- 若 Watchtower 只会自动更新 `pinche-api-1`，publish push 本身即为生产动作，必须先执行 Task 6 Step 1 的快照并取得 Task 6 Step 2 的当次确认。
- 若 Watchtower 可能更新 API 之外的任一容器，立即停止在 main，不推 publish，也不停止或修改 Watchtower。

Expected: 得到可审计的只读结论；不停止、不重启、不编辑任何容器或 Stack。

- [ ] **Step 6: 从远端 publish 合并已验证 main 并等待 CI**

```bash
git fetch origin
git worktree add --detach /private/tmp/pinche-d45-get-publish-20260714 origin/publish
git -C /private/tmp/pinche-d45-get-publish-20260714 merge --no-ff origin/main -m "Merge main into publish"
PUBLISH_SHA="$(git -C /private/tmp/pinche-d45-get-publish-20260714 rev-parse HEAD)"
git -C /private/tmp/pinche-d45-get-publish-20260714 push origin HEAD:publish
PUBLISH_RUN_ID="$(gh run list --repo jubenmi/pinche --workflow docker-publish.yml --branch publish --commit "$PUBLISH_SHA" --event push --limit 1 --json databaseId --jq '.[0].databaseId')"
test -n "$PUBLISH_RUN_ID"
gh run watch "$PUBLISH_RUN_ID" --repo jubenmi/pinche --exit-status
```

Expected: publish CI success，并生成 `hkccr.ccs.tencentyun.com/murder/pinche:latest` 的新不可变 digest。

- [ ] **Step 7: 记录发布证据并清理临时工作树**

```bash
git fetch origin
git rev-parse origin/develop
git rev-parse origin/main
git rev-parse origin/publish
gh run view "$PUBLISH_RUN_ID" --repo jubenmi/pinche --log | rg -n 'digest: sha256|hkccr.ccs.tencentyun.com/murder/pinche'
git worktree remove --force /private/tmp/pinche-d45-get-develop-20260714
git worktree remove --force /private/tmp/pinche-d45-get-main-20260714
git worktree remove --force /private/tmp/pinche-d45-get-publish-20260714
```

Expected: 记录三分支实际 SHA、三个 run id/结论和 API 镜像 digest；勾选 tasks.md 的 CI 子项。此时 GET 父项仍不得勾选。

### Task 6: 仅部署 API 并完成微信真实保存验证

**Files:**
- No source changes expected during deployment.
- Modify after evidence: `specs/d45-hybrid-content-moderation/tasks.md`

- [ ] **Step 1: 生产动作前做只读快照**

记录 `pinche-api-1` 的容器 ID、当前镜像 digest、Entrypoint/Cmd、restart policy、环境变量名称、mount、`pinche_internal` 与 `proxy` 网络；记录所有运行中容器的名称和 ID 作为前后对照。只核对三个 intake 的值为 `closed`，不得输出其他环境变量值或任何 Token/AESKey/AppSecret。

Expected: 快照不改变任何容器；三个 intake 精确为 `closed`；若不满足则停止。

- [ ] **Step 2: 请求当次 API-only 部署确认**

向用户明确展示：将使用 Task 5 记录的不可变 API digest，只替换 `pinche-api-1`；不操作 Traefik、Watchtower、admin-web、Redis、MySQL 或任何 Worker。没有当次确认不得执行下一步。

- [ ] **Step 3: 仅替换 pinche-api-1**

使用服务器现有 Compose 项目或 Portainer 中等价的单服务重建方式，指定 Task 5 的不可变 API digest，保留 Step 1 核对过的环境、mount、restart policy 和两个网络；必须使用 `--no-deps` 等价语义。不得使用 Stack 全量 redeploy、不得重启 Traefik、不得编辑其他服务。

Expected: 只有 `pinche-api-1` 容器 ID 变化；其他容器 ID 与 Step 1 完全一致。若任何其他容器发生变化，立即停止并报告，不继续微信保存。

- [ ] **Step 4: 验证 API 健康与门禁**

Run from a read-only client:

```bash
curl -fsS https://api.pinche.jubenmi.com/health
curl -fsS https://api.pinche.jubenmi.com/health/db
curl -sS -o /dev/null -w '%{http_code}\n' https://api.pinche.jubenmi.com/api/internal/content-moderation/wechat-image/callback
```

Expected: `/health` 与 `/health/db` 为 HTTP 200 且数据库/schema 正常；不带参数的 callback 为 HTTP 400；三个 intake 再次核对仍为 `closed`。勾选 API-only 部署子项，GET 父项仍 `[ ]`。

- [ ] **Step 5: 在动作时确认后保存微信配置**

微信后台保持既有 URL、同一 Token、后台生成的 EncodingAESKey，选择安全模式与 JSON；提交会修改小程序的消息推送配置，因此必须在点击最终提交前请求用户确认。不得把 Token、AESKey、签名或 `echostr` 放入日志、截图或任务记录。

Expected: 微信提示保存成功，刷新页面后配置仍存在；若仍提示服务器地址验证失败，保持三个 intake 为 `closed`，只查看脱敏 API 日志并停止，不切明文/XML、不放宽验签。

- [ ] **Step 6: 收口任务状态但不扩大生产放行**

只有真实保存成功且脱敏核对 GET 没有创建审核任务、媒体记录或预演状态后：

- 勾选微信真实保存子项与 GET 父项。
- 追加实际生产 API digest、API 容器前后 ID、健康检查结果和保存时间；不记录任何密钥或 query 值。
- D45.18A、D45.18、D45.18B 和最终生产受控预演/故障放行验收仍保持 `[ ]`。
- 三个 intake 继续保持 `closed`；保存成功不构成切换到 `moderated` 的授权。

- [ ] **Step 7: 最终核对**

```bash
git diff --check
git status --short
```

Expected: 代码与发布状态已完成，唯一可能的本地变更是新增的脱敏生产证据；报告该文件状态并在用户批准后单独提交，不因记录证据再次触发生产镜像更新。
