# D49 Session Review Experience Implementation Plan

> **For Codex:** Follow `superpowers:executing-plans` and execute task by task. Update `specs/d49-session-review-experience/tasks.md` immediately after each verified slice.

**Goal:** Turn the existing per-session review into a simple 900-character, 1–5 star after-session note with up to nine album-backed photos and a public WeChat share page.

**Architecture:** Preserve the existing review and eligibility models. Add a nullable album-photo foreign key to the existing review-photo join table, validate album photo IDs at the service boundary, preserve legacy review assets, and add a minimal public review projection. On the mini-program, keep the current editor route, add a tested photo-source state helper, reuse the album upload pipeline, and add one read-only share route.

**Tech Stack:** Node.js ESM, Fastify, MySQL migrations, uni-app/Vue, Node test runner, WeChat mini-program build.

---

### Task 1: Lock D49 contracts and migration

**Files:**
- Create: `scripts/d49-session-review-experience-check.js`
- Create: `apps/api/test/session-review-album-photos.test.mjs`
- Create: `apps/api/migrations/0032_session_review_album_photos.sql`
- Modify: `package.json`
- Modify: `specs/d49-session-review-experience/tasks.md`

1. Write a static contract check for the migration, 900-character boundaries, album-photo request, public routes, editor source labels, 9-photo cap, and share-page registration.
2. Write a unit test that imports the album-photo-ID normalizer and expects `undefined` preservation, explicit empty arrays, positive unique IDs, and rejection above nine.
3. Run both and confirm they fail because the migration/helper do not exist.
4. Add the migration and package scripts; leave business assertions failing until their task.
5. Mark only verified Task 1 checklist items complete.

### Task 2: Implement review album references and 900-character text

**Files:**
- Modify: `apps/api/src/modules/core/service.js`
- Modify: `apps/api/src/modules/content-moderation/text-boundaries.js`
- Modify: `apps/api/src/modules/content-moderation/text-author-projection.js`
- Modify: `apps/api/src/modules/content-moderation/author-social-read.js`
- Modify: `apps/api/test/session-review-album-photos.test.mjs`
- Modify: `scripts/d15-session-review-records-check.js`

1. Export and test `normalizeSessionReviewAlbumPhotoIds`.
2. Change all new review text limits from 500 to 900 while preserving legacy proposal decoding.
3. Add service validation for same-session, visible, active, ready, approved image rows.
4. Save `album_photo_id` rows only when `albumPhotoIds` is supplied; preserve current photos when omitted.
5. Return ordered `album_photo_ids` and render new/legacy photos through a unified projection.
6. Run the new unit test plus D15, D18 and moderation-focused tests; update the checklist.

### Task 3: Implement public review and controlled album-photo reads

**Files:**
- Modify: `apps/api/src/modules/core/service.js`
- Modify: `apps/api/src/server.js`
- Create or modify: `apps/api/test/session-review-public.test.mjs`
- Modify: `scripts/d49-session-review-experience-check.js`

1. First write failing tests/contract assertions for the minimal public DTO, author-private rejection, and photo-reference authorization.
2. Add a service getter for one publishable active review with safe author/session snapshots.
3. Add `GET /api/session-reviews/:reviewId` without login.
4. Add `GET /api/session-reviews/:reviewId/photos/:albumPhotoId/image`, checking active relation and media state before reusing the album image response helper.
5. Run public-review tests, API checks and D46 privacy tests; update the checklist.

### Task 4: Implement tested mini-program photo-source state

**Files:**
- Create: `apps/miniprogram/src/utils/sessionReviewPhotos.js`
- Create: `apps/miniprogram/test/sessionReviewPhotos.test.mjs`
- Modify: `apps/miniprogram/src/utils/api.js`
- Modify: `apps/miniprogram/src/pages/session/review.vue`

1. Write failing tests for mutually exclusive source selection, switch/reset, nine-photo cap, and omission of `albumPhotoIds` for untouched legacy reviews.
2. Implement the smallest pure state/request helpers.
3. Load visible album images into the editor and hide the album option when empty.
4. Replace review-specific upload calls with `uploadAlbumPhoto`; select only finalized publishable results.
5. Submit `albumPhotoIds` according to touched/legacy state and make the tests pass.

### Task 5: Match the selected editor UI

**Files:**
- Modify: `apps/miniprogram/src/pages/session/review.vue`
- Reference: `docs/superpowers/specs/assets/2026-07-19-session-review-experience-selected.png`

1. Keep the current page route and style language; change only the confirmed sections and copy.
2. Implement 1–5 star selection, 900-character counter, source switcher, album picker, selected thumbnails, and `N/9` display.
3. Add confirmation before switching an already-used source.
4. Rename the fixed CTA to “发布并分享” and navigate to the share page after success.
5. Build the mini-program before proceeding.

### Task 6: Add the read-only WeChat share page

**Files:**
- Create: `apps/miniprogram/src/pages/session/review-share.vue`
- Modify: `apps/miniprogram/src/pages.json`
- Modify: `scripts/d49-session-review-experience-check.js`

1. First make the static contract fail on missing page registration and share hooks.
2. Fetch the public review by ID and render only its minimal DTO.
3. Add native `open-type="share"`, `onShareAppMessage`, and `onShareTimeline`, all pointing to the same review ID.
4. Show the publish-success share affordance without claiming the async save opens WeChat automatically.
5. Run D49 checks and a mini-program build.

### Task 7: Full verification and visual QA

**Files:**
- Modify: `specs/d49-session-review-experience/tasks.md`

1. Run all new tests and D49 contract checks.
2. Run D15, D18, D31, D45, and D46 focused regressions.
3. Run `npm run check` and `npm run build:mp-weixin`.
4. Open the built editor at the matching mobile viewport, capture it, and compare it side-by-side with the selected reference using the Product Design design-QA workflow.
5. Fix visible mismatches, repeat the comparison, and record evidence and known platform limitations in `tasks.md`.
6. Review the final diff for scope fidelity before reporting completion.
