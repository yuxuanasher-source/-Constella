do $$
begin
  create type public.recording_asset_kind as enum (
    'project_submission',
    'streamer_library'
  );
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.recording_asset_source_kind as enum (
    'bilibili_url',
    'external_url',
    'storage_object'
  );
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.recording_asset_preview_state as enum (
    'pending',
    'previewable',
    'external_only',
    'private_file',
    'failed'
  );
exception
  when duplicate_object then null;
end $$;

create table if not exists public.recording_assets (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  streamer_id uuid not null references public.streamers(id) on delete restrict,
  project_id uuid references public.projects(id) on delete cascade,
  application_id uuid references public.project_applications(id) on delete cascade,
  asset_kind public.recording_asset_kind not null,
  title text not null,
  review_status public.recording_review_status not null default 'submitted',
  preview_state public.recording_asset_preview_state not null default 'pending',
  duration_seconds integer,
  visibility_scope text not null default 'organization',
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint recording_assets_duration_nonnegative check (
    duration_seconds is null or duration_seconds >= 0
  )
);

create table if not exists public.recording_asset_sources (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  asset_id uuid not null references public.recording_assets(id) on delete cascade,
  source_ref text not null,
  source_kind public.recording_asset_source_kind not null,
  preview_state public.recording_asset_preview_state not null default 'pending',
  provider text not null default 'unknown',
  external_url text,
  storage_path text,
  recording_submission_id uuid references public.recording_submissions(id) on delete cascade,
  streamer_recording_link_id uuid references public.streamer_recording_links(id) on delete cascade,
  submitted_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, source_ref),
  constraint recording_asset_sources_has_source check (
    external_url is not null or storage_path is not null
  ),
  constraint recording_asset_sources_http_url check (
    external_url is null or external_url ~* '^https?://'
  )
);

alter table public.recording_submissions
add column if not exists asset_id uuid references public.recording_assets(id);

alter table public.streamer_recording_links
add column if not exists asset_id uuid references public.recording_assets(id);

create index if not exists recording_assets_org_streamer_idx
on public.recording_assets (organization_id, streamer_id, created_at desc);

create index if not exists recording_assets_project_idx
on public.recording_assets (project_id, review_status, created_at desc)
where project_id is not null;

create index if not exists recording_asset_sources_asset_idx
on public.recording_asset_sources (asset_id);

create index if not exists recording_asset_sources_submission_idx
on public.recording_asset_sources (recording_submission_id)
where recording_submission_id is not null;

create index if not exists recording_asset_sources_library_idx
on public.recording_asset_sources (streamer_recording_link_id)
where streamer_recording_link_id is not null;

create trigger recording_assets_touch_updated_at
before update on public.recording_assets
for each row execute function public.touch_updated_at();

create trigger recording_asset_sources_touch_updated_at
before update on public.recording_asset_sources
for each row execute function public.touch_updated_at();

alter table public.recording_assets enable row level security;
alter table public.recording_asset_sources enable row level security;

create policy recording_assets_staff_access
on public.recording_assets
for all
using (public.is_org_member(organization_id) and public.is_mcn_staff(organization_id))
with check (public.is_org_member(organization_id) and public.is_mcn_staff(organization_id));

create policy recording_assets_streamer_read_own
on public.recording_assets
for select
using (streamer_id = public.current_streamer_id(organization_id));

create policy recording_asset_sources_staff_access
on public.recording_asset_sources
for all
using (public.is_org_member(organization_id) and public.is_mcn_staff(organization_id))
with check (public.is_org_member(organization_id) and public.is_mcn_staff(organization_id));

create policy recording_asset_sources_streamer_read_own
on public.recording_asset_sources
for select
using (
  exists (
    select 1
    from public.recording_assets ra
    where ra.id = recording_asset_sources.asset_id
      and ra.streamer_id = public.current_streamer_id(recording_asset_sources.organization_id)
  )
);

