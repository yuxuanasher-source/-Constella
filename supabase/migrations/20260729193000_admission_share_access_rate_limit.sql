create table public.project_recording_share_access_attempts (
  share_board_id uuid not null
    references public.project_recording_share_boards(id) on delete cascade,
  client_fingerprint text not null,
  window_started_at timestamptz not null default now(),
  failed_attempts integer not null default 0,
  blocked_until timestamptz,
  updated_at timestamptz not null default now(),
  primary key (share_board_id, client_fingerprint),
  constraint project_recording_share_access_attempts_fingerprint_check
    check (char_length(client_fingerprint) between 32 and 128),
  constraint project_recording_share_access_attempts_failed_check
    check (failed_attempts >= 0)
);

create table public.project_recording_share_access_sessions (
  id uuid primary key default gen_random_uuid(),
  share_board_id uuid not null
    references public.project_recording_share_boards(id) on delete cascade,
  session_token_hash text not null unique,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint project_recording_share_access_sessions_token_hash_check
    check (session_token_hash ~ '^[0-9a-f]{64}$'),
  constraint project_recording_share_access_sessions_expiry_check
    check (expires_at > created_at)
);

create index project_recording_share_access_sessions_board_expiry_idx
on public.project_recording_share_access_sessions (share_board_id, expires_at);

alter table public.project_recording_share_access_attempts enable row level security;
alter table public.project_recording_share_access_sessions enable row level security;

create or replace function public.consume_admission_share_access_attempt(
  p_share_board_id uuid,
  p_client_fingerprint text,
  p_succeeded boolean,
  p_now timestamptz default now(),
  p_window_seconds integer default 900,
  p_max_failures integer default 5,
  p_block_seconds integer default 900
)
returns table (
  allowed boolean,
  retry_after_seconds integer
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_attempt public.project_recording_share_access_attempts%rowtype;
  v_failed_attempts integer;
  v_blocked_until timestamptz;
begin
  if p_window_seconds <= 0
     or p_max_failures <= 0
     or p_block_seconds <= 0 then
    raise exception 'admission_share_access_limit_invalid_configuration';
  end if;

  insert into public.project_recording_share_access_attempts (
    share_board_id,
    client_fingerprint,
    window_started_at,
    failed_attempts,
    blocked_until,
    updated_at
  )
  values (
    p_share_board_id,
    p_client_fingerprint,
    p_now,
    0,
    null,
    p_now
  )
  on conflict (share_board_id, client_fingerprint) do nothing;

  select *
  into v_attempt
  from public.project_recording_share_access_attempts
  where share_board_id = p_share_board_id
    and client_fingerprint = p_client_fingerprint
  for update;

  if v_attempt.blocked_until is not null
     and v_attempt.blocked_until > p_now then
    return query
      select
        false,
        greatest(
          1,
          ceil(extract(epoch from (v_attempt.blocked_until - p_now)))::integer
        );
    return;
  end if;

  if p_succeeded is null then
    return query select true, 0::integer;
    return;
  end if;

  if p_succeeded then
    update public.project_recording_share_access_attempts
    set window_started_at = p_now,
        failed_attempts = 0,
        blocked_until = null,
        updated_at = p_now
    where share_board_id = p_share_board_id
      and client_fingerprint = p_client_fingerprint;

    return query select true, 0::integer;
    return;
  end if;

  v_failed_attempts :=
    case
      when v_attempt.window_started_at <=
        p_now - make_interval(secs => p_window_seconds)
      then 1
      else v_attempt.failed_attempts + 1
    end;

  v_blocked_until :=
    case
      when v_failed_attempts >= p_max_failures
      then p_now + make_interval(secs => p_block_seconds)
      else null
    end;

  update public.project_recording_share_access_attempts
  set window_started_at =
        case
          when v_attempt.window_started_at <=
            p_now - make_interval(secs => p_window_seconds)
          then p_now
          else v_attempt.window_started_at
        end,
      failed_attempts = v_failed_attempts,
      blocked_until = v_blocked_until,
      updated_at = p_now
  where share_board_id = p_share_board_id
    and client_fingerprint = p_client_fingerprint;

  if v_blocked_until is not null then
    return query select false, p_block_seconds;
    return;
  end if;

  return query select true, 0::integer;
end;
$$;

revoke all on table public.project_recording_share_access_attempts
  from public, anon, authenticated;
revoke all on table public.project_recording_share_access_sessions
  from public, anon, authenticated;
revoke all on function public.consume_admission_share_access_attempt(
  uuid,
  text,
  boolean,
  timestamptz,
  integer,
  integer,
  integer
) from public, anon, authenticated;

grant execute on function public.consume_admission_share_access_attempt(
  uuid,
  text,
  boolean,
  timestamptz,
  integer,
  integer,
  integer
) to service_role;
