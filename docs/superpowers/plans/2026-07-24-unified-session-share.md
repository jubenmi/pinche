# Unified Session Share Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reuse one WebView session share page that invites players to join before the session starts and invites actual players to claim their role and album after it starts.

**Architecture:** The API adds a server-derived `has_started` value to every session detail response. A small pure miniprogram helper turns that trusted lifecycle value into one of two presentation modes and builds the fixed-image share payload; `pages/session/share.vue` renders the chosen copy while continuing to reuse `RoleSeatBoard`. All entry points navigate to the same route, and URL source parameters never override the lifecycle mode.

**Tech Stack:** Node.js 20 tests, UniApp/Vue Options API, WeChat Mini Program WebView renderer, existing TDesign feedback utilities, existing `RoleSeatBoard`.

---

## File map

- Create `apps/api/test/session-share-lifecycle.test.mjs`: pure tests for the server-derived `has_started` field.
- Modify `apps/api/src/modules/core/service.js`: calculate and expose the authoritative session lifecycle flag.
- Create `apps/miniprogram/src/utils/sessionShare.js`: pure mode, copy, image, and payload helpers.
- Create `apps/miniprogram/test/sessionShare.test.mjs`: unit tests for both modes and untrusted URL-source behavior.
- Modify `apps/miniprogram/src/pages/session/share.vue`: render the two modes, use a native share button, and keep the sender on the share page.
- Modify `apps/miniprogram/src/pages/session/album.vue`: rename the album action and navigate to the unified page.
- Create `scripts/d56-unified-session-share-check.js`: static integration and WebView-only guard.
- Modify `package.json`: add focused D56 unit/check commands to the normal check chain.
- Reuse `apps/miniprogram/src/static/art/photo-claim-share.jpg`: fixed post-start card image already added by the approved design.

### Task 1: Expose the server-authoritative start state

**Files:**

- Create: `apps/api/test/session-share-lifecycle.test.mjs`
- Modify: `apps/api/src/modules/core/service.js`

- [ ] **Step 1: Write the failing lifecycle tests**

Create `apps/api/test/session-share-lifecycle.test.mjs`:

```js
import assert from "node:assert/strict";
import test from "node:test";

import { sessionHasStarted } from "../src/modules/core/service.js";

test("sessionHasStarted compares session start time with server time", () => {
  const now = Date.parse("2026-07-24T12:00:00.000Z");

  assert.equal(
    sessionHasStarted({ start_at: "2026-07-24T11:59:59.000Z" }, now),
    true
  );
  assert.equal(
    sessionHasStarted({ start_at: "2026-07-24T12:00:01.000Z" }, now),
    false
  );
});

test("sessionHasStarted fails closed when the session time is missing or invalid", () => {
  const now = Date.parse("2026-07-24T12:00:00.000Z");

  assert.equal(sessionHasStarted({}, now), false);
  assert.equal(sessionHasStarted({ start_at: "invalid" }, now), false);
});
```

- [ ] **Step 2: Run the test and verify the missing export fails**

Run:

```bash
node --test apps/api/test/session-share-lifecycle.test.mjs
```

Expected: FAIL because `sessionHasStarted` is not exported.

- [ ] **Step 3: Add the lifecycle helper**

Add near the other session helpers in `apps/api/src/modules/core/service.js`:

```js
export function sessionHasStarted(session = {}, nowMs = Date.now()) {
  const startAtMs = new Date(session?.start_at || "").getTime();
  const normalizedNowMs = Number(nowMs);
  return (
    Number.isFinite(startAtMs) &&
    Number.isFinite(normalizedNowMs) &&
    startAtMs <= normalizedNowMs
  );
}
```

Add this field to both `memberSessionDetail()` and `publicSessionPreview()` return values:

```js
has_started: sessionHasStarted(safeSession),
```

Place it alongside `join_policy`, before the seats arrays, so member and invite-preview responses have the same mode signal.

- [ ] **Step 4: Run the lifecycle tests**

Run:

```bash
node --test apps/api/test/session-share-lifecycle.test.mjs
```

Expected: 2 tests PASS.

- [ ] **Step 5: Run the existing session and invite regressions**

Run:

```bash
node scripts/d23-album-share-join-policy-check.js
node scripts/d40-guest-calendar-home-check.js
```

