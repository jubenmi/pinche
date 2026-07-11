# D39 Design: 同城车局只读预览

更新日期：2026-07-10

## Architecture

D39 使用现有详情页的入口上下文控制，不创建新页面，也不修改后端报名协议：

```text
同城车卡
  -> /pages/session/detail?id=<sessionId>&entry=city
  -> 只读详情

店家或车友分享卡片
  -> /pages/session/share?id=<sessionId>...
  -> 现有选角色和上车流程
```

`entry=city` 只表达当前页面的产品入口。它用于关闭详情页动作，不作为服务端授权凭证。D39 的目标是保证正常用户路径不会从同城发现直接上车或分享；防止技术用户手工拼接 URL 的签名邀请机制不在本期范围内。

## SessionCalendar

`SessionCalendar.vue` 的 `goDetail(id)` 改为：

```js
uni.navigateTo({ url: `/pages/session/detail?id=${id}&entry=city` });
```

只有 `item.type === "city"` 使用该方法。我的车局继续按开本状态进入分享页或相册。

## Detail State

`pages/session/detail.vue` 增加：

```js
data() {
  return {
    entry: ""
  };
}

computed: {
  isCityPreview() {
    return this.entry === "city";
  }
}
```

`onLoad(options)` 在任何异步调用之前保存 `options.entry`。若为同城预览，调用：

```js
uni.hideShareMenu({ menus: ["shareAppMessage", "shareTimeline"] });
```

普通详情不调用该方法，保持现有分享能力。

## Read-only Rendering

同城详情顶部新增提示：

```text
同城发现仅供浏览。请先联系店家；收到店家或车友分享卡片后可选择角色上车。
```

同城预览保留：

- 剧本名、店家、地址、地图、时间和状态。
- 角色座位和 NPC 当前状态。
- 公开车友记录。

同城预览隐藏：

- 顶部全部动作区。
- 座位和 NPC 的动作按钮。
- 车友记录编辑按钮。
- 聊天扩展。

## Event Guards

视图隐藏之外，事件处理函数增加 `isCityPreview` 早退，防止组件事件或后续模板改动重新触发跳转：

```js
handleDetailSeatTap(payload) {
  if (this.isCityPreview) {
    return;
  }
  // existing behavior
}
```

`handleDetailSeatAction` 同样处理。`detailSeatCards` 和 `detailNpcRoleCards` 在只读状态返回空动作数组。

成员关系恢复 `relinkSessionMembership()` 在同城预览直接返回，避免只读页面产生成员状态写入。

## Share Boundary

详情页的页面内分享按钮和座位分享按钮在同城状态隐藏，微信右上角分享菜单也关闭。`pages/session/share.vue` 不接收 `entry=city`，不增加只读逻辑，现有分享卡片仍可上车。

## Testing

新增 `scripts/d39-city-preview-readonly-check.js`，检查：

- 同城卡 URL 包含 `entry=city`。
- 详情页保存入口并暴露 `isCityPreview`。
- 提示文案存在。
- 操作区、记录编辑和聊天受 `!isCityPreview` 控制。
- 座位/NPC 动作数组在只读状态为空。
- 点击处理函数在只读状态早退。
- `relinkSessionMembership` 在只读状态早退。
- `uni.hideShareMenu` 同时关闭好友与朋友圈分享。
- 分享页仍包含座位认领和报名审核请求。

检查接入 `npm run check`，并运行小程序生产构建。
