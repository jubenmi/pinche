# D46 User Image Review Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the five D46.4 review gaps so avatar and review-photo moderation is recoverable, claimable after approval, cleanup-safe, atomic locally, and migration-safe.

**Architecture:** Keep `user_image_assets` as the immutable owner-scoped source of truth, expose one authenticated status/claim boundary, and reuse the existing moderation and cleanup workers. Reconcile migration 0031 from `information_schema` before recording it, and make every legacy review reference bind to an explicit owner-scoped asset.

**Tech Stack:** Node.js ESM, MySQL 8, node:test, WeChat/D45 moderation runtime, mini-program API utilities.

---

### Task 1: Owner status, claim, and idempotent finalize

**Files:**
- Modify: `apps/api/src/modules/user-image-assets/repository.js`
- Modify: `apps/api/src/modules/user-image-assets/service.js`
- Modify: `apps/api/src/server.js`
- Modify: `apps/miniprogram/src/utils/api.js`
- Test: `apps/api/test/content-moderation-user-image-assets.test.mjs`
- Test: `apps/api/test/content-moderation-user-image-boundaries.test.mjs`

- [x] Add failing tests for owner-only asset lookup, safe status DTOs, approved-only path release, and duplicate finalize replay.
- [x] Add failing client tests proving `assetId` is retained and checked before a later avatar/review association attempt.
- [x] Implement `GET /api/uploads/user-image/:assetId`, exact owner lookup, safe DTO projection, and same-owner immutable replay.
- [x] Implement client status query/retry helpers and approved-path recovery without exposing paths for hidden states.
- [x] Run both test files and confirm green.

### Task 2: Recoverable migration 0031

**Files:**
- Modify: `apps/api/src/modules/album-video/migration.js`
- Modify: `apps/api/migrations/0031_user_image_assets.sql`
- Test: `apps/api/test/content-moderation-user-image-assets.test.mjs`

- [x] Add executable migration-runner coverage for partial DDL recovery and incomplete historical bindings.
- [x] Add a `prepareMigration` reconciler that inspects tables, columns, indexes, and foreign keys before applying only missing compatible DDL/backfill steps.
- [x] Verify partial DDL recovery records 0031 only after reconciliation completes.

### Task 3: Persistent user-image cleanup

**Files:**
- Modify: `apps/api/migrations/0031_user_image_assets.sql`
- Modify: `apps/api/src/modules/user-image-assets/repository.js`
- Create: `apps/api/src/modules/user-image-assets/cleanup.js`
- Modify: `apps/api/src/modules/content-moderation/service.js`
- Modify: `apps/api/src/server.js`
- Test: `apps/api/test/content-moderation-user-image-pipeline.test.mjs`

- [x] Add failing tests for durable jobs on reject/block and unfinalized objects, reference recheck, retry retention, and successful cleanup completion.
- [x] Add owner-scoped cleanup rows and worker operations that accept only avatar/review prefixes.
- [x] Enqueue terminal rejected assets and finalize failures; recheck active business references immediately before delete.
- [x] Verify cleanup failures retain their durable retry anchor.

### Task 4: Atomic local no-overwrite

**Files:**
- Modify: `apps/api/src/server.js`
- Test: `apps/api/test/content-moderation-user-image-boundaries.test.mjs`

- [x] Add a failing test that writes the same local filename twice and proves the original bytes survive.
- [x] Use Node `fs.writeFile(..., { flag: "wx" })` whenever `forbidOverwrite` is true and map collisions safely.
- [x] Run the boundary test green.

### Task 5: Explicit legacy review bindings

**Files:**
- Modify: `apps/api/migrations/0031_user_image_assets.sql`
- Modify: `apps/api/src/modules/core/service.js`
- Test: `apps/api/test/content-moderation-user-image-assets.test.mjs`
- Test: `apps/api/test/content-moderation-user-image-boundaries.test.mjs`

- [x] Add failing tests for the same path owned by multiple users, multiple references, and no nullable serialization escape.
- [x] Change uniqueness to owner plus path, backfill one approved-legacy asset per owner/path, bind every review row, then make the association non-null.
- [x] Remove the `image_asset_id IS NULL` read allowance and verify only explicitly published assets serialize.

### Task 6: Verification and handoff

- [x] Run the focused RED/GREEN suites during implementation.
- [x] Run `npm run d45:unit`, `npm run d45:check`, API syntax checks, full API tests, and `git diff --check` (full API has the same three pre-existing subscription/token failures reproduced in the main worktree).
- [x] Keep D46.4 unchecked and report unrelated baseline failures separately; do not commit.

### Task 7: Second review follow-up

- [x] RED/GREEN: key review-photo recovery by upload operation and local file identity, preserving multi-image order and never substituting an older approved path for a new `filePath`.
- [x] RED/GREEN: claim same-owner/path assets before evaluating current intake so a lost-response replay survives a later unavailable/block policy.
- [x] RED/GREEN: bind every non-empty historical avatar to an `approved_legacy` asset, including allowed non-canonical avatar paths, and refuse to record 0031 while any avatar remains unbound.
- [x] Re-run focused, D45, migration-adjacent, syntax, diff, and full API verification; keep D46.4 unchecked and do not commit.

### Task 8: Third review follow-up

- [x] RED/GREEN: use a non-locking idempotency probe, then preserve settings-before-business lock order for the locked recheck and insert path.
- [x] RED/GREEN: keep finalized unattached assets cleanup-scheduled, enqueue displaced avatar/review assets, and mark deleted assets terminal after successful object cleanup.
- [x] RED/GREEN: scope review-photo pending operations to authenticated user plus session/draft and prevent cross-session recovery.
- [x] Run focused, relevant D45, syntax, build, and diff verification; keep D46.4 unchecked and do not commit.

