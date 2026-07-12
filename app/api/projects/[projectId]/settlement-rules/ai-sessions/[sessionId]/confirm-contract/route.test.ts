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
    kind: "simulated",
    conversationId: SESSION_ID,
    draft: {
      id: "66666666-6666-4666-8666-666666666666",
      conversationId: SESSION_ID,
      revisionNumber: 3,
      status: "simulated",
      initialStatus: "contract_ready",
      businessContract: { title: "确认合同" },
      unresolvedAmbiguities: [],
      generatedFormula: { expression: "money_result({ final: yuan(1) })" },
      generatedExplanation: "按确认公式计算。",
      generatedTestCases: [],
      safetyFlags: [],
      formulaHash: "c".repeat(64),
      contractHash: "a".repeat(64),
      parameterHash: "d".repeat(64),
      variableCatalogVersion: "b".repeat(64),
      createdAt: "2026-07-12T05:00:00.000Z",
      promptText: "raw confirmation prompt",
      model: "private-provider-model",
    },
    simulation: {
      id: "77777777-7777-4777-8777-777777777777",
      createdAt: "2026-07-12T05:00:01.000Z",
      dataSelectionHash: "e".repeat(64),
      sampleSource: { kind: "approved_operations" },
      sampleSelection: {
        periodStart: "2026-07-01",
        periodEnd: "2026-07-10",
        populationCount: 0,
        sampledCount: 0,
        criteria: ["approved_reports"],
      },
      coverage: { totalRecords: 0, evaluatedRecords: 0, skippedRecords: 0 },
      scenarios: [],
      historicalTotals: {
        payableAmountCents: null,
        receivableAmountCents: null,
        recordCount: 0,
      },
      deltas: {
        payableAmountCents: "0",
        receivableAmountCents: "0",
        percentageBps: 0,
      },
      largestChanges: [],
      warnings: [],
    },
    summary: {
      recordCount: 0,
      coverage: { totalCount: 0, evaluatedCount: 0, rateBps: 0 },
      uncoveredCount: 0,
      zeroPayCount: 0,
      reviewRoutedCount: 0,
      blockedCount: 0,
      largestIncreases: [],
      largestDecreases: [],
      totalOldCents: null,
      totalNewCents: "0",
      totalDeltaCents: null,
      marginImpactCents: null,
      historicalVerification: {
        status: "unverified",
        label: "未经过历史数据验证",
      },
      unitSources: [],
      dataSelectionHash: "e".repeat(64),
      riskFlags: [],
      warnings: [],
      scenarios: [],
      persistable: {},
    },
    duplicate: false,
  };
}

function context(role: string) {
  const authorizedSelection = {
    ...body().simulationSelection,
    selectionToken: `server:${"f".repeat(64)}`,
  };
  return {
    supabase: { client: "supabase" },
    auth: { userId: USER_ID, organizationId: ORGANIZATION_ID, role },
    actor: { userId: USER_ID, organizationId: ORGANIZATION_ID },
    requireProjectAccess: vi.fn().mockResolvedValue(undefined),
    authorizeSimulationSelection: vi
      .fn()
      .mockResolvedValue(authorizedSelection),
    authoring: { confirmContract: vi.fn().mockResolvedValue(result()) },
    audit: vi.fn().mockResolvedValue(undefined),
  };
}

