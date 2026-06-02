import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const p1Migration = readFileSync(
  join(
    process.cwd(),
    "supabase",
    "migrations",
    "20260602013000_p1_admission_foundation.sql",
  ),
  "utf8",
);

describe("P1 admission schema contract", () => {
  it("declares streamer pool and admission tables", () => {
    const requiredTables = [
      "streamer_accounts",
      "streamer_suppliers",
      "project_streamers",
      "project_applications",
      "recording_submissions",
    ];

    for (const table of requiredTables) {
      expect(p1Migration).toContain(`create table public.${table}`);
    }
  });

  it("enables RLS for every new P1 business table", () => {
    const requiredTables = [
      "streamer_accounts",
      "streamer_suppliers",
      "project_streamers",
      "project_applications",
      "recording_submissions",
    ];

    for (const table of requiredTables) {
      expect(p1Migration).toContain(
        `alter table public.${table} enable row level security`,
      );
    }
  });

  it("keeps single-streamer visibility and org isolation in policies", () => {
    expect(p1Migration).toContain(
      "public.current_streamer_id(organization_id)",
    );
    expect(p1Migration).toContain("public.is_org_member(organization_id)");
    expect(p1Migration).toContain("public.is_mcn_staff(organization_id)");
    expect(p1Migration).toContain("public.can_access_project(project_id)");
  });
});
