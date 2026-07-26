-- OCR attribution is derived from the live report/task in the database.
-- metric_window is the authoritative session date in Asia/Shanghai:
-- system start, then planned start, then report creation as the final fallback.

alter table public.ocr_results
  add column if not exists streamer_id uuid references public.streamers(id) on delete cascade,
  add column if not exists project_id uuid references public.projects(id) on delete cascade,
  add column if not exists report_date date;

create or replace function public.sync_ocr_result_attribution()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_streamer_id uuid;
  v_project_id uuid;
  v_report_date date;
begin
  select
    lr.streamer_id,
    lr.project_id,
    (
      coalesce(
        lt.system_started_at,
        lt.planned_start_at,
        lr.created_at
      ) at time zone 'Asia/Shanghai'
    )::date
  into
    v_streamer_id,
    v_project_id,
    v_report_date
  from public.live_reports as lr
  join public.live_tasks as lt
    on lt.id = lr.live_task_id
   and lt.organization_id = lr.organization_id
  where lr.id = new.live_report_id
    and lr.organization_id = new.organization_id;

  if not found then
    raise exception 'OCR result live report attribution mismatch'
      using errcode = '23503';
  end if;

  new.streamer_id := v_streamer_id;
  new.project_id := v_project_id;
  new.report_date := v_report_date;
  return new;
end;
$$;

revoke all on function public.sync_ocr_result_attribution()
  from public, anon, authenticated, service_role;

-- Keep the historical backfill set-based. The trigger is installed below with
-- the same derivation for every future write.
update public.ocr_results as ocr
set streamer_id = lr.streamer_id,
    project_id = lr.project_id,
    report_date = (
      coalesce(
        lt.system_started_at,
        lt.planned_start_at,
        lr.created_at
      ) at time zone 'Asia/Shanghai'
    )::date
from public.live_reports as lr
join public.live_tasks as lt
  on lt.id = lr.live_task_id
 and lt.organization_id = lr.organization_id
where lr.id = ocr.live_report_id
  and lr.organization_id = ocr.organization_id
  and (
    ocr.streamer_id is distinct from lr.streamer_id
    or ocr.project_id is distinct from lr.project_id
    or ocr.report_date is distinct from (
      coalesce(
        lt.system_started_at,
        lt.planned_start_at,
        lr.created_at
      ) at time zone 'Asia/Shanghai'
    )::date
  );

drop trigger if exists ocr_results_sync_attribution
  on public.ocr_results;

create trigger ocr_results_sync_attribution
before insert or update on public.ocr_results
for each row execute function public.sync_ocr_result_attribution();

create index if not exists ocr_results_streamer_report_date_idx
  on public.ocr_results (organization_id, streamer_id, report_date);

create index if not exists ocr_results_project_report_date_idx
  on public.ocr_results (organization_id, project_id, report_date);

alter table public.streamer_metrics
  add column if not exists source_report_id uuid references public.live_reports(id) on delete cascade;

create unique index if not exists streamer_metrics_ocr_report_metric_unique
  on public.streamer_metrics (organization_id, streamer_id, metric_key, metric_window, source_report_id);

drop function if exists public.upsert_ocr_streamer_metrics(
  uuid, jsonb, uuid, boolean
);

