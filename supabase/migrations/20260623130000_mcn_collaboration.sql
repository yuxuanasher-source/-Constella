-- P-B MCN 跨组织协作
-- 甲方(host)开放项目协作，乙方(partner)凭协作码加入，在协同面板上传主播/账号/录屏，
-- 同步进甲方录屏待审核库；甲方一审通过后落地到现有履约链路。
--
-- 隔离原则：默认仍单租户。本迁移只为"已激活的协作方"新增 *只读* 策略（叠加 permissive），
-- 不改动任何现有策略；所有写操作仍限甲方。审核权限由 DB 触发器在数据库层钉死。

create type public.collaboration_status as enum (
  'invited',     -- 已邀请，待乙方接受
  'active',      -- 协作中
  'paused',      -- 暂停
  'ended',       -- 结束
  'revoked'      -- 撤销
);

create type public.collaboration_settlement_mode as enum (
  'percentage',     -- 按百分比分成（基数=项目毛利）
  'hourly_fixed'    -- 每小时固定抽成（按结算时长）
);

create type public.collaboration_submission_status as enum (
  'submitted',         -- 乙方已提交，待甲方一审
  'under_review',      -- 甲方一审中
  'approved',          -- 一审通过 → 落地履约链路
  'rejected',          -- 一审驳回
  'needs_changes'      -- 退回补充
);

create table public.project_collaborations (
  id uuid primary key default extensions.gen_random_uuid(),

  host_organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,

  partner_organization_id uuid references public.organizations(id) on delete cascade,
  invite_code text unique,

  status public.collaboration_status not null default 'invited',

  settlement_mode public.collaboration_settlement_mode not null default 'percentage',
  share_percentage numeric(6, 4),
  hourly_fixed_amount numeric(12, 2),

  invited_by uuid references public.profiles(id),
  accepted_by uuid references public.profiles(id),
  accepted_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (project_id, partner_organization_id),
  constraint project_collaborations_share_valid check (
    (settlement_mode = 'percentage'
      and share_percentage is not null
      and share_percentage >= 0 and share_percentage <= 1)
    or
    (settlement_mode = 'hourly_fixed'
      and hourly_fixed_amount is not null
      and hourly_fixed_amount >= 0)
  ),
  constraint project_collaborations_self_partner_forbidden check (
    partner_organization_id is null
    or partner_organization_id <> host_organization_id
  )
);

