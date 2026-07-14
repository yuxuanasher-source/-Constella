alter type public.recording_ai_analysis_status add value if not exists 'needs_confirmation';
alter type public.recording_ai_analysis_status add value if not exists 'cancelled';

alter table public.background_jobs
  add column if not exists requested_by uuid references public.profiles(id),
  add column if not exists stage text not null default 'queued',
  add column if not exists priority smallint not null default 1,
  add column if not exists run_after timestamptz not null default now(),
  add column if not exists lease_expires_at timestamptz,
  add column if not exists started_at timestamptz,
  add column if not exists completed_at timestamptz,
  add column if not exists idempotency_key text,
  add column if not exists error_code text,
  add column if not exists cancel_requested_at timestamptz,
  add column if not exists desired_state text not null default 'running';

alter table public.recording_ai_analyses
  add column if not exists stage text not null default 'queued',
  add column if not exists priority smallint not null default 1,
  add column if not exists run_after timestamptz not null default now(),
  add column if not exists claimed_by text,
  add column if not exists lease_expires_at timestamptz,
  add column if not exists started_at timestamptz,
  add column if not exists idempotency_key text,
  add column if not exists error_code text,
  add column if not exists cancel_requested_at timestamptz,
  add column if not exists desired_state text not null default 'running';

do $$
begin
  alter table public.background_jobs
    add constraint background_jobs_priority_range
    check (priority between 0 and 9);
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter table public.recording_ai_analyses
    add constraint recording_ai_analyses_priority_range
    check (priority between 0 and 9);
exception
  when duplicate_object then null;
end $$;

do $$
declare
  v_constraint_definition text;
begin
  select pg_get_constraintdef(pg_constraint.oid)
  into v_constraint_definition
  from pg_constraint
  join pg_class
    on pg_class.oid = pg_constraint.conrelid
  join pg_namespace
    on pg_namespace.oid = pg_class.relnamespace
  where pg_namespace.nspname = 'public'
    and pg_class.relname = 'background_jobs'
    and pg_constraint.conname = 'background_jobs_known_type';

  if v_constraint_definition is null then
    alter table public.background_jobs
      add constraint background_jobs_known_type check (
        job_type in (
          'ocr.extract_live_report',
          'ai.replay',
          'insight.scan',
          'settlement.simulate_large_sample'
        )
      );
  elsif position('settlement.simulate_large_sample' in v_constraint_definition) = 0 then
    alter table public.background_jobs
      drop constraint background_jobs_known_type;

    alter table public.background_jobs
      add constraint background_jobs_known_type check (
        job_type in (
          'ocr.extract_live_report',
          'ai.replay',
          'insight.scan',
          'settlement.simulate_large_sample'
        )
      );
  end if;
end $$;

create unique index if not exists background_jobs_org_type_idempotency_uidx
on public.background_jobs (organization_id, job_type, idempotency_key)
where idempotency_key is not null;

create unique index if not exists recording_ai_analyses_org_asset_idempotency_uidx
on public.recording_ai_analyses (organization_id, asset_id, idempotency_key)
where idempotency_key is not null;

create table if not exists public.async_task_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  task_type text not null,
  task_id uuid not null,
  status text not null,
  stage text,
  attempt integer not null default 0,
  worker_id text,
  error_code text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint async_task_events_attempt_nonnegative check (attempt >= 0),
  constraint async_task_events_status_check check (
    status in (
      'queued',
      'running',
      'needs_confirmation',
      'succeeded',
      'failed',
      'cancelled'
    )
  )
);

create index if not exists async_task_events_task_idx
on public.async_task_events (task_type, task_id, created_at desc, id desc);

create index if not exists async_task_events_cursor_idx
on public.async_task_events (created_at desc, id desc);

create unique index if not exists async_task_events_terminal_attempt_uidx
on public.async_task_events (task_type, task_id, attempt, status)
where status in ('needs_confirmation', 'succeeded', 'failed', 'cancelled');

