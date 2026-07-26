import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = resolve(
  process.cwd(),
  "supabase/migrations/20260726110000_profile_insight_admission_source.sql",
);

describe("profile insight admission source migration", () => {
  it("replaces the source type constraint with recording and admission sources", () => {
    expect(existsSync(migrationPath)).toBe(true);
    const migration = readFileSync(migrationPath, "utf8");
    const dropConstraint = migration.indexOf(
      "drop constraint if exists streamer_profile_insights_source_type_check",
    );
    const addConstraint = migration.indexOf(
      "add constraint streamer_profile_insights_source_type_check",
    );

    expect(dropConstraint).toBeGreaterThan(-1);
    expect(addConstraint).toBeGreaterThan(dropConstraint);
    expect(migration).toMatch(
      /source_type\s+in\s*\(\s*'recording_ai_analysis'\s*,\s*'admission_review'\s*\)/,
    );
  });

  it("indexes admission evaluations for application-scoped vendor aggregation", () => {
    const migration = readFileSync(migrationPath, "utf8");

    expect(migration).toMatch(
      /create index if not exists admission_review_evaluations_application_org_stage_idx\s+on public\.admission_review_evaluations \(application_id, organization_id, stage\)/,
    );
  });
});
