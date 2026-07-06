-- 性能第一轮：查询减负配套索引。
-- 准入队列/看板按组织取报名并按提交时间倒序（listOpsApplicationQueue /
-- listAdmissionProjectBoards），此前只有 (project_id, status) 与
-- (streamer_id) 索引，组织维度全表扫。
--
-- 已核对无需重复创建的既有索引：
-- - recording_submissions (application_id, version desc)
--   —— 20260602013000_p1_admission_foundation.sql 的
--      recording_submissions_application_idx。
-- - recording_ai_analyses (asset_id, created_at desc)
--   —— 20260701100000_recording_ai_analysis.sql 的
--      recording_ai_analyses_asset_idx。

create index if not exists project_applications_org_submitted_idx
on public.project_applications (organization_id, submitted_at desc);
