# Admin Force Delete Session Design

## Goal

Allow `system_admin` users to force-delete test or abnormal sessions from the admin web session list when the original organizer user is not available.

## Scope

- Add admin-only `DELETE /api/admin/sessions/:id`.
- Reuse the existing session tree database cleanup order.
- Add a `强制删除` button in `管理界面 > 车局`.
- Require a browser confirmation before sending the delete request.
- Reload the session list after successful deletion.

First pass intentionally cleans database records only. Uploaded local/COS objects are not deleted in this operation; object garbage collection remains separate.

## Safety Model

This is not a normal user cancellation flow. It bypasses organizer ownership, onboard-member, and album-photo blockers because it is for admin data cleanup.

Guardrails:

- Backend requires `system_admin`.
- Endpoint is named under `/api/admin/...`.
- Frontend button copy says `强制删除`.
- Confirmation text names the broad data impact: session, seats, signups, chat, reviews, and album records.
- The admin session list keeps no downlist/restore model.

## Implementation

Backend:

- Export `deleteAdminSession(sessionId)` from `apps/api/src/modules/core/service.js`.
- Implement it with `withTransaction`, `positiveId`, row existence check, and `deleteSessionTree(connection, id)`.
- Add `DELETE /api/admin/sessions/:id` to `apps/api/src/server.js` after the admin session list route.

Frontend:

- Add `deleteAdminSession(sessionId)` to `apps/admin-web/src/api.js`.
- Import it in `CatalogWorkspace.vue`.
- Render an action cell for session rows with a danger `强制删除` button.
- Implement `forceDeleteSession(item)` with confirm, busy state, API call, and reload.

## Testing

Extend `scripts/d12-admin-web-check.js` before implementation to assert:

- Backend exports and routes `deleteAdminSession`.
- Admin web API exports `deleteAdminSession`.
- Catalog workspace imports `deleteAdminSession`, displays `强制删除`, and keeps no downlist/restore copy for sessions.

Verification:

- `node scripts/d12-admin-web-check.js`
- `npm --workspace apps/api run check`
- `npm --workspace apps/admin-web run build`
