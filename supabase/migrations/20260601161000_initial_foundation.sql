create extension if not exists pgcrypto with schema extensions;

create type public.app_role as enum (
  'owner',
  'ops_manager',
  'operator_business',
  'finance',
  'streamer'
);

create type public.member_status as enum (
  'invited',
  'active',
  'suspended'
);

create type public.project_status as enum (
  'draft',
  'recruiting',
  'pending_start',
  'active',
  'paused',
  'ended',
  'settling',
  'archived'
);

create type public.project_sensitivity as enum ('normal', 'high');
create type public.settlement_method as enum (
  'cpt',
  'cpa',
  'cps',
  'gift',
  'base_salary',
  'base_salary_cpt',
  'manual'
);

create type public.streamer_source_type as enum (
  'self_incubated',
  'signed',
  'external',
  'supplier_recommended',
  'account_managed'
);

create type public.streamer_cooperation_status as enum (
  'not_started',
  'active',
  'key_development',
  'signed',
  'paused',
  'blacklisted'
);

create type public.risk_level as enum ('low', 'medium', 'high');
create type public.auto_trust_status as enum (
  'trusted',
  'probation',
  'restricted'
);

create type public.live_task_type as enum (
  'project',
  'trial',
  'training',
  'temporary'
);

create type public.live_task_status as enum (
  'pending_live',
  'live',
  'pending_report',
  'report_pending_review',
  'report_approved',
  'completed',
  'report_rejected',
  'cancelled',
  'abnormal'
);

create type public.report_status as enum (
  'pending',
  'ocr_ing',
  'pending_confirm',
  'pending_review',
  'pending_adjudication',
  'approved',
  'rejected',
  'need_more',
  'voided'
);

create type public.time_source as enum ('system', 'screenshot', 'claimed');
create type public.evidence_level as enum ('green', 'yellow', 'red');
create type public.review_mode as enum ('manual', 'auto');
create type public.re_review_result as enum ('upheld', 'overturned');
create type public.auto_review_rule_status as enum (
  'draft',
  'shadow',
  'active',
  'archived'
);

create type public.sample_result as enum (
  'pending',
  'upheld',
  'overturned'
);

create type public.settlement_batch_type as enum ('receivable', 'payable');
create type public.settlement_batch_status as enum (
  'draft',
  'generated',
  'pending',
  'confirmed',
  'locked',
  'reopened',
  'voided'
);

create type public.audit_action as enum (
  'create',
  'update',
  'approve',
  'reject',
  'export',
  'lock',
  'reopen',
  'login',
  'logout',
  'publish',
  'void'
);

create type public.audit_result as enum ('success', 'failure');
create type public.notification_type as enum (
  'task',
  'review',
  'anomaly',
  'settlement',
  'system',
  'high_risk'
);

create type public.notification_status as enum (
  'unread',
  'read',
  'handled',
  'ignored'
);

create table public.organizations (
  id uuid primary key default extensions.gen_random_uuid(),
  name text not null,
  code text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  full_name text not null,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.organization_members (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role public.app_role not null,
  status public.member_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id)
);

create table public.suppliers (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  contact_name text,
  contact_phone text,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, name)
);

create table public.projects (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  code text not null,
  name text not null,
  status public.project_status not null default 'draft',
  sensitivity public.project_sensitivity not null default 'normal',
  supplier_id uuid references public.suppliers(id),
  created_by uuid references public.profiles(id),
  owner_id uuid references public.profiles(id),
  ops_manager_id uuid references public.profiles(id),
  starts_at timestamptz,
  ends_at timestamptz,
  recruiting_deadline date,
  open_signup boolean not null default true,
  allow_direct_invite boolean not null default true,
  force_recording boolean not null default true,
  force_system_timing boolean not null default true,
  default_settlement_method public.settlement_method not null default 'cpt',
  default_hourly_rate numeric(12, 2) not null default 0,
  default_base_salary numeric(12, 2) not null default 0,
  default_settlement_rule jsonb not null default '{}'::jsonb,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, code),
  constraint projects_default_hourly_rate_nonnegative check (default_hourly_rate >= 0),
  constraint projects_default_base_salary_nonnegative check (default_base_salary >= 0),
  constraint projects_publish_requires_timestamp check (
    status <> 'recruiting' or published_at is not null
  )
);

