-- Attribute OCR results and parsed dashboard metrics to the authoritative
-- live report dimensions. These columns remain nullable so an application
-- deploy can roll independently from this migration; the application and
-- history backfill populate them from live_reports.

alter table public.ocr_results
  add column if not exists streamer_id uuid references public.streamers(id) on delete cascade,
  add column if not exists project_id uuid references public.projects(id) on delete cascade,
  add column if not exists report_date date;

update public.ocr_results as ocr
set streamer_id = lr.streamer_id,
    project_id = lr.project_id,
    report_date = (lr.created_at at time zone 'UTC')::date
from public.live_reports as lr
where lr.id = ocr.live_report_id
  and lr.organization_id = ocr.organization_id
  and (
    ocr.streamer_id is distinct from lr.streamer_id
    or ocr.project_id is distinct from lr.project_id
    or ocr.report_date is distinct from (lr.created_at at time zone 'UTC')::date
  );

create index if not exists ocr_results_streamer_report_date_idx
  on public.ocr_results (organization_id, streamer_id, report_date);

create index if not exists ocr_results_project_report_date_idx
  on public.ocr_results (organization_id, project_id, report_date);

alter table public.streamer_metrics
  add column if not exists source_report_id uuid references public.live_reports(id) on delete cascade;

-- OCR retries must update the same report metric instead of creating another
-- observation. Existing non-OCR metrics may keep a null source_report_id.
create unique index if not exists streamer_metrics_ocr_report_metric_unique
  on public.streamer_metrics (organization_id, streamer_id, metric_key, metric_window, source_report_id);
