-- P6 支付与订阅闭环：订单 / 交易流水 / 回调事件 / 价格版本 / 发票 / 对账 / 退款
-- 资金红线：本链路仅处理「组织 → 平台」的订阅 / 用量收款，
-- 严禁复用于「平台 → 主播」的结算付款（结算批次与本支付链路数据与代码隔离）。

create type public.billing_order_kind as enum (
  'subscription_new',
  'subscription_renewal',
  'subscription_upgrade',
  'subscription_downgrade',
  'usage_addon',
  'feature_addon'
);

create type public.billing_order_status as enum (
  'pending',
  'paid',
  'failed',
  'cancelled',
  'refunding',
  'refunded'
);

create type public.billing_transaction_type as enum ('payment', 'refund');

create type public.billing_transaction_status as enum (
  'created',
  'succeeded',
  'failed'
);

create type public.invoice_type as enum ('vat_normal', 'vat_special');

create type public.invoice_request_status as enum (
  'submitted',
  'issuing',
  'issued',
  'rejected',
  'cancelled'
);

-- 套餐价格版本：避免直接改 billing_plans 价格污染历史订单
create table public.billing_plan_prices (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.billing_plans(id) on delete cascade,
  billing_cycle public.billing_cycle not null,
  price_cents integer not null check (price_cents >= 0),
  currency text not null default 'CNY',
  active boolean not null default true,
  effective_from timestamptz not null default now(),
  effective_to timestamptz,
  created_at timestamptz not null default now()
);

-- 订单：一次「要付钱的意图」
create table public.billing_orders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  kind public.billing_order_kind not null,
  status public.billing_order_status not null default 'pending',
  amount_cents integer not null check (amount_cents >= 0),
  currency text not null default 'CNY',
  target jsonb not null default '{}'::jsonb,
  plan_id uuid references public.billing_plans(id),
  plan_price_id uuid references public.billing_plan_prices(id),
  billing_cycle public.billing_cycle,
  idempotency_key text not null,
  provider text,
  expires_at timestamptz,
  paid_at timestamptz,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, idempotency_key)
);

-- 交易流水：订单与渠道之间每一次资金动作
create table public.billing_transactions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  order_id uuid not null references public.billing_orders(id) on delete cascade,
  type public.billing_transaction_type not null,
  status public.billing_transaction_status not null default 'created',
  amount_cents integer not null check (amount_cents >= 0),
  provider text not null,
  provider_txn_id text,
  provider_payload jsonb not null default '{}'::jsonb,
  failure_reason text,
  created_at timestamptz not null default now(),
  succeeded_at timestamptz,
  unique (provider, provider_txn_id)
);

-- 支付回调事件：先入库再处理，幂等 + 可重放
create table public.billing_webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  event_id text not null,
  signature_verified boolean not null default false,
  processed boolean not null default false,
  processed_at timestamptz,
  raw_payload jsonb not null default '{}'::jsonb,
  order_id uuid references public.billing_orders(id) on delete set null,
  received_at timestamptz not null default now(),
  unique (provider, event_id)
);

-- 发票申请与发票
create table public.invoice_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  status public.invoice_request_status not null default 'submitted',
  invoice_type public.invoice_type not null default 'vat_normal',
  title text not null,
  tax_no text,
  amount_cents integer not null check (amount_cents >= 0),
  order_ids uuid[] not null default '{}',
  contact_email text not null,
  extra jsonb not null default '{}'::jsonb,
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  request_id uuid not null references public.invoice_requests(id) on delete cascade,
  invoice_no text not null,
  amount_cents integer not null check (amount_cents >= 0),
  file_path text,
  issued_at timestamptz not null default now()
);

-- 日终对账
create table public.billing_reconciliations (
  id uuid primary key default gen_random_uuid(),
  recon_date date not null,
  provider text not null,
  expected_amount_cents bigint not null default 0,
  provider_amount_cents bigint not null default 0,
  matched_count integer not null default 0,
  mismatched_count integer not null default 0,
  status text not null default 'balanced',
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (recon_date, provider)
);

-- 订阅生命周期增量列
alter table public.organization_subscriptions
  add column grace_until timestamptz,
  add column pending_plan_id uuid references public.billing_plans(id),
  add column pending_billing_cycle public.billing_cycle,
  add column auto_renew boolean not null default true,
  add column last_order_id uuid references public.billing_orders(id);

