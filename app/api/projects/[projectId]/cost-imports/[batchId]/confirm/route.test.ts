import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

import { assertBillingWriteAllowed } from "@/features/billing/route-guard";
import { getComplexCostRouteContext } from "@/features/complex-cost/complex-cost-route-utils";
import { confirmProjectCostImportBatch } from "@/features/complex-cost/complex-cost-service";

vi.mock("@/features/billing/route-guard", () => ({
  assertBillingWriteAllowed: vi.fn(),
}));
vi.mock("@/features/complex-cost/complex-cost-service", () => ({
  confirmProjectCostImportBatch: vi.fn(),
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
}));

describe("project cost import confirm route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(assertBillingWriteAllowed).mockResolvedValue(undefined);
    vi.mocked(getComplexCostRouteContext).mockResolvedValue({
      supabase: {},
      auth: { userId: "user-1", role: "ops_manager", organizationId: "org-1" },
      repo: {},
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
  });
});
