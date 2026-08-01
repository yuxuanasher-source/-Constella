import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = join(
  process.cwd(),
  "supabase/migrations/20260731090000_ocr_usage_reservations.sql",
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

  it("reserves OCR allowance before creating any enqueue artifacts", () => {
    expect(migration).not.toBe("");
    expect(migration).toContain("function public.enqueue_ocr_job(");
    expect(migration).toMatch(
      /from public\.usage_monthly_counters[\s\S]*for update/,
    );
    expect(migration).toContain("ocr_usage_limit_reached");

    const reservation = migration.indexOf(
      "insert into public.usage_reservations",
    );
    const invocation = migration.indexOf("insert into public.ai_invocations");
    const backgroundJob = migration.indexOf(
      "insert into public.background_jobs",
    );
    expect(reservation).toBeGreaterThan(-1);
    expect(invocation).toBeGreaterThan(reservation);
    expect(backgroundJob).toBeGreaterThan(invocation);
  });

  it("keeps reservation mutation service-role-only and search-path hardened", () => {
    expect(migration).toMatch(
      /revoke all on table public\.usage_reservations[\s\S]*from public, anon, authenticated, service_role/,
    );
    expect(migration).not.toMatch(
      /grant (all|insert|update|delete) on table public\.usage_reservations/,
    );
    for (const functionName of [
      "consume_usage_reservation",
      "release_usage_reservation",
      "reserve_usage_reservation",
    ]) {
      expect(migration).toMatch(
        new RegExp(
          `function public\\.${functionName}\\([\\s\\S]*security definer[\\s\\S]*set search_path = ''`,
        ),
      );
      expect(migration).toMatch(
        new RegExp(
          `revoke all on function public\\.${functionName}\\([\\s\\S]*from public, anon, authenticated, service_role`,
        ),
      );
      expect(migration).toMatch(
        new RegExp(
          `grant execute on function public\\.${functionName}\\([\\s\\S]*to service_role`,
        ),
      );
    }
  });

  it("prevents authenticated clients from rewriting quota counters directly", () => {
    expect(migration).toMatch(
      /revoke insert, update, delete on table public\.usage_monthly_counters[\s\S]*from anon, authenticated/,
    );
  });

  it("consumes exactly once and releases only reserved usage", () => {
    expect(migration).toMatch(
      /function public\.consume_usage_reservation\([\s\S]*status = 'consumed'[\s\S]*insert into public\.usage_events/,
    );
    expect(migration).toMatch(
      /function public\.release_usage_reservation\([\s\S]*v_reservation\.status = 'consumed'[\s\S]*usage_reservation_already_consumed/,
    );
    expect(migration).toMatch(
      /update public\.usage_monthly_counters[\s\S]*used_quantity = used_quantity - v_reservation\.quantity[\s\S]*used_quantity >= v_reservation\.quantity/,
    );
  });

  it("re-arms only released reservations under the counter lock", () => {
    expect(migration).toMatch(
      /function public\.reserve_usage_reservation\([\s\S]*from public\.usage_reservations[\s\S]*for update[\s\S]*status in \('reserved', 'consumed'\)[\s\S]*from public\.usage_monthly_counters[\s\S]*for update/,
    );
    expect(migration).toMatch(
      /used_quantity \+ v_reservation\.quantity[\s\S]*ocr_usage_limit_reached[\s\S]*used_quantity = used_quantity \+ v_reservation\.quantity/,
    );
    expect(migration).toMatch(
      /status = 'reserved'[\s\S]*released_at = null[\s\S]*reserved_at = now\(\)[\s\S]*last_reviewed_at = null/,
    );
  });

  it("re-arms released reservations against the current month's active allowance", () => {
    const functionStart = migration.indexOf(
      "function public.reserve_usage_reservation(",
    );
    const functionEnd = migration.indexOf(
      "function public.list_stale_usage_reservations(",
      functionStart,
    );
    const functionSql = migration.slice(functionStart, functionEnd);

    expect(functionSql).toMatch(
      /from public\.usage_reservations[\s\S]*for update[\s\S]*v_period_month := date_trunc\('month', current_date\)::date/,
    );
    expect(functionSql).toMatch(
      /insert into public\.usage_monthly_counters[\s\S]*from public\.organization_subscriptions[\s\S]*join public\.billing_plans[\s\S]*status in \('trialing', 'active'\)[\s\S]*on conflict \(organization_id, metric, period_month\) do nothing/,
    );
    expect(functionSql).toMatch(
      /from public\.usage_monthly_counters[\s\S]*period_month = v_period_month[\s\S]*for update/,
    );
    expect(functionSql).toMatch(
      /period_month = v_period_month[\s\S]*status = 'reserved'/,
    );
  });

  it("tracks the current reservation attempt and review progression", () => {
    expect(migration).toMatch(
      /reserved_at timestamptz not null default now\(\)/,
    );
    expect(migration).toContain("last_reviewed_at timestamptz");
    expect(migration).toMatch(
      /insert into public\.usage_reservations \([\s\S]*reserved_at[\s\S]*\)\s*values \([\s\S]*now\(\)/,
    );
  });

  it("rotates stale reservations for service-role review without mutating quota state", () => {
    expect(migration).toMatch(
      /function public\.list_stale_usage_reservations\(\s*p_before timestamptz,\s*p_limit integer\s*\)[\s\S]*security definer[\s\S]*set search_path = ''/,
    );
    expect(migration).toMatch(
      /list_stale_usage_reservations\([\s\S]*auth\.role\(\)[\s\S]*service_role/,
    );
    expect(migration).toMatch(
      /where reservation\.status = 'reserved'[\s\S]*reservation\.reserved_at <= p_before[\s\S]*reservation\.last_reviewed_at is null[\s\S]*reservation\.last_reviewed_at <= p_before[\s\S]*order by\s*reservation\.last_reviewed_at asc nulls first,\s*reservation\.reserved_at,\s*reservation\.id[\s\S]*limit p_limit/,
    );
    expect(migration).toMatch(
      /revoke all on function public\.list_stale_usage_reservations\(timestamptz, integer\)[\s\S]*from public, anon, authenticated, service_role[\s\S]*grant execute on function public\.list_stale_usage_reservations\(timestamptz, integer\)[\s\S]*to service_role/,
    );

    const functionStart = migration.indexOf(
      "function public.list_stale_usage_reservations(",
    );
    const functionEnd = migration.indexOf(
      "function public.mark_stale_usage_reservation_reviewed(",
      functionStart,
    );
    const functionSql = migration.slice(functionStart, functionEnd);
    expect(functionStart).toBeGreaterThan(-1);
    expect(functionSql).toContain("reservation_id uuid");
    expect(functionSql).toContain("organization_id uuid");
    expect(functionSql).toContain("source text");
    expect(functionSql).toContain("reserved_at timestamptz");
    expect(functionSql).toContain("last_reviewed_at timestamptz");
    expect(functionSql).toContain("age_seconds bigint");
    expect(functionSql).not.toContain("metadata");
    expect(functionSql).not.toMatch(
      /\b(update|delete|release_usage_reservation)\b/,
    );
  });

  it("marks only the listed reservation attempt and review version", () => {
    expect(migration).toMatch(
      /function public\.mark_stale_usage_reservation_reviewed\([\s\S]*security definer[\s\S]*set search_path = ''/,
    );
    expect(migration).toMatch(
      /mark_stale_usage_reservation_reviewed\([\s\S]*auth\.role\(\)[\s\S]*service_role[\s\S]*from public\.usage_reservations[\s\S]*for update/,
    );
    expect(migration).toMatch(
      /v_reservation\.status <> 'reserved'[\s\S]*v_reservation\.reserved_at is distinct from p_expected_reserved_at[\s\S]*v_reservation\.last_reviewed_at is distinct from p_expected_last_reviewed_at/,
    );
    expect(migration).toMatch(
      /v_reservation\.reserved_at > p_before[\s\S]*v_reservation\.last_reviewed_at > p_before[\s\S]*update public\.usage_reservations[\s\S]*last_reviewed_at = v_reviewed_at/,
    );
    expect(migration).toMatch(
      /revoke all on function public\.mark_stale_usage_reservation_reviewed\(\s*uuid, timestamptz, timestamptz, timestamptz\s*\)[\s\S]*from public, anon, authenticated, service_role[\s\S]*grant execute on function public\.mark_stale_usage_reservation_reviewed\(\s*uuid, timestamptz, timestamptz, timestamptz\s*\)[\s\S]*to service_role/,
    );

    const functionStart = migration.indexOf(
      "function public.mark_stale_usage_reservation_reviewed(",
    );
    const functionEnd = migration.indexOf(
      "function public.reset_stale_usage_reservation_review(",
      functionStart,
    );
    const functionSql = migration.slice(functionStart, functionEnd);
    expect(functionStart).toBeGreaterThan(-1);
    expect(functionSql).not.toContain("metadata");
    expect(functionSql).not.toMatch(/status\s*=|used_quantity|usage_events/);
  });

  it("conditionally restores review progression after audit failure", () => {
    expect(migration).toMatch(
      /function public\.reset_stale_usage_reservation_review\([\s\S]*security definer[\s\S]*set search_path = ''/,
    );
    expect(migration).toMatch(
      /reset_stale_usage_reservation_review\([\s\S]*auth\.role\(\)[\s\S]*service_role[\s\S]*from public\.usage_reservations[\s\S]*for update/,
    );
    expect(migration).toMatch(
      /v_reservation\.status <> 'reserved'[\s\S]*v_reservation\.reserved_at is distinct from p_expected_reserved_at[\s\S]*v_reservation\.last_reviewed_at is distinct from p_failed_reviewed_at[\s\S]*last_reviewed_at = p_previous_reviewed_at/,
    );
    expect(migration).toMatch(
      /revoke all on function public\.reset_stale_usage_reservation_review\(\s*uuid, timestamptz, timestamptz, timestamptz\s*\)[\s\S]*from public, anon, authenticated, service_role[\s\S]*grant execute on function public\.reset_stale_usage_reservation_review\(\s*uuid, timestamptz, timestamptz, timestamptz\s*\)[\s\S]*to service_role/,
    );
  });
});
