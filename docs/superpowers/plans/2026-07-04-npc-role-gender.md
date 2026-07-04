# NPC Role Gender Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development for implementation. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add persistent, visible gender settings for NPC roles.

**Architecture:** Reuse the existing player role gender vocabulary and validation. Store gender on both NPC role tables, pass it through API responses, parse organizer text inputs into structured NPC role payloads, and render NPC gender through existing role-board/card visual patterns.

**Tech Stack:** Node.js, MySQL migrations, Vue/uni-app mini-program, Vue admin-web, repository static check scripts.

---

### Task 1: Failing Coverage

**Files:**
- Create: `scripts/d26-npc-role-gender-check.js`
- Modify: `package.json`

- [x] Write a static check that requires the migration, service persistence, script drawer controls, setup parsers, NPC card rendering hooks, and root `npm run check` integration.
- [x] Run `node scripts/d26-npc-role-gender-check.js` and verify it fails because the production implementation is missing.

### Task 2: Backend Persistence

**Files:**
- Create: `apps/api/migrations/0020_npc_role_gender.sql`
- Modify: `apps/api/src/modules/core/service.js`

- [x] Add idempotent migration columns on `script_npc_roles` and `session_npc_roles`.
- [x] Normalize NPC role gender through `normalizeRoleGender`.
- [x] Insert, clone, update, list, and signup-query NPC role gender.

### Task 3: Frontend Inputs And Rendering

**Files:**
- Modify: `apps/admin-web/src/components/ScriptDrawer.vue`
- Modify: `apps/admin-web/src/components/MiniProgramWorkspace.vue`
- Modify: `apps/admin-web/src/styles.css`
- Modify: `apps/miniprogram/src/components/RoleSeatBoard.vue`
- Modify: `apps/miniprogram/src/pages/session/setup.vue`
- Modify: `apps/miniprogram/src/pages/session/share.vue`
- Modify: `apps/miniprogram/src/pages/session/manage.vue`

- [x] Add NPC gender controls to script editing.
- [x] Parse extra NPC role text with optional gender suffix.
- [x] Render NPC male, female, and unlimited marks with colored/grey states.

### Task 4: Verification

- [x] Run `node scripts/d26-npc-role-gender-check.js`.
- [x] Run targeted checks and report existing full-check blockers precisely.
