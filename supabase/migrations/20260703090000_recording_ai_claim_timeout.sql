-- 录屏 AI 分析：记录 runner 认领时间，支持超时回收。
-- claimed_at 在 queued -> running 认领（含超时回收再认领）时写入；runner 在
-- running 中途崩溃时，认领查询会把 claimed_at 超过阈值（默认 15 分钟）且
-- attempt 未耗尽的 running 行视为可重新认领，避免任务永久卡死。
alter table public.recording_ai_analyses
  add column if not exists claimed_at timestamptz;

-- 历史 running 行没有 claimed_at，用 updated_at 兜底（认领是该行最后一次
-- 更新），使已经卡死的行在超时后同样可以被回收。
update public.recording_ai_analyses
set claimed_at = updated_at
where status = 'running' and claimed_at is null;
