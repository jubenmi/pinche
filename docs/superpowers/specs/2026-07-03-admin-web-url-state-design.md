# Admin Web URL State Design

## Goal

Admin web page position should live in the browser URL so refresh, copy/paste, and direct open keep the same main workspace location.

## Scope

- Persist the top-level admin workspace: `catalog` or `miniapp`.
- Persist catalog workspace tabs: `stores`, `scripts`, or `sessions`.
- Persist mini app workspace screens: `home`, `create`, `mine`, `detail`, `manage`, `share`, `review`, or `album`.
- Persist `sessionId` for session-backed mini app screens.
- Keep existing shared links that only provide `sessionId`, `seatId`, `shareCode`, or `source` working.

Temporary state stays out of the URL: search keywords, drawer state, pending form input, selected create step, upload state, and popovers.

## URL Shape

- Management stores: `?view=catalog&catalogTab=stores`
- Management scripts: `?view=catalog&catalogTab=scripts`
- Management sessions: `?view=catalog&catalogTab=sessions`
- Mini home: `?view=miniapp&screen=home`
- Mini detail: `?view=miniapp&screen=detail&sessionId=123`
- Mini manage: `?view=miniapp&screen=manage&sessionId=123`
- Mini album: `?view=miniapp&screen=album&sessionId=123`

Legacy `?sessionId=123` opens mini detail.

## Architecture

Create a small pure helper module at `apps/admin-web/src/adminRoute.js`.

The helper parses and builds URL state:

- Validate unknown values and fall back to safe defaults.
- Derive `miniapp` from `sessionId` when `view` is missing.
- Require `sessionId` for session-backed screens; otherwise fall back to mini home.
- Preserve inbound share attribution parameters when useful.

`App.vue` owns top-level `view` URL state. `CatalogWorkspace.vue` and `MiniProgramWorkspace.vue` receive initial state from the URL and push URL updates when users navigate between main pages.

## Testing

Extend `scripts/d12-admin-web-check.js` with assertions against the pure helper:

- Catalog tab URLs round-trip.
- Mini session-backed URLs round-trip.
- Legacy `sessionId` URLs still resolve to mini detail.
- Invalid or incomplete URL state falls back safely.

Then run the admin check and admin web build.
