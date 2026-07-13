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
  reopened_at timestamptz,
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
  constraint custom_rule_review_events_scope_identity_key
    unique (id, rule_version_id, organization_id, project_id),
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

create table public.custom_settlement_rule_lifecycle_requests (
  actor_id uuid not null,
  client_request_id text not null,
  organization_id uuid not null,
  project_id uuid not null,
  rule_version_id uuid not null,
  event_id uuid,
  request_fingerprint text not null,
  version_snapshot jsonb not null,
  created_at timestamptz not null default pg_catalog.now(),
  constraint custom_settlement_rule_lifecycle_requests_pkey
    primary key (actor_id, client_request_id),
  constraint custom_rule_lifecycle_requests_actor_fkey
    foreign key (actor_id)
    references public.profiles(id)
    on delete restrict,
  constraint custom_rule_lifecycle_requests_organization_fkey
    foreign key (organization_id)
    references public.organizations(id)
    on delete restrict,
  constraint custom_rule_lifecycle_requests_rule_scope_fkey
    foreign key (rule_version_id, organization_id, project_id)
    references public.custom_settlement_rule_versions(
      id,
      organization_id,
      project_id
    )
    on delete restrict,
  constraint custom_rule_lifecycle_requests_event_scope_fkey
    foreign key (
      event_id,
      rule_version_id,
      organization_id,
      project_id
    )
    references public.custom_settlement_rule_review_events(
      id,
      rule_version_id,
      organization_id,
      project_id
    )
    on delete restrict,
  constraint custom_rule_lifecycle_requests_client_id_check check (
    client_request_id = pg_catalog.btrim(client_request_id)
    and pg_catalog.char_length(client_request_id) between 1 and 120
  ),
  constraint custom_rule_lifecycle_requests_fingerprint_check check (
    request_fingerprint ~ '^[0-9a-f]{64}$'
  ),
  constraint custom_rule_lifecycle_requests_snapshot_check check (
    pg_catalog.jsonb_typeof(version_snapshot) = 'object'
    and public.settlement_ai_json_within_budget(version_snapshot)
    and public.settlement_ai_json_is_safe(version_snapshot)
  )
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
     or new.reopened_at is distinct from old.reopened_at
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

create or replace function public.prevent_custom_settlement_lifecycle_request_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  raise exception 'custom settlement rule lifecycle requests are immutable';
end;
$$;

create trigger custom_settlement_rule_lifecycle_requests_immutable
before update or delete on public.custom_settlement_rule_lifecycle_requests
for each row execute function public.prevent_custom_settlement_lifecycle_request_mutation();

create trigger custom_settlement_rule_lifecycle_requests_no_truncate
before truncate on public.custom_settlement_rule_lifecycle_requests
for each statement execute function public.prevent_custom_settlement_lifecycle_request_mutation();

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
alter table public.custom_settlement_rule_lifecycle_requests enable row level security;
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

create or replace function public.custom_settlement_rule_request_fingerprint(
  p_operation text,
  p_payload jsonb
)
returns text
language sql
immutable
set search_path = pg_catalog, public
as $$
  select pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        p_operation || ':' || coalesce(p_payload, '{}'::jsonb)::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
$$;

create or replace function public.custom_settlement_rule_lifecycle_result(
  p_rule_version_id uuid,
  p_event_id uuid
)
returns jsonb
language sql
stable
set search_path = pg_catalog, public
as $$
  select pg_catalog.jsonb_build_object(
    'version',
    pg_catalog.to_jsonb(version) - array[
      'target_group_id',
      'target_project_streamer_id',
      'reopened_at'
    ]::text[],
    'simulation', pg_catalog.to_jsonb(simulation)
  ) || case
    when p_event_id is null then '{}'::jsonb
    else pg_catalog.jsonb_build_object('event', pg_catalog.to_jsonb(event))
  end
  from public.custom_settlement_rule_versions as version
  join public.settlement_formula_simulations as simulation
    on simulation.id = version.simulation_id
   and simulation.rule_version_id = version.id
   and simulation.organization_id = version.organization_id
   and simulation.project_id = version.project_id
  left join public.custom_settlement_rule_review_events as event
    on event.id = p_event_id
   and event.rule_version_id = version.id
   and event.organization_id = version.organization_id
   and event.project_id = version.project_id
  where version.id = p_rule_version_id;
$$;

create or replace function public.create_settlement_rule_group(
  p_organization_id uuid,
  p_project_id uuid,
  p_name text,
  p_description text,
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
  v_actor_role text;
  v_group public.settlement_rule_groups%rowtype;
begin
  if auth.uid() is null or v_actor_id is null then
    raise exception 'authentication_required';
  end if;
  v_actor_role := public.current_user_role(p_organization_id);
  if not public.is_org_member(p_organization_id)
     or not public.can_access_project(p_project_id)
     or v_actor_role is null
     or v_actor_role not in (
       'owner',
       'ops_manager'
     ) then
    raise exception 'settlement_rule_group_create_access_denied';
  end if;
  if p_name is null
     or p_name <> pg_catalog.btrim(p_name)
     or pg_catalog.char_length(p_name) not between 1 and 120
     or (
       p_description is not null
       and (
         p_description <> pg_catalog.btrim(p_description)
         or pg_catalog.char_length(p_description) not between 1 and 2000
       )
     )
     or p_reason is null
     or p_reason <> pg_catalog.btrim(p_reason)
     or pg_catalog.char_length(p_reason) not between 1 and 4000
     or p_client_request_id is null
     or p_client_request_id <> pg_catalog.btrim(p_client_request_id)
     or pg_catalog.char_length(p_client_request_id) not between 1 and 120 then
    raise exception 'settlement_rule_group_input_invalid';
  end if;

  perform public.settlement_ai_lock_authoring_parents(
    p_organization_id,
    v_actor_id,
    p_project_id
  );
  perform 1
  from public.projects as project
  where project.id = p_project_id
    and project.organization_id = p_organization_id
  for update;
  if not found then
    raise exception 'settlement_rule_group_project_scope_mismatch';
  end if;
  if exists (
    select 1
    from public.settlement_rule_groups as rule_group
    where rule_group.project_id = p_project_id
      and pg_catalog.lower(rule_group.name) = pg_catalog.lower(p_name)
      and rule_group.status = 'active'
  ) then
    raise exception 'settlement_rule_group_duplicate_active_name';
  end if;

  insert into public.settlement_rule_groups (
    organization_id, project_id, name, description, created_by
  ) values (
    p_organization_id, p_project_id, p_name, p_description, v_actor_id
  ) returning * into v_group;

  return pg_catalog.to_jsonb(v_group) || pg_catalog.jsonb_build_object(
    'assignment_count', 0,
    'active_rule_count', 0,
    'pending_rule_count', 0,
    'future_assignment_count', 0
  );
end;
$$;

create or replace function public.save_custom_settlement_rule_draft(
  p_organization_id uuid,
  p_project_id uuid,
  p_source_ai_draft_id uuid,
  p_source_simulation_id uuid,
  p_rule_version_id uuid,
  p_version_simulation_id uuid,
  p_scope text,
  p_target_type text,
  p_target_id uuid,
  p_draft jsonb,
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
  v_actor_role text;
  v_existing public.custom_settlement_rule_versions%rowtype;
  v_source_draft public.ai_settlement_rule_drafts%rowtype;
  v_source_simulation public.settlement_formula_simulations%rowtype;
  v_version_number integer;
  v_request_key text;
  v_request_fingerprint text;
  v_request_record public.custom_settlement_rule_lifecycle_requests%rowtype;
  v_result jsonb;
begin
  if auth.uid() is null or v_actor_id is null then
    raise exception 'authentication_required';
  end if;
  v_actor_role := public.current_user_role(p_organization_id);
  if not public.is_org_member(p_organization_id)
     or not public.can_access_project(p_project_id)
     or v_actor_role is null
     or v_actor_role not in (
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
     or (p_scope <> 'payable' and p_target_type <> 'project')
     or p_rule_version_id is null
     or p_version_simulation_id is null
     or p_rule_version_id = p_version_simulation_id then
    raise exception 'custom_settlement_rule_target_invalid';
  end if;
  if p_client_request_id is null
     or p_client_request_id <> pg_catalog.btrim(p_client_request_id)
     or pg_catalog.char_length(p_client_request_id) not between 1 and 120
     or p_reason is null
     or p_reason <> pg_catalog.btrim(p_reason)
     or pg_catalog.char_length(p_reason) not between 1 and 4000
     or pg_catalog.jsonb_typeof(p_draft) <> 'object'
     or not public.settlement_ai_json_within_budget(p_draft)
     or pg_catalog.jsonb_typeof(p_draft -> 'compiledAst') <> 'object'
     or pg_catalog.jsonb_typeof(p_draft -> 'variables') <> 'array'
     or pg_catalog.jsonb_typeof(p_draft -> 'parameters') <> 'object'
     or pg_catalog.jsonb_typeof(p_draft -> 'ruleContract') <> 'object'
     or pg_catalog.jsonb_typeof(p_draft -> 'missingDataPolicy') <> 'object'
     or pg_catalog.jsonb_typeof(p_draft -> 'testCases') <> 'array'
     or coalesce((p_draft ->> 'priority')::numeric, -1) not between 0 and 1000000
     or coalesce(p_draft ->> 'formula', '') = ''
     or coalesce(p_draft ->> 'systemExplanationTemplate', '') = ''
     or not public.settlement_ai_normalized_ast_is_valid(p_draft -> 'compiledAst')
     or not public.settlement_ai_business_contract_is_valid(
       p_draft -> 'ruleContract'
     )
     or not public.settlement_ai_generated_test_cases_is_valid(
       p_draft -> 'testCases'
     ) then
    raise exception 'custom_settlement_rule_draft_input_invalid';
  end if;
  if coalesce(p_draft ->> 'formulaHash', '') !~ '^[0-9a-f]{64}$'
     or coalesce(p_draft ->> 'contractHash', '') !~ '^[0-9a-f]{64}$'
     or coalesce(p_draft ->> 'parameterHash', '') !~ '^[0-9a-f]{64}$'
     or coalesce(p_draft ->> 'catalogHash', '') !~ '^[0-9a-f]{64}$'
     or coalesce(p_draft ->> 'dataSelectionHash', '') !~ '^[0-9a-f]{64}$'
  then
    raise exception 'custom_settlement_rule_draft_hashes_required';
  end if;

  v_request_key := v_actor_id::text || ':' || p_client_request_id;
  v_request_fingerprint := public.custom_settlement_rule_request_fingerprint(
    'save_custom_settlement_rule_draft',
    pg_catalog.jsonb_build_object(
      'organizationId', p_organization_id,
      'projectId', p_project_id,
      'sourceAiDraftId', p_source_ai_draft_id,
      'sourceSimulationId', p_source_simulation_id,
      'ruleVersionId', p_rule_version_id,
      'versionSimulationId', p_version_simulation_id,
      'scope', p_scope,
      'targetType', p_target_type,
      'targetId', p_target_id,
      'draft', p_draft,
      'reason', p_reason
    )
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_organization_id::text || ':' || v_request_key,
      0
    )
  );
  select request.*
  into v_request_record
  from public.custom_settlement_rule_lifecycle_requests as request
  where request.actor_id = v_actor_id
    and request.client_request_id = p_client_request_id;
  if found then
    if v_request_record.request_fingerprint <> v_request_fingerprint then
      raise exception 'custom_settlement_rule_idempotency_conflict';
    end if;
    v_result := public.custom_settlement_rule_lifecycle_result(
      v_request_record.rule_version_id,
      v_request_record.event_id
    );
    return pg_catalog.jsonb_set(
      v_result,
      '{version}',
      v_request_record.version_snapshot,
      true
    );
  end if;

  perform public.settlement_ai_lock_authoring_parents(
    p_organization_id,
    v_actor_id,
    p_project_id
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_organization_id::text || ':' || p_project_id::text || ':' ||
      p_scope || ':' || p_target_type || ':' || coalesce(p_target_id::text, ''),
      0
    )
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
  order by version.version_number, version.id
  for update;

  select version.*
  into v_existing
  from public.custom_settlement_rule_versions as version
  where version.id = p_rule_version_id
  for update;
  if found then
    if v_existing.organization_id <> p_organization_id
       or v_existing.project_id <> p_project_id
       or v_existing.scope <> p_scope
       or v_existing.target_type <> p_target_type
       or v_existing.target_id is distinct from p_target_id
       or v_existing.created_by <> v_actor_id
       or v_existing.status <> 'draft' then
      raise exception 'custom_settlement_rule_version_scope_mismatch';
    end if;
    if p_version_simulation_id = v_existing.simulation_id then
      select simulation.*
      into v_source_simulation
      from public.settlement_formula_simulations as simulation
      where simulation.id = p_version_simulation_id
        and simulation.organization_id = p_organization_id
        and simulation.project_id = p_project_id
        and simulation.rule_version_id = v_existing.id
        and simulation.ai_draft_id is null
      for update;
      if not found
         or v_source_simulation.rule_version_id <> v_existing.id
         or p_draft ->> 'formulaHash' <> v_source_simulation.formula_hash
         or p_draft ->> 'contractHash' <>
           v_source_simulation.rule_contract_hash
         or p_draft ->> 'parameterHash' <> v_source_simulation.parameter_hash
         or p_draft ->> 'catalogHash' <>
           v_source_simulation.variable_catalog_version
         or p_draft ->> 'dataSelectionHash' <>
           v_source_simulation.data_selection_hash then
        raise exception 'custom_settlement_rule_resimulation_required';
      end if;
    else
      if p_source_simulation_id is null
         or v_existing.ai_draft_id is null
         or v_existing.reopened_at is null then
        raise exception 'custom_settlement_rule_resimulation_required';
      end if;
      if exists (
        select 1 from public.settlement_formula_simulations as simulation
        where simulation.id = p_version_simulation_id
      ) then
        raise exception 'custom_settlement_rule_destination_occupied';
      end if;
      select simulation.*
      into v_source_simulation
      from public.settlement_formula_simulations as simulation
      where simulation.id = p_source_simulation_id
        and simulation.organization_id = p_organization_id
        and simulation.project_id = p_project_id
        and simulation.ai_draft_id = v_existing.ai_draft_id
        and simulation.rule_version_id is null
        and simulation.created_by = v_actor_id
        and simulation.created_at > v_existing.reopened_at
      for update;
      if not found
         or p_draft ->> 'formulaHash' <> v_source_simulation.formula_hash
         or p_draft ->> 'contractHash' <>
           v_source_simulation.rule_contract_hash
         or p_draft ->> 'parameterHash' <> v_source_simulation.parameter_hash
         or p_draft ->> 'catalogHash' <>
           v_source_simulation.variable_catalog_version
         or p_draft ->> 'dataSelectionHash' <>
           v_source_simulation.data_selection_hash then
        raise exception 'custom_settlement_rule_resimulation_required';
      end if;
      update public.settlement_formula_simulations as old_simulation
      set rule_version_id = null,
          ai_draft_id = v_existing.ai_draft_id
      where old_simulation.id = v_existing.simulation_id
        and old_simulation.organization_id = p_organization_id
        and old_simulation.project_id = p_project_id
        and old_simulation.rule_version_id = v_existing.id
        and old_simulation.ai_draft_id is null;
      if not found then
        raise exception 'custom_settlement_rule_resimulation_required';
      end if;
      insert into public.settlement_formula_simulations (
        id, organization_id, project_id, rule_version_id, ai_draft_id,
        formula_hash, rule_contract_hash, parameter_hash,
        variable_catalog_version, data_selection_hash, sample_source,
        sample_selection, coverage, scenarios, historical_totals, deltas,
        largest_changes, warnings, idempotency_key, created_by
      ) select
        p_version_simulation_id, p_organization_id, p_project_id,
        p_rule_version_id, null,
        simulation.formula_hash, simulation.rule_contract_hash,
        simulation.parameter_hash, simulation.variable_catalog_version,
        simulation.data_selection_hash, simulation.sample_source,
        simulation.sample_selection, simulation.coverage,
        simulation.scenarios, simulation.historical_totals, simulation.deltas,
        simulation.largest_changes, simulation.warnings,
        'lifecycle:' || p_client_request_id, v_actor_id
      from public.settlement_formula_simulations as simulation
      where simulation.id = p_source_simulation_id;
    end if;
    if (
      v_existing.priority is distinct from (p_draft ->> 'priority')::integer
      or v_existing.formula is distinct from p_draft ->> 'formula'
      or v_existing.compiled_ast is distinct from p_draft -> 'compiledAst'
      or v_existing.variables is distinct from p_draft -> 'variables'
      or v_existing.parameters is distinct from p_draft -> 'parameters'
      or v_existing.rule_contract is distinct from p_draft -> 'ruleContract'
      or v_existing.system_explanation_template is distinct from
        p_draft ->> 'systemExplanationTemplate'
      or v_existing.missing_data_policy is distinct from
        p_draft -> 'missingDataPolicy'
      or v_existing.test_cases is distinct from p_draft -> 'testCases'
    ) and v_existing.formula_hash = p_draft ->> 'formulaHash'
      and v_existing.rule_contract_hash = p_draft ->> 'contractHash'
      and v_existing.parameter_hash = p_draft ->> 'parameterHash'
      and v_existing.variable_catalog_version = p_draft ->> 'catalogHash'
      and v_existing.data_selection_hash = p_draft ->> 'dataSelectionHash'
    then
      raise exception 'custom_settlement_rule_draft_hashes_must_change';
    end if;
    update public.custom_settlement_rule_versions as version
    set priority = (p_draft ->> 'priority')::integer,
        formula = p_draft ->> 'formula',
        compiled_ast = p_draft -> 'compiledAst',
        variables = p_draft -> 'variables',
        parameters = p_draft -> 'parameters',
        rule_contract = p_draft -> 'ruleContract',
        execution_grain = p_draft -> 'ruleContract' ->> 'executionGrain',
        composition_mode = p_draft -> 'ruleContract' ->> 'compositionMode',
        system_explanation_template =
          p_draft ->> 'systemExplanationTemplate',
        missing_data_policy = p_draft -> 'missingDataPolicy',
        test_cases = p_draft -> 'testCases',
        formula_hash = p_draft ->> 'formulaHash',
        rule_contract_hash = p_draft ->> 'contractHash',
        parameter_hash = p_draft ->> 'parameterHash',
        variable_catalog_version = p_draft ->> 'catalogHash',
        data_selection_hash = p_draft ->> 'dataSelectionHash',
        simulation_summary = pg_catalog.jsonb_build_object(
          'coverage', v_source_simulation.coverage,
          'historicalTotals', v_source_simulation.historical_totals,
          'deltas', v_source_simulation.deltas,
          'warnings', v_source_simulation.warnings
        ),
        simulation_id = p_version_simulation_id,
        reason = p_reason
    where version.id = p_rule_version_id;
  else
    if p_source_ai_draft_id is null or p_source_simulation_id is null then
      raise exception 'custom_settlement_rule_draft_source_required';
    end if;
    select draft.*
    into v_source_draft
    from public.ai_settlement_rule_drafts as draft
    where draft.id = p_source_ai_draft_id
      and draft.organization_id = p_organization_id
      and draft.project_id = p_project_id
      and draft.created_by = v_actor_id
    for update;
    if not found or v_source_draft.status <> 'simulated' then
      raise exception 'custom_settlement_rule_draft_scope_mismatch';
    end if;
    select simulation.*
    into v_source_simulation
    from public.settlement_formula_simulations as simulation
    where simulation.id = p_source_simulation_id
      and simulation.organization_id = p_organization_id
      and simulation.project_id = p_project_id
      and simulation.ai_draft_id = p_source_ai_draft_id
      and simulation.rule_version_id is null
      and simulation.created_by = v_actor_id
    for update;
    if not found then
      raise exception 'custom_settlement_rule_simulation_scope_mismatch';
    end if;
    if exists (
      select 1 from public.settlement_formula_simulations as simulation
      where simulation.id = p_version_simulation_id
    ) then
      raise exception 'custom_settlement_rule_destination_occupied';
    end if;
    if p_draft ->> 'formulaHash' <> v_source_simulation.formula_hash
       or p_draft ->> 'contractHash' <> v_source_simulation.rule_contract_hash
       or p_draft ->> 'parameterHash' <> v_source_simulation.parameter_hash
       or p_draft ->> 'catalogHash' <>
         v_source_simulation.variable_catalog_version
       or p_draft ->> 'dataSelectionHash' <>
         v_source_simulation.data_selection_hash then
      raise exception 'custom_settlement_rule_stale_simulation';
    end if;
    select coalesce(pg_catalog.max(version.version_number), 0) + 1
    into v_version_number
    from public.custom_settlement_rule_versions as version
    where version.organization_id = p_organization_id
      and version.project_id = p_project_id
      and version.scope = p_scope
      and version.target_type = p_target_type
      and version.target_id is not distinct from p_target_id;
    insert into public.custom_settlement_rule_versions (
      id, organization_id, project_id, scope, target_type, target_id,
      execution_grain, composition_mode, priority, version_number, status,
      formula, compiled_ast, variables, parameters, rule_contract,
      system_explanation_template, missing_data_policy, test_cases,
      simulation_summary, formula_hash, rule_contract_hash, parameter_hash,
      variable_catalog_version, data_selection_hash, simulation_id,
      created_by, ai_draft_id, reason
    ) values (
      p_rule_version_id, p_organization_id, p_project_id, p_scope,
      p_target_type, p_target_id,
      p_draft -> 'ruleContract' ->> 'executionGrain',
      p_draft -> 'ruleContract' ->> 'compositionMode',
      (p_draft ->> 'priority')::integer, v_version_number, 'draft',
      p_draft ->> 'formula', p_draft -> 'compiledAst',
      p_draft -> 'variables', p_draft -> 'parameters',
      p_draft -> 'ruleContract', p_draft ->> 'systemExplanationTemplate',
      p_draft -> 'missingDataPolicy', p_draft -> 'testCases',
      pg_catalog.jsonb_build_object(
        'coverage', v_source_simulation.coverage,
        'historicalTotals', v_source_simulation.historical_totals,
        'deltas', v_source_simulation.deltas,
        'warnings', v_source_simulation.warnings
      ),
      p_draft ->> 'formulaHash', p_draft ->> 'contractHash',
      p_draft ->> 'parameterHash', p_draft ->> 'catalogHash',
      p_draft ->> 'dataSelectionHash',
      p_version_simulation_id, v_actor_id, p_source_ai_draft_id, p_reason
    );
    insert into public.settlement_formula_simulations (
      id, organization_id, project_id, rule_version_id, ai_draft_id,
      formula_hash, rule_contract_hash, parameter_hash,
      variable_catalog_version, data_selection_hash, sample_source,
      sample_selection, coverage, scenarios, historical_totals, deltas,
      largest_changes, warnings, idempotency_key, created_by
    ) select
      p_version_simulation_id, p_organization_id, p_project_id,
      p_rule_version_id, null,
      simulation.formula_hash, simulation.rule_contract_hash,
      simulation.parameter_hash, simulation.variable_catalog_version,
      simulation.data_selection_hash, simulation.sample_source,
      simulation.sample_selection, simulation.coverage, simulation.scenarios,
      simulation.historical_totals, simulation.deltas,
      simulation.largest_changes, simulation.warnings,
      'lifecycle:' || p_client_request_id, v_actor_id
    from public.settlement_formula_simulations as simulation
    where simulation.id = p_source_simulation_id;
  end if;

  v_result := public.custom_settlement_rule_lifecycle_result(
    p_rule_version_id,
    null
  );
  if v_result is null then
    raise exception 'custom_settlement_rule_atomic_result_missing';
  end if;
  insert into public.custom_settlement_rule_lifecycle_requests (
    actor_id, client_request_id, organization_id, project_id,
    rule_version_id, event_id, request_fingerprint, version_snapshot
  ) values (
    v_actor_id, p_client_request_id, p_organization_id, p_project_id,
    p_rule_version_id, null, v_request_fingerprint, v_result -> 'version'
  );
  return v_result;
end;
$$;

drop function if exists public.apply_and_submit_custom_settlement_rule(
  uuid, uuid, uuid, uuid, uuid, uuid, text, text, uuid,
  timestamptz, text, text
);

create or replace function public.apply_and_submit_custom_settlement_rule(
  p_organization_id uuid,
  p_project_id uuid,
  p_source_ai_draft_id uuid,
  p_source_rule_version_id uuid,
  p_source_simulation_id uuid,
  p_rule_version_id uuid,
  p_version_simulation_id uuid,
  p_scope text,
  p_target_type text,
  p_target_id uuid,
  p_effective_from timestamptz,
  p_reason text,
  p_submission_event_type text,
  p_client_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor_id uuid := auth.uid();
  v_actor_role text;
  v_source_draft public.ai_settlement_rule_drafts%rowtype;
  v_source_version public.custom_settlement_rule_versions%rowtype;
  v_source_simulation public.settlement_formula_simulations%rowtype;
  v_version_number integer;
  v_formula text;
  v_compiled_ast jsonb;
  v_variables jsonb;
  v_parameters jsonb;
  v_rule_contract jsonb;
  v_explanation text;
  v_missing_data_policy jsonb;
  v_test_cases jsonb;
  v_formula_hash text;
  v_contract_hash text;
  v_parameter_hash text;
  v_catalog_hash text;
  v_data_selection_hash text;
  v_ai_draft_id uuid;
  v_event_id uuid;
  v_request_key text;
  v_request_fingerprint text;
  v_request_record public.custom_settlement_rule_lifecycle_requests%rowtype;
  v_result jsonb;
begin
  if auth.uid() is null or v_actor_id is null then
    raise exception 'authentication_required';
  end if;
  v_actor_role := public.current_user_role(p_organization_id);
  if not public.is_org_member(p_organization_id)
     or not public.can_access_project(p_project_id)
     or v_actor_role is null
     or v_actor_role not in (
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
     or (p_scope <> 'payable' and p_target_type <> 'project')
     or p_source_simulation_id is null
     or p_rule_version_id is null
     or p_version_simulation_id is null
     or p_rule_version_id = p_version_simulation_id then
    raise exception 'custom_settlement_rule_target_invalid';
  end if;
  if (p_source_ai_draft_id is null) =
       (p_source_rule_version_id is null) then
    raise exception 'custom_settlement_rule_source_ambiguous';
  end if;
  if p_submission_event_type not in ('submitted', 'resubmitted')
     or (
       p_source_ai_draft_id is not null
       and p_submission_event_type <> 'submitted'
     )
     or (
       p_source_rule_version_id is not null
       and p_submission_event_type not in ('submitted', 'resubmitted')
     )
     or p_effective_from is null
     or p_reason is null
     or p_reason <> pg_catalog.btrim(p_reason)
     or pg_catalog.char_length(p_reason) not between 1 and 4000
     or p_client_request_id is null
     or p_client_request_id <> pg_catalog.btrim(p_client_request_id)
     or pg_catalog.char_length(p_client_request_id) not between 1 and 120 then
    raise exception 'custom_settlement_rule_submit_input_invalid';
  end if;

  v_request_key := v_actor_id::text || ':' || p_client_request_id;
  v_request_fingerprint := public.custom_settlement_rule_request_fingerprint(
    'apply_and_submit_custom_settlement_rule',
    pg_catalog.jsonb_build_object(
      'organizationId', p_organization_id,
      'projectId', p_project_id,
      'sourceAiDraftId', p_source_ai_draft_id,
      'sourceRuleVersionId', p_source_rule_version_id,
      'sourceSimulationId', p_source_simulation_id,
      'ruleVersionId', p_rule_version_id,
      'versionSimulationId', p_version_simulation_id,
      'scope', p_scope,
      'targetType', p_target_type,
      'targetId', p_target_id,
      'effectiveFrom', p_effective_from,
      'reason', p_reason,
      'eventType', p_submission_event_type
    )
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_organization_id::text || ':' || v_request_key,
      0
    )
  );
  select request.*
  into v_request_record
  from public.custom_settlement_rule_lifecycle_requests as request
  where request.actor_id = v_actor_id
    and request.client_request_id = p_client_request_id;
  if found then
    if v_request_record.request_fingerprint <> v_request_fingerprint then
      raise exception 'custom_settlement_rule_idempotency_conflict';
    end if;
    v_result := public.custom_settlement_rule_lifecycle_result(
      v_request_record.rule_version_id,
      v_request_record.event_id
    );
    return pg_catalog.jsonb_set(
      v_result,
      '{version}',
      v_request_record.version_snapshot,
      true
    );
  end if;

  perform public.settlement_ai_lock_authoring_parents(
    p_organization_id,
    v_actor_id,
    p_project_id
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_organization_id::text || ':' || p_project_id::text || ':' ||
      p_scope || ':' || p_target_type || ':' || coalesce(p_target_id::text, ''),
      0
    )
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
  order by version.version_number, version.id
  for update;

  if p_source_ai_draft_id is not null then
    select draft.*
    into v_source_draft
    from public.ai_settlement_rule_drafts as draft
    where draft.id = p_source_ai_draft_id
      and draft.organization_id = p_organization_id
      and draft.project_id = p_project_id
      and draft.created_by = v_actor_id
    for update;
    if not found
       or v_source_draft.status <> 'simulated'
       or v_source_draft.generated_formula is null
       or v_source_draft.generated_explanation is null
       or pg_catalog.jsonb_array_length(
         v_source_draft.unresolved_ambiguities
       ) <> 0
       or exists (
         select 1
         from pg_catalog.jsonb_array_elements(
           v_source_draft.safety_flags
         ) as flag(value)
         where flag.value ->> 'severity' = 'block'
       ) then
      raise exception 'custom_settlement_rule_draft_scope_mismatch';
    end if;
    v_formula := v_source_draft.generated_formula ->> 'expression';
    v_compiled_ast := v_source_draft.generated_formula -> 'normalizedAst';
    v_variables := v_source_draft.business_contract -> 'requiredInputs';
    v_parameters := '{}'::jsonb;
    v_rule_contract := v_source_draft.business_contract;
    v_explanation := v_source_draft.generated_explanation;
    v_missing_data_policy :=
      v_source_draft.business_contract -> 'missingDataPolicy';
    v_test_cases := v_source_draft.generated_test_cases;
    v_formula_hash := v_source_draft.formula_hash;
    v_contract_hash := v_source_draft.contract_hash;
    v_parameter_hash := v_source_draft.parameter_hash;
    v_catalog_hash := v_source_draft.variable_catalog_version;
    v_ai_draft_id := p_source_ai_draft_id;
  else
    select version.*
    into v_source_version
    from public.custom_settlement_rule_versions as version
    where version.id = p_source_rule_version_id
      and version.organization_id = p_organization_id
      and version.project_id = p_project_id
      and version.scope = p_scope
      and version.target_type = p_target_type
      and version.target_id is not distinct from p_target_id
      and version.created_by = v_actor_id
    for update;
    if not found or v_source_version.status <> 'draft' then
      raise exception 'custom_settlement_rule_version_scope_mismatch';
    end if;
    v_formula := v_source_version.formula;
    v_compiled_ast := v_source_version.compiled_ast;
    v_variables := v_source_version.variables;
    v_parameters := v_source_version.parameters;
    v_rule_contract := v_source_version.rule_contract;
    v_explanation := v_source_version.system_explanation_template;
    v_missing_data_policy := v_source_version.missing_data_policy;
    v_test_cases := v_source_version.test_cases;
    v_formula_hash := v_source_version.formula_hash;
    v_contract_hash := v_source_version.rule_contract_hash;
    v_parameter_hash := v_source_version.parameter_hash;
    v_catalog_hash := v_source_version.variable_catalog_version;
    v_data_selection_hash := v_source_version.data_selection_hash;
    v_ai_draft_id := v_source_version.ai_draft_id;
  end if;

  select simulation.*
  into v_source_simulation
  from public.settlement_formula_simulations as simulation
  where simulation.id = p_source_simulation_id
    and simulation.organization_id = p_organization_id
    and simulation.project_id = p_project_id
    and simulation.created_by = v_actor_id
    and (
      (
        p_source_ai_draft_id is not null
        and simulation.ai_draft_id = p_source_ai_draft_id
        and simulation.rule_version_id is null
      )
      or (
        p_source_rule_version_id is not null
        and (
          (
            p_submission_event_type = 'submitted'
            and simulation.rule_version_id = p_source_rule_version_id
          )
          or (
            p_submission_event_type = 'resubmitted'
            and v_source_version.reopened_at is not null
            and (
              (
                simulation.id = v_source_version.simulation_id
                and simulation.rule_version_id = p_source_rule_version_id
                and simulation.ai_draft_id is null
              )
              or (
                v_source_version.ai_draft_id is not null
                and simulation.ai_draft_id = v_source_version.ai_draft_id
                and simulation.rule_version_id is null
              )
            )
            and simulation.created_at > v_source_version.reopened_at
          )
        )
      )
    )
  for update;
  if not found then
    raise exception 'custom_settlement_rule_simulation_scope_mismatch';
  end if;
  if p_source_ai_draft_id is not null then
    v_data_selection_hash := v_source_simulation.data_selection_hash;
  end if;
  if v_source_simulation.formula_hash <> v_formula_hash
     or v_source_simulation.rule_contract_hash <> v_contract_hash
     or v_source_simulation.parameter_hash <> v_parameter_hash
     or v_source_simulation.variable_catalog_version <> v_catalog_hash
     or v_source_simulation.data_selection_hash <> v_data_selection_hash then
    raise exception 'custom_settlement_rule_stale_simulation';
  end if;
  if v_source_simulation.coverage ->> 'summarySchemaVersion' <> '2'
     or (v_source_simulation.coverage ->> 'blockedRecords')::integer <> 0
     or (v_source_simulation.coverage ->> 'uncoveredRecords')::integer <> 0
     or exists (
       select 1
       from pg_catalog.jsonb_array_elements(
         v_source_simulation.scenarios
       ) as scenario(value)
       where scenario.value ->> 'passed' <> 'true'
     )
     or exists (
       select 1
       from pg_catalog.jsonb_array_elements(
         v_source_simulation.warnings
       ) as warning(value)
       where warning.value ->> 'severity' = 'block'
     ) then
    raise exception 'custom_settlement_rule_data_not_ready';
  end if;
  if v_rule_contract ->> 'scope' <> p_scope
     or v_rule_contract -> 'target' ->> 'targetType' <> p_target_type
     or (
       p_target_id is null
       and pg_catalog.jsonb_typeof(
         v_rule_contract -> 'target' -> 'targetId'
       ) <> 'null'
     )
     or (
       p_target_id is not null
       and v_rule_contract -> 'target' ->> 'targetId' <> p_target_id::text
     ) then
    raise exception 'custom_settlement_rule_target_conflict';
  end if;
  if exists (
    select 1 from public.custom_settlement_rule_versions as version
    where version.id = p_rule_version_id
  ) or exists (
    select 1 from public.settlement_formula_simulations as simulation
    where simulation.id = p_version_simulation_id
  ) then
    raise exception 'custom_settlement_rule_destination_occupied';
  end if;

  select coalesce(pg_catalog.max(version.version_number), 0) + 1
  into v_version_number
  from public.custom_settlement_rule_versions as version
  where version.organization_id = p_organization_id
    and version.project_id = p_project_id
    and version.scope = p_scope
    and version.target_type = p_target_type
    and version.target_id is not distinct from p_target_id;

  insert into public.custom_settlement_rule_versions (
    id, organization_id, project_id, scope, target_type, target_id,
    execution_grain, composition_mode, priority, version_number, status,
    formula, compiled_ast, variables, parameters, rule_contract,
    system_explanation_template, missing_data_policy, test_cases,
    simulation_summary, formula_hash, rule_contract_hash, parameter_hash,
    variable_catalog_version, data_selection_hash, simulation_id,
    effective_from, created_by, ai_draft_id, reason
  ) values (
    p_rule_version_id, p_organization_id, p_project_id, p_scope,
    p_target_type, p_target_id, v_rule_contract ->> 'executionGrain',
    v_rule_contract ->> 'compositionMode', 100, v_version_number,
    'pending_review', v_formula, v_compiled_ast, v_variables, v_parameters,
    v_rule_contract, v_explanation, v_missing_data_policy, v_test_cases,
    pg_catalog.jsonb_build_object(
      'coverage', v_source_simulation.coverage,
      'historicalTotals', v_source_simulation.historical_totals,
      'deltas', v_source_simulation.deltas,
      'warnings', v_source_simulation.warnings
    ),
    v_formula_hash, v_contract_hash, v_parameter_hash, v_catalog_hash,
    v_data_selection_hash, p_version_simulation_id, p_effective_from,
    v_actor_id, v_ai_draft_id, p_reason
  );
  -- The copied row preserves settlement_formula_simulations_exactly_one_owner.
  insert into public.settlement_formula_simulations (
    id, organization_id, project_id, rule_version_id, ai_draft_id,
    formula_hash, rule_contract_hash, parameter_hash,
    variable_catalog_version, data_selection_hash, sample_source,
    sample_selection, coverage, scenarios, historical_totals, deltas,
    largest_changes, warnings, idempotency_key, created_by
  ) select
    p_version_simulation_id, p_organization_id, p_project_id,
    p_rule_version_id, null, simulation.formula_hash,
    simulation.rule_contract_hash, simulation.parameter_hash,
    simulation.variable_catalog_version, simulation.data_selection_hash,
    simulation.sample_source, simulation.sample_selection,
    simulation.coverage, simulation.scenarios, simulation.historical_totals,
    simulation.deltas, simulation.largest_changes, simulation.warnings,
    'lifecycle:' || p_client_request_id, v_actor_id
  from public.settlement_formula_simulations as simulation
  where simulation.id = p_source_simulation_id;
  insert into public.custom_settlement_rule_review_events (
    organization_id, project_id, rule_version_id, event_type, actor_id,
    actor_role, reason, before_status, after_status, risk_summary,
    formula_hash, rule_contract_hash, parameter_hash,
    variable_catalog_version, data_selection_hash
  ) values (
    p_organization_id, p_project_id, p_rule_version_id,
    p_submission_event_type, v_actor_id, v_actor_role, p_reason,
    'draft', 'pending_review',
    pg_catalog.jsonb_build_object(
      'sourceKind', case
        when p_source_ai_draft_id is not null then 'ai_draft'
        else 'saved_draft'
      end,
      'sourceId', coalesce(p_source_ai_draft_id, p_source_rule_version_id)
    ),
    v_formula_hash, v_contract_hash, v_parameter_hash, v_catalog_hash,
    v_data_selection_hash
  ) returning id into v_event_id;

  v_result := public.custom_settlement_rule_lifecycle_result(
    p_rule_version_id,
    v_event_id
  );
  if v_result is null then
    raise exception 'custom_settlement_rule_atomic_result_missing';
  end if;
  insert into public.custom_settlement_rule_lifecycle_requests (
    actor_id, client_request_id, organization_id, project_id,
    rule_version_id, event_id, request_fingerprint, version_snapshot
  ) values (
    v_actor_id, p_client_request_id, p_organization_id, p_project_id,
    p_rule_version_id, v_event_id, v_request_fingerprint,
    v_result -> 'version'
  );
  return v_result;
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
  p_risk_summary jsonb,
  p_client_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor_id uuid := auth.uid();
  v_actor_role text;
  v_version public.custom_settlement_rule_versions%rowtype;
  v_simulation public.settlement_formula_simulations%rowtype;
  v_event_id uuid;
  v_event_type text;
  v_before_status text;
  v_after_status text;
  v_eligible_approver_count integer := 0;
  v_eligible_owner_count integer := 0;
  v_actor_is_eligible boolean := false;
  v_another_eligible_approver_exists boolean := false;
  v_material_risk_codes text[] := array[]::text[];
  v_material_risk boolean := false;
  v_old_total_cents numeric;
  v_new_total_cents numeric;
  v_margin_impact_cents numeric;
  v_abnormal_total_increase_bps integer := 2000;
  v_safety_cap_cents numeric := 100000;
  v_missing_data_impact_cents numeric;
  v_approval_risk_summary jsonb := '{}'::jsonb;
  v_event_risk_summary jsonb := '{}'::jsonb;
  v_request_key text;
  v_request_fingerprint text;
  v_request_record public.custom_settlement_rule_lifecycle_requests%rowtype;
  v_result jsonb;
begin
  if auth.uid() is null or v_actor_id is null then
    raise exception 'authentication_required';
  end if;
  v_actor_role := public.current_user_role(p_organization_id);
  if not public.is_org_member(p_organization_id)
     or not public.can_access_project(p_project_id)
     or v_actor_role is null
     or v_actor_role not in (
       'owner',
       'ops_manager',
       'operator_business',
       'finance'
     ) then
    raise exception 'custom_settlement_rule_review_access_denied';
  end if;
  if p_action not in (
       'request_changes',
       'reopen',
       'approve',
       'activation_failed'
     )
     or p_client_request_id is null
     or p_client_request_id <> pg_catalog.btrim(p_client_request_id)
     or pg_catalog.char_length(p_client_request_id) not between 1 and 120
     or p_reason is null
     or p_reason <> pg_catalog.btrim(p_reason)
     or pg_catalog.char_length(p_reason) not between 1 and 4000
     or pg_catalog.jsonb_typeof(p_risk_summary) <> 'object'
     or not public.settlement_ai_json_within_budget(p_risk_summary)
     or not public.settlement_ai_json_is_safe(p_risk_summary) then
    raise exception 'custom_settlement_rule_review_input_invalid';
  end if;

  v_request_key := v_actor_id::text || ':' || p_client_request_id;
  v_request_fingerprint := public.custom_settlement_rule_request_fingerprint(
    'review_custom_settlement_rule',
    pg_catalog.jsonb_build_object(
      'organizationId', p_organization_id,
      'projectId', p_project_id,
      'ruleVersionId', p_rule_version_id,
      'action', p_action,
      'effectiveFrom', p_effective_from,
      'reason', p_reason,
      'comment', p_comment,
      'force', p_force,
      'acknowledgment', p_acknowledgment,
      'riskSummary', p_risk_summary
    )
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_organization_id::text || ':' || v_request_key,
      0
    )
  );
  select request.*
  into v_request_record
  from public.custom_settlement_rule_lifecycle_requests as request
  where request.actor_id = v_actor_id
    and request.client_request_id = p_client_request_id;
  if found then
    if v_request_record.request_fingerprint <> v_request_fingerprint then
      raise exception 'custom_settlement_rule_idempotency_conflict';
    end if;
    v_result := public.custom_settlement_rule_lifecycle_result(
      v_request_record.rule_version_id,
      v_request_record.event_id
    );
    return pg_catalog.jsonb_set(
      v_result,
      '{version}',
      v_request_record.version_snapshot,
      true
    );
  end if;

  perform public.settlement_ai_lock_authoring_parents(
    p_organization_id,
    v_actor_id,
    p_project_id
  );
  select version.*
  into v_version
  from public.custom_settlement_rule_versions as version
  where version.id = p_rule_version_id
    and version.organization_id = p_organization_id
    and version.project_id = p_project_id;
  if not found then
    raise exception 'custom_settlement_rule_version_scope_mismatch';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_organization_id::text || ':' || p_project_id::text || ':' ||
      v_version.scope || ':' || v_version.target_type || ':' ||
      coalesce(v_version.target_id::text, ''),
      0
    )
  );
  perform 1
  from public.custom_settlement_rule_versions as version
  where version.organization_id = p_organization_id
    and version.project_id = p_project_id
    and version.scope = v_version.scope
    and version.target_type = v_version.target_type
    and version.target_id is not distinct from v_version.target_id
  order by version.version_number, version.id
  for update;
  select version.*
  into v_version
  from public.custom_settlement_rule_versions as version
  where version.id = p_rule_version_id
  for update;

  v_before_status := v_version.status;
  if p_action = 'request_changes' then
    if v_actor_role not in ('owner', 'ops_manager', 'finance')
       or v_version.status <> 'pending_review'
       or p_force
       or p_effective_from is not null
       or p_comment is null
       or p_comment <> pg_catalog.btrim(p_comment)
       or pg_catalog.char_length(p_comment) not between 1 and 4000 then
      raise exception 'custom_settlement_rule_request_changes_denied';
    end if;
    update public.custom_settlement_rule_versions
    set status = 'changes_requested',
        reason = p_reason
    where id = p_rule_version_id;
    v_event_type := 'changes_requested';
    v_after_status := 'changes_requested';
  elsif p_action = 'reopen' then
    if v_actor_role not in ('owner', 'ops_manager', 'operator_business')
       or v_version.status <> 'changes_requested'
       or p_force
       or p_effective_from is not null then
      raise exception 'custom_settlement_rule_reopen_denied';
    end if;
    update public.custom_settlement_rule_versions
    set status = 'draft',
        reopened_at = pg_catalog.now(),
        reason = p_reason
    where id = p_rule_version_id;
    v_after_status := 'draft';
    v_event_id := null;
  elsif p_action = 'approve' then
    if v_actor_role not in ('owner', 'ops_manager')
       or v_version.status <> 'pending_review'
       or p_effective_from is null
       or p_comment is not null then
      raise exception 'custom_settlement_rule_approval_denied';
    end if;
    if p_force and (
      v_actor_role <> 'owner'
      or p_acknowledgment is distinct from
        'I_UNDERSTAND_SINGLE_OWNER_FINANCIAL_RISK'
    ) then
      raise exception 'custom_settlement_rule_force_approval_denied';
    end if;
    if not p_force and p_acknowledgment is not null then
      raise exception 'custom_settlement_rule_approval_input_invalid';
    end if;
    select simulation.*
    into v_simulation
    from public.settlement_formula_simulations as simulation
    where simulation.id = v_version.simulation_id
      and simulation.rule_version_id = v_version.id
      and simulation.organization_id = p_organization_id
      and simulation.project_id = p_project_id
    for update;
    if not found
       or v_simulation.formula_hash <> v_version.formula_hash
       or v_simulation.rule_contract_hash <> v_version.rule_contract_hash
       or v_simulation.parameter_hash <> v_version.parameter_hash
       or v_simulation.variable_catalog_version <>
         v_version.variable_catalog_version
       or v_simulation.data_selection_hash <> v_version.data_selection_hash
       or v_simulation.coverage ->> 'summarySchemaVersion' <> '2'
       or (v_simulation.coverage ->> 'blockedRecords')::integer <> 0
       or (v_simulation.coverage ->> 'uncoveredRecords')::integer <> 0 then
      raise exception 'custom_settlement_rule_stale_simulation';
    end if;
    select
      pg_catalog.count(*)::integer,
      pg_catalog.count(*) filter (
        where approver_member.role = 'owner'
      )::integer,
      coalesce(pg_catalog.bool_or(
        approver_member.user_id = v_actor_id
        and approver_member.role = v_actor_role
      ), false),
      coalesce(pg_catalog.bool_or(
        approver_member.user_id <> v_version.created_by
      ), false)
    into
      v_eligible_approver_count,
      v_eligible_owner_count,
      v_actor_is_eligible,
      v_another_eligible_approver_exists
    from public.organization_members as approver_member
    where approver_member.organization_id = p_organization_id
      and approver_member.status = 'active'
      and approver_member.role in ('owner', 'ops_manager');
    if not v_actor_is_eligible then
      raise exception 'custom_settlement_rule_approver_not_eligible';
    end if;

    v_old_total_cents := coalesce(
      nullif(
        v_simulation.historical_totals ->> 'oldPayableAmountCents',
        ''
      )::numeric,
      nullif(
        v_simulation.historical_totals ->> 'oldReceivableAmountCents',
        ''
      )::numeric
    );
    v_new_total_cents := coalesce(
      nullif(
        v_simulation.historical_totals ->> 'newPayableAmountCents',
        ''
      )::numeric,
      nullif(
        v_simulation.historical_totals ->> 'newReceivableAmountCents',
        ''
      )::numeric
    );
    v_margin_impact_cents := nullif(
      v_simulation.deltas ->> 'marginImpactCents',
      ''
    )::numeric;
    v_abnormal_total_increase_bps := coalesce(
      nullif(
        v_version.rule_contract #>>
          '{riskConfiguration,project,abnormalTotalIncreaseBps}',
        ''
      )::integer,
      nullif(
        v_version.rule_contract #>>
          '{riskConfiguration,organization,abnormalTotalIncreaseBps}',
        ''
      )::integer,
      2000
    );
    v_safety_cap_cents := coalesce(
      nullif(
        v_version.rule_contract #>>
          '{riskConfiguration,project,safetyCapCents}',
        ''
      )::numeric,
      nullif(
        v_version.rule_contract #>>
          '{riskConfiguration,organization,safetyCapCents}',
        ''
      )::numeric,
      100000
    );
    if v_old_total_cents is not null
       and v_new_total_cents is not null
       and v_new_total_cents > v_old_total_cents
       and (
         v_old_total_cents = 0
         or (
           (v_new_total_cents - v_old_total_cents) * 10000 >
             v_old_total_cents * v_abnormal_total_increase_bps
         )
       ) then
      v_material_risk_codes := v_material_risk_codes ||
        array['abnormal_total_increase'];
    end if;
    if exists (
      select 1
      from pg_catalog.jsonb_array_elements(
        v_simulation.scenarios
      ) as scenario(value)
      where nullif(scenario.value ->> 'amountCents', '')::numeric >
        v_safety_cap_cents
    ) then
      v_material_risk_codes := v_material_risk_codes ||
        array['safety_cap_exceeded'];
    end if;
    if exists (
      select 1
      from pg_catalog.jsonb_array_elements(
        v_simulation.warnings
      ) as warning(value)
      where warning.value ->> 'kind' = 'risk'
        and warning.value ->> 'code' in (
          'CUSTOM_RULE_NEGATIVE_MARGIN',
          'negative_margin'
        )
    ) then
      v_material_risk_codes := v_material_risk_codes ||
        array['negative_margin'];
    end if;
    if exists (
      select 1
      from pg_catalog.jsonb_array_elements(
        v_simulation.warnings
      ) as warning(value)
      where warning.value ->> 'kind' = 'risk'
        and warning.value ->> 'code' in (
          'CUSTOM_RULE_RED_EVIDENCE_PRICED',
          'red_evidence_payment'
        )
    ) then
      v_material_risk_codes := v_material_risk_codes ||
        array['red_evidence_payment'];
    end if;
    v_missing_data_impact_cents := coalesce(
      nullif(
        v_simulation.sample_selection #>>
          '{riskFacts,missingDataImpact,amountDeltaCents}',
        ''
      )::numeric,
      nullif(
        v_simulation.sample_selection #>>
          '{missingDataImpact,amountDeltaCents}',
        ''
      )::numeric,
      nullif(
        v_version.rule_contract #>>
          '{missingDataPolicy,defaultValue,amountCents}',
        ''
      )::numeric
    );
    if v_version.rule_contract -> 'missingDataPolicy' ->> 'action' =
         'use_explicit_default'
       and coalesce(v_missing_data_impact_cents, 0) <> 0 then
      v_material_risk_codes := v_material_risk_codes ||
        array['money_changing_explicit_default'];
    end if;
    if v_version.target_type = 'streamer_group'
       and v_version.composition_mode = 'replace' then
      v_material_risk_codes :=
        v_material_risk_codes || array['group_level_replace'];
    end if;
    if v_version.target_type = 'streamer_group'
       and v_version.rule_contract -> 'groupConflict' ->> 'resolution' =
         'explicit_exception'
       and pg_catalog.jsonb_typeof(
         v_version.rule_contract -> 'groupConflict' -> 'conflictingGroupIds'
       ) = 'array'
       and pg_catalog.jsonb_array_length(
         v_version.rule_contract -> 'groupConflict' -> 'conflictingGroupIds'
       ) > 0 then
      v_material_risk_codes := v_material_risk_codes ||
        array['overlapping_group_exception'];
    end if;
    select coalesce(array_agg(distinct code order by code), array[]::text[])
    into v_material_risk_codes
    from pg_catalog.unnest(v_material_risk_codes) as code;
    v_material_risk := pg_catalog.array_length(
      v_material_risk_codes,
      1
    ) is not null;
    if p_force then
      if v_actor_role <> 'owner'
         or p_acknowledgment is distinct from
           'I_UNDERSTAND_SINGLE_OWNER_FINANCIAL_RISK'
         or v_eligible_owner_count <> 1 then
        raise exception 'custom_settlement_rule_force_requires_single_owner';
      end if;
      if not v_material_risk and v_eligible_approver_count <> 1 then
        raise exception 'custom_settlement_rule_force_requires_single_owner';
      end if;
    else
      if p_acknowledgment is not null then
        raise exception 'custom_settlement_rule_approval_input_invalid';
      end if;
      if v_material_risk and v_actor_role <> 'owner' then
        raise exception 'custom_settlement_rule_material_risk_requires_owner';
      end if;
      if v_material_risk and v_actor_id = v_version.created_by then
        raise exception
          'custom_settlement_rule_material_risk_requires_distinct_owner';
      end if;
      if v_actor_id = v_version.created_by
         and v_another_eligible_approver_exists then
        raise exception
          'custom_settlement_rule_creator_requires_distinct_approver';
      end if;
    end if;
    v_approval_risk_summary := pg_catalog.jsonb_build_object(
      'material',
      v_material_risk,
      'codes',
      to_jsonb(v_material_risk_codes),
      'force',
      p_force,
      'acknowledgment',
      p_acknowledgment,
      'derivedFrom',
      'server_owned_review_custom_settlement_rule',
      'custom_rule_material_risk_server_owned_totals',
      pg_catalog.jsonb_build_object(
        'totalOldCents',
        v_old_total_cents,
        'totalNewCents',
        v_new_total_cents,
        'marginImpactCents',
        v_margin_impact_cents,
        'abnormalTotalIncreaseBps',
        v_abnormal_total_increase_bps
      ),
      'custom_rule_material_risk_server_owned_scenarios',
      pg_catalog.jsonb_build_object(
        'safetyCapCents',
        v_safety_cap_cents
      ),
      'custom_settlement_rule_client_risk_ignored',
      p_risk_summary <> '{}'::jsonb
    );
    if exists (
      select 1
      from public.custom_settlement_rule_versions as prior
      where prior.organization_id = p_organization_id
        and prior.project_id = p_project_id
        and prior.scope = v_version.scope
        and prior.target_type = v_version.target_type
        and prior.target_id is not distinct from v_version.target_id
        and prior.id <> p_rule_version_id
        and prior.status = 'active'
        and prior.effective_from >= p_effective_from
    ) then
      raise exception 'custom_settlement_rule_effective_period_conflict';
    end if;
    update public.custom_settlement_rule_versions as version
    set status = 'archived',
        effective_until = p_effective_from,
        archived_at = pg_catalog.now(),
        reason = p_reason
    where version.organization_id = p_organization_id
      and version.project_id = p_project_id
      and version.scope = v_version.scope
      and version.target_type = v_version.target_type
      and version.target_id is not distinct from v_version.target_id
      and version.id <> p_rule_version_id
      and version.status = 'active';
    update public.custom_settlement_rule_versions
    set status = 'active',
        effective_from = p_effective_from,
        approved_by = v_actor_id,
        approved_at = pg_catalog.now(),
        reason = p_reason
    where id = p_rule_version_id;
    v_event_type := case
      when p_force then 'force_approved'
      else 'approved'
    end;
    v_after_status := 'active';
  elsif p_action = 'activation_failed' then
    if v_actor_role not in ('owner', 'ops_manager')
       or v_version.status <> 'pending_review'
       or p_force
       or p_effective_from is not null
       or p_comment is null
       or pg_catalog.char_length(pg_catalog.btrim(p_comment)) = 0 then
      raise exception 'custom_settlement_rule_activation_failure_denied';
    end if;
    v_event_type := 'activation_failed';
    v_after_status := v_version.status;
  else
    raise exception 'custom_settlement_rule_review_action_invalid';
  end if;

  if v_event_type is not null then
    v_event_risk_summary := case
      when v_event_type in ('approved', 'force_approved') then
        v_approval_risk_summary
      else
        pg_catalog.jsonb_build_object(
          'force', p_force,
          'acknowledgment', p_acknowledgment
        ) || p_risk_summary
    end;
    insert into public.custom_settlement_rule_review_events (
      organization_id, project_id, rule_version_id, event_type, actor_id,
      actor_role, reason, comment, before_status, after_status, risk_summary,
      formula_hash, rule_contract_hash, parameter_hash,
      variable_catalog_version, data_selection_hash
    ) values (
      p_organization_id, p_project_id, p_rule_version_id, v_event_type,
      v_actor_id, v_actor_role, p_reason, p_comment, v_before_status,
      v_after_status,
      v_event_risk_summary,
      v_version.formula_hash, v_version.rule_contract_hash,
      v_version.parameter_hash, v_version.variable_catalog_version,
      v_version.data_selection_hash
    ) returning id into v_event_id;
  end if;
  v_result := public.custom_settlement_rule_lifecycle_result(
    p_rule_version_id,
    v_event_id
  );
  if v_result is null then
    raise exception 'custom_settlement_rule_atomic_result_missing';
  end if;
  insert into public.custom_settlement_rule_lifecycle_requests (
    actor_id, client_request_id, organization_id, project_id,
    rule_version_id, event_id, request_fingerprint, version_snapshot
  ) values (
    v_actor_id, p_client_request_id, p_organization_id, p_project_id,
    p_rule_version_id, v_event_id, v_request_fingerprint,
    v_result -> 'version'
  );
  return v_result;
end;
$$;

create or replace function public.archive_custom_settlement_rule(
  p_organization_id uuid,
  p_project_id uuid,
  p_rule_version_id uuid,
  p_effective_until timestamptz,
  p_reason text,
  p_fallback_proof jsonb,
  p_client_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor_id uuid := auth.uid();
  v_actor_role text;
  v_version public.custom_settlement_rule_versions%rowtype;
  v_simulation public.settlement_formula_simulations%rowtype;
  v_fallback_simulation public.settlement_formula_simulations%rowtype;
  v_event_id uuid;
  v_request_key text;
  v_request_fingerprint text;
  v_request_record public.custom_settlement_rule_lifecycle_requests%rowtype;
  v_result jsonb;
begin
  if auth.uid() is null or v_actor_id is null then
    raise exception 'authentication_required';
  end if;
  v_actor_role := public.current_user_role(p_organization_id);
  if not public.is_org_member(p_organization_id)
     or not public.can_access_project(p_project_id)
     or v_actor_role is null
     or v_actor_role not in (
       'owner',
       'ops_manager'
     ) then
    raise exception 'custom_settlement_rule_archive_access_denied';
  end if;

  if p_effective_until is null
     or p_reason is null
     or p_reason <> pg_catalog.btrim(p_reason)
     or pg_catalog.char_length(p_reason) not between 1 and 4000
     or p_client_request_id is null
     or p_client_request_id <> pg_catalog.btrim(p_client_request_id)
     or pg_catalog.char_length(p_client_request_id) not between 1 and 120
     or pg_catalog.jsonb_typeof(p_fallback_proof) <> 'object'
     or not public.settlement_ai_json_within_budget(p_fallback_proof)
     or not public.settlement_ai_json_is_safe(p_fallback_proof) then
    raise exception 'custom_settlement_rule_archive_end_required';
  end if;

  v_request_key := v_actor_id::text || ':' || p_client_request_id;
  v_request_fingerprint := public.custom_settlement_rule_request_fingerprint(
    'archive_custom_settlement_rule',
    pg_catalog.jsonb_build_object(
      'organizationId', p_organization_id,
      'projectId', p_project_id,
      'ruleVersionId', p_rule_version_id,
      'effectiveUntil', p_effective_until,
      'reason', p_reason,
      'fallbackProof', p_fallback_proof
    )
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_organization_id::text || ':' || v_request_key,
      0
    )
  );
  select request.*
  into v_request_record
  from public.custom_settlement_rule_lifecycle_requests as request
  where request.actor_id = v_actor_id
    and request.client_request_id = p_client_request_id;
  if found then
    if v_request_record.request_fingerprint <> v_request_fingerprint then
      raise exception 'custom_settlement_rule_idempotency_conflict';
    end if;
    v_result := public.custom_settlement_rule_lifecycle_result(
      v_request_record.rule_version_id,
      v_request_record.event_id
    );
    return pg_catalog.jsonb_set(
      v_result,
      '{version}',
      v_request_record.version_snapshot,
      true
    );
  end if;

  perform public.settlement_ai_lock_authoring_parents(
    p_organization_id,
    v_actor_id,
    p_project_id
  );
  select version.*
  into v_version
  from public.custom_settlement_rule_versions as version
  where version.id = p_rule_version_id
    and version.organization_id = p_organization_id
    and version.project_id = p_project_id;
  if not found then
    raise exception 'custom_settlement_rule_version_scope_mismatch';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_organization_id::text || ':' || p_project_id::text || ':' ||
      v_version.scope || ':' || v_version.target_type || ':' ||
      coalesce(v_version.target_id::text, ''),
      0
    )
  );
  perform 1
  from public.custom_settlement_rule_versions as version
  where version.organization_id = p_organization_id
    and version.project_id = p_project_id
    and version.scope = v_version.scope
    and version.target_type = v_version.target_type
    and version.target_id is not distinct from v_version.target_id
  order by version.version_number, version.id
  for update;
  select version.*
  into v_version
  from public.custom_settlement_rule_versions as version
  where version.id = p_rule_version_id
  for update;
  if v_version.status not in ('active', 'draft', 'changes_requested') then
    raise exception 'custom_settlement_rule_archive_status_invalid';
  end if;
  if v_version.status = 'active' then
    select simulation.*
    into v_simulation
    from public.settlement_formula_simulations as simulation
    where simulation.id = v_version.simulation_id
      and simulation.rule_version_id = v_version.id
      and simulation.organization_id = p_organization_id
      and simulation.project_id = p_project_id
    for update;
    if not found
       or v_simulation.formula_hash <> v_version.formula_hash
       or v_simulation.rule_contract_hash <> v_version.rule_contract_hash
       or v_simulation.parameter_hash <> v_version.parameter_hash
       or v_simulation.variable_catalog_version <>
         v_version.variable_catalog_version
       or v_simulation.data_selection_hash <> v_version.data_selection_hash
       or pg_catalog.jsonb_typeof(
         p_fallback_proof -> 'proofKind'
       ) <> 'string'
       or p_fallback_proof ->> 'proofKind' not in (
         'remaining_custom_layers',
         'fixed_fallback'
       )
       or pg_catalog.jsonb_typeof(
         p_fallback_proof -> 'remainingCustomLayerCount'
       ) <> 'number'
       or (p_fallback_proof ->> 'remainingCustomLayerCount')::integer < 0
       or pg_catalog.jsonb_typeof(
         p_fallback_proof -> 'fixedFallbackAvailable'
       ) <> 'boolean'
       or pg_catalog.jsonb_typeof(
         p_fallback_proof -> 'lockedBatchCount'
       ) <> 'number'
       or (p_fallback_proof ->> 'lockedBatchCount')::integer < 0
       or pg_catalog.jsonb_typeof(
         p_fallback_proof -> 'lockedBatchExclusion'
       ) <> 'object'
       or p_fallback_proof -> 'lockedBatchExclusion' ->> 'excluded' <> 'true'
       or (
         p_fallback_proof -> 'lockedBatchExclusion' ->>
           'lockedBatchCount'
       )::integer <> (p_fallback_proof ->> 'lockedBatchCount')::integer
       or (
         (p_fallback_proof ->> 'remainingCustomLayerCount')::integer = 0
         and not (p_fallback_proof ->> 'fixedFallbackAvailable')::boolean
       ) then
      raise exception 'custom_settlement_rule_archive_fallback_invalid';
    end if;
    select simulation.*
    into v_fallback_simulation
    from public.settlement_formula_simulations as simulation
    where simulation.id = (p_fallback_proof ->> 'simulationId')::uuid
      and simulation.organization_id = p_organization_id
      and simulation.project_id = p_project_id
    for update;
    if not found
       or v_fallback_simulation.id = v_version.simulation_id
       or v_fallback_simulation.rule_version_id is null
       or v_fallback_simulation.rule_version_id = v_version.id
       or v_fallback_simulation.coverage ->> 'summarySchemaVersion' <> '2'
       or (v_fallback_simulation.coverage ->> 'blockedRecords')::integer <> 0
       or (v_fallback_simulation.coverage ->> 'uncoveredRecords')::integer <> 0
       or exists (
         select 1
         from pg_catalog.jsonb_array_elements(
           v_fallback_simulation.warnings
         ) as warning(value)
         where warning.value ->> 'severity' = 'block'
       )
       or v_fallback_simulation.sample_selection
            -> 'archiveProof' ->> 'archivedRuleVersionId' <>
          v_version.id::text
       or v_fallback_simulation.sample_selection
            -> 'archiveProof' ->> 'proofKind' <>
          p_fallback_proof ->> 'proofKind'
       or v_fallback_simulation.sample_selection
            -> 'archiveProof' ->> 'excludesLockedBatches' <> 'true'
       or (
         v_fallback_simulation.sample_selection
           -> 'archiveProof' ->> 'lockedBatchCount'
       )::integer <> (p_fallback_proof ->> 'lockedBatchCount')::integer
       or (
         v_fallback_simulation.sample_selection
           -> 'archiveProof' ->> 'remainingCustomLayerCount'
       )::integer <> (
         p_fallback_proof ->> 'remainingCustomLayerCount'
       )::integer
       or (
         v_fallback_simulation.sample_selection
           -> 'archiveProof' ->> 'fixedFallbackAvailable'
       )::boolean <> (
         p_fallback_proof ->> 'fixedFallbackAvailable'
       )::boolean then
      raise exception
        'custom_settlement_rule_archive_fallback_simulation_required';
    end if;
    if p_effective_until <= v_version.effective_from then
      raise exception 'custom_settlement_rule_archive_period_invalid';
    end if;
  end if;

  update public.custom_settlement_rule_versions
  set status = 'archived',
      effective_until = p_effective_until,
      archived_at = pg_catalog.now(),
      reason = p_reason
  where id = p_rule_version_id;
  insert into public.custom_settlement_rule_review_events (
    organization_id, project_id, rule_version_id, event_type, actor_id,
    actor_role, reason, before_status, after_status, risk_summary,
    formula_hash, rule_contract_hash, parameter_hash,
    variable_catalog_version, data_selection_hash
  ) values (
    p_organization_id, p_project_id, p_rule_version_id, 'archived',
    v_actor_id, v_actor_role, p_reason, v_version.status, 'archived',
    pg_catalog.jsonb_build_object('fallbackProof', p_fallback_proof),
    v_version.formula_hash, v_version.rule_contract_hash,
    v_version.parameter_hash, v_version.variable_catalog_version,
    v_version.data_selection_hash
  ) returning id into v_event_id;
  v_result := public.custom_settlement_rule_lifecycle_result(
    p_rule_version_id,
    v_event_id
  );
  if v_result is null then
    raise exception 'custom_settlement_rule_atomic_result_missing';
  end if;
  insert into public.custom_settlement_rule_lifecycle_requests (
    actor_id, client_request_id, organization_id, project_id,
    rule_version_id, event_id, request_fingerprint, version_snapshot
  ) values (
    v_actor_id, p_client_request_id, p_organization_id, p_project_id,
    p_rule_version_id, v_event_id, v_request_fingerprint,
    v_result -> 'version'
  );
  return v_result;
