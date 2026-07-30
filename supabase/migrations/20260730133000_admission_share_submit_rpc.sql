create or replace function public.submit_admission_share_review(
  p_share_board_id uuid,
  p_project_remark text,
  p_submitted_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_board public.project_recording_share_boards%rowtype;
  v_application public.project_applications%rowtype;
  v_draft record;
  v_submission_id uuid;
  v_vendor_review_id uuid;
  v_submission_revision integer;
  v_share_item_count integer;
  v_draft_count integer;
  v_selected_count integer;
  v_backup_count integer;
  v_rejected_count integer;
  v_needs_changes_count integer;
  v_synced_count integer := 0;
  v_skipped_count integer := 0;
  v_sync_status text;
  v_sync_error text;
  v_application_status public.project_application_status;
  v_recording_status public.recording_review_status;
  v_items jsonb := '[]'::jsonb;
begin
  if p_share_board_id is null
     or p_project_remark is null
     or char_length(p_project_remark) > 2000
     or p_submitted_at is null
     or p_submitted_at < v_now - interval '5 minutes'
     or p_submitted_at > v_now + interval '1 minute' then
    raise exception 'admission_share_submit_invalid';
  end if;

  select board.*
  into v_board
  from public.project_recording_share_boards as board
  where board.id = p_share_board_id
  for update;

  if not found then
    raise exception 'admission_share_board_not_found';
  end if;

  if v_board.locked_at is not null
     or v_board.review_state = 'submitted_locked' then
    raise exception 'admission_share_review_already_locked';
  end if;

  if v_board.mode <> 'formal_review'
     or not v_board.allow_vendor_submit
     or v_board.status <> 'active'
     or v_board.expires_at <= v_now
     or v_board.revoked_at is not null then
    raise exception 'admission_share_board_not_active';
  end if;

  select count(*)
  into v_share_item_count
  from public.project_recording_share_items
  where share_board_id = v_board.id
    and organization_id = v_board.organization_id
    and project_id = v_board.project_id;

  select
    count(*),
    count(*) filter (where decision = 'selected'),
    count(*) filter (where decision = 'backup'),
    count(*) filter (where decision = 'rejected'),
    count(*) filter (where decision = 'needs_changes')
  into
    v_draft_count,
    v_selected_count,
    v_backup_count,
    v_rejected_count,
    v_needs_changes_count
  from public.project_recording_vendor_review_drafts
  where share_board_id = v_board.id
    and organization_id = v_board.organization_id
    and project_id = v_board.project_id;

  if v_share_item_count = 0
     or v_draft_count is distinct from v_share_item_count
     or exists (
       select 1
       from public.project_recording_vendor_review_drafts
       where share_board_id = v_board.id
         and (
           decision = 'pending'
           or (
             decision in ('rejected', 'needs_changes')
             and btrim(remark) = ''
           )
         )
     ) then
    raise exception 'admission_share_review_incomplete';
  end if;

  v_submission_revision := v_board.current_submission_revision + 1;

  insert into public.project_recording_vendor_review_submissions (
    share_board_id,
    organization_id,
    project_id,
    revision,
    project_remark,
    selected_count,
    backup_count,
    rejected_count,
    needs_changes_count,
    submitted_at
  ) values (
    v_board.id,
    v_board.organization_id,
    v_board.project_id,
    v_submission_revision,
    p_project_remark,
    v_selected_count,
    v_backup_count,
    v_rejected_count,
    v_needs_changes_count,
    p_submitted_at
  )
  returning id into v_submission_id;

  for v_draft in
    select
      draft.*,
      share_item.sort_order
    from public.project_recording_vendor_review_drafts as draft
    join public.project_recording_share_items as share_item
      on share_item.share_board_id = draft.share_board_id
     and share_item.recording_submission_id =
       draft.recording_submission_id
     and share_item.organization_id = draft.organization_id
     and share_item.project_id = draft.project_id
     and share_item.application_id = draft.application_id
     and share_item.recording_version = draft.recording_version
    where draft.share_board_id = v_board.id
      and draft.organization_id = v_board.organization_id
      and draft.project_id = v_board.project_id
    order by share_item.sort_order, draft.recording_submission_id
  loop
    select application.*
    into v_application
    from public.project_applications as application
    where application.id = v_draft.application_id
      and application.project_id = v_board.project_id
    for update;

    if not found then
      raise exception 'admission_share_selection_changed';
    end if;

    v_sync_status := 'synced';
    v_sync_error := null;
    v_application_status := null;
    v_recording_status := null;

    if exists (
      select 1
      from public.recording_submissions
      where application_id = v_draft.application_id
        and version > v_draft.recording_version
    ) then
      v_sync_status := 'skipped';
      v_sync_error := 'superseded_recording_version';
    elsif v_application.status = 'joined' then
      v_sync_status := 'skipped';
      v_sync_error := 'application_already_joined';
    elsif v_draft.decision = 'selected' then
      v_application_status := 'recording_approved';
      v_recording_status := 'approved';
    elsif v_draft.decision = 'rejected' then
      v_application_status := 'recording_rejected';
      v_recording_status := 'rejected';
    elsif v_draft.decision = 'needs_changes' then
      v_application_status := 'recording_required';
      v_recording_status := 'needs_changes';
    end if;

    if v_recording_status is not null then
      update public.recording_submissions
      set
        status = v_recording_status,
        reviewed_at = p_submitted_at,
        review_note = v_draft.remark
      where id = v_draft.recording_submission_id
        and organization_id = v_application.organization_id
        and project_id = v_board.project_id
        and application_id = v_draft.application_id
        and version = v_draft.recording_version;

      if not found then
        raise exception 'admission_share_selection_changed';
      end if;
    end if;

    if v_application_status is not null then
      update public.project_applications
      set
        status = v_application_status,
        decided_at = p_submitted_at,
        decision_reason = v_draft.remark
      where id = v_draft.application_id
        and project_id = v_board.project_id
        and organization_id = v_application.organization_id;

      if not found then
        raise exception 'admission_share_selection_changed';
      end if;
    end if;

    if v_sync_status = 'synced' then
      v_synced_count := v_synced_count + 1;
    else
      v_skipped_count := v_skipped_count + 1;
    end if;

    insert into public.project_recording_vendor_reviews (
      organization_id,
      project_id,
      share_board_id,
      application_id,
      recording_submission_id,
      recording_version,
      decision,
      remark,
      vendor_reviewer_name,
      vendor_reviewer_contact,
      submitted_at,
      synced_application_status,
      synced_recording_status,
      sync_status,
      sync_error
    ) values (
      v_board.organization_id,
      v_board.project_id,
      v_board.id,
      v_draft.application_id,
      v_draft.recording_submission_id,
      v_draft.recording_version,
      v_draft.decision,
      v_draft.remark,
      '',
      '',
      p_submitted_at,
      v_application_status::text,
      v_recording_status::text,
      v_sync_status,
      v_sync_error
    )
    on conflict (share_board_id, recording_submission_id)
    do update set
      recording_version = excluded.recording_version,
      decision = excluded.decision,
      remark = excluded.remark,
      submitted_at = excluded.submitted_at,
      synced_application_status = excluded.synced_application_status,
      synced_recording_status = excluded.synced_recording_status,
      sync_status = excluded.sync_status,
      sync_error = excluded.sync_error
    returning id into v_vendor_review_id;

    insert into public.project_recording_vendor_review_submission_items (
      submission_id,
      share_board_id,
      organization_id,
      project_id,
      application_id,
      recording_submission_id,
      recording_version,
      decision,
      remark,
      reason_codes,
      sync_status,
      sync_error,
      created_at
    ) values (
      v_submission_id,
      v_board.id,
      v_board.organization_id,
      v_board.project_id,
      v_draft.application_id,
      v_draft.recording_submission_id,
      v_draft.recording_version,
      v_draft.decision,
      v_draft.remark,
      v_draft.reason_codes,
      v_sync_status,
      v_sync_error,
      p_submitted_at
    );

    v_items := v_items || jsonb_build_array(
      jsonb_build_object(
        'vendorReviewId', v_vendor_review_id,
        'applicationId', v_draft.application_id,
        'recordingSubmissionId', v_draft.recording_submission_id,
        'recordingVersion', v_draft.recording_version,
        'decision', v_draft.decision,
        'remark', v_draft.remark,
        'reasonCodes', to_jsonb(v_draft.reason_codes),
        'syncStatus', v_sync_status,
        'syncError', v_sync_error
      )
    );
  end loop;

  update public.project_recording_share_boards
  set
    last_submitted_at = p_submitted_at,
    locked_at = p_submitted_at,
    review_state = 'submitted_locked',
    current_submission_revision = v_submission_revision
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
    'submitted',
    'public',
    jsonb_build_object(
      'submission_revision', v_submission_revision,
      'submitted_count', v_draft_count,
      'synced_count', v_synced_count,
      'skipped_count', v_skipped_count
    ),
    p_submitted_at
  );

  return jsonb_build_object(
    'submissionRevision', v_submission_revision,
    'submittedCount', v_draft_count,
    'syncedCount', v_synced_count,
    'skippedCount', v_skipped_count,
    'items', v_items
  );
end;
$$;

revoke all on function public.submit_admission_share_review(
  uuid,
  text,
  timestamptz
) from public, anon, authenticated;

grant execute on function public.submit_admission_share_review(
  uuid,
  text,
  timestamptz
) to service_role;
