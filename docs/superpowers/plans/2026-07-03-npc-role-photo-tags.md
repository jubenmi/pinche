# NPC Role Photo Tags Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build first-class session NPC role slots that can be tagged in session albums and optionally bound to WeChat users.

**Architecture:** Store fixed NPC role definitions per script and clone them into session NPC role slots on session creation. Album people and tag persistence operate only on session-level NPC roles so extra store-designed NPCs and bound users share one runtime model. Existing legacy `npc:session` remains available for compatibility.

**Tech Stack:** Node.js HTTP API, MySQL migrations, Vue 3 Admin Web, UniApp mini-program, static check scripts, smoke scripts.

---

## File Structure

- Create `apps/api/migrations/0015_npc_role_tags.sql` for the two role tables and album tag extension.
- Modify `apps/api/src/modules/core/service.js` for normalization, script NPC CRUD, session NPC role creation, membership, album people, and tag persistence.
- Modify `apps/api/src/server.js` for admin/session NPC role routes.
- Modify `apps/admin-web/src/api.js` for session NPC role API helpers.
- Modify `apps/admin-web/src/components/ScriptDrawer.vue` to edit fixed script NPC roles.
- Modify `apps/admin-web/src/components/MiniProgramWorkspace.vue` to submit extra NPC roles when creating a session.
- Modify `apps/admin-web/src/components/SessionAlbumWorkspace.vue` to show NPC role tags separately.
- Modify `apps/miniprogram/src/pages/session/setup.vue` to submit extra NPC role names.
- Modify `apps/miniprogram/src/pages/session/album.vue` to show NPC role tags separately and keep a fallback for session detail.
- Modify `scripts/d18-session-album-privacy-smoke.js` for behavior coverage.
- Create `scripts/d19-npc-role-tags-check.js` and add it to `package.json` check.

### Task 1: Add Static Gate

**Files:**
- Create: `scripts/d19-npc-role-tags-check.js`
- Modify: `package.json`

- [ ] **Step 1: Write the failing static check**

Create a Node check that asserts:

```js
const migration = read("apps/api/migrations/0015_npc_role_tags.sql");
for (const token of [
  "CREATE TABLE IF NOT EXISTS script_npc_roles",
  "CREATE TABLE IF NOT EXISTS session_npc_roles",
  "session_npc_role_id",
  "fk_session_album_photo_tags_session_npc_role"
]) assert(migration.includes(token), `npc role migration must include ${token}`);
```

Also assert service/server/frontend tokens such as `script_npc_roles`, `session_npc_roles`, `session-npc:`, `session_npc_role`, `npcRolePeople`, and `extraNpcRoles`.

- [ ] **Step 2: Run the check and verify it fails**

Run: `node scripts/d19-npc-role-tags-check.js`

Expected: failure because migration and implementation do not exist yet.

- [ ] **Step 3: Add the check to `package.json`**

Append `&& node scripts/d19-npc-role-tags-check.js` to the root `check` script.

### Task 2: Add Migration

**Files:**
- Create: `apps/api/migrations/0015_npc_role_tags.sql`

- [ ] **Step 1: Write migration**

Create `script_npc_roles`, `session_npc_roles`, and add `session_npc_role_id` to `session_album_photo_tags`.

- [ ] **Step 2: Run syntax/static check**

Run: `node scripts/d19-npc-role-tags-check.js`

Expected: fails on service/server/frontend tokens, not migration tokens.

### Task 3: Backend NPC Role Model

**Files:**
- Modify: `apps/api/src/modules/core/service.js`
- Modify: `apps/api/src/server.js`

- [ ] **Step 1: Extend service normalization**

Add helpers for NPC role names, descriptions, source values, and payload arrays.

- [ ] **Step 2: Implement script NPC persistence**

`createScript` inserts `npcRoles`. `updateScript` replaces active script NPC roles for that script when `npcRoles` is supplied. Listing scripts attaches `npc_roles`.

- [ ] **Step 3: Implement session NPC slots**

`createSession` clones active script NPC roles and appends `extraNpcRoles`. Add exported functions to list, create, and update session NPC roles.

- [ ] **Step 4: Wire server routes**

Add `GET /api/sessions/:id/npc-roles`, `POST /api/sessions/:id/npc-roles`, and `PATCH /api/session-npc-roles/:id`.

### Task 4: Album Integration

**Files:**
- Modify: `apps/api/src/modules/core/service.js`

- [ ] **Step 1: Include bound NPC users in membership**

Update album membership and album session listing queries to include active `session_npc_roles.bound_user_id`.

- [ ] **Step 2: Include NPC roles in album people**

Add `session-npc:<id>` people with `tag_type = "session_npc_role"`.

- [ ] **Step 3: Persist session NPC role tags**

Allow `session-npc:<id>` in tag keys, write `session_npc_role_id`, and return the same key from album tag queries.

### Task 5: Admin Web UI

**Files:**
- Modify: `apps/admin-web/src/api.js`
- Modify: `apps/admin-web/src/components/ScriptDrawer.vue`
- Modify: `apps/admin-web/src/components/MiniProgramWorkspace.vue`
- Modify: `apps/admin-web/src/components/SessionAlbumWorkspace.vue`

- [ ] **Step 1: Add API helpers**

Export `listSessionNpcRoles`, `createSessionNpcRole`, and `updateSessionNpcRole`.

- [ ] **Step 2: Add script NPC editor**

Add an NPC role template table to `ScriptDrawer.vue` and include `npcRoles` in save payload.

- [ ] **Step 3: Add extra NPC role input to session creation**

Let the Web mini-program workspace submit `extraNpcRoles` during `createUserSession`.

- [ ] **Step 4: Split album people groups**

Add `npcRolePeople` and render it under an "NPC 角色" title.

### Task 6: Mini-Program UI

**Files:**
- Modify: `apps/miniprogram/src/pages/session/setup.vue`
- Modify: `apps/miniprogram/src/pages/session/album.vue`

- [ ] **Step 1: Add extra NPC role input to setup**

Use a textarea or compact input to collect line-separated extra NPC names and send `extraNpcRoles`.

- [ ] **Step 2: Split album people groups**

Add `npcRolePeople` and render it under an "NPC 角色" title. Update fallback people merging for `session_npc_roles`.

### Task 7: Behavior Smoke

**Files:**
- Modify: `scripts/d18-session-album-privacy-smoke.js`

- [ ] **Step 1: Extend setup**

Create a script with fixed `npcRoles`, create a session with `extraNpcRoles`, and bind one extra NPC role to a player user.

- [ ] **Step 2: Extend assertions**

Assert album people include `session-npc:<id>`, tag save returns that key, and the bound NPC user sees the album session.

- [ ] **Step 3: Run checks**

Run:

```bash
node scripts/d19-npc-role-tags-check.js
node --check scripts/d18-session-album-privacy-smoke.js
npm --workspace apps/api run check
node scripts/check-miniprogram.js
node scripts/d12-admin-web-check.js
```

Expected: all commands exit 0.

## Self-Review

- Spec coverage: Tasks 2-4 cover the data model, API behavior, album membership, and photo tags. Tasks 5-6 cover Admin Web and mini-program UI. Task 7 covers behavior smoke.
- Placeholder scan: No task depends on an undefined future system or unimplemented voting feature.
- Type consistency: The stable key is always `session-npc:<id>`, the backend tag type is `session_npc_role`, and payloads use `npcRoles` and `extraNpcRoles`.
