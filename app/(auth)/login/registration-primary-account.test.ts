import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260725120000_platform_admin_console.sql",
  ),
  "utf8",
);

describe("self-registration primary account", () => {
  it("records the signup user before returning the organization", () => {
    const functionStart = migration.indexOf(
      "create or replace function public.provision_self_serve_org",
    );
    const functionEnd = migration.indexOf(
      "revoke all on function public.provision_self_serve_org",
      functionStart,
    );
    const body = migration.slice(functionStart, functionEnd);

    expect(body.indexOf("organization_primary_accounts")).toBeGreaterThan(-1);
    expect(body.indexOf("organization_primary_accounts")).toBeLessThan(
      body.indexOf("return v_org_id"),
    );
  });
});
