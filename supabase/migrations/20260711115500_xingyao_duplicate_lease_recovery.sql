-- Reconcile expired active turns before resolving idempotent duplicate requests.
-- The lease duration remains owned by the original conversation protocol trigger.

create or replace function public.create_ai_chat_turn(
  p_organization_id uuid,
  p_owner_user_id uuid,
  p_conversation_id uuid,
  p_idempotency_key text,
  p_mode text,
  p_kind text,
  p_content text,
  p_source_turn_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_conversation public.ai_conversations%rowtype;
  v_existing public.ai_chat_turns%rowtype;
  v_source public.ai_chat_turns%rowtype;
  v_turn public.ai_chat_turns%rowtype;
  v_user_message_id uuid;
  v_assistant_message_id uuid;
  v_next_sequence bigint;
  v_attempt integer := 1;
  v_context_snapshot jsonb := '{}'::jsonb;
  v_context_hash text;
  v_snapshot_version integer := 1;
  v_stale_message_ids uuid[] := '{}'::uuid[];
begin
  if p_kind not in ('user', 'retry', 'regenerate') then
    raise exception 'invalid_turn_kind';
  end if;
  if p_mode not in ('fast', 'deep') then
    raise exception 'invalid_turn_mode';
  end if;
  if nullif(trim(coalesce(p_idempotency_key, '')), '') is null then
    raise exception 'idempotency_key_required';
  end if;

  select * into v_conversation
  from public.ai_conversations
  where id = p_conversation_id
    and organization_id = p_organization_id
    and owner_user_id = p_owner_user_id
    and status = 'active'
  for update;

  if not found then
    raise exception 'conversation_not_found';
  end if;

  with expired_turns as (
    update public.ai_chat_turns
    set status = 'failed',
        error_code = 'turn_lease_expired',
        error_summary = 'The previous AI turn expired before completion',
        retryable = true,
        completed_at = now()
    where conversation_id = p_conversation_id
      and status in ('accepted', 'grounding', 'generating', 'validating')
      and lease_expires_at <= now()
    returning assistant_message_id
  )
  select coalesce(array_agg(assistant_message_id), '{}'::uuid[])
  into v_stale_message_ids
  from expired_turns;

  update public.ai_chat_messages
  set status = 'failed',
      metadata = metadata || jsonb_build_object(
        'errorCode', 'turn_lease_expired',
        'retryable', true
      )
  where id = any(v_stale_message_ids);

  select * into v_existing
  from public.ai_chat_turns
  where organization_id = p_organization_id
    and owner_user_id = p_owner_user_id
    and idempotency_key = p_idempotency_key;

  if found then
    if v_existing.conversation_id <> p_conversation_id then
      raise exception 'idempotency_key_collision';
    end if;
    return jsonb_build_object(
      'conversation_id', v_existing.conversation_id,
      'turn_id', v_existing.id,
      'user_message_id', v_existing.user_message_id,
      'assistant_message_id', v_existing.assistant_message_id,
      'status', v_existing.status,
      'attempt_no', v_existing.attempt_no,
      'duplicate', true
    );
  end if;

  if p_kind <> 'user' then
    if p_source_turn_id is null then
      raise exception 'source_turn_required';
    end if;

    select * into v_source
    from public.ai_chat_turns
    where id = p_source_turn_id
      and organization_id = p_organization_id
      and owner_user_id = p_owner_user_id
      and conversation_id = p_conversation_id;

    if not found then
      raise exception 'source_turn_not_found';
    end if;
    if p_kind = 'retry' and v_source.status <> 'failed' then
      raise exception 'source_turn_not_retryable';
    end if;
    if p_kind = 'regenerate' and v_source.status <> 'completed' then
      raise exception 'source_turn_not_regeneratable';
    end if;

    select * into v_existing
    from public.ai_chat_turns successor
    where (p_kind = 'retry' and successor.retry_of_turn_id = p_source_turn_id)
       or (p_kind = 'regenerate' and successor.regenerate_of_turn_id = p_source_turn_id)
    order by successor.created_at desc
    limit 1;

    if found then
      return jsonb_build_object(
        'conversation_id', v_existing.conversation_id,
        'turn_id', v_existing.id,
        'user_message_id', v_existing.user_message_id,
        'assistant_message_id', v_existing.assistant_message_id,
        'status', v_existing.status,
        'attempt_no', v_existing.attempt_no,
        'duplicate', true,
        'conflict', 'source_turn_already_replaced'
      );
    end if;
  end if;

  if exists (
    select 1
    from public.ai_chat_turns active_turn
    where active_turn.conversation_id = p_conversation_id
      and active_turn.status in ('accepted', 'grounding', 'generating', 'validating')
  ) then
    raise exception 'conversation_turn_active';
  end if;

  select coalesce(max(sequence_no), 0) + 1
  into v_next_sequence
  from public.ai_chat_messages
  where conversation_id = p_conversation_id;

  if p_kind = 'user' then
    if nullif(trim(coalesce(p_content, '')), '') is null then
      raise exception 'user_message_required';
    end if;

    insert into public.ai_chat_messages (
      organization_id,
      owner_user_id,
      conversation_id,
      sequence_no,
      role,
      status,
      content
    ) values (
      p_organization_id,
      p_owner_user_id,
      p_conversation_id,
      v_next_sequence,
      'user',
      'completed',
      trim(p_content)
    ) returning id into v_user_message_id;

    v_next_sequence := v_next_sequence + 1;
  else
    v_user_message_id := v_source.user_message_id;
    v_attempt := v_source.attempt_no + 1;
    v_context_snapshot := v_source.context_snapshot;
    v_context_hash := v_source.context_hash;
    v_snapshot_version := v_source.snapshot_version;

    if p_kind = 'retry' then
      update public.ai_chat_messages
      set status = 'superseded'
      where id = v_source.assistant_message_id
        and status = 'failed';
    end if;
  end if;

  insert into public.ai_chat_messages (
    organization_id,
    owner_user_id,
    conversation_id,
    sequence_no,
    role,
    status,
    content,
    parent_message_id
  ) values (
    p_organization_id,
    p_owner_user_id,
    p_conversation_id,
    v_next_sequence,
    'assistant',
    'pending',
    '',
    v_user_message_id
  ) returning id into v_assistant_message_id;

  insert into public.ai_chat_turns (
    organization_id,
    owner_user_id,
    conversation_id,
    user_message_id,
    assistant_message_id,
    mode,
    status,
    idempotency_key,
    retry_of_turn_id,
    regenerate_of_turn_id,
    context_snapshot,
    context_hash,
    snapshot_version,
    attempt_no
  ) values (
    p_organization_id,
    p_owner_user_id,
    p_conversation_id,
    v_user_message_id,
    v_assistant_message_id,
    p_mode,
    'accepted',
    p_idempotency_key,
    case when p_kind = 'retry' then p_source_turn_id else null end,
    case when p_kind = 'regenerate' then p_source_turn_id else null end,
    v_context_snapshot,
    v_context_hash,
    v_snapshot_version,
    v_attempt
  ) returning * into v_turn;

  update public.ai_conversations
  set last_message_at = now()
  where id = p_conversation_id;

  return jsonb_build_object(
    'conversation_id', v_turn.conversation_id,
    'turn_id', v_turn.id,
    'user_message_id', v_turn.user_message_id,
    'assistant_message_id', v_turn.assistant_message_id,
    'status', v_turn.status,
    'attempt_no', v_turn.attempt_no,
    'duplicate', false
  );
end;
$$;

revoke all on function public.create_ai_chat_turn(
  uuid, uuid, uuid, text, text, text, text, uuid
) from public, anon, authenticated;

grant execute on function public.create_ai_chat_turn(
  uuid, uuid, uuid, text, text, text, text, uuid
) to service_role;
