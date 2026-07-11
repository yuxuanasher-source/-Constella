-- Xingyao AI assistant durable conversation protocol.
-- The product-owned ledger is authoritative; provider thread IDs are adapter metadata only.

create table public.ai_conversations (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  owner_user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null default '新会话',
  status text not null default 'active',
  summary jsonb not null default '{}'::jsonb,
  summary_version integer not null default 0,
  provider_state jsonb not null default '{}'::jsonb,
  last_message_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ai_conversations_identity_key unique (id, organization_id, owner_user_id),
  constraint ai_conversations_status_check check (status in ('active', 'archived')),
  constraint ai_conversations_title_length check (
    char_length(trim(title)) between 1 and 120
  ),
  constraint ai_conversations_summary_version_nonnegative check (summary_version >= 0)
);

create table public.ai_chat_messages (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  owner_user_id uuid not null references public.profiles(id) on delete cascade,
  conversation_id uuid not null,
  sequence_no bigint not null,
  role text not null,
  status text not null default 'pending',
  content text not null default '',
  parent_message_id uuid references public.ai_chat_messages(id) on delete set null,
  ai_invocation_id uuid references public.ai_invocations(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ai_chat_messages_conversation_owner_fkey
    foreign key (conversation_id, organization_id, owner_user_id)
    references public.ai_conversations(id, organization_id, owner_user_id)
    on delete cascade,
  constraint ai_chat_messages_conversation_sequence_key
    unique (conversation_id, sequence_no),
  constraint ai_chat_messages_identity_key
    unique (id, conversation_id, organization_id, owner_user_id),
  constraint ai_chat_messages_sequence_positive check (sequence_no > 0),
  constraint ai_chat_messages_role_check check (
    role in ('user', 'assistant', 'system', 'tool')
  ),
  constraint ai_chat_messages_status_check check (
    status in ('pending', 'streaming', 'completed', 'failed', 'superseded')
  ),
  constraint ai_chat_messages_completed_content check (
    status <> 'completed' or nullif(trim(content), '') is not null
  )
);

create table public.ai_chat_turns (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  owner_user_id uuid not null references public.profiles(id) on delete cascade,
  conversation_id uuid not null,
  user_message_id uuid not null,
  assistant_message_id uuid not null,
  mode text not null default 'fast',
  status text not null default 'accepted',
  idempotency_key text not null,
  retry_of_turn_id uuid references public.ai_chat_turns(id) on delete set null,
  regenerate_of_turn_id uuid references public.ai_chat_turns(id) on delete set null,
  context_snapshot jsonb not null default '{}'::jsonb,
  context_hash text,
  snapshot_version integer not null default 1,
  provider_name text,
  ai_invocation_id uuid references public.ai_invocations(id) on delete set null,
  error_code text,
  error_summary text,
  retryable boolean not null default true,
  attempt_no integer not null default 1,
  started_at timestamptz,
  completed_at timestamptz,
  lease_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ai_chat_turns_conversation_owner_fkey
    foreign key (conversation_id, organization_id, owner_user_id)
    references public.ai_conversations(id, organization_id, owner_user_id)
    on delete cascade,
  constraint ai_chat_turns_user_message_fkey
    foreign key (
      user_message_id,
      conversation_id,
      organization_id,
      owner_user_id
    ) references public.ai_chat_messages(
      id,
      conversation_id,
      organization_id,
      owner_user_id
    ) on delete cascade,
  constraint ai_chat_turns_assistant_message_fkey
    foreign key (
      assistant_message_id,
      conversation_id,
      organization_id,
      owner_user_id
    ) references public.ai_chat_messages(
      id,
      conversation_id,
      organization_id,
      owner_user_id
    ) on delete cascade,
  constraint ai_chat_turns_owner_idempotency_key
    unique (organization_id, owner_user_id, idempotency_key),
  constraint ai_chat_turns_mode_check check (mode in ('fast', 'deep')),
  constraint ai_chat_turns_status_check check (
    status in (
      'accepted',
      'grounding',
      'generating',
      'validating',
      'completed',
      'failed',
      'cancelled'
    )
  ),
  constraint ai_chat_turns_attempt_positive check (attempt_no > 0),
  constraint ai_chat_turns_snapshot_version_positive check (snapshot_version > 0),
  constraint ai_chat_turns_retry_regenerate_exclusive check (
    retry_of_turn_id is null or regenerate_of_turn_id is null
  )
);

create index ai_conversations_owner_recent_idx
  on public.ai_conversations (organization_id, owner_user_id, last_message_at desc);

create index ai_chat_messages_conversation_order_idx
  on public.ai_chat_messages (conversation_id, sequence_no);

create index ai_chat_turns_conversation_recent_idx
  on public.ai_chat_turns (conversation_id, created_at desc);

create unique index ai_chat_turns_one_active_per_conversation
  on public.ai_chat_turns (conversation_id)
  where status in ('accepted', 'grounding', 'generating', 'validating');

create unique index ai_chat_turns_one_retry_successor
  on public.ai_chat_turns (retry_of_turn_id)
  where retry_of_turn_id is not null;

create unique index ai_chat_turns_one_regenerate_successor
  on public.ai_chat_turns (regenerate_of_turn_id)
  where regenerate_of_turn_id is not null;

create or replace function public.refresh_ai_chat_turn_lease()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status in ('accepted', 'grounding', 'generating', 'validating') then
    new.lease_expires_at := now() + interval '2 minutes';
  else
    new.lease_expires_at := null;
  end if;
  return new;
end;
$$;

create trigger ai_chat_turns_refresh_lease
before insert or update of status on public.ai_chat_turns
for each row execute function public.refresh_ai_chat_turn_lease();

create trigger ai_conversations_touch_updated_at
before update on public.ai_conversations
for each row execute function public.touch_updated_at();

create trigger ai_chat_messages_touch_updated_at
before update on public.ai_chat_messages
for each row execute function public.touch_updated_at();

create trigger ai_chat_turns_touch_updated_at
before update on public.ai_chat_turns
for each row execute function public.touch_updated_at();

alter table public.ai_conversations enable row level security;
alter table public.ai_chat_messages enable row level security;
alter table public.ai_chat_turns enable row level security;

-- Authenticated clients may only read their own ledger. All writes and state
-- transitions are performed through server routes with the service role.
create policy ai_conversations_owner_access
on public.ai_conversations for select
using (
  owner_user_id = auth.uid()
  and public.is_org_member(organization_id)
);

create policy ai_chat_messages_owner_read
on public.ai_chat_messages for select
using (
  owner_user_id = auth.uid()
  and public.is_org_member(organization_id)
);

create policy ai_chat_turns_owner_read
on public.ai_chat_turns for select
using (
  owner_user_id = auth.uid()
  and public.is_org_member(organization_id)
);

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

create or replace function public.finish_ai_chat_turn(
  p_organization_id uuid,
  p_owner_user_id uuid,
  p_turn_id uuid,
  p_succeeded boolean,
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
set search_path = public
as $$
declare
  v_turn public.ai_chat_turns%rowtype;
  v_superseded_message_id uuid;
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

  select * into v_turn
  from public.ai_chat_turns
  where id = p_turn_id
    and organization_id = p_organization_id
    and owner_user_id = p_owner_user_id
  for update;

  if not found then
    return false;
  end if;

  if p_succeeded then
    if v_turn.status = 'completed' then
      return true;
    end if;
    if v_turn.status <> 'validating' then
      return false;
    end if;
    if nullif(trim(coalesce(p_content, '')), '') is null then
      return false;
    end if;

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

    update public.ai_chat_messages
    set status = 'completed',
        content = p_content,
        ai_invocation_id = p_ai_invocation_id,
        metadata = coalesce(p_metadata, '{}'::jsonb)
    where id = v_turn.assistant_message_id;

    update public.ai_chat_turns
    set status = 'completed',
        provider_name = p_provider_name,
        ai_invocation_id = p_ai_invocation_id,
        error_code = null,
        error_summary = null,
        retryable = false,
        completed_at = now()
    where id = v_turn.id;
  else
    if v_turn.status = 'failed' then
      return true;
    end if;
    if v_turn.status not in ('accepted', 'grounding', 'generating', 'validating') then
      return false;
    end if;

    update public.ai_chat_messages
    set status = 'failed',
        content = coalesce(p_content, ''),
        ai_invocation_id = p_ai_invocation_id,
        metadata = coalesce(p_metadata, '{}'::jsonb)
    where id = v_turn.assistant_message_id;

    update public.ai_chat_turns
    set status = 'failed',
        provider_name = p_provider_name,
        ai_invocation_id = p_ai_invocation_id,
        error_code = nullif(trim(coalesce(p_error_code, '')), ''),
        error_summary = nullif(trim(coalesce(p_error_summary, '')), ''),
        retryable = p_retryable,
        completed_at = now()
    where id = v_turn.id;
  end if;

  update public.ai_conversations
  set last_message_at = now()
  where id = v_turn.conversation_id;

  return true;
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
set search_path = public
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
  set lease_expires_at = now() + interval '2 minutes'
  where id = p_turn_id
    and organization_id = p_organization_id
    and owner_user_id = p_owner_user_id
    and status in ('accepted', 'grounding', 'generating', 'validating')
  returning id into v_renewed_id;

  return v_renewed_id is not null;
end;
$$;

revoke all on function public.create_ai_chat_turn(
  uuid, uuid, uuid, text, text, text, text, uuid
) from public, anon, authenticated;
revoke all on function public.finish_ai_chat_turn(
  uuid, uuid, uuid, boolean, text, text, uuid, text, text, boolean, jsonb
) from public, anon, authenticated;
revoke all on function public.renew_ai_chat_turn_lease(
  uuid, uuid, uuid
) from public, anon, authenticated;

grant execute on function public.create_ai_chat_turn(
  uuid, uuid, uuid, text, text, text, text, uuid
) to service_role;
grant execute on function public.finish_ai_chat_turn(
  uuid, uuid, uuid, boolean, text, text, uuid, text, text, boolean, jsonb
) to service_role;
grant execute on function public.renew_ai_chat_turn_lease(
  uuid, uuid, uuid
) to service_role;

revoke all on table public.ai_conversations from anon, authenticated;
revoke all on table public.ai_chat_messages from anon, authenticated;
revoke all on table public.ai_chat_turns from anon, authenticated;

grant select on table public.ai_conversations to authenticated;
grant select on table public.ai_chat_messages to authenticated;
grant select on table public.ai_chat_turns to authenticated;

grant all on table public.ai_conversations to service_role;
grant all on table public.ai_chat_messages to service_role;
grant all on table public.ai_chat_turns to service_role;