Expected: both commands exit 0.

- [ ] **Step 6: Commit the lifecycle contract**

```bash
git add apps/api/src/modules/core/service.js apps/api/test/session-share-lifecycle.test.mjs
git commit -m "feat: expose session share lifecycle"
```

### Task 2: Add pure dual-mode share helpers

**Files:**

- Create: `apps/miniprogram/src/utils/sessionShare.js`
- Create: `apps/miniprogram/test/sessionShare.test.mjs`

- [ ] **Step 1: Write the failing mode and payload tests**

Create `apps/miniprogram/test/sessionShare.test.mjs`:

```js
import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSessionSharePayload,
  resolveSessionShareMode,
  sessionSharePresentation
} from "../src/utils/sessionShare.js";

test("server has_started selects join before departure and claim afterwards", () => {
  assert.equal(resolveSessionShareMode({ has_started: false }), "join");
  assert.equal(resolveSessionShareMode({ has_started: true }), "claim");
});

test("URL source cannot force the business mode", () => {
  assert.equal(
    resolveSessionShareMode({ has_started: false }, { source: "claim", entry: "album" }),
    "join"
  );
  assert.equal(
    resolveSessionShareMode({ has_started: true }, { source: "join", entry: "session" }),
    "claim"
  );
});

test("claim mode uses claim language and the fixed claim image", () => {
  assert.deepEqual(sessionSharePresentation("claim"), {
    pageTitle: "邀请认领",
    pageIntro: "邀请本局玩家认领照片，选择自己玩过的角色。",
    buttonText: "分享给玩家认领",
    cardTitleSuffix: "照片待认领",
    imageUrl: "/static/art/photo-claim-share.jpg"
  });
});

test("payload keeps one landing route and records, but does not trust, the mode", () => {
  assert.deepEqual(
    buildSessionSharePayload({
      sessionId: 42,
      inviteToken: "token value",
      shareCode: "s42-1",
      scriptName: "年轮",
      mode: "claim"
    }),
    {
      title: "《年轮》照片待认领",
      path: "/pages/session/share?id=42&shareCode=s42-1&inviteToken=token%20value&entry=wechat_share&source=claim",
      imageUrl: "/static/art/photo-claim-share.jpg"
    }
  );
});

test("payload is unavailable until session id and invite token exist", () => {
  assert.equal(buildSessionSharePayload({ sessionId: 42, mode: "join" }), null);
  assert.equal(buildSessionSharePayload({ inviteToken: "token", mode: "join" }), null);
});
```

- [ ] **Step 2: Run the test and verify the missing module fails**

Run:

```bash
node --test apps/miniprogram/test/sessionShare.test.mjs
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implement the pure helper**

Create `apps/miniprogram/src/utils/sessionShare.js`:

```js
const PRESENTATIONS = Object.freeze({
  join: Object.freeze({
    pageTitle: "邀请上车",
    pageIntro: "邀请玩家加入本局，选择一个空位，和大家一起开局。",
    buttonText: "分享拼车邀请",
    cardTitleSuffix: "正在拼车",
    imageUrl: "/static/art/ticket-landscape.jpg"
  }),
  claim: Object.freeze({
    pageTitle: "邀请认领",
    pageIntro: "邀请本局玩家认领照片，选择自己玩过的角色。",
    buttonText: "分享给玩家认领",
    cardTitleSuffix: "照片待认领",
    imageUrl: "/static/art/photo-claim-share.jpg"
  })
});

export function resolveSessionShareMode(session = {}) {
  if (typeof session?.has_started === "boolean") {
    return session.has_started ? "claim" : "join";
  }
  const startAtMs = new Date(session?.start_at || "").getTime();
  return Number.isFinite(startAtMs) && startAtMs <= Date.now() ? "claim" : "join";
}

export function sessionSharePresentation(mode) {
  return PRESENTATIONS[mode] || PRESENTATIONS.join;
}

