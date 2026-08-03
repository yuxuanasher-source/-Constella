-- deploy: expand

alter table public.organizations
  add column if not exists branding_version integer not null default 0;

alter table public.organizations
  add constraint organization_branding_version_nonnegative
  check (branding_version >= 0);

create table public.organization_brand_drafts (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  base_version integer not null check (base_version >= 0),
  draft_revision integer not null default 0 check (draft_revision >= 0),
  content jsonb not null,
  updated_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organization_brand_drafts_updated_by_member_fkey
    foreign key (organization_id, updated_by)
    references public.organization_members(organization_id, user_id)
);

create table public.organization_brand_versions (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  version integer not null check (version > 0),
  content jsonb not null,
  published_by uuid not null references public.profiles(id),
  published_at timestamptz not null default now(),
  unique (organization_id, version)
);

create table public.organization_contact_cards (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  display_name text not null check (
    char_length(btrim(display_name)) between 1 and 40
  ),
  title text not null default '' check (char_length(title) <= 40),
  phone text check (
    phone is null or char_length(btrim(phone)) <= 30
  ),
  email text check (
    email is null
    or (
      char_length(btrim(email)) <= 120
      and btrim(email) ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
    )
  ),
  wechat text check (
    wechat is null or char_length(btrim(wechat)) <= 60
  ),
  status text not null default 'active' check (
    status in ('active', 'disabled')
  ),
  created_by uuid not null references public.profiles(id),
  updated_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  constraint organization_contact_cards_created_by_member_fkey
    foreign key (organization_id, created_by)
    references public.organization_members(organization_id, user_id),
  constraint organization_contact_cards_updated_by_member_fkey
    foreign key (organization_id, updated_by)
    references public.organization_members(organization_id, user_id),
  check (
    nullif(btrim(coalesce(phone, '')), '') is not null
    or nullif(btrim(coalesce(email, '')), '') is not null
    or nullif(btrim(coalesce(wechat, '')), '') is not null
  )
);

create index organization_brand_versions_org_published_idx
on public.organization_brand_versions (organization_id, published_at desc);

create index organization_contact_cards_org_status_idx
on public.organization_contact_cards (organization_id, status, updated_at desc);

alter table public.project_recording_share_boards
  add column if not exists contact_card_id uuid,
  add column if not exists contact_card_snapshot jsonb,
  add constraint project_recording_share_boards_contact_snapshot_consistency
    check (
      contact_card_id is null
      or contact_card_snapshot is not null
    ),
  add constraint project_recording_share_boards_contact_card_org_fkey
    foreign key (organization_id, contact_card_id)
    references public.organization_contact_cards(organization_id, id)
    on delete set null (contact_card_id);

create index project_recording_share_boards_contact_card_idx
on public.project_recording_share_boards (contact_card_id, organization_id)
where contact_card_id is not null;

create or replace function public.guard_organization_contact_card_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.organization_id is distinct from old.organization_id
     or new.created_by is distinct from old.created_by then
    raise exception 'organization_contact_card_identity_is_immutable'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

create or replace function public.guard_recording_share_contact_card()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_card public.organization_contact_cards%rowtype;
begin
  if tg_op = 'INSERT' then
    if new.contact_card_id is null then
      new.contact_card_snapshot := null;
      return new;
    end if;

    select card.*
    into v_card
    from public.organization_contact_cards as card
    where card.id = new.contact_card_id
      and card.organization_id = new.organization_id
      and card.status = 'active'
    for share;

    if not found then
      raise exception 'organization_contact_card_not_active'
        using errcode = '23503';
    end if;

    new.contact_card_snapshot := jsonb_strip_nulls(jsonb_build_object(
      'displayName', btrim(v_card.display_name),
      'title', nullif(btrim(v_card.title), ''),
      'phone', nullif(btrim(v_card.phone), ''),
      'email', nullif(btrim(v_card.email), ''),
      'wechat', nullif(btrim(v_card.wechat), '')
    ));
    return new;
  end if;

  if new.contact_card_id is not distinct from old.contact_card_id
     and new.contact_card_snapshot is not distinct from old.contact_card_snapshot then
    return new;
  end if;

  if pg_trigger_depth() > 1
     and old.contact_card_id is not null
     and new.contact_card_id is null then
    new.contact_card_snapshot := old.contact_card_snapshot;
    return new;
  end if;

  if current_user = 'postgres'
     and new.contact_card_id is null
     and new.contact_card_snapshot is null then
    return new;
  end if;

  raise exception 'recording_share_contact_card_is_immutable'
    using errcode = '42501';
