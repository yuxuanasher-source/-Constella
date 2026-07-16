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
    expect(migration).toContain("streamer_payable");
    expect(migration).toContain("collaboration_share");
    expect(migration).toContain("finance_batches_status_check");
    expect(migration).toContain("draft");
    expect(migration).toContain("locked");
    expect(migration).toContain("voided");
  });

  it("prevents duplicate active source consumption", () => {
    expect(migration).toContain("finance_batch_items_active_source_uidx");
    expect(migration).toMatch(
      /unique index[\s\S]*finance_batch_items[\s\S]*organization_id[\s\S]*batch_type[\s\S]*source_type[\s\S]*source_id/,
    );
  });

  it("keeps project attribution on every item", () => {
    expect(migration).toMatch(
      /project_id uuid not null references public\.projects\(id\)/,
    );
    expect(migration).toContain("finance_batch_project_summary");
  });

  it("adds staff-scoped rls policies", () => {
    expect(migration).toContain("enable row level security");
    expect(migration).toContain("finance_batches_staff_read");
    expect(migration).toContain("public.is_mcn_staff(organization_id)");
  });
});
