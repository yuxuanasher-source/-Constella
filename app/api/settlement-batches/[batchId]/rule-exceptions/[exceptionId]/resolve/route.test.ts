import { beforeEach, describe, expect, it, vi } from "vitest";

import { assertBillingWriteAllowed } from "@/features/billing/route-guard";
import {
  getSettlementRouteContext,
  RouteError,
} from "@/features/settlements/settlement-route-utils";
import { resolveSettlementRuleException } from "@/features/settlements/custom-rule-exception-service";

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
  resolveSettlementRuleException: vi.fn(),
}));

const supabase = {};
const repo = {};

describe("settlement batch rule exception resolve route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(assertBillingWriteAllowed).mockResolvedValue(undefined);
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
    vi.mocked(resolveSettlementRuleException).mockResolvedValue({
      batch: { id: "batch-1", computedAmount: 25 },
      item: { id: "item-1", computedAmount: 25 },
      exception: { id: "exception-1", status: "resolved" },
      amountDelta: 15,
      idempotent: false,
    } as never);
  });

  it("guards billing before resolving and maps the typed resolution body", async () => {
    const response = await POST(
      jsonRequest({
        resolutionValue: { type: "money_cents", amountCents: 2500 },
        reason: "Matched finance source sheet",
      }),
      {
        params: Promise.resolve({
          batchId: "batch-1",
          exceptionId: "exception-1",
        }),
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      batch: { id: "batch-1", computedAmount: 25 },
      item: { id: "item-1", computedAmount: 25 },
      exception: { id: "exception-1", status: "resolved" },
      amountDelta: 15,
      idempotent: false,
    });
    expect(assertBillingWriteAllowed).toHaveBeenCalledWith({
      client: supabase,
      organizationId: "org-1",
      featureKey: "settlement",
    });
    expect(resolveSettlementRuleException).toHaveBeenCalledWith(
      expect.objectContaining({
        repo,
        batchId: "batch-1",
        exceptionId: "exception-1",
        actor: expect.objectContaining({ role: "finance" }),
        input: {
          resolutionValue: { type: "money_cents", amountCents: 2500 },
          reason: "Matched finance source sheet",
        },
      }),
    );
  });

  it("blocks resolution while billing is read-only", async () => {
    vi.mocked(assertBillingWriteAllowed).mockRejectedValueOnce(
      new Error("Organization is read-only because billing is past due"),
    );

    const response = await POST(
      jsonRequest({
        resolutionValue: { type: "money_cents", amountCents: 2500 },
        reason: "Matched finance source sheet",
      }),
      {
        params: Promise.resolve({
          batchId: "batch-1",
          exceptionId: "exception-1",
        }),
      },
    );

    expect(response.status).toBe(403);
    expect(resolveSettlementRuleException).not.toHaveBeenCalled();
  });

  it("requires a reason", async () => {
    const response = await POST(
      jsonRequest({
        resolutionValue: { type: "money_cents", amountCents: 2500 },
      }),
      {
        params: Promise.resolve({
          batchId: "batch-1",
          exceptionId: "exception-1",
        }),
      },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "reason is required",
    });
    expect(assertBillingWriteAllowed).not.toHaveBeenCalled();
    expect(resolveSettlementRuleException).not.toHaveBeenCalled();
  });

  it("returns 401 when the resolver is unauthenticated", async () => {
    vi.mocked(getSettlementRouteContext).mockRejectedValueOnce(
      new RouteError("Unauthorized", 401),
    );

    const response = await POST(
      jsonRequest({
        resolutionValue: { type: "money_cents", amountCents: 2500 },
        reason: "Checked",
      }),
      {
        params: Promise.resolve({
          batchId: "batch-1",
          exceptionId: "exception-1",
        }),
      },
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
    expect(assertBillingWriteAllowed).not.toHaveBeenCalled();
    expect(resolveSettlementRuleException).not.toHaveBeenCalled();
  });

  it("returns safe 409 responses for stale batch state and duplicate conflicts", async () => {
    vi.mocked(resolveSettlementRuleException).mockRejectedValueOnce(
      new Error("Settlement batch is no longer open for rule exception resolution"),
    );

    const stale = await POST(
      jsonRequest({
        resolutionValue: { type: "money_cents", amountCents: 2500 },
        reason: "Checked",
      }),
      {
        params: Promise.resolve({
          batchId: "batch-1",
          exceptionId: "exception-1",
        }),
      },
    );

    expect(stale.status).toBe(409);
    await expect(stale.json()).resolves.toEqual({
      error: "Settlement batch is no longer open for rule exception resolution",
    });

    vi.mocked(resolveSettlementRuleException).mockRejectedValueOnce(
      new Error(
        "Settlement rule exception was already resolved with a different value",
      ),
    );

    const conflict = await POST(
      jsonRequest({
        resolutionValue: { type: "money_cents", amountCents: 2600 },
        reason: "Checked",
      }),
      {
        params: Promise.resolve({
          batchId: "batch-1",
          exceptionId: "exception-1",
        }),
      },
    );

    expect(conflict.status).toBe(409);
  });

  it("returns safe auth errors for cross-org and streamer denials", async () => {
    vi.mocked(resolveSettlementRuleException).mockRejectedValueOnce(
      new Error("Settlement rule exception not found"),
    );

    const crossOrg = await POST(
      jsonRequest({
        resolutionValue: { type: "money_cents", amountCents: 2500 },
        reason: "Checked",
      }),
      {
        params: Promise.resolve({
          batchId: "batch-1",
          exceptionId: "exception-cross-org",
        }),
      },
    );

    expect(crossOrg.status).toBe(404);

    vi.mocked(resolveSettlementRuleException).mockRejectedValueOnce(
      new Error(
        "Current role cannot resolve money-changing settlement rule exceptions",
      ),
    );

    const denied = await POST(
      jsonRequest({
        resolutionValue: { type: "money_cents", amountCents: 2500 },
        reason: "Checked",
      }),
      {
        params: Promise.resolve({
          batchId: "batch-1",
          exceptionId: "exception-1",
        }),
      },
    );

    expect(denied.status).toBe(403);
  });
});

function jsonRequest(body: Record<string, unknown>): Request {
  return new Request("http://localhost", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
