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
const GROUP_ID = "44444444-4444-4444-8444-444444444444";

function request(value: unknown = body()) {
  return new Request("http://localhost", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(value),
  });
}

function body(overrides: Record<string, unknown> = {}) {
  return {
    archivedAt: "2026-07-31T00:00:00.000Z",
    reason: "分组不再使用",
    clientRequestId: "archive-group-0001",
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
      archiveSettlementRuleGroup: vi.fn().mockResolvedValue({
        id: GROUP_ID,
        projectId: PROJECT_ID,
        name: "旧分组",
        status: "archived",
      }),
    },
  };
}

describe("settlement rule group archive route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(assertBillingWriteAllowed).mockResolvedValue(undefined);
  });

  it.each(["owner", "ops_manager"])("archives groups for %s", async (role) => {
    const routeContext = context(role);
    vi.mocked(getCustomRuleRouteContext).mockResolvedValue(
      routeContext as never,
    );

    const response = await POST(request(), {
      params: Promise.resolve({ projectId: PROJECT_ID, groupId: GROUP_ID }),
    });

    expect(response.status).toBe(200);
    expect(routeContext.groups.archiveSettlementRuleGroup).toHaveBeenCalledWith({
      actor: routeContext.actor,
      projectId: PROJECT_ID,
      groupId: GROUP_ID,
      archivedAt: body().archivedAt,
      reason: body().reason,
      clientRequestId: "archive-group-0001",
    });
  });

  it("maps active-rule archive blockers to 422", async () => {
    const routeContext = context("owner");
    routeContext.groups.archiveSettlementRuleGroup.mockRejectedValue(
      new CustomRuleGovernanceError(
        "SETTLEMENT_GROUP_ARCHIVE_BLOCKED",
        "Settlement group archive requires no active or pending group rules and no future assignments",
      ),
    );
    vi.mocked(getCustomRuleRouteContext).mockResolvedValue(
      routeContext as never,
    );

    const response = await POST(request(), {
      params: Promise.resolve({ projectId: PROJECT_ID, groupId: GROUP_ID }),
    });

    expect(response.status).toBe(422);
  });

  it("blocks billing read-only mode before archive", async () => {
    const routeContext = context("owner");
    vi.mocked(assertBillingWriteAllowed).mockRejectedValue(
      new Error("Organization is read-only because billing is past due"),
    );
    vi.mocked(getCustomRuleRouteContext).mockResolvedValue(
      routeContext as never,
    );

    const response = await POST(request(), {
      params: Promise.resolve({ projectId: PROJECT_ID, groupId: GROUP_ID }),
    });

    expect(response.status).toBe(403);
    expect(routeContext.groups.archiveSettlementRuleGroup).not.toHaveBeenCalled();
  });
});
