create or replace function public.can_streamer_read_ocr_job(
  target_organization_id uuid,
  target_payload jsonb
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.live_reports lr
    where lr.id = public.ocr_job_live_report_id(target_payload)
      and lr.organization_id = target_organization_id
      and lr.streamer_id = public.current_streamer_id(target_organization_id)
  );
$$;

create policy background_jobs_streamer_ocr_read
on public.background_jobs
for select
to authenticated
using (
  job_type = 'ocr.extract_live_report'
  and public.can_streamer_read_ocr_job(organization_id, payload)
);
