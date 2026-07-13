import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET, POST } from "./route";

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
const RULE_ID = "44444444-4444-4444-8444-444444444444";

function organizationTemplate(overrides: Record<string, unknown> = {}) {
  return {
    kind: "organization",
    id: "55555555-5555-4555-8555-555555555555",
    organizationId: ORGANIZATION_ID,
    name: "高峰时段奖励",
    description: "可复用组织模板",
    sourceRuleVersionId: RULE_ID,
    sourceProjectId: PROJECT_ID,
    sourceVersionNumber: 2,
    sourceScope: "payable",
    executionGrain: "report",
    compositionMode: "add",
    formula: "secret formula",
    compiledAst: { secret: true },
    variables: [{ secret: true }],
    parameters: {},
    ruleContract: { title: "模板合同" },
    missingDataPolicy: {},
    testCases: [{ private: true }],
    status: "active",
    createdBy: USER_ID,
    createdAt: "2026-07-12T00:00:00.000Z",
    archivedAt: null,
    readOnly: false,
    ...overrides,
  };
}

function context(role: string) {
  return {
    supabase: { client: "supabase" },
    auth: { userId: USER_ID, organizationId: ORGANIZATION_ID, role },
    actor: { userId: USER_ID, organizationId: ORGANIZATION_ID },
    requireProjectAccess: vi.fn().mockResolvedValue(undefined),
    templates: {
      listReusableSettlementRuleTemplates: vi.fn().mockResolvedValue([
        {
          kind: "system",
          id: "system:base-hourly",
          name: "基础时薪",
          description: "系统模板",
          contract: { title: "系统合同" },
          readOnly: true,
        },
        organizationTemplate(),
      ]),
    },
    lifecycle: {
      saveOrganizationRuleTemplate: vi
        .fn()
        .mockResolvedValue(organizationTemplate()),
    },
  };
}

function postRequest(value: unknown) {
  return new Request("http://localhost", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(value),
  });
}

describe("settlement rule templates route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(assertBillingWriteAllowed).mockResolvedValue(undefined);
  });

  it.each(["owner", "ops_manager", "operator_business", "finance"])(
    "lists reusable templates for %s without billing write gate",
    async (role) => {
      const routeContext = context(role);
      vi.mocked(getCustomRuleRouteContext).mockResolvedValue(
        routeContext as never,
      );

      const response = await GET(
        new Request("http://localhost/api/settlement-rule-templates"),
      );

      expect(response.status).toBe(200);
      expect(assertBillingWriteAllowed).not.toHaveBeenCalled();
      expect(routeContext.templates.listReusableSettlementRuleTemplates).toHaveBeenCalledWith({
        actor: routeContext.actor,
      });
      expect(JSON.stringify(await response.json())).not.toContain("secret formula");
    },
  );

  it.each(["owner", "ops_manager"])("saves organization templates for %s", async (role) => {
    const routeContext = context(role);
    vi.mocked(getCustomRuleRouteContext).mockResolvedValue(
      routeContext as never,
    );

    const response = await POST(
      postRequest({
        projectId: PROJECT_ID,
        sourceRuleVersionId: RULE_ID,
        name: "高峰时段奖励",
        description: "保存供其他项目复用",
        confirmedContractHash: "a".repeat(64),
        reason: "沉淀为组织模板",
        clientRequestId: "save-template-0001",
      }),
    );

    expect(response.status).toBe(201);
    expect(routeContext.requireProjectAccess).toHaveBeenCalledWith(PROJECT_ID);
    expect(assertBillingWriteAllowed).toHaveBeenCalledWith({
      client: routeContext.supabase,
      organizationId: ORGANIZATION_ID,
      featureKey: "settlement",
    });
    expect(routeContext.lifecycle.saveOrganizationRuleTemplate).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: routeContext.actor,
        projectId: PROJECT_ID,
        sourceRuleVersionId: RULE_ID,
      }),
    );
  });

  it("rejects malformed template commands before billing", async () => {
    const routeContext = context("owner");
    vi.mocked(getCustomRuleRouteContext).mockResolvedValue(
      routeContext as never,
    );

    const response = await POST(
      postRequest({
        projectId: PROJECT_ID,
        sourceRuleVersionId: RULE_ID,
        name: "",
        confirmedContractHash: "bad",
        reason: "",
        clientRequestId: "bad",
      }),
    );

    expect(response.status).toBe(400);
    expect(assertBillingWriteAllowed).not.toHaveBeenCalled();
  });

  it("blocks billing read-only mode before saving templates", async () => {
    const routeContext = context("owner");
    vi.mocked(assertBillingWriteAllowed).mockRejectedValue(
      new Error("Organization is read-only because billing is past due"),
    );
    vi.mocked(getCustomRuleRouteContext).mockResolvedValue(
      routeContext as never,
    );

    const response = await POST(
      postRequest({
        projectId: PROJECT_ID,
        sourceRuleVersionId: RULE_ID,
        name: "高峰时段奖励",
        confirmedContractHash: "a".repeat(64),
        reason: "沉淀为组织模板",
        clientRequestId: "save-template-0002",
      }),
    );

    expect(response.status).toBe(403);
    expect(routeContext.lifecycle.saveOrganizationRuleTemplate).not.toHaveBeenCalled();
  });
});
