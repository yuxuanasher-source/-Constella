import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

import { assertBillingWriteAllowed } from "@/features/billing/route-guard";
import { getComplexCostRouteContext } from "@/features/complex-cost/complex-cost-route-utils";
import { approveComplexCostRuleVersion } from "@/features/complex-cost/complex-cost-service";

vi.mock("@/features/billing/route-guard", () => ({
  assertBillingWriteAllowed: vi.fn(),
}));
vi.mock("@/features/complex-cost/complex-cost-service", () => ({
  approveComplexCostRuleVersion: vi.fn(),
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

describe("complex cost rule approval route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(assertBillingWriteAllowed).mockResolvedValue(undefined);
    vi.mocked(getComplexCostRouteContext).mockResolvedValue({
      supabase: {},
      auth: {
        userId: "user-1",
        name: "Owner",
        role: "owner",
        organizationId: "org-1",
      },
      repo: {},
      audit: vi.fn(),
    } as never);
    vi.mocked(approveComplexCostRuleVersion).mockResolvedValue({
      id: "rule-1",
      organizationId: "org-1",
      projectId: "project-1",
      versionNo: 1,
      status: "active",
      rulePayload: {},
    });
  });

  it("approves a draft rule version", async () => {
    const response = await POST(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ versionId: "rule-1", reason: "Approved" }),
      }),
      { params: Promise.resolve({ projectId: "project-1" }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      rule: { id: "rule-1", status: "active" },
    });
  });
});
