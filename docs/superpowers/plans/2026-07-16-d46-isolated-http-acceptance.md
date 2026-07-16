# D46 Isolated HTTP Acceptance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete D46.16 with a reproducible, local-only, multi-account HTTP acceptance run while production D45 intake remains `closed` and all production D46 gates remain `false`.

**Architecture:** Compose starts only a uniquely named local MySQL/Redis pair on loopback. The `D46_SMOKE_ISOLATED=1` marker makes the configuration loader skip `.env` entirely. A guarded host-side launcher then imports the real API only after checking `NODE_ENV=test`, mock login, loopback MySQL, exact database `pinche_d46_test`, disabled COS, harmless local cloud placeholders, a loopback callback, and explicit empty legacy callback-token variables. The smoke script then uses real HTTP authentication, route handling, MySQL state transitions, encrypted/provider-shaped callbacks, and a fixture-scoped cleanup runner; a deterministic provider client is selected only after the same guard passes.

**Tech Stack:** Node.js ESM, node:test, native fetch/FormData, MySQL 8.4, Redis 7, Docker Compose, existing Pinche API and cleanup worker.

---

## Fixed scope and safety invariants

This plan implements only D46.16 acceptance infrastructure. It does not change a public API contract, D45 provider behavior, production image/video storage, or any production environment variable.

- The active source of truth is `specs/d46-author-private-content-visibility/{requirements,design,tasks}.md`.
- The final production state remains `CONTENT_MODERATION_*_INTAKE_MODE=closed` and all three `CONTENT_MODERATION_AUTHOR_PRIVATE_*=false`.
- No command may inherit a production database URL, production Redis URL, COS credential, or cloud callback URL.
- The local API must bind exactly `127.0.0.1:3046`; MySQL and Redis must bind only `127.0.0.1:3346` and `127.0.0.1:6446`.
- The only synthetic moderation behavior is a provider-shaped adapter guarded by the exact D46 local runtime contract. It produces harmless `pass`, `review`, and `risky` results and never performs network I/O.
- The acceptance script may seed only its randomly prefixed fixture rows in `pinche_d46_test`, must use `try/finally`, and must remove them and their local media files before succeeding or failing.

## File map

| File | Responsibility |
|---|---|
| `apps/api/src/modules/content-moderation/d46-isolated-smoke.js` | Pure runtime guard plus deterministic local provider client and local author-video capability validation. |
| `apps/api/test/content-moderation-author-d46-isolated-smoke.test.mjs` | Tests every rejection case and the provider-shaped safe outcomes before server wiring exists. |
| `apps/api/src/server.js` | Selects the fake client only under the strict guard, exposes an isolated target probe, and permits a guarded author-only local video preview without weakening public readers. |
| `scripts/d46-api-smoke-server.mjs` | Performs pre-import guard checks and starts `createApp()` bound to `127.0.0.1`. |
| `scripts/d46-author-private-content-api-smoke.js` | Real HTTP multi-account acceptance, encrypted WeChat-shaped image callback, Tencent-shaped video callback, database-only fixture adaptation, and cleanup. |
| `scripts/d46-fixture-cleanup.mjs` | Runs exactly one D46 fixture cleanup job after the strict guard, never a global scan or COS operation. |
| `scripts/d46-isolated-acceptance-check.js` | Static contract check that prevents a production/public route from reaching the test adapter. |
| `docker-compose.d46-smoke.yml` | Dedicated loopback MySQL/Redis resources with unique Compose project/volume. |
| `package.json` | Registers static and runnable D46 acceptance commands without adding write smoke to root `check`. |
| `specs/d46-author-private-content-visibility/{design,tasks}.md` | Records the local acceptance route and exact task status/results. |

### Task 1: Strict isolated runtime and deterministic provider

**Files:**
- Create: `apps/api/src/modules/content-moderation/d46-isolated-smoke.js`
- Create: `apps/api/test/content-moderation-author-d46-isolated-smoke.test.mjs`
- Modify: `apps/api/src/server.js:324-342, 3497-3510, 3659-3690, 5417-5426`

