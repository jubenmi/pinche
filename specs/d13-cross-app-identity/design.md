# D13 Cross-App WeChat Identity Design

## Current State

- `users.open_id` is unique and used as the main WeChat identity for the current mini program.
- `users.union_id` exists and is updated when `code2Session` returns `unionid`.
- Admin bootstrap currently checks only `BOOTSTRAP_ADMIN_OPENIDS`.
- The JWT-like business token includes `openid` but not `unionid`.

## Data Model

Add migration `0009_wechat_identities.sql`:

```sql
CREATE TABLE IF NOT EXISTS wechat_identities (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  app_id VARCHAR(128) NOT NULL,
  open_id VARCHAR(128) NOT NULL,
  union_id VARCHAR(128) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_wechat_identity_app_open (app_id, open_id),
  INDEX idx_wechat_identities_user (user_id),
  INDEX idx_wechat_identities_union_id (union_id),
  CONSTRAINT fk_wechat_identities_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

`users.open_id` remains the compatibility identity for existing queries and tokens. `wechat_identities` becomes the forward-compatible record for future App IDs.

## Login Flow

1. Exchange mini program login code for `{ openid, unionid }`.
2. Find an existing user in this order:
   - existing `wechat_identities` row for the current `app_id + open_id`;
   - existing compatibility `users.open_id`;
   - existing `users.union_id`, when WeChat returns a non-empty `unionid`.
3. If no user exists, create one with the current login `open_id` and `unionid`.
4. Save `union_id` onto `users` using `COALESCE(?, union_id)` when a user exists.
5. Upsert `wechat_identities` with:
   - `user_id`
   - `app_id` from `WECHAT_APP_ID`
   - `open_id`
   - `union_id`
6. Ensure `player`.
7. Ensure `system_admin` when:
   - `openid` is in `BOOTSTRAP_ADMIN_OPENIDS`, or
   - non-empty `unionid` is in `BOOTSTRAP_ADMIN_UNIONIDS`.
8. Issue the business token with `openid`, `unionid`, and `roles`.

## Environment

- Add `BOOTSTRAP_ADMIN_UNIONIDS` to config and env examples.
- Preserve `BOOTSTRAP_ADMIN_OPENIDS`.
- For local mock login, `unionid` may be null unless a future test path supplies one.

## Verification

- Static API checks prove the migration, env config, and code paths exist.
- Node syntax checks prove changed backend files parse.
- Existing smoke tests continue to prove `openid` admin bootstrap still works.
