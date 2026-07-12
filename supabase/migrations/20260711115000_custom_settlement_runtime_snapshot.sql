-- Task8 runtime primitives for settlement AI session claims and evidence reads.
-- Generic Xingyao conversations remain authoritative; this table only binds a
-- caller-owned idempotency key to one existing generic conversation.

create table public.custom_settlement_ai_sessions (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null,
  actor_id uuid not null references public.profiles(id) on delete cascade,
  client_request_id text not null,
  title text not null,
  request_fingerprint text not null,
  conversation_id uuid not null,
  created_at timestamptz not null default pg_catalog.now(),
  constraint custom_settlement_ai_sessions_project_scope_fkey
    foreign key (project_id, organization_id)
    references public.projects(id, organization_id)
    on delete cascade,
  constraint custom_settlement_ai_sessions_conversation_actor_fkey
    foreign key (
      conversation_id,
      organization_id,
      actor_id
    ) references public.ai_conversations(
      id,
      organization_id,
      owner_user_id
    ) on delete cascade,
  constraint custom_settlement_ai_sessions_conversation_project_fkey
    foreign key (
      conversation_id,
      organization_id,
      project_id
    ) references public.ai_conversations(
      id,
      organization_id,
      project_id
    ) on delete cascade,
  constraint custom_settlement_ai_sessions_request_key_check check (
    pg_catalog.char_length(client_request_id) between 8 and 128
    and client_request_id ~ '^[A-Za-z0-9._:-]+$'
  ),
  constraint custom_settlement_ai_sessions_title_check check (
    title = pg_catalog.btrim(title)
    and pg_catalog.char_length(title) between 1 and 120
  ),
  constraint custom_settlement_ai_sessions_fingerprint_check check (
    request_fingerprint ~ '^[0-9a-f]{64}$'
  ),
  constraint custom_settlement_ai_sessions_scope_request_key
    unique (organization_id, project_id, actor_id, client_request_id)
);

create unique index custom_settlement_ai_sessions_conversation_idx
  on public.custom_settlement_ai_sessions (conversation_id);

create index custom_settlement_ai_sessions_project_recent_idx
  on public.custom_settlement_ai_sessions (
    organization_id,
    project_id,
    created_at desc
  );

create index if not exists settlement_batches_runtime_snapshot_idx
  on public.settlement_batches (
    organization_id,
    project_id,
    status,
    period_start,
    period_end,
    id
  );

create index if not exists settlement_batch_items_runtime_snapshot_idx
  on public.settlement_batch_items (
    organization_id,
    project_id,
    settlement_batch_id,
    id
  );

create index if not exists live_reports_runtime_snapshot_idx
  on public.live_reports (
    organization_id,
    project_id,
    status,
    reviewed_at,
    id
  );

create index if not exists project_cost_items_runtime_snapshot_idx
  on public.project_cost_items (
    organization_id,
    project_id,
    status,
    created_at,
    id
  );

alter table public.custom_settlement_ai_sessions enable row level security;

-- No policies are intentional. The mapping is an implementation detail and
-- cannot be read or mutated directly by authenticated or service clients.
revoke all on table public.custom_settlement_ai_sessions
from public, anon, authenticated, service_role;

create or replace function public.custom_settlement_snapshot_numeric_text(
  p_value numeric
)
returns text
language sql
immutable
strict
set search_path = pg_catalog, public
as $$
  select pg_catalog.trim_scale(p_value)::text;
$$;

revoke all on function public.custom_settlement_snapshot_numeric_text(numeric)
from public, anon, authenticated, service_role;

create or replace function public.claim_custom_settlement_ai_session(
  p_organization_id uuid,
  p_project_id uuid,
  p_client_request_id text,
  p_title text,
  p_request_fingerprint text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor_id uuid := auth.uid();
  v_client_request_id text := p_client_request_id;
  v_title text := pg_catalog.btrim(p_title);
  v_request_fingerprint text := p_request_fingerprint;
  v_existing public.custom_settlement_ai_sessions%rowtype;
  v_conversation public.ai_conversations%rowtype;
begin
  if auth.uid() is null or v_actor_id is null then
    raise exception 'authentication_required';
  end if;
  if p_organization_id is null or p_project_id is null then
    raise exception 'custom_settlement_session_scope_invalid';
  end if;
  if v_client_request_id is null
     or pg_catalog.char_length(v_client_request_id) not between 8 and 128
     or v_client_request_id !~ '^[A-Za-z0-9._:-]+$'
     or v_title is null
     or pg_catalog.char_length(v_title) not between 1 and 120
     or p_request_fingerprint is null
     or p_request_fingerprint !~ '^[0-9a-f]{64}$' then
    raise exception 'custom_settlement_session_input_invalid';
  end if;
  if not public.is_org_member(p_organization_id)
     or public.current_user_role(p_organization_id) not in (
       'owner',
       'ops_manager',
       'operator_business'
     )
     or not public.can_access_project(p_project_id) then
    raise exception 'custom_settlement_session_access_denied';
  end if;

  perform public.settlement_ai_lock_authoring_parents(
    p_organization_id,
    v_actor_id,
    p_project_id
  );

  -- The advisory key serializes only equal idempotency claims. Parent locks
  -- above remain the canonical order for all implicit FK edges.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_organization_id::text || ':' ||
      p_project_id::text || ':' ||
      v_actor_id::text || ':' ||
      v_client_request_id,
      0
    )
  );

  select session.*
  into v_existing
  from public.custom_settlement_ai_sessions as session
  where session.organization_id = p_organization_id
    and session.project_id = p_project_id
    and session.actor_id = v_actor_id
    and session.client_request_id = v_client_request_id;

  if found then
    if v_existing.request_fingerprint is distinct from v_request_fingerprint
       or v_existing.title is distinct from v_title then
      raise exception 'custom_settlement_session_replay_mismatch';
    end if;

    select conversation.*
    into v_conversation
    from public.ai_conversations as conversation
    where conversation.id = v_existing.conversation_id
      and conversation.organization_id = p_organization_id
      and conversation.project_id = p_project_id
      and conversation.owner_user_id = v_actor_id
    for key share;
    if not found then
      raise exception 'custom_settlement_session_mapping_corrupt';
    end if;

    return pg_catalog.jsonb_build_object(
      'id', v_conversation.id,
      'title', v_conversation.title,
      'status', v_conversation.status,
      'last_message_at', v_conversation.last_message_at,
      'created_at', v_conversation.created_at,
      'updated_at', v_conversation.updated_at,
      'duplicate', true
    );
  end if;

  insert into public.ai_conversations (
    organization_id,
    owner_user_id,
    project_id,
    title
  ) values (
    p_organization_id,
    v_actor_id,
    p_project_id,
    v_title
  )
  returning * into v_conversation;

  insert into public.custom_settlement_ai_sessions (
    organization_id,
    project_id,
    actor_id,
    client_request_id,
    title,
    request_fingerprint,
    conversation_id
  ) values (
    p_organization_id,
    p_project_id,
    v_actor_id,
    v_client_request_id,
    v_title,
    v_request_fingerprint,
    v_conversation.id
  );

  return pg_catalog.jsonb_build_object(
    'id', v_conversation.id,
    'title', v_conversation.title,
    'status', v_conversation.status,
    'last_message_at', v_conversation.last_message_at,
    'created_at', v_conversation.created_at,
    'updated_at', v_conversation.updated_at,
    'duplicate', false
  );
