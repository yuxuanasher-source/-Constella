import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260610133000_project_collaboration_execution_attribution.sql",
  ),
  "utf8",
).toLowerCase();

const attributedTables = [
  "project_applications",
  "recording_submissions",
  "project_streamers",
  "live_tasks",
  "live_reports",
  "settlement_batch_items",
];

describe("project MCN collaboration execution attribution schema", () => {
  it("adds collaboration and contributor organization attribution to execution tables", () => {
    for (const table of attributedTables) {
      expect(migration).toMatch(
        new RegExp(
          `alter table public\\.${table}[\\s\\S]*add column if not exists collaboration_id uuid references public\\.project_collaboration_agreements\\(id\\)`,
        ),
      );
      expect(migration).toMatch(
        new RegExp(
          `alter table public\\.${table}[\\s\\S]*add column if not exists contributor_organization_id uuid references public\\.organizations\\(id\\)`,
        ),
      );
    }
  });

  it("indexes collaboration execution attribution", () => {
    for (const table of attributedTables) {
      expect(migration).toContain(`${table}_collaboration_idx`);
      expect(migration).toContain(`${table}_contributor_idx`);
    }
  });

  it("allows active collaboration contributors through RLS policies", () => {
    for (const table of [
      "project_applications",
      "recording_submissions",
      "project_streamers",
      "live_tasks",
      "live_reports",
    ]) {
      expect(migration).toContain(`${table}_collaboration_contributor_access`);
      expect(migration).toMatch(
        new RegExp(
          `on public\\.${table}[\\s\\S]*public\\.can_contribute_to_project\\(project_id, contributor_organization_id\\)`,
        ),
      );
    }
  });

  it("requires collaborator rows to reference an active agreement for writes", () => {
    expect(migration).toContain(
      "function public.has_active_project_collaboration",
    );
    expect(migration).toContain("agreement.status = 'active'");
    expect(migration).toContain("agreement.id = target_collaboration_id");
  });
});
