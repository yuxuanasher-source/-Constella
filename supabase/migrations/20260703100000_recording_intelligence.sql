-- 录屏智能分析：结构化质量指标、话术洞察、违规告警、主播能力报告与组织自学习校准。
-- 边界：所有 AI 结论仅作为审核辅助，人工确认后才进入画像/准入/结算等业务判断。

create table if not exists public.recording_quality_metrics (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  asset_id uuid not null references public.recording_assets(id) on delete cascade,
  duration_seconds integer not null default 0,
  effective_seconds integer not null default 0,
  idle_seconds integer not null default 0,
  game_screen_ratio_bps integer not null default 0,
  face_visible_ratio_bps integer not null default 0,
  effective_ratio_bps integer not null default 0,
  effectiveness_verdict text not null default 'below_standard',
  compliance_verdict text not null default 'needs_review',
  findings jsonb not null default '[]'::jsonb,
  signal_source text not null default 'derived',
  calibration_version integer not null default 0,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  constraint recording_quality_metrics_durations check (
    duration_seconds >= 0
    and effective_seconds >= 0
    and idle_seconds >= 0
    and effective_seconds <= duration_seconds
    and idle_seconds <= duration_seconds
  ),
  constraint recording_quality_metrics_ratios check (
    game_screen_ratio_bps between 0 and 10000
    and face_visible_ratio_bps between 0 and 10000
    and effective_ratio_bps between 0 and 10000
  ),
  constraint recording_quality_metrics_effectiveness check (
    effectiveness_verdict in ('effective', 'below_standard', 'invalid')
  ),
  constraint recording_quality_metrics_compliance check (
    compliance_verdict in ('pass', 'needs_review', 'violation')
  ),
  constraint recording_quality_metrics_signal_source check (
    signal_source in ('derived', 'uploaded')
  )
);

create table if not exists public.recording_script_insights (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  asset_id uuid not null references public.recording_assets(id) on delete cascade,
  total_lines integer not null default 0,
  category_stats jsonb not null default '[]'::jsonb,
  benchmark jsonb not null default '{}'::jsonb,
  benchmark_gaps jsonb not null default '[]'::jsonb,
  suggestions jsonb not null default '[]'::jsonb,
  transcript_source text not null default 'none',
  calibration_version integer not null default 0,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  constraint recording_script_insights_lines_nonnegative check (total_lines >= 0),
  constraint recording_script_insights_transcript_source check (
    transcript_source in ('none', 'uploaded')
  )
);

create table if not exists public.recording_risk_alerts (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  asset_id uuid not null references public.recording_assets(id) on delete cascade,
  category text not null,
  severity text not null default 'medium',
  term text not null,
  at_seconds integer not null default 0,
  message text not null,
  evidence jsonb not null default '{}'::jsonb,
  status text not null default 'open',
  acknowledged_by uuid references public.profiles(id),
  acknowledged_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint recording_risk_alerts_category check (
    category in ('sensitive_word', 'banned_content', 'violation_operation')
  ),
  constraint recording_risk_alerts_severity check (severity in ('medium', 'high')),
  constraint recording_risk_alerts_status check (
    status in ('open', 'acknowledged', 'resolved')
  ),
  constraint recording_risk_alerts_at_seconds_nonnegative check (at_seconds >= 0)
);

create table if not exists public.streamer_capability_reports (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  streamer_id uuid not null references public.streamers(id) on delete cascade,
  asset_id uuid not null references public.recording_assets(id) on delete cascade,
  dimensions jsonb not null default '[]'::jsonb,
  overall_score integer not null default 0,
  grade text not null default 'C',
  growth_advice jsonb not null default '[]'::jsonb,
  history_stats jsonb not null default '{}'::jsonb,
  calibration_version integer not null default 0,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  constraint streamer_capability_reports_score_range check (
    overall_score between 0 and 100
  ),
  constraint streamer_capability_reports_grade check (grade in ('S', 'A', 'B', 'C'))
);

