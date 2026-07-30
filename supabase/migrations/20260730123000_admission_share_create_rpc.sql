create policy project_applications_host_mcn_share_read
on public.project_applications
for select
to authenticated
using (
  exists (
    select 1
    from public.projects as project
    where project.id = project_applications.project_id
      and public.is_org_member(project.organization_id)
      and public.is_mcn_staff(project.organization_id)
      and public.can_access_project(project.id)
  )
);

create policy recording_submissions_host_mcn_share_read
on public.recording_submissions
for select
to authenticated
using (
  exists (
    select 1
    from public.projects as project
    where project.id = recording_submissions.project_id
      and public.is_org_member(project.organization_id)
      and public.is_mcn_staff(project.organization_id)
      and public.can_access_project(project.id)
  )
);

create policy project_recording_share_events_staff_insert
on public.project_recording_share_events
for insert
to authenticated
with check (
  public.is_org_member(organization_id)
  and public.is_mcn_staff(organization_id)
  and public.can_access_project(project_id)
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
  p_items jsonb
)
returns public.project_recording_share_boards
language plpgsql
security invoker
set search_path = pg_catalog, public
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

  perform 1
  from public.projects as project
  where project.id = p_project_id
    and project.organization_id = p_organization_id
  for update;

  if not found then
    raise exception 'insufficient_privilege'
      using errcode = '42501';
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

  -- Concurrency is also enforced by
  -- project_recording_share_boards_one_open_formal_idx.
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
    created_by
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
    p_created_by
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
    selected_item.application_id,
    selected_item.recording_submission_id,
    selected_item.recording_version,
    selected_item.sort_order,
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
  from jsonb_to_recordset(p_items) as selected_item(
    application_id uuid,
    recording_submission_id uuid,
    recording_version integer,
    sort_order integer
  )
  join public.recording_submissions as recording
    on recording.id = selected_item.recording_submission_id
  order by selected_item.sort_order;

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
    v_board.id,
    p_organization_id,
    p_project_id,
    'created',
    'staff',
    p_created_by,
    jsonb_build_object(
      'mode', p_mode,
      'round_number', v_round_number,
      'item_count', v_item_count
    ),
    v_now
  );

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
  jsonb
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
  jsonb
) to authenticated;
