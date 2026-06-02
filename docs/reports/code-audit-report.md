# 代码审计报告

日期：2026-06-02

## 结论

通过。P0-P5 后端能力按阶段落地，核心红线均有代码、迁移或测试约束覆盖。

## 安全

- RLS：所有 P0/P1/P5 新增业务表均在迁移中启用 RLS；P5 账单组织表均带 `organization_id` 与组织策略。
- 授权：经营侧 API 使用 `getAuthContext` + 角色判断；主播账单访问被 403 拦截；AI 工具继承 actor role。
- 密钥：未发现真实 `sk-*` 或硬编码服务密钥；命中项为 `.env.example` 占位、Supabase `env(...)` 配置和本地 smoke 测试密码。
- AI：只允许注册工具；拒绝 `sql.query` 等任意工具；主播诊断 DTO 递归过滤应收、毛利、成本、内部风险字段。

## 数据完整性

- P5 金额与用量使用整数：`amount_cents integer`、`quantity integer`、`included_quantity integer`。
- P4 报价与复盘以 cents / basis points 输出，除零时返回显式 fallback，不产生 NaN/Inf。
- P2 防重复结算仍由既有可结算池与批次回归覆盖。

## 审计与脱敏

- 自动审核 shadow/active、AI 查询、用量事件均写审计。
- 对外交付包、导出、主播结算、AI 主播 DTO 均有脱敏测试。
- 审计表无删除入口；高风险审计原因仍由统一审计服务约束。

## 状态机与边界

- P4 active 自动审核必须显式 active rule；默认不开启灰度放行。
- active 自动审核只调用报数审核入池，不计算金额，不生成结算项。
- 欠费/past_due 只读守卫允许 read、拒绝 write，不删除结算或审计数据。

## 验证证据

- `pnpm test`：60 files / 180 tests passed。
- `pnpm test:p5-commercialization`：6 files / 15 tests passed。
- `pnpm test:p4-flywheel`：12 files / 29 tests passed。
- `pnpm test:p3-governance`：9 files / 19 tests passed。
- `pnpm test:golden`：1 file / 1 test passed。
- `pnpm lint`：0 errors。
- `pnpm type-check`：pass。
- `pnpm build`：pass，包含 `/api/billing/status`。

## 遗留

- 未接真实支付、发票、税务、SSO、私有化部署；按 P5 v1 Scope Out 保留为扩展。
- `docs/manual-acceptance-test-cases.md` 当前仍是未跟踪文件，未纳入本次提交。
