import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  bridgeCreateShare,
  bridgeSubmitApplication,
  type BridgeActor,
  type BridgeDeps,
} from "./marketplace-bridge";
import { MarketplaceError } from "./marketplace-service";
import type { DealRecord } from "./marketplace-types";

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

const owner: BridgeActor = { userId: "u-o", role: "owner", organizationId: "org-owner" };
const mcn: BridgeActor = { userId: "u-m", role: "ops_manager", organizationId: "org-mcn" };

function makeDeps(seed: DealRecord) {
  let current = seed;
  return {
    deps: {
      getDeal: vi.fn(async () => current),
      updateDeal: vi.fn(async (_id, patch) => {
        current = { ...current, collaborationShareId: patch.collaboration_share_id, collaborationShareToken: patch.collaboration_share_token };
        return current;
      }),
      createShare: vi.fn(async () => ({ shareId: "share-1", token: "tok-abc" })),
      submitApplication: vi.fn(async () => ({ applicationId: "capp-1" })),
    } as BridgeDeps,
    get current() {
      return current;
    },
  };
}

describe("bridgeCreateShare (owner)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates a share and stores token on the deal", async () => {
    const h = makeDeps(deal());
    const res = await bridgeCreateShare(h.deps, owner, "deal-1", "proj-1");
    expect(res.shareId).toBe("share-1");
    expect(h.deps.createShare).toHaveBeenCalledWith({ actor: owner, projectId: "proj-1" });
    expect(h.deps.updateDeal).toHaveBeenCalledWith("deal-1", {
      collaboration_share_id: "share-1",
      collaboration_share_token: "tok-abc",
    });
  });

  it("rejects non-owner and non-pending deals", async () => {
    const h = makeDeps(deal());
    await expect(bridgeCreateShare(h.deps, mcn, "deal-1", "proj-1")).rejects.toThrow(/posting owner/);

    const h2 = makeDeps(deal({ status: "collaboration_active" }));
    await expect(bridgeCreateShare(h2.deps, owner, "deal-1", "proj-1")).rejects.toThrow(/not pending/);
  });
});

describe("bridgeSubmitApplication (applicant)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("submits a collaboration application using the deal's share token", async () => {
    const h = makeDeps(deal({ collaborationShareToken: "tok-abc" }));
    const res = await bridgeSubmitApplication(h.deps, mcn, "deal-1", { requestedRevenueShareBps: 3000 });
    expect(res.applicationId).toBe("capp-1");
    expect(h.deps.submitApplication).toHaveBeenCalledWith({
      actor: mcn,
      token: "tok-abc",
      requestedRevenueShareBps: 3000,
      applicantNote: "",
    });
  });

  it("rejects non-applicant, missing share, and out-of-range bps", async () => {
    const ready = deal({ collaborationShareToken: "tok-abc" });
    await expect(
      bridgeSubmitApplication(makeDeps(ready).deps, owner, "deal-1", { requestedRevenueShareBps: 3000 }),
    ).rejects.toThrow(/applicant/);

    await expect(
      bridgeSubmitApplication(makeDeps(deal()).deps, mcn, "deal-1", { requestedRevenueShareBps: 3000 }),
    ).rejects.toThrow(/has not created the collaboration share/);

    await expect(
      bridgeSubmitApplication(makeDeps(ready).deps, mcn, "deal-1", { requestedRevenueShareBps: 20000 }),
    ).rejects.toThrow(MarketplaceError);
  });
});
