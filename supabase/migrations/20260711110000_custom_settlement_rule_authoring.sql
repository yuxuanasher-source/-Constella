-- Phase 1 persistence for Xingyao-authored settlement rule drafts and
-- summary-only formula simulations. Existing AI conversations remain the
-- conversation ledger; this migration only adds an optional project binding.

alter table public.projects
  add constraint projects_id_organization_key unique (id, organization_id);

alter table public.ai_conversations
  add column project_id uuid;

alter table public.ai_conversations
  add constraint ai_conversations_project_scope_fkey
  foreign key (project_id, organization_id)
  references public.projects(id, organization_id)
  on delete cascade;

alter table public.ai_conversations
  add constraint ai_conversations_project_identity_key
  unique (id, organization_id, project_id);

create or replace function public.settlement_ai_json_has_exact_keys(
  p_value jsonb,
  p_keys text[]
)
returns boolean
language sql
immutable
set search_path = pg_catalog, public
as $$
  select
    pg_catalog.jsonb_typeof(p_value) = 'object'
    and p_value ?& p_keys
    and (
      select pg_catalog.count(*)
      from pg_catalog.jsonb_object_keys(p_value)
    ) = pg_catalog.cardinality(p_keys);
$$;

create or replace function public.settlement_ai_decimal_is_bigint(
  p_value jsonb,
  p_allow_null boolean
)
returns boolean
language sql
immutable
set search_path = pg_catalog, public
as $$
  select case
    when p_value is null then false
    when pg_catalog.jsonb_typeof(p_value) = 'null' then p_allow_null
    when pg_catalog.jsonb_typeof(p_value) <> 'string' then false
    when (p_value #>> '{}') !~ '^-?(0|[1-9][0-9]*)$' then false
    else (p_value #>> '{}')::numeric between
      -9223372036854775808::numeric and 9223372036854775807::numeric
  end;
$$;

create or replace function public.settlement_ai_json_is_safe(p_value jsonb)
returns boolean
language sql
immutable
set search_path = pg_catalog, public
as $$
  with recursive walk(value) as (
    select p_value
    union all
    select child.value
    from walk as parent
    cross join lateral (
      select object_item.value
      from pg_catalog.jsonb_each(
        case
          when pg_catalog.jsonb_typeof(parent.value) = 'object'
            then parent.value
          else '{}'::jsonb
        end
      ) as object_item(key, value)
      union all
      select array_item.value
      from pg_catalog.jsonb_array_elements(
        case
          when pg_catalog.jsonb_typeof(parent.value) = 'array'
            then parent.value
          else '[]'::jsonb
        end
      ) as array_item(value)
    ) as child
  ), normalized_keys as (
    select pg_catalog.lower(
      pg_catalog.regexp_replace(object_item.key, '[^a-z0-9]', '', 'g')
    ) as key
    from walk
    cross join lateral pg_catalog.jsonb_each(
      case
        when pg_catalog.jsonb_typeof(walk.value) = 'object'
          then walk.value
        else '{}'::jsonb
      end
    ) as object_item(key, value)
  )
  select p_value is not null and not exists (
    select 1
    from normalized_keys
    where key in (
      'importpayload',
      'internalmargin',
      'parsedpayload',
      'payload',
      'rawpayload',
      'rawrows',
      'reportrows',
      'rows',
      'samplerows',
      'sourcepayload',
      'streameramounts',
      'tax'
    )
  );
$$;

create table public.ai_settlement_rule_drafts (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null,
  conversation_id uuid not null,
  prompt_text text not null,
  turn_trace jsonb not null,
  business_contract jsonb not null,
  unresolved_ambiguities jsonb not null default '[]'::jsonb,
  variable_catalog_version text not null,
  ai_response jsonb not null,
  generated_formula jsonb not null,
  generated_explanation text not null,
  generated_test_cases jsonb not null,
  model text not null,
  safety_flags jsonb not null default '[]'::jsonb,
  contract_hash text not null,
  formula_hash text not null,
  parameter_hash text not null,
  status text not null,
  revision_number integer not null,
  idempotency_key text not null,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default pg_catalog.now(),
  supersedes_draft_id uuid,
  superseded_by_draft_id uuid,
  superseded_at timestamptz,
  constraint ai_settlement_rule_drafts_identity_key
    unique (id, organization_id, project_id),
  constraint ai_settlement_rule_drafts_project_scope_fkey
    foreign key (project_id, organization_id)
    references public.projects(id, organization_id)
    on delete cascade,
  constraint ai_settlement_rule_drafts_conversation_scope_fkey
    foreign key (conversation_id, organization_id, project_id)
    references public.ai_conversations(id, organization_id, project_id)
    on delete cascade,
  constraint ai_settlement_rule_drafts_supersedes_scope_fkey
    foreign key (supersedes_draft_id, organization_id, project_id)
    references public.ai_settlement_rule_drafts(id, organization_id, project_id),
  constraint ai_settlement_rule_drafts_superseded_by_scope_fkey
    foreign key (superseded_by_draft_id, organization_id, project_id)
    references public.ai_settlement_rule_drafts(id, organization_id, project_id),
  constraint ai_settlement_rule_drafts_conversation_revision_key
    unique (conversation_id, revision_number),
  constraint ai_settlement_rule_drafts_created_by_idempotency_key
    unique (organization_id, created_by, idempotency_key),
  constraint ai_settlement_rule_drafts_revision_positive
    check (revision_number > 0),
  constraint ai_settlement_rule_drafts_status_check check (
    status in ('clarifying', 'contract_ready', 'simulated', 'failed', 'superseded')
  ),
  constraint ai_settlement_rule_drafts_hashes_check check (
    variable_catalog_version ~ '^[0-9a-f]{64}$'
    and contract_hash ~ '^[0-9a-f]{64}$'
    and formula_hash ~ '^[0-9a-f]{64}$'
    and parameter_hash ~ '^[0-9a-f]{64}$'
  ),
  constraint ai_settlement_rule_drafts_text_check check (
    pg_catalog.char_length(pg_catalog.btrim(prompt_text)) between 1 and 100000
    and pg_catalog.char_length(pg_catalog.btrim(generated_explanation)) between 1 and 100000
    and pg_catalog.char_length(pg_catalog.btrim(model)) between 1 and 200
    and pg_catalog.char_length(pg_catalog.btrim(idempotency_key)) between 1 and 200
  ),
  constraint ai_settlement_rule_drafts_json_shapes_check check (
    public.settlement_ai_json_has_exact_keys(
      turn_trace,
      array['turnId', 'userMessageId', 'assistantMessageId']::text[]
    )
    and pg_catalog.jsonb_typeof(business_contract) = 'object'
    and pg_catalog.jsonb_typeof(unresolved_ambiguities) = 'array'
    and public.settlement_ai_json_has_exact_keys(
      ai_response,
      array['content', 'finishReason', 'providerRequestId']::text[]
    )
    and public.settlement_ai_json_has_exact_keys(
      generated_formula,
      array['expression', 'normalizedAst']::text[]
    )
    and pg_catalog.jsonb_typeof(generated_test_cases) = 'array'
    and pg_catalog.jsonb_array_length(generated_test_cases) > 0
    and pg_catalog.jsonb_typeof(safety_flags) = 'array'
  ),
  constraint ai_settlement_rule_drafts_chinese_contract_check check (
    pg_catalog.jsonb_typeof(business_contract -> 'title') = 'string'
    and pg_catalog.jsonb_typeof(business_contract -> 'summary') = 'string'
    and business_contract ->> 'title' ~ '[一-龥]'
    and business_contract ->> 'summary' ~ '[一-龥]'
  ),
  constraint ai_settlement_rule_drafts_supersession_state_check check (
    (
      status = 'superseded'
      and superseded_by_draft_id is not null
      and superseded_at is not null
    ) or (
      status <> 'superseded'
      and superseded_by_draft_id is null
      and superseded_at is null
    )
  ),
  constraint ai_settlement_rule_drafts_supersession_not_self check (
    supersedes_draft_id is null or supersedes_draft_id <> id
  )
);

create table public.settlement_formula_simulations (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null,
  rule_version_id uuid,
  ai_draft_id uuid,
  formula_hash text not null,
  rule_contract_hash text not null,
  parameter_hash text not null,
  variable_catalog_version text not null,
  data_selection_hash text not null,
  sample_source jsonb not null,
  sample_selection jsonb not null,
  coverage jsonb not null,
  scenarios jsonb not null,
  historical_totals jsonb not null,
  deltas jsonb not null,
  largest_changes jsonb not null,
  warnings jsonb not null,
  idempotency_key text not null,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default pg_catalog.now(),
  constraint settlement_formula_simulations_identity_key
    unique (id, organization_id, project_id),
  constraint settlement_formula_simulations_project_scope_fkey
    foreign key (project_id, organization_id)
    references public.projects(id, organization_id)
    on delete cascade,
  constraint settlement_formula_simulations_draft_scope_fkey
    foreign key (ai_draft_id, organization_id, project_id)
    references public.ai_settlement_rule_drafts(id, organization_id, project_id),
  constraint settlement_formula_simulations_exactly_one_owner check (((rule_version_id is not null)::integer + (ai_draft_id is not null)::integer = 1)),
  constraint settlement_formula_simulations_created_by_idempotency_key
    unique (organization_id, created_by, idempotency_key),
  constraint settlement_formula_simulations_hashes_check check (
    formula_hash ~ '^[0-9a-f]{64}$'
    and rule_contract_hash ~ '^[0-9a-f]{64}$'
    and parameter_hash ~ '^[0-9a-f]{64}$'
    and variable_catalog_version ~ '^[0-9a-f]{64}$'
    and data_selection_hash ~ '^[0-9a-f]{64}$'
  ),
  constraint settlement_formula_simulations_text_check check (
    pg_catalog.char_length(pg_catalog.btrim(idempotency_key)) between 1 and 200
  ),
  constraint settlement_formula_simulations_json_shapes_check check (
    public.settlement_ai_json_has_exact_keys(sample_source, array['kind']::text[])
    and public.settlement_ai_json_has_exact_keys(
      sample_selection,
      array[
        'periodStart',
        'periodEnd',
        'populationCount',
        'sampledCount',
        'criteria'
      ]::text[]
    )
    and public.settlement_ai_json_has_exact_keys(
      coverage,
      array['totalRecords', 'evaluatedRecords', 'skippedRecords']::text[]
    )
    and pg_catalog.jsonb_typeof(scenarios) = 'array'
    and pg_catalog.jsonb_array_length(scenarios) > 0
    and public.settlement_ai_json_has_exact_keys(
      historical_totals,
      array[
        'payableAmountCents',
        'receivableAmountCents',
        'recordCount'
      ]::text[]
    )
    and public.settlement_ai_json_has_exact_keys(
      deltas,
      array[
        'payableAmountCents',
        'receivableAmountCents',
        'percentageBps'
      ]::text[]
    )
    and pg_catalog.jsonb_typeof(largest_changes) = 'array'
    and pg_catalog.jsonb_typeof(warnings) = 'array'
  ),
  constraint settlement_formula_simulations_decimal_totals_check check (
    public.settlement_ai_decimal_is_bigint(
      historical_totals -> 'payableAmountCents',
      true
    )
    and public.settlement_ai_decimal_is_bigint(
      historical_totals -> 'receivableAmountCents',
      true
    )
    and public.settlement_ai_decimal_is_bigint(
      deltas -> 'payableAmountCents',
      false
    )
    and public.settlement_ai_decimal_is_bigint(
      deltas -> 'receivableAmountCents',
      false
    )
  )
);

create index ai_settlement_rule_drafts_org_project_status_recent_idx
  on public.ai_settlement_rule_drafts (
    organization_id,
    project_id,
    status,
    created_at desc
  );

create index ai_settlement_rule_drafts_conversation_recent_idx
  on public.ai_settlement_rule_drafts (
    conversation_id,
    revision_number desc,
    created_at desc
  );

create index settlement_formula_simulations_org_project_recent_idx
  on public.settlement_formula_simulations (
    organization_id,
    project_id,
    created_at desc
  );

create index settlement_formula_simulations_ai_draft_recent_idx
  on public.settlement_formula_simulations (ai_draft_id, created_at desc)
  where ai_draft_id is not null;

create index settlement_formula_simulations_rule_version_recent_idx
  on public.settlement_formula_simulations (rule_version_id, created_at desc)
  where rule_version_id is not null;

create or replace function public.guard_ai_settlement_rule_draft_revision()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'ai_settlement_rule_drafts are append-only';
  end if;

  if old.status = 'contract_ready'
     and new.status = 'simulated'
     and (
       pg_catalog.to_jsonb(new) - 'status'
     ) = (
       pg_catalog.to_jsonb(old) - 'status'
     ) then
    return new;
  end if;

  if old.status <> 'superseded'
     and new.status = 'superseded'
     and new.superseded_by_draft_id is not null
     and new.superseded_at is not null
     and (
       pg_catalog.to_jsonb(new) - array[
         'status',
         'superseded_by_draft_id',
         'superseded_at'
       ]::text[]
     ) = (
       pg_catalog.to_jsonb(old) - array[
         'status',
         'superseded_by_draft_id',
         'superseded_at'
       ]::text[]
     ) then
    return new;
  end if;

  raise exception 'only contract_ready to simulated and supersession transitions are allowed';
end;
$$;

create trigger ai_settlement_rule_drafts_guard
before update or delete on public.ai_settlement_rule_drafts
for each row execute function public.guard_ai_settlement_rule_draft_revision();

create or replace function public.prevent_settlement_formula_simulation_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  raise exception 'settlement_formula_simulations are append-only';
end;
$$;

create trigger settlement_formula_simulations_immutable
before update or delete on public.settlement_formula_simulations
for each row execute function public.prevent_settlement_formula_simulation_mutation();

alter table public.ai_settlement_rule_drafts enable row level security;
alter table public.settlement_formula_simulations enable row level security;

create policy ai_settlement_rule_drafts_mcn_project_read
on public.ai_settlement_rule_drafts
for select
using (
  auth.uid() is not null
  and public.is_org_member(organization_id)
  and public.is_mcn_staff(organization_id)
  and public.can_access_project(project_id)
);

create policy settlement_formula_simulations_mcn_project_read
on public.settlement_formula_simulations
for select
using (
  auth.uid() is not null
  and public.is_org_member(organization_id)
  and public.is_mcn_staff(organization_id)
  and public.can_access_project(project_id)
);

create or replace function public.create_ai_settlement_rule_draft(
  p_organization_id uuid,
  p_project_id uuid,
  p_conversation_id uuid,
  p_idempotency_key text,
  p_prompt_text text,
  p_turn_trace jsonb,
  p_business_contract jsonb,
  p_unresolved_ambiguities jsonb,
  p_variable_catalog_version text,
  p_ai_response jsonb,
  p_generated_formula jsonb,
  p_generated_explanation text,
  p_generated_test_cases jsonb,
  p_model text,
  p_safety_flags jsonb,
  p_contract_hash text,
  p_formula_hash text,
  p_parameter_hash text,
  p_status text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor_id uuid := auth.uid();
  v_conversation public.ai_conversations%rowtype;
  v_existing public.ai_settlement_rule_drafts%rowtype;
  v_previous public.ai_settlement_rule_drafts%rowtype;
  v_created public.ai_settlement_rule_drafts%rowtype;
  v_next_revision integer;
begin
  if auth.uid() is null or v_actor_id is null then
    raise exception 'authentication_required';
  end if;
  if not public.is_org_member(p_organization_id)
     or not public.is_mcn_staff(p_organization_id)
     or not public.can_access_project(p_project_id) then
    raise exception 'settlement_ai_project_access_denied';
  end if;
  if not exists (
    select 1
    from public.projects as p
    where p.id = p_project_id
      and p.organization_id = p_organization_id
  ) then
    raise exception 'settlement_ai_project_scope_mismatch';
  end if;
  if p_status not in ('clarifying', 'contract_ready', 'failed') then
    raise exception 'settlement_ai_draft_status_invalid';
  end if;
  if pg_catalog.nullif(pg_catalog.btrim(p_idempotency_key), '') is null
     or pg_catalog.char_length(pg_catalog.btrim(p_idempotency_key)) > 200
     or pg_catalog.nullif(pg_catalog.btrim(p_prompt_text), '') is null
     or pg_catalog.char_length(pg_catalog.btrim(p_prompt_text)) > 100000
     or pg_catalog.nullif(pg_catalog.btrim(p_generated_explanation), '') is null
     or pg_catalog.char_length(pg_catalog.btrim(p_generated_explanation)) > 100000
     or pg_catalog.nullif(pg_catalog.btrim(p_model), '') is null
     or pg_catalog.char_length(pg_catalog.btrim(p_model)) > 200 then
    raise exception 'settlement_ai_draft_text_invalid';
  end if;
  if p_variable_catalog_version !~ '^[0-9a-f]{64}$'
     or p_contract_hash !~ '^[0-9a-f]{64}$'
     or p_formula_hash !~ '^[0-9a-f]{64}$'
     or p_parameter_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'settlement_ai_draft_hash_invalid';
  end if;
  if not public.settlement_ai_json_is_safe(p_turn_trace)
     or not public.settlement_ai_json_is_safe(p_business_contract)
     or not public.settlement_ai_json_is_safe(p_unresolved_ambiguities)
     or not public.settlement_ai_json_is_safe(p_ai_response)
     or not public.settlement_ai_json_is_safe(p_generated_formula)
     or not public.settlement_ai_json_is_safe(p_generated_test_cases)
     or not public.settlement_ai_json_is_safe(p_safety_flags) then
    raise exception 'settlement_ai_draft_json_unsafe';
  end if;
  if not public.settlement_ai_json_has_exact_keys(
       p_turn_trace,
       array['turnId', 'userMessageId', 'assistantMessageId']::text[]
     )
     or not public.settlement_ai_json_has_exact_keys(
       p_ai_response,
       array['content', 'finishReason', 'providerRequestId']::text[]
     )
     or not public.settlement_ai_json_has_exact_keys(
       p_generated_formula,
       array['expression', 'normalizedAst']::text[]
     )
     or not public.settlement_ai_json_has_exact_keys(
       p_business_contract,
       array[
         'schemaVersion',
         'scope',
         'target',
         'executionGrain',
         'compositionMode',
         'title',
         'summary',
         'calculationComponents',
         'requiredInputs',
         'parameters',
         'effectiveStartAt',
         'effectiveEndAt',
         'missingDataPolicy',
         'compositionDescription',
         'businessTimezone',
         'examples'
       ]::text[]
     )
     or pg_catalog.jsonb_typeof(p_unresolved_ambiguities) <> 'array'
     or pg_catalog.jsonb_typeof(p_generated_test_cases) <> 'array'
     or pg_catalog.jsonb_array_length(p_generated_test_cases) = 0
     or pg_catalog.jsonb_typeof(p_safety_flags) <> 'array' then
    raise exception 'settlement_ai_draft_json_shape_invalid';
  end if;
  if pg_catalog.jsonb_typeof(p_business_contract -> 'title') <> 'string'
     or pg_catalog.jsonb_typeof(p_business_contract -> 'summary') <> 'string'
     or p_business_contract ->> 'title' !~ '[一-龥]'
     or p_business_contract ->> 'summary' !~ '[一-龥]'
     or p_ai_response ->> 'finishReason' not in (
       'stop',
       'length',
       'content_filter',
       'tool_call'
     ) then
    raise exception 'settlement_ai_draft_business_contract_invalid';
  end if;
  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(p_unresolved_ambiguities) as item(value)
    where not public.settlement_ai_json_has_exact_keys(
      item.value,
      array['code', 'question', 'required']::text[]
    )
  ) or exists (
    select 1
    from pg_catalog.jsonb_array_elements(p_generated_test_cases) as item(value)
    where not public.settlement_ai_json_has_exact_keys(
      item.value,
      array['name', 'inputs', 'expectedResult']::text[]
    )
  ) or exists (
    select 1
    from pg_catalog.jsonb_array_elements(p_safety_flags) as item(value)
    where not public.settlement_ai_json_has_exact_keys(
      item.value,
      array['code', 'severity', 'message']::text[]
    )
  ) then
    raise exception 'settlement_ai_draft_json_item_invalid';
  end if;

  select c.*
  into v_conversation
  from public.ai_conversations as c
  where c.id = p_conversation_id
    and c.organization_id = p_organization_id
    and c.owner_user_id = auth.uid()
  for update;
  if not found then
    raise exception 'settlement_ai_conversation_scope_mismatch';
  end if;
  if v_conversation.project_id is null then
    update public.ai_conversations
    set project_id = p_project_id
    where id = p_conversation_id
      and organization_id = p_organization_id
      and owner_user_id = v_actor_id;
  elsif v_conversation.project_id <> p_project_id then
    raise exception 'settlement_ai_conversation_project_mismatch';
  end if;

  select d.*
  into v_existing
  from public.ai_settlement_rule_drafts as d
  where d.organization_id = p_organization_id
    and d.created_by = v_actor_id
    and d.idempotency_key = pg_catalog.btrim(p_idempotency_key)
  for update;
  if found then
    if v_existing.project_id <> p_project_id
       or v_existing.conversation_id <> p_conversation_id
       or v_existing.prompt_text <> pg_catalog.btrim(p_prompt_text)
       or v_existing.turn_trace is distinct from p_turn_trace
       or v_existing.business_contract is distinct from p_business_contract
       or v_existing.unresolved_ambiguities is distinct from p_unresolved_ambiguities
       or v_existing.variable_catalog_version <> p_variable_catalog_version
       or v_existing.ai_response is distinct from p_ai_response
       or v_existing.generated_formula is distinct from p_generated_formula
       or v_existing.generated_explanation <> pg_catalog.btrim(p_generated_explanation)
       or v_existing.generated_test_cases is distinct from p_generated_test_cases
       or v_existing.model <> pg_catalog.btrim(p_model)
       or v_existing.safety_flags is distinct from p_safety_flags
       or v_existing.contract_hash <> p_contract_hash
       or v_existing.formula_hash <> p_formula_hash
       or v_existing.parameter_hash <> p_parameter_hash then
      raise exception 'settlement_ai_draft_idempotency_conflict';
    end if;
    return pg_catalog.to_jsonb(v_existing)
      || pg_catalog.jsonb_build_object('duplicate', true);
  end if;

  select coalesce(max(d.revision_number), 0) + 1
  into v_next_revision
  from public.ai_settlement_rule_drafts as d
  where d.conversation_id = p_conversation_id;

  select d.*
  into v_previous
  from public.ai_settlement_rule_drafts as d
  where d.conversation_id = p_conversation_id
  order by d.revision_number desc
  limit 1;

  insert into public.ai_settlement_rule_drafts (
    organization_id,
    project_id,
    conversation_id,
    prompt_text,
    turn_trace,
    business_contract,
    unresolved_ambiguities,
    variable_catalog_version,
    ai_response,
    generated_formula,
    generated_explanation,
    generated_test_cases,
    model,
    safety_flags,
    contract_hash,
    formula_hash,
    parameter_hash,
    status,
    revision_number,
    idempotency_key,
    created_by,
    supersedes_draft_id
  ) values (
    p_organization_id,
    p_project_id,
    p_conversation_id,
    pg_catalog.btrim(p_prompt_text),
    p_turn_trace,
    p_business_contract,
    p_unresolved_ambiguities,
    p_variable_catalog_version,
    p_ai_response,
    p_generated_formula,
    pg_catalog.btrim(p_generated_explanation),
    p_generated_test_cases,
    pg_catalog.btrim(p_model),
    p_safety_flags,
    p_contract_hash,
    p_formula_hash,
    p_parameter_hash,
    p_status,
    v_next_revision,
    pg_catalog.btrim(p_idempotency_key),
    v_actor_id,
    v_previous.id
  )
  returning * into v_created;

  if v_previous.id is not null then
    update public.ai_settlement_rule_drafts
    set status = 'superseded',
        superseded_by_draft_id = v_created.id,
        superseded_at = pg_catalog.clock_timestamp()
    where id = v_previous.id
      and status <> 'superseded';
  end if;

  return pg_catalog.to_jsonb(v_created)
    || pg_catalog.jsonb_build_object('duplicate', false);
end;
$$;

create or replace function public.create_settlement_formula_simulation(
  p_organization_id uuid,
  p_project_id uuid,
  p_rule_version_id uuid,
  p_ai_draft_id uuid,
  p_idempotency_key text,
  p_formula_hash text,
  p_rule_contract_hash text,
  p_parameter_hash text,
  p_variable_catalog_version text,
  p_data_selection_hash text,
  p_sample_source jsonb,
  p_sample_selection jsonb,
  p_coverage jsonb,
  p_scenarios jsonb,
  p_historical_totals jsonb,
  p_deltas jsonb,
  p_largest_changes jsonb,
  p_warnings jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor_id uuid := auth.uid();
  v_project_id uuid;
  v_existing public.settlement_formula_simulations%rowtype;
  v_draft public.ai_settlement_rule_drafts%rowtype;
  v_created public.settlement_formula_simulations%rowtype;
begin
  if auth.uid() is null or v_actor_id is null then
    raise exception 'authentication_required';
  end if;
  if not public.is_org_member(p_organization_id)
     or not public.is_mcn_staff(p_organization_id)
     or not public.can_access_project(p_project_id) then
    raise exception 'settlement_ai_project_access_denied';
  end if;
  select p.id
  into v_project_id
  from public.projects as p
  where p.id = p_project_id
    and p.organization_id = p_organization_id
  for update;
  if not found then
    raise exception 'settlement_ai_project_scope_mismatch';
  end if;
  if ((p_rule_version_id is not null)::integer + (p_ai_draft_id is not null)::integer) <> 1 then
    raise exception 'settlement_ai_simulation_owner_invalid';
  end if;
  if pg_catalog.nullif(pg_catalog.btrim(p_idempotency_key), '') is null
     or pg_catalog.char_length(pg_catalog.btrim(p_idempotency_key)) > 200 then
    raise exception 'settlement_ai_simulation_idempotency_key_invalid';
  end if;
  if p_formula_hash !~ '^[0-9a-f]{64}$'
     or p_rule_contract_hash !~ '^[0-9a-f]{64}$'
     or p_parameter_hash !~ '^[0-9a-f]{64}$'
     or p_variable_catalog_version !~ '^[0-9a-f]{64}$'
     or p_data_selection_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'settlement_ai_simulation_hash_invalid';
  end if;
  if not public.settlement_ai_json_is_safe(p_sample_source)
     or not public.settlement_ai_json_is_safe(p_sample_selection)
     or not public.settlement_ai_json_is_safe(p_coverage)
     or not public.settlement_ai_json_is_safe(p_scenarios)
     or not public.settlement_ai_json_is_safe(p_historical_totals)
     or not public.settlement_ai_json_is_safe(p_deltas)
     or not public.settlement_ai_json_is_safe(p_largest_changes)
     or not public.settlement_ai_json_is_safe(p_warnings) then
    raise exception 'settlement_ai_simulation_json_unsafe';
  end if;
  if not public.settlement_ai_json_has_exact_keys(
       p_sample_source,
       array['kind']::text[]
     )
     or p_sample_source ->> 'kind' not in (
       'historical_settlements',
       'approved_operations',
       'synthetic_scenarios'
     )
     or not public.settlement_ai_json_has_exact_keys(
       p_sample_selection,
       array[
         'periodStart',
         'periodEnd',
         'populationCount',
         'sampledCount',
         'criteria'
       ]::text[]
     )
     or not public.settlement_ai_json_has_exact_keys(
       p_coverage,
       array['totalRecords', 'evaluatedRecords', 'skippedRecords']::text[]
     )
     or pg_catalog.jsonb_typeof(p_scenarios) <> 'array'
     or pg_catalog.jsonb_array_length(p_scenarios) = 0
     or not public.settlement_ai_json_has_exact_keys(
       p_historical_totals,
       array[
         'payableAmountCents',
         'receivableAmountCents',
         'recordCount'
       ]::text[]
     )
     or not public.settlement_ai_json_has_exact_keys(
       p_deltas,
       array[
         'payableAmountCents',
         'receivableAmountCents',
         'percentageBps'
       ]::text[]
     )
     or pg_catalog.jsonb_typeof(p_largest_changes) <> 'array'
     or pg_catalog.jsonb_typeof(p_warnings) <> 'array' then
    raise exception 'settlement_ai_simulation_json_shape_invalid';
  end if;
  if p_sample_selection ->> 'periodStart' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
     or p_sample_selection ->> 'periodEnd' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
     or p_sample_selection ->> 'periodStart' > p_sample_selection ->> 'periodEnd'
     or p_sample_selection ->> 'populationCount' !~ '^(0|[1-9][0-9]*)$'
     or p_sample_selection ->> 'sampledCount' !~ '^(0|[1-9][0-9]*)$'
     or (p_sample_selection ->> 'sampledCount')::numeric
       > (p_sample_selection ->> 'populationCount')::numeric
     or pg_catalog.jsonb_typeof(p_sample_selection -> 'criteria') <> 'array'
     or p_coverage ->> 'totalRecords' !~ '^(0|[1-9][0-9]*)$'
     or p_coverage ->> 'evaluatedRecords' !~ '^(0|[1-9][0-9]*)$'
     or p_coverage ->> 'skippedRecords' !~ '^(0|[1-9][0-9]*)$'
     or (p_coverage ->> 'evaluatedRecords')::numeric
       + (p_coverage ->> 'skippedRecords')::numeric
       <> (p_coverage ->> 'totalRecords')::numeric
     or not public.settlement_ai_decimal_is_bigint(
       p_historical_totals -> 'payableAmountCents',
       true
     )
     or not public.settlement_ai_decimal_is_bigint(
       p_historical_totals -> 'receivableAmountCents',
       true
     )
     or not public.settlement_ai_decimal_is_bigint(
       p_deltas -> 'payableAmountCents',
       false
     )
     or not public.settlement_ai_decimal_is_bigint(
       p_deltas -> 'receivableAmountCents',
       false
     ) then
    raise exception 'settlement_ai_simulation_summary_invalid';
  end if;
  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(p_scenarios) as item(value)
    where not public.settlement_ai_json_has_exact_keys(
      item.value,
      array['name', 'kind', 'result']::text[]
    )
      or item.value ->> 'kind' not in ('normal', 'boundary', 'missing_data')
      or item.value ->> 'result' not in ('passed', 'warning', 'failed')
  ) or exists (
    select 1
    from pg_catalog.jsonb_array_elements(p_largest_changes) as item(value)
    where not public.settlement_ai_json_has_exact_keys(
      item.value,
      array['dimension', 'key', 'deltaAmountCents', 'direction']::text[]
    )
      or item.value ->> 'dimension' not in (
        'rule_component',
        'scenario',
        'period'
      )
      or pg_catalog.lower(
        pg_catalog.regexp_replace(item.value ->> 'key', '[^a-z0-9]', '', 'g')
      ) in ('tax', 'internalmargin', 'streamer', 'streameramount')
      or not public.settlement_ai_decimal_is_bigint(
        item.value -> 'deltaAmountCents',
        false
      )
      or item.value ->> 'direction' not in (
        'increase',
        'decrease',
        'unchanged'
      )
  ) or exists (
    select 1
    from pg_catalog.jsonb_array_elements(p_warnings) as item(value)
    where not public.settlement_ai_json_has_exact_keys(
      item.value,
      array['code', 'severity', 'message']::text[]
    )
      or item.value ->> 'severity' not in ('info', 'warning', 'block')
  ) then
    raise exception 'settlement_ai_simulation_summary_item_invalid';
  end if;

  select s.*
  into v_existing
  from public.settlement_formula_simulations as s
  where s.organization_id = p_organization_id
    and s.created_by = v_actor_id
    and s.idempotency_key = pg_catalog.btrim(p_idempotency_key)
  for update;
  if found then
    if v_existing.project_id <> p_project_id
       or v_existing.rule_version_id is distinct from p_rule_version_id
       or v_existing.ai_draft_id is distinct from p_ai_draft_id
       or v_existing.formula_hash <> p_formula_hash
       or v_existing.rule_contract_hash <> p_rule_contract_hash
       or v_existing.parameter_hash <> p_parameter_hash
       or v_existing.variable_catalog_version <> p_variable_catalog_version
       or v_existing.data_selection_hash <> p_data_selection_hash
       or v_existing.sample_source is distinct from p_sample_source
       or v_existing.sample_selection is distinct from p_sample_selection
       or v_existing.coverage is distinct from p_coverage
       or v_existing.scenarios is distinct from p_scenarios
       or v_existing.historical_totals is distinct from p_historical_totals
       or v_existing.deltas is distinct from p_deltas
       or v_existing.largest_changes is distinct from p_largest_changes
       or v_existing.warnings is distinct from p_warnings then
      raise exception 'settlement_ai_simulation_idempotency_conflict';
    end if;
    return pg_catalog.to_jsonb(v_existing)
      || pg_catalog.jsonb_build_object('duplicate', true);
  end if;

  if p_ai_draft_id is not null then
    select d.*
    into v_draft
    from public.ai_settlement_rule_drafts as d
    where d.id = p_ai_draft_id
      and d.organization_id = p_organization_id
      and d.project_id = p_project_id
    for update;
    if not found then
      raise exception 'settlement_ai_simulation_draft_scope_mismatch';
    end if;
    if v_draft.status not in ('contract_ready', 'simulated')
       or v_draft.formula_hash <> p_formula_hash
       or v_draft.contract_hash <> p_rule_contract_hash
       or v_draft.parameter_hash <> p_parameter_hash
       or v_draft.variable_catalog_version <> p_variable_catalog_version then
      raise exception 'settlement_ai_simulation_draft_not_fresh';
    end if;
  end if;

  insert into public.settlement_formula_simulations (
    organization_id,
    project_id,
    rule_version_id,
    ai_draft_id,
    formula_hash,
    rule_contract_hash,
    parameter_hash,
    variable_catalog_version,
    data_selection_hash,
    sample_source,
    sample_selection,
    coverage,
    scenarios,
    historical_totals,
    deltas,
    largest_changes,
    warnings,
    idempotency_key,
    created_by
  ) values (
    p_organization_id,
    p_project_id,
    p_rule_version_id,
    p_ai_draft_id,
    p_formula_hash,
    p_rule_contract_hash,
    p_parameter_hash,
    p_variable_catalog_version,
    p_data_selection_hash,
    p_sample_source,
    p_sample_selection,
    p_coverage,
    p_scenarios,
    p_historical_totals,
    p_deltas,
    p_largest_changes,
    p_warnings,
    pg_catalog.btrim(p_idempotency_key),
    v_actor_id
  )
  returning * into v_created;

  if p_ai_draft_id is not null and v_draft.status = 'contract_ready' then
    update public.ai_settlement_rule_drafts
    set status = 'simulated'
    where id = p_ai_draft_id
      and organization_id = p_organization_id
      and project_id = p_project_id
      and status = 'contract_ready';
  end if;

  return pg_catalog.to_jsonb(v_created)
    || pg_catalog.jsonb_build_object('duplicate', false);
end;
$$;

-- Read policies intentionally omit conversation ownership: every authorized
-- MCN operator with project access may inspect the project's authoring trail.
-- Direct table writes, including service-client writes, remain unavailable;
-- the function owner performs the two validated append operations above.
revoke all on table public.ai_settlement_rule_drafts
  from public, anon, authenticated, service_role;
revoke all on table public.settlement_formula_simulations
  from public, anon, authenticated, service_role;

grant select on table public.ai_settlement_rule_drafts to authenticated;
grant select on table public.settlement_formula_simulations to authenticated;

revoke all on function public.settlement_ai_json_has_exact_keys(jsonb, text[])
  from public, anon, authenticated, service_role;
revoke all on function public.settlement_ai_decimal_is_bigint(jsonb, boolean)
  from public, anon, authenticated, service_role;
revoke all on function public.settlement_ai_json_is_safe(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.guard_ai_settlement_rule_draft_revision()
  from public, anon, authenticated, service_role;
revoke all on function public.prevent_settlement_formula_simulation_mutation()
  from public, anon, authenticated, service_role;

revoke all on function public.create_ai_settlement_rule_draft(
  uuid,
  uuid,
  uuid,
  text,
  text,
  jsonb,
  jsonb,
  jsonb,
  text,
  jsonb,
  jsonb,
  text,
  jsonb,
  text,
  jsonb,
  text,
  text,
  text,
  text
) from public, anon, authenticated, service_role;

grant execute on function public.create_ai_settlement_rule_draft(
  uuid,
  uuid,
  uuid,
  text,
  text,
  jsonb,
  jsonb,
  jsonb,
  text,
  jsonb,
  jsonb,
  text,
  jsonb,
  text,
  jsonb,
  text,
  text,
  text,
  text
) to authenticated;

revoke all on function public.create_settlement_formula_simulation(
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  text,
  text,
  jsonb,
  jsonb,
  jsonb,
  jsonb,
  jsonb,
  jsonb,
  jsonb,
  jsonb
) from public, anon, authenticated, service_role;

grant execute on function public.create_settlement_formula_simulation(
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  text,
  text,
  jsonb,
  jsonb,
  jsonb,
  jsonb,
  jsonb,
  jsonb,
  jsonb,
  jsonb
) to authenticated;

comment on table public.ai_settlement_rule_drafts is
  'Append-only Xingyao settlement rule revisions; only narrow lifecycle transitions are mutable.';
comment on table public.settlement_formula_simulations is
  'Immutable settlement formula summaries; raw sample and private amount rows are intentionally excluded.';
