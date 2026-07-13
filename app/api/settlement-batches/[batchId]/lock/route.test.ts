import { beforeEach, describe, expect, it, vi } from "vitest";

import { assertBillingWriteAllowed } from "@/features/billing/route-guard";
import {
  getSettlementRouteContext,
  RouteError,
} from "@/features/settlements/settlement-route-utils";
import { createSettlementBatchRuleExceptionGate } from "@/features/settlements/custom-rule-exception-service";
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

vi.mock("@/features/settlements/custom-rule-exception-service", () => ({
  createSettlementBatchRuleExceptionGate: vi.fn(() => ({
    assertNoOpenRuleExceptions: vi.fn(),
  })),
}));

vi.mock("@/features/settlements/settlement-service", () => ({
  lockSettlementBatch: vi.fn(),
}));

const supabase = {};
const repo = {};

describe("settlement batch lock route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(assertBillingWriteAllowed).mockResolvedValue(undefined);
    vi.mocked(getSettlementRouteContext).mockResolvedValue({
      supabase,
      repo,
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
    const response = await POST(jsonRequest({ reason: "Checked" }), {
      params: Promise.resolve({ batchId: "batch-1" }),
    });

    expect(response.status).toBe(200);
    expect(assertBillingWriteAllowed).toHaveBeenCalledWith({
      client: supabase,
      organizationId: "org-1",
      featureKey: "settlement",
    });
    expect(createSettlementBatchRuleExceptionGate).toHaveBeenCalledWith({
      repo,
      organizationId: "org-1",
    });
    expect(lockSettlementBatch).toHaveBeenCalledWith(
      expect.objectContaining({
        gate: vi.mocked(createSettlementBatchRuleExceptionGate).mock.results[0]
          .value,
      }),
    );
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
