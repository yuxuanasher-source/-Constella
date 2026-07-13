-- Phase 2 settlement-rule governance schema. This migration persists review
-- state only; production settlement execution remains unchanged.

create extension if not exists btree_gist with schema extensions;

set search_path = pg_catalog, public, extensions;

alter table public.project_streamers
  add constraint project_streamers_id_organization_project_key
  unique (id, organization_id, project_id);

create table public.settlement_rule_groups (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null,
  name text not null,
  description text,
  status text not null default 'active',
  created_by uuid not null,
  created_at timestamptz not null default pg_catalog.now(),
  archived_at timestamptz,
  constraint settlement_rule_groups_organization_fkey
    foreign key (organization_id)
    references public.organizations(id)
    on delete restrict,
  constraint settlement_rule_groups_created_by_fkey
    foreign key (created_by)
    references public.profiles(id)
    on delete restrict,
  constraint settlement_rule_groups_identity_key
    unique (id, organization_id, project_id),
  constraint settlement_rule_groups_project_scope_fkey
    foreign key (project_id, organization_id)
    references public.projects(id, organization_id)
    on delete restrict,
  constraint settlement_rule_groups_status_check check (
    status in ('active', 'archived')
  ),
  constraint settlement_rule_groups_archive_state_check check (
    (status = 'active' and archived_at is null)
    or (status = 'archived' and archived_at is not null)
  ),
  constraint settlement_rule_groups_name_check check (
    pg_catalog.char_length(pg_catalog.btrim(name)) between 1 and 120
    and name = pg_catalog.btrim(name)
  ),
  constraint settlement_rule_groups_description_check check (
    description is null
    or (
      description = pg_catalog.btrim(description)
      and pg_catalog.char_length(description) between 1 and 2000
    )
  )
);

create unique index settlement_rule_groups_active_name_key
on public.settlement_rule_groups (
  project_id,
  pg_catalog.lower(name)
)
where status = 'active';

