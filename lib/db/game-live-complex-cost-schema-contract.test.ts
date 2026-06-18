import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260616190000_game_live_complex_cost_rules.sql",
  ),
  "utf8",
);

describe("game live complex cost rules schema", () => {
  it("declares project entitlement, rule, cost item, and import tables", () => {
    expect(migration).toContain(
      "create table if not exists public.project_complex_cost_rule_entitlements",
    );
    expect(migration).toContain(
      "create table if not exists public.cost_rule_templates",
    );
    expect(migration).toContain(
      "create table if not exists public.project_cost_rule_versions",
    );
    expect(migration).toContain(
      "create table if not exists public.project_cost_items",
    );
    expect(migration).toContain(
      "create table if not exists public.project_cost_import_batches",
    );
  });

  it("pins money, status, and source constraints", () => {
    expect(migration).toContain("amount_cents bigint not null");
    expect(migration).toContain("status text not null");
    expect(migration).toContain("source text not null");
    expect(migration).toContain("check (amount_cents >= 0)");
    expect(migration).toContain(
      "check (source in ('system', 'import', 'manual'))",
    );
  });

  it("enables RLS on all new tables", () => {
    expect(migration).toContain(
      "alter table public.project_complex_cost_rule_entitlements enable row level security",
    );
    expect(migration).toContain(
      "alter table public.cost_rule_templates enable row level security",
    );
    expect(migration).toContain(
      "alter table public.project_cost_rule_versions enable row level security",
    );
    expect(migration).toContain(
      "alter table public.project_cost_items enable row level security",
    );
    expect(migration).toContain(
      "alter table public.project_cost_import_batches enable row level security",
    );
  });

  it("allows scoped writes for staff-managed complex cost tables", () => {
    expect(migration).toContain(
      "create policy project_complex_cost_entitlements_staff_insert",
    );
    expect(migration).toContain(
      "create policy project_cost_rule_versions_staff_insert",
    );
    expect(migration).toContain(
      "create policy project_cost_rule_versions_staff_update",
    );
    expect(migration).toContain(
      "create policy project_cost_items_staff_insert",
    );
    expect(migration).toContain(
      "create policy project_cost_items_staff_update",
    );
    expect(migration).toContain(
      "create policy project_cost_import_batches_staff_insert",
    );
    expect(migration).toContain(
      "create policy project_cost_import_batches_staff_update",
    );
    expect(migration).toContain(
      "public.current_user_role(organization_id) in ('owner', 'ops_manager')",
    );
    expect(migration).toContain(
      "public.current_user_role(organization_id) in ('owner', 'ops_manager', 'operator_business')",
    );
    expect(migration).toContain("and public.can_access_project(project_id)");
  });
});