create or replace function public.upsert_ocr_streamer_metrics(
  p_live_report_id uuid,
  p_metrics jsonb,
  p_source_invocation_id uuid
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_report record;
  v_ocr record;
  v_metric jsonb;
  v_metric_key text;
  v_metric_value numeric;
  v_seen_keys text[] := array[]::text[];
  v_written integer := 0;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'OCR metric writer requires the service role'
      using errcode = '42501';
  end if;
  if p_source_invocation_id is null then
    raise exception 'OCR metric source invocation is required'
      using errcode = '22023';
  end if;

  select
    lr.id,
    lr.organization_id,
    lr.project_id,
    lr.streamer_id,
    lr.status,
    (
      coalesce(
        lt.system_started_at,
        lt.planned_start_at,
        lr.created_at
      ) at time zone 'Asia/Shanghai'
    )::date as report_date
  into v_report
  from public.live_reports as lr
  join public.live_tasks as lt
    on lt.id = lr.live_task_id
   and lt.organization_id = lr.organization_id
  where lr.id = p_live_report_id
  for update of lr;

  if not found then
    raise exception 'OCR metric live report not found'
      using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.ai_invocations as invocation
    where invocation.id = p_source_invocation_id
      and invocation.organization_id = v_report.organization_id
      and invocation.scene = 'ocr.extract_live_report'
      and invocation.object_type = 'live_report'
      and invocation.object_id = p_live_report_id::text
  ) then
    raise exception 'OCR metric source invocation does not match the report'
      using errcode = '23503';
  end if;

  select
    ocr.id,
    ocr.status,
    ocr.needs_confirmation,
    ocr.reviewed_at
  into v_ocr
  from public.ocr_results as ocr
  join public.background_jobs as bj
    on bj.id = ocr.background_job_id
   and bj.organization_id = ocr.organization_id
   and bj.ai_invocation_id = p_source_invocation_id
   and bj.job_type = 'ocr.extract_live_report'
   and bj.status = 'succeeded'
  where ocr.live_report_id = p_live_report_id
    and ocr.organization_id = v_report.organization_id
    and ocr.ai_invocation_id = p_source_invocation_id
    and public.ocr_job_live_report_id(bj.payload) = p_live_report_id
  order by ocr.created_at desc
  limit 1
  for update of ocr;

  if not found
    or v_report.status <> 'ocr_ing'
    or v_ocr.status <> 'succeeded'
    or v_ocr.needs_confirmation
    or v_ocr.reviewed_at is not null
  then
    return 0;
  end if;

  if p_metrics is null or jsonb_typeof(p_metrics) <> 'array' then
    raise exception 'OCR metrics must be a JSON array'
      using errcode = '22023';
  end if;

  for v_metric in
    select item.value
    from jsonb_array_elements(p_metrics) as item(value)
  loop
    if jsonb_typeof(v_metric) is distinct from 'object'
      or jsonb_typeof(v_metric -> 'key') is distinct from 'string'
      or jsonb_typeof(v_metric -> 'value') is distinct from 'number'
    then
      raise exception 'OCR metric entries require string key and numeric value'
        using errcode = '22023';
    end if;

    v_metric_key := v_metric ->> 'key';
    if not (
      v_metric_key = any (
        array[
          'viewers', 'pcu', 'acu', 'exposure', 'clicks', 'interactions',
          'comments', 'likes', 'shares', 'follows', 'gmv'
        ]::text[]
      )
    ) then
      raise exception 'Unsupported OCR metric key: %', v_metric_key
        using errcode = '22023';
    end if;
    if v_metric_key = any (v_seen_keys) then
      raise exception 'duplicate metric key: %', v_metric_key
        using errcode = '22023';
    end if;
    v_seen_keys := array_append(v_seen_keys, v_metric_key);

    v_metric_value := (v_metric ->> 'value')::numeric;
    if v_metric_value < 0
      or v_metric_value > 2147483647
      or v_metric_value <> trunc(v_metric_value)
    then
      raise exception 'OCR metric value must be an int4-safe nonnegative integer'
        using errcode = '22023';
    end if;

    insert into public.streamer_metrics as existing (
      organization_id,
      streamer_id,
      metric_key,
      metric_value,
      metric_window,
      source_invocation_id,
      source_report_id
    )
    values (
      v_report.organization_id,
      v_report.streamer_id,
      v_metric_key,
      v_metric_value::integer,
      v_report.report_date::text,
      p_source_invocation_id,
      v_report.id
    )
    on conflict (organization_id, streamer_id, metric_key, metric_window, source_report_id)
    do update
      set metric_value = excluded.metric_value,
          source_invocation_id = excluded.source_invocation_id,
          recorded_at = now();
    v_written := v_written + 1;
  end loop;

  return v_written;
