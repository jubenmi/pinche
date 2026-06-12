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
GET /api/sessions/:id/share-stats
```

## Copy Text

- 详情页提供“复制文案”，只使用剧本名、店名、时间、开放座位和实付价生成招募文案。
- 文案不读取 `session.note`、联系方式或报名联系方式。
- 复制前检查高风险词：红包、返现、提现、现金奖励、返利、佣金、分享奖励、拉人/拉新奖励、抽奖、优先锁座、现实/线下陪伴、联系方式、手机号、微信号、加微信。
- 命中风险词或手机号模式时阻止复制，并提示先改写。

## Stats

- `GET /api/sessions/:id/share-stats` 返回聚合统计：浏览数、申请数、转化数、已转化报名数、待审/已通过申请数。
- 统计返回座位级浏览、申请和转化数，不返回申请联系方式。
- 分享统计只用于车况观察，不兑换权益、补贴、现金、抽奖或优先锁座。

## Compliance

- 分享是自愿能力，不作为报名前置。
- 分享次数仅用于统计。
- 招募文案不出现红包、返现、提现、分享得补贴、现实陪伴承诺。
