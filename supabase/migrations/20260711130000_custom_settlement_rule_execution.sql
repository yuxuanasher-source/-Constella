-- Phase 3 custom settlement execution persistence.
--
-- Aggregate rule grains can produce one settlement item from multiple source
-- reports. The legacy settlement_batch_items.live_report_id column remains for
-- single-report compatibility, while this junction is authoritative for new
-- duplicate detection and evidence reconstruction.

create table if not exists public.settlement_batch_item_reports (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  settlement_batch_id uuid not null references public.settlement_batches(id) on delete cascade,
  settlement_batch_item_id uuid not null references public.settlement_batch_items(id) on delete cascade,
  live_report_id uuid not null references public.live_reports(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint settlement_batch_item_reports_unique_link unique (settlement_batch_item_id, live_report_id),
  constraint settlement_batch_item_reports_unique_batch_report unique (settlement_batch_id, live_report_id)
);

create index if not exists settlement_batch_item_reports_report_idx
  on public.settlement_batch_item_reports (organization_id, live_report_id);

create index if not exists settlement_batch_item_reports_batch_idx
  on public.settlement_batch_item_reports (settlement_batch_id, live_report_id);

insert into public.settlement_batch_item_reports (
  organization_id,
  project_id,
  settlement_batch_id,
  settlement_batch_item_id,
  live_report_id
)
select
  item.organization_id,
  item.project_id,
  item.settlement_batch_id,
  item.id,
  item.live_report_id
from public.settlement_batch_items as item
where item.live_report_id is not null
on conflict do nothing;

create table if not exists public.settlement_rule_exceptions (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  settlement_batch_id uuid not null references public.settlement_batches(id) on delete cascade,
  settlement_batch_item_id uuid not null references public.settlement_batch_items(id) on delete cascade,
  live_report_id uuid references public.live_reports(id) on delete set null,
  rule_version_id uuid references public.custom_settlement_rule_versions(id),
  layer_snapshot jsonb not null default '{}'::jsonb,
  variable_name text not null,
  policy text not null,
  status text not null default 'review_required',
  resolution_value jsonb,
  resolution_reason text,
  created_by uuid references public.profiles(id),
  resolved_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  constraint settlement_rule_exceptions_status_check check (status in ('review_required', 'resolved', 'voided')),
  constraint settlement_rule_exceptions_policy_check check (policy in ('route_item_to_review', 'block_batch', 'use_explicit_default')),
  constraint settlement_rule_exceptions_resolution_complete check (
    status <> 'resolved'
    or (
      resolution_value is not null
      and nullif(trim(coalesce(resolution_reason, '')), '') is not null
      and resolved_by is not null
      and resolved_at is not null
    )
  ),
  constraint settlement_rule_exceptions_no_explicit_default_for_sensitive check (
    policy <> 'use_explicit_default'
    or variable_name !~* '(identity|evidence|auth|password|token|credential)'
  )
);

create index if not exists settlement_rule_exceptions_open_batch_idx
  on public.settlement_rule_exceptions (organization_id, settlement_batch_id, status)
  where status = 'review_required';

create index if not exists settlement_rule_exceptions_item_idx
  on public.settlement_rule_exceptions (settlement_batch_item_id, status);

create index if not exists settlement_rule_exceptions_report_idx
  on public.settlement_rule_exceptions (live_report_id)
  where live_report_id is not null;

alter table public.settlement_batch_item_reports enable row level security;
alter table public.settlement_rule_exceptions enable row level security;

create policy settlement_batch_item_reports_staff_read
on public.settlement_batch_item_reports for select
to authenticated
using (public.is_mcn_staff(organization_id) and public.can_access_project(project_id));

create policy settlement_batch_item_reports_staff_manage
on public.settlement_batch_item_reports for all
to authenticated
using (public.is_mcn_staff(organization_id) and public.can_access_project(project_id))
with check (public.is_mcn_staff(organization_id) and public.can_access_project(project_id));

create policy settlement_rule_exceptions_staff_read
on public.settlement_rule_exceptions for select
to authenticated
using (public.is_mcn_staff(organization_id) and public.can_access_project(project_id));

create policy settlement_rule_exceptions_staff_manage
on public.settlement_rule_exceptions for all
to authenticated
using (public.is_mcn_staff(organization_id) and public.can_access_project(project_id))
with check (public.is_mcn_staff(organization_id) and public.can_access_project(project_id));

revoke all on table public.settlement_batch_item_reports
  from public, anon, authenticated, service_role;
revoke all on table public.settlement_rule_exceptions
  from public, anon, authenticated, service_role;
grant select on table public.settlement_batch_item_reports to authenticated;
grant select on table public.settlement_rule_exceptions to authenticated;

create or replace function public.settlement_rule_exceptions_prevent_resolved_update_fn()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'UPDATE' and old.status in ('resolved', 'voided') then
    raise exception 'settlement_rule_exception_immutable';
  end if;
  return new;
end;
$$;

create or replace function public.settlement_rule_exceptions_prevent_locked_batch_update_fn()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_batch_status public.settlement_batch_status;
begin
  if tg_op = 'DELETE' then
    select batch.status
    into v_batch_status
    from public.settlement_batches as batch
    where batch.id = old.settlement_batch_id
    for update;
  else
    select batch.status
    into v_batch_status
    from public.settlement_batches as batch
    where batch.id = new.settlement_batch_id
    for update;
  end if;

  if v_batch_status in ('confirmed', 'locked', 'voided') then
    raise exception 'settlement_rule_exception_batch_locked';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger settlement_rule_exceptions_prevent_resolved_update
before update on public.settlement_rule_exceptions
for each row
execute function public.settlement_rule_exceptions_prevent_resolved_update_fn();

create trigger settlement_rule_exceptions_prevent_locked_batch_update
before update or delete on public.settlement_rule_exceptions
for each row
execute function public.settlement_rule_exceptions_prevent_locked_batch_update_fn();

create or replace function public.settlement_batch_item_reports_prevent_locked_batch_update_fn()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_batch_status public.settlement_batch_status;
begin
  if tg_op = 'DELETE' then
    select batch.status
    into v_batch_status
    from public.settlement_batches as batch
    where batch.id = old.settlement_batch_id
    for update;
  else
    select batch.status
    into v_batch_status
    from public.settlement_batches as batch
    where batch.id = new.settlement_batch_id
    for update;
  end if;

  if v_batch_status in ('confirmed', 'locked', 'voided') then
    raise exception 'settlement_batch_item_report_batch_locked';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger settlement_batch_item_reports_prevent_locked_batch_update
before update or delete on public.settlement_batch_item_reports
for each row
execute function public.settlement_batch_item_reports_prevent_locked_batch_update_fn();

create or replace function public.generate_settlement_batch(
  p_organization_id uuid,
  p_project_id uuid,
  p_batch_type public.settlement_batch_type,
  p_period_start date,
  p_period_end date,
  p_computed_amount numeric,
  p_manual_amount numeric,
  p_adjustment_amount numeric,
  p_evidence_summary jsonb,
  p_created_by uuid,
  p_items jsonb,
  p_title text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor_id uuid := auth.uid();
  v_actor_role text;
  v_all_report_ids uuid[] := array[]::uuid[];
  v_report_reference_count integer := 0;
  v_distinct_report_count integer := 0;
  v_report_ids jsonb;
  v_report_id_text text;
  v_report_id uuid;
  v_locked_report_count integer := 0;
  v_batch public.settlement_batches%rowtype;
  v_item jsonb;
  v_exception jsonb;
  v_item_row public.settlement_batch_items%rowtype;
  v_link_row public.settlement_batch_item_reports%rowtype;
  v_exception_row public.settlement_rule_exceptions%rowtype;
  v_items jsonb := '[]'::jsonb;
  v_links jsonb := '[]'::jsonb;
  v_exceptions jsonb := '[]'::jsonb;
  v_legacy_report_id uuid;
begin
  if auth.uid() is null or v_actor_id is null then
    raise exception 'authentication_required';
  end if;

  v_actor_role := public.current_user_role(p_organization_id);
  if not public.is_org_member(p_organization_id)
     or not public.can_access_project(p_project_id)
     or v_actor_role is null
     or v_actor_role not in (
       'owner',
       'ops_manager',
       'operator_business'
     ) then
    raise exception 'settlement_batch_generate_access_denied';
  end if;

  if p_created_by <> v_actor_id then
    raise exception 'settlement_batch_generate_actor_mismatch';
  end if;

  for v_item in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    v_report_ids := case
      when jsonb_typeof(v_item -> 'live_report_ids') = 'array' then v_item -> 'live_report_ids'
      when nullif(v_item ->> 'live_report_id', '') is not null then jsonb_build_array(v_item ->> 'live_report_id')
      else '[]'::jsonb
    end;

    for v_report_id_text in
      select value from jsonb_array_elements_text(v_report_ids)
    loop
      v_all_report_ids := array_append(v_all_report_ids, nullif(v_report_id_text, '')::uuid);
      v_report_reference_count := v_report_reference_count + 1;
    end loop;
  end loop;

  if array_length(v_all_report_ids, 1) is not null then
    select array_agg(distinct source_id)
    into v_all_report_ids
    from unnest(v_all_report_ids) as source_id;
    v_distinct_report_count := array_length(v_all_report_ids, 1);

    if v_report_reference_count <> v_distinct_report_count then
      raise exception 'settlement_batch_report_duplicate_in_payload';
    end if;

    with locked_reports as materialized (
      select report.id
      from public.live_reports as report
      where report.id = any(v_all_report_ids)
        and report.organization_id = p_organization_id
        and report.project_id = p_project_id
      for update
    )
    select count(*)
    into v_locked_report_count
    from locked_reports;

    if v_locked_report_count <> array_length(v_all_report_ids, 1) then
      raise exception 'settlement_batch_report_scope_mismatch';
    end if;

    if exists (
      select 1
      from public.settlement_batch_item_reports as link
      join public.settlement_batch_items as item
        on item.id = link.settlement_batch_item_id
      join public.settlement_batches as batch
        on batch.id = item.settlement_batch_id
      where link.live_report_id = any(v_all_report_ids)
        and batch.organization_id = p_organization_id
        and batch.batch_type = p_batch_type
    ) then
      raise exception 'settlement_batch_report_already_linked';
    end if;

    if exists (
      select 1
      from public.settlement_batch_items as item
      join public.settlement_batches as batch
        on batch.id = item.settlement_batch_id
      where item.live_report_id = any(v_all_report_ids)
        and batch.organization_id = p_organization_id
        and batch.batch_type = p_batch_type
    ) then
      raise exception 'settlement_batch_report_already_linked';
    end if;
  end if;

  insert into public.settlement_batches (
    organization_id, project_id, batch_type, status,
    period_start, period_end,
    computed_amount, manual_amount, adjustment_amount,
    evidence_summary, created_by, title
  )
  values (
    p_organization_id, p_project_id, p_batch_type, 'generated',
    p_period_start, p_period_end,
    coalesce(p_computed_amount, 0),
    coalesce(p_manual_amount, 0),
    coalesce(p_adjustment_amount, 0),
    coalesce(p_evidence_summary, '{}'::jsonb),
    p_created_by,
    nullif(trim(coalesce(p_title, '')), '')
  )
  returning * into v_batch;

  for v_item in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    v_report_ids := case
      when jsonb_typeof(v_item -> 'live_report_ids') = 'array' then v_item -> 'live_report_ids'
      when nullif(v_item ->> 'live_report_id', '') is not null then jsonb_build_array(v_item ->> 'live_report_id')
      else '[]'::jsonb
    end;
    v_legacy_report_id := null;

    if jsonb_array_length(v_report_ids) = 1 then
      select nullif(value, '')::uuid
      into v_legacy_report_id
      from jsonb_array_elements_text(v_report_ids);
    end if;

    insert into public.settlement_batch_items (
      organization_id, settlement_batch_id, project_id,
      streamer_id, live_report_id, item_type,
      computed_amount, manual_amount, adjustment_amount,
      evidence_level, evidence_snapshot
    )
    values (
      p_organization_id, v_batch.id, p_project_id,
      nullif(v_item->>'streamer_id', '')::uuid,
      v_legacy_report_id,
      coalesce(nullif(v_item->>'item_type', ''), 'live_report'),
      coalesce((v_item->>'computed_amount')::numeric, 0),
      coalesce((v_item->>'manual_amount')::numeric, 0),
      coalesce((v_item->>'adjustment_amount')::numeric, 0),
      nullif(v_item->>'evidence_level', '')::public.evidence_level,
      coalesce(v_item->'evidence_snapshot', '{}'::jsonb)
    )
    returning * into v_item_row;

    v_items := v_items || to_jsonb(v_item_row);

    for v_report_id_text in
      select value from jsonb_array_elements_text(v_report_ids)
    loop
      v_report_id := nullif(v_report_id_text, '')::uuid;
      insert into public.settlement_batch_item_reports (
        organization_id,
        project_id,
        settlement_batch_id,
        settlement_batch_item_id,
        live_report_id
      )
      values (
        p_organization_id,
        p_project_id,
        v_batch.id,
        v_item_row.id,
        v_report_id
      )
      returning * into v_link_row;

      v_links := v_links || to_jsonb(v_link_row);
    end loop;

    if jsonb_array_length(v_report_ids) = 1 and v_legacy_report_id is not null then
      update public.live_reports
        set settled_batch_item_id = v_item_row.id
      where id = v_legacy_report_id
        and organization_id = p_organization_id
        and project_id = p_project_id
        and settled_batch_item_id is null;
    end if;

    for v_exception in
      select * from jsonb_array_elements(coalesce(v_item -> 'exceptions', '[]'::jsonb))
    loop
      insert into public.settlement_rule_exceptions (
        organization_id,
        project_id,
        settlement_batch_id,
        settlement_batch_item_id,
        live_report_id,
        rule_version_id,
        layer_snapshot,
        variable_name,
        policy,
        status,
        resolution_value,
        resolution_reason,
        created_by
      )
      values (
        p_organization_id,
        p_project_id,
        v_batch.id,
        v_item_row.id,
        nullif(v_exception ->> 'live_report_id', '')::uuid,
        nullif(v_exception ->> 'rule_version_id', '')::uuid,
        coalesce(v_exception -> 'layer_snapshot', '{}'::jsonb),
        nullif(v_exception ->> 'variable_name', ''),
        coalesce(nullif(v_exception ->> 'policy', ''), 'route_item_to_review'),
        'review_required',
        v_exception -> 'resolution_value',
        nullif(v_exception ->> 'resolution_reason', ''),
        coalesce(nullif(v_exception ->> 'created_by', '')::uuid, p_created_by)
      )
      returning * into v_exception_row;

      v_exceptions := v_exceptions || to_jsonb(v_exception_row);
    end loop;
  end loop;

  return jsonb_build_object(
    'batch', to_jsonb(v_batch),
    'items', v_items,
    'links', v_links,
    'exceptions', v_exceptions
  );
end;
$$;

create or replace function public.resolve_settlement_rule_exception(
  p_organization_id uuid,
  p_exception_id uuid,
  p_settlement_batch_item_id uuid,
  p_old_computed_amount numeric,
  p_new_computed_amount numeric,
  p_resolution_value jsonb,
  p_resolution_reason text,
  p_resolved_by uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor_id uuid := auth.uid();
  v_actor_role text;
  v_exception public.settlement_rule_exceptions%rowtype;
  v_item public.settlement_batch_items%rowtype;
  v_batch public.settlement_batches%rowtype;
  v_open_sibling_count integer := 0;
begin
  if auth.uid() is null or v_actor_id is null then
    raise exception 'authentication_required';
  end if;

  if nullif(trim(coalesce(p_resolution_reason, '')), '') is null then
    raise exception 'settlement_rule_exception_resolution_reason_required';
  end if;

  select *
  into v_exception
  from public.settlement_rule_exceptions
  where id = p_exception_id
    and organization_id = p_organization_id
  for update;

  if not found then
    raise exception 'settlement_rule_exception_not_found';
  end if;

  if v_exception.status <> 'review_required' then
    raise exception 'settlement_rule_exception_not_open';
  end if;

  v_actor_role := public.current_user_role(p_organization_id);
  if not public.is_org_member(p_organization_id)
     or not public.can_access_project(v_exception.project_id)
     or v_actor_role is null
     or v_actor_role not in (
       'owner',
       'ops_manager',
       'operator_business'
     ) then
    raise exception 'settlement_rule_exception_resolve_access_denied';
  end if;

  if p_resolved_by <> v_actor_id then
    raise exception 'settlement_rule_exception_resolver_mismatch';
  end if;

  select *
  into v_item
  from public.settlement_batch_items
  where id = p_settlement_batch_item_id
    and id = v_exception.settlement_batch_item_id
    and organization_id = p_organization_id
  for update;

  if not found then
    raise exception 'settlement_rule_exception_item_mismatch';
  end if;

  if v_item.computed_amount <> p_old_computed_amount then
    raise exception 'settlement_rule_exception_stale_amount';
  end if;

  select *
  into v_batch
  from public.settlement_batches
  where id = v_exception.settlement_batch_id
    and id = v_item.settlement_batch_id
    and organization_id = p_organization_id
  for update;

  if not found then
    raise exception 'settlement_rule_exception_batch_mismatch';
  end if;

  if v_batch.status in ('confirmed', 'locked', 'voided') then
    raise exception 'settlement_rule_exception_batch_locked';
  end if;

  with open_siblings as (
    select sibling.id
    from public.settlement_rule_exceptions as sibling
    where sibling.settlement_batch_item_id = v_item.id
      and sibling.id <> v_exception.id
      and sibling.status = 'review_required'
    for update
  )
  select count(*)
  into v_open_sibling_count
  from open_siblings;

  update public.settlement_rule_exceptions
  set
    status = 'resolved',
    resolution_value = p_resolution_value,
    resolution_reason = p_resolution_reason,
    resolved_by = p_resolved_by,
    resolved_at = statement_timestamp()
  where id = v_exception.id
  returning * into v_exception;

  if v_open_sibling_count = 0 then
    update public.settlement_batch_items
    set
      computed_amount = p_new_computed_amount,
      evidence_snapshot = jsonb_set(
        coalesce(evidence_snapshot, '{}'::jsonb),
        '{ruleExceptionResolution}',
        jsonb_build_object(
          'exceptionId', p_exception_id,
          'oldComputedAmount', p_old_computed_amount,
          'newComputedAmount', p_new_computed_amount,
          'resolvedBy', p_resolved_by,
          'resolvedAt', statement_timestamp()
        ),
        true
      )
    where id = v_item.id
    returning * into v_item;

    update public.settlement_batches
    set computed_amount = computed_amount + (p_new_computed_amount - p_old_computed_amount)
    where id = v_batch.id
    returning * into v_batch;
  end if;

  return jsonb_build_object(
    'batch', to_jsonb(v_batch),
    'item', to_jsonb(v_item),
    'exception', to_jsonb(v_exception)
  );
end;
$$;

revoke all on function public.generate_settlement_batch(
  uuid,
  uuid,
  public.settlement_batch_type,
  date,
  date,
  numeric,
  numeric,
  numeric,
  jsonb,
  uuid,
  jsonb,
  text
) from public, anon, authenticated, service_role;
grant execute on function public.generate_settlement_batch(
  uuid,
  uuid,
  public.settlement_batch_type,
  date,
  date,
  numeric,
  numeric,
  numeric,
  jsonb,
  uuid,
  jsonb,
  text
) to authenticated;

revoke all on function public.resolve_settlement_rule_exception(
  uuid,
  uuid,
  uuid,
  numeric,
  numeric,
  jsonb,
  text,
  uuid
) from public, anon, authenticated, service_role;
grant execute on function public.resolve_settlement_rule_exception(
  uuid,
  uuid,
  uuid,
  numeric,
  numeric,
  jsonb,
  text,
  uuid
) to authenticated;
