-- Initialize the root invocation ledger and issue its capability atomically.
-- Child capabilities continue to use issue_ai_hermes_run_capability directly.

create or replace function public.issue_ai_hermes_root_run_capability(
  p_token_sha256 text,
  p_organization_id uuid,
  p_owner_user_id uuid,
  p_actor_role public.app_role,
  p_conversation_id uuid,
  p_turn_id uuid,
  p_invocation_id uuid,
  p_parent_invocation_id uuid,
  p_parent_token_sha256 text,
  p_actor_fingerprint text,
  p_allowed_tools text[],
  p_allowed_tools_hash text,
  p_scopes text[],
  p_scope_hash text,
  p_skill_grants_hash text,
  p_skill_draft_ids uuid[],
  p_depth integer,
  p_ai_state_writes_allowed boolean,
  p_expires_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_invocation public.ai_invocations%rowtype;
  v_turn public.ai_chat_turns%rowtype;
begin
  if p_depth is distinct from 0
     or p_parent_invocation_id is not null
     or p_parent_token_sha256 is not null then
    raise exception 'root_invocation_delegation_invalid';
  end if;

  perform 1
  from public.ai_conversations conversation
  where conversation.id = p_conversation_id
    and conversation.organization_id = p_organization_id
    and conversation.owner_user_id = p_owner_user_id
    and conversation.status = 'active'
  for update;

  if not found then
    raise exception 'capability_context_invalid';
  end if;

  perform 1
  from public.organization_members member
  where member.organization_id = p_organization_id
    and member.user_id = p_owner_user_id
    and member.status = 'active'
    and member.role = p_actor_role
  for share;

  if not found then
    raise exception 'root_invocation_actor_invalid';
  end if;

  select turn.*
  into v_turn
  from public.ai_chat_turns turn
  where turn.id = p_turn_id
    and turn.organization_id = p_organization_id
    and turn.owner_user_id = p_owner_user_id
    and turn.conversation_id = p_conversation_id
    and turn.status in ('accepted', 'grounding', 'generating', 'validating')
    and turn.lease_expires_at > now()
    and turn.cancel_requested_at is null
  for update;

  if not found then
    raise exception 'capability_context_invalid';
  end if;

  insert into public.ai_invocations (
    id,
    organization_id,
    actor_user_id,
    actor_role,
    scene,
    object_type,
    object_id,
    provider_name,
    primary_provider,
    status,
    metadata
  )
  values (
    p_invocation_id,
    p_organization_id,
    p_owner_user_id,
    p_actor_role,
    'dashboard_ai_chat',
    'ai_chat_turn',
    p_turn_id::text,
    'hermes',
    'hermes',
    'started',
    jsonb_build_object(
      'hermesActorFingerprint', lower(p_actor_fingerprint),
      'hermesDepth', 0,
      'hermesMode', v_turn.mode,
      'hermesRootInvocationId', p_invocation_id
    )
  )
  on conflict (id) do nothing;

  select invocation.*
  into v_invocation
  from public.ai_invocations invocation
  where invocation.id = p_invocation_id
  for update;

  if not found
     or v_invocation.organization_id is distinct from p_organization_id
     or v_invocation.actor_user_id is distinct from p_owner_user_id
     or v_invocation.actor_role is distinct from p_actor_role
     or v_invocation.scene is distinct from 'dashboard_ai_chat'
     or v_invocation.object_type is distinct from 'ai_chat_turn'
     or v_invocation.object_id is distinct from p_turn_id::text
     or v_invocation.provider_name is distinct from 'hermes'
     or v_invocation.primary_provider is distinct from 'hermes'
     or v_invocation.status not in ('started', 'queued')
     or v_invocation.metadata ->> 'hermesMode'
        is distinct from v_turn.mode
     or v_invocation.metadata ->> 'hermesRootInvocationId'
        is distinct from p_invocation_id::text then
    raise exception 'root_invocation_identity_conflict';
  end if;

  return public.issue_ai_hermes_run_capability(
    p_token_sha256,
    p_organization_id,
    p_owner_user_id,
    p_conversation_id,
    p_turn_id,
    p_invocation_id,
    p_parent_invocation_id,
    p_parent_token_sha256,
    p_actor_fingerprint,
    p_allowed_tools,
    p_allowed_tools_hash,
    p_scopes,
    p_scope_hash,
    p_skill_grants_hash,
    p_skill_draft_ids,
    p_depth,
    p_ai_state_writes_allowed,
    p_expires_at
  );
end;
$$;

create or replace function public.complete_ai_invocation_for_terminal_chat_turn()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_invocation_status text;
begin
  if new.ai_invocation_id is null
     or new.status not in ('completed', 'failed', 'cancelled') then
    return new;
  end if;

  v_invocation_status := case new.status
    when 'completed' then
      case
        when new.outcome = 'complete' then 'succeeded'
        else 'degraded'
      end
    when 'failed' then 'failed'
    when 'cancelled' then 'failed'
  end;

  update public.ai_invocations invocation
  set status = v_invocation_status,
      degraded_reason = case
        when v_invocation_status = 'degraded'
          then coalesce(new.outcome, 'partial')
        when new.status = 'cancelled'
          then 'cancelled'
        else invocation.degraded_reason
      end,
      error_summary = case
        when v_invocation_status = 'failed'
          then new.error_summary
        else invocation.error_summary
      end,
      completed_at = coalesce(
        invocation.completed_at,
        new.completed_at,
        now()
      )
  where invocation.id = new.ai_invocation_id
    and invocation.organization_id = new.organization_id
    and invocation.actor_user_id = new.owner_user_id
    and invocation.status in ('started', 'queued');

  return new;
end;
$$;

drop trigger if exists ai_chat_turns_complete_linked_invocation
on public.ai_chat_turns;

create trigger ai_chat_turns_complete_linked_invocation
after update of status, outcome, ai_invocation_id on public.ai_chat_turns
for each row
when (new.status in ('completed', 'failed', 'cancelled'))
execute function public.complete_ai_invocation_for_terminal_chat_turn();

revoke all on function public.issue_ai_hermes_root_run_capability(
  text,
  uuid,
  uuid,
  public.app_role,
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  text,
  text[],
  text,
  text[],
  text,
  text,
  uuid[],
  integer,
  boolean,
  timestamptz
) from public, anon, authenticated;

revoke all on function public.complete_ai_invocation_for_terminal_chat_turn()
from public, anon, authenticated;

grant execute on function public.issue_ai_hermes_root_run_capability(
  text,
  uuid,
  uuid,
  public.app_role,
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  text,
  text[],
  text,
  text[],
  text,
  text,
  uuid[],
  integer,
  boolean,
  timestamptz
) to service_role;
