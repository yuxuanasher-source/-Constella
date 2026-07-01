import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260701090000_recording_assets.sql",
  ),
  "utf8",
).toLowerCase();

describe("recording assets schema contract", () => {
  it("creates organization-scoped recording asset tables with RLS", () => {
    for (const table of ["recording_assets", "recording_asset_sources"]) {
      expect(migration).toContain(`create table if not exists public.${table}`);
      expect(migration).toMatch(
        new RegExp(
          `create table if not exists public\\.${table} \\([\\s\\S]*?organization_id uuid not null references public\\.organizations\\(id\\)`,
        ),
      );
      expect(migration).toContain(
        `alter table public.${table} enable row level security`,
      );
    }
  });

  it("links legacy admission submissions and streamer library rows to assets", () => {
    expect(migration).toMatch(
      /alter table public\.recording_submissions[\s\S]*add column if not exists asset_id uuid references public\.recording_assets\(id\)/,
    );
    expect(migration).toMatch(
      /alter table public\.streamer_recording_links[\s\S]*add column if not exists asset_id uuid references public\.recording_assets\(id\)/,
    );
    expect(migration).toContain(
      "recording_submission_id uuid references public.recording_submissions(id) on delete cascade",
    );
    expect(migration).toContain(
      "streamer_recording_link_id uuid references public.streamer_recording_links(id) on delete cascade",
    );
  });

  it("records normalized source kind, preview state, and source refs", () => {
    for (const value of ["bilibili_url", "external_url", "storage_object"]) {
      expect(migration).toContain(`'${value}'`);
    }
    for (const value of ["pending", "previewable", "external_only", "private_file"]) {
      expect(migration).toContain(`'${value}'`);
    }
    expect(migration).toContain("source_ref text not null");
    expect(migration).toContain(
      "unique (organization_id, source_ref)",
    );
  });

  it("backfills and keeps existing recording writes synchronized", () => {
    expect(migration).toContain(
      "function public.sync_recording_asset_from_submission",
    );
    expect(migration).toContain(
      "function public.sync_recording_asset_from_streamer_link",
    );
    expect(migration).toContain(
      "create trigger recording_submissions_sync_asset",
    );
    expect(migration).toContain(
      "create trigger streamer_recording_links_sync_asset",
    );
    expect(migration).toContain("recording_submissions:");
    expect(migration).toContain("streamer_recording_links:");
  });
});
