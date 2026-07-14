import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

import { assertBillingWriteAllowed } from "@/features/billing/route-guard";
import { getCustomRuleRouteContext } from "@/features/settlements/custom-rule-route-context";
import { CustomRuleAuthoringServiceError } from "@/features/settlements/custom-rule-service";

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

function result() {
  return {
    ok: true,
    kind: "clarifying",
    conversationId: SESSION_ID,
    draft: {
      id: "66666666-6666-4666-8666-666666666666",
      conversationId: SESSION_ID,
      revisionNumber: 3,
      status: "clarifying",
      initialStatus: "clarifying",
      businessContract: { title: "修订后的合同" },
      unresolvedAmbiguities: [
        { code: "confirm_contract", question: "确认合同？", required: true },
      ],
      generatedFormula: null,
      generatedExplanation: null,
      generatedTestCases: [],
      safetyFlags: [],
      formulaHash: null,
      contractHash: "a".repeat(64),
      parameterHash: "b".repeat(64),
      variableCatalogVersion: "c".repeat(64),
      createdAt: "2026-07-12T04:00:00.000Z",
      promptText: "sensitive revision prompt",
      model: "private-model",
    },
    diff: [{ field: "summary", before: "旧", after: "新" }],
    duplicate: false,
  };
}

function context(role: string) {
  return {
    supabase: { client: "supabase" },
    auth: { userId: USER_ID, organizationId: ORGANIZATION_ID, role },
    actor: { userId: USER_ID, organizationId: ORGANIZATION_ID },
    requireProjectAccess: vi.fn().mockResolvedValue(undefined),
    authoring: {
      answerOrRevise: vi.fn().mockResolvedValue(result()),
    },
    audit: vi.fn().mockResolvedValue(undefined),
  };
}

function body() {
  return {
    expectedDraftId: DRAFT_ID,
    expectedRevisionNumber: 2,
    clientRequestId: "revise-request-0001",
    promptText: "小时单价使用项目主播冻结单价",
  };
}

function request(value: unknown = body()) {
  return new Request("http://localhost", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof value === "string" ? value : JSON.stringify(value),
  });
}

function params() {
  return Promise.resolve({ projectId: PROJECT_ID, sessionId: SESSION_ID });
}