end;
$$;

create trigger organization_brand_drafts_touch_updated_at
before update on public.organization_brand_drafts
for each row execute function public.touch_updated_at();

create trigger organization_contact_cards_touch_updated_at
before update on public.organization_contact_cards
for each row execute function public.touch_updated_at();

create trigger organization_contact_cards_guard_identity
before update on public.organization_contact_cards
for each row execute function public.guard_organization_contact_card_identity();

create trigger project_recording_share_boards_guard_contact_card
before insert or update on public.project_recording_share_boards
for each row execute function public.guard_recording_share_contact_card();

alter table public.organization_brand_drafts enable row level security;
alter table public.organization_brand_versions enable row level security;
alter table public.organization_contact_cards enable row level security;

create policy organization_brand_drafts_owner_select
on public.organization_brand_drafts
for select
to authenticated
using (public.current_user_role(organization_id) = 'owner');

create policy organization_brand_drafts_owner_insert
on public.organization_brand_drafts
for insert
to authenticated
with check (
  public.current_user_role(organization_id) = 'owner'
  and updated_by = auth.uid()
);

create policy organization_brand_drafts_owner_update
on public.organization_brand_drafts
for update
to authenticated
using (public.current_user_role(organization_id) = 'owner')
with check (
  public.current_user_role(organization_id) = 'owner'
  and updated_by = auth.uid()
);

create policy organization_brand_drafts_owner_delete
on public.organization_brand_drafts
for delete
to authenticated
using (public.current_user_role(organization_id) = 'owner');

create policy organization_brand_versions_member_select
on public.organization_brand_versions
for select
to authenticated
using (public.is_org_member(organization_id));

create policy organization_contact_cards_member_select
on public.organization_contact_cards
for select
to authenticated
using (
  public.current_user_role(organization_id) = 'owner'
  or (
    status = 'active'
    and public.is_org_member(organization_id)
  )
);

revoke all on table public.organization_brand_drafts from public, anon;
revoke all on table public.organization_brand_versions from public, anon;
revoke all on table public.organization_contact_cards from public, anon, authenticated;

grant select, insert, update, delete
on table public.organization_brand_drafts
to authenticated;

grant select on table public.organization_brand_versions to authenticated;
revoke insert, update, delete on table public.organization_brand_versions from anon, authenticated, service_role;

grant select on table public.organization_contact_cards to authenticated;

create policy brand_logos_owner_insert_restriction
on storage.objects
as restrictive
for insert
to authenticated
with check (
  bucket_id <> 'jy-private'
  or (storage.foldername(name))[2] is distinct from 'brand-logos'
  or (
    bucket_id = 'jy-private'
    and (storage.foldername(name))[2] = 'brand-logos'
    and public.current_user_role(
      ((storage.foldername(name))[1])::uuid
    ) = 'owner'
  )
);

