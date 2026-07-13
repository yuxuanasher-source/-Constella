import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "./route";

import { assertBillingWriteAllowed } from "@/features/billing/route-guard";
import { getCustomRuleRouteContext } from "@/features/settlements/custom-rule-route-context";

vi.mock("@/features/billing/route-guard", () => ({
  assertBillingWriteAllowed: vi.fn(),
}));

vi.mock(
  "@/features/settlements/custom-rule-route-context",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("@/features/settlements/custom-rule-route-context")
      >();
    return { ...actual, getCustomRuleRouteContext: vi.fn() };
  },
);

const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const PROJECT_ID = "33333333-3333-4333-8333-333333333333";

function routeContext(role: string) {
  return {
    supabase: { client: "supabase" },
    auth: {
      userId: "22222222-2222-4222-8222-222222222222",
      organizationId: ORGANIZATION_ID,
      role,
    },
    actor: {
      userId: "22222222-2222-4222-8222-222222222222",
      organizationId: ORGANIZATION_ID,
    },
    requireProjectAccess: vi.fn().mockResolvedValue(undefined),
    catalog: {
      getCatalog: vi.fn().mockResolvedValue({
        scope: "payable",
        executionGrain: "report",
        businessTimezone: "Asia/Shanghai",
        businessTimezoneConfirmed: true,
        businessTimezoneSource: "contract_default",
        hasHistory: true,
        version: "a".repeat(64),
        variables: [
          {
            id: "system_minutes",
            label: "系统直播时长",
            runtimeType: { kind: "scalar", scalarType: "integer" },
            unit: "分钟",
            sourceLabel: "直播报告",
            availability: "available",
            coverageNumerator: 4,
            coverageDenominator: 4,
            latestSampledPeriod: {
              start: "2026-07-01",
              end: "2026-07-10",
            },
          },
        ],
      }),
    },
  };
}

function request(scope = "payable", executionGrain = "report") {
  return new Request(
    `http://localhost/api/projects/${PROJECT_ID}/settlement-rules/variable-catalog?scope=${scope}&executionGrain=${executionGrain}`,
  );
}

describe("settlement rule variable catalog route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each(["owner", "ops_manager", "operator_business", "finance"])(
    "allows %s to read the scoped catalog",
    async (role) => {
      const context = routeContext(role);
      vi.mocked(getCustomRuleRouteContext).mockResolvedValue(context as never);

      const response = await GET(request(), {
        params: Promise.resolve({ projectId: PROJECT_ID }),
      });

      expect(response.status).toBe(200);
      expect(context.requireProjectAccess).toHaveBeenCalledWith(PROJECT_ID);
      expect(context.catalog.getCatalog).toHaveBeenCalledWith({
        organizationId: ORGANIZATION_ID,
        projectId: PROJECT_ID,
        scope: "payable",
        executionGrain: "report",
      });
      expect(assertBillingWriteAllowed).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["external_cost", "report"],
    ["reconciliation", "project_period"],
  ])(
    "allows Phase 4 %s catalogs through the public route",
    async (scope, executionGrain) => {
      const context = routeContext("finance");
      vi.mocked(getCustomRuleRouteContext).mockResolvedValue(context as never);

      const response = await GET(request(scope, executionGrain), {
        params: Promise.resolve({ projectId: PROJECT_ID }),
      });

      expect(response.status).toBe(200);
      expect(context.requireProjectAccess).toHaveBeenCalledWith(PROJECT_ID);
      expect(context.catalog.getCatalog).toHaveBeenCalledWith({
        organizationId: ORGANIZATION_ID,
        projectId: PROJECT_ID,
        scope,
        executionGrain,
      });
    },
  );

  it("returns only catalog metadata and never raw sample values", async () => {
    const context = routeContext("finance");
    vi.mocked(getCustomRuleRouteContext).mockResolvedValue(context as never);

    const response = await GET(request(), {
      params: Promise.resolve({ projectId: PROJECT_ID }),
    });
    const body = await response.json();

    expect(body.catalog.variables[0]).toEqual(
      expect.objectContaining({
        id: "system_minutes",
        coverageNumerator: 4,
        coverageDenominator: 4,
      }),
    );
    expect(JSON.stringify(body)).not.toContain("sampleRows");
    expect(JSON.stringify(body)).not.toContain("amountCents");
  });

  it("uses Zod for route params and query options", async () => {
    const context = routeContext("finance");
    vi.mocked(getCustomRuleRouteContext).mockResolvedValue(context as never);

    const response = await GET(request("external_cost", "unknown"), {
      params: Promise.resolve({ projectId: "not-a-uuid" }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "INVALID_REQUEST",
        message: "Request validation failed",
        path: ["projectId"],
        retryable: false,
      },
    });
    expect(context.requireProjectAccess).not.toHaveBeenCalled();
    expect(context.catalog.getCatalog).not.toHaveBeenCalled();
  });

  it("preserves fail-closed context responses", async () => {
    vi.mocked(getCustomRuleRouteContext).mockResolvedValue(
      Response.json(
        {
          error: {
            code: "CUSTOM_RULE_FEATURE_DISABLED",
            message: "Custom settlement rule authoring is disabled",
            retryable: false,
          },
        },
        { status: 404 },
      ) as never,
    );

    const response = await GET(request(), {
      params: Promise.resolve({ projectId: PROJECT_ID }),
    });

    expect(response.status).toBe(404);
  });

  it("hides projects outside the authenticated organization", async () => {
    const context = routeContext("finance");
    const { CustomRuleRouteError } =
      await import("@/features/settlements/custom-rule-route-context");
    context.requireProjectAccess.mockRejectedValue(
      new CustomRuleRouteError({
        code: "CUSTOM_RULE_PROJECT_NOT_FOUND",
        message: "Project not found",
        status: 404,
        retryable: false,
      }),
    );
    vi.mocked(getCustomRuleRouteContext).mockResolvedValue(context as never);

    const response = await GET(request(), {
      params: Promise.resolve({ projectId: PROJECT_ID }),
    });

    expect(response.status).toBe(404);
    expect(context.catalog.getCatalog).not.toHaveBeenCalled();
  });
});