export function buildSessionSharePayload({
  sessionId,
  inviteToken,
  shareCode,
  scriptName,
  mode
} = {}) {
  const id = String(sessionId || "").trim();
  const token = String(inviteToken || "").trim();
  if (!id || !token) return null;

  const normalizedMode = mode === "claim" ? "claim" : "join";
  const presentation = sessionSharePresentation(normalizedMode);
  const query = [
    `id=${encodeURIComponent(id)}`,
    `shareCode=${encodeURIComponent(String(shareCode || ""))}`,
    `inviteToken=${encodeURIComponent(token)}`,
    "entry=wechat_share",
    `source=${normalizedMode}`
  ].join("&");

  return Object.freeze({
    title: `《${String(scriptName || "本局")}》${presentation.cardTitleSuffix}`,
    path: `/pages/session/share?${query}`,
    imageUrl: presentation.imageUrl
  });
}
```

- [ ] **Step 4: Run the helper tests**

Run:

```bash
node --test apps/miniprogram/test/sessionShare.test.mjs
```

Expected: 5 tests PASS.

- [ ] **Step 5: Commit the pure share model**

```bash
git add apps/miniprogram/src/utils/sessionShare.js apps/miniprogram/test/sessionShare.test.mjs
git commit -m "feat: add unified session share modes"
```

### Task 3: Convert the existing share page to lifecycle-driven copy

**Files:**

- Modify: `apps/miniprogram/src/pages/session/share.vue`

- [ ] **Step 1: Import the helper and expose mode presentation**

Add:

```js
import {
  buildSessionSharePayload,
  resolveSessionShareMode,
  sessionSharePresentation
} from "../../utils/sessionShare";
```

Add `sessionLoadError: ""` and `invitePreparing: false` to `data()`. Replace entry-driven title computation with:

```js
shareMode() {
  return resolveSessionShareMode(this.session);
},
sharePresentation() {
  return sessionSharePresentation(this.shareMode);
},
pageTitle() {
  return this.sharePresentation.pageTitle;
},
pageIntro() {
  return this.sharePresentation.pageIntro;
},
shareButtonText() {
  return this.sharePresentation.buttonText;
},
shareReady() {
  return Boolean(this.sessionId && this.inviteToken && !this.sessionLoadError);
},
isClaimMode() {
  return this.shareMode === "claim";
}
```

Keep `entry` only for diagnostics and navigation history. Do not use it to compute `shareMode`.

- [ ] **Step 2: Render a visible state and a native share button**

Replace the TDesign share button with:

```vue
<view v-if="sessionLoadError" class="share-error">
  <text>{{ sessionLoadError }}</text>
  <button class="share-retry" @tap="retryLoadSession">重新加载</button>
</view>

<view v-else class="share-actions">
  <button
    class="button wechat-action"
    open-type="share"
    :disabled="!shareReady"
    @tap="persistFlow"
  >
    <view class="wechat-action-content">
      <t-image
        class="button-icon"
        src="/static/icons/share-light.svg"
        mode="aspectFit"
      />
      <text>{{ shareReady ? shareButtonText : "分享准备中…" }}</text>
    </view>
  </button>
</view>
```

Add scoped styles for `.share-error` and `.share-retry` using the existing cream background, thin green border, and 24–28rpx type. Do not add a Canvas, snapshot node, poster layer, or Skyline-only element.

- [ ] **Step 3: Make the existing seat board use mode-correct labels**

In `roleCards()`, keep the same seat calculation and only change the displayed labels:

```js
const labels = this.isClaimMode
  ? {
      mine: "我认领",
      taken: "已认领",
      pendingReview: "待确认",
      unavailable: "不可认领",
      available: "待认领",
      switching: "换认领"
    }
  : {
      mine: "",
      taken: "已选",
      pendingReview: "待审",
      unavailable: "不可选",
      available: "可选",
      switching: "换选"
    };
