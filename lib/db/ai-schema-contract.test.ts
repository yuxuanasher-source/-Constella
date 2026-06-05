import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migrationsDir = join(process.cwd(), "supabase", "migrations");
const allMigrations = readdirSync(migrationsDir)
  .filter((file) => file.endsWith(".sql"))
  .map((file) => readFileSync(join(migrationsDir, file), "utf8").toLowerCase())
  .join("\n");

describe("AI runtime schema contract", () => {
  it("creates organization-scoped AI runtime tables", () => {
    for (const table of [
      "ai_invocations",
      "ai_tool_invocations",
      "background_jobs",
      "prompts",
      "streamer_metrics",
      "supplier_scores",
      "scoring_weights",
      "recommendation_outcomes",
      "project_reviews",
      "ai_diagnoses",
      "ai_script_versions",
    ]) {
      expect(allMigrations).toContain(`create table public.${table}`);
      expect(allMigrations).toMatch(
        new RegExp(
          `create table public\\.${table} \\([\\s\\S]*?organization_id uuid not null references public\\.organizations\\(id\\)`,
        ),
      );
      expect(allMigrations).toContain(
        `alter table public.${table} enable row level security`,
      );
    }
  });

  it("links OCR jobs and results to the AI invocation ledger", () => {
    expect(allMigrations).toContain("job_type text not null");
    expect(allMigrations).toContain("ocr.extract_live_report");
    expect(allMigrations).toContain(
      "ai_invocation_id uuid references public.ai_invocations(id)",
    );
    expect(allMigrations).toMatch(
      /alter table public\.ocr_results[\s\S]*add column if not exists ai_invocation_id/,
    );
    expect(allMigrations).toMatch(
      /alter table public\.ocr_results[\s\S]*add column if not exists background_job_id/,
    );
    expect(allMigrations).toMatch(
      /alter table public\.ocr_results[\s\S]*add column if not exists raw_response/,
    );
  });

  it("uses integer-safe AI costs and token counters", () => {
    expect(allMigrations).toContain("prompt_tokens integer not null default 0");
    expect(allMigrations).toContain(
      "completion_tokens integer not null default 0",
    );
    expect(allMigrations).toContain("cost_cents integer not null default 0");
    expect(allMigrations).not.toMatch(/\s(double precision|real)(\s|,|\))/);
  });
});
