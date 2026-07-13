import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

import { assertBillingWriteAllowed } from "@/features/billing/route-guard";
import { CustomRuleGovernanceError } from "@/features/settlements/custom-rule-governance";
import { CustomRulePersistenceQueryError } from "@/features/settlements/custom-rule-repository";
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
const FALLBACK_RULE_ID = "99999999-9999-4999-8999-999999999999";

function body(overrides: Record<string, unknown> = {}) {
  return {
    effectiveUntil: "2026-07-31T00:00:00.000Z",
    fallbackProof: {
      ruleVersionId: FALLBACK_RULE_ID,
      simulationId: "77777777-7777-4777-8777-777777777777",
      proofKind: "remaining_custom_layers",
      remainingCustomLayerCount: 1,
      fixedFallbackAvailable: false,
      lockedBatchCount: 2,
    },
    reason: "规则已被新版替代",
    clientRequestId: "archive-request-0001",
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
      archiveCustomRule: vi.fn().mockResolvedValue({
        version: { id: RULE_ID, projectId: PROJECT_ID, status: "archived" },
        simulation: { id: "55555555-5555-4555-8555-555555555555" },
        event: { id: "66666666-6666-4666-8666-666666666666" },
      }),
    },
  };
}

describe("settlement rule archive route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(assertBillingWriteAllowed).mockResolvedValue(undefined);
  });

  it.each(["owner", "ops_manager"])("archives for %s", async (role) => {
    const routeContext = context(role);
    vi.mocked(getCustomRuleRouteContext).mockResolvedValue(
      routeContext as never,
    );

    const response = await POST(request(), {
      params: Promise.resolve({ projectId: PROJECT_ID, ruleVersionId: RULE_ID }),
    });

    expect(response.status).toBe(200);
    expect(routeContext.lifecycle.archiveCustomRule).toHaveBeenCalledWith({
      actor: routeContext.actor,
      projectId: PROJECT_ID,
      ruleVersionId: RULE_ID,
      effectiveUntil: body().effectiveUntil,
      fallbackProof: expect.objectContaining({
        ruleVersionId: FALLBACK_RULE_ID,
        simulationId: body().fallbackProof.simulationId,
      }),
      reason: body().reason,
      clientRequestId: "archive-request-0001",
    });
  });

  it("rejects fallback proof that reuses the archived rule version before billing", async () => {
    const routeContext = context("owner");
    vi.mocked(getCustomRuleRouteContext).mockResolvedValue(
      routeContext as never,
    );

    const response = await POST(
      request(
        body({
          fallbackProof: {
            ...body().fallbackProof,
            ruleVersionId: RULE_ID,
          },
        }),
      ),
      { params: Promise.resolve({ projectId: PROJECT_ID, ruleVersionId: RULE_ID }) },
    );

    expect(response.status).toBe(422);
    expect(assertBillingWriteAllowed).not.toHaveBeenCalled();
    expect(routeContext.lifecycle.archiveCustomRule).not.toHaveBeenCalled();
  });

  it("maps current simulation fallback rejection to 422", async () => {
    const routeContext = context("owner");
    routeContext.lifecycle.archiveCustomRule.mockRejectedValue(
      new CustomRuleGovernanceError(
        "CUSTOM_RULE_ARCHIVE_FALLBACK_SIMULATION_REQUIRED",
        "Active rule archival requires a separate fresh fallback or remaining-layer simulation",
      ),
    );
    vi.mocked(getCustomRuleRouteContext).mockResolvedValue(
      routeContext as never,
    );

    const response = await POST(request(), {
      params: Promise.resolve({ projectId: PROJECT_ID, ruleVersionId: RULE_ID }),
    });

    expect(response.status).toBe(422);
  });

  it("maps deterministic archive readiness failures to 422", async () => {
    const routeContext = context("owner");
    routeContext.lifecycle.archiveCustomRule.mockRejectedValue(
      new CustomRuleGovernanceError(
        "CUSTOM_RULE_ARCHIVE_FALLBACK_REQUIRED",
        "Active rule archival requires a remaining custom layer or fixed fallback",
      ),
    );
    vi.mocked(getCustomRuleRouteContext).mockResolvedValue(
      routeContext as never,
    );

    const response = await POST(request(), {
      params: Promise.resolve({ projectId: PROJECT_ID, ruleVersionId: RULE_ID }),
    });

    expect(response.status).toBe(422);
  });

  it("maps database uniqueness conflicts to 409", async () => {
    const routeContext = context("owner");
    routeContext.lifecycle.archiveCustomRule.mockRejectedValue(
      new CustomRulePersistenceQueryError("archive_rule", {
        code: "23505",
        message: "duplicate key value violates unique constraint",
      }),
    );
    vi.mocked(getCustomRuleRouteContext).mockResolvedValue(
      routeContext as never,
    );

    const response = await POST(request(), {
      params: Promise.resolve({ projectId: PROJECT_ID, ruleVersionId: RULE_ID }),
    });

    expect(response.status).toBe(409);
  });

  it("rejects malformed effective date before billing", async () => {
    const routeContext = context("owner");
    vi.mocked(getCustomRuleRouteContext).mockResolvedValue(
      routeContext as never,
    );

    const response = await POST(request(body({ effectiveUntil: "tomorrow" })), {
      params: Promise.resolve({ projectId: PROJECT_ID, ruleVersionId: RULE_ID }),
    });

    expect(response.status).toBe(400);
    expect(assertBillingWriteAllowed).not.toHaveBeenCalled();
  });
});
