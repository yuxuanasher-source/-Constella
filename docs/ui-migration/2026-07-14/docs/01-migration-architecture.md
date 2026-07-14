# UI 迁移技术架构

## 1. 当前诊断

正式运营控制台的核心视图集中在 `components/reference-ui/ops-reference.jsx`：当前约 33,886 行，包含约 1,487 处内联样式和 444 次 React Hook 调用。导航、查询状态、业务动作、轮询、弹窗和所有页面一起进入同一个客户端组件，导致：

- 修改任意页面都可能影响其他页面。
- 页面无法获得清晰的路由级代码分包。
- 首屏需要解析大量当前路由不使用的 JSX 和逻辑。
- 数据状态和视图状态互相耦合，测试定位成本高。
- 像素调整依赖复制样式，长期容易重新分叉。

## 2. 迁移原则

1. 保留现有 `features/**`、`app/api/**`、Supabase、RBAC 和 DTO 合同。
2. HTML 原型只作为视觉基线，不复制其模拟数据和 CDN 脚本。
3. 每个业务页面使用真实 App Router 路由，不再通过单个组件内的 `route` 状态切屏。
4. 默认使用 Server Component；只将筛选、弹窗、编辑器、实时状态等交互区域声明为 Client Component。
5. 不创建覆盖所有业务域的全局数据 Provider。
6. 公共 UI 只容纳跨业务稳定复用的控件；业务组件归属各自 `features/<domain>`。
7. 新旧 UI 通过功能开关并存，迁移过程可逐路由回滚。

## 3. 目标目录

```text
app/(ops)/console/
  layout.tsx
  page.tsx
  projects/page.tsx
  projects/[projectId]/page.tsx
  streamers/page.tsx
  admissions/page.tsx
  schedules/page.tsx
  reports/page.tsx
  settlements/page.tsx
  audit/page.tsx
  exports/page.tsx
  ai/page.tsx
  knowledge/page.tsx
  settings/page.tsx

components/ops-shell/
  ops-shell.tsx
  ops-sidebar.tsx
  ops-topbar.tsx
  mobile-navigation.tsx

components/ops-ui/
  button.tsx
  icon-button.tsx
  input.tsx
  select.tsx
  card.tsx
  table.tsx
  badge.tsx
  tabs.tsx
  dialog.tsx
  drawer.tsx
  empty-state.tsx

features/<domain>/
  model/
  server/
  client/
  ui/

styles/ops/
  tokens.css
  foundations.css
```

## 4. 页面数据流

```text
App Router page
  -> 服务端鉴权
  -> 现有 feature/service 查询
  -> DTO/页面 ViewModel 适配
  -> Server Component 首屏
  -> 小型 Client Island 处理交互
  -> 现有 API 或 Server Action 完成 mutation
```

筛选、分页、排序和标签页优先进入 URL Search Params。临时输入、弹窗开关和表格选中项保留为局部客户端状态。用户敏感数据不进入跨用户持久缓存。

## 5. 组件所有权

- `components/ops-ui`：按钮、输入框、表格骨架、状态标签等无业务语义控件。
- `components/ops-shell`：品牌、导航、顶部操作区和响应式框架。
- `features/projects/ui`：项目列表、阶段卡、项目详情等项目语义组件。
- `features/settlements/ui`：结算批次、金额摘要、锁定确认等财务语义组件。
- `features/knowledge/ui`：知识列表、目录、Markdown 阅读和编辑状态。
- `features/ai/ui`：会话、上下文、消息、产物和安全状态。

禁止业务域通过另一个业务域的 UI 目录复用组件。需要跨域复用时，先抽取无业务语义的公共控件。

## 6. 非目标

- 本轮不改登录、主播移动端和公开分享页。
- 不同时重构 API 返回结构或数据库表。
- 不使用 iframe 将原型嵌入正式应用。
- 不在一次 PR 中迁移所有页面。
- 不为追求抽象而建立新的通用状态管理框架。

