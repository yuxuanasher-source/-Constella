import { describe, expect, it } from "vitest";

import {
  computeApplicantProfiles,
  computeMarketDynamics,
  computeMatches,
  computeSupplyHeat,
  recommendPostingsForMcn,
} from "./marketplace-intel";
import type { ApplicationPublic, PostingPublic } from "./marketplace-types";

const NOW = Date.parse("2026-06-27T00:00:00.000Z");

function posting(over: Partial<PostingPublic>): PostingPublic {
  return {
    id: "p",
    organizationId: "org-a",
    postType: "demand",
    status: "open",
    title: "需求",
    productName: null,
    category: null,
    budgetCents: null,
    settlementMethod: null,
    requirements: null,
    description: null,
    deadlineAt: null,
    details: {},
    createdAt: "2026-06-26T00:00:00.000Z",
    updatedAt: "2026-06-26T00:00:00.000Z",
    ...over,
  };
}
function application(over: Partial<ApplicationPublic>): ApplicationPublic {
  return {
    id: "a",
    postingId: "p1",
    applicantOrganizationId: "org-mcn",
    status: "submitted",
    streamerLineup: null,
    pastCases: null,
    quoteCents: null,
    resources: null,
    message: null,
    reviewNote: null,
    submittedAt: NOW.toString(),
    reviewedAt: null,
    createdAt: "2026-06-26T00:00:00.000Z",
    updatedAt: "2026-06-26T00:00:00.000Z",
    ...over,
  };
}

describe("computeMarketDynamics", () => {
  it("counts fresh postings/products in window and lists recent", () => {
    const postings = [
      posting({ id: "p1", productName: "产品甲", createdAt: "2026-06-26T00:00:00.000Z" }),
      posting({ id: "p2", productName: "产品乙", createdAt: "2026-06-20T00:00:00.000Z" }),
      posting({ id: "p3", productName: "产品甲", createdAt: "2026-06-01T00:00:00.000Z" }),
    ];
    const d = computeMarketDynamics(postings, NOW, 7);
    expect(d.newPostings).toBe(2); // p1, p2 in last 7 days
    expect(d.newProducts.sort()).toEqual(["产品乙", "产品甲"]);
    expect(d.recent[0].id).toBe("p1"); // most recent first
    expect(d.sourceRef).toContain("marketplace_postings");
  });
});

describe("computeSupplyHeat", () => {
  it("aggregates publishers, categories and budget buckets over open postings", () => {
    const postings = [
      posting({ id: "p1", organizationId: "org-a", category: "品类甲", budgetCents: 50_000 }),
      posting({ id: "p2", organizationId: "org-a", category: "品类甲", budgetCents: 2_000_000 }),
      posting({ id: "p3", organizationId: "org-b", category: "品类乙", budgetCents: 20_000_000 }),
      posting({ id: "p4", organizationId: "org-c", category: "品类甲", status: "matched" }),
    ];
    const h = computeSupplyHeat(postings);
    expect(h.totalOpen).toBe(3); // p4 is matched, excluded
    expect(h.publishers).toBe(2); // org-a, org-b
    expect(h.byCategory[0]).toEqual({ category: "品类甲", count: 2 });
    expect(h.budgetBuckets.find((b) => b.label === "≤1千")?.count).toBe(1);
    expect(h.budgetBuckets.find((b) => b.label === ">10万")?.count).toBe(1);
  });
});

describe("computeApplicantProfiles", () => {
  it("profiles applicants by category coverage / quote range / deals", () => {
    const postings = [posting({ id: "p1", category: "品类甲" }), posting({ id: "p2", category: "品类乙" })];
    const apps = [
      application({ id: "a1", applicantOrganizationId: "org-x", postingId: "p1", quoteCents: 30_000 }),
      application({ id: "a2", applicantOrganizationId: "org-x", postingId: "p2", quoteCents: 50_000, status: "deal_confirmed" }),
    ];
    const { profiles } = computeApplicantProfiles(apps, postings);
    expect(profiles[0].organizationId).toBe("org-x");
    expect(profiles[0].applications).toBe(2);
    expect(profiles[0].deals).toBe(1);
    expect(new Set(profiles[0].categories)).toEqual(new Set(["品类甲", "品类乙"]));
    expect(profiles[0].quoteRange).toEqual({ minCents: 30_000, maxCents: 50_000 });
  });
});

describe("recommendPostingsForMcn", () => {
  it("ranks by preferred-category match, excludes own & already-applied", () => {
    const postings = [
      posting({ id: "p1", organizationId: "org-a", category: "品类甲" }),
      posting({ id: "p2", organizationId: "org-a", category: "品类乙", budgetCents: 100_000 }),
      posting({ id: "p3", organizationId: "org-mcn", category: "品类甲" }), // own → excluded
      posting({ id: "applied", organizationId: "org-a", category: "品类甲" }),
    ];
    const recs = recommendPostingsForMcn(
      { organizationId: "org-mcn", myApplicationPostingIds: ["applied"], myOpenPostingCategories: [] },
      postings,
      NOW,
      5,
    );
    const ids = recs.map((r) => r.refId);
    expect(ids).not.toContain("p3"); // own posting
    expect(ids).not.toContain("applied"); // already applied
    // p1 matches preferred category 品类甲 (from applied posting) → ranks above p2
    expect(recs[0].refId).toBe("p1");
    expect(recs[0].reasons.some((r) => r.includes("品类匹配"))).toBe(true);
  });
});

describe("computeMatches", () => {
  it("includes vendor-side applicant recs only when actor has open postings", () => {
    const postings = [
      posting({ id: "p1", organizationId: "org-vendor", category: "品类甲" }),
      posting({ id: "p2", organizationId: "org-other", category: "品类甲" }),
    ];
    const apps = [application({ id: "a1", applicantOrganizationId: "org-mcn", postingId: "p2" })];
    const result = computeMatches(
      { organizationId: "org-vendor", myApplicationPostingIds: [], myOpenPostingCategories: ["品类甲"] },
      postings,
      apps,
      NOW,
    );
    expect(result.recommendations.some((r) => r.kind === "applicant")).toBe(true);
    expect(result.sourceRef).toContain("public");
  });
});
