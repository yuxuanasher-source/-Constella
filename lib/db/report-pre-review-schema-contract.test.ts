import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260629100000_report_pre_review_results.sql",
  ),
  "utf8",
).toLowerCase();

describe("report pre-review schema contract", () => {
  it("stores append-only AI pre-review results with safe references", () => {
    expect(migration).toContain(
      "create table public.report_pre_review_results",
    );
    expect(migration).toContain(
      "live_report_id uuid not null references public.live_reports(id) on delete cascade",
    );
    expect(migration).toContain(
      "ai_invocation_id uuid references public.ai_invocations(id) on delete set null",
    );
    expect(migration).toContain(
      "status_snapshot jsonb not null default '{}'::jsonb",
    );
    expect(migration).toContain("decision text not null");
    expect(migration).toContain("suggested_action text not null");
    expect(migration).toContain("review_note_draft text not null");
    expect(migration).toContain(
      "created_by uuid references public.profiles(id)",
    );
    expect(migration).toContain("report_pre_review_results_decision_check");
    expect(migration).toContain("report_pre_review_results_action_check");
    expect(migration).toContain("report_pre_review_results_confidence_check");
    expect(migration).toContain("report_pre_review_results_source_check");
  });

  it("allows MCN staff to select and insert without update or delete policies", () => {
    expect(migration).toContain(
      "alter table public.report_pre_review_results enable row level security",
    );
    expect(migration).toContain(
      "create policy report_pre_review_results_staff_read",
    );
    expect(migration).toContain(
      "create policy report_pre_review_results_staff_insert",
    );
    expect(migration).toContain("using (public.is_mcn_staff(organization_id))");
    expect(migration).toContain(
      "with check (public.is_mcn_staff(organization_id))",
    );
    expect(migration).not.toContain(
      "on public.report_pre_review_results for update",
    );
    expect(migration).not.toContain(
      "on public.report_pre_review_results for delete",
    );
  });
});
