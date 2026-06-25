import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

import { assertBillingWriteAllowed } from "@/features/billing/route-guard";
import { getComplexCostRouteContext } from "@/features/complex-cost/complex-cost-route-utils";

vi.mock("@/features/billing/route-guard", () => ({
  assertBillingWriteAllowed: vi.fn(),
}));

vi.mock("@/features/complex-cost/complex-cost-route-utils", () => ({
  getComplexCostRouteContext: vi.fn(),
  readJsonBody: async (request: Request) => request.json().catch(() => ({})),
  jsonError: (error: { message?: string; statusCode?: number }) =>
    Response.json(
      { error: error.message ?? "Unexpected error" },
      {
        status:
          error.statusCode ??
          (error.message?.startsWith(
            "Organization is read-only because billing",
          )
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

const auth = {
  userId: "user-1",
  name: "Ops",
  role: "ops_manager" as const,
  organizationId: "org-1",
};

describe("complex cost preview route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(assertBillingWriteAllowed).mockResolvedValue(undefined);
    vi.mocked(getComplexCostRouteContext).mockResolvedValue({
      supabase: { client: "supabase" },
      auth,
      repo: {
        getProjectEntitlement: vi.fn(async () => ({ projectId: "project-1" })),
      },
      audit: vi.fn(),
    } as never);
  });

  it("returns complex cost preview result", async () => {
    const request = new Request(
      "http://localhost/api/projects/project-1/complex-cost-rule/preview",
      {
        method: "POST",
        body: JSON.stringify({
          expectedReceivableCents: 100000,
          streamerCount: 2,
          estimatedMinutesPerStreamer: 60,
          streamerHourlyCostCents: 5000,
        }),
      },
    );

    const response = await POST(request, {
      params: Promise.resolve({ projectId: "project-1" }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      preview: expect.objectContaining({ expectedReceivableCents: 100000 }),
    });
  });

  it("requires authentication", async () => {
    vi.mocked(getComplexCostRouteContext).mockRejectedValueOnce(
      new ErrorWithStatus("Unauthorized", 401),
    );

    const response = await POST(createPreviewRequest(), {
      params: Promise.resolve({ projectId: "project-1" }),
    });

    expect(response.status).toBe(401);
  });

  it("blocks roles outside MCN staff", async () => {
    vi.mocked(getComplexCostRouteContext).mockRejectedValueOnce(
      new ErrorWithStatus("Only MCN staff can manage complex cost rules", 403),
    );

    const response = await POST(createPreviewRequest(), {
      params: Promise.resolve({ projectId: "project-1" }),
    });

    expect(response.status).toBe(403);
  });

  it("blocks writes while billing is read-only", async () => {
    vi.mocked(assertBillingWriteAllowed).mockRejectedValueOnce(
      new Error("Organization is read-only because billing is past due"),
    );

    const response = await POST(createPreviewRequest(), {
      params: Promise.resolve({ projectId: "project-1" }),
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "Organization is read-only because billing is past due",
    });
  });

  it("requires a project complex cost entitlement", async () => {
    vi.mocked(getComplexCostRouteContext).mockResolvedValueOnce({
      supabase: { client: "supabase" },
      auth,
      repo: {
        getProjectEntitlement: vi.fn(async () => null),
      },
      audit: vi.fn(),
    } as never);

    const response = await POST(createPreviewRequest(), {
      params: Promise.resolve({ projectId: "project-1" }),
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "Complex cost rules are not enabled for this project",
    });
  });
});

function createPreviewRequest() {
  return new Request(
    "http://localhost/api/projects/project-1/complex-cost-rule/preview",
    {
      method: "POST",
      body: JSON.stringify({
        expectedReceivableCents: 100000,
        streamerCount: 2,
        estimatedMinutesPerStreamer: 60,
        streamerHourlyCostCents: 5000,
      }),
    },
  );
}

class ErrorWithStatus extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
  }
}
