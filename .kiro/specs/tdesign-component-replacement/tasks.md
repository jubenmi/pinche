# TDesign Component Replacement Tasks

## Source of Truth

Requirements: `.kiro/specs/tdesign-component-replacement/requirements.md`

Design: `.kiro/specs/tdesign-component-replacement/design.md`

## Tasks

- [x] 1. Spec and preflight
  - [x] 1.1 Create requirements, design, and task tracking docs.
  - [x] 1.2 Review existing dirty working-tree changes and preserve them.
  - [x] 1.3 Identify all native primitive usages targeted by the approved TDesign scope.

- [x] 2. Add migration audit before production template replacement
  - [x] 2.1 Extend `scripts/check-miniprogram.js` with TDesign dependency, registration, copy-list, and native primitive checks.
  - [x] 2.2 Run the audit and confirm it fails because native primitives still remain.

- [x] 3. Register and copy approved TDesign components
  - [x] 3.1 Add TDesign component registrations to `apps/miniprogram/src/pages.json`.
  - [x] 3.2 Extend `copyTdesignMiniprogramNpmPlugin()` in `apps/miniprogram/vite.config.js` to copy all required TDesign assets.
  - [x] 3.3 Run the audit and resolve registration or copy-list failures.

- [x] 4. Replace shared component primitives
  - [x] 4.1 Replace primitives inside `AuthIdentityBar.vue`.
  - [x] 4.2 Replace primitives inside `SessionCalendar.vue`.
  - [x] 4.3 Replace primitives inside `RoleSeatBoard.vue`.
  - [x] 4.4 Replace primitives inside pseudo-chat extension components.
  - [x] 4.5 Run the audit for shared component replacement.

- [x] 5. Replace first-flow and admin page primitives
  - [x] 5.1 Replace primitives in home, mine, create, script, role, setup, and share pages.
  - [x] 5.2 Replace primitives in the admin catalog page.
  - [x] 5.3 Run the audit for first-flow and admin replacement.

- [x] 6. Replace session operation page primitives
  - [x] 6.1 Replace primitives in detail, manage, review, album privacy, and album pages.
  - [x] 6.2 Keep `uv-waterfall` and the existing album `t-image-viewer` behavior intact.
  - [x] 6.3 Run the audit for session page replacement.

- [x] 7. Final verification
  - Result: no compatibility exceptions recorded.
  - [x] 7.1 Run `node scripts/check-miniprogram.js`.
  - [x] 7.2 Run `npm --workspace apps/miniprogram run build:mp-weixin`.
  - [x] 7.3 Update this task file with completed checkboxes or recorded compatibility exceptions.

- [x] 8. Replace high-priority hand-written UI with TDesign components
  - Scope: `notice-bar`, `empty`, `tag`, `badge`, and `search` only.
  - Status: static audit and mp-weixin build passed.
  - [x] 8.1 Add static audit coverage for high-priority TDesign component usage.
  - [x] 8.2 Register and copy high-priority TDesign components and dependencies.
  - [x] 8.3 Replace notice, empty, status tag/badge, and search UI in current pages/components.
  - [x] 8.4 Run `node scripts/check-miniprogram.js`.
  - [x] 8.5 Run `npm --workspace apps/miniprogram run build:mp-weixin`.

- [x] 9. Replace medium-priority UI with TDesign components
  - Scope: `popup`, `toast`, `dialog`, `action-sheet`, `segmented`, `tabs`, and `avatar` only.
  - Status: static audit and mp-weixin build passed.
  - [x] 9.1 Add static audit coverage for medium-priority TDesign component usage and feedback API fallback boundaries.
  - [x] 9.2 Register and copy medium-priority TDesign components and dependencies.
  - [x] 9.3 Add a TDesign feedback host/adapter for toast, dialog, and action sheet behavior.
  - [x] 9.4 Replace popup shells, tab/segmented controls, and avatar displays in current pages/components.
  - [x] 9.5 Run `node scripts/check-miniprogram.js`.
  - [x] 9.6 Run `npm --workspace apps/miniprogram run build:mp-weixin`.
