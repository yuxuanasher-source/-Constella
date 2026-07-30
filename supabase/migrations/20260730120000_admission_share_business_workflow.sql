alter table public.recording_submissions
  add column mcn_review_decision public.recording_review_status,
  add column mcn_reviewed_by uuid references public.profiles(id),
  add column mcn_reviewed_at timestamptz,
  add column mcn_review_note text;

update public.recording_submissions
set
  mcn_review_decision = status,
  mcn_reviewed_by = reviewed_by,
  mcn_reviewed_at = reviewed_at,
  mcn_review_note = coalesce(review_note, '')
where status in ('approved', 'rejected', 'needs_changes')
  and reviewed_at is not null;

with shared_recordings as (
  select
    recording_submission_id,
    min(created_at) as first_shared_at
  from public.project_recording_share_items
  group by recording_submission_id
)
update public.recording_submissions as recording
set
  mcn_review_decision = 'approved',
  mcn_reviewed_by = recording.reviewed_by,
  mcn_reviewed_at = shared_recordings.first_shared_at,
  mcn_review_note = ''
from shared_recordings
where recording.id = shared_recordings.recording_submission_id;

alter table public.recording_submissions
  add constraint recording_submissions_mcn_review_decision_check
  check (
    mcn_review_decision is null
    or mcn_review_decision in ('approved', 'rejected', 'needs_changes')
  );

create or replace function public.guard_recording_mcn_review_fact()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if old.mcn_review_decision is not null
     and (
       new.mcn_review_decision is distinct from old.mcn_review_decision
       or new.mcn_reviewed_by is distinct from old.mcn_reviewed_by
       or new.mcn_reviewed_at is distinct from old.mcn_reviewed_at
       or new.mcn_review_note is distinct from old.mcn_review_note
     ) then
    raise exception 'recording_mcn_review_fact_is_immutable';
  end if;

  return new;
end;
$$;

create trigger recording_submissions_guard_mcn_review_fact
before update on public.recording_submissions
for each row execute function public.guard_recording_mcn_review_fact();

alter table public.project_recording_share_boards
  add column mode text,
  add column purpose text not null default '',
  add column review_state text not null default 'not_started',
  add column round_number integer not null default 1,
  add column allow_external_fallback boolean not null default true,
  add column last_draft_at timestamptz,
  add column locked_at timestamptz,
  add column current_submission_revision integer not null default 0,
  add column reopened_by uuid references public.profiles(id),
  add column reopened_at timestamptz,
  add column reopen_reason text;

update public.project_recording_share_boards
set
  mode = case
    when allow_vendor_submit then 'formal_review'
    else 'preview'
  end,
  review_state = case
    when last_submitted_at is not null then 'submitted_locked'
    when last_viewed_at is not null then 'viewed'
    else 'not_started'
  end,
  round_number = case
    when allow_vendor_submit then greatest(round_number, 1)
    else 0
  end,
  locked_at = last_submitted_at,
  current_submission_revision = case
    when last_submitted_at is not null
      then greatest(current_submission_revision, 1)
    else current_submission_revision
  end;

alter table public.project_recording_share_boards
  alter column mode set not null,
  add constraint project_recording_share_boards_mode_check
  check (mode in ('preview', 'formal_review')),
  add constraint project_recording_share_boards_review_state_check
  check (
    review_state in (
      'not_started',
      'viewed',
      'in_progress',
      'submitted_locked'
    )
  ),
  add constraint project_recording_share_boards_round_check
  check (
    (mode = 'preview' and round_number = 0)
    or (mode = 'formal_review' and round_number > 0)
  ),
  add constraint project_recording_share_boards_revision_nonnegative_check
  check (current_submission_revision >= 0);

create or replace function public.derive_recording_share_board_workflow()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.mode is null then
    new.mode := case
      when new.allow_vendor_submit then 'formal_review'
      else 'preview'
    end;
  else
    new.allow_vendor_submit := new.mode = 'formal_review';
  end if;

  new.round_number := case
    when new.mode = 'preview' then 0
    else greatest(coalesce(new.round_number, 1), 1)
  end;

  return new;
end;
$$;

create trigger project_recording_share_boards_derive_workflow
before insert on public.project_recording_share_boards
for each row
execute function public.derive_recording_share_board_workflow();

alter table public.project_recording_share_items
  add column mcn_review_decision public.recording_review_status,
  add column source_health text,
  add column allow_external_fallback boolean not null default true;

