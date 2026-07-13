import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

import { assertBillingWriteAllowed } from "@/features/billing/route-guard";
import {
  CUSTOM_RULE_FORCE_APPROVAL_ACKNOWLEDGEMENT,
  CustomRuleGovernanceError,
} from "@/features/settlements/custom-rule-governance";
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

function body(overrides: Record<string, unknown> = {}) {
  return {
    effectiveFrom: "2026-07-12T00:00:00.000Z",
    reason: "试算和风险均已复核",
    clientRequestId: "approve-request-0001",
    ...overrides,
  };
}

function request(value: unknown = body()) {
  return new Request("http://localhost", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof value === "string" ? value : JSON.stringify(value),
  });
}

function context(role: string) {
  return {
    supabase: { client: "supabase" },
    auth: { userId: USER_ID, organizationId: ORGANIZATION_ID, role },
    actor: { userId: USER_ID, organizationId: ORGANIZATION_ID },
    requireProjectAccess: vi.fn().mockResolvedValue(undefined),
    lifecycle: {
      approveCustomRule: vi.fn().mockResolvedValue({
        version: { id: RULE_ID, projectId: PROJECT_ID, status: "active" },
        simulation: { id: "55555555-5555-4555-8555-555555555555" },
        event: { id: "66666666-6666-4666-8666-666666666666" },
      }),
      forceApproveCustomRule: vi.fn().mockResolvedValue({
        version: { id: RULE_ID, projectId: PROJECT_ID, status: "active" },
        simulation: { id: "55555555-5555-4555-8555-555555555555" },
        event: { id: "66666666-6666-4666-8666-666666666666" },
      }),
    },
  };
}

describe("settlement rule approve route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(assertBillingWriteAllowed).mockResolvedValue(undefined);
  });

  it.each(["owner", "ops_manager"])("standard-approves for %s", async (role) => {
    const routeContext = context(role);
    vi.mocked(getCustomRuleRouteContext).mockResolvedValue(
      routeContext as never,
    );

    const response = await POST(request(), {
      params: Promise.resolve({ projectId: PROJECT_ID, ruleVersionId: RULE_ID }),
    });

    expect(response.status).toBe(200);
    expect(routeContext.lifecycle.approveCustomRule).toHaveBeenCalledWith({
      actor: routeContext.actor,
      projectId: PROJECT_ID,
      ruleVersionId: RULE_ID,
      effectiveFrom: body().effectiveFrom,
      reason: body().reason,
      clientRequestId: "approve-request-0001",
    });
    expect(routeContext.lifecycle.forceApproveCustomRule).not.toHaveBeenCalled();
  });

  it("keeps force approval on the same endpoint with a typed command", async () => {
    const routeContext = context("owner");
    vi.mocked(getCustomRuleRouteContext).mockResolvedValue(
      routeContext as never,
    );

    const response = await POST(
      request(
        body({
          force: true,
          reason: "单一负责人组织，已复核风险与试算",
          acknowledgment: CUSTOM_RULE_FORCE_APPROVAL_ACKNOWLEDGEMENT,
        }),
      ),
      { params: Promise.resolve({ projectId: PROJECT_ID, ruleVersionId: RULE_ID }) },
    );

    expect(response.status).toBe(200);
    expect(routeContext.lifecycle.forceApproveCustomRule).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: "单一负责人组织，已复核风险与试算",
        acknowledgment: CUSTOM_RULE_FORCE_APPROVAL_ACKNOWLEDGEMENT,
      }),
    );
  });

  it("rejects client-side risk downgrades as malformed commands", async () => {
    const routeContext = context("owner");
    vi.mocked(getCustomRuleRouteContext).mockResolvedValue(
      routeContext as never,
    );

    const response = await POST(
      request(body({ isMaterialRisk: false, creatorId: USER_ID })),
      { params: Promise.resolve({ projectId: PROJECT_ID, ruleVersionId: RULE_ID }) },
    );

    expect(response.status).toBe(400);
    expect(assertBillingWriteAllowed).not.toHaveBeenCalled();
    expect(routeContext.lifecycle.approveCustomRule).not.toHaveBeenCalled();
  });

  it.each([
    ["CREATOR_APPROVAL_REQUIRES_DISTINCT_APPROVER"],
    ["MATERIAL_RISK_REQUIRES_OWNER"],
    ["FORCE_ACKNOWLEDGEMENT_REQUIRED"],
  ])("maps %s to 403", async (code) => {
    const routeContext = context("owner");
    routeContext.lifecycle.approveCustomRule.mockRejectedValue(
      new CustomRuleGovernanceError(code, "approval denied"),
    );
    vi.mocked(getCustomRuleRouteContext).mockResolvedValue(
      routeContext as never,
    );

    const response = await POST(request(), {
      params: Promise.resolve({ projectId: PROJECT_ID, ruleVersionId: RULE_ID }),
    });

    expect(response.status).toBe(403);
  });

  it("rejects force approval without acknowledgment before billing", async () => {
    const routeContext = context("owner");
    vi.mocked(getCustomRuleRouteContext).mockResolvedValue(
      routeContext as never,
    );

    const response = await POST(request(body({ force: true })), {
      params: Promise.resolve({ projectId: PROJECT_ID, ruleVersionId: RULE_ID }),
    });

    expect(response.status).toBe(400);
    expect(assertBillingWriteAllowed).not.toHaveBeenCalled();
  });

  it("blocks billing read-only mode before approval", async () => {
    const routeContext = context("owner");
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
    expect(routeContext.lifecycle.approveCustomRule).not.toHaveBeenCalled();
  });
});
