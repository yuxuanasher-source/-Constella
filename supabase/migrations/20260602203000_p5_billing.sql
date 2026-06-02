create type public.billing_plan_tier as enum (
  'free',
  'basic',
  'pro',
  'enterprise'
);

create type public.subscription_status as enum (
  'trialing',
  'active',
  'past_due',
  'readonly',
  'cancelled'
);

create type public.billing_cycle as enum ('monthly', 'annual');

create type public.usage_metric as enum (
  'active_streamer',
  'seat',
  'ocr',
  'ai',
  'storage_mb',
  'export'
);

create table public.billing_plans (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  tier public.billing_plan_tier not null,
  name text not null,
  monthly_price_cents integer not null default 0,
  annual_price_cents integer not null default 0,
  included_active_streamers integer not null default 0,
  included_seats integer not null default 0,
  included_ocr integer not null default 0,
  included_ai integer not null default 0,
  included_storage_mb integer not null default 0,
  included_exports integer not null default 0,
  features jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint billing_plans_prices_nonnegative check (
    monthly_price_cents >= 0 and annual_price_cents >= 0
  ),
  constraint billing_plans_included_nonnegative check (
    included_active_streamers >= 0
    and included_seats >= 0
    and included_ocr >= 0
    and included_ai >= 0
    and included_storage_mb >= 0
    and included_exports >= 0
  )
);

create table public.organization_subscriptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  plan_id uuid not null references public.billing_plans(id),
  status public.subscription_status not null default 'trialing',
  billing_cycle public.billing_cycle not null default 'monthly',
  current_period_start date not null,
  current_period_end date not null,
  read_only_since timestamptz,
  trial_ends_at timestamptz,
  cancel_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id),
  constraint organization_subscriptions_period_valid check (
    current_period_end >= current_period_start
  )
);

create table public.usage_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  metric public.usage_metric not null,
  quantity integer not null,
  period_month date not null,
  source text not null,
  object_type text,
  object_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint usage_events_quantity_positive check (quantity > 0)
);

create table public.usage_monthly_counters (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  metric public.usage_metric not null,
  period_month date not null,
  used_quantity integer not null default 0,
  included_quantity integer not null default 0,
  addon_quantity integer not null default 0,
  updated_at timestamptz not null default now(),
  unique (organization_id, metric, period_month),
  constraint usage_monthly_counters_nonnegative check (
    used_quantity >= 0 and included_quantity >= 0 and addon_quantity >= 0
  )
);

create table public.usage_addons (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  metric public.usage_metric not null,
  quantity integer not null,
  amount_cents integer not null,
  period_start date not null,
  period_end date not null,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  constraint usage_addons_period_valid check (period_end >= period_start),
  constraint usage_addons_quantity_positive check (quantity > 0),
  constraint usage_addons_amount_nonnegative check (amount_cents >= 0)
);

create table public.feature_addons (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  feature_key text not null,
  amount_cents integer not null,
  enabled boolean not null default true,
  period_start date not null,
  period_end date not null,
  created_at timestamptz not null default now(),
  unique (organization_id, feature_key),
  constraint feature_addons_period_valid check (period_end >= period_start),
  constraint feature_addons_amount_nonnegative check (amount_cents >= 0)
);

create index billing_plans_tier_idx on public.billing_plans (tier);
create index organization_subscriptions_status_idx
  on public.organization_subscriptions (organization_id, status);
create index usage_events_org_month_idx
  on public.usage_events (organization_id, period_month, metric);
create index usage_monthly_counters_org_month_idx
  on public.usage_monthly_counters (organization_id, period_month);
create index usage_addons_org_period_idx
  on public.usage_addons (organization_id, period_start, period_end);
create index feature_addons_org_enabled_idx
  on public.feature_addons (organization_id, enabled);

alter table public.billing_plans enable row level security;
alter table public.organization_subscriptions enable row level security;
alter table public.usage_events enable row level security;
alter table public.usage_monthly_counters enable row level security;
alter table public.usage_addons enable row level security;
alter table public.feature_addons enable row level security;

create policy "billing plans readable by authenticated users"
on public.billing_plans for select
using (auth.uid() is not null);

create policy "staff can read organization subscriptions"
on public.organization_subscriptions for select
using (public.is_mcn_staff(organization_id));

create policy "owners ops can manage organization subscriptions"
on public.organization_subscriptions for all
using (public.current_user_role(organization_id) in ('owner', 'ops_manager'))
with check (public.current_user_role(organization_id) in ('owner', 'ops_manager'));

create policy "staff can read usage events"
on public.usage_events for select
using (public.is_mcn_staff(organization_id));

create policy "staff can insert usage events"
on public.usage_events for insert
with check (public.is_mcn_staff(organization_id));

create policy "staff can read usage monthly counters"
on public.usage_monthly_counters for select
using (public.is_mcn_staff(organization_id));

create policy "staff can upsert usage monthly counters"
on public.usage_monthly_counters for all
using (public.is_mcn_staff(organization_id))
with check (public.is_mcn_staff(organization_id));

create policy "staff can read usage addons"
on public.usage_addons for select
using (public.is_mcn_staff(organization_id));

create policy "owners ops can manage usage addons"
on public.usage_addons for all
using (public.current_user_role(organization_id) in ('owner', 'ops_manager'))
with check (public.current_user_role(organization_id) in ('owner', 'ops_manager'));

create policy "staff can read feature addons"
on public.feature_addons for select
using (public.is_mcn_staff(organization_id));

create policy "owners ops can manage feature addons"
on public.feature_addons for all
using (public.current_user_role(organization_id) in ('owner', 'ops_manager'))
with check (public.current_user_role(organization_id) in ('owner', 'ops_manager'));
