# Client Canvas Album Share Cover — Implementation Plan

> **For Codex:** Execute this plan inline, task by task. Follow test-driven development and verify each task before continuing.

**Goal:** Remove server-side public-share cover image composition and produce the 1–3-image share cover locally in the mini program with Canvas.

**Architecture:** The API retains a privacy-safe, ordered `cover_recipe` of at most three thumbnail descriptors and no longer serves a composite JPEG or its signed capability URLs. The mini program turns that recipe into a local friend/timeline cover using deterministic Canvas plans, caches the exported temporary files by recipe, and falls back to the existing static artwork on any rendering failure.

**Tech stack:** Node.js API, MySQL-backed service layer, Vue/uni-app (`mp-weixin`), WeChat Canvas, Node built-in test runner.

---

### Task 1: Replace server cover selection output with a safe client recipe

**Files:**

- Modify: `apps/api/src/modules/core/service.js`
- Modify: `apps/api/src/server.js`
- Create: `apps/api/test/album-public-share-cover-recipe.test.mjs`
- Modify: `apps/api/test/album-public-share-pagination.test.mjs`

**Step 1: Write the failing tests.**

Cover new snapshots with three ordered media IDs; cover legacy rows with more IDs by projecting only the first three privacy-safe media records. Assert public responses expose a versioned recipe with image ID, thumbnail URL, dimensions, and focus point, but neither server-cover URLs nor raw object-storage fields.

**Step 2: Run the focused test to verify red.**

```bash
node --test apps/api/test/album-public-share-cover-recipe.test.mjs
```

Expected: FAIL because the current public DTO only offers signed server-composite cover URLs.

**Step 3: Implement the smallest production change.**

Limit newly selected snapshot candidates to three, retain defensive parsing of legacy candidates, construct an ordered safe media projection in the public-share service, and serialize it as `cover_recipe`. Use the existing signed public-thumbnail route for each recipe thumbnail. Remove cover capability-token helpers, server render route, Sharp analysis helpers, cache/coordinator injection, and all related imports.

**Step 4: Run the focused server tests.**

```bash
node --test apps/api/test/album-public-share-cover-recipe.test.mjs apps/api/test/album-public-share-pagination.test.mjs apps/api/test/album-single-media-share.test.mjs
```

Expected: PASS.

**Step 5: Commit the server recipe change.**

```bash
git add apps/api/src/modules/core/service.js apps/api/src/server.js apps/api/test/album-public-share-cover-recipe.test.mjs apps/api/test/album-public-share-pagination.test.mjs
git commit -m "feat: expose client album share cover recipes"
```

### Task 2: Build and test deterministic mini-program Canvas cover rendering

**Files:**

- Create: `apps/miniprogram/src/utils/albumShareCanvas.js`
- Create: `apps/miniprogram/test/albumShareCanvas.test.mjs`

**Step 1: Write the failing tests.**

Test recipe normalization, crop-safe geometry, layout selection for one, two, and three images, friend and timeline output sizes, and a fake Canvas runtime that verifies the renderer exports a local JPEG path. Include an unavailable-runtime/error case that returns a controlled failure rather than throwing.

**Step 2: Run the focused test to verify red.**

```bash
node --test apps/miniprogram/test/albumShareCanvas.test.mjs
```

Expected: FAIL because the client Canvas module does not exist.

**Step 3: Implement the smallest production change.**

Add pure normalization and layout-plan functions, then a runtime adapter that loads each recipe thumbnail, draws crop-to-fill tiles plus lightweight title text, and exports a 0.82-quality JPEG to a temporary local path. The adapter must support the WeChat page-canvas API and permit test injection; do not download or compose images through the API server.

**Step 4: Run the focused Canvas tests.**

```bash
node --test apps/miniprogram/test/albumShareCanvas.test.mjs
```

Expected: PASS.

**Step 5: Commit the Canvas utility.**

```bash
git add apps/miniprogram/src/utils/albumShareCanvas.js apps/miniprogram/test/albumShareCanvas.test.mjs
git commit -m "feat: render album share covers in client canvas"
```

### Task 3: Wire local covers into the album share flow and remove obsolete server assets

**Files:**

