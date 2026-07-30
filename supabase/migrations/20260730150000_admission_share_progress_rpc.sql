create or replace function public.list_admission_share_board_progress(
  p_project_ids uuid[]
)
returns table (
  share_board_id uuid,
  item_count bigint,
  draft_completed_count bigint
)
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  select
    board.id as share_board_id,
    (
      select count(*)
      from public.project_recording_share_items as share_item
      where share_item.share_board_id = board.id
    ) as item_count,
    (
      select count(*)
      from public.project_recording_vendor_review_drafts as draft
      where draft.share_board_id = board.id
        and (
          draft.decision in ('selected', 'backup')
          or (
            draft.decision in ('rejected', 'needs_changes')
            and nullif(btrim(draft.remark), '') is not null
          )
        )
    ) as draft_completed_count
  from public.project_recording_share_boards as board
  where board.project_id = any(coalesce(p_project_ids, '{}'::uuid[]))
    and (
      auth.role() = 'service_role'
      or (
        public.is_org_member(board.organization_id)
        and public.is_mcn_staff(board.organization_id)
        and public.can_access_project(board.project_id)
      )
    );
$$;

revoke all on function public.list_admission_share_board_progress(uuid[])
from public, anon;

grant execute on function public.list_admission_share_board_progress(uuid[])
to authenticated, service_role;
