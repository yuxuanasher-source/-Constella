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

create trigger zz_ai_chat_turns_preserve_updated_at_for_telemetry
before update of
  accepted_at,
  context_ready_at,
  session_ready_at,
  agent_ready_at,
  first_delta_at,
  terminal_at,
  persisted_at,
  session_action
on public.ai_chat_turns
for each row execute function public.preserve_ai_chat_turn_updated_at_for_telemetry();

-- scripts/deploy.sh backfills accepted_at in separately committed batches,
-- then validates ai_chat_turns_session_action_check before release activation.
