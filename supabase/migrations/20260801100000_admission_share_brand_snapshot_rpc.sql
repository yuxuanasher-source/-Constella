alter table public.project_recording_share_boards
  add column if not exists brand_snapshot jsonb,
  add column if not exists brand_version integer,
  add column if not exists contact_card_id uuid,
  add column if not exists contact_card_snapshot jsonb;

update public.project_recording_share_boards as board
set
  brand_snapshot = coalesce(board.brand_snapshot, jsonb_build_object(
    'schemaVersion', 1,
    'version', organization.branding_version,
    'logoText', left(
      coalesce(
        nullif(btrim(brand.source->>'logoText'), ''),
        left(btrim(organization.name), 2)
      ),
      8
    ),
    'logoStoragePath', case
      when nullif(btrim(brand.source->>'logoStoragePath'), '') ~* format(
        '^%s/brand-logos/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.webp$',
        organization.id::text
      ) then btrim(brand.source->>'logoStoragePath')
      else null
    end,
    'brandName', left(
      coalesce(
        nullif(btrim(brand.source->>'brandName'), ''),
        btrim(organization.name)
      ),
      40
    ),
    'brandTagline', left(coalesce(btrim(brand.source->>'brandTagline'), ''), 80),
    'primaryColor', case
      when btrim(brand.source->>'primaryColor') ~ '^#[0-9a-fA-F]{6}$'
        then upper(btrim(brand.source->>'primaryColor'))
      else '#165DFF'
    end,
    'publishedAt', case
      when char_length(btrim(brand.source->>'publishedAt')) <= 32
        and btrim(brand.source->>'publishedAt') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
        then btrim(brand.source->>'publishedAt')
      else null
    end
  )),
  brand_version = coalesce(board.brand_version, organization.branding_version)
from public.organizations as organization
cross join lateral (
  select case
    when jsonb_typeof(organization.branding) = 'object'
      and (
        not (organization.branding ? 'schemaVersion')
        or organization.branding->'schemaVersion' = '1'::jsonb
      )
      then organization.branding
    else '{}'::jsonb
  end as source
) as brand
where organization.id = board.organization_id
  and (
    board.brand_snapshot is null
    or board.brand_version is null
  );

alter table public.project_recording_share_boards
  alter column brand_snapshot set not null,
  alter column brand_version set not null;

create or replace function public.record_admission_share_board_created_event()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  insert into public.project_recording_share_events (
    share_board_id,
    organization_id,
    project_id,
    event_type,
    actor_type,
    actor_user_id,
    metadata,
    created_at
  ) values (
    new.id,
    new.organization_id,
    new.project_id,
    'created',
    'staff',
    new.created_by,
    jsonb_build_object(
      'mode', new.mode,
      'round_number', new.round_number,
      'brandVersion', new.brand_version,
      'contactCardId', new.contact_card_id
    ),
    new.created_at
  );

  return new;
end;
$$;

