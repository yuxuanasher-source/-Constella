import { beforeEach, describe, expect, it, vi } from "vitest";

import * as ctx from "@/features/marketplace/marketplace-route-utils";
import type {
  ApplicationPublic,
  PostingPublic,
} from "@/features/marketplace/marketplace-types";

vi.mock("@/features/marketplace/marketplace-route-utils", async () => {
  const actual = await vi.importActual<typeof ctx>(
    "@/features/marketplace/marketplace-route-utils",
  );
  return { ...actual, getMarketplaceContext: vi.fn() };
});

// 市场动态按「距 now 7 天」窗口过滤，夹具时间必须相对当前时间，
// 否则用例会随日历自然过期（曾在 2026-07-03 因窗口滑出而失败）。
const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

function posting(over: Partial<PostingPublic>): PostingPublic {
  return {
    id: "p1",
    organizationId: "org-a",
    postType: "demand",
    status: "open",
    title: "需求",
    productName: "产品甲",
    category: "品类甲",
    budgetCents: 50_000,
    settlementMethod: null,
    requirements: null,
    description: null,
    deadlineAt: null,
    details: {},
    createdAt: oneDayAgo,
    updatedAt: oneDayAgo,
    ...over,
  };
}
function application(over: Partial<ApplicationPublic>): ApplicationPublic {
  return {
    id: "a1",
    postingId: "p1",
    applicantOrganizationId: "org-mcn",
    status: "submitted",
    streamerLineup: null,
    pastCases: null,
    quoteCents: 30_000,
    resources: null,
    message: null,
    reviewNote: null,
    submittedAt: "2026-06-26T00:00:00.000Z",
    reviewedAt: null,
    createdAt: "2026-06-26T00:00:00.000Z",
    updatedAt: "2026-06-26T00:00:00.000Z",
    ...over,
  };
}

describe("GET /api/marketplace/intel", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns market dynamics / supply heat / profiles / matches from public data", async () => {
    const publicPostings = [
      posting({ id: "p1", organizationId: "org-a", category: "品类甲" }),
      posting({ id: "p2", organizationId: "org-b", category: "品类乙", budgetCents: 5_000_000 }),
    ];
    const publicApplications = [
      application({ id: "a1", applicantOrganizationId: "org-mcn", postingId: "p1" }),
    ];
    vi.mocked(ctx.getMarketplaceContext).mockResolvedValue({
      auth: { organizationId: "org-vendor", userId: "u", name: "V", role: "owner" },
      repo: {
        listPublicPostings: async () => publicPostings,
        listPublicApplications: async () => publicApplications,
        listMyPostings: async () => [posting({ id: "p1", organizationId: "org-vendor", category: "品类甲" })],
        listMyApplications: async () => [],
      },
      audit: vi.fn(),
      actor: { userId: "u", name: "V", role: "owner", organizationId: "org-vendor" },
    } as never);

    const { GET } = await import("./route");
    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.marketDynamics.newProducts).toContain("产品甲");
    expect(json.supplyHeat.totalOpen).toBeGreaterThan(0);
    expect(json.supplyHeat.publishers).toBeGreaterThan(0);
    expect(json.applicantProfiles.profiles[0].organizationId).toBe("org-mcn");
    // vendor 有公开需求(品类甲) → 应含接单方推荐
    expect(json.matches.recommendations.some((r: { kind: string }) => r.kind === "applicant")).toBe(true);
  });
});
