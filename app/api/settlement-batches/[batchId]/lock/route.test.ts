import { beforeEach, describe, expect, it, vi } from "vitest";

import { assertBillingWriteAllowed } from "@/features/billing/route-guard";
import {
  getSettlementRouteContext,
  RouteError,
} from "@/features/settlements/settlement-route-utils";
import { lockSettlementBatch } from "@/features/settlements/settlement-service";

import { POST } from "./route";

vi.mock("@/features/billing/route-guard", () => ({
  assertBillingWriteAllowed: vi.fn(),
}));

vi.mock("@/features/settlements/settlement-route-utils", async () => {
  const actual = await vi.importActual<
    typeof import("@/features/settlements/settlement-route-utils")
  >("@/features/settlements/settlement-route-utils");
  return { ...actual, getSettlementRouteContext: vi.fn() };
});

vi.mock("@/features/settlements/settlement-service", () => ({
  lockSettlementBatch: vi.fn(),
}));

const supabase = {};
const repo = {};
const gate = {
  assertNoOpenRuleExceptions: vi.fn(),
  evaluateReconciliation: vi.fn(),
};

describe("settlement batch lock route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(assertBillingWriteAllowed).mockResolvedValue(undefined);
    vi.mocked(getSettlementRouteContext).mockResolvedValue({
      supabase,
      repo,
      gate,
      audit: vi.fn(),
      notify: vi.fn(),
      auth: {
        userId: "user-owner",
        name: "Owner",
        role: "owner",
        organizationId: "org-1",
      },
    } as never);
    vi.mocked(lockSettlementBatch).mockResolvedValue({
      id: "batch-1",
      status: "locked",
    } as never);
  });

  it("runs billing guard and passes the unresolved-exception gate", async () => {
    vi.mocked(lockSettlementBatch).mockResolvedValueOnce({
      id: "batch-1",
      status: "locked",
      reconciliation: {
        reconciliationRunId: "run-1",
        blockedCheckCodes: [],
        warningCheckCodes: ["custom_rule:rule-1:0"],
        trigger: "lock",
      },
    } as never);

    const response = await POST(jsonRequest({ reason: "Checked" }), {
      params: Promise.resolve({ batchId: "batch-1" }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      batch: expect.objectContaining({ id: "batch-1", status: "locked" }),
      reconciliation: {
        reconciliationRunId: "run-1",
        blockedCheckCodes: [],
        warningCheckCodes: ["custom_rule:rule-1:0"],
        trigger: "lock",
      },
    });
    expect(assertBillingWriteAllowed).toHaveBeenCalledWith({
      client: supabase,
      organizationId: "org-1",
      featureKey: "settlement",
    });
    expect(lockSettlementBatch).toHaveBeenCalledWith(
      expect.objectContaining({
        gate,
      }),
    );
  });

  it("does not enter reconciliation when billing is read-only", async () => {
    vi.mocked(assertBillingWriteAllowed).mockRejectedValueOnce(
      new Error("Organization is read-only because billing is cancelled"),
    );

    const response = await POST(jsonRequest({ reason: "Checked" }), {
      params: Promise.resolve({ batchId: "batch-1" }),
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "Organization is read-only because billing is cancelled",
    });
    expect(lockSettlementBatch).not.toHaveBeenCalled();
    expect(gate.evaluateReconciliation).not.toHaveBeenCalled();
  });

  it("returns a safe 409 when unresolved rule exceptions block locking", async () => {
    vi.mocked(lockSettlementBatch).mockRejectedValueOnce(
      new Error("Settlement batch has unresolved rule exceptions"),
    );

    const response = await POST(jsonRequest({ reason: "Checked" }), {
      params: Promise.resolve({ batchId: "batch-1" }),
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "Settlement batch has unresolved rule exceptions",
    });
  });

  it("validates the request body before billing", async () => {
    const response = await POST(jsonRequest({}), {
      params: Promise.resolve({ batchId: "batch-1" }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "reason is required",
    });
    expect(assertBillingWriteAllowed).not.toHaveBeenCalled();
    expect(lockSettlementBatch).not.toHaveBeenCalled();
  });

  it("returns 401 when the locker is unauthenticated", async () => {
    vi.mocked(getSettlementRouteContext).mockRejectedValueOnce(
      new RouteError("Unauthorized", 401),
    );

    const response = await POST(jsonRequest({ reason: "Checked" }), {
      params: Promise.resolve({ batchId: "batch-1" }),
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
    expect(assertBillingWriteAllowed).not.toHaveBeenCalled();
    expect(lockSettlementBatch).not.toHaveBeenCalled();
  });
});

function jsonRequest(body: Record<string, unknown>): Request {
  return new Request("http://localhost", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