end;
$$;

create or replace function public.archive_settlement_rule_group(
  p_organization_id uuid,
  p_project_id uuid,
  p_group_id uuid,
  p_archived_at timestamptz,
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
  v_actor_role text;
  v_group public.settlement_rule_groups%rowtype;
  v_active_rule_count integer;
  v_pending_rule_count integer;
  v_future_assignment_count integer;
begin
  if auth.uid() is null or v_actor_id is null then
    raise exception 'authentication_required';
  end if;
  v_actor_role := public.current_user_role(p_organization_id);
  if not public.is_org_member(p_organization_id)
     or not public.can_access_project(p_project_id)
     or v_actor_role is null
     or v_actor_role not in (
       'owner',
       'ops_manager'
     ) then
    raise exception 'settlement_rule_group_archive_access_denied';
  end if;
  if p_archived_at is null
     or p_reason is null
     or p_reason <> pg_catalog.btrim(p_reason)
     or pg_catalog.char_length(p_reason) not between 1 and 4000
     or p_client_request_id is null
     or p_client_request_id <> pg_catalog.btrim(p_client_request_id)
     or pg_catalog.char_length(p_client_request_id) not between 1 and 120 then
    raise exception 'settlement_rule_group_archive_input_invalid';
  end if;

  perform public.settlement_ai_lock_authoring_parents(
    p_organization_id,
    v_actor_id,
    p_project_id
  );
  select rule_group.*
  into v_group
  from public.settlement_rule_groups as rule_group
  where rule_group.id = p_group_id
    and rule_group.organization_id = p_organization_id
    and rule_group.project_id = p_project_id
  for update;
  if not found then
    raise exception 'settlement_rule_group_scope_mismatch';
  end if;
  if v_group.status <> 'active' then
    raise exception 'settlement_rule_group_archive_status_invalid';
  end if;

  perform 1
  from public.custom_settlement_rule_versions as version
  where version.organization_id = p_organization_id
    and version.project_id = p_project_id
    and version.target_type = 'streamer_group'
    and version.target_id = p_group_id
    and version.status = 'active'
  for update;
  select pg_catalog.count(*)::integer
  into v_active_rule_count
  from public.custom_settlement_rule_versions as version
  where version.organization_id = p_organization_id
    and version.project_id = p_project_id
    and version.target_type = 'streamer_group'
    and version.target_id = p_group_id
    and version.status = 'active';
  perform 1
  from public.custom_settlement_rule_versions as version
  where version.organization_id = p_organization_id
    and version.project_id = p_project_id
    and version.target_type = 'streamer_group'
    and version.target_id = p_group_id
    and version.status = 'pending_review'
  for update;
  select pg_catalog.count(*)::integer
  into v_pending_rule_count
  from public.custom_settlement_rule_versions as version
  where version.organization_id = p_organization_id
    and version.project_id = p_project_id
    and version.target_type = 'streamer_group'
    and version.target_id = p_group_id
    and version.status = 'pending_review';
  perform 1
  from public.project_streamer_settlement_group_assignments as assignment
  where assignment.organization_id = p_organization_id
    and assignment.project_id = p_project_id
    and assignment.group_id = p_group_id
    and (
      assignment.effective_from >= p_archived_at
      or assignment.effective_until is null
      or assignment.effective_until > p_archived_at
    )
  for update;
  select pg_catalog.count(*)::integer
  into v_future_assignment_count
  from public.project_streamer_settlement_group_assignments as assignment
  where assignment.organization_id = p_organization_id
    and assignment.project_id = p_project_id
    and assignment.group_id = p_group_id
    and (
      assignment.effective_from >= p_archived_at
      or assignment.effective_until is null
      or assignment.effective_until > p_archived_at
    );
  if v_active_rule_count > 0
     or v_pending_rule_count > 0
     or v_future_assignment_count > 0 then
    raise exception 'settlement_rule_group_archive_blocked';
  end if;

  update public.settlement_rule_groups
  set status = 'archived',
      archived_at = p_archived_at
  where id = p_group_id
  returning * into v_group;

  return pg_catalog.to_jsonb(v_group) || pg_catalog.jsonb_build_object(
    'assignment_count', 0,
    'active_rule_count', v_active_rule_count,
    'pending_rule_count', v_pending_rule_count,
    'future_assignment_count', v_future_assignment_count
  );
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
  v_actor_role text;
  v_inserted public.project_streamer_settlement_group_assignments%rowtype;
  v_closed_ids uuid[];
  v_snapshot_hash text;
begin
  if auth.uid() is null or v_actor_id is null then
    raise exception 'authentication_required';
  end if;
  v_actor_role := public.current_user_role(p_organization_id);
  if not public.is_org_member(p_organization_id)
     or not public.can_access_project(p_project_id)
     or v_actor_role is null
     or v_actor_role not in (
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
     or pg_catalog.char_length(p_reason) not between 1 and 4000
     or p_client_request_id is null
     or p_client_request_id <> pg_catalog.btrim(p_client_request_id)
     or pg_catalog.char_length(p_client_request_id) not between 1 and 120 then
    raise exception 'settlement_group_assignment_input_invalid';
  end if;
  if exists (
    select 1
    from public.settlement_batches as batch
    where batch.organization_id = p_organization_id
      and batch.project_id = p_project_id
      and batch.status = 'locked'
      and batch.period_end >= p_effective_from::date
  ) then
    raise exception 'settlement_group_assignment_locked_history_rewrite';
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
  order by assignment.effective_from, assignment.id
  for update;
  if exists (
    select 1
    from public.project_streamer_settlement_group_assignments as assignment
    where assignment.organization_id = p_organization_id
      and assignment.project_id = p_project_id
      and assignment.project_streamer_id = p_project_streamer_id
      and assignment.group_id = p_group_id
      and tstzrange(
        assignment.effective_from,
        assignment.effective_until,
        '[)'
      ) && tstzrange(p_effective_from, p_effective_until, '[)')
  ) then
    raise exception 'settlement_group_assignment_overlap';
  end if;

  with closed as (
    update public.project_streamer_settlement_group_assignments
    set effective_until = p_effective_from
    where organization_id = p_organization_id
      and project_id = p_project_id
      and project_streamer_id = p_project_streamer_id
      and effective_from < p_effective_from
      and (effective_until is null or effective_until > p_effective_from)
      and group_id <> p_group_id
    returning id
  )
  select coalesce(pg_catalog.array_agg(id order by id), array[]::uuid[])
  into v_closed_ids
  from closed;

  insert into public.project_streamer_settlement_group_assignments (
    organization_id, project_id, project_streamer_id, group_id,
    effective_from, effective_until, assigned_by, reason
  ) values (
    p_organization_id, p_project_id, p_project_streamer_id, p_group_id,
    p_effective_from, p_effective_until, v_actor_id, p_reason
  ) returning * into v_inserted;

  select public.custom_settlement_rule_request_fingerprint(
    'settlement_group_membership_snapshot',
    pg_catalog.jsonb_build_object(
      'projectStreamerId', p_project_streamer_id,
      'effectiveAt', p_effective_from,
      'groups', coalesce(
        (
          select pg_catalog.jsonb_agg(
            pg_catalog.jsonb_build_object(
              'id', rule_group.id,
              'name', rule_group.name,
              'assignmentId', assignment.id
            )
            order by rule_group.id, assignment.id
          )
          from public.project_streamer_settlement_group_assignments
            as assignment
          join public.settlement_rule_groups as rule_group
            on rule_group.id = assignment.group_id
           and rule_group.organization_id = assignment.organization_id
           and rule_group.project_id = assignment.project_id
          where assignment.organization_id = p_organization_id
            and assignment.project_id = p_project_id
            and assignment.project_streamer_id = p_project_streamer_id
            and assignment.effective_from <= p_effective_from
            and (
              assignment.effective_until is null
              or p_effective_from < assignment.effective_until
            )
        ),
        '[]'::jsonb
      )
    )
  ) into v_snapshot_hash;

  return pg_catalog.jsonb_build_object(
    'insertedAssignment', pg_catalog.to_jsonb(v_inserted),
    'inserted_assignment', pg_catalog.to_jsonb(v_inserted),
    'closedAssignmentIds', coalesce(v_closed_ids, array[]::uuid[]),
    'closed_assignment_ids', coalesce(v_closed_ids, array[]::uuid[]),
    'newGroupSnapshotHash', v_snapshot_hash,
    'new_group_snapshot_hash', v_snapshot_hash
  );
end;
$$;

revoke all on table public.custom_settlement_rule_versions
  from public, anon, authenticated, service_role;
revoke all on table public.custom_settlement_rule_review_events
  from public, anon, authenticated, service_role;
revoke all on table public.custom_settlement_rule_lifecycle_requests
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
revoke all on function public.prevent_custom_settlement_lifecycle_request_mutation()
  from public, anon, authenticated, service_role;
revoke all on function public.prevent_custom_settlement_governance_delete()
  from public, anon, authenticated, service_role;
revoke all on function public.custom_settlement_rule_request_fingerprint(
  text,
  jsonb
) from public, anon, authenticated, service_role;
revoke all on function public.custom_settlement_rule_lifecycle_result(
  uuid,
  uuid
) from public, anon, authenticated, service_role;

revoke all on function public.create_settlement_rule_group(
  uuid,
  uuid,
  text,
  text,
  text,
  text
) from public, anon, authenticated, service_role;
grant execute on function public.create_settlement_rule_group(
  uuid,
  uuid,
  text,
  text,
  text,
  text
) to authenticated;

revoke all on function public.save_custom_settlement_rule_draft(
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  text,
  uuid,
  jsonb,
  text,
  text
) from public, anon, authenticated, service_role;
grant execute on function public.save_custom_settlement_rule_draft(
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  text,
  uuid,
  jsonb,
  text,
  text
) to authenticated;

revoke all on function public.apply_and_submit_custom_settlement_rule(
  uuid,
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
  uuid,
  text,
  text,
  uuid,
  timestamptz,
  text,
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
  jsonb,
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
  jsonb,
  text
) to authenticated;

revoke all on function public.archive_custom_settlement_rule(
  uuid,
  uuid,
  uuid,
  timestamptz,
  text,
  jsonb,
  text
) from public, anon, authenticated, service_role;
grant execute on function public.archive_custom_settlement_rule(
  uuid,
  uuid,
  uuid,
  timestamptz,
  text,
  jsonb,
  text
) to authenticated;

revoke all on function public.archive_settlement_rule_group(
  uuid,
  uuid,
  uuid,
  timestamptz,
  text,
  text
) from public, anon, authenticated, service_role;
grant execute on function public.archive_settlement_rule_group(
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
