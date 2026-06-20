# 登录后手机号提示与上车动作门禁设计

## 概述

用户完成微信登录后，小程序会提示用户授权手机号，但这个提示在浏览、查看资料、进入非上车流程时可以跳过。手机号只在用户准备组织或参与一车时变成必填：发布车、申请上车、确认角色、或换选到另一个角色。

这样可以让浏览体验保持轻量，同时确保真正进入车局运营流程的车头和玩家都已经留下可验证手机号。

## 目标

- 用户可以登录、浏览车局、查看详情、使用非上车动作，而不会被手机号授权阻断。
- 用户在本次新登录后如果缺少手机号，小程序提示授权，并明确说明创建车或上车前会强制需要手机号。
- 发布车和确认上车前必须有已验证手机号。
- 手机号授权必须使用微信要求的 `button open-type="getPhoneNumber"` 交互。
- 后端增加兜底校验，避免绕过小程序前端直接调用接口完成创建车或上车。

## 非目标

- 不在浏览车局详情页或分享页时强制授权手机号。
- 不因为用户打开“我的”页或查看账号状态而强制授权手机号。
- 不在公开车局、分享页、个人信息条等界面展示手机号。
- 不替换现有性别补全流程。
- 本次不实现手动填写联系方式兜底。

## 现有上下文

小程序当前已经通过 `apps/miniprogram/src/utils/api.js` 里的 `ensureLoggedIn()` 集中处理登录，包括 `wx.login`、后端登录、本地 auth 缓存、以及缺少性别时的补全流程。共享组件 `AuthIdentityBar` 已经监听 auth/profile 事件，并能在缺少性别时打开必填资料弹窗。

后端当前已经有 `POST /api/auth/wechat/phone`，并且 `publicUser()` 返回 `phoneVerifiedAt`。现有手机号接口会保存提交的手机号占位值并设置 `phone_verified_at`，但创建车和上车相关接口还没有强制检查手机号。

现有产品文档倾向于在用户发生关键动作时收集联系方式，而不是浏览阶段就强制收集。本设计沿用这个方向：登录后提示、可跳过；上车相关动作前强制。

## 用户流程

### 登录不阻塞

1. 用户点击需要登录但不属于上车流程的操作。
2. `ensureLoggedIn()` 在需要时执行微信登录。
3. 如果用户没有 `phoneVerifiedAt`，小程序在本次新登录后展示一个可跳过的手机号授权提示。
4. 如果用户跳过，登录仍然成功，原本的非上车操作可以继续。
5. 现有缺少性别时的处理仍按当前要求执行。

### 创建车

1. 用户进入 `pages/session/setup` 的最终发布步骤。
2. `createPublishedSession()` 调用 `ensureLoggedIn({ requirePhone: true })`。
3. 如果用户缺少 `phoneVerifiedAt`，小程序打开必填手机号授权提示。
4. 提示里的授权按钮使用微信手机号授权按钮。
5. 授权成功后，小程序更新 auth 缓存，并继续发布车。
6. 用户拒绝授权或关闭提示时，本次发布停止，草稿仍保留在当前页面。

### 申请上车或换角色

1. 用户在 `pages/session/share` 选择并确认角色。
2. 最终确认上车路径调用 `ensureLoggedIn({ requirePhone: true })`。
3. 手机号授权成功后，小程序调用 `POST /api/session-seats/:id/claim`。
4. 用户拒绝手机号授权时，不提交上车请求，也不提交本地角色状态。

## 前端设计

### 共享手机号助手

在 `apps/miniprogram/src/utils/api.js` 增加共享手机号助手：

- `updateUserPhoneFromWechatPhoneCode(code)` 调用 `POST /api/auth/wechat/phone`。
- `requestUserPhoneFromPhoneModal(auth, options)` 发出手机号资料事件，并等待当前可见组件响应。
- `ensureUserPhone(auth, options)` 在 `auth.user.phoneVerifiedAt` 已存在时直接返回当前 auth。如果 `options.requirePhone === true`，则请求手机号授权，用户没有完成授权时返回 `null`。如果是本次新登录后的可选手机号提示，则只提示一次；用户跳过时仍返回原 auth。

`ensureLoggedIn()` 的默认行为仍然是先完成登录，不因为缺少手机号而阻塞。它会在本次新登录后展示可跳过的手机号提示，避免对缓存登录状态反复打扰；只有传入 `requirePhone: true` 时才强制手机号。

