create or replace function public.save_admission_share_review_draft(
  p_share_board_id uuid,
  p_recording_submission_id uuid,
  p_expected_revision integer,
  p_decision text,
  p_remark text,
  p_reason_codes text[],
  p_saved_at timestamptz
)
returns public.project_recording_vendor_review_drafts
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_board public.project_recording_share_boards%rowtype;
  v_item public.project_recording_share_items%rowtype;
  v_draft public.project_recording_vendor_review_drafts%rowtype;
  reason_code text;
begin
  if p_share_board_id is null
     or p_recording_submission_id is null
     or p_expected_revision is null
     or p_expected_revision < 0
     or p_expected_revision >= 2147483647
     or p_decision is null
     or p_decision not in (
       'pending',
       'selected',
       'backup',
       'rejected',
       'needs_changes'
     )
     or p_remark is null
     or char_length(p_remark) > 2000
     or p_reason_codes is null
     or cardinality(p_reason_codes) > 20
     or p_saved_at is null
     or p_saved_at < v_now - interval '5 minutes'
     or p_saved_at > v_now + interval '1 minute' then
    raise exception 'invalid_admission_share_draft';
  end if;

  foreach reason_code in array p_reason_codes
  loop
    if nullif(btrim(reason_code), '') is null
       or char_length(reason_code) > 64
       or reason_code !~ '^[A-Za-z0-9_.:-]+$' then
      raise exception 'invalid_admission_share_draft';
    end if;
  end loop;

  select board.*
  into strict v_board
  from public.project_recording_share_boards as board
  where board.id = p_share_board_id
  for update;

  if v_board.locked_at is not null
     or v_board.review_state = 'submitted_locked' then
    raise exception 'admission_share_review_already_locked';
  end if;

  if v_board.mode <> 'formal_review'
     or not v_board.allow_vendor_submit
     or v_board.status <> 'active'
     or v_board.expires_at <= v_now
     or v_board.revoked_at is not null then
    raise exception 'admission_share_draft_unavailable';
  end if;

  select item.*
  into v_item
  from public.project_recording_share_items as item
  where item.share_board_id = v_board.id
    and item.organization_id = v_board.organization_id
    and item.project_id = v_board.project_id
    and item.recording_submission_id = p_recording_submission_id;

  if not found then
    raise exception 'admission_share_draft_item_not_shared';
  end if;

  select draft.*
  into v_draft
  from public.project_recording_vendor_review_drafts as draft
  where draft.share_board_id = v_board.id
    and draft.recording_submission_id = p_recording_submission_id
  for update;

  if found then
    if v_draft.revision is distinct from p_expected_revision then
      raise exception 'admission_share_draft_conflict';
    end if;

    update public.project_recording_vendor_review_drafts
    set
      decision = p_decision,
      remark = p_remark,
      reason_codes = p_reason_codes,
      revision = p_expected_revision + 1,
      updated_at = p_saved_at
    where share_board_id = v_board.id
      and recording_submission_id = p_recording_submission_id
      and revision = p_expected_revision
    returning * into v_draft;

    if not found then
      raise exception 'admission_share_draft_conflict';
    end if;
  else
    if p_expected_revision <> 0 then
      raise exception 'admission_share_draft_conflict';
    end if;

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
    ) values (
      v_board.id,
      v_item.recording_submission_id,
      v_board.organization_id,
      v_board.project_id,
      v_item.application_id,
      v_item.recording_version,
      p_decision,
      p_remark,
      p_reason_codes,
      1,
      p_saved_at
    )
    returning * into v_draft;
  end if;

  update public.project_recording_share_boards
  set
    review_state = 'in_progress',
    last_draft_at = p_saved_at
  where id = v_board.id;

  insert into public.project_recording_share_events (
    share_board_id,
    organization_id,
    project_id,
    event_type,
    actor_type,
    metadata,
    created_at
  ) values (
    v_board.id,
    v_board.organization_id,
    v_board.project_id,
    'draft_saved',
    'public',
    jsonb_build_object(
      'recording_submission_id',
      p_recording_submission_id,
      'revision',
      v_draft.revision,
      'decision',
      p_decision
    ),
    p_saved_at
  );

  return v_draft;
end;
$$;

revoke all on function public.save_admission_share_review_draft(
  uuid,
  uuid,
  integer,
  text,
  text,
  text[],
  timestamptz
) from public, anon, authenticated;

grant execute on function public.save_admission_share_review_draft(
  uuid,
  uuid,
  integer,
  text,
  text,
  text[],
  timestamptz
) to service_role;
