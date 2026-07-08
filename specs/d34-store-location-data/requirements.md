# D34 Requirements: 店家地图定位数据统一

更新日期：2026-07-08

## Introduction

D34 让剧本店地址具备地图定位能力。系统将店家位置统一为 `address + latitude + longitude`，并约定 `latitude`、`longitude` 均保存 GCJ-02 坐标。小程序使用微信内置地图能力完成主动选点和打开地图；admin web 本次先支持手填 GCJ-02 坐标，后续如接入腾讯位置服务 Web SDK 或 WebService API，也读写同一套店家位置字段。

D34 统一的是数据层，不统一地图组件层。小程序内置地图能力不能直接复用于普通 web 页面。

## Requirements

### Requirement 1: 店家资料保存统一位置字段

**User Story:** 作为平台运营者，我希望店家资料统一保存地址、纬度和经度，以便小程序和 admin web 使用同一套位置数据。

#### Acceptance Criteria

1. WHEN 数据库迁移执行 THEN 系统 SHALL 给 `stores` 增加 `latitude` 和 `longitude` 可空字段。
2. WHEN 旧店家没有坐标 THEN 系统 SHALL 保持 `latitude = NULL`、`longitude = NULL`，且旧数据继续可用。
3. WHEN 系统保存店家坐标 THEN `latitude` 和 `longitude` SHALL 按 GCJ-02 坐标解释。
4. WHEN 后续从非 GCJ-02 来源导入坐标 THEN 系统 SHALL 在写入前转换为 GCJ-02。
5. WHEN 店家只有地址没有坐标 THEN 前端 SHALL 只展示文本地址，不展示地图打开动作。

### Requirement 2: 后端接收、校验并返回坐标字段

**User Story:** 作为客户端开发者，我希望所有店家相关 API 都返回同一套位置字段，以便小程序和 admin web 不需要维护不同数据结构。

#### Acceptance Criteria

1. WHEN 创建私有店家时请求包含合法 `latitude` 和 `longitude` THEN 后端 SHALL 保存坐标。
2. WHEN 管理员创建店家时请求包含合法 `latitude` 和 `longitude` THEN 后端 SHALL 保存坐标。
3. WHEN 管理员编辑店家时请求包含合法 `latitude` 和 `longitude` THEN 后端 SHALL 更新坐标。
4. WHEN 请求坐标为空字符串、`null` 或 `undefined` THEN 后端 SHALL 保存为 `NULL`。
5. WHEN `latitude` 不是有限数字或超出 `-90..90` THEN 后端 SHALL 返回 400。
6. WHEN `longitude` 不是有限数字或超出 `-180..180` THEN 后端 SHALL 返回 400。
7. WHEN 请求 `GET /api/stores` THEN 响应 SHALL 包含 `address`、`latitude` 和 `longitude`。
8. WHEN 请求 `GET /api/admin/stores` THEN 响应 SHALL 包含 `address`、`latitude` 和 `longitude`。

### Requirement 3: 车局详情可获得店家位置

**User Story:** 作为玩家，我希望在车局详情看到店家地址并能打开地图，以便确认到店位置。

#### Acceptance Criteria

1. WHEN 车局详情接口返回数据 THEN 响应 SHALL 包含店家地址字段。
2. WHEN 车局对应店家有完整坐标 THEN 详情响应 SHALL 包含店家纬度和经度字段。
3. WHEN 店家改名 THEN 车局标题 SHALL 继续使用 `store_name_snapshot`。
4. WHEN 店家地址或坐标被管理员修正 THEN 车局详情 SHALL 可使用修正后的地址和坐标。
5. WHEN 店家缺少任一坐标 THEN 车局详情 SHALL NOT 暴露可打开地图的完整坐标状态。

### Requirement 4: admin web 支持同一套位置数据

**User Story:** 作为管理员，我希望在 web 后台创建和编辑店家时能用腾讯地图选点、地名搜索或手填经纬度，以便和小程序地图数据保持一致。

#### Acceptance Criteria

