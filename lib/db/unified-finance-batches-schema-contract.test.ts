import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260716160000_unified_finance_batches.sql",
  ),
  "utf8",
).toLowerCase();

describe("unified finance batch schema", () => {
  it("creates finance batch tables", () => {
    expect(migration).toContain(
      "create table if not exists public.finance_batches",
    );
    expect(migration).toContain(
      "create table if not exists public.finance_batch_items",
    );
    expect(migration).toContain(
      "create table if not exists public.finance_batch_adjustments",
    );
  });

  it("defines typed batches and status checks", () => {
    expect(migration).toContain("finance_batches_batch_type_check");
    for (const batchType of [
      "receivable",
      "streamer_payable",
      "project_cost",
      "collaboration_share",
    ]) {
      expect(migration).toContain(batchType);
    }

    expect(migration).toContain("finance_batches_status_check");
    for (const status of [
      "draft",
      "pending_review",
      "confirmed",
      "locked",
      "exported",
      "completed",
      "rejected",
      "reopened",
      "voided",
    ]) {
      expect(migration).toContain(status);
    }
  });

  it("prevents duplicate active source consumption", () => {
    expect(migration).toContain("finance_batch_items_active_source_uidx");
    expect(migration).toMatch(
      /unique index[\s\S]*finance_batch_items[\s\S]*organization_id[\s\S]*batch_type[\s\S]*source_type[\s\S]*source_id/,
    );
    expect(migration).toMatch(
      /finance_batch_items_active_source_uidx[\s\S]*where status = 'active'/,
    );
  });

  it("keeps project attribution on every item", () => {
    expect(migration).toMatch(
      /project_id uuid not null references public\.projects\(id\)/,
    );
    expect(migration).toContain("finance_batch_project_summary");
    for (const summaryColumn of [
      "receivable_amount",
      "streamer_payable_amount",
      "project_cost_amount",
      "collaboration_share_amount",
      "gross_margin_impact",
    ]) {
      expect(migration).toContain(summaryColumn);
    }
    expect(migration).toMatch(
      /create or replace view public\.finance_batch_project_summary\s+with \(security_invoker = true\)\s+as/,
    );
  });

  it("adds staff-scoped rls policies", () => {
    expect(migration).toContain("enable row level security");
    for (const policy of [
      ["finance_batches_staff_read", "finance_batches"],
      ["finance_batch_items_staff_read", "finance_batch_items"],
      ["finance_batch_adjustments_staff_read", "finance_batch_adjustments"],
    ]) {
      expect(migration).toMatch(
        new RegExp(
          `create policy ${policy[0]}[\\s\\S]*on public\\.${policy[1]}[\\s\\S]*using \\(public\\.is_mcn_staff\\(organization_id\\)\\)`,
        ),
      );
    }
  });
});
