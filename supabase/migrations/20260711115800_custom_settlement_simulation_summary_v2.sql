-- Version settlement simulation summaries without rewriting legacy rows.

alter function public.settlement_ai_simulation_summary_is_valid(
  uuid,
  jsonb,
  jsonb,
  jsonb,
  jsonb,
  jsonb,
  jsonb,
  jsonb,
  jsonb
) rename to settlement_ai_simulation_summary_v1_is_valid;

-- V2 stores safe scenario amounts, so amountCents is no longer globally
-- forbidden. Exact v1/v2 validators below remain authoritative for shape.
create or replace function public.settlement_ai_simulation_json_is_safe(
  p_value jsonb
)
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
  select public.settlement_ai_json_is_safe(p_value) and not exists (
    select 1
    from normalized_keys
    where key in (
      'conversationid',
      'internalmargin',
      'organizationid',
      'projectid',
      'reportid',
      'streamerid',
      'tax'
    )
  );
$$;

create or replace function public.settlement_ai_nonnegative_decimal_is_bigint(
  p_value jsonb,
  p_allow_null boolean
)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog, public
as $$
begin
  if not public.settlement_ai_decimal_is_bigint(p_value, p_allow_null) then
    return false;
  end if;
  if pg_catalog.jsonb_typeof(p_value) = 'null' then
    return p_allow_null;
  end if;
  return (p_value #>> '{}')::numeric >= 0;
exception
  when others then
    return false;
end;
$$;

create or replace function public.settlement_ai_simulation_summary_v2_is_valid(
  p_project_id uuid,
  p_sample_source jsonb,
  p_sample_selection jsonb,
  p_coverage jsonb,
  p_scenarios jsonb,
  p_historical_totals jsonb,
  p_deltas jsonb,
  p_largest_changes jsonb,
  p_warnings jsonb
)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog, public
as $$
declare
  v_item jsonb;
  v_normalized text;
  v_payable_active boolean;
  v_old numeric;
  v_new numeric;
  v_delta numeric;
  v_margin numeric;
  v_percentage numeric;
begin
  if p_project_id is null
     or not public.settlement_ai_json_within_budget(
       pg_catalog.jsonb_build_array(
         p_sample_source,
         p_sample_selection,
         p_coverage,
         p_scenarios,
         p_historical_totals,
         p_deltas,
         p_largest_changes,
         p_warnings
       )
     )
     or not public.settlement_ai_json_within_budget(p_sample_source)
     or not public.settlement_ai_json_within_budget(p_sample_selection)
     or not public.settlement_ai_json_within_budget(p_coverage)
     or not public.settlement_ai_json_within_budget(p_scenarios)
     or not public.settlement_ai_json_within_budget(p_historical_totals)
     or not public.settlement_ai_json_within_budget(p_deltas)
     or not public.settlement_ai_json_within_budget(p_largest_changes)
     or not public.settlement_ai_json_within_budget(p_warnings)
     or not public.settlement_ai_simulation_json_is_safe(
       pg_catalog.jsonb_build_array(
         p_sample_source,
         p_sample_selection,
         p_coverage,
         p_scenarios,
         p_historical_totals,
         p_deltas,
         p_largest_changes,
         p_warnings
       )
     ) then
    return false;
  end if;

  if not public.settlement_ai_json_has_exact_keys(
       p_sample_source,
       array['kind']::text[]
     )
     or p_sample_source ->> 'kind' not in (
       'historical_settlements',
       'approved_operations',
       'synthetic_scenarios'
     ) then
    return false;
  end if;

  if not (
       public.settlement_ai_json_has_exact_keys(
         p_sample_selection,
         array[
           'periodStart',
           'periodEnd',
           'populationCount',
           'sampledCount',
           'criteria'
         ]::text[]
       )
       or public.settlement_ai_json_has_exact_keys(
         p_sample_selection,
         array[
           'periodStart',
           'periodEnd',
           'populationCount',
           'sampledCount',
           'criteria',
           'archiveProof'
         ]::text[]
       )
     )
     or not public.settlement_ai_business_date_is_valid(
       p_sample_selection ->> 'periodStart'
     )
     or not public.settlement_ai_business_date_is_valid(
       p_sample_selection ->> 'periodEnd'
     )
     or p_sample_selection ->> 'periodStart'
       > p_sample_selection ->> 'periodEnd'
     or not public.settlement_ai_safe_integer_json(
       p_sample_selection -> 'populationCount',
       true
     )
     or not public.settlement_ai_safe_integer_json(
       p_sample_selection -> 'sampledCount',
       true
     )
     or (p_sample_selection ->> 'sampledCount')::numeric
       > (p_sample_selection ->> 'populationCount')::numeric
     or pg_catalog.jsonb_typeof(p_sample_selection -> 'criteria') <> 'array'
     or pg_catalog.jsonb_array_length(p_sample_selection -> 'criteria') > 100 then
    return false;
  end if;
  for v_item in
    select criteria.value
    from pg_catalog.jsonb_array_elements(
      p_sample_selection -> 'criteria'
    ) as criteria(value)
  loop
    if pg_catalog.jsonb_typeof(v_item) <> 'string'
       or pg_catalog.char_length(v_item #>> '{}') not between 1 and 200
       or v_item #>> '{}' <> pg_catalog.btrim(v_item #>> '{}')
       or v_item #>> '{}' ~* '(report|project|streamer)[_-]?id|amount[_-]?cents|internal[_-]?margin|tax|payload|rows' then
      return false;
    end if;
  end loop;
  if p_sample_selection ? 'archiveProof'
     and (
       not public.settlement_ai_json_has_exact_keys(
         p_sample_selection -> 'archiveProof',
         array[
           'archivedRuleVersionId',
           'proofKind',
           'excludesLockedBatches',
           'lockedBatchCount',
           'remainingCustomLayerCount',
           'fixedFallbackAvailable'
         ]::text[]
       )
       or (p_sample_selection -> 'archiveProof' ->> 'archivedRuleVersionId')
         !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or p_sample_selection -> 'archiveProof' ->> 'proofKind' not in (
         'remaining_custom_layers',
         'fixed_fallback'
       )
       or pg_catalog.jsonb_typeof(
         p_sample_selection -> 'archiveProof' -> 'excludesLockedBatches'
       ) <> 'boolean'
       or not public.settlement_ai_safe_integer_json(
         p_sample_selection -> 'archiveProof' -> 'lockedBatchCount',
         true
       )
       or not public.settlement_ai_safe_integer_json(
         p_sample_selection -> 'archiveProof' -> 'remainingCustomLayerCount',
         true
       )
       or pg_catalog.jsonb_typeof(
         p_sample_selection -> 'archiveProof' -> 'fixedFallbackAvailable'
       ) <> 'boolean'
     ) then
    return false;
  end if;

  if not public.settlement_ai_json_has_exact_keys(
       p_coverage,
       array[
         'summarySchemaVersion',
         'totalRecords',
         'evaluatedRecords',
         'skippedRecords',
         'uncoveredRecords',
         'zeroAmountRecords',
         'reviewRoutedRecords',
         'blockedRecords'
       ]::text[]
     )
     or not public.settlement_ai_safe_integer_json(
       p_coverage -> 'summarySchemaVersion',
       true
     )
     or (p_coverage ->> 'summarySchemaVersion')::numeric <> 2
     or not public.settlement_ai_safe_integer_json(
       p_coverage -> 'totalRecords',
       true
     )
     or not public.settlement_ai_safe_integer_json(
       p_coverage -> 'evaluatedRecords',
       true
     )
     or not public.settlement_ai_safe_integer_json(
       p_coverage -> 'skippedRecords',
       true
     )
     or not public.settlement_ai_safe_integer_json(
       p_coverage -> 'uncoveredRecords',
       true
     )
     or not public.settlement_ai_safe_integer_json(
       p_coverage -> 'zeroAmountRecords',
       true
     )
     or not public.settlement_ai_safe_integer_json(
       p_coverage -> 'reviewRoutedRecords',
       true
     )
     or not public.settlement_ai_safe_integer_json(
       p_coverage -> 'blockedRecords',
       true
     )
     or (p_coverage ->> 'evaluatedRecords')::numeric
       + (p_coverage ->> 'skippedRecords')::numeric
       <> (p_coverage ->> 'totalRecords')::numeric
     or (p_coverage ->> 'uncoveredRecords')::numeric
       > (p_coverage ->> 'totalRecords')::numeric
     or (p_coverage ->> 'zeroAmountRecords')::numeric
       > (p_coverage ->> 'evaluatedRecords')::numeric
     or (p_coverage ->> 'reviewRoutedRecords')::numeric
       + (p_coverage ->> 'blockedRecords')::numeric
       <> (p_coverage ->> 'skippedRecords')::numeric
     or (p_sample_selection ->> 'sampledCount')::numeric
       <> (p_coverage ->> 'totalRecords')::numeric then
    return false;
  end if;

  if pg_catalog.jsonb_typeof(p_scenarios) <> 'array'
     or pg_catalog.jsonb_array_length(p_scenarios) not between 1 and 200 then
    return false;
  end if;
  for v_item in
    select scenario.value
    from pg_catalog.jsonb_array_elements(p_scenarios) as scenario(value)
  loop
    if not public.settlement_ai_json_has_exact_keys(
         v_item,
         array[
           'id',
           'category',
           'outcome',
           'amountCents',
           'expectedAmountCents',
           'passed'
         ]::text[]
       )
       or pg_catalog.jsonb_typeof(v_item -> 'id') <> 'string'
       or pg_catalog.char_length(v_item ->> 'id') not between 1 and 120
       or v_item ->> 'id' <> pg_catalog.btrim(v_item ->> 'id')
       or v_item ->> 'category' not in (
         'zero',
         'threshold_edge',
         'configured_maximum',
         'evidence_level',
         'missing_data_policy',
         'contract_example',
         'ai_test_case',
         'user_example'
       )
       or v_item ->> 'outcome' not in (
         'calculated',
         'review_routed',
         'blocked'
       )
       or not public.settlement_ai_nonnegative_decimal_is_bigint(
         v_item -> 'amountCents',
         true
       )
       or not public.settlement_ai_nonnegative_decimal_is_bigint(
         v_item -> 'expectedAmountCents',
         true
       )
       or pg_catalog.jsonb_typeof(v_item -> 'passed') <> 'boolean'
       or (
         (v_item ->> 'outcome' = 'calculated')
         <> (pg_catalog.jsonb_typeof(v_item -> 'amountCents') = 'string')
       ) then
      return false;
    end if;
  end loop;
  if exists (
    select scenario.value ->> 'id'
    from pg_catalog.jsonb_array_elements(p_scenarios) as scenario(value)
    group by scenario.value ->> 'id'
    having pg_catalog.count(*) > 1
  ) then
    return false;
  end if;

  if not public.settlement_ai_json_has_exact_keys(
       p_historical_totals,
       array[
         'oldPayableAmountCents',
         'oldReceivableAmountCents',
         'newPayableAmountCents',
         'newReceivableAmountCents',
         'recordCount',
         'verificationStatus'
       ]::text[]
     )
     or not public.settlement_ai_nonnegative_decimal_is_bigint(
       p_historical_totals -> 'oldPayableAmountCents',
       true
     )
     or not public.settlement_ai_nonnegative_decimal_is_bigint(
       p_historical_totals -> 'oldReceivableAmountCents',
       true
     )
     or not public.settlement_ai_nonnegative_decimal_is_bigint(
       p_historical_totals -> 'newPayableAmountCents',
       true
     )
     or not public.settlement_ai_nonnegative_decimal_is_bigint(
       p_historical_totals -> 'newReceivableAmountCents',
       true
     )
     or not public.settlement_ai_safe_integer_json(
       p_historical_totals -> 'recordCount',
       true
     )
     or p_historical_totals ->> 'verificationStatus' not in (
       'verified',
       'unverified'
     )
     or (p_historical_totals ->> 'recordCount')::numeric
       <> (p_coverage ->> 'totalRecords')::numeric then
    return false;
  end if;

  if not public.settlement_ai_json_has_exact_keys(
       p_deltas,
       array[
         'payableAmountCents',
         'receivableAmountCents',
         'percentageBps',
         'marginImpactCents'
       ]::text[]
     )
     or not public.settlement_ai_decimal_is_bigint(
       p_deltas -> 'payableAmountCents',
       true
     )
     or not public.settlement_ai_decimal_is_bigint(
       p_deltas -> 'receivableAmountCents',
       true
     )
     or not (
       pg_catalog.jsonb_typeof(p_deltas -> 'percentageBps') = 'null'
       or public.settlement_ai_safe_integer_json(
         p_deltas -> 'percentageBps',
         false
       )
     )
     or not public.settlement_ai_decimal_is_bigint(
       p_deltas -> 'marginImpactCents',
       true
     ) then
    return false;
  end if;

  v_payable_active :=
    pg_catalog.jsonb_typeof(
      p_historical_totals -> 'newPayableAmountCents'
    ) = 'string';
  if v_payable_active = (
    pg_catalog.jsonb_typeof(
      p_historical_totals -> 'newReceivableAmountCents'
    ) = 'string'
  ) then
    return false;
  end if;

  if p_historical_totals ->> 'verificationStatus' = 'unverified' then
    if pg_catalog.jsonb_typeof(
         p_historical_totals -> 'oldPayableAmountCents'
       ) <> 'null'
       or pg_catalog.jsonb_typeof(
         p_historical_totals -> 'oldReceivableAmountCents'
       ) <> 'null'
       or pg_catalog.jsonb_typeof(p_deltas -> 'payableAmountCents') <> 'null'
       or pg_catalog.jsonb_typeof(p_deltas -> 'receivableAmountCents') <> 'null'
       or pg_catalog.jsonb_typeof(p_deltas -> 'percentageBps') <> 'null'
       or pg_catalog.jsonb_typeof(p_deltas -> 'marginImpactCents') <> 'null' then
      return false;
    end if;
  else
    if p_sample_source ->> 'kind' = 'synthetic_scenarios'
       or (p_historical_totals ->> 'recordCount')::numeric = 0
       or pg_catalog.jsonb_typeof(p_deltas -> 'percentageBps') <> 'number'
       or pg_catalog.jsonb_typeof(p_deltas -> 'marginImpactCents') <> 'string'
       or (
         v_payable_active and (
           pg_catalog.jsonb_typeof(
             p_historical_totals -> 'oldPayableAmountCents'
           ) <> 'string'
           or pg_catalog.jsonb_typeof(
             p_historical_totals -> 'oldReceivableAmountCents'
           ) <> 'null'
           or pg_catalog.jsonb_typeof(
             p_deltas -> 'payableAmountCents'
           ) <> 'string'
           or pg_catalog.jsonb_typeof(
             p_deltas -> 'receivableAmountCents'
           ) <> 'null'
         )
       )
       or (
         not v_payable_active and (
           pg_catalog.jsonb_typeof(
             p_historical_totals -> 'oldReceivableAmountCents'
           ) <> 'string'
           or pg_catalog.jsonb_typeof(
             p_historical_totals -> 'oldPayableAmountCents'
           ) <> 'null'
           or pg_catalog.jsonb_typeof(
             p_deltas -> 'receivableAmountCents'
           ) <> 'string'
           or pg_catalog.jsonb_typeof(
             p_deltas -> 'payableAmountCents'
           ) <> 'null'
         )
       ) then
      return false;
    end if;

    if v_payable_active then
      v_old := (
        p_historical_totals ->> 'oldPayableAmountCents'
      )::numeric;
      v_new := (
        p_historical_totals ->> 'newPayableAmountCents'
      )::numeric;
      v_delta := (p_deltas ->> 'payableAmountCents')::numeric;
    else
      v_old := (
        p_historical_totals ->> 'oldReceivableAmountCents'
      )::numeric;
      v_new := (
        p_historical_totals ->> 'newReceivableAmountCents'
      )::numeric;
      v_delta := (p_deltas ->> 'receivableAmountCents')::numeric;
    end if;
    v_margin := (p_deltas ->> 'marginImpactCents')::numeric;
    v_percentage := (p_deltas ->> 'percentageBps')::numeric;
    if v_new - v_old <> v_delta
       or v_margin <> (
         case when v_payable_active then -v_delta else v_delta end
       )
       or v_percentage <> (
         case
         when v_old = 0 then 0
         else pg_catalog.trunc(v_delta * 10000 / pg_catalog.abs(v_old))
         end
       ) then
      return false;
    end if;
  end if;

  if pg_catalog.jsonb_typeof(p_largest_changes) <> 'array'
     or pg_catalog.jsonb_array_length(p_largest_changes) > 100 then
    return false;
  end if;
  for v_item in
    select change.value
    from pg_catalog.jsonb_array_elements(p_largest_changes) as change(value)
  loop
    if not public.settlement_ai_json_has_exact_keys(
         v_item,
         array['dimension', 'key', 'deltaAmountCents', 'direction']::text[]
       )
       or v_item ->> 'dimension' not in (
         'rule_component',
         'scenario',
         'period'
       )
       or pg_catalog.jsonb_typeof(v_item -> 'key') <> 'string'
       or pg_catalog.char_length(v_item ->> 'key') not between 1 and 200
       or v_item ->> 'key' <> pg_catalog.btrim(v_item ->> 'key')
       or not public.settlement_ai_decimal_is_bigint(
         v_item -> 'deltaAmountCents',
         false
       )
       or v_item ->> 'direction' not in (
         'increase',
         'decrease',
         'unchanged'
       ) then
      return false;
    end if;
    v_normalized := pg_catalog.lower(
      pg_catalog.regexp_replace(v_item ->> 'key', '[^a-z0-9]', '', 'g')
    );
    if v_normalized in (
      'amountcents',
      'conversationid',
      'importpayload',
      'internalmargin',
      'organizationid',
      'parsedpayload',
      'payload',
      'projectid',
      'rawpayload',
      'rawrows',
      'reportid',
      'reportrows',
      'rows',
      'samplerows',
      'sourcepayload',
      'streamer',
      'streameramount',
      'streameramounts',
      'streamerid',
      'tax'
    ) then
      return false;
    end if;
  end loop;

  if pg_catalog.jsonb_typeof(p_warnings) <> 'array'
     or pg_catalog.jsonb_array_length(p_warnings) > 100 then
    return false;
  end if;
  for v_item in
    select finding.value
    from pg_catalog.jsonb_array_elements(p_warnings) as finding(value)
  loop
    if not public.settlement_ai_json_has_exact_keys(
         v_item,
         array['kind', 'code', 'severity', 'message']::text[]
       )
       or v_item ->> 'kind' not in ('warning', 'risk')
       or pg_catalog.jsonb_typeof(v_item -> 'code') <> 'string'
       or pg_catalog.char_length(v_item ->> 'code') not between 1 and 120
       or v_item ->> 'code' <> pg_catalog.btrim(v_item ->> 'code')
       or v_item ->> 'severity' not in ('info', 'warning', 'block')
       or pg_catalog.jsonb_typeof(v_item -> 'message') <> 'string'
       or pg_catalog.char_length(v_item ->> 'message') not between 1 and 4000
       or v_item ->> 'message' <> pg_catalog.btrim(v_item ->> 'message') then
      return false;
    end if;
  end loop;
  if exists (
    select finding.value ->> 'kind', finding.value ->> 'code'
    from pg_catalog.jsonb_array_elements(p_warnings) as finding(value)
    group by finding.value ->> 'kind', finding.value ->> 'code'
    having pg_catalog.count(*) > 1
  ) then
    return false;
  end if;

  return true;
exception
  when others then return false;
end;
$$;

create or replace function public.settlement_ai_simulation_summary_is_valid(
  p_project_id uuid,
  p_sample_source jsonb,
  p_sample_selection jsonb,
  p_coverage jsonb,
  p_scenarios jsonb,
  p_historical_totals jsonb,
  p_deltas jsonb,
  p_largest_changes jsonb,
  p_warnings jsonb
)
returns boolean
language sql
immutable
set search_path = pg_catalog, public
as $$
  select coalesce(
    public.settlement_ai_simulation_summary_v1_is_valid(
      p_project_id,
      p_sample_source,
      p_sample_selection,
      p_coverage,
      p_scenarios,
      p_historical_totals,
      p_deltas,
      p_largest_changes,
      p_warnings
    ),
    false
  ) or coalesce(
    public.settlement_ai_simulation_summary_v2_is_valid(
      p_project_id,
      p_sample_source,
      p_sample_selection,
      p_coverage,
      p_scenarios,
      p_historical_totals,
      p_deltas,
      p_largest_changes,
      p_warnings
    ),
    false
  );
$$;

alter table public.settlement_formula_simulations
  drop constraint settlement_formula_simulations_json_shapes_check,
  drop constraint settlement_formula_simulations_decimal_totals_check,
  drop constraint settlement_formula_simulations_summary_valid;

alter table public.settlement_formula_simulations
  add constraint settlement_formula_simulations_json_shapes_check check (
    public.settlement_ai_simulation_summary_is_valid(
      project_id,
      sample_source,
      sample_selection,
      coverage,
      scenarios,
      historical_totals,
      deltas,
      largest_changes,
      warnings
    )
  ),
  add constraint settlement_formula_simulations_decimal_totals_check check (
    public.settlement_ai_simulation_summary_is_valid(
      project_id,
      sample_source,
      sample_selection,
      coverage,
      scenarios,
      historical_totals,
      deltas,
      largest_changes,
      warnings
    )
  ),
  add constraint settlement_formula_simulations_summary_valid check (
    public.settlement_ai_simulation_summary_is_valid(
      project_id,
      sample_source,
      sample_selection,
      coverage,
      scenarios,
      historical_totals,
      deltas,
      largest_changes,
      warnings
    )
  );

create or replace function public.require_settlement_formula_simulation_summary_v2()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.coverage -> 'summarySchemaVersion' is distinct from '2'::jsonb
     or not public.settlement_ai_simulation_summary_v2_is_valid(
       new.project_id,
       new.sample_source,
       new.sample_selection,
       new.coverage,
       new.scenarios,
       new.historical_totals,
       new.deltas,
       new.largest_changes,
       new.warnings
     ) then
    raise exception 'settlement_ai_simulation_summary_v2_required';
  end if;
  return new;
end;
$$;

create trigger settlement_formula_simulations_require_v2
before insert on public.settlement_formula_simulations
for each row execute function public.require_settlement_formula_simulation_summary_v2();

-- Keep the public RPC signature stable while removing its duplicated v1-only
-- shape checks. The strict versioned validator and insert trigger are the two
-- write gates.
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
  perform public.settlement_ai_lock_authoring_parents(
    p_organization_id,
    v_actor_id,
    p_project_id
  );
  if p_rule_version_id is not null then
    raise exception 'settlement_ai_rule_version_owner_phase1_unsupported';
  end if;
  if p_ai_draft_id is null then
    raise exception 'settlement_ai_simulation_ai_draft_owner_required';
  end if;
  if ((p_rule_version_id is not null)::integer + (p_ai_draft_id is not null)::integer) <> 1 then
    raise exception 'settlement_ai_simulation_owner_invalid';
  end if;
  if nullif(pg_catalog.btrim(p_idempotency_key), '') is null
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
  if not public.settlement_ai_simulation_summary_is_valid(
    p_project_id,
    p_sample_source,
    p_sample_selection,
    p_coverage,
    p_scenarios,
    p_historical_totals,
    p_deltas,
    p_largest_changes,
    p_warnings
  ) then
    raise exception 'settlement_ai_simulation_summary_invalid';
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

  if not public.settlement_ai_simulation_summary_v2_is_valid(
    p_project_id,
    p_sample_source,
    p_sample_selection,
    p_coverage,
    p_scenarios,
    p_historical_totals,
    p_deltas,
    p_largest_changes,
    p_warnings
  ) then
    raise exception 'settlement_ai_simulation_summary_v2_required';
  end if;

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
  if v_draft.initial_status <> 'contract_ready'
     or v_draft.status not in ('contract_ready', 'simulated')
     or v_draft.formula_hash <> p_formula_hash
     or v_draft.contract_hash <> p_rule_contract_hash
     or v_draft.parameter_hash <> p_parameter_hash
     or v_draft.variable_catalog_version <> p_variable_catalog_version then
    raise exception 'settlement_ai_simulation_draft_not_fresh';
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

  if v_draft.status = 'contract_ready' then
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

revoke all on function public.settlement_ai_simulation_json_is_safe(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.settlement_ai_nonnegative_decimal_is_bigint(
  jsonb,
  boolean
) from public, anon, authenticated, service_role;
revoke all on function public.settlement_ai_simulation_summary_v1_is_valid(
  uuid,
  jsonb,
  jsonb,
  jsonb,
  jsonb,
  jsonb,
  jsonb,
  jsonb,
  jsonb
) from public, anon, authenticated, service_role;
revoke all on function public.settlement_ai_simulation_summary_v2_is_valid(
  uuid,
  jsonb,
  jsonb,
  jsonb,
  jsonb,
  jsonb,
  jsonb,
  jsonb,
  jsonb
) from public, anon, authenticated, service_role;
revoke all on function public.settlement_ai_simulation_summary_is_valid(
  uuid,
  jsonb,
  jsonb,
  jsonb,
  jsonb,
  jsonb,
  jsonb,
  jsonb,
  jsonb
) from public, anon, authenticated, service_role;
revoke all on function public.require_settlement_formula_simulation_summary_v2()
  from public, anon, authenticated, service_role;

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