create table public.project_assignments (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (project_id, user_id)
);

create table public.streamers (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete set null,
  display_name text not null,
  real_name text,
  gender text,
  phone text,
  wechat text,
  note text,
  source_type public.streamer_source_type not null default 'external',
  primary_supplier_id uuid references public.suppliers(id),
  referrer text,
  cooperation_status public.streamer_cooperation_status not null default 'not_started',
  categories text[] not null default '{}',
  platforms text[] not null default '{}',
  styles text[] not null default '{}',
  skills text[] not null default '{}',
  availability jsonb not null default '{}'::jsonb,
  equipment jsonb not null default '{}'::jsonb,
  risk_tags text[] not null default '{}',
  default_settlement_method public.settlement_method not null default 'cpt',
  default_price numeric(12, 2) not null default 0,
  default_base_salary numeric(12, 2) not null default 0,
  risk_level public.risk_level not null default 'low',
  risk_reason text,
  blacklist_reason text,
  operation_note text,
  auto_trust public.auto_trust_status not null default 'probation',
  clean_report_count integer not null default 0,
  duration_baseline integer,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint streamers_default_price_nonnegative check (default_price >= 0),
  constraint streamers_default_base_salary_nonnegative check (default_base_salary >= 0),
  constraint streamers_clean_report_count_nonnegative check (clean_report_count >= 0),
  constraint streamers_duration_baseline_nonnegative check (
    duration_baseline is null or duration_baseline >= 0
  )
);

create table public.live_tasks (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  streamer_id uuid not null references public.streamers(id) on delete cascade,
  title text not null,
  task_type public.live_task_type not null default 'project',
  status public.live_task_status not null default 'pending_live',
  planned_start_at timestamptz,
  planned_end_at timestamptz,
  planned_duration integer,
  requires_timing boolean not null default true,
  system_started_at timestamptz,
  system_stopped_at timestamptz,
  system_duration integer not null default 0,
  anomaly_flags text[] not null default '{}',
  created_by uuid references public.profiles(id),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint live_tasks_project_required_for_project_task check (
    task_type <> 'project' or project_id is not null
  ),
  constraint live_tasks_planned_duration_nonnegative check (
    planned_duration is null or planned_duration >= 0
  ),
  constraint live_tasks_system_duration_nonnegative check (system_duration >= 0)
);