create table public.custom_settlement_rule_versions (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null,
  scope text not null,
  target_type text not null,
  target_id uuid,
  target_group_id uuid generated always as (
    case when target_type = 'streamer_group' then target_id end
  ) stored,
  target_project_streamer_id uuid generated always as (
    case when target_type = 'project_streamer' then target_id end
  ) stored,
  execution_grain text not null,
  composition_mode text not null,
  priority integer not null default 100,
  version_number integer not null,
  status text not null default 'draft',
  formula text not null,
  compiled_ast jsonb not null,
  variables jsonb not null,
  parameters jsonb not null default '{}'::jsonb,
  rule_contract jsonb not null,
  system_explanation_template text not null,
  missing_data_policy jsonb not null default '{}'::jsonb,
  test_cases jsonb not null default '[]'::jsonb,
  simulation_summary jsonb not null default '{}'::jsonb,
  formula_hash text not null,
  rule_contract_hash text not null,
  parameter_hash text not null,
  variable_catalog_version text not null,
  data_selection_hash text not null,
  simulation_id uuid not null,
  effective_from timestamptz,
  effective_until timestamptz,
  created_by uuid not null,
  approved_by uuid,
  ai_draft_id uuid,
  reason text,
  created_at timestamptz not null default pg_catalog.now(),
  approved_at timestamptz,
  archived_at timestamptz,
  constraint custom_rule_versions_organization_fkey
    foreign key (organization_id)
    references public.organizations(id)
    on delete restrict,
  constraint custom_rule_versions_created_by_fkey
    foreign key (created_by)
    references public.profiles(id)
    on delete restrict,
  constraint custom_rule_versions_approved_by_fkey
    foreign key (approved_by)
    references public.profiles(id)
    on delete restrict,
  constraint custom_settlement_rule_versions_identity_key
    unique (id, organization_id, project_id),
  constraint custom_settlement_rule_versions_id_organization_key
    unique (id, organization_id),
  constraint custom_rule_versions_source_metadata_key
    unique (id, organization_id, project_id, version_number, scope),
  constraint custom_settlement_rule_versions_simulation_key
    unique (simulation_id),
  constraint custom_settlement_rule_versions_project_scope_fkey
    foreign key (project_id, organization_id)
    references public.projects(id, organization_id)
    on delete restrict,
  constraint custom_rule_versions_target_group_scope_fkey
    foreign key (target_group_id, organization_id, project_id)
    references public.settlement_rule_groups(id, organization_id, project_id)
    on delete restrict,
  constraint custom_rule_versions_target_project_streamer_scope_fkey
    foreign key (target_project_streamer_id, organization_id, project_id)
    references public.project_streamers(id, organization_id, project_id)
    on delete restrict,
  constraint custom_settlement_rule_versions_ai_draft_scope_fkey
    foreign key (ai_draft_id, organization_id, project_id)
    references public.ai_settlement_rule_drafts(id, organization_id, project_id)
    on delete restrict,
  constraint custom_settlement_rule_versions_status_check check (
    status in (
      'draft',
      'pending_review',
      'changes_requested',
      'active',
      'archived'
    )
  ),
  constraint custom_settlement_rule_versions_scope_check check (
    scope in ('receivable', 'payable', 'external_cost', 'reconciliation')
  ),
  constraint custom_settlement_rule_versions_target_type_check check (
    target_type in ('project', 'streamer_group', 'project_streamer')
  ),
  constraint custom_settlement_rule_versions_grain_check check (
    execution_grain in (
      'report',
      'project_streamer_period',
      'batch',
      'project_period'
    )
  ),
  constraint custom_settlement_rule_versions_composition_check check (
    composition_mode in (
      'replace',
      'add',
      'multiply',
      'clamp',
      'emit_items',
      'check'
    )
  ),
  constraint custom_settlement_rule_versions_target_shape_check check (
    (target_type = 'project' and target_id is null)
    or (target_type <> 'project' and target_id is not null)
  ),
  constraint custom_settlement_rule_versions_initial_scope_check check (
    scope = 'payable' or target_type = 'project'
  ),
  constraint custom_settlement_rule_versions_version_positive check (
    version_number > 0
  ),
  constraint custom_settlement_rule_versions_priority_check check (
    priority between 0 and 1000000
  ),
  constraint custom_settlement_rule_versions_effective_range_check check (
    effective_until is null
    or (
      effective_from is not null
      and effective_until > effective_from
    )
  ),
  constraint custom_settlement_rule_versions_approval_state_check check (
    (
      approved_at is null
      and approved_by is null
      and status <> 'active'
    )
    or (
      approved_at is not null
      and approved_by is not null
      and effective_from is not null
      and status in ('active', 'archived')
    )
  ),
  constraint custom_settlement_rule_versions_approved_archive_end_check check (
    status <> 'archived'
    or approved_at is null
    or effective_until is not null
  ),
  constraint custom_settlement_rule_versions_archive_state_check check (
    (status = 'archived' and archived_at is not null)
    or (status <> 'archived' and archived_at is null)
  ),
  constraint custom_settlement_rule_versions_hashes_check check (
    formula_hash ~ '^[0-9a-f]{64}$'
    and rule_contract_hash ~ '^[0-9a-f]{64}$'
    and parameter_hash ~ '^[0-9a-f]{64}$'
    and variable_catalog_version ~ '^[0-9a-f]{64}$'
    and data_selection_hash ~ '^[0-9a-f]{64}$'
  ),
  constraint custom_settlement_rule_versions_text_check check (
    formula = pg_catalog.btrim(formula)
    and pg_catalog.char_length(formula) between 1 and 4000
    and system_explanation_template = pg_catalog.btrim(
      system_explanation_template
    )
    and pg_catalog.char_length(system_explanation_template) between 1 and 4000
    and (
      reason is null
      or (
        reason = pg_catalog.btrim(reason)
        and pg_catalog.char_length(reason) between 1 and 4000
      )
    )
  ),
  constraint custom_settlement_rule_versions_json_shapes_check check (
    pg_catalog.jsonb_typeof(compiled_ast) = 'object'
    and pg_catalog.jsonb_typeof(variables) = 'array'
    and pg_catalog.jsonb_typeof(parameters) = 'object'
    and pg_catalog.jsonb_typeof(rule_contract) = 'object'
    and pg_catalog.jsonb_typeof(missing_data_policy) = 'object'
    and pg_catalog.jsonb_typeof(test_cases) = 'array'
    and pg_catalog.jsonb_typeof(simulation_summary) = 'object'
  ),
  constraint custom_settlement_rule_versions_json_budget_check check (
    public.settlement_ai_json_within_budget(compiled_ast)
    and public.settlement_ai_json_within_budget(variables)
    and public.settlement_ai_json_within_budget(parameters)
    and public.settlement_ai_json_within_budget(rule_contract)
    and public.settlement_ai_json_within_budget(missing_data_policy)
    and public.settlement_ai_json_within_budget(test_cases)
    and public.settlement_ai_json_within_budget(simulation_summary)
    and public.settlement_ai_json_within_budget(
      pg_catalog.jsonb_build_array(
        compiled_ast,
        variables,
        parameters,
        rule_contract,
        missing_data_policy,
        test_cases,
        simulation_summary
      )
    )
  ),
  constraint custom_settlement_rule_versions_payload_valid check (
    public.settlement_ai_normalized_ast_is_valid(compiled_ast)
    and public.settlement_ai_generated_formula_is_valid(
      pg_catalog.jsonb_build_object(
        'expression', formula,
        'normalizedAst', compiled_ast
      )
    )
    and public.settlement_ai_business_contract_is_valid(rule_contract)
    and public.settlement_ai_generated_test_cases_is_valid(test_cases)
    and public.settlement_ai_json_is_safe(
      pg_catalog.jsonb_build_array(
        variables,
        parameters,
        missing_data_policy,
        simulation_summary
      )
    )
  )
);

create unique index custom_settlement_rule_target_version_key
on public.custom_settlement_rule_versions (
  organization_id,
  project_id,
  scope,
  target_type,
  coalesce(target_id, '00000000-0000-0000-0000-000000000000'::uuid),
  version_number
);

create unique index custom_settlement_rule_one_active_target
on public.custom_settlement_rule_versions (
  project_id,
  scope,
  target_type,
  coalesce(target_id, '00000000-0000-0000-0000-000000000000'::uuid)
)
where status = 'active';

