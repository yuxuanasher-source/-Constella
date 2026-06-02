create index if not exists live_reports_settlement_pool_idx
on public.live_reports (
  organization_id,
  project_id,
  status,
  enter_settlement_pool,
  settled_batch_item_id,
  created_at
)
where status = 'approved'
  and enter_settlement_pool = true
  and settled_batch_item_id is null;

drop policy if exists "staff can manage settlement batches"
on public.settlement_batches;

create policy "owner ops can manage settlement batches"
on public.settlement_batches for all
to authenticated
using (
  public.current_user_role(organization_id) in (
    'owner',
    'ops_manager',
    'operator_business'
  )
  and public.can_access_project(project_id)
)
with check (
  public.current_user_role(organization_id) in (
    'owner',
    'ops_manager',
    'operator_business'
  )
  and public.can_access_project(project_id)
);

drop policy if exists "staff can manage settlement items"
on public.settlement_batch_items;

create policy "owner ops can manage settlement items"
on public.settlement_batch_items for all
to authenticated
using (
  public.current_user_role(organization_id) in (
    'owner',
    'ops_manager',
    'operator_business'
  )
  and public.can_access_project(project_id)
)
with check (
  public.current_user_role(organization_id) in (
    'owner',
    'ops_manager',
    'operator_business'
  )
  and public.can_access_project(project_id)
);