update public.project_recording_share_items as share_item
set
  mcn_review_decision = recording.mcn_review_decision,
  source_health = case
    when nullif(btrim(recording.storage_path), '') is not null
      and recording.external_url ~* '^https?://'
      then 'original_with_external_fallback'
    when nullif(btrim(recording.storage_path), '') is not null
      then 'original_ready'
    when recording.external_url ~* '^https?://' then 'external_only'
    else 'blocked'
  end
from public.recording_submissions as recording
where recording.id = share_item.recording_submission_id;

do $$
begin
  if exists (
    select 1
    from public.project_recording_share_items
    where mcn_review_decision is distinct from
      'approved'::public.recording_review_status
  ) then
    raise exception 'legacy_share_item_without_approved_mcn_review';
  end if;
end;
$$;

alter table public.project_recording_share_items
  alter column mcn_review_decision set not null,
  alter column source_health set not null,
  add constraint project_recording_share_items_mcn_approved_check
  check (mcn_review_decision = 'approved'),
  add constraint project_recording_share_items_source_health_check
  check (
    source_health in (
      'original_ready',
      'original_with_external_fallback',
      'external_only',
      'blocked'
    )
  );

create or replace function public.prepare_recording_share_item()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_board public.project_recording_share_boards%rowtype;
  v_recording public.recording_submissions%rowtype;
  v_application public.project_applications%rowtype;
  v_has_storage boolean;
  v_has_external boolean;
begin
  select *
  into v_board
  from public.project_recording_share_boards
  where id = new.share_board_id;

  if not found then
    raise exception 'recording_share_item_scope_mismatch';
  end if;

  select *
  into v_recording
  from public.recording_submissions
  where id = new.recording_submission_id;

  if not found then
    raise exception 'recording_share_item_scope_mismatch';
  end if;

  select *
  into v_application
  from public.project_applications
  where id = new.application_id;

  if not found
     or v_board.organization_id is distinct from new.organization_id
     or v_board.project_id is distinct from new.project_id
     or v_recording.project_id is distinct from new.project_id
     or v_recording.application_id is distinct from new.application_id
     or v_recording.version is distinct from new.recording_version
     or v_recording.organization_id is distinct from
       v_application.organization_id
     or v_application.project_id is distinct from new.project_id then
    raise exception 'recording_share_item_scope_mismatch';
  end if;

  if v_recording.mcn_review_decision is distinct from
     'approved'::public.recording_review_status then
    raise exception 'recording_share_item_recording_not_mcn_approved';
  end if;

  v_has_storage :=
    nullif(btrim(v_recording.storage_path), '') is not null;
  v_has_external :=
    coalesce(v_recording.external_url ~* '^https?://', false);

  new.mcn_review_decision := v_recording.mcn_review_decision;
  new.allow_external_fallback := v_board.allow_external_fallback;
  new.source_health := case
    when v_has_storage and v_has_external
      then 'original_with_external_fallback'
    when v_has_storage then 'original_ready'
    when v_has_external then 'external_only'
    else null
  end;

  if new.source_health is null then
    raise exception 'recording_share_item_source_unavailable';
  end if;

  return new;
end;
$$;

create trigger project_recording_share_items_prepare
before insert on public.project_recording_share_items
for each row
execute function public.prepare_recording_share_item();

create table public.project_recording_vendor_review_drafts (
  share_board_id uuid not null
    references public.project_recording_share_boards(id) on delete cascade,
  recording_submission_id uuid not null
    references public.recording_submissions(id) on delete cascade,
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  application_id uuid not null
    references public.project_applications(id) on delete cascade,
  recording_version integer not null,
  decision text not null default 'pending',
  remark text not null default '',
  reason_codes text[] not null default '{}'::text[],
  revision integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (share_board_id, recording_submission_id),
  constraint project_recording_vendor_review_drafts_decision_check
  check (
    decision in (
      'pending',
      'selected',
      'backup',
      'rejected',
      'needs_changes'
    )
  ),
  constraint project_recording_vendor_review_drafts_version_positive_check
  check (recording_version > 0),
  constraint project_recording_vendor_review_drafts_revision_nonnegative_check
  check (revision >= 0)
);

create table public.project_recording_vendor_review_submissions (
  id uuid primary key default extensions.gen_random_uuid(),
  share_board_id uuid not null
    references public.project_recording_share_boards(id) on delete cascade,
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  revision integer not null,
  project_remark text not null default '',
  selected_count integer not null default 0,
  backup_count integer not null default 0,
  rejected_count integer not null default 0,
  needs_changes_count integer not null default 0,
  submitted_at timestamptz not null default now(),
  unique (share_board_id, revision),
  constraint project_recording_vendor_review_submissions_revision_positive_check
  check (revision > 0),
  constraint project_recording_vendor_review_submissions_counts_nonnegative_check
  check (
    selected_count >= 0
    and backup_count >= 0
    and rejected_count >= 0
    and needs_changes_count >= 0
  )
);

