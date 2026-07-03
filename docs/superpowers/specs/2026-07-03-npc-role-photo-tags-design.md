# NPC Role Photo Tags Design

## Goal

Support NPC roles as first-class, taggable session members. Each script can define fixed NPC roles, each session can add extra store-designed NPC roles, and album photos can be tagged with those NPC roles. A session NPC role can later bind to a WeChat user so privacy, membership, and future operations can treat that NPC as staff.

## Current Context

- Player roles are stored in `scripts.default_seat_template_json`, then copied into `session_seats` by the creation flow.
- A session currently has only one legacy `npc_user_id` / `npc_name_snapshot` pair, exposed as the album tag key `npc:session`.
- Album tags currently allow only `seat:<id>`, `dm:session`, and `npc:session`.
- Album visibility is user-based: tagged users can see photos containing them, and their privacy settings can hide the photo from other members.

## Requirements

1. Admin users can maintain fixed NPC role definitions for a script.
2. Creating a session copies the script fixed NPC roles into session-level NPC role slots.
3. Session creators can add extra NPC roles for store-specific design on that session.
4. A session NPC role can optionally bind to a WeChat user.
5. A user bound to a session NPC role is a session album member and appears in album session lists.
6. Album people include player seats, legacy DM/NPC snapshots, and session NPC roles.
7. Album photo tags can save and return `session-npc:<id>` keys.
8. If a tagged session NPC role is bound to a user, photo visibility uses that user's album privacy.
9. Existing `dm:session`, `npc:session`, and `seat:<id>` behavior remains compatible.
10. Voting, rankings, and beauty-election product surfaces are out of scope for this change, but the data model must support them later.

## Data Model

Add `script_npc_roles`:

- `id`
- `script_id`
- `name`
- `description`
- `sort_order`
- `status`
- timestamps

Add `session_npc_roles`:

- `id`
- `session_id`
- `script_npc_role_id`
- `name`
- `description`
- `source`
- `bound_user_id`
- `sort_order`
- `status`
- timestamps

Extend `session_album_photo_tags`:

- `session_npc_role_id`
- index and foreign key to `session_npc_roles`

The stable album key for these slots is `session-npc:<session_npc_roles.id>`.

## API Behavior

- `createScript` / `updateScript` accept `npcRoles`.
- `listAdminScripts`, `listActiveScripts`, and `getSession` expose normalized NPC role arrays where useful for creation and editing.
- `createSession` clones active fixed NPC roles from `script_npc_roles` into `session_npc_roles`.
- `createSession` also accepts `extraNpcRoles` and creates `source = "session"` rows.
- A session owner can create or update a session NPC role after creation.
- Album membership checks include users bound to active session NPC roles.
- Album people returns each active session NPC role as:
  - `key: "session-npc:<id>"`
  - `tag_type: "session_npc_role"`
  - `session_npc_role_id`
  - `user_id` from `bound_user_id`
  - `label` from the NPC role name

## UI Behavior

- Admin Web script editor adds an "NPC role template" section.
- Session setup accepts a compact list of extra NPC role names for store-specific additions.
- Admin Web and mini-program album tagging split people into:
  - seats / players
  - DM and legacy NPC staff
  - NPC roles

## Testing

- Add a static gate for migration, service, routes, and frontend tokens.
- Extend the album smoke test so it creates fixed and extra NPC roles, tags a photo with `session-npc:<id>`, and verifies the key round-trips.
- Verify bound NPC users are included in album session lists and can use album visibility rules.

## Out Of Scope

- Public NPC performer profiles.
- NPC voting and ranking UI.
- Store-level reusable NPC staffing templates.
