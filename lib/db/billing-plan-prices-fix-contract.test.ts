import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { DEFAULT_PUBLIC_PRICING_PLANS } from "@/app/pricing/pricing-data";

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260702100000_fix_billing_plan_prices.sql",
  ),
  "utf8",
).toLowerCase();

const paidPlanCodes = ["basic", "pro", "enterprise"] as const;

function migratedPriceCents(
  code: string,
  column: "monthly_price_cents" | "annual_price_cents",
): number {
  // Matches the controlled per-code update, e.g.
  //   update public.billing_plans
  //   set monthly_price_cents = 29900
  //   where code = 'basic'
  //     and monthly_price_cents = 0;
  const pattern = new RegExp(
    `update public\\.billing_plans\\s+set ${column} = (\\d+)\\s+` +
      `where code = '${code}'\\s+and ${column} = 0;`,
  );
  const match = migration.match(pattern);
  expect(match, `missing zero-guarded ${column} update for '${code}'`).not
    .toBeNull();
  return Number(match![1]);
}

describe("billing plan price fix contract", () => {
  it("fixes every paid plan with prices matching DEFAULT_PUBLIC_PRICING_PLANS", () => {
    for (const code of paidPlanCodes) {
      const fallback = DEFAULT_PUBLIC_PRICING_PLANS.find(
        (plan) => plan.code === code,
      );
      expect(fallback, `pricing-data.ts is missing plan '${code}'`).toBeDefined();

      const monthly = migratedPriceCents(code, "monthly_price_cents");
      const annual = migratedPriceCents(code, "annual_price_cents");

      // After the migration every paid plan is billable...
      expect(monthly).toBeGreaterThan(0);
      expect(annual).toBeGreaterThan(0);
      // ...and the billing source of truth matches the public pricing page.
      expect(monthly).toBe(fallback!.monthly_price_cents);
      expect(annual).toBe(fallback!.annual_price_cents);
    }
  });

  it("keeps the fix scoped to paid plans, leaving free/trial at 0", () => {
    expect(migration).not.toContain("where code = 'free'");
    expect(migration).not.toContain("where code = 'trial'");
    expect(migration).toContain("in ('basic', 'pro', 'enterprise')");
  });

  it("repairs active price versions without clobbering non-zero prices", () => {
    // Zero-priced active versions are updated from the corrected plan prices.
    expect(migration).toContain("update public.billing_plan_prices");
    expect(migration).toContain("and pp.active");
    expect(migration).toContain("and pp.price_cents = 0");
    // Missing plan/cycle combinations are inserted for both cycles.
    expect(migration).toContain("insert into public.billing_plan_prices");
    expect(migration).toContain("'monthly'::public.billing_cycle");
    expect(migration).toContain("'annual'::public.billing_cycle");
    expect(migration).toContain("not exists");
  });
});
