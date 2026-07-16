create or replace function public.claim_async_ocr_jobs(
  p_worker_id text,
  p_limit integer default 3,
  p_lease_seconds integer default 120,
  p_per_org_limit integer default 3,
  p_now timestamptz default now()
) returns setof public.background_jobs
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_candidate record;
  v_active_count integer;
  v_remaining integer;
  v_claimed_count integer := 0;
  v_rows integer;
begin
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception 'p_limit must be between 1 and 100';
  end if;
  if p_lease_seconds is null or p_lease_seconds < 1 or p_lease_seconds > 3600 then
    raise exception 'p_lease_seconds must be between 1 and 3600';
  end if;
  if p_per_org_limit is null or p_per_org_limit < 1 or p_per_org_limit > 100 then
    raise exception 'p_per_org_limit must be between 1 and 100';
  end if;

  for v_candidate in
    with ranked as materialized (
      select
        bj.id,
        bj.organization_id,
        row_number() over (
          partition by bj.organization_id
          order by greatest(0, bj.priority - floor(extract(epoch from (p_now - bj.created_at)) / 1800)::integer) asc,
                   bj.run_after asc,
                   bj.created_at asc,
                   bj.id
        ) as org_rank,
        greatest(0, bj.priority - floor(extract(epoch from (p_now - bj.created_at)) / 1800)::integer) as effective_priority,
        bj.run_after,
        bj.created_at
      from public.background_jobs bj
      left join public.async_task_queue_controls queue_controls
        on queue_controls.organization_id = bj.organization_id
       and queue_controls.task_type = 'ocr'
      where bj.job_type = 'ocr.extract_live_report'
        and bj.cancel_requested_at is null
        and bj.attempt < bj.max_attempts
        and bj.run_after <= p_now
        and coalesce(queue_controls.desired_state, 'running') <> 'paused'
        and (
          bj.status = 'queued'
          or (
            bj.status = 'running'
            and (bj.lease_expires_at is null or bj.lease_expires_at <= p_now)
          )
        )
    )
    select
      ranked.organization_id,
      ranked.org_rank
    from ranked
    order by ranked.org_rank asc, ranked.effective_priority asc, ranked.run_after asc, ranked.created_at asc, ranked.id
    limit least(greatest(p_limit * p_per_org_limit, 25), 1000)
  loop
    exit when v_claimed_count >= p_limit;

    if not pg_try_advisory_xact_lock(hashtext('ocr'), hashtext(v_candidate.organization_id::text)) then
      continue;
    end if;

    select count(*)::integer
    into v_active_count
    from public.background_jobs bj
    where bj.organization_id = v_candidate.organization_id
      and bj.job_type = 'ocr.extract_live_report'
      and bj.status = 'running'
      and bj.lease_expires_at > p_now;

    v_remaining := p_per_org_limit - v_active_count;
    if v_remaining <= 0 then
      continue;
    end if;

    return query
    with ranked as materialized (
      select
        bj.id,
        row_number() over (
          partition by bj.organization_id
          order by greatest(0, bj.priority - floor(extract(epoch from (p_now - bj.created_at)) / 1800)::integer) asc,
                   bj.run_after asc,
                   bj.created_at asc,
                   bj.id
        ) as claimable_rank,
        greatest(0, bj.priority - floor(extract(epoch from (p_now - bj.created_at)) / 1800)::integer) as effective_priority,
        bj.run_after,
        bj.created_at
      from public.background_jobs bj
      left join public.async_task_queue_controls queue_controls
        on queue_controls.organization_id = bj.organization_id
       and queue_controls.task_type = 'ocr'
      where bj.organization_id = v_candidate.organization_id
        and bj.job_type = 'ocr.extract_live_report'
        and bj.cancel_requested_at is null
        and bj.attempt < bj.max_attempts
        and bj.run_after <= p_now
        and coalesce(queue_controls.desired_state, 'running') <> 'paused'
        and (
          bj.status = 'queued'
          or (
            bj.status = 'running'
            and (bj.lease_expires_at is null or bj.lease_expires_at <= p_now)
          )
        )
    ),
    candidates as (
      select bj.id
      from public.background_jobs bj
      join ranked
        on ranked.id = bj.id
      where ranked.claimable_rank <= v_remaining
      order by ranked.claimable_rank asc, ranked.effective_priority asc, ranked.run_after asc, ranked.created_at asc, bj.id
      limit 1
      for update skip locked
    )
    update public.background_jobs bj
    set status = 'running',
        stage = 'resolving_image',
        locked_at = p_now,
        locked_by = p_worker_id,
        lease_expires_at = p_now + make_interval(secs => p_lease_seconds),
        attempt = bj.attempt + 1,
        started_at = coalesce(bj.started_at, p_now),
        completed_at = null,
        error_code = null,
        error_summary = null,
        updated_at = p_now
    from candidates
    where bj.id = candidates.id
    returning bj.*;

    get diagnostics v_rows = row_count;
    v_claimed_count := v_claimed_count + v_rows;
  end loop;
