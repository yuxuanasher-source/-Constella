import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  listOpsSettlementBatches,
  listOpsSettlementBatchDetails,
} from "@/features/settlements/settlement-queries";
import { getSettlementRouteContext } from "@/features/settlements/settlement-route-utils";

import { GET as listSettlementBatches } from "./route";
import { GET as getSettlementBatch } from "./[batchId]/route";

vi.mock("@/features/settlements/settlement-route-utils", async () => {
  const actual = await vi.importActual<
    typeof import("@/features/settlements/settlement-route-utils")
  >("@/features/settlements/settlement-route-utils");

  return {
    ...actual,
    getSettlementRouteContext: vi.fn(),
  };
});

vi.mock("@/features/settlements/settlement-queries", () => ({
  listOpsSettlementBatches: vi.fn(),
  listOpsSettlementBatchDetails: vi.fn(),
}));

const supabase = { client: "supabase" };

describe("settlement batch read routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSettlementRouteContext).mockResolvedValue({
      supabase,
      auth: {
        userId: "user-finance",
        name: "Finance",
        role: "finance",
        organizationId: "org-1",
      },
    } as never);
  });

  it("lists settlement batches within the authenticated organization", async () => {
    vi.mocked(listOpsSettlementBatches).mockResolvedValue([]);

    const response = await listSettlementBatches();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ batches: [] });
    expect(listOpsSettlementBatches).toHaveBeenCalledWith(supabase, "org-1");
  });

  it("loads settlement batch details within the authenticated organization", async () => {
    vi.mocked(listOpsSettlementBatches).mockResolvedValue([
      { id: "batch-1", status: "generated" },
    ] as never);
    vi.mocked(listOpsSettlementBatchDetails).mockResolvedValue({
      "batch-1": [{ id: "item-1", batchId: "batch-1" }],
    } as never);

    const response = await getSettlementBatch(new Request("http://localhost"), {
      params: Promise.resolve({ batchId: "batch-1" }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      batch: { id: "batch-1", status: "generated" },
      items: [{ id: "item-1", batchId: "batch-1" }],
    });
    expect(listOpsSettlementBatches).toHaveBeenCalledWith(supabase, "org-1");
    expect(listOpsSettlementBatchDetails).toHaveBeenCalledWith(supabase, {
      organizationId: "org-1",
      batchId: "batch-1",
    });
  });
});
