import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260602013000_p1_admission_foundation.sql",
  ),
  "utf8",
);
const loader = readFileSync(
  join(
    process.cwd(),
    "features/streamers/streamer-project-review-loader.ts",
  ),
  "utf8",
);

describe("recording submissions schema contract", () => {
  it("declares every recording_submissions column selected by the review loader", () => {
    const tableDefinition = migration.match(
      /create table public\.recording_submissions\s*\(([\s\S]*?)\n\);/i,
    )?.[1];
    const selectedColumns = loader.match(
      /\.from\("recording_submissions"\)\s*\.select\("([^"]+)"\)/,
    )?.[1]
      .split(",")
      .map((column) => column.trim()) ?? [];
    const declaredColumns = new Set(
      (tableDefinition?.match(/^\s*([a-z_]+)\s+/gim) ?? []).map((line) =>
        line.trim().split(/\s+/, 1)[0],
      ),
    );

    expect(tableDefinition).toBeDefined();
    expect(selectedColumns).not.toEqual([]);
    expect(selectedColumns.filter((column) => !declaredColumns.has(column))).toEqual(
      [],
    );
  });
});
