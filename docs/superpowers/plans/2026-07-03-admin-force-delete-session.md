# Admin Force Delete Session Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a guarded admin-only way to force-delete test or abnormal sessions.

**Architecture:** Reuse the existing `deleteSessionTree(connection, id)` cleanup helper, but expose it through a separate `deleteAdminSession(sessionId)` service function and `/api/admin/sessions/:id` route. Wire admin-web session rows to call that route through a clearly labeled danger action.

**Tech Stack:** Node HTTP API, MySQL service module, Vue 3 admin web, static regression checks.

---

### Task 1: Failing Checks

**Files:**
- Modify: `scripts/d12-admin-web-check.js`

- [ ] **Step 1: Add assertions**

Add checks for `deleteAdminSession` in API service, server route, admin-web API helper, and catalog UI copy.

- [ ] **Step 2: Run red check**

Run: `node scripts/d12-admin-web-check.js`

Expected: fails because `deleteAdminSession` does not exist yet.

### Task 2: Backend Force Delete

**Files:**
- Modify: `apps/api/src/modules/core/service.js`
- Modify: `apps/api/src/server.js`

- [ ] **Step 1: Add service function**

Export `deleteAdminSession(sessionId)` that opens a transaction, validates the id, locks the session row, throws `notFound("Session not found")` when missing, and returns `{ id, deleted: await deleteSessionTree(connection, id) }`.

- [ ] **Step 2: Add route**

Add `DELETE /api/admin/sessions/:id`, require `system_admin`, and return the service result.

### Task 3: Frontend Force Delete

**Files:**
- Modify: `apps/admin-web/src/api.js`
- Modify: `apps/admin-web/src/components/CatalogWorkspace.vue`

- [ ] **Step 1: Add API helper**

Export `deleteAdminSession(sessionId)` using `DELETE /api/admin/sessions/:id`.

- [ ] **Step 2: Add row action**

For session rows, render a danger `强制删除` action that calls `forceDeleteSession(item)`.

- [ ] **Step 3: Add confirm and reload**

`forceDeleteSession(item)` confirms the impact, uses a busy operation key, calls `deleteAdminSession(item.id)`, clears selected state if needed, and reloads the list.

### Task 4: Verification

**Files:**
- Verify: `scripts/d12-admin-web-check.js`
- Verify: `apps/api/src/modules/core/service.js`
- Verify: `apps/api/src/server.js`
- Verify: `apps/admin-web/src/api.js`
- Verify: `apps/admin-web/src/components/CatalogWorkspace.vue`

- [ ] **Step 1: Run focused static check**

Run: `node scripts/d12-admin-web-check.js`

Expected: pass.

- [ ] **Step 2: Run API syntax check**

Run: `npm --workspace apps/api run check`

Expected: pass.

- [ ] **Step 3: Run admin web build**

Run: `npm --workspace apps/admin-web run build`

Expected: pass.