create index billing_plan_prices_plan_idx
  on public.billing_plan_prices (plan_id, billing_cycle, active);
create index billing_orders_org_status_idx
  on public.billing_orders (organization_id, status);
create index billing_orders_expires_idx
  on public.billing_orders (status, expires_at);
create index billing_transactions_order_idx
  on public.billing_transactions (order_id);
create index billing_webhook_events_processed_idx
  on public.billing_webhook_events (processed, provider);
create index invoice_requests_org_status_idx
  on public.invoice_requests (organization_id, status);
create index invoices_org_idx on public.invoices (organization_id);
create index billing_reconciliations_date_idx
  on public.billing_reconciliations (recon_date, provider);

create trigger billing_orders_touch_updated_at
before update on public.billing_orders
for each row execute function public.touch_updated_at();

create trigger invoice_requests_touch_updated_at
before update on public.invoice_requests
for each row execute function public.touch_updated_at();

-- RLS
alter table public.billing_plan_prices enable row level security;
alter table public.billing_orders enable row level security;
alter table public.billing_transactions enable row level security;
alter table public.billing_webhook_events enable row level security;
alter table public.invoice_requests enable row level security;
alter table public.invoices enable row level security;
alter table public.billing_reconciliations enable row level security;

-- 价格版本：认证用户均可读（漏斗 / 套餐页）
create policy "billing plan prices readable by authenticated users"
on public.billing_plan_prices for select
using (auth.uid() is not null);

-- 订单：staff 可读，owner/ops 可写
create policy "staff can read billing orders"
on public.billing_orders for select
using (public.is_mcn_staff(organization_id));

create policy "owners ops can manage billing orders"
on public.billing_orders for all
using (public.current_user_role(organization_id) in ('owner', 'ops_manager'))
with check (public.current_user_role(organization_id) in ('owner', 'ops_manager'));

-- 交易流水：staff 只读（写入仅 service role）
create policy "staff can read billing transactions"
on public.billing_transactions for select
using (public.is_mcn_staff(organization_id));

-- 回调事件：无 authenticated 策略，仅 service role 可读写
-- （RLS 开启且无 select/all 策略 → authenticated 无权访问）

-- 发票申请：staff 可读，owner/ops 可写
create policy "staff can read invoice requests"
on public.invoice_requests for select
using (public.is_mcn_staff(organization_id));

create policy "owners ops can manage invoice requests"
on public.invoice_requests for all
using (public.current_user_role(organization_id) in ('owner', 'ops_manager'))
with check (public.current_user_role(organization_id) in ('owner', 'ops_manager'));

-- 发票：staff 只读（开具仅 service role / 财务后台）
create policy "staff can read invoices"
on public.invoices for select
using (public.is_mcn_staff(organization_id));

-- 对账：无 authenticated 策略，仅 service role

-- 内置套餐与价格版本（系统参考数据，幂等）
insert into public.billing_plans (
  code, tier, name, monthly_price_cents, annual_price_cents,
  included_active_streamers, included_seats, included_ocr, included_ai,
  included_storage_mb, included_exports, features
) values
  ('trial', 'free', '试用版', 0, 0, 5, 3, 200, 500, 2048, 10,
    '{"trial": true}'::jsonb),
  ('free', 'free', '免费版', 0, 0, 2, 2, 50, 100, 1024, 3, '{}'::jsonb),
  ('basic', 'basic', '基础版', 29900, 299000, 10, 5, 1000, 2000, 10240, 50,
    '{}'::jsonb),
  ('pro', 'pro', '专业版', 99900, 999000, 30, 15, 5000, 10000, 51200, 200,
    '{}'::jsonb),
  ('enterprise', 'enterprise', '旗舰版', 299900, 2999000, 100, 50, 20000,
    50000, 204800, 1000, '{}'::jsonb)
on conflict (code) do nothing;

insert into public.billing_plan_prices (plan_id, billing_cycle, price_cents)
select p.id, c.cycle, case c.cycle
    when 'monthly' then p.monthly_price_cents
    else p.annual_price_cents
  end
from public.billing_plans p
cross join (values ('monthly'::public.billing_cycle), ('annual'::public.billing_cycle)) as c(cycle)
where p.code in ('trial', 'free', 'basic', 'pro', 'enterprise')
  and not exists (
    select 1 from public.billing_plan_prices pp
    where pp.plan_id = p.id and pp.billing_cycle = c.cycle
  );
