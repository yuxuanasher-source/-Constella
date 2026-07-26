import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = resolve(
  process.cwd(),
  "supabase/migrations/20260726130000_streamer_performance_real_economics.sql",
);

describe("streamer performance real economics migration", () => {
  it("backfills historical average duration before enforcing the default", () => {
    expect(existsSync(migrationPath)).toBe(true);
    const migration = readFileSync(migrationPath, "utf8");

    expect(migration).toMatch(
      /add column if not exists avg_session_minutes numeric\(12,\s*2\)\s*,/,
    );
    expect(migration).toMatch(
      /update public\.streamer_performance_snapshots\s+set avg_session_minutes = case\s+when live_sessions > 0 then round\(total_live_minutes::numeric \/ live_sessions,\s*2\)\s+else 0\s+end\s+where avg_session_minutes is null/i,
    );
    expect(migration).toMatch(
      /alter column avg_session_minutes set default 0/i,
    );
    expect(migration).toMatch(
      /alter column avg_session_minutes set not null/i,
    );
    expect(migration).toMatch(
      /add column if not exists total_settlement_amount numeric\(12,\s*2\)/,
    );
    expect(migration).toMatch(
      /add column if not exists actual_hourly_rate numeric\(12,\s*2\)/,
    );
    expect(migration).toMatch(
      /add column if not exists total_gmv_amount numeric\(14,\s*2\)/,
    );
    expect(migration).toMatch(/add column if not exists roi_bps integer/);
    expect(migration).toMatch(
      /add column if not exists views_per_hour numeric\(14,\s*2\)/,
    );

    const addAt = migration.indexOf(
      "add column if not exists avg_session_minutes",
    );
    const updateAt = migration.indexOf(
      "update public.streamer_performance_snapshots",
    );
    const notNullAt = migration.indexOf(
      "alter column avg_session_minutes set not null",
    );
    expect(addAt).toBeLessThan(updateAt);
    expect(updateAt).toBeLessThan(notNullAt);
  });

  it("does not relabel legacy configured-rate ROI history as real ROI", () => {
    const migration = readFileSync(migrationPath, "utf8");

    expect(migration).not.toMatch(
      /rename column avg_session_roi_bps to roi_bps/,
    );
  });
});
