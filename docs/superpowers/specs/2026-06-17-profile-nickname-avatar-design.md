# 个人信息昵称与头像编辑设计

## 概述

个人信息页应支持用户修改昵称、更换头像，并把结果长期保存到账号资料。当前 `users` 表已经有 `nickname` 和 `avatar_url` 字段，`publicUser()` 也会返回这两个字段，但前端“我的”页和顶部个人信息弹窗尚未提供编辑能力，后端 `PATCH /api/users/me` 也只支持更新 `gender`。

本设计将个人资料编辑统一到现有 `AuthIdentityBar` 资料弹窗中：用户可以在“我的”页或顶部身份条进入同一个编辑面板，修改昵称、选择微信头像、调整性别。保存成功后更新后端用户资料和本地 auth 缓存，所有页面立即看到新的昵称与头像。

## 目标

- “我的”页展示当前昵称、头像和性别，并提供清晰的编辑入口。
- 用户可以修改昵称，保存后写入 `users.nickname`。
- 用户可以通过微信小程序原生 `chooseAvatar` 选择头像，上传后写入 `users.avatar_url`。
- 顶部身份条和资料弹窗优先展示用户上传头像；没有上传头像时继续使用现有男女默认头像。
- `PATCH /api/users/me` 支持部分更新 `nickname`、`avatarUrl`、`gender`，并继续返回 `{ user, roles }`。
- 头像上传使用登录态校验、文件大小限制、图片类型限制和固定服务端存储目录。
- 保持现有首次登录补齐性别流程不变：缺少性别时仍可打开必填资料弹窗。

## 非目标

- 不接入对象存储、CDN、图片审核或裁剪服务。
- 不实现头像历史版本管理。
- 不支持从外部 URL 粘贴头像。
- 不改变手机号授权、车局创建、上车、反串等流程。
- 不把昵称作为唯一身份标识；昵称可以重复。

## 现有上下文

后端：

- `users` 表在初始 migration 中已有 `nickname VARCHAR(128)` 和 `avatar_url VARCHAR(512)`。
- `apps/api/src/modules/auth/users.js` 的 `publicUser()` 已经返回 `nickname` 和 `avatarUrl`。
- `PATCH /api/users/me` 当前调用 `updateUserGender()`，只允许更新 `gender`。
- API server 使用 Node 原生 `http`，当前没有 multipart 依赖和静态文件服务。

前端：

- `apps/miniprogram/src/components/AuthIdentityBar.vue` 已有资料弹窗，用于补齐和修改性别。
- `apps/miniprogram/src/pages/mine/index.vue` 已展示登录状态、性别编辑和“我的发车”。
- `apps/miniprogram/src/utils/api.js` 已有 `setAuth()`、`getCurrentUser()` 和 `updateUserGender()`，保存用户更新后会同步本地缓存。

## 用户流程

### 从“我的”页编辑

1. 用户进入“我的”页。
2. 已登录时，页面展示头像、昵称、性别和角色。
3. 用户点击“编辑资料”。
4. 页面通过现有资料事件或组件方法打开 `AuthIdentityBar` 资料弹窗。
5. 用户输入昵称，或点击头像按钮选择微信头像。
6. 用户点击保存。
7. 小程序先上传新头像，再提交昵称、头像 URL 和性别资料。
8. 保存成功后关闭弹窗，更新本地 auth 缓存，“我的”页和顶部身份条立即刷新。

### 从顶部身份条编辑

1. 用户点击顶部身份条。
2. 已登录时打开同一个资料弹窗。
3. 编辑与保存流程和“我的”页一致。
4. 未登录时保持现有行为：先触发登录，再进入资料流程。

### 首次登录补齐性别

1. `ensureLoggedIn()` 判断用户缺少 `gender`。
2. 仍通过 `AUTH_PROFILE_REQUEST_EVENT` 打开资料弹窗。
3. 必填模式下，用户至少需要选择性别才能继续。
4. 用户也可以顺手填写昵称或选择头像；未填写昵称、未更换头像不阻塞继续。

## 后端设计

### 用户资料更新

新增通用用户资料更新函数，例如 `updateUserProfile(userId, patch)`：

- 接收 `nickname`、`avatarUrl`、`gender` 三个可选字段。
- 至少包含一个可更新字段，否则返回参数错误。
- `nickname`：
  - 转成字符串并去首尾空白。
  - 允许为空字符串，保存为 `NULL` 表示清除昵称。
  - 最大长度 32 个字符，超过返回参数错误。
- `avatarUrl`：
  - 转成字符串并去首尾空白。
  - 只允许为空值或服务端头像上传接口返回的站内相对路径；为空时保存为 `NULL`。
  - 最大长度 512。
- `gender`：
  - 沿用现有校验，只允许 `male` 或 `female`。

`PATCH /api/users/me` 改为调用 `updateUserProfile()`，并返回：

```json
{
  "ok": true,
  "data": {
    "user": {},
    "roles": []
  }
}
```

为了保持兼容，前端旧的 `updateUserGender(gender)` 仍可调用同一路由，只发送 `{ "gender": "male" }` 或 `{ "gender": "female" }`。

### 头像上传

新增接口：

```text
POST /api/users/me/avatar
Authorization: Bearer <token>
Content-Type: multipart/form-data
field: avatar
```

