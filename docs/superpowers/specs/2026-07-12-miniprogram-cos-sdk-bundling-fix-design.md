# 微信小程序 COS SDK 打包修复设计

## 问题

相册上传触发 COS 客户端初始化时，小程序报错：

`module 'utils/cos-wx-sdk-v5/index.js' is not defined`

当前源码在函数内调用 `require("cos-wx-sdk-v5/index.js")`。uni-app 构建后，这个裸模块 `require` 仍残留在 `dist/build/mp-weixin/utils/api.js`。微信运行时把它解析成页面目录下的相对模块，但构建包没有生成该路径，所以 SDK 无法加载。

现有回归检查只匹配源码中的 `require` 字符串，没有检查最终微信小程序构建包，因此没有捕获这个问题。

## 方案

在 `apps/miniprogram/src/utils/api.js` 顶层使用静态 ESM import 引入 COS SDK。由 Vite/uni-app 在构建期解析 CommonJS 包并把 SDK 收进公共 vendor chunk；`loadCosSdk` 只返回已经导入的构造器。

不采用手工复制 SDK 到 `utils/cos-wx-sdk-v5/` 的方案，因为它会制造第二份依赖来源，并带来升级和发布同步风险。

## 变更边界

- 只修改微信小程序 COS SDK 的装载方式。
- 不修改 COS 授权、上传、重试、错误分类或 API fallback 逻辑。
- 更新源码级检查，禁止重新引入动态 import 或运行时裸 `require`。
- 新增最终构建包检查，确认 `utils/api.js` 不含未解析的 `cos-wx-sdk-v5` 模块引用，同时 vendor chunk 包含 COS SDK 实现。

## 验证

1. 先让新增构建产物检查在当前实现上失败，证明它能捕获截图中的问题。
2. 改为静态 ESM import 后运行相关单元测试。
3. 重新执行微信小程序生产构建。
4. 检查最终构建包不存在 `require("cos-wx-sdk-v5/index.js")` 或 `utils/cos-wx-sdk-v5`，且 vendor chunk 包含 SDK 标识和实现。
5. 运行仓库现有 COS 存储检查，确保业务契约没有回归。
