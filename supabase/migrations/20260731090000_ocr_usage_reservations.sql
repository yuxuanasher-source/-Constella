-- deploy: expand
create table public.usage_reservations (
  id uuid primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  metric public.usage_metric not null,
  quantity integer not null check (quantity > 0),
  period_month date not null,
  source text not null,
  object_type text not null,
  object_id text not null,
  status text not null check (status in ('reserved', 'consumed', 'released')),
  consumed_at timestamptz,
  released_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  reserved_at timestamptz not null default now(),
  last_reviewed_at timestamptz,
  unique (organization_id, metric, source, object_id),
  constraint usage_reservations_terminal_timestamp check (
    (status = 'reserved' and consumed_at is null and released_at is null)
    or (status = 'consumed' and consumed_at is not null and released_at is null)
    or (status = 'released' and consumed_at is null and released_at is not null)
  )
);

create index usage_reservations_org_status_idx
  on public.usage_reservations (organization_id, status, created_at);

create index usage_reservations_stale_review_idx
  on public.usage_reservations (
    status,
    last_reviewed_at asc nulls first,
    reserved_at,
    id
  );

alter table public.usage_reservations enable row level security;

revoke all on table public.usage_reservations
from public, anon, authenticated, service_role;

-- Monthly counters are authoritative quota state. Authenticated callers may
-- read them through RLS, but all mutations must flow through service-side
-- billing code or the security-definer reservation functions below.
revoke insert, update, delete on table public.usage_monthly_counters
from anon, authenticated;

