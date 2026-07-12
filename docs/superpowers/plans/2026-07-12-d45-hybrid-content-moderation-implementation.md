# D45 Hybrid Content Moderation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 D45 v1.1：微信审核文本和图片、腾讯云 CI 审核视频、私有 COS 加 API 发布门禁，并提供人工复核、监控和可重复验证。

**Architecture:** 以 `content_moderation_jobs` 统一状态机，以 provider-attempt 表关联微信 trace_id 与腾讯云 JobId。微信接入共享 token 模块，文本同步、图片异步；腾讯云只保留视频。所有普通读取只认可 approved/approved_legacy，管理员通过独立权限路径处理 review/error。

**Tech Stack:** Node.js ESM、mysql2、Redis (`redis` 客户端)、腾讯云 COS/CI、微信小程序 OpenAPI、Vue 3、uni-app、Node test runner。

---

### Task 1: D45.3 Provider attempts、唯一约束与 stale 契约

**Files:**
- Create: `apps/api/migrations/0025_content_moderation_provider_attempts.sql`
- Modify: `apps/api/src/db/mysql.js`
- Modify: `apps/api/src/modules/content-moderation/repository.js`
- Modify: `apps/api/src/modules/content-moderation/service.js`
- Modify: `apps/api/test/content-moderation-migration.test.mjs`
- Modify: `apps/api/test/content-moderation-repository.test.mjs`
- Modify: `apps/api/test/content-moderation-service.test.mjs`

- [ ] Write failing tests for provider-inclusive job uniqueness, one current attempt, duplicate/old attempt callbacks, and stale text proposal transition.
- [ ] Run `node --test apps/api/test/content-moderation-migration.test.mjs apps/api/test/content-moderation-repository.test.mjs apps/api/test/content-moderation-service.test.mjs`; expect failures due to missing attempt table and APIs.
- [ ] Add migration 0025: replace job unique key with `(subject_type, subject_id, subject_version, provider)`; create attempts table with unique provider job ID, unique `(job, attempt_no)`, and generated unique current-job key; add proposal `action` and `idempotency_key`; backfill existing job provider IDs as current attempts.
- [ ] Implement repository functions `createModerationAttempt`, `retireCurrentModerationAttempt`, `findModerationAttemptByProviderJobId`, `findCurrentModerationAttempt`, and proposal stale transition; make submission atomically retire old attempt, write new one, then mark job processing.
- [ ] Keep job statuses unchanged; proposal stale is terminal `stale`, while its job receives `last_error_code=CONTENT_MODERATION_PROPOSAL_STALE` and leaves the review queue.
- [ ] Run the same tests; expect all pass. Commit `feat: add moderation provider attempts`.

### Task 2: D45.4 Shared WeChat token and API clients

**Files:**
- Create: `apps/api/src/modules/wechat/access-token.js`
- Create: `apps/api/src/modules/content-moderation/wechat-client.js`
- Modify: `apps/api/src/modules/wechat/subscribe-message.js`
- Modify: `apps/api/src/config/env.js`
- Modify: `.env.production.example`
- Modify: `apps/api/package.json`, root `package-lock.json`
- Create: `apps/api/test/wechat-access-token.test.mjs`
- Create: `apps/api/test/content-moderation-wechat-client.test.mjs`

- [ ] Write failing tests for cache-before-expiry, local single-flight, Redis lock ownership, token-error one-time refresh, no credential leakage, `msgSecCheck`, and `mediaCheckAsync` request bodies.
- [ ] Run `node --test apps/api/test/wechat-access-token.test.mjs apps/api/test/content-moderation-wechat-client.test.mjs`; expect module-not-found failures.
- [ ] Add `redis` dependency and implement injected Redis/fetch adapters. Use keys `wechat:access-token:<appid>` and `wechat:access-token-lock:<appid>`, a 60-second refresh margin, and a bounded wait for a competing refresh.
- [ ] Rewire subscription messages to import the shared token provider. Build WeChat client methods `checkText({content, openid, scene})` and `checkImage({mediaUrl, openid, scene})`, map only `pass/review/risky`, and redact URLs/tokens from errors.
- [ ] Extend moderation config validation so production text/image gates require Redis, AppID/AppSecret, event token and AES key; retain independent Tencent video validation.
- [ ] Run both tests plus `node scripts/check-api-env.js`; expect pass. Commit `feat: add shared WeChat moderation client`.

### Task 3: D45.5 Text proposals and atomic applicator

