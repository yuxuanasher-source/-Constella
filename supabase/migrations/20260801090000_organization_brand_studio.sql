alter table public.organizations
  add column if not exists branding_version integer not null default 0;

alter table public.organizations
  add constraint organization_branding_version_nonnegative
  check (branding_version >= 0);

create table public.organization_brand_drafts (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  base_version integer not null check (base_version >= 0),
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

create policy organization_contact_cards_owner_insert
on public.organization_contact_cards
for insert
to authenticated
with check (
  public.current_user_role(organization_id) = 'owner'
  and created_by = auth.uid()
  and updated_by = auth.uid()
);

create policy organization_contact_cards_owner_update
on public.organization_contact_cards
for update
to authenticated
using (public.current_user_role(organization_id) = 'owner')
with check (
  public.current_user_role(organization_id) = 'owner'
  and updated_by = auth.uid()
);

revoke all on table public.organization_brand_drafts from public, anon;
revoke all on table public.organization_brand_versions from public, anon;
revoke all on table public.organization_contact_cards from public, anon, authenticated;

grant select, insert, update, delete
on table public.organization_brand_drafts
to authenticated;

grant select on table public.organization_brand_versions to authenticated;
revoke insert, update, delete on table public.organization_brand_versions from anon, authenticated, service_role;

grant select, insert, update
on table public.organization_contact_cards
to authenticated;

create or replace function public.publish_organization_brand(
  p_organization_id uuid,
  p_expected_version integer
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

revoke all on function public.publish_organization_brand(uuid, integer) from public, anon, authenticated, service_role;
revoke all on function public.emergency_remove_contact_card_from_shares(uuid, uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.guard_organization_contact_card_identity() from public, anon, authenticated, service_role;
revoke all on function public.guard_recording_share_contact_card() from public, anon, authenticated, service_role;

grant execute on function public.publish_organization_brand(uuid, integer) to authenticated;
grant execute on function public.emergency_remove_contact_card_from_shares(uuid, uuid, text) to authenticated;
