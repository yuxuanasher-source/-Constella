-- 自助试用 → Onboarding → 付费墙漏斗：自助开通、引导进度、转化埋点、销售线索

-- 销售辅助 / 大客户线索（落地页「联系销售」CTA 写入）
create table public.mcn_onboarding_requests (
  id uuid primary key default gen_random_uuid(),
  company_name text not null,
  contact_name text not null,
  contact_phone text not null,
  contact_email text,
  note text,
  source text not null default 'landing_contact_sales',
  status text not null default 'new',
  created_at timestamptz not null default now()
);

create type public.onboarding_step as enum (
  'create_project',
  'add_streamer',
  'schedule_live',
  'submit_report',
  'view_settlement',
  'invite_member'
);

create table public.onboarding_progress (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  step public.onboarding_step not null,
  completed_at timestamptz not null default now(),
  completed_by uuid references public.profiles(id),
  unique (organization_id, step)
);

create table public.funnel_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete set null,
  anonymous_id text,
  user_id uuid references public.profiles(id) on delete set null,
  event text not null,
  reason text,
  variant text,
  properties jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);

create index funnel_events_event_idx on public.funnel_events (event, occurred_at);
create index funnel_events_org_idx on public.funnel_events (organization_id, occurred_at);
create index funnel_events_anon_idx on public.funnel_events (anonymous_id);
create index onboarding_progress_org_idx on public.onboarding_progress (organization_id);

-- 自助开通：在一个事务内创建 profile → org → member(owner) → trial 订阅，
-- 避免分步写入产生半成品组织；security definer 集中做防滥用校验。
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

  -- 确保 profile 存在（自助注册路径无 handle_new_user 触发器）
  insert into public.profiles (id, email, full_name)
  values (v_user, v_email, coalesce(nullif(trim(p_full_name), ''), v_email))
  on conflict (id) do nothing;

  -- 防滥用：一个用户只能自助开通一个组织
  if exists (
    select 1 from public.organization_members om
    where om.user_id = v_user and om.status = 'active'
  ) then
    raise exception 'User already belongs to an organization';
  end if;

  v_code := coalesce(
    nullif(trim(p_org_code), ''),
    'org_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)
  );

  select id into v_plan_id from public.billing_plans where code = 'trial' limit 1;
  if v_plan_id is null then
    raise exception 'Trial plan is not configured';
  end if;

  insert into public.organizations (name, code)
  values (trim(p_org_name), v_code)
  returning id into v_org_id;

  insert into public.organization_members (organization_id, user_id, role, status)
  values (v_org_id, v_user, 'owner', 'active');

  insert into public.organization_subscriptions (
    organization_id, plan_id, status, billing_cycle,
    current_period_start, current_period_end, trial_ends_at, auto_renew
  ) values (
    v_org_id, v_plan_id, 'trialing', 'monthly',
    v_today, v_today + 14, now() + interval '14 days', true
  );

  return v_org_id;
end;
$$;

revoke all on function public.provision_self_serve_org(text, text, text) from public;
grant execute on function public.provision_self_serve_org(text, text, text) to authenticated;

-- RLS
alter table public.mcn_onboarding_requests enable row level security;
alter table public.onboarding_progress enable row level security;
alter table public.funnel_events enable row level security;

-- 线索表：无 authenticated 策略，写入仅 service role（落地页通过 admin client 写入）

create policy "staff read onboarding"
on public.onboarding_progress for select
using (public.is_mcn_staff(organization_id));

create policy "staff write onboarding"
on public.onboarding_progress for all
using (public.is_mcn_staff(organization_id))
with check (public.is_mcn_staff(organization_id));

-- 漏斗事件：staff 读自己组织；注册后事件可由 staff 客户端写入；
-- 注册前（anonymous_id，org 为空）事件经 service role 写入。
create policy "staff read funnel events"
on public.funnel_events for select
using (organization_id is not null and public.is_mcn_staff(organization_id));

create policy "staff insert funnel events"
on public.funnel_events for insert
with check (organization_id is not null and public.is_mcn_staff(organization_id));
