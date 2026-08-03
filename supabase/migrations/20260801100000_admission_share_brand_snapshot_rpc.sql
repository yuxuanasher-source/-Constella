alter table public.project_recording_share_boards
  add column if not exists brand_snapshot jsonb,
  add column if not exists brand_version integer,
  add column if not exists contact_card_id uuid,
  add column if not exists contact_card_snapshot jsonb;

update public.project_recording_share_boards as board
set
  brand_snapshot = jsonb_build_object(
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
  ),
  brand_version = organization.branding_version
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
    or board.brand_version < 0
    or jsonb_typeof(board.brand_snapshot) is distinct from 'object'
    or board.brand_snapshot->'schemaVersion' is distinct from '1'::jsonb
    or board.brand_snapshot->'version' is distinct from to_jsonb(board.brand_version)
    or jsonb_typeof(board.brand_snapshot->'logoText') is distinct from 'string'
    or nullif(btrim(board.brand_snapshot->>'logoText'), '') is null
    or char_length(board.brand_snapshot->>'logoText') > 8
    or jsonb_typeof(board.brand_snapshot->'brandName') is distinct from 'string'
    or nullif(btrim(board.brand_snapshot->>'brandName'), '') is null
    or char_length(board.brand_snapshot->>'brandName') > 40
    or jsonb_typeof(board.brand_snapshot->'brandTagline') is distinct from 'string'
    or char_length(board.brand_snapshot->>'brandTagline') > 80
    or jsonb_typeof(board.brand_snapshot->'primaryColor') is distinct from 'string'
    or board.brand_snapshot->>'primaryColor' !~ '^#[0-9a-fA-F]{6}$'
    or (
      board.brand_snapshot->'logoStoragePath' <> 'null'::jsonb
      and (
        jsonb_typeof(board.brand_snapshot->'logoStoragePath') is distinct from 'string'
        or board.brand_snapshot->>'logoStoragePath' !~* format(
          '^%s/brand-logos/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.webp$',
          board.organization_id::text
        )
      )
    )
  );

alter table public.project_recording_share_boards
  alter column brand_snapshot set not null,
  alter column brand_version set not null;

create or replace function public.record_admission_share_board_created_event()
returns trigger
language plpgsql
security definer
set search_path = ''
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

alter function public.record_admission_share_board_created_event()
owner to postgres;
revoke all on function public.record_admission_share_board_created_event()
from public, anon, authenticated, service_role;

create or replace function public.derive_recording_share_brand_snapshot()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organization_name text;
  v_organization_branding jsonb;
  v_brand_source jsonb;
  v_brand_version integer;
