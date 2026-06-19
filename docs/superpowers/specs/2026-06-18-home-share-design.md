# Home Share Design

Date: 2026-06-18

## Goal

The Mini Program home page supports native WeChat sharing to friends, group chats, and Moments without adding another visible home-screen action.

## Approach

- Keep the current home page layout unchanged.
- Enable the WeChat share menu for both `shareAppMessage` and `shareTimeline` when the home page loads or becomes visible.
- Use `onShareAppMessage` for friend and group sharing, returning a card that opens `/pages/index/index`.
- Use `onShareTimeline` for Moments sharing, returning a title plus an empty home-page query because Moments share uses `query` rather than `path`.
- Reuse `/static/art/ink-home-landscape.jpg` as the share image so the card matches the first-screen brand.

## Copy

- Friend/group title: `剧本迷·拼车`
- Moments title: `剧本迷·拼车，一起玩好本`

## Testing

Extend `scripts/check-miniprogram.js` to assert that the home page:

- Registers `onShareAppMessage`.
- Registers `onShareTimeline`.
- Enables `menus: ["shareAppMessage", "shareTimeline"]`.
- Uses `/pages/index/index` for friend/group share.
- Uses `query:` instead of `path:` for Moments share.
