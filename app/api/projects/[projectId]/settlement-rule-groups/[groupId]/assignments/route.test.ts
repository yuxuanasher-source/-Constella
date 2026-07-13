import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

import { assertBillingWriteAllowed } from "@/features/billing/route-guard";
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
const GROUP_ID = "44444444-4444-4444-8444-444444444444";
const PROJECT_STREAMER_ID = "55555555-5555-4555-8555-555555555555";

function body(overrides: Record<string, unknown> = {}) {
  return {
    projectStreamerId: PROJECT_STREAMER_ID,
    effectiveFrom: "2026-07-12T00:00:00.000Z",
    effectiveUntil: null,
    reason: "调整主播结算分组",
    clientRequestId: "assign-group-0001",
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
    groups: {
      changeSettlementGroupAssignment: vi.fn().mockResolvedValue({
        insertedAssignment: {
          id: "66666666-6666-4666-8666-666666666666",
          projectStreamerId: PROJECT_STREAMER_ID,
          groupId: GROUP_ID,
          effectiveFrom: "2026-07-12T00:00:00.000Z",
          effectiveUntil: null,
        },
        closedAssignmentIds: [],
        newGroupSnapshotHash: "a".repeat(64),
      }),
    },
  };
}

describe("settlement rule group assignments route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(assertBillingWriteAllowed).mockResolvedValue(undefined);
  });

  it.each(["owner", "ops_manager"])("changes assignments for %s", async (role) => {
    const routeContext = context(role);
    vi.mocked(getCustomRuleRouteContext).mockResolvedValue(
      routeContext as never,
    );

    const response = await POST(request(), {
      params: Promise.resolve({ projectId: PROJECT_ID, groupId: GROUP_ID }),
    });

    expect(response.status).toBe(200);
    expect(routeContext.groups.changeSettlementGroupAssignment).toHaveBeenCalledWith({
      actor: routeContext.actor,
      projectId: PROJECT_ID,
      projectStreamerId: PROJECT_STREAMER_ID,
      groupId: GROUP_ID,
      effectiveFrom: "2026-07-12T00:00:00.000Z",
      effectiveUntil: null,
      reason: "调整主播结算分组",
      clientRequestId: "assign-group-0001",
    });
  });

  it("maps database target conflicts to 409", async () => {
    const routeContext = context("owner");
    routeContext.groups.changeSettlementGroupAssignment.mockRejectedValue(
      new CustomRulePersistenceQueryError("change_settlement_group_assignment", {
        code: "23505",
        message: "overlapping assignment",
      }),
    );
    vi.mocked(getCustomRuleRouteContext).mockResolvedValue(
      routeContext as never,
    );

    const response = await POST(request(), {
      params: Promise.resolve({ projectId: PROJECT_ID, groupId: GROUP_ID }),
    });

    expect(response.status).toBe(409);
  });

  it("rejects malformed dates and reasons before billing", async () => {
    const routeContext = context("owner");
    vi.mocked(getCustomRuleRouteContext).mockResolvedValue(
      routeContext as never,
    );

    const response = await POST(
      request(body({ effectiveFrom: "soon", reason: "" })),
      { params: Promise.resolve({ projectId: PROJECT_ID, groupId: GROUP_ID }) },
    );

    expect(response.status).toBe(400);
    expect(assertBillingWriteAllowed).not.toHaveBeenCalled();
  });
});
