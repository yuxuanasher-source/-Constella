import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

import { assertBillingWriteAllowed } from "@/features/billing/route-guard";
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
const SESSION_ID = "44444444-4444-4444-8444-444444444444";
const DRAFT_ID = "55555555-5555-4555-8555-555555555555";

function seedContract() {
  return {
    schemaVersion: 1,
    scope: "payable",
    target: { targetType: "project", targetId: null },
    executionGrain: "report",
    compositionMode: "replace",
    title: "项目主播按场计费",
    summary: "每场直播按系统时长计算主播应付金额。",
    calculationComponents: [
      {
        name: "final",
        description: "计算最终应付金额",
        expression: "按确认业务规则计算最终金额",
        resultType: { kind: "scalar", scalarType: "money_cents" },
      },
    ],
    requiredInputs: [
      {
        name: "system_minutes",
        description: "系统直播时长",
        source: "直播报告系统计时",
        valueType: { kind: "scalar", scalarType: "integer" },
        userFacingUnit: "分钟",
      },
    ],
    parameters: [
      {
        name: "hourly_rate",
        description: "每小时结算单价",
        valueType: { kind: "scalar", scalarType: "money_cents" },
        userFacingUnit: "元/小时",
        defaultValue: { type: "money_cents", amountCents: 10_000 },
      },
    ],
    effectiveStartAt: "2026-07-12T00:00:00+08:00",
    effectiveEndAt: null,
    missingDataPolicy: { action: "route_item_to_review" },
    compositionDescription: "替换项目现有的主播应付基础规则。",
    businessTimezone: "Asia/Shanghai",
    examples: [
      {
        name: "标准一小时",
        kind: "normal",
        description: "直播六十分钟按一小时结算。",
        inputs: { system_minutes: { type: "integer", value: 60 } },
        expectedResult: { type: "money_cents", amountCents: 10_000 },
      },
      {
        name: "零时长",
        kind: "boundary",
        description: "直播时长为零时金额为零。",
        inputs: { system_minutes: { type: "integer", value: 0 } },
        expectedResult: { type: "money_cents", amountCents: 0 },
      },
      {
        name: "最小分钟",
        kind: "boundary",
        description: "直播一分钟按最小粒度结算。",
        inputs: { system_minutes: { type: "integer", value: 1 } },
        expectedResult: { type: "money_cents", amountCents: 167 },
      },
    ],
  };
}

function authoringResult() {
  return {
    ok: true,
    kind: "clarifying",
    conversationId: SESSION_ID,
    draft: {
      id: DRAFT_ID,
      conversationId: SESSION_ID,
      revisionNumber: 1,
      status: "clarifying",
      initialStatus: "clarifying",
      businessContract: seedContract(),
      unresolvedAmbiguities: [
        {
          code: "rate_source",
          question: "按哪个单价计算？",
          required: true,
        },
      ],
      generatedFormula: null,
      generatedExplanation: null,
      generatedTestCases: [],
      safetyFlags: [],
      formulaHash: null,
      contractHash: "a".repeat(64),
      parameterHash: "b".repeat(64),
      variableCatalogVersion: "c".repeat(64),
      createdAt: "2026-07-12T01:00:00.000Z",
      promptText: "raw customer prompt with sensitive value",
      aiResponse: { content: "raw provider body" },
      model: "provider-secret-model",
    },
    diff: [],
    duplicate: false,
  };
}

function context(role: string) {
  return {
    supabase: { client: "supabase" },
    auth: {
      userId: USER_ID,
      organizationId: ORGANIZATION_ID,
      role,
      name: "Operator",
    },
    actor: { userId: USER_ID, organizationId: ORGANIZATION_ID },
    requireProjectAccess: vi.fn().mockResolvedValue(undefined),
    conversation: {
      createConversation: vi.fn().mockResolvedValue({
        id: SESSION_ID,
        title: "主播按场结算",
        status: "active",
        lastMessageAt: "2026-07-12T01:00:00.000Z",
        createdAt: "2026-07-12T01:00:00.000Z",
        updatedAt: "2026-07-12T01:00:00.000Z",
      }),
    },
    authoring: {
      startSession: vi.fn().mockResolvedValue(authoringResult()),
    },
    audit: vi.fn().mockResolvedValue(undefined),
  };
}

function body() {
  return {
    title: "主播按场结算",
    clientRequestId: "start-request-0001",
    promptText: "每场按系统直播时长和小时单价结算",
    seedContract: seedContract(),
    initialAmbiguities: [
      {
        code: "rate_source",
        question: "按哪个单价计算？",
        required: true,
      },
    ],
  };
}

function request(value: unknown = body()) {
  return new Request("http://localhost", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof value === "string" ? value : JSON.stringify(value),
  });
}

