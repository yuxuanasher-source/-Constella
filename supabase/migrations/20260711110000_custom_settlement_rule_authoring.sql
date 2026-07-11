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

create or replace function public.settlement_ai_json_within_budget(
  p_value jsonb
)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog, public
as $$
declare
  v_queue jsonb[] := array[p_value];
  v_depths integer[] := array[0];
  v_index integer := 1;
  v_node_count integer := 0;
  v_node jsonb;
  v_depth integer;
  v_type text;
  v_item_count integer;
  v_child jsonb;
  v_key text;
begin
  if p_value is null
     or pg_catalog.pg_column_size(p_value) > 262144 then
    return false;
  end if;

  while v_index <= pg_catalog.cardinality(v_queue) loop
    v_node := v_queue[v_index];
    v_depth := v_depths[v_index];
    v_index := v_index + 1;
    v_node_count := v_node_count + 1;
    if v_node_count > 300 or v_depth > 20 then
      return false;
    end if;
    if v_node_count > 1
       and pg_catalog.pg_column_size(v_node) > 65536 then
      return false;
    end if;

    v_type := pg_catalog.jsonb_typeof(v_node);
    if v_type = 'string' then
      if pg_catalog.octet_length(v_node #>> '{}') > 16384 then
        return false;
      end if;
    elsif v_type = 'array' then
      v_item_count := pg_catalog.jsonb_array_length(v_node);
      if v_item_count > 200
         or pg_catalog.cardinality(v_queue) + v_item_count > 300 then
        return false;
      end if;
      for v_child in
        select item.value
        from pg_catalog.jsonb_array_elements(v_node) as item(value)
      loop
        v_queue := pg_catalog.array_append(v_queue, v_child);
        v_depths := pg_catalog.array_append(v_depths, v_depth + 1);
      end loop;
    elsif v_type = 'object' then
      select pg_catalog.count(*)::integer
      into v_item_count
      from pg_catalog.jsonb_object_keys(v_node);
      if v_item_count > 200
         or pg_catalog.cardinality(v_queue) + v_item_count > 300 then
        return false;
      end if;
      for v_key, v_child in
        select object_item.key, object_item.value
        from pg_catalog.jsonb_each(v_node) as object_item(key, value)
      loop
        if pg_catalog.octet_length(v_key) > 256 then
          return false;
        end if;
        v_queue := pg_catalog.array_append(v_queue, v_child);
        v_depths := pg_catalog.array_append(v_depths, v_depth + 1);
      end loop;
    end if;
  end loop;
  return true;
exception
  when others then return false;
end;
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

create or replace function public.settlement_ai_identifier_is_valid(p_value text)
returns boolean
language sql
immutable
set search_path = pg_catalog, public
as $$
  select
    p_value is not null
    and p_value = pg_catalog.btrim(p_value)
    and p_value ~ '^[A-Za-z_][A-Za-z0-9_]*$'
    and pg_catalog.lower(p_value) not in (
      'amount',
      '__proto__',
      'prototype',
      'constructor'
    );
$$;

create or replace function public.settlement_ai_plain_identifier_is_valid(
  p_value text
)
returns boolean
language sql
immutable
set search_path = pg_catalog, public
as $$
  select
    p_value is not null
    and p_value = pg_catalog.btrim(p_value)
    and p_value ~ '^[A-Za-z_][A-Za-z0-9_]*$';
$$;

create or replace function public.settlement_ai_uuid_text_is_valid(
  p_value text
)
returns boolean
language sql
immutable
set search_path = pg_catalog, public
as $$
  select p_value is not null and p_value ~* (
    '^('
    || '[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}'
    || '|00000000-0000-0000-0000-000000000000'
    || '|ffffffff-ffff-ffff-ffff-ffffffffffff'
    || ')$'
  );
$$;

create or replace function public.settlement_ai_offset_datetime_is_valid(
  p_value text
)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog, public
as $$
declare
  v_calendar_date date;
begin
  if p_value is null
     or p_value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](\.[0-9]+)?(Z|[+-]([01][0-9]|2[0-3]):[0-5][0-9])$' then
    return false;
  end if;
  v_calendar_date := pg_catalog.substr(p_value, 1, 10)::date;
  if pg_catalog.to_char(v_calendar_date, 'YYYY-MM-DD')
     <> pg_catalog.substr(p_value, 1, 10) then
    return false;
  end if;
  perform p_value::timestamptz;
  return true;
exception
  when others then return false;
end;
$$;

create or replace function public.settlement_ai_business_date_is_valid(
  p_value text
)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog, public
as $$
declare
  v_date date;
begin
  if p_value is null or p_value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    return false;
  end if;
  v_date := p_value::date;
  return pg_catalog.to_char(v_date, 'YYYY-MM-DD') = p_value;
exception
  when others then return false;
end;
$$;

create or replace function public.settlement_ai_safe_integer_json(
  p_value jsonb,
  p_nonnegative boolean
)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog, public
as $$
declare
  v_text text;
  v_numeric numeric;
begin
  if pg_catalog.jsonb_typeof(p_value) <> 'number' then
    return false;
  end if;
  v_text := p_value #>> '{}';
  if v_text !~ '^-?(0|[1-9][0-9]*)$' then
    return false;
  end if;
  v_numeric := v_text::numeric;
  return v_numeric between -9007199254740991::numeric and 9007199254740991::numeric
    and (not p_nonnegative or v_numeric >= 0);
exception
  when others then return false;
end;
$$;

create or replace function public.settlement_ai_finite_number_json(
  p_value jsonb
)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog, public
as $$
declare
  v_number numeric;
