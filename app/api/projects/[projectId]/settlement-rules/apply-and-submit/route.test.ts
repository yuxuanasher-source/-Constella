import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

import { assertBillingWriteAllowed } from "@/features/billing/route-guard";
import {
  CustomRuleRouteError,
  getCustomRuleRouteContext,
} from "@/features/settlements/custom-rule-route-context";
import { CustomRuleGovernanceError } from "@/features/settlements/custom-rule-governance";
import { CustomRulePersistenceQueryError } from "@/features/settlements/custom-rule-repository";

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

function result() {
  return {
    version: {
      id: "44444444-4444-4444-8444-444444444444",
      projectId: PROJECT_ID,
      status: "pending_review",
      scope: "payable",
      target: { targetType: "project", targetId: null },
      executionGrain: "report",
      compositionMode: "replace",
      versionNumber: 1,
      priority: 100,
      formula: "secret formula",
      compiledAst: { secret: true },
      formulaHash: "a".repeat(64),
      contractHash: "b".repeat(64),
      parameterHash: "c".repeat(64),
      catalogHash: "d".repeat(64),
      dataSelectionHash: "e".repeat(64),
      simulationId: "55555555-5555-4555-8555-555555555555",
      effectiveFrom: "2026-07-12T00:00:00.000Z",
      effectiveUntil: null,
      createdAt: "2026-07-12T00:00:00.000Z",
      approvedAt: null,
      archivedAt: null,
      createdBy: USER_ID,
      approvedBy: null,
      reason: "提交审核",
    },
    simulation: {
      id: "55555555-5555-4555-8555-555555555555",
      createdAt: "2026-07-12T00:00:00.000Z",
    },
    event: { id: "66666666-6666-4666-8666-666666666666" },
  };
}

function body(overrides: Record<string, unknown> = {}) {
  return {
    source: {
      kind: "ai_draft",
      id: "77777777-7777-4777-8777-777777777777",
    },
    sourceSimulationId: "88888888-8888-4888-8888-888888888888",
    destinationVersionId: "44444444-4444-4444-8444-444444444444",
    destinationSimulationId: "55555555-5555-4555-8555-555555555555",
    scope: "payable",
    target: { targetType: "project", targetId: null },
    effectiveFrom: "2026-07-12T00:00:00.000Z",
    reason: "提交审核",
    clientRequestId: "submit-request-0001",
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
      applyAndSubmitCustomRule: vi.fn().mockResolvedValue(result()),
    },
  };
}