end;
$$;

create or replace function public.read_custom_settlement_evidence_snapshot(
  p_organization_id uuid,
  p_project_id uuid,
  p_scope text,
  p_period_start date,
  p_period_end date,
  p_business_timezone text,
  p_business_timezone_source text,
  p_execution_grain text,
  p_max_sources integer,
  p_max_record_count integer
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor_id uuid := auth.uid();
  v_project public.projects%rowtype;
  v_window_start timestamptz;
  v_window_end timestamptz;
  v_captured_at timestamptz := pg_catalog.statement_timestamp();
  v_snapshot jsonb;
  v_source_count integer;
  v_record_count integer;
begin
  if auth.uid() is null or v_actor_id is null then
    raise exception 'authentication_required';
  end if;
  if p_organization_id is null
     or p_project_id is null
     or p_scope is null
     or p_scope not in ('payable', 'receivable') then
    raise exception 'custom_settlement_snapshot_scope_invalid';
  end if;
  if p_period_start is null
     or p_period_end is null
     or p_period_end < p_period_start
     or p_period_end - p_period_start > 365 then
    raise exception 'custom_settlement_snapshot_period_invalid';
  end if;
  if p_max_sources is null
     or p_max_sources < 1
     or p_max_sources > 10000 then
    raise exception 'custom_settlement_snapshot_max_sources_invalid';
  end if;
  if p_max_record_count is null
     or p_max_record_count < 1
     or p_max_record_count > 500 then
    raise exception 'custom_settlement_snapshot_max_record_count_invalid';
  end if;
  if p_business_timezone is null
     or p_business_timezone <> pg_catalog.btrim(p_business_timezone)
     or pg_catalog.char_length(p_business_timezone) < 1
     or pg_catalog.char_length(p_business_timezone) > 100
     or not exists (
       select 1
       from pg_catalog.pg_timezone_names as timezone_name
       where timezone_name.name = p_business_timezone
     ) then
    raise exception 'custom_settlement_snapshot_timezone_invalid';
  end if;
  if p_business_timezone_source is null
     or p_business_timezone_source not in (
       'contract_default',
       'organization_setting',
       'confirmed_contract'
     )
     or (
       p_business_timezone_source = 'contract_default'
       and p_business_timezone <> 'Asia/Shanghai'
     ) then
    raise exception 'custom_settlement_snapshot_timezone_source_invalid';
  end if;
  if p_execution_grain is null
     or p_execution_grain not in (
       'report',
       'project_streamer_period',
       'batch',
       'project_period'
     ) then
    raise exception 'custom_settlement_snapshot_execution_grain_invalid';
  end if;
  if not public.is_org_member(p_organization_id)
     or public.current_user_role(p_organization_id) not in (
       'owner',
       'ops_manager',
       'operator_business',
       'finance'
     )
     or not public.can_access_project(p_project_id) then
    raise exception 'custom_settlement_snapshot_access_denied';
  end if;

  perform public.settlement_ai_lock_authoring_parents(
    p_organization_id,
    v_actor_id,
    p_project_id
  );

  select project.*
  into v_project
  from public.projects as project
  where project.id = p_project_id
    and project.organization_id = p_organization_id;
  if not found then
    raise exception 'custom_settlement_snapshot_project_scope_mismatch';
  end if;

  v_window_start := p_period_start::timestamp
    at time zone p_business_timezone;
  v_window_end := (p_period_end + 1)::timestamp
    at time zone p_business_timezone;

  -- All arrays, counts, metadata, and the hash are materialized by this one
  -- bounded statement, so they share one READ COMMITTED statement snapshot.
  -- Child rows are not locked; attachment writers need not share an advisory
  -- protocol, and row locks here would reintroduce lock-order deadlocks.
  with selected_batches as materialized (
    select
      batch.id,
      batch.organization_id,
      batch.project_id,
      batch.title,
      batch.status,
      batch.batch_type,
      batch.period_start,
      batch.period_end,
      batch.computed_amount,
      batch.manual_amount,
      batch.adjustment_amount,
      batch.locked_at,
      batch.created_at,
      batch.updated_at,
      pg_catalog.encode(
        extensions.digest(
          pg_catalog.jsonb_build_object(
            'id', batch.id,
            'title', batch.title,
            'status', batch.status,
            'batchType', batch.batch_type,
            'periodStart', batch.period_start,
            'periodEnd', batch.period_end,
            'lockedAt', batch.locked_at,
            'updatedAt', batch.updated_at,
            'computedAmount', public.custom_settlement_snapshot_numeric_text(batch.computed_amount),
            'manualAmount', public.custom_settlement_snapshot_numeric_text(batch.manual_amount),
            'adjustmentAmount', public.custom_settlement_snapshot_numeric_text(batch.adjustment_amount)
          )::text,
          'sha256'
        ),
        'hex'
      ) as version
    from public.settlement_batches as batch
    where batch.organization_id = p_organization_id
      and batch.project_id = p_project_id
      and batch.status = 'locked'
      and batch.batch_type in ('payable', 'receivable')
      and batch.period_start <= p_period_end
      and batch.period_end >= p_period_start
    order by batch.period_start, batch.period_end, batch.batch_type, batch.id
    limit p_max_sources + 1
  ),
  requested_batches as materialized (
    select
      batch.id,
      batch.organization_id,
      batch.project_id,
      batch.title,
      batch.status,
      batch.batch_type,
      batch.period_start,
      batch.period_end,
      batch.computed_amount,
      batch.manual_amount,
      batch.adjustment_amount,
      batch.locked_at,
      batch.created_at,
      batch.updated_at,
      batch.version
    from selected_batches as batch
    where batch.batch_type::text = p_scope
  ),
  selected_items as materialized (
    select
      item.id,
      item.organization_id,
      item.project_id,
      item.settlement_batch_id,
      item.streamer_id,
      item.live_report_id,
      item.item_type,
      item.computed_amount,
      item.manual_amount,
      item.adjustment_amount,
      item.evidence_level,
      item.created_at
    from public.settlement_batch_items as item
    join selected_batches as batch
      on batch.id = item.settlement_batch_id
    where item.organization_id = p_organization_id
      and item.project_id = p_project_id
    order by item.settlement_batch_id, item.id
    limit p_max_sources + 1
  ),
  requested_items as materialized (
    select
      item.id,
      item.organization_id,
      item.project_id,
      item.settlement_batch_id,
      item.streamer_id,
      item.live_report_id,
      item.item_type,
      item.computed_amount,
      item.manual_amount,
      item.adjustment_amount,
      item.evidence_level,
      item.created_at
    from selected_items as item
    join requested_batches as batch
      on batch.id = item.settlement_batch_id
  ),
  selected_reports as materialized (
    select
      report.id,
      report.organization_id,
      report.project_id,
      report.live_task_id,
      report.streamer_id,
      report.status,
      report.system_duration,
      report.screenshot_duration,
      report.settlement_duration,
      report.evidence_level,
      report.time_source,
      report.viewers,
      report.reviewed_at,
      report.created_at,
      report.settled_batch_item_id,
      task.system_started_at
    from public.live_reports as report
    join public.live_tasks as task
      on task.id = report.live_task_id
     and task.organization_id = report.organization_id
     and task.project_id = report.project_id
    where report.organization_id = p_organization_id
      and report.project_id = p_project_id
      and report.status = 'approved'
      and (
        exists (
          select 1
          from selected_items as item
          where item.live_report_id = report.id
        )
        or (
          not exists (select 1 from requested_batches)
          and
          report.reviewed_at >= v_window_start
          and report.reviewed_at < v_window_end
        )
      )
    order by report.reviewed_at, report.id
    limit p_max_sources + 1
  ),
  effective_reports as materialized (
    select
      report.id,
      report.organization_id,
      report.project_id,
      report.live_task_id,
      report.streamer_id,
      report.status,
      report.system_duration,
      report.screenshot_duration,
      report.settlement_duration,
      report.evidence_level,
      report.time_source,
      report.viewers,
      report.reviewed_at,
      report.created_at,
      report.settled_batch_item_id,
      report.system_started_at
    from selected_reports as report
    where (
      exists (select 1 from requested_batches)
      and exists (
        select 1
        from requested_items as item
        where item.live_report_id = report.id
      )
    ) or (
      not exists (select 1 from requested_batches)
      and report.reviewed_at >= v_window_start
      and report.reviewed_at < v_window_end
    )
  ),
  selected_costs as materialized (
    select
      cost.id,
      cost.organization_id,
      cost.project_id,
      cost.streamer_id,
      cost.live_report_id,
      cost.settlement_batch_id,
      cost.amount_cents,
      cost.direction,
      cost.status,
      cost.created_at
    from public.project_cost_items as cost
    where cost.organization_id = p_organization_id
      and cost.project_id = p_project_id
      and cost.status = 'confirmed'
      and (
        (
          (
            cost.live_report_id is not null
            or cost.settlement_batch_id is not null
          )
          and (
            cost.live_report_id is null
            or exists (
              select 1
              from selected_reports as report
              where report.id = cost.live_report_id
            )
          )
          and (
            cost.settlement_batch_id is null
            or exists (
              select 1
              from selected_batches as batch
              where batch.id = cost.settlement_batch_id
            )
          )
        )
        or (
          cost.live_report_id is null
          and cost.settlement_batch_id is null
          and cost.created_at >= v_window_start
          and cost.created_at < v_window_end
        )
      )
    order by cost.created_at, cost.id
    limit p_max_sources + 1
  ),
  selected_streamer_ids as materialized (
    select report.streamer_id as id from selected_reports as report
    union
    select item.streamer_id from selected_items as item
    where item.streamer_id is not null
    union
    select cost.streamer_id from selected_costs as cost
    where cost.streamer_id is not null
  ),
  selected_project_streamers as materialized (
    select
      project_streamer.id,
      project_streamer.organization_id,
      project_streamer.project_id,
      project_streamer.streamer_id,
      project_streamer.status,
      project_streamer.hourly_rate,
      project_streamer.base_salary,
      project_streamer.cps_rate_bps,
      project_streamer.collaboration_id,
      streamer.source_type
    from public.project_streamers as project_streamer
    join selected_streamer_ids as selected_streamer
      on selected_streamer.id = project_streamer.streamer_id
    join public.streamers as streamer
      on streamer.id = project_streamer.streamer_id
     and streamer.organization_id = project_streamer.organization_id
    where project_streamer.organization_id = p_organization_id
      and project_streamer.project_id = p_project_id
    order by project_streamer.streamer_id, project_streamer.id
    limit p_max_sources + 1
  ),
  selected_streamers as materialized (
    select streamer.id, streamer.organization_id, streamer.source_type
    from public.streamers as streamer
    join selected_streamer_ids as selected_streamer
      on selected_streamer.id = streamer.id
    where streamer.organization_id = p_organization_id
    order by streamer.id
    limit p_max_sources + 1
  ),
  selected_tasks as materialized (
    select task.id, task.organization_id, task.project_id,
      task.streamer_id, task.system_started_at
    from public.live_tasks as task
    where task.id in (select report.live_task_id from selected_reports as report)
    order by task.id
    limit p_max_sources + 1
  ),
  source_counts as materialized (
    select
      (select pg_catalog.count(*) from selected_batches)::integer
        as settlement_batches,
      (select pg_catalog.count(*) from selected_items)::integer
        as settlement_batch_items,
      (select pg_catalog.count(*) from selected_reports)::integer
        as live_reports,
      (select pg_catalog.count(*) from selected_tasks)::integer
        as live_tasks,
      (select pg_catalog.count(*) from selected_costs)::integer
        as project_cost_items,
      (select pg_catalog.count(*) from selected_project_streamers)::integer
        as project_streamers,
      (select pg_catalog.count(*) from selected_streamers)::integer
        as streamers
  ),
  record_counts as materialized (
    select
      case p_execution_grain
        when 'report' then
          (select pg_catalog.count(*) from effective_reports)
        when 'project_streamer_period' then
          (
            select pg_catalog.count(*)
            from (
              select report.streamer_id
              from effective_reports as report
              union
              select item.streamer_id
              from requested_items as item
              where item.live_report_id is null
                and item.streamer_id is not null
            ) as selected_record_streamers
          )
        when 'batch' then
          case
            when not exists (select 1 from requested_batches) then
              (select pg_catalog.count(*) from effective_reports)
            else (
              select pg_catalog.count(*)
              from requested_batches as batch
              where exists (
                select 1
                from requested_items as item
                where item.settlement_batch_id = batch.id
              )
            )
          end
        when 'project_period' then
          case
            when exists (select 1 from effective_reports)
              or exists (select 1 from requested_items)
            then 1
            else 0
          end
      end::integer as record_count
  ),
  selection_guard as materialized (
    select
      source_counts.settlement_batches,
      source_counts.settlement_batch_items,
      source_counts.live_reports,
      source_counts.live_tasks,
      source_counts.project_cost_items,
      source_counts.project_streamers,
      source_counts.streamers,
      (
        source_counts.settlement_batches +
        source_counts.settlement_batch_items +
        source_counts.live_reports +
        source_counts.live_tasks +
        source_counts.project_cost_items +
        source_counts.project_streamers +
        source_counts.streamers
      )::integer as source_count,
      record_counts.record_count,
      (
        source_counts.settlement_batches +
        source_counts.settlement_batch_items +
        source_counts.live_reports +
        source_counts.live_tasks +
        source_counts.project_cost_items +
        source_counts.project_streamers +
        source_counts.streamers
      ) <= p_max_sources
      and record_counts.record_count <= p_max_record_count as within_limits
    from source_counts
    cross join record_counts
  ),
  batch_payload as materialized (
    select coalesce(
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'id', batch.id,
          'organization_id', batch.organization_id,
          'project_id', batch.project_id,
          'title', batch.title,
          'status', batch.status,
          'batch_type', batch.batch_type,
          'period_start', batch.period_start,
          'period_end', batch.period_end,
          'computed_amount', public.custom_settlement_snapshot_numeric_text(batch.computed_amount),
          'manual_amount', public.custom_settlement_snapshot_numeric_text(batch.manual_amount),
          'adjustment_amount', public.custom_settlement_snapshot_numeric_text(batch.adjustment_amount),
          'locked_at', batch.locked_at,
          'created_at', batch.created_at,
          'updated_at', batch.updated_at,
          'version', batch.version
        ) order by batch.period_start, batch.period_end, batch.batch_type, batch.id
      ),
      '[]'::jsonb
    ) as value
    from selected_batches as batch
    cross join selection_guard
    where selection_guard.within_limits
  ),
  item_payload as materialized (
    select coalesce(
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'id', item.id,
          'organization_id', item.organization_id,
          'project_id', item.project_id,
          'settlement_batch_id', item.settlement_batch_id,
          'streamer_id', item.streamer_id,
          'live_report_id', item.live_report_id,
          'item_type', item.item_type,
          'computed_amount', public.custom_settlement_snapshot_numeric_text(item.computed_amount),
          'manual_amount', public.custom_settlement_snapshot_numeric_text(item.manual_amount),
          'adjustment_amount', public.custom_settlement_snapshot_numeric_text(item.adjustment_amount),
          'evidence_level', item.evidence_level,
          'created_at', item.created_at,
          'settlement_batches', pg_catalog.jsonb_build_object(
            'id', batch.id,
            'status', batch.status,
            'batch_type', batch.batch_type,
            'locked_at', batch.locked_at,
            'period_start', batch.period_start,
            'period_end', batch.period_end,
            'version', batch.version
          )
        ) order by item.settlement_batch_id, item.id
      ),
      '[]'::jsonb
    ) as value
    from selected_items as item
    join selected_batches as batch on batch.id = item.settlement_batch_id
    cross join selection_guard
    where selection_guard.within_limits
  ),
  report_payload as materialized (
    select coalesce(
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'id', report.id,
          'organization_id', report.organization_id,
          'project_id', report.project_id,
          'live_task_id', report.live_task_id,
          'streamer_id', report.streamer_id,
          'status', report.status,
          'system_duration', report.system_duration,
          'screenshot_duration', report.screenshot_duration,
          'settlement_duration', report.settlement_duration,
          'evidence_level', report.evidence_level,
          'time_source', report.time_source,
          'viewers', report.viewers,
          'reviewed_at', report.reviewed_at,
          'created_at', report.created_at,
          'settled_batch_item_id', report.settled_batch_item_id,
          'live_tasks', pg_catalog.jsonb_build_object(
            'system_started_at', report.system_started_at
          )
        ) order by report.reviewed_at, report.id
      ),
      '[]'::jsonb
    ) as value
    from selected_reports as report
    cross join selection_guard
    where selection_guard.within_limits
  ),
  cost_payload as materialized (
    select coalesce(
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'id', cost.id,
          'organization_id', cost.organization_id,
          'project_id', cost.project_id,
          'streamer_id', cost.streamer_id,
          'live_report_id', cost.live_report_id,
          'settlement_batch_id', cost.settlement_batch_id,
          'amount_cents', cost.amount_cents::text,
          'direction', cost.direction,
          'status', cost.status,
          'created_at', cost.created_at
        ) order by cost.created_at, cost.id
      ),
      '[]'::jsonb
    ) as value
    from selected_costs as cost
    cross join selection_guard
    where selection_guard.within_limits
  ),
  project_streamer_payload as materialized (
    select coalesce(
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'id', project_streamer.id,
          'organization_id', project_streamer.organization_id,
          'project_id', project_streamer.project_id,
          'streamer_id', project_streamer.streamer_id,
          'status', project_streamer.status,
          'hourly_rate', case
            when project_streamer.hourly_rate is null then null
            else public.custom_settlement_snapshot_numeric_text(project_streamer.hourly_rate)
          end,
          'base_salary', case
            when project_streamer.base_salary is null then null
            else public.custom_settlement_snapshot_numeric_text(project_streamer.base_salary)
          end,
          'cps_rate_bps', project_streamer.cps_rate_bps,
          'collaboration_id', project_streamer.collaboration_id,
          'streamers', pg_catalog.jsonb_build_object(
            'source_type', project_streamer.source_type
          )
        ) order by project_streamer.streamer_id, project_streamer.id
      ),
      '[]'::jsonb
    ) as value
    from selected_project_streamers as project_streamer
    cross join selection_guard
    where selection_guard.within_limits
  ),
  streamer_payload as materialized (
    select coalesce(
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'id', streamer.id,
          'organization_id', streamer.organization_id,
          'source_type', streamer.source_type
        ) order by streamer.id
      ),
      '[]'::jsonb
    ) as value
    from selected_streamers as streamer
    cross join selection_guard
    where selection_guard.within_limits
  ),
  base_payload as materialized (
    select
      selection_guard.source_count,
      selection_guard.record_count,
      case
      when selection_guard.within_limits then pg_catalog.jsonb_build_object(
        'schema_version', 1,
        'snapshot_version', 1,
        'organization_id', p_organization_id,
        'project_id', p_project_id,
        'actor_id', v_actor_id,
        'scope', p_scope,
        'period_start', p_period_start,
        'period_end', p_period_end,
        'business_timezone', p_business_timezone,
        'business_timezone_confirmed', true,
        'business_timezone_source', p_business_timezone_source,
        'captured_at', v_captured_at,
        'source_count', selection_guard.source_count,
        'source_counts', pg_catalog.jsonb_build_object(
          'settlement_batches', selection_guard.settlement_batches,
          'settlement_batch_items', selection_guard.settlement_batch_items,
          'live_reports', selection_guard.live_reports,
          'live_tasks', selection_guard.live_tasks,
          'project_cost_items', selection_guard.project_cost_items,
          'project_streamers', selection_guard.project_streamers,
          'streamers', selection_guard.streamers,
          'total', selection_guard.source_count
        ),
        'record_count', selection_guard.record_count,
        'project', pg_catalog.jsonb_build_object(
          'id', v_project.id,
          'organization_id', v_project.organization_id,
          'code', v_project.code,
          'name', v_project.name,
          'status', v_project.status,
          'updated_at', v_project.updated_at,
          'business_timezone', p_business_timezone,
          'business_timezone_confirmed', true,
          'business_timezone_source', p_business_timezone_source
        ),
        'settlement_batches', batch_payload.value,
        'settlement_batch_items', item_payload.value,
        'live_reports', report_payload.value,
        'project_cost_items', cost_payload.value,
        'project_streamers', project_streamer_payload.value,
        'streamers', streamer_payload.value
      )
      else pg_catalog.jsonb_build_object(
        '__limit_exceeded', true,
        'source_count', selection_guard.source_count,
        'record_count', selection_guard.record_count
      )
      end as payload
    from selection_guard
    cross join batch_payload
    cross join item_payload
    cross join report_payload
    cross join cost_payload
    cross join project_streamer_payload
    cross join streamer_payload
  )
  select
    base_payload.payload || pg_catalog.jsonb_build_object(
      'snapshot_hash',
      pg_catalog.encode(
        extensions.digest(base_payload.payload::text, 'sha256'),
        'hex'
      )
    ),
    base_payload.source_count,
    base_payload.record_count
  into v_snapshot, v_source_count, v_record_count
  from base_payload;

  if v_source_count > p_max_sources then
    raise exception 'custom_settlement_snapshot_source_limit_exceeded';
  end if;
  if v_record_count > p_max_record_count then
    raise exception 'custom_settlement_snapshot_record_limit_exceeded';
  end if;
  if coalesce((v_snapshot ->> '__limit_exceeded')::boolean, false) then
    raise exception 'custom_settlement_snapshot_limit_exceeded';
  end if;

  return v_snapshot;
