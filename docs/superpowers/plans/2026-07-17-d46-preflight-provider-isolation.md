# D46 Preflight Provider Isolation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow the three production moderation preflight cases to exercise their real providers while all ordinary business provider switches remain disabled, then prove that normal text, image, and video publication still follows D46's direct-or-block fallback policy until each provider is deliberately enabled.

**Architecture:** Keep the existing `CONTENT_MODERATION_*_ENABLED` values as business capability switches read only by the ordinary intake gate. Derive preflight readiness from the raw provider prerequisites already present in `moderationConfig`, validate those prerequisites whenever production preflight is enabled, and continue routing only fixed, HMAC-associated samples through the isolated preflight tables/callback handlers. Preserve the existing provider guard shape so callback and runner state machines remain unchanged.

**Tech Stack:** Node.js ESM, `node:test`, MySQL-backed API jobs, Redis, WeChat content-security APIs, Tencent COS/CI video moderation, Docker Compose, GitHub Actions.

---

## Scope and invariants

- Normal business content remains controlled by `CONTENT_MODERATION_ENABLED` plus the three `CONTENT_MODERATION_*_ENABLED` provider switches and the persisted D46 fallback switches.
- `CONTENT_MODERATION_PRODUCTION_PREFLIGHT_ENABLED=true` never makes ordinary content enter moderation.
- A preflight case is ready only when every raw dependency required by that case is configured.
- The preflight accepts only the three code-owned fixed samples and the existing confirmation, administrator, fingerprint, private-object-prefix, and HMAC callback guards.
- WeChat text needs WeChat credentials and Redis token storage.
- WeChat image needs WeChat credentials, Redis, COS, event token, and the 43-character event AES key.
- Tencent video needs COS credentials/bucket/region, its CI policy/region, HTTPS callback URL, and callback token.
- No production secret, confirmation value, openid, object key, or reusable callback credential is committed or printed.
- D46.8 is not complete until all three real-provider cases pass and both media cases report `cleanup_status=deleted`.

## Task 1: Add failing isolation and prerequisite tests

**Files:**

- Modify: `apps/api/test/content-moderation-production-preflight.test.mjs`
- Modify: `apps/api/test/content-moderation-intake-gate.test.mjs`

- [x] **Step 1: Add a complete preflight-only environment fixture**

  Add a helper in `content-moderation-production-preflight.test.mjs` whose business provider switches are explicitly `false`, but which supplies production preflight confirmation/admin/fingerprint settings and all raw WeChat, Redis, COS, and Tencent CI callback prerequisites. Use only synthetic test values.

- [x] **Step 2: Specify production configuration validation**

  Extend `production preflight config defaults disabled and validates only when enabled` or split it into focused tests proving:

  ```js
  assert.doesNotThrow(() => assertContentModerationConfig(
    buildContentModerationConfig(completePreflightOnlyEnv()),
    { nodeEnv: "production" }
  ));
  ```

  Then remove one prerequisite per provider family and assert the exact existing configuration error key:

  - Redis/WeChat credentials fail WeChat preflight readiness.
  - WeChat event token/AES key and COS fail image readiness.
  - Tencent region/policy/HTTPS callback/token and COS fail video readiness.
  - With preflight disabled and all business providers disabled, the same missing prerequisites remain valid legacy configuration.

- [x] **Step 3: Specify runtime readiness independent of business switches**

  Update the runtime construction test so `wechatTextEnabled`, `wechatImageEnabled`, and `tencentVideoEnabled` are all `false`. Supply the raw prerequisites and assert:

  ```js
  assert.deepEqual(runtime.providerConfig, {
    wechatText: true,
    wechatImage: true,
    tencentVideo: true,
    cos: true,
    redis: true,
    callback: true
  });
  ```

  Add negative assertions that a missing WeChat event credential makes `wechatImage` false without incorrectly disabling Tencent video, and a missing Tencent callback credential makes `tencentVideo` false without incorrectly disabling WeChat image.

- [x] **Step 4: Specify ordinary intake isolation**

  In `content-moderation-intake-gate.test.mjs`, build a production config with preflight enabled, complete raw provider prerequisites, and all three normal provider switches false. Assert for `text`, `image`, and `video`:

  ```js
  assert.deepEqual(resolveContentModerationIntake(config, type), {
    accepting: true,
    mode: "legacy",
    moderationRequired: false,
    reason: "legacy"
  });
  assert.throws(
    () => assertContentModerationIntake(config, type, { fallbackBlocking: true }),
    { code: "CONTENT_MODERATION_INTAKE_CLOSED", statusCode: 503 }
  );
  ```