**Files:**
- Create: `apps/api/src/modules/content-moderation/text-proposal-applicator.js`
- Modify: `apps/api/src/modules/content-moderation/normalize.js`
- Modify: `apps/api/src/modules/content-moderation/service.js`
- Modify: `apps/api/src/server.js`
- Modify: `apps/api/src/modules/core/service.js` only to expose connection-bound operations needed by the applicator
- Create: `apps/api/test/content-moderation-text.test.mjs`
- Modify: `apps/api/test/content-moderation-admin.test.mjs`

- [ ] Write failing tests covering fixed scene mapping, missing openid, Pass/Review/risky/error, stable labelled fields, proposal action/idempotency, nickname stale baseline, and retry/administrator approval applying exactly once.
- [ ] Run `node --test apps/api/test/content-moderation-text.test.mjs apps/api/test/content-moderation-admin.test.mjs`; expect missing WeChat text moderation behavior.
- [ ] Implement `moderateTextMutation` using provider `wechat_sec_check`; persist proposal before provider call, apply immediately only for pass, and retain a hidden proposal for review/error/risky.
- [ ] Implement the proposal applicator within the caller transaction. Re-check actor permission, base version and domain constraints; use proposal action/idempotency to route nickname, private store/script, session create/update, review, message and pinned-message actions.
- [ ] Add server boundary helper that maps every covered endpoint to scenes 1–4 and reads authenticated user openid. Return `CONTENT_MODERATION_OPENID_REQUIRED`, `CONTENT_MODERATION_REVIEW_PENDING`, `CONTENT_MODERATION_REJECTED`, or `CONTENT_MODERATION_UNAVAILABLE` without optimistic updates.
- [ ] Run text/admin tests and targeted API syntax check; expect pass. Commit `feat: moderate covered text with WeChat`.

### Task 4: D45.6 WeChat image submission

**Files:**
- Modify: `apps/api/src/modules/album-image/upload-service.js`
- Modify: `apps/api/src/modules/album-image/signed-urls.js`
- Modify: `apps/api/src/modules/content-moderation/service.js`
- Modify: `apps/api/src/server.js`
- Modify: `apps/api/src/modules/content-moderation/repository.js`
- Modify: `apps/api/test/album-image-finalize.test.mjs`
- Create: `apps/api/test/content-moderation-wechat-image.test.mjs`

- [ ] Write failing tests proving a finalized JPEG/PNG <=4 MB creates a WeChat image job and current trace attempt, supplies a short-lived provider-only URL, never returns it to a user, and remains hidden when submission fails.
- [ ] Run `node --test apps/api/test/album-image-finalize.test.mjs apps/api/test/content-moderation-wechat-image.test.mjs`; expect production image path lacks WeChat hooks.
- [ ] Add image job creation with provider `wechat_sec_check`; create it in the image-finalize transaction and submit after commit through `checkImage`. Record the returned trace ID as the current attempt.
- [ ] Generate a provider-only signed URL with constrained expiry, preserve existing JPEG/PNG/4 MB validation, and ensure response serialisation strips every URL until approval.
- [ ] Run both tests and `node --test apps/api/test/content-moderation-media-gates.test.mjs`; expect pass. Commit `feat: submit album images to WeChat moderation`.

### Task 5: D45.7 WeChat secure image callback

**Files:**
- Create: `apps/api/src/modules/content-moderation/wechat-callback.js`
- Modify: `apps/api/src/server.js`
- Modify: `apps/api/src/modules/content-moderation/service.js`
- Create: `apps/api/test/content-moderation-wechat-callback.test.mjs`

- [ ] Write failing tests for invalid signature, invalid AES ciphertext, oversized raw request, unknown schema, valid current trace, duplicate trace, old attempt, expired media, and administrator decision.
- [ ] Run `node --test apps/api/test/content-moderation-wechat-callback.test.mjs`; expect missing callback parser and route.
- [ ] Implement WeChat SHA-1 signature verification and AES-CBC message decryption using configured token/AES key; bound raw body before parsing and normalize only safe result fields.
- [ ] Register the callback before generic body parsing. Resolve trace ID to current attempt, lock job and media, verify stored subject version/object key, then apply pass/review/risky/error. Return 200 for duplicate, stale, old-attempt and admin-decided events.
- [ ] Run callback and media tests; expect pass. Commit `feat: process WeChat image moderation callbacks`.

### Task 6: D45.8–D45.10 Video hardening, media gates, and multi-provider retry

**Files:**
- Modify: `apps/api/src/modules/content-moderation/tencent-video-client.js`
- Modify: `apps/api/src/modules/content-moderation/callback.js`
- Modify: `apps/api/src/server.js`
- Modify: `apps/api/src/jobs/content-moderation-retry.js`
- Modify: `apps/api/src/modules/content-moderation/retry.js`
- Modify: `apps/api/src/modules/content-moderation/repository.js`
- Modify: `docker-compose.prod.example.yml`
- Modify: `apps/api/test/content-moderation-callback.test.mjs`
- Modify: `apps/api/test/content-moderation-retry.test.mjs`
- Modify: `apps/api/test/content-moderation-media-gates.test.mjs`

