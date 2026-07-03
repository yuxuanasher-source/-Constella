-- 主播全生命周期数字化管理：档案扩展、生命周期履历、试播考核、出勤台账、调班替班、绩效快照与分层运营标签。

-- 1. 主播主档扩展：评级、生命周期阶段、合同期限、通用分成比例、运营分层。
alter table public.streamers
  add column if not exists rating text not null default 'unrated',
  add column if not exists lifecycle_stage text not null default 'recruited',
  add column if not exists lifecycle_stage_changed_at timestamptz,
  add column if not exists contract_start_date date,
  add column if not exists contract_end_date date,
  add column if not exists revenue_share_bps integer,
  add column if not exists operation_tier text not null default 'unassigned',
  add column if not exists operation_tags text[] not null default '{}';

alter table public.streamers
  add constraint streamers_rating_check check (
    rating in ('unrated', 's', 'a', 'b', 'c')
  ),
  add constraint streamers_lifecycle_stage_check check (
    lifecycle_stage in ('recruited', 'trial', 'training', 'regular', 'paused', 'eliminated')
  ),
  add constraint streamers_revenue_share_bps_check check (
    revenue_share_bps is null or (revenue_share_bps >= 0 and revenue_share_bps <= 10000)
  ),
  add constraint streamers_operation_tier_check check (
    operation_tier in ('unassigned', 'core', 'potential', 'regular', 'observation')
  ),
  add constraint streamers_contract_period_check check (
    contract_start_date is null
    or contract_end_date is null
    or contract_end_date >= contract_start_date
  );

create index if not exists streamers_lifecycle_stage_idx
on public.streamers (organization_id, lifecycle_stage);

create index if not exists streamers_operation_tier_idx
on public.streamers (organization_id, operation_tier);

-- 2. 生命周期履历事件（成长轨迹，append-only）。
create table public.streamer_lifecycle_events (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  streamer_id uuid not null references public.streamers(id) on delete cascade,
  event_type text not null,
  from_value text,
  to_value text,
  reason text,
  detail jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint streamer_lifecycle_events_type_check check (
    event_type in (
      'stage_change',
      'rating_change',
      'tier_change',
      'contract_change',
      'assessment_concluded',
      'shift_change_applied'
    )
  )
);

create index streamer_lifecycle_events_streamer_idx
on public.streamer_lifecycle_events (organization_id, streamer_id, created_at desc);

alter table public.streamer_lifecycle_events enable row level security;

create policy streamer_lifecycle_events_staff_read
on public.streamer_lifecycle_events
for select
using (public.is_org_member(organization_id) and public.is_mcn_staff(organization_id));

create policy streamer_lifecycle_events_staff_insert
on public.streamer_lifecycle_events
for insert
with check (public.is_org_member(organization_id) and public.is_mcn_staff(organization_id));

create policy streamer_lifecycle_events_streamer_read_own
on public.streamer_lifecycle_events
for select
using (streamer_id = public.current_streamer_id(organization_id));

