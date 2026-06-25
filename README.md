# 经营舱

游戏直播 MCN / 直播工作室项目经营系统。当前版本是 P0 工程骨架，加一条「项目草稿创建 -> 发布」纵切片，用来验证多租户、RBAC、RLS、审计、通知、状态机和三端外壳。

## 快速开始

```bash
pnpm install
cp .env.example .env.local
pnpm supabase:start
pnpm supabase:migrate
pnpm dev
```

访问：

- 经营 Web：`http://localhost:3000/console/projects`
- 主播 App 外壳：`http://localhost:3000/m/tasks`
- 主播桌面外壳：`http://localhost:3000/desktop`

本地库不再随源码写入演示账号或业务样例数据。请通过 Supabase Auth / 后台流程创建真实测试账号。

`scripts/api-integration-smoke.mjs` 和 `scripts/manual-acceptance-smoke.mjs` 不读取源码 seed。运行前请在 `.env.local` 填写 `SMOKE_PROJECT_ID`、`SMOKE_STREAMER_ID`、`SMOKE_OWNER_EMAIL`、`SMOKE_OPS_EMAIL`、`SMOKE_FINANCE_EMAIL`、`SMOKE_STREAMER_EMAIL`、`SMOKE_USER_PASSWORD`，这些值应来自你在本地库中通过真实流程创建的验收数据。

## 产品文档

- [产品功能文档](docs/product-function-document.md)：按产品逻辑梳理经营舱的主闭环、状态机、权限、模块、API、数据模型和验收边界。
- [产品使用教程](docs/product-usage-tutorial.md)：面向最终用户的操作手册，覆盖登录、项目、主播、排班报数、结算导出和常见问题。

## 常用命令

```bash
pnpm dev
pnpm lint
pnpm type-check
pnpm test
pnpm build
pnpm supabase:migrate
```

`pnpm supabase:migrate` 当前映射到 `supabase db reset`，会按迁移重建本地库；`supabase/seed.sql` 保持为空，避免演示数据进入项目源码。

## 目录约定

```text
app/                         Next.js App Router
app/(ops)/console/           经营 Web 端
app/(streamer-app)/m/        主播 App 移动端外壳
app/(streamer-desktop)/      主播桌面端外壳
components/ui/               shadcn 风格基础组件
components/layouts/          三端布局
features/projects/           项目纵切片：状态机、服务、查询、server actions
lib/auth/                    会话与组织/角色解析
lib/rbac/                    角色权限与前端门控
lib/audit/                   统一审计写服务
lib/notify/                  站内通知底座
lib/db/                      Supabase client 与数据库契约测试
supabase/migrations/         数据库迁移，包含枚举、RLS、函数、视图
supabase/seed.sql            空 seed，占位用于本地自定义数据
```

## 架构边界

- 多租户：业务表均包含 `organization_id`，迁移中统一开启 RLS。
- 权限三层：数据库 RLS、服务端 RBAC、前端按钮/菜单门控。
- 字段级脱敏：主播端使用 `streamer_payable_items_safe` 安全视图，不返回厂家应收、毛利和成本。
- 审计：`lib/audit` 是统一写入口，`audit_logs` 有 append-only trigger，高风险操作要求原因。
- 通知：`lib/notify` 写 `notifications`，经营 Web 顶部铃铛读取未读数。
- 证据模型：`live_reports` 保留 `system_duration` / `screenshot_duration` / `claimed_duration` 三轨，`settlement_duration`、`time_source`、`evidence_level` 写入后由 trigger 冻结。
- 结算边界：P0 只立表；后续 P2 引擎只计算 CPT / 底薪，CPA / CPS / 礼物仅承载。

## 当前纵切片

经营 Web 的 `/console/projects` 已接入：

```text
创建项目草稿 -> RBAC 校验 -> RLS 写入 -> 审计 create
发布项目 -> owner/ops_manager 校验 -> draft -> recruiting 状态机 -> 审计 publish -> 通知 owner
```

`operator_business` 可以创建草稿，但发布按钮会被前端禁用；服务端仍会拒绝发布。

## P1 下一步

按 `经营舱-开发计划.md` 进入 P1 履约证据闭环：

```text
M1 项目完善 -> M2 主播池 -> M3 选播准入 -> M4 排班+系统计时
-> M5 报数+证据分级 -> 审核通过进可结算池
```

优先从 `features/projects/` 扩展 M1，再新增 `features/streamers/`、`features/applications/`、`features/live-tasks/`、`features/live-reports/`。
