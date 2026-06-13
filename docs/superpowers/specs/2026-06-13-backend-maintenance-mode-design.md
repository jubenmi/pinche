# Backend Maintenance Mode Design

更新日期：2026-06-13

## 背景

当前小程序首页在 `onLoad` 中直接调用 `ensureLoggedIn()`。如果后端尚未部署或生产 API 域名不可达，登录请求失败后只会 toast “登录失败”，用户仍停留在正常首页，继续点击“创建”“我的”会遇到更多接口错误。

发布策略调整为先发布小程序，再发布后端。因此小程序必须在一段“生产后端不可用”的窗口内给出稳定、清晰的维护提示，并在后端上线后自动恢复。

## 目标

1. 后端不可用时，小程序显示全局维护态，而不是暴露正常业务入口。
2. 用户从首页、旧分享链接或深层页面进入时，都能被引导回维护提示。
3. 维护态支持手动“重试”和自动轮询恢复。
4. 后端恢复后，小程序回到正常首页并继续现有登录流程。
5. 发布检查允许“生产 API 域名已注入，但后端暂未健康”的前端先发布路径。

## 非目标

- 不新增独立后端维护服务。
- 不新增远程开关、运营后台或动态公告配置。
- 不在后端恢复后自动跳回原深层页面。
- 不改变现有登录、建车、分享、报名、管理等业务 API 语义。
- 不把维护态做成单独小程序页面路由；第一版复用首页承载。

## 已确认决策

- 维护态采用全局方案：任意页面发现后端不可用后，回到首页显示维护提示。
- 恢复方式采用自动轮询加手动重试。
- 首页维护态隐藏正常业务入口，避免用户进入依赖后端的流程。

## 推荐方案

在小程序前端增加一个轻量 backend status 模块，仍放在现有 `apps/miniprogram/src/utils/api.js` 内，避免过早拆分文件。模块负责：

- 调用 `<VITE_API_BASE_URL>/health` 做短超时健康检查。
- 维护全局状态：`checking`、`available`、`maintenance`、`lastCheckedAt`、`lastErrorMessage`。
- 通过 `uni.$emit` 广播后端状态变化。
- 在业务请求遇到网络不可达、超时或 request fail 时标记维护态。
- 维护态下让普通业务请求快速失败，减少用户等待。

首页 `apps/miniprogram/src/pages/index/index.vue` 作为维护态承载页。它订阅后端状态，展示维护 UI，提供重试按钮，并在维护态期间启动定时健康检查。健康检查通过后，首页恢复原有主视觉、按钮和 `ensureLoggedIn()` 流程。

## 前端架构

### API 工具层

`apps/miniprogram/src/utils/api.js` 新增导出：

```js
export const BACKEND_STATUS_CHANGE_EVENT = "pinche-backend-status-change";
export function getBackendStatus();
export async function checkBackendHealth(options = {});
export function markBackendMaintenance(error);
export function clearBackendMaintenance();
export function shouldBlockBusinessRequests();
```

状态对象建议形状：

```js
{
  checking: false,
  available: null,
  maintenance: false,
  lastCheckedAt: "",
  lastErrorMessage: ""
}
```

`available: null` 表示尚未确认；`maintenance: true` 表示当前应展示维护态。

`checkBackendHealth()` 请求 `/health`，默认 timeout 为 3000ms。返回 `ok: true` 时清除维护态；请求失败、超时、HTTP 5xx、返回 `ok: false` 时进入维护态。HTTP 4xx 不应作为健康检查成功处理，因为 `/health` 预期无需登录。

`request(options)` 在发起普通业务请求前检查维护态。如果已经处于维护态，且 `options.allowDuringMaintenance !== true`，直接 reject 一个带 `maintenance: true` 的错误对象。健康检查本身通过 `allowDuringMaintenance: true` 或内部直接调用 `uni.request` 避免被拦截。

业务请求的 `fail(error)` 分支中，如果发生 timeout、fail、DNS、TLS、连接不可达等小程序 request fail，调用 `markBackendMaintenance(error)` 并触发首页跳转。

### 全局跳转

`markBackendMaintenance()` 只负责状态变化和事件广播，不直接频繁跳转。新增内部 helper 在状态从非维护变为维护时执行：

