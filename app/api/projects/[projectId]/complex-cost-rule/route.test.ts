import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET, POST } from "./route";

import { assertBillingWriteAllowed } from "@/features/billing/route-guard";
import { getProjectComplexCostSettings } from "@/features/complex-cost/complex-cost-queries";
import { getComplexCostRouteContext } from "@/features/complex-cost/complex-cost-route-utils";
import { saveComplexCostRuleDraft } from "@/features/complex-cost/complex-cost-service";

vi.mock("@/features/billing/route-guard", () => ({
  assertBillingWriteAllowed: vi.fn(),
}));
vi.mock("@/features/complex-cost/complex-cost-queries", () => ({
  getProjectComplexCostSettings: vi.fn(),
}));
vi.mock("@/features/complex-cost/complex-cost-service", () => ({
  saveComplexCostRuleDraft: vi.fn(),
}));
vi.mock("@/features/complex-cost/complex-cost-route-utils", () => ({
  getComplexCostRouteContext: vi.fn(),
  complexCostActorFromContext: vi.fn((context) => context.auth),
  readJsonBody: async (request: Request) => request.json().catch(() => ({})),
  optionalRecord: (body: Record<string, unknown>, key: string) =>
    body[key] && typeof body[key] === "object" && !Array.isArray(body[key])
      ? (body[key] as Record<string, unknown>)
      : undefined,
  jsonError: (error: { message?: string; statusCode?: number }) =>
    Response.json(
      { error: error.message ?? "Unexpected error" },
      { status: error.statusCode ?? 500 },
    ),
}));

const auth = {
  userId: "user-1",
  name: "Ops",
  role: "ops_manager" as const,
  organizationId: "org-1",
};

describe("complex cost rule route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(assertBillingWriteAllowed).mockResolvedValue(undefined);
    vi.mocked(getComplexCostRouteContext).mockResolvedValue({
      supabase: { client: "supabase" },
      auth,
      repo: {},
      audit: vi.fn(),
    } as never);
    vi.mocked(getProjectComplexCostSettings).mockResolvedValue({
      entitlement: null,
      activeRule: null,
      draftRule: null,
    });
    vi.mocked(saveComplexCostRuleDraft).mockResolvedValue({
      id: "rule-1",
      organizationId: "org-1",
      projectId: "project-1",
      versionNo: 1,
      status: "draft",
      rulePayload: { scenario: "cps" },
    });
  });

  it("returns project complex cost settings", async () => {
    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ projectId: "project-1" }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      settings: { entitlement: null, activeRule: null, draftRule: null },
    });
  });

  it("saves a draft rule version", async () => {
    const response = await POST(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ rulePayload: { scenario: "cps" } }),
      }),
      { params: Promise.resolve({ projectId: "project-1" }) },
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      rule: { id: "rule-1", status: "draft" },
    });
  });
});
