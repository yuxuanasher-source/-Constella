alter table public.background_jobs
  add column if not exists next_run_at timestamptz,
  add column if not exists error_code text,
  add column if not exists error_message text,
  add column if not exists result jsonb not null default '{}'::jsonb,
  add column if not exists reviewed_by uuid references public.profiles(id),
  add column if not exists reviewed_at timestamptz,
  add column if not exists review_payload jsonb not null default '{}'::jsonb;

update public.background_jobs
set next_run_at = run_after
where next_run_at is null;

alter table public.background_jobs
  drop constraint if exists background_jobs_status_check;

alter table public.background_jobs
  add constraint background_jobs_status_check check (
    status in (
      'queued',
      'pending',
      'running',
      'processing',
      'succeeded',
      'failed',
      'needs_confirmation',
      'needs_review',
      'cancelled'
    )
  );

create index if not exists background_jobs_ocr_runnable_idx
  on public.background_jobs (
    organization_id,
    job_type,
    status,
    coalesce(next_run_at, run_after),
    locked_at
  )
  where job_type = 'ocr.extract_live_report';

alter table public.ocr_results
  add column if not exists error_code text,
  add column if not exists manual_result jsonb not null default '{}'::jsonb,
  add column if not exists reviewed_by uuid references public.profiles(id),
  add column if not exists reviewed_at timestamptz;

create or replace function public.ocr_job_live_report_id(target_payload jsonb)
returns uuid
language sql
immutable
as $$
  select case
    when target_payload ->> 'liveReportId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then (target_payload ->> 'liveReportId')::uuid
    else null
  end;
$$;

create or replace function public.can_access_ocr_job(
  target_organization_id uuid,
  target_payload jsonb
)
returns boolean
language sql
stable
as $$
  select public.is_mcn_staff(target_organization_id)
    and exists (
      select 1
      from public.live_reports lr
      where lr.id = public.ocr_job_live_report_id(target_payload)
        and lr.organization_id = target_organization_id
        and public.can_access_project(lr.project_id)
    );
$$;

drop policy if exists background_jobs_staff_access
on public.background_jobs;

create policy background_jobs_staff_access
on public.background_jobs for all
using (
  public.is_mcn_staff(organization_id)
  and (
    job_type <> 'ocr.extract_live_report'
    or public.can_access_ocr_job(organization_id, payload)
  )
)
with check (
  public.is_mcn_staff(organization_id)
  and (
    job_type <> 'ocr.extract_live_report'
    or public.can_access_ocr_job(organization_id, payload)
  )
);

drop policy if exists ocr_results_staff_insert
on public.ocr_results;

create policy ocr_results_staff_insert
on public.ocr_results for insert
with check (
  public.is_mcn_staff(organization_id)
  and exists (
    select 1
    from public.live_reports lr
    where lr.id = ocr_results.live_report_id
      and lr.organization_id = ocr_results.organization_id
      and public.can_access_project(lr.project_id)
  )
);

drop policy if exists ocr_results_staff_update
on public.ocr_results;

create policy ocr_results_staff_update
on public.ocr_results for update
using (
  public.is_mcn_staff(organization_id)
  and exists (
    select 1
    from public.live_reports lr
    where lr.id = ocr_results.live_report_id
      and lr.organization_id = ocr_results.organization_id
      and public.can_access_project(lr.project_id)
  )
)
with check (
  public.is_mcn_staff(organization_id)
  and exists (
    select 1
    from public.live_reports lr
    where lr.id = ocr_results.live_report_id
      and lr.organization_id = ocr_results.organization_id
      and public.can_access_project(lr.project_id)
  )
);

create or replace function public.claim_ocr_jobs(
  p_organization_id uuid,
  p_runner_id text,
  p_limit integer default 1,
  p_lock_timeout_seconds integer default 900,
  p_now timestamptz default now()
)
returns setof public.background_jobs
language plpgsql
security invoker
set search_path = public
as $$
begin
  return query
  with candidates as (
    select bj.id
    from public.background_jobs bj
    where bj.organization_id = p_organization_id
      and bj.job_type = 'ocr.extract_live_report'
      and bj.attempt < bj.max_attempts
      and public.can_access_ocr_job(bj.organization_id, bj.payload)
      and (
        (
          bj.status in ('queued', 'pending')
          and coalesce(bj.next_run_at, bj.run_after, bj.created_at) <= p_now
        )
        or (
          bj.status in ('running', 'processing')
          and (
            bj.locked_at is null
            or bj.locked_at <= p_now - make_interval(secs => p_lock_timeout_seconds)
          )
        )
      )
    order by coalesce(bj.next_run_at, bj.run_after, bj.created_at), bj.created_at
    for update skip locked
    limit greatest(1, least(coalesce(p_limit, 1), 10))
  )
  update public.background_jobs bj
  set
    status = 'running',
    locked_at = p_now,
    locked_by = p_runner_id,
    updated_at = p_now
  from candidates
  where bj.id = candidates.id
  returning bj.*;
end;
$$;
