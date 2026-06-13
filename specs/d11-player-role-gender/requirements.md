# D11 Requirements: 玩家性别与角色位性别

更新日期：2026-06-13

## Requirements

### Requirement 1: 玩家性别长期保存

1. WHEN 微信登录创建或读取用户 THEN API SHALL 返回用户的 `gender`。
2. WHEN 登录用户没有 `gender` THEN 小程序 SHALL 打开个人信息模态窗并要求玩家选择自己的性别后再继续当前流程。
3. WHEN 玩家首次选择性别 THEN 系统 SHALL 将该值长期保存到账号资料。
4. WHEN 玩家以后再次登录且已有性别 THEN 小程序 SHALL NOT 重复要求选择。
5. WHEN 玩家需要修改性别 THEN 小程序 SHALL 在顶部个人信息条提供修改入口。
6. WHEN 玩家打开个人信息 THEN 小程序 SHALL 弹出模态窗用于修改性别。
7. WHEN 玩家在个人信息模态窗选择男或女 THEN 小程序 SHALL 展示对应的默认头像。

### Requirement 2: 剧本角色位性别

1. WHEN 剧本座位模板包含角色性别 THEN 前端 SHALL 读取为角色位的 `roleGender`。
2. WHEN 车头创建车局座位 THEN API SHALL 将角色位性别保存到 `session_seats.role_gender`。
3. WHEN 角色位为男位 THEN 小程序 SHALL 用 `♂` 标记。
4. WHEN 角色位为女位 THEN 小程序 SHALL 用 `♀` 标记。
5. WHEN 角色位不限性别 THEN 小程序 SHALL 不显示性别符号。

### Requirement 3: 不按性别限制选角

1. WHEN 男玩家选择女位 THEN 系统 SHALL 允许选择。
2. WHEN 女玩家选择男位 THEN 系统 SHALL 允许选择。
3. WHEN 玩家选择不限性别角色位 THEN 系统 SHALL 允许选择且不显示反串。
4. WHEN 角色位已被他人选择或锁定 THEN 现有座位占用规则 SHALL 继续生效。

### Requirement 4: 反串显示

1. WHEN 玩家性别为男且选择女位 THEN 最终选角页 SHALL 显示“反串”。
2. WHEN 玩家性别为女且选择男位 THEN 最终选角页 SHALL 显示“反串”。
3. WHEN 玩家性别与角色位性别一致 THEN 最终选角页 SHALL NOT 显示“反串”。
4. WHEN 角色位不限性别 THEN 最终选角页 SHALL NOT 显示“反串”。
5. WHEN 玩家换选角色 THEN 最终选角页 SHALL 按新角色重新计算“反串”。

### Requirement 5: 反串确认提示

1. WHEN 玩家选择不同性别角色位 THEN 小程序 SHALL 提示“反串可能会影响游戏体验，是否确认”。
2. WHEN 玩家确认提示 THEN 小程序 SHALL 继续选择或确认该角色。
3. WHEN 玩家取消提示 THEN 小程序 SHALL 停止本次选择，不改变已选角色。
4. WHEN 玩家选择相同性别或不限性别角色位 THEN 小程序 SHALL NOT 展示反串确认提示。

## Non-Goals

- 不增加第三种玩家性别选项。
- 不用玩家性别阻止玩家选择角色。
- 不公开展示其他玩家的账号性别。
- 不新增申请页；分享页继续作为最终选角页。
