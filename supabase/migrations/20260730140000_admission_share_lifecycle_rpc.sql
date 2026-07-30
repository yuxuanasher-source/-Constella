create or replace function public.extend_admission_share_board(
  p_share_board_id uuid,
  p_project_id uuid,
  p_expires_at timestamptz,
  p_actor_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_board public.project_recording_share_boards%rowtype;
begin
  if auth.uid() is null
     or p_actor_user_id is distinct from auth.uid()
     or not public.can_access_project(p_project_id) then
    raise exception 'insufficient_privilege'
      using errcode = '42501';
  end if;

  select *
  into strict v_board
  from public.project_recording_share_boards
  where id = p_share_board_id
    and project_id = p_project_id
  for update;

  if not public.is_mcn_staff(v_board.organization_id) then
    raise exception 'insufficient_privilege'
      using errcode = '42501';
  end if;

  perform 1
  from public.projects as project
  where project.id = v_board.project_id
    and project.organization_id = v_board.organization_id;

  if not found then
    raise exception 'insufficient_privilege'
      using errcode = '42501';
  end if;

  if v_board.status <> 'active'
     or v_board.expires_at <= v_now then
    raise exception 'admission_share_board_not_active';
  end if;

  if p_expires_at is null
     or p_expires_at <= v_now
     or p_expires_at <= v_board.expires_at
     or p_expires_at > v_now + interval '30 days' then
    raise exception 'invalid_admission_share_expiry';
  end if;

  update public.project_recording_share_boards
  set expires_at = p_expires_at
  where id = v_board.id;

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
    v_board.organization_id,
    v_board.project_id,
    'extended',
    'staff',
    p_actor_user_id,
    jsonb_build_object(
      'previous_expires_at', v_board.expires_at,
      'expires_at', p_expires_at
    ),
    v_now
  );
end;
$$;

create or replace function public.reopen_admission_share_board(
  p_share_board_id uuid,
  p_project_id uuid,
  p_reason text,
  p_actor_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_board public.project_recording_share_boards%rowtype;
  v_submission public.project_recording_vendor_review_submissions%rowtype;
begin
  if auth.uid() is null
     or p_actor_user_id is distinct from auth.uid()
     or not public.can_access_project(p_project_id) then
    raise exception 'insufficient_privilege'
      using errcode = '42501';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_project_id::text, 0)
  );

  select *
  into strict v_board
  from public.project_recording_share_boards
  where id = p_share_board_id
    and project_id = p_project_id
  for update;

  if not public.is_mcn_staff(v_board.organization_id) then
    raise exception 'insufficient_privilege'
      using errcode = '42501';
  end if;

  perform 1
  from public.projects as project
  where project.id = v_board.project_id
    and project.organization_id = v_board.organization_id;

  if not found then
    raise exception 'insufficient_privilege'
      using errcode = '42501';
  end if;

  if nullif(btrim(p_reason), '') is null
     or char_length(btrim(p_reason)) < 2 then
    raise exception 'admission_share_reopen_reason_required';
  end if;

  if v_board.status <> 'active'
     or v_board.expires_at <= v_now then
    raise exception 'admission_share_board_not_active';
  end if;

  if v_board.mode <> 'formal_review'
     or v_board.review_state <> 'submitted_locked'
     or v_board.locked_at is null then
    raise exception 'admission_share_reopen_not_allowed';
  end if;

  update public.project_recording_share_boards
  set status = 'expired'
  where organization_id = v_board.organization_id
    and project_id = v_board.project_id
    and id <> v_board.id
    and status = 'active'
    and expires_at <= v_now;

  perform 1
  from public.project_recording_share_boards
  where organization_id = v_board.organization_id
    and project_id = v_board.project_id
    and id <> v_board.id
    and mode = 'formal_review'
    and status = 'active'
    and locked_at is null;

  if found then
    -- Preserve the stable conflict instead of relying on
    -- project_recording_share_boards_one_open_formal_idx diagnostics.
    raise exception 'admission_share_formal_round_already_open';
  end if;

  select *
  into v_submission
  from public.project_recording_vendor_review_submissions
  where share_board_id = v_board.id
    and organization_id = v_board.organization_id
    and project_id = v_board.project_id
  order by revision desc, submitted_at desc
  limit 1;

  if not found then
    raise exception 'admission_share_submission_missing';
  end if;

  delete from public.project_recording_vendor_review_drafts
  where share_board_id = v_board.id;

  insert into public.project_recording_vendor_review_drafts (
    share_board_id,
    recording_submission_id,
    organization_id,
    project_id,
    application_id,
    recording_version,
    decision,
    remark,
    reason_codes,
    revision,
    updated_at
  )
  select
    v_board.id,
    submission_item.recording_submission_id,
    v_board.organization_id,
    v_board.project_id,
    submission_item.application_id,
    submission_item.recording_version,
    submission_item.decision,
    submission_item.remark,
    submission_item.reason_codes,
    v_submission.revision + 1,
    v_now
  from public.project_recording_vendor_review_submission_items
    as submission_item
  where submission_item.submission_id = v_submission.id
    and submission_item.share_board_id = v_board.id
    and submission_item.organization_id = v_board.organization_id
    and submission_item.project_id = v_board.project_id;

  if not found then
    raise exception 'admission_share_submission_missing';
  end if;

  update public.project_recording_share_boards
  set
    review_state = 'in_progress',
    locked_at = null,
    last_draft_at = v_now,
    reopened_by = p_actor_user_id,
    reopened_at = v_now,
    reopen_reason = btrim(p_reason)
  where id = v_board.id;

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
    v_board.organization_id,
    v_board.project_id,
    'reopened',
    'staff',
    p_actor_user_id,
    jsonb_build_object(
      'reason', btrim(p_reason),
      'source_submission_id', v_submission.id,
      'source_revision', v_submission.revision,
      'draft_revision', v_submission.revision + 1
    ),
    v_now
  );