create table if not exists public.recording_intelligence_calibrations (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  version integer not null,
  source text not null default 'learned',
  sample_counts jsonb not null default '{}'::jsonb,
  upload_rate_bps integer not null default 0,
  go_live_rate_bps integer not null default 0,
  live_test_pass_rate_bps integer not null default 0,
  quality_thresholds jsonb not null default '{}'::jsonb,
  script_benchmark jsonb not null default '{}'::jsonb,
  capability_weights jsonb not null default '{}'::jsonb,
  bottlenecks jsonb not null default '[]'::jsonb,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (organization_id, version),
  constraint recording_intelligence_calibrations_version_positive check (version > 0),
  constraint recording_intelligence_calibrations_source check (
    source in ('default', 'learned')
  ),
  constraint recording_intelligence_calibrations_rates check (
    upload_rate_bps between 0 and 10000
    and go_live_rate_bps between 0 and 10000
    and live_test_pass_rate_bps between 0 and 10000
  )
);

create index if not exists recording_quality_metrics_asset_idx
on public.recording_quality_metrics (asset_id, created_at desc);

create index if not exists recording_quality_metrics_org_idx
on public.recording_quality_metrics (organization_id, created_at desc);

create index if not exists recording_script_insights_asset_idx
on public.recording_script_insights (asset_id, created_at desc);

create index if not exists recording_risk_alerts_asset_idx
on public.recording_risk_alerts (asset_id, created_at desc);

create index if not exists recording_risk_alerts_org_status_idx
on public.recording_risk_alerts (organization_id, status, created_at desc);

create index if not exists streamer_capability_reports_streamer_idx
on public.streamer_capability_reports (streamer_id, created_at desc);

create index if not exists streamer_capability_reports_asset_idx
on public.streamer_capability_reports (asset_id, created_at desc);

create index if not exists recording_intelligence_calibrations_org_version_idx
on public.recording_intelligence_calibrations (organization_id, version desc);

create trigger recording_risk_alerts_touch_updated_at
before update on public.recording_risk_alerts
for each row execute function public.touch_updated_at();

alter table public.recording_quality_metrics enable row level security;
alter table public.recording_script_insights enable row level security;
alter table public.recording_risk_alerts enable row level security;
alter table public.streamer_capability_reports enable row level security;
alter table public.recording_intelligence_calibrations enable row level security;

create policy recording_quality_metrics_staff_access
on public.recording_quality_metrics
for all
using (public.is_org_member(organization_id) and public.is_mcn_staff(organization_id))
with check (public.is_org_member(organization_id) and public.is_mcn_staff(organization_id));

create policy recording_quality_metrics_streamer_read_own
on public.recording_quality_metrics
for select
using (
  exists (
    select 1
    from public.recording_assets ra
    where ra.id = recording_quality_metrics.asset_id
      and ra.streamer_id = public.current_streamer_id(recording_quality_metrics.organization_id)
  )
);

create policy recording_script_insights_staff_access
on public.recording_script_insights
for all
using (public.is_org_member(organization_id) and public.is_mcn_staff(organization_id))
with check (public.is_org_member(organization_id) and public.is_mcn_staff(organization_id));

create policy recording_script_insights_streamer_read_own
on public.recording_script_insights
for select
using (
  exists (
    select 1
    from public.recording_assets ra
    where ra.id = recording_script_insights.asset_id
      and ra.streamer_id = public.current_streamer_id(recording_script_insights.organization_id)
  )
);

-- 风险告警包含敏感词证据，仅 MCN 员工可见，不向主播端开放。
create policy recording_risk_alerts_staff_access
on public.recording_risk_alerts
for all
using (public.is_org_member(organization_id) and public.is_mcn_staff(organization_id))
with check (public.is_org_member(organization_id) and public.is_mcn_staff(organization_id));

create policy streamer_capability_reports_staff_access
on public.streamer_capability_reports
for all
using (public.is_org_member(organization_id) and public.is_mcn_staff(organization_id))
with check (public.is_org_member(organization_id) and public.is_mcn_staff(organization_id));

create policy streamer_capability_reports_streamer_read_own
on public.streamer_capability_reports
for select
using (
  streamer_id = public.current_streamer_id(streamer_capability_reports.organization_id)
);

create policy recording_intelligence_calibrations_staff_access
on public.recording_intelligence_calibrations
for all
using (public.is_org_member(organization_id) and public.is_mcn_staff(organization_id))
with check (public.is_org_member(organization_id) and public.is_mcn_staff(organization_id));