create or replace function public.recording_asset_source_kind_for(
  p_external_url text,
  p_storage_path text
)
returns public.recording_asset_source_kind
language sql
immutable
as $$
  select case
    when nullif(btrim(p_storage_path), '') is not null then 'storage_object'::public.recording_asset_source_kind
    when p_external_url ~* '^https?://([^/]+\.)?bilibili\.com/' then 'bilibili_url'::public.recording_asset_source_kind
    when p_external_url ~* '^https?://b23\.tv/' then 'bilibili_url'::public.recording_asset_source_kind
    else 'external_url'::public.recording_asset_source_kind
  end
$$;

create or replace function public.recording_asset_preview_state_for(
  p_source_kind public.recording_asset_source_kind
)
returns public.recording_asset_preview_state
language sql
immutable
as $$
  select case p_source_kind
    when 'storage_object' then 'private_file'::public.recording_asset_preview_state
    when 'bilibili_url' then 'previewable'::public.recording_asset_preview_state
    else 'external_only'::public.recording_asset_preview_state
  end
$$;

create or replace function public.recording_asset_provider_for(
  p_source_kind public.recording_asset_source_kind,
  p_external_url text
)
returns text
language sql
immutable
as $$
  select case
    when p_source_kind = 'storage_object' then 'private_storage'
    when p_source_kind = 'bilibili_url' then 'bilibili'
    when p_external_url is null then 'unknown'
    else lower(regexp_replace(split_part(regexp_replace(p_external_url, '^https?://', ''), '/', 1), '^www\.', ''))
  end
$$;

create or replace function public.sync_recording_asset_from_submission()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source_ref text := 'recording_submissions:' || new.id::text;
  v_source_kind public.recording_asset_source_kind;
  v_preview_state public.recording_asset_preview_state;
  v_provider text;
  v_asset_id uuid;
begin
  v_source_kind := public.recording_asset_source_kind_for(new.external_url, new.storage_path);
  v_preview_state := public.recording_asset_preview_state_for(v_source_kind);
  v_provider := public.recording_asset_provider_for(v_source_kind, new.external_url);

  if new.asset_id is null then
    insert into public.recording_assets (
      organization_id,
      streamer_id,
      project_id,
      application_id,
      asset_kind,
      title,
      review_status,
      preview_state,
      duration_seconds,
      visibility_scope,
      metadata
    ) values (
      new.organization_id,
      new.streamer_id,
      new.project_id,
      new.application_id,
      'project_submission',
      '项目录屏 v' || new.version::text,
      new.status,
      v_preview_state,
      new.duration_seconds,
      'project_admission',
      jsonb_build_object(
        'source_ref', v_source_ref,
        'version', new.version,
        'collaboration_id', new.collaboration_id,
        'contributor_organization_id', new.contributor_organization_id
      )
    )
    returning id into v_asset_id;

    update public.recording_submissions
    set asset_id = v_asset_id
    where id = new.id;
  else
    v_asset_id := new.asset_id;

    update public.recording_assets
    set review_status = new.status,
        preview_state = v_preview_state,
        duration_seconds = new.duration_seconds,
        updated_at = now(),
        metadata = metadata || jsonb_build_object(
          'source_ref', v_source_ref,
          'version', new.version,
          'collaboration_id', new.collaboration_id,
          'contributor_organization_id', new.contributor_organization_id
        )
    where id = v_asset_id;
  end if;

  insert into public.recording_asset_sources (
    organization_id,
    asset_id,
    source_ref,
    source_kind,
    preview_state,
    provider,
    external_url,
    storage_path,
    recording_submission_id,
    submitted_at,
    metadata
  ) values (
    new.organization_id,
    v_asset_id,
    v_source_ref,
    v_source_kind,
    v_preview_state,
    v_provider,
    new.external_url,
    new.storage_path,
    new.id,
    new.submitted_at,
    jsonb_build_object('version', new.version)
  )
  on conflict (organization_id, source_ref) do update
  set source_kind = excluded.source_kind,
      preview_state = excluded.preview_state,
      provider = excluded.provider,
      external_url = excluded.external_url,
      storage_path = excluded.storage_path,
      submitted_at = excluded.submitted_at,
      metadata = excluded.metadata,
      updated_at = now();

  return new;
