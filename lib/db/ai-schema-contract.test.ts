import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migrationsDir = join(process.cwd(), "supabase", "migrations");
const allMigrations = readdirSync(migrationsDir)
  .filter((file) => file.endsWith(".sql"))
  .map((file) => readFileSync(join(migrationsDir, file), "utf8").toLowerCase())
  .join("\n");
const ocrRunnerClaimMigration = readFileSync(
  join(migrationsDir, "20260608215200_ocr_runner_service_role_claims.sql"),
  "utf8",
).toLowerCase();

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

  it("adds production OCR job operation fields without exposing raw secrets", () => {
    expect(allMigrations).toMatch(
      /alter table public\.background_jobs[\s\S]*add column if not exists error_code/,
    );
    expect(allMigrations).toMatch(
      /alter table public\.background_jobs[\s\S]*add column if not exists error_message/,
    );
    expect(allMigrations).toMatch(
      /alter table public\.background_jobs[\s\S]*add column if not exists result/,
    );
    expect(allMigrations).toMatch(
      /alter table public\.background_jobs[\s\S]*add column if not exists reviewed_by/,
    );
    expect(allMigrations).toMatch(
      /alter table public\.background_jobs[\s\S]*add column if not exists reviewed_at/,
    );
    expect(allMigrations).toContain("pending");
    expect(allMigrations).toContain("processing");
    expect(allMigrations).toContain("needs_review");
  });

  it("adds OCR job claim and project-scoped operation policies", () => {
    expect(allMigrations).toContain("function public.claim_ocr_jobs");
    expect(allMigrations).toContain("for update skip locked");
    expect(allMigrations).toContain("public.can_access_ocr_job");
    expect(allMigrations).toContain("payload ->> 'livereportid'");
    expect(allMigrations).toContain("create policy ocr_results_staff_insert");
    expect(allMigrations).toContain("create policy ocr_results_staff_update");
  });

  it("preserves service-role OCR runner claims with live report organization checks", () => {
    expect(ocrRunnerClaimMigration).toContain(
      "create or replace function public.claim_ocr_jobs",
    );
    expect(ocrRunnerClaimMigration).toContain("auth.role() = 'service_role'");
    expect(ocrRunnerClaimMigration).toMatch(
      /lr\.id = public\.ocr_job_live_report_id\(bj\.payload\)[\s\S]*lr\.organization_id = p_organization_id/,
    );
    expect(ocrRunnerClaimMigration).toMatch(
      /public\.can_access_ocr_job\(bj\.organization_id, bj\.payload\)[\s\S]*auth\.role\(\) = 'service_role'/,
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

  it("keeps knowledge documents upsertable and metadata rich", () => {
    expect(allMigrations).toMatch(
      /alter table public\.knowledge_documents[\s\S]*add column if not exists metadata jsonb not null default '\{\}'::jsonb/,
    );
    expect(allMigrations).toContain(
      "on public.knowledge_documents (organization_id, source_ref)",
    );
  });

  it("stores retrievable knowledge chunks with business filters", () => {
    expect(allMigrations).toContain(
      "create table if not exists public.knowledge_document_chunks",
    );
    for (const column of [
      "knowledge_document_id uuid not null references public.knowledge_documents(id) on delete cascade",
      "project_id text",
      "streamer_id text",
      "product text",
      "platform text",
      "tags text[] not null default '{}'",
    ]) {
      expect(allMigrations).toContain(column);
    }
    expect(allMigrations).toContain(
      "knowledge_document_chunks_org_filters_idx",
    );
    expect(allMigrations).toContain("knowledge_document_chunks_tags_idx");
  });
});
