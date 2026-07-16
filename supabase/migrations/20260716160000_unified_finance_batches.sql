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
  constraint finance_batches_id_org_key unique (id, organization_id),
  constraint finance_batches_id_org_type_key unique (id, organization_id, batch_type),
  constraint finance_batches_period_check check (period_end >= period_start),
  constraint finance_batches_batch_type_check check (
    batch_type in ('receivable', 'streamer_payable', 'project_cost', 'collaboration_share')
  ),
  constraint finance_batches_status_check check (
    status in ('draft', 'pending_review', 'confirmed', 'locked', 'exported', 'completed', 'rejected', 'reopened', 'voided')
  ),
  constraint finance_batches_amount_check check (
    final_amount = system_amount + adjustment_amount
  ),
  constraint finance_batches_metadata_shape_check check (
    jsonb_typeof(metadata) = 'object'
  )
);

create table if not exists public.finance_batch_items (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  finance_batch_id uuid not null,
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
  constraint finance_batch_items_id_batch_org_key unique (
    id,
    finance_batch_id,
    organization_id
  ),
  constraint finance_batch_items_batch_org_type_fkey foreign key (
    finance_batch_id,
    organization_id,
    batch_type
  ) references public.finance_batches (
    id,
    organization_id,
    batch_type
  ) on delete cascade,
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
  ),
  constraint finance_batch_items_source_snapshot_shape_check check (
    jsonb_typeof(source_snapshot) = 'object'
  ),
  constraint finance_batch_items_evidence_snapshot_shape_check check (
    jsonb_typeof(evidence_snapshot) = 'object'
  ),
  constraint finance_batch_items_exception_flags_shape_check check (
    jsonb_typeof(exception_flags) = 'array'
  )
);