end;
$$;

create or replace function public.claim_async_recording_ai(
  p_worker_id text,
  p_limit integer default 1,
  p_lease_seconds integer default 120,
  p_per_org_limit integer default 1,
  p_now timestamptz default now()
) returns setof public.recording_ai_analyses
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_candidate record;
  v_active_count integer;
  v_remaining integer;
  v_claimed_count integer := 0;
  v_rows integer;
begin
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception 'p_limit must be between 1 and 100';
  end if;
  if p_lease_seconds is null or p_lease_seconds < 1 or p_lease_seconds > 3600 then
    raise exception 'p_lease_seconds must be between 1 and 3600';
  end if;
  if p_per_org_limit is null or p_per_org_limit < 1 or p_per_org_limit > 100 then
    raise exception 'p_per_org_limit must be between 1 and 100';
  end if;

  for v_candidate in
    with ranked as materialized (
      select
        analysis.id,
        analysis.organization_id,
        row_number() over (
          partition by analysis.organization_id
          order by greatest(0, analysis.priority - floor(extract(epoch from (p_now - analysis.created_at)) / 1800)::integer) asc,
                   analysis.run_after asc,
                   analysis.created_at asc,
                   analysis.id
        ) as org_rank,
        greatest(0, analysis.priority - floor(extract(epoch from (p_now - analysis.created_at)) / 1800)::integer) as effective_priority,
        analysis.run_after,
        analysis.created_at
      from public.recording_ai_analyses analysis
      left join public.async_task_queue_controls queue_controls
        on queue_controls.organization_id = analysis.organization_id
       and queue_controls.task_type = 'recording_ai'
      where analysis.cancel_requested_at is null
        and analysis.attempt < analysis.max_attempts
        and analysis.run_after <= p_now
        and coalesce(queue_controls.desired_state, 'running') <> 'paused'
        and (
          analysis.status = 'queued'
          or (
            analysis.status = 'running'
            and (analysis.lease_expires_at is null or analysis.lease_expires_at <= p_now)
          )
        )
    )
    select
      ranked.organization_id,
      ranked.org_rank
    from ranked
    order by ranked.org_rank asc, ranked.effective_priority asc, ranked.run_after asc, ranked.created_at asc, ranked.id
    limit least(greatest(p_limit * p_per_org_limit, 25), 1000)
  loop
    exit when v_claimed_count >= p_limit;

    if not pg_try_advisory_xact_lock(hashtext('recording_ai'), hashtext(v_candidate.organization_id::text)) then
      continue;
    end if;

    select count(*)::integer
    into v_active_count
    from public.recording_ai_analyses analysis
    where analysis.organization_id = v_candidate.organization_id
      and analysis.status = 'running'
      and analysis.lease_expires_at > p_now;

    v_remaining := p_per_org_limit - v_active_count;
    if v_remaining <= 0 then
      continue;
    end if;

    return query
    with ranked as materialized (
      select
        analysis.id,
        row_number() over (
          partition by analysis.organization_id
          order by greatest(0, analysis.priority - floor(extract(epoch from (p_now - analysis.created_at)) / 1800)::integer) asc,
                   analysis.run_after asc,
                   analysis.created_at asc,
                   analysis.id
        ) as claimable_rank,
        greatest(0, analysis.priority - floor(extract(epoch from (p_now - analysis.created_at)) / 1800)::integer) as effective_priority,
        analysis.run_after,
        analysis.created_at
      from public.recording_ai_analyses analysis
      left join public.async_task_queue_controls queue_controls
        on queue_controls.organization_id = analysis.organization_id
       and queue_controls.task_type = 'recording_ai'
      where analysis.organization_id = v_candidate.organization_id
        and analysis.cancel_requested_at is null
        and analysis.attempt < analysis.max_attempts
        and analysis.run_after <= p_now
        and coalesce(queue_controls.desired_state, 'running') <> 'paused'
        and (
          analysis.status = 'queued'
          or (
            analysis.status = 'running'
            and (analysis.lease_expires_at is null or analysis.lease_expires_at <= p_now)
          )
        )
    ),
    candidates as (
      select analysis.id
      from public.recording_ai_analyses analysis
      join ranked
        on ranked.id = analysis.id
      where ranked.claimable_rank <= v_remaining
      order by ranked.claimable_rank asc, ranked.effective_priority asc, ranked.run_after asc, ranked.created_at asc, analysis.id
      limit 1
      for update skip locked
    )
    update public.recording_ai_analyses analysis
    set status = 'running',
        stage = 'extracting_audio',
        claimed_at = p_now,
        claimed_by = p_worker_id,
        lease_expires_at = p_now + make_interval(secs => p_lease_seconds),
        attempt = analysis.attempt + 1,
        started_at = coalesce(analysis.started_at, p_now),
        completed_at = null,
        error_code = null,
        error_summary = null,
        updated_at = p_now
    from candidates
    where analysis.id = candidates.id
    returning analysis.*;

    get diagnostics v_rows = row_count;
    v_claimed_count := v_claimed_count + v_rows;
  end loop;
