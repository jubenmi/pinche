# Project bug audit and fixes

> Execute the bounded tasks with superpowers:subagent-driven-development and test-driven-development. The user explicitly authorized finding and fixing all discovered bugs. Keep their existing lockfile and documentation changes intact.

**Goal:** Audit the application and fix every confirmed finding, prioritizing time settings.

**Architecture:** Retain the existing Beijing business timezone and UTC database convention. Normalize at API write boundaries; use shared formatting in UI and messages. Preserve existing workflow semantics and validate fixes with reproducible regression tests. Work in the current feature checkout; no deployment or production data changes.

**Tech Stack:** Node.js, MySQL/mysql2, Vue, UniApp, native Node tests and Vite builds.

## Findings and execution checklist

- [x] Create-session time: both clients send wall-time text and the API binds that text unchanged into a UTC DATETIME. Normalize creation to a Date, submit explicit UTC from current clients, validate invalid dates and time selection, and verify 19:30 Beijing remains 19:30 after storage and display. Files: shared time helpers, core service, setup.vue, MiniProgramWorkspace.vue; regression: API creation and frontend time tests.
- [x] User-visible times: signup subscription messages stringify Date objects; talk timestamps/default pins truncate UTC; pending-signup subtitles expose ISO; album timestamps use device timezone. Reproduce with 2026-09-07T16:30:00Z (Beijing 09-08 00:30), then use shared formatters and test different TZ values.
- [x] Session lifecycle: inspect cross-start/cross-midnight UI refresh and database/application clock comparisons. Fix only confirmed inconsistencies with boundary tests.
- [x] Admin auth expiry: authenticated 401 leaves expired token/UI in place. Clear only the request's still-current token, notify the root view, preserve 403/anonymous/media behavior, and reject stale login-poll responses. Test network races and multipart paths.
- [x] Ticket/token expiry: approved login tickets bypass expiry; verify expiration at the exact token boundary. Add isolated tests before changing checks.
- [x] Chat history: ascending LIMIT 100 returns oldest messages permanently. Verify current chat behavior and return the newest 100 in chronological order if confirmed.
- [x] Independent audit: scan remaining API, authorization, moderation, media lifecycle, frontend request flows and runtime configuration. Append confirmed findings and fix with focused tests; do not equate unfinished feature specs with bugs.
- [x] Verification: run existing unit suites, root checks, frontend builds, timezone matrix, diff review, and document actual coverage/limitations. Docker is initially unavailable; do not represent fake-connection tests as live database validation.

## Reproduction and validation

Run new focused tests first and retain failure output. Implement the minimal correction, then rerun those tests. Use `node --test` for API/shared/talk/admin/mini tests; keep full output in /tmp until final audit evidence is recorded. Run `npm run check`, `npm run build:admin-web` and `npm run build:mp-weixin` after integration. Any baseline failure must be classified by reproduction before changes. Dependency installation uses `--package-lock=false` so the user's lockfile is preserved.

## Review decisions

- Existing D47 design already specifies the time model; no new product design is needed.
- Historical time correction (D52) and historical backfill documents are planned features, not automatically part of this bugfix.
- Grok read-only audit was rejected by the tool. Continue local analysis without retrying that rejected call.

## Completed audit details

- Full findings and validation are recorded in `docs/audits/2026-09-07-project-bug-fixes.md`.
- Creation intentionally accepts legacy Beijing wall time for installed clients; current clients now send explicit UTC. This is a compatibility decision, not a historical-data migration.
- Independent review added NPC rejoin/insert-ID fixes, moderation expiration handling, token boundary validation, and chat lifecycle race fixes.
- Publishing now locks the session before checking ownership and refuses expired/cancelled/locked publication.
- The unused photo-claim-share image is preserved unchanged in docs/design-assets instead of shipping in the runtime package.
- Final verification numbers are recorded in the audit report after the last integrated run.

## Follow-up audit after user asked about additional bugs

- [x] Reproduce mini-program late 401 invalidation and stale profile/phone/auth writes using the actual API module with controlled UniApp callbacks. Bind expiry and auth updates to the originating token/backend; handle malformed upload 401 before JSON parsing.
- [x] Reproduce and fix chat duplicate sends and draft edits overwritten while sending, in both the package and active component; retain existing lifecycle generation guards.
- [x] Independently review the follow-up diff, run the full check, rebuild/refresh development output, and append final evidence to the audit report.
