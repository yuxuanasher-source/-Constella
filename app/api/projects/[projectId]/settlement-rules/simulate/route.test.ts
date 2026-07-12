import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

import { assertBillingWriteAllowed } from "@/features/billing/route-guard";
import type {
  InsertedSettlementFormulaSimulation,
} from "@/features/settlements/custom-rule-repository";
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

function simulationResult() {
  return {
    draft: {
      id: DRAFT_ID,
      conversationId: SESSION_ID,
      revisionNumber: 3,
      status: "simulated",
      initialStatus: "contract_ready",
      businessContract: { title: "项目主播按场计费" },
      unresolvedAmbiguities: [],
      generatedFormula: { expression: "money_result({ final: yuan(1) })" },
      generatedExplanation: "按确认公式计算。",
      generatedTestCases: [],
      safetyFlags: [],
      formulaHash: "a".repeat(64),
      contractHash: "b".repeat(64),
      parameterHash: "c".repeat(64),
      variableCatalogVersion: "d".repeat(64),
      createdAt: "2026-07-12T01:00:00.000Z",
      promptText: "sensitive prompt value",
      model: "provider-secret-model",
    },
    simulation: {
      id: "66666666-6666-4666-8666-666666666666",
      organizationId: ORGANIZATION_ID,
      projectId: PROJECT_ID,
      owner: { kind: "ai_draft", id: DRAFT_ID },
      idempotencyKey: "simulate-request-0001",
      formulaHash: "a".repeat(64),
      ruleContractHash: "b".repeat(64),
      parameterHash: "c".repeat(64),
      variableCatalogVersion: "d".repeat(64),
      createdAt: "2026-07-12T01:01:00.000Z",
      dataSelectionHash: "e".repeat(64),
      sampleSource: { kind: "historical_settlements" },
      sampleSelection: {
        periodStart: "2026-07-01",
        periodEnd: "2026-07-10",
        populationCount: 2,
        sampledCount: 2,
        criteria: ["approved_reports"],
      },
      summarySchemaVersion: 2,
      summaryComplete: true,
      summaryStatus: "complete",
      coverage: {
        summarySchemaVersion: 2,
        totalRecords: 2,
        evaluatedRecords: 2,
        skippedRecords: 0,
        uncoveredRecords: 0,
        zeroAmountRecords: 0,
        reviewRoutedRecords: 0,
        blockedRecords: 0,
      },
      scenarios: [
        {
          id: "scenario:contract-example",
          category: "contract_example",
          outcome: "calculated",
          amountCents: "12345",
          expectedAmountCents: "12345",
          passed: true,
        },
      ],
      historicalTotals: {
        oldPayableAmountCents: "10000",
        oldReceivableAmountCents: null,
        newPayableAmountCents: "12345",
        newReceivableAmountCents: null,
        payableAmountCents: "10000",
        receivableAmountCents: null,
        recordCount: 2,
        verificationStatus: "verified",
      },
      deltas: {
        payableAmountCents: "2345",
        receivableAmountCents: null,
        percentageBps: 2345,
        marginImpactCents: "-2345",
      },
      largestChanges: [],
      warnings: [
        {
          kind: "warning",
          code: "CUSTOM_RULE_SIMULATION_FIXTURE",
          severity: "info",
          message: "Fixture warning",
        },
      ],
      createdBy: USER_ID,
      duplicate: false,
    } satisfies InsertedSettlementFormulaSimulation,
    summary: {
      recordCount: 2,
      coverage: { totalCount: 2, evaluatedCount: 2, rateBps: 10_000 },
      uncoveredCount: 0,
      zeroPayCount: 0,
      reviewRoutedCount: 0,
      blockedCount: 0,
      largestIncreases: [],
      largestDecreases: [],
      totalOldCents: "10000",
      totalNewCents: "12345",
      totalDeltaCents: "2345",
      marginImpactCents: "-2345",
      historicalVerification: {
        status: "verified",
        label: "已通过历史数据验证",
      },
      unitSources: ["current_rule_cents"],
      dataSelectionHash: "e".repeat(64),
      riskFlags: [],
      warnings: [],
      scenarios: [],
      persistable: {},
      rawSampleRows: [{ streamerId: "private-streamer" }],
      records: [{ streamerId: "private-streamer", amountCents: "999" }],
    },
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
    simulation: {
      simulateExistingDraft: vi.fn().mockResolvedValue(simulationResult()),
    },
    audit: vi.fn().mockResolvedValue(undefined),
  };
}

