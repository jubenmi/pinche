# TDesign Component Replacement Requirements

## Goal

Replace the current mini-program UI primitives with approved `tdesign-miniprogram` components where they can preserve the existing business behavior, styling intent, and WeChat mini-program capabilities.

## Approved Component Scope

Use only these TDesign components in this migration:

- `button`, `icon`, `tag`, `badge`, `empty`, `loading`, `skeleton`, `notice-bar`
- `form`, `input`, `textarea`, `switch`, `picker`, `date-time-picker`, `search`, `segmented`
- `popup`, `dialog`, `action-sheet`, `toast`
- `cell`, `collapse`, `tabs`, `steps`, `sticky`, `back-top`
- `avatar`, `image`, `image-viewer`

## Functional Requirements

1. The mini-program must keep the existing page routes, API calls, auth behavior, share behavior, album behavior, admin flows, and calendar/session management behavior.
2. Page templates and shared components should use TDesign equivalents for native `button`, `input`, `textarea`, `switch`, `picker`, and `image` usages unless an explicit compatibility exception is recorded in `tasks.md`.
3. Existing `t-image-viewer` usage in the album page must remain and continue using filtered photo preview data.
4. TDesign components used in Vue templates must be registered for WeChat mini-program builds through `pages.json` and copied into the mini-program build output by the Vite plugin.
5. TDesign feedback components must not replace `uni.showToast`, `uni.showModal`, or `uni.showActionSheet` until their template instance requirements and event behavior are verified in this uni-app build. Existing imperative feedback behavior may remain behind a documented compatibility exception.
6. The migration must include static checks that fail when unapproved native primitives remain in the application source or when used TDesign components are missing from the build asset copy list.
7. The migration must pass the existing mini-program static check and `mp-weixin` build before it is considered complete.

## Non-Goals

- Do not redesign the product flow, route structure, copywriting, or backend API contracts.
- Do not migrate to TDesign Vue Next or any non-mini-program TDesign package.
- Do not remove `uv-waterfall`; it has no TDesign replacement in the approved scope and drives the existing album masonry layout.
- Do not replace custom business components such as `RoleSeatBoard`, `SessionCalendar`, or `AuthIdentityBar` with generic TDesign layouts unless the task explicitly targets their internal primitives.
- Do not change existing user-generated media loading, COS upload, WeChat phone authorization, or share-menu behavior except where required to preserve it after component replacement.

## Acceptance Criteria

- `scripts/check-miniprogram.js` verifies the approved TDesign migration rules.
- `npm --workspace apps/miniprogram run build:mp-weixin` exits successfully.
- `rg` finds no unapproved native `<button>`, `<input>`, `<textarea>`, `<switch>`, `<picker>`, or `<image>` usages in app pages, shared components, and local extensions.
- `apps/miniprogram/src/pages.json` registers all TDesign components used by the app.
- `apps/miniprogram/vite.config.js` copies all registered TDesign component assets needed by the build output.
