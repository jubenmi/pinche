# D45 Production Controlled Preflight Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 D45 已确认的生产受控预演：用一次性、强门禁、无害样本的生产 Job 验证微信文本/图片与腾讯云 CI 视频审核链路，但不打开任何普通用户入口。

**Architecture:** 新增独立的 production preflight 域：独立迁移表、独立 repository、独立 guard、固定样本、一次性 CLI Job、provider adapter 与 callback preflight-first 拦截。普通内容审核路径只在 callback HMAC 命中预演关联时短路到预演表，否则保持现有用户回调链不变；D45.18B 继续不实现、不勾选。

**Tech Stack:** Node.js ESM, MySQL, existing COS helpers, existing WeChat moderation client, existing Tencent CI video client patterns, `node:test`, D45 repo scripts.

---

## Scope

- 实现 `specs/d45-hybrid-content-moderation/tasks.md` 的 D45.18A。
- 不新增 HTTP route、admin UI、长期运行服务或普通用户上传入口。
- 不把 text/image/video 任一 intake 切为 `moderated`。
- 不在本地测试读取生产密钥，不发送真实 provider 请求。
- 不引入 TMS、CI 图片审核或 COS 自动审核；腾讯云 CI 仅覆盖视频。

## File Map

- Create `apps/api/migrations/0029_content_moderation_production_preflight.sql`: 预演运行、预演关联、provider lock 三张隔离表。
- Modify `apps/api/src/db/mysql.js`: schema readiness 增加三张表。
- Create `apps/api/src/modules/content-moderation/production-preflight-repository.js`: HMAC、锁、run/attempt 读写。
- Modify `apps/api/src/config/env.js`: disabled-by-default 的 production preflight 配置。
- Modify `.env.production.example`: 只写关闭默认和示例哨兵值。
- Create `apps/api/src/modules/content-moderation/production-preflight-samples.js`: 白名单 case、固定 COS key 构造、fixture 读取和 sha256。
- Create `apps/api/src/modules/content-moderation/fixtures/production-preflight-image-v1.png`: 固定无害 PNG。
- Create `apps/api/src/modules/content-moderation/fixtures/production-preflight-video-v1.mp4`: 固定无害静音 MP4。
- Create `apps/api/src/modules/content-moderation/production-preflight.js`: guard、CLI 参数解析、pass-only orchestration、COS cleanup。
- Modify `apps/api/src/modules/content-moderation/tencent-video-client.js`: 增加 preflight-only 视频 key 校验和 client/parser，保持普通 key regex 不变。
- Create `apps/api/src/modules/content-moderation/production-preflight-callback.js`: preflight callback HMAC 命中、幂等更新、未命中返回 normal path。
- Modify `apps/api/src/server.js`: 在现有已认证腾讯/微信 callback route 中，先尝试 preflight handler，再走原逻辑。
- Create `apps/api/src/jobs/content-moderation-production-preflight.js`: 一次性 Job，不 import `server.js` 或普通 `contentModeration` service。
- Modify `apps/api/package.json`: 增加 `job:content-moderation-production-preflight`。
- Create `apps/api/test/content-moderation-production-preflight.test.mjs`: guard、CLI、orchestration、callback、泄漏检查。
- Create `apps/api/test/content-moderation-production-preflight-repository.test.mjs`: repository、HMAC、锁测试。
- Modify `apps/api/test/content-moderation-callback.test.mjs`: 腾讯 normal callback 回归。
- Modify `apps/api/test/content-moderation-wechat-callback.test.mjs`: 微信图片 normal callback 回归。
- Modify `apps/api/test/content-moderation-live-contract.test.mjs`: D45.18 文案断言对齐当前 spec。
- Modify `scripts/d45-content-moderation-check.js`: 静态检查 migration/job/config/callback order/no route/no TMS。
- Modify `docs/runbooks/hybrid-content-moderation-release.md`: 生产受控预演操作手册。
- Modify `specs/d45-hybrid-content-moderation/tasks.md`: 只在验证达成后更新 D45.18A 状态，D45.18B 保持未勾选。

## Invariants

- CLI 只接受 `--case=wechat-text-v1`、`--case=wechat-image-v1`、`--case=tencent-video-v1`。
- 调用方不能传正文、openid、object key、URL、callback、provider 参数或 JSON。
- 三次 gate 必须存在：provider outbound 前、callback DB write 前、completion 前。
- gate 必须校验 `NODE_ENV=production`、显式启用、当次 confirmation、active `system_admin`、目标 provider 配置完整、三个 intake 全部 `closed`。
- 图片和视频只允许 `system/content-moderation-preflight/<run-id>/image-v1.png` 与 `system/content-moderation-preflight/<run-id>/video-v1.mp4`。
- 数据库只存 HMAC provider refs，不存 raw trace/job/DataId/object key/callback body/token/signed URL。
- 预演不写普通 `content_moderation_jobs`、proposal、album media、普通 queue/retry/cleanup/notification/user URL。
- 只有 `pass` 可成功；`review`、`block`、unknown、error、timeout、cleanup failure 都是预演失败。

