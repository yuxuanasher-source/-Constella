create table if not exists public.project_collaboration_revenue_records (
  id uuid primary key default gen_random_uuid(),
  agreement_id uuid not null references public.project_collaboration_agreements(id),
  project_id uuid not null references public.projects(id),
  owner_organization_id uuid not null references public.organizations(id),
  partner_organization_id uuid not null references public.organizations(id),
  period_start date not null,
  period_end date not null,
  revenue_amount integer not null default 0,
  status text not null default 'draft',
  evidence_snapshot jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id),
  confirmed_by uuid references auth.users(id),
  confirmed_at timestamptz,
  voided_by uuid references auth.users(id),
  voided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint project_collaboration_revenue_records_period_valid check (period_end >= period_start),
  constraint project_collaboration_revenue_records_amount_nonnegative check (revenue_amount >= 0),
  constraint project_collaboration_revenue_records_status_check check (
    status in ('draft', 'confirmed', 'voided')
  )
);

create table if not exists public.project_collaboration_settlement_batches (
  id uuid primary key default gen_random_uuid(),
  agreement_id uuid not null references public.project_collaboration_agreements(id),
  project_id uuid not null references public.projects(id),
  owner_organization_id uuid not null references public.organizations(id),
  partner_organization_id uuid not null references public.organizations(id),
  batch_type text not null default 'partner_receivable',
  status text not null default 'generated',
  period_start date not null,
  period_end date not null,
  computed_amount integer not null default 0,
  manual_amount integer not null default 0,
  adjustment_amount integer not null default 0,
  evidence_summary jsonb not null default '{}'::jsonb,
  partner_response_reason text,
  lock_reason text,
  reopen_reason text,
  void_reason text,
  created_by uuid references auth.users(id),
  partner_responded_by uuid references auth.users(id),
  partner_responded_at timestamptz,
  locked_by uuid references auth.users(id),
  locked_at timestamptz,
  reopened_by uuid references auth.users(id),
  reopened_at timestamptz,
  voided_by uuid references auth.users(id),
  voided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint project_collaboration_settlement_batches_period_valid check (period_end >= period_start),
  constraint project_collaboration_settlement_batches_amounts_nonnegative check (
    computed_amount >= 0 and manual_amount >= 0
  ),
  constraint project_collaboration_settlement_batches_type_check check (
    batch_type in ('partner_receivable')
  ),
  constraint project_collaboration_settlement_batches_status_check check (
    status in (
      'generated',
      'partner_confirmed',
      'partner_disputed',
      'locked',
      'reopened',
      'voided'
    )
  )
);

create table if not exists public.project_collaboration_settlement_items (
  id uuid primary key default gen_random_uuid(),
  settlement_batch_id uuid not null references public.project_collaboration_settlement_batches(id) on delete cascade,
  agreement_id uuid not null references public.project_collaboration_agreements(id),
  revenue_record_id uuid references public.project_collaboration_revenue_records(id),
  project_id uuid not null references public.projects(id),
  owner_organization_id uuid not null references public.organizations(id),
  partner_organization_id uuid not null references public.organizations(id),
  batch_type text not null default 'partner_receivable',
  item_type text not null default 'project_revenue_share',
  revenue_amount integer not null default 0,
  revenue_share_bps integer not null default 0,
  computed_amount integer not null default 0,
  manual_amount integer not null default 0,
  adjustment_amount integer not null default 0,
  evidence_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint project_collaboration_settlement_items_amounts_nonnegative check (
    revenue_amount >= 0 and computed_amount >= 0 and manual_amount >= 0
  ),
  constraint project_collaboration_settlement_items_bps_range check (
    revenue_share_bps >= 0 and revenue_share_bps <= 10000
  )
);

create unique index if not exists project_collaboration_settlement_items_unique_revenue
on public.project_collaboration_settlement_items (
  agreement_id,
  revenue_record_id,
  batch_type
)
where revenue_record_id is not null;

create index if not exists project_collaboration_revenue_records_agreement_idx
on public.project_collaboration_revenue_records (agreement_id, status, period_start, period_end);

create index if not exists project_collaboration_settlement_batches_agreement_idx
on public.project_collaboration_settlement_batches (agreement_id, status, period_start, period_end);

create index if not exists project_collaboration_settlement_items_batch_idx
on public.project_collaboration_settlement_items (settlement_batch_id);

create or replace function public.can_read_collaboration_settlement(
  target_agreement_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.project_collaboration_agreements agreement
    where agreement.id = target_agreement_id
      and (
        public.is_org_member(agreement.owner_organization_id)
        or public.is_org_member(agreement.partner_organization_id)
      )
  );
$$;

alter table public.project_collaboration_revenue_records enable row level security;
alter table public.project_collaboration_settlement_batches enable row level security;
alter table public.project_collaboration_settlement_items enable row level security;

create policy project_collaboration_revenue_records_owner_read_write
on public.project_collaboration_revenue_records
for all
to authenticated
using (public.can_manage_project_collaboration(project_id))
with check (public.can_manage_project_collaboration(project_id));

create policy project_collaboration_revenue_records_settlement_read
on public.project_collaboration_revenue_records
for select
to authenticated
using (public.can_read_collaboration_settlement(agreement_id));

create policy project_collaboration_settlement_batches_read
on public.project_collaboration_settlement_batches
for select
to authenticated
using (public.can_read_collaboration_settlement(agreement_id));

create policy project_collaboration_settlement_batches_owner_write
on public.project_collaboration_settlement_batches
for all
to authenticated
using (public.can_manage_project_collaboration(project_id))
with check (public.can_manage_project_collaboration(project_id));

create policy project_collaboration_settlement_items_read
on public.project_collaboration_settlement_items
for select
to authenticated
using (public.can_read_collaboration_settlement(agreement_id));

create policy project_collaboration_settlement_items_owner_write
on public.project_collaboration_settlement_items
for all
to authenticated
using (public.can_manage_project_collaboration(project_id))
with check (public.can_manage_project_collaboration(project_id));
