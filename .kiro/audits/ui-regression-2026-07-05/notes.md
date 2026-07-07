# UI Regression Audit - 2026-07-05

## Scope

Post-TDesign migration UI scan for the miniprogram screens reported by the user.

## Evidence

1. `01-home-first-session.png`
   - Issue: the primary CTA icon and text stacked vertically inside `t-button`.
   - Root cause: TDesign button wraps slot content in its own content node, so the old button-level flex styles did not control inner slot layout.
   - Fix: added `primary-action-content` as an explicit flex slot wrapper.

2. `02-auth-bar-avatar.png`
   - Issue: login avatar appeared cropped and malformed.
   - Root cause: `t-avatar` defaults to `medium` (`96rpx`) while the auth bar avatar frame is `36rpx`.
   - Fix: set explicit TDesign avatar sizes for auth bar, profile modal, gender options, and review avatars.

3. `03-album-filter-segmented.png`
   - Issue: album filter segmented control was too tall and labels overflowed.
   - Root cause: TDesign segmented default item padding/font did not match the compact album toolbar.
   - Fix: changed album and calendar segmented controls to `block` layout with compact TDesign CSS variables.

## Additional Scan Fixes

- Added explicit slot flex wrappers for complex `t-button` content in:
  - auth message chip
  - auth message list item
  - profile gender options
  - chat floating button
  - share CTA
- Isolated admin `t-tabs` from old `.tabs` flex styles and switched it to TDesign `tag` theme with compact theme variables.

## Verification

- `node scripts/check-miniprogram.js` passed.
- `npm --workspace apps/miniprogram run build:mp-weixin` passed.
- Build still reports existing Sass deprecation warnings from `uv-waterfall`; no new build errors.
