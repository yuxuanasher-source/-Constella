import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = resolve(
  process.cwd(),
  "supabase/migrations/20260726140000_recording_submission_uploaded_by.sql",
);

describe("recording submission upload attribution migration", () => {
  it("adds a nullable uploader reference for historical rows", () => {
    expect(existsSync(migrationPath)).toBe(true);
    const migration = readFileSync(migrationPath, "utf8");

    expect(migration).toMatch(
      /alter table public\.recording_submissions\s+add column if not exists uploaded_by uuid references public\.profiles\(id\)/,
    );
    expect(migration).not.toMatch(/uploaded_by uuid not null/);
    expect(migration).toMatch(
      /comment on column public\.recording_submissions\.uploaded_by is\s*'[^']*historical[^']*nullable[^']*'/i,
    );
  });

  it("indexes uploader history by submission time", () => {
    const migration = readFileSync(migrationPath, "utf8");

    expect(migration).toMatch(
      /create index if not exists recording_submissions_uploaded_by_submitted_at_idx\s+on public\.recording_submissions \(uploaded_by, submitted_at desc\)/,
    );
  });
});
