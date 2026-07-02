# Admin Web Miniapp Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make admin-web expose two top-level areas and make the web miniapp functionally match the WeChat mini-program user-side flows, excluding WeChat-only platform capabilities.

**Architecture:** Keep `CatalogWorkspace` as the management area and keep `MiniProgramWorkspace` as the first web-miniapp state container. Add missing API wrappers, then extend the web-miniapp with share/role state, detail share tracking, chat, pinned-message management, and leave-organizer behavior. Use `scripts/d12-admin-web-check.js` as the static parity gate.

**Tech Stack:** Vue 3 SFC, Vite, browser Fetch/File APIs, Node static check script.

---

## Source Of Truth

- Design spec: `docs/superpowers/specs/2026-07-02-admin-web-miniapp-parity-design.md`
- Tracking file: this plan.

## File Structure

- Modify `scripts/d12-admin-web-check.js`: add failing static assertions for two-block admin navigation, web-miniapp parity tokens, chat/pin/share APIs.
- Modify `apps/admin-web/src/api.js`: add API wrappers for chat, pinned message, and share view tracking.
- Modify `apps/admin-web/src/App.vue`: remove standalone album navigation and rename the two top-level areas.
- Modify `apps/admin-web/src/components/MiniProgramWorkspace.vue`: add the missing web-miniapp behavior while preserving existing home/create/mine/detail/manage/review/album flows.
- Modify `apps/admin-web/src/styles.css`: add small utility styles needed by share cards, chat, and pinned-message panels if existing `mini-*` styles are insufficient.

### Task 1: Static Parity Gate

**Files:**
- Modify: `scripts/d12-admin-web-check.js`

Progress: static assertions added and verified failing on missing `pinSessionChatMessage`.

- [x] **Step 1: Write failing static assertions**

Add assertions that require:

```js
const appShell = read("apps/admin-web/src/App.vue");
assert(appShell.includes("管理界面"), "admin shell should name the management area");
assert(appShell.includes("网页小程序"), "admin shell should name the web miniapp area");
assert(!appShell.includes("activeView === 'album'"), "album should not be a top-level admin shell area");

const miniProgramWorkspace = read("apps/admin-web/src/components/MiniProgramWorkspace.vue");
for (const token of [
  "screen === 'share'",
  "openShare",
  "shareRoleCards",
  "pendingShareRole",
  "confirmShareRole",
  "confirmedCrossCastRoleKey",
  "copyShareLink",
  "copySeatShareLink",
  "trackShareView",
  "getSessionChat",
  "sendSessionMessage",
  "pinSessionChatMessage",
  "leaveOrganizer"
]) {
  assert(miniProgramWorkspace.includes(token), `web miniapp should include parity token ${token}`);
}

const webApi = read("apps/admin-web/src/api.js");
for (const token of [
  "pinSessionChatMessage",
  "getSessionChat",
  "sendSessionMessage",
  "trackShareView"
]) {
  assert(webApi.includes(`export function ${token}`), `web API should export ${token}`);
}
```

- [x] **Step 2: Run the check and confirm it fails**

Run: `node scripts/d12-admin-web-check.js`

Expected: FAIL before implementation, with the first missing parity token.

### Task 2: API Wrappers

**Files:**
- Modify: `apps/admin-web/src/api.js`

Progress: API wrappers added and `node --check apps/admin-web/src/api.js` exited 0.

- [x] **Step 1: Add chat, pinned-message, and share tracking wrappers**

Add:

```js
export function pinSessionChatMessage(sessionId, pinnedMessageText) {
  return apiRequest(`/api/sessions/${sessionId}/chat/pin`, {
    method: "PATCH",
    body: { pinnedMessageText }
  });
}

export function getSessionChat(sessionId) {
  return apiRequest(`/api/sessions/${sessionId}/chat`);
}

export function sendSessionMessage(sessionId, content) {
  return apiRequest(`/api/sessions/${sessionId}/messages`, {
    method: "POST",
    body: { content }
  });
}

export function trackShareView(body) {
  return apiRequest("/api/share-events/view", {
    method: "POST",
    body
  });
}
```

- [x] **Step 2: Run syntax check**

Run: `node --check apps/admin-web/src/api.js`

Expected: PASS.

### Task 3: Two-Block Admin Shell

**Files:**
- Modify: `apps/admin-web/src/App.vue`

Progress: top-level shell reduced to management and web miniapp; static check now fails on missing web-miniapp share parity.