- Modify: `apps/miniprogram/src/pages/album/album.vue`
- Modify: `apps/miniprogram/src/utils/albumShareCover.js`
- Modify: `apps/miniprogram/test/albumShareCover.test.mjs`
- Modify: `apps/miniprogram/test/albumSharePreview.test.mjs`
- Delete: `apps/api/src/modules/core/album-share-cover/cache.js`
- Delete: `apps/api/src/modules/core/album-share-cover/layouts.js`
- Delete: `apps/api/src/modules/core/album-share-cover/renderer.js`
- Delete: `apps/api/src/modules/core/album-share-cover/selection.js`
- Delete: `apps/api/test/album-share-cover-layouts.test.mjs`
- Delete: `apps/api/test/album-share-cover-selection.test.mjs`
- Delete: `apps/api/test/album-share-cover-renderer.test.mjs`
- Delete: `apps/api/test/album-share-cover-route.test.mjs`

**Step 1: Write the failing integration tests.**

Change mini-program assertions to expect a locally exported friend/timeline path or the static fallback, never a server-composite URL. Assert stale render results cannot replace a newer recipe and that each share target only becomes usable after its own cover path is ready.

**Step 2: Run the focused test to verify red.**

```bash
node --test apps/miniprogram/test/albumShareCover.test.mjs apps/miniprogram/test/albumSharePreview.test.mjs
```

Expected: FAIL because the existing helper prepares remote server-cover URLs.

**Step 3: Implement the smallest production change.**

Add an off-screen page canvas to the album page, pass its adapter to the Canvas utility, cache by share ID, recipe digest, and target kind, and preserve the current static fallback and stale-request guard. Delete the server cover modules and their tests once no imports remain. Retain generic Sharp thumbnail support.

**Step 4: Run the focused integration tests.**

```bash
node --test apps/miniprogram/test/albumShareCanvas.test.mjs apps/miniprogram/test/albumShareCover.test.mjs apps/miniprogram/test/albumSharePreview.test.mjs
```

Expected: PASS.

**Step 5: Commit the integrated client flow.**

```bash
git add apps/miniprogram/src/pages/album/album.vue apps/miniprogram/src/utils/albumShareCover.js apps/miniprogram/test/albumShareCover.test.mjs apps/miniprogram/test/albumSharePreview.test.mjs
git rm apps/api/src/modules/core/album-share-cover/cache.js apps/api/src/modules/core/album-share-cover/layouts.js apps/api/src/modules/core/album-share-cover/renderer.js apps/api/src/modules/core/album-share-cover/selection.js apps/api/test/album-share-cover-layouts.test.mjs apps/api/test/album-share-cover-selection.test.mjs apps/api/test/album-share-cover-renderer.test.mjs apps/api/test/album-share-cover-route.test.mjs
git commit -m "feat: prepare album share covers on device"
```

### Task 4: Replace release gates and verify the cleanup end-to-end

**Files:**

- Delete: `scripts/d52-adaptive-album-share-cover-check.js`
- Create: `scripts/d55-client-canvas-album-share-cover-check.js`
- Modify: `scripts/d54-public-album-share-full-photos-check.js`
- Modify: `scripts/d48-album-sharing-role-claim-separation-smoke.js`
- Modify: `package.json`
- Modify: `Dockerfile`
- Modify: `specs/d55-client-canvas-album-share-cover/tasks.md`

**Step 1: Write the failing static gate.**

Assert no public-share composite-cover route, token helper, cache/coordinator, renderer module, or D52 command remains; assert `cover_recipe`, client Canvas rendering, local cover paths, and the three-image bound exist. Keep the D54 gate focused on snapshot pagination rather than deleted server selection internals.

**Step 2: Run the focused static gate to verify red.**

```bash
node scripts/d55-client-canvas-album-share-cover-check.js
```

Expected: FAIL until the obsolete code and command wiring are removed.

**Step 3: Implement the smallest production change.**

Replace D52 package scripts with D55 unit/check commands and add them to `postcheck`; remove server-cover-only Docker font dependencies if no other component needs them; update D48’s layout import/assertion; mark D55 task evidence complete.

**Step 4: Run all required verification.**

```bash
npm run d55:unit
npm run d55:check
npm run check
npm run build:mp-weixin
git diff --check
```

Expected: every command exits 0; build may only show known non-fatal dependency warnings.

**Step 5: Commit the verification and documentation wiring.**

```bash
git add scripts/d55-client-canvas-album-share-cover-check.js scripts/d54-public-album-share-full-photos-check.js scripts/d48-album-sharing-role-claim-separation-smoke.js package.json Dockerfile specs/d55-client-canvas-album-share-cover/tasks.md docs/superpowers/plans/2026-07-23-client-canvas-album-share-cover.md
git rm scripts/d52-adaptive-album-share-cover-check.js
git commit -m "test: gate client canvas album share covers"
```
