import { beforeEach, describe, expect, it, vi } from "vitest";

import * as ctxMod from "@/features/marketplace/marketplace-route-utils";
import * as depsMod from "@/features/marketplace/marketplace-bridge-server";
import type { DealRecord } from "@/features/marketplace/marketplace-types";

vi.mock("@/features/marketplace/marketplace-route-utils", async () => {
  const actual = await vi.importActual<typeof ctxMod>(
    "@/features/marketplace/marketplace-route-utils",
  );
  return { ...actual, getMarketplaceContext: vi.fn() };
});
vi.mock("@/features/marketplace/marketplace-bridge-server", () => ({
  buildBridgeDeps: vi.fn(),
}));

function deal(over: Partial<DealRecord> = {}): DealRecord {
  return {
    id: "deal-1",
    postingId: "p1",
    applicationId: "app-1",
    ownerOrganizationId: "org-owner",
    applicantOrganizationId: "org-mcn",
    status: "pending_collaboration",
    collaborationApplicationId: null,
    collaborationAgreementId: null,
    collaborationShareId: null,
    collaborationShareToken: null,
    createdAt: "2026-06-27T00:00:00Z",
    ...over,
  };
}

function ctxFor(role: string, org: string, dealRow: DealRecord) {
  const updated: DealRecord[] = [];
  return {
    ctx: {
      actor: { userId: `u-${org}`, name: org, role, organizationId: org },
      repo: {
        getDealById: vi.fn(async () => dealRow),
        updateDeal: vi.fn(async (_id: string, patch: Record<string, unknown>) => {
          updated.push({ ...dealRow, ...(patch as Partial<DealRecord>) });
          return dealRow;
        }),
      },
    },
    updated,
  };
}

const createShare = vi.fn(async () => ({ shareId: "share-1", token: "tok-abc" }));
const submitApplication = vi.fn(async () => ({ applicationId: "capp-1" }));

function wireDeps(ctx: { repo: { getDealById: unknown; updateDeal: unknown } }) {
  vi.mocked(depsMod.buildBridgeDeps).mockReturnValue({
    getDeal: ctx.repo.getDealById as never,
    updateDeal: ctx.repo.updateDeal as never,
    createShare,
    submitApplication,
  });
}

function post(body: Record<string, unknown> = {}) {
  return new Request("http://localhost/x", { method: "POST", body: JSON.stringify(body) });
}

describe("POST /api/marketplace/deals/[id]/bridge-share", () => {
  beforeEach(() => vi.clearAllMocks());

  it("owner creates the collaboration share and stores it on the deal", async () => {
    const { ctx } = ctxFor("owner", "org-owner", deal());
    vi.mocked(ctxMod.getMarketplaceContext).mockResolvedValue(ctx as never);
    wireDeps(ctx);
    const { POST } = await import("./route");
    const res = await POST(post({ projectId: "proj-1" }), { params: Promise.resolve({ id: "deal-1" }) });
    expect(res.status).toBe(200);
    expect((await res.json()).shareId).toBe("share-1");
    expect(createShare).toHaveBeenCalledWith({ actor: ctx.actor, projectId: "proj-1" });
  });

  it("rejects a non-owner caller", async () => {
    const { ctx } = ctxFor("ops_manager", "org-mcn", deal());
    vi.mocked(ctxMod.getMarketplaceContext).mockResolvedValue(ctx as never);
    wireDeps(ctx);
    const { POST } = await import("./route");
    const res = await POST(post({ projectId: "proj-1" }), { params: Promise.resolve({ id: "deal-1" }) });
    expect(res.status).toBe(403);
  });
});

describe("POST /api/marketplace/deals/[id]/collab-apply", () => {
  beforeEach(() => vi.clearAllMocks());

  it("applicant submits a collaboration application via the deal token", async () => {
    const { ctx } = ctxFor("ops_manager", "org-mcn", deal({ collaborationShareToken: "tok-abc" }));
    vi.mocked(ctxMod.getMarketplaceContext).mockResolvedValue(ctx as never);
    wireDeps(ctx);
    const { POST } = await import("../collab-apply/route");
    const res = await POST(post({ requestedRevenueShareBps: 3000 }), { params: Promise.resolve({ id: "deal-1" }) });
    expect(res.status).toBe(200);
    expect((await res.json()).applicationId).toBe("capp-1");
    expect(submitApplication).toHaveBeenCalledWith({
      actor: ctx.actor,
      token: "tok-abc",
      requestedRevenueShareBps: 3000,
      applicantNote: "",
    });
  });

  it("409s when the owner has not created the share yet", async () => {
    const { ctx } = ctxFor("ops_manager", "org-mcn", deal());
    vi.mocked(ctxMod.getMarketplaceContext).mockResolvedValue(ctx as never);
    wireDeps(ctx);
    const { POST } = await import("../collab-apply/route");
    const res = await POST(post({ requestedRevenueShareBps: 3000 }), { params: Promise.resolve({ id: "deal-1" }) });
    expect(res.status).toBe(409);
  });
});
