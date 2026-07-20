-- Recording production feedback loop:
-- project task card + streamer self-check + key moments.
-- These fields are advisory evidence only and do not change admission state.

create table if not exists public.project_recording_guides (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  game_name text not null default '',
  game_version text not null default '',
  server_region text not null default '',
  promotion_goal text not null default '',
  target_audience text not null default '',
  required_content jsonb not null default '[]'::jsonb,
  required_talking_points jsonb not null default '[]'::jsonb,
  forbidden_content jsonb not null default '[]'::jsonb,
  commercial_actions jsonb not null default '[]'::jsonb,
  technical_standard jsonb not null default '{}'::jsonb,
  template_text text not null default '',
  example_url text,
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, project_id),
  constraint project_recording_guides_example_url_http check (
    example_url is null or example_url ~* '^https?://'
  ),
  constraint project_recording_guides_required_content_array check (
    jsonb_typeof(required_content) = 'array'
  ),
  constraint project_recording_guides_required_talking_points_array check (
    jsonb_typeof(required_talking_points) = 'array'
  ),
  constraint project_recording_guides_forbidden_content_array check (
    jsonb_typeof(forbidden_content) = 'array'
  ),
  constraint project_recording_guides_commercial_actions_array check (
    jsonb_typeof(commercial_actions) = 'array'
  ),
  constraint project_recording_guides_technical_standard_object check (
    jsonb_typeof(technical_standard) = 'object'
  )
);

alter table public.recording_submissions
  add column if not exists task_card_read_confirmed_at timestamptz,
  add column if not exists self_check jsonb not null default '{}'::jsonb,
  add column if not exists key_moments jsonb not null default '[]'::jsonb,
  add column if not exists self_score_total integer,
  add column if not exists self_assessment_level text,
  add column if not exists submitter_note text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'recording_submissions_self_score_range'
  ) then
    alter table public.recording_submissions
      add constraint recording_submissions_self_score_range
      check (self_score_total is null or self_score_total between 0 and 100);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'recording_submissions_self_assessment_level'
  ) then
    alter table public.recording_submissions
      add constraint recording_submissions_self_assessment_level
      check (
        self_assessment_level is null
        or self_assessment_level in ('L0', 'L1', 'L2', 'L3', 'L4')
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'recording_submissions_self_check_object'
  ) then
    alter table public.recording_submissions
      add constraint recording_submissions_self_check_object
      check (jsonb_typeof(self_check) = 'object');
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'recording_submissions_key_moments_array'
  ) then
    alter table public.recording_submissions
      add constraint recording_submissions_key_moments_array
      check (jsonb_typeof(key_moments) = 'array');
  end if;
end $$;

create index if not exists project_recording_guides_project_idx
on public.project_recording_guides (project_id);

create index if not exists recording_submissions_self_level_idx
on public.recording_submissions (organization_id, self_assessment_level, submitted_at desc);

create trigger project_recording_guides_touch_updated_at
before update on public.project_recording_guides
for each row execute function public.touch_updated_at();

alter table public.project_recording_guides enable row level security;

create policy project_recording_guides_staff_access
on public.project_recording_guides
for all
using (public.is_org_member(organization_id) and public.is_mcn_staff(organization_id))
with check (public.is_org_member(organization_id) and public.is_mcn_staff(organization_id));

create policy project_recording_guides_streamer_read_visible
on public.project_recording_guides
for select
using (
  exists (
    select 1
    from public.projects p
    where p.id = project_recording_guides.project_id
      and p.organization_id = project_recording_guides.organization_id
      and p.open_signup = true
      and p.is_public_to_streamers = true
      and p.status in ('recruiting', 'pending_start', 'active', 'paused')
  )
  and public.current_streamer_id(organization_id) is not null
);
