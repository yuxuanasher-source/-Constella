create or replace function public.report_admission_share_playback_issue(
  p_share_board_id uuid,
  p_recording_submission_id uuid,
  p_source_type text,
  p_error_code text,
  p_user_agent_family text,
  p_reported_at timestamptz
)
returns public.project_recording_share_playback_issues
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_board public.project_recording_share_boards%rowtype;
  v_issue public.project_recording_share_playback_issues%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'insufficient_privilege'
      using errcode = '42501';
  end if;

  if p_source_type not in ('original', 'external', 'none')
     or p_error_code not in (
       'MEDIA_LOAD_FAILED',
       'MEDIA_DECODE_FAILED',
       'EXTERNAL_LINK_FAILED',
       'NO_PLAYABLE_SOURCE'
     )
     or p_user_agent_family not in (
       'Chrome',
       'Edge',
       'Firefox',
       'Safari',
       'Opera',
       'Samsung Internet',
       'Unknown'
     )
     or char_length(p_user_agent_family) > 40
     or p_reported_at is null then
    raise exception 'invalid_playback_issue';
  end if;

  select board.*
  into v_board
  from public.project_recording_share_boards as board
  join public.project_recording_share_items as item
    on item.share_board_id = board.id
   and item.organization_id = board.organization_id
   and item.project_id = board.project_id
   and item.recording_submission_id = p_recording_submission_id
  where board.id = p_share_board_id
    and board.status = 'active'
    and board.expires_at > v_now
  for update of board;

  if not found then
    raise exception 'admission_share_recording_not_available';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      pg_catalog.concat_ws(
        ':',
        v_board.id::text,
        p_recording_submission_id::text,
        p_source_type,
        p_error_code
      ),
      0
    )
  );

  select *
  into v_issue
  from public.project_recording_share_playback_issues
  where share_board_id = v_board.id
    and recording_submission_id = p_recording_submission_id
    and source_type = p_source_type
    and error_code = p_error_code
    and status = 'open'
  order by reported_at desc
  limit 1;

  if found then
    return v_issue;
  end if;

  insert into public.project_recording_share_playback_issues (
    share_board_id,
    organization_id,
    project_id,
    recording_submission_id,
    source_type,
    error_code,
    user_agent_family,
    reported_at
  ) values (
    v_board.id,
    v_board.organization_id,
    v_board.project_id,
    p_recording_submission_id,
    p_source_type,
    p_error_code,
    p_user_agent_family,
    p_reported_at
  )
  returning * into v_issue;

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
    'playback_issue_reported',
    'public',
    jsonb_build_object(
      'issue_id', v_issue.id,
      'recording_submission_id', p_recording_submission_id,
      'source_type', p_source_type,
      'error_code', p_error_code
    ),
    p_reported_at
  );

  return v_issue;
end;
$$;

create or replace function public.resolve_admission_share_playback_issue(
  p_organization_id uuid,
  p_project_id uuid,
  p_issue_id uuid,
  p_actor_user_id uuid,
  p_resolved_at timestamptz
)
returns public.project_recording_share_playback_issues
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_issue public.project_recording_share_playback_issues%rowtype;
begin
  if p_resolved_at is null then
    raise exception 'invalid_playback_issue_resolution';
  end if;

  if auth.uid() is null
     or p_actor_user_id is distinct from auth.uid()
     or not public.is_org_member(p_organization_id)
     or not public.is_mcn_staff(p_organization_id)
     or not public.can_access_project(p_project_id) then
    raise exception 'insufficient_privilege'
      using errcode = '42501';
  end if;

  perform 1
  from public.projects as project
  where project.id = p_project_id
    and project.organization_id = p_organization_id;

  if not found then
    raise exception 'insufficient_privilege'
      using errcode = '42501';
  end if;

  select *
  into v_issue
  from public.project_recording_share_playback_issues
  where id = p_issue_id
    and organization_id = p_organization_id
    and project_id = p_project_id
  for update;

  if not found then
    raise exception 'admission_share_playback_issue_not_found';
  end if;

  if v_issue.status = 'resolved' then
    return v_issue;
  end if;

  update public.project_recording_share_playback_issues
  set
    status = 'resolved',
    resolved_by = p_actor_user_id,
    resolved_at = p_resolved_at
  where id = v_issue.id
  returning * into v_issue;

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
    v_issue.share_board_id,
    v_issue.organization_id,
    v_issue.project_id,
    'playback_issue_resolved',
    'staff',
    p_actor_user_id,
    jsonb_build_object('issue_id', v_issue.id),
    p_resolved_at
  );

  return v_issue;
end;
$$;

revoke all on function public.report_admission_share_playback_issue(
  uuid,
  uuid,
  text,
  text,
  text,
  timestamptz
) from public, anon, authenticated;

grant execute on function public.report_admission_share_playback_issue(
  uuid,
  uuid,
  text,
  text,
  text,
  timestamptz
) to service_role;

revoke all on function public.resolve_admission_share_playback_issue(
  uuid,
  uuid,
  uuid,
  uuid,
  timestamptz
) from public, anon;

grant execute on function public.resolve_admission_share_playback_issue(
  uuid,
  uuid,
  uuid,
  uuid,
  timestamptz
) to authenticated;