describe("settlement rule AI session start route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(assertBillingWriteAllowed).mockResolvedValue(undefined);
  });

  it.each(["owner", "ops_manager", "operator_business"])(
    "allows %s to start a settlement authoring session",
    async (role) => {
      const routeContext = context(role);
      vi.mocked(getCustomRuleRouteContext).mockResolvedValue(
        routeContext as never,
      );

      const response = await POST(request(), {
        params: Promise.resolve({ projectId: PROJECT_ID }),
      });

      expect(response.status).toBe(201);
      expect(routeContext.requireProjectAccess).toHaveBeenCalledWith(
        PROJECT_ID,
      );
      expect(assertBillingWriteAllowed).toHaveBeenCalledWith({
        client: routeContext.supabase,
        organizationId: ORGANIZATION_ID,
        featureKey: "settlement",
      });
      expect(routeContext.conversation.createConversation).toHaveBeenCalledWith(
        routeContext.actor,
        "主播按场结算",
      );
      expect(routeContext.authoring.startSession).toHaveBeenCalledWith({
        actor: routeContext.actor,
        projectId: PROJECT_ID,
        conversationId: SESSION_ID,
        title: "主播按场结算",
        clientRequestId: "start-request-0001",
        promptText: "每场按系统直播时长和小时单价结算",
        seedContract: body().seedContract,
        initialAmbiguities: body().initialAmbiguities,
      });
    },
  );

  it("prevents finance from creating an authoring session", async () => {
    const routeContext = context("finance");
    vi.mocked(getCustomRuleRouteContext).mockResolvedValue(
      routeContext as never,
    );

    const response = await POST(request(), {
      params: Promise.resolve({ projectId: PROJECT_ID }),
    });

    expect(response.status).toBe(403);
    expect(assertBillingWriteAllowed).not.toHaveBeenCalled();
    expect(routeContext.conversation.createConversation).not.toHaveBeenCalled();
    expect(routeContext.authoring.startSession).not.toHaveBeenCalled();
  });

  it("stops before conversation or authoring when billing rejects the write", async () => {
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
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "BILLING_WRITE_BLOCKED", retryable: false },
    });
    expect(routeContext.conversation.createConversation).not.toHaveBeenCalled();
    expect(routeContext.authoring.startSession).not.toHaveBeenCalled();
  });

  it("returns a safe draft DTO without raw prompts or provider metadata", async () => {
    vi.mocked(getCustomRuleRouteContext).mockResolvedValue(
      context("owner") as never,
    );

    const response = await POST(request(), {
      params: Promise.resolve({ projectId: PROJECT_ID }),
    });
    const payload = await response.json();
    const serialized = JSON.stringify(payload);

    expect(payload).toMatchObject({
      session: { id: SESSION_ID },
      result: {
        ok: true,
        kind: "clarifying",
        draft: { id: DRAFT_ID, revisionNumber: 1, status: "clarifying" },
      },
    });
    expect(serialized).not.toContain("raw customer prompt");
    expect(serialized).not.toContain("raw provider body");
    expect(serialized).not.toContain("provider-secret-model");
  });

  it("rejects malformed JSON before project, billing, or conversation writes", async () => {
    const routeContext = context("owner");
    vi.mocked(getCustomRuleRouteContext).mockResolvedValue(
      routeContext as never,
    );

    const response = await POST(request("{"), {
      params: Promise.resolve({ projectId: PROJECT_ID }),
    });

    expect(response.status).toBe(400);
    expect(routeContext.requireProjectAccess).not.toHaveBeenCalled();
    expect(assertBillingWriteAllowed).not.toHaveBeenCalled();
    expect(routeContext.conversation.createConversation).not.toHaveBeenCalled();
  });

  it("stops before creating a conversation for a cross-organization project", async () => {
    const routeContext = context("owner");
    const { CustomRuleRouteError } =
      await import("@/features/settlements/custom-rule-route-context");
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

    const response = await POST(request(), {
      params: Promise.resolve({ projectId: PROJECT_ID }),
    });

    expect(response.status).toBe(404);
    expect(assertBillingWriteAllowed).not.toHaveBeenCalled();
    expect(routeContext.conversation.createConversation).not.toHaveBeenCalled();
  });

  it("sanitizes unexpected provider failures", async () => {
    const routeContext = context("owner");
    routeContext.authoring.startSession.mockRejectedValue(
      new Error("sk-provider-secret raw prompt stack trace"),
    );
    vi.mocked(getCustomRuleRouteContext).mockResolvedValue(
      routeContext as never,
    );

    const response = await POST(request(), {
      params: Promise.resolve({ projectId: PROJECT_ID }),
    });
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload).toEqual({
      error: {
        code: "CUSTOM_RULE_INTERNAL_ERROR",
        message: "Unable to process settlement rule request",
        retryable: true,
      },
    });
    expect(JSON.stringify(payload)).not.toContain("sk-provider-secret");
  });

  it("maps a resolved provider failure to a safe non-2xx envelope", async () => {
    const routeContext = context("owner");
    routeContext.authoring.startSession.mockResolvedValue({
      ok: false,
      code: "SETTLEMENT_AI_PROVIDER_FAILED",
      retryable: true,
      conversationId: SESSION_ID,
      sourceTurnId: "77777777-7777-4777-8777-777777777777",
      turnTrace: {
        turnId: "77777777-7777-4777-8777-777777777777",
        userMessageId: "88888888-8888-4888-8888-888888888888",
        assistantMessageId: "99999999-9999-4999-8999-999999999999",
      },
      failedDraft: {
        ...authoringResult().draft,
        promptText: "raw prompt secret amount 88888",
        model: "provider-private-stack",
      },
    });
    vi.mocked(getCustomRuleRouteContext).mockResolvedValue(
      routeContext as never,
    );

    const response = await POST(request(), {
      params: Promise.resolve({ projectId: PROJECT_ID }),
    });
    const payload = await response.json();

    expect(response.status).toBe(503);
    expect(payload).toEqual({
      error: {
        code: "CUSTOM_RULE_AI_UNAVAILABLE",
        message: "Settlement rule AI is unavailable",
        retryable: true,
      },
    });
    expect(JSON.stringify(payload)).not.toContain("88888");
    expect(JSON.stringify(payload)).not.toContain("provider-private-stack");
    expect(routeContext.audit).not.toHaveBeenCalled();
  });
});
