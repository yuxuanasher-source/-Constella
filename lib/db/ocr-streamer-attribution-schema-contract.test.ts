import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = join(
  process.cwd(),
  "supabase/migrations/20260726100000_ocr_streamer_attribution.sql",
);
const migration = existsSync(migrationPath)
  ? readFileSync(migrationPath, "utf8").toLowerCase()
  : "";

describe("OCR streamer attribution schema contract", () => {
  it("attributes OCR results to the live report streamer, project, and date", () => {
    expect(migration).not.toBe("");
    expect(migration).toMatch(
      /alter table public\.ocr_results[\s\S]*add column if not exists streamer_id uuid references public\.streamers\(id\)/,
    );
    expect(migration).toMatch(
      /alter table public\.ocr_results[\s\S]*add column if not exists project_id uuid references public\.projects\(id\)/,
    );
    expect(migration).toMatch(
      /alter table public\.ocr_results[\s\S]*add column if not exists report_date date/,
    );
    expect(migration).toMatch(
      /update public\.ocr_results[\s\S]*from public\.live_reports[\s\S]*live_report_id/,
    );
    expect(migration).toMatch(
      /coalesce\(\s*lt\.system_started_at,\s*lt\.planned_start_at,\s*lr\.created_at\s*\)\s+at time zone 'asia\/shanghai'/,
    );
    expect(migration).toContain("ocr_results_streamer_report_date_idx");
    expect(migration).toContain("ocr_results_project_report_date_idx");
  });

  it("derives OCR attribution in a locked-down database trigger", () => {
    expect(migration).toContain(
      "function public.sync_ocr_result_attribution()",
    );
    expect(migration).toMatch(
      /function public\.sync_ocr_result_attribution\(\)[\s\S]*security definer[\s\S]*set search_path = ''/,
    );
    expect(migration).toMatch(
      /from public\.live_reports as lr[\s\S]*join public\.live_tasks as lt[\s\S]*lr\.organization_id = new\.organization_id/,
    );
    expect(migration).toContain("create trigger ocr_results_sync_attribution");
    expect(migration).toContain(
      "before insert or update on public.ocr_results",
    );
    expect(migration).toMatch(
      /revoke all on function public\.sync_ocr_result_attribution\(\)[\s\S]*from public, anon, authenticated, service_role/,
    );
  });

  it("gives OCR metrics a report-scoped database idempotency key", () => {
    expect(migration).toMatch(
      /alter table public\.streamer_metrics[\s\S]*add column if not exists source_report_id uuid references public\.live_reports\(id\)/,
    );
    expect(migration).toContain(
      "organization_id, streamer_id, metric_key, metric_window, source_report_id",
    );
    expect(migration).toContain("create unique index if not exists");
  });

  it("exposes the automatic OCR metric RPC only to the service role", () => {
    expect(migration).toContain("function public.upsert_ocr_streamer_metrics(");
    expect(migration).toMatch(
      /function public\.upsert_ocr_streamer_metrics\([\s\S]*security definer[\s\S]*set search_path = ''/,
    );
    expect(migration).toMatch(
      /upsert_ocr_streamer_metrics\([\s\S]*auth\.role\(\)[\s\S]*service_role/,
    );
    expect(migration).toMatch(
      /from public\.live_reports as lr[\s\S]*join public\.live_tasks as lt[\s\S]*coalesce\(\s*lt\.system_started_at,\s*lt\.planned_start_at,\s*lr\.created_at\s*\)\s+at time zone 'asia\/shanghai'/,
    );
    expect(migration).toMatch(
      /p_source_invocation_id[\s\S]*public\.ai_invocations[\s\S]*scene = 'ocr\.extract_live_report'[\s\S]*object_type = 'live_report'[\s\S]*object_id = p_live_report_id::text/,
    );
    expect(migration).toMatch(
      /from public\.ocr_results[\s\S]*background_job_id[\s\S]*bj\.ai_invocation_id = p_source_invocation_id[\s\S]*bj\.status = 'succeeded'[\s\S]*ocr\.ai_invocation_id = p_source_invocation_id[\s\S]*for update/,
    );
    expect(migration).toMatch(
      /from public\.live_reports[\s\S]*where lr\.id = p_live_report_id[\s\S]*for update/,
    );
    expect(migration).toContain("2147483647");
    expect(migration).toContain("duplicate metric key");
    expect(migration).toMatch(
      /on conflict \(organization_id, streamer_id, metric_key, metric_window, source_report_id\)[\s\S]*do update/,
    );
    expect(migration).toMatch(
      /revoke all on function public\.upsert_ocr_streamer_metrics\([\s\S]*from public, anon, authenticated, service_role/,
    );
    expect(migration).toMatch(
      /grant execute on function public\.upsert_ocr_streamer_metrics\([\s\S]*to service_role/,
    );
    expect(migration).not.toMatch(
      /grant execute on function public\.upsert_ocr_streamer_metrics\([\s\S]*to authenticated/,
    );
  });

  it("keeps the automatic RPC state and payload validation effective against direct callers", () => {
    expect(migration).toMatch(
      /v_report\.status <> 'ocr_ing'[\s\S]*v_ocr\.status <> 'succeeded'[\s\S]*v_ocr\.reviewed_at is not null/,
    );
    expect(migration).toContain(
      "jsonb_typeof(v_metric -> 'key') is distinct from 'string'",
    );
    expect(migration).toContain(
      "jsonb_typeof(v_metric -> 'value') is distinct from 'number'",
    );
    expect(migration).toMatch(
      /source_report_id[\s\S]*values \([\s\S]*v_report\.id/,
    );
  });

  it("confirms OCR status and metrics in one service-role-only transaction", () => {
    expect(migration).toContain("function public.confirm_ocr_job_metrics(");
    expect(migration).toMatch(
      /function public\.confirm_ocr_job_metrics\([\s\S]*security definer[\s\S]*set search_path = ''/,
    );
    expect(migration).toMatch(
      /from public\.background_jobs as bj[\s\S]*where bj\.id = p_job_id[\s\S]*for update/,
    );
    expect(migration).toMatch(
      /from public\.ocr_results as ocr[\s\S]*ocr\.background_job_id = v_job\.id[\s\S]*for update/,
    );
    expect(migration).toMatch(
      /from public\.live_reports as lr[\s\S]*where lr\.id = v_ocr\.live_report_id[\s\S]*for update/,
    );
    expect(migration).toMatch(
      /v_job\.status not in \('needs_confirmation', 'needs_review'\)[\s\S]*v_ocr\.status <> 'needs_confirmation'[\s\S]*v_ocr\.reviewed_at is not null/,
    );
    expect(migration).toContain(
      "v_ocr.ai_invocation_id is distinct from v_job.ai_invocation_id",
    );
    expect(migration).toMatch(
      /v_report\.status not in \('ocr_ing', 'pending_review'\)/,
    );
    expect(migration).toMatch(
      /update public\.ocr_results[\s\S]*update public\.background_jobs[\s\S]*insert into public\.streamer_metrics[\s\S]*update public\.live_reports/,
    );
    expect(migration).toMatch(
      /update public\.ocr_results[\s\S]*updated_at = p_reviewed_at/,
    );
    expect(migration).toMatch(
      /update public\.live_reports[\s\S]*status = case[\s\S]*screenshot_duration = v_confirmed_duration[\s\S]*viewers = v_effective_viewers[\s\S]*settlement_duration = v_settlement_duration[\s\S]*time_source = v_time_source[\s\S]*evidence_level = v_evidence_level[\s\S]*divergence_pct = v_divergence_pct[\s\S]*risk_flags = v_risk_flags[\s\S]*updated_at = p_reviewed_at/,
    );
    expect(migration).toMatch(
      /revoke all on function public\.confirm_ocr_job_metrics\(\s*uuid, uuid, timestamptz, jsonb, jsonb, integer, integer\s*\) from public, anon, authenticated, service_role/,
    );
    expect(migration).toMatch(
      /grant execute on function public\.confirm_ocr_job_metrics\(\s*uuid, uuid, timestamptz, jsonb, jsonb, integer, integer\s*\) to service_role/,
    );
    expect(migration).not.toMatch(
      /grant execute on function public\.confirm_ocr_job_metrics\([\s\S]*to authenticated/,
    );
  });

  it("uses one effective viewers value for both report and metric persistence", () => {
    const confirmationFunction = migration.slice(
      migration.indexOf(
        "create or replace function public.confirm_ocr_job_metrics(",
      ),
    );

    expect(confirmationFunction).toMatch(
      /v_effective_viewers := coalesce\(\s*nullif\(p_confirmed_viewers, 0\),\s*nullif\(v_report\.viewers, 0\)\s*\)/,
    );
    expect(confirmationFunction).not.toMatch(
      /v_effective_viewers := coalesce\([\s\S]*v_ocr\.extracted_viewers/,
    );
    expect(
      confirmationFunction.match(
        /if v_metric_key = 'viewers' then\s*continue;\s*end if;/g,
      ),
    ).toHaveLength(2);
    expect(confirmationFunction).toMatch(
      /if v_effective_viewers is not null then[\s\S]*'viewers'[\s\S]*v_effective_viewers[\s\S]*end if;[\s\S]*update public\.live_reports[\s\S]*viewers = v_effective_viewers/,
    );
    expect(confirmationFunction).toMatch(
      /v_metric_key := v_metric ->> 'key';[\s\S]*v_metric_value := \(v_metric ->> 'value'\)::numeric;[\s\S]*values \([\s\S]*v_metric_key,[\s\S]*v_metric_value::integer/,
    );
    expect(confirmationFunction).toContain("'gmv'");
  });

  it("computes aligned, divergent, and missing-system evidence under the report row lock", () => {
    expect(migration).toMatch(
      /select[\s\S]*lr\.system_duration[\s\S]*lr\.claimed_duration[\s\S]*lr\.risk_flags[\s\S]*for update of lr/,
    );
    expect(migration).toMatch(
      /v_confirmed_duration := coalesce\([\s\S]*nullif\(p_confirmed_duration, 0\)[\s\S]*v_ocr\.extracted_duration/,
    );
    expect(migration).toContain(
      "greatest(v_report.system_duration * 0.10, 15)",
    );
    expect(migration).toMatch(
      /v_divergence_pct := round\([\s\S]*abs\(v_report\.system_duration - v_confirmed_duration\)[\s\S]*v_evidence_level := 'green'[\s\S]*v_evidence_level := 'yellow'[\s\S]*duration_divergence/,
    );
    expect(migration).toMatch(
      /if v_report\.system_duration is not null then[\s\S]*v_evidence_level := 'green'[\s\S]*else[\s\S]*missing_system_duration[\s\S]*v_time_source := 'screenshot'[\s\S]*v_evidence_level := 'yellow'/,
    );
    expect(migration).toMatch(
      /missing_screenshot_duration[\s\S]*v_time_source := 'claimed'[\s\S]*v_evidence_level := 'red'/,
    );
    expect(migration).toMatch(
      /flag not like 'ocr\\_%' escape '\\'[\s\S]*duration_divergence[\s\S]*missing_system_duration[\s\S]*missing_screenshot_duration/,
    );
  });

  it("does not weaken streamer metric row-level security", () => {
    expect(migration).not.toContain(
      "alter table public.streamer_metrics disable row level security",
    );
    expect(migration).not.toMatch(
      /create policy[\s\S]*on public\.streamer_metrics/,
    );
    expect(migration).not.toMatch(
      /create policy[\s\S]*(insert|update)[\s\S]*streamer_metrics/,
    );
  });
});
