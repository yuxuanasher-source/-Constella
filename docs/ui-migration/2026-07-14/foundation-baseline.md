# 经营舱 UI 迁移基础阶段记录

日期：2026-07-14

## 本阶段范围

- 导入静态视觉基准到 `public/arco-redesign/`。
- 保存迁移包核心文档与 prompts 到 `docs/ui-migration/2026-07-14/`。
- 新增 `NEXT_PUBLIC_OPS_UI_V2` 功能开关，默认关闭。
- 新增 `components/ops-shell/` 服务端壳层与 `components/ops-ui/` 第一批无业务语义控件。
- 新增 Playwright 视觉 smoke 框架与 6 个验收视口配置。

## 不在本阶段

- 不迁移业务页面。
- 不改 `features/**`、`app/api/**`、Supabase、RBAC、DTO、结算或审计合同。
- 不把静态 HTML、CDN 脚本或模拟数据引入生产组件。
- 不提交像素回归二进制基线；本阶段仅生成 smoke 截图 artifact。

## 开关

```text
NEXT_PUBLIC_OPS_UI_V2=true
```

打开后 `/console` 使用 v2 壳层预览；未设置或设为 `false` 时继续使用旧 `OpsReferenceApp`。

## 验证命令

```bash
pnpm vitest run features/ui-route-contracts/ops-ui-v2-flag.test.ts
pnpm vitest run app/(ops)/console/page.test.tsx
pnpm vitest run components/ops-ui/ops-ui-primitives.test.tsx
pnpm test:ui-smoke
pnpm exec playwright test --list
```

完整收口阶段继续运行：

```bash
pnpm lint
pnpm type-check
pnpm test
pnpm build
```
