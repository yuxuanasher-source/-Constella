import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20260720140000_recording_production_feedback_loop.sql",
  "utf8",
);

describe("recording production feedback schema", () => {
  it("creates project recording guides", () => {
    expect(migration).toContain(
      "create table if not exists public.project_recording_guides",
    );
    expect(migration).toContain("required_content jsonb not null default '[]'::jsonb");
    expect(migration).toContain("commercial_actions jsonb not null default '[]'::jsonb");
    expect(migration).toContain("unique (organization_id, project_id)");
  });

  it("adds advisory self-check metadata to recording submissions", () => {
    expect(migration).toContain("add column if not exists task_card_read_confirmed_at");
    expect(migration).toContain("add column if not exists self_check jsonb");
    expect(migration).toContain("add column if not exists key_moments jsonb");
    expect(migration).toContain("add column if not exists self_score_total integer");
    expect(migration).toContain("add column if not exists self_assessment_level text");
    expect(migration).toContain("recording_submissions_self_score_range");
  });

  it("keeps streamer access scoped to own project/application rows", () => {
    expect(migration).toContain("project_recording_guides_streamer_read_visible");
    expect(migration).toContain("current_streamer_id");
    expect(migration).toContain("p.is_public_to_streamers = true");
    expect(migration).toContain("project_recording_guides_staff_access");
  });
});
