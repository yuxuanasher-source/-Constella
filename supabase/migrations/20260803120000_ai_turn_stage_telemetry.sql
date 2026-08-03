alter table public.ai_chat_turns
  add column if not exists accepted_at timestamptz,
  add column if not exists context_ready_at timestamptz,
  add column if not exists session_ready_at timestamptz,
  add column if not exists agent_ready_at timestamptz,
  add column if not exists first_delta_at timestamptz,
  add column if not exists terminal_at timestamptz,
  add column if not exists persisted_at timestamptz,
  add column if not exists session_action text;

update public.ai_chat_turns
set accepted_at = created_at
where accepted_at is null;

alter table public.ai_chat_turns
  alter column accepted_at set default now(),
  add constraint ai_chat_turns_session_action_check check (
    session_action is null or session_action in ('resumed', 'rebuilt')
  );

create or replace function public.record_ai_chat_turn_stage(
  p_organization_id uuid,
  p_owner_user_id uuid,
  p_conversation_id uuid,
  p_turn_id uuid,
  p_stage text,
  p_observed_at timestamptz,
  p_session_action text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_turn public.ai_chat_turns%rowtype;
  v_existing timestamptz;
  v_candidate timestamptz;
  v_previous timestamptz;
  v_next timestamptz;
  v_recorded_at timestamptz;
  v_recorded_session_action text;
begin
  if p_observed_at is null then
    raise exception 'ai_chat_turn_stage_observed_at_required';
  end if;
  if p_observed_at > statement_timestamp() + interval '5 minutes' then
    raise exception 'ai_chat_turn_stage_observed_at_in_future';
  end if;
  if p_stage not in (
    'accepted',
    'context_ready',
    'session_ready',
    'agent_ready',
    'first_delta',
    'terminal',
    'persisted'
  ) then
    raise exception 'ai_chat_turn_stage_invalid';
  end if;
  if p_session_action is not null and p_stage <> 'session_ready' then
    raise exception 'ai_chat_turn_session_action_stage_invalid';
  end if;
  if p_session_action is not null
     and p_session_action not in ('resumed', 'rebuilt') then
    raise exception 'ai_chat_turn_session_action_invalid';
  end if;

  select locked_turn.*
  into v_turn
  from public.ai_chat_turns locked_turn
  where locked_turn.organization_id = p_organization_id
    and locked_turn.owner_user_id = p_owner_user_id
    and locked_turn.conversation_id = p_conversation_id
    and locked_turn.id = p_turn_id
  for update;

  if not found then
    raise exception 'ai_chat_turn_stage_identity_mismatch';
  end if;
  if p_stage in ('terminal', 'persisted') and v_turn.accepted_at is null then
    raise exception 'ai_chat_turn_stage_accepted_required';
  end if;

  v_existing := case p_stage
    when 'accepted' then v_turn.accepted_at
    when 'context_ready' then v_turn.context_ready_at
    when 'session_ready' then v_turn.session_ready_at
    when 'agent_ready' then v_turn.agent_ready_at
    when 'first_delta' then v_turn.first_delta_at
    when 'terminal' then v_turn.terminal_at
    when 'persisted' then v_turn.persisted_at
  end;
  v_candidate := coalesce(v_existing, p_observed_at);

  v_previous := case p_stage
    when 'context_ready' then v_turn.accepted_at
    when 'session_ready' then greatest(v_turn.accepted_at, v_turn.context_ready_at)
    when 'agent_ready' then greatest(
      v_turn.accepted_at,
      v_turn.context_ready_at,
      v_turn.session_ready_at
    )
    when 'first_delta' then greatest(
      v_turn.accepted_at,
      v_turn.context_ready_at,
      v_turn.session_ready_at,
      v_turn.agent_ready_at
    )
    when 'terminal' then greatest(
      v_turn.accepted_at,
      v_turn.context_ready_at,
      v_turn.session_ready_at,
      v_turn.agent_ready_at,
      v_turn.first_delta_at
    )
    when 'persisted' then greatest(
      v_turn.accepted_at,
      v_turn.context_ready_at,
      v_turn.session_ready_at,
      v_turn.agent_ready_at,
      v_turn.first_delta_at,
      v_turn.terminal_at
    )
  end;
  v_next := case p_stage
    when 'accepted' then least(
      v_turn.context_ready_at,
      v_turn.session_ready_at,
      v_turn.agent_ready_at,
      v_turn.first_delta_at,
      v_turn.terminal_at,
      v_turn.persisted_at
    )
    when 'context_ready' then least(
      v_turn.session_ready_at,
      v_turn.agent_ready_at,
      v_turn.first_delta_at,
      v_turn.terminal_at,
      v_turn.persisted_at
    )
    when 'session_ready' then least(
      v_turn.agent_ready_at,
      v_turn.first_delta_at,
      v_turn.terminal_at,
      v_turn.persisted_at
    )
    when 'agent_ready' then least(
      v_turn.first_delta_at,
      v_turn.terminal_at,
      v_turn.persisted_at
    )
    when 'first_delta' then least(v_turn.terminal_at, v_turn.persisted_at)
    when 'terminal' then v_turn.persisted_at
  end;

  -- Permit five seconds of clock skew while rejecting materially inverted stages.
  if v_previous is not null
     and v_candidate < v_previous - interval '5 seconds' then
    raise exception 'ai_chat_turn_stage_before_previous';
  end if;
  if v_next is not null
     and v_candidate > v_next + interval '5 seconds' then
    raise exception 'ai_chat_turn_stage_after_next';
  end if;

  update public.ai_chat_turns
  set accepted_at = case
        when p_stage = 'accepted' then coalesce(accepted_at, p_observed_at)
        else accepted_at
      end,
      context_ready_at = case
        when p_stage = 'context_ready' then coalesce(context_ready_at, p_observed_at)
        else context_ready_at
      end,
      session_ready_at = case
        when p_stage = 'session_ready' then coalesce(session_ready_at, p_observed_at)
        else session_ready_at
      end,
      agent_ready_at = case
        when p_stage = 'agent_ready' then coalesce(agent_ready_at, p_observed_at)
        else agent_ready_at
      end,
      first_delta_at = case
        when p_stage = 'first_delta' then coalesce(first_delta_at, p_observed_at)
        else first_delta_at
      end,
      terminal_at = case
        when p_stage = 'terminal' then coalesce(terminal_at, p_observed_at)
        else terminal_at
      end,
      persisted_at = case
        when p_stage = 'persisted' then coalesce(persisted_at, p_observed_at)
        else persisted_at
      end,
      session_action = case
        when p_stage = 'session_ready' then coalesce(session_action, p_session_action)
        else session_action
      end
  where id = v_turn.id
  returning case p_stage
      when 'accepted' then accepted_at
      when 'context_ready' then context_ready_at
      when 'session_ready' then session_ready_at
      when 'agent_ready' then agent_ready_at
      when 'first_delta' then first_delta_at
      when 'terminal' then terminal_at
      when 'persisted' then persisted_at
    end,
    session_action
  into v_recorded_at, v_recorded_session_action;

  return jsonb_build_object(
    'turnId', v_turn.id,
    'stage', p_stage,
    'observedAt', v_recorded_at
  ) || case
    when p_stage = 'session_ready' and v_recorded_session_action is not null
      then jsonb_build_object('sessionAction', v_recorded_session_action)
    else '{}'::jsonb
  end;
end
$$;

revoke execute on function public.record_ai_chat_turn_stage(uuid, uuid, uuid, uuid, text, timestamptz, text) from public;
revoke execute on function public.record_ai_chat_turn_stage(uuid, uuid, uuid, uuid, text, timestamptz, text) from anon;
revoke execute on function public.record_ai_chat_turn_stage(uuid, uuid, uuid, uuid, text, timestamptz, text) from authenticated;
grant execute on function public.record_ai_chat_turn_stage(uuid, uuid, uuid, uuid, text, timestamptz, text) to service_role;