## Task 1: Schema and Repository

**Files:**
- Create: `apps/api/migrations/0029_content_moderation_production_preflight.sql`
- Modify: `apps/api/src/db/mysql.js`
- Create: `apps/api/src/modules/content-moderation/production-preflight-repository.js`
- Test: `apps/api/test/content-moderation-production-preflight-repository.test.mjs`

- [ ] **Step 1: Write failing repository tests**

Create tests covering:

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  acquireProductionPreflightRun,
  finishProductionPreflightRun,
  findProductionPreflightAttemptByAssociation,
  productionPreflightReferenceHmac,
  recordProductionPreflightAssociation,
  releaseProductionPreflightLock,
} from '../src/modules/content-moderation/production-preflight-repository.js';

test('HMAC is deterministic, domain separated, and redacted', () => {
  const key = '01234567890123456789012345678901';
  const hmac = productionPreflightReferenceHmac({ key, provider: 'wechat_image', kind: 'trace_id', value: 'raw-trace' });
  const other = productionPreflightReferenceHmac({ key, provider: 'wechat_image', kind: 'job_id', value: 'raw-trace' });
  assert.match(hmac, /^[0-9a-f]{64}$/);
  assert.notEqual(hmac, other);
  assert.equal(hmac.includes('raw-trace'), false);
});

test('repository acquires one active provider run and rejects cooldown', async () => {
  const fakeConnection = createFakePreflightConnection();
  const run = await acquireProductionPreflightRun({
    connection: fakeConnection,
    provider: 'wechat_text',
    caseId: 'wechat-text-v1',
    operatorUserId: 42,
    configFingerprint: 'cfg',
    assetFingerprint: 'text-v1',
    now: new Date('2026-07-13T00:00:00.000Z'),
  });
  assert.match(run.id, /^[0-9a-f-]{36}$/);
  await assert.rejects(
    acquireProductionPreflightRun({
      connection: fakeConnection,
      provider: 'wechat_text',
      caseId: 'wechat-text-v1',
      operatorUserId: 42,
      configFingerprint: 'cfg',
      assetFingerprint: 'text-v1',
      now: new Date('2026-07-13T00:01:00.000Z'),
    }),
    /already active|cooldown/,
  );
});

test('associations store and find only HMAC values', async () => {
  const fakeConnection = createFakePreflightConnection();
  await recordProductionPreflightAssociation({
    connection: fakeConnection,
    runId: 'run-1',
    provider: 'wechat_image',
    kind: 'trace_id',
    hmac: 'a'.repeat(64),
  });
  const found = await findProductionPreflightAttemptByAssociation({
    connection: fakeConnection,
    provider: 'wechat_image',
    kind: 'trace_id',
    hmac: 'a'.repeat(64),
  });
  assert.equal(found.runId, 'run-1');
  assert.equal(JSON.stringify(fakeConnection.state).includes('raw'), false);
});

