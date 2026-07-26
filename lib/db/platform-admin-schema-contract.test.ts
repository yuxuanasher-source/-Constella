import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260725120000_platform_admin_console.sql",
  ),
  "utf8",
);

describe("platform admin schema", () => {
  it.each([
    "platform_admins",
    "organization_primary_accounts",
    "billing_plan_cost_versions",
    "platform_admin_operation_logs",
  ])("creates %s", (table) => {
    expect(sql).toMatch(new RegExp(`create table public\\.${table}`, "i"));
    expect(sql).toMatch(
      new RegExp(
        `alter table public\\.${table} enable row level security`,
        "i",
      ),
    );
  });

  it("adds lifecycle state and primary-account provisioning", () => {
    expect(sql).toMatch(
      /add column lifecycle_status text not null default 'active'/i,
    );
    expect(sql).toMatch(/insert into public\.organization_primary_accounts/i);
    expect(sql).toMatch(
      /create or replace function public\.provision_self_serve_org/i,
    );
  });

  it("adds an atomic service-role organization creation function", () => {
    expect(sql).toMatch(
      /create or replace function public\.platform_create_organization/i,
    );
    expect(sql).toMatch(
      /revoke all on function public\.platform_create_organization/i,
    );
  });
});
