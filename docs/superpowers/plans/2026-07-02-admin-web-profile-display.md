# Admin Web Profile Display Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show full WeChat user profile information in admin-web after login instead of only showing `openid`.

**Architecture:** Keep backend login unchanged because `pollAdminWebLoginTicket()` already returns `publicUser()`. Add a tiny admin-web asset URL helper, render a compact profile trigger in `App.vue`, and show full user fields in a popover. Extend the existing D12 static check to catch regressions.

**Tech Stack:** Vue 3 SFC, Vite, browser `fetch`/`localStorage`, Node static check script.

---

## File Structure

- Modify `scripts/d12-admin-web-check.js`: add static assertions for profile fields, avatar URL handling, gender labels, and popover markup.
- Modify `apps/admin-web/src/api.js`: export `assetUrl(path)` for uploaded avatar paths.
- Modify `apps/admin-web/src/App.vue`: replace plain `openid` rendering with computed profile display state and a details popover.
- Modify `apps/admin-web/src/styles.css`: style the compact profile trigger, avatar fallback, and details popover responsively.

### Task 1: Failing Admin-Web Profile Display Check

**Files:**
- Modify: `scripts/d12-admin-web-check.js`

- [x] **Step 1: Write the failing check**

Add assertions after the existing `appShell` assertions:

```js
for (const token of [
  "displayName",
  "avatarUrl",
  "genderLabel",
  "profileDetailsOpen",
  "profile-detail-popover",
  "fullProfileRows"
]) {
  assert(appShell.includes(token), `admin shell should render profile detail ${token}`);
}
assert(
  appShell.includes("assetUrl") && appShell.includes("handleAvatarError"),
  "admin shell should resolve uploaded avatars and handle avatar load failures"
);
```

Add an assertion after the existing `webApi` assertions:

```js
assert(webApi.includes("export function assetUrl"), "web API should expose assetUrl helper");
```

- [x] **Step 2: Run the check to verify it fails**

Run: `node scripts/d12-admin-web-check.js`

Expected: FAIL with a message like `admin shell should render profile detail displayName`.

### Task 2: Admin-Web Profile Summary and Details Popover

**Files:**
- Modify: `apps/admin-web/src/api.js`
- Modify: `apps/admin-web/src/App.vue`
- Modify: `apps/admin-web/src/styles.css`

- [x] **Step 1: Implement `assetUrl()` in admin API helper**

Add this export near `apiRequest()`:

```js
export function assetUrl(path) {
  if (!path) {
    return "";
  }
  if (/^https?:\/\//i.test(path)) {
    return path;
  }
  if (path.startsWith("/uploads/")) {
    return path;
  }
  return path;
}
```

- [x] **Step 2: Replace the topbar user box in `App.vue`**

Replace the current `.user-box` block with a profile trigger, popover, and logout button. The trigger uses `profileAvatarSrc`, `displayName`, `genderLabel`, `rolesText`, `profileDetailsOpen`, and `fullProfileRows`.

- [x] **Step 3: Add computed profile state in `App.vue`**

Add computed values for:

```js
const profileDetailsOpen = ref(false);
const avatarLoadFailed = ref(false);
const user = computed(() => auth.value.user || {});
const rolesText = computed(() => (auth.value.roles || []).join(" / "));
const displayName = computed(() => {
  const current = user.value;
  return (
    String(current.nickname || "").trim() ||
    current.openid ||
    current.open_id ||
    (current.id ? `用户${current.id}` : "管理员")
  );
});
const genderLabel = computed(() => {
  const labels = { male: "男", female: "女" };
  return labels[user.value.gender] || "未选择";
});
const profileAvatarSrc = computed(() => {
  if (avatarLoadFailed.value || !user.value.avatarUrl) {
    return "";
  }
  return assetUrl(user.value.avatarUrl);
});
```

Also add `fullProfileRows` for all available fields and `handleAvatarError()`.

- [x] **Step 4: Add CSS for the profile trigger and details popover**

Add styles for `.user-box`, `.user-profile-trigger`, `.user-avatar`, `.user-avatar-image`, `.user-avatar-fallback`, `.user-summary`, `.user-name`, `.user-meta`, `.profile-detail-popover`, `.profile-detail-row`, and responsive topbar behavior.

- [x] **Step 5: Run checks and build**

Run: `node scripts/d12-admin-web-check.js`

Expected: PASS.

Run: `npm --workspace apps/admin-web run build`

Expected: Vite build completes successfully.
