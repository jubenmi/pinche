# Admin Session Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add admin-web global session management so system admins can see all sessions, cancel them first, and delete only cancelled sessions.

**Architecture:** Add admin-only list/delete service functions in `apps/api/src/modules/core/service.js`, expose them through `/api/admin/sessions` routes in `apps/api/src/server.js`, and wire `apps/admin-web` management workspace with a new `车局` tab. Keep cancellation on the existing session cancel route and keep `cancelled` as the downlisted state.

**Tech Stack:** Node.js HTTP API, MySQL transactions via `mysql2`, Vue 3 admin-web, existing static check scripts.

---

## Spec Checklist

- [x] `system_admin` can list all sessions from `GET /api/admin/sessions`.
- [x] The admin session list includes sessions organized by other users and returns organizer + count metadata.
- [x] Non-admin users cannot call admin list/delete routes.
- [x] Admins can cancel any session using the existing cancel route.
- [x] `DELETE /api/admin/sessions/:id` rejects non-cancelled sessions with `请先取消车局再删除。`
- [x] `DELETE /api/admin/sessions/:id` removes cancelled sessions and dependent DB rows in a transaction.
- [x] `管理界面` contains a `车局` tab without adding a third sidebar area.
- [x] Admin-web exposes `listAdminSessions` and `deleteAdminSession`.
- [x] The `车局` tab shows cancel before delete, and only shows delete for `cancelled`.
- [ ] Focused and broad verification commands pass.

## Tasks

### Task 1: Static Checks For Admin Session Management

**Files:**
- Modify: `scripts/d12-admin-web-check.js`

- [x] Add failing static assertions for the new admin session service exports, routes, API helpers, `车局` tab, cancel-first copy, and cancelled-only delete guard.
- [x] Run `node scripts/d12-admin-web-check.js` and confirm it fails because the implementation is missing.

### Task 2: Backend Admin Session Service And Routes

**Files:**
- Modify: `apps/api/src/modules/core/service.js`
- Modify: `apps/api/src/server.js`

- [x] Implement `listAdminSessions(filters)` with keyword/status/limit filtering and organizer/count metadata.
- [x] Implement `deleteAdminSession(user, sessionId)` with `system_admin` guard, cancelled-only conflict, and transactional dependent-row cleanup.
- [x] Wire `GET /api/admin/sessions` and `DELETE /api/admin/sessions/:id` in `server.js`.
- [x] Run `node scripts/d12-admin-web-check.js` and confirm backend route/service checks pass far enough to expose frontend gaps.

### Task 3: Admin-Web API And Management UI

**Files:**
- Modify: `apps/admin-web/src/api.js`
- Modify: `apps/admin-web/src/components/CatalogWorkspace.vue`

- [x] Add `listAdminSessions(filters)` and `deleteAdminSession(sessionId)` API helpers.
- [x] Add `车局` as the third management tab.
- [x] Render session-specific filters, table columns, status labels, counts, cancel action, and cancelled-only delete action.
- [x] Reuse `cancelSession(sessionId, reason)` for the first step.
- [x] Run `node scripts/d12-admin-web-check.js` and confirm it passes.

### Task 4: Verification And Task Sync

**Files:**
- Modify: `docs/superpowers/plans/2026-07-03-admin-session-management.md`

- Progress: in progress.
- [x] Run `npm --workspace apps/api run check`.
- [x] Run `npm --workspace apps/admin-web run build`.
- [ ] Run `npm run check`.
  - Progress: attempted; blocked by existing `apps/miniprogram/.env.development` local API URL (`http://127.0.0.1:3018`) while `scripts/check-miniprogram.js` requires `https://api.pinche.jubenmi.com`.
- [x] Re-read the spec checklist and mark completed tasks accurately.
