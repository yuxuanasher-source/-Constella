import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = resolve(
  process.cwd(),
  "supabase/migrations/20260726150000_live_report_metric_trust.sql",
);

describe("live report metric trust migration", () => {
  it("adds and constrains the final viewer value source", () => {
    expect(existsSync(migrationPath)).toBe(true);
    const migration = readFileSync(migrationPath, "utf8");

    expect(migration).toMatch(
      /alter table public\.live_reports[\s\S]*add column if not exists viewers_source text/i,
    );
    expect(migration).toMatch(
      /viewers_source is null[\s\S]*viewers_source in \('ocr', 'manual', 'claimed'\)/i,
    );
    expect(migration).toMatch(
      /new\.viewers_source := 'manual'[\s\S]*new\.viewers_source := 'ocr'[\s\S]*new\.viewers_source := 'claimed'/i,
    );
  });

  it("flags cross-source viewer and GMV divergence without manufacturing green evidence", () => {
    const migration = readFileSync(migrationPath, "utf8");

    expect(migration).toContain("viewers_divergence");
    expect(migration).toContain("gmv_divergence");
    expect(migration).toMatch(
      /evidence_level = case[\s\S]*when[\s\S]*= 'green'[\s\S]*then 'yellow'/i,
    );
    expect(migration).not.toMatch(
      /then 'green'::public\.evidence_level/i,
    );
  });

  it("uses at least five prior GMV sessions and a robust historical threshold", () => {
    const migration = readFileSync(migrationPath, "utf8");

    expect(migration).toContain("gmv_historical_outlier");
    expect(migration).toMatch(/v_history_count >= 5/i);
    expect(migration).toMatch(/percentile_cont\(0\.5\)/i);
    expect(migration).toMatch(/v_mad \* 3/i);
    expect(migration).toMatch(
      /source_report_id is distinct from new\.source_report_id/i,
    );
    expect(migration).toMatch(
      /create constraint trigger streamer_metrics_sync_gmv_report_trust[\s\S]*deferrable initially deferred/i,
    );
  });
});
