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

create or replace function public.upsert_ocr_streamer_metrics(
  p_live_report_id uuid,
  p_metrics jsonb,
  p_source_invocation_id uuid default null,
  p_human_confirmed boolean default false
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller_role text := coalesce(auth.role(), '');
  v_report record;
  v_metric jsonb;
  v_metric_key text;
  v_metric_value numeric;
  v_seen_keys text[] := array[]::text[];
  v_written integer := 0;
begin
  if v_caller_role not in ('authenticated', 'service_role') then
    raise exception 'OCR metric writer is not authorized'
      using errcode = '42501';
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
  where lr.id = p_live_report_id;

  if not found then
    raise exception 'OCR metric live report not found'
      using errcode = '22023';
  end if;

  if v_caller_role = 'authenticated'
    and not (
      public.is_mcn_staff(v_report.organization_id)
      and public.can_access_project(v_report.project_id)
    )
  then
    raise exception 'OCR metric writer cannot access this live report'
      using errcode = '42501';
  end if;

  if p_source_invocation_id is not null
    and not exists (
      select 1
      from public.ai_invocations as invocation
      where invocation.id = p_source_invocation_id
        and invocation.organization_id = v_report.organization_id
    )
  then
    raise exception 'OCR metric invocation organization mismatch'
      using errcode = '23503';
  end if;

  -- Ordinary OCR may write only while the report is in the OCR stage.
  -- Human confirmation may also complete a result already in pending_review,
  -- but terminal/reviewed/settled states can never be rewritten.
  if p_human_confirmed then
    if v_report.status not in ('ocr_ing', 'pending_review')
      or not exists (
        select 1
        from public.ocr_results as ocr
        where ocr.live_report_id = v_report.id
          and ocr.organization_id = v_report.organization_id
          and ocr.status = 'succeeded'
          and ocr.needs_confirmation = false
          and ocr.reviewed_at is not null
      )
    then
      return 0;
    end if;
  elsif v_report.status <> 'ocr_ing'
    or not exists (
      select 1
      from public.ocr_results as ocr
      where ocr.live_report_id = v_report.id
        and ocr.organization_id = v_report.organization_id
        and ocr.status = 'succeeded'
        and ocr.needs_confirmation = false
        and ocr.reviewed_at is null
    )
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
          'viewers',
          'pcu',
          'acu',
          'exposure',
          'clicks',
          'interactions',
          'comments',
          'likes',
          'shares',
          'follows',
          'gmv'
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

    -- GMV is stored as whole CNY yuan; the existing parser rounds before RPC.
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
          source_invocation_id = coalesce(
            excluded.source_invocation_id,
            existing.source_invocation_id
          ),
          recorded_at = now();

    v_written := v_written + 1;
  end loop;

  return v_written;
end;
$$;

revoke all on function public.upsert_ocr_streamer_metrics(
  uuid, jsonb, uuid, boolean
) from public, anon, authenticated, service_role;

grant execute on function public.upsert_ocr_streamer_metrics(
  uuid, jsonb, uuid, boolean
) to authenticated, service_role;