- [x] **Step 1: Write the failing pure-contract tests.**

  Test the wished-for API rather than server implementation details:

  ```js
  import {
    assertD46IsolatedSmokeEnvironment,
    d46IsolatedSmokeRuntime,
    createD46IsolatedSmokeModerationClient
  } from "../src/modules/content-moderation/d46-isolated-smoke.js";

  test("D46 local smoke rejects production, non-loopback, wrong database, and real login", () => {
    for (const patch of [{ NODE_ENV: "production" }, { MYSQL_HOST: "mysql" },
      { MYSQL_DATABASE: "pinche" }, { WECHAT_MOCK_LOGIN: "false" }]) {
      assert.throws(() => assertD46IsolatedSmokeEnvironment({ ...safeEnv, ...patch }));
    }
  });

  test("D46 local smoke provider returns only documented deterministic outcomes", async () => {
    const client = createD46IsolatedSmokeModerationClient(safeRuntime);
    assert.equal((await client.checkText({ content: "[d46:review]" })).suggestion, "review");
    assert.equal((await client.checkText({ content: "[d46:block]" })).suggestion, "risky");
    assert.equal((await client.submitVideo({ dataId: "x" })).DataId, "x");
  });
  ```

- [x] **Step 2: Run the new test and verify RED.**

  Run: `node --test apps/api/test/content-moderation-author-d46-isolated-smoke.test.mjs`

  Expected: failure because `d46-isolated-smoke.js` does not exist, not a syntax or environment failure.

- [x] **Step 3: Implement the minimal guard and client.**

  The module must reject before imports/database access unless every condition below is true:

  ```js
  const LOCAL_MYSQL_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);
  const D46_SMOKE_DATABASE = "pinche_d46_test";

  export function assertD46IsolatedSmokeEnvironment(env) {
    const failures = [];
    if (env.NODE_ENV !== "test") failures.push("NODE_ENV must equal test");
    if (env.WECHAT_MOCK_LOGIN !== "true") failures.push("WECHAT_MOCK_LOGIN must equal true");
    if (env.D46_SMOKE_ISOLATED !== "1") failures.push("D46_SMOKE_ISOLATED must equal 1");
    if (!LOCAL_MYSQL_HOSTS.has(String(env.MYSQL_HOST || "").trim().toLowerCase())) failures.push("MYSQL_HOST must be loopback");
    if (env.MYSQL_DATABASE !== D46_SMOKE_DATABASE) failures.push("MYSQL_DATABASE must equal pinche_d46_test");
    if (env.COS_ENABLED === "true") failures.push("COS_ENABLED must not be true");
    if (failures.length) throw new Error(`D46 isolated smoke rejected: ${failures.join("; ")}`);
    return true;
  }
  ```

  `checkText` maps only `[d46:review]` to `review`, `[d46:block]` to `risky`, and all other harmless fixture content to `pass`; `checkImage` returns a bounded synthetic trace ID; `submitVideo` returns `{ JobId, DataId, State: "Submitted" }` with the supplied data ID. Do not record input text, object keys, URLs, or tokens.

- [x] **Step 4: Wire it into the real server and add the target probe.**

  Select the fake client before creating real provider clients:

  ```js
  const d46IsolatedSmoke = d46IsolatedSmokeRuntime(config, process.env);
  const moderationClient = d46IsolatedSmoke
    ? createD46IsolatedSmokeModerationClient(d46IsolatedSmoke)
    : { ...tencentVideoModerationClient, ...wechatContentSecurityClient };
  ```

  Add `GET /api/testing/d46-smoke-target`, return 409 unless the same runtime guard passes, and return only:

  ```json
  {"ok":true,"data":{"mode":"d46","isolated":true,"database":"pinche_d46_test"}}
  ```

  Do not add a generic test write route or a production bypass.

- [x] **Step 5: Add a guarded local author-video preview.**

  In the existing unpublished author branch of `GET /api/session-album/media/:id/video-url`, retain the current COS behavior. Only when `d46IsolatedSmoke` is true and COS is disabled, issue a ≤60-second opaque capability URL under `/api/testing/d46-smoke/author-media/videos/:id/preview`. That route must:

  ```js
  if (!d46IsolatedSmoke) throw notFound("Album video not found");
  // verify signed mediaId/userId/object-version claims
  // re-lock via getAuthorAlbumVideoPreview(...)
  // serveUploadedSessionAlbumVideoFile(...) with Cache-Control: private, no-store
  ```

  It must never reuse `getVisibleSessionAlbumVideoForPlayback`, never accept an ordinary public video token, and must be unmatchable outside the strict local runtime.

