-- 上播审核卡点体系（PRD: docs/prd/2026-07-02-admission-review-checkpoint-learning-prd.md）
-- Phase 0：卡点字典 / 审核评估 / 逐卡点结果 / 对齐信号 / 校准配置。
-- 默认卡点字典 v1 内置在代码（features/admission-review/contracts.ts），
-- 组织自定义时才写 admission_review_checkpoints，避免 seed 数据进源码。

create table if not exists public.admission_review_checkpoints (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  rubric_version integer not null,
  key text not null,
  label text not null,
  description text,
  severity text not null check (severity in ('hard_block', 'soft', 'bonus')),
  applicable_stage text not null check (
    applicable_stage in ('mcn_first', 'vendor_second', 'both')
  ),
  weight numeric not null default 1,
  active boolean not null default true,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (organization_id, rubric_version, key),
  constraint admission_review_checkpoints_version_positive check (rubric_version > 0)
);

create table if not exists public.admission_review_evaluations (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  application_id uuid not null references public.project_applications(id) on delete cascade,
  submission_id uuid not null references public.recording_submissions(id) on delete cascade,
  stage text not null check (
    stage in ('ai_pre_review', 'mcn_first', 'vendor_second')
  ),
  rubric_version integer not null,
  decision text not null,
  decision_confidence text check (
    decision_confidence in ('high', 'medium', 'low')
  ),
  reviewer_id uuid references public.profiles(id),
  vendor_review_id uuid references public.project_recording_vendor_reviews(id) on delete set null,
  ai_invocation_id uuid references public.ai_invocations(id) on delete set null,
  note text,
  note_source text not null default 'human' check (
    note_source in ('human', 'llm_classified', 'needs_classification')
  ),
  created_at timestamptz not null default now()
);

create table if not exists public.admission_review_checkpoint_results (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  evaluation_id uuid not null references public.admission_review_evaluations(id) on delete cascade,
  checkpoint_key text not null,
  verdict text not null check (verdict in ('pass', 'fail', 'not_applicable')),
  confidence numeric check (confidence >= 0 and confidence <= 1),
  note text,
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (evaluation_id, checkpoint_key)
);

create table if not exists public.admission_review_signals (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  application_id uuid not null references public.project_applications(id) on delete cascade,
  submission_id uuid not null references public.recording_submissions(id) on delete cascade,
  signal_kind text not null check (
    signal_kind in (
      'ai_vs_mcn',
      'mcn_vs_vendor',
      'resubmission_cycle',
      'post_join_outcome'
    )
  ),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (submission_id, signal_kind)
);

create table if not exists public.admission_review_calibration (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  checkpoint_key text not null,
  score_cutoff integer check (score_cutoff between 0 and 100),
  min_confidence numeric check (min_confidence >= 0 and min_confidence <= 1),
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now(),
  primary key (organization_id, checkpoint_key)
);

create index if not exists admission_review_evaluations_submission_idx
on public.admission_review_evaluations (submission_id, stage, created_at desc);

create index if not exists admission_review_evaluations_org_stage_idx
on public.admission_review_evaluations (organization_id, stage, created_at desc);

create index if not exists admission_review_checkpoint_results_eval_idx
on public.admission_review_checkpoint_results (evaluation_id);

create index if not exists admission_review_signals_org_kind_idx
on public.admission_review_signals (organization_id, signal_kind, created_at desc);

alter table public.admission_review_checkpoints enable row level security;
alter table public.admission_review_evaluations enable row level security;
alter table public.admission_review_checkpoint_results enable row level security;
alter table public.admission_review_signals enable row level security;
alter table public.admission_review_calibration enable row level security;

create policy admission_review_checkpoints_staff_access
on public.admission_review_checkpoints
for all
using (public.is_org_member(organization_id) and public.is_mcn_staff(organization_id))
with check (public.is_org_member(organization_id) and public.is_mcn_staff(organization_id));

create policy admission_review_evaluations_staff_access
on public.admission_review_evaluations
for all
using (public.is_org_member(organization_id) and public.is_mcn_staff(organization_id))
with check (public.is_org_member(organization_id) and public.is_mcn_staff(organization_id));

create policy admission_review_checkpoint_results_staff_access
on public.admission_review_checkpoint_results
for all
using (public.is_org_member(organization_id) and public.is_mcn_staff(organization_id))
with check (public.is_org_member(organization_id) and public.is_mcn_staff(organization_id));

create policy admission_review_signals_staff_access
on public.admission_review_signals
for all
using (public.is_org_member(organization_id) and public.is_mcn_staff(organization_id))
with check (public.is_org_member(organization_id) and public.is_mcn_staff(organization_id));

create policy admission_review_calibration_staff_access
on public.admission_review_calibration
for all
using (public.is_org_member(organization_id) and public.is_mcn_staff(organization_id))
with check (public.is_org_member(organization_id) and public.is_mcn_staff(organization_id));

-- 主播可读自己的审核卡点结果（驳回理由结构化回流主播端）。
create policy admission_review_evaluations_streamer_read_own
on public.admission_review_evaluations
for select
using (
  exists (
    select 1
    from public.project_applications pa
    where pa.id = admission_review_evaluations.application_id
      and pa.streamer_id = public.current_streamer_id(admission_review_evaluations.organization_id)
  )
);

create policy admission_review_checkpoint_results_streamer_read_own
on public.admission_review_checkpoint_results
for select
using (
  exists (
    select 1
    from public.admission_review_evaluations are_eval
    join public.project_applications pa on pa.id = are_eval.application_id
    where are_eval.id = admission_review_checkpoint_results.evaluation_id
      and pa.streamer_id = public.current_streamer_id(admission_review_checkpoint_results.organization_id)
  )
);
