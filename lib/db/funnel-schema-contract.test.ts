import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(process.cwd(), "supabase/migrations/20260620110000_funnel_onboarding.sql"),
  "utf8",
).toLowerCase();

describe("Self-serve funnel schema contract", () => {
  it("creates funnel and onboarding tables plus the leads table", () => {
    for (const table of [
      "onboarding_progress",
      "funnel_events",
      "mcn_onboarding_requests",
    ]) {
      expect(migration).toContain(`create table public.${table}`);
    }
  });

  it("provisions self-serve orgs through a security definer function", () => {
    expect(migration).toContain(
      "create or replace function public.provision_self_serve_org",
    );
    expect(migration).toContain("security definer");
    expect(migration).toContain("status, billing_cycle");
    expect(migration).toContain("'trialing'");
  });

  it("keeps onboarding progress idempotent and org-scoped", () => {
    expect(migration).toContain("unique (organization_id, step)");
    expect(migration).toContain(
      "alter table public.onboarding_progress enable row level security",
    );
    expect(migration).toContain("public.is_mcn_staff(organization_id)");
  });

  it("guards funnel events so anonymous pre-signup events stay service-role only", () => {
    expect(migration).toContain(
      "alter table public.funnel_events enable row level security",
    );
    expect(migration).toContain("anonymous_id text");
    expect(migration).toContain("organization_id is not null");
  });
});