- [x] **Step 6: Run the targeted tests and verify GREEN.**

  Run: `node --test apps/api/test/content-moderation-author-d46-isolated-smoke.test.mjs apps/api/test/content-moderation-author-media-preview.test.mjs`

  Expected: all pass; rejected configs fail before a DB connection, valid video capability cannot be consumed by another media ID or after expiry.

- [x] **Step 7: Commit.**

  ```bash
  git add apps/api/src/modules/content-moderation/d46-isolated-smoke.js \
    apps/api/test/content-moderation-author-d46-isolated-smoke.test.mjs apps/api/src/server.js
  git commit -m "test: add guarded D46 isolated moderation runtime"
  ```

### Task 2: Reproducible loopback infrastructure and static guardrail

**Files:**
- Create: `docker-compose.d46-smoke.yml`
- Create: `scripts/d46-api-smoke-server.mjs`
- Create: `scripts/d46-isolated-acceptance-check.js`
- Modify: `package.json:56-58`

- [x] **Step 1: Write failing static checks.**

  The check must require exact `D46_SMOKE_ISOLATED`, exact DB name, loopback binding, and prove no `api` service exists in the D46 Compose file:

  ```js
  assert.match(serverLauncher, /assertD46IsolatedSmokeEnvironment\(process\.env\)/);
  assert.match(serverLauncher, /server\.listen\(3046, "127\.0\.0\.1"/);
  assert.match(compose, /127\.0\.0\.1:3346:3306/);
  assert.match(compose, /127\.0\.0\.1:6446:6379/);
  assert.doesNotMatch(compose, /^\s+api:/m);
  assert.match(server, /\/api\/testing\/d46-smoke-target/);
  ```

- [x] **Step 2: Run the checker and verify RED.**

  Run: `node scripts/d46-isolated-acceptance-check.js`

  Expected: fail because the launcher and Compose file do not exist.

- [x] **Step 3: Add the local Compose file and host launcher.**

  Compose contains only `mysql` and `redis`, both with loopback host-port bindings and a dedicated Compose network. The network must not set Docker `internal: true`, because that suppresses the required host-loopback port publishing in the local Docker runtime. Use `MYSQL_DATABASE=pinche_d46_test`, volume `mysql_data`, and project name `pinche-d46-smoke`; do not use existing development ports/volumes.

  The launcher starts only after the pre-import guard:

  ```js
  import { assertD46IsolatedSmokeEnvironment } from "../apps/api/src/modules/content-moderation/d46-isolated-smoke.js";
  assertD46IsolatedSmokeEnvironment(process.env);
  const { createApp } = await import("../apps/api/src/server.js");
  const server = createApp();
  server.listen(3046, "127.0.0.1");
  ```

  It handles SIGTERM/SIGINT by closing only this process's HTTP server.

- [x] **Step 4: Register safe commands.**

  Add `d46:acceptance:check` to run the static checker. Add `d46:acceptance:api` to invoke the HTTP smoke but do not include that write command in root `precheck` or `check`.

- [x] **Step 5: Verify GREEN.**

  Run: `npm run d46:acceptance:check && npm run d46:check`

  Expected: static isolation and existing D46 checks pass without Docker, database, network, or cloud access.

- [x] **Step 6: Commit.**

  ```bash
  git add docker-compose.d46-smoke.yml scripts/d46-api-smoke-server.mjs \
    scripts/d46-isolated-acceptance-check.js package.json
  git commit -m "test: add isolated D46 acceptance infrastructure"
  ```

### Task 3: Real HTTP multi-account acceptance script

**Files:**
- Create: `scripts/d46-author-private-content-api-smoke.js`
- Test: `apps/api/test/content-moderation-author-d46-isolated-smoke.test.mjs`

- [x] **Step 1: Add a failing smoke-contract test.**

  Test that the script checks `/api/testing/d46-smoke-target` before all writes, uses a `try/finally` fixture cleanup, verifies `private, no-store`, and never contains production domains or credentials.

