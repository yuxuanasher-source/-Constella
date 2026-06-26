-- 供需撮合论坛 / 派单市场 —— 数据地基（首期端到端最小闭环）。
--
-- 设计要点（对应需求文档）：
--   * 信息默认全公开：需求订单 / 接单资料的「内容字段」对全平台 MCN 公开可读，
--     并进入 AI 抓取范围；靠「成交必须经平台」保护收益，而非遮挡信息。
--   * 防白嫖：联系方式与「达成后披露」字段拆到独立私有表，RLS 仅发单方 / 已达成
--     对家可读（列级遮挡靠分表 + API 选列，沿用现有 toSafeShare 范式）。
--   * 撮合达成：记录 marketplace_deals 撮合关系，作为后续协作与权益归属依据；
--     按既定决策，达成生成「待确认协作申请」（深度桥接到 project_collaboration_*
--     放后续期，此处先落 pending 撮合关系 + 预留协作申请引用列）。

-- ── 平台级 MCN 员工判定：任一组织的在职 MCN 员工即视为平台 MCN（公开读门槛）──
create or replace function public.is_platform_mcn_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_members om
    where om.user_id = auth.uid()
      and om.status = 'active'
      and om.role in ('owner', 'ops_manager', 'operator_business', 'finance')
  );
$$;

