import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const originalMigration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260726103000_atomic_ocr_enqueue.sql",
  ),
  "utf8",
);
const quotaMigration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260731090000_ocr_usage_reservations.sql",
  ),
  "utf8",
);
const migration = `${originalMigration}\n${quotaMigration}`;

describe("atomic OCR enqueue migration", () => {
  it("writes the supplied screenshot id into the OCR result row", () => {
    expect(migration).toMatch(
      /insert into public\.ocr_results \(\s*organization_id,\s*live_report_id,\s*screenshot_id,[\s\S]*?\)\s*values \(\s*v_report\.organization_id,\s*p_live_report_id,\s*p_screenshot_id,/,
    );
  });

  it("serializes submissions by live task and claims the task in the enqueue transaction", () => {
    const reportLock = migration.indexOf("from public.live_reports as lr");
    const taskLock = migration.indexOf("from public.live_tasks as task");
    const taskClaim = migration.indexOf(
      "status = 'report_pending_review'",
    );

    expect(reportLock).toBeGreaterThan(-1);
    expect(taskLock).toBeGreaterThan(reportLock);
    expect(taskClaim).toBeGreaterThan(taskLock);
    expect(migration).toMatch(
      /from public\.live_tasks as task[\s\S]*?task\.id = v_report\.live_task_id[\s\S]*?for update;/,
    );
    expect(migration).toContain("v_report.status <> 'ocr_ing'");
    expect(migration).toMatch(
      /v_task\.status not in \('pending_report', 'report_rejected'\)/,
    );
    expect(migration).toMatch(
      /update public\.live_tasks[\s\S]*?set\s+status = 'report_pending_review'[\s\S]*?where id = v_task\.id/,
    );
    expect(migration).toMatch(
      /update public\.live_reports as sibling[\s\S]*?sibling\.live_task_id = v_report\.live_task_id[\s\S]*?sibling\.id <> v_report\.id[\s\S]*?sibling\.status in \('rejected', 'need_more'\)/,
    );
  });

  it("only reuses an existing job when every OCR linkage still matches", () => {
    expect(migration).toContain(
      "v_existing_result.ai_invocation_id is distinct from v_job.ai_invocation_id",
    );
    expect(migration).toContain(
      "v_existing_result.screenshot_id is distinct from p_screenshot_id",
    );
    expect(migration).toMatch(
      /v_job\.payload ->> 'liveReportId'[\s\S]*?p_live_report_id::text/,
    );
    expect(migration).toMatch(
      /v_job\.payload ->> 'screenshotId'[\s\S]*?p_screenshot_id::text/,
    );
  });

  it("checks for an exact existing job before reserving quota", () => {
    const existingResult = quotaMigration.indexOf(
      "from public.ocr_results as result",
    );
    const existingReturn = quotaMigration.indexOf("return to_jsonb(v_job)");
    const quotaCounter = quotaMigration.indexOf(
      "from public.usage_monthly_counters",
      existingReturn,
    );

    expect(existingResult).toBeGreaterThan(-1);
    expect(existingReturn).toBeGreaterThan(existingResult);
    expect(quotaCounter).toBeGreaterThan(existingReturn);
  });
});
