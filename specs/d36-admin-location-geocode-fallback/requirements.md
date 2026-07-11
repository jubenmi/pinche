# D36 Requirements: admin 店家位置搜索与地址解析兜底

更新日期：2026-07-09

## Overview

D36 在 D34 店家地图定位基础上增强 admin web 的位置搜索链路。管理员仍优先使用腾讯 POI 搜索获得候选地点；当 POI 搜索没有候选、每日额度耗尽或接口失败时，系统改走服务端地址解析代理：先腾讯地址解析，再高德地理编码。地址解析结果只回填 `latitude` 和 `longitude`，由管理员在地图上确认后保存。

## Scope

包含：

- admin web 店家表单位置搜索链路增强。
- API 服务端新增管理员地址解析代理。
- 腾讯地址解析优先，高德地理编码兜底。
- 地址解析 key 只保存在服务端环境变量中。
- 静态检查覆盖链路顺序、密钥边界和回填行为。

不包含：

- 小程序接入腾讯或高德 WebService。
- 自动保存地址解析结果。
- 批量历史店家地址解析。
- 付费额度申请或控制台配置。
- 百度 BD-09 坐标接入。

## Requirements

### Requirement 1: admin web 优先走腾讯 POI 搜索

**User Story:** 作为运营管理员，我希望输入店名或地址后优先看到腾讯 POI 候选，以便在结果准确时直接选择。

Acceptance Criteria:

1. WHEN 管理员点击位置搜索 THEN admin web SHALL 先尝试现有腾讯 POI 搜索。
2. WHEN POI 搜索返回候选 THEN admin web SHALL 展示候选列表。
3. WHEN 管理员选择 POI 候选 THEN admin web SHALL 回填候选地址和坐标，并不自动保存。
4. WHEN POI 搜索返回候选 THEN admin web SHALL NOT 再调用地址解析兜底。

### Requirement 2: POI 不可用时服务端地址解析兜底

**User Story:** 作为运营管理员，我希望腾讯 POI 没额度或没结果时，系统仍可通过完整地址找坐标。

Acceptance Criteria:

1. WHEN POI 搜索返回每日额度耗尽 THEN admin web SHALL 调用服务端地址解析代理。
2. WHEN POI 搜索没有候选 THEN admin web SHALL 调用服务端地址解析代理。
3. WHEN POI 搜索接口失败 THEN admin web MAY 调用服务端地址解析代理，并展示 POI 失败原因。
4. WHEN 地址解析代理成功 THEN admin web SHALL 只回填 `latitude` 和 `longitude`。
5. WHEN 地址解析代理成功 THEN admin web SHALL NOT 覆盖管理员填写的地址、店名、城市或区域。
6. WHEN 地址解析代理失败 THEN admin web SHALL 保留已填写内容和手填坐标能力。

### Requirement 3: 服务端先腾讯地址解析，再高德兜底

**User Story:** 作为平台维护者，我希望尽量保持腾讯地图坐标体系和现有体验一致，同时有免费额度更高的备用解析。

Acceptance Criteria:

1. WHEN 服务端收到地址解析请求 THEN API SHALL require `system_admin`。
2. WHEN 腾讯地址解析 key 存在 THEN API SHALL 先调用腾讯地址解析。
3. WHEN 腾讯地址解析返回可信结果 THEN API SHALL 返回腾讯 GCJ-02 坐标并停止。
4. WHEN 腾讯地址解析缺 key、无结果、低可信、超额或失败 THEN API SHALL 尝试高德地理编码。
5. WHEN 高德地理编码返回结果 THEN API SHALL 返回高德 GCJ-02 坐标。
6. WHEN 两个 provider 均不可用 THEN API SHALL 返回明确错误。

### Requirement 4: 密钥和坐标边界

**User Story:** 作为平台维护者，我希望地图服务 key 不被写入代码或下发到不需要的客户端。

Acceptance Criteria:

1. WHEN 实现 D36 THEN 腾讯地址解析和高德地理编码 key SHALL 从 API 服务端环境变量读取。
2. WHEN 实现 D36 THEN 高德 key SHALL NOT 出现在 admin web runtime config、Docker ARG 或小程序代码中。
3. WHEN 返回坐标 THEN API SHALL 校验纬度 `-90..90`、经度 `-180..180`。
4. WHEN provider 返回 WGS-84 或 BD-09 坐标 THEN API SHALL NOT 直接保存；D36 仅使用腾讯和高德 GCJ-02 结果。

### Requirement 5: 验证

**User Story:** 作为开发者，我希望检查脚本能防止以后把兜底顺序写反或把高德 key 下发到前端。

Acceptance Criteria:

1. WHEN 运行 `node scripts/d36-admin-location-geocode-check.js` THEN SHALL 检查服务端代理路由。
2. WHEN 运行 D36 检查 THEN SHALL 检查腾讯优先、高德兜底顺序。
3. WHEN 运行 D36 检查 THEN SHALL 检查 admin web POI 搜索失败后调用服务端地址解析。
4. WHEN 运行 D36 检查 THEN SHALL 检查地址解析结果只回填坐标。
5. WHEN 运行 `npm run check` THEN SHALL 包含 D36 检查。