- [x] **Step 1: Remove top-level album area and rename catalog**

Change the sidebar so only these top-level views remain:

```vue
<button ... @click="activeView = 'catalog'">
  <span class="nav-icon">管</span>
  <span class="nav-text">管理界面</span>
</button>
<button ... @click="activeView = 'miniapp'">
  <span class="nav-icon">用</span>
  <span class="nav-text">网页小程序</span>
</button>
```

Set `pageTitle` to return `管理界面` for catalog and `网页小程序` for miniapp. Remove the standalone `SessionAlbumWorkspace` import and render branch.

- [x] **Step 2: Run static check**

Run: `node scripts/d12-admin-web-check.js`

Expected: Still FAIL because miniapp parity implementation is not complete yet.

### Task 4: Web Miniapp Functional Parity

**Files:**
- Modify: `apps/admin-web/src/components/MiniProgramWorkspace.vue`
- Modify: `apps/admin-web/src/styles.css`

Progress: implemented share state, chat, pinned message, leave organizer, copy-link alternatives, and verified with static check plus admin-web build.

- [x] **Step 1: Import new API wrappers and add state**

Import `pinSessionChatMessage`, `getSessionChat`, `sendSessionMessage`, and `trackShareView`.

Add refs/computed values for share-role state, focused seat, current user id/gender, share status, chat state, and pinned message state.

- [x] **Step 2: Route detail seat selection through share page**

Replace direct detail-page `claimSeat(seat)` calls with `openShare(detailSession.id, seat.id)`.

- [x] **Step 3: Add share page UI and role status logic**

Add a `screen === 'share'` section that displays ticket metadata, role cards, state labels, copy-link actions, and confirm role action.

- [x] **Step 4: Add create flow pinned-message persistence**

After publishing and claiming the organizer seat, call `pinSessionChatMessage(session.id, pinnedMessageText)` and then open the share page.

- [x] **Step 5: Add detail share tracking and copy-link alternatives**

When opening detail from URL query with `shareCode`, `source`, or `seatId`, call `trackShareView`. Add `copyShareLink()` and `copySeatShareLink(seat)`.

- [x] **Step 6: Add chat panel**

In detail, load chat via `getSessionChat`, show pinned message and messages, and send messages with `sendSessionMessage`.

- [x] **Step 7: Add manage pinned-message editing and leave organizer**

In manage, load pinned message, save it via `pinSessionChatMessage`, and add `leaveOrganizer()`.

- [x] **Step 8: Run checks and build**

Run: `node scripts/d12-admin-web-check.js`

Expected: PASS.

Run: `npm --workspace apps/admin-web run build`

Expected: PASS.

### Task 5: Align Album Entry With Mini-Program Logic

**Files:**
- Modify: `scripts/d12-admin-web-check.js`
- Modify: `scripts/d18-session-album-privacy-check.js`
- Modify: `apps/admin-web/src/components/MiniProgramWorkspace.vue`
- Modify: `apps/admin-web/src/components/SessionAlbumWorkspace.vue`
- Modify: `apps/admin-web/src/styles.css`

Progress: implemented. The web miniapp album now follows mini-program single-session entry logic and no longer renders an accessible-session list.

- [x] **Step 1: Write failing checks**

Require `SessionAlbumWorkspace` to receive `sessionId`, forbid `listMySessions` and `scope: "album"` inside that component, and require `MiniProgramWorkspace` to use `openAlbum`.

- [x] **Step 2: Run checks and confirm they fail**

Run: `node scripts/d18-session-album-privacy-check.js`

Expected: FAIL while the workspace still uses `scope: "album"`.

- [x] **Step 3: Implement single-session album workspace**

Remove the accessible-session list from `SessionAlbumWorkspace`, load one session by prop, and keep upload/tag/privacy behavior for that session.

- [x] **Step 4: Route web miniapp album entry through detail-only openAlbum**

Remove album from tabs/home shortcuts. Add `openAlbum(sessionId)` in `MiniProgramWorkspace`, check start time before entering `screen === 'album'`, and render `<SessionAlbumWorkspace :session-id="activeSessionId" />`.

- [x] **Step 5: Verify**

Run: `node scripts/d18-session-album-privacy-check.js`

Expected: PASS.

Run: `node scripts/d12-admin-web-check.js`

Expected: PASS.

Run: `npm --workspace apps/admin-web run build`

Expected: PASS.