### UI 组件

扩展 `AuthIdentityBar.vue`，增加手机号授权弹窗，或在现有资料弹窗中增加第二种弹窗模式：

- 可选模式文案：现在建议授权手机号，创建车或上车前会强制需要。
- 必填模式文案：创建车或上车前必须授权手机号。
- 可选模式提供跳过或取消动作。
- 必填模式没有成功绕过路径；关闭、拒绝授权都会向等待中的 guard 返回 `null`。
- 授权控件必须是带 `open-type="getPhoneNumber"` 的 `button`。
- 事件处理从微信返回事件中读取动态手机号授权 `code`，然后交给共享 API 助手保存。

手机号提示不能用普通 `uni.showModal` 的确认按钮伪装成授权按钮，因为微信手机号授权必须由用户点击专用 open-type 按钮触发。

### 动作门禁

更新这些前端门禁：

- `apps/miniprogram/src/pages/session/setup.vue`
  - `createPublishedSession()` 在设置 `busyAction` 或创建车之前，调用 `ensureLoggedIn({ requirePhone: true, ... })`。
- `apps/miniprogram/src/pages/session/share.vue`
  - `confirmRole()` 调用 `ensureSeatSelectionLogin({ requirePhone: true })`，或者让本地登录包装方法在最终确认角色时始终要求手机号。
  - 浏览角色和临时选择角色仍可在普通登录后继续，但最终提交上车必须经过手机号门禁。

其它页面继续使用普通 `ensureLoggedIn()`，除非它们新增了创建车或上车相关动作。

## 后端设计

### 手机号授权接口

保持 `POST /api/auth/wechat/phone` 为登录后接口。前端向它提交微信手机号授权 `code`。

本地 mock 登录或当前开发模式下，接口可以保存确定性的占位值并设置 `phone_verified_at`，保持测试可运行。生产环境下，后端应使用这个手机号授权 `code` 服务端调用微信手机号接口换取手机号，不能把小程序端提交的裸手机号当作已验证凭据。

接口响应返回 `{ user, roles }`，或返回足够数据让前端按现有用户更新流程刷新 auth 缓存。

### 上车动作强制校验

增加后端 guard：当 `user.user.phoneVerifiedAt` 缺失时拒绝上车相关动作。

- `POST /api/sessions`
- `POST /api/session-seats/:id/claim`

错误应清晰可识别，例如错误码 `PHONE_REQUIRED`，用户可读文案可为 `创建车或上车前需要授权手机号`。前端仍应在请求前先做门禁，但后端校验是最终兜底。

## 数据流

```text
wx.login
  -> POST /api/auth/wechat/login
  -> 更新 auth 缓存
  -> 如果缺少手机号，本次新登录后出现可跳过手机号提示
  -> 用户可以跳过

发布车或确认上车
  -> ensureLoggedIn({ requirePhone: true })
  -> AuthIdentityBar 手机号弹窗
  -> button open-type="getPhoneNumber"
  -> POST /api/auth/wechat/phone { code }
  -> users.phone_verified_at 被设置
  -> 更新 auth 缓存
  -> 继续原本的发布车或上车动作
```

## 错误处理

- 用户跳过可选提示：保留已登录 auth，继续非上车动作。
- 用户拒绝必填手机号授权：停止当前受保护动作，并展示短 toast。
- 手机号接口失败：保持当前页面状态，停止受保护动作，并展示可重试错误。
- 后端返回 `PHONE_REQUIRED`：前端应尽量拉起同一个手机号授权提示；无法拉起时展示清晰 toast。
- 缺少或格式错误的手机号授权 code 返回参数校验错误。

## 测试

- 增加聚焦检查，证明普通登录不会因为缺少手机号而失败。
- 增加前端源码检查，证明发布车和确认上车路径在副作用前传入 `requirePhone: true`。
- 增加后端 smoke 覆盖：没有 `phoneVerifiedAt` 的用户调用 `POST /api/sessions` 和 `POST /api/session-seats/:id/claim` 会被拒绝。
- 增加后端 smoke 覆盖：手机号授权会更新 `phoneVerifiedAt`，随后同一个上车动作可以成功。
- 保持现有性别、分享、维护模式、小程序检查通过。

## 发布前注意

生产发布前，需要确认小程序隐私保护指引已经声明手机号收集用途，并确认生产后端会在服务端用微信手机号授权 code 换取手机号。公开页面和分享图片仍不得展示手机号。
