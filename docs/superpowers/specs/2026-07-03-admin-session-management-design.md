# Admin Session Management Design

> 状态：已被 2026-07-03 的《车局生命周期与删除决策记录》替代。最新规则见 `docs/session-lifecycle-decisions.md`：管理员只能查看车局，不能取消、下架、恢复或删除车局。

## Context

Admin web currently has two top-level areas: `管理界面` and `网页小程序`. The management area covers stores and scripts, while the web miniapp mirrors user-side flows. Session operations exist for organizers and admins, but admins do not have a global session list. As a result, sessions created by another account, including AI-created test sessions, can exist without appearing in the admin UI.

The existing content-management pattern is: make content inactive first, then allow deletion only from that inactive state. Sessions already have a `cancelled` state, so session management should use cancellation as the session equivalent of downlisting.

## Goals

1. Let `system_admin` users see all sessions, not only sessions they organized or joined.
2. Add a `车局` tab inside `管理界面`, alongside `店家` and `剧本`.
3. Let admins cancel any session from the global list.
4. Let admins delete a session only after it has been cancelled.
5. Keep `网页小程序` focused on user-side parity, not global operations.
6. Preserve existing organizer/user session flows.

## Non-Goals

1. Do not add a third top-level sidebar area.
2. Do not let normal users see or delete other users' sessions.
3. Do not introduce a new session status such as `inactive`; use `cancelled` as the downlisted state.
4. Do not delete uploaded media objects from COS or local upload storage in this first pass. The session DB records and their references are deleted; storage-object garbage collection can be handled separately.

## Recommended Approach

Add admin-only session management to the existing management workspace.

`CatalogWorkspace.vue` becomes a three-tab workspace:

- `店家`
- `剧本`
- `车局`

The existing store/script behavior remains unchanged. When the `车局` tab is selected, the toolbar uses session filters, the table renders session rows, and the row actions follow the same concept as the catalog rows: cancel first, then delete.

## Admin Session List

Add `GET /api/admin/sessions`.

The endpoint requires `system_admin`. It returns sessions ordered by `start_at DESC, id DESC`, with a capped limit matching existing admin list behavior.

Supported filters:

- `keyword`: matches script snapshot, store snapshot, organizer nickname, organizer OpenID, or numeric session id.
- `status`: optional exact session status.
- `limit`: capped to the existing service limit policy.

Each row includes:

- session core fields
- organizer user id
- organizer nickname and OpenID
- seat count
- signup count
- pending signup count
- confirmed/locked seat count
- created time and start time

The UI should display: ID, script, store, organizer, start time, status, seat/signup summary, and actions.

## Admin Cancellation

The existing `PATCH /api/sessions/:id/cancel` behavior is reused for the first step. `requireSessionOwner` already allows `system_admin`, so an admin can cancel a session they do not own.

UI behavior:

- For non-cancelled sessions, show `取消`.
- Confirm with copy that cancellation makes the session ineffective and cancels pending/approved signups.
- After cancellation succeeds, reload the session list.

This is the session equivalent of downlisting.

## Admin Deletion

Add `DELETE /api/admin/sessions/:id`.

The endpoint requires `system_admin` and only deletes sessions whose `status` is `cancelled`. If the session is not cancelled, return a conflict-style error with a clear message: `请先取消车局再删除。`

The deletion runs inside a transaction. It deletes child records before the parent session, following foreign-key dependencies.

Required cleanup order:

1. Find chat room ids for the session.
2. Clear `session_chat_rooms.pinned_message_id` for those rooms.
3. Delete `session_messages` for those rooms.
4. Delete `session_chat_rooms` for the session.
5. Delete `session_review_photos` for reviews in the session.
6. Delete `session_album_photo_tags` for photos in the session and for seats/NPC roles in the session.
7. Delete `session_album_photos` for the session.
8. Delete `session_album_privacy` for the session.
9. Delete `session_reviews` for the session.
10. Delete `session_npc_roles` for the session.
11. Delete `share_events` for the session.
12. Delete `signups` for the session.
13. Delete `session_seats` for the session.
14. Delete the `sessions` row.

The endpoint returns the deleted session id and a compact summary of deleted row counts where practical.

UI behavior:

- Only show `删除` when `status === 'cancelled'`.
- Confirm that deletion removes the cancelled session and its related records from the admin/user-facing database.
- If the backend returns the “cancel first” error, show that message directly.

## Frontend Structure

Keep the current one-file workspace if the change stays small, but isolate tab-specific code clearly:

- store/script list loading keeps using existing APIs.
- session list loading uses new `listAdminSessions(filters)`.
- session deletion uses new `deleteAdminSession(sessionId)`.
- cancellation uses existing `cancelSession(sessionId, reason)`.

The table footer should continue to report displayed row count and list limit. Empty-state copy for sessions should say there are no matching sessions.

## API Client

Add admin-web API helpers:

- `listAdminSessions(filters)`
- `deleteAdminSession(sessionId)`

Existing `cancelSession` remains the cancellation helper.

## Error Handling

- `401/403`: existing auth handling remains unchanged; admin-only routes require `system_admin`.
- `404`: return `Session not found`.
- `409`: return a specific error when deletion is attempted before cancellation.
- Delete failures should not leave partial data because the service uses a transaction.

## Tests And Checks

Add focused tests/checks before implementation:

1. Admin session list exists and requires `system_admin`.
2. Admin session list can include a session organized by another user.
3. Non-admin users cannot call the admin session list or delete endpoint.
4. Deleting a non-cancelled session fails with the cancel-first error.
5. Deleting a cancelled session removes the session and dependent rows.
6. Admin web static check verifies:
   - `车局` tab exists in the management workspace.
   - admin session APIs are wired.
   - delete action is only shown for `cancelled` sessions.
   - UI copy explains cancellation before deletion.

Verification commands:

- `node scripts/d12-admin-web-check.js`
- `npm --workspace apps/api run check`
- `npm --workspace apps/admin-web run build`
- `npm run check`

## Open Decisions

None. The design follows the approved direction: add session management to `管理界面` and require cancel-before-delete, matching other admin content.
