import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

import { assertBillingWriteAllowed } from "@/features/billing/route-guard";
import { getComplexCostRouteContext } from "@/features/complex-cost/complex-cost-route-utils";
import { attachProjectCostItemsToSettlementBatch } from "@/features/complex-cost/complex-cost-service";

vi.mock("@/features/billing/route-guard", () => ({
  assertBillingWriteAllowed: vi.fn(),
}));
vi.mock("@/features/complex-cost/complex-cost-service", () => ({
  attachProjectCostItemsToSettlementBatch: vi.fn(),
}));
vi.mock("@/features/complex-cost/complex-cost-route-utils", () => ({
  getComplexCostRouteContext: vi.fn(),
  complexCostActorFromContext: vi.fn((context) => context.auth),
  readJsonBody: async (request: Request) => request.json().catch(() => ({})),
  requiredString: (body: Record<string, unknown>, key: string) =>
    typeof body[key] === "string" ? (body[key] as string) : "",
  arrayOfRecords: () => [],
  jsonError: (error: { message?: string; statusCode?: number }) =>
    Response.json(
      { error: error.message ?? "Unexpected error" },
      { status: error.statusCode ?? 500 },
    ),
}));

describe("settlement batch project cost items route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(assertBillingWriteAllowed).mockResolvedValue(undefined);
    vi.mocked(getComplexCostRouteContext).mockResolvedValue({
      supabase: {},
      auth: { userId: "user-1", role: "ops_manager", organizationId: "org-1" },
      repo: {},
      audit: vi.fn(),
    } as never);
    vi.mocked(attachProjectCostItemsToSettlementBatch).mockResolvedValue([
      {
        id: "cost-1",
        organizationId: "org-1",
        projectId: "project-1",
        itemType: "traffic",
        amountCents: 1000,
        direction: "cost",
        evidenceLevel: "yellow",
        source: "import",
        sourcePayload: {},
        reason: "Attach",
        status: "confirmed",
      },
    ]);
  });

  it("attaches confirmed project cost items to a settlement batch", async () => {
    const response = await POST(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({
          projectId: "project-1",
          costItemIds: ["cost-1"],
          reason: "Attach",
        }),
      }),
      { params: Promise.resolve({ batchId: "batch-1" }) },
    );

    await expect(response.json()).resolves.toMatchObject({
      items: [{ id: "cost-1" }],
    });
  });
});
