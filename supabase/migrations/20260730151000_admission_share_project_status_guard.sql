create or replace function public.guard_admission_share_project_status()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  perform 1
  from public.projects as project
  where project.id = new.project_id
    and project.organization_id = new.organization_id
    and project.status::text in (
      'recruiting',
      'pending_start',
      'active',
      'paused',
      'ended'
    );

  if not found then
    raise exception 'admission_share_project_status_blocked';
  end if;

  return new;
end;
$$;

revoke all on function public.guard_admission_share_project_status()
from public, anon, authenticated;

drop trigger if exists project_recording_share_boards_project_status_guard
on public.project_recording_share_boards;

create trigger project_recording_share_boards_project_status_guard
before insert on public.project_recording_share_boards
for each row
execute function public.guard_admission_share_project_status();