- [x] **Step 5: Run the focused tests and confirm RED**

  Run:

  ```bash
  node --test apps/api/test/content-moderation-production-preflight.test.mjs apps/api/test/content-moderation-intake-gate.test.mjs
  ```

  Expected: the new runtime test fails because readiness is still coupled to the normal provider switches; missing raw prerequisites may also pass configuration validation incorrectly. Confirm no unrelated test failure before implementation.

## Task 2: Decouple preflight runtime readiness

**Files:**

- Modify: `apps/api/src/jobs/content-moderation-production-preflight.js`
- Test: `apps/api/test/content-moderation-production-preflight.test.mjs`

- [x] **Step 1: Derive reusable raw prerequisite booleans**

  At the start of `buildProductionPreflightRuntime`, derive readiness without reading `wechatTextEnabled`, `wechatImageEnabled`, or `tencentVideoEnabled`:

  ```js
  const redisReady = Boolean(
    moderationConfig.redisEnabled &&
    (moderationConfig.redisUrl || moderationConfig.redisHost)
  );
  const cosReady = Boolean(
    moderationConfig.cosEnabled &&
    moderationConfig.secretId &&
    moderationConfig.secretKey &&
    moderationConfig.bucket &&
    moderationConfig.cosRegion
  );
  const wechatReady = Boolean(
    moderationConfig.wechatAppId &&
    moderationConfig.wechatAppSecret &&
    redisReady
  );
  const wechatCallbackReady = Boolean(
    moderationConfig.wechatEventToken &&
    moderationConfig.wechatEventAesKey
  );
  const tencentCallbackReady = Boolean(
    moderationConfig.tencentVideoCallbackUrl &&
    moderationConfig.tencentVideoCallbackToken
  );
  ```

  Do not log any of these source values.

- [x] **Step 2: Populate the existing guard contract**

  Preserve `runtime.providerConfig` and assign:

  ```js
  providerConfig: {
    wechatText: wechatReady,
    wechatImage: Boolean(wechatReady && wechatCallbackReady && cosReady),
    tencentVideo: Boolean(
      cosReady &&
      moderationConfig.tencentVideoRegion &&
      moderationConfig.tencentVideoPolicyId &&
      tencentCallbackReady
    ),
    cos: cosReady,
    redis: redisReady,
    callback: Boolean(wechatCallbackReady || tencentCallbackReady)
  }
  ```

  Keep `assertProductionPreflightGuards` and its per-case requirements intact. Case-specific booleans must be authoritative so the generic `callback` compatibility flag cannot make the wrong provider appear ready.

- [x] **Step 3: Run the runtime tests and confirm partial GREEN**

  Run:

  ```bash
  node --test apps/api/test/content-moderation-production-preflight.test.mjs
  ```

  Expected: runtime readiness/isolation assertions pass. Configuration prerequisite tests may remain RED until Task 3.

## Task 3: Validate preflight prerequisites without enabling normal moderation

**Files:**

- Modify: `apps/api/src/config/env.js`
- Test: `apps/api/test/content-moderation-production-preflight.test.mjs`
- Test: `apps/api/test/content-moderation-intake-gate.test.mjs`

- [x] **Step 1: Name the configuration conditions once**

  In `assertContentModerationConfig`, derive:

  ```js
  const productionPreflightEnabled = Boolean(
    moderationConfig.productionPreflight?.enabled
  );
  const wechatConfigurationRequired = Boolean(
    wechatModerationEnabled || productionPreflightEnabled
  );
  const wechatImageConfigurationRequired = Boolean(
    moderationConfig.wechatImageEnabled || productionPreflightEnabled
  );
  const tencentVideoConfigurationRequired = Boolean(
    moderationConfig.tencentVideoEnabled || productionPreflightEnabled
  );
  ```

- [x] **Step 2: Reuse existing WeChat/Redis/COS validation**

  In production, validate Redis, AppID, AppSecret, event token, and AES key when `wechatConfigurationRequired`. Validate COS credentials/bucket/region when `wechatImageConfigurationRequired`. Preserve the existing validators and error wording; do not create a second validation path with different rules.

- [x] **Step 3: Reuse existing Tencent validation**

  Replace the repeated `moderationConfig.tencentVideoEnabled` conditions with `tencentVideoConfigurationRequired` for region, COS credentials, policy, callback URL/token, previous-token length, and production HTTPS enforcement.

- [x] **Step 4: Preserve the legacy fast path**

  Keep the early return only when moderation, all normal provider switches, and production preflight are disabled. Verify that the default production configuration still validates and publishes directly exactly as before D45/D46.

