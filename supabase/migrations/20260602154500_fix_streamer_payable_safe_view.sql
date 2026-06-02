create or replace view public.streamer_payable_items_safe
with (security_invoker = false)
as
select
  sbi.id,
  sbi.organization_id,
  sbi.project_id,
  p.name as project_name,
  sbi.streamer_id,
  sb.period_start,
  sb.period_end,
  sbi.computed_amount,
  sbi.manual_amount,
  sbi.adjustment_amount,
  (sbi.computed_amount + sbi.manual_amount + sbi.adjustment_amount) as payable_amount,
  sbi.evidence_level,
  sbi.evidence_snapshot,
  sbi.created_at
from public.settlement_batch_items sbi
join public.settlement_batches sb on sb.id = sbi.settlement_batch_id
join public.projects p on p.id = sbi.project_id
where sb.batch_type = 'payable'
  and sbi.streamer_id = public.current_streamer_id(sbi.organization_id);

comment on view public.streamer_payable_items_safe is
  'Streamer-facing payable-only settlement DTO view. It bypasses batch-table RLS only inside this view and explicitly filters to current_streamer_id.';
