-- Product-owned Hermes state, invocation capabilities, and durable tool audit.
-- Raw capabilities and unsanitized provider/tool payloads must never be stored.

alter table public.ai_chat_turns
  add column if not exists outcome text,
  add column if not exists cancel_requested_at timestamptz;

alter table public.ai_chat_turns
  add constraint ai_chat_turns_outcome_check check (
    outcome is null or outcome in (
      'complete',
      'partial',
      'blocked',
      'failed',
      'cancelled'
    )
  ) not valid,
  add constraint ai_chat_turns_outcome_status_check check (
    outcome is null
    or (outcome in ('complete', 'partial', 'blocked') and status = 'completed')
    or (outcome = 'failed' and status = 'failed')
    or (outcome = 'cancelled' and status = 'cancelled')
  ) not valid;

-- Validation is intentionally deferred to a later migration so this rollout
-- does not scan and lock the existing turn ledger in the same transaction.

create or replace function public.refresh_ai_chat_turn_lease()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.status in ('accepted', 'grounding', 'generating', 'validating') then
    new.lease_expires_at := now() + case new.mode
      when 'fast' then interval '2 minutes'
      when 'deep' then interval '6 minutes'
    end;
  else
    new.lease_expires_at := null;
  end if;
  return new;
end;
$$;

-- Capability list hashes use the UTF-8 text representation of a JSONB array
-- sorted with the C collation. Issuance rejects nulls, blanks, and duplicates.
create or replace function public.ai_hermes_canonical_text_array_sha256(
  p_values text[]
)
returns text
language sql
immutable
strict
security definer
set search_path = pg_catalog, public
as $$
  select pg_catalog.encode(
    extensions.digest(
      coalesce(
        jsonb_agg(value order by value collate "C"),
        '[]'::jsonb
      )::text,
      'sha256'
    ),
    'hex'
  )
  from pg_catalog.unnest(p_values) as values_to_hash(value);
$$;

create or replace function public.ai_hermes_canonical_uuid_array_sha256(
  p_values uuid[]
)
returns text
language sql
immutable
strict
security definer
set search_path = pg_catalog, public
as $$
  select pg_catalog.encode(
    extensions.digest(
      coalesce(
        jsonb_agg(value::text order by value::text collate "C"),
        '[]'::jsonb
      )::text,
      'sha256'
    ),
    'hex'
  )
  from pg_catalog.unnest(p_values) as values_to_hash(value);
$$;

