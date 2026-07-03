# 主播全生命周期管理 Checklist

覆盖"招募 -> 试播 -> 培训 -> 转正 -> 暂停/淘汰"的主播全生命周期数字化管理纵切片。

## Scope In

- [x] 主播档案扩展：S/A/B/C 评级、生命周期阶段、合同起止、通用分成比例（`streamers` 新增列）。
- [x] 生命周期履历：`streamer_lifecycle_events` append-only 事件表，留存阶段/评级/分层/合同/考核/调班轨迹。
- [x] 试播与考核：`streamer_assessments`（试播/培训/转正/定期），转正评估通过后试播、培训期主播自动转正。
- [x] 出勤台账：`streamer_attendance_records` 由排班任务系统计时自动生成（准时/迟到/缺勤），支持人工修正（请假等）。
- [x] 调班/替班：`shift_change_requests` 申请-审批流，审批通过自动改写 `live_tasks` 排期或换绑主播。
- [x] 绩效快照：`streamer_performance_snapshots` 按窗口聚合开播率、场均流水、场均 ROI、场观、贡献流水。
- [x] 分层运营标签：基于最新绩效快照自动评定核心/潜力/常规/观察分层，落库标签并返回资源倾斜、培训计划、建议分成档位。
- [x] 经营端只读总览页 `/console/streamer-lifecycle`。

## Scope Out

- [ ] 合同附件与电子签流程（本切片只登记期限与分成）。
- [ ] 分层规则的组织级可配置化（当前为代码内规则常量）。
- [ ] 平台侧真实流水/互动数据接入（场均流水沿用"结算时长 × 项目时薪"口径，互动先以场观承载）。
- [ ] 绩效快照定时 runner（当前由经营端手动触发同步）。
- [ ] 主播端调班申请 UI（API 已支持 streamer 角色发起）。

## Security Boundaries

- [x] 全部新表带 `organization_id` 并启用 RLS，员工侧使用 `is_org_member` + `is_mcn_staff`。
- [x] 主播只能读自己的履历、考核、出勤、调班申请；绩效快照（含流水口径）仅员工可见。
- [x] 调班申请 insert/update 的 RLS 限定 `current_streamer_id`，且只允许 pending 状态被主播改写。
- [x] 服务层 RBAC：阶段/评级/合同/分层仅 owner、ops_manager；考核/出勤/调班审批/绩效同步开放到 operator_business；finance 只读。
- [x] 淘汰、合同变更为高风险审计并强制填写原因；转正评估结论仅 owner、ops_manager。
- [x] 写路由统一过 `assertBillingWriteAllowed`（project_management 闸门）。

## Verification

- [x] `pnpm vitest run lib/db/streamer-lifecycle-schema-contract.test.ts`
- [x] `pnpm vitest run features/streamer-lifecycle`
- [x] `pnpm vitest run app/api/streamer-lifecycle-route-contracts.test.ts`
- [x] `pnpm lint`
- [x] `pnpm type-check`
- [x] `pnpm test`
- [x] `pnpm build`
