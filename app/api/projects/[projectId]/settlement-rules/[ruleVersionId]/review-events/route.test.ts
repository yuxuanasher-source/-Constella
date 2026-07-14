import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "./route";

import { getCustomRuleRouteContext } from "@/features/settlements/custom-rule-route-context";

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

function context(role: string) {
  return {
    supabase: { client: "supabase" },
    auth: { userId: USER_ID, organizationId: ORGANIZATION_ID, role },
    actor: { userId: USER_ID, organizationId: ORGANIZATION_ID },
    requireProjectAccess: vi.fn().mockResolvedValue(undefined),
    repository: {
      listCustomRuleReviewEvents: vi.fn().mockResolvedValue([
        {
          id: "55555555-5555-4555-8555-555555555555",
          organizationId: ORGANIZATION_ID,
          projectId: PROJECT_ID,
          ruleVersionId: RULE_ID,
          eventType: "submitted_for_review",
          actorId: USER_ID,
          actorRole: "operator_business",
          reason: "submit for review",
          comment: null,
          beforeStatus: "draft",
          afterStatus: "pending_review",
          createdAt: "2026-07-12T00:00:00.000Z",
          privateAuditPayload: { rawFormula: "must-not-leak" },
        },
      ]),
    },
  };
}

describe("settlement rule review-events route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each(["owner", "ops_manager", "operator_business", "finance"])(
    "lets %s load scoped review events",
    async (role) => {
      const routeContext = context(role);
      vi.mocked(getCustomRuleRouteContext).mockResolvedValue(
        routeContext as never,
      );

      const response = await GET(new Request("http://localhost"), {
        params: Promise.resolve({ projectId: PROJECT_ID, ruleVersionId: RULE_ID }),
      });
      const payload = await response.json();
      const serialized = JSON.stringify(payload);

      expect(response.status).toBe(200);
      expect(routeContext.requireProjectAccess).toHaveBeenCalledWith(
        PROJECT_ID,
      );
      expect(
        routeContext.repository.listCustomRuleReviewEvents,
      ).toHaveBeenCalledWith({
        organizationId: ORGANIZATION_ID,
        projectId: PROJECT_ID,
        ruleVersionId: RULE_ID,
      });
      expect(payload).toEqual({
        events: [
          {
            id: "55555555-5555-4555-8555-555555555555",
            eventType: "submitted_for_review",
            actorId: USER_ID,
            actorRole: "operator_business",
            reason: "submit for review",
            comment: null,
            beforeStatus: "draft",
            afterStatus: "pending_review",
            createdAt: "2026-07-12T00:00:00.000Z",
          },
        ],
      });
      expect(serialized).not.toContain("must-not-leak");
    },
  );

  it("validates rule params before loading events", async () => {
    const routeContext = context("finance");
    vi.mocked(getCustomRuleRouteContext).mockResolvedValue(
      routeContext as never,
    );

    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ projectId: PROJECT_ID, ruleVersionId: "bad" }),
    });

    expect(response.status).toBe(400);
    expect(
      routeContext.repository.listCustomRuleReviewEvents,
    ).not.toHaveBeenCalled();
  });
});
