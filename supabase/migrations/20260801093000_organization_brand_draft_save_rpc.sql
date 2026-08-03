-- deploy: expand

create or replace function public.save_organization_brand_draft(
  p_organization_id uuid,
  p_expected_version integer,
  p_expected_draft_revision integer,
  p_content jsonb
)
returns table (
  organization_id uuid,
  base_version integer,
  draft_revision integer,
  content jsonb,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_user_id uuid := auth.uid();
  v_organization public.organizations%rowtype;
  v_draft public.organization_brand_drafts%rowtype;
  v_has_draft boolean := false;
  v_next_draft_revision integer;
  v_logo_text text;
  v_logo_storage_path text;
  v_brand_name text;
  v_brand_tagline text;
  v_primary_color text;
  v_canonical_content jsonb;
  v_updated_at timestamptz := clock_timestamp();
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

  if p_expected_version is null
     or p_expected_version < 0
     or p_expected_draft_revision is null
     or p_expected_draft_revision < 0 then
    raise exception 'brand_draft_invalid_expected_version'
      using errcode = '22023';
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

  v_has_draft := found;
  if v_has_draft then
    if p_expected_draft_revision is distinct from v_draft.draft_revision then
      raise exception 'brand_draft_conflict'
        using errcode = '40001';
    end if;
    if v_draft.draft_revision >= 2147483647 then
      raise exception 'brand_draft_revision_overflow'
        using errcode = '22003';
    end if;
    v_next_draft_revision := v_draft.draft_revision + 1;
  else
    if p_expected_draft_revision is distinct from 0 then
      raise exception 'brand_draft_conflict'
        using errcode = '40001';
    end if;
    v_next_draft_revision := 1;
  end if;

  if jsonb_typeof(p_content) is distinct from 'object' then
    raise exception 'brand_draft_invalid'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_object_keys(p_content) as draft_field(key)
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

  if jsonb_typeof(p_content -> 'logoText') is distinct from 'string'
     or jsonb_typeof(p_content -> 'brandName') is distinct from 'string'
     or jsonb_typeof(p_content -> 'brandTagline') is distinct from 'string'
     or jsonb_typeof(p_content -> 'primaryColor') is distinct from 'string'
     or jsonb_typeof(p_content -> 'logoStoragePath') is null
     or jsonb_typeof(p_content -> 'logoStoragePath')
       not in ('string', 'null') then
    raise exception 'brand_draft_invalid_type'
      using errcode = '22023';
  end if;

  v_logo_text := btrim(p_content ->> 'logoText');
  v_logo_storage_path := nullif(
    btrim(p_content ->> 'logoStoragePath'),
    ''
  );
  v_brand_name := btrim(p_content ->> 'brandName');
  v_brand_tagline := btrim(p_content ->> 'brandTagline');
  v_primary_color := upper(btrim(p_content ->> 'primaryColor'));

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

  v_canonical_content := jsonb_build_object(
    'logoText', v_logo_text,
    'logoStoragePath', v_logo_storage_path,
    'brandName', v_brand_name,
    'brandTagline', v_brand_tagline,
    'primaryColor', v_primary_color
  );

  if v_has_draft then
    update public.organization_brand_drafts as draft_to_update
    set
      base_version = v_organization.branding_version,
      draft_revision = v_next_draft_revision,
      content = v_canonical_content,
      updated_by = v_actor_user_id,
      updated_at = v_updated_at
    where draft_to_update.organization_id = p_organization_id;
  else
    insert into public.organization_brand_drafts (
      organization_id,
      base_version,
      draft_revision,
      content,
      updated_by,
      updated_at
    ) values (
      p_organization_id,
      v_organization.branding_version,
      v_next_draft_revision,
      v_canonical_content,
      v_actor_user_id,
      v_updated_at
    );
  end if;

  return query
  select
    p_organization_id,
    v_organization.branding_version,
    v_next_draft_revision,
    v_canonical_content,
    v_updated_at;
end;
$$;

revoke insert, update, delete
on table public.organization_brand_drafts
from authenticated;

revoke all on function public.save_organization_brand_draft(uuid, integer, integer, jsonb)
from public, anon, authenticated, service_role;

grant execute on function public.save_organization_brand_draft(uuid, integer, integer, jsonb)
to authenticated;
