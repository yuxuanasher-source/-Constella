-- deploy: expand

alter table public.ai_chat_turns
  add column if not exists recovery_event_sequence bigint not null default 0,
  add column if not exists recovery_partial_content text not null default '',
  add column if not exists recovery_partial_updated_at timestamptz,
  add column if not exists recovery_terminal_event jsonb,
  add column if not exists recovery_control_state jsonb not null default '{}'::jsonb;

do $ai_chat_turn_recovery_constraints$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint constraint_record
    where constraint_record.conrelid = 'public.ai_chat_turns'::regclass
      and constraint_record.conname = 'ai_chat_turns_recovery_sequence_nonnegative'
  ) then
    alter table public.ai_chat_turns
      add constraint ai_chat_turns_recovery_sequence_nonnegative
      check (recovery_event_sequence >= 0);
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint constraint_record
    where constraint_record.conrelid = 'public.ai_chat_turns'::regclass
      and constraint_record.conname = 'ai_chat_turns_recovery_partial_bounded'
  ) then
    alter table public.ai_chat_turns
      add constraint ai_chat_turns_recovery_partial_bounded
      check (octet_length(recovery_partial_content) <= 400000);
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint constraint_record
    where constraint_record.conrelid = 'public.ai_chat_turns'::regclass
      and constraint_record.conname = 'ai_chat_turns_recovery_terminal_bounded'
  ) then
    alter table public.ai_chat_turns
      add constraint ai_chat_turns_recovery_terminal_bounded
      check (
        recovery_terminal_event is null
        or (
          jsonb_typeof(recovery_terminal_event) = 'object'
          and octet_length(recovery_terminal_event::text) <= 524288
        )
      );
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint constraint_record
    where constraint_record.conrelid = 'public.ai_chat_turns'::regclass
      and constraint_record.conname = 'ai_chat_turns_recovery_control_bounded'
  ) then
    alter table public.ai_chat_turns
      add constraint ai_chat_turns_recovery_control_bounded
      check (
        jsonb_typeof(recovery_control_state) = 'object'
        and octet_length(recovery_control_state::text) <= 16384
        and recovery_control_state - 'pendingClarify' - 'childSessionIds' = '{}'::jsonb
      );
  end if;
end;
$ai_chat_turn_recovery_constraints$;

create unique index if not exists ai_chat_turns_recovery_identity_key
  on public.ai_chat_turns (
    id,
    conversation_id,
    organization_id,
    owner_user_id
  );

create table if not exists public.ai_chat_turn_events (
  turn_id uuid not null,
  event_sequence bigint not null check (event_sequence > 0),
  organization_id uuid not null,
  owner_user_id uuid not null,
  conversation_id uuid not null,
  event_name text not null check (
    event_name in (
      'accepted',
      'context_ready',
      'session_ready',
      'tool_started',
      'tool_completed',
      'clarify_requested',
      'clarify_answered',
      'cancel_requested',
      'response_partial',
      'terminal'
    )
  ),
  payload jsonb not null default '{}'::jsonb check (
    jsonb_typeof(payload) = 'object'
    and octet_length(payload::text) <= 16384
  ),
  created_at timestamptz not null default clock_timestamp(),
  primary key (turn_id, event_sequence),
  constraint ai_chat_turn_events_turn_identity_fkey
    foreign key (turn_id, conversation_id, organization_id, owner_user_id)
    references public.ai_chat_turns(id, conversation_id, organization_id, owner_user_id)
    on delete cascade
);

create index if not exists ai_chat_turn_events_identity_sequence_idx
  on public.ai_chat_turn_events (
    organization_id,
    owner_user_id,
    conversation_id,
    turn_id,
    event_sequence
  );

alter table public.ai_chat_turn_events enable row level security;

revoke all on table public.ai_chat_turn_events from public;
revoke all on table public.ai_chat_turn_events from anon;
revoke all on table public.ai_chat_turn_events from authenticated;
grant all on table public.ai_chat_turn_events to service_role;

