-- Phase 4 Task 2: idempotent custom cost provenance and reconciliation runs.

alter table public.project_cost_items
  add column if not exists source_rule_version_id uuid references public.custom_settlement_rule_versions(id),
  add column if not exists source_import_batch_id uuid references public.project_cost_import_batches(id),
  add column if not exists source_execution_key text,
  add column if not exists source_input_hash text,
  add column if not exists source_explanation text;

create unique index if not exists project_cost_items_source_execution_key_uidx
  on public.project_cost_items (organization_id, source_execution_key)
  where source_execution_key is not null;

create table if not exists public.external_cost_rule_exceptions (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  import_batch_id uuid not null references public.project_cost_import_batches(id) on delete cascade,
  import_row_index integer not null check (import_row_index >= 0),
  rule_version_id uuid references public.custom_settlement_rule_versions(id),
  variable_name text not null,
  policy text not null,
  source_context_snapshot jsonb not null default '{}'::jsonb,
  status text not null default 'review_required',
  resolution_value jsonb,
  resolution_reason text,
  created_by uuid references public.profiles(id),
  resolved_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  constraint external_cost_rule_exceptions_status_check check (status in ('review_required', 'resolved', 'voided')),
  constraint external_cost_rule_exceptions_policy_check check (policy in ('route_item_to_review', 'block_batch', 'use_explicit_default')),
  constraint external_cost_rule_exceptions_resolution_complete check (
    status <> 'resolved'
    or (
      resolution_value is not null
      and nullif(trim(coalesce(resolution_reason, '')), '') is not null
      and resolved_by is not null
      and resolved_at is not null
    )
  ),
  constraint external_cost_rule_exceptions_no_default_for_sensitive check (
    policy <> 'use_explicit_default'
    or variable_name !~* '(identity|evidence|auth|password|token|credential)'
  )
);

create unique index if not exists external_cost_rule_exceptions_variable_uidx
  on public.external_cost_rule_exceptions (
    organization_id,
    import_batch_id,
    import_row_index,
    variable_name
  );

create index if not exists external_cost_rule_exceptions_open_batch_idx
  on public.external_cost_rule_exceptions (
    organization_id,
    project_id,
    import_batch_id,
    status
  )
  where status = 'review_required';

create table if not exists public.settlement_reconciliation_runs (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  trigger_type text not null,
  trigger_batch_id uuid,
  core_input_hash text not null,
  core_result jsonb not null default '{}'::jsonb,
  rule_version_id uuid references public.custom_settlement_rule_versions(id),
  formula_hash text,
  custom_checks jsonb not null default '{}'::jsonb,
  final_checks jsonb not null default '{}'::jsonb,
  blocked boolean not null default false,
  warnings jsonb not null default '[]'::jsonb,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  constraint settlement_reconciliation_runs_period_check check (period_end >= period_start),
  constraint settlement_reconciliation_runs_trigger_check check (
    trigger_type in ('manual', 'import_batch', 'settlement_batch', 'scheduled')
  )
);

create index if not exists settlement_reconciliation_runs_project_period_idx
  on public.settlement_reconciliation_runs (
    organization_id,
    project_id,
    period_start,
    period_end,
    created_at
  );

create table if not exists public.cost_import_confirmation_requests (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  import_batch_id uuid not null references public.project_cost_import_batches(id) on delete cascade,
  idempotency_key text not null,
  input_hash text not null,
  mode text not null check (mode in ('legacy', 'custom')),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  constraint cost_import_confirmation_requests_idempotency_uidx unique (organization_id, idempotency_key)
);

alter table public.external_cost_rule_exceptions enable row level security;
alter table public.settlement_reconciliation_runs enable row level security;
alter table public.cost_import_confirmation_requests enable row level security;

create policy external_cost_rule_exceptions_staff_read
on public.external_cost_rule_exceptions for select
to authenticated
using (public.is_mcn_staff(organization_id) and public.can_access_project(project_id));

create policy settlement_reconciliation_runs_staff_read
on public.settlement_reconciliation_runs for select
to authenticated
using (public.is_mcn_staff(organization_id) and public.can_access_project(project_id));

create policy cost_import_confirmation_requests_no_direct_access
on public.cost_import_confirmation_requests for select
to authenticated
using (false);