end;
$$;

create or replace function public.sync_recording_asset_from_streamer_link()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source_ref text := 'streamer_recording_links:' || new.id::text;
  v_source_kind public.recording_asset_source_kind;
  v_preview_state public.recording_asset_preview_state;
  v_provider text;
  v_asset_id uuid;
begin
  v_source_kind := public.recording_asset_source_kind_for(new.recording_url, null);
  v_preview_state := public.recording_asset_preview_state_for(v_source_kind);
  v_provider := public.recording_asset_provider_for(v_source_kind, new.recording_url);

  if new.asset_id is null then
    insert into public.recording_assets (
      organization_id,
      streamer_id,
      asset_kind,
      title,
      review_status,
      preview_state,
      visibility_scope,
      metadata,
      created_by
    ) values (
      new.organization_id,
      new.streamer_id,
      'streamer_library',
      new.product || ' · ' || new.recording_month,
      new.status,
      v_preview_state,
      'streamer_profile',
      jsonb_build_object(
        'source_ref', v_source_ref,
        'product', new.product,
        'category', new.category,
        'recording_month', new.recording_month
      ),
      new.submitted_by
    )
    returning id into v_asset_id;

    update public.streamer_recording_links
    set asset_id = v_asset_id
    where id = new.id;
  else
    v_asset_id := new.asset_id;

    update public.recording_assets
    set title = new.product || ' · ' || new.recording_month,
        review_status = new.status,
        preview_state = v_preview_state,
        updated_at = now(),
        metadata = metadata || jsonb_build_object(
          'source_ref', v_source_ref,
          'product', new.product,
          'category', new.category,
          'recording_month', new.recording_month
        )
    where id = v_asset_id;
  end if;

  insert into public.recording_asset_sources (
    organization_id,
    asset_id,
    source_ref,
    source_kind,
    preview_state,
    provider,
    external_url,
    streamer_recording_link_id,
    submitted_at,
    metadata
  ) values (
    new.organization_id,
    v_asset_id,
    v_source_ref,
    v_source_kind,
    v_preview_state,
    v_provider,
    new.recording_url,
    new.id,
    new.submitted_at,
    jsonb_build_object(
      'product', new.product,
      'category', new.category,
      'recording_month', new.recording_month
    )
  )
  on conflict (organization_id, source_ref) do update
  set source_kind = excluded.source_kind,
      preview_state = excluded.preview_state,
      provider = excluded.provider,
      external_url = excluded.external_url,
      submitted_at = excluded.submitted_at,
      metadata = excluded.metadata,
      updated_at = now();

  return new;
end;
$$;

drop trigger if exists recording_submissions_sync_asset on public.recording_submissions;
create trigger recording_submissions_sync_asset
after insert or update of storage_path, external_url, status, duration_seconds
on public.recording_submissions
for each row execute function public.sync_recording_asset_from_submission();

drop trigger if exists streamer_recording_links_sync_asset on public.streamer_recording_links;
create trigger streamer_recording_links_sync_asset
after insert or update of recording_url, status, product, category, recording_month
on public.streamer_recording_links
for each row execute function public.sync_recording_asset_from_streamer_link();