create or replace function public.consume_usage_reservation(
  p_reservation_id uuid,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reservation public.usage_reservations%rowtype;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Usage reservation mutation requires the service role'
      using errcode = '42501';
  end if;
  if p_reservation_id is null
    or p_metadata is null
    or jsonb_typeof(p_metadata) <> 'object'
  then
    raise exception 'Usage reservation consume input is invalid'
      using errcode = '22023';
  end if;

  select reservation.*
  into v_reservation
  from public.usage_reservations as reservation
  where reservation.id = p_reservation_id
  for update;

  if not found then
    raise exception 'USAGE_RESERVATION_NOT_FOUND'
      using errcode = 'P0001';
  end if;
  if v_reservation.status = 'consumed' then
    return to_jsonb(v_reservation);
  end if;
  if v_reservation.status = 'released' then
    raise exception 'USAGE_RESERVATION_RELEASED'
      using errcode = 'P0001';
  end if;

  insert into public.usage_events (
    id,
    organization_id,
    metric,
    quantity,
    period_month,
    source,
    object_type,
    object_id,
    metadata
  )
  values (
    v_reservation.id,
    v_reservation.organization_id,
    v_reservation.metric,
    v_reservation.quantity,
    v_reservation.period_month,
    v_reservation.source,
    v_reservation.object_type,
    v_reservation.object_id,
    v_reservation.metadata || p_metadata
  );

  update public.usage_reservations
  set
    status = 'consumed',
    consumed_at = now(),
    metadata = metadata || p_metadata
  where id = v_reservation.id
  returning * into v_reservation;

  return to_jsonb(v_reservation);
end;
$$;

create or replace function public.release_usage_reservation(
  p_reservation_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reservation public.usage_reservations%rowtype;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Usage reservation mutation requires the service role'
      using errcode = '42501';
  end if;
  if p_reservation_id is null or nullif(trim(p_reason), '') is null then
    raise exception 'Usage reservation release input is invalid'
      using errcode = '22023';
  end if;

  select reservation.*
  into v_reservation
  from public.usage_reservations as reservation
  where reservation.id = p_reservation_id
  for update;

  if not found then
    raise exception 'USAGE_RESERVATION_NOT_FOUND'
      using errcode = 'P0001';
  end if;
  if v_reservation.status = 'released' then
    return to_jsonb(v_reservation);
  end if;
  if v_reservation.status = 'consumed' then
    raise exception 'USAGE_RESERVATION_ALREADY_CONSUMED'
      using errcode = '55000';
  end if;

  update public.usage_monthly_counters
  set
    used_quantity = used_quantity - v_reservation.quantity,
    updated_at = now()
  where organization_id = v_reservation.organization_id
    and metric = v_reservation.metric
    and period_month = v_reservation.period_month
    and used_quantity >= v_reservation.quantity;

  if not found then
    raise exception 'USAGE_RESERVATION_COUNTER_INCONSISTENT'
      using errcode = 'P0001';
  end if;

  update public.usage_reservations
  set
    status = 'released',
    released_at = now(),
    metadata = metadata || jsonb_build_object('releaseReason', trim(p_reason))
  where id = v_reservation.id
  returning * into v_reservation;

  return to_jsonb(v_reservation);
end;
$$;

create or replace function public.reserve_usage_reservation(
  p_reservation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reservation public.usage_reservations%rowtype;
  v_counter public.usage_monthly_counters%rowtype;
  v_period_month date;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Usage reservation mutation requires the service role'
      using errcode = '42501';
  end if;
  if p_reservation_id is null then
    raise exception 'Usage reservation id is required'
      using errcode = '22023';
  end if;

  select reservation.*
  into v_reservation
  from public.usage_reservations as reservation
  where reservation.id = p_reservation_id
  for update;

  if not found then
    raise exception 'USAGE_RESERVATION_NOT_FOUND'
      using errcode = 'P0001';
  end if;
  if v_reservation.status in ('reserved', 'consumed') then
    return to_jsonb(v_reservation);
  end if;

  v_period_month := date_trunc('month', current_date)::date;
  insert into public.usage_monthly_counters (
    organization_id,
    metric,
    period_month,
    used_quantity,
    included_quantity,
    addon_quantity
  )
  select
    v_reservation.organization_id,
    v_reservation.metric,
    v_period_month,
    0,
    case v_reservation.metric
      when 'active_streamer' then coalesce(plan.included_active_streamers, 0)
      when 'seat' then coalesce(plan.included_seats, 0)
      when 'ocr' then coalesce(plan.included_ocr, 0)
      when 'ai' then coalesce(plan.included_ai, 0)
      when 'storage_mb' then coalesce(plan.included_storage_mb, 0)
      when 'export' then coalesce(plan.included_exports, 0)
    end,
    0
  from public.organization_subscriptions as subscription
  join public.billing_plans as plan on plan.id = subscription.plan_id
  where subscription.organization_id = v_reservation.organization_id
    and subscription.status in ('trialing', 'active')
    and current_date between subscription.current_period_start
      and subscription.current_period_end
    and (
      subscription.status <> 'trialing'
      or subscription.trial_ends_at is null
      or now() <= subscription.trial_ends_at
    )
  on conflict (organization_id, metric, period_month) do nothing;

  select counter.*
  into v_counter
  from public.usage_monthly_counters as counter
  where counter.organization_id = v_reservation.organization_id
    and counter.metric = v_reservation.metric
    and counter.period_month = v_period_month
    and exists (
      select 1
      from public.organization_subscriptions as subscription
      where subscription.organization_id = v_reservation.organization_id
        and subscription.status in ('trialing', 'active')
        and current_date between subscription.current_period_start
          and subscription.current_period_end
        and (
          subscription.status <> 'trialing'
          or subscription.trial_ends_at is null
          or now() <= subscription.trial_ends_at
        )
    )
  for update;

  if not found
    or v_counter.used_quantity + v_reservation.quantity >
      v_counter.included_quantity + v_counter.addon_quantity
  then
    raise exception 'OCR_USAGE_LIMIT_REACHED'
      using errcode = 'P0001';
  end if;

  update public.usage_monthly_counters
  set
    used_quantity = used_quantity + v_reservation.quantity,
    updated_at = now()
  where id = v_counter.id;

  update public.usage_reservations
  set
    period_month = v_period_month,
    status = 'reserved',
    released_at = null,
    reserved_at = now(),
    last_reviewed_at = null,
    metadata = metadata || jsonb_build_object('reservedAgainAt', now())
  where id = v_reservation.id
  returning * into v_reservation;

  return to_jsonb(v_reservation);
end;
$$;

create or replace function public.list_stale_usage_reservations(
  p_before timestamptz,
  p_limit integer
)
returns table (
  reservation_id uuid,
  organization_id uuid,
  source text,
  reserved_at timestamptz,
  last_reviewed_at timestamptz,
  age_seconds bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Usage reservation review requires the service role'
      using errcode = '42501';
  end if;
  if p_before is null
    or p_before > now()
    or p_limit is null
    or p_limit < 1
    or p_limit > 500
  then
    raise exception 'Usage reservation review input is invalid'
      using errcode = '22023';
  end if;

  return query
  select
    reservation.id,
    reservation.organization_id,
    reservation.source,
    reservation.reserved_at,
    reservation.last_reviewed_at,
    extract(epoch from (now() - reservation.reserved_at))::bigint
  from public.usage_reservations as reservation
  where reservation.status = 'reserved'
    and reservation.reserved_at <= p_before
    and (
      reservation.last_reviewed_at is null
      or reservation.last_reviewed_at <= p_before
    )
  order by
    reservation.last_reviewed_at asc nulls first,
    reservation.reserved_at,
    reservation.id
  limit p_limit;
end;
$$;

create or replace function public.mark_stale_usage_reservation_reviewed(
  p_reservation_id uuid,
  p_expected_reserved_at timestamptz,
  p_expected_last_reviewed_at timestamptz,
  p_before timestamptz
)
returns table (
  reservation_id uuid,
  organization_id uuid,
  source text,
  reserved_at timestamptz,
  previous_reviewed_at timestamptz,
  reviewed_at timestamptz,
  age_seconds bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reservation public.usage_reservations%rowtype;
  v_reviewed_at timestamptz := now();
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Usage reservation review requires the service role'
      using errcode = '42501';
  end if;
  if p_reservation_id is null
    or p_expected_reserved_at is null
    or p_before is null
    or p_before > v_reviewed_at
  then
    raise exception 'Usage reservation review input is invalid'
      using errcode = '22023';
  end if;

  select reservation.*
  into v_reservation
  from public.usage_reservations as reservation
  where reservation.id = p_reservation_id
  for update;

  if not found then
    return;
  end if;
  if v_reservation.status <> 'reserved'
    or v_reservation.reserved_at is distinct from p_expected_reserved_at
    or v_reservation.last_reviewed_at is distinct from p_expected_last_reviewed_at
    or v_reservation.reserved_at > p_before
    or (
      v_reservation.last_reviewed_at is not null
      and v_reservation.last_reviewed_at > p_before
    )
  then
    return;
  end if;

  update public.usage_reservations
  set last_reviewed_at = v_reviewed_at
  where id = v_reservation.id;

  return query
  select
    v_reservation.id,
    v_reservation.organization_id,
    v_reservation.source,
    v_reservation.reserved_at,
    v_reservation.last_reviewed_at,
    v_reviewed_at,
    extract(epoch from (v_reviewed_at - v_reservation.reserved_at))::bigint;
end;
$$;

create or replace function public.reset_stale_usage_reservation_review(
  p_reservation_id uuid,
  p_expected_reserved_at timestamptz,
  p_failed_reviewed_at timestamptz,
  p_previous_reviewed_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reservation public.usage_reservations%rowtype;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Usage reservation review requires the service role'
      using errcode = '42501';
  end if;
  if p_reservation_id is null
    or p_expected_reserved_at is null
    or p_failed_reviewed_at is null
    or p_failed_reviewed_at > now()
    or p_previous_reviewed_at > p_failed_reviewed_at
  then
    raise exception 'Usage reservation review reset input is invalid'
      using errcode = '22023';
  end if;

  select reservation.*
  into v_reservation
  from public.usage_reservations as reservation
  where reservation.id = p_reservation_id
  for update;

  if not found
    or v_reservation.status <> 'reserved'
    or v_reservation.reserved_at is distinct from p_expected_reserved_at
    or v_reservation.last_reviewed_at is distinct from p_failed_reviewed_at
  then
    return false;
  end if;

  update public.usage_reservations
  set last_reviewed_at = p_previous_reviewed_at
  where id = v_reservation.id;

  return true;
end;
$$;

revoke all on function public.consume_usage_reservation(uuid, jsonb)
from public, anon, authenticated, service_role;
grant execute on function public.consume_usage_reservation(uuid, jsonb)
to service_role;
revoke all on function public.release_usage_reservation(uuid, text)
from public, anon, authenticated, service_role;
grant execute on function public.release_usage_reservation(uuid, text)
to service_role;
revoke all on function public.reserve_usage_reservation(uuid)
from public, anon, authenticated, service_role;
grant execute on function public.reserve_usage_reservation(uuid)
to service_role;
revoke all on function public.list_stale_usage_reservations(timestamptz, integer)
from public, anon, authenticated, service_role;
grant execute on function public.list_stale_usage_reservations(timestamptz, integer)
to service_role;
revoke all on function public.mark_stale_usage_reservation_reviewed(
  uuid, timestamptz, timestamptz, timestamptz
)
from public, anon, authenticated, service_role;
grant execute on function public.mark_stale_usage_reservation_reviewed(
  uuid, timestamptz, timestamptz, timestamptz
)
to service_role;
revoke all on function public.reset_stale_usage_reservation_review(
  uuid, timestamptz, timestamptz, timestamptz
)
from public, anon, authenticated, service_role;
grant execute on function public.reset_stale_usage_reservation_review(
  uuid, timestamptz, timestamptz, timestamptz
)
to service_role;

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
  v_task public.live_tasks%rowtype;
  v_report public.live_reports%rowtype;
  v_existing_result public.ocr_results%rowtype;
  v_job public.background_jobs%rowtype;
  v_counter public.usage_monthly_counters%rowtype;
  v_period_month date;
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

  select task.*
  into v_task
  from public.live_tasks as task
  where task.id = v_report.live_task_id
    and task.organization_id = v_report.organization_id
  for update;

  if not found then
    raise exception 'OCR enqueue live task not found or organization mismatch'
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

  select result.*
  into v_existing_result
  from public.ocr_results as result
  where result.live_report_id = v_report.id
    and result.organization_id = v_report.organization_id
  order by result.created_at desc
  limit 1;

  if found then
    select job.*
    into v_job
    from public.background_jobs as job
    where job.id = v_existing_result.background_job_id
      and job.organization_id = v_existing_result.organization_id
      and job.job_type = 'ocr.extract_live_report';

    if not found
      or v_existing_result.ai_invocation_id is distinct from v_job.ai_invocation_id
      or v_existing_result.screenshot_id is distinct from p_screenshot_id
      or v_job.payload ->> 'liveReportId' is distinct from p_live_report_id::text
      or nullif(v_job.payload ->> 'screenshotId', '') is distinct from p_screenshot_id::text
    then
      raise exception 'Existing OCR enqueue linkage does not match request'
        using errcode = '23514';
    end if;

    return to_jsonb(v_job);
  end if;

  if v_report.status <> 'ocr_ing' then
    raise exception 'OCR enqueue live report is not active'
      using errcode = '55000';
  end if;
  if v_task.status not in ('pending_report', 'report_rejected') then
    raise exception 'OCR enqueue live task is already claimed'
      using errcode = '55000';
  end if;

  v_period_month := date_trunc('month', p_run_at)::date;
  insert into public.usage_monthly_counters (
    organization_id,
    metric,
    period_month,
    used_quantity,
    included_quantity,
    addon_quantity
  )
  select
    p_organization_id,
    'ocr'::public.usage_metric,
    v_period_month,
    0,
    coalesce(plan.included_ocr, 0),
    0
  from public.organization_subscriptions as subscription
  join public.billing_plans as plan on plan.id = subscription.plan_id
  where subscription.organization_id = p_organization_id
    and subscription.status in ('trialing', 'active')
    and p_run_at::date between subscription.current_period_start
      and subscription.current_period_end
    and (
      subscription.status <> 'trialing'
      or subscription.trial_ends_at is null
      or p_run_at <= subscription.trial_ends_at
    )
  on conflict (organization_id, metric, period_month) do nothing;

  select counter.*
  into v_counter
  from public.usage_monthly_counters as counter
  where counter.organization_id = p_organization_id
    and counter.metric = 'ocr'
    and counter.period_month = v_period_month
    and exists (
      select 1
      from public.organization_subscriptions as subscription
      where subscription.organization_id = p_organization_id
        and subscription.status in ('trialing', 'active')
        and p_run_at::date between subscription.current_period_start
          and subscription.current_period_end
        and (
          subscription.status <> 'trialing'
          or subscription.trial_ends_at is null
          or p_run_at <= subscription.trial_ends_at
        )
    )
  for update;

  if not found
    or v_counter.used_quantity + 1 >
      v_counter.included_quantity + v_counter.addon_quantity
  then
    raise exception 'OCR_USAGE_LIMIT_REACHED'
      using errcode = 'P0001';
  end if;

  update public.usage_monthly_counters
  set
    used_quantity = used_quantity + 1,
    updated_at = now()
  where id = v_counter.id;

  insert into public.usage_reservations (
    id,
    organization_id,
    metric,
    quantity,
    period_month,
    source,
    object_type,
    object_id,
    status,
    reserved_at,
    metadata
  )
  values (
    p_job_id,
    p_organization_id,
    'ocr',
    1,
    v_period_month,
    'ocr_job',
    'background_job',
    p_job_id::text,
    'reserved',
    now(),
    jsonb_build_object('liveReportId', p_live_report_id)
  );

  insert into public.ai_invocations (
    id, organization_id, actor_user_id, actor_name, actor_role, scene,
    object_type, object_id, provider_name, status, metadata
  )
  values (
    p_invocation_id, v_report.organization_id, p_actor_user_id, p_actor_name,
    p_actor_role, 'ocr.extract_live_report', 'live_report', v_report.id::text,
    'tencent_ocr', 'queued',
    jsonb_strip_nulls(
      jsonb_build_object('jobId', p_job_id, 'screenshotId', p_screenshot_id)
    )
  );

  insert into public.background_jobs (
    id, organization_id, job_type, payload, status, attempt, max_attempts,
    ai_invocation_id, run_after, next_run_at, result
  )
  values (
    p_job_id, v_report.organization_id, 'ocr.extract_live_report', p_payload,
    'queued', 0, 3, p_invocation_id, p_run_at, p_run_at, '{}'::jsonb
  )
  returning * into v_job;

  insert into public.ocr_results (
    organization_id, live_report_id, screenshot_id, status, raw_result,
    raw_response, ai_invocation_id, background_job_id, needs_confirmation
  )
  values (
    v_report.organization_id, p_live_report_id, p_screenshot_id, 'pending',
    '{}'::jsonb, '{}'::jsonb, p_invocation_id, p_job_id, false
  );

  update public.live_reports as sibling
  set status = 'voided', updated_at = now()
  where sibling.organization_id = v_report.organization_id
    and sibling.live_task_id = v_report.live_task_id
    and sibling.id <> v_report.id
    and sibling.status in ('rejected', 'need_more');

  update public.live_tasks
  set status = 'report_pending_review', updated_at = now()
  where id = v_task.id and organization_id = v_task.organization_id;

  return to_jsonb(v_job);
end;
$$;

revoke all on function public.enqueue_ocr_job(
  uuid, uuid, uuid, uuid, uuid, uuid, text, public.app_role, jsonb, timestamptz
) from public, anon, authenticated, service_role;
grant execute on function public.enqueue_ocr_job(
  uuid, uuid, uuid, uuid, uuid, uuid, text, public.app_role, jsonb, timestamptz
) to service_role;
