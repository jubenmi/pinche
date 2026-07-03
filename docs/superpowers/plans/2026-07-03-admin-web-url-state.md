# Admin Web URL State Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist admin-web main page position in the URL so refresh restores the same workspace.

**Architecture:** Add a pure `adminRoute.js` helper for parsing and building URL state. Wire `App.vue`, `CatalogWorkspace.vue`, and `MiniProgramWorkspace.vue` to initialize from that helper and push URL changes on page-level navigation.

**Tech Stack:** Vue 3 script setup, Vite, Node check scripts.

---

### Task 1: Route Helper Tests

**Files:**
- Modify: `scripts/d12-admin-web-check.js`
- Create: `apps/admin-web/src/adminRoute.js`

- [ ] **Step 1: Write failing assertions**

Add imports and assertions to `scripts/d12-admin-web-check.js` for these cases:

```js
const adminRoute = await import(
  pathToFileURL(path.join(root, "apps/admin-web/src/adminRoute.js")).href
);
const {
  buildAdminRouteQuery,
  parseAdminRouteQuery,
  sessionBackedMiniScreens
} = adminRoute;

assert(
  parseAdminRouteQuery("?view=catalog&catalogTab=sessions").activeView === "catalog",
  "route parser should keep catalog view"
);
assert(
  parseAdminRouteQuery("?view=catalog&catalogTab=sessions").catalogTab === "sessions",
  "route parser should keep catalog tab"
);
assert(
  parseAdminRouteQuery("?view=miniapp&screen=album&sessionId=12").miniScreen === "album",
  "route parser should keep session-backed mini screen"
);
assert(
  parseAdminRouteQuery("?sessionId=12").miniScreen === "detail",
  "legacy session links should open mini detail"
);
assert(
  parseAdminRouteQuery("?view=miniapp&screen=album").miniScreen === "home",
  "session-backed mini screens without sessionId should fall back to home"
);
assert(
  buildAdminRouteQuery({ activeView: "catalog", catalogTab: "sessions" }) ===
    "?view=catalog&catalogTab=sessions",
  "route builder should serialize catalog tab"
);
assert(
  buildAdminRouteQuery({ activeView: "miniapp", miniScreen: "manage", sessionId: "12" }) ===
    "?view=miniapp&screen=manage&sessionId=12",
  "route builder should serialize session-backed mini screen"
);
assert(
  sessionBackedMiniScreens.has("album") && !sessionBackedMiniScreens.has("home"),
  "route helper should expose session-backed mini screen set"
);
```

- [ ] **Step 2: Run failing test**

Run: `node scripts/d12-admin-web-check.js`

Expected: failure because `apps/admin-web/src/adminRoute.js` does not exist.

### Task 2: Minimal Route Helper

**Files:**
- Create: `apps/admin-web/src/adminRoute.js`
- Modify: `scripts/d12-admin-web-check.js`

- [ ] **Step 1: Implement pure helper**

Implement named exports:

- `catalogTabs`
- `miniScreens`
- `sessionBackedMiniScreens`
- `parseAdminRouteQuery(search)`
- `buildAdminRouteQuery(route)`
- `writeAdminRoute(route, options = {})`

Use `URLSearchParams` for parsing/building and `window.history.pushState`/`replaceState` inside `writeAdminRoute`.

- [ ] **Step 2: Verify helper tests pass**

Run: `node scripts/d12-admin-web-check.js`

Expected: pass.

### Task 3: Vue Wiring

**Files:**
- Modify: `apps/admin-web/src/App.vue`
- Modify: `apps/admin-web/src/components/CatalogWorkspace.vue`
- Modify: `apps/admin-web/src/components/MiniProgramWorkspace.vue`

- [ ] **Step 1: Initialize from parsed URL**

In `App.vue`, parse `window.location.search` once and use it for `activeView`.

Pass parsed `catalogTab`, `miniScreen`, `sessionId`, `seatId`, `shareCode`, and `source` to child components.

- [ ] **Step 2: Update top-level navigation**

Replace direct `activeView = ...` button assignments with a function that sets `activeView` and calls `writeAdminRoute`.

- [ ] **Step 3: Update catalog tab navigation**

Add an `initial-tab` prop to `CatalogWorkspace.vue`, initialize `tab` from it, and call `writeAdminRoute({ activeView: "catalog", catalogTab: nextTab })` when switching tabs.

- [ ] **Step 4: Update mini screen navigation**

Add initial props to `MiniProgramWorkspace.vue`, initialize from them, and call `writeAdminRoute` in page-level transitions: home/create/mine/detail/manage/share/review/album.

- [ ] **Step 5: Verify build**

Run: `npm --workspace apps/admin-web run build`

Expected: build succeeds.

### Task 4: Final Verification

**Files:**
- Verify: `apps/admin-web/src/adminRoute.js`
- Verify: `apps/admin-web/src/App.vue`
- Verify: `apps/admin-web/src/components/CatalogWorkspace.vue`
- Verify: `apps/admin-web/src/components/MiniProgramWorkspace.vue`
- Verify: `scripts/d12-admin-web-check.js`

- [ ] **Step 1: Run focused check**

Run: `node scripts/d12-admin-web-check.js`

Expected: pass.

- [ ] **Step 2: Run admin build**

Run: `npm --workspace apps/admin-web run build`

Expected: pass.