end;
$$;

revoke all on function public.claim_custom_settlement_ai_session(
  uuid,
  uuid,
  text,
  text,
  text
) from public, anon, authenticated, service_role;
grant execute on function public.claim_custom_settlement_ai_session(
  uuid,
  uuid,
  text,
  text,
  text
) to authenticated;

revoke all on function public.read_custom_settlement_evidence_snapshot(
  uuid,
  uuid,
  text,
  date,
  date,
  text,
  text,
  text,
  integer,
  integer
) from public, anon, authenticated, service_role;
grant execute on function public.read_custom_settlement_evidence_snapshot(
  uuid,
  uuid,
  text,
  date,
  date,
  text,
  text,
  text,
  integer,
  integer
) to authenticated;

-- custom_settlement_runtime_self_checks
do $$
declare
  v_owner_id uuid := '8f110000-0000-4000-8000-000000000001';
  v_finance_id uuid := '8f110000-0000-4000-8000-000000000002';
  v_streamer_user_id uuid := '8f110000-0000-4000-8000-000000000003';
  v_organization_id uuid := '8f120000-0000-4000-8000-000000000001';
  v_project_id uuid := '8f130000-0000-4000-8000-000000000001';
  v_empty_project_id uuid := '8f130000-0000-4000-8000-000000000002';
  v_streamer_id uuid := '8f140000-0000-4000-8000-000000000001';
  v_project_streamer_id uuid := '8f150000-0000-4000-8000-000000000001';
  v_task_id uuid := '8f160000-0000-4000-8000-000000000001';
  v_report_id uuid := '8f170000-0000-4000-8000-000000000001';
  v_payable_batch_id uuid := '8f180000-0000-4000-8000-000000000001';
  v_receivable_batch_id uuid := '8f180000-0000-4000-8000-000000000002';
  v_linked_item_id uuid := '8f190000-0000-4000-8000-000000000001';
  v_manual_item_id uuid := '8f190000-0000-4000-8000-000000000002';
  v_linked_cost_id uuid := '8f1a0000-0000-4000-8000-000000000001';
  v_unlinked_cost_id uuid := '8f1a0000-0000-4000-8000-000000000002';
  v_claim jsonb;
  v_replay jsonb;
  v_snapshot jsonb;
  v_empty_snapshot jsonb;
  v_error text;
