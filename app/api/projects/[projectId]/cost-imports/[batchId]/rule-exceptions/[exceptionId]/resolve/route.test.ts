import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

import { assertBillingWriteAllowed } from "@/features/billing/route-guard";
import { getComplexCostRouteContext } from "@/features/complex-cost/complex-cost-route-utils";
import { resolveExternalCostRuleExceptionWithReplay } from "@/features/complex-cost/complex-cost-service";

vi.mock("@/features/billing/route-guard", () => ({
  assertBillingWriteAllowed: vi.fn(),
}));
vi.mock("@/features/complex-cost/complex-cost-service", () => ({
  resolveExternalCostRuleExceptionWithReplay: vi.fn(),
}));
vi.mock("@/features/complex-cost/complex-cost-route-utils", () => ({
  getComplexCostRouteContext: vi.fn(),
  complexCostActorFromContext: vi.fn((context) => context.auth),
  readJsonBody: async (request: Request) => request.json().catch(() => ({})),
  requiredString: (body: Record<string, unknown>, key: string) => {
    const value = body[key];
    if (typeof value !== "string" || !value.trim()) {
      const error = new Error(`${key} is required`) as Error & {
        statusCode: number;
      };
      error.statusCode = 400;
      throw error;
    }
    return value.trim();
  },
  jsonError: (error: { message?: string; statusCode?: number }) =>
    Response.json(
      { error: error.message ?? "Unexpected error" },
      {
        status:
          error.statusCode ??
          (error.message?.startsWith("Organization is read-only because billing")
            ? 403
            : 500),
      },
    ),
  RouteError: class RouteError extends Error {
    constructor(
      message: string,
      public readonly statusCode: number,
    ) {
      super(message);
    }
  },
}));

const ORG_ID = "org-1";
const PROJECT_ID = "project-1";

