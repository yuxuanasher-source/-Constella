update public.projects
set owner_id = created_by
where owner_id is null
  and created_by is not null;

create or replace function public.default_project_owner()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.owner_id := coalesce(new.owner_id, new.created_by);
  return new;
end;
$$;

drop trigger if exists projects_default_owner
on public.projects;

create trigger projects_default_owner
before insert on public.projects
for each row execute function public.default_project_owner();
