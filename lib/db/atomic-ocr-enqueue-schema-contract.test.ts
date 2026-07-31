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
const quotaMigrationPath = join(
  process.cwd(),
  "supabase/migrations/20260731090000_ocr_usage_reservations.sql",
);
const quotaMigration = existsSync(quotaMigrationPath)
  ? readFileSync(quotaMigrationPath, "utf8").toLowerCase()
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

  it("reserves OCR allowance before creating any enqueue artifacts", () => {
    expect(quotaMigration).not.toBe("");
    expect(quotaMigration).toContain("function public.enqueue_ocr_job(");
    expect(quotaMigration).toMatch(
      /from public\.usage_monthly_counters[\s\S]*for update/,
    );
    expect(quotaMigration).toContain("ocr_usage_limit_reached");

    const reservation = quotaMigration.indexOf(
      "insert into public.usage_reservations",
    );
    const invocation = quotaMigration.indexOf(
      "insert into public.ai_invocations",
    );
    const backgroundJob = quotaMigration.indexOf(
      "insert into public.background_jobs",
    );
    expect(reservation).toBeGreaterThan(-1);
    expect(invocation).toBeGreaterThan(reservation);
    expect(backgroundJob).toBeGreaterThan(invocation);
  });

  it("keeps reservation mutation service-role-only and search-path hardened", () => {
    expect(quotaMigration).toMatch(
      /revoke all on table public\.usage_reservations[\s\S]*from public, anon, authenticated, service_role/,
    );
    expect(quotaMigration).not.toMatch(
      /grant (all|insert|update|delete) on table public\.usage_reservations/,
    );
    for (const functionName of [
      "consume_usage_reservation",
      "release_usage_reservation",
      "reserve_usage_reservation",
    ]) {
      expect(quotaMigration).toMatch(
        new RegExp(
          `function public\\.${functionName}\\([\\s\\S]*security definer[\\s\\S]*set search_path = ''`,
        ),
      );
      expect(quotaMigration).toMatch(
        new RegExp(
          `revoke all on function public\\.${functionName}\\([\\s\\S]*from public, anon, authenticated, service_role`,
        ),
      );
      expect(quotaMigration).toMatch(
        new RegExp(
          `grant execute on function public\\.${functionName}\\([\\s\\S]*to service_role`,
        ),
      );
    }
  });

  it("prevents authenticated clients from rewriting quota counters directly", () => {
    expect(quotaMigration).toMatch(
      /revoke insert, update, delete on table public\.usage_monthly_counters[\s\S]*from anon, authenticated/,
    );
  });

  it("consumes exactly once and releases only reserved usage", () => {
    expect(quotaMigration).toMatch(
      /function public\.consume_usage_reservation\([\s\S]*status = 'consumed'[\s\S]*insert into public\.usage_events/,
    );
    expect(quotaMigration).toMatch(
      /function public\.release_usage_reservation\([\s\S]*v_reservation\.status = 'consumed'[\s\S]*usage_reservation_already_consumed/,
    );
    expect(quotaMigration).toMatch(
      /update public\.usage_monthly_counters[\s\S]*used_quantity = used_quantity - v_reservation\.quantity[\s\S]*used_quantity >= v_reservation\.quantity/,
    );
  });

  it("re-arms only released reservations under the counter lock", () => {
    expect(quotaMigration).toMatch(
      /function public\.reserve_usage_reservation\([\s\S]*from public\.usage_reservations[\s\S]*for update[\s\S]*status in \('reserved', 'consumed'\)[\s\S]*from public\.usage_monthly_counters[\s\S]*for update/,
    );
    expect(quotaMigration).toMatch(
      /used_quantity \+ v_reservation\.quantity[\s\S]*ocr_usage_limit_reached[\s\S]*used_quantity = used_quantity \+ v_reservation\.quantity/,
    );
    expect(quotaMigration).toMatch(
      /status = 'reserved'[\s\S]*released_at = null/,
    );
  });
});