revoke all on table public.external_cost_rule_exceptions
  from public, anon, authenticated, service_role;
revoke all on table public.settlement_reconciliation_runs
  from public, anon, authenticated, service_role;
revoke all on table public.cost_import_confirmation_requests
  from public, anon, authenticated, service_role;
grant select on table public.external_cost_rule_exceptions to authenticated;
grant select on table public.settlement_reconciliation_runs to authenticated;

create or replace function public.external_cost_rule_exceptions_prevent_resolved_update_fn()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'UPDATE' and old.status in ('resolved', 'voided') then
    raise exception 'external_cost_exception_immutable';
  end if;
  return new;
end;
$$;

create trigger external_cost_rule_exceptions_prevent_resolved_update
before update on public.external_cost_rule_exceptions
for each row
execute function public.external_cost_rule_exceptions_prevent_resolved_update_fn();

create or replace function public.settlement_reconciliation_runs_prevent_mutation_fn()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  raise exception 'settlement_reconciliation_run_immutable';
end;
$$;

create trigger settlement_reconciliation_runs_prevent_update
before update on public.settlement_reconciliation_runs
for each row
execute function public.settlement_reconciliation_runs_prevent_mutation_fn();

create trigger settlement_reconciliation_runs_prevent_delete
before delete on public.settlement_reconciliation_runs
for each row
execute function public.settlement_reconciliation_runs_prevent_mutation_fn();