- [x] **Step 2: Run the test and verify RED.**

  Run: `node --test apps/api/test/content-moderation-author-d46-isolated-smoke.test.mjs`

  Expected: fail because the API smoke script does not exist.

- [x] **Step 3: Implement the script with real HTTP behavior.**

  It must use D40-style `POST /api/auth/wechat/login` and phone authorization for four actors: author/admin, ordinary member, second normal-interface admin, and anonymous/share. Use a random `d46-smoke-<timestamp>-<hex>` prefix for fixture values, but cleanup only the exact fixture IDs collected after a proposal high-water mark; never use user-, time- or prefix-range deletion. The script must take a non-blocking MySQL named lock after confirming `pinche_d46_test` and before any login/fixture write, then retain it through cleanup and the zero-residue assertion.

  Required assertions:

  1. **Text:** create a harmless `create_private_store` Review proposal; author gets 202, `publication_state=author_only`, no private cache; member/second admin/anonymous lists do not contain its draft ID or marker. Cancel and verify it disappears. Create a Block proposal, resubmit via `replaces_draft_id`, verify the old proposal becomes `superseded`, then cancel the replacement. Use the existing ten-action matrix as the full action semantic proof and log that its 148 unit tests passed separately.
  2. **Image:** normal multipart upload/create produces a local object. Before any callback, the author album capability must return actual bytes with `private, no-store`. The script locally updates only its own fixture row with a controlled object key/version and inserts a provider-shaped job/attempt. It calls the real encrypted WeChat callback route with an AES-CBC envelope and SHA-1 signature, verifies rejected author preview bytes and member/share/direct public isolation. A `risky` callback leaves it rejected/retained; author DELETE creates durable cleanup; the script runs a strict fixture-ID-only local runner and verifies the file and media row are gone.
  3. **Video:** normal multipart video upload/create uses the deterministic `submitVideo` client. Before any callback, the author-only local video capability must return actual Range bytes. The script posts the real token-authenticated Tencent callback JSON with `Result=1`/`Result=2`, verifies `review`/`rejected` isolation and author preview, then verifies rejected retention and fixture-scoped author-delete cleanup exactly as for image.
  4. **Leak guard:** every non-author response must lack `draft_id`, `content_ref`, `publication_state=author_only`, `preview_url`, and test marker strings. The script never logs bodies, keys, capability URLs, authorization tokens, or provider result labels.

- [x] **Step 4: Run only against the target probe and verify failure-safe behavior.**

  Run: `env -i PATH="$PATH" HOME="$HOME" D46_SMOKE_ISOLATED=0 node scripts/d46-author-private-content-api-smoke.js`

  Expected: fail before HTTP/database writes with the isolation error. Completed 2026-07-16: exited `1` at the top-level D46 environment guard, before the script opened HTTP or MySQL.

