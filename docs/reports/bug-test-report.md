# BUG 测试报告

日期：2026-06-02

## 结论

通过。已覆盖已知高发边界，未发现阻断级问题。

## 边界用例结果

- 评论率 / 利润率 / 平均小时利润除零：P4 报价、复盘与 P5 用量均返回显式 0/null fallback，不产生 NaN/Inf。
- 跨日直播切分拆账：现阶段结算仍按冻结报数 `settlement_duration` 入池，跨日细分未扩展为新规则，未改变既有行为。
- 改单价后历史已结算记录：P2 批次项使用结算时快照和锁定状态；本次 P4/P5 未引入历史重算。
- 审核退回后重新提交：P1/M5 既有回归保留，旧证据通过报数状态机与 change log 追踪。
- 并发审核 / 重复提交报数：当前服务层有状态前置校验；重复结算由 P2 可结算池回归覆盖。
- 重复结算防护：`pnpm test:golden` 验证入批后可结算池清空，同一报数不会重复进入同批流程。
- 导出 CSV 字段名：P3 导出白名单测试通过；对外交付包不含成本/毛利字段。
- 跨组织越权：服务层 `assertSameOrganization`、RLS 策略与 API 授权测试覆盖；主播账单 API 403。

## 验证命令

- `pnpm test`：60 files / 180 tests passed。
- `pnpm test:p5-commercialization`：6 files / 15 tests passed。
- `pnpm test:p4-flywheel`：12 files / 29 tests passed。
- `pnpm test:p3-governance`：9 files / 19 tests passed。
- `pnpm test:golden`：1 file / 1 test passed。
- `pnpm lint`：0 errors。
- `pnpm type-check`：pass。
- `pnpm build`：pass。