create or replace function public.confirm_cost_import_with_rule_items(
  p_organization_id uuid,
  p_project_id uuid,
  p_import_batch_id uuid,
  p_idempotency_key text,
  p_input_hash text,
  p_mode text,
  p_reason text,
  p_created_by uuid,
  p_legacy_items jsonb default null,
  p_custom_items jsonb default null,
  p_exceptions jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor_id uuid := auth.uid();
  v_actor_role text;
  v_batch public.project_cost_import_batches%rowtype;
  v_request public.cost_import_confirmation_requests%rowtype;
  v_item jsonb;
  v_exception jsonb;
  v_items jsonb := '[]'::jsonb;
  v_exceptions jsonb := '[]'::jsonb;
  v_item_row public.project_cost_items%rowtype;
  v_existing_cost_item public.project_cost_items%rowtype;
  v_exception_row public.external_cost_rule_exceptions%rowtype;
  v_item_source_execution_key text;
  v_item_source_input_hash text;
  v_item_rule_version_id uuid;
  v_legacy_count integer := coalesce(jsonb_array_length(coalesce(p_legacy_items, '[]'::jsonb)), 0);
  v_custom_count integer := coalesce(jsonb_array_length(coalesce(p_custom_items, '[]'::jsonb)), 0);
  v_exception_count integer := coalesce(jsonb_array_length(coalesce(p_exceptions, '[]'::jsonb)), 0);
begin
  if v_actor_id is null then
    raise exception 'authentication_required';
  end if;

  if p_created_by <> v_actor_id then
    raise exception 'confirm_cost_import_actor_mismatch';
  end if;

  if nullif(trim(coalesce(p_idempotency_key, '')), '') is null
     or nullif(trim(coalesce(p_input_hash, '')), '') is null then
    raise exception 'confirm_cost_import_idempotency_required';
  end if;

  if p_mode not in ('legacy', 'custom') then
    raise exception 'confirm_cost_import_mode_invalid';
  end if;

  if (p_mode = 'legacy' and v_custom_count > 0)
     or (p_mode = 'legacy' and v_exception_count > 0)
     or (p_mode = 'custom' and v_legacy_count > 0) then
    raise exception 'confirm_cost_import_modes_conflict';
  end if;

  v_actor_role := public.current_user_role(p_organization_id);
  if not public.is_org_member(p_organization_id)
     or not public.can_access_project(p_project_id)
     or v_actor_role is null
     or v_actor_role not in ('owner', 'ops_manager', 'operator_business') then
    raise exception 'confirm_cost_import_access_denied';
  end if;

  if not exists (
    select 1
    from public.project_complex_cost_rule_entitlements as entitlement
    where entitlement.organization_id = p_organization_id
      and entitlement.project_id = p_project_id
  ) then
    raise exception 'confirm_cost_import_entitlement_required';
  end if;

  select *
  into v_batch
  from public.project_cost_import_batches
  where id = p_import_batch_id
    and organization_id = p_organization_id
    and project_id = p_project_id
  for update;

  if not found then
    raise exception 'confirm_cost_import_batch_not_found';
  end if;

  select *
  into v_request
  from public.cost_import_confirmation_requests
  where organization_id = p_organization_id
    and idempotency_key = p_idempotency_key
  for update;

  if found then
    if v_request.input_hash <> p_input_hash
       or v_request.import_batch_id <> p_import_batch_id
       or v_request.project_id <> p_project_id
       or v_request.mode <> p_mode then
      raise exception 'confirm_cost_import_idempotency_conflict';
    end if;

    select coalesce(jsonb_agg(to_jsonb(item) order by item.created_at), '[]'::jsonb)
    into v_items
    from public.project_cost_items as item
    where item.organization_id = p_organization_id
      and item.project_id = p_project_id
      and item.source_import_batch_id = p_import_batch_id
      and item.source_payload ->> '__confirmation_idempotency_key' = p_idempotency_key;

    select coalesce(jsonb_agg(to_jsonb(exception) order by exception.created_at), '[]'::jsonb)
    into v_exceptions
    from public.external_cost_rule_exceptions as exception
    where exception.organization_id = p_organization_id
      and exception.project_id = p_project_id
      and exception.import_batch_id = p_import_batch_id
      and exception.source_context_snapshot ->> '__confirmation_idempotency_key' = p_idempotency_key;

    return jsonb_build_object(
      'import_batch', to_jsonb(v_batch),
      'items', v_items,
      'exceptions', v_exceptions,
      'idempotency_status', 'existing'
    );
  end if;

  if v_batch.status <> 'parsed' then
    raise exception 'confirm_cost_import_batch_not_parsed';
  end if;

  insert into public.cost_import_confirmation_requests (
    organization_id,
    project_id,
    import_batch_id,
    idempotency_key,
    input_hash,
    mode,
    created_by
  )
  values (
    p_organization_id,
    p_project_id,
    p_import_batch_id,
    p_idempotency_key,
    p_input_hash,
    p_mode,
    p_created_by
  )
  returning * into v_request;

  if p_mode = 'legacy' then
    for v_item in select * from jsonb_array_elements(coalesce(p_legacy_items, '[]'::jsonb))
    loop
      if nullif(v_item ->> 'live_report_id', '') is not null
         and not exists (
           select 1
           from public.live_reports as report
           where report.id = nullif(v_item ->> 'live_report_id', '')::uuid
             and report.organization_id = p_organization_id
             and report.project_id = p_project_id
           for update
         ) then
        raise exception 'confirm_cost_import_source_scope_mismatch';
      end if;

      if nullif(v_item ->> 'streamer_id', '') is not null
         and not exists (
           select 1
           from public.streamers as streamer
           where streamer.id = nullif(v_item ->> 'streamer_id', '')::uuid
             and streamer.organization_id = p_organization_id
           for update
         ) then
        raise exception 'confirm_cost_import_source_scope_mismatch';
      end if;

      if nullif(v_item ->> 'supplier_organization_id', '') is not null
         and not exists (
           select 1
           from public.organizations as supplier
           where supplier.id = nullif(v_item ->> 'supplier_organization_id', '')::uuid
             and supplier.id = p_organization_id
           for update
         ) then
        raise exception 'confirm_cost_import_source_scope_mismatch';
      end if;

      v_item_source_execution_key := nullif(v_item ->> 'source_execution_key', '');
      v_item_source_input_hash := coalesce(nullif(v_item ->> 'source_input_hash', ''), p_input_hash);
      v_item_rule_version_id := null;

      if v_item_source_execution_key is not null then
        select *
        into v_existing_cost_item
        from public.project_cost_items
        where organization_id = p_organization_id
          and source_execution_key = v_item_source_execution_key
        for update;

        if found then
          if v_existing_cost_item.source_input_hash is distinct from v_item_source_input_hash
             or v_existing_cost_item.source_import_batch_id is distinct from p_import_batch_id
             or v_existing_cost_item.source_rule_version_id is distinct from v_item_rule_version_id
             or v_existing_cost_item.source_payload ->> '__confirmation_idempotency_key' is distinct from p_idempotency_key then
            raise exception 'confirm_cost_import_execution_key_conflict';
          end if;

          v_items := v_items || to_jsonb(v_existing_cost_item);
          continue;
        end if;
      end if;

      insert into public.project_cost_items (
        organization_id,
        project_id,
        streamer_id,
        supplier_organization_id,
        live_report_id,
        settlement_batch_id,
        item_type,
        amount_cents,
        direction,
        evidence_level,
        source,
        source_payload,
        source_import_batch_id,
        source_execution_key,
        source_input_hash,
        source_explanation,
        reason,
        status,
        created_by
      )
      values (
        p_organization_id,
        p_project_id,
        nullif(v_item ->> 'streamer_id', '')::uuid,
        nullif(v_item ->> 'supplier_organization_id', '')::uuid,
        nullif(v_item ->> 'live_report_id', '')::uuid,
        null,
        coalesce(nullif(v_item ->> 'item_type', ''), 'manual'),
        coalesce((v_item ->> 'amount_cents')::bigint, 0),
        coalesce(nullif(v_item ->> 'direction', ''), 'cost'),
        coalesce(nullif(v_item ->> 'evidence_level', ''), 'yellow'),
        'import',
        coalesce(v_item -> 'source_payload', '{}'::jsonb)
          || jsonb_build_object('__confirmation_idempotency_key', p_idempotency_key),
        p_import_batch_id,
        v_item_source_execution_key,
        v_item_source_input_hash,
        nullif(v_item ->> 'source_explanation', ''),
        p_reason,
        'confirmed',
        p_created_by
      )
      returning * into v_item_row;

      v_items := v_items || to_jsonb(v_item_row);
    end loop;
  end if;

  if p_mode = 'custom' then
    for v_item in select * from jsonb_array_elements(coalesce(p_custom_items, '[]'::jsonb))
    loop
      if coalesce(nullif(v_item ->> 'status', ''), 'pending_review') <> 'pending_review' then
        raise exception 'confirm_cost_import_custom_items_must_be_pending_review';
      end if;

      if nullif(v_item ->> 'streamer_id', '') is not null
         and (
           not exists (
             select 1
             from public.streamers as streamer
             where streamer.id = nullif(v_item ->> 'streamer_id', '')::uuid
               and streamer.organization_id = p_organization_id
             for update
           )
           or not exists (
             select 1
             from public.project_streamers as project_streamer
             where project_streamer.streamer_id = nullif(v_item ->> 'streamer_id', '')::uuid
               and project_streamer.organization_id = p_organization_id
               and project_streamer.project_id = p_project_id
             for update
           )
         ) then
        raise exception 'confirm_cost_import_source_scope_mismatch';
      end if;

      if nullif(v_item ->> 'supplier_organization_id', '') is not null
         and not exists (
           select 1
           from public.organizations as supplier
           where supplier.id = nullif(v_item ->> 'supplier_organization_id', '')::uuid
             and supplier.id = p_organization_id
           for update
         ) then
        raise exception 'confirm_cost_import_source_scope_mismatch';
      end if;

      if nullif(v_item ->> 'live_report_id', '') is not null
         and not exists (
           select 1
           from public.live_reports as report
           where report.id = nullif(v_item ->> 'live_report_id', '')::uuid
             and report.organization_id = p_organization_id
             and report.project_id = p_project_id
           for update
         ) then
        raise exception 'confirm_cost_import_source_scope_mismatch';
      end if;

      if nullif(v_item ->> 'rule_version_id', '') is not null
         and not exists (
           select 1
           from public.custom_settlement_rule_versions as rule_version
           where rule_version.id = nullif(v_item ->> 'rule_version_id', '')::uuid
             and rule_version.organization_id = p_organization_id
             and rule_version.project_id = p_project_id
           for update
         ) then
        raise exception 'confirm_cost_import_source_scope_mismatch';
      end if;

      v_item_source_execution_key := nullif(v_item ->> 'source_execution_key', '');
      v_item_source_input_hash := coalesce(nullif(v_item ->> 'source_input_hash', ''), p_input_hash);
      v_item_rule_version_id := nullif(v_item ->> 'rule_version_id', '')::uuid;

      if v_item_source_execution_key is not null then
        select *
        into v_existing_cost_item
        from public.project_cost_items
        where organization_id = p_organization_id
          and source_execution_key = v_item_source_execution_key
        for update;

        if found then
          if v_existing_cost_item.source_input_hash is distinct from coalesce(nullif(v_item ->> 'source_input_hash', ''), p_input_hash)
             or v_existing_cost_item.source_import_batch_id is distinct from p_import_batch_id
             or v_existing_cost_item.source_rule_version_id is distinct from nullif(v_item ->> 'rule_version_id', '')::uuid
             or v_existing_cost_item.source_payload ->> '__confirmation_idempotency_key' is distinct from p_idempotency_key then
            raise exception 'confirm_cost_import_execution_key_conflict';
          end if;

          v_items := v_items || to_jsonb(v_existing_cost_item);
          continue;
        end if;
      end if;

      insert into public.project_cost_items (
        organization_id,
        project_id,
        streamer_id,
        supplier_organization_id,
        live_report_id,
        settlement_batch_id,
        item_type,
        amount_cents,
        direction,
        evidence_level,
        source,
        source_payload,
        source_rule_version_id,
        source_import_batch_id,
        source_execution_key,
        source_input_hash,
        source_explanation,
        reason,
        status,
        created_by
      )
      values (
        p_organization_id,
        p_project_id,
        nullif(v_item ->> 'streamer_id', '')::uuid,
        nullif(v_item ->> 'supplier_organization_id', '')::uuid,
        nullif(v_item ->> 'live_report_id', '')::uuid,
        null,
        coalesce(nullif(v_item ->> 'item_type', ''), 'manual'),
        coalesce((v_item ->> 'amount_cents')::bigint, 0),
        coalesce(nullif(v_item ->> 'direction', ''), 'cost'),
        coalesce(nullif(v_item ->> 'evidence_level', ''), 'yellow'),
        'import',
        coalesce(v_item -> 'source_payload', '{}'::jsonb)
          || jsonb_build_object('__confirmation_idempotency_key', p_idempotency_key),
        v_item_rule_version_id,
        p_import_batch_id,
        v_item_source_execution_key,
        v_item_source_input_hash,
        nullif(v_item ->> 'source_explanation', ''),
        p_reason,
        'pending_review',
        p_created_by
      )
      returning * into v_item_row;

      v_items := v_items || to_jsonb(v_item_row);
    end loop;

    for v_exception in select * from jsonb_array_elements(coalesce(p_exceptions, '[]'::jsonb))
    loop
      if nullif(v_exception ->> 'rule_version_id', '') is not null
         and not exists (
           select 1
           from public.custom_settlement_rule_versions as exception_rule_version
           where exception_rule_version.id = nullif(v_exception ->> 'rule_version_id', '')::uuid
             and exception_rule_version.organization_id = p_organization_id
             and exception_rule_version.project_id = p_project_id
           for update
         ) then
        raise exception 'confirm_cost_import_source_scope_mismatch';
      end if;

      insert into public.external_cost_rule_exceptions (
        organization_id,
        project_id,
        import_batch_id,
        import_row_index,
        rule_version_id,
        variable_name,
        policy,
        source_context_snapshot,
        status,
        created_by
      )
      values (
        p_organization_id,
        p_project_id,
        p_import_batch_id,
        coalesce((v_exception ->> 'import_row_index')::integer, 0),
        nullif(v_exception ->> 'rule_version_id', '')::uuid,
        nullif(v_exception ->> 'variable_name', ''),
        coalesce(nullif(v_exception ->> 'policy', ''), 'route_item_to_review'),
        coalesce(v_exception -> 'source_context_snapshot', '{}'::jsonb)
          || jsonb_build_object('__confirmation_idempotency_key', p_idempotency_key),
        'review_required',
        p_created_by
      )
      on conflict (
        organization_id,
        import_batch_id,
        import_row_index,
        variable_name
      )
      do update set variable_name = excluded.variable_name
      returning * into v_exception_row;

      v_exceptions := v_exceptions || to_jsonb(v_exception_row);
    end loop;
  end if;

  update public.project_cost_import_batches
  set status = 'confirmed'
  where id = p_import_batch_id
    and organization_id = p_organization_id
    and project_id = p_project_id
  returning * into v_batch;

  return jsonb_build_object(
    'import_batch', to_jsonb(v_batch),
    'items', v_items,
    'exceptions', v_exceptions,
    'idempotency_status', 'created'
  );
end;
$$;

create or replace function public.resolve_external_cost_rule_exception(
  p_organization_id uuid,
  p_exception_id uuid,
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
  v_exception public.external_cost_rule_exceptions%rowtype;
  v_open_sibling_count integer := 0;
begin
  if v_actor_id is null then
    raise exception 'authentication_required';
  end if;

  if p_resolved_by <> v_actor_id then
    raise exception 'external_cost_exception_resolver_mismatch';
  end if;

  if nullif(trim(coalesce(p_resolution_reason, '')), '') is null then
    raise exception 'external_cost_exception_resolution_reason_required';
  end if;

  select *
  into v_exception
  from public.external_cost_rule_exceptions
  where id = p_exception_id
    and organization_id = p_organization_id;

  if not found then
    raise exception 'external_cost_exception_not_found';
  end if;

  if v_exception.status <> 'review_required' then
    raise exception 'external_cost_exception_not_open';
  end if;

  v_actor_role := public.current_user_role(p_organization_id);
  if not public.is_org_member(p_organization_id)
     or not public.can_access_project(v_exception.project_id)
     or v_actor_role is null
     or v_actor_role not in ('owner', 'ops_manager', 'finance') then
    raise exception 'external_cost_exception_resolve_access_denied';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      v_exception.organization_id::text
        || ':'
        || v_exception.import_batch_id::text
        || ':'
        || v_exception.import_row_index::text,
      0
    )
  );

  with locked_siblings as materialized (
    select sibling.*
    from public.external_cost_rule_exceptions as sibling
    where sibling.organization_id = v_exception.organization_id
      and sibling.import_batch_id = v_exception.import_batch_id
      and sibling.import_row_index = v_exception.import_row_index
    order by sibling.id
    for update
  )
  select locked_siblings.*
  into v_exception
  from locked_siblings
  where locked_siblings.id = p_exception_id;

  if not found then
    raise exception 'external_cost_exception_not_found';
  end if;

  if v_exception.status <> 'review_required' then
    raise exception 'external_cost_exception_not_open';
  end if;

  select count(*)
  into v_open_sibling_count
  from public.external_cost_rule_exceptions as sibling
  where sibling.organization_id = v_exception.organization_id
    and sibling.import_batch_id = v_exception.import_batch_id
    and sibling.import_row_index = v_exception.import_row_index
    and sibling.id <> v_exception.id
    and sibling.status = 'review_required';

  update public.external_cost_rule_exceptions
  set
    status = 'resolved',
    resolution_value = p_resolution_value,
    resolution_reason = p_resolution_reason,
    resolved_by = p_resolved_by,
    resolved_at = statement_timestamp()
  where id = v_exception.id
  returning * into v_exception;

  -- external_cost_exception_replay_deferred_until_task3:
  -- Task 2 records the reviewed value only. Task 3 must replay the original
  -- rule with all resolved values and insert deterministic pending-review
  -- items through a replay-specific path.

  return jsonb_build_object(
    'exception', to_jsonb(v_exception),
    'items', '[]'::jsonb,
    'replayed', false,
    'replay_deferred', true,
    'openSiblingCount', v_open_sibling_count
  );
end;
$$;

revoke all on function public.confirm_cost_import_with_rule_items(
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  uuid,
  jsonb,
  jsonb,
  jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.confirm_cost_import_with_rule_items(
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  uuid,
  jsonb,
  jsonb,
  jsonb
) to authenticated;

revoke all on function public.resolve_external_cost_rule_exception(
  uuid,
  uuid,
  jsonb,
  text,
  uuid
) from public, anon, authenticated, service_role;
grant execute on function public.resolve_external_cost_rule_exception(
  uuid,
  uuid,
  jsonb,
  text,
  uuid
) to authenticated;
