import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

import { assertBillingWriteAllowed } from "@/features/billing/route-guard";
import { CustomRuleGovernanceError } from "@/features/settlements/custom-rule-governance";
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
const SOURCE_PROJECT_ID = "33333333-3333-4333-8333-333333333333";
const TARGET_PROJECT_ID = "99999999-9999-4999-8999-999999999999";
const RULE_ID = "44444444-4444-4444-8444-444444444444";
const NEW_RULE_ID = "55555555-5555-4555-8555-555555555555";

function body(overrides: Record<string, unknown> = {}) {
  return {
    targetProjectId: TARGET_PROJECT_ID,
    targetVariableCatalogVersion: "a".repeat(64),
    targetAvailableVariableIds: ["system_minutes"],
    newVersionId: NEW_RULE_ID,
    reason: "复制为新项目草稿",
    clientRequestId: "clone-request-0001",
    ...overrides,
  };
}

function request(value: unknown = body()) {
  return new Request("http://localhost", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(value),
  });
}

function context(role: string) {
  return {
    supabase: { client: "supabase" },
    auth: { userId: USER_ID, organizationId: ORGANIZATION_ID, role },
    actor: { userId: USER_ID, organizationId: ORGANIZATION_ID },
    requireProjectAccess: vi.fn().mockResolvedValue(undefined),
    lifecycle: {
      cloneCustomRuleToDraft: vi.fn().mockResolvedValue({
        version: {
          id: NEW_RULE_ID,
          projectId: TARGET_PROJECT_ID,
          status: "draft",
          formula: "secret source formula",
          compiledAst: { secret: true },
        },
        lineage: {
          sourceRuleVersionId: RULE_ID,
          sourceProjectId: SOURCE_PROJECT_ID,
          sourceVersionNumber: 2,
          sourceScope: "payable",
        },
        missingTargetVariables: [],
      }),
    },
  };
}

describe("settlement rule clone route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(assertBillingWriteAllowed).mockResolvedValue(undefined);
  });

  it.each(["owner", "ops_manager", "operator_business"])(
    "clones a rule to draft for %s",
    async (role) => {
      const routeContext = context(role);
      vi.mocked(getCustomRuleRouteContext).mockResolvedValue(
        routeContext as never,
      );

      const response = await POST(request(), {
        params: Promise.resolve({
          projectId: SOURCE_PROJECT_ID,
          ruleVersionId: RULE_ID,
        }),
      });

      expect(response.status).toBe(201);
      expect(routeContext.requireProjectAccess).toHaveBeenCalledWith(
        SOURCE_PROJECT_ID,
      );
      expect(routeContext.requireProjectAccess).toHaveBeenCalledWith(
        TARGET_PROJECT_ID,
      );
      expect(routeContext.lifecycle.cloneCustomRuleToDraft).toHaveBeenCalledWith({
        actor: routeContext.actor,
        sourceProjectId: SOURCE_PROJECT_ID,
        targetProjectId: TARGET_PROJECT_ID,
        sourceRuleVersionId: RULE_ID,
        targetVariableCatalogVersion: "a".repeat(64),
        targetAvailableVariableIds: ["system_minutes"],
        newVersionId: NEW_RULE_ID,
        reason: "复制为新项目草稿",
        clientRequestId: "clone-request-0001",
      });
      expect(JSON.stringify(await response.json())).not.toContain("secret");
    },
  );

  it("maps concurrent or wrong target scope conflicts to 409", async () => {
    const routeContext = context("owner");
    routeContext.lifecycle.cloneCustomRuleToDraft.mockRejectedValue(
      new CustomRuleGovernanceError(
        "CUSTOM_RULE_SERVER_CONTEXT_MISMATCH",
        "Server-owned custom settlement rule context does not match the request scope",
      ),
    );
    vi.mocked(getCustomRuleRouteContext).mockResolvedValue(
      routeContext as never,
    );

    const response = await POST(request(), {
      params: Promise.resolve({
        projectId: SOURCE_PROJECT_ID,
        ruleVersionId: RULE_ID,
      }),
    });

    expect(response.status).toBe(409);
  });

  it("rejects malformed target project before billing", async () => {
    const routeContext = context("owner");
    vi.mocked(getCustomRuleRouteContext).mockResolvedValue(
      routeContext as never,
    );

    const response = await POST(request(body({ targetProjectId: "bad" })), {
      params: Promise.resolve({
        projectId: SOURCE_PROJECT_ID,
        ruleVersionId: RULE_ID,
      }),
    });

    expect(response.status).toBe(400);
    expect(assertBillingWriteAllowed).not.toHaveBeenCalled();
  });
});
