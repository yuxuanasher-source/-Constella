import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260619120000_default_billing_subscription.sql",
  ),
  "utf8",
).toLowerCase();

describe("default billing subscription provisioning", () => {
  it("seeds the standard plans idempotently", () => {
    expect(migration).toContain("insert into public.billing_plans");
    for (const tier of ["free", "basic", "pro", "enterprise"]) {
      expect(migration).toContain(`'${tier}'`);
    }
    expect(migration).toContain("on conflict (code) do nothing");
  });

  it("provisions a default subscription on the pro plan without overwriting", () => {
    expect(migration).toContain(
      "function public.ensure_default_org_subscription",
    );
    expect(migration).toContain("where code = 'pro'");
    expect(migration).toContain(
      "insert into public.organization_subscriptions",
    );
    // status keeps writes enabled (trialing is not read-only) and never clobbers
    // an organization that already has a subscription.
    expect(migration).toContain("'trialing'");
    expect(migration).toContain("on conflict (organization_id) do nothing");
  });

  it("backfills existing organizations and auto-provisions new ones", () => {
    // Backfill loop over organizations without a subscription.
    expect(migration).toContain("from public.organizations o");
    expect(migration).toContain(
      "left join public.organization_subscriptions s",
    );
    // Trigger covers every future organization-creation path.
    expect(migration).toContain(
      "create trigger organizations_default_subscription",
    );
    expect(migration).toContain("after insert on public.organizations");
  });
});
