alter table public.project_recording_share_boards
  add column if not exists access_code_salt text,
  add column if not exists access_code_hash_version text,
  add column if not exists access_code_hash_params jsonb,
  add column if not exists access_code_failure_count integer not null default 0,
  add column if not exists access_code_failure_version bigint not null default 0,
  add column if not exists access_code_locked_until timestamptz;

alter table public.project_recording_share_boards
  add constraint project_recording_share_boards_access_code_failure_count_check
  check (access_code_failure_count >= 0);

create index project_recording_share_boards_access_code_locked_until_idx
on public.project_recording_share_boards (access_code_locked_until)
where access_code_locked_until is not null;

alter table public.project_recording_share_boards
  add constraint project_recording_share_boards_access_code_hash_version_check
  check (
    access_code_hash_version is null
    or access_code_hash_version in ('scrypt_v1', 'sha256_salted_v1')
  );

create table public.admission_share_public_rate_limit_buckets (
  scope text not null,
  dimension_hash text not null,
  window_started_at timestamptz not null,
  request_count integer not null,
  updated_at timestamptz not null default now(),
  primary key (scope, dimension_hash),
  constraint admission_share_rate_limit_scope_not_blank_check
    check (length(btrim(scope)) > 0),
  constraint admission_share_rate_limit_dimension_hash_check
    check (dimension_hash ~ '^[0-9a-f]{64}$'),
  constraint admission_share_rate_limit_request_count_positive_check
    check (request_count > 0)
);

alter table public.admission_share_public_rate_limit_buckets enable row level security;

create index admission_share_public_rate_limit_buckets_updated_at_idx
on public.admission_share_public_rate_limit_buckets (updated_at);

revoke all on table public.admission_share_public_rate_limit_buckets
from public, anon, authenticated, service_role;

create or replace function public.consume_admission_share_rate_limit(
  p_scope text,
  p_dimension_hash text,
  p_limit integer,
  p_window_seconds integer
)
returns table (
  allowed boolean,
  retry_after_seconds integer,
  remaining integer
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_bucket public.admission_share_public_rate_limit_buckets%rowtype;
begin
  if length(btrim(coalesce(p_scope, ''))) = 0 then
    raise exception 'rate-limit scope is required';
  end if;
  if p_dimension_hash is null or p_dimension_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'rate-limit dimension hash is invalid';
  end if;
  if p_limit is null or p_limit <= 0 or p_limit > 1000000 then
    raise exception 'rate-limit limit must be positive';
  end if;
  if p_window_seconds is null or p_window_seconds <= 0 then
    raise exception 'rate-limit window must be positive';
  end if;

  delete from public.admission_share_public_rate_limit_buckets
  where ctid in (
    select ctid
    from public.admission_share_public_rate_limit_buckets
    where updated_at < v_now - interval '1 day'
    order by updated_at
    limit 100
  );

  insert into public.admission_share_public_rate_limit_buckets (
    scope,
    dimension_hash,
    window_started_at,
    request_count,
    updated_at
  )
  values (
    btrim(p_scope),
    p_dimension_hash,
    v_now,
    1,
    v_now
  )
  on conflict (scope, dimension_hash) do update
  set
    window_started_at = case
      when admission_share_public_rate_limit_buckets.window_started_at
        <= v_now - make_interval(secs => p_window_seconds)
      then v_now
      else admission_share_public_rate_limit_buckets.window_started_at
    end,
    request_count = case
      when admission_share_public_rate_limit_buckets.window_started_at
        <= v_now - make_interval(secs => p_window_seconds)
      then 1
      else least(
        admission_share_public_rate_limit_buckets.request_count + 1,
        p_limit + 1
      )
    end,
    updated_at = v_now
  returning * into v_bucket;

  allowed := v_bucket.request_count <= p_limit;
  remaining := greatest(p_limit - v_bucket.request_count, 0);
  retry_after_seconds := case
    when allowed then 0
    else greatest(
      1,
      ceil(
        extract(
          epoch from (
            v_bucket.window_started_at
            + make_interval(secs => p_window_seconds)
            - v_now
          )
        )
      )::integer
    )
  end;
  return next;
end;
$$;

create or replace function public.record_admission_share_access_code_failure(
  p_share_board_id uuid,
  p_failed_at timestamptz default now()
)
returns table (
  failure_count integer,
  failure_version bigint,
  locked_until timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if p_failed_at is null then
    raise exception 'failed-at timestamp is required';
  end if;

  return query
  update public.project_recording_share_boards as board
  set
    access_code_failure_count = case
      when board.access_code_locked_until is not null
        and board.access_code_locked_until <= p_failed_at
      then 1
      when board.access_code_locked_until is not null
        and board.access_code_locked_until > p_failed_at
      then board.access_code_failure_count
      else least(board.access_code_failure_count + 1, 5)
    end,
    access_code_locked_until = case
      when board.access_code_locked_until is not null
        and board.access_code_locked_until > p_failed_at
      then board.access_code_locked_until
      when board.access_code_locked_until is not null
        and board.access_code_locked_until <= p_failed_at
      then null
      when board.access_code_failure_count + 1 >= 5
      then p_failed_at + interval '15 minutes'
      else null
    end,
    access_code_failure_version = board.access_code_failure_version + 1
  where board.id = p_share_board_id
    and (
      board.access_code_locked_until is null
      or board.access_code_locked_until <= p_failed_at
    )
  returning
    board.access_code_failure_count,
    board.access_code_failure_version,
    board.access_code_locked_until;

  if found then
    return;
  end if;

  return query
  select
    board.access_code_failure_count,
    board.access_code_failure_version,
    board.access_code_locked_until
  from public.project_recording_share_boards as board
  where board.id = p_share_board_id
    and board.access_code_locked_until > p_failed_at;

  if not found then
    raise exception 'share board not found';
  end if;
end;
$$;

create or replace function public.reset_admission_share_access_code_failures(
  p_share_board_id uuid,
  p_observed_failure_version bigint
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_reset boolean := false;
begin
  update public.project_recording_share_boards
  set
    access_code_failure_count = 0,
    access_code_locked_until = null
  where id = p_share_board_id
    and access_code_failure_version = p_observed_failure_version
  returning true into v_reset;

  return coalesce(v_reset, false);
end;
$$;

create or replace function public.mark_admission_share_board_viewed(
  p_share_board_id uuid,
  p_viewed_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if p_viewed_at is null then
    raise exception 'viewed-at timestamp is required';
  end if;

  update public.project_recording_share_boards
  set last_viewed_at = greatest(
    coalesce(last_viewed_at, p_viewed_at),
    p_viewed_at
  )
  where id = p_share_board_id;
end;
$$;

revoke all on function public.consume_admission_share_rate_limit(
  text, text, integer, integer
) from public, anon, authenticated;
grant execute on function public.consume_admission_share_rate_limit(
  text, text, integer, integer
) to service_role;

revoke all on function public.record_admission_share_access_code_failure(
  uuid, timestamptz
) from public, anon, authenticated;
grant execute on function public.record_admission_share_access_code_failure(
  uuid, timestamptz
) to service_role;

revoke all on function public.reset_admission_share_access_code_failures(
  uuid, bigint
)
from public, anon, authenticated;
grant execute on function public.reset_admission_share_access_code_failures(
  uuid, bigint
)
to service_role;

revoke all on function public.mark_admission_share_board_viewed(
  uuid, timestamptz
)
from public, anon, authenticated;
grant execute on function public.mark_admission_share_board_viewed(
  uuid, timestamptz
)
to service_role;