alter table public.custom_settlement_rule_versions
  add constraint custom_settlement_rule_versions_effective_no_overlap
  exclude using gist (
    project_id with =,
    scope with =,
    target_type with =,
    coalesce(
      target_id,
      '00000000-0000-0000-0000-000000000000'::uuid
    ) with =,
    tstzrange(effective_from, effective_until, '[)') with &&
  )
  where (approved_at is not null and status in ('active', 'archived'))
  deferrable initially immediate;

alter table public.settlement_formula_simulations
  add constraint settlement_formula_simulations_rule_version_pair_key
  unique (id, rule_version_id, organization_id, project_id);

alter table public.custom_settlement_rule_versions
  add constraint custom_settlement_rule_versions_simulation_scope_fkey
  foreign key (simulation_id, id, organization_id, project_id)
  references public.settlement_formula_simulations(
    id,
    rule_version_id,
    organization_id,
    project_id
  )
  on delete restrict
  deferrable initially deferred;

create unique index settlement_formula_simulations_rule_version_key
on public.settlement_formula_simulations (rule_version_id)
where rule_version_id is not null;

alter table public.settlement_formula_simulations
  add constraint settlement_formula_simulations_rule_version_scope_fkey
  foreign key (rule_version_id, organization_id, project_id)
  references public.custom_settlement_rule_versions(id, organization_id, project_id)
  on delete restrict
  deferrable initially deferred;

create table public.custom_settlement_rule_review_events (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null,
  rule_version_id uuid not null,
  event_type text not null,
  actor_id uuid not null,
  actor_role text not null,
  reason text,
  comment text,
  before_status text,
  after_status text,
  risk_summary jsonb not null default '{}'::jsonb,
  formula_hash text not null,
  rule_contract_hash text not null,
  parameter_hash text not null,
  variable_catalog_version text not null,
  data_selection_hash text not null,
  created_at timestamptz not null default pg_catalog.now(),
  constraint custom_rule_review_events_organization_fkey
    foreign key (organization_id)
    references public.organizations(id)
    on delete restrict,
  constraint custom_rule_review_events_actor_fkey
    foreign key (actor_id)
    references public.profiles(id)
    on delete restrict,
  constraint custom_settlement_rule_review_events_rule_scope_fkey
    foreign key (rule_version_id, organization_id, project_id)
    references public.custom_settlement_rule_versions(
      id,
      organization_id,
      project_id
    )
    on delete restrict,
  constraint custom_settlement_rule_review_events_event_type_check check (
    event_type in (
      'submitted',
      'changes_requested',
      'resubmitted',
      'approved',
      'force_approved',
      'archived',
      'activation_failed'
    )
  ),
  constraint custom_settlement_rule_review_events_actor_role_check check (
    actor_role in ('owner', 'ops_manager', 'operator_business', 'finance')
  ),
  constraint custom_settlement_rule_review_events_status_check check (
    (
      before_status is null
      or before_status in (
        'draft',
        'pending_review',
        'changes_requested',
        'active',
        'archived'
      )
    )
    and (
      after_status is null
      or after_status in (
        'draft',
        'pending_review',
        'changes_requested',
        'active',
        'archived'
      )
    )
  ),
  constraint custom_settlement_rule_review_events_text_check check (
    (
      reason is null
      or (
        reason = pg_catalog.btrim(reason)
        and pg_catalog.char_length(reason) between 1 and 4000
      )
    )
    and (
      comment is null
      or (
        comment = pg_catalog.btrim(comment)
        and pg_catalog.char_length(comment) between 1 and 4000
      )
    )
  ),
  constraint custom_settlement_rule_review_events_risk_shape_check check (
    pg_catalog.jsonb_typeof(risk_summary) = 'object'
    and public.settlement_ai_json_within_budget(risk_summary)
    and public.settlement_ai_json_is_safe(risk_summary)
  ),
  constraint custom_settlement_rule_review_events_hashes_check check (
    formula_hash ~ '^[0-9a-f]{64}$'
    and rule_contract_hash ~ '^[0-9a-f]{64}$'
    and parameter_hash ~ '^[0-9a-f]{64}$'
    and variable_catalog_version ~ '^[0-9a-f]{64}$'
    and data_selection_hash ~ '^[0-9a-f]{64}$'
  )
);

create index custom_settlement_rule_review_events_rule_recent_idx
on public.custom_settlement_rule_review_events (
  rule_version_id,
  created_at desc,
  id desc
);

create table public.project_streamer_settlement_group_assignments (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null,
  project_streamer_id uuid not null,
  group_id uuid not null,
  effective_from timestamptz not null,
  effective_until timestamptz,
  assigned_by uuid not null,
  reason text not null,
  created_at timestamptz not null default pg_catalog.now(),
  constraint project_streamer_group_assignments_organization_fkey
    foreign key (organization_id)
    references public.organizations(id)
    on delete restrict,
  constraint project_streamer_group_assignments_actor_fkey
    foreign key (assigned_by)
    references public.profiles(id)
    on delete restrict,
  constraint project_streamer_group_assignments_project_scope_fkey
    foreign key (project_id, organization_id)
    references public.projects(id, organization_id)
    on delete restrict,
  constraint project_streamer_group_assignments_streamer_scope_fkey
    foreign key (project_streamer_id, organization_id, project_id)
    references public.project_streamers(id, organization_id, project_id)
    on delete restrict,
  constraint project_streamer_group_assignments_group_scope_fkey
    foreign key (group_id, organization_id, project_id)
    references public.settlement_rule_groups(id, organization_id, project_id)
    on delete restrict,
  constraint project_streamer_group_assignments_effective_range_check check (
    effective_until is null or effective_until > effective_from
  ),
  constraint project_streamer_group_assignments_reason_check check (
    reason = pg_catalog.btrim(reason)
    and pg_catalog.char_length(reason) between 1 and 4000
  ),
  constraint project_streamer_settlement_group_assignments_no_overlap
    exclude using gist (
      project_streamer_id with =,
      group_id with =,
      tstzrange(effective_from, effective_until, '[)') with &&
    )
    deferrable initially immediate
);

