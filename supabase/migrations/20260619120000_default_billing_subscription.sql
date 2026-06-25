-- Default billing subscription provisioning.
--
-- Problem: the billing gate (features/billing/route-guard.ts) blocks settlement
-- and other feature writes for organizations whose plan tier does not grant the
-- feature. Entitlements are derived from the subscription's plan tier, but no
-- plans were seeded and organizations were never given a subscription, so every
-- org fell back to the "free" tier (settlement = false) and saving a settlement
-- rule failed with "Current plan is not entitled to settlement".
--
-- Fix: seed the standard plans and guarantee every organization (existing and
-- future) has a subscription on a sensible default plan that includes
-- settlement, so the product works out of the box. Pricing/tier can be adjusted
-- later without code changes.

-- 1) Seed the standard plans. Idempotent via the unique `code`. Entitlements are
--    resolved in app code from the plan tier (see features/billing/billing-gates.ts);
--    the included_* quotas below only drive usage-status display, not write gating.
insert into public.billing_plans (
  code, tier, name,
  monthly_price_cents, annual_price_cents,
  included_active_streamers, included_seats,
  included_ocr, included_ai, included_storage_mb, included_exports
)
values
  ('free',       'free',       '免费版', 0, 0,   0,    0,    0,      0,      0,      0),
  ('basic',      'basic',      '基础版', 0, 0,   50,   20,   5000,   5000,   10240,  1000),
  ('pro',        'pro',        '专业版', 0, 0,   200,  100,  50000,  50000,  102400, 50000),
  ('enterprise', 'enterprise', '旗舰版', 0, 0,   100000, 100000, 1000000, 1000000, 10240000, 1000000)
on conflict (code) do nothing;

-- 2) Ensure a single organization has a subscription on the default plan.
--    Default plan = 'pro' (includes settlement, export_center, war_room,
--    auto_review_shadow, ai_diagnosis). Change the `code` below to adjust the
--    default grant. Status 'trialing' keeps writes enabled (not read-only) and
--    flags the subscription as an auto-provisioned default.
create or replace function public.ensure_default_org_subscription(target_org_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  default_plan_id uuid;
begin
  select id into default_plan_id
  from public.billing_plans
  where code = 'pro'
  limit 1;

  if default_plan_id is null then
    return;
  end if;

  insert into public.organization_subscriptions (
    organization_id, plan_id, status, billing_cycle,
    current_period_start, current_period_end
  )
  values (
    target_org_id, default_plan_id, 'trialing', 'monthly',
    current_date, (current_date + interval '100 years')::date
  )
  on conflict (organization_id) do nothing;
end;
$$;

-- 3) Backfill every existing organization that has no subscription yet.
do $$
declare
  org_row record;
begin
  for org_row in
    select o.id
    from public.organizations o
    left join public.organization_subscriptions s
      on s.organization_id = o.id
    where s.id is null
  loop
    perform public.ensure_default_org_subscription(org_row.id);
  end loop;
end;
$$;

-- 4) Auto-provision a default subscription whenever a new organization is created.
--    A database trigger covers every creation path (signup flow, admin, scripts).
create or replace function public.provision_default_org_subscription()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.ensure_default_org_subscription(new.id);
  return new;
end;
$$;

drop trigger if exists organizations_default_subscription on public.organizations;
create trigger organizations_default_subscription
after insert on public.organizations
for each row execute function public.provision_default_org_subscription();