- [x] **Step 5: Run the local stack and execute the real acceptance.**

  Use a fresh terminal environment with explicit values, not inherited shell configuration:

  ```bash
  set -e
  test -z "${DOCKER_HOST:-}" || { echo "D46 requires no DOCKER_HOST override" >&2; exit 1; }
  D46_DOCKER_CONTEXT="$(docker context show)"
  D46_DOCKER_HOST="$(docker context inspect "$D46_DOCKER_CONTEXT" --format '{{.Endpoints.docker.Host}}')"
  case "$D46_DOCKER_HOST" in
    unix://*|npipe://*) ;;
    *) echo "D46 requires a local Docker context, got: $D46_DOCKER_HOST" >&2; exit 1 ;;
  esac
  d46_compose() {
    docker --context "$D46_DOCKER_CONTEXT" compose -p pinche-d46-smoke -f docker-compose.d46-smoke.yml "$@"
  }
  d46_compose up -d --wait mysql redis
  d46_env() {
    env -i PATH="$PATH" HOME="$HOME" NODE_ENV=test PORT=3046 APP_BASE_URL=http://127.0.0.1:3046 \
      D46_SMOKE_ISOLATED=1 MYSQL_HOST=127.0.0.1 MYSQL_PORT=3346 MYSQL_DATABASE=pinche_d46_test \
      MYSQL_USER=pinche_d46 MYSQL_PASSWORD=pinche_d46_local_only REDIS_ENABLED=true REDIS_URL=redis://127.0.0.1:6446/15 \
      WECHAT_MOCK_LOGIN=true WECHAT_APP_ID=wx-d46-local WECHAT_APP_SECRET=d46-local-placeholder \
      WECHAT_CONTENT_SECURITY_EVENT_TOKEN=d46-local-wechat-callback-token-0000000000 \
      WECHAT_CONTENT_SECURITY_EVENT_AES_KEY=YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXowMTIzNDU \
      SESSION_SECRET=d46-local-session-secret-at-least-32-characters CONTACT_ENCRYPTION_KEY=d46-local-contact-key-at-least-32-characters \
      BOOTSTRAP_ADMIN_OPENIDS=dev-d46-admin COS_ENABLED=false COS_DIRECT_MEDIA_URLS=false COS_DIRECT_UPLOAD_REQUIRED=false \
      CONTENT_MODERATION_ENABLED=true CONTENT_MODERATION_WECHAT_TEXT_ENABLED=true CONTENT_MODERATION_WECHAT_IMAGE_ENABLED=true \
      CONTENT_MODERATION_TENCENT_VIDEO_ENABLED=true CONTENT_MODERATION_TEXT_INTAKE_MODE=moderated \
      CONTENT_MODERATION_IMAGE_INTAKE_MODE=moderated CONTENT_MODERATION_VIDEO_INTAKE_MODE=moderated \
      CONTENT_MODERATION_AUTHOR_PRIVATE_TEXT_ENABLED=true CONTENT_MODERATION_AUTHOR_PRIVATE_TEXT_ACTIONS=update_nickname,create_private_store,create_private_script,create_session,update_session,create_session_npc_role,update_session_npc_role,upsert_session_review,create_session_message,update_session_pinned_message \
      CONTENT_MODERATION_AUTHOR_PRIVATE_IMAGE_ENABLED=true CONTENT_MODERATION_AUTHOR_PRIVATE_VIDEO_ENABLED=true CONTENT_MODERATION_AUTHOR_PREVIEW_TTL_SECONDS=60 \
      COS_SECRET_ID=d46-local-fake-id COS_SECRET_KEY=d46-local-fake-key COS_BUCKET=d46-local-fake-bucket COS_REGION=ap-nanjing \
      TENCENT_CI_VIDEO_REGION=ap-nanjing TENCENT_CI_VIDEO_BIZ_TYPE=d46-local-fake-policy \
      TENCENT_CI_VIDEO_CALLBACK_URL=http://127.0.0.1:3046/api/internal/content-moderation/tencent-video/callback \
      TENCENT_CI_VIDEO_CALLBACK_TOKEN=d46-local-video-callback-token-0000000000 \
      TENCENT_CI_VIDEO_CALLBACK_PREVIOUS_TOKEN= COS_CI_CALLBACK_TOKEN= \
      CONTENT_MODERATION_PRODUCTION_PREFLIGHT_ENABLED=false \
      CONTENT_MODERATION_ORPHAN_SCAN_ENABLED=false CONTENT_MODERATION_ORPHAN_CLEANUP_ENABLED=false \
      CONTENT_MODERATION_PRODUCTION_PREFLIGHT_CONFIRMATION= CONTENT_MODERATION_PRODUCTION_PREFLIGHT_OPERATOR_USER_ID= \
      CONTENT_MODERATION_PRODUCTION_PREFLIGHT_TEST_ADMIN_USER_ID= CONTENT_MODERATION_PRODUCTION_PREFLIGHT_REFERENCE_HMAC_KEY= \
      CONTENT_MODERATION_PRODUCTION_PREFLIGHT_IMAGE_FINGERPRINT= CONTENT_MODERATION_PRODUCTION_PREFLIGHT_VIDEO_FINGERPRINT= \
      CONTENT_MODERATION_PRODUCTION_PREFLIGHT_RELEASE_FINGERPRINT= \
      D45_PREFLIGHT_CONFIRMATION= \
      TENCENT_MAP_SERVICE_KEY= TENCENT_MAP_KEY= VITE_TENCENT_MAP_KEY= AMAP_WEB_SERVICE_KEY= GAODE_MAP_KEY= \
      WECHAT_SUBSCRIBE_MESSAGE_ENABLED=false WECHAT_SUBSCRIBE_TEMPLATE_SIGNUP_CREATED= WECHAT_SUBSCRIBE_TEMPLATE_SIGNUP_REVIEWED= \
      "$@"
  }

  launcher_pid=""
  cleanup_d46() {
    if [ -n "$launcher_pid" ]; then
      kill -INT "$launcher_pid" 2>/dev/null || true
      for attempt in 1 2 3 4 5 6 7 8 9 10; do
        if ! kill -0 "$launcher_pid" 2>/dev/null; then break; fi
        sleep 1
      done
      if kill -0 "$launcher_pid" 2>/dev/null; then
        kill -TERM "$launcher_pid" 2>/dev/null || true
        for attempt in 1 2 3 4 5; do
          if ! kill -0 "$launcher_pid" 2>/dev/null; then break; fi
          sleep 1
        done
      fi
      if kill -0 "$launcher_pid" 2>/dev/null; then kill -KILL "$launcher_pid" 2>/dev/null || true; fi
      wait "$launcher_pid" 2>/dev/null || true
    fi
    d46_compose down -v
  }
  trap cleanup_d46 EXIT

  d46_env npm --workspace apps/api run migrate
  d46_env node scripts/d46-api-smoke-server.mjs &
  launcher_pid=$!
  until curl -fsS http://127.0.0.1:3046/api/testing/d46-smoke-target; do sleep 1; done
  d46_env npm run d46:acceptance:api
  ```

  `d46_compose` rejects a remote Docker endpoint and pins every Compose call to the verified local context. `d46_env` is mandatory for migration, launcher and acceptance; the trap stops only that launcher PID and removes only the dedicated Compose project, even when a command fails. Completed 2026-07-16 after a fresh 32-migration run: a deliberately held MySQL D46 named lock caused a second strict acceptance to fail before fixture writes, with seven transient table counts still `0/0/0/0/0/0/0`; after release, diagnostic and normal HTTP runs both passed and the independent final counts remained zero. The launcher, dedicated containers, volume, network and 3046/3346/6446 listeners were then removed.

