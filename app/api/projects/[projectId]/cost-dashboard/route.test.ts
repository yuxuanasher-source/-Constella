import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "./route";

import { getProjectComplexCostDashboard } from "@/features/complex-cost/complex-cost-queries";
import { getComplexCostRouteContext } from "@/features/complex-cost/complex-cost-route-utils";

vi.mock("@/features/complex-cost/complex-cost-queries", () => ({
  getProjectComplexCostDashboard: vi.fn(),
}));
vi.mock("@/features/complex-cost/complex-cost-route-utils", () => ({
  getComplexCostRouteContext: vi.fn(),
  jsonError: (error: { message?: string; statusCode?: number }) =>
    Response.json(
      { error: error.message ?? "Unexpected error" },
      { status: error.statusCode ?? 500 },
    ),
}));

describe("project cost dashboard route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getComplexCostRouteContext).mockResolvedValue({
      supabase: {},
      auth: { role: "finance", organizationId: "org-1" },
    } as never);
    vi.mocked(getProjectComplexCostDashboard).mockResolvedValue({
      expectedReceivableCents: 100000,
      grossMarginCents: 40000,
      items: [],
    });
  });

  it("returns a role-safe cost dashboard", async () => {
    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ projectId: "project-1" }),
    });

    await expect(response.json()).resolves.toMatchObject({
      dashboard: { expectedReceivableCents: 100000, items: [] },
    });
  });
});
