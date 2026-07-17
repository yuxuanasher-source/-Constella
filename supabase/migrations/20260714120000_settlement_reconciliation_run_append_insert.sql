-- Allow settlement transition gates to persist immutable reconciliation runs.
-- Updates and deletes remain blocked by the existing immutability triggers.

grant insert on table public.settlement_reconciliation_runs to authenticated;

drop policy if exists settlement_reconciliation_runs_staff_insert
  on public.settlement_reconciliation_runs;

create policy settlement_reconciliation_runs_staff_insert
on public.settlement_reconciliation_runs for insert
to authenticated
with check (
  auth.uid() is not null
  and created_by = auth.uid()
  and public.is_mcn_staff(organization_id)
  and public.can_access_project(project_id)
);
