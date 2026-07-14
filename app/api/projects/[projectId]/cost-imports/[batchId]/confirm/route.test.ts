import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

import { assertBillingWriteAllowed } from "@/features/billing/route-guard";
import { getComplexCostRouteContext } from "@/features/complex-cost/complex-cost-route-utils";
import { confirmProjectCostImportBatch } from "@/features/complex-cost/complex-cost-service";
import { SupabaseCustomRuleReadRepository } from "@/features/settlements/custom-rule-repository";

vi.mock("@/features/billing/route-guard", () => ({
  assertBillingWriteAllowed: vi.fn(),
}));
vi.mock("@/features/complex-cost/complex-cost-service", () => ({
  confirmProjectCostImportBatch: vi.fn(),
}));
vi.mock("@/features/settlements/custom-rule-repository", () => ({
  SupabaseCustomRuleReadRepository: vi.fn(function SupabaseCustomRuleReadRepository(
    this: { marker: string },
  ) {
    this.marker = "custom-rule-repo";
  }),
}));
vi.mock("@/features/complex-cost/complex-cost-route-utils", () => ({
  getComplexCostRouteContext: vi.fn(),
  complexCostActorFromContext: vi.fn((context) => context.auth),
  readJsonBody: async (request: Request) => request.json().catch(() => ({})),
  requiredString: (body: Record<string, unknown>, key: string) =>
    typeof body[key] === "string" ? (body[key] as string) : "",
  jsonError: (error: { message?: string; statusCode?: number }) =>
    Response.json(
      { error: error.message ?? "Unexpected error" },
      { status: error.statusCode ?? 500 },
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

describe("project cost import confirm route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(assertBillingWriteAllowed).mockResolvedValue(undefined);
    vi.mocked(getComplexCostRouteContext).mockResolvedValue({
      supabase: {},
      auth: { userId: "user-1", role: "ops_manager", organizationId: "org-1" },
      repo: {
        getImportBatchById: vi.fn().mockResolvedValue({
          id: "batch-1",
          organizationId: "org-1",
          projectId: "project-1",
          importType: "cps",
          rowCount: 1,
          parsedPayload: [],
          status: "parsed",
        }),
      },
      audit: vi.fn(),
    } as never);
    vi.mocked(confirmProjectCostImportBatch).mockResolvedValue({
      importBatch: {
        id: "batch-1",
        organizationId: "org-1",
        projectId: "project-1",
        importType: "cps",
        rowCount: 1,
        parsedPayload: [],
        status: "confirmed",
      },
      items: [],
    });
  });

  it("confirms import rows into project cost items", async () => {
    const response = await POST(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ reason: "Finance confirmed." }),
      }),
      {
        params: Promise.resolve({
          projectId: "project-1",
          batchId: "batch-1",
        }),
      },
    );

    await expect(response.json()).resolves.toMatchObject({
      importBatch: { id: "batch-1", status: "confirmed" },
    });
    expect(assertBillingWriteAllowed).toHaveBeenNthCalledWith(1, {
      client: {},
      organizationId: "org-1",
      featureKey: "settlement",
    });
    expect(assertBillingWriteAllowed).toHaveBeenNthCalledWith(2, {
      client: {},
      organizationId: "org-1",
      featureKey: "complex_cost_rules",
    });
    expect(SupabaseCustomRuleReadRepository).toHaveBeenCalledWith({});
    expect(confirmProjectCostImportBatch).toHaveBeenCalledWith(
      expect.objectContaining({
        repo: expect.objectContaining({
          getImportBatchById: expect.any(Function),
        }),
        customRuleRepo: expect.objectContaining({ marker: "custom-rule-repo" }),
        batchId: "batch-1",
        reason: "Finance confirmed.",
      }),
    );
  });

  it("rejects a project URL mismatch before confirming the import batch", async () => {
    const repo = {
      getImportBatchById: vi.fn().mockResolvedValue({
        id: "batch-1",
        organizationId: "org-1",
        projectId: "other-project",
        importType: "cps",
        rowCount: 1,
        parsedPayload: [],
        status: "parsed",
      }),
    };
    vi.mocked(getComplexCostRouteContext).mockResolvedValueOnce({
      supabase: {},
      auth: { userId: "user-1", role: "ops_manager", organizationId: "org-1" },
      repo,
      audit: vi.fn(),
    } as never);

    const response = await POST(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ reason: "Finance confirmed." }),
      }),
      {
        params: Promise.resolve({
          projectId: "project-1",
          batchId: "batch-1",
        }),
      },
    );

    expect(response.status).toBe(404);
    expect(confirmProjectCostImportBatch).not.toHaveBeenCalled();
  });
});
