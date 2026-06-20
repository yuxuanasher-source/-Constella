import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260619140000_atomic_settlement_batch_generation.sql",
  ),
  "utf8",
).toLowerCase();

describe("atomic settlement batch generation", () => {
  it("defines the generate_settlement_batch function", () => {
    expect(migration).toContain(
      "function public.generate_settlement_batch",
    );
  });

  it("persists the batch, items and report pointers together", () => {
    expect(migration).toContain("insert into public.settlement_batches");
    expect(migration).toContain("insert into public.settlement_batch_items");
    // Mirrors markReportSettled's claim-if-unsettled guard.
    expect(migration).toContain("update public.live_reports");
    expect(migration).toContain("settled_batch_item_id is null");
  });

  it("returns the inserted batch and items so callers can map them", () => {
    expect(migration).toContain("jsonb_build_object('batch'");
  });
});
