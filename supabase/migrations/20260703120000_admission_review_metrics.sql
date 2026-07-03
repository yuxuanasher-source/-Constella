-- 审核校准指标（Phase 3）：nightly runner 从 admission_review_signals 物化。
-- checkpoint_key = '' 表示整体指标；非空为逐卡点指标。
create table if not exists public.admission_review_metrics (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  metric_key text not null,
  checkpoint_key text not null default '',
  numerator integer not null default 0,
  denominator integer not null default 0,
  computed_at timestamptz not null default now(),
  unique (organization_id, period_start, period_end, metric_key, checkpoint_key),
  constraint admission_review_metrics_counts_nonnegative check (
    numerator >= 0 and denominator >= 0 and numerator <= denominator
  )
);

create index if not exists admission_review_metrics_org_period_idx
on public.admission_review_metrics (organization_id, period_end desc, metric_key);

alter table public.admission_review_metrics enable row level security;

create policy admission_review_metrics_staff_access
on public.admission_review_metrics
for all
using (public.is_org_member(organization_id) and public.is_mcn_staff(organization_id))
with check (public.is_org_member(organization_id) and public.is_mcn_staff(organization_id));
