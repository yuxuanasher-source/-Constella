import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260701100000_recording_ai_analysis.sql",
  ),
  "utf8",
).toLowerCase();

describe("recording AI analysis schema contract", () => {
  it("creates recording analysis and segment tables with asset linkage", () => {
    expect(migration).toContain(
      "create table if not exists public.recording_ai_analyses",
    );
    expect(migration).toContain(
      "asset_id uuid not null references public.recording_assets(id) on delete cascade",
    );
    expect(migration).toContain(
      "ai_invocation_id uuid references public.ai_invocations(id) on delete set null",
    );
    expect(migration).toContain(
      "create table if not exists public.recording_ai_segments",
    );
    expect(migration).toContain(
      "analysis_id uuid not null references public.recording_ai_analyses(id) on delete cascade",
    );
  });

  it("keeps analysis state auditable and retryable", () => {
    for (const value of ["queued", "running", "succeeded", "failed"]) {
      expect(migration).toContain(`'${value}'`);
    }
    expect(migration).toContain("attempt integer not null default 0");
    expect(migration).toContain("max_attempts integer not null default 3");
    expect(migration).toContain("error_summary text");
    expect(migration).toContain("recording_ai_analyses_active_asset_uidx");
    expect(migration).toContain("where status in ('queued','running')");
  });

  it("enforces organization RLS while allowing streamers to read their own analysis", () => {
    for (const table of ["recording_ai_analyses", "recording_ai_segments"]) {
      expect(migration).toContain(
        `alter table public.${table} enable row level security`,
      );
      expect(migration).toContain(`${table}_staff_access`);
      expect(migration).toContain(`${table}_streamer_read_own`);
    }
  });
});
