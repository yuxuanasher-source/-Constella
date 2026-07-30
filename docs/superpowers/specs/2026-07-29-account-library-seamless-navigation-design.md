# 账号库无缝场景切换设计

## 目标

将账号库从独立页面外壳收编为经营端 `OpsReferenceApp` 的原生场景，使账号库与项目、主播、准入、任务等模块之间的切换不再触发整页导航、重新鉴权和整棵组件树重挂载。

## 根因

- 经营端普通模块通过 `setRoute()` 在同一个 React 应用内切换。
- 账号库侧栏项带有独立 `href`，`Sidebar` 使用 `window.location.assign()` 进入 `/console/account-library`。
- 独立账号库外壳中的其他侧栏项又统一执行 `window.location.assign("/console")`。
- 因此双向切换都会销毁当前文档，重新执行服务端鉴权、数据查询、脚本加载和客户端挂载。

## 设计

1. 新增 `AccountLibraryScreen` 客户端场景组件。
   - 仅在第一次激活账号库时调用现有 `GET /api/account-library`。
   - 成功后缓存账号数据；切换到其他场景时仅隐藏而不卸载账号库面板，保留筛选、展开项和未提交表单状态。
   - 加载失败时显示可重试错误态。

2. 将账号库注册为 `OpsReferenceApp` 原生路由。
   - 侧栏 key 改为 `account-library`，移除 `href` 和 `window.location.assign()` 分支。
   - 使用统一的 `go()` 场景切换和面包屑。
   - 账号管理按钮权限继续由现有 `canManageAccounts()` 规则决定。

3. 统一旧地址。
   - `/console/account-library` 仍可直接访问。
   - 该页面改为服务端预加载账号列表后渲染同一个 `OpsReferenceApp`，初始场景设为 `account-library`。
   - 使用与 `/console` 相同的员工鉴权、当前用户和组织数据映射，不再维护第二套 `AccountLibraryShell`。

## 数据与权限边界

- 列表懒加载继续调用现有受鉴权 API；字段脱敏仍由服务端 DTO 适配器按角色完成。
- 新增、状态变更、设备和登录日志等写操作继续使用现有 API 与服务层权限校验。
- UI 中是否展示管理操作只复用 `canManageAccounts()`，不创建新的权限规则。

## 验收标准

- 从任一经营端场景点击“账号库”不会触发文档级导航。
- 从账号库点击任一其他场景立即走同一 React 路由切换。
- 账号数据只在首次进入时加载一次，往返切换不重复请求。
- 账号库筛选、详情展开和新增表单状态在场景往返后保留。
- `/console/account-library` 直接访问仍显示统一主壳和真实账号数据。
- UI 冒烟、类型检查、lint 和生产构建通过。
