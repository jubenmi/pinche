# D8 QA Checklist

更新日期：2026-06-12

## 自动检查

| 检查项 | 命令 | 结果 |
| --- | --- | --- |
| 语法与结构检查 | `npm run check` | 通过 |
| 小程序发布构建 | `npm run build:mp-weixin` | 通过 |
| Docker API构建 | `docker compose build api` | 通过 |
| Docker API启动 | `docker compose up -d api` | 通过 |
| D2身份和数据模型 | `npm run d2:smoke` | 通过 |
| D3管理员资料录入 | `npm run d3:smoke` | 通过 |
| D4车头建车 | `npm run d4:smoke` | 通过 |
| D5分享报名 | `npm run d5:smoke` | 通过 |
| D6车头管理 | `npm run d6:smoke` | 通过 |
| D7分享统计 | `npm run d7:smoke` | 通过 |
| D8合规硬化 | `npm run d8:qa` | 通过 |

## 主链路

| 链路 | 覆盖方式 | 结果 |
| --- | --- | --- |
| 管理员录入店家 | D3 smoke | 通过 |
| 管理员录入剧本 | D3 smoke | 通过 |
| 车头建车 | D4 smoke | 通过 |
| 座位价格调整配平 | D4 smoke | 通过 |
| 发布车 | D4-D7 smoke | 通过 |
| 分享路径访问埋点 | D7 smoke | 通过 |
| 玩家申请上车 | D2/D5/D6/D7 smoke | 通过 |
| 车头审核申请 | D6 smoke | 通过 |
| 押金状态记录 | D6 smoke | 通过 |
| 锁座 | D6 smoke | 通过 |

## 权限和异常

| 检查项 | 覆盖方式 | 结果 |
| --- | --- | --- |
| 非管理员访问管理员能力 | D3 smoke | 通过 |
| 非车头查看申请 | D6 smoke | 通过 |
| 补贴不配平禁止发布 | D4 smoke | 通过 |
| 实付小于0禁止创建/发布 | D4 smoke | 通过 |
| 重复报名禁止 | D5 smoke | 通过 |
| 已锁座后不可重复锁定 | D6 smoke | 通过 |
| 公开字段高风险词拦截 | D8 QA | 通过 |
| 公开脚本列表中性化输出 | D8 QA | 通过 |
| 公开车详情不返回自由备注 | D8 QA | 通过 |

## 微信开发者工具

| 检查项 | 结果 |
| --- | --- |
| `dist/dev/mp-weixin` 已重新生成 | 通过，2026-06-12 11:15 |
| 开发者工具加载用户代码 | 通过，日志含 `finish load user code` |
| WebView加载完成 | 通过，日志含 `webview loaded` |
| 页面ready | 通过，日志含 `webview page ready` |
| 热重载瞬时 `app.json doesn't exist` | 已确认是 UniApp 重建目录时的瞬时日志，最终加载完成 |

## 真机兼容待办

真机需要上传体验版后由用户配合完成：

- iOS微信：登录、建车、分享、申请、审核。
- Android微信：登录、建车、分享、申请、审核。
- 分享卡片：好友会话打开路径参数正确。
- 网络：体验版后端域名和 request 合法域名配置正确。
