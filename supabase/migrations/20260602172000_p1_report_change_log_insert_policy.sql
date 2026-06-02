create policy report_change_logs_staff_insert
on public.report_change_logs
for insert
to authenticated
with check (
  exists (
    select 1
    from public.live_reports lr
    where lr.id = report_change_logs.live_report_id
      and lr.organization_id = report_change_logs.organization_id
      and public.is_mcn_staff(lr.organization_id)
      and public.can_access_project(lr.project_id)
  )
);
