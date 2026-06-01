# P1 Streamer Pool Checklist

## Scope In

- [x] 黑名单主播不可被邀约。
- [x] 主播档案允许无登录账号绑定。
- [x] 主播风险状态仅 owner / ops_manager 可改。
- [x] 风险状态变更必须填写原因并写高风险审计。

## Scope Out

- [ ] 多平台直播账号、供应商多对多、标签体系的完整 UI 留到后续切片。
- [ ] 主播画像聚合指标先继续使用原型展示数据，真实聚合查询后续接入。
- [ ] M10 智能匹配引擎不在本切片实现。

## Security Boundaries

- [x] `streamers` RLS 已在 P0 migration 中存在。
- [x] 风险字段通过服务层校验角色。
- [x] 高风险风险调整写审计日志。
- [x] 主播端敏感字段仍以后续 DTO / 安全视图接入，不由前端隐藏兜底。

## Verification

- [x] `pnpm test features/streamers/streamer-service.test.ts`
- [x] `pnpm lint`
- [x] `pnpm type-check`
- [x] `pnpm test`
- [x] `pnpm build`
- [ ] `pnpm supabase db reset` blocked locally by Docker Desktop startup failure.
- [ ] Golden path smoke test after主播池 UI 接入真实服务。