- [ ] Write failing tests proving video callback uses provider attempts and accepts old/duplicate callback idempotently; local/admin create responses never leak pending URLs; retry dispatches separately to WeChat text, WeChat image, and Tencent video.
- [ ] Run the three moderation tests; expect legacy single provider_job lookup and incomplete retry dispatch failures.
- [ ] Use attempts for Tencent video submission/callback, redact callback token in structured logs, and enforce `album_video` routing. Preserve ETag and all video cleanup objects.
- [ ] Make every direct media creation response pass the same moderation serialization gate. Implement retry dispatch per provider, attempt rollover, retry classification, bounded worker cadence and alert events for auth/quota/CAM errors.
- [ ] Run content moderation, D42 video and album image tests; expect pass. Commit `fix: harden moderation media and retries`.

### Task 7: D45.11–D45.13 Admin API, web console, and mini-program states

**Files:**
- Modify: `apps/api/src/modules/content-moderation/repository.js`
- Modify: `apps/api/src/modules/content-moderation/service.js`
- Modify: `apps/api/src/server.js`
- Create: `apps/api/test/content-moderation-admin-routes.test.mjs`
- Modify: `apps/admin-web/src/api.js`, `apps/admin-web/src/adminRoute.js`, `apps/admin-web/src/App.vue`, `apps/admin-web/src/styles.css`
- Create: `apps/admin-web/src/components/ContentModerationWorkspace.vue`
- Create: `apps/admin-web/test/contentModeration.test.mjs`
- Modify: `apps/miniprogram/src/pages/session/album.vue`
- Modify: `apps/miniprogram/src/utils/albumMediaOperation.js`
- Modify: covered text-entry pages and pseudo-chat extension components
- Create: `apps/miniprogram/test/contentModeration.test.mjs`

- [ ] Write failing API tests for role enforcement, provider/type/status/label/time filters, details redaction, approve/reject/retry, audit and stale text application.
- [ ] Implement the five admin routes and a dedicated administrator preview URL endpoint; do not expose raw storage URLs.
- [ ] Write failing web and mini-program tests for navigation, filtering/actions, and three mandated user-facing moderation messages.
- [ ] Add the standalone web workspace and API wrappers; add mini-program pending/review/rejected placeholders, stop preview/download/play for non-published content, and surface text review without mutating local values.
- [ ] Run API tests, admin-web tests/build, and miniprogram tests/build; expect pass. Commit `feat: add moderation review interfaces`.

### Task 8: D45.14–D45.17 Observability, runbook, checks, and local verification

**Files:**
- Create: `apps/api/src/modules/content-moderation/telemetry.js`
- Create: `apps/api/src/jobs/content-moderation-orphan-scan.js`
- Modify: `apps/api/src/modules/content-moderation/*`, `apps/api/src/server.js`, `apps/api/package.json`, `docker-compose.prod.example.yml`
- Create: `docs/runbooks/hybrid-content-moderation-release.md`
- Create: `scripts/d45-content-moderation-check.js`
- Create: `scripts/d45-content-moderation-smoke.js`
- Modify: root `package.json`

- [ ] Write failing tests/checks for redacted telemetry, queue age/depth calculation, callback failure events, orphan scan candidates, and required runbook/config statements.
- [ ] Implement low-cardinality telemetry and alert event names; scan COS/object metadata versus media/job records using a bounded batch and safe retention interval.
- [ ] Add Chinese release/runbook documentation for WeChat permissions/quotas, CI video/CAM, private COS, staged gates and rollback.
- [ ] Add `d45:unit`, `d45:check`, `d45:smoke` and wire them into root check; smoke must use fake clients only.
- [ ] Run D45 commands, album tests, web/miniprogram builds, migration check, and `npm run check`. Record actual output in `tasks.md`. Commit `chore: verify D45 hybrid moderation`.

### Task 9: D45.18 Staging live integration

**Files:**
- Create: `scripts/d45-content-moderation-live-contract.js`
- Modify: `specs/d45-hybrid-content-moderation/tasks.md`

- [ ] Add an opt-in script that refuses to run without explicit staging environment variables and never logs samples or signed URLs.
- [ ] Validate WeChat text/image and Tencent video against permitted staging samples, including repeated/old callbacks and provider outage simulation.
- [ ] Record only timing, policy identifier and outcome. This task remains unchecked until real staging credentials and callback endpoints are supplied.