create or replace function public.append_ai_chat_turn_recovery_event(
  p_organization_id uuid,
  p_owner_user_id uuid,
  p_conversation_id uuid,
  p_turn_id uuid,
  p_event_name text,
  p_payload jsonb,
  p_partial_content text,
  p_terminal_event jsonb,
  p_control_state jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_locked_turn public.ai_chat_turns%rowtype;
  v_event_sequence bigint;
  v_recorded_at timestamptz := clock_timestamp();
  v_control_key text;
  v_pending_clarify jsonb;
  v_child_session_ids jsonb;
  v_child_count integer;
  v_child_distinct_count integer;
  v_result public.ai_chat_turns%rowtype;
  v_existing_response jsonb;
  v_incoming_response jsonb;
  v_operation_status text := 'appended';
begin
  if p_event_name is null or p_event_name not in (
    'accepted',
    'context_ready',
    'session_ready',
    'tool_started',
    'tool_completed',
    'clarify_requested',
    'clarify_answered',
    'cancel_requested',
    'response_partial',
    'terminal'
  ) then
    raise exception 'ai_chat_turn_recovery_event_invalid';
  end if;

  if p_payload is null
     or jsonb_typeof(p_payload) <> 'object'
     or octet_length(p_payload::text) > 16384
     or p_payload::text ~* '"(authorization|cookie|set-cookie|access[_-]?token|refresh[_-]?token|service[_-]?role|secret|password|private[_-]?key|prompt|context_snapshot)"[[:space:]]*:' then
    raise exception 'ai_chat_turn_recovery_payload_invalid';
  end if;

  if p_partial_content is not null
     and octet_length(p_partial_content) > 400000 then
    raise exception 'ai_chat_turn_recovery_partial_content_invalid';
  end if;

  if p_event_name = 'terminal' then
    if p_terminal_event is null
       or jsonb_typeof(p_terminal_event) <> 'object'
       or octet_length(p_terminal_event::text) > 524288
       or p_terminal_event ->> 'type' not in (
         'response.completed',
         'response.failed',
         'response.cancelled'
       )
       or p_terminal_event ->> 'conversationId' <> p_conversation_id::text
       or p_terminal_event ->> 'turnId' <> p_turn_id::text
       or p_terminal_event::text ~* '"(authorization|cookie|set-cookie|access[_-]?token|refresh[_-]?token|service[_-]?role|secret|password|private[_-]?key|prompt|context_snapshot)"[[:space:]]*:' then
      raise exception 'ai_chat_turn_recovery_terminal_event_invalid';
    end if;
  elsif p_terminal_event is not null then
    raise exception 'ai_chat_turn_recovery_terminal_event_invalid';
  end if;

  if p_control_state is not null then
    if jsonb_typeof(p_control_state) <> 'object'
       or octet_length(p_control_state::text) > 16384 then
      raise exception 'ai_chat_turn_recovery_control_state_invalid';
    end if;

    for v_control_key in
      select control_key
      from jsonb_object_keys(p_control_state) control_key
    loop
      if v_control_key not in ('pendingClarify', 'childSessionIds') then
        raise exception 'ai_chat_turn_recovery_control_state_invalid';
      end if;
    end loop;

    v_pending_clarify := p_control_state -> 'pendingClarify';
    if v_pending_clarify is not null
       and jsonb_typeof(v_pending_clarify) <> 'null' then
      if jsonb_typeof(v_pending_clarify) <> 'object'
         or octet_length(v_pending_clarify::text) > 12288
         or exists (
           select 1
           from jsonb_object_keys(v_pending_clarify) pending_key
           where pending_key not in (
             'turnId',
             'clarifyId',
             'requestId',
             'question',
             'choices',
             'allowFreeText',
             'response'
           )
         )
         or jsonb_typeof(v_pending_clarify -> 'turnId') <> 'string'
         or (v_pending_clarify ->> 'turnId') <> p_turn_id::text
         or jsonb_typeof(v_pending_clarify -> 'clarifyId') <> 'string'
         or (v_pending_clarify ->> 'clarifyId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
         or (
           v_pending_clarify ? 'requestId'
           and (
             jsonb_typeof(v_pending_clarify -> 'requestId') <> 'string'
             or (v_pending_clarify ->> 'requestId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
           )
         )
         or jsonb_typeof(v_pending_clarify -> 'question') <> 'string'
         or length(v_pending_clarify ->> 'question') not between 1 and 2000
         or jsonb_typeof(v_pending_clarify -> 'choices') <> 'array'
         or jsonb_array_length(v_pending_clarify -> 'choices') > 12
         or exists (
           select 1
           from jsonb_array_elements(v_pending_clarify -> 'choices') choice(value)
           where jsonb_typeof(choice.value) <> 'string'
             or length(trim(both '"' from choice.value::text)) not between 1 and 256
         )
         or jsonb_typeof(v_pending_clarify -> 'allowFreeText') <> 'boolean' then
        raise exception 'ai_chat_turn_recovery_control_state_invalid';
      end if;

      if v_pending_clarify ? 'response'
         and jsonb_typeof(v_pending_clarify -> 'response') <> 'null' then
        if jsonb_typeof(v_pending_clarify -> 'response') <> 'object'
           or exists (
             select 1
             from jsonb_object_keys(v_pending_clarify -> 'response') response_key
             where response_key not in ('clarifyId', 'answerSha256', 'status')
           )
           or (v_pending_clarify #>> '{response,clarifyId}') <> (v_pending_clarify ->> 'clarifyId')
           or jsonb_typeof(v_pending_clarify #> '{response,answerSha256}') <> 'string'
           or (v_pending_clarify #>> '{response,answerSha256}') !~ '^[0-9a-f]{64}$'
           or (v_pending_clarify #>> '{response,status}') not in ('claimed', 'delivered') then
          raise exception 'ai_chat_turn_recovery_control_state_invalid';
        end if;
      end if;
    end if;

    v_child_session_ids := p_control_state -> 'childSessionIds';
    if v_child_session_ids is not null
       and jsonb_typeof(v_child_session_ids) <> 'null' then
      if jsonb_typeof(v_child_session_ids) <> 'array'
         or jsonb_array_length(v_child_session_ids) > 64
         or exists (
           select 1
           from jsonb_array_elements(v_child_session_ids) child(value)
           where jsonb_typeof(child.value) <> 'string'
             or length(trim(both '"' from child.value::text)) not between 1 and 256
         ) then
        raise exception 'ai_chat_turn_recovery_control_state_invalid';
      end if;

      select count(*), count(distinct child.value)
      into v_child_count, v_child_distinct_count
      from jsonb_array_elements_text(v_child_session_ids) child(value);
      if v_child_count <> v_child_distinct_count then
        raise exception 'ai_chat_turn_recovery_control_state_invalid';
      end if;
    end if;
  end if;

  select locked_turn.*
  into v_locked_turn
  from public.ai_chat_turns locked_turn
  where locked_turn.organization_id = p_organization_id
    and locked_turn.owner_user_id = p_owner_user_id
    and locked_turn.conversation_id = p_conversation_id
    and locked_turn.id = p_turn_id
  for update;

  if not found then
    raise exception 'ai_chat_turn_recovery_not_found';
  end if;
  if v_locked_turn.recovery_terminal_event is not null then
    raise exception 'ai_chat_turn_recovery_terminal_locked';
  end if;

  if p_event_name = 'clarify_answered' then
    v_incoming_response := p_control_state #> '{pendingClarify,response}';
    v_existing_response := v_locked_turn.recovery_control_state
      #> '{pendingClarify,response}';
    if v_incoming_response is null
       or jsonb_typeof(v_incoming_response) <> 'object' then
      raise exception 'ai_chat_turn_recovery_control_state_invalid';
    end if;

    if v_existing_response is not null
       and jsonb_typeof(v_existing_response) = 'object' then
      if (v_existing_response ->> 'answerSha256')
           <> (v_incoming_response ->> 'answerSha256') then
        v_operation_status := 'conflict';
      elsif (v_existing_response ->> 'status') = 'delivered' then
        v_operation_status := 'duplicate';
      elsif (v_incoming_response ->> 'status') = 'claimed' then
        v_operation_status := 'claimed';
      end if;
    elsif (v_incoming_response ->> 'status') = 'delivered' then
      v_operation_status := 'conflict';
    end if;

    if v_operation_status in ('duplicate', 'conflict', 'claimed') then
      return jsonb_build_object(
        'turnId', v_locked_turn.id,
        'status', v_locked_turn.status,
        'eventSequence', v_locked_turn.recovery_event_sequence,
        'partialContent', v_locked_turn.recovery_partial_content,
        'terminalEvent', v_locked_turn.recovery_terminal_event,
        'controlState', v_locked_turn.recovery_control_state,
        'operationStatus', v_operation_status,
        'updatedAt', coalesce(
          v_locked_turn.recovery_partial_updated_at,
          v_locked_turn.updated_at,
          v_locked_turn.created_at
        )
      );
    end if;

    v_operation_status := case
      when (v_incoming_response ->> 'status') = 'claimed' then 'claimed'
      else 'appended'
    end;
  end if;
  if v_locked_turn.recovery_event_sequence = 9223372036854775807 then
    raise exception 'ai_chat_turn_recovery_sequence_exhausted';
  end if;

  v_event_sequence := v_locked_turn.recovery_event_sequence + 1;

  insert into public.ai_chat_turn_events (
    turn_id,
    event_sequence,
    organization_id,
    owner_user_id,
    conversation_id,
    event_name,
    payload,
    created_at
  ) values (
    v_locked_turn.id,
    v_event_sequence,
    v_locked_turn.organization_id,
    v_locked_turn.owner_user_id,
    v_locked_turn.conversation_id,
    p_event_name,
    p_payload,
    v_recorded_at
  );

  update public.ai_chat_turns
  set recovery_event_sequence = v_event_sequence,
      recovery_partial_content = coalesce(
        p_partial_content,
        recovery_partial_content
      ),
      recovery_partial_updated_at = case
        when p_partial_content is not null then v_recorded_at
        else recovery_partial_updated_at
      end,
      recovery_terminal_event = case
        when p_event_name = 'terminal' then p_terminal_event
        else recovery_terminal_event
      end,
      recovery_control_state = coalesce(
        p_control_state,
        recovery_control_state
      )
  where id = v_locked_turn.id
    and organization_id = v_locked_turn.organization_id
    and owner_user_id = v_locked_turn.owner_user_id
    and conversation_id = v_locked_turn.conversation_id
  returning * into v_result;

  return jsonb_build_object(
    'turnId', v_result.id,
    'status', v_result.status,
    'eventSequence', v_result.recovery_event_sequence,
    'partialContent', v_result.recovery_partial_content,
    'terminalEvent', v_result.recovery_terminal_event,
    'controlState', v_result.recovery_control_state,
    'operationStatus', v_operation_status,
    'updatedAt', v_recorded_at
  );
end
$$;

create or replace function public.get_ai_chat_turn_recovery_snapshot(
  p_organization_id uuid,
  p_owner_user_id uuid,
  p_conversation_id uuid,
  p_turn_id uuid
)
returns jsonb
language plpgsql
security definer
stable
set search_path = pg_catalog, public
as $$
declare
  v_snapshot jsonb;
begin
  select jsonb_build_object(
    'turnId', turn_record.id,
    'status', turn_record.status,
    'eventSequence', turn_record.recovery_event_sequence,
    'partialContent', turn_record.recovery_partial_content,
    'terminalEvent', turn_record.recovery_terminal_event,
    'controlState', turn_record.recovery_control_state,
    'updatedAt', coalesce(latest_event.created_at, turn_record.created_at)
  )
  into v_snapshot
  from public.ai_chat_turns turn_record
  left join public.ai_chat_turn_events latest_event
    on latest_event.turn_id = turn_record.id
   and latest_event.event_sequence = turn_record.recovery_event_sequence
  where turn_record.organization_id = p_organization_id
    and turn_record.owner_user_id = p_owner_user_id
    and turn_record.conversation_id = p_conversation_id
    and turn_record.id = p_turn_id;

  if not found then return null; end if;
  return v_snapshot;
end
$$;

revoke all on function public.append_ai_chat_turn_recovery_event(
  uuid, uuid, uuid, uuid, text, jsonb, text, jsonb, jsonb
) from public, anon, authenticated;
grant execute on function public.append_ai_chat_turn_recovery_event(
  uuid, uuid, uuid, uuid, text, jsonb, text, jsonb, jsonb
) to service_role;

revoke all on function public.get_ai_chat_turn_recovery_snapshot(
  uuid, uuid, uuid, uuid
) from public, anon, authenticated;
grant execute on function public.get_ai_chat_turn_recovery_snapshot(
  uuid, uuid, uuid, uuid
) to service_role;
