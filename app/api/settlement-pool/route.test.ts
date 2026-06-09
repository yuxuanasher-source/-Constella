import { beforeEach, describe, expect, it, vi } from "vitest";

import { listOpsSettlementPool } from "@/features/settlements/settlement-queries";
import { getSettlementRouteContext } from "@/features/settlements/settlement-route-utils";
import { listSettlementPool } from "@/features/settlements/settlement-service";

vi.mock("@/features/settlements/settlement-queries", () => ({
  listOpsSettlementPool: vi.fn(),
}));

vi.mock("@/features/settlements/settlement-service", () => ({
  listSettlementPool: vi.fn(),
}));

vi.mock("@/features/settlements/settlement-route-utils", async () => {
  const actual = await vi.importActual<
    typeof import("@/features/settlements/settlement-route-utils")
  >("@/features/settlements/settlement-route-utils");
  return {
    ...actual,
    getSettlementRouteContext: vi.fn(),
  };
});

describe("settlement pool route", () => {
  const supabase = {};
  const repo = {};

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSettlementRouteContext).mockResolvedValue({
      supabase: supabase as never,
      repo: repo as never,
      audit: vi.fn() as never,
      notify: vi.fn() as never,
      auth: {
        userId: "user-owner",
        email: "owner@example.test",
        name: "Owner",
        organizationId: "org-1",
        organizationName: "Org One",
        role: "owner",
      },
    });
    vi.mocked(listOpsSettlementPool).mockResolvedValue([]);
  });

  it("scopes organization-wide pool reads to the authenticated organization", async () => {
    const { GET } = await import("./route");
    const response = await GET(
      new Request(
        "http://localhost/api/settlement-pool?periodStart=2026-06-01&periodEnd=2026-06-30",
      ),
    );

    expect(response.status).toBe(200);
    expect(listSettlementPool).not.toHaveBeenCalled();
    expect(listOpsSettlementPool).toHaveBeenCalledWith(supabase, {
      organizationId: "org-1",
      projectId: null,
      batchType: "payable",
      periodStart: "2026-06-01",
      periodEnd: "2026-06-30",
    });
  });
});