end;
$$;

create or replace function public.rotate_admission_share_board_token(
  p_share_board_id uuid,
  p_project_id uuid,
  p_token_hash text,
  p_actor_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_board public.project_recording_share_boards%rowtype;
begin
  if auth.uid() is null
     or p_actor_user_id is distinct from auth.uid()
     or not public.can_access_project(p_project_id) then
    raise exception 'insufficient_privilege'
      using errcode = '42501';
  end if;

  select *
  into strict v_board
  from public.project_recording_share_boards
  where id = p_share_board_id
    and project_id = p_project_id
  for update;

  if not public.is_mcn_staff(v_board.organization_id) then
    raise exception 'insufficient_privilege'
      using errcode = '42501';
  end if;

  perform 1
  from public.projects as project
  where project.id = v_board.project_id
    and project.organization_id = v_board.organization_id;

  if not found then
    raise exception 'insufficient_privilege'
      using errcode = '42501';
  end if;

  if v_board.status <> 'active'
     or v_board.expires_at <= v_now then
    raise exception 'admission_share_board_not_active';
  end if;

  if p_token_hash is null
     or p_token_hash !~ '^[0-9a-f]{64}$'
     or p_token_hash = v_board.token_hash then
    raise exception 'invalid_admission_share_token';
  end if;

  update public.project_recording_share_boards
  set token_hash = p_token_hash
  where id = v_board.id;

  delete from public.project_recording_share_access_sessions
  where share_board_id = v_board.id;

  delete from public.project_recording_share_access_attempts
  where share_board_id = v_board.id;

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
    v_board.organization_id,
    v_board.project_id,
    'token_rotated',
    'staff',
    p_actor_user_id,
    '{}'::jsonb,
    v_now
  );
end;
$$;

create or replace function public.revoke_admission_share_board(
  p_share_board_id uuid,
  p_project_id uuid,
  p_actor_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_board public.project_recording_share_boards%rowtype;
begin
  if auth.uid() is null
     or p_actor_user_id is distinct from auth.uid()
     or not public.can_access_project(p_project_id) then
    raise exception 'insufficient_privilege'
      using errcode = '42501';
  end if;

  select *
  into strict v_board
  from public.project_recording_share_boards
  where id = p_share_board_id
    and project_id = p_project_id
  for update;

  if not public.is_mcn_staff(v_board.organization_id) then
    raise exception 'insufficient_privilege'
      using errcode = '42501';
  end if;

  perform 1
  from public.projects as project
  where project.id = v_board.project_id
    and project.organization_id = v_board.organization_id;

  if not found then
    raise exception 'insufficient_privilege'
      using errcode = '42501';
  end if;

  if v_board.status = 'revoked' then
    raise exception 'admission_share_board_not_active';
  end if;

  update public.project_recording_share_boards
  set
    status = 'revoked',
    token_hash = encode(extensions.gen_random_bytes(32), 'hex'),
    revoked_by = p_actor_user_id,
    revoked_at = v_now
  where id = v_board.id;

  delete from public.project_recording_share_access_sessions
  where share_board_id = v_board.id;

  delete from public.project_recording_share_access_attempts
  where share_board_id = v_board.id;

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
    v_board.organization_id,
    v_board.project_id,
    'revoked',
    'staff',
    p_actor_user_id,
    '{}'::jsonb,
    v_now
  );
end;
$$;

revoke all on function public.extend_admission_share_board(
  uuid,
  uuid,
  timestamptz,
  uuid
) from public, anon, authenticated;
revoke all on function public.reopen_admission_share_board(
  uuid,
  uuid,
  text,
  uuid
) from public, anon, authenticated;
revoke all on function public.rotate_admission_share_board_token(
  uuid,
  uuid,
  text,
  uuid
) from public, anon, authenticated;
revoke all on function public.revoke_admission_share_board(
  uuid,
  uuid,
  uuid
) from public, anon, authenticated;

grant execute on function public.extend_admission_share_board(
  uuid,
  uuid,
  timestamptz,
  uuid
) to authenticated;
grant execute on function public.reopen_admission_share_board(
  uuid,
  uuid,
  text,
  uuid
) to authenticated;
grant execute on function public.rotate_admission_share_board_token(
  uuid,
  uuid,
  text,
  uuid
) to authenticated;
grant execute on function public.revoke_admission_share_board(
  uuid,
  uuid,
  uuid
) to authenticated;
