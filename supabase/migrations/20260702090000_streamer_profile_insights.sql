create table if not exists public.streamer_profile_insights (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  streamer_id uuid not null references public.streamers(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  recording_asset_id uuid references public.recording_assets(id) on delete set null,
  recording_ai_analysis_id uuid references public.recording_ai_analyses(id) on delete set null,
  source_type text not null,
  source_ref text not null,
  title text not null,
  summary text not null default '',
  strengths text[] not null default '{}',
  risks text[] not null default '{}',
  recommendations text[] not null default '{}',
  dimensions jsonb not null default '[]'::jsonb,
  tags text[] not null default '{}',
  created_by uuid references public.profiles(id) on delete set null,
  confirmed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, source_type, source_ref),
  constraint streamer_profile_insights_source_type_check check (
    source_type in ('recording_ai_analysis')
  )
);

create index if not exists streamer_profile_insights_streamer_idx
on public.streamer_profile_insights (organization_id, streamer_id, confirmed_at desc);

create index if not exists streamer_profile_insights_recording_asset_idx
on public.streamer_profile_insights (recording_asset_id);

create index if not exists streamer_profile_insights_tags_idx
on public.streamer_profile_insights using gin (tags);

create trigger streamer_profile_insights_touch_updated_at
before update on public.streamer_profile_insights
for each row execute function public.touch_updated_at();

alter table public.streamer_profile_insights enable row level security;

create policy streamer_profile_insights_staff_access
on public.streamer_profile_insights
for all
using (public.is_org_member(organization_id) and public.is_mcn_staff(organization_id))
with check (public.is_org_member(organization_id) and public.is_mcn_staff(organization_id));