```

Set `stateLabel: labels[stateKind]`. Keep `RoleSeatBoard`, its sections, and its tap event unchanged.

- [ ] **Step 4: Stop redirecting the sender away from the share page**

Delete the automatic `redirectAlbumMemberIfNeeded()` calls from `onLoad`, fresh-login refresh, and `loadPublishedSession()`. A member entering with `entry=album` must stay on the share page so they can press the share button.

Only redirect after a successful claim-mode role claim:

```js
openAlbumAfterClaim() {
  if (!this.isClaimMode || !this.sessionId || this.navigatingAlbum) return false;
  this.navigatingAlbum = true;
  uni.redirectTo({ url: `/pages/session/album?id=${this.sessionId}` });
  return true;
}
```

Call it after `join_result === "joined"` or `join_result === "npc_joined"`. If `active_album_photo_count` is zero, keep the player on the page and set:

```js
this.statusText = "角色已认领，照片上传后即可查看。";
```

- [ ] **Step 5: Use mode-correct claim messages**

For phone authorization, request notes, success text, and conflict text, branch only on `isClaimMode`. Use:

```js
selectionCopy() {
  return this.isClaimMode
    ? {
        phoneTitle: "授权手机号后认领",
        phoneContent: "认领角色前需要授权手机号，便于核对本局玩家。",
        directNote: "相册认领页认领角色",
        success: "角色已认领",
        conflict: "这个角色已被认领"
      }
    : {
        phoneTitle: "授权手机号后上车",
        phoneContent: "上车前需要授权手机号，方便车头沟通和审核。",
        directNote: "分享页选择角色上车",
        success: "已上车",
        conflict: "这个角色已被选择"
      };
}
```

Keep the same seat-claim and signup endpoints; this task changes product meaning and presentation, not the existing membership/permission model.

- [ ] **Step 6: Build share payloads through the helper**

Replace the published-session branch of `onShareAppMessage()` with:

```js
onShareAppMessage() {
  this.persistFlow();
  const payload = buildSessionSharePayload({
    sessionId: this.sessionId,
    inviteToken: this.inviteToken,
    shareCode: `s${this.sessionId}-${Date.now()}`,
    scriptName: this.scriptName,
    mode: this.shareMode
  });
  if (payload) return payload;
  showToast({ title: "分享尚未准备好，请稍后重试", icon: "none" });
  return undefined;
}
```

Do not restore dataset-dependent behavior. Do not use a live album photo or page screenshot as `imageUrl`.

- [ ] **Step 7: Make loading and retry explicit**

In `loadPublishedSession()` clear `sessionLoadError` before the request and set it to `车局加载失败，请重试` in `catch`. Add:

```js
async retryLoadSession() {
  if (!this.sessionId) {
    this.sessionLoadError = "车局信息不存在";
    return;
  }
  await this.loadPublishedSession(this.sessionId);
  await this.prepareJoinInviteToken();
}
```

In `prepareJoinInviteToken()`, set `invitePreparing` while awaiting and set `statusText = "分享准备失败，请重试。"` when token creation fails.

- [ ] **Step 8: Run the helper tests and build**

Run:

```bash
node --test apps/miniprogram/test/sessionShare.test.mjs
npm run build:mp-weixin
```

Expected: unit tests pass and the miniprogram build exits 0.

- [ ] **Step 9: Commit the unified page**

```bash
git add apps/miniprogram/src/pages/session/share.vue
git commit -m "feat: switch session share page by lifecycle"
```

### Task 4: Route the album action into the unified page

**Files:**

- Modify: `apps/miniprogram/src/pages/session/album.vue`

- [ ] **Step 1: Rename the album action and handler**

Change the tool label and tap handler:

```vue
<t-button
  class="album-command"
  size="extra-small"
  :disabled="albumBusy"
  @tap="openClaimShare"
>
  <view class="album-command-content">
    <t-image
      class="album-command-icon"
      src="/static/icons/album-recruit.svg"
      mode="aspectFit"
    />
    <text class="album-command-label">邀请认领</text>
  </view>
</t-button>
```

Replace `openRecruitment()` with:

```js
openClaimShare() {
  if (this.timelineMode || this.albumBusy || !this.sessionId) return;
  uni.navigateTo({
    url: `/pages/session/share?id=${this.sessionId}&entry=album`
  });
}
```

This action must not have `open-type="share"` and must not participate in `onShareAppMessage(options)` dataset routing.

- [ ] **Step 2: Build the miniprogram**

Run:

```bash
npm run build:mp-weixin
```

Expected: build exits 0.

- [ ] **Step 3: Commit the album entry**

```bash
git add apps/miniprogram/src/pages/session/album.vue
git commit -m "fix: open unified claim share from album"
```

### Task 5: Add integration guards for one route, native sharing, and WebView only

**Files:**

- Create: `scripts/d56-unified-session-share-check.js`
- Modify: `package.json`

- [ ] **Step 1: Write the failing static check**

Create `scripts/d56-unified-session-share-check.js`:

```js
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const sharePage = read("apps/miniprogram/src/pages/session/share.vue");
const albumPage = read("apps/miniprogram/src/pages/session/album.vue");
const pages = read("apps/miniprogram/src/pages.json");
const privateConfigs = [
  "apps/miniprogram/project.private.config.json",
  "apps/miniprogram/src/project.private.config.json"
].map(read);
const claimImage = path.join(
  root,
  "apps/miniprogram/src/static/art/photo-claim-share.jpg"
);

