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
      and (
        public.can_access_ocr_job(bj.organization_id, bj.payload)
        or (
          auth.role() = 'service_role'
          and exists (
            select 1
            from public.live_reports lr
            where lr.id = public.ocr_job_live_report_id(bj.payload)
              and lr.organization_id = p_organization_id
              and lr.organization_id = bj.organization_id
          )
        )
      )
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