describe("external-cost rule exception resolve route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(assertBillingWriteAllowed).mockResolvedValue(undefined);
    vi.mocked(getComplexCostRouteContext).mockResolvedValue(context() as never);
    vi.mocked(resolveExternalCostRuleExceptionWithReplay).mockResolvedValue({
      exception: {
        id: "exception-1",
        organizationId: ORG_ID,
        projectId: PROJECT_ID,
        importBatchId: "batch-1",
        importRowIndex: 0,
        ruleVersionId: "rule-original",
        variableName: "sales_amount",
        policy: "route_item_to_review",
        sourceContextSnapshot: { __source_context_hash: "original-hash" },
        status: "resolved",
        resolutionValue: { type: "money_cents", amountCents: 123_00 },
        resolutionReason: "补充复核金额",
      },
      items: [
        {
          id: "item-1",
          organizationId: ORG_ID,
          projectId: PROJECT_ID,
          itemType: "traffic",
          amountCents: 123_00,
          direction: "cost",
          evidenceLevel: "yellow",
          source: "system",
          sourcePayload: {},
          sourceRuleVersionId: "rule-original",
          sourceImportBatchId: "batch-1",
          sourceExecutionKey: "locked-execution-key",
          sourceInputHash: "original-hash",
          sourceExplanation:
            "Custom external-cost rule emitted traffic for 12300 cents",
          reason: "replay",
          status: "pending_review",
        },
      ],
      replayed: true,
      replayDeferred: false,
      openSiblingCount: 0,
      needsReplay: true,
      replay: {
        idempotencyStatus: "existing",
        items: [
          {
            id: "item-1",
            sourceRuleVersionId: "rule-original",
            sourceExecutionKey: "locked-execution-key",
          },
        ],
      },
    } as never);
  });

  it.each(["owner", "ops_manager", "finance"])(
    "allows %s to resolve a typed reviewed value and preserves original-version replay provenance",
    async (role) => {
      vi.mocked(getComplexCostRouteContext).mockResolvedValueOnce(
        context(role) as never,
      );

      const response = await POST(resolveRequest(), {
        params: Promise.resolve({
          projectId: PROJECT_ID,
          batchId: "batch-1",
          exceptionId: "exception-1",
        }),
      });
      const body = await response.json();

      expect(response.status, JSON.stringify(body)).toBe(200);
      expect(assertBillingWriteAllowed).toHaveBeenNthCalledWith(1, {
        client: {},
        organizationId: ORG_ID,
        featureKey: "settlement",
      });
      expect(assertBillingWriteAllowed).toHaveBeenNthCalledWith(2, {
        client: {},
        organizationId: ORG_ID,
        featureKey: "complex_cost_rules",
      });
      expect(resolveExternalCostRuleExceptionWithReplay).toHaveBeenCalledWith(
        expect.objectContaining({
          actor: expect.objectContaining({ role }),
          exceptionId: "exception-1",
          resolutionValue: { type: "money_cents", amountCents: 123_00 },
          resolutionReason: "补充复核金额",
        }),
      );
      expect(body).toMatchObject({
        exception: {
          id: "exception-1",
          status: "resolved",
          reviewedValue: { type: "money_cents", amountCents: 123_00 },
        },
        replay: {
          replayed: true,
          idempotencyStatus: "existing",
          openSiblingCount: 0,
        },
        items: [
          {
            id: "item-1",
            ruleVersionId: "rule-original",
            sourceExecutionKey: "locked-execution-key",
            status: "pending_review",
          },
        ],
      });
    },
  );

  it("defers replay while sibling exceptions remain unresolved", async () => {
    vi.mocked(resolveExternalCostRuleExceptionWithReplay).mockResolvedValueOnce({
      exception: {
        id: "exception-1",
        organizationId: ORG_ID,
        projectId: PROJECT_ID,
        importBatchId: "batch-1",
        importRowIndex: 0,
        variableName: "sales_amount",
        policy: "route_item_to_review",
        sourceContextSnapshot: {},
        status: "resolved",
      },
      items: [],
      replayed: false,
      replayDeferred: true,
      openSiblingCount: 1,
      needsReplay: false,
      replay: null,
    } as never);

    const response = await POST(resolveRequest(), {
      params: Promise.resolve({
        projectId: PROJECT_ID,
        batchId: "batch-1",
        exceptionId: "exception-1",
      }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      replay: { replayed: false, replayDeferred: true, openSiblingCount: 1 },
      items: [],
    });
  });

  it("rejects operator, streamer, billing read-only mode, missing reasons, and untyped reviewed values before mutation", async () => {
    vi.mocked(getComplexCostRouteContext).mockResolvedValueOnce(
      context("operator_business") as never,
    );
    let response = await POST(resolveRequest(), {
      params: Promise.resolve({
        projectId: PROJECT_ID,
        batchId: "batch-1",
        exceptionId: "exception-1",
      }),
    });
    expect(response.status).toBe(403);

    vi.mocked(getComplexCostRouteContext).mockRejectedValueOnce(
      new ErrorWithStatus("Only MCN staff can manage complex cost rules", 403),
    );
    response = await POST(resolveRequest(), {
      params: Promise.resolve({
        projectId: PROJECT_ID,
        batchId: "batch-1",
        exceptionId: "exception-1",
      }),
    });
    expect(response.status).toBe(403);

    vi.mocked(assertBillingWriteAllowed).mockRejectedValueOnce(
      new Error("Organization is read-only because billing is past due"),
    );
    response = await POST(resolveRequest(), {
      params: Promise.resolve({
        projectId: PROJECT_ID,
        batchId: "batch-1",
        exceptionId: "exception-1",
      }),
    });
    expect(response.status).toBe(403);

    response = await POST(
      resolveRequest({ resolutionReason: "", resolutionValue: typedMoney() }),
      {
        params: Promise.resolve({
          projectId: PROJECT_ID,
          batchId: "batch-1",
          exceptionId: "exception-1",
        }),
      },
    );
    expect(response.status).toBe(400);

    response = await POST(
      resolveRequest({ resolutionReason: "补充复核金额", resolutionValue: 123 }),
      {
        params: Promise.resolve({
          projectId: PROJECT_ID,
          batchId: "batch-1",
          exceptionId: "exception-1",
        }),
      },
    );
    expect(response.status).toBe(400);
  });
});

function resolveRequest(
  body: Record<string, unknown> = {
    resolutionReason: "补充复核金额",
    resolutionValue: typedMoney(),
  },
) {
  return new Request("http://localhost", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

function typedMoney() {
  return { type: "money_cents", amountCents: 123_00 };
}

function context(role = "ops_manager") {
  return {
    supabase: {},
    auth: { userId: "user-1", role, organizationId: ORG_ID },
    repo: {
      getExternalCostRuleExceptionById: vi.fn().mockResolvedValue({
        id: "exception-1",
        organizationId: ORG_ID,
        projectId: PROJECT_ID,
        importBatchId: "batch-1",
      }),
    },
    audit: vi.fn(),
  };
}

class ErrorWithStatus extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
  }
}
