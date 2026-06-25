import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

import { assertBillingWriteAllowed } from "@/features/billing/route-guard";
import { createGovernedExport } from "@/features/exports/export-service";
import { getComplexCostRouteContext } from "@/features/complex-cost/complex-cost-route-utils";

vi.mock("@/features/billing/route-guard", () => ({
  assertBillingWriteAllowed: vi.fn(),
}));
vi.mock("@/features/exports/export-service", () => ({
  createGovernedExport: vi.fn(),
}));
vi.mock("@/features/complex-cost/complex-cost-route-utils", () => ({
  getComplexCostRouteContext: vi.fn(),
  readJsonBody: async (request: Request) => request.json().catch(() => ({})),
  requiredString: (body: Record<string, unknown>, key: string) =>
    typeof body[key] === "string" ? (body[key] as string) : "",
  arrayOfRecords: (body: Record<string, unknown>, key: string) =>
    Array.isArray(body[key])
      ? (body[key] as Array<Record<string, unknown>>)
      : [],
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

describe("project cost export route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(assertBillingWriteAllowed).mockResolvedValue(undefined);
    vi.mocked(getComplexCostRouteContext).mockResolvedValue({
      supabase: {},
      auth: { userId: "user-1", role: "finance", organizationId: "org-1" },
    } as never);
    vi.mocked(createGovernedExport).mockResolvedValue({
      kind: "project_costs" as never,
      filename: "project_costs.csv",
      content: "",
      fieldCount: 0,
      rowCount: 0,
    });
  });

  it("creates a project cost export", async () => {
    const response = await POST(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ kind: "project_costs", rows: [] }),
      }),
      { params: Promise.resolve({ projectId: "project-1" }) },
    );

    await expect(response.json()).resolves.toMatchObject({
      export: { filename: "project_costs.csv" },
    });
  });
});
