alter table public.project_applications
  add column if not exists collaboration_id uuid references public.project_collaboration_agreements(id),
  add column if not exists contributor_organization_id uuid references public.organizations(id);

alter table public.recording_submissions
  add column if not exists collaboration_id uuid references public.project_collaboration_agreements(id),
  add column if not exists contributor_organization_id uuid references public.organizations(id);

alter table public.project_streamers
  add column if not exists collaboration_id uuid references public.project_collaboration_agreements(id),
  add column if not exists contributor_organization_id uuid references public.organizations(id);

alter table public.live_tasks
  add column if not exists collaboration_id uuid references public.project_collaboration_agreements(id),
  add column if not exists contributor_organization_id uuid references public.organizations(id);

alter table public.live_reports
  add column if not exists collaboration_id uuid references public.project_collaboration_agreements(id),
  add column if not exists contributor_organization_id uuid references public.organizations(id);

alter table public.settlement_batch_items
  add column if not exists collaboration_id uuid references public.project_collaboration_agreements(id),
  add column if not exists contributor_organization_id uuid references public.organizations(id);

create index if not exists project_applications_collaboration_idx
on public.project_applications (collaboration_id, project_id);

create index if not exists project_applications_contributor_idx
on public.project_applications (contributor_organization_id, project_id);

create index if not exists recording_submissions_collaboration_idx
on public.recording_submissions (collaboration_id, project_id);

create index if not exists recording_submissions_contributor_idx
on public.recording_submissions (contributor_organization_id, project_id);

create index if not exists project_streamers_collaboration_idx
on public.project_streamers (collaboration_id, project_id);

create index if not exists project_streamers_contributor_idx
on public.project_streamers (contributor_organization_id, project_id);

create index if not exists live_tasks_collaboration_idx
on public.live_tasks (collaboration_id, project_id);

create index if not exists live_tasks_contributor_idx
on public.live_tasks (contributor_organization_id, project_id);

create index if not exists live_reports_collaboration_idx
on public.live_reports (collaboration_id, project_id);

create index if not exists live_reports_contributor_idx
on public.live_reports (contributor_organization_id, project_id);

create index if not exists settlement_batch_items_collaboration_idx
on public.settlement_batch_items (collaboration_id, project_id);

create index if not exists settlement_batch_items_contributor_idx
on public.settlement_batch_items (contributor_organization_id, project_id);

create or replace function public.has_active_project_collaboration(
  target_project_id uuid,
  target_collaboration_id uuid,
  target_contributor_organization_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.project_collaboration_agreements agreement
    where agreement.id = target_collaboration_id
      and agreement.project_id = target_project_id
      and agreement.partner_organization_id = target_contributor_organization_id
      and agreement.status = 'active'
      and public.is_org_member(agreement.partner_organization_id)
  );
$$;

create policy project_applications_collaboration_contributor_access
on public.project_applications
for all
to authenticated
using (
  collaboration_id is not null
  and contributor_organization_id is not null
  and public.can_contribute_to_project(project_id, contributor_organization_id)
)
with check (
  collaboration_id is not null
  and contributor_organization_id is not null
  and public.can_contribute_to_project(project_id, contributor_organization_id)
  and public.has_active_project_collaboration(project_id, collaboration_id, contributor_organization_id)
);

create policy recording_submissions_collaboration_contributor_access
on public.recording_submissions
for all
to authenticated
using (
  collaboration_id is not null
  and contributor_organization_id is not null
  and public.can_contribute_to_project(project_id, contributor_organization_id)
)
with check (
  collaboration_id is not null
  and contributor_organization_id is not null
  and public.can_contribute_to_project(project_id, contributor_organization_id)
  and public.has_active_project_collaboration(project_id, collaboration_id, contributor_organization_id)
);

create policy project_streamers_collaboration_contributor_access
on public.project_streamers
for all
to authenticated
using (
  collaboration_id is not null
  and contributor_organization_id is not null
  and public.can_contribute_to_project(project_id, contributor_organization_id)
)
with check (
  collaboration_id is not null
  and contributor_organization_id is not null
  and public.can_contribute_to_project(project_id, contributor_organization_id)
  and public.has_active_project_collaboration(project_id, collaboration_id, contributor_organization_id)
);

create policy live_tasks_collaboration_contributor_access
on public.live_tasks
for all
to authenticated
using (
  collaboration_id is not null
  and contributor_organization_id is not null
  and public.can_contribute_to_project(project_id, contributor_organization_id)
)
with check (
  collaboration_id is not null
  and contributor_organization_id is not null
  and public.can_contribute_to_project(project_id, contributor_organization_id)
  and public.has_active_project_collaboration(project_id, collaboration_id, contributor_organization_id)
);

create policy live_reports_collaboration_contributor_access
on public.live_reports
for all
to authenticated
using (
  collaboration_id is not null
  and contributor_organization_id is not null
  and public.can_contribute_to_project(project_id, contributor_organization_id)
)
with check (
  collaboration_id is not null
  and contributor_organization_id is not null
  and public.can_contribute_to_project(project_id, contributor_organization_id)
  and public.has_active_project_collaboration(project_id, collaboration_id, contributor_organization_id)
);