服务端行为：

- 必须登录。
- 读取 multipart body，提取 `avatar` 文件。
- 文件大小限制 2 MB。
- 允许 `image/jpeg` 和 `image/png`。
- 生成不可预测文件名，例如 `user-<userId>-<timestamp>-<random>.jpg`。
- 保存到 API 可写上传目录，例如 `apps/api/uploads/avatars`。
- 返回站内相对 URL，例如 `/uploads/avatars/user-1-...jpg`。

新增静态访问：

```text
GET /uploads/avatars/:filename
```

只允许访问头像目录中的文件名，不允许路径穿越。响应设置正确的图片 `content-type` 和缓存头。`publicUser().avatarUrl` 返回相对路径，前端展示时通过 API base URL 拼成完整图片地址；默认头像仍使用小程序本地静态资源路径。

本阶段不引入 multipart 依赖。由于头像文件小、字段固定，后端可以用 Node 原生 Buffer 完成边界解析，并用严格大小限制控制内存占用。

## 前端设计

### API 工具

在 `apps/miniprogram/src/utils/api.js` 中增加：

- `assetUrl(path)`：如果头像是 `/uploads/...` 站内路径，则拼接 API base URL；如果是 `/static/...` 或完整 URL，则按现有路径使用。
- `uploadUserAvatar(filePath)`：调用 `uni.uploadFile` 上传到 `/api/users/me/avatar`，携带 `Authorization` header，返回 `avatarUrl`。
- `updateUserProfile(patch)`：调用 `PATCH /api/users/me`，拿到 `{ user, roles }` 后调用 `setAuth()`。

保留 `updateUserGender(gender)`，内部改为调用 `updateUserProfile({ gender })`，避免重复缓存逻辑。

### 资料弹窗

扩展 `AuthIdentityBar.vue`：

- `displayName` 优先使用 `user.nickname`，其次使用 openid，最后使用 `用户{id}`。
- 头像显示优先级：
  1. `user.avatarUrl`
  2. 根据 `gender` 选择现有男女默认头像
  3. 未知头像图标
- 弹窗增加昵称输入框。
- 弹窗增加头像预览和更换头像按钮。
- 更换头像使用微信小程序 `button open-type="chooseAvatar"`，从 `@chooseavatar` 事件读取临时头像路径。
- 保存时如果有新头像临时路径，先调用 `uploadUserAvatar()`，再调用 `updateUserProfile()`。
- 必填性别模式下，没有选择性别不能保存；普通编辑模式下，昵称和头像可单独保存。
- 保存成功 toast 仍使用“个人信息已更新”。

### “我的”页

调整 `apps/miniprogram/src/pages/mine/index.vue`：

- 已登录区域增加“个人信息”卡片，展示头像、昵称、性别。
- “编辑资料”入口打开同一个资料弹窗或发出同一个资料请求事件。
- 保留现有“我的性别”快捷修改也可以接受，但推荐把性别编辑收敛进个人信息弹窗，避免两个入口状态不一致。
- `statusText` 使用昵称优先，不再优先展示 openid。

## 数据流

```text
用户点击更换头像
  -> 微信 chooseAvatar 返回临时文件路径
  -> 本地弹窗预览临时头像
  -> 用户点击保存
  -> POST /api/users/me/avatar 上传图片
  -> API 返回 /uploads/avatars/...
  -> PATCH /api/users/me { nickname, avatarUrl, gender }
  -> API 返回 { user, roles }
  -> setAuth() 更新缓存
  -> AUTH_CHANGE_EVENT 刷新身份条和“我的”页
```

## 错误处理

- 未登录编辑资料：触发登录；登录失败则不打开编辑表单。
- 昵称过长：前端提示并阻止保存；后端仍做兜底校验。
- 头像选择取消：保留旧头像，不报错。
- 头像上传失败：不提交新的头像 URL，提示“头像上传失败，请重试”。
- 资料保存失败：保持弹窗打开，让用户可重试。
- 静态头像文件不存在：图片请求返回 404，前端仍可在下一次编辑时选择新头像。
- 必填性别弹窗关闭：保持现有行为，提示选择性别后继续。

## 测试与检查

新增静态或 smoke 检查，覆盖：

- `users.js` 暴露 `updateUserProfile()`，并校验昵称、头像 URL、性别。
- `server.js` 的 `PATCH /api/users/me` 支持 profile patch。
- `server.js` 提供 `POST /api/users/me/avatar` 和 `/uploads/avatars/` 静态访问。
- `api.js` 提供 `uploadUserAvatar()`、`updateUserProfile()`，且 `updateUserGender()` 复用资料更新。
- `AuthIdentityBar.vue` 展示昵称、头像，使用 `open-type="chooseAvatar"`。
- `mine/index.vue` 展示个人信息和编辑入口。

常规验证：

- `npm --workspace apps/api run check`
- `node scripts/check-miniprogram.js`
- 新增个人资料检查脚本
- `npm run check`

## 发布前注意

- 生产环境需要为头像上传目录配置持久化存储；否则容器重建会丢失本地头像文件。
- 小程序隐私说明应覆盖用户头像和昵称的收集、展示用途。
- 后续如果接入对象存储，`avatar_url` 可以继续保存站内代理路径或对象存储 URL，但前端应继续通过 `assetUrl()` 统一展示。