function body() {
  return {
    sessionId: SESSION_ID,
    draftId: DRAFT_ID,
    expectedRevisionNumber: 3,
    clientRequestId: "simulate-request-0001",
    simulationSelection: {
      periodStart: "2026-07-01",
      periodEnd: "2026-07-10",
      criteriaCodes: ["approved_reports", "period_overlap", "project_scope"],
    },
  };
}

function userExample(overrides: Record<string, unknown> = {}) {
  return {
    id: "user-standard",
    inputs: {
      system_minutes: { type: "integer", value: 60 },
      evidence_level: { type: "string", value: "green" },
    },
    expectedResult: { type: "money_cents", amountCents: 100 },
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

describe("settlement rule simulation route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(assertBillingWriteAllowed).mockResolvedValue(undefined);
  });

  it.each(["owner", "ops_manager", "operator_business", "finance"])(
    "allows %s to simulate an existing authorized draft",
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
      expect(routeContext.authorizeSimulationSelection).toHaveBeenCalledWith({
        actor: routeContext.actor,
        projectId: PROJECT_ID,
        conversationId: SESSION_ID,
        draftId: DRAFT_ID,
        expectedRevisionNumber: 3,
        selection: body().simulationSelection,
      });
      expect(
        routeContext.simulation.simulateExistingDraft,
      ).toHaveBeenCalledWith({
        actor: routeContext.actor,
        projectId: PROJECT_ID,
        conversationId: SESSION_ID,
        draftId: DRAFT_ID,
        expectedRevisionNumber: 3,
        clientRequestId: "simulate-request-0001",
        selection: {
          ...body().simulationSelection,
          selectionToken: `server:${"f".repeat(64)}`,
        },
      });
    },
  );

  it("authorizes typed user examples but passes only the server token to simulation", async () => {
    const routeContext = context("finance");
    const selectionWithExamples = {
      ...body().simulationSelection,
      userExamples: [userExample()],
    };
    routeContext.authorizeSimulationSelection.mockResolvedValue({
      ...body().simulationSelection,
      selectionToken: `server:${"f".repeat(64)}`,
    });
    vi.mocked(getCustomRuleRouteContext).mockResolvedValue(
      routeContext as never,
    );

    const response = await POST(
      request({ ...body(), simulationSelection: selectionWithExamples }),
      { params: Promise.resolve({ projectId: PROJECT_ID }) },
    );

    expect(response.status).toBe(201);
    expect(routeContext.authorizeSimulationSelection).toHaveBeenCalledWith(
      expect.objectContaining({ selection: selectionWithExamples }),
    );
    expect(routeContext.simulation.simulateExistingDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        selection: {
          ...body().simulationSelection,
          selectionToken: `server:${"f".repeat(64)}`,
        },
      }),
    );
  });

  it.each([
    [
      "too many examples",
      Array.from({ length: 51 }, (_, index) =>
        userExample({ id: `example-${index}` }),
      ),
    ],
    [
      "non-money expectation",
      [
        userExample({
          expectedResult: { type: "rate_bps", rateBps: 1000 },
        }),
      ],
    ],
    [
      "too many input values",
      [
        userExample({
          inputs: Object.fromEntries(
            Array.from({ length: 101 }, (_, index) => [
              `input_${index}`,
              { type: "integer", value: index },
            ]),
          ),
        }),
      ],
    ],
  ])("rejects %s before billing", async (_label, userExamples) => {
    const routeContext = context("finance");
    vi.mocked(getCustomRuleRouteContext).mockResolvedValue(
      routeContext as never,
    );

    const response = await POST(
      request({
        ...body(),
        simulationSelection: {
          ...body().simulationSelection,
          userExamples,
        },
      }),
      { params: Promise.resolve({ projectId: PROJECT_ID }) },
    );

    expect(response.status).toBe(400);
    expect(assertBillingWriteAllowed).not.toHaveBeenCalled();
    expect(routeContext.authorizeSimulationSelection).not.toHaveBeenCalled();
    expect(
      routeContext.simulation.simulateExistingDraft,
    ).not.toHaveBeenCalled();
  });

  it("returns a typed summary without raw rows or cents/bps internals", async () => {
    vi.mocked(getCustomRuleRouteContext).mockResolvedValue(
      context("finance") as never,
    );

    const response = await POST(request(), {
      params: Promise.resolve({ projectId: PROJECT_ID }),
    });
    const payload = await response.json();
    const serialized = JSON.stringify(payload);

    expect(payload.summary).toMatchObject({
      recordCount: 2,
      totalOldYuan: "100.00",
      totalNewYuan: "123.45",
      totalDeltaYuan: "23.45",
      marginImpactYuan: "-23.45",
      coverage: { totalCount: 2, evaluatedCount: 2, ratePercent: "100.00" },
    });
    expect(serialized).not.toContain("private-streamer");
    expect(serialized).not.toContain("amountCents");
    expect(serialized).not.toContain("rateBps");
    expect(serialized).not.toContain("percentageBps");
    expect(serialized).not.toContain("sensitive prompt value");
    expect(serialized).not.toContain("provider-secret-model");
  });

  it("returns malformed JSON as 400 before billing", async () => {
    const routeContext = context("finance");
    vi.mocked(getCustomRuleRouteContext).mockResolvedValue(
      routeContext as never,
    );

    const response = await POST(request("{"), {
      params: Promise.resolve({ projectId: PROJECT_ID }),
    });

    expect(response.status).toBe(400);
    expect(assertBillingWriteAllowed).not.toHaveBeenCalled();
    expect(
      routeContext.simulation.simulateExistingDraft,
    ).not.toHaveBeenCalled();
  });

  it("rejects client-supplied selection tokens before billing", async () => {
    const routeContext = context("finance");
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
      { params: Promise.resolve({ projectId: PROJECT_ID }) },
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
    expect(
      routeContext.simulation.simulateExistingDraft,
    ).not.toHaveBeenCalled();
  });

  it("stops before authorization or simulation when billing rejects the write", async () => {
    const routeContext = context("finance");
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
    expect(routeContext.authorizeSimulationSelection).not.toHaveBeenCalled();
    expect(
      routeContext.simulation.simulateExistingDraft,
    ).not.toHaveBeenCalled();
  });

  it.each([
    ["CUSTOM_RULE_SESSION_NOT_FOUND", 404],
    ["CUSTOM_RULE_STALE_REVISION", 409],
  ] as const)("maps %s to a stable status", async (code, status) => {
    const routeContext = context("finance");
    const { CustomRuleRouteError } =
      await import("@/features/settlements/custom-rule-route-context");
    routeContext.simulation.simulateExistingDraft.mockRejectedValue(
      new CustomRuleRouteError({
        code,
        message:
          code === "CUSTOM_RULE_SESSION_NOT_FOUND"
            ? "Settlement rule session not found"
            : "Settlement rule draft is stale",
        status,
        retryable: false,
      }),
    );
    vi.mocked(getCustomRuleRouteContext).mockResolvedValue(
      routeContext as never,
    );

    const response = await POST(request(), {
      params: Promise.resolve({ projectId: PROJECT_ID }),
    });

    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toMatchObject({
      error: { code, retryable: false },
    });
  });

  it("does not touch evidence when project scope is rejected", async () => {
    const routeContext = context("finance");
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
    expect(
      routeContext.simulation.simulateExistingDraft,
    ).not.toHaveBeenCalled();
  });

  it("fails closed when the server cannot authorize the requested selection", async () => {
    const routeContext = context("finance");
    const { CustomRuleRouteError } =
      await import("@/features/settlements/custom-rule-route-context");
    routeContext.authorizeSimulationSelection.mockRejectedValue(
      new CustomRuleRouteError({
        code: "CUSTOM_RULE_SELECTION_UNSUPPORTED",
        message: "Historical simulation selection is unsupported",
        status: 422,
        retryable: false,
      }),
    );
    vi.mocked(getCustomRuleRouteContext).mockResolvedValue(
      routeContext as never,
    );

    const response = await POST(request(), {
      params: Promise.resolve({ projectId: PROJECT_ID }),
    });

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "CUSTOM_RULE_SELECTION_UNSUPPORTED" },
    });
    expect(
      routeContext.simulation.simulateExistingDraft,
    ).not.toHaveBeenCalled();
  });
});
