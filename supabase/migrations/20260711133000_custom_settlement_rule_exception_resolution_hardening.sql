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

  v_actor_role := public.current_user_role(p_organization_id);
  if not public.is_org_member(p_organization_id)
     or not public.can_access_project(v_exception.project_id)
     or v_actor_role is null
     or v_actor_role not in ('owner', 'ops_manager', 'finance') then
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

  if v_exception.status <> 'review_required' then
    if v_exception.status = 'resolved'
       and v_exception.resolution_value = p_resolution_value then
      return jsonb_build_object(
        'batch', to_jsonb(v_batch),
        'item', to_jsonb(v_item),
        'exception', to_jsonb(v_exception)
      );
    end if;

    if v_exception.status = 'resolved' then
      raise exception 'Settlement rule exception was already resolved with a different value';
    end if;

    raise exception 'Settlement rule exception is not open for resolution';
  end if;

  if v_item.computed_amount <> p_old_computed_amount then
    raise exception 'settlement_rule_exception_stale_amount';
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

