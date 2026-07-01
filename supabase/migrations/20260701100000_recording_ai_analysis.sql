do $$
begin
  create type public.recording_ai_analysis_status as enum (
    'queued',
    'running',
    'succeeded',
    'failed'
  );
exception
  when duplicate_object then null;
end $$;

create table if not exists public.recording_ai_analyses (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  asset_id uuid not null references public.recording_assets(id) on delete cascade,
  status public.recording_ai_analysis_status not null default 'queued',
  provider_name text,
  summary text not null default '',
  scorecard jsonb not null default '{}'::jsonb,
  dimensions jsonb not null default '[]'::jsonb,
  risk_flags jsonb not null default '[]'::jsonb,
  recommendations jsonb not null default '[]'::jsonb,
  attempt integer not null default 0,
  max_attempts integer not null default 3,
  error_summary text,
  ai_invocation_id uuid references public.ai_invocations(id) on delete set null,
  requested_by uuid references public.profiles(id),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint recording_ai_analyses_attempt_nonnegative check (attempt >= 0),
  constraint recording_ai_analyses_max_attempts_positive check (max_attempts > 0)
);

create table if not exists public.recording_ai_segments (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  analysis_id uuid not null references public.recording_ai_analyses(id) on delete cascade,
  asset_id uuid not null references public.recording_assets(id) on delete cascade,
  segment_kind text not null,
  start_seconds integer not null default 0,
  end_seconds integer not null default 0,
  title text not null,
  summary text not null default '',
  risk_level text not null default 'low',
  evidence jsonb not null default '{}'::jsonb,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  constraint recording_ai_segments_time_nonnegative check (
    start_seconds >= 0 and end_seconds >= start_seconds
  ),
  constraint recording_ai_segments_risk_level check (
    risk_level in ('low', 'medium', 'high')
  )
);

create index if not exists recording_ai_analyses_asset_idx
on public.recording_ai_analyses (asset_id, created_at desc);

create index if not exists recording_ai_analyses_org_status_idx
on public.recording_ai_analyses (organization_id, status, created_at desc);

create unique index if not exists recording_ai_analyses_active_asset_uidx
on public.recording_ai_analyses (organization_id, asset_id)
where status in ('queued','running');

create index if not exists recording_ai_segments_analysis_idx
on public.recording_ai_segments (analysis_id, sort_order);

create trigger recording_ai_analyses_touch_updated_at
before update on public.recording_ai_analyses
for each row execute function public.touch_updated_at();

alter table public.recording_ai_analyses enable row level security;
alter table public.recording_ai_segments enable row level security;

create policy recording_ai_analyses_staff_access
on public.recording_ai_analyses
for all
using (public.is_org_member(organization_id) and public.is_mcn_staff(organization_id))
with check (public.is_org_member(organization_id) and public.is_mcn_staff(organization_id));

create policy recording_ai_analyses_streamer_read_own
on public.recording_ai_analyses
for select
using (
  exists (
    select 1
    from public.recording_assets ra
    where ra.id = recording_ai_analyses.asset_id
      and ra.streamer_id = public.current_streamer_id(recording_ai_analyses.organization_id)
  )
);

create policy recording_ai_segments_staff_access
on public.recording_ai_segments
for all
using (public.is_org_member(organization_id) and public.is_mcn_staff(organization_id))
with check (public.is_org_member(organization_id) and public.is_mcn_staff(organization_id));

create policy recording_ai_segments_streamer_read_own
on public.recording_ai_segments
for select
using (
  exists (
    select 1
    from public.recording_ai_analyses ria
    join public.recording_assets ra on ra.id = ria.asset_id
    where ria.id = recording_ai_segments.analysis_id
      and ra.streamer_id = public.current_streamer_id(recording_ai_segments.organization_id)
  )
);
