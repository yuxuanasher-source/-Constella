# P1 Project Management Checklist

## Scope In

- [x] M1 项目状态机补齐 `recruiting -> active`、`ended -> settling` 与非法 `active -> settling` 校验。
- [x] 项目普通字段更新走服务层并写普通审计。
- [x] 项目默认结算规则更新要求 owner / ops_manager 权限。
- [x] 项目默认结算规则更新必须填写原因并写高风险审计。
- [x] Supabase repository 支持项目基础字段和结算字段更新。

## Scope Out

- [ ] 项目详情真实编辑表单仍需嵌入已迁移的设计稿页面。
- [ ] 供应商 / 厂商 / 产品层级完整主数据留到 P1 后续切片。
- [ ] P2 结算引擎不在本切片计算金额。

## Security Boundaries

- [x] 项目表 RLS 已在 P0 migration 中存在。
- [x] 服务动作检查角色权限。
- [x] 结算字段变更通过高风险审计保留原因。
- [x] 前端视觉迁移不作为安全边界，后续真实表单仍调用服务层。

## Verification

- [x] `pnpm test features/projects/project-service.test.ts features/projects/project-state.test.ts`
- [x] `pnpm lint`
- [x] `pnpm type-check`
- [x] `pnpm test`
- [x] `pnpm build`
- [x] `pnpm supabase db reset` passed locally with `DOCKER_CONTEXT=default`.
- [ ] Golden path smoke test after UI form wiring.
