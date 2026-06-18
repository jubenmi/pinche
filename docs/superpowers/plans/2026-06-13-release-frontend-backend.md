# Frontend Backend Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish the Pinche API on a Docker-capable server and submit the UniApp WeChat mini program build for experience testing, review, and public release.

**Architecture:** Keep the MVP as one Node.js API container backed by MySQL 8.4 and Redis, fronted by an HTTPS reverse proxy. Build the mini program with the production API base URL, upload the generated `mp-weixin` package through WeChat DevTools, and only submit review after the experience version passes the main workflow.

**Tech Stack:** Node.js, Docker Compose, MySQL 8.4, Redis 7, UniApp, WeChat Mini Program DevTools.

---

## Current Repository State

- Backend source: `apps/api`
- Backend Dockerfile: `apps/api/Dockerfile`
- Production compose template: `docker-compose.prod.example.yml`
- Production env template: `.env.production.example`
- Mini program source: `apps/miniprogram`
- Mini program production build output: `apps/miniprogram/dist/build/mp-weixin`
- Existing release handoff: `specs/d9-mvp-release/handoff.md`
- Existing release checklist: `specs/d9-mvp-release/release-checklist.md`

## Execution Inputs

Record these concrete values before starting Task 2:

- Production API origin, for example the HTTPS origin that will serve `/health` and `/api/*`.
- WeChat AppID and AppSecret from the mini program account.
- Production MySQL password and root password.
- Production `SESSION_SECRET`, at least 32 characters.
- Production `CONTACT_ENCRYPTION_KEY`, exactly the format expected by the backend once encryption is enforced.
- Initial admin OpenID list for `BOOTSTRAP_ADMIN_OPENIDS`.
- Server login path and deployment directory.

## Task 1: Freeze Release Candidate

**Files:**
- Read: `specs/d9-mvp-release/tasks.md`
- Read: `specs/d9-mvp-release/release-checklist.md`
- Read: `package.json`

- [ ] **Step 1: Check worktree status**

Run:

```bash
git status --short
```

Expected: Review all modified and untracked files. If any user work is unrelated to release, keep it out of the release commit.

- [ ] **Step 2: Run static and script checks**

Run:

```bash
npm run check
```

Expected: Command exits with code `0`.

- [ ] **Step 3: Build mini program once locally**

Run:

```bash
npm run build:mp-weixin
```

Expected: `apps/miniprogram/dist/build/mp-weixin/app.js` and `apps/miniprogram/dist/build/mp-weixin/app.json` exist.

- [ ] **Step 4: Build backend Docker image locally**

Run:

```bash
docker compose build api
```

Expected: The `api` image builds successfully from `apps/api/Dockerfile`.

- [ ] **Step 5: Run release check with the final API origin**

Run:

```bash
RELEASE_API_BASE_URL="$PINCHE_API_BASE_URL" npm run d9:release-check
```

Expected: JSON output contains `"ok": true`, `"uploadReady": true`, and `"placeholderDomain": false`.

## Task 2: Prepare Production Server

**Files:**
- Create on server only: `.env.production`
- Copy or create on server only: `docker-compose.prod.yml`
- Source template: `.env.production.example`
- Source template: `docker-compose.prod.example.yml`

- [ ] **Step 1: Point a domain to the server**

Configure DNS so the production API hostname resolves to the server public IP.

Expected:

```bash
dig +short "$PINCHE_API_HOST"
```

prints the server public IP.

- [ ] **Step 2: Prepare HTTPS**

Configure a reverse proxy such as Nginx, Caddy, Traefik, or the cloud provider load balancer so HTTPS traffic for the API hostname proxies to `127.0.0.1:3018`.

Expected:

```bash
curl -I "$PINCHE_API_BASE_URL/health"
```

eventually returns an HTTP response over HTTPS. It may return `502` before the API container is started, but TLS must succeed.

- [ ] **Step 3: Create production env file on the server**

Create `.env.production` from `.env.production.example` on the server deployment directory. Set:

```bash
NODE_ENV=production
PORT=3018
APP_BASE_URL=$PINCHE_API_BASE_URL
MYSQL_HOST=mysql
MYSQL_PORT=3306
MYSQL_DATABASE=pinche
MYSQL_USER=pinche
MYSQL_PASSWORD=$PINCHE_MYSQL_PASSWORD
REDIS_ENABLED=true
REDIS_URL=redis://redis:6379
WECHAT_MOCK_LOGIN=false
WECHAT_APP_ID=$PINCHE_WECHAT_APP_ID
WECHAT_APP_SECRET=$PINCHE_WECHAT_APP_SECRET
SESSION_SECRET=$PINCHE_SESSION_SECRET
CONTACT_ENCRYPTION_KEY=$PINCHE_CONTACT_ENCRYPTION_KEY
BOOTSTRAP_ADMIN_OPENIDS=$PINCHE_BOOTSTRAP_ADMIN_OPENIDS
```

Expected: `.env.production` exists on the server and is not committed to git.

- [ ] **Step 4: Create production compose file on the server**

Copy `docker-compose.prod.example.yml` to `docker-compose.prod.yml` on the server and replace the MySQL root/user passwords with production values.

Expected:

```bash
docker compose -f docker-compose.prod.yml config
```

exits with code `0`.

## Task 3: Deploy Backend

**Files:**
- Use: `docker-compose.prod.yml`
- Use: `.env.production`
- Use: `apps/api/migrations/*.sql`

- [ ] **Step 1: Build production image on the server**

Run on the server:

```bash
docker compose -f docker-compose.prod.yml build api
```

Expected: The `api` image builds successfully.

- [ ] **Step 2: Start database and Redis**

Run on the server:

```bash
docker compose -f docker-compose.prod.yml up -d mysql redis
```

Expected: MySQL healthcheck becomes healthy.

- [ ] **Step 3: Run database migrations**

Run on the server:

```bash
docker compose -f docker-compose.prod.yml run --rm migrate
```

Expected: JSON output contains `"ok": true`; `executed` lists newly applied migration files or an empty array.

If the server has not yet been updated with the dedicated `migrate` service, use this one-time compatibility command instead:

```bash
docker compose -f docker-compose.prod.yml run --rm api npm run migrate
```

- [ ] **Step 4: Start API**

Run on the server:

```bash
docker compose -f docker-compose.prod.yml up -d api
```

Expected: API container is running and restart policy is active.

- [ ] **Step 5: Verify local container health**

Run on the server:

```bash
curl -sS http://127.0.0.1:3018/health
```

Expected: JSON contains `"ok": true` and `"wechatMockLogin": false`.

- [ ] **Step 6: Verify public HTTPS health**

Run from a local machine:

```bash
curl -sS "$PINCHE_API_BASE_URL/health"
curl -sS "$PINCHE_API_BASE_URL/health/db"
curl -sS "$PINCHE_API_BASE_URL/api/stores"
curl -sS "$PINCHE_API_BASE_URL/api/scripts"
```

Expected: All responses contain `"ok": true`.

## Task 4: Configure WeChat Mini Program Console

**Files:**
- Read: `docs/wechat-compliance-guardrails.md`
- Read: `specs/d9-mvp-release/requirements.md`

- [ ] **Step 1: Configure server domain**

In the WeChat mini program console, add the production API hostname to request legal domains.

Expected: The console accepts the HTTPS domain, and the domain matches the hostname used in `$PINCHE_API_BASE_URL`.

- [ ] **Step 2: Configure basic release materials**

In the WeChat mini program console, confirm:

- Mini program name, avatar, and introduction.
- Service category.
- Privacy protection guideline.
- User agreement or product instructions if required by the chosen category.
- Experience members.

Expected: Console shows no blocking warnings before upload/review.

- [ ] **Step 3: Prepare review account path**

Prepare an auditor path that can experience:

- WeChat login.
- Admin catalog entry or seeded catalog data.
- Session creation.
- Session share/open.
- Player signup.
- Organizer review and seat lock.

Expected: A reviewer can reach the main workflow without private instructions outside the review notes.

## Task 5: Build Mini Program For Production

**Files:**
- Use: `apps/miniprogram/src/App.vue`
- Use: `apps/miniprogram/src/manifest.json`
- Build output: `apps/miniprogram/dist/build/mp-weixin`

- [ ] **Step 1: Build with production API origin**

Run:

```bash
VITE_API_BASE_URL="$PINCHE_API_BASE_URL" npm run build:mp-weixin
```