create or replace function public.create_organization_contact_card(
  p_organization_id uuid,
  p_content jsonb
)
returns table (
  id uuid,
  organization_id uuid,
  display_name text,
  title text,
  phone text,
  email text,
  wechat text,
  status text,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_user_id uuid := auth.uid();
  v_actor_name text;
  v_display_name text;
  v_title text;
  v_phone text;
  v_email text;
  v_wechat text;
  v_card public.organization_contact_cards%rowtype;
begin
  if v_actor_user_id is null
     or public.current_user_role(p_organization_id)
       is distinct from 'owner'::public.app_role then
    raise exception 'insufficient_privilege'
      using errcode = '42501';
  end if;

  if jsonb_typeof(p_content) is distinct from 'object'
     or not (
       p_content ? 'displayName'
       and p_content ? 'title'
       and p_content ? 'phone'
       and p_content ? 'email'
       and p_content ? 'wechat'
     )
     or exists (
       select 1
       from jsonb_object_keys(p_content) as contact_field(key)
       where not (
         contact_field.key = any (
           array['displayName', 'title', 'phone', 'email', 'wechat']::text[]
         )
       )
     ) then
    raise exception 'contact_card_invalid'
      using errcode = '22023';
  end if;

  if jsonb_typeof(p_content -> 'displayName') is distinct from 'string'
     or jsonb_typeof(p_content -> 'title') is distinct from 'string'
     or jsonb_typeof(p_content -> 'phone') not in ('string', 'null')
     or jsonb_typeof(p_content -> 'email') not in ('string', 'null')
     or jsonb_typeof(p_content -> 'wechat') not in ('string', 'null') then
    raise exception 'contact_card_invalid'
      using errcode = '22023';
  end if;

  v_display_name := btrim(p_content ->> 'displayName');
  v_title := btrim(p_content ->> 'title');
  v_phone := nullif(btrim(p_content ->> 'phone'), '');
  v_email := nullif(btrim(p_content ->> 'email'), '');
  v_wechat := nullif(btrim(p_content ->> 'wechat'), '');

  if char_length(v_display_name) not between 1 and 40
     or char_length(v_title) > 40
     or char_length(v_phone) > 30
     or char_length(v_email) > 120
     or char_length(v_wechat) > 60
     or (v_email is not null and v_email !~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')
     or (v_phone is null and v_email is null and v_wechat is null) then
    raise exception 'contact_card_invalid'
      using errcode = '22023';
  end if;

  insert into public.organization_contact_cards (
    organization_id,
    display_name,
    title,
    phone,
    email,
    wechat,
    status,
    created_by,
    updated_by
  ) values (
    p_organization_id,
    v_display_name,
    v_title,
    v_phone,
    v_email,
    v_wechat,
    'active',
    v_actor_user_id,
    v_actor_user_id
  )
  returning * into v_card;

  select profile.full_name
  into v_actor_name
  from public.profiles as profile
  where profile.id = v_actor_user_id;

  insert into public.audit_logs (
    organization_id,
    actor_user_id,
    actor_name,
    actor_role,
    action,
    module,
    object_type,
    object_id,
    object_name,
    before_json,
    after_json,
    changed_fields
  ) values (
    p_organization_id,
    v_actor_user_id,
    v_actor_name,
    'owner'::public.app_role,
    'create'::public.audit_action,
    'organization_brand',
    'organization_contact_card',
    v_card.id,
    v_card.display_name,
    '{}'::jsonb,
    jsonb_build_object(
      'id', v_card.id,
      'displayName', v_card.display_name,
      'title', v_card.title,
      'phone', v_card.phone,
      'email', v_card.email,
      'wechat', v_card.wechat,
      'status', v_card.status,
      'createdAt', v_card.created_at,
      'updatedAt', v_card.updated_at
    ),
    array[
      'displayName', 'title', 'phone', 'email', 'wechat', 'status'
    ]::text[]
  );

  return query
  select
    v_card.id,
    v_card.organization_id,
    v_card.display_name,
    v_card.title,
    v_card.phone,
    v_card.email,
    v_card.wechat,
    v_card.status,
    v_card.created_by,
    v_card.updated_by,
    v_card.created_at,
    v_card.updated_at;
end;
$$;

create or replace function public.update_organization_contact_card(
  p_organization_id uuid,
  p_contact_card_id uuid,
  p_changes jsonb
)
returns table (
  id uuid,
  organization_id uuid,
  display_name text,
  title text,
  phone text,
  email text,
  wechat text,
  status text,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_user_id uuid := auth.uid();
  v_actor_name text;
  v_card public.organization_contact_cards%rowtype;
  v_updated public.organization_contact_cards%rowtype;
  v_display_name text;
  v_title text;
  v_phone text;
  v_email text;
  v_wechat text;
  v_status text;
  v_changed_fields text[];
begin
  if v_actor_user_id is null
     or public.current_user_role(p_organization_id)
       is distinct from 'owner'::public.app_role then
    raise exception 'insufficient_privilege'
      using errcode = '42501';
  end if;

  if jsonb_typeof(p_changes) is distinct from 'object'
     or p_changes = '{}'::jsonb
     or exists (
       select 1
       from jsonb_object_keys(p_changes) as contact_field(key)
       where not (
         contact_field.key = any (
           array[
             'displayName', 'title', 'phone', 'email', 'wechat', 'status'
           ]::text[]
         )
       )
     ) then
    raise exception 'contact_card_invalid'
      using errcode = '22023';
  end if;

  if (p_changes ? 'displayName' and jsonb_typeof(p_changes -> 'displayName') is distinct from 'string')
     or (p_changes ? 'title' and jsonb_typeof(p_changes -> 'title') is distinct from 'string')
     or (p_changes ? 'phone' and jsonb_typeof(p_changes -> 'phone') not in ('string', 'null'))
     or (p_changes ? 'email' and jsonb_typeof(p_changes -> 'email') not in ('string', 'null'))
     or (p_changes ? 'wechat' and jsonb_typeof(p_changes -> 'wechat') not in ('string', 'null'))
     or (p_changes ? 'status' and jsonb_typeof(p_changes -> 'status') is distinct from 'string') then
    raise exception 'contact_card_invalid'
      using errcode = '22023';
  end if;

  select card.*
  into v_card
  from public.organization_contact_cards as card
  where card.id = p_contact_card_id
    and card.organization_id = p_organization_id
  for update;

  if not found then
    raise exception 'contact_card_not_found'
      using errcode = 'P0002';
  end if;

  v_display_name := case
    when p_changes ? 'displayName' then btrim(p_changes ->> 'displayName')
    else v_card.display_name
  end;
  v_title := case
    when p_changes ? 'title' then btrim(p_changes ->> 'title')
    else v_card.title
  end;
  v_phone := case
    when p_changes ? 'phone' then nullif(btrim(p_changes ->> 'phone'), '')
    else v_card.phone
  end;
  v_email := case
    when p_changes ? 'email' then nullif(btrim(p_changes ->> 'email'), '')
    else v_card.email
  end;
  v_wechat := case
    when p_changes ? 'wechat' then nullif(btrim(p_changes ->> 'wechat'), '')
    else v_card.wechat
  end;
  v_status := case
    when p_changes ? 'status' then btrim(p_changes ->> 'status')
    else v_card.status
  end;

  if char_length(v_display_name) not between 1 and 40
     or char_length(v_title) > 40
     or char_length(v_phone) > 30
     or char_length(v_email) > 120
     or char_length(v_wechat) > 60
     or (v_email is not null and v_email !~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')
     or v_status not in ('active', 'disabled')
     or (v_phone is null and v_email is null and v_wechat is null) then
    raise exception 'contact_card_invalid'
      using errcode = '22023';
  end if;

  v_changed_fields := array_remove(array[
    case when v_display_name is distinct from v_card.display_name then 'displayName' end,
    case when v_title is distinct from v_card.title then 'title' end,
    case when v_phone is distinct from v_card.phone then 'phone' end,
    case when v_email is distinct from v_card.email then 'email' end,
    case when v_wechat is distinct from v_card.wechat then 'wechat' end,
    case when v_status is distinct from v_card.status then 'status' end
  ]::text[], null);

  if cardinality(v_changed_fields) = 0 then
    v_updated := v_card;
  else
    update public.organization_contact_cards
    set
      display_name = v_display_name,
      title = v_title,
      phone = v_phone,
      email = v_email,
      wechat = v_wechat,
      status = v_status,
      updated_by = v_actor_user_id
    where organization_contact_cards.id = p_contact_card_id
      and organization_contact_cards.organization_id = p_organization_id
    returning * into v_updated;

    select profile.full_name
    into v_actor_name
    from public.profiles as profile
    where profile.id = v_actor_user_id;

    insert into public.audit_logs (
      organization_id,
      actor_user_id,
      actor_name,
      actor_role,
      action,
      module,
      object_type,
      object_id,
      object_name,
      before_json,
      after_json,
      changed_fields
    ) values (
      p_organization_id,
      v_actor_user_id,
      v_actor_name,
      'owner'::public.app_role,
      'update'::public.audit_action,
      'organization_brand',
      'organization_contact_card',
      v_updated.id,
      v_updated.display_name,
      jsonb_build_object(
        'id', v_card.id,
        'displayName', v_card.display_name,
        'title', v_card.title,
        'phone', v_card.phone,
        'email', v_card.email,
        'wechat', v_card.wechat,
        'status', v_card.status,
        'createdAt', v_card.created_at,
        'updatedAt', v_card.updated_at
      ),
      jsonb_build_object(
        'id', v_updated.id,
        'displayName', v_updated.display_name,
        'title', v_updated.title,
        'phone', v_updated.phone,
        'email', v_updated.email,
        'wechat', v_updated.wechat,
        'status', v_updated.status,
        'createdAt', v_updated.created_at,
        'updatedAt', v_updated.updated_at
      ),
      v_changed_fields
    );
  end if;

  return query
  select
    v_updated.id,
    v_updated.organization_id,
    v_updated.display_name,
    v_updated.title,
    v_updated.phone,
    v_updated.email,
    v_updated.wechat,
    v_updated.status,
    v_updated.created_by,
    v_updated.updated_by,
    v_updated.created_at,
    v_updated.updated_at;
end;
$$;

create or replace function public.publish_organization_brand(
  p_organization_id uuid,
  p_expected_version integer,
  p_expected_draft_revision integer
)
returns table (
  organization_id uuid,
  version integer,
  content jsonb,
  published_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_user_id uuid := auth.uid();
  v_actor_name text;
  v_organization public.organizations%rowtype;
  v_draft public.organization_brand_drafts%rowtype;
  v_next_version integer;
  v_published_at timestamptz := clock_timestamp();
  v_logo_text text;
  v_logo_storage_path text;
  v_brand_name text;
  v_brand_tagline text;
  v_primary_color text;
  v_action_color text := '#123A8C';
  v_soft_color text;
  v_published jsonb;
  v_red integer;
  v_green integer;
  v_blue integer;
  v_action_red integer;
  v_action_green integer;
  v_action_blue integer;
  v_soft_red integer;
  v_soft_green integer;
  v_soft_blue integer;
  v_channel_red numeric;
  v_channel_green numeric;
  v_channel_blue numeric;
  v_linear_red numeric;
  v_linear_green numeric;
  v_linear_blue numeric;
  v_luminance numeric;
begin
  if v_actor_user_id is null
     or public.current_user_role(p_organization_id)
       is distinct from 'owner'::public.app_role then
    raise exception 'insufficient_privilege'
      using errcode = '42501';
  end if;

  select organization.*
  into v_organization
  from public.organizations as organization
  where organization.id = p_organization_id
  for update;

  if not found then
    raise exception 'insufficient_privilege'
      using errcode = '42501';
  end if;

  if p_expected_version is distinct from v_organization.branding_version then
    raise exception 'brand_version_conflict'
      using errcode = '40001';
  end if;

  select draft.*
  into v_draft
  from public.organization_brand_drafts as draft
  where draft.organization_id = p_organization_id
  for update;

  if not found then
    raise exception 'brand_draft_not_found'
      using errcode = 'P0002';
  end if;

  if v_draft.base_version is distinct from v_organization.branding_version then
    raise exception 'brand_version_conflict'
      using errcode = '40001';
  end if;

  if p_expected_draft_revision is null
     or p_expected_draft_revision < 0 then
    raise exception 'brand_draft_invalid_expected_revision'
      using errcode = '22023';
  end if;

  if p_expected_draft_revision is distinct from v_draft.draft_revision then
    raise exception 'brand_draft_conflict'
      using errcode = '40001';
  end if;

  if v_organization.branding_version >= 2147483647 then
    raise exception 'brand_version_overflow'
      using errcode = '22003';
  end if;

  if jsonb_typeof(v_draft.content) is distinct from 'object' then
    raise exception 'brand_draft_invalid'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_object_keys(v_draft.content) as draft_field(key)
    where not (
      draft_field.key = any (
        array[
          'logoText',
          'logoStoragePath',
          'brandName',
          'brandTagline',
          'primaryColor'
        ]::text[]
      )
    )
  ) then
    raise exception 'brand_draft_unknown_field'
      using errcode = '22023';
  end if;

  if jsonb_typeof(v_draft.content -> 'logoText') is distinct from 'string'
     or jsonb_typeof(v_draft.content -> 'brandName') is distinct from 'string'
     or jsonb_typeof(v_draft.content -> 'brandTagline') is distinct from 'string'
     or jsonb_typeof(v_draft.content -> 'primaryColor') is distinct from 'string'
     or jsonb_typeof(v_draft.content -> 'logoStoragePath') is null
     or jsonb_typeof(v_draft.content -> 'logoStoragePath')
       not in ('string', 'null') then
    raise exception 'brand_draft_invalid_type'
      using errcode = '22023';
  end if;

  v_logo_text := btrim(v_draft.content ->> 'logoText');
  v_logo_storage_path := nullif(
    btrim(v_draft.content ->> 'logoStoragePath'),
    ''
  );
  v_brand_name := btrim(v_draft.content ->> 'brandName');
  v_brand_tagline := btrim(v_draft.content ->> 'brandTagline');
  v_primary_color := upper(btrim(v_draft.content ->> 'primaryColor'));

  if char_length(v_logo_text) not between 1 and 8
     or char_length(v_brand_name) not between 1 and 40
     or char_length(v_brand_tagline) > 80 then
    raise exception 'brand_draft_invalid_length'
      using errcode = '22023';
  end if;

  if v_primary_color !~ '^#[0-9A-F]{6}$' then
    raise exception 'brand_draft_invalid_color'
      using errcode = '22023';
  end if;

  if v_logo_storage_path is not null
     and v_logo_storage_path !~* format(
       '^%s/brand-logos/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.webp$',
       p_organization_id::text
     ) then
    raise exception 'brand_draft_invalid_logo_path'
      using errcode = '22023';
  end if;

  v_next_version := v_organization.branding_version + 1;

  v_red := get_byte(decode(substr(v_primary_color, 2, 6), 'hex'), 0);
  v_green := get_byte(decode(substr(v_primary_color, 2, 6), 'hex'), 1);
  v_blue := get_byte(decode(substr(v_primary_color, 2, 6), 'hex'), 2);

  for v_step in 0..20 loop
    v_action_red := round(v_red * (1 - v_step * 0.04))::integer;
    v_action_green := round(v_green * (1 - v_step * 0.04))::integer;
    v_action_blue := round(v_blue * (1 - v_step * 0.04))::integer;

    v_channel_red := v_action_red / 255.0;
    v_channel_green := v_action_green / 255.0;
    v_channel_blue := v_action_blue / 255.0;

    v_linear_red := case
      when v_channel_red <= 0.03928 then v_channel_red / 12.92
      else power((v_channel_red + 0.055) / 1.055, 2.4)
    end;
    v_linear_green := case
      when v_channel_green <= 0.03928 then v_channel_green / 12.92
      else power((v_channel_green + 0.055) / 1.055, 2.4)
    end;
    v_linear_blue := case
      when v_channel_blue <= 0.03928 then v_channel_blue / 12.92
      else power((v_channel_blue + 0.055) / 1.055, 2.4)
    end;

    v_luminance :=
      0.2126 * v_linear_red
      + 0.7152 * v_linear_green
      + 0.0722 * v_linear_blue;

    if 1.05 / (v_luminance + 0.05) >= 4.5 then
      v_action_color := upper(format(
        '#%s%s%s',
        lpad(to_hex(v_action_red), 2, '0'),
        lpad(to_hex(v_action_green), 2, '0'),
        lpad(to_hex(v_action_blue), 2, '0')
      ));
      exit;
    end if;
  end loop;

  v_soft_red := round(v_red * 0.12 + 255 * 0.88)::integer;
  v_soft_green := round(v_green * 0.12 + 255 * 0.88)::integer;
  v_soft_blue := round(v_blue * 0.12 + 255 * 0.88)::integer;
  v_soft_color := upper(format(
    '#%s%s%s',
    lpad(to_hex(v_soft_red), 2, '0'),
    lpad(to_hex(v_soft_green), 2, '0'),
    lpad(to_hex(v_soft_blue), 2, '0')
  ));

  v_published := jsonb_build_object(
    'schemaVersion', 1,
    'version', v_next_version,
    'logoText', v_logo_text,
    'logoStoragePath', v_logo_storage_path,
    'brandName', v_brand_name,
    'brandTagline', v_brand_tagline,
    'primaryColor', v_primary_color,
    'actionColor', v_action_color,
    'softColor', v_soft_color,
    'publishedAt', v_published_at,
    'semantic', jsonb_build_object(
      'success', '#00B42A',
      'warning', '#FF7D00',
      'danger', '#F53F3F',
      'info', '#165DFF'
    )
  );

  insert into public.organization_brand_versions (
    organization_id,
    version,
    content,
    published_by,
    published_at
  ) values (
    p_organization_id,
    v_next_version,
    v_published,
    v_actor_user_id,
    v_published_at
  );

  update public.organizations
  set
    branding = v_published,
    branding_version = v_next_version
  where id = p_organization_id;

  delete from public.organization_brand_drafts as draft_to_delete
  where draft_to_delete.organization_id = p_organization_id;

  select profile.full_name
  into v_actor_name
  from public.profiles as profile
  where profile.id = v_actor_user_id;

  insert into public.audit_logs (
    organization_id,
    actor_user_id,
    actor_name,
    actor_role,
    action,
    module,
    object_type,
    object_id,
    object_name,
    before_json,
    after_json,
    changed_fields
  ) values (
    p_organization_id,
    v_actor_user_id,
    v_actor_name,
    'owner'::public.app_role,
    'publish'::public.audit_action,
    'organization_brand',
    'organization_brand',
    p_organization_id,
    v_organization.name,
    jsonb_build_object(
      'version', v_organization.branding_version,
      'content', v_organization.branding
    ),
    jsonb_build_object(
      'version', v_next_version,
      'content', v_published
    ),
    array['branding', 'branding_version']::text[]
  );

  return query
  select
    p_organization_id,
    v_next_version,
    v_published,
    v_published_at;
end;
$$;

create or replace function public.emergency_remove_contact_card_from_shares(
  p_organization_id uuid,
  p_contact_card_id uuid,
  p_reason text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_user_id uuid := auth.uid();
  v_actor_name text;
  v_card public.organization_contact_cards%rowtype;
  v_now timestamptz := clock_timestamp();
  v_affected_count integer := 0;
begin
  if v_actor_user_id is null
     or public.current_user_role(p_organization_id)
       is distinct from 'owner'::public.app_role then
    raise exception 'insufficient_privilege'
      using errcode = '42501';
  end if;

  if p_reason is null
     or nullif(btrim(p_reason), '') is null then
    raise exception 'contact_card_emergency_reason_required'
      using errcode = '22023';
  end if;

  select card.*
  into v_card
  from public.organization_contact_cards as card
  where card.id = p_contact_card_id
  for update;

  if not found
     or v_card.organization_id is distinct from p_organization_id then
    raise exception 'contact_card_not_found'
      using errcode = 'P0002';
  end if;

  update public.project_recording_share_boards as board
  set
    contact_card_id = null,
    contact_card_snapshot = null
  where board.organization_id = p_organization_id
    and board.contact_card_id = p_contact_card_id
    and board.status = 'active'
    and board.expires_at > v_now
    and board.revoked_at is null;

  get diagnostics v_affected_count = row_count;

  select profile.full_name
  into v_actor_name
  from public.profiles as profile
  where profile.id = v_actor_user_id;

  insert into public.audit_logs (
    organization_id,
    actor_user_id,
    actor_name,
    actor_role,
    action,
    module,
    object_type,
    object_id,
    object_name,
    reason,
    is_high_risk,
    before_json,
    after_json,
    changed_fields
  ) values (
    p_organization_id,
    v_actor_user_id,
    v_actor_name,
    'owner'::public.app_role,
    'update'::public.audit_action,
    'organization_brand',
    'organization_contact_card',
    v_card.id,
    v_card.display_name,
    btrim(p_reason),
    true,
    jsonb_build_object(
      'contactCardId', v_card.id,
      'affectedActiveShareCount', v_affected_count
    ),
    jsonb_build_object(
      'contactCardId', null,
      'affectedActiveShareCount', v_affected_count
    ),
    array['contact_card_id', 'contact_card_snapshot']::text[]
  );

  return v_affected_count;
end;
$$;

revoke all on function public.publish_organization_brand(uuid, integer, integer) from public, anon, authenticated, service_role;
revoke all on function public.create_organization_contact_card(uuid, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.update_organization_contact_card(uuid, uuid, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.emergency_remove_contact_card_from_shares(uuid, uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.guard_organization_contact_card_identity() from public, anon, authenticated, service_role;
revoke all on function public.guard_recording_share_contact_card() from public, anon, authenticated, service_role;

grant execute on function public.publish_organization_brand(uuid, integer, integer) to authenticated;
grant execute on function public.create_organization_contact_card(uuid, jsonb) to authenticated;
grant execute on function public.update_organization_contact_card(uuid, uuid, jsonb) to authenticated;
grant execute on function public.emergency_remove_contact_card_from_shares(uuid, uuid, text) to authenticated;
