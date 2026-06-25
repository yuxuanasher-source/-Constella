import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260614150000_project_collaboration_settlement.sql",
  ),
  "utf8",
).toLowerCase();

describe("project collaboration settlement schema", () => {
  it("creates collaboration revenue and settlement tables", () => {
    expect(migration).toContain("project_collaboration_revenue_records");
    expect(migration).toContain("project_collaboration_settlement_batches");
    expect(migration).toContain("project_collaboration_settlement_items");
  });

  it("exposes a scoped settlement read helper", () => {
    expect(migration).toContain(
      "function public.can_read_collaboration_settlement",
    );
    expect(migration).toContain("project_collaboration_agreements");
    expect(migration).toContain("partner_organization_id");
  });

  it("prevents duplicate revenue consumption per agreement and batch type", () => {
    expect(migration).toContain(
      "project_collaboration_settlement_items_unique_revenue",
    );
    expect(migration).toMatch(
      /unique index[\s\S]*on public\.project_collaboration_settlement_items[\s\S]*agreement_id[\s\S]*revenue_record_id[\s\S]*batch_type/,
    );
  });
});