Expected: `apps/miniprogram/dist/build/mp-weixin/app.js` contains the production HTTPS API origin.

- [ ] **Step 2: Run release check**

Run:

```bash
RELEASE_API_BASE_URL="$PINCHE_API_BASE_URL" npm run d9:release-check
```

Expected: JSON output contains `"ok": true`, `"uploadReady": true`, and `"placeholderDomain": false`.

- [ ] **Step 3: Open build output in WeChat DevTools**

Open this directory in WeChat DevTools:

```text
apps/miniprogram/dist/build/mp-weixin
```

Expected: The project AppID is `wx2675a606d3bd242c`, and the app can compile without local API requests.

## Task 6: Upload Experience Version

**Files:**
- Upload directory: `apps/miniprogram/dist/build/mp-weixin`

- [ ] **Step 1: Upload code from WeChat DevTools**

Use WeChat DevTools upload with a release version such as `0.1.0`.

Expected: Upload succeeds and the WeChat console shows a new development version.

- [ ] **Step 2: Set experience version**

In the WeChat console, set the uploaded development version as the experience version.

Expected: Experience QR code is available.

- [ ] **Step 3: Run iOS and Android smoke tests**

On real devices, test:

- Home page opens.
- Login succeeds.
- Catalog pages load.
- Admin creates or edits store/script data.
- Organizer creates and publishes a session.
- Share page opens from QR/share.
- Player signs up.
- Organizer approves/rejects and locks seat.

Expected: No `127.0.0.1` request appears; no API request fails because of domain, TLS, or login configuration.

## Task 7: Submit Review And Publish

**Files:**
- Read: `specs/d9-mvp-release/release-checklist.md`
- Read: `docs/wechat-compliance-guardrails.md`

- [ ] **Step 1: Prepare review notes**

Write concise review notes covering:

- Product positioning as a script-game session forming tool.
- Test account or workflow path.
- Main pages and expected interactions.
- Privacy and contact information handling.
- Statement that deposits are offline status records, not platform payments.

Expected: Review notes let the auditor complete the main workflow.

- [ ] **Step 2: Submit review**

Submit the experience version for WeChat review.

Expected: Review status changes to in review.

- [ ] **Step 3: Handle review feedback**

If WeChat rejects the version, record:

- Rejection reason.
- Screenshot or page path.
- Required code, content, category, or privacy change.

Expected: A focused fix is made and a new experience version is uploaded.

- [ ] **Step 4: Publish after approval**

After approval, publish the approved version in the WeChat console.

Expected: Public users can open the online mini program and complete the smoke path.

## Task 8: Post-Release Operations

**Files:**
- Read: `docs/backend-architecture.md`
- Use: `docker-compose.prod.yml`

- [ ] **Step 1: Capture release evidence**

Record:

- Release version.
- Git commit SHA.
- Production API origin.
- `/health` result timestamp.
- `/health/db` result timestamp.
- Experience QR code or release screenshot.
- WeChat review result.

Expected: Release evidence is saved in the release notes or handoff document.

- [ ] **Step 2: Set up database backups**

Configure daily MySQL volume or logical backups.

Expected: A restoreable backup exists before the first public traffic push.

- [ ] **Step 3: Set up logs and basic monitoring**

At minimum, keep:

```bash
docker compose -f docker-compose.prod.yml logs --tail=200 api
docker compose -f docker-compose.prod.yml ps
```

Expected: On-call operator can see API errors and container restart status.

- [ ] **Step 4: Define rollback**

Rollback path:

- Keep the previous uploaded mini program version available in the WeChat console if possible.
- Keep the previous API image tag or deployment copy on the server.
- Avoid destructive database migrations without a backup.

Expected: A failed deployment can be restored by publishing the previous mini program version and restarting the previous API image.

## Official References

- WeChat Mini Program platform rules: https://developers.weixin.qq.com/miniprogram/product/
- WeChat Mini Program common rejection reasons: https://developers.weixin.qq.com/miniprogram/product/reject.html
- WeChat Mini Program network/domain requirements: https://developers.weixin.qq.com/miniprogram/dev/framework/ability/network.html
- WeChat Mini Program privacy guideline: https://developers.weixin.qq.com/miniprogram/dev/framework/user-privacy/
