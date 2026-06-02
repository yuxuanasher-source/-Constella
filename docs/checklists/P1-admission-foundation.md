# P1 Admission Foundation Checklist

## Scope In

- [x] 主播平台账号表 `streamer_accounts`。
- [x] 主播与供应商多对多表 `streamer_suppliers`。
- [x] 项目主播关系表 `project_streamers`，包含加入状态与单主播结算规则快照。
- [x] 报名 / 定向邀约表 `project_applications`。
- [x] 录屏提交表 `recording_submissions`，支持版本化和私有文件路径 / 外链双轨。
- [x] 新增 P1 表全部开启 RLS。

## Scope Out

- [ ] 报名审核服务动作留到下一切片。
- [ ] 录屏文件上传组件和签名 URL 留到 UI 接入切片。
- [ ] 厂家候选表导出最小版留到 M3 服务切片。

## Security Boundaries

- [x] 所有新业务表带 `organization_id`。
- [x] MCN 员工访问走 `public.is_org_member` + `public.can_access_project`。
- [x] 主播访问走 `public.current_streamer_id()`。
- [x] 报名和录屏提交允许主播仅写自己的数据。

## Verification

- [x] `pnpm test lib/db/p1-schema-contract.test.ts`
- [x] `pnpm lint`
- [x] `pnpm type-check`
- [x] `pnpm test`
- [x] `pnpm build`
- [x] `pnpm supabase db reset` passed locally with `DOCKER_CONTEXT=default`.