create table public.collaboration_submissions (
  id uuid primary key default extensions.gen_random_uuid(),
  collaboration_id uuid not null references public.project_collaborations(id) on delete cascade,

  -- 冗余双方组织 + 项目，便于双向 RLS 命中
  host_organization_id uuid not null references public.organizations(id) on delete cascade,
  partner_organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,

  -- 乙方上传内容
  streamer_name text not null,
  live_account text,
  recording_url text,
  note text,

  status public.collaboration_submission_status not null default 'submitted',

  -- 甲方一审
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  review_note text,

  -- 一审通过后落地的履约对象（甲方组织内实体）
  linked_streamer_id uuid references public.streamers(id),
  linked_recording_submission_id uuid references public.recording_submissions(id),

  submitted_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index project_collaborations_project_idx
  on public.project_collaborations (project_id, status);
create index project_collaborations_partner_idx
  on public.project_collaborations (partner_organization_id, status);
create index collaboration_submissions_collaboration_idx
  on public.collaboration_submissions (collaboration_id, status);
create index collaboration_submissions_host_status_idx
  on public.collaboration_submissions (host_organization_id, status);
create index collaboration_submissions_partner_idx
  on public.collaboration_submissions (partner_organization_id, status);

create trigger project_collaborations_touch_updated_at
before update on public.project_collaborations
for each row execute function public.touch_updated_at();

create trigger collaboration_submissions_touch_updated_at
before update on public.collaboration_submissions
for each row execute function public.touch_updated_at();

-- 当前用户是否为该项目已激活协作方(乙方) staff
create or replace function public.is_active_partner_collaborator(target_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.project_collaborations pc
    where pc.project_id = target_project_id
      and pc.status = 'active'
      and pc.partner_organization_id is not null
      and public.is_mcn_staff(pc.partner_organization_id)
  );
$$;

-- 甲方原有访问 OR 已激活协作方；仅供 select 放宽使用
create or replace function public.can_access_collaborated_project(target_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.can_access_project(target_project_id)
    or public.is_active_partner_collaborator(target_project_id);
$$;

-- 乙方凭协作码加入：协作码所在行在认领前 partner_organization_id 为空、乙方不可见，
-- 故用 security definer 原子认领，并校验调用者确为目标乙方组织 staff。
create or replace function public.accept_collaboration(
  p_invite_code text,
  p_partner_organization_id uuid
)
returns public.project_collaborations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.project_collaborations;
begin
  if not public.is_mcn_staff(p_partner_organization_id) then
    raise exception 'Only MCN staff of the partner organization can accept';
  end if;

  select * into v_row
  from public.project_collaborations
  where invite_code = p_invite_code
    and status = 'invited'
  for update;

  if not found then
    raise exception 'Invite code is invalid or already used';
  end if;

  if v_row.host_organization_id = p_partner_organization_id then
    raise exception 'Cannot accept your own collaboration invite';
  end if;

  update public.project_collaborations
  set partner_organization_id = p_partner_organization_id,
      status = 'active',
      accepted_by = auth.uid(),
      accepted_at = now()
  where id = v_row.id
  returning * into v_row;

  return v_row;
end;
$$;

-- 审核权限在数据库层钉死：除"乙方重新提交(submitted)"外，任何状态流转及
-- 审核/落地字段变更必须由甲方 staff 执行。
create or replace function public.enforce_collaboration_review_authority()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status is distinct from old.status and new.status <> 'submitted' then
    if not (public.is_org_member(old.host_organization_id)
            and public.is_mcn_staff(old.host_organization_id)) then
      raise exception 'Only host organization staff can review collaboration submissions';
    end if;
  end if;

  if new.reviewed_by is distinct from old.reviewed_by
     or new.linked_streamer_id is distinct from old.linked_streamer_id
     or new.linked_recording_submission_id is distinct from old.linked_recording_submission_id then
    if not (public.is_org_member(old.host_organization_id)
            and public.is_mcn_staff(old.host_organization_id)) then
      raise exception 'Only host organization staff can review collaboration submissions';
    end if;
  end if;

  return new;
end;
$$;

create trigger collaboration_submissions_enforce_review
before update on public.collaboration_submissions
for each row execute function public.enforce_collaboration_review_authority();

alter table public.project_collaborations enable row level security;
alter table public.collaboration_submissions enable row level security;

-- 甲方 staff 全权
create policy project_collaborations_host_access
on public.project_collaborations
for all
to authenticated
using (public.is_org_member(host_organization_id) and public.is_mcn_staff(host_organization_id))
with check (public.is_org_member(host_organization_id) and public.is_mcn_staff(host_organization_id));

-- 乙方 staff 只读自己已认领的协作行（认领走 accept_collaboration definer 函数）
create policy project_collaborations_partner_read
on public.project_collaborations
for select
to authenticated
using (
  partner_organization_id is not null
  and public.is_mcn_staff(partner_organization_id)
);

-- 乙方 staff 对自己的提交可增改读（敏感审核字段由触发器拦截）
create policy collaboration_submissions_partner_manage
on public.collaboration_submissions
for all
to authenticated
using (public.is_mcn_staff(partner_organization_id))
with check (public.is_mcn_staff(partner_organization_id));

-- 甲方 staff 对落在自己项目的提交可读 + 审核
create policy collaboration_submissions_host_review
on public.collaboration_submissions
for all
to authenticated
using (public.is_org_member(host_organization_id) and public.is_mcn_staff(host_organization_id))
with check (public.is_org_member(host_organization_id) and public.is_mcn_staff(host_organization_id));

-- 叠加式只读放宽：已激活协作方可读项目履约数据用于查看/排版协同。
-- 注意：仅 select，且不含 settlement_batches / settlement_batch_items（甲方成本/毛利不外泄）。
create policy projects_partner_collaborator_read
on public.projects
for select
to authenticated
using (public.is_active_partner_collaborator(id));

create policy live_tasks_partner_collaborator_read
on public.live_tasks
for select
to authenticated
using (project_id is not null and public.is_active_partner_collaborator(project_id));

create policy live_reports_partner_collaborator_read
on public.live_reports
for select
to authenticated
using (public.is_active_partner_collaborator(project_id));

create policy project_streamers_partner_collaborator_read
on public.project_streamers
for select
to authenticated
using (public.is_active_partner_collaborator(project_id));