end;
$$;

create or replace function public.claim_async_settlement_simulations(
  p_worker_id text,
  p_limit integer default 1,
  p_lease_seconds integer default 120,
  p_per_org_limit integer default 1,
  p_now timestamptz default now()
) returns setof public.background_jobs
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_candidate record;
  v_active_count integer;
  v_remaining integer;
  v_claimed_count integer := 0;
  v_rows integer;
begin
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception 'p_limit must be between 1 and 100';
  end if;
  if p_lease_seconds is null or p_lease_seconds < 1 or p_lease_seconds > 3600 then
    raise exception 'p_lease_seconds must be between 1 and 3600';
  end if;
  if p_per_org_limit is null or p_per_org_limit < 1 or p_per_org_limit > 100 then
    raise exception 'p_per_org_limit must be between 1 and 100';
  end if;

  for v_candidate in
    with ranked as materialized (
      select
        bj.id,
        bj.organization_id,
        row_number() over (
          partition by bj.organization_id
          order by greatest(0, bj.priority - floor(extract(epoch from (p_now - bj.created_at)) / 1800)::integer) asc,
                   bj.run_after asc,
                   bj.created_at asc,
                   bj.id
        ) as org_rank,
        greatest(0, bj.priority - floor(extract(epoch from (p_now - bj.created_at)) / 1800)::integer) as effective_priority,
        bj.run_after,
        bj.created_at
      from public.background_jobs bj
      left join public.async_task_queue_controls queue_controls
        on queue_controls.organization_id = bj.organization_id
       and queue_controls.task_type = 'settlement_simulation'
      where bj.job_type = 'settlement.simulate_large_sample'
        and bj.cancel_requested_at is null
        and bj.attempt < bj.max_attempts
        and bj.run_after <= p_now
        and coalesce(queue_controls.desired_state, 'running') <> 'paused'
        and (
          bj.status = 'queued'
          or (
            bj.status = 'running'
            and (bj.lease_expires_at is null or bj.lease_expires_at <= p_now)
          )
        )
    )
    select
      ranked.organization_id,
      ranked.org_rank
    from ranked
    order by ranked.org_rank asc, ranked.effective_priority asc, ranked.run_after asc, ranked.created_at asc, ranked.id
    limit least(greatest(p_limit * p_per_org_limit, 25), 1000)
  loop
    exit when v_claimed_count >= p_limit;

    if not pg_try_advisory_xact_lock(hashtext('settlement_simulation'), hashtext(v_candidate.organization_id::text)) then
      continue;
    end if;

    select count(*)::integer
    into v_active_count
    from public.background_jobs bj
    where bj.organization_id = v_candidate.organization_id
      and bj.job_type = 'settlement.simulate_large_sample'
      and bj.status = 'running'
      and bj.lease_expires_at > p_now;

    v_remaining := p_per_org_limit - v_active_count;
    if v_remaining <= 0 then
      continue;
    end if;

    return query
    with ranked as materialized (
      select
        bj.id,
        row_number() over (
          partition by bj.organization_id
          order by greatest(0, bj.priority - floor(extract(epoch from (p_now - bj.created_at)) / 1800)::integer) asc,
                   bj.run_after asc,
                   bj.created_at asc,
                   bj.id
        ) as claimable_rank,
        greatest(0, bj.priority - floor(extract(epoch from (p_now - bj.created_at)) / 1800)::integer) as effective_priority,
        bj.run_after,
        bj.created_at
      from public.background_jobs bj
      left join public.async_task_queue_controls queue_controls
        on queue_controls.organization_id = bj.organization_id
       and queue_controls.task_type = 'settlement_simulation'
      where bj.organization_id = v_candidate.organization_id
        and bj.job_type = 'settlement.simulate_large_sample'
        and bj.cancel_requested_at is null
        and bj.attempt < bj.max_attempts
        and bj.run_after <= p_now
        and coalesce(queue_controls.desired_state, 'running') <> 'paused'
        and (
          bj.status = 'queued'
          or (
            bj.status = 'running'
            and (bj.lease_expires_at is null or bj.lease_expires_at <= p_now)
          )
        )
    ),
    candidates as (
      select bj.id
      from public.background_jobs bj
      join ranked
        on ranked.id = bj.id
      where ranked.claimable_rank <= v_remaining
      order by ranked.claimable_rank asc, ranked.effective_priority asc, ranked.run_after asc, ranked.created_at asc, bj.id
      limit 1
      for update skip locked
    )
    update public.background_jobs bj
    set status = 'running',
        stage = 'validating_snapshot',
        locked_at = p_now,
        locked_by = p_worker_id,
        lease_expires_at = p_now + make_interval(secs => p_lease_seconds),
        attempt = bj.attempt + 1,
        started_at = coalesce(bj.started_at, p_now),
        completed_at = null,
        error_code = null,
        error_summary = null,
        updated_at = p_now
    from candidates
    where bj.id = candidates.id
    returning bj.*;

    get diagnostics v_rows = row_count;
    v_claimed_count := v_claimed_count + v_rows;
  end loop;