create table if not exists public.finance_batch_adjustments (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  finance_batch_id uuid not null,
  finance_batch_item_id uuid,
  direction text not null,
  amount numeric(14, 2) not null,
  reason text not null,
  evidence_snapshot jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  voided_by uuid references public.profiles(id),
  voided_at timestamptz,
  void_reason text,
  constraint finance_batch_adjustments_batch_org_fkey foreign key (
    finance_batch_id,
    organization_id
  ) references public.finance_batches (
    id,
    organization_id
  ) on delete cascade,
  constraint finance_batch_adjustments_item_batch_org_fkey foreign key (
    finance_batch_item_id,
    finance_batch_id,
    organization_id
  ) references public.finance_batch_items (
    id,
    finance_batch_id,
    organization_id
  ) on delete cascade,
  constraint finance_batch_adjustments_direction_check check (
    direction in ('increase', 'decrease')
  ),
  constraint finance_batch_adjustments_amount_check check (amount > 0),
  constraint finance_batch_adjustments_reason_check check (
    nullif(trim(reason), '') is not null
  ),
  constraint finance_batch_adjustments_void_reason_check check (
    voided_at is null or nullif(trim(coalesce(void_reason, '')), '') is not null
  ),
  constraint finance_batch_adjustments_evidence_snapshot_shape_check check (
    jsonb_typeof(evidence_snapshot) = 'object'
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

create trigger finance_batches_touch_updated_at
before update on public.finance_batches
for each row
execute function public.touch_updated_at();

create trigger finance_batch_items_touch_updated_at
before update on public.finance_batch_items
for each row
execute function public.touch_updated_at();

create trigger finance_batch_adjustments_touch_updated_at
before update on public.finance_batch_adjustments
for each row
execute function public.touch_updated_at();

create or replace function public.finance_batches_void_items_fn()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.status = 'voided' and old.status is distinct from 'voided' then
    update public.finance_batch_items
    set status = 'voided'
    where finance_batch_id = new.id
      and organization_id = new.organization_id
      and status <> 'voided';
  end if;

  return new;
end;
$$;

create trigger finance_batches_void_items
after update of status on public.finance_batches
for each row
execute function public.finance_batches_void_items_fn();

create or replace view public.finance_batch_project_summary
with (security_invoker = true)
as
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

create or replace function public.create_finance_batch(
  p_organization_id uuid,
  p_batch_type text,
  p_title text,
  p_period_start date,
  p_period_end date,
  p_system_amount numeric,
  p_adjustment_amount numeric,
  p_final_amount numeric,
  p_created_by uuid,
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor_id uuid := auth.uid();
  v_batch public.finance_batches%rowtype;
  v_item jsonb;
  v_item_row public.finance_batch_items%rowtype;
  v_items jsonb := '[]'::jsonb;
  v_project_id uuid;
  v_counterparty_type text;
  v_source_type text;
  v_source_id uuid;
begin
  if v_actor_id is null then
    raise exception 'authentication_required';
  end if;

  if p_created_by <> v_actor_id then
    raise exception 'finance_batch_create_actor_mismatch';
  end if;

  if not public.is_org_member(p_organization_id)
     or not public.is_mcn_staff(p_organization_id) then
    raise exception 'finance_batch_create_access_denied';
  end if;

  if jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array' then
    raise exception 'finance_batch_items_invalid';
  end if;

  insert into public.finance_batches (
    organization_id,
    batch_type,
    title,
    period_start,
    period_end,
    system_amount,
    adjustment_amount,
    final_amount,
    item_count,
    created_by
  )
  values (
    p_organization_id,
    p_batch_type,
    p_title,
    p_period_start,
    p_period_end,
    p_system_amount,
    p_adjustment_amount,
    p_final_amount,
    coalesce(jsonb_array_length(coalesce(p_items, '[]'::jsonb)), 0),
    p_created_by
  )
  returning * into v_batch;

  for v_item in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    v_project_id := nullif(v_item ->> 'project_id', '')::uuid;
    v_counterparty_type := nullif(v_item ->> 'counterparty_type', '');
    v_source_type := nullif(v_item ->> 'source_type', '');
    v_source_id := nullif(v_item ->> 'source_id', '')::uuid;

    if v_project_id is null
       or v_counterparty_type is null
       or v_source_type is null
       or v_source_id is null then
      raise exception 'finance_batch_item_required_fields_missing';
    end if;

    if not exists (
      select 1
      from public.projects as project
      where project.id = v_project_id
        and project.organization_id = p_organization_id
    ) then
      raise exception 'finance_batch_item_project_scope_mismatch';
    end if;

    insert into public.finance_batch_items (
      organization_id,
      finance_batch_id,
      batch_type,
      project_id,
      counterparty_type,
      counterparty_id,
      counterparty_name_snapshot,
      source_type,
      source_id,
      source_snapshot,
      system_amount,
      adjustment_amount,
      final_amount,
      evidence_level,
      evidence_snapshot,
      exception_flags
    )
    values (
      p_organization_id,
      v_batch.id,
      p_batch_type,
      v_project_id,
      v_counterparty_type,
      nullif(v_item ->> 'counterparty_id', '')::uuid,
      nullif(v_item ->> 'counterparty_name_snapshot', ''),
      v_source_type,
      v_source_id,
      coalesce(v_item -> 'source_snapshot', '{}'::jsonb),
      coalesce((v_item ->> 'system_amount')::numeric, 0),
      coalesce((v_item ->> 'adjustment_amount')::numeric, 0),
      coalesce((v_item ->> 'final_amount')::numeric, 0),
      nullif(v_item ->> 'evidence_level', ''),
      coalesce(v_item -> 'evidence_snapshot', '{}'::jsonb),
      coalesce(v_item -> 'exception_flags', '[]'::jsonb)
    )
    returning * into v_item_row;

    v_items := v_items || to_jsonb(v_item_row);
  end loop;

  return jsonb_build_object(
    'batch',
    to_jsonb(v_batch),
    'items',
    v_items
  );
end;
$$;

create or replace function public.add_finance_batch_adjustment(
  p_organization_id uuid,
  p_finance_batch_id uuid,
  p_finance_batch_item_id uuid,
  p_direction text,
  p_amount numeric,
  p_reason text,
  p_evidence_snapshot jsonb,
  p_created_by uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor_id uuid := auth.uid();
  v_batch public.finance_batches%rowtype;
  v_item public.finance_batch_items%rowtype;
  v_adjustment public.finance_batch_adjustments%rowtype;
  v_signed_amount numeric(14, 2);
begin
  if v_actor_id is null then
    raise exception 'authentication_required';
  end if;

  if p_created_by <> v_actor_id then
    raise exception 'finance_batch_adjustment_actor_mismatch';
  end if;

  if not public.is_org_member(p_organization_id)
     or not public.is_mcn_staff(p_organization_id) then
    raise exception 'finance_batch_adjustment_access_denied';
  end if;

  if p_direction not in ('increase', 'decrease') then
    raise exception 'finance_batch_adjustment_direction_invalid';
  end if;

  v_signed_amount := case
    when p_direction = 'increase' then p_amount
    else -p_amount
  end;

  select *
  into v_batch
  from public.finance_batches
  where id = p_finance_batch_id
    and organization_id = p_organization_id
  for update;

  if not found then
    raise exception 'finance_batch_not_found';
  end if;

  if v_batch.status in ('locked', 'exported', 'completed', 'voided') then
    raise exception 'finance_batch_adjustment_not_allowed';
  end if;

  if p_finance_batch_item_id is not null then
    select *
    into v_item
    from public.finance_batch_items
    where id = p_finance_batch_item_id
      and finance_batch_id = p_finance_batch_id
      and organization_id = p_organization_id
    for update;

    if not found then
      raise exception 'finance_batch_adjustment_item_scope_mismatch';
    end if;
  end if;

  insert into public.finance_batch_adjustments (
    organization_id,
    finance_batch_id,
    finance_batch_item_id,
    direction,
    amount,
    reason,
    evidence_snapshot,
    created_by
  )
  values (
    p_organization_id,
    p_finance_batch_id,
    p_finance_batch_item_id,
    p_direction,
    p_amount,
    p_reason,
    coalesce(p_evidence_snapshot, '{}'::jsonb),
    p_created_by
  )
  returning * into v_adjustment;

  if p_finance_batch_item_id is not null then
    update public.finance_batch_items
    set
      adjustment_amount = adjustment_amount + v_signed_amount,
      final_amount = final_amount + v_signed_amount
    where id = p_finance_batch_item_id
      and finance_batch_id = p_finance_batch_id
      and organization_id = p_organization_id;
  end if;

  update public.finance_batches
  set
    adjustment_amount = adjustment_amount + v_signed_amount,
    final_amount = final_amount + v_signed_amount
  where id = p_finance_batch_id
    and organization_id = p_organization_id
  returning * into v_batch;

  return jsonb_build_object(
    'batch',
    to_jsonb(v_batch),
    'adjustment',
    to_jsonb(v_adjustment)
  );
end;
$$;

create or replace function public.transition_finance_batch(
  p_organization_id uuid,
  p_finance_batch_id uuid,
  p_next_status text,
  p_actor_user_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor_id uuid := auth.uid();
  v_batch public.finance_batches%rowtype;
begin
  if v_actor_id is null then
    raise exception 'authentication_required';
  end if;

  if p_actor_user_id <> v_actor_id then
    raise exception 'finance_batch_transition_actor_mismatch';
  end if;

  if not public.is_org_member(p_organization_id)
     or not public.is_mcn_staff(p_organization_id) then
    raise exception 'finance_batch_transition_access_denied';
  end if;

  if p_next_status not in (
    'draft',
    'pending_review',
    'confirmed',
    'locked',
    'exported',
    'completed',
    'rejected',
    'reopened',
    'voided'
  ) then
    raise exception 'finance_batch_status_invalid';
  end if;

  update public.finance_batches
  set
    status = p_next_status,
    status_reason = p_reason,
    submitted_by = case when p_next_status = 'pending_review' then p_actor_user_id else submitted_by end,
    submitted_at = case when p_next_status = 'pending_review' then statement_timestamp() else submitted_at end,
    confirmed_by = case when p_next_status = 'confirmed' then p_actor_user_id else confirmed_by end,
    confirmed_at = case when p_next_status = 'confirmed' then statement_timestamp() else confirmed_at end,
    locked_by = case when p_next_status = 'locked' then p_actor_user_id else locked_by end,
    locked_at = case when p_next_status = 'locked' then statement_timestamp() else locked_at end,
    exported_by = case when p_next_status = 'exported' then p_actor_user_id else exported_by end,
    exported_at = case when p_next_status = 'exported' then statement_timestamp() else exported_at end,
    completed_by = case when p_next_status = 'completed' then p_actor_user_id else completed_by end,
    completed_at = case when p_next_status = 'completed' then statement_timestamp() else completed_at end,
    reopened_by = case when p_next_status = 'reopened' then p_actor_user_id else reopened_by end,
    reopened_at = case when p_next_status = 'reopened' then statement_timestamp() else reopened_at end,
    voided_by = case when p_next_status = 'voided' then p_actor_user_id else voided_by end,
    voided_at = case when p_next_status = 'voided' then statement_timestamp() else voided_at end
  where id = p_finance_batch_id
    and organization_id = p_organization_id
  returning * into v_batch;

  if not found then
    raise exception 'finance_batch_not_found';
  end if;

  return jsonb_build_object('batch', to_jsonb(v_batch));
end;
$$;

revoke all on function public.finance_batches_void_items_fn()
  from public, anon, authenticated, service_role;

revoke all on function public.create_finance_batch(
  uuid,
  text,
  text,
  date,
  date,
  numeric,
  numeric,
  numeric,
  uuid,
  jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.create_finance_batch(
  uuid,
  text,
  text,
  date,
  date,
  numeric,
  numeric,
  numeric,
  uuid,
  jsonb
) to authenticated;

revoke all on function public.add_finance_batch_adjustment(
  uuid,
  uuid,
  uuid,
  text,
  numeric,
  text,
  jsonb,
  uuid
) from public, anon, authenticated, service_role;
grant execute on function public.add_finance_batch_adjustment(
  uuid,
  uuid,
  uuid,
  text,
  numeric,
  text,
  jsonb,
  uuid
) to authenticated;

revoke all on function public.transition_finance_batch(
  uuid,
  uuid,
  text,
  uuid,
  text
) from public, anon, authenticated, service_role;
grant execute on function public.transition_finance_batch(
  uuid,
  uuid,
  text,
  uuid,
  text
) to authenticated;
