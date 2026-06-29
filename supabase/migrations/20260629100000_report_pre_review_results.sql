-- Report AI pre-review results are append-only suggestions for pending live reports.
-- They never mutate the live report review status and only store safe summaries.

create table public.report_pre_review_results (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  live_report_id uuid not null references public.live_reports(id) on delete cascade,
  ai_invocation_id uuid references public.ai_invocations(id) on delete set null,
  created_by uuid references public.profiles(id),
  decision text not null,
  confidence text not null,
  evidence_summary text not null,
  suggested_action text not null,
  review_note_draft text not null,
  reasons text[] not null default '{}'::text[],
  failed_gates text[] not null default '{}'::text[],
  source text not null default 'deterministic',
  status_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint report_pre_review_results_decision_check check (
    decision in (
      'quick_pass_candidate',
      'manual_review',
      'need_more_evidence',
      'high_risk_blocked'
    )
  ),
  constraint report_pre_review_results_action_check check (
    suggested_action in ('approve', 'need_more', 'reject', 'review')
  ),
  constraint report_pre_review_results_confidence_check check (
    confidence in ('high', 'medium', 'low')
  ),
  constraint report_pre_review_results_source_check check (
    source in ('deterministic', 'llm', 'degraded')
  )
);

create index report_pre_review_results_report_created_idx
  on public.report_pre_review_results (
    organization_id,
    live_report_id,
    created_at desc
  );

create index report_pre_review_results_invocation_idx
  on public.report_pre_review_results (ai_invocation_id);

alter table public.report_pre_review_results enable row level security;

create policy report_pre_review_results_staff_read
on public.report_pre_review_results for select
using (public.is_mcn_staff(organization_id));

create policy report_pre_review_results_staff_insert
on public.report_pre_review_results for insert
with check (public.is_mcn_staff(organization_id));
