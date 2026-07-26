import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("platform admin Supabase repository contracts", () => {
  it("selects the current subscription plan through its explicit relationship", () => {
    const source = readFileSync(
      join(
        process.cwd(),
        "features/platform-admin/platform-admin-repository-supabase.ts",
      ),
      "utf8",
    );

    expect(source).toContain(
      "billing_plans!organization_subscriptions_plan_id_fkey(id, code, name)",
    );
  });
});