- [x] **Step 6: Commit.**

  ```bash
  git add scripts/d46-author-private-content-api-smoke.js \
    apps/api/test/content-moderation-author-d46-isolated-smoke.test.mjs
  git commit -m "test: cover D46 author-private visibility over HTTP"
  ```

### Task 4: Spec reconciliation and full verification

**Files:**
- Modify: `specs/d46-author-private-content-visibility/design.md`
- Modify: `specs/d46-author-private-content-visibility/tasks.md`

- [x] **Step 1: Record the accepted local-only route.**

  Document that D46.16's local acceptance uses fake provider-shaped results only under the exact strict guard, real HTTP/read/write/callback semantics, and no production gate changes.

- [x] **Step 2: Run final verification.**

  Run, in order:

  ```bash
  npm run d46:acceptance:check
  npm run d46:unit
  npm run d46:check
  npm run d46:smoke
  npm run d45:unit
  npm run d45:check
  npm run d45:smoke
  npm run check
  git diff --check
  ```

  Expected: all green, local acceptance transcript contains no sensitive values, and production remains unmodified.

- [x] **Step 3: Update the D46.16 checklist accurately.**

  Mark only the local acceptance child tasks supported by output. Keep the production-real-traffic checkbox explicitly unchecked because D46 requirements forbid opening it without a separate approval.

- [x] **Step 4: Commit.**

  ```bash
  git add specs/d46-author-private-content-visibility/design.md \
    specs/d46-author-private-content-visibility/tasks.md
  git commit -m "docs: record D46 isolated acceptance results"
  ```

## Plan self-review

- Requirement 1, 2, 4, 5, 6, 7, 8, 9, 10, 13, 14, 16 map to Tasks 1 and 3, with exact author/non-author/callback/deletion assertions.
- All ten action semantics remain covered by the existing D46 lifecycle matrix; the new HTTP path covers create/review/block/cancel/resubmit and media authorization with real app routes.
- The plan deliberately does not claim that local fake providers replace WeChat or Tencent Cloud production verification; D45 provider preflight already remains the only actual provider verification.
- No task introduces a production-facing test bypass, public media route, or automatic production intake change.
