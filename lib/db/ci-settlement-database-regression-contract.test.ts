import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const workflow = readFileSync(
  join(process.cwd(), ".github/workflows/ci.yml"),
  "utf8",
);

function readJob(name: string) {
  const lines = workflow.split(/\r?\n/u);
  const start = lines.indexOf(`  ${name}:`);

  if (start === -1) {
    return "";
  }

  const nextJob = lines.findIndex(
    (line, index) => index > start && /^  [a-z0-9_-]+:$/u.test(line),
  );

  return lines.slice(start, nextJob === -1 ? undefined : nextJob).join("\n");
}

describe("settlement database regression CI contract", () => {
  it("runs the live schema regressions on migrated local Supabase and always cleans up", () => {
    const job = readJob("database-regression");
    const orderedCommands = [
      "run: pnpm supabase:start",
      "run: docker stop supabase_realtime_jingying-cabin",
      "run: pnpm supabase:migrate",
      "run: docker start supabase_realtime_jingying-cabin",
      "run: pnpm exec vitest run lib/db/schema-contract.test.ts",
      "run: docker stop supabase_realtime_jingying-cabin",
      "run: pnpm exec vitest run lib/db/custom-settlement-runtime-upgrade.test.ts",
      "run: pnpm exec supabase stop --no-backup",
    ];

    expect(job).toContain("  database-regression:");
    expect(job).toContain("runs-on: ubuntu-latest");
    expect(job).toContain("timeout-minutes: 30");
    expect(job).toContain("uses: actions/checkout@v4");
    expect(job).toContain("uses: pnpm/action-setup@v4");
    expect(job).toContain("version: 10.12.1");
    expect(job).toContain("uses: actions/setup-node@v4");
    expect(job).toContain("run: pnpm install --frozen-lockfile");

    let previousCommandIndex = -1;
    for (const command of orderedCommands) {
      const commandIndex = job.indexOf(command, previousCommandIndex + 1);
      expect(commandIndex, command).toBeGreaterThan(previousCommandIndex);
      previousCommandIndex = commandIndex;
    }

    expect(job).toContain(
      "CUSTOM_SETTLEMENT_RUNTIME_DB_REGRESSION_CONTAINER: supabase_db_jingying-cabin",
    );
    expect(job).toContain(
      "SETTLEMENT_AI_DB_LOCK_REGRESSION_CONTAINER: supabase_db_jingying-cabin",
    );
    expect(job).toContain(
      "CUSTOM_SETTLEMENT_RUNTIME_UPGRADE_REGRESSION_CONTAINER: supabase_db_jingying-cabin",
    );
    expect(job).toContain(
      "CUSTOM_SETTLEMENT_RUNTIME_UPGRADE_REALTIME_CONTAINER: supabase_realtime_jingying-cabin",
    );
    expect(job).toMatch(
      /if: always\(\)[\s\S]+run: pnpm exec supabase stop --no-backup/u,
    );
    expect(job).not.toContain("secrets.");
  });
});
