import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260730120000_admission_share_business_workflow.sql",
  ),
  "utf8",
).toLowerCase();

describe("admission share business workflow migration", () => {
  it("freezes the MCN review fact and copies it onto share items", () => {
    expect(migration).toContain(
      "mcn_review_decision public.recording_review_status",
    );
    expect(migration).toContain("mcn_reviewed_by uuid");
    expect(migration).toContain("mcn_reviewed_at timestamptz");
    expect(migration).toContain("mcn_review_note text");
    expect(migration).toContain("guard_recording_mcn_review_fact");
    expect(migration).toContain("recording_mcn_review_fact_is_immutable");
    expect(migration).toMatch(
      /alter table public\.project_recording_share_items[\s\S]+mcn_review_decision public\.recording_review_status/u,
    );
    expect(migration).toContain("mcn_review_decision = 'approved'");
  });

  it("adds board workflow state and versioned vendor review tables", () => {
    expect(migration).toContain("mode text not null default 'formal_review'");
    expect(migration).toContain(
      "review_state text not null default 'not_started'",
    );
    expect(migration).toContain("round_number integer not null default 1");

    for (const table of [
      "project_recording_vendor_review_drafts",
      "project_recording_vendor_review_submissions",
      "project_recording_vendor_review_submission_items",
    ]) {
      expect(migration).toContain(`create table public.${table}`);
    }
  });

  it("adds RLS-protected events and playback issue reporting", () => {
    for (const table of [
      "project_recording_share_events",
      "project_recording_share_playback_issues",
    ]) {
      expect(migration).toContain(`create table public.${table}`);
      expect(migration).toContain(
        `alter table public.${table} enable row level security`,
      );
      expect(migration).toMatch(
        new RegExp(
          `create policy ${table}_staff_read[\\s\\S]+?on public\\.${table}[\\s\\S]+?for select[\\s\\S]+?public\\.is_org_member\\(organization_id\\)[\\s\\S]+?public\\.can_access_project\\(project_id\\)`,
          "u",
        ),
      );
    }
  });

  it("normalizes duplicate formal boards before enforcing uniqueness", () => {
    const normalization = migration.indexOf("row_number() over");
    const uniqueIndex = migration.indexOf(
      "project_recording_share_boards_one_open_formal_idx",
    );

    expect(normalization).toBeGreaterThanOrEqual(0);
    expect(migration).toMatch(
      /row_number\(\) over \(\s*partition by organization_id,\s*project_id\s*order by created_at desc,\s*id desc\s*\)/u,
    );
    expect(uniqueIndex).toBeGreaterThan(normalization);
    expect(migration).toMatch(
      /create unique index project_recording_share_boards_one_open_formal_idx[\s\S]+where mode = 'formal_review'[\s\S]+status = 'active'[\s\S]+locked_at is null/u,
    );
  });
});
