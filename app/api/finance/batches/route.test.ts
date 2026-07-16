import { beforeEach, describe, expect, it, vi } from "vitest";

import { assertBillingWriteAllowed } from "@/features/billing/route-guard";
import { SupabaseFinanceBatchRepository } from "@/features/finance-batches/finance-batch-repository";
import {
  addFinanceBatchAdjustment,
  createFinanceBatch,
  transitionFinanceBatch,
} from "@/features/finance-batches/finance-batch-service";
import { getSettlementRouteContext } from "@/features/settlements/settlement-route-utils";

import { GET as listFinanceBatches, POST as createFinanceBatchRoute } from "./route";
import { GET as getFinanceBatch } from "./[batchId]/route";
import { POST as addAdjustmentRoute } from "./[batchId]/adjustments/route";
import { POST as lockFinanceBatch } from "./[batchId]/lock/route";
import { POST as reopenFinanceBatch } from "./[batchId]/reopen/route";
import { POST as voidFinanceBatch } from "./[batchId]/void/route";

const mocks = vi.hoisted(() => ({
  repo: {
    listFinanceBatches: vi.fn(),
    getFinanceBatchDetail: vi.fn(),
    getFinanceBatch: vi.fn(),
    listStreamerPayableSources: vi.fn(),
    createFinanceBatchAtomic: vi.fn(),
    addAdjustment: vi.fn(),
    transitionBatch: vi.fn(),
  },
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

vi.mock("@/features/billing/route-guard", () => ({
  assertBillingWriteAllowed: vi.fn(async () => undefined),
}));

vi.mock("@/features/finance-batches/finance-batch-repository", () => ({
  SupabaseFinanceBatchRepository: vi.fn(function SupabaseFinanceBatchRepository() {
    return mocks.repo;
  }),
}));

vi.mock("@/features/finance-batches/finance-batch-service", async () => {
  const actual = await vi.importActual<
    typeof import("@/features/finance-batches/finance-batch-service")
  >("@/features/finance-batches/finance-batch-service");

  return {
    ...actual,
    createFinanceBatch: vi.fn(async () => ({
      batch: { id: "batch-created", status: "draft" },
      items: [],
    })),
    addFinanceBatchAdjustment: vi.fn(async () => ({
      batch: { id: "batch-1", adjustmentAmount: 10 },
      adjustment: { id: "adjustment-1", amount: 10 },
    })),
    transitionFinanceBatch: vi.fn(async ({ input }) => ({
      id: input.financeBatchId,
      status: `${input.action}-status`,
    })),
  };
});

const supabase = { client: "supabase" };
const auth = {
  userId: "user-finance",
  name: "Finance",
  role: "finance",
  organizationId: "org-1",
};
const batchId = "2ba8b258-b9f6-4ac2-bd3e-b55f686ac608";
const itemId = "9b332f5a-0126-4c4d-a85b-d6096d45a0f3";

describe("finance batch routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSettlementRouteContext).mockResolvedValue({
      supabase,
      auth,
      repo: { kind: "settlement-repo" },
      audit: vi.fn(),
      notify: vi.fn(),
    } as never);
    mocks.repo.listFinanceBatches.mockResolvedValue([
      { id: "batch-1", batchType: "streamer_payable" },
    ]);
    mocks.repo.getFinanceBatchDetail.mockResolvedValue({
      batch: { id: batchId, batchType: "streamer_payable" },
      items: [{ id: itemId, financeBatchId: batchId }],
    });
  });

  it("lists finance batches within the authenticated organization", async () => {
    const response = await listFinanceBatches();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      batches: [{ id: "batch-1", batchType: "streamer_payable" }],
    });
    expect(SupabaseFinanceBatchRepository).toHaveBeenCalledWith(supabase);
    expect(mocks.repo.listFinanceBatches).toHaveBeenCalledWith({
      organizationId: "org-1",
    });
  });

  it("creates a finance batch after billing allows settlement writes", async () => {
    const response = await createFinanceBatchRoute(
      jsonRequest("http://localhost/api/finance/batches", {
        batchType: "streamer_payable",
        periodStart: "2026-07-01",
        periodEnd: "2026-07-31",
        title: "July streamer payable",
        selection: { streamerIds: ["streamer-1"] },
      }),
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      batch: { id: "batch-created", status: "draft" },
      items: [],
    });
    expect(assertBillingWriteAllowed).toHaveBeenCalledWith({
      client: supabase,
      organizationId: "org-1",
      featureKey: "settlement",
    });
    expect(createFinanceBatch).toHaveBeenCalledWith({
      repo: mocks.repo,
      actor: auth,
      input: {
        batchType: "streamer_payable",
        periodStart: "2026-07-01",
        periodEnd: "2026-07-31",
        title: "July streamer payable",
        selection: { streamerIds: ["streamer-1"] },
      },
    });
  });

  it("does not create a finance batch when billing denies settlement writes", async () => {
    vi.mocked(assertBillingWriteAllowed).mockRejectedValueOnce(
      new Error("Organization is read-only because billing is past due"),
    );

    const response = await createFinanceBatchRoute(
      jsonRequest("http://localhost/api/finance/batches", {
        batchType: "streamer_payable",
        periodStart: "2026-07-01",
        periodEnd: "2026-07-31",
        selection: {},
      }),
    );

    expect(response.status).toBe(403);
    expect(createFinanceBatch).not.toHaveBeenCalled();
  });

  it("rejects unsupported finance batch types before billing", async () => {
    const response = await createFinanceBatchRoute(
      jsonRequest("http://localhost/api/finance/batches", {
        batchType: "legacy_payable",
        periodStart: "2026-07-01",
        periodEnd: "2026-07-31",
        selection: {},
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error:
        "batchType must be receivable, streamer_payable, project_cost, or collaboration_share",
    });
    expect(assertBillingWriteAllowed).not.toHaveBeenCalled();
  });

  it("loads finance batch detail within the authenticated organization", async () => {
    const response = await getFinanceBatch(new Request("http://localhost"), {
      params: Promise.resolve({ batchId }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      batch: { id: batchId, batchType: "streamer_payable" },
      items: [{ id: itemId, financeBatchId: batchId }],
    });
    expect(mocks.repo.getFinanceBatchDetail).toHaveBeenCalledWith({
      organizationId: "org-1",
      financeBatchId: batchId,
    });
  });

  it("rejects malformed finance batch detail ids before repository calls", async () => {
    const response = await getFinanceBatch(new Request("http://localhost"), {
      params: Promise.resolve({ batchId: "not-a-uuid" }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "batchId must be a valid UUID",
    });
    expect(SupabaseFinanceBatchRepository).not.toHaveBeenCalled();
    expect(mocks.repo.getFinanceBatchDetail).not.toHaveBeenCalled();
  });

  it("returns 404 when finance batch detail is missing", async () => {
    mocks.repo.getFinanceBatchDetail.mockResolvedValueOnce(null);

    const response = await getFinanceBatch(new Request("http://localhost"), {
      params: Promise.resolve({ batchId }),
    });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "Finance batch not found",
    });
  });

  it("adds an adjustment after billing allows settlement writes", async () => {
    const response = await addAdjustmentRoute(
      jsonRequest(`http://localhost/api/finance/batches/${batchId}/adjustments`, {
        direction: "increase",
        amount: 10,
        reason: "Late bonus",
        financeBatchItemId: itemId,
        evidenceSnapshot: { note: "approved" },
      }),
      { params: Promise.resolve({ batchId }) },
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      batch: { id: "batch-1", adjustmentAmount: 10 },
      adjustment: { id: "adjustment-1", amount: 10 },
    });
    expect(addFinanceBatchAdjustment).toHaveBeenCalledWith({
      repo: mocks.repo,
      actor: auth,
      input: {
        financeBatchId: batchId,
        financeBatchItemId: itemId,
        direction: "increase",
        amount: 10,
        reason: "Late bonus",
        evidenceSnapshot: { note: "approved" },
      },
    });
  });

  it("rejects malformed adjustment batch ids before billing", async () => {
    const response = await addAdjustmentRoute(
      jsonRequest("http://localhost/api/finance/batches/not-a-uuid/adjustments", {
        direction: "increase",
        amount: 10,
        reason: "Late bonus",
      }),
      { params: Promise.resolve({ batchId: "not-a-uuid" }) },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "batchId must be a valid UUID",
    });
    expect(assertBillingWriteAllowed).not.toHaveBeenCalled();
    expect(addFinanceBatchAdjustment).not.toHaveBeenCalled();
  });

  it("rejects malformed adjustment item ids before billing", async () => {
    const response = await addAdjustmentRoute(
      jsonRequest(`http://localhost/api/finance/batches/${batchId}/adjustments`, {
        direction: "increase",
        amount: 10,
        reason: "Late bonus",
        financeBatchItemId: "not-a-uuid",
      }),
      { params: Promise.resolve({ batchId }) },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "financeBatchItemId must be a valid UUID",
    });
    expect(assertBillingWriteAllowed).not.toHaveBeenCalled();
    expect(addFinanceBatchAdjustment).not.toHaveBeenCalled();
  });

  it("locks a finance batch with an optional reason", async () => {
    const response = await lockFinanceBatch(
      jsonRequest(`http://localhost/api/finance/batches/${batchId}/lock`, {
        reason: "Reviewed",
      }),
      { params: Promise.resolve({ batchId }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      batch: { id: batchId, status: "lock-status" },
    });
    expect(transitionFinanceBatch).toHaveBeenCalledWith({
      repo: mocks.repo,
      actor: auth,
      input: {
        financeBatchId: batchId,
        action: "lock",
        reason: "Reviewed",
      },
    });
  });

  it("rejects malformed lock batch ids before billing", async () => {
    const response = await lockFinanceBatch(
      jsonRequest("http://localhost/api/finance/batches/not-a-uuid/lock", {
        reason: "Reviewed",
      }),
      { params: Promise.resolve({ batchId: "not-a-uuid" }) },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "batchId must be a valid UUID",
    });
    expect(assertBillingWriteAllowed).not.toHaveBeenCalled();
    expect(transitionFinanceBatch).not.toHaveBeenCalled();
  });

  it("requires a reason before billing when reopening a finance batch", async () => {
    const response = await reopenFinanceBatch(
      jsonRequest(`http://localhost/api/finance/batches/${batchId}/reopen`, {}),
      { params: Promise.resolve({ batchId }) },
    );

    expect(response.status).toBe(400);
    expect(assertBillingWriteAllowed).not.toHaveBeenCalled();
    expect(transitionFinanceBatch).not.toHaveBeenCalled();
  });

  it("rejects malformed reopen batch ids before billing", async () => {
    const response = await reopenFinanceBatch(
      jsonRequest("http://localhost/api/finance/batches/not-a-uuid/reopen", {
        reason: "Need edits",
      }),
      { params: Promise.resolve({ batchId: "not-a-uuid" }) },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "batchId must be a valid UUID",
    });
    expect(assertBillingWriteAllowed).not.toHaveBeenCalled();
    expect(transitionFinanceBatch).not.toHaveBeenCalled();
  });

  it("requires a reason before billing when voiding a finance batch", async () => {
    const response = await voidFinanceBatch(
      jsonRequest(`http://localhost/api/finance/batches/${batchId}/void`, {
        reason: "   ",
      }),
      { params: Promise.resolve({ batchId }) },
    );

    expect(response.status).toBe(400);
    expect(assertBillingWriteAllowed).not.toHaveBeenCalled();
    expect(transitionFinanceBatch).not.toHaveBeenCalled();
  });

  it("rejects malformed void batch ids before billing", async () => {
    const response = await voidFinanceBatch(
      jsonRequest("http://localhost/api/finance/batches/not-a-uuid/void", {
        reason: "Duplicate batch",
      }),
      { params: Promise.resolve({ batchId: "not-a-uuid" }) },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "batchId must be a valid UUID",
    });
    expect(assertBillingWriteAllowed).not.toHaveBeenCalled();
    expect(transitionFinanceBatch).not.toHaveBeenCalled();
  });
});

function jsonRequest(url: string, body: Record<string, unknown>): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
