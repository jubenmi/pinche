# D13 Cross-App WeChat Identity Requirements

## Purpose

Support future cross-App identity by preserving per-App `openid`, saving WeChat `unionid`, allowing bootstrap admins by `unionid`, and adding a normalized identity table for multiple WeChat applications under one business user.

## Requirements

1. The system SHALL keep `users.open_id` as the current mini program's per-App identifier.
2. The system SHALL keep saving `users.union_id` when WeChat returns a `unionid`.
3. The system SHALL allow bootstrap system admins to be configured by `BOOTSTRAP_ADMIN_OPENIDS`.
4. The system SHALL allow bootstrap system admins to be configured by `BOOTSTRAP_ADMIN_UNIONIDS`.
5. The system SHALL grant `system_admin` when either the login `openid` or `unionid` appears in the matching bootstrap list.
6. The system SHALL add a `wechat_identities` table that records `user_id`, `app_id`, `open_id`, and `union_id` for every WeChat login.
7. The system SHALL upsert `wechat_identities` during WeChat login without removing the existing `users.open_id` compatibility path.
8. The system SHALL reuse an existing `users` row when a new App login provides a `unionid` already stored for that user.
9. The system SHALL include `unionid` in issued business tokens when available.
10. Production and development env examples SHALL document both bootstrap lists.

## Non-Goals

- Do not run a bulk historical merge job; only login-time linking is in scope.
- Do not add a UI for role management.
- Do not remove `BOOTSTRAP_ADMIN_OPENIDS`.
- Do not require `unionid`; WeChat may return it only after the mini program is bound to the same WeChat Open Platform account.
