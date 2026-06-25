-- AI 安全地基（对应《经营舱·AI 能力全套方案》第 4 节状态机强制确认 + 附录 B）。
-- 1) state_machine_meta：由「目标状态」驱动是否需要人工确认（铁律 2），系统级配置。
-- 2) ai_drafts：L2 草稿落点，不影响主流程，受租户 RLS 约束。
-- 审计沿用现有 ai_invocations / ai_tool_invocations，不另建 ai_audit_log。

-- ===== 状态元数据（系统级、非租户数据；由迁移种子，应用只读）=====
create table public.state_machine_meta (
  state_machine          text not null,            -- 'settlement' | 'report' | 'onboarding' ...
  state                  text not null,
  ai_tier                text not null,            -- L1_PERCEIVE | L2_DRAFT | L3_BOUNDED | L4_FORBIDDEN
  requires_human_confirm boolean not null default false,
  financial_impact       boolean not null default false,
  is_frozen              boolean not null default false,
  high_risk_audit        boolean not null default false,
  created_at             timestamptz not null default now(),
  primary key (state_machine, state),
  constraint state_machine_meta_tier_check check (
    ai_tier in ('L1_PERCEIVE', 'L2_DRAFT', 'L3_BOUNDED', 'L4_FORBIDDEN')
  )
);

alter table public.state_machine_meta enable row level security;

-- 元数据非敏感，所有登录用户可读；无写策略，仅迁移种子（迁移以属主身份执行，绕过 RLS）。
create policy state_machine_meta_read
on public.state_machine_meta for select
using (true);

-- 种子：明确标注 L4 禁区（不可逆 / 带资金 / 冻结语义）。
insert into public.state_machine_meta
  (state_machine, state, ai_tier, requires_human_confirm, financial_impact, is_frozen, high_risk_audit)
values
  -- 结算状态机
  ('settlement', 'draft',          'L2_DRAFT',     false, false, false, false),
  ('settlement', 'generated',      'L3_BOUNDED',   true,  false, false, false),
  ('settlement', 'pending_confirm','L3_BOUNDED',   true,  false, false, false),
  ('settlement', 'confirmed',      'L4_FORBIDDEN', true,  true,  true,  false),
  ('settlement', 'locked',         'L4_FORBIDDEN', true,  true,  true,  false),
  ('settlement', 'reopened',       'L4_FORBIDDEN', true,  true,  false, true),
  ('settlement', 'exported',       'L3_BOUNDED',   false, false, false, false),
  -- 报数 / 证据三轨
  ('report', 'pending_review',     'L3_BOUNDED',   true,  false, false, false),
  ('report', 'enter_settlement_pool','L4_FORBIDDEN',true, true,  true,  false),
  ('report', 'green',              'L4_FORBIDDEN', false, false, true,  false),
  ('report', 'yellow',             'L4_FORBIDDEN', false, false, true,  false),
  ('report', 'red',                'L4_FORBIDDEN', false, false, true,  false),
  -- 选播准入
  ('onboarding', 'recording_submitted','L1_PERCEIVE',false,false, false, false),
  ('onboarding', 'recording_approved', 'L4_FORBIDDEN',true, true,  true,  false),
  ('onboarding', 'joined',             'L4_FORBIDDEN',true, true,  true,  false);

-- ===== AI 草稿（L2 落点，受 RLS 约束）=====
create table public.ai_drafts (
  id              uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  draft_type      text not null,                  -- 'settlement_batch' | 'schedule' | 'recruitment' | 'retrospective' ...
  acting_user_id  uuid not null references public.profiles(id),
  target_state_machine text,
  target_state    text,
  payload         jsonb not null default '{}'::jsonb,
  status          text not null default 'pending',
  ai_invocation_id uuid references public.ai_invocations(id) on delete set null,
  confirmed_by    uuid references public.profiles(id),
  confirmed_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint ai_drafts_status_check check (status in ('pending', 'confirmed', 'discarded'))
);

alter table public.ai_drafts enable row level security;

-- 草稿是 MCN 员工面向的工作产物，复用租户隔离：仅本组织员工可读写。
create policy ai_drafts_staff_access
on public.ai_drafts for all
using (public.is_mcn_staff(organization_id))
with check (public.is_mcn_staff(organization_id));

create index ai_drafts_org_type_idx
  on public.ai_drafts (organization_id, draft_type, status, created_at desc);
create index ai_drafts_invocation_idx
  on public.ai_drafts (ai_invocation_id);

create trigger ai_drafts_touch_updated_at
before update on public.ai_drafts
for each row execute function public.touch_updated_at();