assert(sharePage.includes("<RoleSeatBoard"), "share page must reuse RoleSeatBoard");
assert(
  /<button[\\s\\S]*open-type="share"/.test(sharePage),
  "share page must use a native share button"
);
assert(
  !/<t-button[\\s\\S]{0,300}open-type="share"/.test(sharePage),
  "TDesign button must not own the share open-type"
);
assert(
  sharePage.includes("resolveSessionShareMode(this.session)"),
  "server session state must decide the share mode"
);
assert(
  albumPage.includes(">邀请认领</text>") &&
    albumPage.includes("/pages/session/share?id=${this.sessionId}&entry=album"),
  "album action must navigate to the unified claim entry"
);
assert(
  pages.includes('"path": "pages/session/share"'),
  "the unified share route must remain registered"
);
assert(
  !pages.includes('"renderer": "skyline"'),
  "no page may enable Skyline"
);
for (const config of privateConfigs) {
  assert(
    !config.includes('"skylineRenderEnable": true'),
    "private config must not enable Skyline"
  );
}
assert(
  fs.existsSync(claimImage) && fs.statSync(claimImage).size > 0,
  "the fixed claim share image must exist"
);

console.log("D56 unified session share checks passed");
```

- [ ] **Step 2: Run the static check**

Run:

```bash
node scripts/d56-unified-session-share-check.js
```

Expected before all page work is present: FAIL on the first missing integration contract. After Tasks 1–4: PASS.

- [ ] **Step 3: Register focused commands**

Add to root `package.json` scripts:

```json
"d56:unit": "node --test apps/api/test/session-share-lifecycle.test.mjs apps/miniprogram/test/sessionShare.test.mjs",
"d56:check": "node scripts/d56-unified-session-share-check.js"
```

Add `npm run d56:unit && npm run d56:check &&` near the start of the root `precheck` command, and add syntax checking plus `npm run d56:check` to the root `check` command.

- [ ] **Step 4: Run the focused checks**

Run:

```bash
npm run d56:unit
npm run d56:check
```

Expected: lifecycle tests, share helper tests, and static integration check all pass.

- [ ] **Step 5: Commit the guards**

```bash
git add package.json scripts/d56-unified-session-share-check.js
git commit -m "test: guard unified session sharing"
```

### Task 6: Final verification in code and WeChat Developer Tools

**Files:**

- Verify only; do not add unrelated changes.

- [ ] **Step 1: Run focused and adjacent regressions**

Run:

```bash
npm run d56:unit
npm run d56:check
node scripts/d23-album-share-join-policy-check.js
node scripts/d48-album-sharing-role-claim-separation-check.js
node scripts/d40-guest-calendar-home-check.js
```

Expected: every command exits 0.

- [ ] **Step 2: Run the production miniprogram build**

Run:

```bash
npm run build:mp-weixin
```

Expected: build exits 0; existing Sass deprecation warnings are allowed, compile errors are not.

- [ ] **Step 3: Run the repository check**

Run:

```bash
npm run check
```

Expected: exits 0. If an external API or database prerequisite is unavailable, record the exact failing command and still run all local D56, D23, D40, D48, and build checks.

- [ ] **Step 4: Verify before departure**

In WeChat Developer Tools:

1. Open a session whose server response has `has_started=false`.
2. Confirm `/pages/session/share` shows “邀请上车” and “分享拼车邀请”.
3. Share to a test chat and confirm the existing fixed拼车 image is used.
4. Open the recipient link and claim an empty seat.

- [ ] **Step 5: Verify after departure**

In WeChat Developer Tools:

1. Open the same session with `has_started=true`.
2. Confirm the same route now shows “邀请认领” and no “上车/还差几位” copy.
3. Enter from the album’s “邀请认领” action and confirm the sender stays on the share page.
4. Share to a test chat and confirm `/static/art/photo-claim-share.jpg` is used.
5. Open the recipient link, claim the played role, and enter the album when photos exist.
6. Repeat once with no photos and confirm “角色已认领，照片上传后即可查看。”

- [ ] **Step 6: Verify WebView-only configuration**

Run:

```bash
rg -n -i '"renderer"\\s*:\\s*"skyline"|skylineRenderEnable"\\s*:\\s*true' apps/miniprogram
```

Expected: no matches. In Developer Tools, confirm both album and share pages run with WebView.

- [ ] **Step 7: Review the final diff**

Run:

```bash
git diff --check
git status --short
git log --oneline -6
```

Expected: no whitespace errors; only intentional feature files and the user’s pre-existing unrelated changes remain.

### Task 7: Final-review hardening

**Files:**

- Modify: `apps/api/src/modules/core/service.js`
- Modify: `apps/api/test/session-share-lifecycle.test.mjs`
- Modify: `apps/miniprogram/src/pages/session/share.vue`
- Create: `apps/miniprogram/test/sessionSharePage.test.mjs`
- Modify: `scripts/d56-unified-session-share-check.js`
- Modify: `scripts/d56-unified-session-share-check.test.mjs`
- Modify: `scripts/check-miniprogram.js`
- Modify: `package.json`

- [x] **Step 1: Refresh the authoritative lifecycle on show and at the start boundary**

  Add a behavioral regression that loads `has_started=false`, hides sharing during a later
  refresh, and only emits a claim-mode payload after a fresh `has_started=true` response and
  token-ready state. Reuse the page's request-promise guards so concurrent lifecycle hooks do
  not race or duplicate requests.

- [x] **Step 2: Respect public NPC occupancy flags**

  Add a public invite-preview regression for stripped NPC identity fields with `is_bound` or
  `has_pending_signup`, then include those flags in the existing taken-state calculation without
  exposing private identity data.

- [x] **Step 3: Fail the top-right share menu closed**

  Cover load failure, token failure, invite-preview readiness, and later successful preparation.
  Hide both share menus whenever `shareReady` is false, and reevaluate menu visibility after
  loads, token attempts, lifecycle refreshes, and retries.

- [x] **Step 4: Block cancelled-session invitation tokens**

  Add an API regression that rejects token authorization for a cancelled session and a page
  regression for the permanent `车局已取消，无法分享` state. Do not show the generic retryable
  preparation error or mint a token for that state.

- [x] **Step 5: Harden fixed-image and project-wide WebView guards**

  Mutate a valid-sized JPEG fixture to another 5:4 size and require exact `560x448`. Mutate
  relevant miniprogram JSON/source/config fixtures to enable Skyline and require the project-wide
  guard to catch them while accepting disabled flags and unrelated prose.

- [x] **Step 6: Verify and commit**

  Run focused D56 tests/checks, adjacent privacy/login/claim checks, the miniprogram build, and
  the full relevant repository verification. Confirm that no generated build output or Developer
  Tools configuration mutation is included before committing.

### Task 8: Spec-review blocking fixes

**Files:**

- Modify: `apps/api/src/modules/core/service.js`
- Modify: `apps/api/src/server.js`
- Modify: `apps/api/test/session-share-lifecycle.test.mjs`
- Modify: `apps/miniprogram/src/pages/session/share.vue`
- Modify: `apps/miniprogram/test/sessionSharePage.test.mjs`
- Modify: `scripts/d56-unified-session-share-check.js`
- Modify: `scripts/d56-unified-session-share-check.test.mjs`

- [x] **Step 1: Bound client-ahead lifecycle reconciliation**

  Add fake-timer coverage proving that an authoritative pre-start response received after the
  client boundary triggers only a capped number of backoff refreshes, with no lingering timer or
  request loop after the cap.

- [x] **Step 2: Make token authorization and signing atomic**

  Add a service-level race regression where cancellation lands between the initial session read
  and token signing. Re-authorize the locked session immediately before signing inside one
  transaction, and invoke the signer before releasing that transaction.

- [x] **Step 3: Invalidate delayed share-menu callbacks**

  Add a delayed-`hideShareMenu.complete` regression and gate the callback by both a generation
  token and current `shareReady` state so stale completions cannot re-enable sharing.

- [x] **Step 4: Hide the native share button until ready**

  Add a template regression requiring the `open-type="share"` button to render only when
  `shareReady` is true, with a non-share preparation/error control in the other branch.

- [x] **Step 5: Catch quoted Skyline keys and skip vendored trees**

  Add source mutation coverage for quoted JavaScript keys and traversal coverage excluding
  `src/wxcomponents`, `src/uni_modules`, build, test, and vendor directories.

- [x] **Step 6: Verify and amend**

  Run focused tests, the complete `npm run check`, diff/status/artifact checks, and amend the
  feature commit only after all regressions pass.

### Task 9: Page-activity lifecycle invalidation

**Files:**

- Modify: `apps/miniprogram/src/pages/session/share.vue`
- Modify: `apps/miniprogram/test/sessionSharePage.test.mjs`
- Modify: `scripts/check-miniprogram.js`
- Modify: `docs/superpowers/plans/2026-07-24-unified-session-share.md`

- [x] **Step 1: Invalidate a hidden page during an authoritative GET**

  Add a deferred-GET regression proving `onHide` immediately hides sharing and prevents the stale
  response from scheduling a boundary timer, preparing a token, or showing a menu. Prove the next
  `onShow` starts a fresh authoritative refresh and can recover normally.

- [x] **Step 2: Invalidate an unloaded page during token preparation**

  Add a deferred-token regression proving `onUnload` clears timers, ignores the stale token
  response, and does not reevaluate or show sharing after navigation.

- [x] **Step 3: Invalidate delayed menu completions on navigation**

  Add a delayed-`hideShareMenu.complete` regression proving hide/unload invalidation prevents the
  callback from showing a friend-share menu even if the page was ready when it began.

- [x] **Step 4: Verify and commit**

  Run D56 unit/check, focused adjacent miniprogram guards, the complete `npm run check`,
  `git diff --check`, artifact/status checks, and create a follow-up feature commit.

### Task 10: Final quality-review hardening

**Files:**

- Modify: `apps/api/src/modules/core/service.js`
- Modify: `apps/api/test/session-share-lifecycle.test.mjs`
- Modify: `apps/miniprogram/src/pages/session/share.vue`
- Modify: `apps/miniprogram/test/sessionSharePage.test.mjs`
- Modify: `scripts/check-miniprogram.js`
- Modify: `scripts/d29-join-login-gate-check.js`
- Modify: `scripts/d39-city-preview-readonly-check.js`
- Modify: `docs/superpowers/plans/2026-07-24-unified-session-share.md`

- [x] **Step 1: Add bounded lifecycle recovery**

  After the capped clock-skew refreshes, expose one explicit full lifecycle retry instead of
  leaving the active page in a permanent preparation state. Prove a later authoritative
  `has_started=true` response recovers sharing without restarting background polling.

- [x] **Step 2: Make role actionability server-authoritative**

  Derive published-session start actionability only from `session.has_started`. Cover both a fast
  client with `has_started=false` and a slow client with `has_started=true` in role-card behavior.

- [x] **Step 3: Invalidate seat and NPC action continuations**

  Carry the page activity generation through login, confirmation, claim, subscription, refresh,
  status, toast, and album-navigation continuations. Deferred seat and NPC tests must prove a
  hidden or unloaded page performs no post-response UI/subscription/navigation work; the next
  `onShow` remains responsible for reconciliation.

- [x] **Step 4: Remove the token lock-order cycle**

  Record that the repository has mixed—not established child-first—locking: cancellation and
  reschedule are session-first, seat claim is child-only, and joined NPC/kick locks have
  optimizer-dependent physical order. Lock only the session for cancellation serialization, then
  perform a fresh membership authorization immediately before signing without taking child locks.
  Add SQL-order and concurrent-cancellation tests.

- [x] **Step 5: Verify and commit**

  Run focused suites, the complete `npm run check`, `git diff --check`, artifact/status checks,
  and create a follow-up commit on top of `70337b0f`.
