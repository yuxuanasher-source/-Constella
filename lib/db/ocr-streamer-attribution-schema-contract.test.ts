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

  it("exposes only a constrained OCR metric RPC to authenticated runners", () => {
    expect(migration).toContain("function public.upsert_ocr_streamer_metrics(");
    expect(migration).toMatch(
      /function public\.upsert_ocr_streamer_metrics\([\s\S]*security definer[\s\S]*set search_path = ''/,
    );
    expect(migration).toContain("auth.role()");
    expect(migration).toContain("public.is_mcn_staff(");
    expect(migration).toContain("public.can_access_project(");
    expect(migration).toMatch(
      /from public\.live_reports as lr[\s\S]*join public\.live_tasks as lt[\s\S]*coalesce\(\s*lt\.system_started_at,\s*lt\.planned_start_at,\s*lr\.created_at\s*\)\s+at time zone 'asia\/shanghai'/,
    );
    expect(migration).toMatch(
      /p_source_invocation_id[\s\S]*public\.ai_invocations[\s\S]*organization_id/,
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
      /grant execute on function public\.upsert_ocr_streamer_metrics\([\s\S]*to authenticated, service_role/,
    );
  });

  it("keeps RPC state and payload validation effective against direct callers", () => {
    expect(migration).toContain("p_human_confirmed boolean");
    expect(migration).toMatch(
      /p_human_confirmed[\s\S]*pending_review[\s\S]*ocr\.reviewed_at is not null/,
    );
    expect(migration).toMatch(
      /v_report\.status <> 'ocr_ing'[\s\S]*ocr\.reviewed_at is null/,
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
