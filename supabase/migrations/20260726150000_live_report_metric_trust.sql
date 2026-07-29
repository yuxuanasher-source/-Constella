-- Preserve the provenance of the final viewer value and centralize
-- cross-source / historical trust flags at the database boundary.

alter table public.live_reports
  add column if not exists viewers_source text;

-- Historical rows cannot be reconstructed reliably after OCR/manual values
-- were collapsed into live_reports.viewers. Backfill them conservatively as
-- claimed instead of overstating machine provenance.
update public.live_reports
set viewers_source = 'claimed'
where viewers is not null
  and viewers_source is null;

alter table public.live_reports
  drop constraint if exists live_reports_viewers_source_check;

alter table public.live_reports
  add constraint live_reports_viewers_source_check check (
    (viewers is null and viewers_source is null)
    or (
      viewers is not null
      and viewers_source in ('ocr', 'manual', 'claimed')
    )
  );

comment on column public.live_reports.viewers_source is
  'Provenance of live_reports.viewers: OCR extraction, manual confirmation, or claimed input.';

create or replace function public.sync_live_report_viewer_trust()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ocr_viewers integer;
  v_ocr_reviewed_at timestamptz;
  v_reference_viewers integer;
  v_source_was_explicit boolean := false;
  v_diverged boolean := false;
begin
  if new.viewers is null then
    new.viewers_source := null;
    new.risk_flags := array_remove(
      coalesce(new.risk_flags, array[]::text[]),
      'viewers_divergence'
    );
    return new;
  end if;

  select
    ocr.extracted_viewers,
    ocr.reviewed_at
  into
    v_ocr_viewers,
    v_ocr_reviewed_at
  from public.ocr_results as ocr
  where ocr.live_report_id = new.id
    and ocr.organization_id = new.organization_id
  order by ocr.created_at desc
  limit 1;

  -- Respect an explicitly changed source from the application. The fallback
  -- inference keeps the atomic SQL confirmation RPC source-aware as well.
  if tg_op = 'INSERT' then
    v_source_was_explicit := new.viewers_source is not null;
  else
    v_source_was_explicit :=
      new.viewers_source is distinct from old.viewers_source
      and new.viewers_source is not null;
  end if;

  if v_source_was_explicit then
    null;
  elsif v_ocr_reviewed_at is not null then
    new.viewers_source := 'manual';
  elsif v_ocr_viewers is not null and v_ocr_viewers = new.viewers then
    new.viewers_source := 'ocr';
  else
    new.viewers_source := 'claimed';
  end if;

  if new.viewers_source = 'manual' and v_ocr_viewers is not null then
    v_reference_viewers := v_ocr_viewers;
  elsif tg_op = 'UPDATE'
    and new.viewers_source = 'ocr'
    and old.viewers is not null
    and old.viewers_source in ('manual', 'claimed')
  then
    v_reference_viewers := old.viewers;
  end if;

  if v_reference_viewers is not null then
    v_diverged :=
      abs(new.viewers - v_reference_viewers)
        > greatest(v_reference_viewers * 0.20, 100);
    new.risk_flags := array_remove(
      coalesce(new.risk_flags, array[]::text[]),
      'viewers_divergence'
    );
    if v_diverged then
      new.risk_flags := array_append(
        new.risk_flags,
        'viewers_divergence'
      );
    end if;
  end if;

  if v_diverged and new.evidence_level = 'green' then
    new.evidence_level := 'yellow';
  end if;

  return new;
end;
$$;

revoke all on function public.sync_live_report_viewer_trust()
  from public, anon, authenticated, service_role;

drop trigger if exists live_reports_sync_viewer_trust
  on public.live_reports;

create trigger live_reports_sync_viewer_trust
before insert or update of viewers, viewers_source on public.live_reports
for each row execute function public.sync_live_report_viewer_trust();

create or replace function public.sync_streamer_gmv_report_trust()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ocr_gmv numeric;
  v_history_count integer := 0;
  v_median numeric;
  v_mad numeric;
  v_diverged boolean := false;
  v_historical_outlier boolean := false;
  v_risk_flags text[];
begin
  if new.metric_key <> 'gmv' or new.source_report_id is null then
    return new;
  end if;

  -- The OCR candidate remains immutable in ocr_results.raw_result even when a
  -- reviewer replaces the final streamer_metrics value.
  select (candidate.value ->> 'value')::numeric
  into v_ocr_gmv
  from public.ocr_results as ocr
  cross join lateral jsonb_array_elements(
    case
      when jsonb_typeof(ocr.raw_result -> 'metricCandidates') = 'array'
        then ocr.raw_result -> 'metricCandidates'
      else '[]'::jsonb
    end
  ) as candidate(value)
  where ocr.live_report_id = new.source_report_id
    and ocr.organization_id = new.organization_id
    and candidate.value ->> 'key' = 'gmv'
    and jsonb_typeof(candidate.value -> 'value') = 'number'
  order by ocr.created_at desc
  limit 1;

  if v_ocr_gmv is not null then
    v_diverged :=
      abs(new.metric_value - v_ocr_gmv)
        > greatest(v_ocr_gmv * 0.20, 100);
  end if;

  select
    count(*)::integer,
    percentile_cont(0.5) within group (order by metric.metric_value)
  into
    v_history_count,
    v_median
  from public.streamer_metrics as metric
  where metric.organization_id = new.organization_id
    and metric.streamer_id = new.streamer_id
    and metric.metric_key = 'gmv'
    and metric.metric_value > 0
    and metric.source_report_id is distinct from new.source_report_id;

  if v_history_count >= 5 and v_median is not null then
    select percentile_cont(0.5) within group (
      order by abs(metric.metric_value - v_median)
    )
    into v_mad
    from public.streamer_metrics as metric
    where metric.organization_id = new.organization_id
      and metric.streamer_id = new.streamer_id
      and metric.metric_key = 'gmv'
      and metric.metric_value > 0
      and metric.source_report_id is distinct from new.source_report_id;

    v_historical_outlier :=
      abs(new.metric_value - v_median)
        > greatest(v_mad * 3, v_median * 0.50, 100);
  end if;

  select array_remove(
    array_remove(
      coalesce(report.risk_flags, array[]::text[]),
      'gmv_divergence'
    ),
    'gmv_historical_outlier'
  )
  into v_risk_flags
  from public.live_reports as report
  where report.id = new.source_report_id
    and report.organization_id = new.organization_id
  for update;

  if not found then
    return new;
  end if;

  if v_diverged then
    v_risk_flags := array_append(v_risk_flags, 'gmv_divergence');
  end if;
  if v_historical_outlier then
    v_risk_flags := array_append(v_risk_flags, 'gmv_historical_outlier');
  end if;

  update public.live_reports
  set risk_flags = v_risk_flags,
      evidence_level = case
        when (v_diverged or v_historical_outlier)
          and evidence_level = 'green'
          then 'yellow'::public.evidence_level
        else evidence_level
      end,
      updated_at = now()
  where id = new.source_report_id
    and organization_id = new.organization_id;

  return new;
end;
$$;

revoke all on function public.sync_streamer_gmv_report_trust()
  from public, anon, authenticated, service_role;

drop trigger if exists streamer_metrics_sync_gmv_report_trust
  on public.streamer_metrics;

create constraint trigger streamer_metrics_sync_gmv_report_trust
after insert or update on public.streamer_metrics
deferrable initially deferred
for each row execute function public.sync_streamer_gmv_report_trust();