end;
$$;

revoke all on function public.upsert_ocr_streamer_metrics(
  uuid, jsonb, uuid
) from public, anon, authenticated, service_role;

grant execute on function public.upsert_ocr_streamer_metrics(
  uuid, jsonb, uuid
) to service_role;

drop function if exists public.confirm_ocr_job_metrics(
  uuid, uuid, timestamptz, jsonb, jsonb
);

create or replace function public.confirm_ocr_job_metrics(
  p_job_id uuid,
  p_reviewed_by uuid,
  p_reviewed_at timestamptz,
  p_manual_result jsonb,
  p_metrics jsonb,
  p_confirmed_duration integer,
  p_confirmed_viewers integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job record;
  v_ocr record;
  v_report record;
  v_metric jsonb;
  v_metric_key text;
  v_metric_value numeric;
  v_seen_keys text[] := array[]::text[];
  v_written integer := 0;
  v_confirmed_duration integer;
  v_confirmed_viewers integer;
  v_settlement_duration integer;
  v_time_source public.time_source;
  v_evidence_level public.evidence_level;
  v_divergence_pct numeric(8, 4);
  v_allowed_diff numeric;
  v_risk_flags text[] := array[]::text[];
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'OCR confirmation requires the service role'
      using errcode = '42501';
  end if;
  if p_reviewed_by is null or p_reviewed_at is null then
    raise exception 'OCR confirmation reviewer and timestamp are required'
      using errcode = '22023';
  end if;
  if p_manual_result is null or jsonb_typeof(p_manual_result) <> 'object' then
    raise exception 'OCR manual result must be a JSON object'
      using errcode = '22023';
  end if;
  if p_metrics is null or jsonb_typeof(p_metrics) <> 'array' then
    raise exception 'OCR metrics must be a JSON array'
      using errcode = '22023';
  end if;
  if p_confirmed_duration < 0 or p_confirmed_viewers < 0 then
    raise exception 'OCR confirmed duration and viewers must be nonnegative'
      using errcode = '22023';
  end if;

  -- Lock order is stable across every manual confirmation: job, OCR result,
  -- then report. Settlement locks the report before it can leave the review
  -- pool, so either confirmation lands completely first or writes nothing.
  select
    bj.id,
    bj.organization_id,
    bj.job_type,
    bj.status,
    bj.ai_invocation_id,
    public.ocr_job_live_report_id(bj.payload) as live_report_id
  into v_job
  from public.background_jobs as bj
  where bj.id = p_job_id
  for update;

  if not found or v_job.job_type <> 'ocr.extract_live_report' then
    raise exception 'OCR confirmation job not found'
      using errcode = '22023';
  end if;

  select
    ocr.id,
    ocr.organization_id,
    ocr.live_report_id,
    ocr.ai_invocation_id,
    ocr.status,
    ocr.needs_confirmation,
    ocr.reviewed_at,
    ocr.extracted_duration,
    ocr.extracted_viewers
  into v_ocr
  from public.ocr_results as ocr
  where ocr.background_job_id = v_job.id
    and ocr.organization_id = v_job.organization_id
    and ocr.live_report_id = v_job.live_report_id
  order by ocr.created_at desc
  limit 1
  for update;

  if not found then
    raise exception 'OCR confirmation result not found'
      using errcode = '22023';
  end if;

  select
    lr.id,
    lr.organization_id,
    lr.project_id,
    lr.streamer_id,
    lr.status,
    lr.system_duration,
    lr.claimed_duration,
    lr.viewers,
    lr.risk_flags,
    (
      coalesce(
        lt.system_started_at,
        lt.planned_start_at,
        lr.created_at
      ) at time zone 'Asia/Shanghai'
    )::date as report_date
  into v_report
  from public.live_reports as lr
  join public.live_tasks as lt
    on lt.id = lr.live_task_id
   and lt.organization_id = lr.organization_id
  where lr.id = v_ocr.live_report_id
    and lr.organization_id = v_job.organization_id
  for update of lr;

  if not found then
    raise exception 'OCR confirmation live report not found'
      using errcode = '22023';
  end if;

  if v_job.status not in ('needs_confirmation', 'needs_review')
    or v_ocr.status <> 'needs_confirmation'
    or v_ocr.needs_confirmation is not true
    or v_ocr.reviewed_at is not null
    or v_ocr.ai_invocation_id is distinct from v_job.ai_invocation_id
    or v_report.status not in ('ocr_ing', 'pending_review')
  then
    return jsonb_build_object('confirmed', false, 'metricsWritten', 0);
  end if;

  v_confirmed_duration := coalesce(
    nullif(p_confirmed_duration, 0),
    nullif(v_ocr.extracted_duration, 0)
  );
  v_confirmed_viewers := coalesce(
    nullif(p_confirmed_viewers, 0),
    nullif(v_ocr.extracted_viewers, 0),
    v_report.viewers
  );

  select coalesce(
    array_agg(item.flag order by item.ordinality),
    array[]::text[]
  )
  into v_risk_flags
  from unnest(coalesce(v_report.risk_flags, array[]::text[]))
    with ordinality as item(flag, ordinality)
  where item.flag <> 'ocr_pending'
    and item.flag not like 'ocr\_%' escape '\'
    and item.flag not in (
      'duration_divergence',
      'missing_system_duration',
      'missing_screenshot_duration'
    );

  if v_report.system_duration is not null then
    v_settlement_duration := v_report.system_duration;
    v_time_source := 'system';
    if v_confirmed_duration is null then
      v_evidence_level := 'yellow';
      v_divergence_pct := null;
      v_risk_flags := array_append(
        v_risk_flags,
        'missing_screenshot_duration'
      );
    else
      v_divergence_pct := round(
        abs(v_report.system_duration - v_confirmed_duration)::numeric
          / greatest(v_report.system_duration, 1)::numeric,
        4
      );
      v_allowed_diff := greatest(v_report.system_duration * 0.10, 15);
      if abs(v_report.system_duration - v_confirmed_duration)
        <= v_allowed_diff
      then
        v_evidence_level := 'green';
      else
        v_evidence_level := 'yellow';
        v_risk_flags := array_append(v_risk_flags, 'duration_divergence');
      end if;
    end if;
  else
    v_risk_flags := array_append(v_risk_flags, 'missing_system_duration');
    if v_confirmed_duration is not null then
      v_settlement_duration := v_confirmed_duration;
      v_time_source := 'screenshot';
      v_evidence_level := 'yellow';
      v_divergence_pct := null;
    else
      v_risk_flags := array_append(
        v_risk_flags,
        'missing_screenshot_duration'
      );
      if v_report.claimed_duration is not null
        and v_report.claimed_duration > 0
      then
        v_settlement_duration := v_report.claimed_duration;
        v_time_source := 'claimed';
        v_evidence_level := 'red';
        v_divergence_pct := null;
      else
        raise exception 'Report requires system, screenshot, or claimed duration'
          using errcode = '22023';
      end if;
    end if;
  end if;

  if v_job.ai_invocation_id is null
    or not exists (
      select 1
      from public.ai_invocations as invocation
      where invocation.id = v_job.ai_invocation_id
        and invocation.organization_id = v_report.organization_id
        and invocation.scene = 'ocr.extract_live_report'
        and invocation.object_type = 'live_report'
        and invocation.object_id = v_report.id::text
    )
  then
    raise exception 'OCR confirmation source invocation does not match the report'
      using errcode = '23503';
  end if;

  for v_metric in
    select item.value
    from jsonb_array_elements(p_metrics) as item(value)
  loop
    if jsonb_typeof(v_metric) is distinct from 'object'
      or jsonb_typeof(v_metric -> 'key') is distinct from 'string'
      or jsonb_typeof(v_metric -> 'value') is distinct from 'number'
    then
      raise exception 'OCR metric entries require string key and numeric value'
        using errcode = '22023';
    end if;
    v_metric_key := v_metric ->> 'key';
    if not (
      v_metric_key = any (
        array[
          'viewers', 'pcu', 'acu', 'exposure', 'clicks', 'interactions',
          'comments', 'likes', 'shares', 'follows', 'gmv'
        ]::text[]
      )
    ) then
      raise exception 'Unsupported OCR metric key: %', v_metric_key
        using errcode = '22023';
    end if;
    if v_metric_key = any (v_seen_keys) then
      raise exception 'duplicate metric key: %', v_metric_key
        using errcode = '22023';
    end if;
    v_seen_keys := array_append(v_seen_keys, v_metric_key);
    v_metric_value := (v_metric ->> 'value')::numeric;
    if v_metric_value < 0
      or v_metric_value > 2147483647
      or v_metric_value <> trunc(v_metric_value)
    then
      raise exception 'OCR metric value must be an int4-safe nonnegative integer'
        using errcode = '22023';
    end if;
  end loop;

  update public.ocr_results
  set status = 'succeeded',
      needs_confirmation = false,
      manual_result = p_manual_result,
      reviewed_by = p_reviewed_by,
      reviewed_at = p_reviewed_at,
      updated_at = p_reviewed_at
  where id = v_ocr.id;

  update public.background_jobs
  set status = 'succeeded',
      error_code = null,
      error_message = null,
      error_summary = null,
      result = coalesce(result, '{}'::jsonb)
        || jsonb_build_object('manualResult', p_manual_result),
      review_payload = p_manual_result,
      reviewed_by = p_reviewed_by,
      reviewed_at = p_reviewed_at,
      locked_at = null,
      locked_by = null,
      updated_at = p_reviewed_at
  where id = v_job.id;

  for v_metric in
    select item.value
    from jsonb_array_elements(p_metrics) as item(value)
  loop
    v_metric_key := v_metric ->> 'key';
    v_metric_value := (v_metric ->> 'value')::numeric;
    insert into public.streamer_metrics as existing (
      organization_id,
      streamer_id,
      metric_key,
      metric_value,
      metric_window,
      source_invocation_id,
      source_report_id
    )
    values (
      v_report.organization_id,
      v_report.streamer_id,
      v_metric_key,
      v_metric_value::integer,
      v_report.report_date::text,
      v_job.ai_invocation_id,
      v_report.id
    )
    on conflict (organization_id, streamer_id, metric_key, metric_window, source_report_id)
    do update
      set metric_value = excluded.metric_value,
          source_invocation_id = excluded.source_invocation_id,
          recorded_at = now();
    v_written := v_written + 1;
  end loop;

  update public.live_reports
  set status = case
        when v_report.status = 'ocr_ing'
          then 'pending_review'::public.report_status
        else v_report.status
      end,
      screenshot_duration = v_confirmed_duration,
      viewers = v_confirmed_viewers,
      settlement_duration = v_settlement_duration,
      time_source = v_time_source,
      evidence_level = v_evidence_level,
      divergence_pct = v_divergence_pct,
      risk_flags = v_risk_flags,
      updated_at = p_reviewed_at
  where id = v_report.id;

  return jsonb_build_object(
    'confirmed', true,
    'metricsWritten', v_written
  );
end;
$$;

revoke all on function public.confirm_ocr_job_metrics(
  uuid, uuid, timestamptz, jsonb, jsonb, integer, integer
) from public, anon, authenticated, service_role;

grant execute on function public.confirm_ocr_job_metrics(
  uuid, uuid, timestamptz, jsonb, jsonb, integer, integer
) to service_role;