create table public.live_reports (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  live_task_id uuid not null references public.live_tasks(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  streamer_id uuid not null references public.streamers(id) on delete cascade,
  status public.report_status not null default 'pending',
  system_duration integer,
  screenshot_duration integer,
  claimed_duration integer,
  settlement_duration integer,
  time_source public.time_source,
  evidence_level public.evidence_level,
  divergence_pct numeric(8, 4),
  divergence_resolved_by uuid references public.profiles(id),
  divergence_reason text,
  viewers integer,
  review_mode public.review_mode not null default 'manual',
  auto_rule_version integer,
  auto_gate_snapshot jsonb,
  sampled boolean not null default false,
  re_review_result public.re_review_result,
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  review_notes text,
  include_in_task_result boolean not null default true,
  enter_settlement_pool boolean not null default true,
  settled_batch_item_id uuid unique,
  risk_flags text[] not null default '{}',
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint live_reports_system_duration_nonnegative check (
    system_duration is null or system_duration >= 0
  ),
  constraint live_reports_screenshot_duration_nonnegative check (
    screenshot_duration is null or screenshot_duration >= 0
  ),
  constraint live_reports_claimed_duration_nonnegative check (
    claimed_duration is null or claimed_duration >= 0
  ),
  constraint live_reports_settlement_duration_nonnegative check (
    settlement_duration is null or settlement_duration >= 0
  ),
  constraint live_reports_viewers_nonnegative check (viewers is null or viewers >= 0),
  constraint live_reports_approved_has_snapshot check (
    status <> 'approved'
    or (settlement_duration is not null and time_source is not null and evidence_level is not null)
  )
);

create table public.settlement_batches (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  batch_type public.settlement_batch_type not null,
  status public.settlement_batch_status not null default 'draft',
  period_start date not null,
  period_end date not null,
  computed_amount numeric(12, 2) not null default 0,
  manual_amount numeric(12, 2) not null default 0,
  adjustment_amount numeric(12, 2) not null default 0,
  evidence_summary jsonb not null default '{}'::jsonb,
  lock_reason text,
  reopen_reason text,
  created_by uuid references public.profiles(id),
  locked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint settlement_batches_period_valid check (period_end >= period_start),
  constraint settlement_batches_reopen_reason_required check (
    status <> 'reopened' or nullif(trim(reopen_reason), '') is not null
  ),
  constraint settlement_batches_unique_period_type unique (
    organization_id,
    project_id,
    batch_type,
    period_start,
    period_end
  )
);

create table public.settlement_batch_items (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  settlement_batch_id uuid references public.settlement_batches(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  streamer_id uuid references public.streamers(id),
  live_report_id uuid references public.live_reports(id),
  item_type text not null default 'live_report',
  computed_amount numeric(12, 2) not null default 0,
  manual_amount numeric(12, 2) not null default 0,
  adjustment_amount numeric(12, 2) not null default 0,
  evidence_level public.evidence_level,
  evidence_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint settlement_batch_items_amounts_nonnegative check (
    computed_amount >= 0 and manual_amount >= 0
  )
);

alter table public.live_reports
  add constraint live_reports_settled_batch_item_id_fkey
  foreign key (settled_batch_item_id)
  references public.settlement_batch_items(id);

create unique index settlement_batch_items_no_duplicate_report
  on public.settlement_batch_items (organization_id, live_report_id, item_type)
  where live_report_id is not null;

create table public.report_screenshots (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  live_report_id uuid not null references public.live_reports(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  streamer_id uuid not null references public.streamers(id) on delete cascade,
  storage_path text not null,
  file_hash text not null,
  uploaded_by uuid references public.profiles(id),
  uploaded_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  unique (organization_id, file_hash)
);

create table public.ocr_results (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  live_report_id uuid not null references public.live_reports(id) on delete cascade,
  screenshot_id uuid references public.report_screenshots(id) on delete set null,
  status text not null default 'pending',
  raw_result jsonb not null default '{}'::jsonb,
  extracted_duration integer,
  extracted_viewers integer,
  error_message text,
  created_at timestamptz not null default now(),
  constraint ocr_results_extracted_duration_nonnegative check (
    extracted_duration is null or extracted_duration >= 0
  ),
  constraint ocr_results_extracted_viewers_nonnegative check (
    extracted_viewers is null or extracted_viewers >= 0
  )
);

create table public.report_change_logs (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  live_report_id uuid not null references public.live_reports(id) on delete cascade,
  changed_by uuid references public.profiles(id),
  before_json jsonb not null default '{}'::jsonb,
  after_json jsonb not null default '{}'::jsonb,
  changed_fields text[] not null default '{}',
  reason text,
  created_at timestamptz not null default now()
);

create table public.auto_review_rules (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  version integer not null,
  status public.auto_review_rule_status not null default 'draft',
  scope jsonb not null default '{}'::jsonb,
  auto_review_enabled boolean not null default false,
  divergence_threshold_pct numeric(6, 4) not null default 0.10,
  divergence_threshold_min integer not null default 15,
  daily_duration_cap integer not null default 1080,
  planned_duration_tolerance numeric(6, 4) not null default 0.30,
  baseline_deviation_pct numeric(6, 4) not null default 0.60,
  probation_clean_reports integer not null default 5,
  sample_rate numeric(6, 4) not null default 0.30,
  effective_at timestamptz,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, version),
  constraint auto_review_rules_sample_rate_range check (sample_rate >= 0 and sample_rate <= 1),
  constraint auto_review_rules_probation_nonnegative check (probation_clean_reports >= 0),
  constraint auto_review_rules_duration_caps_nonnegative check (
    divergence_threshold_min >= 0 and daily_duration_cap > 0
  )
);

create unique index auto_review_rules_single_active
  on public.auto_review_rules (organization_id)
  where status = 'active';

create table public.review_samples (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  live_report_id uuid not null references public.live_reports(id) on delete cascade,
  sampled_by uuid references public.profiles(id),
  sampled_at timestamptz not null default now(),
  result public.sample_result not null default 'pending',
  notes text,
  created_at timestamptz not null default now()
);

create table public.audit_logs (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_user_id uuid references public.profiles(id),
  actor_name text,
  actor_role public.app_role,
  action public.audit_action not null,
  module text not null,
  object_type text not null,
  object_id uuid,
  object_name text,
  project_id uuid references public.projects(id),
  streamer_id uuid references public.streamers(id),
  before_json jsonb not null default '{}'::jsonb,
  after_json jsonb not null default '{}'::jsonb,
  changed_fields text[] not null default '{}',
  reason text,
  is_high_risk boolean not null default false,
  result public.audit_result not null default 'success',
  error_message text,
  created_at timestamptz not null default now(),
  constraint audit_logs_high_risk_reason_required check (
    is_high_risk = false or nullif(trim(reason), '') is not null
  )
);

create table public.notifications (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  recipient_user_id uuid references public.profiles(id) on delete cascade,
  recipient_role public.app_role,
  notification_type public.notification_type not null,
  status public.notification_status not null default 'unread',
  title text not null,
  content text not null,
  object_type text,
  object_id uuid,
  source text,
  is_high_risk boolean not null default false,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  handled_at timestamptz,
  constraint notifications_recipient_required check (
    recipient_user_id is not null or recipient_role is not null
  )
);

create index organization_members_user_idx on public.organization_members (user_id);
create index projects_org_status_idx on public.projects (organization_id, status);
create index project_assignments_user_idx on public.project_assignments (user_id);
create index streamers_org_user_idx on public.streamers (organization_id, user_id);
create index streamers_org_auto_trust_idx on public.streamers (organization_id, auto_trust);
create index live_tasks_project_idx on public.live_tasks (project_id, status);
create index live_tasks_streamer_idx on public.live_tasks (streamer_id, status);
create index live_reports_task_idx on public.live_reports (live_task_id);
create index live_reports_project_status_idx on public.live_reports (project_id, status);
create index live_reports_streamer_idx on public.live_reports (streamer_id);
create index audit_logs_org_created_idx on public.audit_logs (organization_id, created_at desc);
create index notifications_recipient_status_idx on public.notifications (recipient_user_id, status);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger organizations_touch_updated_at
before update on public.organizations
for each row execute function public.touch_updated_at();

create trigger profiles_touch_updated_at
before update on public.profiles
for each row execute function public.touch_updated_at();

create trigger organization_members_touch_updated_at
before update on public.organization_members
for each row execute function public.touch_updated_at();

create trigger suppliers_touch_updated_at
before update on public.suppliers
for each row execute function public.touch_updated_at();

create trigger projects_touch_updated_at
before update on public.projects
for each row execute function public.touch_updated_at();

create trigger streamers_touch_updated_at
before update on public.streamers
for each row execute function public.touch_updated_at();

create trigger live_tasks_touch_updated_at
before update on public.live_tasks
for each row execute function public.touch_updated_at();

create trigger live_reports_touch_updated_at
before update on public.live_reports
for each row execute function public.touch_updated_at();

create trigger settlement_batches_touch_updated_at
before update on public.settlement_batches
for each row execute function public.touch_updated_at();

create trigger auto_review_rules_touch_updated_at
before update on public.auto_review_rules
for each row execute function public.touch_updated_at();

create or replace function public.prevent_audit_log_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'audit_logs are append-only';
end;
$$;

create trigger audit_logs_append_only
before update or delete on public.audit_logs
for each row execute function public.prevent_audit_log_mutation();

create or replace function public.prevent_live_report_snapshot_mutation()
returns trigger
language plpgsql
as $$
begin
  if old.settlement_duration is not null
     and new.settlement_duration is distinct from old.settlement_duration then
    raise exception 'live report settlement_duration is frozen once written';
  end if;

  if old.time_source is not null
     and new.time_source is distinct from old.time_source then
    raise exception 'live report time_source is frozen once written';
  end if;

  if old.evidence_level is not null
     and new.evidence_level is distinct from old.evidence_level then
    raise exception 'live report evidence_level is frozen once written';
  end if;

  return new;
end;
$$;

create trigger live_reports_freeze_evidence_snapshot
before update on public.live_reports
for each row execute function public.prevent_live_report_snapshot_mutation();

create or replace function public.is_org_member(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_members om
    where om.organization_id = target_organization_id
      and om.user_id = auth.uid()
      and om.status = 'active'
  );
$$;

create or replace function public.current_user_role(target_organization_id uuid)
returns public.app_role
language sql
stable
security definer
set search_path = public
as $$
  select om.role
  from public.organization_members om
  where om.organization_id = target_organization_id
    and om.user_id = auth.uid()
    and om.status = 'active'
  order by case om.role
    when 'owner' then 1
    when 'ops_manager' then 2
    when 'finance' then 3
    when 'operator_business' then 4
    when 'streamer' then 5
  end
  limit 1;
$$;

create or replace function public.is_mcn_staff(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_user_role(target_organization_id) in (
    'owner',
    'ops_manager',
    'operator_business',
    'finance'
  );
$$;

create or replace function public.current_streamer_id(target_organization_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select s.id
  from public.streamers s
  where s.organization_id = target_organization_id
    and s.user_id = auth.uid()
  limit 1;
$$;

create or replace function public.can_access_project(target_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with project_scope as (
    select p.id, p.organization_id
    from public.projects p
    where p.id = target_project_id
  )
  select coalesce((
    select
      case
        when public.current_user_role(ps.organization_id) in ('owner', 'ops_manager', 'finance')
          then true
        when public.current_user_role(ps.organization_id) = 'operator_business'
          then exists (
            select 1
            from public.project_assignments pa
            where pa.project_id = ps.id
              and pa.user_id = auth.uid()
          )
        when public.current_user_role(ps.organization_id) = 'streamer'
          then exists (
            select 1
            from public.live_tasks lt
            where lt.project_id = ps.id
              and lt.streamer_id = public.current_streamer_id(ps.organization_id)
          )
        else false
      end
    from project_scope ps
  ), false);
$$;

create or replace function public.can_publish_project(target_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.projects p
    where p.id = target_project_id
      and public.current_user_role(p.organization_id) in ('owner', 'ops_manager')
  );
$$;

create or replace view public.streamer_payable_items_safe
with (security_invoker = true)
as
select
  sbi.id,
  sbi.organization_id,
  sbi.project_id,
  p.name as project_name,
  sbi.streamer_id,
  sb.period_start,
  sb.period_end,
  sbi.computed_amount,
  sbi.manual_amount,
  sbi.adjustment_amount,
  (sbi.computed_amount + sbi.manual_amount + sbi.adjustment_amount) as payable_amount,
  sbi.evidence_level,
  sbi.evidence_snapshot,
  sbi.created_at
from public.settlement_batch_items sbi
join public.settlement_batches sb on sb.id = sbi.settlement_batch_id
join public.projects p on p.id = sbi.project_id
where sb.batch_type = 'payable';

insert into storage.buckets (id, name, public, file_size_limit)
values ('jy-private', 'jy-private', false, 52428800)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit;

alter table public.organizations enable row level security;
alter table public.profiles enable row level security;
alter table public.organization_members enable row level security;
alter table public.suppliers enable row level security;
alter table public.projects enable row level security;
alter table public.project_assignments enable row level security;
alter table public.streamers enable row level security;
alter table public.live_tasks enable row level security;
alter table public.live_reports enable row level security;
alter table public.settlement_batches enable row level security;
alter table public.settlement_batch_items enable row level security;
alter table public.report_screenshots enable row level security;
alter table public.ocr_results enable row level security;
alter table public.report_change_logs enable row level security;
alter table public.auto_review_rules enable row level security;
alter table public.review_samples enable row level security;
alter table public.audit_logs enable row level security;
alter table public.notifications enable row level security;

create policy "members can read their organizations"
on public.organizations for select
to authenticated
using (public.is_org_member(id));

create policy "members can read profiles in their organizations"
on public.profiles for select
to authenticated
using (
  id = auth.uid()
  or exists (
    select 1
    from public.organization_members om_self
    join public.organization_members om_other
      on om_other.organization_id = om_self.organization_id
    where om_self.user_id = auth.uid()
      and om_self.status = 'active'
      and om_other.user_id = profiles.id
      and om_other.status = 'active'
  )
);

create policy "users can update own profile"
on public.profiles for update
to authenticated
using (id = auth.uid())
with check (id = auth.uid());

create policy "members can read org memberships"
on public.organization_members for select
to authenticated
using (public.is_org_member(organization_id));

create policy "owners can manage org memberships"
on public.organization_members for all
to authenticated
using (public.current_user_role(organization_id) = 'owner')
with check (public.current_user_role(organization_id) = 'owner');

create policy "staff can read suppliers"
on public.suppliers for select
to authenticated
using (public.is_mcn_staff(organization_id));

create policy "ops can manage suppliers"
on public.suppliers for all
to authenticated
using (public.current_user_role(organization_id) in ('owner', 'ops_manager', 'operator_business'))
with check (public.current_user_role(organization_id) in ('owner', 'ops_manager', 'operator_business'));

create policy "project scoped read"
on public.projects for select
to authenticated
using (public.can_access_project(id));

create policy "staff can create projects"
on public.projects for insert
to authenticated
with check (public.is_mcn_staff(organization_id));

create policy "staff can update accessible projects"
on public.projects for update
to authenticated
using (
  public.current_user_role(organization_id) in ('owner', 'ops_manager')
  or (
    public.current_user_role(organization_id) = 'operator_business'
    and exists (
      select 1 from public.project_assignments pa
      where pa.project_id = projects.id and pa.user_id = auth.uid()
    )
  )
)
with check (public.is_mcn_staff(organization_id));

create policy "members can read project assignments"
on public.project_assignments for select
to authenticated
using (public.is_org_member(organization_id));

create policy "owner ops can manage project assignments"
on public.project_assignments for all
to authenticated
using (public.current_user_role(organization_id) in ('owner', 'ops_manager'))
with check (public.current_user_role(organization_id) in ('owner', 'ops_manager'));

create policy "staff and self can read streamers"
on public.streamers for select
to authenticated
using (
  public.current_user_role(organization_id) in ('owner', 'ops_manager', 'finance')
  or user_id = auth.uid()
);

create policy "ops can manage streamers"
on public.streamers for all
to authenticated
using (public.current_user_role(organization_id) in ('owner', 'ops_manager', 'operator_business'))
with check (public.current_user_role(organization_id) in ('owner', 'ops_manager', 'operator_business'));

create policy "staff can read auto review rules"
on public.auto_review_rules for select
to authenticated
using (public.is_mcn_staff(organization_id));

create policy "owner ops can manage auto review rules"
on public.auto_review_rules for all
to authenticated
using (public.current_user_role(organization_id) in ('owner', 'ops_manager'))
with check (public.current_user_role(organization_id) in ('owner', 'ops_manager'));

create policy "project scoped live task read"
on public.live_tasks for select
to authenticated
using (
  (project_id is not null and public.can_access_project(project_id))
  or streamer_id = public.current_streamer_id(organization_id)
);

create policy "staff can manage live tasks"
on public.live_tasks for all
to authenticated
using (
  public.is_mcn_staff(organization_id)
  and (project_id is null or public.can_access_project(project_id))
)
with check (
  public.is_mcn_staff(organization_id)
  and (project_id is null or public.can_access_project(project_id))
);

create policy "streamer can update own live task timing"
on public.live_tasks for update
to authenticated
using (streamer_id = public.current_streamer_id(organization_id))
with check (streamer_id = public.current_streamer_id(organization_id));

create policy "project or streamer scoped live report read"
on public.live_reports for select
to authenticated
using (
  public.can_access_project(project_id)
  or streamer_id = public.current_streamer_id(organization_id)
);

create policy "staff or streamer can create live reports"
on public.live_reports for insert
to authenticated
with check (
  public.can_access_project(project_id)
  or streamer_id = public.current_streamer_id(organization_id)
);

create policy "staff or streamer can update live reports"
on public.live_reports for update
to authenticated
using (
  public.can_access_project(project_id)
  or streamer_id = public.current_streamer_id(organization_id)
)
with check (
  public.can_access_project(project_id)
  or streamer_id = public.current_streamer_id(organization_id)
);

create policy "staff can read settlement batches"
on public.settlement_batches for select
to authenticated
using (public.is_mcn_staff(organization_id) and public.can_access_project(project_id));

create policy "staff can manage settlement batches"
on public.settlement_batches for all
to authenticated
using (public.is_mcn_staff(organization_id) and public.can_access_project(project_id))
with check (public.is_mcn_staff(organization_id) and public.can_access_project(project_id));

create policy "staff and payable streamer can read settlement items"
on public.settlement_batch_items for select
to authenticated
using (
  (public.is_mcn_staff(organization_id) and public.can_access_project(project_id))
  or (
    streamer_id = public.current_streamer_id(organization_id)
    and exists (
      select 1 from public.settlement_batches sb
      where sb.id = settlement_batch_items.settlement_batch_id
        and sb.batch_type = 'payable'
    )
  )
);

create policy "staff can manage settlement items"
on public.settlement_batch_items for all
to authenticated
using (public.is_mcn_staff(organization_id) and public.can_access_project(project_id))
with check (public.is_mcn_staff(organization_id) and public.can_access_project(project_id));

create policy "report support read"
on public.report_screenshots for select
to authenticated
using (
  public.can_access_project(project_id)
  or streamer_id = public.current_streamer_id(organization_id)
);

create policy "report support insert"
on public.report_screenshots for insert
to authenticated
with check (
  public.can_access_project(project_id)
  or streamer_id = public.current_streamer_id(organization_id)
);

create policy "ocr read"
on public.ocr_results for select
to authenticated
using (
  exists (
    select 1 from public.live_reports lr
    where lr.id = ocr_results.live_report_id
      and (
        public.can_access_project(lr.project_id)
        or lr.streamer_id = public.current_streamer_id(lr.organization_id)
      )
  )
);

create policy "report change read"
on public.report_change_logs for select
to authenticated
using (
  exists (
    select 1 from public.live_reports lr
    where lr.id = report_change_logs.live_report_id
      and public.can_access_project(lr.project_id)
  )
);

create policy "review samples read"
on public.review_samples for select
to authenticated
using (
  exists (
    select 1 from public.live_reports lr
    where lr.id = review_samples.live_report_id
      and public.can_access_project(lr.project_id)
  )
);

create policy "audit scoped read"
on public.audit_logs for select
to authenticated
using (
  public.current_user_role(organization_id) = 'owner'
  or (
    public.current_user_role(organization_id) = 'ops_manager'
    and module <> 'finance'
  )
  or (
    public.current_user_role(organization_id) = 'finance'
    and module in ('finance', 'settlement', 'audit', 'auth')
  )
  or (
    public.current_user_role(organization_id) = 'operator_business'
    and project_id is not null
    and public.can_access_project(project_id)
  )
);

create policy "members can insert audit logs"
on public.audit_logs for insert
to authenticated
with check (public.is_org_member(organization_id));

create policy "recipient notification read"
on public.notifications for select
to authenticated
using (
  recipient_user_id = auth.uid()
  or (
    recipient_role is not null
    and recipient_role = public.current_user_role(organization_id)
  )
);

create policy "recipient notification update"
on public.notifications for update
to authenticated
using (recipient_user_id = auth.uid())
with check (recipient_user_id = auth.uid());

create policy "members can insert notifications"
on public.notifications for insert
to authenticated
with check (public.is_org_member(organization_id));

create policy "private bucket organization read"
on storage.objects for select
to authenticated
using (
  bucket_id = 'jy-private'
  and public.is_org_member(((storage.foldername(name))[1])::uuid)
);

create policy "private bucket organization write"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'jy-private'
  and public.is_org_member(((storage.foldername(name))[1])::uuid)
);
