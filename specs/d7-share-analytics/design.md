# D7 Design: 分享与埋点设计

更新日期：2026-06-12

## Share Path

```text
/pages/session/detail?id={sessionId}&shareCode={shareCode}
/pages/session/detail?id={sessionId}&shareCode={shareCode}&seatId={seatId}
```

## Events

```text
POST /api/share-events/view
POST /api/share-events/convert
```

## Compliance

- 分享是自愿能力，不作为报名前置。
- 分享次数仅用于统计。
- 招募文案不出现红包、返现、提现、分享得补贴、现实陪伴承诺。
