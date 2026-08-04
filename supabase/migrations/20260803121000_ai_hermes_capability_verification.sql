-- deploy: expand

create or replace function public.verify_ai_hermes_invocation_capability(
  p_token_sha256 text
)
returns table (
  organization_id uuid,
  owner_user_id uuid,
  conversation_id uuid,
  invocation_id uuid,
  actor_fingerprint text,
  expires_at timestamptz,
  revoked_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_capability public.ai_hermes_run_capabilities%rowtype;
  v_discovered_lineage_ids uuid[];
  v_discovered_invocation_ids uuid[];
  v_final_lineage_ids uuid[];
  v_final_invocation_ids uuid[];
  v_discovered_lineage_count integer;
  v_final_lineage_count integer;
  v_locked_invocation_count bigint;
  v_final_lineage_invalid boolean;
begin
  if lower(coalesce(p_token_sha256, '')) !~ '^[0-9a-f]{64}$' then
    raise exception 'capability_invalid';
  end if;

  select discovered_capability.*
  into v_capability
  from public.ai_hermes_run_capabilities discovered_capability
  where discovered_capability.token_sha256 = lower(p_token_sha256);

  if not found then
    raise exception 'capability_not_found';
  end if;
  if v_capability.depth < 0
     or v_capability.depth > 2
     or v_capability.actor_fingerprint !~ '^[0-9a-f]{64}$'
     or v_capability.skill_grants_hash is distinct from
       public.ai_hermes_canonical_uuid_array_sha256(v_capability.skill_draft_ids) then
    raise exception 'capability_invalid';
  end if;

  with recursive discovered_lineage as (
    select
      capability.id,
      capability.parent_capability_id,
      capability.invocation_id,
      0 as hop,
      array[capability.id]::uuid[] as path,
      false as cycle
    from public.ai_hermes_run_capabilities capability
    where capability.id = v_capability.id

    union all

    select
      parent_capability.id,
      parent_capability.parent_capability_id,
      parent_capability.invocation_id,
      lineage.hop + 1,
      lineage.path || parent_capability.id,
      parent_capability.id = any(lineage.path)
    from discovered_lineage lineage
    join public.ai_hermes_run_capabilities parent_capability
      on parent_capability.id = lineage.parent_capability_id
    where not lineage.cycle
      and lineage.hop < 3
  )
  select
    array_agg(distinct lineage.id order by lineage.id),
    array_agg(distinct lineage.invocation_id order by lineage.invocation_id),
    count(*),
    coalesce(bool_or(lineage.cycle), true)
  into
    v_discovered_lineage_ids,
    v_discovered_invocation_ids,
    v_discovered_lineage_count,
    v_final_lineage_invalid
  from discovered_lineage lineage;

  if v_discovered_lineage_ids is null
     or v_discovered_invocation_ids is null
     or v_discovered_lineage_count <> v_capability.depth + 1
     or pg_catalog.cardinality(v_discovered_invocation_ids) <> v_capability.depth + 1
     or v_final_lineage_invalid then
    raise exception 'capability_invalid';
  end if;

  -- Hermes lock order: conversation -> turn -> invocation lineage -> capability lineage.
  perform 1
  from public.ai_conversations locked_conversation
  where locked_conversation.id = v_capability.conversation_id
    and locked_conversation.organization_id = v_capability.organization_id
    and locked_conversation.owner_user_id = v_capability.owner_user_id
    and locked_conversation.status = 'active'
  for update;

  if not found then
    raise exception 'capability_invalid';
  end if;

  perform 1
  from public.ai_chat_turns locked_turn
  where locked_turn.id = v_capability.turn_id
    and locked_turn.organization_id = v_capability.organization_id
    and locked_turn.owner_user_id = v_capability.owner_user_id
    and locked_turn.conversation_id = v_capability.conversation_id
    and locked_turn.ai_invocation_id = v_capability.root_invocation_id
    and locked_turn.status in ('accepted', 'grounding', 'generating', 'validating')
    and locked_turn.lease_expires_at > clock_timestamp()
    and locked_turn.cancel_requested_at is null
  for update;

  if not found then
    raise exception 'capability_invalid';
  end if;

  perform locked_invocation.id
  from public.ai_invocations locked_invocation
  where locked_invocation.id = any(v_discovered_invocation_ids)
    and locked_invocation.organization_id = v_capability.organization_id
    and locked_invocation.actor_user_id = v_capability.owner_user_id
    and locked_invocation.status in ('started', 'queued')
  order by locked_invocation.id
  for update;
  get diagnostics v_locked_invocation_count = row_count;

  if v_locked_invocation_count <> v_capability.depth + 1 then
    raise exception 'capability_invalid';
  end if;

  begin
    perform public.lock_and_validate_ai_hermes_capability_lineage(
      v_capability.id,
      v_capability.organization_id,
      v_capability.owner_user_id,
      v_capability.conversation_id,
      v_capability.turn_id,
      v_capability.root_invocation_id,
      v_capability.actor_fingerprint,
      v_capability.depth
    );
  exception
    when raise_exception then
      raise exception 'capability_invalid';
  end;

  select locked_capability.*
  into v_capability
  from public.ai_hermes_run_capabilities locked_capability
  where locked_capability.id = v_capability.id
    and locked_capability.token_sha256 = lower(p_token_sha256)
    and locked_capability.organization_id = v_capability.organization_id
    and locked_capability.owner_user_id = v_capability.owner_user_id
    and locked_capability.conversation_id = v_capability.conversation_id
    and locked_capability.turn_id = v_capability.turn_id
    and locked_capability.root_invocation_id = v_capability.root_invocation_id
    and locked_capability.invocation_id = v_capability.invocation_id
    and locked_capability.revoked_at is null
    and locked_capability.expires_at > clock_timestamp()
  for update;

  if not found then
    raise exception 'capability_invalid';
  end if;

  with recursive final_lineage as (
    select
      lineage_capability.id,
      lineage_capability.parent_capability_id,
      lineage_capability.invocation_id,
      lineage_capability.revoked_at,
      lineage_capability.expires_at,
      lineage_capability.skill_grants_hash,
      lineage_capability.skill_draft_ids,
      0 as hop
    from public.ai_hermes_run_capabilities lineage_capability
    where lineage_capability.id = v_capability.id

    union all

    select
      parent_capability.id,
      parent_capability.parent_capability_id,
      parent_capability.invocation_id,
      parent_capability.revoked_at,
      parent_capability.expires_at,
      parent_capability.skill_grants_hash,
      parent_capability.skill_draft_ids,
      lineage.hop + 1
    from final_lineage lineage
    join public.ai_hermes_run_capabilities parent_capability
      on parent_capability.id = lineage.parent_capability_id
    where lineage.hop < 3
  )
  select
    array_agg(distinct lineage_capability.id order by lineage_capability.id),
    array_agg(
      distinct lineage_capability.invocation_id
      order by lineage_capability.invocation_id
    ),
    count(*),
    coalesce(bool_or(
      lineage_capability.revoked_at is not null
      or lineage_capability.expires_at <= clock_timestamp()
      or lineage_capability.skill_grants_hash is distinct from
        public.ai_hermes_canonical_uuid_array_sha256(
          lineage_capability.skill_draft_ids
        )
    ), true)
  into
    v_final_lineage_ids,
    v_final_invocation_ids,
    v_final_lineage_count,
    v_final_lineage_invalid
  from final_lineage lineage_capability;

  if v_final_lineage_ids is distinct from v_discovered_lineage_ids
     or v_final_invocation_ids is distinct from v_discovered_invocation_ids
     or v_final_lineage_count <> v_capability.depth + 1
     or v_final_lineage_invalid then
    raise exception 'capability_invalid';
  end if;

  if not exists (
    select 1
    from public.ai_chat_turns active_turn
    where active_turn.id = v_capability.turn_id
      and active_turn.organization_id = v_capability.organization_id
      and active_turn.owner_user_id = v_capability.owner_user_id
      and active_turn.conversation_id = v_capability.conversation_id
      and active_turn.ai_invocation_id = v_capability.root_invocation_id
      and active_turn.status in ('accepted', 'grounding', 'generating', 'validating')
      and active_turn.lease_expires_at > clock_timestamp()
      and active_turn.cancel_requested_at is null
  ) then
    raise exception 'capability_invalid';
  end if;

  return query
  select
    v_capability.organization_id,
    v_capability.owner_user_id,
    v_capability.conversation_id,
    v_capability.invocation_id,
    v_capability.actor_fingerprint,
    v_capability.expires_at,
    v_capability.revoked_at;
end;
$$;

revoke all on function public.verify_ai_hermes_invocation_capability(text) from public, anon, authenticated;
grant execute on function public.verify_ai_hermes_invocation_capability(text) to service_role;
