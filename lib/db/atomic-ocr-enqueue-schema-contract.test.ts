import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = join(
  process.cwd(),
  "supabase/migrations/20260726103000_atomic_ocr_enqueue.sql",
);
const migration = existsSync(migrationPath)
  ? readFileSync(migrationPath, "utf8").toLowerCase()
  : "";

describe("atomic OCR enqueue schema contract", () => {
  it("creates a service-role-only security-definer RPC", () => {
    expect(migration).not.toBe("");
    expect(migration).toContain("function public.enqueue_ocr_job(");
    expect(migration).toMatch(
      /function public\.enqueue_ocr_job\([\s\S]*security definer[\s\S]*set search_path = ''/,
    );
    expect(migration).toMatch(
      /enqueue_ocr_job\([\s\S]*auth\.role\(\)[\s\S]*service_role/,
    );
    expect(migration).toMatch(
      /revoke all on function public\.enqueue_ocr_job\([\s\S]*from public, anon, authenticated, service_role/,
    );
    expect(migration).toMatch(
      /grant execute on function public\.enqueue_ocr_job\([\s\S]*to service_role/,
    );
    expect(migration).not.toMatch(
      /grant execute on function public\.enqueue_ocr_job\([\s\S]*to authenticated/,
    );
  });

  it("validates the report organization and payload identity under a row lock", () => {
    expect(migration).toMatch(
      /from public\.live_reports as lr[\s\S]*where lr\.id = p_live_report_id[\s\S]*lr\.organization_id = p_organization_id[\s\S]*for update/,
    );
    expect(migration).toContain(
      "ocr enqueue live report not found or organization mismatch",
    );
    expect(migration).toMatch(
      /p_payload ->> 'livereportid'[\s\S]*p_live_report_id::text/,
    );
  });

  it("rejects screenshots that do not belong to the exact report attribution", () => {
    expect(migration).toMatch(
      /from public\.report_screenshots as screenshot[\s\S]*screenshot\.id = p_screenshot_id[\s\S]*screenshot\.organization_id = v_report\.organization_id[\s\S]*screenshot\.live_report_id = v_report\.id[\s\S]*screenshot\.project_id = v_report\.project_id[\s\S]*screenshot\.streamer_id = v_report\.streamer_id/,
    );
    expect(migration).toContain(
      "ocr screenshot does not belong to live report",
    );
  });

  it("inserts the invocation, job, and OCR result in one function transaction", () => {
    expect(migration).toMatch(
      /insert into public\.ai_invocations[\s\S]*insert into public\.background_jobs[\s\S]*insert into public\.ocr_results/,
    );
    expect(migration).toMatch(
      /insert into public\.ai_invocations[\s\S]*actor_user_id[\s\S]*actor_name[\s\S]*actor_role[\s\S]*metadata/,
    );
    expect(migration).toMatch(
      /insert into public\.background_jobs[\s\S]*p_payload[\s\S]*p_invocation_id/,
    );
    expect(migration).toMatch(
      /insert into public\.ocr_results[\s\S]*p_live_report_id[\s\S]*p_screenshot_id[\s\S]*p_invocation_id[\s\S]*p_job_id/,
    );
    expect(migration).toContain("return to_jsonb(v_job)");
  });
});