begin
  insert into auth.users (id, email) values
    (v_owner_id, 'task8-runtime-owner@example.invalid'),
    (v_finance_id, 'task8-runtime-finance@example.invalid'),
    (v_streamer_user_id, 'task8-runtime-streamer@example.invalid');

  insert into public.profiles (id, email, full_name) values
    (v_owner_id, 'task8-runtime-owner@example.invalid', 'Task8 Runtime Owner'),
    (v_finance_id, 'task8-runtime-finance@example.invalid', 'Task8 Runtime Finance'),
    (v_streamer_user_id, 'task8-runtime-streamer@example.invalid', 'Task8 Runtime Streamer');

  insert into public.organizations (id, name, code) values (
    v_organization_id,
    'Task8 Runtime Self Check',
    'task8-runtime-self-check'
  );

  insert into public.organization_members (
    organization_id,
    user_id,
    role,
    status
  ) values
    (v_organization_id, v_owner_id, 'owner', 'active'),
    (v_organization_id, v_finance_id, 'finance', 'active'),
    (v_organization_id, v_streamer_user_id, 'streamer', 'active');

  insert into public.projects (
    id,
    organization_id,
    code,
    name,
    created_by,
    owner_id
  ) values
    (
      v_project_id,
      v_organization_id,
      'task8-runtime-source',
      'Task8 Runtime Source',
      v_owner_id,
      v_owner_id
    ),
    (
      v_empty_project_id,
      v_organization_id,
      'task8-runtime-empty',
      'Task8 Runtime Empty',
      v_owner_id,
      v_owner_id
    );

  insert into public.streamers (
    id,
    organization_id,
    user_id,
    display_name,
    source_type,
    created_by
  ) values (
    v_streamer_id,
    v_organization_id,
    v_streamer_user_id,
    'Task8 Runtime Streamer',
    'external',
    v_owner_id
  );

  insert into public.project_streamers (
    id,
    organization_id,
    project_id,
    streamer_id,
    status,
    joined_at,
    settlement_method,
    hourly_rate,
    base_salary,
    cps_rate_bps,
    created_by
  ) values (
    v_project_streamer_id,
    v_organization_id,
    v_project_id,
    v_streamer_id,
    'joined',
    '2026-07-01T00:00:00Z'::timestamptz,
    'cpt',
    123.40,
    5000.00,
    1250,
    v_owner_id
  );

  insert into public.live_tasks (
    id,
    organization_id,
    project_id,
    streamer_id,
    title,
    status,
    system_started_at,
    system_stopped_at,
    system_duration,
    created_by
  ) values (
    v_task_id,
    v_organization_id,
    v_project_id,
    v_streamer_id,
    'Task8 Runtime Live',
    'completed',
    '2026-07-02T02:00:00Z'::timestamptz,
    '2026-07-02T03:00:00Z'::timestamptz,
    3600,
    v_owner_id
  );

  insert into public.live_reports (
    id,
    organization_id,
    live_task_id,
    project_id,
    streamer_id,
    status,
    system_duration,
    screenshot_duration,
    settlement_duration,
    time_source,
    evidence_level,
    viewers,
    reviewed_by,
    reviewed_at,
    created_by
  ) values (
    v_report_id,
    v_organization_id,
    v_task_id,
    v_project_id,
    v_streamer_id,
    'approved',
    3600,
    3580,
    3600,
    'system',
    'green',
    4200,
    v_owner_id,
    '2026-07-02T04:00:00Z'::timestamptz,
    v_owner_id
  );

  insert into public.settlement_batches (
    id,
    organization_id,
    project_id,
    batch_type,
    status,
    period_start,
    period_end,
    computed_amount,
    locked_at,
    created_by,
    title
  ) values
    (
      v_payable_batch_id,
      v_organization_id,
      v_project_id,
      'payable',
      'locked',
      '2026-07-01'::date,
      '2026-07-31'::date,
      123.40,
      '2026-08-01T00:00:00Z'::timestamptz,
      v_owner_id,
      'Task8 Payable'
    ),
    (
      v_receivable_batch_id,
      v_organization_id,
      v_project_id,
      'receivable',
      'locked',
      '2026-07-01'::date,
      '2026-07-31'::date,
      200.00,
      '2026-08-01T00:00:00Z'::timestamptz,
      v_owner_id,
      'Task8 Receivable'
    );

  insert into public.settlement_batch_items (
    id,
    organization_id,
    settlement_batch_id,
    project_id,
    streamer_id,
    live_report_id,
    item_type,
    computed_amount,
    evidence_level
  ) values
    (
      v_linked_item_id,
      v_organization_id,
      v_payable_batch_id,
      v_project_id,
      v_streamer_id,
      v_report_id,
      'live_report',
      123.40,
      'green'
    ),
    (
      v_manual_item_id,
      v_organization_id,
      v_receivable_batch_id,
      v_project_id,
      v_streamer_id,
      null,
      'manual',
      200.00,
      'yellow'
    );

  insert into public.project_cost_items (
    id,
    organization_id,
    project_id,
    streamer_id,
    live_report_id,
    settlement_batch_id,
    item_type,
    amount_cents,
    direction,
    evidence_level,
    source,
    reason,
    status,
    created_by,
    created_at
  ) values
    (
      v_linked_cost_id,
      v_organization_id,
      v_project_id,
      v_streamer_id,
      v_report_id,
      null,
      'manual',
      9007199254740993,
      'cost',
      'green',
      'manual',
      'Task8 linked cost',
      'confirmed',
      v_owner_id,
      '2025-01-01T00:00:00Z'::timestamptz
    ),
    (
      v_unlinked_cost_id,
      v_organization_id,
      v_project_id,
      v_streamer_id,
      null,
      null,
      'manual',
      42,
      'adjustment',
      'yellow',
      'manual',
      'Task8 fallback cost',
      'confirmed',
      v_owner_id,
      '2026-07-03T00:00:00Z'::timestamptz
    );

  perform pg_catalog.set_config(
    'request.jwt.claim.sub',
    v_owner_id::text,
    true
  );
  v_claim := public.claim_custom_settlement_ai_session(
    v_organization_id,
    v_project_id,
    'task8-runtime-claim-0001',
    'Task8 Runtime Session',
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  );
  if (v_claim ->> 'duplicate')::boolean
     or v_claim ->> 'id' is null
     or (
       select pg_catalog.count(*)
       from pg_catalog.jsonb_object_keys(v_claim)
     ) <> 7 then
    raise exception 'runtime_claim_initial_failed';
  end if;

  v_replay := public.claim_custom_settlement_ai_session(
    v_organization_id,
    v_project_id,
    'task8-runtime-claim-0001',
    'Task8 Runtime Session',
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  );
  if not (v_replay ->> 'duplicate')::boolean
     or v_replay ->> 'id' is distinct from v_claim ->> 'id' then
    raise exception 'runtime_claim_duplicate_failed';
  end if;

  begin
    perform public.claim_custom_settlement_ai_session(
      v_organization_id,
      v_project_id,
      'task8-runtime-claim-0001',
      'Task8 Runtime Session',
      'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
    );
    raise exception 'runtime_claim_mismatch_accepted';
  exception
    when others then
      if sqlerrm = 'runtime_claim_mismatch_accepted' then
        raise;
      end if;
  end;

  begin
    perform public.claim_custom_settlement_ai_session(
      v_organization_id,
      v_project_id,
      'task8-runtime-claim-0001',
      'Task8 Runtime Different Title',
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    );
    raise exception 'runtime_claim_title_mismatch_accepted';
  exception
    when others then
      if sqlerrm = 'runtime_claim_title_mismatch_accepted' then
        raise;
      end if;
  end;

  perform pg_catalog.set_config(
    'request.jwt.claim.sub',
    v_finance_id::text,
    true
  );
  begin
    perform public.claim_custom_settlement_ai_session(
      v_organization_id,
      v_project_id,
      'task8-runtime-finance-0001',
      'Finance Must Not Claim',
      'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'
    );
    raise exception 'runtime_finance_claim_accepted';
  exception
    when others then
      if sqlerrm = 'runtime_finance_claim_accepted' then
        raise;
      end if;
  end;

  v_snapshot := public.read_custom_settlement_evidence_snapshot(
    v_organization_id,
    v_project_id,
    'payable',
    '2026-07-01'::date,
    '2026-07-31'::date,
    'Asia/Shanghai',
    'contract_default',
    'report',
    10000,
    500
  );
  if pg_catalog.jsonb_array_length(v_snapshot -> 'settlement_batches') <> 2
     or pg_catalog.jsonb_array_length(v_snapshot -> 'settlement_batch_items') <> 2
     or pg_catalog.jsonb_array_length(v_snapshot -> 'live_reports') <> 1
     or pg_catalog.jsonb_array_length(v_snapshot -> 'project_cost_items') <> 2
     or (v_snapshot #>> '{source_counts,live_reports}')::integer <> 1
     or (v_snapshot #>> '{source_counts,live_tasks}')::integer <> 1
     or (v_snapshot #>> '{source_counts,total}')::integer
       <> (v_snapshot ->> 'source_count')::integer
     or (v_snapshot ->> 'record_count')::integer <> 1
     or v_snapshot ->> 'business_timezone' <> 'Asia/Shanghai'
     or v_snapshot ->> 'business_timezone_source' <> 'contract_default'
     or exists (
       select 1
       from pg_catalog.jsonb_array_elements(
         v_snapshot -> 'settlement_batch_items'
       ) as item(value)
       join pg_catalog.jsonb_array_elements(
         v_snapshot -> 'settlement_batches'
       ) as batch(value)
         on batch.value ->> 'id' = item.value ->> 'settlement_batch_id'
       where item.value #>> '{settlement_batches,version}'
         is distinct from batch.value ->> 'version'
     ) then
    raise exception 'runtime_finance_snapshot_failed';
  end if;
  if pg_catalog.jsonb_typeof(
    v_snapshot #> '{project_cost_items,0,amount_cents}'
  ) <> 'string'
     or not exists (
       select 1
       from pg_catalog.jsonb_array_elements(
         v_snapshot -> 'project_cost_items'
       ) as cost(value)
       where cost.value ->> 'amount_cents' = '9007199254740993'
     ) then
    raise exception 'runtime_snapshot_amount_not_text';
  end if;
  if v_snapshot ->> 'snapshot_hash' is distinct from pg_catalog.encode(
    extensions.digest((v_snapshot - 'snapshot_hash')::text, 'sha256'),
    'hex'
  ) then
    raise exception 'runtime_snapshot_hash_mismatch';
  end if;

  begin
    perform public.read_custom_settlement_evidence_snapshot(
      v_organization_id,
      v_empty_project_id,
      null,
      '2026-07-01'::date,
      '2026-07-31'::date,
      'Asia/Shanghai',
      'contract_default',
      'report',
      10000,
      500
    );
    raise exception 'runtime_snapshot_null_scope_accepted';
  exception
    when others then
      if sqlerrm = 'runtime_snapshot_null_scope_accepted' then
        raise;
      end if;
  end;

  perform public.read_custom_settlement_evidence_snapshot(
    v_organization_id,
    v_empty_project_id,
    'payable',
    '2025-01-01'::date,
    '2026-01-01'::date,
    'Asia/Shanghai',
    'contract_default',
    'report',
    10000,
    500
  );

  begin
    perform public.read_custom_settlement_evidence_snapshot(
      v_organization_id,
      v_empty_project_id,
      'payable',
      '2025-01-01'::date,
      '2026-01-02'::date,
      'Asia/Shanghai',
      'contract_default',
      'report',
      10000,
      500
    );
    raise exception 'runtime_snapshot_367_day_period_accepted';
  exception
    when others then
      if sqlerrm = 'runtime_snapshot_367_day_period_accepted' then
        raise;
      end if;
  end;

  begin
    perform public.read_custom_settlement_evidence_snapshot(
      v_organization_id,
      v_project_id,
      'payable',
      '2026-07-01'::date,
      '2026-07-31'::date,
      'Asia/Shanghai',
      'contract_default',
      'report',
      1,
      500
    );
    raise exception 'runtime_snapshot_limit_accepted';
  exception
    when others then
      if sqlerrm = 'runtime_snapshot_limit_accepted' then
        raise;
      end if;
  end;

  v_empty_snapshot := public.read_custom_settlement_evidence_snapshot(
    v_organization_id,
    v_empty_project_id,
    'receivable',
    '2026-07-01'::date,
    '2026-07-31'::date,
    'Asia/Shanghai',
    'contract_default',
    'report',
    10000,
    500
  );
  if (v_empty_snapshot ->> 'source_count')::integer <> 0
     or (v_empty_snapshot #>> '{source_counts,total}')::integer <> 0
     or (v_empty_snapshot ->> 'record_count')::integer <> 0
     or v_empty_snapshot -> 'settlement_batches' <> '[]'::jsonb
     or v_empty_snapshot -> 'settlement_batch_items' <> '[]'::jsonb
     or v_empty_snapshot -> 'live_reports' <> '[]'::jsonb
     or v_empty_snapshot -> 'project_cost_items' <> '[]'::jsonb then
    raise exception 'runtime_empty_snapshot_failed';
  end if;

  begin
    perform public.read_custom_settlement_evidence_snapshot(
      v_organization_id,
      extensions.gen_random_uuid(),
      'payable',
      '2026-07-01'::date,
      '2026-07-31'::date,
      'Asia/Shanghai',
      'contract_default',
      'report',
      10000,
      500
    );
    raise exception 'runtime_cross_scope_snapshot_accepted';
  exception
    when others then
      if sqlerrm = 'runtime_cross_scope_snapshot_accepted' then
        raise;
      end if;
  end;

  delete from public.project_cost_items
  where organization_id = v_organization_id;
  delete from public.settlement_batch_items
  where organization_id = v_organization_id;
  delete from public.live_reports
  where organization_id = v_organization_id;
  delete from public.live_tasks
  where organization_id = v_organization_id;
  delete from public.project_streamers
  where organization_id = v_organization_id;
  delete from public.streamers
  where organization_id = v_organization_id;
  delete from public.settlement_batches
  where organization_id = v_organization_id;
  delete from public.custom_settlement_ai_sessions
  where organization_id = v_organization_id;
  delete from public.ai_conversations
  where organization_id = v_organization_id;
  delete from public.projects
  where organization_id = v_organization_id;
  delete from public.organization_members
  where organization_id = v_organization_id;
  delete from public.organizations where id = v_organization_id;
  delete from public.profiles
  where id in (v_owner_id, v_finance_id, v_streamer_user_id);
  delete from auth.users
  where id in (v_owner_id, v_finance_id, v_streamer_user_id);
  perform pg_catalog.set_config('request.jwt.claim.sub', '', true);

  if exists (
    select 1 from public.custom_settlement_ai_sessions
    where organization_id = v_organization_id
  ) or exists (
    select 1 from public.ai_conversations
    where organization_id = v_organization_id
  ) or exists (
    select 1 from public.organizations
    where id = v_organization_id
  ) then
    raise exception 'runtime_snapshot_fixture_cleanup_failed';
  end if;
exception
  when others then
    v_error := sqlerrm;
    delete from public.project_cost_items
    where organization_id = v_organization_id;
    delete from public.settlement_batch_items
    where organization_id = v_organization_id;
    delete from public.live_reports
    where organization_id = v_organization_id;
    delete from public.live_tasks
    where organization_id = v_organization_id;
    delete from public.project_streamers
    where organization_id = v_organization_id;
    delete from public.streamers
    where organization_id = v_organization_id;
    delete from public.settlement_batches
    where organization_id = v_organization_id;
    delete from public.custom_settlement_ai_sessions
    where organization_id = v_organization_id;
    delete from public.ai_conversations
    where organization_id = v_organization_id;
    delete from public.projects
    where organization_id = v_organization_id;
    delete from public.organization_members
    where organization_id = v_organization_id;
    delete from public.organizations where id = v_organization_id;
    delete from public.profiles
    where id in (v_owner_id, v_finance_id, v_streamer_user_id);
    delete from auth.users
    where id in (v_owner_id, v_finance_id, v_streamer_user_id);
    perform pg_catalog.set_config('request.jwt.claim.sub', '', true);
    raise exception 'custom_settlement_runtime_self_check_failed: %', v_error;
end;
$$;
