import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260702090000_streamer_profile_insights.sql",
  ),
  "utf8",
).toLowerCase();

describe("streamer profile insights schema contract", () => {
  it("creates confirmed streamer profile insights linked to recording AI analysis", () => {
    expect(migration).toContain(
      "create table if not exists public.streamer_profile_insights",
    );
    expect(migration).toContain(
      "streamer_id uuid not null references public.streamers(id) on delete cascade",
    );
    expect(migration).toContain(
      "recording_asset_id uuid references public.recording_assets(id) on delete set null",
    );
    expect(migration).toContain(
      "recording_ai_analysis_id uuid references public.recording_ai_analyses(id) on delete set null",
    );
    expect(migration).toContain("source_type text not null");
    expect(migration).toContain("source_ref text not null");
  });

  it("keeps profile insight writes idempotent and searchable", () => {
    expect(migration).toContain(
      "unique (organization_id, source_type, source_ref)",
    );
    expect(migration).toContain("streamer_profile_insights_streamer_idx");
    expect(migration).toContain("streamer_profile_insights_tags_idx");
    expect(migration).toContain("tags text[] not null default '{}'");
    expect(migration).toContain("dimensions jsonb not null default '[]'::jsonb");
  });

  it("enforces organization-scoped staff access", () => {
    expect(migration).toContain(
      "alter table public.streamer_profile_insights enable row level security",
    );
    expect(migration).toContain("streamer_profile_insights_staff_access");
    expect(migration).toContain("public.is_org_member(organization_id)");
    expect(migration).toContain("public.is_mcn_staff(organization_id)");
  });
});