end;
$$;

create or replace function public.renew_async_task_lease(
  p_task_type text,
  p_task_id uuid,
  p_worker_id text,
  p_lease_seconds integer,
  p_now timestamptz default now()
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_renewed boolean := false;
begin
  if p_task_type not in ('ocr', 'recording_ai', 'settlement_simulation') then
    return false;
  end if;
  if p_lease_seconds is null or p_lease_seconds < 1 or p_lease_seconds > 3600 then
    raise exception 'p_lease_seconds must be between 1 and 3600';
  end if;

  if p_task_type = 'ocr' then
    with renewed_task as (
      update public.background_jobs
      set lease_expires_at = p_now + make_interval(secs => p_lease_seconds),
          updated_at = p_now
      where id = p_task_id
        and job_type = 'ocr.extract_live_report'
        and status = 'running'
        and locked_by = p_worker_id
        and lease_expires_at > p_now
      returning true as renewed
    )
    select coalesce((select renewed from renewed_task), false) into v_renewed;
  elsif p_task_type = 'recording_ai' then
    with renewed_task as (
      update public.recording_ai_analyses
      set lease_expires_at = p_now + make_interval(secs => p_lease_seconds),
          updated_at = p_now
      where id = p_task_id
        and status = 'running'
        and claimed_by = p_worker_id
        and lease_expires_at > p_now
      returning true as renewed
    )
    select coalesce((select renewed from renewed_task), false) into v_renewed;
  elsif p_task_type = 'settlement_simulation' then
    with renewed_task as (
      update public.background_jobs
      set lease_expires_at = p_now + make_interval(secs => p_lease_seconds),
          updated_at = p_now
      where id = p_task_id
        and job_type = 'settlement.simulate_large_sample'
        and status = 'running'
        and locked_by = p_worker_id
        and lease_expires_at > p_now
      returning true as renewed
    )
    select coalesce((select renewed from renewed_task), false) into v_renewed;
  end if;

  return coalesce(v_renewed, false);
end;
$$;

create or replace function public.finalize_async_task(
  p_task_type text,
  p_task_id uuid,
  p_worker_id text,
  p_status text,
  p_error_code text default null,
  p_metadata jsonb default '{}'::jsonb,
  p_now timestamptz default now()
) returns public.async_task_events
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_organization_id uuid;
  v_attempt integer;
  v_stage text;
  v_existing_status text;
  v_event public.async_task_events%rowtype;
begin
  if p_task_type not in ('ocr', 'recording_ai', 'settlement_simulation') then
    return null;
  end if;
  if p_status not in ('succeeded', 'failed', 'cancelled', 'needs_confirmation') then
    return null;
  end if;

  if p_task_type = 'ocr' then
    select organization_id, attempt, stage, status
    into v_organization_id, v_attempt, v_stage, v_existing_status
    from public.background_jobs
    where id = p_task_id
      and job_type = 'ocr.extract_live_report'
    for update;

    if not found then
      return null;
    end if;
    if v_existing_status in ('succeeded', 'failed', 'cancelled', 'needs_confirmation') then
      select event.*
      into v_event
        from public.async_task_events event
        where event.task_type = p_task_type
          and event.task_id = p_task_id
          and event.status = p_status
          and event.attempt = v_attempt
          and event.worker_id = p_worker_id
        order by event.created_at desc, event.id desc
        limit 1;
      if found then
        return v_event;
      end if;
      return null;
    end if;

    update public.background_jobs
    set status = p_status,
        completed_at = p_now,
        lease_expires_at = null,
        locked_at = null,
        locked_by = null,
        error_code = p_error_code,
        error_summary = p_error_code,
        result = case when p_metadata ? 'result' then p_metadata->'result' else result end,
        updated_at = p_now
    where id = p_task_id
      and job_type = 'ocr.extract_live_report'
      and status = 'running'
      and locked_by = p_worker_id
      and lease_expires_at > p_now;

    if not found then
      return null;
    end if;
  elsif p_task_type = 'recording_ai' then
    select organization_id, attempt, stage, status
    into v_organization_id, v_attempt, v_stage, v_existing_status
    from public.recording_ai_analyses
    where id = p_task_id
    for update;

    if not found then
      return null;
    end if;
    if v_existing_status::text in ('succeeded', 'failed', 'cancelled', 'needs_confirmation') then
      select event.*
      into v_event
        from public.async_task_events event
        where event.task_type = p_task_type
          and event.task_id = p_task_id
          and event.status = p_status
          and event.attempt = v_attempt
          and event.worker_id = p_worker_id
        order by event.created_at desc, event.id desc
        limit 1;
      if found then
        return v_event;
      end if;
      return null;
    end if;

    update public.recording_ai_analyses
    set status = p_status::public.recording_ai_analysis_status,
        completed_at = p_now,
        lease_expires_at = null,
        claimed_by = null,
        error_code = p_error_code,
        error_summary = p_error_code,
        updated_at = p_now
    where id = p_task_id
      and status = 'running'
      and claimed_by = p_worker_id
      and lease_expires_at > p_now;

    if not found then
      return null;
    end if;
  elsif p_task_type = 'settlement_simulation' then
    select organization_id, attempt, stage, status
    into v_organization_id, v_attempt, v_stage, v_existing_status
    from public.background_jobs
    where id = p_task_id
      and job_type = 'settlement.simulate_large_sample'
    for update;

    if not found then
      return null;
    end if;
    if v_existing_status in ('succeeded', 'failed', 'cancelled', 'needs_confirmation') then
      select event.*
      into v_event
        from public.async_task_events event
        where event.task_type = p_task_type
          and event.task_id = p_task_id
          and event.status = p_status
          and event.attempt = v_attempt
          and event.worker_id = p_worker_id
        order by event.created_at desc, event.id desc
        limit 1;
      if found then
        return v_event;
      end if;
      return null;
    end if;

    update public.background_jobs
    set status = p_status,
        completed_at = p_now,
        lease_expires_at = null,
        locked_at = null,
        locked_by = null,
        error_code = p_error_code,
        error_summary = p_error_code,
        result = case when p_metadata ? 'result' then p_metadata->'result' else result end,
        updated_at = p_now
    where id = p_task_id
      and job_type = 'settlement.simulate_large_sample'
      and status = 'running'
      and locked_by = p_worker_id
      and lease_expires_at > p_now;

    if not found then
      return null;
    end if;
  end if;

  insert into public.async_task_events (
    organization_id,
    task_type,
    task_id,
    status,
    stage,
    attempt,
    worker_id,
    error_code,
    metadata,
    created_at
  )
  values (
    v_organization_id,
    p_task_type,
    p_task_id,
    p_status,
    v_stage,
    v_attempt,
    p_worker_id,
    p_error_code,
    coalesce(p_metadata, '{}'::jsonb),
    p_now
  )
  returning * into v_event;

  if found then
    return v_event;
  end if;

  select event.*
  into v_event
  from public.async_task_events event
  where event.task_type = p_task_type
    and event.task_id = p_task_id
    and event.status = p_status
    and event.attempt = v_attempt
    and event.worker_id = p_worker_id
  order by event.created_at desc, event.id desc
  limit 1;

  if found then
    return v_event;
  end if;

  return null;
end;
$$;

create or replace function public.reconcile_expired_async_tasks(
  p_now timestamptz default now(),
  p_limit integer default 100
) returns table (
  task_type text,
  task_id uuid
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_limit is null or p_limit < 1 or p_limit > 1000 then
    raise exception 'p_limit must be between 1 and 1000';
  end if;

  return query
  with expired_ocr as (
    select
      'ocr'::text as task_type,
      bj.id,
      bj.organization_id,
      bj.stage,
      bj.attempt,
      bj.locked_by as worker_id
    from public.background_jobs bj
    where bj.job_type = 'ocr.extract_live_report'
      and bj.status = 'running'
      and bj.lease_expires_at <= p_now
      and bj.attempt >= bj.max_attempts
    order by bj.lease_expires_at asc, bj.id
    limit p_limit
    for update skip locked
  ),
  marked_ocr as (
    update public.background_jobs bj
    set status = 'failed',
        completed_at = p_now,
        lease_expires_at = null,
        locked_at = null,
        locked_by = null,
        error_code = 'worker_lease_exhausted',
        error_summary = 'worker_lease_exhausted',
        updated_at = p_now
    from expired_ocr
    where bj.id = expired_ocr.id
    returning
      expired_ocr.task_type,
      bj.id,
      bj.organization_id,
      expired_ocr.stage,
      bj.attempt,
      expired_ocr.worker_id
  ),
  expired_recording_ai as (
    select
      'recording_ai'::text as task_type,
      analysis.id,
      analysis.organization_id,
      analysis.stage,
      analysis.attempt,
      analysis.claimed_by as worker_id
    from public.recording_ai_analyses analysis
    where analysis.status = 'running'
      and analysis.lease_expires_at <= p_now
      and analysis.attempt >= analysis.max_attempts
    order by analysis.lease_expires_at asc, analysis.id
    limit p_limit
    for update skip locked
  ),
  marked_recording_ai as (
    update public.recording_ai_analyses analysis
    set status = 'failed',
        completed_at = p_now,
        lease_expires_at = null,
        claimed_by = null,
        error_code = 'worker_lease_exhausted',
        error_summary = 'worker_lease_exhausted',
        updated_at = p_now
    from expired_recording_ai
    where analysis.id = expired_recording_ai.id
    returning
      expired_recording_ai.task_type,
      analysis.id,
      analysis.organization_id,
      expired_recording_ai.stage,
      analysis.attempt,
      expired_recording_ai.worker_id
  ),
  expired_settlement_simulation as (
    select
      'settlement_simulation'::text as task_type,
      bj.id,
      bj.organization_id,
      bj.stage,
      bj.attempt,
      bj.locked_by as worker_id
    from public.background_jobs bj
    where bj.job_type = 'settlement.simulate_large_sample'
      and bj.status = 'running'
      and bj.lease_expires_at <= p_now
      and bj.attempt >= bj.max_attempts
    order by bj.lease_expires_at asc, bj.id
    limit p_limit
    for update skip locked
  ),
  marked_settlement_simulation as (
    update public.background_jobs bj
    set status = 'failed',
        completed_at = p_now,
        lease_expires_at = null,
        locked_at = null,
        locked_by = null,
        error_code = 'worker_lease_exhausted',
        error_summary = 'worker_lease_exhausted',
        updated_at = p_now
    from expired_settlement_simulation
    where bj.id = expired_settlement_simulation.id
    returning
      expired_settlement_simulation.task_type,
      bj.id,
      bj.organization_id,
      expired_settlement_simulation.stage,
      bj.attempt,
      expired_settlement_simulation.worker_id
  ),
  marked as (
    select * from marked_ocr
    union all
    select * from marked_recording_ai
    union all
    select * from marked_settlement_simulation
  ),
  events as (
    insert into public.async_task_events (
      organization_id,
      task_type,
      task_id,
      status,
      stage,
      attempt,
      worker_id,
      error_code,
      metadata,
      created_at
    )
    select
      marked.organization_id,
      marked.task_type,
      marked.id,
      'failed',
      marked.stage,
      marked.attempt,
      marked.worker_id,
      'worker_lease_exhausted',
      jsonb_build_object('reconciled', true),
      p_now
    from marked
    on conflict do nothing
    returning task_type, task_id
  )
  select marked.task_type, marked.id
  from marked;
end;
$$;

revoke all on function public.claim_async_ocr_jobs(text, integer, integer, integer, timestamptz) from public, anon, authenticated;
revoke all on function public.claim_async_recording_ai(text, integer, integer, integer, timestamptz) from public, anon, authenticated;
revoke all on function public.claim_async_settlement_simulations(text, integer, integer, integer, timestamptz) from public, anon, authenticated;
revoke all on function public.renew_async_task_lease(text, uuid, text, integer, timestamptz) from public, anon, authenticated;
revoke all on function public.finalize_async_task(text, uuid, text, text, text, jsonb, timestamptz) from public, anon, authenticated;
revoke all on function public.reconcile_expired_async_tasks(timestamptz, integer) from public, anon, authenticated;

grant execute on function public.claim_async_ocr_jobs(text, integer, integer, integer, timestamptz) to service_role;
grant execute on function public.claim_async_recording_ai(text, integer, integer, integer, timestamptz) to service_role;
grant execute on function public.claim_async_settlement_simulations(text, integer, integer, integer, timestamptz) to service_role;
grant execute on function public.renew_async_task_lease(text, uuid, text, integer, timestamptz) to service_role;
grant execute on function public.finalize_async_task(text, uuid, text, text, text, jsonb, timestamptz) to service_role;
grant execute on function public.reconcile_expired_async_tasks(timestamptz, integer) to service_role;
