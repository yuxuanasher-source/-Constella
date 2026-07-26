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
    expect(migration).toContain("ocr_results_streamer_report_date_idx");
    expect(migration).toContain("ocr_results_project_report_date_idx");
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

  it("does not weaken streamer metric row-level security", () => {
    expect(migration).not.toContain(
      "alter table public.streamer_metrics disable row level security",
    );
    expect(migration).not.toMatch(
      /create policy[\s\S]*on public\.streamer_metrics/,
    );
  });
});