create index project_streamer_group_assignments_project_effective_idx
on public.project_streamer_settlement_group_assignments (
  project_id,
  effective_from,
  effective_until,
  project_streamer_id
);

create table public.settlement_rule_templates (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  name text not null,
  description text,
  source_rule_version_id uuid,
  source_project_id uuid,
  source_version_number integer,
  source_scope text,
  execution_grain text not null,
  composition_mode text not null,
  formula text not null,
  compiled_ast jsonb not null,
  variables jsonb not null,
  parameters jsonb not null default '{}'::jsonb,
  rule_contract jsonb not null,
  missing_data_policy jsonb not null default '{}'::jsonb,
  test_cases jsonb not null default '[]'::jsonb,
  status text not null default 'active',
  created_by uuid not null,
  created_at timestamptz not null default pg_catalog.now(),
  archived_at timestamptz,
  constraint settlement_rule_templates_organization_fkey
    foreign key (organization_id)
    references public.organizations(id)
    on delete restrict,
  constraint settlement_rule_templates_created_by_fkey
    foreign key (created_by)
    references public.profiles(id)
    on delete restrict,
  constraint settlement_rule_templates_source_rule_org_fkey
    foreign key (source_rule_version_id, organization_id)
    references public.custom_settlement_rule_versions(id, organization_id)
    on delete restrict,
  constraint settlement_rule_templates_source_metadata_fkey
    foreign key (
      source_rule_version_id,
      organization_id,
      source_project_id,
      source_version_number,
      source_scope
    )
    references public.custom_settlement_rule_versions(
      id,
      organization_id,
      project_id,
      version_number,
      scope
    )
    on delete restrict,
  constraint settlement_rule_templates_source_metadata_check check (
    (
      source_rule_version_id is null
      and source_project_id is null
      and source_version_number is null
      and source_scope is null
    )
    or (
      source_rule_version_id is not null
      and source_project_id is not null
      and source_version_number is not null
      and source_version_number > 0
      and source_scope in (
        'receivable',
        'payable',
        'external_cost',
        'reconciliation'
      )
    )
  ),
  constraint settlement_rule_templates_status_check check (
    status in ('active', 'archived')
  ),
  constraint settlement_rule_templates_archive_state_check check (
    (status = 'active' and archived_at is null)
    or (status = 'archived' and archived_at is not null)
  ),
  constraint settlement_rule_templates_grain_check check (
    execution_grain in (
      'report',
      'project_streamer_period',
      'batch',
      'project_period'
    )
  ),
  constraint settlement_rule_templates_composition_check check (
    composition_mode in (
      'replace',
      'add',
      'multiply',
      'clamp',
      'emit_items',
      'check'
    )
  ),
  constraint settlement_rule_templates_text_check check (
    name = pg_catalog.btrim(name)
    and pg_catalog.char_length(name) between 1 and 120
    and (
      description is null
      or (
        description = pg_catalog.btrim(description)
        and pg_catalog.char_length(description) between 1 and 2000
      )
    )
    and formula = pg_catalog.btrim(formula)
    and pg_catalog.char_length(formula) between 1 and 4000
  ),
  constraint settlement_rule_templates_json_shapes_check check (
    pg_catalog.jsonb_typeof(compiled_ast) = 'object'
    and pg_catalog.jsonb_typeof(variables) = 'array'
    and pg_catalog.jsonb_typeof(parameters) = 'object'
    and pg_catalog.jsonb_typeof(rule_contract) = 'object'
    and pg_catalog.jsonb_typeof(missing_data_policy) = 'object'
    and pg_catalog.jsonb_typeof(test_cases) = 'array'
  ),
  constraint settlement_rule_templates_payload_valid check (
    public.settlement_ai_json_within_budget(
      pg_catalog.jsonb_build_array(
        compiled_ast,
        variables,
        parameters,
        rule_contract,
        missing_data_policy,
        test_cases
      )
    )
    and public.settlement_ai_normalized_ast_is_valid(compiled_ast)
    and public.settlement_ai_generated_formula_is_valid(
      pg_catalog.jsonb_build_object(
        'expression', formula,
        'normalizedAst', compiled_ast
      )
    )
    and public.settlement_ai_business_contract_is_valid(rule_contract)
    and public.settlement_ai_generated_test_cases_is_valid(test_cases)
    and public.settlement_ai_json_is_safe(
      pg_catalog.jsonb_build_array(
        variables,
        parameters,
        missing_data_policy
      )
    )
  )
);

