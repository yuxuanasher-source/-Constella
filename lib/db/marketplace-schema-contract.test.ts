import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(process.cwd(), "supabase/migrations/20260627100000_marketplace_foundation.sql"),
  "utf8",
).toLowerCase();

describe("marketplace foundation schema contract", () => {
  it("creates the marketplace tables with organization anchors", () => {
    for (const table of [
      "marketplace_postings",
      "marketplace_posting_private",
      "marketplace_applications",
      "marketplace_application_private",
      "marketplace_deals",
    ]) {
      expect(migration).toContain(`create table if not exists public.${table}`);
      expect(migration).toContain(
        `alter table public.${table} enable row level security`,
      );
    }
    expect(migration).toMatch(
      /marketplace_postings[\s\S]*organization_id uuid not null references public\.organizations\(id\)/,
    );
    expect(migration).toMatch(
      /marketplace_applications[\s\S]*applicant_organization_id uuid not null references public\.organizations\(id\)/,
    );
  });

  it("adds the platform-public-read helper for cross-org visibility", () => {
    expect(migration).toContain(
      "create or replace function public.is_platform_mcn_staff()",
    );
    expect(migration).toContain("public.is_marketplace_posting_owner");
    expect(migration).toContain("public.is_marketplace_posting_partner");
  });

  it("keeps non-negative money and a single application per applicant", () => {
    expect(migration).toContain("budget_cents is null or budget_cents >= 0");
    expect(migration).toContain("quote_cents is null or quote_cents >= 0");
    expect(migration).toContain("unique (posting_id, applicant_organization_id)");
  });

  it("exposes public postings/applications only when not draft", () => {
    // 公开读策略：平台 MCN 仅可读已公开状态。
    expect(migration).toContain("marketplace_postings_public_read");
    expect(migration).toMatch(
      /marketplace_postings_public_read[\s\S]*is_platform_mcn_staff\(\)[\s\S]*status in \('open', 'matched', 'closed'\)/,
    );
    expect(migration).toContain("marketplace_applications_public_read");
  });

  it("gates private contact fields behind owner/partner policies", () => {
    expect(migration).toContain("marketplace_posting_private_partner_read");
    expect(migration).toContain("marketplace_application_private_owner_read");
  });

  it("records the matched deal with collaboration bridge columns", () => {
    expect(migration).toContain(
      "collaboration_application_id uuid references public.project_collaboration_applications(id)",
    );
    expect(migration).toContain(
      "collaboration_agreement_id uuid references public.project_collaboration_agreements(id)",
    );
    expect(migration).toContain("status in ('pending_collaboration', 'collaboration_active', 'cancelled')");
  });
});
