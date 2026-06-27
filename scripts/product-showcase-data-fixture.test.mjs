import { describe, expect, it } from "vitest";

import {
  DATASET,
  assertShowcaseExecutionAllowed,
  buildAccountLookupPlan,
  buildShowcaseManifest,
  buildShowcaseRows,
  createStableUuidFactory,
  normalizeAccountIdentifier,
} from "./product-showcase-data-fixture.mjs";

describe("product showcase account targeting", () => {
  it("normalizes account input used for server-side targeting", () => {
    expect(normalizeAccountIdentifier("  Demo.Owner@Example.CN  ")).toBe(
      "demo.owner@example.cn",
    );
    expect(normalizeAccountIdentifier("  JY-SALES-001  ")).toBe("jy-sales-001");
    expect(normalizeAccountIdentifier(" 13800138000 ")).toBe("13800138000");
  });

  it("builds a deterministic lookup plan for id email login account and phone", () => {
    expect(
      buildAccountLookupPlan("11111111-1111-4111-8111-111111111111"),
    ).toEqual([
      {
        column: "id",
        value: "11111111-1111-4111-8111-111111111111",
      },
    ]);

    expect(buildAccountLookupPlan("Demo.Owner@Example.CN")).toEqual([
      { column: "email", value: "demo.owner@example.cn" },
      { column: "login_account", value: "demo.owner@example.cn" },
    ]);

    expect(buildAccountLookupPlan("13800138000")).toEqual([
      { column: "phone", value: "13800138000" },
      { column: "login_account", value: "13800138000" },
    ]);
  });

  it("requires an explicit server execution switch", () => {
    expect(() =>
      assertShowcaseExecutionAllowed({
        NEXT_PUBLIC_SUPABASE_URL: "https://db.example.cn",
      }),
    ).toThrow(/ALLOW_PRODUCT_SHOWCASE_DATA=1/);

    expect(() =>
      assertShowcaseExecutionAllowed({
        NEXT_PUBLIC_SUPABASE_URL: "https://db.example.cn",
        ALLOW_PRODUCT_SHOWCASE_DATA: "1",
      }),
    ).not.toThrow();
  });
});

describe("product showcase rows", () => {
  it("creates stable account-scoped identifiers", () => {
    const uuidFor = createStableUuidFactory(
      "11111111-1111-4111-8111-111111111111",
      "22222222-2222-4222-8222-222222222222",
    );

    expect(uuidFor("primary-project")).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(uuidFor("primary-project")).toBe(uuidFor("primary-project"));
    expect(uuidFor("secondary-project")).not.toBe(uuidFor("primary-project"));
  });

  it("builds a reusable manifest for clearing only script-owned rows", () => {
    const manifest = buildShowcaseManifest({
      accountId: "11111111-1111-4111-8111-111111111111",
      organizationId: "22222222-2222-4222-8222-222222222222",
    });

    expect(manifest.organizationId).toBe(
      "22222222-2222-4222-8222-222222222222",
    );
    expect(manifest.projectIds).toHaveLength(2);
    expect(manifest.streamerIds).toHaveLength(3);
    expect(manifest.partnerOrganizationCode).toMatch(/^product-showcase-/);
  });

  it("covers the product walkthrough with project operations and settlement rows", () => {
    const rows = buildShowcaseRows({
      account: {
        id: "11111111-1111-4111-8111-111111111111",
        email: "owner@example.cn",
        full_name: "Product Owner",
      },
      organization: {
        id: "22222222-2222-4222-8222-222222222222",
        name: "Existing MCN",
        code: "existing-mcn",
      },
    });

    expect(rows.projects).toHaveLength(2);
    expect(rows.streamers).toHaveLength(3);
    expect(rows.liveTasks).toHaveLength(5);
    expect(rows.liveReports).toHaveLength(4);
    expect(rows.projectApplications).toHaveLength(3);
    expect(rows.settlementBatches).toHaveLength(2);
    expect(rows.settlementBatchItems.length).toBeGreaterThanOrEqual(3);
    expect(rows.notifications).toHaveLength(4);
    expect(rows.usageMonthlyCounters).toHaveLength(
      DATASET.requiredUsageMetrics.length,
    );
    expect(rows.streamers[0]).toMatchObject({
      user_id: "11111111-1111-4111-8111-111111111111",
    });
  });
});
