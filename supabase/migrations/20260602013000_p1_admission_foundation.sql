create type public.project_streamer_status as enum (
  'candidate',
  'screening',
  'approved',
  'rejected',
  'joined',
  'removed'
);

create type public.project_application_source as enum (
  'signup',
  'direct_invite'
);

create type public.project_application_status as enum (
  'submitted',
  'invited',
  'recording_required',
  'recording_reviewing',
  'recording_approved',
  'recording_rejected',
  'confirmed',
  'declined',
  'joined',
  'withdrawn'
);

create type public.recording_review_status as enum (
  'submitted',
  'reviewing',
  'approved',
  'rejected',
  'needs_changes'
);

create table public.streamer_accounts (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  streamer_id uuid not null references public.streamers(id) on delete cascade,
  platform text not null,
  account_handle text not null,
  account_url text,
  follower_count integer,
  is_primary boolean not null default false,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, platform, account_handle),
  constraint streamer_accounts_follower_count_nonnegative check (
    follower_count is null or follower_count >= 0
  )
);

create table public.streamer_suppliers (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  streamer_id uuid not null references public.streamers(id) on delete cascade,
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  relation_type text not null default 'cooperation',
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (streamer_id, supplier_id)
);

create table public.project_streamers (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  streamer_id uuid not null references public.streamers(id) on delete restrict,
  status public.project_streamer_status not null default 'candidate',
  joined_at timestamptz,
  removed_at timestamptz,
  decision_reason text,
  settlement_method public.settlement_method,
  hourly_rate numeric(12, 2),
  base_salary numeric(12, 2),
  settlement_rule jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, streamer_id),
  constraint project_streamers_hourly_rate_nonnegative check (
    hourly_rate is null or hourly_rate >= 0
  ),
  constraint project_streamers_base_salary_nonnegative check (
    base_salary is null or base_salary >= 0
  ),
  constraint project_streamers_joined_timestamp check (
    status <> 'joined' or joined_at is not null
  )
);

create table public.project_applications (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  streamer_id uuid not null references public.streamers(id) on delete restrict,
  source public.project_application_source not null,
  status public.project_application_status not null default 'submitted',
  invited_by uuid references public.profiles(id),
  submitted_at timestamptz not null default now(),
  decided_by uuid references public.profiles(id),
  decided_at timestamptz,
  decision_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, streamer_id, source)
);

create table public.recording_submissions (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  application_id uuid not null references public.project_applications(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  streamer_id uuid not null references public.streamers(id) on delete restrict,
  version integer not null default 1,
  storage_path text,
  external_url text,
  file_hash text,
  duration_seconds integer,
  status public.recording_review_status not null default 'submitted',
  submitted_at timestamptz not null default now(),
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (application_id, version),
  constraint recording_submissions_has_file check (
    storage_path is not null or external_url is not null
  ),
  constraint recording_submissions_duration_nonnegative check (
    duration_seconds is null or duration_seconds >= 0
  )
);

create index streamer_accounts_streamer_idx
on public.streamer_accounts (streamer_id);

create index streamer_suppliers_supplier_idx
on public.streamer_suppliers (supplier_id);

create index project_streamers_project_status_idx
on public.project_streamers (project_id, status);

create index project_streamers_streamer_idx
on public.project_streamers (streamer_id);

create index project_applications_project_status_idx
on public.project_applications (project_id, status);

create index project_applications_streamer_idx
on public.project_applications (streamer_id);

create index recording_submissions_application_idx
on public.recording_submissions (application_id, version desc);

create trigger streamer_accounts_touch_updated_at
before update on public.streamer_accounts
for each row execute function public.touch_updated_at();

create trigger streamer_suppliers_touch_updated_at
before update on public.streamer_suppliers
for each row execute function public.touch_updated_at();

create trigger project_streamers_touch_updated_at
before update on public.project_streamers
for each row execute function public.touch_updated_at();

create trigger project_applications_touch_updated_at
before update on public.project_applications
for each row execute function public.touch_updated_at();

create trigger recording_submissions_touch_updated_at
before update on public.recording_submissions
for each row execute function public.touch_updated_at();

alter table public.streamer_accounts enable row level security;
alter table public.streamer_suppliers enable row level security;
alter table public.project_streamers enable row level security;
alter table public.project_applications enable row level security;
alter table public.recording_submissions enable row level security;

create policy streamer_accounts_staff_access
on public.streamer_accounts
for all
using (public.is_org_member(organization_id) and public.is_mcn_staff(organization_id))
with check (public.is_org_member(organization_id) and public.is_mcn_staff(organization_id));

create policy streamer_accounts_streamer_read_own
on public.streamer_accounts
for select
using (streamer_id = public.current_streamer_id(organization_id));

create policy streamer_suppliers_staff_access
on public.streamer_suppliers
for all
using (public.is_org_member(organization_id) and public.is_mcn_staff(organization_id))
with check (public.is_org_member(organization_id) and public.is_mcn_staff(organization_id));

create policy project_streamers_staff_project_access
on public.project_streamers
for all
using (public.is_org_member(organization_id) and public.can_access_project(project_id))
with check (public.is_org_member(organization_id) and public.can_access_project(project_id));

create policy project_streamers_streamer_read_own
on public.project_streamers
for select
using (streamer_id = public.current_streamer_id(organization_id));

create policy project_applications_staff_project_access
on public.project_applications
for all
using (public.is_org_member(organization_id) and public.can_access_project(project_id))
with check (public.is_org_member(organization_id) and public.can_access_project(project_id));

create policy project_applications_streamer_read_own
on public.project_applications
for select
using (streamer_id = public.current_streamer_id(organization_id));

create policy project_applications_streamer_insert_own
on public.project_applications
for insert
with check (
  streamer_id = public.current_streamer_id(organization_id)
  and source = 'signup'
);

create policy recording_submissions_staff_project_access
on public.recording_submissions
for all
using (public.is_org_member(organization_id) and public.can_access_project(project_id))
with check (public.is_org_member(organization_id) and public.can_access_project(project_id));

create policy recording_submissions_streamer_read_own
on public.recording_submissions
for select
using (streamer_id = public.current_streamer_id(organization_id));

create policy recording_submissions_streamer_insert_own
on public.recording_submissions
for insert
with check (streamer_id = public.current_streamer_id(organization_id));