create table public.project_recording_vendor_review_submission_items (
  id uuid primary key default extensions.gen_random_uuid(),
  submission_id uuid not null
    references public.project_recording_vendor_review_submissions(id)
    on delete cascade,
  share_board_id uuid not null
    references public.project_recording_share_boards(id) on delete cascade,
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  application_id uuid not null
    references public.project_applications(id) on delete cascade,
  recording_submission_id uuid not null
    references public.recording_submissions(id) on delete cascade,
  recording_version integer not null,
  decision text not null,
  remark text not null default '',
  reason_codes text[] not null default '{}'::text[],
  sync_status text not null default 'synced',
  sync_error text,
  created_at timestamptz not null default now(),
  unique (submission_id, recording_submission_id),
  constraint project_recording_vendor_review_submission_items_decision_check
  check (decision in ('selected', 'backup', 'rejected', 'needs_changes')),
  constraint project_recording_vendor_review_submission_items_version_positive_check
  check (recording_version > 0),
  constraint project_recording_vendor_review_submission_items_sync_status_check
  check (sync_status in ('synced', 'skipped'))
);

create table public.project_recording_share_events (
  id uuid primary key default extensions.gen_random_uuid(),
  share_board_id uuid not null
    references public.project_recording_share_boards(id) on delete cascade,
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  event_type text not null,
  actor_type text not null,
  actor_user_id uuid references public.profiles(id),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint project_recording_share_events_event_type_check
  check (
    event_type in (
      'created',
      'viewed',
      'draft_saved',
      'submitted',
      'extended',
      'reopened',
      'token_rotated',
      'revoked',
      'playback_issue_reported',
      'playback_issue_resolved'
    )
  ),
  constraint project_recording_share_events_actor_type_check
  check (actor_type in ('staff', 'public', 'system'))
);

create table public.project_recording_share_playback_issues (
  id uuid primary key default extensions.gen_random_uuid(),
  share_board_id uuid not null
    references public.project_recording_share_boards(id) on delete cascade,
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  recording_submission_id uuid not null
    references public.recording_submissions(id) on delete cascade,
  source_type text not null,
  error_code text not null,
  user_agent_family text not null default 'unknown',
  status text not null default 'open',
  reported_by uuid references public.profiles(id),
  reported_at timestamptz not null default now(),
  resolved_by uuid references public.profiles(id),
  resolved_at timestamptz,
  resolution_note text,
  constraint project_recording_share_playback_issues_source_check
  check (source_type in ('original', 'external', 'none')),
  constraint project_recording_share_playback_issues_user_agent_family_check
  check (char_length(user_agent_family) <= 80),
  constraint project_recording_share_playback_issues_status_check
  check (status in ('open', 'resolved'))
);

create index project_recording_vendor_review_drafts_project_updated_idx
on public.project_recording_vendor_review_drafts (project_id, updated_at desc);

create index project_recording_vendor_review_submissions_project_submitted_idx
on public.project_recording_vendor_review_submissions (
  project_id,
  submitted_at desc
);

create index project_recording_vendor_review_submission_items_board_created_idx
on public.project_recording_vendor_review_submission_items (
  share_board_id,
  created_at desc
);

create index project_recording_share_events_board_created_idx
on public.project_recording_share_events (share_board_id, created_at desc);

create index project_recording_share_playback_issues_project_status_idx
on public.project_recording_share_playback_issues (
  project_id,
  status,
  reported_at desc
);

update public.project_recording_share_boards
set status = 'expired'
where status = 'active'
  and expires_at <= now();

with ranked_open_formal_boards as (
  select
    id,
    row_number() over (
      partition by organization_id, project_id
      order by created_at desc, id desc
    ) as formal_rank
  from public.project_recording_share_boards
  where mode = 'formal_review'
    and status = 'active'
    and locked_at is null
)
update public.project_recording_share_boards as board
set
  status = 'revoked',
  revoked_at = coalesce(board.revoked_at, now())
from ranked_open_formal_boards as ranked
where board.id = ranked.id
  and ranked.formal_rank > 1;

create unique index project_recording_share_boards_one_open_formal_idx
on public.project_recording_share_boards (organization_id, project_id)
where mode = 'formal_review'
  and status = 'active'
  and locked_at is null;

create or replace function public.validate_recording_share_workflow_scope()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_board_organization_id uuid;
  v_board_project_id uuid;
