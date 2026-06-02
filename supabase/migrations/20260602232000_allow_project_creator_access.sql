create or replace function public.can_access_project(target_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with project_scope as (
    select p.id, p.organization_id, p.created_by
    from public.projects p
    where p.id = target_project_id
  )
  select coalesce((
    select
      case
        when public.current_user_role(ps.organization_id) in ('owner', 'ops_manager', 'finance')
          then true
        when public.current_user_role(ps.organization_id) = 'operator_business'
          then ps.created_by = auth.uid()
            or exists (
              select 1
              from public.project_assignments pa
              where pa.project_id = ps.id
                and pa.user_id = auth.uid()
            )
        when public.current_user_role(ps.organization_id) = 'streamer'
          then exists (
            select 1
            from public.live_tasks lt
            where lt.project_id = ps.id
              and lt.streamer_id = public.current_streamer_id(ps.organization_id)
          )
        else false
      end
    from project_scope ps
  ), false);
$$;
