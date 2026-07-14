# 页面、路由与数据域映射

| 原型 | 正式路由 | 主要现有业务域/API | 迁移重点 |
|---|---|---|---|
| `index.html` | `/console` | `features/dashboards`、`/api/dashboards/role-home` | 服务端首屏、KPI、行动队列 |
| `projects.html` | `/console/projects` | `features/projects`、`/api/projects` | 搜索、筛选、分页、创建项目 |
| `project-detail.html` | `/console/projects/[projectId]` | `features/projects`、`features/collaborations` | 动态路由、阶段与项目动作 |
| `streamers.html` | `/console/streamers` | `features/streamers`、`features/streamer-lifecycle`、`/api/streamers` | 资源池、详情抽屉、状态筛选 |
| `admissions.html` | `/console/admissions` | `features/applications`、`features/admission-review` | 准入评估、复核和证据状态 |
| `schedules.html` | `/console/schedules` | `features/live-operations`、`/api/live-tasks` | 日历/列表、批量排班、冲突状态 |
| `reports.html` | `/console/reports` | `features/live-operations`、`features/report-pre-review`、`/api/live-reports` | OCR、弱证据、人工复核 |
| `settlements.html` | `/console/settlements` | `features/settlements`、`/api/settlement-batches`、`/api/settlement-pool` | 金额精度、锁定、批次状态 |
| `audit.html` | `/console/audit` | `features/audit-center`、`/api/audit-logs` | 审计筛选和详情 |
| `audit.html` | `/console/exports` | `features/exports`、`/api/exports` | 导出权限、任务状态、下载 |
| `ai-workbench.html` | `/console/ai` | `features/ai`、`features/war-room`、`/api/ai/**` | 会话、上下文、来源和人工确认 |
| `knowledge-base.html` | `/console/knowledge` | `/api/knowledge-base`、`/api/ai/kb` | Markdown 阅读/编辑、版本与 AI 引用 |
| `settings.html` | `/console/settings` | `features/organizations`、`/api/organization/settings` | 组织配置、成员与审计提示 |

## 兼容处理

- 旧 `/console/stubs/m0` 到 `/console/stubs/m11` 在迁移期保留。
- 对应新页面上线后，旧入口改为服务端重定向或功能开关分流。
- 不再把多个正式页面映射到一个组件内部的字符串 route。
- 页面间导航统一使用 Next.js `Link` 或 Router。

## 数据适配规则

- 优先调用现有 feature service，不从页面直接拼 Supabase 查询。
- 旧组件中的显示数据转换迁入各业务域的 ViewModel adapter。
- 金额、日期、状态名称和权限判断必须复用现有业务函数。
- 原型中的固定数字、用户名和演示记录只用于测试 fixture。