- [x] **Step 5: Run both focused test files and confirm GREEN**

  Run:

  ```bash
  node --test apps/api/test/content-moderation-production-preflight.test.mjs apps/api/test/content-moderation-intake-gate.test.mjs
  ```

  Expected: all tests pass, including the preflight-only configuration and ordinary intake isolation matrix.

- [x] **Step 6: Commit the code and tests**

  ```bash
  git add apps/api/src/config/env.js \
    apps/api/src/jobs/content-moderation-production-preflight.js \
    apps/api/test/content-moderation-production-preflight.test.mjs \
    apps/api/test/content-moderation-intake-gate.test.mjs
  git commit -m "fix: isolate moderation preflight readiness"
  ```

## Task 4: Add a static regression guard

**Files:**

- Modify: `scripts/d45-content-moderation-check.js`

- [x] **Step 1: Extract the runtime builder source**

  Reuse a bounded source slice from `preflightJob`, starting at `export async function buildProductionPreflightRuntime` and ending before `function bindProductionPreflightRepository`.

- [x] **Step 2: Assert the forbidden coupling is absent**

  Add checks that the runtime builder contains the raw prerequisite fields and does not contain these three business switches:

  ```js
  assert.doesNotMatch(preflightRuntime, /wechatTextEnabled/);
  assert.doesNotMatch(preflightRuntime, /wechatImageEnabled/);
  assert.doesNotMatch(preflightRuntime, /tencentVideoEnabled/);
  ```

  Also assert that `moderationEnv` makes production preflight participate in WeChat and Tencent prerequisite validation. Keep this structural guard narrow so unrelated formatting does not break it.

- [x] **Step 3: Run static and focused verification**

  Run:

  ```bash
  npm run d45:check
  npm run d46:check
  node --test apps/api/test/content-moderation-production-preflight.test.mjs apps/api/test/content-moderation-intake-gate.test.mjs
  ```

  Expected: all commands exit 0.

- [x] **Step 4: Commit the static guard**

  ```bash
  git add scripts/d45-content-moderation-check.js
  git commit -m "test: guard moderation preflight isolation"
  ```

## Task 5: Align the runbook and D46 task record

**Files:**

- Modify: `docs/runbooks/hybrid-content-moderation-release.md`
- Modify: `specs/d46-automatic-content-moderation-fallback/tasks.md`

- [x] **Step 1: Make the rollout order unambiguous**

  Update sections 6 and 8 of the runbook to state:

  1. The resident API and preflight-timeout worker need `CONTENT_MODERATION_PRODUCTION_PREFLIGHT_ENABLED=true` while asynchronous image/video callbacks are being verified.
  2. Keep `CONTENT_MODERATION_WECHAT_TEXT_ENABLED=false`, `CONTENT_MODERATION_WECHAT_IMAGE_ENABLED=false`, and `CONTENT_MODERATION_TENCENT_VIDEO_ENABLED=false` for all three preflight cases.
  3. Enabling preflight validates raw provider credentials but does not change normal intake.
  4. Only after all three cases pass and both private media objects are deleted may providers be enabled one at a time with observation windows.
  5. Disabling preflight after completion must retain callback/HMAC cleanup support until all existing runs are terminal.

- [x] **Step 2: Correct the one-shot container note**

  Replace the sentence implying the preflight flag only affects the `--rm` container. Explain that the one-shot override enables submission, while the resident API must use the same preflight configuration to authenticate and finalize asynchronous callbacks. Normal business switches still remain false.

- [x] **Step 3: Record implementation verification without closing D46.8**

  Add a dated D46.8 note describing the isolated preflight readiness fix and its local verification. Leave `D46.8` unchecked until the three real cases and cleanup evidence succeed.

- [x] **Step 4: Run documentation/static checks**

  Run:

  ```bash
  npm run d45:check
  npm run d46:check
  ```

  Expected: both commands exit 0 and the static runbook requirements remain present.

- [x] **Step 5: Commit documentation**

  ```bash
  git add docs/runbooks/hybrid-content-moderation-release.md \
    specs/d46-automatic-content-moderation-fallback/tasks.md
  git commit -m "docs: align moderation preflight rollout"
  ```

## Task 6: Complete local regression verification

**Files:**

- Verify only; update `specs/d46-automatic-content-moderation-fallback/tasks.md` if the evidence statement needs correction.

- [x] **Step 1: Run the moderation suites**

  ```bash
  npm run d45:unit
  npm run d45:check
  npm run d46:check
  ```

  Expected: all commands exit 0.

- [x] **Step 2: Run API syntax/config checks**

  ```bash
  npm --workspace apps/api run check
  node scripts/check-api-env.js
  ```

  Expected: both commands exit 0.

