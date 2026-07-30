import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = join(
  process.cwd(),
  "supabase/migrations/20260729193000_admission_share_access_rate_limit.sql",
);

describe("admission share access persistence contract", () => {
  it("defines persistent attempts, opaque sessions, and an atomic limiter", () => {
    expect(existsSync(migrationPath)).toBe(true);
    if (!existsSync(migrationPath)) {
      return;
    }

    const sql = readFileSync(migrationPath, "utf8").toLowerCase();
    expect(sql).toContain("project_recording_share_access_attempts");
    expect(sql).toContain("project_recording_share_access_sessions");
    expect(sql).toContain("consume_admission_share_access_attempt");
    expect(sql).toContain("security definer");
    expect(sql).toContain("p_succeeded boolean");
    expect(sql).toContain("p_max_failures integer default 5");
    expect(sql).toContain("p_block_seconds integer default 900");
    expect(sql).toContain("revoke all");
    expect(sql).toContain("service_role");
  });
});