create table if not exists public.worker_instances (
  worker_id text primary key,
  worker_type text not null,
  host_name text not null,
  app_version text,
  status text not null default 'starting',
  desired_state text not null default 'running',
  current_jobs integer not null default 0,
  concurrency_limit integer not null default 1,
  protection_state text not null default 'normal',
  last_heartbeat_at timestamptz not null default now(),
  started_at timestamptz not null default now(),
  stopped_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  constraint worker_instances_type_check check (
    worker_type in (
      'ocr',
      'recording_ai',
      'settlement_simulation',
      'maintenance',
      'watchdog'
    )
  ),
  constraint worker_instances_status_check check (
    status in ('starting', 'running', 'paused', 'draining', 'stopped')
  ),
  constraint worker_instances_desired_state_check check (
    desired_state in ('running', 'paused', 'draining')
  ),
  constraint worker_instances_protection_state_check check (
    protection_state in ('normal', 'cpu_high', 'memory_high', 'disk_high')
  ),
  constraint worker_instances_capacity_nonnegative check (
    current_jobs >= 0 and concurrency_limit > 0
  )
);

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'worker_instances'
      and column_name = 'heartbeat_at'
  ) and not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'worker_instances'
      and column_name = 'last_heartbeat_at'
  ) then
    alter table public.worker_instances
      rename column heartbeat_at to last_heartbeat_at;
  end if;
end $$;

create table if not exists public.scheduled_job_runs (
  id uuid primary key default extensions.gen_random_uuid(),
  job_key text not null,
  scheduled_for timestamptz not null,
  status text not null default 'queued',
  claimed_by text,
  lease_expires_at timestamptz,
  attempt integer not null default 0,
  started_at timestamptz,
  completed_at timestamptz,
  error_code text,
  result jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (job_key, scheduled_for),
  constraint scheduled_job_runs_status_check check (
    status in ('queued', 'running', 'succeeded', 'failed', 'skipped')
  ),
  constraint scheduled_job_runs_attempt_nonnegative check (attempt >= 0)
);

comment on column public.scheduled_job_runs.job_key is
  'Scheduled maintenance job key, for example settlement.simulate_large_sample.';