- [x] **Step 3: Run the full repository check in the isolated local stack**

  Start or reuse the project-approved isolated MySQL/Redis/API test environment, then run:

  ```bash
  WECHAT_SUBSCRIBE_MESSAGE_ENABLED=false npm run check
  ```

  Expected: exit 0. If anything fails, use `superpowers:systematic-debugging`; do not classify a failure as baseline without reproducing it against unmodified `develop` under the same environment.

- [x] **Step 4: Review the complete branch diff**

  ```bash
  git diff --check develop...HEAD
  git diff --stat develop...HEAD
  git status --short
  ```

  Expected: no whitespace errors, only planned files changed, and a clean feature worktree.

## Task 7: Integrate and publish through guarded CI

**Files:**

- Git branches and GitHub Actions only; do not modify user-owned dirty files in `/Users/dirui/Documents/pinche`.

- [x] **Step 1: Perform final code review**

  Use `superpowers:requesting-code-review` against `develop...codex/d46-preflight-isolation`. Resolve only findings that are within this approved design; request confirmation before changing architecture or scope.

  - [x] Review remediation: add a failing static assertion proving the resident API callback runtime does not read `wechatTextEnabled`, `wechatImageEnabled`, or `tencentVideoEnabled`.
  - [x] Review remediation: make the resident API callback runtime reuse `buildProductionPreflightRuntime` so submission and asynchronous callback guards derive identical raw-provider readiness.
  - [x] Review remediation: add the same RED/static guard for the preflight timeout Worker and reuse the shared runtime builder while retaining its HMAC fingerprint input.
  - [x] Review remediation: rerun focused callback/preflight tests, D45/D46 static checks, and the complete isolated-stack verification before marking review complete.

- [x] **Step 2: Verify immediately before integration**

  Use `superpowers:verification-before-completion` and rerun the focused tests plus D45/D46 checks. Record command exit codes, not claims based on earlier runs.

- [x] **Step 3: Merge into `develop` without disturbing the dirty main worktree**

  Follow the repository's guarded branch workflow from the isolated worktree. Preserve the main worktree's existing `package-lock.json` and `docs/evidence/` state. Do not use destructive restore/reset commands.

  - [x] Reconciled the isolated branch with the latest `origin/develop`, reran the complete isolated-stack verification, then fast-forwarded local `develop`; the existing `package-lock.json` and `docs/evidence/` changes remained untouched.

- [ ] **Step 4: Publish and verify CI in order**

  Invoke the `ci-release` skill. Push `develop`, wait for its required GitHub Actions checks and immutable image digest, then promote only the verified commit/digest through the repository's normal `main` and `publish` stages. Stop on any failed or ambiguous check.

## Task 8: Prepare production configuration without exposing secrets

**Files:**

- Modify locally only: `/Users/dirui/Documents/pinche/.env.production` (gitignored)
- Do not modify: `.env.production.example` unless a newly required key is absent from the example.

- [ ] **Step 1: Populate the non-secret provider coordinates**

  Set the existing production AppID/COS bucket/region and:

  ```text
  TENCENT_CI_VIDEO_REGION=ap-nanjing
  TENCENT_CI_VIDEO_BIZ_TYPE=449c2c20e6ba65eddcae07853ac2f313
  TENCENT_CI_VIDEO_CALLBACK_URL=https://api.pinche.jubenmi.com/api/internal/content-moderation/tencent-video/callback
  ```

- [ ] **Step 2: Generate and store credentials locally**

  Generate at least 32 random bytes for the production preflight confirmation, HMAC key, WeChat event token, and Tencent callback token; generate a valid 43-character WeChat event AES key. Copy existing AppSecret/COS credentials from the approved local source directly into `.env.production` without emitting values to terminal output or chat.

- [ ] **Step 3: Keep ordinary business moderation disabled**

  Set:

  ```text
  CONTENT_MODERATION_PRODUCTION_PREFLIGHT_ENABLED=true
  CONTENT_MODERATION_WECHAT_TEXT_ENABLED=false
  CONTENT_MODERATION_WECHAT_IMAGE_ENABLED=false
  CONTENT_MODERATION_TENCENT_VIDEO_ENABLED=false
  ```

  Configure the preflight operator/test administrator IDs and fixed sample/release fingerprints. Confirm the test administrator has a valid production WeChat openid without printing it.

- [ ] **Step 4: Validate the rendered configuration safely**

  Run a validation command that prints only missing key names and a success/failure result, never values. Expected: production API configuration loads successfully with all three normal provider switches false.

