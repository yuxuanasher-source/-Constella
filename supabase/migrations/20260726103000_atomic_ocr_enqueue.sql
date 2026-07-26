drop function if exists public.enqueue_ocr_job(
  uuid, uuid, uuid, uuid, uuid, uuid, text, public.app_role, jsonb, timestamptz
);

create or replace function public.enqueue_ocr_job(
  p_job_id uuid,
  p_invocation_id uuid,
  p_organization_id uuid,
  p_live_report_id uuid,
  p_screenshot_id uuid,
  p_actor_user_id uuid,
  p_actor_name text,
  p_actor_role public.app_role,
  p_payload jsonb,
  p_run_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_report public.live_reports%rowtype;
  v_job public.background_jobs%rowtype;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'OCR enqueue requires the service role'
      using errcode = '42501';
  end if;
  if p_job_id is null
    or p_invocation_id is null
    or p_organization_id is null
    or p_live_report_id is null
    or p_actor_user_id is null
    or p_actor_role is null
    or p_run_at is null
  then
    raise exception 'OCR enqueue identifiers and actor are required'
      using errcode = '22023';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'OCR enqueue payload must be an object'
      using errcode = '22023';
  end if;
  if p_payload ->> 'liveReportId' is distinct from p_live_report_id::text then
    raise exception 'OCR enqueue payload does not match live report'
      using errcode = '22023';
  end if;
  if p_screenshot_id is null then
    if nullif(p_payload ->> 'screenshotId', '') is not null then
      raise exception 'OCR enqueue payload screenshot mismatch'
        using errcode = '22023';
    end if;
  elsif p_payload ->> 'screenshotId' is distinct from p_screenshot_id::text then
    raise exception 'OCR enqueue payload screenshot mismatch'
      using errcode = '22023';
  end if;
  if coalesce(
    nullif(p_payload ->> 'imageBase64', ''),
    nullif(p_payload ->> 'imageUrl', ''),
    nullif(p_payload ->> 'imagePath', '')
  ) is null then
    raise exception 'OCR job requires imageBase64, imageUrl, or imagePath'
      using errcode = '22023';
  end if;

  select lr.*
  into v_report
  from public.live_reports as lr
  where lr.id = p_live_report_id
    and lr.organization_id = p_organization_id
  for update;

  if not found then
    raise exception 'OCR enqueue live report not found or organization mismatch'
      using errcode = '23503';
  end if;

  if p_screenshot_id is not null and not exists (
    select 1
    from public.report_screenshots as screenshot
    where screenshot.id = p_screenshot_id
      and screenshot.organization_id = v_report.organization_id
      and screenshot.live_report_id = v_report.id
      and screenshot.project_id = v_report.project_id
      and screenshot.streamer_id = v_report.streamer_id
  ) then
    raise exception 'OCR screenshot does not belong to live report'
      using errcode = '23503';
  end if;

  -- The report row lock serializes concurrent enqueues. Re-check inside the
  -- transaction so retries return the existing job without duplicate writes.
  select job.*
  into v_job
  from public.ocr_results as result
  join public.background_jobs as job
    on job.id = result.background_job_id
   and job.organization_id = result.organization_id
   and job.job_type = 'ocr.extract_live_report'
  where result.live_report_id = v_report.id
    and result.organization_id = v_report.organization_id
  order by result.created_at desc
  limit 1;

  if found then
    return to_jsonb(v_job);
  end if;

  insert into public.ai_invocations (
    id,
    organization_id,
    actor_user_id,
    actor_name,
    actor_role,
    scene,
    object_type,
    object_id,
    provider_name,
    status,
    metadata
  )
  values (
    p_invocation_id,
    v_report.organization_id,
    p_actor_user_id,
    p_actor_name,
    p_actor_role,
    'ocr.extract_live_report',
    'live_report',
    v_report.id::text,
    'tencent_ocr',
    'queued',
    jsonb_strip_nulls(
      jsonb_build_object(
        'jobId', p_job_id,
        'screenshotId', p_screenshot_id
      )
    )
  );

  insert into public.background_jobs (
    id,
    organization_id,
    job_type,
    payload,
    status,
    attempt,
    max_attempts,
    ai_invocation_id,
    run_after,
    next_run_at,
    result
  )
  values (
    p_job_id,
    v_report.organization_id,
    'ocr.extract_live_report',
    p_payload,
    'queued',
    0,
    3,
    p_invocation_id,
    p_run_at,
    p_run_at,
    '{}'::jsonb
  )
  returning * into v_job;

  insert into public.ocr_results (
    organization_id,
    live_report_id,
    screenshot_id,
    status,
    raw_result,
    raw_response,
    ai_invocation_id,
    background_job_id,
    needs_confirmation
  )
  values (
    v_report.organization_id,
    p_live_report_id,
    p_screenshot_id,
    'pending',
    '{}'::jsonb,
    '{}'::jsonb,
    p_invocation_id,
    p_job_id,
    false
  );

  return to_jsonb(v_job);
end;
$$;

revoke all on function public.enqueue_ocr_job(
  uuid, uuid, uuid, uuid, uuid, uuid, text, public.app_role, jsonb, timestamptz
) from public, anon, authenticated, service_role;

grant execute on function public.enqueue_ocr_job(
  uuid, uuid, uuid, uuid, uuid, uuid, text, public.app_role, jsonb, timestamptz
) to service_role;
