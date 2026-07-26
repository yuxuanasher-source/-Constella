-- 平台管理后台：跨组织身份、主账号、标准成本版本与独立操作审计。
-- 本迁移只处理「组织向平台付费」的数据；不得用于主播结算或平台出款。

alter table public.organizations
  add column lifecycle_status text not null default 'active'
  check (lifecycle_status in ('active', 'frozen', 'archived'));

alter table public.billing_plans
  add column updated_at timestamptz not null default now();

create trigger billing_plans_touch_updated_at
before update on public.billing_plans
for each row execute function public.touch_updated_at();

create table public.platform_admins (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  role text not null default 'super_admin' check (role = 'super_admin'),
  status text not null default 'active' check (status in ('active', 'suspended')),
  last_access_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.organization_primary_accounts (
  organization_id uuid primary key
    references public.organizations(id) on delete cascade,
  user_id uuid not null references public.profiles(id),
  assignment_source text not null
    check (
      assignment_source in ('signup', 'backfill', 'manual_confirmation')
    ),
  confirmed_at timestamptz,
  confirmed_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.billing_plan_cost_versions (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.billing_plans(id) on delete cascade,
  effective_from timestamptz not null,
  effective_to timestamptz,
  fixed_cost_cents integer not null default 0 check (fixed_cost_cents >= 0),
  per_seat_cost_cents integer not null default 0
    check (per_seat_cost_cents >= 0),
  per_active_streamer_cost_cents integer not null default 0
    check (per_active_streamer_cost_cents >= 0),
  metric_unit_costs jsonb not null default '{}'::jsonb,
  reason text not null,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  check (effective_to is null or effective_to > effective_from)
);

create table public.platform_admin_operation_logs (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid not null references public.profiles(id),
  action text not null,
  target_type text not null,
  target_id text,
  target_organization_id uuid references public.organizations(id),
  before_json jsonb not null default '{}'::jsonb,
  after_json jsonb not null default '{}'::jsonb,
  reason text,
  is_high_risk boolean not null default false,
  result text not null default 'success'
    check (result in ('success', 'failure')),
  error_message text,
  trace_id text not null,
  idempotency_key text,
  created_at timestamptz not null default now(),
  unique (actor_user_id, idempotency_key)
);

create extension if not exists btree_gist with schema extensions;

alter table public.billing_plan_cost_versions
  add constraint billing_plan_cost_versions_no_overlap
  exclude using gist (
    plan_id with =,
    tstzrange(
      effective_from,
      coalesce(effective_to, 'infinity'::timestamptz),
      '[)'
    ) with &&
  );

create index organizations_lifecycle_status_idx
  on public.organizations (lifecycle_status, created_at desc);
create index organization_subscriptions_expiry_idx
  on public.organization_subscriptions (current_period_end, status);
create index billing_orders_paid_at_idx
  on public.billing_orders (paid_at desc)
  where status = 'paid';
create index billing_plan_cost_versions_effective_idx
  on public.billing_plan_cost_versions (
    plan_id,
    effective_from desc,
    effective_to
  );
create index platform_admin_operation_logs_org_created_idx
  on public.platform_admin_operation_logs (
    target_organization_id,
    created_at desc
  );

create trigger platform_admins_touch_updated_at
before update on public.platform_admins
for each row execute function public.touch_updated_at();

alter table public.platform_admins enable row level security;
alter table public.organization_primary_accounts enable row level security;
alter table public.billing_plan_cost_versions enable row level security;
alter table public.platform_admin_operation_logs enable row level security;

-- 历史组织只有在恰好存在一个有效 owner 时才能安全推断主账号。
-- 多 owner 或无 owner 的组织保留为空，等待平台管理员人工确认。
insert into public.organization_primary_accounts (
  organization_id,
  user_id,
  assignment_source,
  confirmed_at
)
select
  owner_candidates.organization_id,
  min(owner_candidates.user_id::text)::uuid,
  'backfill',
  now()
from public.organization_members owner_candidates
where owner_candidates.role = 'owner'
  and owner_candidates.status = 'active'
group by owner_candidates.organization_id
having count(*) = 1;

-- 自助开通仍保持原有权限边界，同时把注册创建者记录为唯一主账号。
create or replace function public.provision_self_serve_org(
  p_org_name text,
  p_full_name text default null,
  p_org_code text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_email text;
  v_org_id uuid;
  v_code text;
  v_plan_id uuid;
  v_today date := (now() at time zone 'utc')::date;
begin
  if v_user is null then
    raise exception 'Not authenticated';
  end if;

  if coalesce(trim(p_org_name), '') = '' then
    raise exception 'Organization name is required';
  end if;

  select email into v_email from auth.users where id = v_user;
  if v_email is null then
    raise exception 'Auth user not found';
  end if;

  insert into public.profiles (id, email, full_name)
  values (v_user, v_email, coalesce(nullif(trim(p_full_name), ''), v_email))
  on conflict (id) do nothing;

  if exists (
    select 1
    from public.organization_members om
    where om.user_id = v_user
      and om.status = 'active'
  ) then
    raise exception 'User already belongs to an organization';
  end if;

  v_code := coalesce(
    nullif(trim(p_org_code), ''),
    'org_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)
  );

  select id into v_plan_id
  from public.billing_plans
  where code = 'trial'
  limit 1;

  if v_plan_id is null then
    raise exception 'Trial plan is not configured';
  end if;

  insert into public.organizations (name, code)
  values (trim(p_org_name), v_code)
  returning id into v_org_id;

  insert into public.organization_members (
    organization_id,
    user_id,
    role,
    status
  )
  values (v_org_id, v_user, 'owner', 'active');

  insert into public.organization_primary_accounts (
    organization_id,
    user_id,
    assignment_source,
    confirmed_at,
    confirmed_by
  )
  values (v_org_id, v_user, 'signup', now(), v_user);

  insert into public.organization_subscriptions (
    organization_id,
    plan_id,
    status,
    billing_cycle,
    current_period_start,
    current_period_end,
    trial_ends_at,
    auto_renew
  )
  values (
    v_org_id,
    v_plan_id,
    'trialing',
    'monthly',
    v_today,
    v_today + 14,
    now() + interval '14 days',
    true
  );

  return v_org_id;
end;
$$;

revoke all on function public.provision_self_serve_org(text, text, text)
  from public;
grant execute on function public.provision_self_serve_org(text, text, text)
  to authenticated;

-- 平台服务端先在 auth.users 创建用户，再调用本函数一次性完成业务数据。
-- security definer 不等于授权：函数仍校验 actor，并只向 service_role 开放。
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
    auto_renew
  )
  values (
    v_organization_id,
    p_plan_id,
    'active',
    p_billing_cycle,
    p_period_start,
    p_period_end,
    false
  )
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

create or replace function public.platform_create_plan_price_version(
  p_plan_id uuid,
  p_billing_cycle public.billing_cycle,
  p_price_cents integer,
  p_currency text,
  p_effective_from timestamptz,
  p_previous_price_version_id uuid,
  p_expected_plan_updated_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_price public.billing_plan_prices%rowtype;
  v_updated_count integer;
begin
  if p_price_cents < 0 then
    raise exception 'Price must be non-negative';
  end if;

  update public.billing_plans
  set
    monthly_price_cents = case
      when p_billing_cycle = 'monthly' then p_price_cents
      else monthly_price_cents
    end,
    annual_price_cents = case
      when p_billing_cycle = 'annual' then p_price_cents
      else annual_price_cents
    end
  where id = p_plan_id
    and updated_at = p_expected_plan_updated_at;
  get diagnostics v_updated_count = row_count;
  if v_updated_count <> 1 then
    raise exception 'Billing plan changed after it was loaded'
      using errcode = '40001';
  end if;

  if p_previous_price_version_id is not null then
    update public.billing_plan_prices
    set
      active = false,
      effective_to = p_effective_from
    where id = p_previous_price_version_id
      and plan_id = p_plan_id
      and billing_cycle = p_billing_cycle
      and active = true
      and effective_from < p_effective_from;
    get diagnostics v_updated_count = row_count;
    if v_updated_count <> 1 then
      raise exception 'Active price version changed after it was loaded'
        using errcode = '40001';
    end if;
  elsif exists (
    select 1
    from public.billing_plan_prices
    where plan_id = p_plan_id
      and billing_cycle = p_billing_cycle
      and active = true
  ) then
    raise exception 'Active price version changed after it was loaded'
      using errcode = '40001';
  end if;

  insert into public.billing_plan_prices (
    plan_id,
    billing_cycle,
    price_cents,
    currency,
    active,
    effective_from
  )
  values (
    p_plan_id,
    p_billing_cycle,
    p_price_cents,
    upper(trim(p_currency)),
    true,
    p_effective_from
  )
  returning * into v_price;

  return to_jsonb(v_price);
end;
$$;

revoke all on function public.platform_create_plan_price_version(
  uuid,
  public.billing_cycle,
  integer,
  text,
  timestamptz,
  uuid,
  timestamptz
) from public, anon, authenticated;
grant execute on function public.platform_create_plan_price_version(
  uuid,
  public.billing_cycle,
  integer,
  text,
  timestamptz,
  uuid,
  timestamptz
) to service_role;

create or replace function public.platform_create_plan_cost_version(
  p_plan_id uuid,
  p_effective_from timestamptz,
  p_effective_to timestamptz,
  p_fixed_cost_cents integer,
  p_per_seat_cost_cents integer,
  p_per_active_streamer_cost_cents integer,
  p_metric_unit_costs jsonb,
  p_reason text,
  p_created_by uuid,
  p_expected_plan_updated_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cost public.billing_plan_cost_versions%rowtype;
  v_updated_count integer;
begin
  update public.billing_plans
  set updated_at = now()
  where id = p_plan_id
    and updated_at = p_expected_plan_updated_at;
  get diagnostics v_updated_count = row_count;
  if v_updated_count <> 1 then
    raise exception 'Billing plan changed after it was loaded'
      using errcode = '40001';
  end if;

  insert into public.billing_plan_cost_versions (
    plan_id,
    effective_from,
    effective_to,
    fixed_cost_cents,
    per_seat_cost_cents,
    per_active_streamer_cost_cents,
    metric_unit_costs,
    reason,
    created_by
  )
  values (
    p_plan_id,
    p_effective_from,
    p_effective_to,
    p_fixed_cost_cents,
    p_per_seat_cost_cents,
    p_per_active_streamer_cost_cents,
    coalesce(p_metric_unit_costs, '{}'::jsonb),
    trim(p_reason),
    p_created_by
  )
  returning * into v_cost;

  return to_jsonb(v_cost);
end;
$$;

revoke all on function public.platform_create_plan_cost_version(
  uuid,
  timestamptz,
  timestamptz,
  integer,
  integer,
  integer,
  jsonb,
  text,
  uuid,
  timestamptz
) from public, anon, authenticated;
grant execute on function public.platform_create_plan_cost_version(
  uuid,
  timestamptz,
  timestamptz,
  integer,
  integer,
  integer,
  jsonb,
  text,
  uuid,
  timestamptz
) to service_role;