begin
  select organization_id, project_id
  into v_board_organization_id, v_board_project_id
  from public.project_recording_share_boards
  where id = new.share_board_id;

  if not found
     or v_board_organization_id is distinct from new.organization_id
     or v_board_project_id is distinct from new.project_id then
    raise exception 'recording_share_workflow_board_scope_mismatch';
  end if;

  if tg_table_name = 'project_recording_vendor_review_drafts' then
    perform 1
    from public.project_recording_share_items
    where share_board_id = new.share_board_id
      and organization_id = new.organization_id
      and project_id = new.project_id
      and application_id = new.application_id
      and recording_submission_id = new.recording_submission_id
      and recording_version = new.recording_version;

    if not found then
      raise exception 'recording_share_workflow_draft_share_item_mismatch';
    end if;
  elsif tg_table_name =
        'project_recording_vendor_review_submission_items' then
    perform 1
    from public.project_recording_vendor_review_submissions
    where id = new.submission_id
      and share_board_id = new.share_board_id
      and organization_id = new.organization_id
      and project_id = new.project_id;

    if not found then
      raise exception
        'recording_share_workflow_submission_item_parent_mismatch';
    end if;

    perform 1
    from public.project_recording_share_items
    where share_board_id = new.share_board_id
      and organization_id = new.organization_id
      and project_id = new.project_id
      and application_id = new.application_id
      and recording_submission_id = new.recording_submission_id
      and recording_version = new.recording_version;

    if not found then
      raise exception
        'recording_share_workflow_submission_item_share_item_mismatch';
    end if;
  elsif tg_table_name = 'project_recording_share_playback_issues' then
    perform 1
    from public.project_recording_share_items
    where share_board_id = new.share_board_id
      and organization_id = new.organization_id
      and project_id = new.project_id
      and recording_submission_id = new.recording_submission_id;

    if not found then
      raise exception 'recording_share_workflow_playback_recording_mismatch';
    end if;
  end if;

  return new;
end;
$$;

create constraint trigger project_recording_vendor_review_drafts_validate_scope
after insert or update on public.project_recording_vendor_review_drafts
deferrable initially immediate
for each row
execute function public.validate_recording_share_workflow_scope();

create constraint trigger project_recording_vendor_review_submissions_validate_scope
after insert or update on public.project_recording_vendor_review_submissions
deferrable initially immediate
for each row
execute function public.validate_recording_share_workflow_scope();

create constraint trigger project_recording_vendor_review_submission_items_validate_scope
after insert or update
on public.project_recording_vendor_review_submission_items
deferrable initially immediate
for each row
execute function public.validate_recording_share_workflow_scope();

create constraint trigger project_recording_share_events_validate_scope
after insert or update on public.project_recording_share_events
deferrable initially immediate
for each row
execute function public.validate_recording_share_workflow_scope();

create constraint trigger project_recording_share_playback_issues_validate_scope
after insert or update on public.project_recording_share_playback_issues
deferrable initially immediate
for each row
execute function public.validate_recording_share_workflow_scope();

alter table public.project_recording_vendor_review_drafts enable row level security;
alter table public.project_recording_vendor_review_submissions enable row level security;
alter table public.project_recording_vendor_review_submission_items enable row level security;
alter table public.project_recording_share_events enable row level security;
alter table public.project_recording_share_playback_issues enable row level security;

create policy project_recording_vendor_review_drafts_staff_read
on public.project_recording_vendor_review_drafts
for select
using (
  public.is_org_member(organization_id)
  and public.is_mcn_staff(organization_id)
  and public.can_access_project(project_id)
);

create policy project_recording_vendor_review_submissions_staff_read
on public.project_recording_vendor_review_submissions
for select
using (
  public.is_org_member(organization_id)
  and public.is_mcn_staff(organization_id)
  and public.can_access_project(project_id)
);

create policy project_recording_vendor_review_submission_items_staff_read
on public.project_recording_vendor_review_submission_items
for select
using (
  public.is_org_member(organization_id)
  and public.is_mcn_staff(organization_id)
  and public.can_access_project(project_id)
);

create policy project_recording_share_events_staff_read
on public.project_recording_share_events
for select
using (
  public.is_org_member(organization_id)
  and public.is_mcn_staff(organization_id)
  and public.can_access_project(project_id)
);

create policy project_recording_share_playback_issues_staff_read
on public.project_recording_share_playback_issues
for select
using (
  public.is_org_member(organization_id)
  and public.is_mcn_staff(organization_id)
  and public.can_access_project(project_id)
);

alter type public.audit_action
  add value if not exists 'extend_share_board';
alter type public.audit_action
  add value if not exists 'reopen_share_board';
alter type public.audit_action
  add value if not exists 'rotate_share_board_token';
alter type public.audit_action
  add value if not exists 'resolve_share_playback_issue';
