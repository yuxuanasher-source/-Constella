create table if not exists public.project_complex_cost_rule_entitlements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  enabled_source text not null check (enabled_source in ('plan', 'addon', 'override')),
  billing_mode text not null check (billing_mode in ('included', 'per_project_monthly', 'enterprise')),
  valid_from timestamptz not null default now(),
  valid_to timestamptz,
  monthly_price_cents integer not null default 0 check (monthly_price_cents >= 0),
  created_by uuid references auth.users(id),
  reason text not null,
  created_at timestamptz not null default now(),
  unique (project_id)
);

create table if not exists public.cost_rule_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  name text not null,
  scenario text not null check (
    scenario in (
      'cpt',
      'base_salary_cpt',
      'cpa',
      'cps',
      'gift',
      'supplier',
      'traffic',
      'replay_penalty'
    )
  ),
  rule_payload jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.project_cost_rule_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  version_no integer not null check (version_no > 0),
  status text not null check (status in ('draft', 'active', 'archived')),
  rule_payload jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id),
  approved_by uuid references auth.users(id),
  effective_from timestamptz,
  created_at timestamptz not null default now(),
  unique (project_id, version_no)
);

create table if not exists public.project_cost_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  streamer_id uuid references public.streamers(id) on delete set null,
  supplier_organization_id uuid references public.organizations(id) on delete set null,
  live_report_id uuid references public.live_reports(id) on delete set null,
  settlement_batch_id uuid references public.settlement_batches(id) on delete set null,
  item_type text not null check (
    item_type in (
      'cpa',
      'cps',
      'gift',
      'bonus',
      'penalty',
      'supplier_fee',
      'traffic',
      'platform_fee',
      'sample',
      'replay',
      'tax',
      'manual'
    )
  ),
  amount_cents bigint not null check (amount_cents >= 0),
  direction text not null check (direction in ('cost', 'revenue_offset', 'adjustment')),
  evidence_level text not null check (evidence_level in ('green', 'yellow', 'red')),
  source text not null check (source in ('system', 'import', 'manual')),
  source_payload jsonb not null default '{}'::jsonb,
  reason text not null,
  status text not null check (status in ('draft', 'pending_review', 'confirmed', 'voided')),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.project_cost_import_batches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  import_type text not null check (import_type in ('cpa', 'cps', 'gift', 'traffic', 'supplier_bill')),
  file_url text,
  row_count integer not null default 0 check (row_count >= 0),
  parsed_payload jsonb not null default '[]'::jsonb,
  status text not null check (status in ('uploaded', 'parsed', 'confirmed', 'failed')),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create index if not exists project_complex_cost_entitlements_org_project_idx
  on public.project_complex_cost_rule_entitlements (organization_id, project_id);
create index if not exists project_cost_rule_versions_project_status_idx
  on public.project_cost_rule_versions (project_id, status);
create index if not exists project_cost_items_project_status_idx
  on public.project_cost_items (project_id, status);
create index if not exists project_cost_items_batch_idx
  on public.project_cost_items (settlement_batch_id);
create index if not exists project_cost_import_batches_project_status_idx
  on public.project_cost_import_batches (project_id, status);

alter table public.project_complex_cost_rule_entitlements enable row level security;
alter table public.cost_rule_templates enable row level security;
alter table public.project_cost_rule_versions enable row level security;
alter table public.project_cost_items enable row level security;
alter table public.project_cost_import_batches enable row level security;

create policy project_complex_cost_entitlements_org_read
  on public.project_complex_cost_rule_entitlements for select
  using (public.is_org_member(organization_id));

create policy project_complex_cost_entitlements_staff_insert
  on public.project_complex_cost_rule_entitlements for insert
  with check (
    public.current_user_role(organization_id) in ('owner', 'ops_manager')
    and public.can_access_project(project_id)
  );

create policy project_complex_cost_entitlements_staff_update
  on public.project_complex_cost_rule_entitlements for update
  using (
    public.current_user_role(organization_id) in ('owner', 'ops_manager')
    and public.can_access_project(project_id)
  )
  with check (
    public.current_user_role(organization_id) in ('owner', 'ops_manager')
    and public.can_access_project(project_id)
  );

create policy cost_rule_templates_org_read
  on public.cost_rule_templates for select
  using (organization_id is null or public.is_org_member(organization_id));

create policy project_cost_rule_versions_org_read
  on public.project_cost_rule_versions for select
  using (public.is_org_member(organization_id));

create policy project_cost_rule_versions_staff_insert
  on public.project_cost_rule_versions for insert
  with check (
    public.current_user_role(organization_id) in ('owner', 'ops_manager')
    and public.can_access_project(project_id)
  );

create policy project_cost_rule_versions_staff_update
  on public.project_cost_rule_versions for update
  using (
    public.current_user_role(organization_id) in ('owner', 'ops_manager')
    and public.can_access_project(project_id)
  )
  with check (
    public.current_user_role(organization_id) in ('owner', 'ops_manager')
    and public.can_access_project(project_id)
  );

create policy project_cost_items_org_read
  on public.project_cost_items for select
  using (public.is_org_member(organization_id));

create policy project_cost_items_staff_insert
  on public.project_cost_items for insert
  with check (
    public.current_user_role(organization_id) in ('owner', 'ops_manager', 'operator_business')
    and public.can_access_project(project_id)
  );

create policy project_cost_items_staff_update
  on public.project_cost_items for update
  using (
    public.current_user_role(organization_id) in ('owner', 'ops_manager', 'operator_business')
    and public.can_access_project(project_id)
  )
  with check (
    public.current_user_role(organization_id) in ('owner', 'ops_manager', 'operator_business')
    and public.can_access_project(project_id)
  );

create policy project_cost_import_batches_org_read
  on public.project_cost_import_batches for select
  using (public.is_org_member(organization_id));

create policy project_cost_import_batches_staff_insert
  on public.project_cost_import_batches for insert
  with check (
    public.current_user_role(organization_id) in ('owner', 'ops_manager', 'operator_business')
    and public.can_access_project(project_id)
  );

create policy project_cost_import_batches_staff_update
  on public.project_cost_import_batches for update
  using (
    public.current_user_role(organization_id) in ('owner', 'ops_manager', 'operator_business')
    and public.can_access_project(project_id)
  )
  with check (
    public.current_user_role(organization_id) in ('owner', 'ops_manager', 'operator_business')
    and public.can_access_project(project_id)
  );