```js
uni.reLaunch({ url: "/pages/index/index?maintenance=1" });
```

为了避免重复跳转，只有状态首次进入维护态时触发。首页本身收到事件后只更新 UI。

### 首页维护 UI

`apps/miniprogram/src/pages/index/index.vue` 增加两种渲染状态：

- `backendStatus.maintenance === true`：显示维护提示。
- 其他情况：显示现有首页、创建入口、我的入口和版本号。

维护态文案：

- 标题：`服务正在上线维护中`
- 正文：`我们正在准备后端服务，稍后会自动恢复。`
- 次级信息：显示最近检查时间；如果有错误摘要，显示 `当前连接暂不可用` 这类用户友好描述。
- 操作：`重试` 按钮。点击后调用 `checkBackendHealth({ force: true })`。

维护态轮询：

- 首页进入维护态后启动 `setInterval`，每 5000ms 检查一次。
- 离开首页或退出维护态时清理 interval。
- 每次检查期间按钮展示 `检查中...` 并禁用重复点击。

健康恢复：

- `checkBackendHealth()` 成功后清除维护态。
- 首页恢复正常内容。
- 恢复后只在未登录时调用现有 `ensureLoggedIn()`，避免重复弹登录或重复请求。

## 数据流

1. 小程序打开首页。
2. 首页先调用 `checkBackendHealth()`。
3. 如果 `/health` 不可用，`api.js` 设置维护态并广播 `BACKEND_STATUS_CHANGE_EVENT`。
4. 首页显示维护 UI，隐藏业务入口，并启动 5 秒轮询。
5. 如果用户从深层页面进入，页面业务请求失败后调用 `markBackendMaintenance()`，小程序 `reLaunch` 到首页维护态。
6. 后端上线后，下一次自动轮询或用户点击重试命中 `/health`。
7. `api.js` 清除维护态并广播事件。
8. 首页恢复正常 UI，并继续现有登录流程。

## 错误处理

- 健康检查失败不展示 toast，避免自动轮询刷屏。
- 手动重试失败时可更新页面内状态，不额外 toast。
- 普通业务请求在维护态下快速失败，错误对象包含 `maintenance: true` 和用户友好消息。
- 非网络类业务错误继续沿用现有逻辑，不应被错误归类为维护态。
- 健康检查成功后，已有 token 和用户信息仍按现有 `getCurrentUser()`、`getToken()` 逻辑复用。

## 发布流程调整

现有 `specs/d9-mvp-release/release-checklist.md` 中“上传前门禁”要求后端 `/health` 和 `/health/db` 通过，这与前端先发布策略冲突。实施时需要调整为两阶段门禁：

- 小程序先发布门禁：生产 HTTPS API 域名已确定、已注入构建产物、微信后台 request 合法域名已配置、维护态验证通过。
- 后端上线门禁：后端部署完成后再要求 `/health`、`/health/db`、数据库迁移和真实登录配置通过。

`scripts/d9-release-check.js` 当前只校验构建产物和 API 域名注入，不请求线上健康接口，因此适合继续作为“小程序先发布”的构建检查。实施时应让检查脚本或补充检查脚本验证维护态相关源码存在，防止回归。

## 测试策略

1. 为 `api.js` 的维护态纯逻辑增加脚本级测试：
   - 初始状态不是维护态。
   - 健康检查失败后进入维护态。
   - 健康检查成功后退出维护态。
   - 维护态下业务请求快速失败。
2. 为首页源码增加静态检查：
   - 存在维护态标题和重试按钮。
   - 维护态条件下不渲染创建和我的入口。
   - 存在轮询清理逻辑。
3. 保留现有 `npm run check`。
4. 构建小程序后运行 `npm run d9:release-check`，确认生产 API 域名注入仍通过。

## 实施边界

第一版保持改动集中在：

- `apps/miniprogram/src/utils/api.js`
- `apps/miniprogram/src/pages/index/index.vue`
- `scripts/check-miniprogram.js` 或新增轻量检查脚本
- `specs/d9-mvp-release/release-checklist.md`
- 必要时更新 `package.json` 的 `check` 串联脚本

不修改后端服务逻辑，不新增数据库迁移，不调整已有业务页面结构。