describe("settlement rule AI session turn route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(assertBillingWriteAllowed).mockResolvedValue(undefined);
  });

  it.each(["owner", "ops_manager", "operator_business"])(
    "allows %s to answer or revise",
    async (role) => {
      const routeContext = context(role);
      vi.mocked(getCustomRuleRouteContext).mockResolvedValue(
        routeContext as never,
      );

      const response = await POST(request(), { params: params() });

      expect(response.status).toBe(200);
      expect(routeContext.requireProjectAccess).toHaveBeenCalledWith(
        PROJECT_ID,
      );
      expect(assertBillingWriteAllowed).toHaveBeenCalledWith({
        client: routeContext.supabase,
        organizationId: ORGANIZATION_ID,
        featureKey: "settlement",
      });
      expect(routeContext.authoring.answerOrRevise).toHaveBeenCalledWith({
        actor: routeContext.actor,
        projectId: PROJECT_ID,
        conversationId: SESSION_ID,
        ...body(),
      });
    },
  );

  it("prevents finance from revising a draft", async () => {
    const routeContext = context("finance");
    vi.mocked(getCustomRuleRouteContext).mockResolvedValue(
      routeContext as never,
    );

    const response = await POST(request(), { params: params() });

    expect(response.status).toBe(403);
    expect(assertBillingWriteAllowed).not.toHaveBeenCalled();
    expect(routeContext.authoring.answerOrRevise).not.toHaveBeenCalled();
  });

  it("stops before revision when billing rejects the write", async () => {
    const routeContext = context("owner");
    vi.mocked(assertBillingWriteAllowed).mockRejectedValue(
      new Error("Organization is read-only because billing is past due"),
    );
    vi.mocked(getCustomRuleRouteContext).mockResolvedValue(
      routeContext as never,
    );

    const response = await POST(request(), { params: params() });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "BILLING_WRITE_BLOCKED", retryable: false },
    });
    expect(routeContext.authoring.answerOrRevise).not.toHaveBeenCalled();
  });

  it("returns a safe revision DTO", async () => {
    vi.mocked(getCustomRuleRouteContext).mockResolvedValue(
      context("owner") as never,
    );

    const response = await POST(request(), { params: params() });
    const payload = await response.json();
    const serialized = JSON.stringify(payload);

    expect(payload.result).toMatchObject({
      ok: true,
      kind: "clarifying",
      draft: { revisionNumber: 3 },
      diff: [{ field: "summary" }],
    });
    expect(serialized).not.toContain("sensitive revision prompt");
    expect(serialized).not.toContain("private-model");
  });

  it("maps stale revisions to 409", async () => {
    const routeContext = context("owner");
    routeContext.authoring.answerOrRevise.mockRejectedValue(
      new CustomRuleAuthoringServiceError(
        "stale_revision",
        "settlement draft revision is stale",
        false,
      ),
    );
    vi.mocked(getCustomRuleRouteContext).mockResolvedValue(
      routeContext as never,
    );

    const response = await POST(request(), { params: params() });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "CUSTOM_RULE_STALE_REVISION",
        message: "Settlement rule draft is stale",
        retryable: false,
      },
    });
  });

  it("returns malformed JSON as 400 without billing", async () => {
    const routeContext = context("owner");
    vi.mocked(getCustomRuleRouteContext).mockResolvedValue(
      routeContext as never,
    );

    const response = await POST(request("{"), { params: params() });

    expect(response.status).toBe(400);
    expect(assertBillingWriteAllowed).not.toHaveBeenCalled();
    expect(routeContext.authoring.answerOrRevise).not.toHaveBeenCalled();
  });

  it("validates params before project access", async () => {
    const routeContext = context("owner");
    vi.mocked(getCustomRuleRouteContext).mockResolvedValue(
      routeContext as never,
    );

    const response = await POST(request(), {
      params: Promise.resolve({ projectId: PROJECT_ID, sessionId: "unknown" }),
    });

    expect(response.status).toBe(400);
    expect(routeContext.requireProjectAccess).not.toHaveBeenCalled();
  });

  it("does not reach authoring for a project outside the organization", async () => {
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

    const response = await POST(request(), { params: params() });

    expect(response.status).toBe(404);
    expect(assertBillingWriteAllowed).not.toHaveBeenCalled();
    expect(routeContext.authoring.answerOrRevise).not.toHaveBeenCalled();
  });

  it("maps a resolved persistence failure to a safe non-2xx envelope", async () => {
    const routeContext = context("owner");
    routeContext.authoring.answerOrRevise.mockResolvedValue({
      ok: false,
      code: "persistence_failed",
      retryable: true,
      conversationId: SESSION_ID,
      sourceTurnId: "77777777-7777-4777-8777-777777777777",
      turnTrace: {
        turnId: "77777777-7777-4777-8777-777777777777",
        userMessageId: "88888888-8888-4888-8888-888888888888",
        assistantMessageId: "99999999-9999-4999-8999-999999999999",
      },
      failedDraft: {
        ...result().draft,
        promptText: "private persistence prompt",
        model: "private persistence stack",
      },
    });
    vi.mocked(getCustomRuleRouteContext).mockResolvedValue(
      routeContext as never,
    );

    const response = await POST(request(), { params: params() });
    const payload = await response.json();

    expect(response.status).toBe(503);
    expect(payload).toEqual({
      error: {
        code: "CUSTOM_RULE_STORAGE_UNAVAILABLE",
        message: "Settlement rule authoring storage is unavailable",
        retryable: true,
      },
    });
    expect(JSON.stringify(payload)).not.toContain("private persistence");
    expect(routeContext.audit).not.toHaveBeenCalled();
  });
});