create table if not exists public.scheduled_job_run_items (
  run_id uuid not null references public.scheduled_job_runs(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  status text not null default 'queued',
  claimed_by text,
  lease_expires_at timestamptz,
  attempt integer not null default 0,
  max_attempts integer not null default 3,
  started_at timestamptz,
  completed_at timestamptz,
  error_code text,
  result jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(run_id, organization_id),
  constraint scheduled_job_run_items_status_check check (
    status in ('queued', 'running', 'succeeded', 'failed', 'skipped')
  ),
  constraint scheduled_job_run_items_attempt_bounds check (
    attempt >= 0 and max_attempts > 0
  )
);

create index if not exists scheduled_job_runs_incomplete_idx
on public.scheduled_job_runs (job_key, scheduled_for)
where status in ('queued', 'running');

create index if not exists scheduled_job_run_items_claim_idx
on public.scheduled_job_run_items (run_id, status, lease_expires_at, attempt);

create table if not exists public.maintenance_execution_leases (
  lease_key text primary key,
  owner_worker_id text not null,
  lease_expires_at timestamptz not null,
  acquired_at timestamptz not null default now(),
  renewed_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  constraint maintenance_execution_leases_global_key check (lease_key = 'global')
);

do $$
begin
  alter table public.maintenance_execution_leases
    add constraint maintenance_execution_leases_global_key
    check (lease_key = 'global');
exception
  when duplicate_object then null;
end $$;

create table if not exists public.async_task_queue_controls (
  organization_id uuid references public.organizations(id) on delete cascade,
  task_type text not null,
  desired_state text not null default 'running',
  reason text,
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now(),
  primary key (organization_id, task_type),
  constraint async_task_queue_controls_task_type_check check (
    task_type in ('ocr', 'recording_ai', 'settlement_simulation')
  ),
  constraint async_task_queue_controls_desired_state_check check (
    desired_state in ('running', 'paused', 'draining')
  )
);

create table if not exists public.provider_circuit_breakers (
  provider_key text primary key,
  state text not null default 'closed',
  consecutive_failures integer not null default 0,
  opened_until timestamptz,
  probe_worker_id text,
  probe_lease_expires_at timestamptz,
  last_error_code text,
  updated_at timestamptz not null default now(),
  constraint provider_circuit_breakers_state_check check (
    state in ('closed', 'open', 'half_open')
  ),
  constraint provider_circuit_breakers_consecutive_failures_nonnegative check (
    consecutive_failures >= 0
  )
);

alter table public.async_task_events enable row level security;
alter table public.worker_instances enable row level security;
alter table public.scheduled_job_runs enable row level security;
alter table public.scheduled_job_run_items enable row level security;
alter table public.maintenance_execution_leases enable row level security;
alter table public.async_task_queue_controls enable row level security;
alter table public.provider_circuit_breakers enable row level security;

create policy async_task_queue_controls_staff_read
on public.async_task_queue_controls
for select
using (
  organization_id is not null
  and public.is_org_member(organization_id)
  and public.is_mcn_staff(organization_id)
);

create policy async_task_queue_controls_manager_write
on public.async_task_queue_controls
for all
using (
  organization_id is not null
  and public.current_user_role(organization_id) in ('owner', 'ops_manager')
)
with check (
  organization_id is not null
  and public.current_user_role(organization_id) in ('owner', 'ops_manager')
);

revoke all on public.async_task_events from public, anon, authenticated;
grant select, insert on public.async_task_events to service_role;
grant usage, select on sequence public.async_task_events_id_seq to service_role;

revoke all on public.worker_instances from public, anon, authenticated;
revoke all on public.scheduled_job_runs from public, anon, authenticated;
revoke all on public.scheduled_job_run_items from public, anon, authenticated;
revoke all on public.maintenance_execution_leases from public, anon, authenticated;
revoke all on public.provider_circuit_breakers from public, anon, authenticated;

grant select, insert, update on public.worker_instances to service_role;
grant select, insert, update on public.scheduled_job_runs to service_role;
grant select, insert, update on public.scheduled_job_run_items to service_role;
grant select, insert, update on public.maintenance_execution_leases to service_role;
grant select, insert, update on public.provider_circuit_breakers to service_role;

revoke all on public.async_task_queue_controls from public, anon;
grant select, insert, update on public.async_task_queue_controls to authenticated;
grant select, insert, update on public.async_task_queue_controls to service_role;

create or replace function public.ensure_scheduled_job_run(
  p_job_key text,
  p_scheduled_for timestamptz
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_run_id uuid;
begin
  insert into public.scheduled_job_runs (job_key, scheduled_for, status)
  values (p_job_key, p_scheduled_for, 'queued')
  on conflict (job_key, scheduled_for) do nothing;

  select id into v_run_id
  from public.scheduled_job_runs
  where job_key = p_job_key
    and scheduled_for = p_scheduled_for;

  insert into public.scheduled_job_run_items (run_id, organization_id)
  select v_run_id, organization_members.organization_id
  from public.organization_members
  where organization_members.status = 'active'
  group by organization_members.organization_id
  on conflict (run_id, organization_id) do nothing;

  return v_run_id;
end;
$$;

create or replace function public.claim_scheduled_job_run(
  p_run_id uuid,
  p_worker_id text,
  p_lease_seconds integer default 120,
  p_now timestamptz default now()
) returns public.scheduled_job_runs
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_run public.scheduled_job_runs;
begin
  if not exists (
    select 1
    from public.maintenance_execution_leases
    where lease_key = 'global'
      and owner_worker_id = p_worker_id
      and lease_expires_at > p_now
  ) then
    return null;
  end if;

  select *
  into v_run
  from public.scheduled_job_runs
  where id = p_run_id
  for update;

  if not found then
    return null;
  end if;

  if v_run.status in ('succeeded', 'failed', 'skipped') then
    return v_run;
  end if;

  if v_run.status = 'running'
    and v_run.claimed_by is not null
    and v_run.claimed_by <> p_worker_id
    and v_run.lease_expires_at > p_now
  then
    return v_run;
  end if;

  if v_run.status = 'queued'
    or (
      v_run.status = 'running'
      and (v_run.lease_expires_at is null or v_run.lease_expires_at <= p_now)
    )
  then
    update public.scheduled_job_runs
    set status = 'running',
        claimed_by = p_worker_id,
        lease_expires_at = p_now + make_interval(secs => p_lease_seconds),
        attempt = attempt + 1,
        started_at = coalesce(started_at, p_now),
        completed_at = null,
        updated_at = p_now
    where id = p_run_id
    returning * into v_run;
  end if;

  return v_run;
end;
$$;

create or replace function public.find_oldest_incomplete_scheduled_job_run(
  p_job_key text
) returns uuid
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select id
  from public.scheduled_job_runs
  where job_key = p_job_key
    and status in ('queued', 'running')
  order by scheduled_for asc
  limit 1;
$$;

create or replace function public.claim_scheduled_job_run_items(
  p_run_id uuid,
  p_worker_id text,
  p_limit integer,
  p_lease_seconds integer default 120,
  p_now timestamptz default now()
) returns setof public.scheduled_job_run_items
language sql
security definer
set search_path = public, pg_temp
as $$
  with locked_run as (
    select run.id
    from public.scheduled_job_runs run
    where run.id = p_run_id
      and run.status = 'running'
      and run.claimed_by = p_worker_id
      and run.lease_expires_at > p_now
    for update
  ),
  claimable as (
    select item.run_id, item.organization_id
    from public.scheduled_job_run_items item
    join locked_run
      on locked_run.id = item.run_id
    where item.attempt < item.max_attempts
      and (
        item.status = 'queued'
        or (
          item.status = 'running'
          and (item.lease_expires_at is null or item.lease_expires_at <= p_now)
        )
      )
    order by item.organization_id
    limit p_limit
    for update skip locked
  )
  update public.scheduled_job_run_items item
  set status = 'running',
      claimed_by = p_worker_id,
      lease_expires_at = p_now + make_interval(secs => p_lease_seconds),
      attempt = item.attempt + 1,
      started_at = coalesce(item.started_at, p_now),
      completed_at = null,
      updated_at = p_now
  from claimable
  where item.run_id = claimable.run_id
    and item.organization_id = claimable.organization_id
  returning item.*;
$$;

create or replace function public.renew_scheduled_job_run_lease(
  p_run_id uuid,
  p_worker_id text,
  p_lease_seconds integer default 120,
  p_now timestamptz default now()
) returns boolean
language sql
security definer
set search_path = public, pg_temp
as $$
  with renewed_run as (
    update public.scheduled_job_runs
    set lease_expires_at = p_now + make_interval(secs => p_lease_seconds),
        updated_at = p_now
    where id = p_run_id
      and status = 'running'
      and claimed_by = p_worker_id
      and lease_expires_at > p_now
    returning true as renewed
  )
  select coalesce((select renewed from renewed_run), false);
$$;

create or replace function public.renew_scheduled_job_run_item_lease(
  p_run_id uuid,
  p_organization_id uuid,
  p_worker_id text,
  p_lease_seconds integer default 120,
  p_now timestamptz default now()
) returns boolean
language sql
security definer
set search_path = public, pg_temp
as $$
  with renewed_item as (
    update public.scheduled_job_run_items item
    set lease_expires_at = p_now + make_interval(secs => p_lease_seconds),
        updated_at = p_now
    from public.scheduled_job_runs run
    where item.run_id = p_run_id
      and item.organization_id = p_organization_id
      and item.status = 'running'
      and item.claimed_by = p_worker_id
      and item.lease_expires_at > p_now
      and run.id = item.run_id
      and run.status = 'running'
      and run.claimed_by = p_worker_id
      and run.lease_expires_at > p_now
    returning true as renewed
  )
  select coalesce((select renewed from renewed_item), false);
$$;

create or replace function public.complete_scheduled_job_run_item(
  p_run_id uuid,
  p_organization_id uuid,
  p_worker_id text,
  p_status text,
  p_error_code text default null,
  p_result jsonb default '{}'::jsonb,
  p_now timestamptz default now()
) returns boolean
language sql
security definer
set search_path = public, pg_temp
as $$
  with completed_item as (
    update public.scheduled_job_run_items item
    set status = p_status,
        error_code = p_error_code,
        result = p_result,
        completed_at = p_now,
        lease_expires_at = null,
        updated_at = p_now
    from public.scheduled_job_runs run
    where item.run_id = p_run_id
      and item.organization_id = p_organization_id
      and item.status = 'running'
      and item.claimed_by = p_worker_id
      and item.lease_expires_at > p_now
      and run.id = item.run_id
      and run.status = 'running'
      and run.claimed_by = p_worker_id
      and run.lease_expires_at > p_now
      and p_status in ('succeeded', 'failed', 'skipped')
    returning true as completed
  )
  select coalesce((select completed from completed_item), false);
$$;

create or replace function public.finalize_scheduled_job_run(
  p_run_id uuid,
  p_worker_id text,
  p_now timestamptz default now()
) returns public.scheduled_job_runs
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_run public.scheduled_job_runs;
  v_total integer;
  v_failed integer;
  v_skipped integer;
begin
  select *
  into v_run
  from public.scheduled_job_runs
  where id = p_run_id
    and status = 'running'
    and claimed_by = p_worker_id
    and lease_expires_at > p_now
  for update;

  if not found then
    return null;
  end if;

  select
    count(*),
    count(*) filter (where status = 'failed'),
    count(*) filter (where status = 'skipped')
  into v_total, v_failed, v_skipped
  from public.scheduled_job_run_items
  where run_id = p_run_id;

  if exists (
    select 1
    from public.scheduled_job_run_items
    where run_id = p_run_id
      and status not in ('succeeded', 'failed', 'skipped')
  ) then
    return v_run;
  end if;

  update public.scheduled_job_runs
  set status = case
        when v_total = 0 then 'skipped'
        when v_failed > 0 then 'failed'
        when v_skipped = v_total then 'skipped'
        else 'succeeded'
      end,
      completed_at = p_now,
      lease_expires_at = null,
      error_code = case when v_failed > 0 then 'scheduled_items_failed' else null end,
      result = jsonb_build_object(
        'total', v_total,
        'succeeded', (
          select count(*)
          from public.scheduled_job_run_items
          where run_id = p_run_id and status = 'succeeded'
        ),
        'failed', v_failed,
        'skipped', v_skipped
      ),
      updated_at = p_now
  where id = p_run_id
  returning * into v_run;

  return v_run;
end;
$$;

create or replace function public.finalize_scheduled_job_run_reconciled(
  p_run_id uuid,
  p_now timestamptz default now()
) returns public.scheduled_job_runs
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_run public.scheduled_job_runs;
  v_total integer;
  v_failed integer;
  v_skipped integer;
begin
  select *
  into v_run
  from public.scheduled_job_runs
  where id = p_run_id
    and status in ('queued', 'running')
  for update;

  if not found then
    return null;
  end if;

  select
    count(*),
    count(*) filter (where status = 'failed'),
    count(*) filter (where status = 'skipped')
  into v_total, v_failed, v_skipped
  from public.scheduled_job_run_items
  where run_id = p_run_id;

  if exists (
    select 1
    from public.scheduled_job_run_items
    where run_id = p_run_id
      and status not in ('succeeded', 'failed', 'skipped')
  ) then
    return v_run;
  end if;

  update public.scheduled_job_runs
  set status = case
        when v_total = 0 then 'skipped'
        when v_failed > 0 then 'failed'
        when v_skipped = v_total then 'skipped'
        else 'succeeded'
      end,
      completed_at = p_now,
      lease_expires_at = null,
      error_code = case when v_failed > 0 then 'scheduled_items_failed' else null end,
      result = jsonb_build_object(
        'total', v_total,
        'succeeded', (
          select count(*)
          from public.scheduled_job_run_items
          where run_id = p_run_id and status = 'succeeded'
        ),
        'failed', v_failed,
        'skipped', v_skipped
      ),
      updated_at = p_now
  where id = p_run_id
    and status in ('queued', 'running')
  returning * into v_run;

  return v_run;
end;
$$;

drop function if exists public.reconcile_expired_scheduled_job_work(timestamptz, integer);

create or replace function public.reconcile_expired_scheduled_job_work(
  p_now timestamptz default now(),
  p_limit integer default 100
) returns table (
  failed_item_ids text[],
  finalized_run_ids uuid[]
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_run_id uuid;
  v_finalized_run public.scheduled_job_runs;
  v_affected_run_ids uuid[] := '{}'::uuid[];
  v_failed_item_ids text[] := '{}'::text[];
  v_finalized_run_ids uuid[] := '{}'::uuid[];
begin
  with expired as (
    select run_id, organization_id
    from public.scheduled_job_run_items
    where status = 'running'
      and lease_expires_at <= p_now
      and attempt >= max_attempts
    order by lease_expires_at
    limit p_limit
    for update skip locked
  ),
  marked as (
    update public.scheduled_job_run_items item
    set status = 'failed',
        error_code = 'worker_lease_exhausted',
        completed_at = p_now,
        lease_expires_at = null,
        updated_at = p_now
    from expired
    where item.run_id = expired.run_id
      and item.organization_id = expired.organization_id
    returning item.run_id, item.organization_id
  )
  select
    coalesce(
      array_agg(
        distinct marked.run_id::text || ':' || marked.organization_id::text
        order by marked.run_id::text || ':' || marked.organization_id::text
      ),
      '{}'::text[]
    ),
    coalesce(array_agg(distinct marked.run_id order by marked.run_id), '{}'::uuid[])
  into v_failed_item_ids, v_affected_run_ids
  from marked;

  with retryable as (
    select run_id, organization_id
    from public.scheduled_job_run_items
    where status = 'running'
      and lease_expires_at <= p_now
      and attempt < max_attempts
    order by lease_expires_at
    limit p_limit
    for update skip locked
  ),
  requeued as (
    update public.scheduled_job_run_items item
    set status = 'queued',
        claimed_by = null,
        lease_expires_at = null,
        updated_at = p_now
    from retryable
    where item.run_id = retryable.run_id
      and item.organization_id = retryable.organization_id
    returning item.run_id
  )
  select v_affected_run_ids || coalesce(array_agg(distinct run_id), '{}'::uuid[])
  into v_affected_run_ids
  from requeued;

  for v_run_id in
    with affected_runs as (
      select distinct run_id
      from unnest(v_affected_run_ids) as affected_runs(run_id)
    ),
    complete_open_runs as (
      select run.id as run_id
      from public.scheduled_job_runs run
      where run.status in ('queued', 'running')
        and not exists (
          select 1
          from public.scheduled_job_run_items item
          where item.run_id = run.id
            and item.status not in ('succeeded', 'failed', 'skipped')
        )
      order by run.updated_at
      limit p_limit
    )
    select distinct run_id
    from (
      select run_id from affected_runs
      union all
      select run_id from complete_open_runs
    ) candidates
  loop
    v_finalized_run := public.finalize_scheduled_job_run_reconciled(v_run_id, p_now);
    if v_finalized_run.id is not null
      and v_finalized_run.status in ('succeeded', 'failed', 'skipped')
    then
      v_finalized_run_ids := array_append(v_finalized_run_ids, v_finalized_run.id);
    end if;
  end loop;

  return query
  select
    coalesce(v_failed_item_ids, '{}'::text[]) as failed_item_ids,
    coalesce(v_finalized_run_ids, '{}'::uuid[]) as finalized_run_ids;
end;
$$;

create or replace function public.acquire_maintenance_execution_lease(
  p_worker_id text,
  p_lease_seconds integer default 120,
  p_now timestamptz default now()
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_acquired boolean := false;
begin
  insert into public.maintenance_execution_leases (
    lease_key,
    owner_worker_id,
    lease_expires_at,
    acquired_at,
    renewed_at
  )
  values (
    'global',
    p_worker_id,
    p_now + make_interval(secs => p_lease_seconds),
    p_now,
    p_now
  )
  on conflict (lease_key) do update
  set owner_worker_id = excluded.owner_worker_id,
      lease_expires_at = excluded.lease_expires_at,
      acquired_at = excluded.acquired_at,
      renewed_at = excluded.renewed_at
  where public.maintenance_execution_leases.lease_expires_at <= p_now
  returning true into v_acquired;

  return coalesce(v_acquired, false);
end;
$$;

create or replace function public.renew_maintenance_execution_lease(
  p_worker_id text,
  p_lease_seconds integer default 120,
  p_now timestamptz default now()
) returns boolean
language sql
security definer
set search_path = public, pg_temp
as $$
  with renewed_lease as (
    update public.maintenance_execution_leases
    set lease_expires_at = p_now + make_interval(secs => p_lease_seconds),
        renewed_at = p_now
    where lease_key = 'global'
      and owner_worker_id = p_worker_id
      and lease_expires_at > p_now
    returning true as renewed
  )
  select coalesce((select renewed from renewed_lease), false);
$$;

create or replace function public.release_maintenance_execution_lease(
  p_worker_id text
) returns boolean
language sql
security definer
set search_path = public, pg_temp
as $$
  with released_lease as (
    delete from public.maintenance_execution_leases
    where lease_key = 'global'
      and owner_worker_id = p_worker_id
    returning true as released
  )
  select coalesce((select released from released_lease), false);
$$;

revoke all on function public.ensure_scheduled_job_run(text, timestamptz) from public, anon, authenticated;
revoke all on function public.claim_scheduled_job_run(uuid, text, integer, timestamptz) from public, anon, authenticated;
revoke all on function public.find_oldest_incomplete_scheduled_job_run(text) from public, anon, authenticated;
revoke all on function public.claim_scheduled_job_run_items(uuid, text, integer, integer, timestamptz) from public, anon, authenticated;
revoke all on function public.renew_scheduled_job_run_lease(uuid, text, integer, timestamptz) from public, anon, authenticated;
revoke all on function public.renew_scheduled_job_run_item_lease(uuid, uuid, text, integer, timestamptz) from public, anon, authenticated;
revoke all on function public.complete_scheduled_job_run_item(uuid, uuid, text, text, text, jsonb, timestamptz) from public, anon, authenticated;
revoke all on function public.finalize_scheduled_job_run(uuid, text, timestamptz) from public, anon, authenticated;
revoke all on function public.finalize_scheduled_job_run_reconciled(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.reconcile_expired_scheduled_job_work(timestamptz, integer) from public, anon, authenticated;
revoke all on function public.acquire_maintenance_execution_lease(text, integer, timestamptz) from public, anon, authenticated;
revoke all on function public.renew_maintenance_execution_lease(text, integer, timestamptz) from public, anon, authenticated;
revoke all on function public.release_maintenance_execution_lease(text) from public, anon, authenticated;

grant execute on function public.ensure_scheduled_job_run(text, timestamptz) to service_role;
grant execute on function public.claim_scheduled_job_run(uuid, text, integer, timestamptz) to service_role;
grant execute on function public.find_oldest_incomplete_scheduled_job_run(text) to service_role;
grant execute on function public.claim_scheduled_job_run_items(uuid, text, integer, integer, timestamptz) to service_role;
grant execute on function public.renew_scheduled_job_run_lease(uuid, text, integer, timestamptz) to service_role;
grant execute on function public.renew_scheduled_job_run_item_lease(uuid, uuid, text, integer, timestamptz) to service_role;
grant execute on function public.complete_scheduled_job_run_item(uuid, uuid, text, text, text, jsonb, timestamptz) to service_role;
grant execute on function public.finalize_scheduled_job_run(uuid, text, timestamptz) to service_role;
grant execute on function public.reconcile_expired_scheduled_job_work(timestamptz, integer) to service_role;
grant execute on function public.acquire_maintenance_execution_lease(text, integer, timestamptz) to service_role;
grant execute on function public.renew_maintenance_execution_lease(text, integer, timestamptz) to service_role;
grant execute on function public.release_maintenance_execution_lease(text) to service_role;