begin
  if auth.uid() is not null then
    if not public.is_mcn_staff(new.organization_id) then
      raise exception 'insufficient_privilege' using errcode = '42501';
    end if;
  elsif session_user <> 'postgres' then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;

  select organization.name, organization.branding, organization.branding_version
  into v_organization_name, v_organization_branding, v_brand_version
  from public.organizations as organization
  where organization.id = new.organization_id
  for update;

  if not found then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;

  v_brand_source := case
    when jsonb_typeof(v_organization_branding) = 'object'
      and (
        not (v_organization_branding ? 'schemaVersion')
        or v_organization_branding->'schemaVersion' = '1'::jsonb
      ) then v_organization_branding
    else '{}'::jsonb
  end;

  new.brand_snapshot := jsonb_build_object(
    'schemaVersion', 1,
    'version', v_brand_version,
    'logoText', left(
      coalesce(nullif(btrim(v_brand_source->>'logoText'), ''), left(btrim(v_organization_name), 2)),
      8
    ),
    'logoStoragePath', case
      when nullif(btrim(v_brand_source->>'logoStoragePath'), '') ~* format(
        '^%s/brand-logos/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.webp$',
        new.organization_id::text
      ) then btrim(v_brand_source->>'logoStoragePath')
      else null
    end,
    'brandName', left(
      coalesce(nullif(btrim(v_brand_source->>'brandName'), ''), btrim(v_organization_name)),
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
  new.brand_version := v_brand_version;
  return new;
end;
$$;

alter function public.derive_recording_share_brand_snapshot()
owner to postgres;
revoke all on function public.derive_recording_share_brand_snapshot()
from public, anon, authenticated, service_role;

create or replace function public.guard_recording_share_brand_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.brand_snapshot is distinct from old.brand_snapshot
     or new.brand_version is distinct from old.brand_version then
    raise exception 'recording_share_brand_is_immutable'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_recording_share_brand_update()
from public, anon, authenticated, service_role;

create or replace function public.derive_recording_share_contact_card()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_contact_card_id uuid;
  v_contact_card_snapshot jsonb;
begin
  if auth.uid() is not null then
    if not public.is_mcn_staff(new.organization_id) then
      raise exception 'insufficient_privilege' using errcode = '42501';
    end if;
  elsif session_user <> 'postgres' then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;

  if new.contact_card_id is null then
    new.contact_card_snapshot := null;
    return new;
  end if;

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

  if not found then
    raise exception 'organization_contact_card_not_active'
      using errcode = '23503';
  end if;

  new.contact_card_id := v_contact_card_id;
  new.contact_card_snapshot := v_contact_card_snapshot;
  return new;
end;
$$;

alter function public.derive_recording_share_contact_card()
owner to postgres;
revoke all on function public.derive_recording_share_contact_card()
from public, anon, authenticated, service_role;

create or replace function public.guard_recording_share_contact_card_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.contact_card_id is not distinct from old.contact_card_id
     and new.contact_card_snapshot is not distinct from old.contact_card_snapshot then
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

revoke all on function public.guard_recording_share_contact_card_update()
from public, anon, authenticated, service_role;

drop trigger if exists project_recording_share_boards_guard_contact_card
on public.project_recording_share_boards;
drop trigger if exists project_recording_share_boards_derive_brand
on public.project_recording_share_boards;
drop trigger if exists project_recording_share_boards_guard_brand_update
on public.project_recording_share_boards;
drop trigger if exists project_recording_share_boards_derive_contact_card
on public.project_recording_share_boards;
drop trigger if exists project_recording_share_boards_guard_contact_card_update
on public.project_recording_share_boards;

create trigger project_recording_share_boards_derive_brand
before insert on public.project_recording_share_boards
for each row execute function public.derive_recording_share_brand_snapshot();

create trigger project_recording_share_boards_guard_brand_update
before update on public.project_recording_share_boards
for each row execute function public.guard_recording_share_brand_update();

create trigger project_recording_share_boards_derive_contact_card
before insert on public.project_recording_share_boards
for each row execute function public.derive_recording_share_contact_card();

create trigger project_recording_share_boards_guard_contact_card_update
before update on public.project_recording_share_boards
for each row execute function public.guard_recording_share_contact_card_update();

drop function if exists public.guard_recording_share_contact_card();
drop function if exists public.lock_admission_share_organization_brand(uuid);
drop function if exists public.lock_admission_share_contact_card(uuid, uuid);

create or replace function public.guard_admission_share_board_hydration_size(
  p_share_board_id uuid
)
returns boolean
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if (
    select count(*) > 5000
    from public.project_recording_share_items as item
    where item.share_board_id = p_share_board_id
  ) then
    raise exception 'admission_share_hydration_item_limit_exceeded';
  end if;
  return true;
end;
$$;

alter function public.guard_admission_share_board_hydration_size(uuid)
owner to postgres;
revoke all on function public.guard_admission_share_board_hydration_size(uuid)
from public, anon, authenticated, service_role;

create or replace function public.build_admission_share_board_hydration(
  p_share_board_id uuid
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with board as (
    select
      share_board.*,
      project.code as project_code,
      project.name as project_name,
      project.vendor_name,
      project.product_name
    from public.project_recording_share_boards as share_board
    join public.projects as project on project.id = share_board.project_id
    where share_board.id = p_share_board_id
  ),
  latest_submission as (
    select submission.*
    from public.project_recording_vendor_review_submissions as submission
    join board on board.id = submission.share_board_id
    order by submission.revision desc, submission.id desc
    limit 1
  ),
  item_payload as (
    select
      count(*)::integer as item_count,
      coalesce(
        jsonb_agg(
          jsonb_build_object(
            'applicationId', item.application_id,
            'applicationStatus', application.status,
            'recordingSubmissionId', item.recording_submission_id,
            'recordingVersion', item.recording_version,
            'recordingStatus', recording.status,
            'recordingUrl', nullif(btrim(recording.external_url), ''),
            'hasPrivateStorage', nullif(btrim(recording.storage_path), '') is not null,
            'sourceHealth', item.source_health,
            'streamer', jsonb_build_object(
              'id', streamer.id,
              'displayName', coalesce(btrim(streamer.display_name), ''),
              'accountLabel', coalesce(account.account_label, '')
            ),
            'finalReview', case
              when receipt.id is null then null
              else jsonb_build_object(
                'decision', receipt.decision,
                'remark', coalesce(btrim(receipt.remark), ''),
                'reasonCodes', to_jsonb(receipt.reason_codes),
                'submittedAt', latest.submitted_at
              )
            end
          ) order by item.sort_order, item.id
        ),
        '[]'::jsonb
      ) as items
    from board
    cross join lateral (
      select public.guard_admission_share_board_hydration_size(board.id) as allowed
    ) as hydration_guard
    join public.project_recording_share_items as item
      on item.share_board_id = board.id
    join public.project_applications as application
      on application.id = item.application_id
    join public.recording_submissions as recording
      on recording.id = item.recording_submission_id
    join public.streamers as streamer
      on streamer.id = application.streamer_id
    left join latest_submission as latest on true
    left join public.project_recording_vendor_review_submission_items as receipt
      on receipt.submission_id = latest.id
      and receipt.recording_submission_id = item.recording_submission_id
    left join lateral (
      select concat_ws(
        ' / ',
        nullif(btrim(streamer_account.platform), ''),
        nullif(btrim(streamer_account.account_handle), '')
      ) as account_label
      from public.streamer_accounts as streamer_account
      where streamer_account.streamer_id = streamer.id
      order by streamer_account.is_primary desc, streamer_account.created_at, streamer_account.id
      limit 1
    ) as account on true
    where hydration_guard.allowed
  ),
  draft_progress as (
    select count(*)::integer as completed_count
    from board
    join public.project_recording_vendor_review_drafts as draft
      on draft.share_board_id = board.id
    where draft.decision in ('selected', 'backup')
      or (
        draft.decision in ('rejected', 'needs_changes')
        and nullif(btrim(draft.remark), '') is not null
      )
  )
  select jsonb_build_object(
    'task', jsonb_build_object(
      'id', board.id,
      'title', board.title,
      'purpose', board.purpose,
      'mode', board.mode,
      'status', board.status,
      'reviewState', board.review_state,
      'roundNumber', board.round_number,
      'expiresAt', board.expires_at,
      'itemCount', item_payload.item_count,
      'draftCompletedCount', least(draft_progress.completed_count, item_payload.item_count),
      'lastViewedAt', board.last_viewed_at,
      'lastDraftAt', board.last_draft_at,
      'lastSubmittedAt', board.last_submitted_at,
      'lockedAt', board.locked_at,
      'createdBy', board.created_by,
      'createdAt', board.created_at
    ),
    'snapshot', jsonb_build_object(
      'id', board.id,
      'organizationId', board.organization_id,
      'projectId', board.project_id,
      'title', board.title,
      'purpose', board.purpose,
      'mode', board.mode,
      'status', board.status,
      'expiresAt', board.expires_at,
      'allowVendorSubmit', board.allow_vendor_submit,
      'allowExternalFallback', board.allow_external_fallback,
      'reviewState', board.review_state,
      'roundNumber', board.round_number,
      'brandSnapshot', jsonb_build_object(
        'schemaVersion', board.brand_snapshot->'schemaVersion',
        'version', board.brand_snapshot->'version',
        'logoText', board.brand_snapshot->'logoText',
        'brandName', board.brand_snapshot->'brandName',
        'brandTagline', board.brand_snapshot->'brandTagline',
        'primaryColor', board.brand_snapshot->'primaryColor',
        'publishedAt', board.brand_snapshot->'publishedAt'
      ),
      'brandVersion', board.brand_version,
      'contactCardId', board.contact_card_id,
      'contactCardSnapshot', board.contact_card_snapshot,
      'createdBy', board.created_by,
      'createdAt', board.created_at,
      'project', jsonb_build_object(
        'id', board.project_id,
        'code', coalesce(btrim(board.project_code), ''),
        'name', coalesce(btrim(board.project_name), ''),
        'vendor', coalesce(btrim(board.vendor_name), ''),
        'product', coalesce(btrim(board.product_name), '')
      ),
      'progress', jsonb_build_object(
        'completed', case
          when board.review_state = 'submitted_locked'
            and latest_submission.id is not null then item_payload.item_count
          else least(draft_progress.completed_count, item_payload.item_count)
        end,
        'total', item_payload.item_count
      ),
      'latestSubmission', case
        when latest_submission.id is null then null
        else jsonb_build_object(
          'revision', latest_submission.revision,
          'submittedAt', latest_submission.submitted_at,
          'summary', jsonb_build_object(
            'selected', latest_submission.selected_count,
            'backup', latest_submission.backup_count,
            'rejected', latest_submission.rejected_count,
            'needsChanges', latest_submission.needs_changes_count
          )
        )
      end,
      'items', item_payload.items
    )
  )
  from board
  cross join item_payload
  cross join draft_progress
  left join latest_submission on true;
$$;

alter function public.build_admission_share_board_hydration(uuid)
owner to postgres;
revoke all on function public.build_admission_share_board_hydration(uuid)
from public, anon, authenticated, service_role;

drop function if exists public.list_internal_admission_share_board_hydrations(
  uuid, timestamptz, uuid, integer
);

create or replace function public.list_internal_admission_share_board_tasks(
  p_project_id uuid,
  p_before_created_at timestamptz default null,
  p_before_id uuid default null,
  p_limit integer default 20
)
returns table (task jsonb)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null
     or not public.can_access_project(p_project_id)
     or not exists (
       select 1
       from public.projects as project
       where project.id = p_project_id
         and public.is_mcn_staff(project.organization_id)
     ) then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;

  if p_limit is null or p_limit < 1 or p_limit > 50 then
    raise exception 'admission_share_page_limit_invalid' using errcode = '22023';
  end if;

  if (p_before_created_at is null) <> (p_before_id is null) then
    raise exception 'admission_share_cursor_invalid' using errcode = '22023';
  end if;

  return query
  with board_page as (
    select board.*
    from public.project_recording_share_boards as board
    where board.project_id = p_project_id
      and (
        p_before_created_at is null
        or board.created_at < p_before_created_at
        or (
          board.created_at = p_before_created_at
          and board.id < p_before_id
        )
      )
    order by board.created_at desc, board.id desc
    limit p_limit + 1
  )
  select jsonb_build_object(
    'id', board.id,
    'title', board.title,
    'purpose', board.purpose,
    'mode', board.mode,
    'status', board.status,
    'reviewState', board.review_state,
    'roundNumber', board.round_number,
    'expiresAt', board.expires_at,
    'itemCount', item_progress.item_count,
    'draftCompletedCount', least(
      draft_progress.completed_count,
      item_progress.item_count
    ),
    'lastViewedAt', board.last_viewed_at,
    'lastDraftAt', board.last_draft_at,
    'lastSubmittedAt', board.last_submitted_at,
    'lockedAt', board.locked_at,
    'createdBy', board.created_by,
    'createdAt', board.created_at
  ) as task
  from board_page as board
  cross join lateral (
    select count(*)::integer as item_count
    from public.project_recording_share_items as item
    where item.share_board_id = board.id
  ) as item_progress
  cross join lateral (
    select count(*)::integer as completed_count
    from public.project_recording_vendor_review_drafts as draft
    where draft.share_board_id = board.id
      and (
        draft.decision in ('selected', 'backup')
        or (
          draft.decision in ('rejected', 'needs_changes')
          and nullif(btrim(draft.remark), '') is not null
        )
      )
  ) as draft_progress
  order by board.created_at desc, board.id desc;
end;
$$;

alter function public.list_internal_admission_share_board_tasks(
  uuid, timestamptz, uuid, integer
) owner to postgres;
revoke all on function public.list_internal_admission_share_board_tasks(
  uuid, timestamptz, uuid, integer
) from public, anon, authenticated, service_role;
grant execute on function public.list_internal_admission_share_board_tasks(
  uuid, timestamptz, uuid, integer
) to authenticated;

create or replace function public.get_internal_admission_share_board_hydration(
  p_project_id uuid,
  p_share_board_id uuid
)
returns table (hydration jsonb)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null
     or not public.can_access_project(p_project_id)
     or not exists (
       select 1
       from public.projects as project
       where project.id = p_project_id
         and public.is_mcn_staff(project.organization_id)
     ) then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.project_recording_share_boards as board
    where board.id = p_share_board_id
      and board.project_id = p_project_id
  ) then
    raise exception 'admission_share_detail_not_found' using errcode = 'P0002';
  end if;

  return query
  select public.build_admission_share_board_hydration(p_share_board_id)
    as hydration;
end;
$$;

alter function public.get_internal_admission_share_board_hydration(uuid, uuid)
owner to postgres;
revoke all on function public.get_internal_admission_share_board_hydration(uuid, uuid)
from public, anon, authenticated, service_role;
grant execute on function public.get_internal_admission_share_board_hydration(uuid, uuid)
to authenticated;

drop function if exists public.create_admission_share_board(
  uuid, uuid, text, text, text, text, text, timestamptz, boolean, uuid, jsonb
);
drop function if exists public.create_admission_share_board(
  uuid, uuid, text, text, text, text, text, timestamptz, boolean, uuid, jsonb, uuid
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
returns table (board jsonb, snapshot jsonb)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_board public.project_recording_share_boards%rowtype;
  v_round_number integer;
  v_item_count integer;
  v_recording_count integer;
  v_sort_order_count integer;
  selected_item record;
begin
  if p_mode is null or p_mode not in ('preview', 'formal_review') then
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
  if jsonb_array_length(p_items) > 5000 then
    raise exception 'admission_share_item_limit_exceeded';
  end if;
  if auth.uid() is null
     or p_created_by is distinct from auth.uid()
     or not public.is_mcn_staff(p_organization_id)
     or not public.can_access_project(p_project_id) then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_project_id::text, 0)
  );
  perform 1
  from public.projects as project
  where project.id = p_project_id
    and project.organization_id = p_organization_id
  for share;
  if not found then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;

  perform 1
  from public.organizations as organization
  where organization.id = p_organization_id
  for update;
  if not found then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;

  if p_contact_card_id is not null then
    perform 1
    from public.organization_contact_cards as card
    where card.id = p_contact_card_id
      and card.organization_id = p_organization_id
      and card.status = 'active'
    for share;
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

  select count(*), count(distinct item.recording_submission_id), count(distinct item.sort_order)
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
    select coalesce(max(existing.round_number), 0) + 1
    into v_round_number
    from public.project_recording_share_boards as existing
    where existing.organization_id = p_organization_id
      and existing.project_id = p_project_id
      and existing.mode = 'formal_review';
  else
    v_round_number := 0;
  end if;

  insert into public.project_recording_share_boards (
    organization_id, project_id, title, purpose, mode, token_hash,
    access_code_hash, status, expires_at, allow_vendor_submit,
    allow_external_fallback, review_state, round_number, created_by,
    brand_snapshot, brand_version, contact_card_id, contact_card_snapshot
  ) values (
    p_organization_id, p_project_id, btrim(p_title), coalesce(btrim(p_purpose), ''),
    p_mode, p_token_hash, p_access_code_hash, 'active', p_expires_at,
    p_mode = 'formal_review', coalesce(p_allow_external_fallback, true),
    'not_started', v_round_number, p_created_by, '{}'::jsonb, 0,
    p_contact_card_id, null
  ) returning * into v_board;

  insert into public.project_recording_share_items (
    share_board_id, organization_id, project_id, application_id,
    recording_submission_id, recording_version, sort_order,
    mcn_review_decision, source_health, allow_external_fallback
  )
  select
    v_board.id, p_organization_id, p_project_id, payload.application_id,
    payload.recording_submission_id, payload.recording_version, payload.sort_order,
    recording.mcn_review_decision,
    case
      when nullif(btrim(recording.storage_path), '') is not null
        and recording.external_url ~* '^https?://[^[:space:]/?#]+[^[:space:]]*$'
        then 'original_with_external_fallback'
      when nullif(btrim(recording.storage_path), '') is not null then 'original_ready'
      when recording.external_url ~* '^https?://[^[:space:]/?#]+[^[:space:]]*$'
        then 'external_only'
      else 'blocked'
    end,
    coalesce(p_allow_external_fallback, true)
  from jsonb_to_recordset(p_items) as payload(
    application_id uuid,
    recording_submission_id uuid,
    recording_version integer,
    sort_order integer
  )
  join public.recording_submissions as recording
    on recording.id = payload.recording_submission_id
  order by payload.sort_order;

  board := jsonb_build_object(
    'id', v_board.id,
    'organizationId', v_board.organization_id,
    'projectId', v_board.project_id,
    'title', v_board.title,
    'purpose', v_board.purpose,
    'mode', v_board.mode,
    'status', v_board.status,
    'expiresAt', v_board.expires_at,
    'allowVendorSubmit', v_board.allow_vendor_submit,
    'allowExternalFallback', v_board.allow_external_fallback,
    'reviewState', v_board.review_state,
    'roundNumber', v_board.round_number,
    'brandSnapshot', v_board.brand_snapshot - 'logoStoragePath',
    'brandVersion', v_board.brand_version,
    'contactCardId', v_board.contact_card_id,
    'contactCardSnapshot', v_board.contact_card_snapshot,
    'createdBy', v_board.created_by,
    'createdAt', v_board.created_at
  );
  snapshot := public.build_admission_share_board_hydration(v_board.id)->'snapshot';
  return next;
end;
$$;

alter function public.create_admission_share_board(
  uuid, uuid, text, text, text, text, text, timestamptz, boolean, uuid, jsonb, uuid
) owner to postgres;
revoke all on function public.create_admission_share_board(
  uuid, uuid, text, text, text, text, text, timestamptz, boolean, uuid, jsonb, uuid
) from public, anon, authenticated, service_role;
grant execute on function public.create_admission_share_board(
  uuid, uuid, text, text, text, text, text, timestamptz, boolean, uuid, jsonb, uuid
) to authenticated;
