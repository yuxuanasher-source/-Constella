-- Bind every settlement AI draft insert to an authorized claimed session.

drop trigger if exists ai_settlement_rule_drafts_authoring_guard
on public.ai_settlement_rule_drafts;

create or replace function public.guard_custom_settlement_ai_draft_authoring()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor_id uuid := auth.uid();
begin
  if v_actor_id is null then
    raise exception 'settlement_ai_authoring_authentication_required';
  end if;

  if new.created_by is distinct from v_actor_id then
    raise exception 'settlement_ai_authoring_actor_mismatch';
  end if;

  if public.current_user_role(new.organization_id) is null
     or public.current_user_role(new.organization_id) not in (
       'owner',
       'ops_manager',
       'operator_business'
     ) then
    raise exception 'settlement_ai_authoring_role_denied';
  end if;

  perform 1
  from public.custom_settlement_ai_sessions as session
  where session.organization_id = new.organization_id
    and session.project_id = new.project_id
    and session.conversation_id = new.conversation_id
    and session.actor_id = new.created_by
  for key share;

  if not found then
    raise exception 'settlement_ai_authoring_session_required';
  end if;

  return new;
end;
$$;

revoke all on function public.guard_custom_settlement_ai_draft_authoring()
from public, anon, authenticated, service_role;

create trigger ai_settlement_rule_drafts_authoring_guard
before insert on public.ai_settlement_rule_drafts
for each row
execute function public.guard_custom_settlement_ai_draft_authoring();