1. WHEN 管理员打开店家新增表单 THEN 表单 SHALL 展示地址、GCJ-02 纬度和 GCJ-02 经度字段。
2. WHEN 管理员打开店家编辑表单 THEN 表单 SHALL 回显现有地址、纬度和经度。
3. WHEN 管理员保存店家 THEN admin web SHALL 提交 `address`、`latitude` 和 `longitude`。
4. WHEN 坐标为空 THEN admin web SHALL 允许保存为空。
5. WHEN 表单展示坐标字段 THEN 文案 SHALL 标明坐标系为 GCJ-02。
6. WHEN 运行时腾讯位置服务 key 存在 THEN admin web SHALL 提供腾讯位置服务地图选点能力。
7. WHEN 管理员在腾讯地图上点选位置 THEN admin web SHALL 将点选坐标回填到 `latitude` 和 `longitude`。
8. WHEN 管理员输入地名或地址搜索 THEN admin web SHALL 通过腾讯位置服务 POI 搜索返回候选地点。
9. WHEN 管理员选择 POI 搜索结果 THEN admin web SHALL 将结果地址、纬度和经度回填到店家表单。
10. WHEN 当前腾讯位置服务 key 未开启 WebServiceAPI THEN admin web SHALL 提示需要开启 WebServiceAPI，并继续允许地图点选或手填 GCJ-02 坐标。
11. WHEN 运行时腾讯位置服务 key 不存在或地图加载失败 THEN admin web SHALL 继续允许手填 GCJ-02 坐标。

### Requirement 5: 小程序支持地图选点创建私有店家

**User Story:** 作为发起拼车的用户，我希望补录店家时可以用地图选点回填地址和坐标，以便减少手动输入错误。

#### Acceptance Criteria

1. WHEN 用户打开“添加给自己用”店家表单 THEN 小程序 SHALL 提供地图选点入口。
2. WHEN 用户点击地图选点 THEN 小程序 SHALL 调用 `uni.chooseLocation`。
3. WHEN 用户成功选点 THEN 小程序 SHALL 回填地址、GCJ-02 纬度和 GCJ-02 经度。
4. WHEN 用户取消选点 THEN 小程序 SHALL 保留原表单内容并且 SHALL NOT 报错。
5. WHEN 当前运行环境不支持 `chooseLocation` THEN 小程序 SHALL 提示用户手动填写地址。
6. WHEN 用户提交私有店家 THEN 请求 SHALL 携带已回填的坐标字段。
7. WHEN 使用 `chooseLocation` THEN 项目 SHALL 按微信要求完成位置接口权限开通和 app 配置声明。
8. WHEN 实现 D34 THEN 小程序 SHALL NOT 调用 `getLocation` 主动读取或保存用户当前位置。

### Requirement 6: 小程序车局详情支持打开地图

**User Story:** 作为玩家，我希望在车局详情一键打开地图，以便导航到剧本店。

#### Acceptance Criteria

1. WHEN 车局详情有店家地址 THEN 小程序 SHALL 展示地址。
2. WHEN 车局详情同时有 `store_latitude` 和 `store_longitude` THEN 小程序 SHALL 展示 `查看地图` 入口。
3. WHEN 用户点击 `查看地图` THEN 小程序 SHALL 调用 `uni.openLocation`。
4. WHEN 调用 `openLocation` THEN 小程序 SHALL 传入店名、地址、GCJ-02 纬度和 GCJ-02 经度。
5. WHEN 车局详情缺少任一坐标 THEN 小程序 SHALL NOT 展示地图入口。
6. WHEN `openLocation` 调用失败 THEN 小程序 SHALL 展示轻量错误提示。

### Requirement 7: 坐标系和跨端边界明确

**User Story:** 作为开发团队，我希望 spec 和代码明确小程序地图能力与 web 地图能力的边界，以免后续混用 API 或坐标系。

#### Acceptance Criteria

1. WHEN D34 文档描述跨端统一 THEN SHALL 明确统一的是数据层，不是地图组件层。
2. WHEN D34 文档描述小程序能力 THEN SHALL 明确小程序使用微信内置 `chooseLocation` 和 `openLocation`。
3. WHEN D34 文档描述 admin web 能力 THEN SHALL 明确 admin web 使用腾讯位置服务 Web SDK 选点、POI 搜索，并退化为手填坐标。
4. WHEN 后续接入地址解析或逆地址解析 THEN SHALL 使用服务端 WebService API Key，不把服务端密钥放进前端。
5. WHEN 代码注释或 UI 文案描述坐标 THEN SHALL 不把 WGS-84、BD-09 与 GCJ-02 混为一谈。

### Requirement 8: D34 交付物和验证

**User Story:** 作为开发团队，我希望 D34 有清晰的 spec 三件套和自动验证入口，方便后续按任务实现。

#### Acceptance Criteria

1. WHEN D34 spec 完成 THEN SHALL 产出 `requirements.md`。
2. WHEN D34 spec 完成 THEN SHALL 产出 `design.md`。
3. WHEN D34 spec 完成 THEN SHALL 产出 `tasks.md`。
4. WHEN D34 实现完成 THEN SHALL 更新相关静态检查或烟测。
5. WHEN D34 实现完成 THEN SHALL 通过 `npm run check`。
6. WHEN D34 实现完成 THEN SHALL 通过 `npm run build:mp-weixin`。