with source_rows as (
  select
    rs.*,
    'recording_submissions:' || rs.id::text as source_ref,
    public.recording_asset_source_kind_for(rs.external_url, rs.storage_path) as source_kind
  from public.recording_submissions rs
  where rs.asset_id is null
),
inserted_assets as (
  insert into public.recording_assets (
    organization_id,
    streamer_id,
    project_id,
    application_id,
    asset_kind,
    title,
    review_status,
    preview_state,
    duration_seconds,
    visibility_scope,
    metadata
  )
  select
    sr.organization_id,
    sr.streamer_id,
    sr.project_id,
    sr.application_id,
    'project_submission',
    '项目录屏 v' || sr.version::text,
    sr.status,
    public.recording_asset_preview_state_for(sr.source_kind),
    sr.duration_seconds,
    'project_admission',
    jsonb_build_object(
      'source_ref', sr.source_ref,
      'version', sr.version,
      'collaboration_id', sr.collaboration_id,
      'contributor_organization_id', sr.contributor_organization_id
    )
  from source_rows sr
  where not exists (
    select 1
    from public.recording_asset_sources ras
    where ras.organization_id = sr.organization_id
      and ras.source_ref = sr.source_ref
  )
  returning id, organization_id, metadata
)
insert into public.recording_asset_sources (
  organization_id,
  asset_id,
  source_ref,
  source_kind,
  preview_state,
  provider,
  external_url,
  storage_path,
  recording_submission_id,
  submitted_at,
  metadata
)
select
  ia.organization_id,
  ia.id,
  sr.source_ref,
  sr.source_kind,
  public.recording_asset_preview_state_for(sr.source_kind),
  public.recording_asset_provider_for(sr.source_kind, sr.external_url),
  sr.external_url,
  sr.storage_path,
  sr.id,
  sr.submitted_at,
  jsonb_build_object('version', sr.version)
from inserted_assets ia
join source_rows sr
  on sr.source_ref = ia.metadata ->> 'source_ref'
on conflict (organization_id, source_ref) do nothing;

update public.recording_submissions rs
set asset_id = ras.asset_id
from public.recording_asset_sources ras
where ras.recording_submission_id = rs.id
  and rs.asset_id is null;

with source_rows as (
  select
    l.*,
    'streamer_recording_links:' || l.id::text as source_ref,
    public.recording_asset_source_kind_for(l.recording_url, null) as source_kind
  from public.streamer_recording_links l
  where l.asset_id is null
),
inserted_assets as (
  insert into public.recording_assets (
    organization_id,
    streamer_id,
    asset_kind,
    title,
    review_status,
    preview_state,
    visibility_scope,
    metadata,
    created_by
  )
  select
    sr.organization_id,
    sr.streamer_id,
    'streamer_library',
    sr.product || ' · ' || sr.recording_month,
    sr.status,
    public.recording_asset_preview_state_for(sr.source_kind),
    'streamer_profile',
    jsonb_build_object(
      'source_ref', sr.source_ref,
      'product', sr.product,
      'category', sr.category,
      'recording_month', sr.recording_month
    ),
    sr.submitted_by
  from source_rows sr
  where not exists (
    select 1
    from public.recording_asset_sources ras
    where ras.organization_id = sr.organization_id
      and ras.source_ref = sr.source_ref
  )
  returning id, organization_id, metadata
)
insert into public.recording_asset_sources (
  organization_id,
  asset_id,
  source_ref,
  source_kind,
  preview_state,
  provider,
  external_url,
  streamer_recording_link_id,
  submitted_at,
  metadata
)
select
  ia.organization_id,
  ia.id,
  sr.source_ref,
  sr.source_kind,
  public.recording_asset_preview_state_for(sr.source_kind),
  public.recording_asset_provider_for(sr.source_kind, sr.recording_url),
  sr.recording_url,
  sr.id,
  sr.submitted_at,
  jsonb_build_object(
    'product', sr.product,
    'category', sr.category,
    'recording_month', sr.recording_month
  )
from inserted_assets ia
join source_rows sr
  on sr.source_ref = ia.metadata ->> 'source_ref'
on conflict (organization_id, source_ref) do nothing;

update public.streamer_recording_links l
set asset_id = ras.asset_id
from public.recording_asset_sources ras
where ras.streamer_recording_link_id = l.id
  and l.asset_id is null;
