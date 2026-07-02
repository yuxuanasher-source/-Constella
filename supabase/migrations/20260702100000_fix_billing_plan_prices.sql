-- 修正内置付费套餐被 seed 成 0 的价格。
--
-- 背景：20260619120000_default_billing_subscription.sql 先把 basic/pro/enterprise
-- 的 monthly_price_cents / annual_price_cents seed 成了 0；随后
-- 20260620100000_p6_payment.sql 重新插入套餐时使用 on conflict (code) do nothing，
-- 已存在的 0 价行永远不会被修正，billing_plan_prices 的价格版本又是从
-- billing_plans 复制的，同样落成了 0。展示层（app/pricing/pricing-data.ts 的
-- DEFAULT_PUBLIC_PRICING_PLANS）硬编码兜底了对外价格，但数据库计费真值仍是 0。
--
-- 修正价以 pricing-data.ts 的对外展示价为准（与 p6 迁移原本想插入的价格一致，
-- 两处金额无冲突）：
--   basic       月付 29900   年付 299000
--   pro         月付 99900   年付 999000
--   enterprise  月付 299900  年付 2999000
-- free / trial 保持 0。
--
-- 所有语句仅在当前价格为 0 时生效：已被人工调成非 0 的价格不会被覆盖，
-- 重复执行为 no-op，幂等。

-- 1) 按 code 逐个修正 billing_plans 的套餐价（仅覆盖 0 价）。
update public.billing_plans
set monthly_price_cents = 29900
where code = 'basic'
  and monthly_price_cents = 0;

update public.billing_plans
set annual_price_cents = 299000
where code = 'basic'
  and annual_price_cents = 0;

update public.billing_plans
set monthly_price_cents = 99900
where code = 'pro'
  and monthly_price_cents = 0;

update public.billing_plans
set annual_price_cents = 999000
where code = 'pro'
  and annual_price_cents = 0;

update public.billing_plans
set monthly_price_cents = 299900
where code = 'enterprise'
  and monthly_price_cents = 0;

update public.billing_plans
set annual_price_cents = 2999000
where code = 'enterprise'
  and annual_price_cents = 0;

-- 2) 同步价格版本表 billing_plan_prices（monthly / annual 两种 cycle）：
--    active 且为 0 价的版本 → 更新为修正后的套餐价；已有非 0 active 价不动。
update public.billing_plan_prices pp
set price_cents = case pp.billing_cycle
    when 'monthly' then p.monthly_price_cents
    else p.annual_price_cents
  end
from public.billing_plans p
where pp.plan_id = p.id
  and p.code in ('basic', 'pro', 'enterprise')
  and pp.active
  and pp.price_cents = 0
  and case pp.billing_cycle
    when 'monthly' then p.monthly_price_cents
    else p.annual_price_cents
  end > 0;

-- 3) 缺失 active 价格版本的 plan/cycle 组合 → 按修正后的套餐价补插。
insert into public.billing_plan_prices (plan_id, billing_cycle, price_cents)
select p.id, c.cycle, case c.cycle
    when 'monthly' then p.monthly_price_cents
    else p.annual_price_cents
  end
from public.billing_plans p
cross join (values ('monthly'::public.billing_cycle), ('annual'::public.billing_cycle)) as c(cycle)
where p.code in ('basic', 'pro', 'enterprise')
  and not exists (
    select 1 from public.billing_plan_prices pp
    where pp.plan_id = p.id
      and pp.billing_cycle = c.cycle
      and pp.active
  );