test('finish and release only update preflight tables', async () => {
  const fakeConnection = createFakePreflightConnection();
  await finishProductionPreflightRun({
    connection: fakeConnection,
    runId: 'run-1',
    state: 'passed',
    resultCategory: 'pass',
    cleanupStatus: 'not_required',
    elapsedMs: 10,
  });
  await releaseProductionPreflightLock({ connection: fakeConnection, provider: 'wechat_text', runId: 'run-1' });
  assert.ok(fakeConnection.state.sql.every((sql) => sql.includes('production_preflight')));
});
```

The test helper `createFakePreflightConnection()` should implement `beginTransaction`, `commit`, `rollback`, and `execute` with in-memory maps for the three new tables.

- [ ] **Step 2: Run failing test**

Run:

```bash
node --test apps/api/test/content-moderation-production-preflight-repository.test.mjs
```

Expected: FAIL with module-not-found for `production-preflight-repository.js`.

- [ ] **Step 3: Add migration**

Create `apps/api/migrations/0029_content_moderation_production_preflight.sql`:

```sql
CREATE TABLE IF NOT EXISTS content_moderation_production_preflight_provider_locks (
  provider VARCHAR(32) NOT NULL PRIMARY KEY,
  last_started_at DATETIME(3) NULL,
  active_run_id CHAR(36) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS content_moderation_production_preflight_runs (
  id CHAR(36) NOT NULL PRIMARY KEY,
  case_id VARCHAR(64) NOT NULL,
  provider VARCHAR(32) NOT NULL,
  state VARCHAR(32) NOT NULL,
  operator_user_id BIGINT UNSIGNED NOT NULL,
  config_fingerprint VARCHAR(128) NOT NULL,
  asset_fingerprint VARCHAR(128) NOT NULL,
  result_category VARCHAR(32) NULL,
  cleanup_status VARCHAR(32) NOT NULL DEFAULT 'not_required',
  elapsed_ms INT UNSIGNED NULL,
  failure_code VARCHAR(64) NULL,
  failure_message VARCHAR(255) NULL,
  started_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  completed_at DATETIME(3) NULL,
  KEY idx_cmppr_provider_state (provider, state),
  KEY idx_cmppr_started_at (started_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS content_moderation_production_preflight_attempts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  run_id CHAR(36) NOT NULL,
  provider VARCHAR(32) NOT NULL,
  association_kind VARCHAR(32) NOT NULL,
  association_hmac CHAR(64) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_cmppa_association (provider, association_kind, association_hmac),
  KEY idx_cmppa_run_id (run_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

- [ ] **Step 4: Implement repository**

Implement these exports in `production-preflight-repository.js` with the exact public names below:

```js
export function productionPreflightReferenceHmac({ key, provider, kind, value }) {
  if (typeof key !== 'string' || key.length < 32) throw new Error('production preflight HMAC key must be at least 32 characters');
  if (typeof value !== 'string' || value.length === 0) throw new Error('production preflight reference value is required');
  return crypto.createHmac('sha256', key).update(`${provider}:${kind}:${value}`, 'utf8').digest('hex');
}
```

Concrete behavior:

- `acquireProductionPreflightRun` starts a transaction, creates/locks provider row with `SELECT ... FOR UPDATE`, rejects active run, rejects less than 15 minutes since `last_started_at`, inserts a UUID run, updates `active_run_id`, then commits.
- On any error it rolls back.
- `recordProductionPreflightAssociation` validates `hmac` as 64 lowercase hex and uses `ON DUPLICATE KEY UPDATE updated_at = CURRENT_TIMESTAMP(3)`.
- `finishProductionPreflightRun` updates terminal fields and `completed_at`.
- `releaseProductionPreflightLock` clears `active_run_id` only when provider and run id match.

- [ ] **Step 5: Update schema readiness**

Add these strings to `requiredSchemaTables` in `apps/api/src/db/mysql.js`:

```js
'content_moderation_production_preflight_provider_locks',
'content_moderation_production_preflight_runs',
'content_moderation_production_preflight_attempts',
```

- [ ] **Step 6: Verify and commit**

Run:

```bash
node --test apps/api/test/content-moderation-production-preflight-repository.test.mjs
```

Expected: PASS.

Commit:

```bash
git add apps/api/migrations/0029_content_moderation_production_preflight.sql apps/api/src/db/mysql.js apps/api/src/modules/content-moderation/production-preflight-repository.js apps/api/test/content-moderation-production-preflight-repository.test.mjs
git commit -m "feat(d45): add production preflight repository"
```

## Task 2: Config, Guards, Fixed Cases

**Files:**
- Modify: `apps/api/src/config/env.js`
- Modify: `.env.production.example`
- Create: `apps/api/src/modules/content-moderation/production-preflight-samples.js`
- Create: `apps/api/src/modules/content-moderation/fixtures/production-preflight-image-v1.png`
- Create: `apps/api/src/modules/content-moderation/fixtures/production-preflight-video-v1.mp4`
- Create: `apps/api/src/modules/content-moderation/production-preflight.js`
- Test: `apps/api/test/content-moderation-production-preflight.test.mjs`

- [ ] **Step 1: Write failing guard tests**

Create tests asserting:

```js
assert.deepEqual(Object.keys(PRODUCTION_PREFLIGHT_CASES).sort(), ['tencent-video-v1', 'wechat-image-v1', 'wechat-text-v1']);
assert.throws(() => getProductionPreflightCase('custom'), /unsupported production preflight case/);
assert.deepEqual(parseProductionPreflightCliArgs(['--case=wechat-text-v1']), { caseId: 'wechat-text-v1' });
assert.throws(() => parseProductionPreflightCliArgs(['--case=wechat-text-v1', '--openid=x']), /unsupported production preflight argument/);
assert.doesNotThrow(() => assertProductionPreflightGuards(validRuntime(), 'wechat-text-v1'));
assert.throws(() => assertProductionPreflightGuards({ ...validRuntime(), nodeEnv: 'test' }, 'wechat-text-v1'), /NODE_ENV=production/);
assert.throws(() => assertProductionPreflightGuards({ ...validRuntime(), preflightEnabled: false }, 'wechat-text-v1'), /disabled/);
assert.throws(() => assertProductionPreflightGuards({ ...validRuntime(), confirmation: 'wrong' }, 'wechat-text-v1'), /confirmation/);
assert.throws(() => assertProductionPreflightGuards({ ...validRuntime(), operatorStatus: 'disabled' }, 'wechat-text-v1'), /system_admin/);
assert.throws(() => assertProductionPreflightGuards({ ...validRuntime(), intakeModes: { text: 'moderated', image: 'closed', video: 'closed' } }, 'wechat-text-v1'), /closed/);
assert.throws(() => validateProductionPreflightCosKey('11111111-1111-4111-8111-111111111111', 'uploads/session-album/videos/source/a.mp4'), /invalid production preflight COS key/);
```

`validRuntime()` returns production, enabled, matching confirmation, active system admin, all intake `closed`, and complete target provider flags.

- [ ] **Step 2: Run failing test**

Run:

```bash
node --test apps/api/test/content-moderation-production-preflight.test.mjs
```

Expected: FAIL with missing preflight exports.

- [ ] **Step 3: Add config**

Add `productionPreflight` to `buildContentModerationConfig`:

```js
productionPreflight: {
  enabled: readBooleanEnv('CONTENT_MODERATION_PRODUCTION_PREFLIGHT_ENABLED', false),
  confirmation: process.env.CONTENT_MODERATION_PRODUCTION_PREFLIGHT_CONFIRMATION || '',
  operatorUserId: readIntegerEnv('CONTENT_MODERATION_PRODUCTION_PREFLIGHT_OPERATOR_USER_ID', 0),
  testAdminUserId: readIntegerEnv('CONTENT_MODERATION_PRODUCTION_PREFLIGHT_TEST_ADMIN_USER_ID', 0),
  referenceHmacKey: process.env.CONTENT_MODERATION_PRODUCTION_PREFLIGHT_REFERENCE_HMAC_KEY || '',
  imageFingerprint: process.env.CONTENT_MODERATION_PRODUCTION_PREFLIGHT_IMAGE_FINGERPRINT || '',
  videoFingerprint: process.env.CONTENT_MODERATION_PRODUCTION_PREFLIGHT_VIDEO_FINGERPRINT || '',
  releaseFingerprint: process.env.CONTENT_MODERATION_PRODUCTION_PREFLIGHT_RELEASE_FINGERPRINT || '',
}
```

In config assertion, when `productionPreflight.enabled` is true require confirmation and HMAC key length >= 32, positive operator/test admin ids, and non-empty image/video/release fingerprints.

- [ ] **Step 4: Add env example values**

Add to `.env.production.example`:

```dotenv
CONTENT_MODERATION_PRODUCTION_PREFLIGHT_ENABLED=false
CONTENT_MODERATION_PRODUCTION_PREFLIGHT_CONFIRMATION=example-confirmation-value-not-for-real-use
CONTENT_MODERATION_PRODUCTION_PREFLIGHT_OPERATOR_USER_ID=0
CONTENT_MODERATION_PRODUCTION_PREFLIGHT_TEST_ADMIN_USER_ID=0
CONTENT_MODERATION_PRODUCTION_PREFLIGHT_REFERENCE_HMAC_KEY=example-independent-hmac-key-not-for-real-use
CONTENT_MODERATION_PRODUCTION_PREFLIGHT_IMAGE_FINGERPRINT=production-preflight-image-v1
CONTENT_MODERATION_PRODUCTION_PREFLIGHT_VIDEO_FINGERPRINT=production-preflight-video-v1
CONTENT_MODERATION_PRODUCTION_PREFLIGHT_RELEASE_FINGERPRINT=d45-production-controlled-preflight
```

Keep these defaults closed:

```dotenv
CONTENT_MODERATION_TEXT_INTAKE_MODE=closed
CONTENT_MODERATION_IMAGE_INTAKE_MODE=closed
CONTENT_MODERATION_VIDEO_INTAKE_MODE=closed
```

- [ ] **Step 5: Add fixed cases and guards**

Implement the fixed-case module with these concrete rules:

```js
// production-preflight-samples.js
export const PRODUCTION_PREFLIGHT_CASES = Object.freeze({
  'wechat-text-v1': Object.freeze({ caseId: 'wechat-text-v1', provider: 'wechat_text', kind: 'text', text: '内容安全生产预演样本 v1', assetFingerprint: 'text-v1' }),
  'wechat-image-v1': Object.freeze({ caseId: 'wechat-image-v1', provider: 'wechat_image', kind: 'image', filename: 'production-preflight-image-v1.png', cosFilename: 'image-v1.png', assetFingerprint: 'image-v1' }),
  'tencent-video-v1': Object.freeze({ caseId: 'tencent-video-v1', provider: 'tencent_video', kind: 'video', filename: 'production-preflight-video-v1.mp4', cosFilename: 'video-v1.mp4', assetFingerprint: 'video-v1' }),
});

const RUN_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function getProductionPreflightCase(caseId, callerPayload = undefined) {
  if (callerPayload && Object.keys(callerPayload).length > 0) throw new Error('caller supplied preflight content is forbidden');
  const sample = PRODUCTION_PREFLIGHT_CASES[caseId];
  if (!sample) throw new Error(`unsupported production preflight case: ${caseId}`);
  return sample;
}

export function buildProductionPreflightCosKey(runId, sample) {
  if (!RUN_ID_PATTERN.test(runId)) throw new Error('invalid production preflight run id');
  if (!['image-v1.png', 'video-v1.mp4'].includes(sample.cosFilename)) throw new Error('invalid production preflight fixture filename');
  return `system/content-moderation-preflight/${runId}/${sample.cosFilename}`;
}

export function validateProductionPreflightCosKey(runId, key) {
  const allowed = new Set([
    `system/content-moderation-preflight/${runId}/image-v1.png`,
    `system/content-moderation-preflight/${runId}/video-v1.mp4`,
  ]);
  if (!allowed.has(key)) throw new Error('invalid production preflight COS key');
  return true;
}
```

```js
// production-preflight.js
export function parseProductionPreflightCliArgs(argv) {
  if (argv.length !== 1 || !argv[0].startsWith('--case=')) throw new Error('production preflight accepts exactly one --case argument');
  const caseId = argv[0].slice('--case='.length);
  getProductionPreflightCase(caseId);
  return { caseId };
}

export function createProductionPreflightConfigFingerprint(input) {
  return crypto.createHash('sha256').update(JSON.stringify({ release: input.release, provider: input.provider, appId: input.appId })).digest('hex');
}
```

Guard implementation uses `crypto.timingSafeEqual` for confirmation comparison and checks only provider flags required by the selected case.

- [ ] **Step 6: Add fixtures**

Add the two fixture files under `apps/api/src/modules/content-moderation/fixtures/`. After adding them, run:

```bash
shasum -a 256 apps/api/src/modules/content-moderation/fixtures/production-preflight-image-v1.png
shasum -a 256 apps/api/src/modules/content-moderation/fixtures/production-preflight-video-v1.mp4
```

Expected: each command prints one 64-character SHA-256 hash. Put those hashes in the commit body for audit.

- [ ] **Step 7: Verify and commit**

Run:

```bash
node --test apps/api/test/content-moderation-production-preflight.test.mjs
```

Expected: PASS for guard/fixed-case tests.

Commit:

```bash
git add .env.production.example apps/api/src/config/env.js apps/api/src/modules/content-moderation/production-preflight.js apps/api/src/modules/content-moderation/production-preflight-samples.js apps/api/src/modules/content-moderation/fixtures apps/api/test/content-moderation-production-preflight.test.mjs
git commit -m "feat(d45): add production preflight guards"
```

## Task 3: Orchestration, Providers, Cleanup

**Files:**
- Modify: `apps/api/src/modules/content-moderation/production-preflight.js`
- Modify: `apps/api/src/modules/content-moderation/tencent-video-client.js`
- Test: `apps/api/test/content-moderation-production-preflight.test.mjs`

- [ ] **Step 1: Add failing orchestration tests**

Add tests for:

```js
await runProductionPreflightCase(fakeRunner, { caseId: 'wechat-text-v1', runtime: validRuntime() });
assert.equal(fakeCalls.includes('normalApply'), false);

await runProductionPreflightCase(fakeRunner, { caseId: 'wechat-image-v1', runtime: validRuntime() });
assert.equal(fakeCalls.some((call) => call.key === 'system/content-moderation-preflight/11111111-1111-4111-8111-111111111111/image-v1.png'), true);
assert.equal(JSON.stringify(fakeCalls).includes('raw-trace-id'), false);
assert.equal(fakeCalls.includes('deleteObject'), true);

await assert.rejects(
  runProductionPreflightCase(fakeCleanupFailRunner, { caseId: 'wechat-image-v1', runtime: validRuntime() }),
  /cleanup verification failed/,
);

assert.throws(
  () => validateTencentVideoSourceObjectKey('system/content-moderation-preflight/11111111-1111-4111-8111-111111111111/video-v1.mp4'),
  /invalid/i,
);
```

- [ ] **Step 2: Run failing test**

Run:

```bash
node --test apps/api/test/content-moderation-production-preflight.test.mjs
```

Expected: FAIL with missing `runProductionPreflightCase` or Tencent preflight exports.

- [ ] **Step 3: Implement orchestration**

Add:

```js
export function createProductionPreflightRunner(dependencies) {
  return Object.freeze({ ...dependencies });
}

export async function runProductionPreflightCase(runner, { caseId, runtime }) {
  const sample = getProductionPreflightCase(caseId);
  runner.guards(runtime, caseId);
  const run = await runner.repository.acquireRun({
    provider: sample.provider,
    caseId: sample.caseId,
    operatorUserId: runtime.operatorUserId,
    configFingerprint: createProductionPreflightConfigFingerprint({ release: runtime.releaseFingerprint, provider: sample.provider, appId: runtime.appId || '' }),
    assetFingerprint: `${sample.assetFingerprint}:${productionPreflightAssetSha256(sample)}`,
    now: runner.clock(),
  });
  try {
    const result = await executeProviderCase(runner, run, sample, runtime);
    runner.guards(runtime, caseId);
    if (result.resultCategory !== 'pass') throw new Error(`production preflight expected pass but got ${result.resultCategory}`);
    await runner.repository.finishRun({ runId: run.id, state: 'passed', resultCategory: 'pass', cleanupStatus: result.cleanupStatus || 'not_required', elapsedMs: 0 });
    return { runId: run.id, state: 'passed' };
  } catch (error) {
    await runner.repository.finishRun({ runId: run.id, state: 'failed', resultCategory: 'error', cleanupStatus: error.cleanupStatus || 'not_required', elapsedMs: 0, failureCode: error.code || 'PRODUCTION_PREFLIGHT_FAILED', failureMessage: String(error.message).slice(0, 255) });
    throw error;
  } finally {
    await runner.repository.releaseLock({ provider: sample.provider, runId: run.id });
  }
}
```

`executeProviderCase` behavior:

- text: fetch test admin openid in memory, call direct WeChat `checkText`, do not call normal moderation service.
- image: upload fixed fixture to derived private COS key, build signed URL in memory, call direct WeChat `checkImage`, store trace HMAC, delete object, verify not-found.
- video: upload fixed fixture to derived private COS key, store DataId HMAC before outbound, call preflight-only Tencent video client, store JobId HMAC if returned, delete object, verify not-found.

- [ ] **Step 4: Add Tencent preflight-only client**

Add to `tencent-video-client.js`:

```js
export function validateProductionPreflightVideoObjectKey(runId, objectKey) {
  const expected = `system/content-moderation-preflight/${runId}/video-v1.mp4`;
  if (objectKey !== expected) throw new Error('invalid production preflight video object key');
  return true;
}

export function createTencentProductionPreflightVideoModerationClient({ config, transport }) {
  return {
    async submitProductionPreflightVideo({ runId, objectKey, dataId }) {
      validateProductionPreflightVideoObjectKey(runId, objectKey);
      return transport.submitVideo({ objectKey, dataId, bizType: config.tencentCloud.video.bizType });
    },
  };
}
```

- [ ] **Step 5: Verify and commit**

Run:

```bash
node --test apps/api/test/content-moderation-production-preflight.test.mjs
```

Expected: PASS, no network calls.

Commit:

```bash
git add apps/api/src/modules/content-moderation/production-preflight.js apps/api/src/modules/content-moderation/tencent-video-client.js apps/api/test/content-moderation-production-preflight.test.mjs
git commit -m "feat(d45): orchestrate production preflight cases"
```

## Task 4: Callback Isolation

**Files:**
- Create: `apps/api/src/modules/content-moderation/production-preflight-callback.js`
- Modify: `apps/api/src/server.js`
- Modify: `apps/api/src/modules/content-moderation/tencent-video-client.js`
- Modify: `apps/api/test/content-moderation-callback.test.mjs`
- Modify: `apps/api/test/content-moderation-wechat-callback.test.mjs`
- Test: `apps/api/test/content-moderation-production-preflight.test.mjs`

- [ ] **Step 1: Add failing callback tests**

Add tests for:

```js
const tencentHandled = await tryHandleProductionPreflightTencentCallback({ payload: { dataId: 'raw-data', jobId: 'raw-job', resultCategory: 'pass' }, runtime: validRuntime(), hmacKey, guards, repository });
assert.equal(tencentHandled.status, 'handled');
assert.equal(JSON.stringify(repository.calls).includes('raw-job'), false);

const early = await tryHandleProductionPreflightTencentCallback({ payload: { dataId: 'raw-data', jobId: 'raw-job', resultCategory: 'pass' }, runtime: validRuntime(), hmacKey, guards, repository: dataOnlyRepository, requireJobAssociation: true });
assert.deepEqual(early, { status: 'retry', httpStatus: 503 });

const wechatHandled = await tryHandleProductionPreflightWechatImageCallback({ event: { traceId: 'raw-trace', resultCategory: 'pass' }, runtime: validRuntime(), hmacKey, guards, repository });
assert.equal(wechatHandled.status, 'handled');

const miss = await tryHandleProductionPreflightWechatImageCallback({ event: { traceId: 'normal-trace', resultCategory: 'pass' }, runtime: validRuntime(), hmacKey, guards, repository: missRepository });
assert.equal(miss.status, 'miss');
```

- [ ] **Step 2: Run failing callback tests**

Run:

```bash
node --test apps/api/test/content-moderation-production-preflight.test.mjs
```

Expected: FAIL with missing `production-preflight-callback.js`.

- [ ] **Step 3: Implement callback module**

Export:

```js
export async function tryHandleProductionPreflightTencentCallback({ payload, runtime, hmacKey, guards, repository, requireJobAssociation = false }) {}
export async function tryHandleProductionPreflightWechatImageCallback({ event, runtime, hmacKey, guards, repository }) {}
```

Behavior:

- Compute HMAC from raw DataId/JobId/traceId only in memory.
- Lookup preflight attempts by HMAC.
- On miss return `{ status: 'miss' }`.
- On bounded early event return `{ status: 'retry', httpStatus: 503 }`.
- Re-run guards before preflight DB write.
- For matched callback, update only preflight run state; return `{ status: 'handled', httpStatus: 200 }`.
- Never call `applyMediaResult`, media transition, normal cleanup, notification, or signed user URL generation.

- [ ] **Step 4: Add Tencent preflight callback parser**

Add:

```js
export function parseTencentProductionPreflightCallbackPayload(rawBody) {
  const parsed = JSON.parse(rawBody.toString('utf8'));
  return {
    dataId: String(parsed.DataId || parsed.dataId || ''),
    jobId: String(parsed.JobId || parsed.jobId || ''),
    resultCategory: normalizeTencentVideoResultCategory(parsed),
  };
}
```

Keep existing normal `parseTencentCallbackPayload` rejecting preflight COS keys.

- [ ] **Step 5: Wire server callback routes**

In the existing Tencent callback route, after authentication and raw-body parsing but before normal resolver:

```js
const preflightResult = await tryHandleProductionPreflightTencentCallback(...);
if (preflightResult.status === 'handled') return res.status(200).json({ ok: true });
if (preflightResult.status === 'retry') return res.status(503).json({ ok: false, retry: true });
```

In the existing WeChat image callback route, after secure parse but before normal dispatch:

```js
const preflightResult = await tryHandleProductionPreflightWechatImageCallback(...);
if (preflightResult.status === 'handled') return res.status(200).json({ ok: true });
if (preflightResult.status === 'retry') return res.status(503).json({ ok: false, retry: true });
```

On `{ status: 'miss' }`, continue original route logic.

- [ ] **Step 6: Add normal callback regression tests**

Add one Tencent test confirming a normal callback still reaches existing normal apply path when preflight lookup misses.

Add one WeChat image test confirming a normal callback still reaches `dispatchWechatImageModerationEvent` when preflight lookup misses.

- [ ] **Step 7: Verify and commit**

Run:

```bash
node --test apps/api/test/content-moderation-production-preflight.test.mjs apps/api/test/content-moderation-callback.test.mjs apps/api/test/content-moderation-wechat-callback.test.mjs
```

Expected: PASS.

Commit:

```bash
git add apps/api/src/modules/content-moderation/production-preflight-callback.js apps/api/src/modules/content-moderation/tencent-video-client.js apps/api/src/server.js apps/api/test/content-moderation-production-preflight.test.mjs apps/api/test/content-moderation-callback.test.mjs apps/api/test/content-moderation-wechat-callback.test.mjs
git commit -m "feat(d45): isolate production preflight callbacks"
```

## Task 5: One-Shot Job and Documentation

**Files:**
- Create: `apps/api/src/jobs/content-moderation-production-preflight.js`
- Modify: `apps/api/package.json`
- Modify: `scripts/d45-content-moderation-check.js`
- Modify: `apps/api/test/content-moderation-live-contract.test.mjs`
- Modify: `docs/runbooks/hybrid-content-moderation-release.md`
- Modify: `specs/d45-hybrid-content-moderation/tasks.md`
- Test: `apps/api/test/content-moderation-production-preflight.test.mjs`

- [ ] **Step 1: Add failing job tests**

Add tests asserting:

```js
const job = await import('../src/jobs/content-moderation-production-preflight.js');
assert.equal(typeof job.main, 'function');
await assert.rejects(
  job.main({ argv: ['--case=wechat-text-v1', '--openid=x'], env: { D45_PREFLIGHT_CONFIRMATION: 'confirm-012345678901234567890123' }, stdout: fakeOut, stderr: fakeErr, exit: fakeExit }),
  /unsupported production preflight argument/,
);
assert.equal(fakeOutput.includes('confirm-012345678901234567890123'), false);
```

Update live contract expectation:

```js
assert.ok(tasksText.includes('- [ ] D45.18A 实现并验证生产受控预演（有限验证）。'));
assert.ok(tasksText.includes('- [ ] D45.18B 完整结果与故障放行验证（不由生产预演替代）。'));
```

- [ ] **Step 2: Run failing tests**

Run:

```bash
node --test apps/api/test/content-moderation-production-preflight.test.mjs apps/api/test/content-moderation-live-contract.test.mjs
```

Expected: FAIL with missing job module or stale live contract text.

- [ ] **Step 3: Implement job**

Create `apps/api/src/jobs/content-moderation-production-preflight.js` exporting `main`.

`main` must:

- Parse only one `--case=...` argument.
- Read confirmation from `D45_PREFLIGHT_CONFIRMATION`.
- Build config using existing config module.
- Build runtime context from config, DB `user_roles`, env, and provider config.
- Bind repository to DB connection.
- Wire direct clients and COS helpers without importing `server.js`.
- Output only `{ ok, caseId, runId, state }` or `{ ok:false, error }`, never secrets or raw provider refs.

- [ ] **Step 4: Add package script**

Add:

```json
"job:content-moderation-production-preflight": "node src/jobs/content-moderation-production-preflight.js"
```

- [ ] **Step 5: Update checker**

Update `scripts/d45-content-moderation-check.js` to require:

- migration `0029_content_moderation_production_preflight.sql`
- package script `job:content-moderation-production-preflight`
- `.env.production.example` has preflight enabled default `false`
- three intake modes remain `closed`
- no new `/preflight` public/admin route
- `tryHandleProductionPreflightTencentCallback` and `tryHandleProductionPreflightWechatImageCallback` appear in `server.js`
- no D45 requirement text for TMS, CI image审核, COS 自动审核, or old non-production true integration

- [ ] **Step 6: Update runbook**

Add section:

```md
## 生产受控预演（D45.18A）

此步骤只验证 harmless pass、鉴权、私有 COS 读取、回调、标准化结果和清理。它不表示可以把任何正常用户入口切到 `moderated`。

前置条件：

- `CONTENT_MODERATION_TEXT_INTAKE_MODE=closed`
- `CONTENT_MODERATION_IMAGE_INTAKE_MODE=closed`
- `CONTENT_MODERATION_VIDEO_INTAKE_MODE=closed`
- `CONTENT_MODERATION_PRODUCTION_PREFLIGHT_ENABLED=true`
- 操作人是仍然 active 的 `system_admin`
- `D45_PREFLIGHT_CONFIRMATION` 由当次人工确认提供，不写入仓库

手动执行：

```bash
docker compose run --rm --no-deps api npm run job:content-moderation-production-preflight -- --case=wechat-text-v1
docker compose run --rm --no-deps api npm run job:content-moderation-production-preflight -- --case=wechat-image-v1
docker compose run --rm --no-deps api npm run job:content-moderation-production-preflight -- --case=tencent-video-v1
```

成功只代表固定 harmless 样本的生产链路可用。失败时保持三个入口 `closed`，查看脱敏 preflight run 状态，先处理清理失败、鉴权失败或回调失败，再重试。不要上传危险样本做真实生产验证。
```

- [ ] **Step 7: Verify and commit**

Run:

```bash
node --test apps/api/test/content-moderation-production-preflight.test.mjs apps/api/test/content-moderation-live-contract.test.mjs
npm run d45:check
```

Expected: PASS.

Commit:

```bash
git add apps/api/src/jobs/content-moderation-production-preflight.js apps/api/package.json scripts/d45-content-moderation-check.js apps/api/test/content-moderation-production-preflight.test.mjs apps/api/test/content-moderation-live-contract.test.mjs docs/runbooks/hybrid-content-moderation-release.md specs/d45-hybrid-content-moderation/tasks.md
git commit -m "feat(d45): add production preflight job"
```

## Task 6: Full Verification and Task Tracking

**Files:**
- Modify: `specs/d45-hybrid-content-moderation/tasks.md`

- [ ] **Step 1: Run focused tests**

Run:

```bash
node --test apps/api/test/content-moderation-production-preflight.test.mjs apps/api/test/content-moderation-production-preflight-repository.test.mjs apps/api/test/content-moderation-callback.test.mjs apps/api/test/content-moderation-wechat-callback.test.mjs apps/api/test/content-moderation-config-client.test.mjs apps/api/test/content-moderation-wechat-image.test.mjs apps/api/test/content-moderation-service.test.mjs
```

Expected: PASS.

- [ ] **Step 2: Run D45 verification**

Run:

```bash
npm run d45:unit
npm run d45:check
npm run d45:smoke
```

Expected: PASS. `d45:smoke` remains local/test-only and does not require production env.

- [ ] **Step 3: Run workspace checks**

Run:

```bash
npm --workspace apps/api run check
npm run check
```

Expected: PASS.

- [ ] **Step 4: Update spec tracking**

If code and local verification pass but real production harmless provider preflight has not been run, keep D45.18A unchecked and add:

```md
  - [ ] 代码与本地验证完成；生产真实 harmless 预演尚未执行。
```

Only after the actual approved production harmless run succeeds and is manually reviewed, change D45.18A to checked. Keep D45.18B unchecked.

- [ ] **Step 5: Commit verification tracking**

```bash
git add specs/d45-hybrid-content-moderation/tasks.md
git commit -m "docs(d45): track production preflight verification"
```

## Self-Review

- [ ] D45.18A maps to Tasks 1-6.
- [ ] D45.18B remains unchecked and unimplemented.
- [ ] Every provider callback path has a normal-path regression test.
- [ ] The plan never opens user intake or changes normal moderation state.
- [ ] The plan never asks local tests to read production secrets or call live providers.
- [ ] Static checks remove the old TMS、CI 图片审核、COS 自动审核 direction.
- [ ] Function names are consistent: `productionPreflightReferenceHmac`, `acquireProductionPreflightRun`, `recordProductionPreflightAssociation`, `findProductionPreflightAttemptByAssociation`, `finishProductionPreflightRun`, `releaseProductionPreflightLock`, `assertProductionPreflightGuards`, `parseProductionPreflightCliArgs`, `runProductionPreflightCase`, `tryHandleProductionPreflightTencentCallback`, `tryHandleProductionPreflightWechatImageCallback`.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-13-d45-production-controlled-preflight-implementation.md`. Two execution options:

1. Subagent-Driven (recommended) - I dispatch a fresh subagent per task, review between tasks, fast iteration

2. Inline Execution - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