begin
  if pg_catalog.jsonb_typeof(p_value) <> 'number' then
    return false;
  end if;
  v_number := (p_value #>> '{}')::numeric;
  return v_number between
    -1.7976931348623157e308::numeric and 1.7976931348623157e308::numeric;
exception
  when others then return false;
end;
$$;

create or replace function public.settlement_ai_runtime_type_is_valid(
  p_value jsonb
)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog, public
as $$
declare
  v_kind text;
  v_field record;
begin
  if pg_catalog.jsonb_typeof(p_value) <> 'object' then
    return false;
  end if;
  v_kind := p_value ->> 'kind';
  if v_kind = 'scalar' then
    return public.settlement_ai_json_has_exact_keys(
      p_value,
      array['kind', 'scalarType']::text[]
    ) and p_value ->> 'scalarType' in (
      'money_cents',
      'rate_bps',
      'number',
      'integer',
      'boolean',
      'string',
      'timestamp'
    );
  end if;
  if v_kind = 'array' then
    return public.settlement_ai_json_has_exact_keys(
      p_value,
      array['kind', 'itemType']::text[]
    ) and public.settlement_ai_runtime_type_is_valid(p_value -> 'itemType');
  end if;
  if v_kind <> 'object'
     or not public.settlement_ai_json_has_exact_keys(
       p_value,
       array['kind', 'fields']::text[]
     )
     or pg_catalog.jsonb_typeof(p_value -> 'fields') <> 'object' then
    return false;
  end if;
  for v_field in
    select field.key, field.value
    from pg_catalog.jsonb_each(p_value -> 'fields') as field(key, value)
  loop
    if not public.settlement_ai_identifier_is_valid(v_field.key)
       or not public.settlement_ai_runtime_type_is_valid(v_field.value) then
      return false;
    end if;
  end loop;
  return true;
exception
  when others then return false;
end;
$$;

create or replace function public.settlement_ai_typed_value_is_valid(
  p_value jsonb
)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog, public
as $$
declare
  v_type text;
  v_item jsonb;
  v_field record;
  v_number numeric;
begin
  if pg_catalog.jsonb_typeof(p_value) <> 'object' then
    return false;
  end if;
  v_type := p_value ->> 'type';
  if v_type = 'money_cents' then
    return public.settlement_ai_json_has_exact_keys(
      p_value,
      array['type', 'amountCents']::text[]
    ) and public.settlement_ai_safe_integer_json(
      p_value -> 'amountCents',
      false
    );
  end if;
  if v_type = 'rate_bps' then
    return public.settlement_ai_json_has_exact_keys(
      p_value,
      array['type', 'rateBps']::text[]
    ) and public.settlement_ai_safe_integer_json(p_value -> 'rateBps', false);
  end if;
  if v_type = 'integer' then
    return public.settlement_ai_json_has_exact_keys(
      p_value,
      array['type', 'value']::text[]
    ) and public.settlement_ai_safe_integer_json(p_value -> 'value', false);
  end if;
  if v_type = 'number' then
    if not public.settlement_ai_json_has_exact_keys(
         p_value,
         array['type', 'value']::text[]
       )
       or pg_catalog.jsonb_typeof(p_value -> 'value') <> 'number' then
      return false;
    end if;
    v_number := (p_value ->> 'value')::numeric;
    return v_number between
      -1.7976931348623157e308::numeric and 1.7976931348623157e308::numeric;
  end if;
  if v_type = 'boolean' then
    return public.settlement_ai_json_has_exact_keys(
      p_value,
      array['type', 'value']::text[]
    ) and pg_catalog.jsonb_typeof(p_value -> 'value') = 'boolean';
  end if;
  if v_type = 'string' then
    return public.settlement_ai_json_has_exact_keys(
      p_value,
      array['type', 'value']::text[]
    ) and pg_catalog.jsonb_typeof(p_value -> 'value') = 'string';
  end if;
  if v_type = 'timestamp' then
    return public.settlement_ai_json_has_exact_keys(
      p_value,
      array['type', 'value']::text[]
    ) and pg_catalog.jsonb_typeof(p_value -> 'value') = 'string'
      and public.settlement_ai_offset_datetime_is_valid(p_value ->> 'value');
  end if;
  if v_type = 'array' then
    if not public.settlement_ai_json_has_exact_keys(
         p_value,
         array['type', 'items']::text[]
       )
       or pg_catalog.jsonb_typeof(p_value -> 'items') <> 'array' then
      return false;
    end if;
    for v_item in
      select item.value
      from pg_catalog.jsonb_array_elements(p_value -> 'items') as item(value)
    loop
      if not public.settlement_ai_typed_value_is_valid(v_item) then
        return false;
      end if;
    end loop;
    return true;
  end if;
  if v_type <> 'object'
     or not public.settlement_ai_json_has_exact_keys(
       p_value,
       array['type', 'fields']::text[]
     )
     or pg_catalog.jsonb_typeof(p_value -> 'fields') <> 'object' then
    return false;
  end if;
  for v_field in
    select field.key, field.value
    from pg_catalog.jsonb_each(p_value -> 'fields') as field(key, value)
  loop
    if not public.settlement_ai_identifier_is_valid(v_field.key)
       or not public.settlement_ai_typed_value_is_valid(v_field.value) then
      return false;
    end if;
  end loop;
  return true;
exception
  when others then return false;
end;
$$;

create or replace function public.settlement_ai_runtime_value_matches_type(
  p_value jsonb,
  p_value_type jsonb
)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog, public
as $$
declare
  v_kind text;
  v_item jsonb;
  v_field record;
  v_expected_count bigint;
  v_actual_count bigint;
begin
  if not public.settlement_ai_typed_value_is_valid(p_value)
     or not public.settlement_ai_runtime_type_is_valid(p_value_type) then
    return false;
  end if;
  v_kind := p_value_type ->> 'kind';
  if v_kind = 'scalar' then
    return p_value ->> 'type' = p_value_type ->> 'scalarType';
  end if;
  if v_kind = 'array' then
    if p_value ->> 'type' <> 'array' then
      return false;
    end if;
    for v_item in
      select item.value
      from pg_catalog.jsonb_array_elements(p_value -> 'items') as item(value)
    loop
      if not public.settlement_ai_runtime_value_matches_type(
        v_item,
        p_value_type -> 'itemType'
      ) then
        return false;
      end if;
    end loop;
    return true;
  end if;
  if p_value ->> 'type' <> 'object' then
    return false;
  end if;
  select pg_catalog.count(*) into v_expected_count
  from pg_catalog.jsonb_object_keys(p_value_type -> 'fields');
  select pg_catalog.count(*) into v_actual_count
  from pg_catalog.jsonb_object_keys(p_value -> 'fields');
  if v_expected_count <> v_actual_count then
    return false;
  end if;
  for v_field in
    select field.key, field.value
    from pg_catalog.jsonb_each(p_value_type -> 'fields') as field(key, value)
  loop
    if not (p_value -> 'fields' ? v_field.key)
       or not public.settlement_ai_runtime_value_matches_type(
         p_value -> 'fields' -> v_field.key,
         v_field.value
       ) then
      return false;
    end if;
  end loop;
  return true;
exception
  when others then return false;
end;
$$;

create or replace function public.settlement_ai_turn_trace_json_is_valid(
  p_value jsonb
)
returns boolean
language sql
immutable
set search_path = pg_catalog, public
as $$
  select
    public.settlement_ai_json_has_exact_keys(
      p_value,
      array['turnId', 'userMessageId', 'assistantMessageId']::text[]
    )
    and pg_catalog.jsonb_typeof(p_value -> 'turnId') = 'string'
    and pg_catalog.jsonb_typeof(p_value -> 'userMessageId') = 'string'
    and pg_catalog.jsonb_typeof(p_value -> 'assistantMessageId') = 'string'
    and public.settlement_ai_uuid_text_is_valid(p_value ->> 'turnId')
    and public.settlement_ai_uuid_text_is_valid(p_value ->> 'userMessageId')
    and public.settlement_ai_uuid_text_is_valid(
      p_value ->> 'assistantMessageId'
    );
$$;

create or replace function public.settlement_ai_unresolved_ambiguities_is_valid(
  p_value jsonb
)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog, public
as $$
declare
  v_item jsonb;
begin
  if pg_catalog.jsonb_typeof(p_value) <> 'array'
     or pg_catalog.jsonb_array_length(p_value) > 100 then
    return false;
  end if;
  for v_item in
    select item.value
    from pg_catalog.jsonb_array_elements(p_value) as item(value)
  loop
    if not public.settlement_ai_json_has_exact_keys(
         v_item,
         array['code', 'question', 'required']::text[]
       )
       or pg_catalog.jsonb_typeof(v_item -> 'code') <> 'string'
       or pg_catalog.char_length(
         pg_catalog.btrim(v_item ->> 'code')
       ) not between 1 and 120
       or pg_catalog.jsonb_typeof(v_item -> 'question') <> 'string'
       or pg_catalog.char_length(
         pg_catalog.btrim(v_item ->> 'question')
       ) not between 1 and 4000
       or pg_catalog.jsonb_typeof(v_item -> 'required') <> 'boolean' then
      return false;
    end if;
  end loop;
  return true;
exception
  when others then return false;
end;
$$;

create or replace function public.settlement_ai_response_is_valid(
  p_value jsonb
)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog, public
as $$
begin
  if not public.settlement_ai_json_has_exact_keys(
       p_value,
       array['content', 'finishReason', 'providerRequestId']::text[]
     )
     or pg_catalog.jsonb_typeof(p_value -> 'content') <> 'string'
     or pg_catalog.char_length(p_value ->> 'content') > 4000
     or nullif(pg_catalog.btrim(p_value ->> 'content'), '') is null
     or pg_catalog.jsonb_typeof(p_value -> 'finishReason') <> 'string'
     or p_value ->> 'finishReason' not in (
       'stop', 'length', 'content_filter', 'tool_call'
     ) then
    return false;
  end if;
  if pg_catalog.jsonb_typeof(p_value -> 'providerRequestId') = 'null' then
    return true;
  end if;
  return pg_catalog.jsonb_typeof(p_value -> 'providerRequestId') = 'string'
    and pg_catalog.char_length(
      pg_catalog.btrim(p_value ->> 'providerRequestId')
    ) between 1 and 500;
exception
  when others then return false;
end;
$$;

create or replace function public.settlement_ai_normalized_ast_is_valid(
  p_value jsonb
)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog, public
as $$
declare
  v_kind text;
  v_item jsonb;
  v_entry jsonb;
  v_value_type text;
begin
  if pg_catalog.jsonb_typeof(p_value) <> 'object'
     or pg_catalog.jsonb_typeof(p_value -> 'kind') <> 'string' then
    return false;
  end if;
  v_kind := p_value ->> 'kind';

  if v_kind = 'literal' then
    if not public.settlement_ai_json_has_exact_keys(
      p_value,
      array['kind', 'value']::text[]
    ) then
      return false;
    end if;
    v_value_type := pg_catalog.jsonb_typeof(p_value -> 'value');
    return v_value_type in ('string', 'boolean', 'null')
      or (
        v_value_type = 'number'
        and public.settlement_ai_finite_number_json(p_value -> 'value')
      );
  end if;

  if v_kind = 'identifier' then
    return public.settlement_ai_json_has_exact_keys(
      p_value,
      array['kind', 'name']::text[]
    ) and pg_catalog.jsonb_typeof(p_value -> 'name') = 'string'
      and public.settlement_ai_identifier_is_valid(p_value ->> 'name');
  end if;

  if v_kind = 'unary' then
    return public.settlement_ai_json_has_exact_keys(
      p_value,
      array['kind', 'operator', 'argument']::text[]
    ) and pg_catalog.jsonb_typeof(p_value -> 'operator') = 'string'
      and pg_catalog.char_length(p_value ->> 'operator') >= 1
      and public.settlement_ai_normalized_ast_is_valid(
        p_value -> 'argument'
      );
  end if;

  if v_kind = 'binary' then
    return public.settlement_ai_json_has_exact_keys(
      p_value,
      array['kind', 'operator', 'left', 'right']::text[]
    ) and pg_catalog.jsonb_typeof(p_value -> 'operator') = 'string'
      and pg_catalog.char_length(p_value ->> 'operator') >= 1
      and public.settlement_ai_normalized_ast_is_valid(p_value -> 'left')
      and public.settlement_ai_normalized_ast_is_valid(p_value -> 'right');
  end if;

  if v_kind = 'call' then
    if not public.settlement_ai_json_has_exact_keys(
         p_value,
         array['kind', 'callee', 'arguments']::text[]
       )
       or pg_catalog.jsonb_typeof(p_value -> 'callee') <> 'string'
       or not public.settlement_ai_identifier_is_valid(p_value ->> 'callee')
       or pg_catalog.jsonb_typeof(p_value -> 'arguments') <> 'array' then
      return false;
    end if;
    for v_item in
      select item.value
      from pg_catalog.jsonb_array_elements(p_value -> 'arguments') as item(value)
    loop
      if not public.settlement_ai_normalized_ast_is_valid(v_item) then
        return false;
      end if;
    end loop;
    return true;
  end if;

  if v_kind = 'array' then
    if not public.settlement_ai_json_has_exact_keys(
         p_value,
         array['kind', 'elements']::text[]
       )
       or pg_catalog.jsonb_typeof(p_value -> 'elements') <> 'array' then
      return false;
    end if;
    for v_item in
      select item.value
      from pg_catalog.jsonb_array_elements(p_value -> 'elements') as item(value)
    loop
      if not public.settlement_ai_normalized_ast_is_valid(v_item) then
        return false;
      end if;
    end loop;
    return true;
  end if;

  if v_kind = 'object' then
    if not public.settlement_ai_json_has_exact_keys(
         p_value,
         array['kind', 'entries']::text[]
       )
       or pg_catalog.jsonb_typeof(p_value -> 'entries') <> 'array' then
      return false;
    end if;
    for v_entry in
      select entry.value
      from pg_catalog.jsonb_array_elements(p_value -> 'entries') as entry(value)
    loop
      if not public.settlement_ai_json_has_exact_keys(
           v_entry,
           array['key', 'value']::text[]
         )
         or pg_catalog.jsonb_typeof(v_entry -> 'key') <> 'string'
         or not public.settlement_ai_identifier_is_valid(v_entry ->> 'key')
         or not public.settlement_ai_normalized_ast_is_valid(
           v_entry -> 'value'
         ) then
        return false;
      end if;
    end loop;
    return true;
  end if;

  return false;
exception
  when others then return false;
end;
$$;

create or replace function public.settlement_ai_generated_formula_is_valid(
  p_value jsonb
)
returns boolean
language sql
immutable
set search_path = pg_catalog, public
as $$
  select
    public.settlement_ai_json_has_exact_keys(
      p_value,
      array['expression', 'normalizedAst']::text[]
    )
    and pg_catalog.jsonb_typeof(p_value -> 'expression') = 'string'
    and pg_catalog.char_length(
      pg_catalog.btrim(p_value ->> 'expression')
    ) between 1 and 4000
    and public.settlement_ai_normalized_ast_is_valid(
      p_value -> 'normalizedAst'
    );
$$;

create or replace function public.settlement_ai_generated_test_cases_is_valid(
  p_value jsonb
)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog, public
as $$
declare
  v_item jsonb;
  v_input record;
begin
  if pg_catalog.jsonb_typeof(p_value) <> 'array'
     or pg_catalog.jsonb_array_length(p_value) not between 1 and 200 then
    return false;
  end if;
  for v_item in
    select item.value
    from pg_catalog.jsonb_array_elements(p_value) as item(value)
  loop
    if not public.settlement_ai_json_has_exact_keys(
         v_item,
         array['name', 'inputs', 'expectedResult']::text[]
       )
       or pg_catalog.jsonb_typeof(v_item -> 'name') <> 'string'
       or pg_catalog.char_length(
         pg_catalog.btrim(v_item ->> 'name')
       ) not between 1 and 200
       or pg_catalog.jsonb_typeof(v_item -> 'inputs') <> 'object'
       or not public.settlement_ai_typed_value_is_valid(
         v_item -> 'expectedResult'
       ) then
      return false;
    end if;
    for v_input in
      select input.key, input.value
      from pg_catalog.jsonb_each(v_item -> 'inputs') as input(key, value)
    loop
      if not public.settlement_ai_plain_identifier_is_valid(v_input.key)
         or not public.settlement_ai_typed_value_is_valid(v_input.value) then
        return false;
      end if;
    end loop;
  end loop;
  return true;
exception
  when others then return false;
end;
$$;

create or replace function public.settlement_ai_safety_flags_is_valid(
  p_value jsonb
)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog, public
as $$
declare
  v_item jsonb;
begin
  if pg_catalog.jsonb_typeof(p_value) <> 'array'
     or pg_catalog.jsonb_array_length(p_value) > 100 then
    return false;
  end if;
  for v_item in
    select item.value
    from pg_catalog.jsonb_array_elements(p_value) as item(value)
  loop
    if not public.settlement_ai_json_has_exact_keys(
         v_item,
         array['code', 'severity', 'message']::text[]
       )
       or pg_catalog.jsonb_typeof(v_item -> 'code') <> 'string'
       or pg_catalog.char_length(
         pg_catalog.btrim(v_item ->> 'code')
       ) not between 1 and 120
       or pg_catalog.jsonb_typeof(v_item -> 'severity') <> 'string'
       or v_item ->> 'severity' not in ('info', 'warning', 'block')
       or pg_catalog.jsonb_typeof(v_item -> 'message') <> 'string'
       or pg_catalog.char_length(
         pg_catalog.btrim(v_item ->> 'message')
       ) not between 1 and 4000 then
      return false;
    end if;
  end loop;
  return true;
exception
  when others then return false;
end;
$$;

create or replace function public.settlement_ai_business_contract_is_valid(
  p_contract jsonb
)
returns boolean
language plpgsql
stable
set search_path = pg_catalog, public
as $$
declare
  v_scope text;
  v_target_type text;
  v_component jsonb;
  v_required_input jsonb;
  v_parameter jsonb;
  v_example jsonb;
  v_example_input record;
  v_name text;
  v_component_names text[] := '{}'::text[];
  v_required_input_names text[] := '{}'::text[];
  v_parameter_names text[] := '{}'::text[];
  v_example_names text[] := '{}'::text[];
  v_normal_examples integer := 0;
  v_boundary_examples integer := 0;
begin
  if not public.settlement_ai_json_within_budget(p_contract) then
    return false;
  end if;
  if not public.settlement_ai_json_has_exact_keys(
    p_contract,
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
  ) or p_contract -> 'schemaVersion' <> '1'::jsonb then
    return false;
  end if;

  v_scope := p_contract ->> 'scope';
  v_target_type := p_contract -> 'target' ->> 'targetType';
  if v_scope not in ('receivable', 'payable', 'external_cost', 'reconciliation')
     or p_contract ->> 'executionGrain' not in (
       'report',
       'project_streamer_period',
       'batch',
       'project_period'
     )
     or p_contract ->> 'compositionMode' not in (
       'replace',
       'add',
       'multiply',
       'clamp',
       'emit_items',
       'check'
     ) then
    return false;
  end if;
  if not public.settlement_ai_json_has_exact_keys(
       p_contract -> 'target',
       array['targetType', 'targetId']::text[]
     )
     or v_target_type not in ('project', 'streamer_group', 'project_streamer')
     or (v_scope <> 'payable' and v_target_type <> 'project') then
    return false;
  end if;
  if (v_target_type = 'project' and pg_catalog.jsonb_typeof(
       p_contract -> 'target' -> 'targetId'
     ) <> 'null')
     or (
       v_target_type <> 'project'
       and (
         pg_catalog.jsonb_typeof(p_contract -> 'target' -> 'targetId') <> 'string'
         or nullif(
           pg_catalog.btrim(p_contract -> 'target' ->> 'targetId'),
           ''
         ) is null
       )
     ) then
    return false;
  end if;
  if pg_catalog.jsonb_typeof(p_contract -> 'title') <> 'string'
     or pg_catalog.char_length(
       pg_catalog.btrim(p_contract ->> 'title')
     ) < 2
     or p_contract ->> 'title' !~ '[㐀-鿿]'
     or pg_catalog.jsonb_typeof(p_contract -> 'summary') <> 'string'
     or pg_catalog.char_length(
       pg_catalog.btrim(p_contract ->> 'summary')
     ) < 2
     or p_contract ->> 'summary' !~ '[㐀-鿿]' then
    return false;
  end if;
  if pg_catalog.jsonb_typeof(p_contract -> 'calculationComponents') <> 'array'
     or pg_catalog.jsonb_array_length(p_contract -> 'calculationComponents') = 0
     or pg_catalog.jsonb_typeof(p_contract -> 'requiredInputs') <> 'array'
     or pg_catalog.jsonb_array_length(p_contract -> 'requiredInputs') = 0
     or pg_catalog.jsonb_typeof(p_contract -> 'parameters') <> 'array'
     or pg_catalog.jsonb_array_length(p_contract -> 'parameters') = 0
     or pg_catalog.jsonb_typeof(p_contract -> 'examples') <> 'array'
     or pg_catalog.jsonb_array_length(p_contract -> 'examples') < 3 then
    return false;
  end if;
  if pg_catalog.jsonb_typeof(p_contract -> 'effectiveStartAt') <> 'string'
     or not public.settlement_ai_offset_datetime_is_valid(
       p_contract ->> 'effectiveStartAt'
     )
     or (
       pg_catalog.jsonb_typeof(p_contract -> 'effectiveEndAt') <> 'null'
       and (
         pg_catalog.jsonb_typeof(p_contract -> 'effectiveEndAt') <> 'string'
         or not public.settlement_ai_offset_datetime_is_valid(
           p_contract ->> 'effectiveEndAt'
         )
         or (p_contract ->> 'effectiveEndAt')::timestamptz
           <= (p_contract ->> 'effectiveStartAt')::timestamptz
       )
     ) then
    return false;
  end if;
  if pg_catalog.jsonb_typeof(p_contract -> 'businessTimezone') <> 'string'
     or nullif(
       pg_catalog.btrim(p_contract ->> 'businessTimezone'),
       ''
     ) is null
     or not exists (
       select 1
       from pg_catalog.pg_timezone_names as timezone
       where timezone.name = pg_catalog.btrim(
         p_contract ->> 'businessTimezone'
       )
     )
     or pg_catalog.jsonb_typeof(p_contract -> 'compositionDescription') <> 'string'
     or nullif(
       pg_catalog.btrim(p_contract ->> 'compositionDescription'),
       ''
     ) is null then
    return false;
  end if;

  if pg_catalog.jsonb_typeof(p_contract -> 'missingDataPolicy') <> 'object' then
    return false;
  end if;
  if p_contract -> 'missingDataPolicy' ->> 'action' in (
    'route_item_to_review',
    'block_batch'
  ) then
    if not public.settlement_ai_json_has_exact_keys(
      p_contract -> 'missingDataPolicy',
      array['action']::text[]
    ) then
      return false;
    end if;
  elsif p_contract -> 'missingDataPolicy' ->> 'action' = 'use_explicit_default' then
    if not public.settlement_ai_json_has_exact_keys(
         p_contract -> 'missingDataPolicy',
         array['action', 'defaultValue']::text[]
       )
       or not public.settlement_ai_typed_value_is_valid(
         p_contract -> 'missingDataPolicy' -> 'defaultValue'
       ) then
      return false;
    end if;
  else
    return false;
  end if;

  for v_component in
    select item.value
    from pg_catalog.jsonb_array_elements(
      p_contract -> 'calculationComponents'
    ) as item(value)
  loop
    if not public.settlement_ai_json_has_exact_keys(
         v_component,
         array['name', 'description', 'expression', 'resultType']::text[]
       )
       or not public.settlement_ai_identifier_is_valid(v_component ->> 'name')
       or pg_catalog.jsonb_typeof(v_component -> 'description') <> 'string'
       or nullif(
         pg_catalog.btrim(v_component ->> 'description'),
         ''
       ) is null
       or pg_catalog.jsonb_typeof(v_component -> 'expression') <> 'string'
       or nullif(
         pg_catalog.btrim(v_component ->> 'expression'),
         ''
       ) is null
       or not public.settlement_ai_runtime_type_is_valid(
         v_component -> 'resultType'
       ) then
      return false;
    end if;
    v_name := v_component ->> 'name';
    if v_component_names @> array[v_name] then return false; end if;
    v_component_names := pg_catalog.array_append(v_component_names, v_name);
  end loop;

  for v_required_input in
    select item.value
    from pg_catalog.jsonb_array_elements(
      p_contract -> 'requiredInputs'
    ) as item(value)
  loop
    if not public.settlement_ai_json_has_exact_keys(
         v_required_input,
         array[
           'name',
           'description',
           'source',
           'valueType',
           'userFacingUnit'
         ]::text[]
       )
       or not public.settlement_ai_identifier_is_valid(
         v_required_input ->> 'name'
       )
       or pg_catalog.jsonb_typeof(v_required_input -> 'description') <> 'string'
       or nullif(
         pg_catalog.btrim(v_required_input ->> 'description'),
         ''
       ) is null
       or pg_catalog.jsonb_typeof(v_required_input -> 'source') <> 'string'
       or nullif(
         pg_catalog.btrim(v_required_input ->> 'source'),
         ''
       ) is null
       or pg_catalog.jsonb_typeof(v_required_input -> 'userFacingUnit') <> 'string'
       or nullif(
         pg_catalog.btrim(v_required_input ->> 'userFacingUnit'),
         ''
       ) is null
       or not public.settlement_ai_runtime_type_is_valid(
         v_required_input -> 'valueType'
       ) then
      return false;
    end if;
    v_name := v_required_input ->> 'name';
    if v_required_input_names @> array[v_name] then return false; end if;
    v_required_input_names := pg_catalog.array_append(
      v_required_input_names,
      v_name
    );
  end loop;

  for v_parameter in
    select item.value
    from pg_catalog.jsonb_array_elements(p_contract -> 'parameters') as item(value)
  loop
    if not public.settlement_ai_json_has_exact_keys(
         v_parameter,
         array[
           'name',
           'description',
           'valueType',
           'userFacingUnit',
           'defaultValue'
         ]::text[]
       )
       or not public.settlement_ai_identifier_is_valid(v_parameter ->> 'name')
       or pg_catalog.jsonb_typeof(v_parameter -> 'description') <> 'string'
       or nullif(
         pg_catalog.btrim(v_parameter ->> 'description'),
         ''
       ) is null
       or pg_catalog.jsonb_typeof(v_parameter -> 'userFacingUnit') <> 'string'
       or nullif(
         pg_catalog.btrim(v_parameter ->> 'userFacingUnit'),
         ''
       ) is null
       or not public.settlement_ai_runtime_type_is_valid(
         v_parameter -> 'valueType'
       )
       or not public.settlement_ai_typed_value_is_valid(
         v_parameter -> 'defaultValue'
       )
       or not public.settlement_ai_runtime_value_matches_type(
         v_parameter -> 'defaultValue',
         v_parameter -> 'valueType'
       ) then
      return false;
    end if;
    v_name := v_parameter ->> 'name';
    if v_parameter_names @> array[v_name]
       or v_required_input_names @> array[v_name] then
      return false;
    end if;
    v_parameter_names := pg_catalog.array_append(v_parameter_names, v_name);
  end loop;

  for v_example in
    select item.value
    from pg_catalog.jsonb_array_elements(p_contract -> 'examples') as item(value)
  loop
    if not public.settlement_ai_json_has_exact_keys(
         v_example,
         array['name', 'kind', 'description', 'inputs', 'expectedResult']::text[]
       )
       or pg_catalog.jsonb_typeof(v_example -> 'name') <> 'string'
       or nullif(pg_catalog.btrim(v_example ->> 'name'), '') is null
       or v_example ->> 'kind' not in ('normal', 'boundary')
       or pg_catalog.jsonb_typeof(v_example -> 'description') <> 'string'
       or nullif(
         pg_catalog.btrim(v_example ->> 'description'),
         ''
       ) is null
       or pg_catalog.jsonb_typeof(v_example -> 'inputs') <> 'object'
       or not public.settlement_ai_typed_value_is_valid(
         v_example -> 'expectedResult'
       ) then
      return false;
    end if;
    v_name := v_example ->> 'name';
    if v_example_names @> array[v_name] then return false; end if;
    v_example_names := pg_catalog.array_append(v_example_names, v_name);
    if v_example ->> 'kind' = 'normal' then
      v_normal_examples := v_normal_examples + 1;
    else
      v_boundary_examples := v_boundary_examples + 1;
    end if;
    for v_example_input in
      select input.key, input.value
      from pg_catalog.jsonb_each(v_example -> 'inputs') as input(key, value)
    loop
      if not public.settlement_ai_identifier_is_valid(v_example_input.key)
         or not public.settlement_ai_typed_value_is_valid(
           v_example_input.value
         ) then
        return false;
      end if;
    end loop;
    for v_required_input in
      select item.value
      from pg_catalog.jsonb_array_elements(
        p_contract -> 'requiredInputs'
      ) as item(value)
    loop
      v_name := v_required_input ->> 'name';
      if not (v_example -> 'inputs' ? v_name)
         or not public.settlement_ai_runtime_value_matches_type(
           v_example -> 'inputs' -> v_name,
           v_required_input -> 'valueType'
         ) then
        return false;
      end if;
    end loop;
  end loop;

  if v_normal_examples < 1 or v_boundary_examples < 2 then
    return false;
  end if;
  return true;
exception
  when others then return false;
end;
$$;

create or replace function public.settlement_ai_draft_payload_is_valid(
  p_turn_trace jsonb,
  p_business_contract jsonb,
  p_unresolved_ambiguities jsonb,
  p_ai_response jsonb,
  p_generated_formula jsonb,
  p_generated_test_cases jsonb,
  p_safety_flags jsonb
)
returns boolean
language plpgsql
stable
set search_path = pg_catalog, public
as $$
begin
  if not public.settlement_ai_json_within_budget(
       pg_catalog.jsonb_build_array(
         p_turn_trace,
         p_business_contract,
         p_unresolved_ambiguities,
         p_ai_response,
         p_generated_formula,
         p_generated_test_cases,
         p_safety_flags
       )
     )
     or not public.settlement_ai_json_within_budget(p_turn_trace)
     or not public.settlement_ai_json_within_budget(p_business_contract)
     or not public.settlement_ai_json_within_budget(p_unresolved_ambiguities)
     or not public.settlement_ai_json_within_budget(p_ai_response)
     or not public.settlement_ai_json_within_budget(p_generated_formula)
     or not public.settlement_ai_json_within_budget(p_generated_test_cases)
     or not public.settlement_ai_json_within_budget(p_safety_flags) then
    return false;
  end if;
  return public.settlement_ai_json_is_safe(p_turn_trace)
    and public.settlement_ai_json_is_safe(p_business_contract)
    and public.settlement_ai_json_is_safe(p_unresolved_ambiguities)
    and public.settlement_ai_json_is_safe(p_ai_response)
    and public.settlement_ai_json_is_safe(p_generated_formula)
    and public.settlement_ai_json_is_safe(p_generated_test_cases)
    and public.settlement_ai_json_is_safe(p_safety_flags)
    and public.settlement_ai_turn_trace_json_is_valid(p_turn_trace)
    and public.settlement_ai_business_contract_is_valid(p_business_contract)
    and public.settlement_ai_unresolved_ambiguities_is_valid(
      p_unresolved_ambiguities
    )
    and public.settlement_ai_response_is_valid(p_ai_response)
    and public.settlement_ai_generated_formula_is_valid(p_generated_formula)
    and public.settlement_ai_generated_test_cases_is_valid(
      p_generated_test_cases
    )
    and public.settlement_ai_safety_flags_is_valid(p_safety_flags);
exception
  when others then return false;
end;
$$;

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
      'amountcents',
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
language plpgsql
immutable
set search_path = pg_catalog, public
as $$
declare
  v_item jsonb;
  v_normalized text;
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
     or not public.settlement_ai_json_within_budget(p_warnings) then
    return false;
  end if;
  if not public.settlement_ai_simulation_json_is_safe(
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
  if not public.settlement_ai_json_has_exact_keys(
       p_sample_selection,
       array[
         'periodStart',
         'periodEnd',
         'populationCount',
         'sampledCount',
         'criteria'
       ]::text[]
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
       or pg_catalog.char_length(pg_catalog.btrim(v_item #>> '{}')) not between 1 and 200
       or v_item #>> '{}' ~* '(report|project|streamer)[_-]?id|amount[_-]?cents|internal[_-]?margin|tax|payload|rows' then
      return false;
    end if;
  end loop;

  if not public.settlement_ai_json_has_exact_keys(
       p_coverage,
       array['totalRecords', 'evaluatedRecords', 'skippedRecords']::text[]
     )
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
     or (p_coverage ->> 'evaluatedRecords')::numeric
       + (p_coverage ->> 'skippedRecords')::numeric
       <> (p_coverage ->> 'totalRecords')::numeric then
    return false;
  end if;

  if pg_catalog.jsonb_typeof(p_scenarios) <> 'array'
     or not (
       pg_catalog.jsonb_array_length(p_scenarios) between 1 and 200
     ) then
    return false;
  end if;
  for v_item in
    select scenario.value
    from pg_catalog.jsonb_array_elements(p_scenarios) as scenario(value)
  loop
    if not public.settlement_ai_json_has_exact_keys(
         v_item,
         array['name', 'kind', 'result']::text[]
       )
       or pg_catalog.jsonb_typeof(v_item -> 'name') <> 'string'
       or pg_catalog.char_length(
         pg_catalog.btrim(v_item ->> 'name')
       ) not between 1 and 200
       or v_item ->> 'kind' not in ('normal', 'boundary', 'missing_data')
       or v_item ->> 'result' not in ('passed', 'warning', 'failed') then
      return false;
    end if;
  end loop;

  if not public.settlement_ai_json_has_exact_keys(
       p_historical_totals,
       array[
         'payableAmountCents',
         'receivableAmountCents',
         'recordCount'
       ]::text[]
     )
     or not public.settlement_ai_decimal_is_bigint(
       p_historical_totals -> 'payableAmountCents',
       true
     )
     or not public.settlement_ai_decimal_is_bigint(
       p_historical_totals -> 'receivableAmountCents',
       true
     )
     or not public.settlement_ai_safe_integer_json(
       p_historical_totals -> 'recordCount',
       true
     ) then
    return false;
  end if;
  if not public.settlement_ai_json_has_exact_keys(
       p_deltas,
       array[
         'payableAmountCents',
         'receivableAmountCents',
         'percentageBps'
       ]::text[]
     )
     or not public.settlement_ai_decimal_is_bigint(
       p_deltas -> 'payableAmountCents',
       false
     )
     or not public.settlement_ai_decimal_is_bigint(
       p_deltas -> 'receivableAmountCents',
       false
     )
     or not public.settlement_ai_safe_integer_json(
       p_deltas -> 'percentageBps',
       false
     ) then
    return false;
  end if;

  if pg_catalog.jsonb_typeof(p_largest_changes) <> 'array'
     or not (pg_catalog.jsonb_array_length(p_largest_changes) <= 100) then
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
       or pg_catalog.char_length(
         pg_catalog.btrim(v_item ->> 'key')
       ) not between 1 and 200
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
      'tax',
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
      'streamerid'
    ) then
      return false;
    end if;
  end loop;

  if pg_catalog.jsonb_typeof(p_warnings) <> 'array'
     or not (pg_catalog.jsonb_array_length(p_warnings) <= 100) then
    return false;
  end if;
  for v_item in
    select warning.value
    from pg_catalog.jsonb_array_elements(p_warnings) as warning(value)
  loop
    if not public.settlement_ai_json_has_exact_keys(
         v_item,
         array['code', 'severity', 'message']::text[]
       )
       or pg_catalog.jsonb_typeof(v_item -> 'code') <> 'string'
       or pg_catalog.char_length(
         pg_catalog.btrim(v_item ->> 'code')
       ) not between 1 and 120
       or v_item ->> 'severity' not in ('info', 'warning', 'block')
       or pg_catalog.jsonb_typeof(v_item -> 'message') <> 'string'
       or pg_catalog.char_length(
         pg_catalog.btrim(v_item ->> 'message')
       ) not between 1 and 4000 then
      return false;
    end if;
  end loop;
  return true;
exception
  when others then return false;
end;
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
  request_fingerprint text not null,
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
    and request_fingerprint ~ '^[0-9a-f]{64}$'
  ),
  constraint ai_settlement_rule_drafts_text_check check (
    pg_catalog.char_length(pg_catalog.btrim(prompt_text)) between 1 and 4000
    and pg_catalog.char_length(pg_catalog.btrim(generated_explanation)) between 1 and 4000
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
  constraint ai_settlement_rule_drafts_business_contract_valid check (
    public.settlement_ai_business_contract_is_valid(business_contract)
  ),
  constraint ai_settlement_rule_drafts_payload_valid check (
    public.settlement_ai_draft_payload_is_valid(
      turn_trace,
      business_contract,
      unresolved_ambiguities,
      ai_response,
      generated_formula,
      generated_test_cases,
      safety_flags
    )
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
  ),
  constraint settlement_formula_simulations_summary_valid check (
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
  on public.settlement_formula_simulations (
    ai_draft_id,
    created_at desc,
    id desc
  )
  where ai_draft_id is not null;

create index settlement_formula_simulations_rule_version_recent_idx
  on public.settlement_formula_simulations (
    rule_version_id,
    created_at desc,
    id desc
  )
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
  v_trace_turn public.ai_chat_turns%rowtype;
  v_trace_turn_id uuid;
  v_trace_user_message_id uuid;
  v_trace_assistant_message_id uuid;
  v_next_revision integer;
  v_request_fingerprint text;
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
  if nullif(pg_catalog.btrim(p_idempotency_key), '') is null
     or pg_catalog.char_length(pg_catalog.btrim(p_idempotency_key)) > 200
     or nullif(pg_catalog.btrim(p_prompt_text), '') is null
     or pg_catalog.char_length(pg_catalog.btrim(p_prompt_text)) > 4000
     or nullif(pg_catalog.btrim(p_generated_explanation), '') is null
     or pg_catalog.char_length(pg_catalog.btrim(p_generated_explanation)) > 4000
     or nullif(pg_catalog.btrim(p_model), '') is null
     or pg_catalog.char_length(pg_catalog.btrim(p_model)) > 200 then
    raise exception 'settlement_ai_draft_text_invalid';
  end if;
  if p_variable_catalog_version !~ '^[0-9a-f]{64}$'
     or p_contract_hash !~ '^[0-9a-f]{64}$'
     or p_formula_hash !~ '^[0-9a-f]{64}$'
     or p_parameter_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'settlement_ai_draft_hash_invalid';
  end if;
  if not public.settlement_ai_draft_payload_is_valid(
    p_turn_trace,
    p_business_contract,
    p_unresolved_ambiguities,
    p_ai_response,
    p_generated_formula,
    p_generated_test_cases,
    p_safety_flags
  ) then
    raise exception 'settlement_ai_draft_payload_invalid';
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
  if not public.settlement_ai_business_contract_is_valid(p_business_contract) then
    raise exception 'settlement_ai_draft_business_contract_invalid';
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
  v_request_fingerprint := pg_catalog.encode(
    extensions.digest(
      pg_catalog.jsonb_build_object(
        'organizationId', p_organization_id,
        'projectId', p_project_id,
        'conversationId', p_conversation_id,
        'idempotencyKey', pg_catalog.btrim(p_idempotency_key),
        'promptText', pg_catalog.btrim(p_prompt_text),
        'turnTrace', p_turn_trace,
        'businessContract', p_business_contract,
        'unresolvedAmbiguities', p_unresolved_ambiguities,
        'variableCatalogVersion', p_variable_catalog_version,
        'aiResponse', p_ai_response,
        'generatedFormula', p_generated_formula,
        'generatedExplanation', pg_catalog.btrim(p_generated_explanation),
        'generatedTestCases', p_generated_test_cases,
        'model', pg_catalog.btrim(p_model),
        'safetyFlags', p_safety_flags,
        'contractHash', p_contract_hash,
        'formulaHash', p_formula_hash,
        'parameterHash', p_parameter_hash,
        'status', p_status
      )::text,
      'sha256'
    ),
    'hex'
  );
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

  if pg_catalog.jsonb_typeof(p_turn_trace -> 'turnId') <> 'string'
     or pg_catalog.jsonb_typeof(p_turn_trace -> 'userMessageId') <> 'string'
     or pg_catalog.jsonb_typeof(p_turn_trace -> 'assistantMessageId') <> 'string' then
    raise exception 'settlement_ai_turn_trace_invalid';
  end if;
  begin
    v_trace_turn_id := (p_turn_trace ->> 'turnId')::uuid;
    v_trace_user_message_id := (p_turn_trace ->> 'userMessageId')::uuid;
    v_trace_assistant_message_id := (p_turn_trace ->> 'assistantMessageId')::uuid;
  exception
    when invalid_text_representation then
      raise exception 'settlement_ai_turn_trace_invalid';
  end;

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

  -- The conversation lock serializes retries. A matching immutable request may
  -- be replayed after Xingyao supersedes its source assistant message; only a
  -- first insert needs the source turn and messages to remain current.
  select d.*
  into v_existing
  from public.ai_settlement_rule_drafts as d
  where d.organization_id = p_organization_id
    and d.created_by = v_actor_id
    and d.idempotency_key = pg_catalog.btrim(p_idempotency_key)
  for update;
  if found then
    if v_existing.request_fingerprint <> v_request_fingerprint
       or v_existing.project_id <> p_project_id
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

  select trace_turn.*
  into v_trace_turn
  from public.ai_chat_turns as trace_turn
  where trace_turn.id = v_trace_turn_id
    and trace_turn.conversation_id = p_conversation_id
    and trace_turn.organization_id = p_organization_id
    and trace_turn.owner_user_id = v_actor_id
    and trace_turn.user_message_id = v_trace_user_message_id
    and trace_turn.assistant_message_id = v_trace_assistant_message_id
    and trace_turn.status = 'completed'
  for update of trace_turn;
  if not found then
    raise exception 'settlement_ai_turn_trace_scope_mismatch';
  end if;

  perform 1
  from public.ai_chat_messages as user_message
  join public.ai_chat_messages as assistant_message
    on assistant_message.id = v_trace_assistant_message_id
    and assistant_message.conversation_id = user_message.conversation_id
    and assistant_message.organization_id = user_message.organization_id
    and assistant_message.owner_user_id = user_message.owner_user_id
  where user_message.id = v_trace_user_message_id
    and user_message.id = v_trace_turn.user_message_id
    and assistant_message.id = v_trace_turn.assistant_message_id
    and user_message.conversation_id = p_conversation_id
    and user_message.organization_id = p_organization_id
    and user_message.owner_user_id = v_actor_id
    and user_message.role = 'user'
    and assistant_message.role = 'assistant'
    and user_message.status = 'completed'
    and assistant_message.status = 'completed'
    and assistant_message.parent_message_id = user_message.id
    and assistant_message.sequence_no > user_message.sequence_no
    and assistant_message.content = p_ai_response ->> 'content'
  for update of user_message, assistant_message;
  if not found then
    raise exception 'settlement_ai_turn_message_trace_mismatch';
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
    request_fingerprint,
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
    v_request_fingerprint,
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
      ) in (
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
      )
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

-- settlement_ai_validator_self_checks
do $$
declare
  v_project_id uuid := '00000000-0000-4000-8000-000000000001'::uuid;
  v_valid_contract jsonb := $contract$
  {
    "schemaVersion": 1,
    "scope": "receivable",
    "target": {"targetType": "project", "targetId": null},
    "executionGrain": "project_period",
    "compositionMode": "replace",
    "title": "项目应收分成",
    "summary": "计算项目应收金额。",
    "calculationComponents": [
      {
        "name": "grossRevenue",
        "description": "读取项目确认收入",
        "expression": "grossRevenue",
        "resultType": {"kind": "scalar", "scalarType": "money_cents"}
      }
    ],
    "requiredInputs": [
      {
        "name": "grossRevenue",
        "description": "项目确认收入",
        "source": "settlement_report.gross_revenue_cents",
        "valueType": {"kind": "scalar", "scalarType": "money_cents"},
        "userFacingUnit": "元"
      }
    ],
    "parameters": [
      {
        "name": "minimumAmount",
        "description": "最低应收金额",
        "valueType": {"kind": "scalar", "scalarType": "money_cents"},
        "userFacingUnit": "元",
        "defaultValue": {"type": "money_cents", "amountCents": 0}
      }
    ],
    "effectiveStartAt": "2026-07-01T00:00:00+08:00",
    "effectiveEndAt": null,
    "missingDataPolicy": {"action": "route_item_to_review"},
    "compositionDescription": "替换项目周期的基础应收金额",
    "businessTimezone": "Asia/Shanghai",
    "examples": [
      {
        "name": "标准项目应收",
        "kind": "normal",
        "description": "标准收入场景",
        "inputs": {
          "grossRevenue": {"type": "money_cents", "amountCents": 10000}
        },
        "expectedResult": {"type": "money_cents", "amountCents": 10000}
      },
      {
        "name": "零收入边界",
        "kind": "boundary",
        "description": "零收入场景",
        "inputs": {
          "grossRevenue": {"type": "money_cents", "amountCents": 0}
        },
        "expectedResult": {"type": "money_cents", "amountCents": 0}
      },
      {
        "name": "最小金额边界",
        "kind": "boundary",
        "description": "最小货币单位",
        "inputs": {
          "grossRevenue": {"type": "money_cents", "amountCents": 1}
        },
        "expectedResult": {"type": "money_cents", "amountCents": 1}
      }
    ]
  }
  $contract$::jsonb;
  v_valid_sample_source jsonb := '{"kind":"historical_settlements"}'::jsonb;
  v_valid_sample_selection jsonb := $selection$
  {
    "periodStart": "2026-06-01",
    "periodEnd": "2026-06-30",
    "populationCount": 100,
    "sampledCount": 20,
    "criteria": ["confirmed", "locked"]
  }
  $selection$::jsonb;
  v_valid_coverage jsonb := '{"totalRecords":20,"evaluatedRecords":18,"skippedRecords":2}'::jsonb;
  v_valid_scenarios jsonb := '[{"name":"标准场景","kind":"normal","result":"passed"}]'::jsonb;
  v_valid_historical_totals jsonb := '{"payableAmountCents":"9007199254740993","receivableAmountCents":null,"recordCount":20}'::jsonb;
  v_valid_deltas jsonb := '{"payableAmountCents":"1000","receivableAmountCents":"0","percentageBps":125}'::jsonb;
  v_valid_largest_changes jsonb := '[{"dimension":"rule_component","key":"grossRevenue","deltaAmountCents":"1000","direction":"increase"}]'::jsonb;
  v_valid_warnings jsonb := '[]'::jsonb;
  v_actor_id uuid := '10000000-0000-4000-8000-000000000001'::uuid;
  v_organization_id uuid := '20000000-0000-4000-8000-000000000001'::uuid;
  v_fixture_project_id uuid := '30000000-0000-4000-8000-000000000001'::uuid;
  v_conversation_id uuid := '40000000-0000-4000-8000-000000000001'::uuid;
  v_other_conversation_id uuid := '40000000-0000-4000-8000-000000000002'::uuid;
  v_user_message_id uuid := '50000000-0000-4000-8000-000000000001'::uuid;
  v_assistant_message_id uuid := '50000000-0000-4000-8000-000000000002'::uuid;
  v_turn_id uuid := '60000000-0000-4000-8000-000000000001'::uuid;
  v_turn_trace jsonb;
  v_valid_ambiguities jsonb := '[{"code":"confirm_rate","question":"请确认分成比例。","required":true}]'::jsonb;
  v_valid_ai_response jsonb := '{"content":"\n已生成结算规则。\n","finishReason":"stop","providerRequestId":null}'::jsonb;
  v_valid_generated_formula jsonb := '{"expression":"grossRevenue","normalizedAst":{"kind":"identifier","name":"grossRevenue"}}'::jsonb;
  v_valid_generated_tests jsonb := '[{"name":"标准场景","inputs":{"grossRevenue":{"type":"money_cents","amountCents":10000}},"expectedResult":{"type":"money_cents","amountCents":10000}}]'::jsonb;
  v_valid_safety_flags jsonb := '[{"code":"manual_review","severity":"info","message":"需人工复核。"}]'::jsonb;
  v_draft_one jsonb;
  v_draft_two jsonb;
  v_draft_replay jsonb;
  v_simulation jsonb;
  v_constraint_name text;
begin
  v_turn_trace := pg_catalog.jsonb_build_object(
    'turnId', v_turn_id,
    'userMessageId', v_user_message_id,
    'assistantMessageId', v_assistant_message_id
  );
  if not public.settlement_ai_business_contract_is_valid(v_valid_contract) then
    raise exception 'valid_contract_rejected';
  end if;
  if public.settlement_ai_business_contract_is_valid(
    v_valid_contract || '{"extra":true}'::jsonb
  ) then
    raise exception 'invalid_contract_extra_key';
  end if;
  if public.settlement_ai_business_contract_is_valid(
    pg_catalog.jsonb_set(
      v_valid_contract,
      '{calculationComponents}',
      '[]'::jsonb
    )
  ) then
    raise exception 'invalid_contract_empty_components';
  end if;
  if public.settlement_ai_business_contract_is_valid(
    pg_catalog.jsonb_set(
      v_valid_contract,
      '{examples}',
      '[]'::jsonb
    )
  ) then
    raise exception 'invalid_contract_empty_examples';
  end if;
  if public.settlement_ai_business_contract_is_valid(
    pg_catalog.jsonb_set(
      v_valid_contract,
      '{target}',
      '{"targetType":"streamer_group","targetId":"group-1"}'::jsonb
    )
  ) then
    raise exception 'invalid_contract_target_scope';
  end if;
  if public.settlement_ai_business_contract_is_valid(
    pg_catalog.jsonb_set(
      v_valid_contract,
      '{businessTimezone}',
      '"Mars/Olympus"'::jsonb
    )
  ) then
    raise exception 'invalid_contract_timezone';
  end if;
  if public.settlement_ai_business_contract_is_valid(
    pg_catalog.jsonb_set(
      v_valid_contract,
      '{effectiveStartAt}',
      '"2026-07-01T24:00:00+08:00"'::jsonb
    )
  ) then
    raise exception 'invalid_contract_hour_24';
  end if;
  if public.settlement_ai_business_contract_is_valid(
    pg_catalog.jsonb_set(
      v_valid_contract,
      '{effectiveStartAt}',
      '"2026-02-30T00:00:00+08:00"'::jsonb
    )
  ) then
    raise exception 'invalid_contract_feb_30';
  end if;
  if not public.settlement_ai_draft_payload_is_valid(
    v_turn_trace,
    v_valid_contract,
    v_valid_ambiguities,
    v_valid_ai_response,
    v_valid_generated_formula,
    v_valid_generated_tests,
    v_valid_safety_flags
  ) then
    raise exception 'valid_draft_payload_rejected';
  end if;
  if public.settlement_ai_unresolved_ambiguities_is_valid(
    '[{"code":7,"question":"请确认。","required":true}]'::jsonb
  ) then
    raise exception 'invalid_ambiguity_code_type';
  end if;
  if public.settlement_ai_unresolved_ambiguities_is_valid(
    '[{"code":"confirm","question":7,"required":true}]'::jsonb
  ) then
    raise exception 'invalid_ambiguity_question_type';
  end if;
  if public.settlement_ai_unresolved_ambiguities_is_valid(
    '[{"code":"confirm","question":"请确认。","required":"true"}]'::jsonb
  ) then
    raise exception 'invalid_ambiguity_required_type';
  end if;
  if public.settlement_ai_response_is_valid(
    '{"content":7,"finishReason":"stop","providerRequestId":null}'::jsonb
  ) then
    raise exception 'invalid_ai_response_content_type';
  end if;
  if public.settlement_ai_generated_formula_is_valid(
    '{"expression":"x","normalizedAst":{"kind":"literal","value":1e400}}'::jsonb
  ) then
    raise exception 'invalid_generated_formula_ast';
  end if;
  if public.settlement_ai_generated_test_cases_is_valid(
    '[{"name":"坏场景","inputs":{},"expectedResult":{"type":"money_cents","amountCents":1.5}}]'::jsonb
  ) then
    raise exception 'invalid_generated_test_case_value';
  end if;
  if public.settlement_ai_safety_flags_is_valid(
    '[{"code":"review","severity":"critical","message":"复核"}]'::jsonb
  ) then
    raise exception 'invalid_safety_flag_severity';
  end if;
  if public.settlement_ai_json_within_budget(
    pg_catalog.jsonb_build_object(
      'code', 'large_warning',
      'severity', 'warning',
      'message', pg_catalog.repeat(' ', 1048576) || 'x'
    )
  ) then
    raise exception 'oversized_json_budget_accepted';
  end if;

  if exists (
    select 1
    from public.ai_chat_turns as trace_turn
    join public.ai_conversations as trace_conversation
      on trace_conversation.id = trace_turn.conversation_id
      and trace_conversation.organization_id = trace_turn.organization_id
      and trace_conversation.owner_user_id = trace_turn.owner_user_id
    join public.ai_chat_messages as user_message
      on user_message.id = trace_turn.user_message_id
      and user_message.conversation_id = trace_turn.conversation_id
      and user_message.organization_id = trace_turn.organization_id
      and user_message.owner_user_id = trace_turn.owner_user_id
    join public.ai_chat_messages as assistant_message
      on assistant_message.id = trace_turn.assistant_message_id
      and assistant_message.conversation_id = user_message.conversation_id
      and assistant_message.organization_id = user_message.organization_id
      and assistant_message.owner_user_id = user_message.owner_user_id
    where trace_turn.id = '00000000-0000-4000-8000-000000000099'::uuid
      and trace_conversation.id =
        '00000000-0000-4000-8000-000000000098'::uuid
      and trace_turn.status = 'completed'
      and user_message.role = 'user'
      and assistant_message.role = 'assistant'
      and user_message.status = 'completed'
      and assistant_message.status = 'completed'
      and assistant_message.parent_message_id = user_message.id
      and assistant_message.sequence_no > user_message.sequence_no
  ) then
    raise exception 'invalid_trace_accepted';
  end if;

  if not public.settlement_ai_simulation_summary_is_valid(
    v_project_id,
    v_valid_sample_source,
    v_valid_sample_selection,
    v_valid_coverage,
    v_valid_scenarios,
    v_valid_historical_totals,
    v_valid_deltas,
    v_valid_largest_changes,
    v_valid_warnings
  ) then
    raise exception 'valid_simulation_summary_rejected';
  end if;
  if public.settlement_ai_simulation_summary_is_valid(
    v_project_id,
    v_valid_sample_source,
    pg_catalog.jsonb_set(
      v_valid_sample_selection,
      '{criteria}',
      '[{"name":"confirmed"}]'::jsonb
    ),
    v_valid_coverage,
    v_valid_scenarios,
    v_valid_historical_totals,
    v_valid_deltas,
    v_valid_largest_changes,
    v_valid_warnings
  ) then
    raise exception 'invalid_selection_criteria_object';
  end if;
  if public.settlement_ai_simulation_summary_is_valid(
    v_project_id,
    v_valid_sample_source,
    v_valid_sample_selection || '{"rawRows":[]}'::jsonb,
    v_valid_coverage,
    v_valid_scenarios,
    v_valid_historical_totals,
    v_valid_deltas,
    v_valid_largest_changes,
    v_valid_warnings
  ) then
    raise exception 'invalid_selection_raw_rows';
  end if;
  if public.settlement_ai_simulation_summary_is_valid(
    v_project_id,
    v_valid_sample_source,
    v_valid_sample_selection || '{"projectId":"00000000-0000-4000-8000-000000000002"}'::jsonb,
    v_valid_coverage,
    v_valid_scenarios,
    v_valid_historical_totals,
    v_valid_deltas,
    v_valid_largest_changes,
    v_valid_warnings
  ) then
    raise exception 'invalid_selection_project_id';
  end if;
  if public.settlement_ai_simulation_summary_is_valid(
    v_project_id,
    v_valid_sample_source,
    pg_catalog.jsonb_set(
      v_valid_sample_selection,
      '{criteria}',
      '["amountCents=1"]'::jsonb
    ),
    v_valid_coverage,
    v_valid_scenarios,
    v_valid_historical_totals,
    v_valid_deltas,
    v_valid_largest_changes,
    v_valid_warnings
  ) then
    raise exception 'invalid_selection_amount_cents';
  end if;

  begin
    insert into auth.users (id, email)
    values (v_actor_id, 'task6-settlement-ai-selfcheck@example.invalid');

    insert into public.profiles (id, email, full_name)
    values (
      v_actor_id,
      'task6-settlement-ai-selfcheck@example.invalid',
      'Task6 Settlement AI Selfcheck'
    );

    insert into public.organizations (id, name, code)
    values (
      v_organization_id,
      'Task6 Settlement AI Selfcheck',
      'task6-settlement-ai-selfcheck'
    );

    insert into public.organization_members (
      organization_id,
      user_id,
      role,
      status
    ) values (
      v_organization_id,
      v_actor_id,
      'owner',
      'active'
    );

    insert into public.projects (
      id,
      organization_id,
      code,
      name,
      created_by,
      owner_id
    ) values (
      v_fixture_project_id,
      v_organization_id,
      'task6-settlement-ai-selfcheck',
      'Task6 Settlement AI Selfcheck',
      v_actor_id,
      v_actor_id
    );

    insert into public.ai_conversations (
      id,
      organization_id,
      owner_user_id,
      project_id,
      title
    ) values
      (
        v_conversation_id,
        v_organization_id,
        v_actor_id,
        v_fixture_project_id,
        'Task6 合法会话'
      ),
      (
        v_other_conversation_id,
        v_organization_id,
        v_actor_id,
        v_fixture_project_id,
        'Task6 跨会话攻击目标'
      );

    insert into public.ai_chat_messages (
      id,
      organization_id,
      owner_user_id,
      conversation_id,
      sequence_no,
      role,
      status,
      content,
      parent_message_id
    ) values
      (
        v_user_message_id,
        v_organization_id,
        v_actor_id,
        v_conversation_id,
        1,
        'user',
        'completed',
        '请生成项目结算规则。',
        null
      ),
      (
        v_assistant_message_id,
        v_organization_id,
        v_actor_id,
        v_conversation_id,
        2,
        'assistant',
        'completed',
        v_valid_ai_response ->> 'content',
        v_user_message_id
      );

    insert into public.ai_chat_turns (
      id,
      organization_id,
      owner_user_id,
      conversation_id,
      user_message_id,
      assistant_message_id,
      status,
      idempotency_key,
      completed_at
    ) values (
      v_turn_id,
      v_organization_id,
      v_actor_id,
      v_conversation_id,
      v_user_message_id,
      v_assistant_message_id,
      'completed',
      'task6-settlement-ai-turn',
      pg_catalog.clock_timestamp()
    );

    perform pg_catalog.set_config(
      'request.jwt.claim.sub',
      v_actor_id::text,
      true
    );
    if auth.uid() is distinct from v_actor_id then
      raise exception 'actual_rpc_auth_context_invalid';
    end if;

    v_draft_one := public.create_ai_settlement_rule_draft(
      v_organization_id,
      v_fixture_project_id,
      v_conversation_id,
      'task6-settlement-ai-draft-1',
      '请按项目收入生成结算规则。',
      v_turn_trace,
      v_valid_contract,
      v_valid_ambiguities,
      pg_catalog.repeat('a', 64),
      v_valid_ai_response,
      v_valid_generated_formula,
      '按项目确认收入计算。',
      v_valid_generated_tests,
      'fixture-model',
      v_valid_safety_flags,
      pg_catalog.repeat('b', 64),
      pg_catalog.repeat('c', 64),
      pg_catalog.repeat('d', 64),
      'clarifying'
    );
    if not public.settlement_ai_json_has_exact_keys(
         v_draft_one,
         array[
           'id',
           'organization_id',
           'project_id',
           'conversation_id',
           'prompt_text',
           'turn_trace',
           'business_contract',
           'unresolved_ambiguities',
           'variable_catalog_version',
           'ai_response',
           'generated_formula',
           'generated_explanation',
           'generated_test_cases',
           'model',
           'safety_flags',
           'contract_hash',
           'formula_hash',
           'parameter_hash',
           'status',
           'revision_number',
           'idempotency_key',
           'request_fingerprint',
           'created_by',
           'created_at',
           'supersedes_draft_id',
           'superseded_by_draft_id',
           'superseded_at',
           'duplicate'
         ]::text[]
       )
       or v_draft_one ->> 'revision_number' <> '1'
       or v_draft_one ->> 'request_fingerprint' !~ '^[0-9a-f]{64}$'
       or pg_catalog.jsonb_typeof(v_draft_one -> 'duplicate') <> 'boolean'
       or (v_draft_one ->> 'duplicate')::boolean
       or not public.settlement_ai_draft_payload_is_valid(
         v_draft_one -> 'turn_trace',
         v_draft_one -> 'business_contract',
         v_draft_one -> 'unresolved_ambiguities',
         v_draft_one -> 'ai_response',
         v_draft_one -> 'generated_formula',
         v_draft_one -> 'generated_test_cases',
         v_draft_one -> 'safety_flags'
    ) then
      raise exception 'actual_draft_shape_invalid';
    end if;

    update public.ai_chat_messages
    set status = 'superseded'
    where id = v_assistant_message_id;

    v_draft_replay := public.create_ai_settlement_rule_draft(
      v_organization_id,
      v_fixture_project_id,
      v_conversation_id,
      'task6-settlement-ai-draft-1',
      '请按项目收入生成结算规则。',
      v_turn_trace,
      v_valid_contract,
      v_valid_ambiguities,
      pg_catalog.repeat('a', 64),
      v_valid_ai_response,
      v_valid_generated_formula,
      '按项目确认收入计算。',
      v_valid_generated_tests,
      'fixture-model',
      v_valid_safety_flags,
      pg_catalog.repeat('b', 64),
      pg_catalog.repeat('c', 64),
      pg_catalog.repeat('d', 64),
      'clarifying'
    );
    if not (v_draft_replay ->> 'duplicate')::boolean
       or v_draft_replay ->> 'id' <> v_draft_one ->> 'id'
       or v_draft_replay ->> 'request_fingerprint'
         <> v_draft_one ->> 'request_fingerprint' then
      raise exception 'idempotent_superseded_message_replay_invalid';
    end if;

    begin
      perform public.create_ai_settlement_rule_draft(
        v_organization_id,
        v_fixture_project_id,
        v_conversation_id,
        'task6-settlement-ai-draft-1',
        '请按项目收入生成结算规则。',
        v_turn_trace,
        v_valid_contract,
        v_valid_ambiguities,
        pg_catalog.repeat('a', 64),
        v_valid_ai_response,
        v_valid_generated_formula,
        '按项目确认收入计算。',
        v_valid_generated_tests,
        'fixture-model',
        v_valid_safety_flags,
        pg_catalog.repeat('b', 64),
        pg_catalog.repeat('c', 64),
        pg_catalog.repeat('d', 64),
        'failed'
      );
      raise exception 'idempotency_status_conflict_missing';
    exception
      when others then
        if sqlerrm = 'idempotency_status_conflict_missing' then raise; end if;
        if sqlerrm <> 'settlement_ai_draft_idempotency_conflict' then
          raise exception 'idempotency_status_conflict_unexpected: %', sqlerrm;
        end if;
    end;

    update public.ai_chat_messages
    set status = 'completed'
    where id = v_assistant_message_id;

    begin
      perform public.create_ai_settlement_rule_draft(
        v_organization_id,
        v_fixture_project_id,
        v_conversation_id,
        'task6-settlement-ai-malformed-ambiguity',
        '请按项目收入生成结算规则。',
        v_turn_trace,
        v_valid_contract,
        '[{"code":"confirm","question":"请确认。","required":"true"}]'::jsonb,
        pg_catalog.repeat('a', 64),
        v_valid_ai_response,
        v_valid_generated_formula,
        '按项目确认收入计算。',
        v_valid_generated_tests,
        'fixture-model',
        v_valid_safety_flags,
        pg_catalog.repeat('b', 64),
        pg_catalog.repeat('c', 64),
        pg_catalog.repeat('d', 64),
        'contract_ready'
      );
      raise exception 'malformed_ambiguity_rpc_accepted';
    exception
      when others then
        if sqlerrm = 'malformed_ambiguity_rpc_accepted' then raise; end if;
        if sqlerrm <> 'settlement_ai_draft_payload_invalid' then
          raise exception 'malformed_ambiguity_rpc_unexpected: %', sqlerrm;
        end if;
    end;

    begin
      perform public.create_ai_settlement_rule_draft(
        v_organization_id,
        v_fixture_project_id,
        v_conversation_id,
        'task6-settlement-ai-invalid-datetime',
        '请按项目收入生成结算规则。',
        v_turn_trace,
        pg_catalog.jsonb_set(
          v_valid_contract,
          '{effectiveStartAt}',
          '"2026-07-01T24:00:00+08:00"'::jsonb
        ),
        v_valid_ambiguities,
        pg_catalog.repeat('a', 64),
        v_valid_ai_response,
        v_valid_generated_formula,
        '按项目确认收入计算。',
        v_valid_generated_tests,
        'fixture-model',
        v_valid_safety_flags,
        pg_catalog.repeat('b', 64),
        pg_catalog.repeat('c', 64),
        pg_catalog.repeat('d', 64),
        'contract_ready'
      );
      raise exception 'invalid_datetime_rpc_accepted';
    exception
      when others then
        if sqlerrm = 'invalid_datetime_rpc_accepted' then raise; end if;
        if sqlerrm <> 'settlement_ai_draft_payload_invalid' then
          raise exception 'invalid_datetime_rpc_unexpected: %', sqlerrm;
        end if;
    end;

    begin
      perform public.create_ai_settlement_rule_draft(
        v_organization_id,
        v_fixture_project_id,
        v_other_conversation_id,
        'task6-settlement-ai-forged-trace',
        '请按项目收入生成结算规则。',
        v_turn_trace,
        v_valid_contract,
        v_valid_ambiguities,
        pg_catalog.repeat('a', 64),
        v_valid_ai_response,
        v_valid_generated_formula,
        '按项目确认收入计算。',
        v_valid_generated_tests,
        'fixture-model',
        v_valid_safety_flags,
        pg_catalog.repeat('b', 64),
        pg_catalog.repeat('c', 64),
        pg_catalog.repeat('d', 64),
        'contract_ready'
      );
      raise exception 'forged_trace_rpc_accepted';
    exception
      when others then
        if sqlerrm = 'forged_trace_rpc_accepted' then raise; end if;
        if sqlerrm <> 'settlement_ai_turn_trace_scope_mismatch' then
          raise exception 'forged_trace_rpc_unexpected: %', sqlerrm;
        end if;
    end;

    v_draft_two := public.create_ai_settlement_rule_draft(
      v_organization_id,
      v_fixture_project_id,
      v_conversation_id,
      'task6-settlement-ai-draft-2',
      '请按项目收入生成结算规则。',
      v_turn_trace,
      v_valid_contract,
      v_valid_ambiguities,
      pg_catalog.repeat('a', 64),
      v_valid_ai_response,
      v_valid_generated_formula,
      '按项目确认收入计算。',
      v_valid_generated_tests,
      'fixture-model',
      v_valid_safety_flags,
      pg_catalog.repeat('b', 64),
      pg_catalog.repeat('c', 64),
      pg_catalog.repeat('d', 64),
      'contract_ready'
    );
    if v_draft_two ->> 'revision_number' <> '2'
       or (v_draft_two ->> 'supersedes_draft_id')::uuid
         <> (v_draft_one ->> 'id')::uuid
       or not exists (
         select 1
         from public.ai_settlement_rule_drafts as revision
         where revision.conversation_id = v_conversation_id
         group by revision.conversation_id
         having pg_catalog.count(*) = 2
           and pg_catalog.min(revision.revision_number) = 1
           and pg_catalog.max(revision.revision_number) = 2
       ) then
      raise exception 'actual_revision_sequence_invalid';
    end if;

    begin
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
        request_fingerprint,
        created_by,
        supersedes_draft_id
      )
      select
        draft.organization_id,
        draft.project_id,
        draft.conversation_id,
        draft.prompt_text,
        draft.turn_trace,
        draft.business_contract,
        '[{"code":7,"question":"请确认。","required":true}]'::jsonb,
        draft.variable_catalog_version,
        draft.ai_response,
        draft.generated_formula,
        draft.generated_explanation,
        draft.generated_test_cases,
        draft.model,
        draft.safety_flags,
        draft.contract_hash,
        draft.formula_hash,
        draft.parameter_hash,
        'contract_ready',
        3,
        'task6-settlement-ai-direct-invalid',
        draft.request_fingerprint,
        draft.created_by,
        draft.id
      from public.ai_settlement_rule_drafts as draft
      where draft.id = (v_draft_two ->> 'id')::uuid;
      raise exception 'malformed_service_insert_accepted';
    exception
      when check_violation then
        get stacked diagnostics v_constraint_name = constraint_name;
        if v_constraint_name <>
           'ai_settlement_rule_drafts_payload_valid' then
          raise exception 'malformed_service_insert_wrong_check: %',
            v_constraint_name;
        end if;
    end;

    begin
      perform public.create_settlement_formula_simulation(
        v_organization_id,
        v_fixture_project_id,
        '70000000-0000-4000-8000-000000000001'::uuid,
        null,
        'task6-settlement-ai-rule-version-owner',
        pg_catalog.repeat('c', 64),
        pg_catalog.repeat('b', 64),
        pg_catalog.repeat('d', 64),
        pg_catalog.repeat('a', 64),
        pg_catalog.repeat('e', 64),
        v_valid_sample_source,
        v_valid_sample_selection,
        v_valid_coverage,
        v_valid_scenarios,
        v_valid_historical_totals,
        v_valid_deltas,
        v_valid_largest_changes,
        v_valid_warnings
      );
      raise exception 'phase1_rule_version_rpc_accepted';
    exception
      when others then
        if sqlerrm = 'phase1_rule_version_rpc_accepted' then raise; end if;
        if sqlerrm <>
           'settlement_ai_rule_version_owner_phase1_unsupported' then
          raise exception 'phase1_rule_version_rpc_unexpected: %', sqlerrm;
        end if;
    end;

    v_simulation := public.create_settlement_formula_simulation(
      v_organization_id,
      v_fixture_project_id,
      null,
      (v_draft_two ->> 'id')::uuid,
      'task6-settlement-ai-simulation-1',
      pg_catalog.repeat('c', 64),
      pg_catalog.repeat('b', 64),
      pg_catalog.repeat('d', 64),
      pg_catalog.repeat('a', 64),
      pg_catalog.repeat('e', 64),
      v_valid_sample_source,
      v_valid_sample_selection,
      v_valid_coverage,
      v_valid_scenarios,
      v_valid_historical_totals,
      v_valid_deltas,
      v_valid_largest_changes,
      v_valid_warnings
    );
    if not public.settlement_ai_json_has_exact_keys(
         v_simulation,
         array[
           'id',
           'organization_id',
           'project_id',
           'rule_version_id',
           'ai_draft_id',
           'formula_hash',
           'rule_contract_hash',
           'parameter_hash',
           'variable_catalog_version',
           'data_selection_hash',
           'sample_source',
           'sample_selection',
           'coverage',
           'scenarios',
           'historical_totals',
           'deltas',
           'largest_changes',
           'warnings',
           'idempotency_key',
           'created_by',
           'created_at',
           'duplicate'
         ]::text[]
       )
       or pg_catalog.jsonb_typeof(v_simulation -> 'rule_version_id') <> 'null'
       or (v_simulation ->> 'ai_draft_id')::uuid
         <> (v_draft_two ->> 'id')::uuid
       or (v_simulation ->> 'duplicate')::boolean then
      raise exception 'actual_simulation_shape_invalid';
    end if;

    v_draft_replay := public.create_ai_settlement_rule_draft(
      v_organization_id,
      v_fixture_project_id,
      v_conversation_id,
      'task6-settlement-ai-draft-2',
      '请按项目收入生成结算规则。',
      v_turn_trace,
      v_valid_contract,
      v_valid_ambiguities,
      pg_catalog.repeat('a', 64),
      v_valid_ai_response,
      v_valid_generated_formula,
      '按项目确认收入计算。',
      v_valid_generated_tests,
      'fixture-model',
      v_valid_safety_flags,
      pg_catalog.repeat('b', 64),
      pg_catalog.repeat('c', 64),
      pg_catalog.repeat('d', 64),
      'contract_ready'
    );
    if not (v_draft_replay ->> 'duplicate')::boolean
       or v_draft_replay ->> 'status' <> 'simulated'
       or v_draft_replay ->> 'revision_number' <> '2'
       or v_draft_replay ->> 'request_fingerprint'
         <> v_draft_two ->> 'request_fingerprint' then
      raise exception 'idempotent_lifecycle_replay_invalid';
    end if;

    begin
      perform public.create_settlement_formula_simulation(
        v_organization_id,
        v_fixture_project_id,
        null,
        (v_draft_two ->> 'id')::uuid,
        'task6-settlement-ai-simulation-large-warning',
        pg_catalog.repeat('c', 64),
        pg_catalog.repeat('b', 64),
        pg_catalog.repeat('d', 64),
        pg_catalog.repeat('a', 64),
        pg_catalog.repeat('e', 64),
        v_valid_sample_source,
        v_valid_sample_selection,
        v_valid_coverage,
        v_valid_scenarios,
        v_valid_historical_totals,
        v_valid_deltas,
        v_valid_largest_changes,
        pg_catalog.jsonb_build_array(
          pg_catalog.jsonb_build_object(
            'code', 'large_warning',
            'severity', 'warning',
            'message', pg_catalog.repeat(' ', 1048576) || 'x'
          )
        )
      );
      raise exception 'oversized_warning_rpc_accepted';
    exception
      when others then
        if sqlerrm = 'oversized_warning_rpc_accepted' then raise; end if;
        if sqlerrm <> 'settlement_ai_simulation_summary_invalid' then
          raise exception 'oversized_warning_rpc_unexpected: %', sqlerrm;
        end if;
    end;

    begin
      perform public.create_settlement_formula_simulation(
        v_organization_id,
        v_fixture_project_id,
        null,
        (v_draft_two ->> 'id')::uuid,
        'task6-settlement-ai-simulation-forbidden-key',
        pg_catalog.repeat('c', 64),
        pg_catalog.repeat('b', 64),
        pg_catalog.repeat('d', 64),
        pg_catalog.repeat('a', 64),
        pg_catalog.repeat('e', 64),
        v_valid_sample_source,
        v_valid_sample_selection,
        v_valid_coverage,
        v_valid_scenarios,
        v_valid_historical_totals,
        v_valid_deltas,
        '[{"dimension":"rule_component","key":"project_id","deltaAmountCents":"100","direction":"increase"}]'::jsonb,
        v_valid_warnings
      );
      raise exception 'forbidden_largest_change_rpc_accepted';
    exception
      when others then
        if sqlerrm = 'forbidden_largest_change_rpc_accepted' then raise; end if;
        if sqlerrm <> 'settlement_ai_simulation_summary_invalid' then
          raise exception 'forbidden_largest_change_rpc_unexpected: %', sqlerrm;
        end if;
    end;

    begin
      perform public.create_settlement_formula_simulation(
        v_organization_id,
        v_fixture_project_id,
        null,
        (v_draft_two ->> 'id')::uuid,
        'task6-settlement-ai-simulation-raw-criteria',
        pg_catalog.repeat('c', 64),
        pg_catalog.repeat('b', 64),
        pg_catalog.repeat('d', 64),
        pg_catalog.repeat('a', 64),
        pg_catalog.repeat('e', 64),
        v_valid_sample_source,
        pg_catalog.jsonb_set(
          v_valid_sample_selection,
          '{criteria}',
          '[{"name":"confirmed"}]'::jsonb
        ),
        v_valid_coverage,
        v_valid_scenarios,
        v_valid_historical_totals,
        v_valid_deltas,
        v_valid_largest_changes,
        v_valid_warnings
      );
      raise exception 'raw_criteria_rpc_accepted';
    exception
      when others then
        if sqlerrm = 'raw_criteria_rpc_accepted' then raise; end if;
        if sqlerrm <> 'settlement_ai_simulation_summary_invalid' then
          raise exception 'raw_criteria_rpc_unexpected: %', sqlerrm;
        end if;
    end;

    raise exception 'settlement_ai_rpc_fixture_rollback';
  exception
    when others then
      if sqlerrm <> 'settlement_ai_rpc_fixture_rollback' then
        raise;
      end if;
  end;

  if exists (
       select 1 from auth.users where id = v_actor_id
     )
     or exists (
       select 1
       from public.organizations
       where id = v_organization_id
     )
     or exists (
       select 1
       from public.projects
       where id = v_fixture_project_id
     )
     or exists (
       select 1
       from public.ai_conversations
       where id in (v_conversation_id, v_other_conversation_id)
     )
     or exists (
       select 1
       from public.ai_settlement_rule_drafts
       where organization_id = v_organization_id
     )
     or exists (
       select 1
       from public.settlement_formula_simulations
       where organization_id = v_organization_id
     ) then
    raise exception 'settlement_ai_rpc_fixture_cleanup_failed';
  end if;
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
revoke all on function public.settlement_ai_json_within_budget(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.settlement_ai_decimal_is_bigint(jsonb, boolean)
  from public, anon, authenticated, service_role;
revoke all on function public.settlement_ai_json_is_safe(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.settlement_ai_identifier_is_valid(text)
  from public, anon, authenticated, service_role;
revoke all on function public.settlement_ai_plain_identifier_is_valid(text)
  from public, anon, authenticated, service_role;
revoke all on function public.settlement_ai_uuid_text_is_valid(text)
  from public, anon, authenticated, service_role;
revoke all on function public.settlement_ai_offset_datetime_is_valid(text)
  from public, anon, authenticated, service_role;
revoke all on function public.settlement_ai_business_date_is_valid(text)
  from public, anon, authenticated, service_role;
revoke all on function public.settlement_ai_safe_integer_json(jsonb, boolean)
  from public, anon, authenticated, service_role;
revoke all on function public.settlement_ai_finite_number_json(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.settlement_ai_runtime_type_is_valid(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.settlement_ai_typed_value_is_valid(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.settlement_ai_runtime_value_matches_type(jsonb, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.settlement_ai_turn_trace_json_is_valid(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.settlement_ai_unresolved_ambiguities_is_valid(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.settlement_ai_response_is_valid(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.settlement_ai_normalized_ast_is_valid(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.settlement_ai_generated_formula_is_valid(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.settlement_ai_generated_test_cases_is_valid(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.settlement_ai_safety_flags_is_valid(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.settlement_ai_business_contract_is_valid(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.settlement_ai_draft_payload_is_valid(
  jsonb,
  jsonb,
  jsonb,
  jsonb,
  jsonb,
  jsonb,
  jsonb
) from public, anon, authenticated, service_role;
revoke all on function public.settlement_ai_simulation_json_is_safe(jsonb)
  from public, anon, authenticated, service_role;
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
