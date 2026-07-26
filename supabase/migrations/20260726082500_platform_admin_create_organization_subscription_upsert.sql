-- The global organizations_default_subscription trigger inserts a default
-- subscription immediately after an organization is created. Platform-admin
-- creation supplies an explicit plan and period, so reuse that row instead of
-- attempting a second insert against the one-subscription-per-org constraint.
create or replace function public.platform_create_organization(
  p_actor_user_id uuid,
  p_name text,
  p_code text,
  p_primary_user_id uuid,
  p_primary_email text,
  p_primary_name text,
  p_plan_id uuid,
  p_billing_cycle public.billing_cycle,
  p_period_start date,
  p_period_end date,
  p_offline_payment jsonb,
  p_reason text,
  p_trace_id text,
  p_idempotency_key text,
  p_request_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing public.platform_admin_operation_logs%rowtype;
  v_request jsonb;
  v_result jsonb;
  v_organization_id uuid;
  v_subscription_id uuid;
  v_order_id uuid;
  v_transaction_id uuid;
  v_amount_cents integer;
  v_currency text;
  v_provider text;
  v_provider_txn_id text;
  v_paid_at timestamptz;
begin
  if not exists (
    select 1
    from public.platform_admins pa
    where pa.user_id = p_actor_user_id
      and pa.role = 'super_admin'
      and pa.status = 'active'
  ) then
    raise exception 'Active platform administrator required';
  end if;

  if coalesce(trim(p_name), '') = '' then
    raise exception 'Organization name is required';
  end if;
  if coalesce(trim(p_code), '') = '' then
    raise exception 'Organization code is required';
  end if;
  if coalesce(trim(p_primary_email), '') = '' then
    raise exception 'Primary account email is required';
  end if;
  if p_period_end < p_period_start then
    raise exception 'Subscription period is invalid';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'Operation reason is required';
  end if;
  if coalesce(trim(p_trace_id), '') = '' then
    raise exception 'Trace ID is required';
  end if;
  if coalesce(trim(p_idempotency_key), '') = '' then
    raise exception 'Idempotency key is required';
  end if;
  if coalesce(trim(p_request_hash), '') = '' then
    raise exception 'Request hash is required';
  end if;

  v_request := jsonb_build_object(
    'name', trim(p_name),
    'code', trim(p_code),
    'primary_user_id', p_primary_user_id,
    'primary_email', lower(trim(p_primary_email)),
    'primary_name', trim(p_primary_name),
    'plan_id', p_plan_id,
    'billing_cycle', p_billing_cycle,
    'period_start', p_period_start,
    'period_end', p_period_end,
    'offline_payment', coalesce(p_offline_payment, 'null'::jsonb),
    'reason', trim(p_reason)
  );

  select *
  into v_existing
  from public.platform_admin_operation_logs
  where actor_user_id = p_actor_user_id
    and idempotency_key = p_idempotency_key
  limit 1;

  if found then
    if v_existing.before_json ->> 'requestHash' = trim(p_request_hash)
      and v_existing.result = 'success'
      and v_existing.after_json ? 'resultValue'
    then
      return v_existing.after_json -> 'resultValue';
    end if;

    raise exception 'Idempotency key conflict';
  end if;

  insert into public.organizations (name, code, lifecycle_status)
  values (trim(p_name), trim(p_code), 'active')
  returning id into v_organization_id;

  insert into public.profiles (id, email, full_name)
  values (
    p_primary_user_id,
    lower(trim(p_primary_email)),
    coalesce(nullif(trim(p_primary_name), ''), lower(trim(p_primary_email)))
  )
  on conflict (id) do update
  set
    email = excluded.email,
    full_name = excluded.full_name;

  insert into public.organization_members (
    organization_id,
    user_id,
    role,
    status
  )
  values (v_organization_id, p_primary_user_id, 'owner', 'active');

  insert into public.organization_primary_accounts (
    organization_id,
    user_id,
    assignment_source,
    confirmed_at,
    confirmed_by
  )
  values (
    v_organization_id,
    p_primary_user_id,
    'manual_confirmation',
    now(),
    p_actor_user_id
  );

  insert into public.organization_subscriptions (
    organization_id,
    plan_id,
    status,
    billing_cycle,
    current_period_start,
    current_period_end,
    trial_ends_at,
    cancel_at,
    grace_until,
    pending_plan_id,
    pending_billing_cycle,
    auto_renew,
    last_order_id
  )
  values (
    v_organization_id,
    p_plan_id,
    'active',
    p_billing_cycle,
    p_period_start,
    p_period_end,
    null,
    null,
    null,
    null,
    null,
    false,
    null
  )
  on conflict (organization_id) do update
  set
    plan_id = excluded.plan_id,
    status = excluded.status,
    billing_cycle = excluded.billing_cycle,
    current_period_start = excluded.current_period_start,
    current_period_end = excluded.current_period_end,
    trial_ends_at = excluded.trial_ends_at,
    cancel_at = excluded.cancel_at,
    grace_until = excluded.grace_until,
    pending_plan_id = excluded.pending_plan_id,
    pending_billing_cycle = excluded.pending_billing_cycle,
    auto_renew = excluded.auto_renew,
    last_order_id = excluded.last_order_id
  returning id into v_subscription_id;

  if p_offline_payment is not null
    and jsonb_typeof(p_offline_payment) <> 'null'
  then
    v_amount_cents := (p_offline_payment ->> 'amount_cents')::integer;
    v_currency := coalesce(
      nullif(trim(p_offline_payment ->> 'currency'), ''),
      'CNY'
    );
    v_provider := coalesce(
      nullif(trim(p_offline_payment ->> 'provider'), ''),
      'offline'
    );
    v_provider_txn_id := nullif(
      trim(p_offline_payment ->> 'provider_txn_id'),
      ''
    );
    v_paid_at := coalesce(
      nullif(p_offline_payment ->> 'paid_at', '')::timestamptz,
      now()
    );

    if v_amount_cents is null or v_amount_cents < 0 then
      raise exception 'Offline payment amount is invalid';
    end if;

    insert into public.billing_orders (
      organization_id,
      kind,
      status,
      amount_cents,
      currency,
      target,
      plan_id,
      billing_cycle,
      idempotency_key,
      provider,
      paid_at,
      created_by
    )
    values (
      v_organization_id,
      'subscription_new',
      'paid',
      v_amount_cents,
      v_currency,
      jsonb_build_object(
        'source', 'platform_admin',
        'subscription_id', v_subscription_id
      ),
      p_plan_id,
      p_billing_cycle,
      p_idempotency_key || ':offline-payment',
      v_provider,
      v_paid_at,
      p_actor_user_id
    )
    returning id into v_order_id;

    insert into public.billing_transactions (
      organization_id,
      order_id,
      type,
      status,
      amount_cents,
      provider,
      provider_txn_id,
      provider_payload,
      succeeded_at
    )
    values (
      v_organization_id,
      v_order_id,
      'payment',
      'succeeded',
      v_amount_cents,
      v_provider,
      v_provider_txn_id,
      p_offline_payment,
      v_paid_at
    )
    returning id into v_transaction_id;
  end if;

  v_result := jsonb_build_object(
    'organization_id', v_organization_id,
    'subscription_id', v_subscription_id,
    'primary_user_id', p_primary_user_id,
    'order_id', v_order_id,
    'transaction_id', v_transaction_id
  );

  insert into public.platform_admin_operation_logs (
    actor_user_id,
    action,
    target_type,
    target_id,
    target_organization_id,
    before_json,
    after_json,
    reason,
    is_high_risk,
    result,
    trace_id,
    idempotency_key
  )
  values (
    p_actor_user_id,
    'organization.create',
    'organization',
    v_organization_id::text,
    v_organization_id,
    jsonb_build_object(
      'requestHash', trim(p_request_hash),
      'request', v_request,
      'snapshot', '{}'::jsonb
    ),
    jsonb_build_object(
      'summary', jsonb_build_object(
        'organizationId', v_organization_id,
        'subscriptionId', v_subscription_id
      ),
      'resultValue', v_result
    ),
    trim(p_reason),
    true,
    'success',
    trim(p_trace_id),
    trim(p_idempotency_key)
  );

  return v_result;
end;
$$;

revoke all on function public.platform_create_organization(
  uuid,
  text,
  text,
  uuid,
  text,
  text,
  uuid,
  public.billing_cycle,
  date,
  date,
  jsonb,
  text,
  text,
  text,
  text
) from public, anon, authenticated;

grant execute on function public.platform_create_organization(
  uuid,
  text,
  text,
  uuid,
  text,
  text,
  uuid,
  public.billing_cycle,
  date,
  date,
  jsonb,
  text,
  text,
  text,
  text
) to service_role;
