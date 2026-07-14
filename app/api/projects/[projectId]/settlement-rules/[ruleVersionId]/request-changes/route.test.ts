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
const PROJECT_ID = "33333333-3333-4333-8333-333333333333";
const RULE_ID = "44444444-4444-4444-8444-444444444444";

function request(value: unknown = body()) {
  return new Request("http://localhost", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof value === "string" ? value : JSON.stringify(value),
  });
}

function body(overrides: Record<string, unknown> = {}) {
  return {
    reason: "试算差异过大，需要调整",
    comment: "请把红黄证据场次路由到人工复核",
    clientRequestId: "request-changes-0001",
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
      requestCustomRuleChanges: vi.fn().mockResolvedValue({
        version: { id: RULE_ID, projectId: PROJECT_ID, status: "changes_requested" },
        simulation: { id: "55555555-5555-4555-8555-555555555555" },
        event: { id: "66666666-6666-4666-8666-666666666666" },
      }),
    },
  };
}

describe("settlement rule request-changes route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(assertBillingWriteAllowed).mockResolvedValue(undefined);
  });

  it.each(["owner", "ops_manager", "finance"])(
    "lets %s request changes",
    async (role) => {
      const routeContext = context(role);
      vi.mocked(getCustomRuleRouteContext).mockResolvedValue(
        routeContext as never,
      );

      const response = await POST(request(), {
        params: Promise.resolve({ projectId: PROJECT_ID, ruleVersionId: RULE_ID }),
      });

      expect(response.status).toBe(200);
      expect(routeContext.lifecycle.requestCustomRuleChanges).toHaveBeenCalledWith({
        actor: routeContext.actor,
        projectId: PROJECT_ID,
        ruleVersionId: RULE_ID,
        reason: body().reason,
        comment: body().comment,
        clientRequestId: "request-changes-0001",
      });
    },
  );

  it("maps an operator_business role denial to 403", async () => {
    const routeContext = context("operator_business");
    routeContext.lifecycle.requestCustomRuleChanges.mockRejectedValue(
      new CustomRuleGovernanceError(
        "CUSTOM_RULE_ACTION_NOT_ALLOWED",
        "Server role operator_business cannot perform request_changes",
      ),
    );
    vi.mocked(getCustomRuleRouteContext).mockResolvedValue(
      routeContext as never,
    );

    const response = await POST(request(), {
      params: Promise.resolve({ projectId: PROJECT_ID, ruleVersionId: RULE_ID }),
    });

    expect(response.status).toBe(403);
  });

  it("rejects malformed reason/comment before billing", async () => {
    const routeContext = context("finance");
    vi.mocked(getCustomRuleRouteContext).mockResolvedValue(
      routeContext as never,
    );

    const response = await POST(request(body({ reason: "", comment: "" })), {
      params: Promise.resolve({ projectId: PROJECT_ID, ruleVersionId: RULE_ID }),
    });

    expect(response.status).toBe(400);
    expect(assertBillingWriteAllowed).not.toHaveBeenCalled();
  });

  it("blocks billing read-only mode before requesting changes", async () => {
    const routeContext = context("finance");
    vi.mocked(assertBillingWriteAllowed).mockRejectedValue(
      new Error("Organization is read-only because billing is past due"),
    );
    vi.mocked(getCustomRuleRouteContext).mockResolvedValue(
      routeContext as never,
    );

    const response = await POST(request(), {
      params: Promise.resolve({ projectId: PROJECT_ID, ruleVersionId: RULE_ID }),
    });

    expect(response.status).toBe(403);
    expect(routeContext.lifecycle.requestCustomRuleChanges).not.toHaveBeenCalled();
  });
});