create unique index settlement_rule_templates_active_name_key
on public.settlement_rule_templates (
  organization_id,
  pg_catalog.lower(name)
)
where status = 'active';

create or replace function public.guard_custom_settlement_rule_version_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_payload_changed boolean;
  v_governance_changed boolean;
begin
  if tg_op = 'DELETE' then
    raise exception 'custom settlement rule versions cannot be deleted';
  end if;

  if new.id is distinct from old.id
     or new.organization_id is distinct from old.organization_id
     or new.project_id is distinct from old.project_id
     or new.version_number is distinct from old.version_number
     or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at then
    raise exception 'custom settlement rule identity is immutable';
  end if;

  v_payload_changed := pg_catalog.jsonb_build_object(
    'formula', new.formula,
    'compiled_ast', new.compiled_ast,
    'variables', new.variables,
    'parameters', new.parameters,
    'rule_contract', new.rule_contract,
    'missing_data_policy', new.missing_data_policy,
    'test_cases', new.test_cases,
    'simulation_summary', new.simulation_summary,
    'scope', new.scope,
    'target_type', new.target_type,
    'target_id', new.target_id,
    'priority', new.priority,
    'execution_grain', new.execution_grain,
    'composition_mode', new.composition_mode,
    'system_explanation_template', new.system_explanation_template,
    'formula_hash', new.formula_hash,
    'rule_contract_hash', new.rule_contract_hash,
    'parameter_hash', new.parameter_hash,
    'variable_catalog_version', new.variable_catalog_version,
    'data_selection_hash', new.data_selection_hash,
    'simulation_id', new.simulation_id,
    'ai_draft_id', new.ai_draft_id
  ) is distinct from pg_catalog.jsonb_build_object(
    'formula', old.formula,
    'compiled_ast', old.compiled_ast,
    'variables', old.variables,
    'parameters', old.parameters,
    'rule_contract', old.rule_contract,
    'missing_data_policy', old.missing_data_policy,
    'test_cases', old.test_cases,
    'simulation_summary', old.simulation_summary,
    'scope', old.scope,
    'target_type', old.target_type,
    'target_id', old.target_id,
    'priority', old.priority,
    'execution_grain', old.execution_grain,
    'composition_mode', old.composition_mode,
    'system_explanation_template', old.system_explanation_template,
    'formula_hash', old.formula_hash,
    'rule_contract_hash', old.rule_contract_hash,
    'parameter_hash', old.parameter_hash,
    'variable_catalog_version', old.variable_catalog_version,
    'data_selection_hash', old.data_selection_hash,
    'simulation_id', old.simulation_id,
    'ai_draft_id', old.ai_draft_id
  );

  v_governance_changed :=
    new.effective_from is distinct from old.effective_from
     or new.effective_until is distinct from old.effective_until
     or new.approved_by is distinct from old.approved_by
     or new.approved_at is distinct from old.approved_at
     or new.archived_at is distinct from old.archived_at
     or new.reason is distinct from old.reason;

  if new.status is distinct from old.status then
    if v_payload_changed then
      raise exception
        'custom settlement rule payload cannot change during status transition';
    end if;

    if not (
      (old.status = 'draft' and new.status = 'pending_review')
      or (
        old.status = 'pending_review'
        and new.status = 'changes_requested'
      )
      or (old.status = 'changes_requested' and new.status = 'draft')
      or (old.status = 'pending_review' and new.status = 'active')
      or (old.status = 'active' and new.status = 'archived')
      or (old.status = 'draft' and new.status = 'archived')
      or (old.status = 'changes_requested' and new.status = 'archived')
    ) then
      raise exception
        'custom settlement rule status transition is not allowed';
    end if;

    return new;
  end if;

  if v_governance_changed then
    raise exception
      'governance fields require an allowed status transition';
  end if;

  if v_payload_changed
     and not (old.status = 'draft' and new.status = 'draft') then
    raise exception 'custom settlement rule payload is immutable outside draft';
  end if;

  return new;
end;
$$;

create trigger custom_settlement_rule_versions_guard
before update or delete on public.custom_settlement_rule_versions
for each row execute function public.guard_custom_settlement_rule_version_mutation();

create or replace function public.prevent_custom_settlement_review_event_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  raise exception 'custom settlement rule review events are append-only';
end;
$$;

create trigger custom_settlement_rule_review_events_immutable
before update or delete on public.custom_settlement_rule_review_events
for each row execute function public.prevent_custom_settlement_review_event_mutation();

create trigger custom_settlement_rule_review_events_no_truncate
before truncate on public.custom_settlement_rule_review_events
for each statement execute function public.prevent_custom_settlement_review_event_mutation();

create or replace function public.prevent_custom_settlement_governance_delete()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  raise exception '% rows must be archived, not deleted', tg_table_name;
end;
$$;

create trigger settlement_rule_groups_no_delete
before delete on public.settlement_rule_groups
for each row execute function public.prevent_custom_settlement_governance_delete();

create trigger project_streamer_group_assignments_no_delete
before delete on public.project_streamer_settlement_group_assignments
for each row execute function public.prevent_custom_settlement_governance_delete();

