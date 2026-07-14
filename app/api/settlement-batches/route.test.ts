import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  listOpsSettlementBatches,
  listOpsSettlementBatchDetails,
} from "@/features/settlements/settlement-queries";
import { getSettlementRouteContext } from "@/features/settlements/settlement-route-utils";
import { assertBillingWriteAllowed } from "@/features/billing/route-guard";
import { createProductionCustomSettlementExecutionPort } from "@/features/settlements/custom-rule-service";
import { generateSettlementBatch } from "@/features/settlements/settlement-service";

import { GET as listSettlementBatches, POST as createSettlementBatch } from "./route";
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

vi.mock("@/features/billing/route-guard", () => ({
  assertBillingWriteAllowed: vi.fn(async () => undefined),
}));

vi.mock("@/features/settlements/custom-rule-service", () => ({
  createProductionCustomSettlementExecutionPort: vi.fn(() => ({
    resolveAndExecute: vi.fn(async () => "no_custom_layers"),
  })),
}));

vi.mock("@/features/settlements/settlement-service", async () => {
  const actual = await vi.importActual<
    typeof import("@/features/settlements/settlement-service")
  >("@/features/settlements/settlement-service");

  return {
    ...actual,
    generateSettlementBatch: vi.fn(async () => ({
      batch: { id: "batch-1", status: "generated" },
      items: [],
    })),
  };
});

const supabase = { client: "supabase" };
const repo = { kind: "settlement-repo" };

describe("settlement batch read routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSettlementRouteContext).mockResolvedValue({
      supabase,
      repo,
      audit: vi.fn(),
      notify: vi.fn(),
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

  it("creates a production custom-rule execution port from authenticated Supabase when generating", async () => {
    const response = await createSettlementBatch(
      jsonRequest({
        projectId: "2ba8b258-b9f6-4ac2-bd3e-b55f686ac608",
        batchType: "payable",
        periodStart: "2026-07-01",
        periodEnd: "2026-07-31",
      }),
    );

    expect(response.status).toBe(201);
    expect(assertBillingWriteAllowed).toHaveBeenCalledWith({
      client: supabase,
      organizationId: "org-1",
      featureKey: "settlement",
    });
    expect(createProductionCustomSettlementExecutionPort).toHaveBeenCalledWith(
      expect.objectContaining({ supabase }),
    );
    expect(generateSettlementBatch).toHaveBeenCalledWith(
      expect.objectContaining({
        repo,
        customExecutionPort:
          vi.mocked(createProductionCustomSettlementExecutionPort).mock
            .results[0].value,
      }),
    );
  });

  it("keeps the billing guard before custom execution port creation", async () => {
    vi.mocked(assertBillingWriteAllowed).mockRejectedValueOnce(
      new Error("Organization is read-only because billing is past due"),
    );

    const response = await createSettlementBatch(
      jsonRequest({
        projectId: "2ba8b258-b9f6-4ac2-bd3e-b55f686ac608",
        batchType: "payable",
        periodStart: "2026-07-01",
        periodEnd: "2026-07-31",
      }),
    );

    expect(response.status).toBe(403);
    expect(createProductionCustomSettlementExecutionPort).not.toHaveBeenCalled();
    expect(generateSettlementBatch).not.toHaveBeenCalled();
  });
});

function jsonRequest(body: Record<string, unknown>): Request {
  return new Request("http://localhost/api/settlement-batches", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
