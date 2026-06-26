do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'project_collaboration_shares_id_project_owner_unique'
  ) then
    alter table public.project_collaboration_shares
      add constraint project_collaboration_shares_id_project_owner_unique
      unique (id, project_id, owner_organization_id);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'project_collaboration_applications_share_project_owner_fk'
  ) then
    alter table public.project_collaboration_applications
      add constraint project_collaboration_applications_share_project_owner_fk
      foreign key (share_id, project_id, owner_organization_id)
      references public.project_collaboration_shares (id, project_id, owner_organization_id)
      on delete cascade;
  end if;
end $$;

create unique index if not exists project_collaboration_applications_one_open_per_partner
on public.project_collaboration_applications (project_id, applicant_organization_id)
where status in ('submitted', 'owner_countered');

create or replace function public.can_submit_project_collaboration_application(
  target_share_id uuid,
  target_project_id uuid,
  target_owner_organization_id uuid,
  target_applicant_organization_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_org_member(target_applicant_organization_id)
    and target_applicant_organization_id <> target_owner_organization_id
    and exists (
      select 1
      from public.project_collaboration_shares share
      join public.projects project
        on project.id = share.project_id
      where share.id = target_share_id
        and share.project_id = target_project_id
        and share.owner_organization_id = target_owner_organization_id
        and share.status = 'active'
        and share.expires_at > now()
        and share.allow_applications
        and project.is_open_to_mcn_collaboration
        and project.organization_id = target_owner_organization_id
    );
$$;

drop policy if exists project_collaboration_applications_partner_insert
on public.project_collaboration_applications;

create policy project_collaboration_applications_partner_insert
on public.project_collaboration_applications
for insert
to authenticated
with check (
  public.can_submit_project_collaboration_application(
    share_id,
    project_id,
    owner_organization_id,
    applicant_organization_id
  )
);