create trigger settlement_rule_templates_no_delete
before delete on public.settlement_rule_templates
for each row execute function public.prevent_custom_settlement_governance_delete();

alter table public.custom_settlement_rule_versions enable row level security;
alter table public.custom_settlement_rule_review_events enable row level security;
alter table public.settlement_rule_groups enable row level security;
alter table public.project_streamer_settlement_group_assignments enable row level security;
alter table public.settlement_rule_templates enable row level security;

create policy custom_settlement_rule_versions_mcn_project_read
on public.custom_settlement_rule_versions
for select
using (
  auth.uid() is not null
  and public.is_org_member(organization_id)
  and public.is_mcn_staff(organization_id)
  and public.can_access_project(project_id)
);

create policy custom_settlement_rule_review_events_mcn_project_read
on public.custom_settlement_rule_review_events
for select
using (
  auth.uid() is not null
  and public.is_org_member(organization_id)
  and public.is_mcn_staff(organization_id)
  and public.can_access_project(project_id)
);

create policy settlement_rule_groups_mcn_project_read
on public.settlement_rule_groups
for select
using (
  auth.uid() is not null
  and public.is_org_member(organization_id)
  and public.is_mcn_staff(organization_id)
  and public.can_access_project(project_id)
);

create policy project_streamer_settlement_group_assignments_mcn_project_read
on public.project_streamer_settlement_group_assignments
for select
using (
  auth.uid() is not null
  and public.is_org_member(organization_id)
  and public.is_mcn_staff(organization_id)
  and public.can_access_project(project_id)
);

create policy settlement_rule_templates_mcn_org_read
on public.settlement_rule_templates
for select
using (
  auth.uid() is not null
  and public.is_org_member(organization_id)
  and public.is_mcn_staff(organization_id)
);

