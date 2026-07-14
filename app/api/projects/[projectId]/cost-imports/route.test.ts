import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET, POST } from "./route";

import { assertBillingWriteAllowed } from "@/features/billing/route-guard";
import { getComplexCostRouteContext } from "@/features/complex-cost/complex-cost-route-utils";
import { createProjectCostImportBatch } from "@/features/complex-cost/complex-cost-service";

vi.mock("@/features/billing/route-guard", () => ({
  assertBillingWriteAllowed: vi.fn(),
}));
vi.mock("@/features/complex-cost/complex-cost-service", () => ({
  createProjectCostImportBatch: vi.fn(),
}));
vi.mock("@/features/complex-cost/complex-cost-route-utils", () => ({
  getComplexCostRouteContext: vi.fn(),
  complexCostActorFromContext: vi.fn((context) => context.auth),
  readJsonBody: async (request: Request) => request.json().catch(() => ({})),
  requiredString: (body: Record<string, unknown>, key: string) =>
    typeof body[key] === "string" ? (body[key] as string) : "",
  optionalString: () => undefined,
  arrayOfRecords: (body: Record<string, unknown>, key: string) =>
    Array.isArray(body[key])
      ? (body[key] as Array<Record<string, unknown>>)
      : [],
  jsonError: (error: { message?: string; statusCode?: number }) =>
    Response.json(
      { error: error.message ?? "Unexpected error" },
      { status: error.statusCode ?? 500 },
    ),
}));

describe("project cost imports route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(assertBillingWriteAllowed).mockResolvedValue(undefined);
    vi.mocked(getComplexCostRouteContext).mockResolvedValue({
      supabase: {},
      auth: { userId: "user-1", role: "ops_manager", organizationId: "org-1" },
      repo: {
        listImportBatches: vi.fn().mockResolvedValue([
          {
            id: "batch-exception-only",
            organizationId: "org-1",
            projectId: "project-1",
            importType: "traffic",
            rowCount: 1,
            parsedPayload: [],
            status: "parsed",
          },
        ]),
      },
      audit: vi.fn(),
    } as never);
    vi.mocked(createProjectCostImportBatch).mockResolvedValue({
      id: "batch-1",
      organizationId: "org-1",
      projectId: "project-1",
      importType: "cps",
      rowCount: 1,
      parsedPayload: [],
      status: "parsed",
    });
  });

  it("creates a parsed cost import batch", async () => {
    const response = await POST(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({
          importType: "cps",
          parsedPayload: [{ salesAmountCents: 200000 }],
        }),
      }),
      { params: Promise.resolve({ projectId: "project-1" }) },
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      importBatch: { id: "batch-1", status: "parsed" },
    });
  });

  it("lists cost import batches for exception discovery", async () => {
    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ projectId: "project-1" }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      batches: [
        {
          id: "batch-exception-only",
          importType: "traffic",
          status: "parsed",
        },
      ],
    });
    expect(
      (await vi.mocked(getComplexCostRouteContext).mock.results[0].value).repo
        .listImportBatches,
    ).toHaveBeenCalledWith({
      organizationId: "org-1",
      projectId: "project-1",
      limit: 25,
    });
  });
});
