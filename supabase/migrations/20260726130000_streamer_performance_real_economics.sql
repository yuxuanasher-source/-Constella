-- Task 9: persist measured streamer economics without rewriting legacy proxy history.
--
-- total_settlement_amount is the sum of computed_amount + manual_amount +
-- adjustment_amount for payable batches in confirmed/locked state.
-- total_gmv_amount is whole-CNY GMV attributed through streamer_metrics.source_report_id.
-- Nullable columns mean attribution/settlement coverage is incomplete; observed zero
-- remains zero.

alter table public.streamer_performance_snapshots
  add column if not exists avg_session_minutes numeric(12, 2),
  add column if not exists total_settlement_amount numeric(12, 2),
  add column if not exists actual_hourly_rate numeric(12, 2),
  add column if not exists total_gmv_amount numeric(14, 2),
  add column if not exists roi_bps integer,
  add column if not exists views_per_hour numeric(14, 2);

update public.streamer_performance_snapshots
set avg_session_minutes = case
  when live_sessions > 0 then round(total_live_minutes::numeric / live_sessions, 2)
  else 0
end
where avg_session_minutes is null;

alter table public.streamer_performance_snapshots
  alter column avg_session_minutes set default 0,
  alter column avg_session_minutes set not null;

comment on column public.streamer_performance_snapshots.avg_session_roi_bps is
  'Deprecated configured-rate ROI history. New writes use roi_bps from attributed GMV / actual settlement.';
comment on column public.streamer_performance_snapshots.roi_bps is
  'Attributed GMV / actual confirmed-or-locked payable settlement, in basis points.';
comment on column public.streamer_performance_snapshots.views_per_hour is
  'Observed viewers divided by actual live hours; not an ROI metric.';