-- ════════════════════════════════ 需求订单（发单 / 二手单）════════════════════════════════
create table if not exists public.marketplace_postings (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  created_by uuid not null references public.profiles(id),
  post_type text not null default 'demand' check (post_type in ('demand', 'supply')),
  status text not null default 'draft'
    check (status in ('draft', 'open', 'matched', 'closed', 'expired')),
  title text not null,
  product_name text,
  category text,
  budget_cents integer check (budget_cents is null or budget_cents >= 0),
  settlement_method text,
  requirements text,
  description text,
  deadline_at timestamptz,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists marketplace_postings_org_idx
  on public.marketplace_postings (organization_id, status);
create index if not exists marketplace_postings_public_idx
  on public.marketplace_postings (status, category, created_at desc);

create trigger marketplace_postings_touch_updated_at
before update on public.marketplace_postings
for each row execute function public.touch_updated_at();

-- 发单方私有 / 达成后披露字段（联系方式、内部联系人、最终结算细节）。
create table if not exists public.marketplace_posting_private (
  posting_id uuid primary key references public.marketplace_postings(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  contact text,
  disclose_after_deal jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger marketplace_posting_private_touch_updated_at
before update on public.marketplace_posting_private
for each row execute function public.touch_updated_at();

-- ════════════════════════════════ 接单投递（接单资料）════════════════════════════════
create table if not exists public.marketplace_applications (
  id uuid primary key default extensions.gen_random_uuid(),
  posting_id uuid not null references public.marketplace_postings(id) on delete cascade,
  applicant_organization_id uuid not null references public.organizations(id) on delete cascade,
  created_by uuid not null references public.profiles(id),
  status text not null default 'draft'
    check (status in ('draft', 'submitted', 'under_review', 'need_more',
                      'approved', 'rejected', 'withdrawn', 'deal_confirmed')),
  streamer_lineup text,
  past_cases text,
  quote_cents integer check (quote_cents is null or quote_cents >= 0),
  resources text,
  message text,
  review_note text,
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- 同一接单方对同一需求只保留一条投递（可改状态 / 重投）。
  unique (posting_id, applicant_organization_id)
);

create index if not exists marketplace_applications_posting_idx
  on public.marketplace_applications (posting_id, status);
create index if not exists marketplace_applications_applicant_idx
  on public.marketplace_applications (applicant_organization_id, status);

create trigger marketplace_applications_touch_updated_at
before update on public.marketplace_applications
for each row execute function public.touch_updated_at();

-- 接单方私有字段（联系方式）。
create table if not exists public.marketplace_application_private (
  application_id uuid primary key references public.marketplace_applications(id) on delete cascade,
  applicant_organization_id uuid not null references public.organizations(id) on delete cascade,
  contact text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger marketplace_application_private_touch_updated_at
before update on public.marketplace_application_private
for each row execute function public.touch_updated_at();

-- ════════════════════════════════ 撮合达成关系 ════════════════════════════════
create table if not exists public.marketplace_deals (
  id uuid primary key default extensions.gen_random_uuid(),
  posting_id uuid not null references public.marketplace_postings(id) on delete cascade,
  application_id uuid not null references public.marketplace_applications(id) on delete cascade,
  owner_organization_id uuid not null references public.organizations(id) on delete cascade,
  applicant_organization_id uuid not null references public.organizations(id) on delete cascade,
  status text not null default 'pending_collaboration'
    check (status in ('pending_collaboration', 'collaboration_active', 'cancelled')),
  -- 后续期：桥接到现有协作流程后回填协作申请 / 协议 id。
  collaboration_application_id uuid references public.project_collaboration_applications(id),
  collaboration_agreement_id uuid references public.project_collaboration_agreements(id),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (application_id)
);

create index if not exists marketplace_deals_owner_idx
  on public.marketplace_deals (owner_organization_id, status);
create index if not exists marketplace_deals_applicant_idx
  on public.marketplace_deals (applicant_organization_id, status);

create trigger marketplace_deals_touch_updated_at
before update on public.marketplace_deals
for each row execute function public.touch_updated_at();

-- ── 跨表 RLS 辅助（security definer，避免策略内对受 RLS 表递归）──
create or replace function public.is_marketplace_posting_owner(target_posting_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_org_member(p.organization_id)
  from public.marketplace_postings p
  where p.id = target_posting_id;
$$;

-- 当前用户所在组织是否为该需求的「已达成对家」（用于私有字段达成后披露）。
create or replace function public.is_marketplace_posting_partner(target_posting_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.marketplace_deals d
    where d.posting_id = target_posting_id
      and d.status in ('pending_collaboration', 'collaboration_active')
      and public.is_org_member(d.applicant_organization_id)
  );
$$;

-- ════════════════════════════════ RLS ════════════════════════════════
alter table public.marketplace_postings enable row level security;
alter table public.marketplace_posting_private enable row level security;
alter table public.marketplace_applications enable row level security;
alter table public.marketplace_application_private enable row level security;
alter table public.marketplace_deals enable row level security;

-- 需求订单：发单方全权管理；其余平台 MCN 仅可读已公开（非草稿）订单。
create policy marketplace_postings_owner_manage
on public.marketplace_postings
for all
to authenticated
using (public.is_mcn_staff(organization_id))
with check (public.is_mcn_staff(organization_id));

create policy marketplace_postings_public_read
on public.marketplace_postings
for select
to authenticated
using (
  public.is_platform_mcn_staff()
  and status in ('open', 'matched', 'closed')
);

-- 需求私有字段：仅发单方 / 已达成对家可读；仅发单方可写。
create policy marketplace_posting_private_manage
on public.marketplace_posting_private
for all
to authenticated
using (public.is_mcn_staff(organization_id))
with check (public.is_mcn_staff(organization_id));

create policy marketplace_posting_private_partner_read
on public.marketplace_posting_private
for select
to authenticated
using (public.is_marketplace_posting_partner(posting_id));

-- 接单投递：接单方管理自己的投递；发单方可读 / 可改（审核）本需求下的投递；
-- 其余平台 MCN 仅可读「已投递及之后」状态的投递（供 AI 接单画像）。
create policy marketplace_applications_applicant_manage
on public.marketplace_applications
for all
to authenticated
using (public.is_mcn_staff(applicant_organization_id))
with check (public.is_mcn_staff(applicant_organization_id));

create policy marketplace_applications_owner_review
on public.marketplace_applications
for all
to authenticated
using (public.is_marketplace_posting_owner(posting_id))
with check (public.is_marketplace_posting_owner(posting_id));

create policy marketplace_applications_public_read
on public.marketplace_applications
for select
to authenticated
using (
  public.is_platform_mcn_staff()
  and status in ('submitted', 'under_review', 'need_more', 'approved', 'deal_confirmed')
);

-- 接单私有字段：仅接单方 / 发单方可读；仅接单方可写。
create policy marketplace_application_private_manage
on public.marketplace_application_private
for all
to authenticated
using (public.is_mcn_staff(applicant_organization_id))
with check (public.is_mcn_staff(applicant_organization_id));

create policy marketplace_application_private_owner_read
on public.marketplace_application_private
for select
to authenticated
using (
  public.is_marketplace_posting_owner(
    (select a.posting_id from public.marketplace_applications a where a.id = application_id)
  )
);

-- 撮合达成：发单方 / 接单方双方可读；发单方（撮合发起方）可写。
create policy marketplace_deals_party_read
on public.marketplace_deals
for select
to authenticated
using (
  public.is_org_member(owner_organization_id)
  or public.is_org_member(applicant_organization_id)
);

create policy marketplace_deals_owner_manage
on public.marketplace_deals
for all
to authenticated
using (public.is_mcn_staff(owner_organization_id))
with check (public.is_mcn_staff(owner_organization_id));
