-- deploy: expand

alter table public.ai_conversations
  add column if not exists memory_status text not null default 'ready',
  add column if not exists memory_degraded_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint constraint_record
    where constraint_record.conrelid = 'public.ai_conversations'::regclass
      and constraint_record.conname = 'ai_conversations_memory_status_check'
  ) then
    alter table public.ai_conversations
      add constraint ai_conversations_memory_status_check
      check (memory_status in ('ready', 'degraded'));
  end if;
end;
$$;

alter table public.ai_conversations
  alter column summary set default '{
    "schemaVersion": 1,
    "goals": [],
    "confirmedFacts": [],
    "decisions": [],
    "unresolvedQuestions": [],
    "lastCompactedSequence": 0
  }'::jsonb;

update public.ai_conversations
set summary = '{
      "schemaVersion": 1,
      "goals": [],
      "confirmedFacts": [],
      "decisions": [],
      "unresolvedQuestions": [],
      "lastCompactedSequence": 0
    }'::jsonb
where summary = '{}'::jsonb;

update public.ai_conversations
set memory_status = 'degraded',
    memory_degraded_at = coalesce(memory_degraded_at, now())
where summary ->> 'schemaVersion' is distinct from '1';

create table if not exists public.ai_conversation_memory_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid not null references public.ai_conversations(id) on delete cascade,
  turn_id uuid not null references public.ai_chat_turns(id) on delete cascade,
  target_summary_version integer not null check (target_summary_version >= 0),
  memory_delta jsonb,
  status text not null default 'pending'
    check (status in ('pending', 'completed')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create unique index if not exists ai_conversation_memory_jobs_pending_unique
on public.ai_conversation_memory_jobs (conversation_id, target_summary_version)
where status = 'pending';

create index if not exists ai_conversation_memory_jobs_pending_scan
on public.ai_conversation_memory_jobs (created_at, conversation_id)
where status = 'pending';

alter table public.ai_conversation_memory_jobs enable row level security;
revoke all on table public.ai_conversation_memory_jobs from anon, authenticated;
grant all on table public.ai_conversation_memory_jobs to service_role;

create or replace function public.finish_ai_chat_turn_v3(
  p_organization_id uuid,
  p_owner_user_id uuid,
  p_turn_id uuid,
  p_outcome text,
  p_content text,
  p_provider_name text,
  p_ai_invocation_id uuid,
  p_error_code text,
  p_error_summary text,
  p_retryable boolean,
  p_metadata jsonb,
  p_expected_summary_version integer,
  p_memory_delta jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_terminal_completed boolean;
  v_conversation_id uuid;
  v_memory_error text;
  v_section text;
  v_item jsonb;
  v_source_value jsonb;
  v_source_id uuid;
  v_source_ids uuid[] := '{}'::uuid[];
  v_item_source_ids uuid[];
  v_delta_keys text[];
  v_item_keys text[];
  v_through_sequence integer;
  v_previous_sequence integer;
  v_max_completed_sequence integer;
  v_matching_sources integer;
  v_next_summary jsonb;
  v_summary_version integer;
begin
  if p_expected_summary_version is null or p_expected_summary_version < 0 then
    return jsonb_build_object('completed', false);
  end if;

  v_terminal_completed := public.finish_ai_chat_turn_v2(
    p_organization_id,
    p_owner_user_id,
    p_turn_id,
    p_outcome,
    p_content,
    p_provider_name,
    p_ai_invocation_id,
    p_error_code,
    p_error_summary,
    p_retryable,
    p_metadata
  );

  if not v_terminal_completed then
    return jsonb_build_object('completed', false);
  end if;

  select turn.conversation_id
  into v_conversation_id
  from public.ai_chat_turns turn
  where turn.id = p_turn_id
    and turn.organization_id = p_organization_id
    and turn.owner_user_id = p_owner_user_id;

  if not found then
    return jsonb_build_object('completed', false);
  end if;

  begin
    if p_memory_delta is null then
      raise exception 'memory_delta_missing';
    end if;
    if jsonb_typeof(p_memory_delta) <> 'object' then
      raise exception 'memory_delta_invalid';
    end if;

    select array_agg(delta_key order by delta_key)
    into v_delta_keys
    from jsonb_object_keys(p_memory_delta) delta_key;
    if v_delta_keys is distinct from array[
      'confirmedFacts',
      'decisions',
      'goals',
      'throughSequence',
      'unresolvedQuestions'
    ]::text[] then
      raise exception 'memory_delta_invalid';
    end if;

    if jsonb_typeof(p_memory_delta -> 'throughSequence') <> 'number'
       or (p_memory_delta ->> 'throughSequence') !~ '^(0|[1-9][0-9]*)$'
       or (p_memory_delta ->> 'throughSequence')::numeric > 2147483647 then
      raise exception 'memory_delta_invalid';
    end if;
    v_through_sequence := (p_memory_delta ->> 'throughSequence')::integer;

    foreach v_section in array array[
      'goals',
      'confirmedFacts',
      'decisions',
      'unresolvedQuestions'
    ]::text[] loop
      if jsonb_typeof(p_memory_delta -> v_section) <> 'array'
         or jsonb_array_length(p_memory_delta -> v_section) > 24 then
        raise exception 'memory_delta_invalid';
      end if;

      for v_item in
        select item.value
        from jsonb_array_elements(p_memory_delta -> v_section) item(value)
      loop
        if jsonb_typeof(v_item) <> 'object' then
          raise exception 'memory_delta_invalid';
        end if;
        select array_agg(item_key order by item_key)
        into v_item_keys
        from jsonb_object_keys(v_item) item_key;
        if v_item_keys is distinct from array['sourceMessageIds', 'text']::text[] then
          raise exception 'memory_delta_invalid';
        end if;
        if jsonb_typeof(v_item -> 'text') <> 'string'
           or length(trim(v_item ->> 'text')) = 0
           or length(trim(v_item ->> 'text')) > 512
           or (v_item ->> 'text') ~ E'[\r\n]'
           or (v_item ->> 'text') ~* '^(user|assistant|system|tool)[[:space:]]*:'
           or (v_item ->> 'text') ~* '<(/)?(conversation_context|current_request|recent_messages|summary)>' then
          raise exception 'memory_delta_invalid';
        end if;
        if jsonb_typeof(v_item -> 'sourceMessageIds') <> 'array'
           or jsonb_array_length(v_item -> 'sourceMessageIds') = 0
           or jsonb_array_length(v_item -> 'sourceMessageIds') > 8 then
          raise exception 'memory_delta_invalid';
        end if;

        v_item_source_ids := '{}'::uuid[];
        for v_source_value in
          select source.value
          from jsonb_array_elements(v_item -> 'sourceMessageIds') source(value)
        loop
          if jsonb_typeof(v_source_value) <> 'string'
             or trim(both '"' from v_source_value::text)
                !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
            raise exception 'memory_delta_invalid';
          end if;
          v_source_id := trim(both '"' from v_source_value::text)::uuid;
          if v_source_id = any(v_item_source_ids) then
            raise exception 'memory_delta_invalid';
          end if;
          v_item_source_ids := array_append(v_item_source_ids, v_source_id);
          if not v_source_id = any(v_source_ids) then
            v_source_ids := array_append(v_source_ids, v_source_id);
          end if;
        end loop;
      end loop;
    end loop;

    select coalesce(
      case
        when jsonb_typeof(conversation.summary -> 'lastCompactedSequence') = 'number'
          and (conversation.summary ->> 'lastCompactedSequence') ~ '^(0|[1-9][0-9]*)$'
        then (conversation.summary ->> 'lastCompactedSequence')::integer
      end,
      0
    )
    into v_previous_sequence
    from public.ai_conversations conversation
    where conversation.id = v_conversation_id
      and conversation.organization_id = p_organization_id
      and conversation.owner_user_id = p_owner_user_id
    for update;

    if not found or v_through_sequence < v_previous_sequence then
      raise exception 'memory_sequence_conflict';
    end if;

    select coalesce(max(source_message.sequence_no), 0)
    into v_max_completed_sequence
    from public.ai_chat_messages source_message
    where source_message.conversation_id = v_conversation_id
      and source_message.organization_id = p_organization_id
      and source_message.owner_user_id = p_owner_user_id
      and source_message.status = 'completed';
    if v_through_sequence > v_max_completed_sequence then
      raise exception 'memory_sequence_conflict';
    end if;

    select count(distinct source_message.id)
    into v_matching_sources
    from public.ai_chat_messages source_message
    where source_message.id = any(v_source_ids)
      and source_message.conversation_id = v_conversation_id
      and source_message.organization_id = p_organization_id
      and source_message.owner_user_id = p_owner_user_id
      and source_message.status = 'completed'
      and source_message.sequence_no <= v_through_sequence;
    if v_matching_sources <> cardinality(v_source_ids) then
      raise exception 'memory_source_invalid';
    end if;

    v_next_summary := jsonb_build_object(
      'schemaVersion', 1,
      'goals', p_memory_delta -> 'goals',
      'confirmedFacts', p_memory_delta -> 'confirmedFacts',
      'decisions', p_memory_delta -> 'decisions',
      'unresolvedQuestions', p_memory_delta -> 'unresolvedQuestions',
      'lastCompactedSequence', v_through_sequence
    );

    select conversation.summary_version
    into v_summary_version
    from public.ai_conversations conversation
    where conversation.id = v_conversation_id
      and conversation.organization_id = p_organization_id
      and conversation.owner_user_id = p_owner_user_id;
    if v_summary_version = p_expected_summary_version + 1
       and exists (
         select 1
         from public.ai_conversations conversation
         where conversation.id = v_conversation_id
           and conversation.summary = v_next_summary
       ) then
      update public.ai_conversations
      set memory_status = 'ready',
          memory_degraded_at = null
      where id = v_conversation_id;
    else
      update public.ai_conversations
      set summary = v_next_summary,
          summary_version = summary_version + 1,
          memory_status = 'ready',
          memory_degraded_at = null
      where id = v_conversation_id
        and organization_id = p_organization_id
        and owner_user_id = p_owner_user_id
        and summary_version = p_expected_summary_version
      returning summary_version into v_summary_version;
      if not found then
        raise exception 'memory_summary_conflict';
      end if;
    end if;
  exception when others then
    v_memory_error := sqlstate || ':' || sqlerrm;
  end;

  if v_memory_error is not null then
    begin
      update public.ai_conversations
      set memory_status = 'degraded',
          memory_degraded_at = coalesce(memory_degraded_at, now())
      where id = v_conversation_id
        and organization_id = p_organization_id
        and owner_user_id = p_owner_user_id;
    exception when others then
      null;
    end;

    begin
      insert into public.ai_conversation_memory_jobs (
        organization_id,
        owner_user_id,
        conversation_id,
        turn_id,
        target_summary_version,
        memory_delta,
        status,
        last_error,
        updated_at
      ) values (
        p_organization_id,
        p_owner_user_id,
        v_conversation_id,
        p_turn_id,
        p_expected_summary_version + 1,
        p_memory_delta,
        'pending',
        left(v_memory_error, 1000),
        now()
      )
      on conflict (conversation_id, target_summary_version)
        where status = 'pending'
      do update set
        memory_delta = excluded.memory_delta,
        last_error = excluded.last_error,
        updated_at = excluded.updated_at;
    exception when others then
      null;
    end;
  end if;

  select conversation.summary_version
  into v_summary_version
  from public.ai_conversations conversation
  where conversation.id = v_conversation_id;

  return jsonb_build_object(
    'completed', true,
    'memory_status', case when v_memory_error is null then 'ready' else 'degraded' end,
    'summary_version', coalesce(v_summary_version, p_expected_summary_version)
  );
end;
$$;

revoke all on function public.finish_ai_chat_turn_v3(
  uuid, uuid, uuid, text, text, text, uuid, text, text, boolean, jsonb, integer, jsonb
) from public, anon, authenticated;

grant execute on function public.finish_ai_chat_turn_v3(
  uuid, uuid, uuid, text, text, text, uuid, text, text, boolean, jsonb, integer, jsonb
) to service_role;
