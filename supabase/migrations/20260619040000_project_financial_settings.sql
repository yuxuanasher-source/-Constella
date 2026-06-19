-- Phase 2: project-level financial settings for the cost dashboard P&L.
-- Adds invoicing / VAT / surtax / procurement so the project margin reflects
-- tax and procurement cost, not just streamer payout and supplier/traffic fees.

alter table public.projects
  add column if not exists is_invoiced boolean not null default false,
  add column if not exists output_vat_rate_bps integer not null default 0,
  add column if not exists surtax_rate_bps integer not null default 0,
  add column if not exists procurement_cost_cents bigint not null default 0;

alter table public.projects
  add constraint projects_output_vat_rate_bps_range
    check (output_vat_rate_bps >= 0 and output_vat_rate_bps <= 10000),
  add constraint projects_surtax_rate_bps_range
    check (surtax_rate_bps >= 0 and surtax_rate_bps <= 10000),
  add constraint projects_procurement_cost_nonnegative
    check (procurement_cost_cents >= 0);
