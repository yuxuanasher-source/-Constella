-- P-C 结算增强
-- 在现有 settlement_batches/settlement_batch_items 之上，新增：
--   1) 自定义收入/成本项（项目→主播二级维度，成本项支持自定义类目）
--   2) MCN 协同分成（百分比=项目毛利基数 / 每小时固定=结算时长）
-- 引擎：收入 − 成本 = 毛利 → 再算 MCN 分成 → 项目净毛利。

create type public.settlement_line_direction as enum (
  'revenue',   -- 收入项（厂家单价/礼物...）
  'cost'       -- 成本项（主播时薪/推广/税费/器材...自定义）
);

create table public.settlement_line_items (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  settlement_batch_id uuid not null references public.settlement_batches(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  streamer_id uuid references public.streamers(id),   -- null = 项目级整体项

  direction public.settlement_line_direction not null,
  category text not null,                             -- 类目键（可自定义）
  label text not null,                                -- 显示名
  amount numeric(12, 2) not null default 0,

  is_system_generated boolean not null default false, -- 引擎自动产出 vs 人工录入
  source_snapshot jsonb not null default '{}'::jsonb,
  reason text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint settlement_line_items_amount_nonnegative check (amount >= 0)
);

create table public.collaboration_settlements (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,  -- 甲方
  settlement_batch_id uuid not null references public.settlement_batches(id) on delete cascade,
  collaboration_id uuid not null references public.project_collaborations(id),
  project_id uuid not null references public.projects(id) on delete cascade,

  mode public.collaboration_settlement_mode not null,
  share_percentage numeric(6, 4),
  hourly_fixed_amount numeric(12, 2),
  basis_amount numeric(12, 2) not null default 0,   -- 百分比模式=项目毛利；固定模式=总小时数
  total_hours numeric(12, 2),
  computed_amount numeric(12, 2) not null default 0,
  manual_amount numeric(12, 2) not null default 0,
  note text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (settlement_batch_id, collaboration_id),
  constraint collaboration_settlements_amounts_nonnegative check (
    computed_amount >= 0 and manual_amount >= 0
  )
);

create index settlement_line_items_batch_idx
  on public.settlement_line_items (settlement_batch_id, direction);
create index settlement_line_items_streamer_idx
  on public.settlement_line_items (settlement_batch_id, streamer_id);
create index collaboration_settlements_batch_idx
  on public.collaboration_settlements (settlement_batch_id);
create index collaboration_settlements_collaboration_idx
  on public.collaboration_settlements (collaboration_id);

create trigger settlement_line_items_touch_updated_at
before update on public.settlement_line_items
for each row execute function public.touch_updated_at();

create trigger collaboration_settlements_touch_updated_at
before update on public.collaboration_settlements
for each row execute function public.touch_updated_at();

alter table public.settlement_line_items enable row level security;
alter table public.collaboration_settlements enable row level security;

-- 收入/成本项：甲方 staff 管理；finance 只读。乙方不可见（甲方成本/毛利不外泄）。
create policy settlement_line_items_staff_manage
on public.settlement_line_items
for all
to authenticated
using (
  public.is_mcn_staff(organization_id)
  and public.can_access_project(project_id)
)
with check (
  public.is_mcn_staff(organization_id)
  and public.can_access_project(project_id)
);

create policy settlement_line_items_finance_read
on public.settlement_line_items
for select
to authenticated
using (public.current_user_role(organization_id) = 'finance');

-- MCN 分成：甲方 staff 管理；乙方只读与自己相关的分成行。
create policy collaboration_settlements_staff_manage
on public.collaboration_settlements
for all
to authenticated
using (
  public.is_mcn_staff(organization_id)
  and public.can_access_project(project_id)
)
with check (
  public.is_mcn_staff(organization_id)
  and public.can_access_project(project_id)
);

create policy collaboration_settlements_finance_read
on public.collaboration_settlements
for select
to authenticated
using (public.current_user_role(organization_id) = 'finance');

create policy collaboration_settlements_partner_read
on public.collaboration_settlements
for select
to authenticated
using (
  exists (
    select 1
    from public.project_collaborations pc
    where pc.id = collaboration_settlements.collaboration_id
      and pc.partner_organization_id is not null
      and public.is_mcn_staff(pc.partner_organization_id)
  )
);