### Task 9: Fourth review follow-up

- [x] RED/GREEN: defer pending/error/review assets and delete only terminal safe-to-delete or unfinalized user-image objects.
- [x] RED/GREEN: coordinate cleanup decision and association locks so no profile/review association can win after deletion is committed; keep object deletion retryable.
- [x] RED/GREEN: retain an intake block error through the settings lock and replay an exact concurrent asset found by the locked recheck.
- [x] RED/GREEN: atomically create a missing cleanup anchor when a displaced historical asset is scheduled.
- [x] Run focused, relevant D45, check, syntax, build, and diff verification; keep D46.4 unchecked and do not commit.

### Task 10: Fifth review lock-order follow-up

- [x] RED/GREEN: make cleanup preparation lock the common user-image asset before its leased cleanup job, matching finalize and rejection callback order.
- [x] Preserve SKIP LOCKED leasing, terminal-only deletion, reference recheck, committed deletion decision, crash recovery, and storage retry behavior.
- [x] Run focused, relevant D45, static, syntax, and diff verification; keep D46.4 unchecked and do not commit.

### Task 11: Sixth quality-review follow-up

- [x] RED/GREEN: protect shared physical paths/object keys across owners during cleanup and resolve published raw reads deterministically.
- [x] RED/GREEN: lock deduplicated review-photo assets in deterministic id order while preserving client photo order.
- [x] RED/GREEN: persist scoped client recovery identity before finalize for avatar and multi-photo review uploads.
- [x] RED/GREEN: reconcile every runtime-required 0031 index, foreign key, and check constraint on partial existing tables.
- [x] Run focused, relevant D45, static, syntax, and diff verification; keep D46.4 unchecked and do not commit.

### Task 12: Seventh spec-review follow-up

- [x] RED/GREEN: tombstone each unreferenced shared-path asset while deferring bytes until the final live member is reclaimable.
- [x] RED/GREEN: serialize one review before locking the deterministic union of current and replacement photo assets.
- [x] RED/GREEN: forget terminal/deleted scoped client recovery records so a retry can allocate a new immutable key.
- [x] RED/GREEN: reconcile missing and reject malformed users/review image-asset indexes when their columns already exist.
- [x] Run focused, relevant D45, static, syntax, and diff verification; keep D46.4 unchecked and do not commit.

### Task 13: Concurrent shared-object cleanup follow-up

- [x] RED/GREEN: when concurrent workers tombstone different live assets in one physical group, keep every non-deleting cleanup job retryable rather than terminal-retained.
- [x] RED/GREEN: reclaim the shared bytes on a later claim after the final live asset has been tombstoned, without permitting premature deletion.
- [x] Run focused, relevant D45, static, syntax, and diff verification; keep D46.4 unchecked and do not commit.

### Task 14: Final D46.4 quality-review follow-up

- [x] RED/GREEN: raw reads allow legacy bytes only when no asset row exists and image moderation is disabled; any known hidden-only duplicate group stays 404 while a published duplicate remains readable.
- [x] RED/GREEN: retain approved recovery records until explicit avatar/profile or review-save acknowledgement, and durably replay local/backend fallback upload response loss.
- [x] RED/GREEN: reconcile or fail closed on runtime-required 0031 column auto-increment, default, on-update, and table semantics.
- [x] RED/GREEN: converge shared-object cleanup with terminal non-final jobs plus one durable final-object reclaim election under concurrent tombstones.
- [x] Run focused, relevant D45, static, syntax, build, and diff verification; keep D46.4 unchecked and do not commit.

### Task 15: Backend fallback response-loss recovery follow-up

- [x] RED/GREEN: resolve a durable backend upload operation by authenticated owner, image kind, and exact avatar/review scope without exposing hidden paths.
- [x] RED/GREEN: recover avatar and normal review-page pending/approved state after an accepted backend upload response is lost, without selecting the same local file again.
- [x] RED/GREEN: forget deleted, missing, or terminal-configuration operation locators so post-cleanup retries can allocate a fresh upload.
- [x] Run focused D45, static, syntax, build, and diff verification; keep D46.4 unchecked and do not commit.

### Task 16: Final D46.4 quality-review follow-up

- [x] RED/GREEN: treat successful profile/review association as authoritative for the complete normalized scope, clear every scoped pending operation, and invalidate overlapping recovery so removed/replaced images cannot reappear.
- [x] RED/GREEN: add and reconcile exact non-unique single-column leading indexes on `user_image_assets(asset_path)` and `user_image_assets(object_key)`, including partial and malformed-index coverage.
- [x] RED/GREEN: on local no-overwrite collision, read and hash the existing stored bytes and reject a different-byte retry before asset binding or moderation.
- [x] RED/GREEN: include normalized review scope in deterministic object identity so the same user/operation ID in different scopes yields different keys and exact scoped recovery.
- [x] Run focused, D45, matrix, static, syntax, build, and diff verification; keep D46.4 unchecked and do not commit.

### Task 17: Final client-concurrency follow-up

- [x] RED/GREEN: reject stale in-flight avatar/review uploads with a stable safe superseded error instead of resolving an empty path.
- [x] RED/GREEN: capture an operation cutoff when an authoritative association request starts so its acknowledgement clears only operations begun at or before that cutoff, preserving newer stacked profile/review uploads.
- [x] RED/GREEN: disable and method-guard review save while `pendingPhotoCount > 0`, with no PUT or scope acknowledgement and eventual approval still recoverable.
- [x] Run focused, D45, matrix, static, syntax, build, and diff verification; keep D46.4 unchecked and do not commit.
