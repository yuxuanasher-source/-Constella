create table public.project_recording_share_boards (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  title text not null,
  token_hash text not null unique,
  access_code_hash text,
  status text not null default 'active',
  expires_at timestamptz not null,
  allow_vendor_submit boolean not null default true,
  visible_fields jsonb not null default '{}'::jsonb,
  created_by uuid not null references public.profiles(id),
  revoked_by uuid references public.profiles(id),
  revoked_at timestamptz,
  last_viewed_at timestamptz,
  last_submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint project_recording_share_boards_status_check check (
    status in ('active', 'expired', 'revoked')
  ),
  constraint project_recording_share_boards_expiry_check check (
    expires_at > created_at
  )
);

create table public.project_recording_share_items (
  id uuid primary key default extensions.gen_random_uuid(),
  share_board_id uuid not null references public.project_recording_share_boards(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  application_id uuid not null references public.project_applications(id) on delete cascade,
  recording_submission_id uuid not null references public.recording_submissions(id) on delete cascade,
  recording_version integer not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (share_board_id, recording_submission_id),
  constraint project_recording_share_items_version_positive check (
    recording_version > 0
  )
);

create table public.project_recording_vendor_reviews (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  share_board_id uuid not null references public.project_recording_share_boards(id) on delete cascade,
  application_id uuid not null references public.project_applications(id) on delete cascade,
  recording_submission_id uuid not null references public.recording_submissions(id) on delete cascade,
  recording_version integer not null,
  decision text not null default 'pending',
  remark text not null default '',
  vendor_reviewer_name text not null default '',
  vendor_reviewer_contact text not null default '',
  submitted_at timestamptz not null default now(),
  synced_application_status text,
  synced_recording_status text,
  sync_status text not null default 'synced',
  sync_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (share_board_id, recording_submission_id),
  constraint project_recording_vendor_reviews_decision_check check (
    decision in ('pending', 'selected', 'backup', 'rejected', 'needs_changes')
  ),
  constraint project_recording_vendor_reviews_sync_status_check check (
    sync_status in ('synced', 'skipped', 'failed')
  ),
  constraint project_recording_vendor_reviews_version_positive check (
    recording_version > 0
  )
);

create index project_recording_share_boards_project_status_idx
on public.project_recording_share_boards (organization_id, project_id, status);

create index project_recording_share_boards_token_hash_idx
on public.project_recording_share_boards (token_hash);

create index project_recording_share_boards_expires_at_idx
on public.project_recording_share_boards (expires_at);

create index project_recording_share_items_board_idx
on public.project_recording_share_items (share_board_id, sort_order);

create index project_recording_share_items_application_idx
on public.project_recording_share_items (application_id);

create index project_recording_vendor_reviews_project_idx
on public.project_recording_vendor_reviews (organization_id, project_id, decision);

create index project_recording_vendor_reviews_application_idx
on public.project_recording_vendor_reviews (application_id);

create trigger project_recording_share_boards_touch_updated_at
before update on public.project_recording_share_boards
for each row execute function public.touch_updated_at();

create trigger project_recording_vendor_reviews_touch_updated_at
before update on public.project_recording_vendor_reviews
for each row execute function public.touch_updated_at();

alter table public.project_recording_share_boards enable row level security;
alter table public.project_recording_share_items enable row level security;
alter table public.project_recording_vendor_reviews enable row level security;

create policy project_recording_share_boards_staff_project_access
on public.project_recording_share_boards
for all
using (
  public.is_org_member(organization_id)
  and public.can_access_project(project_id)
)
with check (
  public.is_org_member(organization_id)
  and public.can_access_project(project_id)
);

create policy project_recording_share_items_staff_project_access
on public.project_recording_share_items
for all
using (
  public.is_org_member(organization_id)
  and public.can_access_project(project_id)
)
with check (
  public.is_org_member(organization_id)
  and public.can_access_project(project_id)
);

create policy project_recording_vendor_reviews_staff_project_access
on public.project_recording_vendor_reviews
for all
using (
  public.is_org_member(organization_id)
  and public.can_access_project(project_id)
)
with check (
  public.is_org_member(organization_id)
  and public.can_access_project(project_id)
);