create or replace function public.lock_admission_share_organization_brand(
  p_organization_id uuid
)
returns table (
  organization_name text,
  branding jsonb,
  branding_version integer
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null
     or not public.is_mcn_staff(p_organization_id) then
    raise exception 'insufficient_privilege'
      using errcode = '42501';
  end if;

  return query
  select
    organization.name,
    organization.branding,
    organization.branding_version
  from public.organizations as organization
  where organization.id = p_organization_id
  for update;

  if not found then
    raise exception 'insufficient_privilege'
      using errcode = '42501';
  end if;
end;
$$;

alter function public.lock_admission_share_organization_brand(uuid)
owner to postgres;

revoke all on function public.lock_admission_share_organization_brand(uuid)
from public, anon, authenticated, service_role;
grant execute on function public.lock_admission_share_organization_brand(uuid)
to authenticated;

create or replace function public.lock_admission_share_contact_card(
  p_organization_id uuid,
  p_contact_card_id uuid
)
returns table (
  contact_card_id uuid,
  contact_card_snapshot jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null
     or not public.is_mcn_staff(p_organization_id) then
    raise exception 'insufficient_privilege'
      using errcode = '42501';
  end if;

  return query
  select
    card.id,
    jsonb_strip_nulls(jsonb_build_object(
      'displayName', btrim(card.display_name),
      'title', nullif(btrim(card.title), ''),
      'phone', nullif(btrim(card.phone), ''),
      'email', nullif(btrim(card.email), ''),
      'wechat', nullif(btrim(card.wechat), '')
    ))
  from public.organization_contact_cards as card
  where card.id = p_contact_card_id
    and card.organization_id = p_organization_id
    and card.status = 'active'
  for share;

  if not found then
    raise exception 'invalid_organization_contact_card';
  end if;
end;
$$;

alter function public.lock_admission_share_contact_card(uuid, uuid)
owner to postgres;

revoke all on function public.lock_admission_share_contact_card(uuid, uuid)
from public, anon, authenticated, service_role;
grant execute on function public.lock_admission_share_contact_card(uuid, uuid)
to authenticated;

create or replace function public.guard_recording_share_contact_card()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_contact_card_id uuid;
  v_contact_card_snapshot jsonb;
begin
  if tg_op = 'INSERT' then
    if new.contact_card_id is null then
      new.contact_card_snapshot := null;
      return new;
    end if;

    if current_user = 'postgres' then
      select
        card.id,
        jsonb_strip_nulls(jsonb_build_object(
          'displayName', btrim(card.display_name),
          'title', nullif(btrim(card.title), ''),
          'phone', nullif(btrim(card.phone), ''),
          'email', nullif(btrim(card.email), ''),
          'wechat', nullif(btrim(card.wechat), '')
        ))
      into v_contact_card_id, v_contact_card_snapshot
      from public.organization_contact_cards as card
      where card.id = new.contact_card_id
        and card.organization_id = new.organization_id
        and card.status = 'active'
      for share;
    else
      select
        locked.contact_card_id,
        locked.contact_card_snapshot
      into v_contact_card_id, v_contact_card_snapshot
      from public.lock_admission_share_contact_card(
        new.organization_id,
        new.contact_card_id
      ) as locked;
    end if;

    if not found then
      raise exception 'organization_contact_card_not_active'
        using errcode = '23503';
    end if;

    new.contact_card_id := v_contact_card_id;
    new.contact_card_snapshot := v_contact_card_snapshot;
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

revoke all on function public.guard_recording_share_contact_card()
from public, anon, authenticated, service_role;

drop function if exists public.create_admission_share_board(
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  text,
  timestamptz,
  boolean,
  uuid,
  jsonb
);

create or replace function public.create_admission_share_board(
  p_organization_id uuid,
  p_project_id uuid,
  p_title text,
  p_purpose text,
  p_mode text,
  p_token_hash text,
  p_access_code_hash text,
  p_expires_at timestamptz,
  p_allow_external_fallback boolean,
  p_created_by uuid,
  p_items jsonb,
  p_contact_card_id uuid
)
returns public.project_recording_share_boards
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_board public.project_recording_share_boards%rowtype;
  v_organization_name text;
  v_organization_branding jsonb;
  v_brand_source jsonb;
  v_brand_snapshot jsonb;
  v_brand_version integer;
  v_contact_card_id uuid;
  v_contact_card_snapshot jsonb;
  v_round_number integer;
  v_item_count integer;
  v_recording_count integer;
  v_sort_order_count integer;
  selected_item record;
begin
  if p_mode is null
     or p_mode not in ('preview', 'formal_review') then
    raise exception 'invalid_admission_share_mode';
  end if;

  if nullif(btrim(p_title), '') is null
     or nullif(btrim(p_token_hash), '') is null then
    raise exception 'invalid_admission_share_board';
  end if;

  if p_expires_at is null
     or p_expires_at < v_now + interval '1 day'
     or p_expires_at > v_now + interval '30 days' then
    raise exception 'invalid_admission_share_expiry';
  end if;

  if jsonb_typeof(p_items) is distinct from 'array'
     or jsonb_array_length(p_items) = 0 then
    raise exception 'admission_share_items_required';
  end if;

  if auth.uid() is null
     or p_created_by is distinct from auth.uid()
     or not public.is_mcn_staff(p_organization_id)
     or not public.can_access_project(p_project_id) then
    raise exception 'insufficient_privilege'
      using errcode = '42501';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_project_id::text, 0)
  );

  perform 1
  from public.projects as project
  where project.id = p_project_id
    and project.organization_id = p_organization_id;

  if not found then
    raise exception 'insufficient_privilege'
      using errcode = '42501';
  end if;

  select
    locked.organization_name,
    locked.branding,
    locked.branding_version
  into
    v_organization_name,
    v_organization_branding,
    v_brand_version
  from public.lock_admission_share_organization_brand(p_organization_id) as locked;

  if not found then
    raise exception 'insufficient_privilege'
      using errcode = '42501';
  end if;

  v_brand_source := case
    when jsonb_typeof(v_organization_branding) = 'object'
      and (
        not (v_organization_branding ? 'schemaVersion')
        or v_organization_branding->'schemaVersion' = '1'::jsonb
      )
      then v_organization_branding
    else '{}'::jsonb
  end;
  v_brand_snapshot := jsonb_build_object(
    'schemaVersion', 1,
    'version', v_brand_version,
    'logoText', left(
      coalesce(
        nullif(btrim(v_brand_source->>'logoText'), ''),
        left(btrim(v_organization_name), 2)
      ),
      8
    ),
    'logoStoragePath', case
      when nullif(btrim(v_brand_source->>'logoStoragePath'), '') ~* format(
        '^%s/brand-logos/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.webp$',
        p_organization_id::text
      ) then btrim(v_brand_source->>'logoStoragePath')
      else null
    end,
    'brandName', left(
      coalesce(
        nullif(btrim(v_brand_source->>'brandName'), ''),
        btrim(v_organization_name)
      ),
      40
    ),
    'brandTagline', left(coalesce(btrim(v_brand_source->>'brandTagline'), ''), 80),
    'primaryColor', case
      when btrim(v_brand_source->>'primaryColor') ~ '^#[0-9a-fA-F]{6}$'
        then upper(btrim(v_brand_source->>'primaryColor'))
      else '#165DFF'
    end,
    'publishedAt', case
      when char_length(btrim(v_brand_source->>'publishedAt')) <= 32
        and btrim(v_brand_source->>'publishedAt') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
        then btrim(v_brand_source->>'publishedAt')
      else null
    end
  );

  if p_contact_card_id is not null then
    select
      locked.contact_card_id,
      locked.contact_card_snapshot
    into v_contact_card_id, v_contact_card_snapshot
    from public.lock_admission_share_contact_card(
      p_organization_id,
      p_contact_card_id
    ) as locked;

    if not found then
      raise exception 'invalid_organization_contact_card';
    end if;
  end if;

  update public.project_recording_share_boards
  set status = 'expired'
  where organization_id = p_organization_id
    and project_id = p_project_id
    and status = 'active'
    and expires_at <= v_now;

  if p_mode = 'formal_review' then
    perform 1
    from public.project_recording_share_boards
    where organization_id = p_organization_id
      and project_id = p_project_id
      and mode = 'formal_review'
      and status = 'active'
      and locked_at is null;

    if found then
      raise exception 'admission_share_formal_round_already_open';
    end if;
  end if;

  select
    count(*),
    count(distinct item.recording_submission_id),
    count(distinct item.sort_order)
  into v_item_count, v_recording_count, v_sort_order_count
  from jsonb_to_recordset(p_items) as item(
    application_id uuid,
    recording_submission_id uuid,
    recording_version integer,
    sort_order integer
  );

  if v_item_count <> jsonb_array_length(p_items)
     or v_recording_count <> v_item_count
     or v_sort_order_count <> v_item_count then
    raise exception 'invalid_admission_share_items';
  end if;

  for selected_item in
    select item.*
    from jsonb_to_recordset(p_items) as item(
      application_id uuid,
      recording_submission_id uuid,
      recording_version integer,
      sort_order integer
    )
  loop
    if selected_item.recording_version is null
       or selected_item.recording_version <= 0
       or selected_item.sort_order is null
       or selected_item.sort_order < 0 then
      raise exception 'invalid_admission_share_item';
    end if;

    perform 1
    from public.recording_submissions as recording
    join public.project_applications as application
      on application.id = selected_item.application_id
    where recording.id = selected_item.recording_submission_id
      and recording.application_id = selected_item.application_id
      and recording.project_id = p_project_id
      and application.project_id = p_project_id
      and recording.version = selected_item.recording_version
      and recording.mcn_review_decision = 'approved'
      and (
        nullif(btrim(recording.storage_path), '') is not null
        or recording.external_url ~* '^https?://[^[:space:]/?#]+[^[:space:]]*$'
      );

    if not found then
      raise exception 'admission_share_selection_changed';
    end if;
  end loop;

  if p_mode = 'formal_review' then
    select coalesce(max(board.round_number), 0) + 1
    into v_round_number
    from public.project_recording_share_boards as board
    where board.organization_id = p_organization_id
      and board.project_id = p_project_id
      and board.mode = 'formal_review';
  else
    v_round_number := 0;
  end if;

  insert into public.project_recording_share_boards (
    organization_id,
    project_id,
    title,
    purpose,
    mode,
    token_hash,
    access_code_hash,
    status,
    expires_at,
    allow_vendor_submit,
    allow_external_fallback,
    review_state,
    round_number,
    created_by,
    brand_snapshot,
    brand_version,
    contact_card_id,
    contact_card_snapshot
  ) values (
    p_organization_id,
    p_project_id,
    btrim(p_title),
    coalesce(btrim(p_purpose), ''),
    p_mode,
    p_token_hash,
    p_access_code_hash,
    'active',
    p_expires_at,
    p_mode = 'formal_review',
    coalesce(p_allow_external_fallback, true),
    'not_started',
    v_round_number,
    p_created_by,
    v_brand_snapshot,
    v_brand_version,
    v_contact_card_id,
    v_contact_card_snapshot
  )
  returning * into v_board;

  insert into public.project_recording_share_items (
    share_board_id,
    organization_id,
    project_id,
    application_id,
    recording_submission_id,
    recording_version,
    sort_order,
    mcn_review_decision,
    source_health,
    allow_external_fallback
  )
  select
    v_board.id,
    p_organization_id,
    p_project_id,
    payload_item.application_id,
    payload_item.recording_submission_id,
    payload_item.recording_version,
    payload_item.sort_order,
    recording.mcn_review_decision,
    case
      when nullif(btrim(recording.storage_path), '') is not null
        and recording.external_url ~* '^https?://[^[:space:]/?#]+[^[:space:]]*$'
        then 'original_with_external_fallback'
      when nullif(btrim(recording.storage_path), '') is not null
        then 'original_ready'
      when recording.external_url ~* '^https?://[^[:space:]/?#]+[^[:space:]]*$'
        then 'external_only'
      else 'blocked'
    end,
    coalesce(p_allow_external_fallback, true)
  from jsonb_to_recordset(p_items) as payload_item(
    application_id uuid,
    recording_submission_id uuid,
    recording_version integer,
    sort_order integer
  )
  join public.recording_submissions as recording
    on recording.id = payload_item.recording_submission_id
  order by payload_item.sort_order;

  return v_board;
end;
$$;

revoke all on function public.create_admission_share_board(
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  text,
  timestamptz,
  boolean,
  uuid,
  jsonb,
  uuid
) from public, anon;

grant execute on function public.create_admission_share_board(
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  text,
  timestamptz,
  boolean,
  uuid,
  jsonb,
  uuid
) to authenticated;
