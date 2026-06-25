drop policy if exists "mcn staff can read live tasks in org"
on public.live_tasks;

create policy "mcn staff can read live tasks in org"
on public.live_tasks for select
to authenticated
using (public.is_mcn_staff(organization_id));

drop policy if exists "mcn staff can read live reports in org"
on public.live_reports;

create policy "mcn staff can read live reports in org"
on public.live_reports for select
to authenticated
using (public.is_mcn_staff(organization_id));

drop policy if exists "mcn staff can read report screenshots in org"
on public.report_screenshots;

create policy "mcn staff can read report screenshots in org"
on public.report_screenshots for select
to authenticated
using (public.is_mcn_staff(organization_id));
