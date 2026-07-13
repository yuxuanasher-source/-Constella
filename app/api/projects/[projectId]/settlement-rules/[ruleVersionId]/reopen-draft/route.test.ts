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

function body(overrides: Record<string, unknown> = {}) {
  return {
    reason: "review changes",
    clientRequestId: "reopen-draft-0001",
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
      reopenRequestedChangesAsDraft: vi.fn().mockResolvedValue({
        version: {
          id: RULE_ID,
          projectId: PROJECT_ID,
          scope: "payable",
          target: { targetType: "project", targetId: null },
          executionGrain: "report",
          compositionMode: "replace",
          priority: 100,
          versionNumber: 2,
          status: "draft",
          formulaHash: "a".repeat(64),
          contractHash: "b".repeat(64),
          parameterHash: "c".repeat(64),
          catalogHash: "d".repeat(64),
          dataSelectionHash: "e".repeat(64),
          simulationId: "55555555-5555-4555-8555-555555555555",
          effectiveFrom: null,
          effectiveUntil: null,
          createdBy: USER_ID,
          approvedBy: null,
          aiDraftId: null,
          reason: "review changes",
          createdAt: "2026-07-12T00:00:00.000Z",
          approvedAt: null,
          archivedAt: null,
        },
        simulation: {
          id: "55555555-5555-4555-8555-555555555555",
          createdAt: "2026-07-12T00:00:00.000Z",
        },
        event: null,
      }),
    },
  };
}

describe("settlement rule reopen-draft route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(assertBillingWriteAllowed).mockResolvedValue(undefined);
  });

  it("reopens requested changes as an editable draft through the lifecycle service", async () => {
    const routeContext = context("operator_business");
    vi.mocked(getCustomRuleRouteContext).mockResolvedValue(
      routeContext as never,
    );

    const response = await POST(request(), {
      params: Promise.resolve({ projectId: PROJECT_ID, ruleVersionId: RULE_ID }),
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(routeContext.requireProjectAccess).toHaveBeenCalledWith(PROJECT_ID);
    expect(assertBillingWriteAllowed).toHaveBeenCalledWith({
      client: routeContext.supabase,
      organizationId: ORGANIZATION_ID,
      featureKey: "settlement",
    });
    expect(
      routeContext.lifecycle.reopenRequestedChangesAsDraft,
    ).toHaveBeenCalledWith({
      actor: routeContext.actor,
      projectId: PROJECT_ID,
      ruleVersionId: RULE_ID,
      reason: "review changes",
      clientRequestId: "reopen-draft-0001",
    });
    expect(payload).toMatchObject({ rule: { status: "draft" }, event: null });
  });

  it("rejects malformed reopen commands before billing", async () => {
    const routeContext = context("operator_business");
    vi.mocked(getCustomRuleRouteContext).mockResolvedValue(
      routeContext as never,
    );

    const response = await POST(request(body({ reason: "" })), {
      params: Promise.resolve({ projectId: PROJECT_ID, ruleVersionId: RULE_ID }),
    });

    expect(response.status).toBe(400);
    expect(assertBillingWriteAllowed).not.toHaveBeenCalled();
    expect(
      routeContext.lifecycle.reopenRequestedChangesAsDraft,
    ).not.toHaveBeenCalled();
  });

  it("maps invalid reopen transitions to 409", async () => {
    const routeContext = context("operator_business");
    routeContext.lifecycle.reopenRequestedChangesAsDraft.mockRejectedValue(
      new CustomRuleGovernanceError(
        "CUSTOM_RULE_TRANSITION_NOT_ALLOWED",
        "only changes_requested versions can reopen",
      ),
    );
    vi.mocked(getCustomRuleRouteContext).mockResolvedValue(
      routeContext as never,
    );

    const response = await POST(request(), {
      params: Promise.resolve({ projectId: PROJECT_ID, ruleVersionId: RULE_ID }),
    });

    expect(response.status).toBe(409);
  });

  it("blocks billing read-only mode before reopening", async () => {
    const routeContext = context("operator_business");
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
    expect(
      routeContext.lifecycle.reopenRequestedChangesAsDraft,
    ).not.toHaveBeenCalled();
  });
});
