set search_path = pg_catalog, public;

create or replace function public.resolve_executable_custom_settlement_rule_layers(
  p_organization_id uuid,
  p_project_id uuid,
  p_scope text,
  p_execution_timestamp timestamptz,
  p_project_streamer_ids uuid[],
  p_group_ids uuid[],
  p_units jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor_id uuid := auth.uid();
  v_actor_role text;
  v_versions jsonb := '[]'::jsonb;
  v_assignments jsonb := '[]'::jsonb;
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
    raise exception 'custom_settlement_rule_execution_lookup_access_denied';
  end if;

  if p_scope is null
     or p_scope not in (
       'receivable',
       'payable',
       'external_cost',
       'reconciliation'
     )
     or p_execution_timestamp is null
     or p_units is null
     or pg_catalog.jsonb_typeof(p_units) <> 'array'
     or pg_catalog.jsonb_array_length(p_units) > 500 then
    raise exception 'custom_settlement_rule_execution_lookup_input_invalid';
  end if;

  with candidate_versions as (
    select version.*
    from public.custom_settlement_rule_versions as version
    where version.organization_id = p_organization_id
      and version.project_id = p_project_id
      and version.scope = p_scope
      and version.approved_by is not null
      and version.approved_at is not null
      and version.status in ('active', 'archived')
      and version.effective_from is not null
      and version.effective_from <= p_execution_timestamp
      and (
        version.effective_until is null
        or p_execution_timestamp < version.effective_until
      )
      and (
        (version.target_type = 'project' and version.target_id is null)
        or (
          version.target_type = 'streamer_group'
          and version.target_id = any(coalesce(p_group_ids, array[]::uuid[]))
        )
        or (
          version.target_type = 'project_streamer'
          and version.target_id = any(
            coalesce(p_project_streamer_ids, array[]::uuid[])
          )
        )
      )
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', version.id,
        'organization_id', version.organization_id,
        'project_id', version.project_id,
        'scope', version.scope,
        'target_type', version.target_type,
        'target_id', version.target_id,
        'execution_grain', version.execution_grain,
        'composition_mode', version.composition_mode,
        'priority', version.priority,
        'version_number', version.version_number,
        'status', version.status,
        'formula', version.formula,
        'compiled_ast', version.compiled_ast,
        'variables', version.variables,
        'parameters', version.parameters,
        'rule_contract', version.rule_contract,
        'system_explanation_template', version.system_explanation_template,
        'missing_data_policy', version.missing_data_policy,
        'test_cases', version.test_cases,
        'simulation_summary', version.simulation_summary,
        'formula_hash', version.formula_hash,
        'rule_contract_hash', version.rule_contract_hash,
        'parameter_hash', version.parameter_hash,
        'variable_catalog_version', version.variable_catalog_version,
        'data_selection_hash', version.data_selection_hash,
        'simulation_id', version.simulation_id,
        'effective_from', version.effective_from,
        'effective_until', version.effective_until,
        'created_by', version.created_by,
        'approved_by', version.approved_by,
        'ai_draft_id', version.ai_draft_id,
        'reason', version.reason,
        'created_at', version.created_at,
        'approved_at', version.approved_at,
        'archived_at', version.archived_at
      )
      order by
        version.target_type,
        version.priority,
        version.effective_from desc,
        version.version_number desc,
        version.id
    ),
    '[]'::jsonb
  )
  into v_versions
  from candidate_versions as version;

  with unit_input as (
    select
      unit_value ->> 'unitKey' as unit_key,
      nullif(unit_value ->> 'projectStreamerId', '')::uuid
        as project_streamer_id,
      nullif(unit_value ->> 'effectiveAt', '')::timestamptz
        as effective_at,
      coalesce(
        array(
          select value::uuid
          from jsonb_array_elements_text(
            coalesce(unit_value -> 'groupIds', '[]'::jsonb)
          ) as value
        ),
        array[]::uuid[]
      ) as group_ids,
      coalesce(
        array(
          select value::uuid
          from jsonb_array_elements_text(
            coalesce(unit_value -> 'assignmentIds', '[]'::jsonb)
          ) as value
        ),
        array[]::uuid[]
      ) as assignment_ids
    from jsonb_array_elements(p_units) as unit_value
  ), candidate_assignments as (
    select
      unit_input.unit_key,
      assignment.project_streamer_id,
      assignment.group_id,
      assignment.id as assignment_id,
      assignment.effective_from,
      assignment.effective_until
    from unit_input
    join public.project_streamer_settlement_group_assignments as assignment
      on assignment.organization_id = p_organization_id
     and assignment.project_id = p_project_id
     and assignment.project_streamer_id = unit_input.project_streamer_id
     and assignment.group_id = any(unit_input.group_ids)
     and assignment.id = any(unit_input.assignment_ids)
     and assignment.effective_from <= unit_input.effective_at
     and (
       assignment.effective_until is null
       or unit_input.effective_at < assignment.effective_until
     )
    where unit_input.unit_key is not null
      and unit_input.project_streamer_id is not null
      and unit_input.effective_at is not null
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'unit_key', assignment.unit_key,
        'project_streamer_id', assignment.project_streamer_id,
        'group_id', assignment.group_id,
        'assignment_id', assignment.assignment_id,
        'effective_from', assignment.effective_from,
        'effective_until', assignment.effective_until
      )
      order by
        assignment.unit_key,
        assignment.group_id,
        assignment.assignment_id
    ),
    '[]'::jsonb
  )
  into v_assignments
  from candidate_assignments as assignment;

  return jsonb_build_object(
    'versions', v_versions,
    'assignments', v_assignments
  );
end;
$$;

revoke all on function public.resolve_executable_custom_settlement_rule_layers(
  uuid,
  uuid,
  text,
  timestamptz,
  uuid[],
  uuid[],
  jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.resolve_executable_custom_settlement_rule_layers(
  uuid,
  uuid,
  text,
  timestamptz,
  uuid[],
  uuid[],
  jsonb
) to authenticated;

reset search_path;
