-- P-A 账号库二期：直播账号库安全管控 + 生命周期 + 数据同步
-- 1) 档案补全：粉丝量、所属项目、密保信息、最近直播/同步时间，状态新增 nurturing（养号中）
-- 2) 安全管控：登录设备白名单、登录日志、封禁记录存档
-- 3) 生命周期：状态流转全流程记录（含自动标记闲置）
-- 4) 数据同步：平台开放接口拉取的粉丝/场观/流水日指标

-- 注意：新枚举值在本迁移内不得被使用（同事务限制），仅声明。
alter type public.platform_account_status add value if not exists 'nurturing';

alter table public.platform_accounts
  add column follower_count bigint not null default 0,
  add column project_id uuid references public.projects(id) on delete set null,
  add column security_phone text,
  add column security_email text,
  add column last_live_at timestamptz,
  add column last_synced_at timestamptz;

create index platform_accounts_project_idx
  on public.platform_accounts (project_id);

-- create or replace 只能在原列序末尾追加列
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
  pa.updated_at,
  pa.follower_count,
  pa.project_id,
  case
    when pa.security_phone is null then null
    when length(pa.security_phone) <= 4 then '****'
    else
      left(pa.security_phone, 3) || '****' ||
      right(pa.security_phone, 2)
  end as security_phone_masked,
  case
    when pa.security_email is null then null
    else left(pa.security_email, 1) || '***' ||
      coalesce(substring(pa.security_email from '@.*$'), '')
  end as security_email_masked,
  pa.last_live_at,
  pa.last_synced_at
from public.platform_accounts pa;

-- 登录设备白名单
create table public.platform_account_devices (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  account_id uuid not null references public.platform_accounts(id) on delete cascade,
  device_name text not null,
  device_fingerprint text not null,
  status text not null default 'active' check (status in ('active', 'revoked')),
  note text,
  created_by uuid references public.profiles(id),
  revoked_by uuid references public.profiles(id),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, device_fingerprint)
);

create index platform_account_devices_account_idx
  on public.platform_account_devices (account_id, status);

create trigger platform_account_devices_touch_updated_at
before update on public.platform_account_devices
for each row execute function public.touch_updated_at();

-- 登录日志：is_whitelisted / risk_level 由服务端按白名单判定后写入
create table public.platform_account_login_logs (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  account_id uuid not null references public.platform_accounts(id) on delete cascade,
  device_fingerprint text not null,
  device_name text,
  ip_address text,
  location text,
  logged_in_at timestamptz not null default now(),
  is_whitelisted boolean not null default false,
  risk_level text not null default 'normal' check (risk_level in ('normal', 'suspicious')),
  note text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create index platform_account_login_logs_account_idx
  on public.platform_account_login_logs (account_id, logged_in_at desc);

create index platform_account_login_logs_org_risk_idx
  on public.platform_account_login_logs (organization_id, risk_level);

-- 封禁记录存档：状态机流转到 frozen 时写入，解封时补 lifted_*
create table public.platform_account_ban_records (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  account_id uuid not null references public.platform_accounts(id) on delete cascade,
  reason text not null,
  source text,
  banned_at timestamptz not null default now(),
  lifted_at timestamptz,
  lifted_reason text,
  created_by uuid references public.profiles(id),
  lifted_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create index platform_account_ban_records_account_idx
  on public.platform_account_ban_records (account_id, banned_at desc);

-- 生命周期全流程记录：养号/启用/停播/封禁/注销以及自动闲置标记
create table public.platform_account_status_logs (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  account_id uuid not null references public.platform_accounts(id) on delete cascade,
  from_status public.platform_account_status not null,
  to_status public.platform_account_status not null,
  reason text,
  source text not null default 'manual' check (source in ('manual', 'auto_idle', 'metrics_sync')),
  changed_by uuid references public.profiles(id),
  changed_at timestamptz not null default now()
);

create index platform_account_status_logs_account_idx
  on public.platform_account_status_logs (account_id, changed_at desc);

-- 平台开放接口日指标：粉丝、场观、流水
create table public.platform_account_metrics (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  account_id uuid not null references public.platform_accounts(id) on delete cascade,
  metric_date date not null,
  follower_count bigint not null default 0,
  live_view_count bigint not null default 0,
  gmv_amount numeric(14, 2) not null default 0,
  live_duration_minutes integer not null default 0,
  source text not null default 'platform_api' check (source in ('platform_api', 'manual')),
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (account_id, metric_date)
);

create index platform_account_metrics_org_date_idx
  on public.platform_account_metrics (organization_id, metric_date desc);

-- RLS：安全与生命周期数据仅经营端员工可见；指标额外允许绑定主播读取
alter table public.platform_account_devices enable row level security;
alter table public.platform_account_login_logs enable row level security;
alter table public.platform_account_ban_records enable row level security;
alter table public.platform_account_status_logs enable row level security;
alter table public.platform_account_metrics enable row level security;

create policy platform_account_devices_staff_access
on public.platform_account_devices
for all
using (public.is_org_member(organization_id) and public.is_mcn_staff(organization_id))
with check (public.is_org_member(organization_id) and public.is_mcn_staff(organization_id));

create policy platform_account_login_logs_staff_access
on public.platform_account_login_logs
for all
using (public.is_org_member(organization_id) and public.is_mcn_staff(organization_id))
with check (public.is_org_member(organization_id) and public.is_mcn_staff(organization_id));

create policy platform_account_ban_records_staff_access
on public.platform_account_ban_records
for all
using (public.is_org_member(organization_id) and public.is_mcn_staff(organization_id))
with check (public.is_org_member(organization_id) and public.is_mcn_staff(organization_id));

create policy platform_account_status_logs_staff_access
on public.platform_account_status_logs
for all
using (public.is_org_member(organization_id) and public.is_mcn_staff(organization_id))
with check (public.is_org_member(organization_id) and public.is_mcn_staff(organization_id));

create policy platform_account_metrics_staff_access
on public.platform_account_metrics
for all
using (public.is_org_member(organization_id) and public.is_mcn_staff(organization_id))
with check (public.is_org_member(organization_id) and public.is_mcn_staff(organization_id));

create policy platform_account_metrics_streamer_read_own
on public.platform_account_metrics
for select
using (
  exists (
    select 1
    from public.platform_accounts pa
    where pa.id = account_id
      and pa.bound_streamer_id = public.current_streamer_id(organization_id)
  )
);

-- 表级授权（同 20260623130000_account_library_grants.sql 的说明）
grant all on table public.platform_account_devices
  to anon, authenticated, service_role;
grant all on table public.platform_account_login_logs
  to anon, authenticated, service_role;
grant all on table public.platform_account_ban_records
  to anon, authenticated, service_role;
grant all on table public.platform_account_status_logs
  to anon, authenticated, service_role;
grant all on table public.platform_account_metrics
  to anon, authenticated, service_role;
