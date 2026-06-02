import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(process.cwd(), "supabase/migrations/20260602203000_p5_billing.sql"),
  "utf8",
).toLowerCase();

describe("P5 billing schema contract", () => {
  it("creates organization-scoped billing tables", () => {
    for (const table of [
      "billing_plans",
      "organization_subscriptions",
      "usage_events",
      "usage_monthly_counters",
      "usage_addons",
      "feature_addons",
    ]) {
      expect(migration).toContain(`create table public.${table}`);
    }

    for (const table of [
      "organization_subscriptions",
      "usage_events",
      "usage_monthly_counters",
      "usage_addons",
      "feature_addons",
    ]) {
      expect(migration).toContain(
        `organization_id uuid not null references public.organizations(id)`,
      );
    }
  });

  it("enables RLS and org-scoped billing policies", () => {
    for (const table of [
      "organization_subscriptions",
      "usage_events",
      "usage_monthly_counters",
      "usage_addons",
      "feature_addons",
    ]) {
      expect(migration).toContain(
        `alter table public.${table} enable row level security`,
      );
      expect(migration).toContain(`on public.${table}`);
    }
  });

  it("stores usage and money with integer-safe types", () => {
    expect(migration).toContain("amount_cents integer not null");
    expect(migration).toContain("quantity integer not null");
    expect(migration).toContain("included_quantity integer not null");
    expect(migration).not.toContain(" double precision");
    expect(migration).not.toContain(" real");
  });
});