## Task 9: Configure the WeChat callback manually

**External checkpoint:** The WeChat public-platform site is blocked from automated browser control by policy. The user must perform this console step; no alternate-browser workaround is allowed.

- [ ] **Step 1: Enter the message-push settings in WeChat**

  In the production mini-program/public-platform console, configure:

  ```text
  URL: https://api.pinche.jubenmi.com/api/internal/content-moderation/wechat-image/callback
  Data format: JSON
  Message encryption: secure mode
  Token: the locally stored WECHAT_CONTENT_SECURITY_EVENT_TOKEN
  EncodingAESKey: the locally stored 43-character WECHAT_CONTENT_SECURITY_EVENT_AES_KEY
  ```

- [ ] **Step 2: Complete WeChat's URL verification**

  The callback API must already be deployed with preflight enabled and the matching token/AES key. Confirm verification succeeds; if it fails, inspect only redacted API logs and signed handshake behavior.

## Task 10: Run the three real-provider preflight cases

**Files/evidence:**

- Runtime data: isolated `content_moderation_production_preflight_*` tables
- Private COS prefix: `system/content-moderation-preflight/`
- Update: `specs/d46-automatic-content-moderation-fallback/tasks.md`

- [ ] **Step 1: Verify resident services and isolation**

  Confirm the API and preflight-timeout worker run the verified immutable digest, preflight is enabled, all three normal provider switches are false, normal new content still resolves to `approved_legacy` unless its D46 fallback switch is on, and no ordinary moderation-job volume begins.

- [ ] **Step 2: Run WeChat text**

  Execute the runbook's immutable-image command for `wechat-text-v1` with the one-time confirmation supplied only to the process. Expected terminal state: `passed`, normalized result `pass`, no ordinary moderation row, no user notification.

- [ ] **Step 3: Run WeChat image**

  Execute `wechat-image-v1`. Accept an initial `awaiting_callback`, then wait for its HMAC-associated WeChat callback. Expected terminal state: `passed`, normalized result `pass`, `cleanup_status=deleted`, and HEAD confirms the private preflight object is gone.

- [ ] **Step 4: Run Tencent video**

  Execute `tencent-video-v1` against policy `449c2c20e6ba65eddcae07853ac2f313`. Accept an initial `awaiting_callback`, then wait for the HMAC-associated Detail callback. Expected terminal state: `passed`, normalized result `pass`, `cleanup_status=deleted`, and HEAD confirms the private preflight object is gone.

- [ ] **Step 5: Check failure and leakage signals**

  Verify no normal content, ordinary moderation tasks, notifications, reusable URLs, raw trace/job/DataId, object keys, callback bodies, tokens, openids, or fixed sample contents were written to logs/evidence. Confirm no preflight run remains nonterminal and the timeout worker has no cleanup alert.

- [ ] **Step 6: Close D46.8 with redacted evidence**

  Update the task checklist with date, release commit/digest fingerprint, three case IDs, terminal categories, elapsed-time summaries, and media cleanup conclusions. Do not include secrets or provider identifiers that the runbook prohibits. Mark D46.8 complete only now.

- [ ] **Step 7: Commit and publish the final task record**

  ```bash
  git add specs/d46-automatic-content-moderation-fallback/tasks.md
  git commit -m "chore: record D46 production preflight"
  ```

  Run the guarded CI release flow once more for this documentation-only completion commit.

## Task 11: Enable business providers only after a separate go/no-go decision

- [ ] **Step 1: Hold at the verified safe state**

  Completion of D46.8 proves provider plumbing; it does not itself authorize normal content moderation. Keep all normal provider switches false until the user approves staged activation.

- [ ] **Step 2: Stage activation in the runbook order**

  When separately approved, enable WeChat text, then WeChat image, then Tencent video one at a time. For each stage, deploy the same verified digest/config change, observe one agreed business window, confirm error/queue/callback/manual-review thresholds, and roll back the single provider switch on failure.

## Final acceptance checklist

- [ ] Preflight starts and finishes with all ordinary provider switches false.
- [ ] Preflight-enabled production config rejects every missing real-provider prerequisite.
- [ ] Preflight-disabled default production config remains backward-compatible.
- [ ] Ordinary content follows D46 direct-or-block fallback during all preflight runs.
- [ ] No preflight sample reaches ordinary moderation tables, user notifications, or public media reads.
- [ ] WeChat text, WeChat image, and Tencent video each reach `passed`.
- [ ] Image and video preflight objects are confirmed deleted.
- [ ] Focused, D45, D46, API, and full repository checks all pass.
- [ ] The verified change and final D46.8 evidence are published through guarded CI.