function body() {
  return {
    expectedDraftId: DRAFT_ID,
    expectedRevisionNumber: 2,
    clientRequestId: "confirm-request-0001",
    promptText: "我确认以上业务合同",
    contractConfirmed: true,
    expectedContractHash: "a".repeat(64),
    expectedCatalogVersion: "b".repeat(64),
    expectedFormulaHash: "c".repeat(64),
    simulationSelection: {
      periodStart: "2026-07-01",
      periodEnd: "2026-07-10",
      criteriaCodes: ["approved_reports", "period_overlap", "project_scope"],
    },
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

describe("settlement rule contract confirmation route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(assertBillingWriteAllowed).mockResolvedValue(undefined);
  });

  it.each(["owner", "ops_manager", "operator_business"])(
    "allows %s to confirm and simulate the contract",
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
      expect(routeContext.authorizeSimulationSelection).toHaveBeenCalledWith({
        actor: routeContext.actor,
        projectId: PROJECT_ID,
        conversationId: SESSION_ID,
        draftId: DRAFT_ID,
        expectedRevisionNumber: 2,
        selection: body().simulationSelection,
      });
      expect(routeContext.authoring.confirmContract).toHaveBeenCalledWith({
        actor: routeContext.actor,
        projectId: PROJECT_ID,
        conversationId: SESSION_ID,
        ...body(),
        simulationSelection: {
          ...body().simulationSelection,
          selectionToken: `server:${"f".repeat(64)}`,
        },
      });
    },
  );

  it("prevents finance from confirming a contract", async () => {
    const routeContext = context("finance");
    vi.mocked(getCustomRuleRouteContext).mockResolvedValue(
      routeContext as never,
    );

    const response = await POST(request(), { params: params() });

    expect(response.status).toBe(403);
    expect(assertBillingWriteAllowed).not.toHaveBeenCalled();
    expect(routeContext.authoring.confirmContract).not.toHaveBeenCalled();
  });

  it("stops before selection or confirmation when billing rejects the write", async () => {
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
    expect(routeContext.authorizeSimulationSelection).not.toHaveBeenCalled();
    expect(routeContext.authoring.confirmContract).not.toHaveBeenCalled();
  });

  it("returns a safe confirmation and simulation DTO", async () => {
    vi.mocked(getCustomRuleRouteContext).mockResolvedValue(
      context("owner") as never,
    );

    const response = await POST(request(), { params: params() });
    const payload = await response.json();
    const serialized = JSON.stringify(payload);

    expect(payload.result).toMatchObject({
      kind: "simulated",
      draft: { status: "simulated" },
      summary: { totalNewYuan: "0.00" },
    });
    expect(serialized).not.toContain("raw confirmation prompt");
    expect(serialized).not.toContain("private-provider-model");
    expect(serialized).not.toContain("amountCents");
    expect(serialized).not.toContain("rateBps");
  });

  it("rejects malformed JSON and non-literal confirmation", async () => {
    for (const invalid of ["{", { ...body(), contractConfirmed: false }]) {
      const routeContext = context("owner");
      vi.mocked(getCustomRuleRouteContext).mockResolvedValue(
        routeContext as never,
      );

      const response = await POST(request(invalid), { params: params() });

      expect(response.status).toBe(400);
      expect(assertBillingWriteAllowed).not.toHaveBeenCalled();
      expect(routeContext.authoring.confirmContract).not.toHaveBeenCalled();
    }
  });

  it("rejects client-supplied selection tokens before billing", async () => {
    const routeContext = context("owner");
    vi.mocked(getCustomRuleRouteContext).mockResolvedValue(
      routeContext as never,
    );

    const response = await POST(
      request({
        ...body(),
        simulationSelection: {
          ...body().simulationSelection,
          selectionToken: "client:spoofed-selection",
        },
      }),
      { params: params() },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "INVALID_REQUEST",
        path: ["simulationSelection"],
        retryable: false,
      },
    });
    expect(assertBillingWriteAllowed).not.toHaveBeenCalled();
    expect(routeContext.authorizeSimulationSelection).not.toHaveBeenCalled();
    expect(routeContext.authoring.confirmContract).not.toHaveBeenCalled();
  });

  it.each([
    ["stale_revision", "CUSTOM_RULE_STALE_REVISION", 409],
    ["draft_not_found", "CUSTOM_RULE_SESSION_NOT_FOUND", 404],
  ] as const)(
    "maps %s without leaking service details",
    async (serviceCode, responseCode, status) => {
      const routeContext = context("owner");
      routeContext.authoring.confirmContract.mockRejectedValue(
        new CustomRuleAuthoringServiceError(
          serviceCode,
          "internal service detail",
          false,
        ),
      );
      vi.mocked(getCustomRuleRouteContext).mockResolvedValue(
        routeContext as never,
      );

      const response = await POST(request(), { params: params() });

      expect(response.status).toBe(status);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: responseCode, retryable: false },
      });
    },
  );

  it("does not call authoring when the project is not scoped to the org", async () => {
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
    expect(routeContext.authoring.confirmContract).not.toHaveBeenCalled();
  });

  it("maps a resolved conversation failure to a safe non-2xx envelope", async () => {
    const routeContext = context("owner");
    routeContext.authoring.confirmContract.mockResolvedValue({
      ok: false,
      code: "conversation_failed",
      retryable: true,
      conversationId: SESSION_ID,
      sourceTurnId: "88888888-8888-4888-8888-888888888888",
      turnTrace: {
        turnId: "88888888-8888-4888-8888-888888888888",
        userMessageId: "99999999-9999-4999-8999-999999999999",
        assistantMessageId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      },
      failedDraft: {
        ...result().draft,
        promptText: "raw confirmation secret 99999",
        model: "private conversation stack",
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
        code: "CUSTOM_RULE_AI_UNAVAILABLE",
        message: "Settlement rule AI is unavailable",
        retryable: true,
      },
    });
    expect(JSON.stringify(payload)).not.toContain("99999");
    expect(JSON.stringify(payload)).not.toContain("private conversation");
    expect(routeContext.audit).not.toHaveBeenCalled();
  });

  it("maps reconciliation exceptions to a redacted stable conflict", async () => {
    const routeContext = context("owner");
    routeContext.authoring.confirmContract.mockRejectedValue(
      new CustomRuleAuthoringServiceError(
        "conversation_reconciliation_failed",
        "provider key sk-secret and raw prompt stack",
        false,
      ),
    );
    vi.mocked(getCustomRuleRouteContext).mockResolvedValue(
      routeContext as never,
    );

    const response = await POST(request(), { params: params() });
    const payload = await response.json();

    expect(response.status).toBe(409);
    expect(payload).toEqual({
      error: {
        code: "CUSTOM_RULE_SESSION_CONFLICT",
        message: "Settlement rule session state changed",
        retryable: false,
      },
    });
    expect(JSON.stringify(payload)).not.toContain("sk-secret");
    expect(JSON.stringify(payload)).not.toContain("raw prompt");
  });
});
