-- Strengthen audit_logs tamper resistance.
--
-- The initial schema made audit_logs append-only against UPDATE and DELETE via
-- the audit_logs_append_only trigger, but two gaps remained:
--
--   1. TRUNCATE bypasses row-level UPDATE/DELETE triggers, so a member with the
--      privilege could wipe the entire audit trail in one statement without
--      tripping the append-only guard. Row-level triggers never fire on
--      TRUNCATE; a statement-level BEFORE TRUNCATE trigger is required.
--
--   2. The insert policy only checked organization membership, so any member
--      could forge an audit entry attributing an action to a *different* user
--      (actor_user_id pointing at someone else). Every application write path
--      sets actor_user_id to the authenticated user's own id, so we can pin
--      actor_user_id to auth.uid() without breaking a legitimate flow. NULL is
--      still allowed for system/background rows since a null actor impersonates
--      no one. Service-role writes bypass RLS and are unaffected.

-- (1) Block TRUNCATE on the audit trail. prevent_audit_log_mutation only raises
-- and never reads NEW/OLD, so it is safe to reuse at statement level.
drop trigger if exists audit_logs_no_truncate on public.audit_logs;
create trigger audit_logs_no_truncate
before truncate on public.audit_logs
for each statement execute function public.prevent_audit_log_mutation();

-- (2) Enforce actor integrity on insert: a member may only record actions under
-- their own identity (or a null system actor).
drop policy if exists "members can insert audit logs" on public.audit_logs;
create policy "members can insert audit logs"
on public.audit_logs for insert
to authenticated
with check (
  public.is_org_member(organization_id)
  and (actor_user_id is null or actor_user_id = auth.uid())
);
