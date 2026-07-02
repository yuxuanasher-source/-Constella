-- 性能索引：补齐经营台热路径查询缺失的组织维度索引。
-- 均为纯增量 create index if not exists，不改任何表结构与数据。

-- 任务队列：listOpsLiveTaskQueue 按 organization_id 过滤并按
-- planned_start_at 排序（现有索引只有 project_id/streamer_id 维度）。
create index if not exists live_tasks_org_planned_start_idx
  on public.live_tasks (organization_id, planned_start_at);

-- 报数队列：listOpsLiveReportQueue / 结算池查询按 organization_id + status
-- 过滤并按 created_at 排序。
create index if not exists live_reports_org_status_created_idx
  on public.live_reports (organization_id, status, created_at desc);

-- 结算批次列表：listOpsSettlementBatches 按 organization_id 过滤并按
-- updated_at desc 排序；settlement_batches 此前没有任何 organization_id 索引。
create index if not exists settlement_batches_org_updated_idx
  on public.settlement_batches (organization_id, updated_at desc);

-- 未读通知铃铛：getUnreadNotificationCount 的 or 分支按 recipient_role +
-- status 过滤（现有索引只覆盖 recipient_user_id + status）。
create index if not exists notifications_recipient_role_status_idx
  on public.notifications (recipient_role, status);
