# NPC Role Gender Design

## Goal

NPC roles can carry the same gender requirement as player roles: `male`, `female`, or `unlimited`. Existing NPC roles default to `unlimited`.

## Scope

- Add `role_gender` to script-level NPC roles and session-level NPC roles.
- Preserve gender when script NPC roles are cloned into a session.
- Let admins set NPC gender in the script drawer.
- Let organizers set gender for extra session NPC roles using lightweight text syntax such as `媒人 男`, `少年将军 女`, or `管家 不限`.
- Show NPC gender visibly in selection and review surfaces. Male and female keep colored marks; unlimited shows a grey mark instead of being blank.

## Data Flow

The API normalizes `roleGender`, `role_gender`, and `gender` through the existing `normalizeRoleGender` helper. Responses expose `role_gender` so mini-program and admin-web views can render the state without inferring it from text.

## Testing

Add `scripts/d26-npc-role-gender-check.js` to guard the migration, backend normalization/persistence, and the expected UI hooks.