-- 3. 试播与考核管理：试播 / 培训 / 转正 / 定期考核记录。
create table public.streamer_assessments (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  streamer_id uuid not null references public.streamers(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  live_task_id uuid references public.live_tasks(id) on delete set null,
  assessment_type text not null,
  title text not null,
  status text not null default 'pending',
  score integer,
  conclusion text not null default '',
  evaluator_id uuid references public.profiles(id) on delete set null,
  scheduled_at timestamptz,
  concluded_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint streamer_assessments_type_check check (
    assessment_type in ('trial', 'training', 'probation', 'periodic')
  ),
  constraint streamer_assessments_status_check check (
    status in ('pending', 'passed', 'failed')
  ),
  constraint streamer_assessments_score_check check (
    score is null or (score >= 0 and score <= 100)
  )
);

create index streamer_assessments_streamer_idx
on public.streamer_assessments (organization_id, streamer_id, created_at desc);

create index streamer_assessments_status_idx
on public.streamer_assessments (organization_id, status);

create trigger streamer_assessments_touch_updated_at
before update on public.streamer_assessments
for each row execute function public.touch_updated_at();

alter table public.streamer_assessments enable row level security;

create policy streamer_assessments_staff_access
on public.streamer_assessments
for all
using (public.is_org_member(organization_id) and public.is_mcn_staff(organization_id))
with check (public.is_org_member(organization_id) and public.is_mcn_staff(organization_id));

create policy streamer_assessments_streamer_read_own
on public.streamer_assessments
for select
using (streamer_id = public.current_streamer_id(organization_id));

-- 4. 出勤台账：由排班任务的系统计时自动生成，支持人工修正。
create table public.streamer_attendance_records (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  streamer_id uuid not null references public.streamers(id) on delete cascade,
  live_task_id uuid not null references public.live_tasks(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  attendance_status text not null,
  planned_start_at timestamptz,
  planned_end_at timestamptz,
  actual_start_at timestamptz,
  actual_stop_at timestamptz,
  late_minutes integer not null default 0,
  live_minutes integer not null default 0,
  source text not null default 'auto',
  note text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, live_task_id),
  constraint streamer_attendance_records_status_check check (
    attendance_status in ('on_time', 'late', 'absent', 'leave')
  ),
  constraint streamer_attendance_records_source_check check (
    source in ('auto', 'manual')
  ),
  constraint streamer_attendance_records_late_minutes_check check (late_minutes >= 0),
  constraint streamer_attendance_records_live_minutes_check check (live_minutes >= 0)
);

create index streamer_attendance_records_streamer_idx
on public.streamer_attendance_records (organization_id, streamer_id, created_at desc);

create index streamer_attendance_records_status_idx
on public.streamer_attendance_records (organization_id, attendance_status);

create trigger streamer_attendance_records_touch_updated_at
before update on public.streamer_attendance_records
for each row execute function public.touch_updated_at();

alter table public.streamer_attendance_records enable row level security;

create policy streamer_attendance_records_staff_access
on public.streamer_attendance_records
for all
using (public.is_org_member(organization_id) and public.is_mcn_staff(organization_id))
with check (public.is_org_member(organization_id) and public.is_mcn_staff(organization_id));

create policy streamer_attendance_records_streamer_read_own
on public.streamer_attendance_records
for select
using (streamer_id = public.current_streamer_id(organization_id));

-- 5. 调班 / 替班申请：主播可对自己的待开播任务发起申请，运营审批后生效。
create table public.shift_change_requests (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  live_task_id uuid not null references public.live_tasks(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  streamer_id uuid not null references public.streamers(id) on delete cascade,
  request_type text not null,
  proposed_start_at timestamptz,
  proposed_end_at timestamptz,
  substitute_streamer_id uuid references public.streamers(id) on delete set null,
  reason text not null,
  status text not null default 'pending',
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  review_note text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint shift_change_requests_type_check check (
    request_type in ('reschedule', 'substitute')
  ),
  constraint shift_change_requests_status_check check (
    status in ('pending', 'approved', 'rejected', 'cancelled')
  ),
  constraint shift_change_requests_proposed_window_check check (
    proposed_start_at is null
    or proposed_end_at is null
    or proposed_end_at > proposed_start_at
  )
);

create index shift_change_requests_streamer_idx
on public.shift_change_requests (organization_id, streamer_id, created_at desc);

create index shift_change_requests_status_idx
on public.shift_change_requests (organization_id, status, created_at desc);

create trigger shift_change_requests_touch_updated_at
before update on public.shift_change_requests
for each row execute function public.touch_updated_at();

alter table public.shift_change_requests enable row level security;

create policy shift_change_requests_staff_access
on public.shift_change_requests
for all
using (public.is_org_member(organization_id) and public.is_mcn_staff(organization_id))
with check (public.is_org_member(organization_id) and public.is_mcn_staff(organization_id));

create policy shift_change_requests_streamer_read_own
on public.shift_change_requests
for select
using (streamer_id = public.current_streamer_id(organization_id));

create policy shift_change_requests_streamer_insert_own
on public.shift_change_requests
for insert
with check (
  streamer_id = public.current_streamer_id(organization_id)
  and status = 'pending'
);

create policy shift_change_requests_streamer_cancel_own
on public.shift_change_requests
for update
using (
  streamer_id = public.current_streamer_id(organization_id)
  and status = 'pending'
)
with check (streamer_id = public.current_streamer_id(organization_id));

-- 6. 绩效快照：按统计窗口聚合开播率、场均流水、场均 ROI、互动与贡献流水。
create table public.streamer_performance_snapshots (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  streamer_id uuid not null references public.streamers(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  scheduled_sessions integer not null default 0,
  live_sessions integer not null default 0,
  completed_sessions integer not null default 0,
  broadcast_rate_bps integer not null default 0,
  total_live_minutes integer not null default 0,
  total_revenue_amount numeric(12, 2) not null default 0,
  avg_session_revenue_amount numeric(12, 2) not null default 0,
  avg_session_roi_bps integer,
  total_viewers integer not null default 0,
  avg_session_viewers integer not null default 0,
  computed_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, streamer_id, period_start, period_end),
  constraint streamer_performance_snapshots_period_check check (period_end >= period_start),
  constraint streamer_performance_snapshots_broadcast_rate_check check (
    broadcast_rate_bps >= 0 and broadcast_rate_bps <= 10000
  ),
  constraint streamer_performance_snapshots_sessions_check check (
    scheduled_sessions >= 0 and live_sessions >= 0 and completed_sessions >= 0
  ),
  constraint streamer_performance_snapshots_amounts_check check (
    total_revenue_amount >= 0 and avg_session_revenue_amount >= 0
  )
);

create index streamer_performance_snapshots_streamer_idx
on public.streamer_performance_snapshots (organization_id, streamer_id, period_end desc);

create trigger streamer_performance_snapshots_touch_updated_at
before update on public.streamer_performance_snapshots
for each row execute function public.touch_updated_at();

alter table public.streamer_performance_snapshots enable row level security;

-- 绩效快照含流水口径，仅经营端员工可见，不向主播端开放。
create policy streamer_performance_snapshots_staff_access
on public.streamer_performance_snapshots
for all
using (public.is_org_member(organization_id) and public.is_mcn_staff(organization_id))
with check (public.is_org_member(organization_id) and public.is_mcn_staff(organization_id));
