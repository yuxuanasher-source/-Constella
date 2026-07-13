import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET, POST } from "./route";

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
const GROUP_ID = "44444444-4444-4444-8444-444444444444";

function group(overrides: Record<string, unknown> = {}) {
  return {
    id: GROUP_ID,
    organizationId: ORGANIZATION_ID,
    projectId: PROJECT_ID,
    name: "优先主播",
    description: "优先结算分组",
    status: "active",
    createdBy: USER_ID,
    createdAt: "2026-07-12T00:00:00.000Z",
    archivedAt: null,
    assignmentCount: 2,
    activeRuleCount: 1,
    pendingRuleCount: 0,
    futureAssignmentCount: 0,
    unassignedProjectStreamers: [
      { projectStreamerId: "55555555-5555-4555-8555-555555555555" },
    ],
    baseRuleCoveredProjectStreamerIds: [
      "66666666-6666-4666-8666-666666666666",
    ],
    ...overrides,
  };
}

function context(role: string) {
  return {
    supabase: { client: "supabase" },
    auth: { userId: USER_ID, organizationId: ORGANIZATION_ID, role },
    actor: { userId: USER_ID, organizationId: ORGANIZATION_ID },
    requireProjectAccess: vi.fn().mockResolvedValue(undefined),
    groups: {
      listSettlementRuleGroups: vi.fn().mockResolvedValue([group()]),
      createSettlementRuleGroup: vi.fn().mockResolvedValue(group()),
    },
  };
}

function getRequest(search = "") {
  return new Request(
    `http://localhost/api/projects/${PROJECT_ID}/settlement-rule-groups${search}`,
  );
}

function postRequest(value: unknown) {
  return new Request("http://localhost", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(value),
  });
}

describe("settlement rule groups route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(assertBillingWriteAllowed).mockResolvedValue(undefined);
  });

  it.each(["owner", "ops_manager", "operator_business", "finance"])(
    "lists groups for %s without billing write gate",
    async (role) => {
      const routeContext = context(role);
      vi.mocked(getCustomRuleRouteContext).mockResolvedValue(
        routeContext as never,
      );

      const response = await GET(getRequest("?includeArchived=true"), {
        params: Promise.resolve({ projectId: PROJECT_ID }),
      });

      expect(response.status).toBe(200);
      expect(assertBillingWriteAllowed).not.toHaveBeenCalled();
      expect(routeContext.groups.listSettlementRuleGroups).toHaveBeenCalledWith({
        actor: routeContext.actor,
        projectId: PROJECT_ID,
        includeArchived: true,
      });
    },
  );

  it.each(["owner", "ops_manager"])("creates groups for %s", async (role) => {
    const routeContext = context(role);
    vi.mocked(getCustomRuleRouteContext).mockResolvedValue(
      routeContext as never,
    );

    const response = await POST(
      postRequest({
        name: "优先主播",
        description: "优先结算分组",
        reason: "按供应商结算策略分组",
        clientRequestId: "create-group-0001",
      }),
      { params: Promise.resolve({ projectId: PROJECT_ID }) },
    );

    expect(response.status).toBe(201);
    expect(assertBillingWriteAllowed).toHaveBeenCalled();
    expect(routeContext.groups.createSettlementRuleGroup).toHaveBeenCalled();
  });

  it("maps group role denial to 403", async () => {
    const routeContext = context("finance");
    routeContext.groups.createSettlementRuleGroup.mockRejectedValue(
      new CustomRuleGovernanceError(
        "CUSTOM_RULE_ACTION_NOT_ALLOWED",
        "Server role finance cannot perform manage_groups",
      ),
    );
    vi.mocked(getCustomRuleRouteContext).mockResolvedValue(
      routeContext as never,
    );

    const response = await POST(
      postRequest({
        name: "财务只读",
        reason: "尝试创建",
        clientRequestId: "create-group-0002",
      }),
      { params: Promise.resolve({ projectId: PROJECT_ID }) },
    );

    expect(response.status).toBe(403);
  });

  it("rejects malformed group names before billing", async () => {
    const routeContext = context("owner");
    vi.mocked(getCustomRuleRouteContext).mockResolvedValue(
      routeContext as never,
    );

    const response = await POST(
      postRequest({ name: "", reason: "", clientRequestId: "short" }),
      { params: Promise.resolve({ projectId: PROJECT_ID }) },
    );

    expect(response.status).toBe(400);
    expect(assertBillingWriteAllowed).not.toHaveBeenCalled();
  });
});
