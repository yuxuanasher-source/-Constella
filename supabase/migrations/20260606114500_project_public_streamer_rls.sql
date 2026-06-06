create or replace view public.streamer_public_project_announcements
as
select
  p.id,
  p.organization_id,
  p.code,
  p.name,
  p.status,
  p.vendor_name,
  p.product_name,
  p.open_signup,
  p.force_recording,
  p.is_public_to_streamers,
  p.public_summary,
  p.game_download_url,
  p.published_at,
  p.created_at
from public.projects p
where p.is_public_to_streamers = true
  and p.status in ('recruiting', 'pending_start', 'active', 'paused')
  and public.current_user_role(p.organization_id) = 'streamer'
  and public.current_streamer_id(p.organization_id) is not null;

grant select on public.streamer_public_project_announcements to authenticated;

create or replace function public.mark_application_recording_reviewing(
  target_application_id uuid
)
returns public.project_applications
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_application public.project_applications;
begin
  update public.project_applications
  set
    status = 'recording_reviewing',
    decided_by = null,
    decided_at = null,
    decision_reason = null
  where id = target_application_id
    and streamer_id = public.current_streamer_id(organization_id)
    and status in (
      'submitted',
      'invited',
      'recording_required',
      'recording_rejected'
    )
  returning * into updated_application;

  if updated_application.id is null then
    raise exception 'Application is not available for recording review';
  end if;

  return updated_application;
end;
$$;

revoke all on function public.mark_application_recording_reviewing(uuid)
from public;

grant execute on function public.mark_application_recording_reviewing(uuid)
to authenticated;
