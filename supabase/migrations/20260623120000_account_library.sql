-- P-A 账号库：组织级独立账号资产库
-- 账号是组织经营资产，独立于主播存在（自孵化账号可换运营主播）。

create type public.platform_account_type as enum (
  'self_incubated',   -- 自孵化
  'partner',          -- 合作商
  'streamer_owned'    -- 主播自带
);

create type public.platform_account_status as enum (
  'active',           -- 在用
  'idle',             -- 闲置
  'frozen',           -- 冻结/封禁
  'retired'           -- 注销
);

create table public.platform_accounts (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,

  -- 平台与标识
  platform text not null,
  account_source text,
  account_uid text not null,
  xingtu_id text,
  cooperation_code text,

  -- 分类
  account_type public.platform_account_type not null default 'self_incubated',
  status public.platform_account_status not null default 'active',

  -- 实名合规（脱敏字段）
  real_name_holder text,
  real_name_phone text,

  -- 运营归属
  operator_id uuid references public.profiles(id),
  bound_streamer_id uuid references public.streamers(id) on delete set null,

  note text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (organization_id, platform, account_uid),
  constraint platform_accounts_streamer_owned_requires_bind check (
    account_type <> 'streamer_owned' or bound_streamer_id is not null
  )
);

create index platform_accounts_org_status_idx
  on public.platform_accounts (organization_id, status);

create index platform_accounts_bound_streamer_idx
  on public.platform_accounts (bound_streamer_id);

create index platform_accounts_operator_idx
  on public.platform_accounts (operator_id);

create trigger platform_accounts_touch_updated_at
before update on public.platform_accounts
for each row execute function public.touch_updated_at();

-- 脱敏视图：实名手机号掩码，供主播端及非高权角色读取
create or replace view public.platform_accounts_safe
with (security_invoker = true)
as
select
  pa.id,
  pa.organization_id,
  pa.platform,
  pa.account_source,
  pa.account_uid,
  pa.xingtu_id,
  pa.cooperation_code,
  pa.account_type,
  pa.status,
  pa.real_name_holder,
  case
    when pa.real_name_phone is null then null
    when length(pa.real_name_phone) <= 4 then '****'
    else
      left(pa.real_name_phone, 3) || '****' ||
      right(pa.real_name_phone, 2)
  end as real_name_phone_masked,
  pa.operator_id,
  pa.bound_streamer_id,
  pa.note,
  pa.created_at,
  pa.updated_at
from public.platform_accounts pa;

alter table public.platform_accounts enable row level security;

create policy platform_accounts_staff_access
on public.platform_accounts
for all
using (public.is_org_member(organization_id) and public.is_mcn_staff(organization_id))
with check (public.is_org_member(organization_id) and public.is_mcn_staff(organization_id));

create policy platform_accounts_streamer_read_own
on public.platform_accounts
for select
using (bound_streamer_id = public.current_streamer_id(organization_id));