create table public.ai_hermes_memories (
  id uuid primary key default extensions.gen_random_uuid(),
  memory_key uuid not null default extensions.gen_random_uuid(),
  requested_memory_key uuid,
  requested_expected_revision integer not null,
  idempotency_key text not null,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  owner_user_id uuid not null references public.profiles(id) on delete cascade,
  memory_type text not null,
  content text not null,
  content_hash text not null,
  revision integer not null,
  active boolean not null default true,
  source_conversation_id uuid not null,
  source_message_id uuid not null,
  source_invocation_id uuid not null references public.ai_invocations(id),
  deactivated_at timestamptz,
  deactivated_by_invocation_id uuid references public.ai_invocations(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ai_hermes_memories_conversation_owner_fkey
    foreign key (source_conversation_id, organization_id, owner_user_id)
    references public.ai_conversations(id, organization_id, owner_user_id)
    on delete cascade,
  constraint ai_hermes_memories_source_message_fkey
    foreign key (
      source_message_id,
      source_conversation_id,
      organization_id,
      owner_user_id
    ) references public.ai_chat_messages(
      id,
      conversation_id,
      organization_id,
      owner_user_id
    ),
  constraint ai_hermes_memories_revision_key
    unique (organization_id, owner_user_id, memory_key, revision),
  constraint ai_hermes_memories_idempotency_key
    unique (organization_id, owner_user_id, idempotency_key),
  constraint ai_hermes_memories_idempotency_value_check check (
    char_length(idempotency_key) between 1 and 200
    and idempotency_key = trim(idempotency_key)
  ),
  constraint ai_hermes_memories_type_check check (
    memory_type in (
      'preference',
      'workflow',
      'communication',
      'user_instruction'
    )
  ),
  constraint ai_hermes_memories_content_check check (
    nullif(trim(content), '') is not null
  ),
  constraint ai_hermes_memories_content_hash_check check (
    content_hash ~ '^[0-9a-f]{64}$'
  ),
  constraint ai_hermes_memories_revision_check check (revision > 0),
  constraint ai_hermes_memories_requested_revision_check check (
    requested_expected_revision >= 0
    and revision = requested_expected_revision + 1
    and (requested_memory_key is null or requested_memory_key = memory_key)
  ),
  constraint ai_hermes_memories_deactivation_check check (
    (active and deactivated_at is null)
    or (not active and deactivated_at is not null)
  )
);

create unique index ai_hermes_memories_one_active_revision
  on public.ai_hermes_memories (organization_id, owner_user_id, memory_key)
  where active;

create index ai_hermes_memories_owner_active_idx
  on public.ai_hermes_memories (
    organization_id,
    owner_user_id,
    active,
    updated_at desc
  );

create table public.ai_hermes_skill_drafts (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  owner_user_id uuid not null references public.profiles(id) on delete cascade,
  skill_id text not null,
  version integer not null,
  manifest jsonb not null default '{}'::jsonb,
  bundle text not null,
  bundle_sha256 text not null,
  status text not null default 'draft',
  source_conversation_id uuid not null,
  source_invocation_id uuid not null references public.ai_invocations(id),
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  review_note text,
  signature text,
  signing_key_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ai_hermes_skill_drafts_conversation_owner_fkey
    foreign key (source_conversation_id, organization_id, owner_user_id)
    references public.ai_conversations(id, organization_id, owner_user_id)
    on delete cascade,
  constraint ai_hermes_skill_drafts_version_key
    unique (organization_id, owner_user_id, skill_id, version),
  constraint ai_hermes_skill_drafts_source_bundle_key
    unique (source_invocation_id, bundle_sha256),
  constraint ai_hermes_skill_drafts_skill_id_check check (
    skill_id ~ '^[a-z0-9][a-z0-9_-]{1,63}$'
  ),
  constraint ai_hermes_skill_drafts_version_check check (version > 0),
  constraint ai_hermes_skill_drafts_manifest_check check (
    jsonb_typeof(manifest) = 'object'
  ),
  constraint ai_hermes_skill_drafts_bundle_check check (
    nullif(trim(bundle), '') is not null
  ),
  constraint ai_hermes_skill_drafts_bundle_hash_check check (
    bundle_sha256 ~ '^[0-9a-f]{64}$'
  ),
  constraint ai_hermes_skill_drafts_status_check check (
    status in (
      'draft',
      'pending_review',
      'approved',
      'rejected',
      'superseded'
    )
  ),
  constraint ai_hermes_skill_drafts_approved_signature_check check (
    status <> 'approved' or (signature is not null and signing_key_id is not null)
  ),
  constraint ai_hermes_skill_drafts_review_check check (
    status not in ('approved', 'rejected')
    or (reviewed_by is not null and reviewed_at is not null)
  )
);

create index ai_hermes_skill_drafts_owner_status_idx
  on public.ai_hermes_skill_drafts (
    organization_id,
    owner_user_id,
    status,
    updated_at desc
  );

create table public.ai_hermes_run_capabilities (
  id uuid primary key default extensions.gen_random_uuid(),
  token_sha256 text not null,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  owner_user_id uuid not null references public.profiles(id) on delete cascade,
  conversation_id uuid not null,
  turn_id uuid not null references public.ai_chat_turns(id) on delete cascade,
  invocation_id uuid not null references public.ai_invocations(id) on delete cascade,
  root_invocation_id uuid not null references public.ai_invocations(id) on delete cascade,
  parent_capability_id uuid,
  parent_invocation_id uuid references public.ai_invocations(id) on delete cascade,
  actor_fingerprint text not null,
  allowed_tools text[] not null default '{}',
  allowed_tools_hash text not null,
  scopes text[] not null default '{}',
  scope_hash text not null,
  skill_grants_hash text not null,
  skill_draft_ids uuid[] not null default '{}',
  depth integer not null default 0,
  ai_state_writes_allowed boolean not null default false,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  constraint ai_hermes_run_capabilities_token_key unique (token_sha256),
  constraint ai_hermes_run_capabilities_identity_key
    unique (id, organization_id, owner_user_id),
  constraint ai_hermes_run_capabilities_parent_identity_key
    unique (
      id,
      organization_id,
      owner_user_id,
      conversation_id,
      turn_id,
      root_invocation_id,
      invocation_id
    ),
  constraint ai_hermes_run_capabilities_conversation_owner_fkey
    foreign key (conversation_id, organization_id, owner_user_id)
    references public.ai_conversations(id, organization_id, owner_user_id)
    on delete cascade,
  constraint ai_hermes_run_capabilities_parent_tenant_fkey
    foreign key (
      parent_capability_id,
      organization_id,
      owner_user_id,
      conversation_id,
      turn_id,
      root_invocation_id,
      parent_invocation_id
    ) references public.ai_hermes_run_capabilities(
      id,
      organization_id,
      owner_user_id,
      conversation_id,
      turn_id,
      root_invocation_id,
      invocation_id
    ) on delete cascade,
  constraint ai_hermes_run_capabilities_token_hash_check check (
    token_sha256 ~ '^[0-9a-f]{64}$'
  ),
  constraint ai_hermes_run_capabilities_actor_hash_check check (
    actor_fingerprint ~ '^[0-9a-f]{64}$'
  ),
  constraint ai_hermes_run_capabilities_tool_hash_check check (
    allowed_tools_hash ~ '^[0-9a-f]{64}$'
  ),
  constraint ai_hermes_run_capabilities_scope_hash_check check (
    scope_hash ~ '^[0-9a-f]{64}$'
  ),
  constraint ai_hermes_run_capabilities_skill_hash_check check (
    skill_grants_hash ~ '^[0-9a-f]{64}$'
  ),
  constraint ai_hermes_run_capabilities_depth_check check (
    depth >= 0 and depth <= 3
  ),
  constraint ai_hermes_run_capabilities_parent_check check (
    (depth = 0 and root_invocation_id = invocation_id and parent_capability_id is null and parent_invocation_id is null)
    or (depth > 0 and parent_capability_id is not null and parent_invocation_id is not null)
  ),
  constraint ai_hermes_run_capabilities_child_write_check check (
    depth = 0 or not ai_state_writes_allowed
  ),
  constraint ai_hermes_run_capabilities_tool_values_check check (
    array_position(allowed_tools, null) is null
  ),
  constraint ai_hermes_run_capabilities_scope_values_check check (
    array_position(scopes, null) is null
  ),
  constraint ai_hermes_run_capabilities_expiry_check check (
    expires_at > created_at
  )
);

create index ai_hermes_run_capabilities_turn_active_idx
  on public.ai_hermes_run_capabilities (turn_id, expires_at)
  where revoked_at is null;

create table public.ai_hermes_broker_calls (
  id uuid primary key default extensions.gen_random_uuid(),
  capability_id uuid not null,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  owner_user_id uuid not null references public.profiles(id) on delete cascade,
  tool_call_id text not null,
  tool_name text not null,
  request_sha256 text not null,
  sanitized_request_envelope jsonb not null default '{}'::jsonb,
  status text not null default 'claimed',
  sanitized_response_envelope jsonb,
  error_code text,
  claim_owner_id uuid not null,
  claim_lease_expires_at timestamptz not null,
  claim_attempt integer not null default 1,
  fencing_token bigint not null default 1,
  claimed_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ai_hermes_broker_calls_tool_call_key
    unique (capability_id, tool_call_id),
  constraint ai_hermes_broker_calls_capability_tenant_fkey
    foreign key (capability_id, organization_id, owner_user_id)
    references public.ai_hermes_run_capabilities(id, organization_id, owner_user_id)
    on delete cascade,
  constraint ai_hermes_broker_calls_request_hash_check check (
    request_sha256 ~ '^[0-9a-f]{64}$'
  ),
  constraint ai_hermes_broker_calls_request_envelope_check check (
    jsonb_typeof(sanitized_request_envelope) = 'object'
  ),
  constraint ai_hermes_broker_calls_status_check check (
    status in ('claimed', 'completed', 'failed', 'denied')
  ),
  constraint ai_hermes_broker_calls_claim_attempt_check check (claim_attempt > 0),
  constraint ai_hermes_broker_calls_fencing_token_check check (fencing_token > 0),
  constraint ai_hermes_broker_calls_claim_lease_check check (
    claim_lease_expires_at > claimed_at
  ),
  constraint ai_hermes_broker_calls_response_check check (
    (status = 'claimed' and sanitized_response_envelope is null and completed_at is null)
    or (
      status in ('completed', 'failed', 'denied')
      and sanitized_response_envelope is not null
      and jsonb_typeof(sanitized_response_envelope) = 'object'
      and completed_at is not null
    )
  )
);

create index ai_hermes_broker_calls_org_recent_idx
  on public.ai_hermes_broker_calls (organization_id, created_at desc);

create or replace function public.validate_ai_hermes_run_capability_identity()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if not exists (
    select 1
    from public.ai_chat_turns turn
    where turn.id = new.turn_id
      and turn.organization_id = new.organization_id
      and turn.owner_user_id = new.owner_user_id
      and turn.conversation_id = new.conversation_id
      and turn.ai_invocation_id = new.root_invocation_id
  ) then
    raise exception 'hermes_capability_identity_invalid';
  end if;
  if not exists (
    select 1
    from public.ai_invocations invocation
    where invocation.id = new.invocation_id
      and invocation.organization_id = new.organization_id
      and invocation.actor_user_id = new.owner_user_id
  ) or not exists (
    select 1
    from public.ai_invocations root_invocation
    where root_invocation.id = new.root_invocation_id
      and root_invocation.organization_id = new.organization_id
      and root_invocation.actor_user_id = new.owner_user_id
  ) then
    raise exception 'hermes_capability_identity_invalid';
  end if;
  if new.parent_invocation_id is not null and not exists (
    select 1
    from public.ai_invocations parent_invocation
    where parent_invocation.id = new.parent_invocation_id
      and parent_invocation.organization_id = new.organization_id
      and parent_invocation.actor_user_id = new.owner_user_id
  ) then
    raise exception 'hermes_capability_identity_invalid';
  end if;
  if new.parent_capability_id is not null and not exists (
    select 1
    from public.ai_hermes_run_capabilities parent_capability
    where parent_capability.id = new.parent_capability_id
      and parent_capability.organization_id = new.organization_id
      and parent_capability.owner_user_id = new.owner_user_id
      and parent_capability.conversation_id = new.conversation_id
      and parent_capability.turn_id = new.turn_id
      and parent_capability.root_invocation_id = new.root_invocation_id
      and parent_capability.invocation_id = new.parent_invocation_id
      and parent_capability.actor_fingerprint = new.actor_fingerprint
  ) then
    raise exception 'hermes_capability_identity_invalid';
  end if;
  return new;
end;
$$;

create or replace function public.validate_ai_hermes_memory_identity()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if not exists (
    select 1
    from public.ai_chat_messages source_message
    where source_message.id = new.source_message_id
      and source_message.role = 'user'
      and source_message.status = 'completed'
      and source_message.organization_id = new.organization_id
      and source_message.owner_user_id = new.owner_user_id
      and source_message.conversation_id = new.source_conversation_id
  ) or not exists (
    select 1
    from public.ai_invocations source_invocation
    where source_invocation.id = new.source_invocation_id
      and source_invocation.organization_id = new.organization_id
      and source_invocation.actor_user_id = new.owner_user_id
  ) then
    raise exception 'hermes_memory_identity_invalid';
  end if;
  if new.deactivated_by_invocation_id is not null and not exists (
    select 1
    from public.ai_invocations deactivation_invocation
    where deactivation_invocation.id = new.deactivated_by_invocation_id
      and deactivation_invocation.organization_id = new.organization_id
      and deactivation_invocation.actor_user_id = new.owner_user_id
  ) then
    raise exception 'hermes_memory_identity_invalid';
  end if;
  return new;
end;
$$;

create or replace function public.validate_ai_hermes_skill_draft_identity()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if not exists (
    select 1
    from public.ai_conversations conversation
    where conversation.id = new.source_conversation_id
      and conversation.organization_id = new.organization_id
      and conversation.owner_user_id = new.owner_user_id
  ) or not exists (
    select 1
    from public.ai_invocations source_invocation
    where source_invocation.id = new.source_invocation_id
      and source_invocation.organization_id = new.organization_id
      and source_invocation.actor_user_id = new.owner_user_id
  ) then
    raise exception 'hermes_skill_draft_identity_invalid';
  end if;
  return new;
end;
$$;

create or replace function public.validate_ai_hermes_broker_call_identity()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if not exists (
    select 1
    from public.ai_hermes_run_capabilities capability
    where capability.id = new.capability_id
      and capability.organization_id = new.organization_id
      and capability.owner_user_id = new.owner_user_id
  ) then
    raise exception 'hermes_broker_call_identity_invalid';
  end if;
  return new;
end;
$$;

create or replace function public.lock_and_validate_ai_hermes_capability_lineage(
  p_capability_id uuid,
  p_organization_id uuid,
  p_owner_user_id uuid,
  p_conversation_id uuid,
  p_turn_id uuid,
  p_root_invocation_id uuid,
  p_actor_fingerprint text,
  p_expected_depth integer
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_lineage_ids uuid[];
  v_validated_lineage_ids uuid[];
  v_lineage_count integer;
  v_lineage_invalid boolean;
  v_root_invocation_id uuid;
begin
  if p_capability_id is null
     or p_organization_id is null
     or p_owner_user_id is null
     or p_conversation_id is null
     or p_turn_id is null
     or p_root_invocation_id is null
     or p_actor_fingerprint is null
     or p_expected_depth is null
     or p_expected_depth < 0
     or p_expected_depth > 3 then
    raise exception 'capability_lineage_invalid';
  end if;

  with recursive capability_lineage as (
    select
      capability.id,
      capability.parent_capability_id,
      capability.invocation_id,
      capability.parent_invocation_id,
      capability.root_invocation_id,
      capability.organization_id,
      capability.owner_user_id,
      capability.conversation_id,
      capability.turn_id,
      capability.actor_fingerprint,
      capability.depth,
      capability.revoked_at,
      capability.expires_at,
      0 as hop,
      array[capability.id]::uuid[] as path,
      false as cycle,
      true as link_valid
    from public.ai_hermes_run_capabilities capability
    where capability.id = p_capability_id

    union all

    select
      parent_capability.id,
      parent_capability.parent_capability_id,
      parent_capability.invocation_id,
      parent_capability.parent_invocation_id,
      parent_capability.root_invocation_id,
      parent_capability.organization_id,
      parent_capability.owner_user_id,
      parent_capability.conversation_id,
      parent_capability.turn_id,
      parent_capability.actor_fingerprint,
      parent_capability.depth,
      parent_capability.revoked_at,
      parent_capability.expires_at,
      lineage.hop + 1,
      lineage.path || parent_capability.id,
      parent_capability.id = any(lineage.path),
      coalesce(
        parent_capability.invocation_id = lineage.parent_invocation_id
        and parent_capability.depth = lineage.depth - 1
        and parent_capability.root_invocation_id = lineage.root_invocation_id,
        false
      )
    from capability_lineage lineage
    join public.ai_hermes_run_capabilities parent_capability
      on parent_capability.id = lineage.parent_capability_id
    where not lineage.cycle
      and lineage.hop < 4
  )
  select array_agg(distinct lineage.id order by lineage.id)
  into v_lineage_ids
  from capability_lineage lineage;

  if v_lineage_ids is null then
    raise exception 'capability_lineage_invalid';
  end if;

  perform 1
  from public.ai_hermes_run_capabilities capability_to_lock
  where capability_to_lock.id = any(v_lineage_ids)
  order by capability_to_lock.id
  for update;

  with recursive capability_lineage as (
    select
      capability.id,
      capability.parent_capability_id,
      capability.invocation_id,
      capability.parent_invocation_id,
      capability.root_invocation_id,
      capability.organization_id,
      capability.owner_user_id,
      capability.conversation_id,
      capability.turn_id,
      capability.actor_fingerprint,
      capability.depth,
      capability.revoked_at,
      capability.expires_at,
      0 as hop,
      array[capability.id]::uuid[] as path,
      false as cycle,
      true as link_valid
    from public.ai_hermes_run_capabilities capability
    where capability.id = p_capability_id

    union all

    select
      parent_capability.id,
      parent_capability.parent_capability_id,
      parent_capability.invocation_id,
      parent_capability.parent_invocation_id,
      parent_capability.root_invocation_id,
      parent_capability.organization_id,
      parent_capability.owner_user_id,
      parent_capability.conversation_id,
      parent_capability.turn_id,
      parent_capability.actor_fingerprint,
      parent_capability.depth,
      parent_capability.revoked_at,
      parent_capability.expires_at,
      lineage.hop + 1,
      lineage.path || parent_capability.id,
      parent_capability.id = any(lineage.path),
      coalesce(
        parent_capability.invocation_id = lineage.parent_invocation_id
        and parent_capability.depth = lineage.depth - 1
        and parent_capability.root_invocation_id = lineage.root_invocation_id,
        false
      )
    from capability_lineage lineage
    join public.ai_hermes_run_capabilities parent_capability
      on parent_capability.id = lineage.parent_capability_id
    where not lineage.cycle
      and lineage.hop < 4
  )
  select
    array_agg(distinct lineage.id order by lineage.id),
    count(*),
    coalesce(bool_or(
      lineage.cycle
      or not lineage.link_valid
      or lineage.depth <> p_expected_depth - lineage.hop
      or lineage.organization_id is distinct from p_organization_id
      or lineage.owner_user_id is distinct from p_owner_user_id
      or lineage.conversation_id is distinct from p_conversation_id
      or lineage.turn_id is distinct from p_turn_id
      or lineage.actor_fingerprint is distinct from p_actor_fingerprint
      or lineage.root_invocation_id is distinct from p_root_invocation_id
      or lineage.revoked_at is not null
      or lineage.expires_at <= now()
      or (
        lineage.depth = 0
        and (
          lineage.root_invocation_id is distinct from lineage.invocation_id
          or lineage.parent_capability_id is not null
          or lineage.parent_invocation_id is not null
        )
      )
      or (
        lineage.depth > 0
        and (
          lineage.parent_capability_id is null
          or lineage.parent_invocation_id is null
        )
      )
    ), true),
    (array_agg(lineage.invocation_id order by lineage.hop desc)
      filter (where lineage.depth = 0))[1]
  into
    v_validated_lineage_ids,
    v_lineage_count,
    v_lineage_invalid,
    v_root_invocation_id
  from capability_lineage lineage;

  if v_lineage_ids is distinct from v_validated_lineage_ids
     or v_lineage_count <> p_expected_depth + 1
     or v_lineage_invalid
     or v_root_invocation_id is distinct from p_root_invocation_id then
    raise exception 'capability_lineage_invalid';
  end if;

  return v_root_invocation_id;
end;
$$;

create trigger ai_hermes_run_capabilities_validate_identity
before insert or update on public.ai_hermes_run_capabilities
for each row execute function public.validate_ai_hermes_run_capability_identity();

create trigger ai_hermes_memories_validate_identity
before insert or update on public.ai_hermes_memories
for each row execute function public.validate_ai_hermes_memory_identity();

create trigger ai_hermes_skill_drafts_validate_identity
before insert or update on public.ai_hermes_skill_drafts
for each row execute function public.validate_ai_hermes_skill_draft_identity();

create trigger ai_hermes_broker_calls_validate_identity
before insert or update on public.ai_hermes_broker_calls
for each row execute function public.validate_ai_hermes_broker_call_identity();

create trigger ai_hermes_memories_touch_updated_at
before update on public.ai_hermes_memories
for each row execute function public.touch_updated_at();

create trigger ai_hermes_skill_drafts_touch_updated_at
before update on public.ai_hermes_skill_drafts
for each row execute function public.touch_updated_at();

create trigger ai_hermes_broker_calls_touch_updated_at
before update on public.ai_hermes_broker_calls
for each row execute function public.touch_updated_at();

alter table public.ai_hermes_run_capabilities enable row level security;
alter table public.ai_hermes_broker_calls enable row level security;
alter table public.ai_hermes_memories enable row level security;
alter table public.ai_hermes_skill_drafts enable row level security;

create policy ai_hermes_memories_owner_read
on public.ai_hermes_memories for select
using (
  owner_user_id = auth.uid()
  and public.is_org_member(organization_id)
);

create policy ai_hermes_skill_drafts_owner_read
on public.ai_hermes_skill_drafts for select
using (
  owner_user_id = auth.uid()
  and public.is_org_member(organization_id)
);

create or replace function public.issue_ai_hermes_run_capability(
  p_token_sha256 text,
  p_organization_id uuid,
  p_owner_user_id uuid,
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
  v_capability_id uuid;
  v_turn public.ai_chat_turns%rowtype;
  v_parent public.ai_hermes_run_capabilities%rowtype;
  v_allowed_tools text[];
  v_scopes text[];
  v_skill_draft_ids uuid[];
  v_allowed_tools_hash text;
  v_scope_hash text;
  v_skill_grants_hash text;
  v_root_invocation_id uuid;
begin
  if lower(coalesce(p_token_sha256, '')) !~ '^[0-9a-f]{64}$'
     or lower(coalesce(p_actor_fingerprint, '')) !~ '^[0-9a-f]{64}$'
     or lower(coalesce(p_allowed_tools_hash, '')) !~ '^[0-9a-f]{64}$'
     or lower(coalesce(p_scope_hash, '')) !~ '^[0-9a-f]{64}$'
     or lower(coalesce(p_skill_grants_hash, '')) !~ '^[0-9a-f]{64}$' then
    raise exception 'capability_hash_invalid';
  end if;
  if p_parent_token_sha256 is not null
     and lower(p_parent_token_sha256) !~ '^[0-9a-f]{64}$' then
    raise exception 'capability_parent_invalid';
  end if;
  if p_depth is null or p_ai_state_writes_allowed is null
     or p_depth < 0 or p_depth > 3
     or (
       p_depth = 0
       and (
         p_parent_token_sha256 is not null
         or p_parent_invocation_id is not null
       )
     )
     or (
       p_depth > 0
       and (
         p_parent_token_sha256 is null
         or p_parent_invocation_id is null
       )
     )
     or (p_depth > 0 and p_ai_state_writes_allowed) then
    raise exception 'capability_delegation_invalid';
  end if;
  if p_expires_at is null or p_expires_at <= now() then
    raise exception 'capability_expiry_invalid';
  end if;
  if p_allowed_tools is null or p_scopes is null or p_skill_draft_ids is null then
    raise exception 'capability_binding_list_invalid';
  end if;
  if exists (
    select 1
    from pg_catalog.unnest(p_allowed_tools) as provided_tool(value)
    where value is null
       or nullif(pg_catalog.btrim(value), '') is null
       or value <> pg_catalog.btrim(value)
  ) or exists (
    select 1
    from pg_catalog.unnest(p_scopes) as provided_scope(value)
    where value is null
       or nullif(pg_catalog.btrim(value), '') is null
       or value <> pg_catalog.btrim(value)
  ) or exists (
    select 1
    from pg_catalog.unnest(p_skill_draft_ids) as provided_skill(value)
    where value is null
  ) then
    raise exception 'capability_binding_list_invalid';
  end if;
  if (
    select count(distinct value collate "C") <> count(*)
    from pg_catalog.unnest(p_allowed_tools) as provided_tool(value)
  ) or (
    select count(distinct value collate "C") <> count(*)
    from pg_catalog.unnest(p_scopes) as provided_scope(value)
  ) or (
    select count(distinct value) <> count(*)
    from pg_catalog.unnest(p_skill_draft_ids) as provided_skill(value)
  ) then
    raise exception 'capability_binding_list_invalid';
  end if;

  select coalesce(
    array_agg(value order by value collate "C"),
    '{}'::text[]
  )
  into v_allowed_tools
  from pg_catalog.unnest(p_allowed_tools) as provided_tool(value);

  select coalesce(
    array_agg(value order by value collate "C"),
    '{}'::text[]
  )
  into v_scopes
  from pg_catalog.unnest(p_scopes) as provided_scope(value);

  select coalesce(
    array_agg(value order by value::text collate "C"),
    '{}'::uuid[]
  )
  into v_skill_draft_ids
  from pg_catalog.unnest(p_skill_draft_ids) as provided_skill(value);

  v_allowed_tools_hash := public.ai_hermes_canonical_text_array_sha256(v_allowed_tools);
  v_scope_hash := public.ai_hermes_canonical_text_array_sha256(v_scopes);
  v_skill_grants_hash := public.ai_hermes_canonical_uuid_array_sha256(v_skill_draft_ids);

  if lower(p_allowed_tools_hash) is distinct from v_allowed_tools_hash
     or lower(p_scope_hash) is distinct from v_scope_hash
     or lower(p_skill_grants_hash) is distinct from v_skill_grants_hash then
    raise exception 'capability_binding_hash_mismatch';
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
  if p_depth = 0 then
    v_root_invocation_id := p_invocation_id;
    if v_turn.ai_invocation_id is not null
       and v_turn.ai_invocation_id is distinct from v_root_invocation_id then
      raise exception 'capability_context_invalid';
    end if;
  end if;

  if not exists (
    select 1
    from public.ai_invocations invocation
    where invocation.id = p_invocation_id
      and invocation.organization_id = p_organization_id
      and invocation.actor_user_id = p_owner_user_id
  ) then
    raise exception 'capability_context_invalid';
  end if;

  if p_depth > 0 then
    select parent_capability.*
    into v_parent
    from public.ai_hermes_run_capabilities parent_capability
    where parent_capability.token_sha256 = lower(p_parent_token_sha256)
      and parent_capability.revoked_at is null
      and parent_capability.expires_at > now()
    for update;

    if not found then
      raise exception 'capability_parent_invalid';
    end if;
    if v_parent.organization_id is distinct from p_organization_id
       or v_parent.owner_user_id is distinct from p_owner_user_id
       or v_parent.conversation_id is distinct from p_conversation_id
       or v_parent.turn_id is distinct from p_turn_id
       or v_parent.invocation_id is distinct from p_parent_invocation_id
       or p_depth <> v_parent.depth + 1
       or lower(p_actor_fingerprint) is distinct from v_parent.actor_fingerprint
       or not (v_allowed_tools <@ v_parent.allowed_tools)
       or not (v_scopes <@ v_parent.scopes)
       or not (v_skill_draft_ids <@ v_parent.skill_draft_ids)
       or p_expires_at > v_parent.expires_at
       or p_ai_state_writes_allowed then
      raise exception 'capability_parent_invalid';
    end if;
    v_root_invocation_id := v_parent.root_invocation_id;
    perform public.lock_and_validate_ai_hermes_capability_lineage(
      v_parent.id,
      p_organization_id,
      p_owner_user_id,
      p_conversation_id,
      p_turn_id,
      v_root_invocation_id,
      lower(p_actor_fingerprint),
      p_depth - 1
    );
    if v_turn.ai_invocation_id is distinct from v_root_invocation_id then
      raise exception 'capability_parent_invalid';
    end if;
    if exists (
      select 1
      from pg_catalog.unnest(v_parent.allowed_tools) as parent_tool(value)
      where value is null
         or nullif(pg_catalog.btrim(value), '') is null
         or value <> pg_catalog.btrim(value)
    ) or exists (
      select 1
      from pg_catalog.unnest(v_parent.scopes) as parent_scope(value)
      where value is null
         or nullif(pg_catalog.btrim(value), '') is null
         or value <> pg_catalog.btrim(value)
    ) or exists (
      select 1
      from pg_catalog.unnest(v_parent.skill_draft_ids) as parent_skill(value)
      where value is null
    ) or (
      select count(distinct value collate "C") <> count(*)
      from pg_catalog.unnest(v_parent.allowed_tools) as parent_tool(value)
    ) or (
      select count(distinct value collate "C") <> count(*)
      from pg_catalog.unnest(v_parent.scopes) as parent_scope(value)
    ) or (
      select count(distinct value) <> count(*)
      from pg_catalog.unnest(v_parent.skill_draft_ids) as parent_skill(value)
    ) or v_parent.allowed_tools_hash is distinct from
      public.ai_hermes_canonical_text_array_sha256(v_parent.allowed_tools)
    or v_parent.scope_hash is distinct from
      public.ai_hermes_canonical_text_array_sha256(v_parent.scopes)
    or v_parent.skill_grants_hash is distinct from
      public.ai_hermes_canonical_uuid_array_sha256(v_parent.skill_draft_ids) then
      raise exception 'capability_parent_invalid';
    end if;
    if exists (
      select 1
      from pg_catalog.unnest(v_parent.skill_draft_ids) parent_skill_grant(draft_id)
      left join public.ai_hermes_skill_drafts parent_skill_draft
        on parent_skill_draft.id = parent_skill_grant.draft_id
       and parent_skill_draft.organization_id = p_organization_id
       and parent_skill_draft.owner_user_id = p_owner_user_id
      where parent_skill_draft.id is null
         or parent_skill_draft.status <> 'approved'
         or parent_skill_draft.signature is null
         or parent_skill_draft.signing_key_id is null
    ) then
      raise exception 'capability_parent_invalid';
    end if;
  end if;

  if exists (
    select 1
    from pg_catalog.unnest(v_skill_draft_ids) skill_grant(draft_id)
    left join public.ai_hermes_skill_drafts skill_draft
      on skill_draft.id = skill_grant.draft_id
     and skill_draft.organization_id = p_organization_id
     and skill_draft.owner_user_id = p_owner_user_id
    where skill_draft.id is null
       or skill_draft.status <> 'approved'
       or skill_draft.signature is null
       or skill_draft.signing_key_id is null
  ) then
    raise exception 'skill_grant_not_approved';
  end if;

  if p_depth = 0 then
    update public.ai_chat_turns
    set ai_invocation_id = p_invocation_id
    where id = p_turn_id
      and ai_invocation_id is null;
  end if;

  insert into public.ai_hermes_run_capabilities (
    token_sha256,
    organization_id,
    owner_user_id,
    conversation_id,
    turn_id,
    invocation_id,
    root_invocation_id,
    parent_capability_id,
    parent_invocation_id,
    actor_fingerprint,
    allowed_tools,
    allowed_tools_hash,
    scopes,
    scope_hash,
    skill_grants_hash,
    skill_draft_ids,
    depth,
    ai_state_writes_allowed,
    expires_at
  ) values (
    lower(p_token_sha256),
    p_organization_id,
    p_owner_user_id,
    p_conversation_id,
    p_turn_id,
    p_invocation_id,
    v_root_invocation_id,
    v_parent.id,
    p_parent_invocation_id,
    lower(p_actor_fingerprint),
    v_allowed_tools,
    v_allowed_tools_hash,
    v_scopes,
    v_scope_hash,
    v_skill_grants_hash,
    v_skill_draft_ids,
    p_depth,
    p_ai_state_writes_allowed,
    p_expires_at
  )
  returning id into v_capability_id;

  return jsonb_build_object(
    'capability_id', v_capability_id,
    'expires_at', p_expires_at
  );
exception
  when unique_violation then
    raise exception 'capability_hash_conflict';
end;
$$;

create or replace function public.claim_ai_hermes_broker_call(
  p_token_sha256 text,
  p_actor_fingerprint text,
  p_claim_owner_id uuid,
  p_tool_call_id text,
  p_tool_name text,
  p_request_sha256 text,
  p_sanitized_request_envelope jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_capability public.ai_hermes_run_capabilities%rowtype;
  v_existing public.ai_hermes_broker_calls%rowtype;
begin
  if lower(coalesce(p_token_sha256, '')) !~ '^[0-9a-f]{64}$'
     or lower(coalesce(p_actor_fingerprint, '')) !~ '^[0-9a-f]{64}$' then
    raise exception 'capability_invalid';
  end if;
  if p_claim_owner_id is null
     or lower(coalesce(p_request_sha256, '')) !~ '^[0-9a-f]{64}$'
     or nullif(trim(coalesce(p_tool_call_id, '')), '') is null
     or nullif(trim(coalesce(p_tool_name, '')), '') is null
     or jsonb_typeof(coalesce(p_sanitized_request_envelope, '{}'::jsonb)) <> 'object' then
    raise exception 'broker_call_invalid';
  end if;

  select capability.*
  into v_capability
  from public.ai_hermes_run_capabilities capability
  where capability.token_sha256 = lower(p_token_sha256)
    and capability.revoked_at is null
    and capability.expires_at > now();

  if not found then
    raise exception 'capability_invalid';
  end if;

  perform 1
  from public.ai_chat_turns turn
  where turn.id = v_capability.turn_id
    and turn.organization_id = v_capability.organization_id
    and turn.owner_user_id = v_capability.owner_user_id
    and turn.conversation_id = v_capability.conversation_id
    and turn.ai_invocation_id = v_capability.root_invocation_id
    and turn.status in ('accepted', 'grounding', 'generating', 'validating')
    and turn.lease_expires_at > now()
    and turn.cancel_requested_at is null
  for update;

  if not found then
    raise exception 'turn_lease_invalid';
  end if;

  select capability.*
  into v_capability
  from public.ai_hermes_run_capabilities capability
  where capability.id = v_capability.id
    and capability.token_sha256 = lower(p_token_sha256)
    and capability.revoked_at is null
    and capability.expires_at > now()
  for update;

  if not found then
    raise exception 'capability_invalid';
  end if;
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
  if exists (
    select 1
    from pg_catalog.unnest(v_capability.allowed_tools) as stored_tool(value)
    where value is null
       or nullif(pg_catalog.btrim(value), '') is null
       or value <> pg_catalog.btrim(value)
  ) or exists (
    select 1
    from pg_catalog.unnest(v_capability.scopes) as stored_scope(value)
    where value is null
       or nullif(pg_catalog.btrim(value), '') is null
       or value <> pg_catalog.btrim(value)
  ) or exists (
    select 1
    from pg_catalog.unnest(v_capability.skill_draft_ids) as stored_skill(value)
    where value is null
  ) or (
    select count(distinct value collate "C") <> count(*)
    from pg_catalog.unnest(v_capability.allowed_tools) as stored_tool(value)
  ) or (
    select count(distinct value collate "C") <> count(*)
    from pg_catalog.unnest(v_capability.scopes) as stored_scope(value)
  ) or (
    select count(distinct value) <> count(*)
    from pg_catalog.unnest(v_capability.skill_draft_ids) as stored_skill(value)
  ) then
    raise exception 'capability_binding_list_invalid';
  end if;
  if v_capability.allowed_tools_hash is distinct from public.ai_hermes_canonical_text_array_sha256(v_capability.allowed_tools)
     or v_capability.scope_hash is distinct from public.ai_hermes_canonical_text_array_sha256(v_capability.scopes)
     or v_capability.skill_grants_hash is distinct from public.ai_hermes_canonical_uuid_array_sha256(v_capability.skill_draft_ids) then
    raise exception 'capability_binding_invalid';
  end if;
  if exists (
    select 1
    from pg_catalog.unnest(v_capability.skill_draft_ids) skill_grant(draft_id)
    left join public.ai_hermes_skill_drafts skill_draft
      on skill_draft.id = skill_grant.draft_id
     and skill_draft.organization_id = v_capability.organization_id
     and skill_draft.owner_user_id = v_capability.owner_user_id
    where skill_draft.id is null
       or skill_draft.status <> 'approved'
       or skill_draft.signature is null
       or skill_draft.signing_key_id is null
  ) then
    raise exception 'capability_binding_invalid';
  end if;
  if v_capability.parent_capability_id is not null and not exists (
    select 1
    from public.ai_hermes_run_capabilities parent_capability
    where parent_capability.id = v_capability.parent_capability_id
      and parent_capability.organization_id = v_capability.organization_id
      and parent_capability.owner_user_id = v_capability.owner_user_id
      and parent_capability.conversation_id = v_capability.conversation_id
      and parent_capability.turn_id = v_capability.turn_id
      and parent_capability.root_invocation_id = v_capability.root_invocation_id
      and parent_capability.invocation_id = v_capability.parent_invocation_id
      and parent_capability.actor_fingerprint = v_capability.actor_fingerprint
      and parent_capability.revoked_at is null
      and parent_capability.expires_at > now()
  ) then
    raise exception 'capability_parent_invalid';
  end if;
  if lower(p_actor_fingerprint) is distinct from v_capability.actor_fingerprint then
    raise exception 'capability_actor_mismatch';
  end if;
  if not (p_tool_name = any(v_capability.allowed_tools)) then
    raise exception 'capability_tool_not_allowed';
  end if;
  if p_tool_name = any(array[
    'xingyao_memory_remember',
    'xingyao_memory_forget',
    'xingyao_skill_draft'
  ]) and not v_capability.ai_state_writes_allowed then
    raise exception 'capability_state_write_not_allowed';
  end if;

  insert into public.ai_hermes_broker_calls (
    capability_id,
    organization_id,
    owner_user_id,
    tool_call_id,
    tool_name,
    request_sha256,
    sanitized_request_envelope,
    claim_owner_id,
    claim_lease_expires_at,
    claim_attempt,
    fencing_token,
    claimed_at
  ) values (
    v_capability.id,
    v_capability.organization_id,
    v_capability.owner_user_id,
    p_tool_call_id,
    p_tool_name,
    lower(p_request_sha256),
    coalesce(p_sanitized_request_envelope, '{}'::jsonb),
    p_claim_owner_id,
    least(now() + interval '2 minutes', v_capability.expires_at),
    1,
    1,
    now()
  )
  on conflict (capability_id, tool_call_id) do nothing
  returning * into v_existing;

  if found then
    update public.ai_hermes_run_capabilities
    set last_used_at = now()
    where id = v_capability.id;

    return jsonb_build_object(
      'broker_call_id', v_existing.id,
      'status', v_existing.status,
      'execute', true,
      'reused', false,
      'fencing_token', v_existing.fencing_token,
      'sanitized_response_envelope', null
    );
  end if;

  select broker_call.*
  into v_existing
  from public.ai_hermes_broker_calls broker_call
  where broker_call.capability_id = v_capability.id
    and broker_call.tool_call_id = p_tool_call_id
  for update;

  if not found then
    raise exception 'broker_call_claim_conflict';
  end if;
  if v_existing.request_sha256 is distinct from lower(p_request_sha256)
     or v_existing.tool_name is distinct from p_tool_name
     or v_existing.sanitized_request_envelope is distinct from
       coalesce(p_sanitized_request_envelope, '{}'::jsonb) then
    raise exception 'broker_call_request_conflict';
  end if;

  update public.ai_hermes_run_capabilities
  set last_used_at = now()
  where id = v_capability.id;

  if v_existing.status in ('completed', 'failed', 'denied') then
    return jsonb_build_object(
      'broker_call_id', v_existing.id,
      'status', v_existing.status,
      'execute', false,
      'reused', true,
      'fencing_token', v_existing.fencing_token,
      'sanitized_response_envelope', v_existing.sanitized_response_envelope
    );
  end if;

  if v_existing.claim_lease_expires_at > now() then
    if v_existing.claim_owner_id = p_claim_owner_id then
      return jsonb_build_object(
        'broker_call_id', v_existing.id,
        'status', v_existing.status,
        'execute', true,
        'reused', true,
        'fencing_token', v_existing.fencing_token,
        'sanitized_response_envelope', null
      );
    end if;

    return jsonb_build_object(
      'broker_call_id', v_existing.id,
      'status', v_existing.status,
      'execute', false,
      'reused', true,
      'fencing_token', v_existing.fencing_token,
      'sanitized_response_envelope', null
    );
  end if;

  update public.ai_hermes_broker_calls
  set claim_owner_id = p_claim_owner_id,
      claim_lease_expires_at = least(
        now() + interval '2 minutes',
        v_capability.expires_at
      ),
      claim_attempt = claim_attempt + 1,
      fencing_token = fencing_token + 1,
      claimed_at = now()
  where id = v_existing.id
  returning * into v_existing;

  return jsonb_build_object(
    'broker_call_id', v_existing.id,
    'status', v_existing.status,
    'execute', true,
    'reused', false,
    'fencing_token', v_existing.fencing_token,
    'sanitized_response_envelope', null
  );
end;
$$;

create or replace function public.complete_ai_hermes_broker_call(
  p_broker_call_id uuid,
  p_claim_owner_id uuid,
  p_fencing_token bigint,
  p_status text,
  p_sanitized_response_envelope jsonb,
  p_error_code text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_call public.ai_hermes_broker_calls%rowtype;
begin
  if p_claim_owner_id is null
     or p_fencing_token is null
     or p_fencing_token <= 0
     or p_status is null
     or p_status not in ('completed', 'failed', 'denied')
     or jsonb_typeof(coalesce(p_sanitized_response_envelope, '{}'::jsonb)) <> 'object' then
    raise exception 'broker_call_completion_invalid';
  end if;

  select broker_call.*
  into v_call
  from public.ai_hermes_broker_calls broker_call
  where broker_call.id = p_broker_call_id
  for update;

  if not found then
    raise exception 'broker_call_not_found';
  end if;
  if v_call.claim_owner_id is distinct from p_claim_owner_id
     or v_call.fencing_token is distinct from p_fencing_token then
    raise exception 'broker_call_fence_invalid';
  end if;

  if v_call.status <> 'claimed' then
    if v_call.status = p_status
       and v_call.sanitized_response_envelope = coalesce(
         p_sanitized_response_envelope,
         '{}'::jsonb
       )
       and v_call.error_code is not distinct from nullif(trim(coalesce(p_error_code, '')), '') then
      return jsonb_build_object(
        'broker_call_id', v_call.id,
        'status', v_call.status,
        'reused', true,
        'fencing_token', v_call.fencing_token
      );
    end if;
    raise exception 'broker_call_completion_conflict';
  end if;
  if v_call.status = 'claimed' and v_call.claim_lease_expires_at <= now() then
    raise exception 'broker_call_fence_invalid';
  end if;

  update public.ai_hermes_broker_calls
  set status = p_status,
      sanitized_response_envelope = coalesce(
        p_sanitized_response_envelope,
        '{}'::jsonb
      ),
      error_code = nullif(trim(coalesce(p_error_code, '')), ''),
      completed_at = now()
  where id = v_call.id
    and claim_owner_id = p_claim_owner_id
    and fencing_token = p_fencing_token;

  return jsonb_build_object(
    'broker_call_id', v_call.id,
    'status', p_status,
    'reused', false,
    'fencing_token', v_call.fencing_token
  );
end;
$$;

create or replace function public.append_ai_hermes_tool_message(
  p_organization_id uuid,
  p_owner_user_id uuid,
  p_conversation_id uuid,
  p_turn_id uuid,
  p_invocation_id uuid,
  p_content text,
  p_metadata jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_next_sequence bigint;
  v_message_id uuid;
begin
  if nullif(trim(coalesce(p_content, '')), '') is null
     or jsonb_typeof(coalesce(p_metadata, '{}'::jsonb)) <> 'object' then
    raise exception 'tool_message_invalid';
  end if;

  perform 1
  from public.ai_conversations conversation
  where conversation.id = p_conversation_id
    and conversation.organization_id = p_organization_id
    and conversation.owner_user_id = p_owner_user_id
    and conversation.status = 'active'
  for update;

  if not found then
    raise exception 'conversation_not_found';
  end if;

  perform 1
  from public.ai_chat_turns turn
  where turn.id = p_turn_id
    and turn.organization_id = p_organization_id
    and turn.owner_user_id = p_owner_user_id
    and turn.conversation_id = p_conversation_id
    and turn.ai_invocation_id = p_invocation_id
    and turn.status in ('accepted', 'grounding', 'generating', 'validating')
    and turn.lease_expires_at > now()
    and turn.cancel_requested_at is null
  for update;

  if not found then
    raise exception 'turn_lease_invalid';
  end if;

  select coalesce(max(sequence_no), 0) + 1
  into v_next_sequence
  from public.ai_chat_messages
  where conversation_id = p_conversation_id;

  insert into public.ai_chat_messages (
    organization_id,
    owner_user_id,
    conversation_id,
    sequence_no,
    role,
    status,
    content,
    ai_invocation_id,
    metadata
  ) values (
    p_organization_id,
    p_owner_user_id,
    p_conversation_id,
    v_next_sequence,
    'tool',
    'completed',
    p_content,
    p_invocation_id,
    coalesce(p_metadata, '{}'::jsonb)
  )
  returning id into v_message_id;

  update public.ai_conversations
  set last_message_at = now()
  where id = p_conversation_id;

  return jsonb_build_object(
    'message_id', v_message_id,
    'sequence_no', v_next_sequence
  );
end;
$$;

create or replace function public.update_ai_conversation_hermes_state(
  p_organization_id uuid,
  p_owner_user_id uuid,
  p_conversation_id uuid,
  p_expected_generation integer,
  p_next_hermes_state jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_conversation public.ai_conversations%rowtype;
  v_current_generation integer;
  v_next_generation integer;
begin
  if p_expected_generation is null
     or p_expected_generation < 0
     or jsonb_typeof(coalesce(p_next_hermes_state, 'null'::jsonb)) <> 'object'
     or coalesce(p_next_hermes_state ->> 'generation', '') !~ '^[0-9]+$' then
    raise exception 'hermes_state_invalid';
  end if;

  select conversation.*
  into v_conversation
  from public.ai_conversations conversation
  where conversation.id = p_conversation_id
    and conversation.organization_id = p_organization_id
    and conversation.owner_user_id = p_owner_user_id
    and conversation.status = 'active'
  for update;

  if not found then
    raise exception 'conversation_not_found';
  end if;

  if coalesce(
    v_conversation.provider_state #>> '{hermesGateway,generation}',
    '0'
  ) !~ '^[0-9]+$' then
    raise exception 'hermes_state_invalid';
  end if;

  v_current_generation := coalesce(
    (v_conversation.provider_state #>> '{hermesGateway,generation}')::integer,
    0
  );
  v_next_generation := (p_next_hermes_state ->> 'generation')::integer;

  if v_current_generation <> p_expected_generation then
    raise exception 'hermes_state_conflict';
  end if;
  if v_next_generation <> p_expected_generation + 1 then
    raise exception 'hermes_state_generation_invalid';
  end if;

  update public.ai_conversations
  set provider_state = jsonb_set(
        provider_state,
        '{hermesGateway}',
        p_next_hermes_state,
        true
      )
  where id = p_conversation_id;

  return jsonb_build_object('generation', v_next_generation);
end;
$$;

create or replace function public.write_ai_hermes_memory_revision(
  p_organization_id uuid,
  p_owner_user_id uuid,
  p_idempotency_key text,
  p_memory_key uuid,
  p_expected_revision integer,
  p_memory_type text,
  p_content text,
  p_content_hash text,
  p_active boolean,
  p_source_conversation_id uuid,
  p_source_message_id uuid,
  p_source_invocation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_existing public.ai_hermes_memories%rowtype;
  v_idempotent public.ai_hermes_memories%rowtype;
  v_memory_key uuid;
  v_next_revision integer;
  v_created_id uuid;
begin
  if p_active is null
     or p_expected_revision is null
     or p_expected_revision < 0
     or nullif(trim(coalesce(p_idempotency_key, '')), '') is null
     or char_length(p_idempotency_key) > 200
     or p_idempotency_key <> trim(p_idempotency_key)
     or p_memory_type is null or p_memory_type not in (
    'preference',
    'workflow',
    'communication',
    'user_instruction'
  ) or nullif(trim(coalesce(p_content, '')), '') is null then
    raise exception 'memory_revision_invalid';
  end if;
  if lower(coalesce(p_content_hash, '')) !~ '^[0-9a-f]{64}$'
     or lower(p_content_hash) <> pg_catalog.encode(
       extensions.digest(p_content, 'sha256'),
       'hex'
     ) then
    raise exception 'memory_content_hash_invalid';
  end if;

  perform 1
  from public.ai_chat_messages source_message
  where source_message.id = p_source_message_id
    and source_message.role = 'user'
    and source_message.status = 'completed'
    and source_message.organization_id = p_organization_id
    and source_message.owner_user_id = p_owner_user_id
    and source_message.conversation_id = p_source_conversation_id;

  if not found then
    raise exception 'memory_source_invalid';
  end if;

  if not exists (
    select 1
    from public.ai_invocations source_invocation
    where source_invocation.id = p_source_invocation_id
      and source_invocation.organization_id = p_organization_id
      and source_invocation.actor_user_id = p_owner_user_id
  ) then
    raise exception 'memory_source_invalid';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'ai_hermes_memory_idempotency:'
        || p_organization_id::text
        || ':'
        || p_owner_user_id::text
        || ':'
        || p_idempotency_key,
      0
    )
  );

  select memory.*
  into v_idempotent
  from public.ai_hermes_memories memory
  where memory.organization_id = p_organization_id
    and memory.owner_user_id = p_owner_user_id
    and memory.idempotency_key = p_idempotency_key
  for update;

  if found then
    if v_idempotent.requested_memory_key is distinct from p_memory_key
       or v_idempotent.requested_expected_revision is distinct from p_expected_revision
       or v_idempotent.source_conversation_id <> p_source_conversation_id
       or v_idempotent.source_message_id <> p_source_message_id
       or v_idempotent.source_invocation_id <> p_source_invocation_id
       or v_idempotent.memory_type <> p_memory_type
       or v_idempotent.content <> p_content
       or v_idempotent.content_hash <> lower(p_content_hash)
       or v_idempotent.active <> p_active then
      raise exception 'memory_idempotency_conflict';
    end if;
    return jsonb_build_object(
      'memory_id', v_idempotent.id,
      'memory_key', v_idempotent.memory_key,
      'revision', v_idempotent.revision,
      'active', v_idempotent.active,
      'reused', true
    );
  end if;

  v_memory_key := coalesce(p_memory_key, extensions.gen_random_uuid());

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'ai_hermes_memory_key:'
        || p_organization_id::text
        || ':'
        || p_owner_user_id::text
        || ':'
        || v_memory_key::text,
      0
    )
  );

  select memory.*
  into v_existing
  from public.ai_hermes_memories memory
  where memory.organization_id = p_organization_id
    and memory.owner_user_id = p_owner_user_id
    and memory.memory_key = v_memory_key
  order by memory.revision desc
  limit 1
  for update;

  if found then
    if p_expected_revision is distinct from v_existing.revision then
      raise exception 'memory_expected_revision_conflict';
    end if;
    v_next_revision := v_existing.revision + 1;

    if v_existing.active then
      update public.ai_hermes_memories
      set active = false,
          deactivated_at = now(),
          deactivated_by_invocation_id = p_source_invocation_id
      where id = v_existing.id;
    end if;
  else
    if p_expected_revision <> 0 then
      raise exception 'memory_expected_revision_conflict';
    end if;
    v_next_revision := 1;
  end if;

  insert into public.ai_hermes_memories (
    memory_key,
    requested_memory_key,
    requested_expected_revision,
    idempotency_key,
    organization_id,
    owner_user_id,
    memory_type,
    content,
    content_hash,
    revision,
    active,
    source_conversation_id,
    source_message_id,
    source_invocation_id,
    deactivated_at,
    deactivated_by_invocation_id
  ) values (
    v_memory_key,
    p_memory_key,
    p_expected_revision,
    p_idempotency_key,
    p_organization_id,
    p_owner_user_id,
    p_memory_type,
    p_content,
    lower(p_content_hash),
    v_next_revision,
    p_active,
    p_source_conversation_id,
    p_source_message_id,
    p_source_invocation_id,
    case when p_active then null else now() end,
    case when p_active then null else p_source_invocation_id end
  )
  returning id into v_created_id;

  return jsonb_build_object(
    'memory_id', v_created_id,
    'memory_key', v_memory_key,
    'revision', v_next_revision,
    'active', p_active,
    'reused', false
  );
end;
$$;

create or replace function public.write_ai_hermes_skill_draft(
  p_organization_id uuid,
  p_owner_user_id uuid,
  p_skill_id text,
  p_version integer,
  p_manifest jsonb,
  p_bundle text,
  p_bundle_sha256 text,
  p_source_conversation_id uuid,
  p_source_invocation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_existing public.ai_hermes_skill_drafts%rowtype;
  v_draft_id uuid;
begin
  if p_version is null
     or coalesce(p_skill_id, '') !~ '^[a-z0-9][a-z0-9_-]{1,63}$'
     or p_version <= 0
     or jsonb_typeof(coalesce(p_manifest, 'null'::jsonb)) <> 'object'
     or nullif(trim(coalesce(p_bundle, '')), '') is null then
    raise exception 'skill_draft_invalid';
  end if;
  if lower(coalesce(p_bundle_sha256, '')) !~ '^[0-9a-f]{64}$'
     or lower(p_bundle_sha256) <> pg_catalog.encode(
       extensions.digest(p_bundle, 'sha256'),
       'hex'
     ) then
    raise exception 'skill_bundle_hash_invalid';
  end if;

  perform 1
  from public.ai_conversations conversation
  where conversation.id = p_source_conversation_id
    and conversation.organization_id = p_organization_id
    and conversation.owner_user_id = p_owner_user_id
  for update;

  if not found or not exists (
    select 1
    from public.ai_invocations source_invocation
    where source_invocation.id = p_source_invocation_id
      and source_invocation.organization_id = p_organization_id
      and source_invocation.actor_user_id = p_owner_user_id
  ) then
    raise exception 'skill_draft_source_invalid';
  end if;

  select draft.*
  into v_existing
  from public.ai_hermes_skill_drafts draft
  where draft.organization_id = p_organization_id
    and draft.owner_user_id = p_owner_user_id
    and draft.skill_id = p_skill_id
    and draft.version = p_version
  for update;

  if found then
    if v_existing.bundle_sha256 = lower(p_bundle_sha256)
       and v_existing.manifest = p_manifest
       and v_existing.bundle = p_bundle then
      return jsonb_build_object(
        'draft_id', v_existing.id,
        'status', v_existing.status,
        'reused', true
      );
    end if;
    if v_existing.status <> 'draft' then
      raise exception 'skill_draft_locked';
    end if;

    update public.ai_hermes_skill_drafts
    set manifest = p_manifest,
        bundle = p_bundle,
        bundle_sha256 = lower(p_bundle_sha256),
        source_conversation_id = p_source_conversation_id,
        source_invocation_id = p_source_invocation_id
    where id = v_existing.id;
    v_draft_id := v_existing.id;
  else
    insert into public.ai_hermes_skill_drafts (
      organization_id,
      owner_user_id,
      skill_id,
      version,
      manifest,
      bundle,
      bundle_sha256,
      source_conversation_id,
      source_invocation_id
    ) values (
      p_organization_id,
      p_owner_user_id,
      p_skill_id,
      p_version,
      p_manifest,
      p_bundle,
      lower(p_bundle_sha256),
      p_source_conversation_id,
      p_source_invocation_id
    )
    returning id into v_draft_id;
  end if;

  return jsonb_build_object(
    'draft_id', v_draft_id,
    'status', 'draft',
    'reused', false
  );
end;
$$;

create or replace function public.review_ai_hermes_skill_draft(
  p_organization_id uuid,
  p_owner_user_id uuid,
  p_draft_id uuid,
  p_reviewer_user_id uuid,
  p_next_status text,
  p_review_note text,
  p_signature text,
  p_signing_key_id text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_draft public.ai_hermes_skill_drafts%rowtype;
begin
  if not exists (
    select 1
    from public.organization_members reviewer
    where reviewer.organization_id = p_organization_id
      and reviewer.user_id = p_reviewer_user_id
      and reviewer.status = 'active'
      and reviewer.role = 'owner'
  ) then
    raise exception 'skill_reviewer_not_authorized';
  end if;

  select draft.*
  into v_draft
  from public.ai_hermes_skill_drafts draft
  where draft.id = p_draft_id
    and draft.organization_id = p_organization_id
    and draft.owner_user_id = p_owner_user_id
  for update;

  if not found then
    raise exception 'skill_draft_not_found';
  end if;

  if p_next_status is null or not (
    (v_draft.status = 'draft' and p_next_status = 'pending_review')
    or (
      v_draft.status = 'pending_review'
      and p_next_status in ('approved', 'rejected')
    )
    or (
      v_draft.status in ('approved', 'rejected')
      and p_next_status = 'superseded'
    )
  ) then
    raise exception 'invalid_skill_review_transition';
  end if;

  if p_next_status = 'approved'
     and (
       nullif(trim(coalesce(p_signature, '')), '') is null
       or nullif(trim(coalesce(p_signing_key_id, '')), '') is null
     ) then
    raise exception 'skill_approval_signature_required';
  end if;

  update public.ai_hermes_skill_drafts
  set status = p_next_status,
      reviewed_by = case
        when p_next_status in ('approved', 'rejected') then p_reviewer_user_id
        else reviewed_by
      end,
      reviewed_at = case
        when p_next_status in ('approved', 'rejected') then now()
        else reviewed_at
      end,
      review_note = case
        when p_next_status in ('approved', 'rejected')
          then nullif(trim(coalesce(p_review_note, '')), '')
        else review_note
      end,
      signature = case
        when p_next_status = 'approved' then p_signature
        else signature
      end,
      signing_key_id = case
        when p_next_status = 'approved' then p_signing_key_id
        else signing_key_id
      end
  where id = v_draft.id;

  return jsonb_build_object(
    'draft_id', v_draft.id,
    'status', p_next_status
  );
end;
$$;

create or replace function public.cancel_ai_chat_turn(
  p_organization_id uuid,
  p_owner_user_id uuid,
  p_conversation_id uuid,
  p_turn_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_turn public.ai_chat_turns%rowtype;
begin
  perform 1
  from public.ai_conversations conversation
  where conversation.id = p_conversation_id
    and conversation.organization_id = p_organization_id
    and conversation.owner_user_id = p_owner_user_id
  for update;

  if not found then
    raise exception 'turn_not_found';
  end if;

  select turn.*
  into v_turn
  from public.ai_chat_turns turn
  where turn.id = p_turn_id
    and turn.organization_id = p_organization_id
    and turn.owner_user_id = p_owner_user_id
    and turn.conversation_id = p_conversation_id
  for update;

  if not found then
    raise exception 'turn_not_found';
  end if;

  if v_turn.status in ('completed', 'failed', 'cancelled') then
    return jsonb_build_object(
      'turn_id', v_turn.id,
      'status', v_turn.status,
      'already_terminal', true
    );
  end if;
  if v_turn.status not in ('accepted', 'grounding', 'generating', 'validating') then
    raise exception 'turn_not_active';
  end if;

  update public.ai_chat_messages
  set status = 'failed',
      metadata = metadata
        || jsonb_build_object('outcome', 'cancelled')
        || jsonb_build_object('cancelRequestedAt', now())
  where id = v_turn.assistant_message_id;

  update public.ai_chat_turns
  set status = 'cancelled',
      outcome = 'cancelled',
      cancel_requested_at = coalesce(cancel_requested_at, now()),
      error_code = coalesce(error_code, 'turn_cancelled'),
      error_summary = coalesce(error_summary, 'Turn cancelled by owner'),
      retryable = false,
      completed_at = coalesce(completed_at, now())
  where id = v_turn.id;

  update public.ai_hermes_run_capabilities
  set revoked_at = coalesce(revoked_at, now())
  where turn_id = v_turn.id;

  update public.ai_conversations
  set last_message_at = now()
  where id = v_turn.conversation_id;

  return jsonb_build_object(
    'turn_id', v_turn.id,
    'status', 'cancelled',
    'cancel_requested', true,
    'already_terminal', false
  );
end;
$$;

create or replace function public.renew_ai_chat_turn_lease(
  p_organization_id uuid,
  p_owner_user_id uuid,
  p_turn_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_renewed_id uuid;
  v_conversation_id uuid;
begin
  select conversation_id
  into v_conversation_id
  from public.ai_chat_turns
  where id = p_turn_id
    and organization_id = p_organization_id
    and owner_user_id = p_owner_user_id;

  if not found then
    return false;
  end if;

  perform 1
  from public.ai_conversations
  where id = v_conversation_id
    and organization_id = p_organization_id
    and owner_user_id = p_owner_user_id
  for update;

  if not found then
    return false;
  end if;

  update public.ai_chat_turns
  set lease_expires_at = now() + case mode
        when 'fast' then interval '2 minutes'
        when 'deep' then interval '6 minutes'
      end
  where id = p_turn_id
    and organization_id = p_organization_id
    and owner_user_id = p_owner_user_id
    and status in ('accepted', 'grounding', 'generating', 'validating')
    and cancel_requested_at is null
    and lease_expires_at > now()
  returning id into v_renewed_id;

  return v_renewed_id is not null;
end;
$$;

create or replace function public.finish_ai_chat_turn_v2(
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
  p_metadata jsonb
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_turn public.ai_chat_turns%rowtype;
  v_conversation_id uuid;
  v_effective_outcome text;
  v_terminal_status text;
  v_superseded_message_id uuid;
begin
  if p_ai_invocation_id is null
     or p_retryable is null
     or p_outcome is null
     or p_outcome not in ('complete', 'partial', 'blocked', 'failed', 'cancelled')
     or jsonb_typeof(coalesce(p_metadata, '{}'::jsonb)) <> 'object' then
    return false;
  end if;

  select conversation_id
  into v_conversation_id
  from public.ai_chat_turns
  where id = p_turn_id
    and organization_id = p_organization_id
    and owner_user_id = p_owner_user_id;

  if not found then
    return false;
  end if;

  perform 1
  from public.ai_conversations
  where id = v_conversation_id
    and organization_id = p_organization_id
    and owner_user_id = p_owner_user_id
  for update;

  if not found then
    return false;
  end if;

  perform 1
  from public.ai_invocations invocation
  where invocation.id = p_ai_invocation_id
    and invocation.organization_id = p_organization_id
    and invocation.actor_user_id = p_owner_user_id;

  if not found then
    return false;
  end if;

  select turn.*
  into v_turn
  from public.ai_chat_turns turn
  where turn.id = p_turn_id
    and turn.organization_id = p_organization_id
    and turn.owner_user_id = p_owner_user_id
  for update;

  if not found then
    return false;
  end if;

  v_effective_outcome := case
    when v_turn.cancel_requested_at is not null then 'cancelled'
    else p_outcome
  end;

  v_terminal_status := case
    when v_effective_outcome in ('complete', 'partial', 'blocked') then 'completed'
    when v_effective_outcome = 'failed' then 'failed'
    when v_effective_outcome = 'cancelled' then 'cancelled'
  end;

  if v_turn.status in ('completed', 'failed', 'cancelled') then
    return v_turn.status = v_terminal_status
      and v_turn.outcome = v_effective_outcome;
  end if;
  if v_turn.status not in ('accepted', 'grounding', 'generating', 'validating') then
    return false;
  end if;
  if v_effective_outcome <> 'cancelled' and (
    v_turn.lease_expires_at is null or v_turn.lease_expires_at <= now()
  ) then
    return false;
  end if;
  if v_turn.ai_invocation_id is not null
     and v_turn.ai_invocation_id is distinct from p_ai_invocation_id then
    return false;
  end if;
  if v_effective_outcome in ('complete', 'partial', 'blocked')
     and nullif(trim(coalesce(p_content, '')), '') is null then
    return false;
  end if;
  if v_effective_outcome = 'cancelled' and v_turn.cancel_requested_at is null then
    return false;
  end if;

  if v_terminal_status = 'completed' then
    with recursive regeneration_lineage as (
      select id, retry_of_turn_id, regenerate_of_turn_id
      from public.ai_chat_turns
      where id = v_turn.id

      union

      select parent.id, parent.retry_of_turn_id, parent.regenerate_of_turn_id
      from public.ai_chat_turns parent
      join regeneration_lineage child
        on parent.id = child.retry_of_turn_id
      where parent.conversation_id = v_turn.conversation_id
        and parent.organization_id = p_organization_id
        and parent.owner_user_id = p_owner_user_id
    )
    select source_turn.assistant_message_id
    into v_superseded_message_id
    from regeneration_lineage lineage
    join public.ai_chat_turns source_turn
      on source_turn.id = lineage.regenerate_of_turn_id
    where lineage.regenerate_of_turn_id is not null
    limit 1;

    if v_superseded_message_id is not null then
      update public.ai_chat_messages
      set status = 'superseded'
      where id = v_superseded_message_id
        and status = 'completed';
    end if;
  end if;

  update public.ai_chat_messages
  set status = case
        when v_terminal_status = 'completed' then 'completed'
        else 'failed'
      end,
      content = case
        when v_terminal_status = 'completed' then p_content
        else coalesce(p_content, '')
      end,
      ai_invocation_id = p_ai_invocation_id,
      metadata = coalesce(p_metadata, '{}'::jsonb)
        || jsonb_build_object('outcome', v_effective_outcome)
  where id = v_turn.assistant_message_id;

  update public.ai_chat_turns
  set status = v_terminal_status,
      outcome = v_effective_outcome,
      provider_name = p_provider_name,
      ai_invocation_id = p_ai_invocation_id,
      error_code = case
        when v_terminal_status = 'failed'
          then nullif(trim(coalesce(p_error_code, '')), '')
        when v_terminal_status = 'cancelled'
          then coalesce(nullif(trim(coalesce(p_error_code, '')), ''), 'turn_cancelled')
        else null
      end,
      error_summary = case
        when v_terminal_status in ('failed', 'cancelled')
          then nullif(trim(coalesce(p_error_summary, '')), '')
        else null
      end,
      retryable = case
        when v_terminal_status = 'failed' then p_retryable
        else false
      end,
      completed_at = now()
  where id = v_turn.id;

  update public.ai_hermes_run_capabilities
  set revoked_at = coalesce(revoked_at, now())
  where turn_id = v_turn.id;

  update public.ai_conversations
  set last_message_at = now()
  where id = v_turn.conversation_id;

  return true;
end;
$$;

revoke all on function public.refresh_ai_chat_turn_lease() from public, anon, authenticated;
revoke all on function public.ai_hermes_canonical_text_array_sha256(
  text[]
) from public, anon, authenticated;
revoke all on function public.ai_hermes_canonical_uuid_array_sha256(
  uuid[]
) from public, anon, authenticated;
revoke all on function public.validate_ai_hermes_run_capability_identity() from public, anon, authenticated;
revoke all on function public.validate_ai_hermes_memory_identity() from public, anon, authenticated;
revoke all on function public.validate_ai_hermes_skill_draft_identity() from public, anon, authenticated;
revoke all on function public.validate_ai_hermes_broker_call_identity() from public, anon, authenticated;
revoke all on function public.lock_and_validate_ai_hermes_capability_lineage(
  uuid, uuid, uuid, uuid, uuid, uuid, text, integer
) from public, anon, authenticated;
revoke all on function public.issue_ai_hermes_run_capability(
  text, uuid, uuid, uuid, uuid, uuid, uuid, text, text, text[], text, text[], text, text, uuid[], integer, boolean, timestamptz
) from public, anon, authenticated;
revoke all on function public.claim_ai_hermes_broker_call(
  text, text, uuid, text, text, text, jsonb
) from public, anon, authenticated;
revoke all on function public.complete_ai_hermes_broker_call(
  uuid, uuid, bigint, text, jsonb, text
) from public, anon, authenticated;
revoke all on function public.append_ai_hermes_tool_message(
  uuid, uuid, uuid, uuid, uuid, text, jsonb
) from public, anon, authenticated;
revoke all on function public.update_ai_conversation_hermes_state(
  uuid, uuid, uuid, integer, jsonb
) from public, anon, authenticated;
revoke all on function public.write_ai_hermes_memory_revision(
  uuid, uuid, text, uuid, integer, text, text, text, boolean, uuid, uuid, uuid
) from public, anon, authenticated;
revoke all on function public.write_ai_hermes_skill_draft(
  uuid, uuid, text, integer, jsonb, text, text, uuid, uuid
) from public, anon, authenticated;
revoke all on function public.review_ai_hermes_skill_draft(
  uuid, uuid, uuid, uuid, text, text, text, text
) from public, anon, authenticated;
revoke all on function public.cancel_ai_chat_turn(
  uuid, uuid, uuid, uuid
) from public, anon, authenticated;
revoke all on function public.renew_ai_chat_turn_lease(
  uuid, uuid, uuid
) from public, anon, authenticated;
revoke all on function public.finish_ai_chat_turn_v2(
  uuid, uuid, uuid, text, text, text, uuid, text, text, boolean, jsonb
) from public, anon, authenticated;

grant execute on function public.issue_ai_hermes_run_capability(
  text, uuid, uuid, uuid, uuid, uuid, uuid, text, text, text[], text, text[], text, text, uuid[], integer, boolean, timestamptz
) to service_role;
grant execute on function public.refresh_ai_chat_turn_lease() to service_role;
grant execute on function public.ai_hermes_canonical_text_array_sha256(
  text[]
) to service_role;
grant execute on function public.ai_hermes_canonical_uuid_array_sha256(
  uuid[]
) to service_role;
grant execute on function public.claim_ai_hermes_broker_call(
  text, text, uuid, text, text, text, jsonb
) to service_role;
grant execute on function public.complete_ai_hermes_broker_call(
  uuid, uuid, bigint, text, jsonb, text
) to service_role;
grant execute on function public.append_ai_hermes_tool_message(
  uuid, uuid, uuid, uuid, uuid, text, jsonb
) to service_role;
grant execute on function public.update_ai_conversation_hermes_state(
  uuid, uuid, uuid, integer, jsonb
) to service_role;
grant execute on function public.write_ai_hermes_memory_revision(
  uuid, uuid, text, uuid, integer, text, text, text, boolean, uuid, uuid, uuid
) to service_role;
grant execute on function public.write_ai_hermes_skill_draft(
  uuid, uuid, text, integer, jsonb, text, text, uuid, uuid
) to service_role;
grant execute on function public.review_ai_hermes_skill_draft(
  uuid, uuid, uuid, uuid, text, text, text, text
) to service_role;
grant execute on function public.cancel_ai_chat_turn(
  uuid, uuid, uuid, uuid
) to service_role;
grant execute on function public.renew_ai_chat_turn_lease(
  uuid, uuid, uuid
) to service_role;
grant execute on function public.finish_ai_chat_turn_v2(
  uuid, uuid, uuid, text, text, text, uuid, text, text, boolean, jsonb
) to service_role;

revoke all on table public.ai_hermes_run_capabilities from anon, authenticated;
revoke all on table public.ai_hermes_broker_calls from anon, authenticated;
revoke all on table public.ai_hermes_memories from anon, authenticated;
revoke all on table public.ai_hermes_skill_drafts from anon, authenticated;

grant select on table public.ai_hermes_memories to authenticated;
grant select on table public.ai_hermes_skill_drafts to authenticated;

grant all on table public.ai_hermes_run_capabilities to service_role;
grant all on table public.ai_hermes_broker_calls to service_role;
grant all on table public.ai_hermes_memories to service_role;
grant all on table public.ai_hermes_skill_drafts to service_role;
