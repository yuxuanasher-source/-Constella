create policy "project creators can read own projects"
on public.projects
for select
to authenticated
using (
  public.is_org_member(organization_id)
  and created_by = auth.uid()
);
