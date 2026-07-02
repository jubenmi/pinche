# Admin Web Profile Display Design

## Context

Admin web login currently renders the logged-in operator as a plain `openid` in the topbar. The login ticket flow already returns the same `publicUser()` payload used by the mini program, including `id`, `openid`, `unionid`, `nickname`, `avatarUrl`, `gender`, timestamps, and roles. The missing piece is admin-web presentation.

## Goals

- After admin web login, show a human-friendly user summary instead of only `openid`.
- Match the mini program identity priority: nickname first, uploaded avatar first, then gender-based fallback avatar.
- Include all available profile information, including gender, avatar, nickname, ids, phone verification time, timestamps, and roles.
- Keep the topbar compact and stable on desktop and narrow widths.

## Non-Goals

- Do not change the admin web login ticket protocol.
- Do not add profile editing in admin web.
- Do not change the user database schema or backend `publicUser()` shape.

## UI Design

The topbar user area becomes a compact profile trigger:

- Avatar image if `user.avatarUrl` exists.
- Gender-based fallback badge when no avatar exists.
- Display name from `user.nickname`, then `openid`, then `用户{id}`.
- Secondary line with gender label and roles.

Clicking the profile trigger opens a lightweight details popover. The popover shows all currently available fields:

- 昵称
- 性别
- 头像地址
- 用户 ID
- OpenID
- UnionID
- 手机授权时间
- 创建时间
- 更新时间
- 角色

Missing values render as `未填写` or `无`.

## Data Flow

No backend change is required. `LoginPanel.vue` receives the approved login ticket result and calls `setStoredAuth(result)`. `App.vue` reads that stored auth with `getStoredAuth()`. The profile display uses `auth.user` and `auth.roles` directly.

Admin-web will add a small `assetUrl()` helper matching the mini program behavior for `/uploads/...` paths, so uploaded avatars load through the current API origin/proxy.

## Error Handling

If an uploaded avatar fails to load, the UI falls back to the gender/default avatar badge without clearing stored auth. The raw avatar URL remains visible in the details popover for diagnosis.

## Testing

- Add static checks to `scripts/d12-admin-web-check.js` that assert the admin shell consumes `nickname`, `avatarUrl`, `gender`, and renders a detail popover.
- Run the focused check script.
- Run the admin-web production build to catch Vue/template/CSS regressions.