describe("settlement rule apply-and-submit route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(assertBillingWriteAllowed).mockResolvedValue(undefined);
  });

  it.each(["owner", "ops_manager", "operator_business"])(
    "submits a simulated rule for %s",
    async (role) => {
      const routeContext = context(role);
      vi.mocked(getCustomRuleRouteContext).mockResolvedValue(
        routeContext as never,
      );

      const response = await POST(request(), {
        params: Promise.resolve({ projectId: PROJECT_ID }),
      });

      expect(response.status).toBe(201);
      expect(assertBillingWriteAllowed).toHaveBeenCalledWith({
        client: routeContext.supabase,
        organizationId: ORGANIZATION_ID,
        featureKey: "settlement",
      });
      expect(routeContext.lifecycle.applyAndSubmitCustomRule).toHaveBeenCalledWith(
        expect.objectContaining({
          actor: routeContext.actor,
          projectId: PROJECT_ID,
          source: body().source,
          reason: "提交审核",
        }),
      );
    },
  );

  it("maps a finance role denial to 403", async () => {
    const routeContext = context("finance");
    routeContext.lifecycle.applyAndSubmitCustomRule.mockRejectedValue(
      new CustomRuleGovernanceError(
        "CUSTOM_RULE_ACTION_NOT_ALLOWED",
        "Server role finance cannot perform submit_review",
      ),
    );
    vi.mocked(getCustomRuleRouteContext).mockResolvedValue(
      routeContext as never,
    );

    const response = await POST(request(), {
      params: Promise.resolve({ projectId: PROJECT_ID }),
    });

    expect(response.status).toBe(403);
  });

  it("blocks billing read-only mode before applying", async () => {
    const routeContext = context("owner");
    vi.mocked(assertBillingWriteAllowed).mockRejectedValue(
      new Error("Organization is read-only because billing is past due"),
    );
    vi.mocked(getCustomRuleRouteContext).mockResolvedValue(
      routeContext as never,
    );

    const response = await POST(request(), {
      params: Promise.resolve({ projectId: PROJECT_ID }),
    });

    expect(response.status).toBe(403);
    expect(routeContext.lifecycle.applyAndSubmitCustomRule).not.toHaveBeenCalled();
  });

  it("maps stale simulation to 409", async () => {
    const routeContext = context("owner");
    routeContext.lifecycle.applyAndSubmitCustomRule.mockRejectedValue(
      new CustomRuleGovernanceError(
        "SIMULATION_STALE",
        "formula_hash changed; run a new simulation before submitting or approving",
      ),
    );
    vi.mocked(getCustomRuleRouteContext).mockResolvedValue(
      routeContext as never,
    );

    const response = await POST(request(), {
      params: Promise.resolve({ projectId: PROJECT_ID }),
    });

    expect(response.status).toBe(409);
  });

  it("rejects non-project targets for non-payable scopes before billing", async () => {
    const routeContext = context("owner");
    vi.mocked(getCustomRuleRouteContext).mockResolvedValue(
      routeContext as never,
    );

    const response = await POST(
      request(
        body({
          scope: "receivable",
          target: {
            targetType: "streamer_group",
            targetId: "99999999-9999-4999-8999-999999999999",
          },
        }),
      ),
      { params: Promise.resolve({ projectId: PROJECT_ID }) },
    );

    expect(response.status).toBe(422);
    expect(assertBillingWriteAllowed).not.toHaveBeenCalled();
    expect(routeContext.lifecycle.applyAndSubmitCustomRule).not.toHaveBeenCalled();
  });

  it("maps deterministic database target validation failures to 422", async () => {
    const routeContext = context("owner");
    routeContext.lifecycle.applyAndSubmitCustomRule.mockRejectedValue(
      new CustomRulePersistenceQueryError("apply_and_submit_rule", {
        message: "custom_settlement_rule_target_invalid",
      }),
    );
    vi.mocked(getCustomRuleRouteContext).mockResolvedValue(
      routeContext as never,
    );

    const response = await POST(request(), {
      params: Promise.resolve({ projectId: PROJECT_ID }),
    });

    expect(response.status).toBe(422);
  });

  it("maps deterministic project streamer target scope mismatches to 422", async () => {
    const routeContext = context("owner");
    routeContext.lifecycle.applyAndSubmitCustomRule.mockRejectedValue(
      new CustomRulePersistenceQueryError("apply_and_submit_rule", {
        message: "custom_settlement_rule_project_streamer_scope_mismatch",
      }),
    );
    vi.mocked(getCustomRuleRouteContext).mockResolvedValue(
      routeContext as never,
    );

    const response = await POST(request(), {
      params: Promise.resolve({ projectId: PROJECT_ID }),
    });

    expect(response.status).toBe(422);
  });

  it("maps project access denial to 403 before billing", async () => {
    const routeContext = context("owner");
    routeContext.requireProjectAccess.mockRejectedValue(
      new CustomRuleRouteError({
        code: "CUSTOM_RULE_PROJECT_ACCESS_DENIED",
        message: "Project access denied",
        status: 403,
        retryable: false,
      }),
    );
    vi.mocked(getCustomRuleRouteContext).mockResolvedValue(
      routeContext as never,
    );

    const response = await POST(request(), {
      params: Promise.resolve({ projectId: PROJECT_ID }),
    });

    expect(response.status).toBe(403);
    expect(assertBillingWriteAllowed).not.toHaveBeenCalled();
    expect(routeContext.lifecycle.applyAndSubmitCustomRule).not.toHaveBeenCalled();
  });

  it("rejects malformed reason and target commands before billing", async () => {
    const routeContext = context("owner");
    vi.mocked(getCustomRuleRouteContext).mockResolvedValue(
      routeContext as never,
    );

    const response = await POST(
      request(
        body({
          reason: "",
          target: { targetType: "streamer_group", targetId: null },
        }),
      ),
      { params: Promise.resolve({ projectId: PROJECT_ID }) },
    );

    expect(response.status).toBe(400);
    expect(assertBillingWriteAllowed).not.toHaveBeenCalled();
  });
});
