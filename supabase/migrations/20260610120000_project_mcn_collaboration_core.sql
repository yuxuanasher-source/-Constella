alter table public.projects
  add column if not exists is_open_to_mcn_collaboration boolean not null default false,
  add column if not exists mcn_collaboration_summary text not null default '',
  add column if not exists mcn_collaboration_terms jsonb not null default '{}'::jsonb;

alter type public.audit_action add value if not exists 'enable_collaboration';
alter type public.audit_action add value if not exists 'disable_collaboration';
alter type public.audit_action add value if not exists 'create_collaboration_share';
alter type public.audit_action add value if not exists 'revoke_collaboration_share';
alter type public.audit_action add value if not exists 'submit_collaboration_application';
alter type public.audit_action add value if not exists 'review_collaboration_application';
alter type public.audit_action add value if not exists 'confirm_collaboration_counter';
alter type public.audit_action add value if not exists 'activate_collaboration_agreement';

create table if not exists public.project_collaboration_shares (
  id uuid primary key default extensions.gen_random_uuid(),
  owner_organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  token_hash text not null unique,
  status text not null default 'active',
  expires_at timestamptz not null,
  allow_applications boolean not null default true,
  visible_fields text[] not null default array[
    'projectName',
    'collaborationSummary',
    'collaborationTerms'
  ]::text[],
  created_by uuid not null references public.profiles(id),
  revoked_by uuid references public.profiles(id),
  revoked_at timestamptz,
  last_viewed_at timestamptz,
  last_submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint project_collaboration_shares_status_check check (
    status in ('active', 'expired', 'revoked')
  ),
  constraint project_collaboration_shares_expiry_check check (
    expires_at > created_at
  )
);

create table if not exists public.project_collaboration_applications (
  id uuid primary key default extensions.gen_random_uuid(),
  share_id uuid not null references public.project_collaboration_shares(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  owner_organization_id uuid not null references public.organizations(id) on delete cascade,
  applicant_organization_id uuid not null references public.organizations(id) on delete cascade,
  requested_revenue_share_bps integer not null,
  owner_counter_revenue_share_bps integer,
  final_revenue_share_bps integer,
  status text not null default 'submitted',
  applicant_note text not null default '',
  owner_review_note text not null default '',
  rejection_reason text not null default '',
  submitted_by uuid not null references public.profiles(id),
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  applicant_confirmed_by uuid references public.profiles(id),
  applicant_confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint project_collaboration_applications_status_check check (
    status in (
      'submitted',
      'approved',
      'owner_countered',
      'rejected',
      'withdrawn',
      'expired'
    )
  ),
  constraint project_collaboration_applications_requested_bps_check check (
    requested_revenue_share_bps between 0 and 10000
  ),
  constraint project_collaboration_applications_counter_bps_check check (
    owner_counter_revenue_share_bps is null or owner_counter_revenue_share_bps between 0 and 10000
  ),
  constraint project_collaboration_applications_final_bps_check check (
    final_revenue_share_bps is null or final_revenue_share_bps between 0 and 10000
  ),
  constraint project_collaboration_applications_not_owner_check check (
    owner_organization_id <> applicant_organization_id
  ),
  constraint project_collaboration_applications_reject_reason_check check (
    status <> 'rejected' or nullif(trim(rejection_reason), '') is not null
  )
);

create table if not exists public.project_collaboration_agreements (
  id uuid primary key default extensions.gen_random_uuid(),
  application_id uuid not null unique references public.project_collaboration_applications(id) on delete restrict,
  project_id uuid not null references public.projects(id) on delete cascade,
  owner_organization_id uuid not null references public.organizations(id) on delete cascade,
  partner_organization_id uuid not null references public.organizations(id) on delete cascade,
  revenue_share_bps integer not null,
  settlement_basis text not null default 'project_revenue',
  status text not null default 'active',
  owner_confirmed_by uuid not null references public.profiles(id),
  owner_confirmed_at timestamptz not null default now(),
  partner_confirmed_by uuid references public.profiles(id),
  partner_confirmed_at timestamptz,
  suspended_by uuid references public.profiles(id),
  suspended_at timestamptz,
  ended_by uuid references public.profiles(id),
  ended_at timestamptz,
  status_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint project_collaboration_agreements_status_check check (
    status in ('active', 'suspended', 'ended')
  ),
  constraint project_collaboration_agreements_basis_check check (
    settlement_basis = 'project_revenue'
  ),
  constraint project_collaboration_agreements_bps_check check (
    revenue_share_bps between 0 and 10000
  ),
  constraint project_collaboration_agreements_not_owner_check check (
    owner_organization_id <> partner_organization_id
  )
);

create index if not exists project_collaboration_shares_project_status_idx
on public.project_collaboration_shares (owner_organization_id, project_id, status);

create index if not exists project_collaboration_shares_token_hash_idx
on public.project_collaboration_shares (token_hash);

create index if not exists project_collaboration_applications_project_status_idx
on public.project_collaboration_applications (project_id, status);

create index if not exists project_collaboration_applications_applicant_idx
on public.project_collaboration_applications (applicant_organization_id, status);

create unique index if not exists project_collaboration_applications_one_pending
on public.project_collaboration_applications (project_id, applicant_organization_id)
where status in ('submitted', 'owner_countered');

create index if not exists project_collaboration_agreements_project_status_idx
on public.project_collaboration_agreements (project_id, status);

create index if not exists project_collaboration_agreements_partner_idx
on public.project_collaboration_agreements (partner_organization_id, status);

create unique index if not exists project_collaboration_agreements_one_active
on public.project_collaboration_agreements (project_id, partner_organization_id)
where status = 'active';

create trigger project_collaboration_shares_touch_updated_at
before update on public.project_collaboration_shares
for each row execute function public.touch_updated_at();

create trigger project_collaboration_applications_touch_updated_at
before update on public.project_collaboration_applications
for each row execute function public.touch_updated_at();

create trigger project_collaboration_agreements_touch_updated_at
before update on public.project_collaboration_agreements
for each row execute function public.touch_updated_at();

create or replace function public.can_manage_project_collaboration(target_project_id uuid)
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

create or replace function public.can_access_project_collaboration(
  target_project_id uuid,
  target_organization_id uuid
)
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
      and p.organization_id = target_organization_id
      and public.can_access_project(p.id)
  )
  or exists (
    select 1
    from public.project_collaboration_agreements agreement
    where agreement.project_id = target_project_id
      and agreement.partner_organization_id = target_organization_id
      and agreement.status in ('active', 'suspended', 'ended')
      and public.is_org_member(agreement.partner_organization_id)
  );
