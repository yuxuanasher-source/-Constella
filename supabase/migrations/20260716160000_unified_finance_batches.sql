create table if not exists public.finance_batches (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  batch_type text not null,
  title text,
  period_start date not null,
  period_end date not null,
  status text not null default 'draft',
  has_exceptions boolean not null default false,
  system_amount numeric(14, 2) not null default 0,
  adjustment_amount numeric(14, 2) not null default 0,
  final_amount numeric(14, 2) not null default 0,
  item_count integer not null default 0 check (item_count >= 0),
  exception_count integer not null default 0 check (exception_count >= 0),
  created_by uuid references public.profiles(id),
  submitted_by uuid references public.profiles(id),
  confirmed_by uuid references public.profiles(id),
  locked_by uuid references public.profiles(id),
  exported_by uuid references public.profiles(id),
  completed_by uuid references public.profiles(id),
  reopened_by uuid references public.profiles(id),
  voided_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  submitted_at timestamptz,
  confirmed_at timestamptz,
  locked_at timestamptz,
  exported_at timestamptz,
  completed_at timestamptz,
  reopened_at timestamptz,
  voided_at timestamptz,
  status_reason text,
  metadata jsonb not null default '{}'::jsonb,
  constraint finance_batches_period_check check (period_end >= period_start),
  constraint finance_batches_batch_type_check check (
    batch_type in ('receivable', 'streamer_payable', 'project_cost', 'collaboration_share')
  ),
  constraint finance_batches_status_check check (
    status in ('draft', 'pending_review', 'confirmed', 'locked', 'exported', 'completed', 'rejected', 'reopened', 'voided')
  ),
  constraint finance_batches_amount_check check (
    final_amount = system_amount + adjustment_amount
  )
);

create table if not exists public.finance_batch_items (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  finance_batch_id uuid not null references public.finance_batches(id) on delete cascade,
  batch_type text not null,
  project_id uuid not null references public.projects(id) on delete cascade,
  counterparty_type text not null,
  counterparty_id uuid,
  counterparty_name_snapshot text,
  source_type text not null,
  source_id uuid not null,
  source_snapshot jsonb not null default '{}'::jsonb,
  system_amount numeric(14, 2) not null default 0,
  adjustment_amount numeric(14, 2) not null default 0,
  final_amount numeric(14, 2) not null default 0,
  evidence_level text,
  evidence_snapshot jsonb not null default '{}'::jsonb,
  status text not null default 'active',
  exception_flags jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint finance_batch_items_batch_type_check check (
    batch_type in ('receivable', 'streamer_payable', 'project_cost', 'collaboration_share')
  ),
  constraint finance_batch_items_counterparty_type_check check (
    counterparty_type in ('customer', 'streamer', 'project', 'collaboration_partner')
  ),
  constraint finance_batch_items_status_check check (
    status in ('active', 'voided')
  ),
  constraint finance_batch_items_amount_check check (
    final_amount = system_amount + adjustment_amount
  )
);

create table if not exists public.finance_batch_adjustments (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  finance_batch_id uuid not null references public.finance_batches(id) on delete cascade,
  finance_batch_item_id uuid references public.finance_batch_items(id) on delete cascade,
  direction text not null,
  amount numeric(14, 2) not null,
  reason text not null,
  evidence_snapshot jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  voided_by uuid references public.profiles(id),
  voided_at timestamptz,
  void_reason text,
  constraint finance_batch_adjustments_direction_check check (
    direction in ('increase', 'decrease')
  ),
  constraint finance_batch_adjustments_amount_check check (amount > 0),
  constraint finance_batch_adjustments_reason_check check (
    nullif(trim(reason), '') is not null
  ),
  constraint finance_batch_adjustments_void_reason_check check (
    voided_at is null or nullif(trim(coalesce(void_reason, '')), '') is not null
  )
);

create index if not exists finance_batches_org_status_idx
  on public.finance_batches (organization_id, status, updated_at desc);

create index if not exists finance_batches_org_type_period_idx
  on public.finance_batches (
    organization_id,
    batch_type,
    period_start,
    period_end
  );

create index if not exists finance_batch_items_batch_idx
  on public.finance_batch_items (organization_id, finance_batch_id, created_at);

create index if not exists finance_batch_items_project_idx
  on public.finance_batch_items (organization_id, project_id, batch_type);

create unique index if not exists finance_batch_items_active_source_uidx
  on public.finance_batch_items (
    organization_id,
    batch_type,
    source_type,
    source_id
  )
  where status = 'active';

create index if not exists finance_batch_adjustments_batch_idx
  on public.finance_batch_adjustments (
    organization_id,
    finance_batch_id,
    created_at
  )
  where voided_at is null;

create or replace view public.finance_batch_project_summary as
select
  item.organization_id,
  item.finance_batch_id,
  item.project_id,
  sum(case when item.batch_type = 'receivable' then item.final_amount else 0 end) as receivable_amount,
  sum(case when item.batch_type = 'streamer_payable' then item.final_amount else 0 end) as streamer_payable_amount,
  sum(case when item.batch_type = 'project_cost' then item.final_amount else 0 end) as project_cost_amount,
  sum(case when item.batch_type = 'collaboration_share' then item.final_amount else 0 end) as collaboration_share_amount,
  sum(case when item.batch_type = 'receivable' then item.final_amount else 0 end)
    - sum(case when item.batch_type = 'streamer_payable' then item.final_amount else 0 end)
    - sum(case when item.batch_type = 'project_cost' then item.final_amount else 0 end)
    - sum(case when item.batch_type = 'collaboration_share' then item.final_amount else 0 end) as gross_margin_impact,
  count(*)::integer as item_count,
  count(*) filter (where jsonb_array_length(item.exception_flags) > 0)::integer as exception_count
from public.finance_batch_items as item
join public.finance_batches as batch on batch.id = item.finance_batch_id
where item.status = 'active'
  and batch.status <> 'voided'
group by item.organization_id, item.finance_batch_id, item.project_id;

alter table public.finance_batches enable row level security;
alter table public.finance_batch_items enable row level security;
alter table public.finance_batch_adjustments enable row level security;

create policy finance_batches_staff_read
on public.finance_batches for select
to authenticated
using (public.is_mcn_staff(organization_id));

create policy finance_batch_items_staff_read
on public.finance_batch_items for select
to authenticated
using (public.is_mcn_staff(organization_id));

create policy finance_batch_adjustments_staff_read
on public.finance_batch_adjustments for select
to authenticated
using (public.is_mcn_staff(organization_id));

revoke all on table public.finance_batches
  from public, anon, authenticated, service_role;
revoke all on table public.finance_batch_items
  from public, anon, authenticated, service_role;
revoke all on table public.finance_batch_adjustments
  from public, anon, authenticated, service_role;
revoke all on table public.finance_batch_project_summary
  from public, anon, authenticated, service_role;
grant select on table public.finance_batches to authenticated;
grant select on table public.finance_batch_items to authenticated;
grant select on table public.finance_batch_adjustments to authenticated;
grant select on table public.finance_batch_project_summary to authenticated;
