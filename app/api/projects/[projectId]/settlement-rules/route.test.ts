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
const USER_ID = "22222222-2222-4222-8222-222222222222";
const PROJECT_ID = "33333333-3333-4333-8333-333333333333";

function rule(overrides: Record<string, unknown> = {}) {
  return {
    id: "44444444-4444-4444-8444-444444444444",
    organizationId: ORGANIZATION_ID,
    projectId: PROJECT_ID,
    scope: "payable",
    target: { targetType: "project", targetId: null },
    executionGrain: "report",
    compositionMode: "replace",
    priority: 100,
    versionNumber: 2,
    status: "active",
    formula: "money_result({ final: yuan(1) })",
    compiledAst: { private: true },
    variables: [{ privateVariable: true }],
    parameters: {},
    ruleContract: { title: "safe contract title" },
    systemExplanationTemplate: "internal template",
    missingDataPolicy: { action: "block_batch" },
    testCases: [{ privateTest: true }],
    simulationSummary: { internalRiskThresholds: true },
    formulaHash: "a".repeat(64),
    contractHash: "b".repeat(64),
    parameterHash: "c".repeat(64),
    catalogHash: "d".repeat(64),
    dataSelectionHash: "e".repeat(64),
    simulationId: "55555555-5555-4555-8555-555555555555",
    effectiveFrom: "2026-07-12T00:00:00.000Z",
    effectiveUntil: null,
    createdBy: USER_ID,
    approvedBy: "66666666-6666-4666-8666-666666666666",
    aiDraftId: null,
    reason: "审核通过",
    createdAt: "2026-07-12T00:00:00.000Z",
    approvedAt: "2026-07-12T01:00:00.000Z",
    archivedAt: null,
    effectiveNow: true,
    scheduled: false,
    reviewDetails: [{ reviewerNote: "private" }],
    ...overrides,
  };
}

function context(role: string) {
  return {
    supabase: { client: "supabase" },
    auth: { userId: USER_ID, organizationId: ORGANIZATION_ID, role },
    actor: { userId: USER_ID, organizationId: ORGANIZATION_ID },
    requireProjectAccess: vi.fn().mockResolvedValue(undefined),
    lifecycle: {
      listCustomRules: vi.fn().mockResolvedValue([rule()]),
    },
  };
}

function request(search = "") {
  return new Request(
    `http://localhost/api/projects/${PROJECT_ID}/settlement-rules${search}`,
  );
}

describe("settlement rule governance list route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each(["owner", "ops_manager", "operator_business", "finance"])(
    "allows %s to list rules in billing read-only mode",
    async (role) => {
      const routeContext = context(role);
      vi.mocked(getCustomRuleRouteContext).mockResolvedValue(
        routeContext as never,
      );

      const response = await GET(request("?status=active"), {
        params: Promise.resolve({ projectId: PROJECT_ID }),
      });

      expect(response.status).toBe(200);
      expect(routeContext.requireProjectAccess).toHaveBeenCalledWith(
        PROJECT_ID,
      );
      expect(assertBillingWriteAllowed).not.toHaveBeenCalled();
      expect(routeContext.lifecycle.listCustomRules).toHaveBeenCalledWith({
        actor: routeContext.actor,
        projectId: PROJECT_ID,
        status: "active",
      });
    },
  );

  it("returns explicit rule DTOs without formulas, ASTs, risk thresholds, or review details", async () => {
    vi.mocked(getCustomRuleRouteContext).mockResolvedValue(
      context("finance") as never,
    );

    const response = await GET(request(), {
      params: Promise.resolve({ projectId: PROJECT_ID }),
    });
    const payload = await response.json();
    const serialized = JSON.stringify(payload);

    expect(payload.rules[0]).toMatchObject({
      id: "44444444-4444-4444-8444-444444444444",
      status: "active",
      effectiveNow: true,
      primaryAction: { state: "active", action: "create_new_version" },
    });
    expect(serialized).not.toContain("money_result");
    expect(serialized).not.toContain("compiledAst");
    expect(serialized).not.toContain("internalRiskThresholds");
    expect(serialized).not.toContain("reviewerNote");
  });

  it("uses Zod for params and query values", async () => {
    const routeContext = context("finance");
    vi.mocked(getCustomRuleRouteContext).mockResolvedValue(
      routeContext as never,
    );

    const response = await GET(request("?status=unknown"), {
      params: Promise.resolve({ projectId: "not-a-uuid" }),
    });

    expect(response.status).toBe(400);
    expect(routeContext.requireProjectAccess).not.toHaveBeenCalled();
    expect(routeContext.lifecycle.listCustomRules).not.toHaveBeenCalled();
  });

  it("preserves fail-closed auth/context responses", async () => {
    vi.mocked(getCustomRuleRouteContext).mockResolvedValue(
      Response.json(
        {
          error: {
            code: "CUSTOM_RULE_FORBIDDEN",
            message: "Settlement rule authoring is limited to MCN staff",
            retryable: false,
          },
        },
        { status: 403 },
      ) as never,
    );

    const response = await GET(request(), {
      params: Promise.resolve({ projectId: PROJECT_ID }),
    });

    expect(response.status).toBe(403);
  });
});
