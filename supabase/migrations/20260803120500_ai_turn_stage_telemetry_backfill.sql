-- deploy: expand

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

do $$
declare
  v_batch_count integer;
begin
  loop
    with backfill_batch as materialized (
      select historical_turn.id
      from public.ai_chat_turns historical_turn
      where historical_turn.accepted_at is null
      order by historical_turn.created_at, historical_turn.id
      limit 500
      for update skip locked
    )
    update public.ai_chat_turns backfill_turn
    set accepted_at = backfill_turn.created_at
    from backfill_batch
    where backfill_turn.id = backfill_batch.id
      and backfill_turn.accepted_at is null;

    get diagnostics v_batch_count = row_count;
    exit when v_batch_count = 0;
  end loop;
end
$$;

alter table public.ai_chat_turns
  validate constraint ai_chat_turns_session_action_check;
