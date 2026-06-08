drop policy if exists "staff can update accessible projects"
on public.projects;

drop policy if exists "project creators can update own projects"
on public.projects;

create policy "project creators can update own projects"
on public.projects for update
to authenticated
using (
  public.current_user_role(organization_id) in ('owner', 'ops_manager')
  or (
    public.current_user_role(organization_id) = 'operator_business'
    and (
      public.can_access_project(id)
      or owner_id = auth.uid()
      or created_by = auth.uid()
      or exists (
        select 1
        from public.project_assignments pa
        where pa.project_id = projects.id
          and pa.user_id = auth.uid()
      )
    )
  )
)
with check (
  public.current_user_role(organization_id) in (
    'owner',
    'ops_manager',
    'operator_business'
  )
);