create or replace function public.save_custom_settlement_rule_draft(
  p_organization_id uuid,
  p_project_id uuid,
  p_rule_version_id uuid,
  p_scope text,
  p_target_type text,
  p_target_id uuid,
  p_draft jsonb,
  p_client_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor_id uuid := auth.uid();
begin
  if auth.uid() is null or v_actor_id is null then
    raise exception 'authentication_required';
  end if;
  if not public.is_org_member(p_organization_id)
     or not public.can_access_project(p_project_id)
     or public.current_user_role(p_organization_id) is null
     or public.current_user_role(p_organization_id) not in (
       'owner',
       'ops_manager',
       'operator_business'
     ) then
    raise exception 'custom_settlement_rule_draft_access_denied';
  end if;
  if p_scope is null
     or p_scope not in (
       'receivable',
       'payable',
       'external_cost',
       'reconciliation'
     )
     or p_target_type is null
     or p_target_type not in (
       'project',
       'streamer_group',
       'project_streamer'
     )
     or (p_target_type = 'project' and p_target_id is not null)
     or (p_target_type <> 'project' and p_target_id is null)
     or (p_scope <> 'payable' and p_target_type <> 'project') then
    raise exception 'custom_settlement_rule_target_invalid';
  end if;

  perform public.settlement_ai_lock_authoring_parents(
    p_organization_id,
    v_actor_id,
    p_project_id
  );
  perform 1
  from public.settlement_rule_groups as rule_group
  where p_target_type = 'streamer_group'
    and rule_group.id = p_target_id
    and rule_group.organization_id = p_organization_id
    and rule_group.project_id = p_project_id
  for update;
  if p_target_type = 'streamer_group' and not found then
    raise exception 'custom_settlement_rule_group_scope_mismatch';
  end if;
  perform 1
  from public.project_streamers as project_streamer
  where p_target_type = 'project_streamer'
    and project_streamer.id = p_target_id
    and project_streamer.organization_id = p_organization_id
    and project_streamer.project_id = p_project_id
  for update;
  if p_target_type = 'project_streamer' and not found then
    raise exception 'custom_settlement_rule_project_streamer_scope_mismatch';
  end if;
  perform 1
  from public.custom_settlement_rule_versions as version
  where version.organization_id = p_organization_id
    and version.project_id = p_project_id
    and version.scope = p_scope
    and version.target_type = p_target_type
    and version.target_id is not distinct from p_target_id
    and (
      p_rule_version_id is null
      or version.id = p_rule_version_id
    )
  order by version.version_number, version.id
  for update;
  if p_rule_version_id is not null and not found then
    raise exception 'custom_settlement_rule_version_scope_mismatch';
  end if;

  raise exception 'save_custom_settlement_rule_draft_not_implemented_phase2_task1';
end;
$$;

create or replace function public.apply_and_submit_custom_settlement_rule(
  p_organization_id uuid,
  p_project_id uuid,
  p_ai_draft_id uuid,
  p_source_simulation_id uuid,
  p_rule_version_id uuid,
  p_version_simulation_id uuid,
  p_scope text,
  p_target_type text,
  p_target_id uuid,
  p_effective_from timestamptz,
  p_reason text,
  p_client_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor_id uuid := auth.uid();
begin
  if auth.uid() is null or v_actor_id is null then
    raise exception 'authentication_required';
  end if;
  if not public.is_org_member(p_organization_id)
     or not public.can_access_project(p_project_id)
     or public.current_user_role(p_organization_id) is null
     or public.current_user_role(p_organization_id) not in (
       'owner',
       'ops_manager',
       'operator_business'
     ) then
    raise exception 'custom_settlement_rule_submit_access_denied';
  end if;
  if p_scope is null
     or p_scope not in (
       'receivable',
       'payable',
       'external_cost',
       'reconciliation'
     )
     or p_target_type is null
     or p_target_type not in (
       'project',
       'streamer_group',
       'project_streamer'
     )
     or (p_target_type = 'project' and p_target_id is not null)
     or (p_target_type <> 'project' and p_target_id is null)
     or (p_scope <> 'payable' and p_target_type <> 'project') then
    raise exception 'custom_settlement_rule_target_invalid';
  end if;

  perform public.settlement_ai_lock_authoring_parents(
    p_organization_id,
    v_actor_id,
    p_project_id
  );
  perform 1
  from public.settlement_rule_groups as rule_group
  where p_target_type = 'streamer_group'
    and rule_group.id = p_target_id
    and rule_group.organization_id = p_organization_id
    and rule_group.project_id = p_project_id
  for update;
  if p_target_type = 'streamer_group' and not found then
    raise exception 'custom_settlement_rule_group_scope_mismatch';
  end if;
  perform 1
  from public.project_streamers as project_streamer
  where p_target_type = 'project_streamer'
    and project_streamer.id = p_target_id
    and project_streamer.organization_id = p_organization_id
    and project_streamer.project_id = p_project_id
  for update;
  if p_target_type = 'project_streamer' and not found then
    raise exception 'custom_settlement_rule_project_streamer_scope_mismatch';
  end if;
  perform 1
  from public.ai_settlement_rule_drafts as draft
  where draft.id = p_ai_draft_id
    and draft.organization_id = p_organization_id
    and draft.project_id = p_project_id
  for update;
  if not found then
    raise exception 'custom_settlement_rule_draft_scope_mismatch';
  end if;
  perform 1
  from public.settlement_formula_simulations as simulation
  where simulation.id = p_source_simulation_id
    and simulation.organization_id = p_organization_id
    and simulation.project_id = p_project_id
  for update;
  if not found then
    raise exception 'custom_settlement_rule_simulation_scope_mismatch';
  end if;
  perform 1
  from public.custom_settlement_rule_versions as version
  where version.organization_id = p_organization_id
    and version.project_id = p_project_id
    and version.scope = p_scope
    and version.target_type = p_target_type
    and version.target_id is not distinct from p_target_id
  order by version.version_number, version.id
  for update;

  raise exception 'apply_and_submit_custom_settlement_rule_not_implemented_phase2_task1';
end;
$$;

create or replace function public.review_custom_settlement_rule(
  p_organization_id uuid,
  p_project_id uuid,
  p_rule_version_id uuid,
  p_action text,
  p_effective_from timestamptz,
  p_reason text,
  p_comment text,
  p_force boolean,
  p_acknowledgment text,
  p_client_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor_id uuid := auth.uid();
begin
  if auth.uid() is null or v_actor_id is null then
    raise exception 'authentication_required';
  end if;
  if not public.is_org_member(p_organization_id)
     or not public.can_access_project(p_project_id)
     or public.current_user_role(p_organization_id) is null
     or public.current_user_role(p_organization_id) not in (
       'owner',
       'ops_manager',
       'finance'
     ) then
    raise exception 'custom_settlement_rule_review_access_denied';
  end if;

  perform public.settlement_ai_lock_authoring_parents(
    p_organization_id,
    v_actor_id,
    p_project_id
  );
  perform 1
  from public.custom_settlement_rule_versions as version
  where version.id = p_rule_version_id
    and version.organization_id = p_organization_id
    and version.project_id = p_project_id
  for update;
  if not found then
    raise exception 'custom_settlement_rule_version_scope_mismatch';
  end if;

  raise exception 'review_custom_settlement_rule_not_implemented_phase2_task1';
end;
$$;

create or replace function public.archive_custom_settlement_rule(
  p_organization_id uuid,
  p_project_id uuid,
  p_rule_version_id uuid,
  p_effective_until timestamptz,
  p_reason text,
  p_client_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor_id uuid := auth.uid();
begin
  if auth.uid() is null or v_actor_id is null then
    raise exception 'authentication_required';
  end if;
  if not public.is_org_member(p_organization_id)
     or not public.can_access_project(p_project_id)
     or public.current_user_role(p_organization_id) is null
     or public.current_user_role(p_organization_id) not in (
       'owner',
       'ops_manager'
     ) then
    raise exception 'custom_settlement_rule_archive_access_denied';
  end if;

  if p_effective_until is null then
    raise exception 'custom_settlement_rule_archive_end_required';
  end if;

  perform public.settlement_ai_lock_authoring_parents(
    p_organization_id,
    v_actor_id,
    p_project_id
  );
  perform 1
  from public.custom_settlement_rule_versions as version
  where version.id = p_rule_version_id
    and version.organization_id = p_organization_id
    and version.project_id = p_project_id
  for update;
  if not found then
    raise exception 'custom_settlement_rule_version_scope_mismatch';
  end if;

  raise exception 'archive_custom_settlement_rule_not_implemented_phase2_task1';
end;
$$;

create or replace function public.change_settlement_group_assignment(
  p_organization_id uuid,
  p_project_id uuid,
  p_project_streamer_id uuid,
  p_group_id uuid,
  p_effective_from timestamptz,
  p_effective_until timestamptz,
  p_reason text,
  p_client_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor_id uuid := auth.uid();
begin
  if auth.uid() is null or v_actor_id is null then
    raise exception 'authentication_required';
  end if;
  if not public.is_org_member(p_organization_id)
     or not public.can_access_project(p_project_id)
     or public.current_user_role(p_organization_id) is null
     or public.current_user_role(p_organization_id) not in (
       'owner',
       'ops_manager'
     ) then
    raise exception 'settlement_group_assignment_access_denied';
  end if;
  if p_effective_from is null
     or (
       p_effective_until is not null
       and p_effective_until <= p_effective_from
     )
     or p_reason is null
     or p_reason <> pg_catalog.btrim(p_reason)
     or pg_catalog.char_length(p_reason) not between 1 and 4000 then
    raise exception 'settlement_group_assignment_input_invalid';
  end if;

  perform public.settlement_ai_lock_authoring_parents(
    p_organization_id,
    v_actor_id,
    p_project_id
  );
  perform 1
  from public.settlement_rule_groups as rule_group
  where rule_group.id = p_group_id
    and rule_group.organization_id = p_organization_id
    and rule_group.project_id = p_project_id
    and rule_group.status = 'active'
  for update;
  if not found then
    raise exception 'settlement_rule_group_scope_mismatch';
  end if;
  perform 1
  from public.project_streamers as project_streamer
  where project_streamer.id = p_project_streamer_id
    and project_streamer.organization_id = p_organization_id
    and project_streamer.project_id = p_project_id
  for update;
  if not found then
    raise exception 'project_streamer_scope_mismatch';
  end if;
  perform 1
  from public.project_streamer_settlement_group_assignments as assignment
  where assignment.organization_id = p_organization_id
    and assignment.project_id = p_project_id
    and assignment.project_streamer_id = p_project_streamer_id
    and assignment.group_id = p_group_id
  order by assignment.effective_from, assignment.id
  for update;

  raise exception 'change_settlement_group_assignment_not_implemented_phase2_task1';
end;
$$;

revoke all on table public.custom_settlement_rule_versions
  from public, anon, authenticated, service_role;
revoke all on table public.custom_settlement_rule_review_events
  from public, anon, authenticated, service_role;
revoke all on table public.settlement_rule_groups
  from public, anon, authenticated, service_role;
revoke all on table public.project_streamer_settlement_group_assignments
  from public, anon, authenticated, service_role;
revoke all on table public.settlement_rule_templates
  from public, anon, authenticated, service_role;

grant select on table public.custom_settlement_rule_versions to authenticated;
grant select on table public.custom_settlement_rule_review_events to authenticated;
grant select on table public.settlement_rule_groups to authenticated;
grant select on table public.project_streamer_settlement_group_assignments
  to authenticated;
grant select on table public.settlement_rule_templates to authenticated;

revoke all on function public.guard_custom_settlement_rule_version_mutation()
  from public, anon, authenticated, service_role;
revoke all on function public.prevent_custom_settlement_review_event_mutation()
  from public, anon, authenticated, service_role;
revoke all on function public.prevent_custom_settlement_governance_delete()
  from public, anon, authenticated, service_role;

revoke all on function public.save_custom_settlement_rule_draft(
  uuid,
  uuid,
  uuid,
  text,
  text,
  uuid,
  jsonb,
  text
) from public, anon, authenticated, service_role;
grant execute on function public.save_custom_settlement_rule_draft(
  uuid,
  uuid,
  uuid,
  text,
  text,
  uuid,
  jsonb,
  text
) to authenticated;

revoke all on function public.apply_and_submit_custom_settlement_rule(
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  text,
  uuid,
  timestamptz,
  text,
  text
) from public, anon, authenticated, service_role;
grant execute on function public.apply_and_submit_custom_settlement_rule(
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  text,
  uuid,
  timestamptz,
  text,
  text
) to authenticated;

revoke all on function public.review_custom_settlement_rule(
  uuid,
  uuid,
  uuid,
  text,
  timestamptz,
  text,
  text,
  boolean,
  text,
  text
) from public, anon, authenticated, service_role;
grant execute on function public.review_custom_settlement_rule(
  uuid,
  uuid,
  uuid,
  text,
  timestamptz,
  text,
  text,
  boolean,
  text,
  text
) to authenticated;

revoke all on function public.archive_custom_settlement_rule(
  uuid,
  uuid,
  uuid,
  timestamptz,
  text,
  text
) from public, anon, authenticated, service_role;
grant execute on function public.archive_custom_settlement_rule(
  uuid,
  uuid,
  uuid,
  timestamptz,
  text,
  text
) to authenticated;

revoke all on function public.change_settlement_group_assignment(
  uuid,
  uuid,
  uuid,
  uuid,
  timestamptz,
  timestamptz,
  text,
  text
) from public, anon, authenticated, service_role;
grant execute on function public.change_settlement_group_assignment(
  uuid,
  uuid,
  uuid,
  uuid,
  timestamptz,
  timestamptz,
  text,
  text
) to authenticated;

reset search_path;
