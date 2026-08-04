-- deploy: expand

do $deploy_control_guard$
begin
  if to_regclass('deploy_internal.schema_migrations') is not null
    and current_setting('jingying.deploy_control_capability', true)
      is distinct from 'ai-turn-telemetry-batched-backfill-v1'
  then
    raise exception
      'deploy_control_upgrade_required: install reviewed protected control before 20260803120500';
  end if;
end
$deploy_control_guard$;

drop trigger if exists zz_ai_chat_turns_preserve_updated_at_for_telemetry
  on public.ai_chat_turns;

drop function if exists public.preserve_ai_chat_turn_updated_at_for_telemetry();

drop trigger if exists ai_chat_turns_touch_updated_at
  on public.ai_chat_turns;

do $ai_chat_turn_touch_trigger$
declare
  v_business_columns text;
begin
  select string_agg(
    format('%I', attribute.attname),
    ', ' order by attribute.attnum
  )
  into v_business_columns
  from pg_catalog.pg_attribute attribute
  where attribute.attrelid = 'public.ai_chat_turns'::pg_catalog.regclass
    and attribute.attnum > 0
    and not attribute.attisdropped
    and attribute.attgenerated = ''
    and attribute.attname not in (
      'accepted_at',
      'context_ready_at',
      'session_ready_at',
      'agent_ready_at',
      'first_delta_at',
      'terminal_at',
      'persisted_at',
      'session_action'
    );

  if v_business_columns is null then
    raise exception 'ai_chat_turns_business_columns_required';
  end if;

  execute format(
    'create trigger ai_chat_turns_touch_updated_at before update of %s on public.ai_chat_turns for each row execute function public.touch_updated_at()',
    v_business_columns
  );
end
$ai_chat_turn_touch_trigger$;

-- scripts/deploy.sh backfills accepted_at in separately committed batches,
-- then validates ai_chat_turns_session_action_check before release activation.
