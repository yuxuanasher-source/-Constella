import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "./route";

import {
  CustomRuleRouteError,
  getCustomRuleRouteContext,
} from "@/features/settlements/custom-rule-route-context";

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
const AUTHOR_ID = "12121212-1212-4121-8121-121212121212";
const PROJECT_ID = "33333333-3333-4333-8333-333333333333";
const SESSION_ID = "44444444-4444-4444-8444-444444444444";
const DRAFT_ID = "55555555-5555-4555-8555-555555555555";

function latestDraft() {
  return {
    id: DRAFT_ID,
    organizationId: ORGANIZATION_ID,
    projectId: PROJECT_ID,
    conversationId: SESSION_ID,
    revisionNumber: 4,
    createdBy: AUTHOR_ID,
    status: "simulated",
    initialStatus: "contract_ready",
    businessContract: {
      schemaVersion: 1,
      scope: "payable",
      target: { targetType: "project", targetId: null },
      executionGrain: "report",
      compositionMode: "replace",
      title: "latest confirmed contract",
      summary: "pay by live duration",
      calculationComponents: [],
      requiredInputs: [],
      parameters: [],
      effectiveStartAt: "2026-07-01T00:00:00+08:00",
      effectiveEndAt: null,
      missingDataPolicy: { action: "route_item_to_review" },
      compositionDescription: "replace base rule",
      businessTimezone: "Asia/Shanghai",
      examples: [],
    },
    unresolvedAmbiguities: [],
    generatedFormula: { expression: "money_result({ final: yuan(1) })" },
    generatedExplanation: "deterministic explanation",
    generatedTestCases: [],
    safetyFlags: [],
    formulaHash: "a".repeat(64),
    contractHash: "b".repeat(64),
    parameterHash: "c".repeat(64),
    variableCatalogVersion: "d".repeat(64),
    createdAt: "2026-07-12T03:00:00.000Z",
    supersedesDraftId: null,
    supersededByDraftId: null,
    supersededAt: null,
  };
}

function latestQuery(row: Record<string, unknown> | null) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: row, error: null }),
  };
}

function context(role: string, row: Record<string, unknown> | null = {
  conversation_id: SESSION_ID,
  created_by: AUTHOR_ID,
}) {
  const query = latestQuery(row);
  return {
    query,
    supabase: { from: vi.fn().mockReturnValue(query) },
    auth: { userId: USER_ID, organizationId: ORGANIZATION_ID, role },
    actor: { userId: USER_ID, organizationId: ORGANIZATION_ID },
    requireProjectAccess: vi.fn().mockResolvedValue(undefined),
    conversation: {
      getHistory: vi.fn().mockResolvedValue({
        conversation: {
          id: SESSION_ID,
          title: "settlement rule session",
          status: "active",
          lastMessageAt: "2026-07-12T03:00:00.000Z",
          createdAt: "2026-07-12T02:00:00.000Z",
          updatedAt: "2026-07-12T03:00:00.000Z",
        },
        messages: [],
        turns: [],
      }),
    },
    repository: {
      listDrafts: vi.fn().mockResolvedValue([latestDraft()]),
      listSimulations: vi.fn().mockResolvedValue([]),
    },
  };
}

describe("settlement rule latest AI session route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each(["owner", "ops_manager", "operator_business", "finance"])(
    "restores the latest project session for %s",
    async (role) => {
      const routeContext = context(role);
      vi.mocked(getCustomRuleRouteContext).mockResolvedValue(
        routeContext as never,
      );

      const response = await GET(new Request("http://localhost"), {
        params: Promise.resolve({ projectId: PROJECT_ID }),
      });
      const payload = await response.json();

      expect(response.status).toBe(200);
      expect(routeContext.requireProjectAccess).toHaveBeenCalledWith(
        PROJECT_ID,
      );
      expect(routeContext.supabase.from).toHaveBeenCalledWith(
        "ai_settlement_rule_drafts",
      );
      expect(routeContext.query.eq).toHaveBeenCalledWith(
        "organization_id",
        ORGANIZATION_ID,
      );
      expect(routeContext.query.eq).toHaveBeenCalledWith(
        "project_id",
        PROJECT_ID,
      );
      expect(routeContext.repository.listDrafts).toHaveBeenCalledWith({
        organizationId: ORGANIZATION_ID,
        projectId: PROJECT_ID,
        conversationId: SESSION_ID,
        revisionOrder: "desc",
        limit: 1,
      });
      expect(routeContext.conversation.getHistory).toHaveBeenCalledWith(
        { organizationId: ORGANIZATION_ID, userId: AUTHOR_ID },
        SESSION_ID,
      );
      expect(payload).toMatchObject({
        session: {
          conversation: { id: SESSION_ID },
          draft: { id: DRAFT_ID, status: "simulated" },
        },
      });
    },
  );

  it("returns an empty session when the project has no settlement AI draft", async () => {
    const routeContext = context("finance", null);
    vi.mocked(getCustomRuleRouteContext).mockResolvedValue(
      routeContext as never,
    );

    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ projectId: PROJECT_ID }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ session: null });
    expect(routeContext.repository.listDrafts).not.toHaveBeenCalled();
  });

  it("checks project scope before looking up the latest draft", async () => {
    const routeContext = context("finance");
    routeContext.requireProjectAccess.mockRejectedValue(
      new CustomRuleRouteError({
        code: "CUSTOM_RULE_PROJECT_NOT_FOUND",
        message: "Project not found",
        status: 404,
        retryable: false,
      }),
    );
    vi.mocked(getCustomRuleRouteContext).mockResolvedValue(
      routeContext as never,
    );

    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ projectId: PROJECT_ID }),
    });

    expect(response.status).toBe(404);
    expect(routeContext.supabase.from).not.toHaveBeenCalled();
  });
});