$$;

create or replace function public.can_contribute_to_project(
  target_project_id uuid,
  target_organization_id uuid
)
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
      and p.organization_id = target_organization_id
      and public.can_access_project(p.id)
  )
  or exists (
    select 1
    from public.project_collaboration_agreements agreement
    where agreement.project_id = target_project_id
      and agreement.partner_organization_id = target_organization_id
      and agreement.status = 'active'
      and public.is_org_member(agreement.partner_organization_id)
  );
$$;

alter table public.project_collaboration_shares enable row level security;
alter table public.project_collaboration_applications enable row level security;
alter table public.project_collaboration_agreements enable row level security;

create policy project_collaboration_shares_owner_manage
on public.project_collaboration_shares
for all
to authenticated
using (
  public.can_manage_project_collaboration(project_id)
)
with check (
  public.can_manage_project_collaboration(project_id)
  and public.current_user_role(owner_organization_id) in ('owner', 'ops_manager')
);

create policy project_collaboration_applications_owner_read
on public.project_collaboration_applications
for select
to authenticated
using (
  public.can_manage_project_collaboration(project_id)
  or (
    public.is_org_member(applicant_organization_id)
    and public.can_access_project_collaboration(project_id, applicant_organization_id)
  )
);

create policy project_collaboration_applications_partner_insert
on public.project_collaboration_applications
for insert
to authenticated
with check (
  public.is_org_member(applicant_organization_id)
  and applicant_organization_id <> owner_organization_id
);

create policy project_collaboration_applications_owner_update
on public.project_collaboration_applications
for update
to authenticated
using (
  public.can_manage_project_collaboration(project_id)
)
with check (
  public.can_manage_project_collaboration(project_id)
);

create policy project_collaboration_agreements_owner_partner_read
on public.project_collaboration_agreements
for select
to authenticated
using (
  public.can_manage_project_collaboration(project_id)
  or public.is_org_member(partner_organization_id)
);

create policy project_collaboration_agreements_owner_insert
on public.project_collaboration_agreements
for insert
to authenticated
with check (
  public.can_manage_project_collaboration(project_id)
);

create policy project_collaboration_agreements_owner_update
on public.project_collaboration_agreements
for update
to authenticated
using (
  public.can_manage_project_collaboration(project_id)
)
with check (
  public.can_manage_project_collaboration(project_id)
);
