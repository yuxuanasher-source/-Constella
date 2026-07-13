import { describe, expect, it, vi } from "vitest";

import {
  CustomSettlementRuleApiError,
  createCustomSettlementRuleApi,
} from "./custom-settlement-rule-api";

const PROJECT_ID = "33333333-3333-4333-8333-333333333333";
const SESSION_ID = "44444444-4444-4444-8444-444444444444";
const OTHER_SESSION_ID = "99999999-9999-4999-8999-999999999999";
const DRAFT_ID = "55555555-5555-4555-8555-555555555555";
const START_PROGRESS_STATUSES = [
  "accepted",
  "grounding",
  "generating",
  "validating",
];
const VALID_START_PROGRESS_MATRIX = [
  ...START_PROGRESS_STATUSES.map((status) => ({
    attempt: 1,
    status,
    duplicate: true,
  })),
  ...START_PROGRESS_STATUSES.map((status) => ({
    attempt: 2,
    status,
    duplicate: true,
  })),
  ...START_PROGRESS_STATUSES.filter((status) => status !== "accepted").map(
    (status) => ({ attempt: 2, status, duplicate: false }),
  ),
];
const INVALID_START_PROGRESS_MATRIX = [
  ...START_PROGRESS_STATUSES.map((status) => ({
    attempt: 1,
    status,
    duplicate: false,
  })),
  { attempt: 2, status: "accepted", duplicate: false },
  ...[3, Number.MAX_SAFE_INTEGER].flatMap((attempt) =>
    START_PROGRESS_STATUSES.flatMap((status) =>
      [false, true].map((duplicate) => ({ attempt, status, duplicate })),
    ),
  ),
];

function generatedTestCase() {
  return {
    name: "标准一小时",
    inputs: { system_minutes: { type: "integer", value: 60 } },
    expectedResult: { type: "money_cents", amountCents: 10_000 },
  };
}

function contract(overrides = {}) {
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
    effectiveStartAt: "2026-07-01T00:00:00+08:00",
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
    ...overrides,
  };
}

function draft(overrides = {}) {
  return {
    id: DRAFT_ID,
    conversationId: SESSION_ID,
    revisionNumber: 1,
    status: "clarifying",
    initialStatus: "clarifying",
    businessContract: contract(),
    unresolvedAmbiguities: [
      {
        code: "rate_source",
        question: "按哪个单价计算？",
        required: true,
      },
    ],
    variableCatalogVersion: "a".repeat(64),
    generatedFormula: null,
    generatedExplanation: null,
    generatedTestCases: [],
    safetyFlags: [],
    contractHash: "b".repeat(64),
    formulaHash: null,
    parameterHash: "c".repeat(64),
    createdAt: "2026-07-12T01:00:00.000Z",
    supersedesDraftId: null,
    supersededByDraftId: null,
    supersededAt: null,
    ...overrides,
  };
}

function confirmableDraft(overrides = {}) {
  return draft({
    unresolvedAmbiguities: [
      {
        code: "confirm_contract",
        question: "请确认以上业务规则无误？",
        required: true,
      },
    ],
    ...overrides,
  });
}

function supersededClarifyingDraft(overrides = {}) {
  return confirmableDraft({
    status: "superseded",
    supersededByDraftId: "77777777-7777-4777-8777-777777777777",
    supersededAt: "2026-07-12T01:01:00.000Z",
    ...overrides,
  });
}

function clarifyingResult(overrides = {}) {
  return {
    ok: true,
    kind: "clarifying",
    conversationId: SESSION_ID,
    draft: draft(),
    diff: [],
    duplicate: false,
    ...overrides,
  };
}

function retryInProgressResult(status = "generating", overrides = {}) {
  return {
    ok: true,
    kind: "retry_in_progress",
    conversationId: SESSION_ID,
    turn: {
      turnId: "88888888-8888-4888-8888-888888888888",
      status,
      attempt: 1,
      duplicate: true,
    },
    ...overrides,
  };
}

function retryReadbackResult() {
  return {
    ok: true,
    kind: "retry_readback",
    conversationId: SESSION_ID,
    draft: supersededClarifyingDraft(),
    turn: {
      turnId: "88888888-8888-4888-8888-888888888888",
      status: "completed",
      attempt: 2,
      duplicate: true,
    },
  };
}

function claimedSession() {
  return {
    id: SESSION_ID,
    title: "主播结算规则",
    status: "active",
    lastMessageAt: "2026-07-12T01:00:00.000Z",
    createdAt: "2026-07-12T01:00:00.000Z",
    updatedAt: "2026-07-12T01:00:00.000Z",
  };
}

function sessionSummary() {
  return {
    conversation: {
      id: SESSION_ID,
      title: "主播结算规则",
      status: "active",
      lastMessageAt: "2026-07-12T01:00:00.000Z",
      createdAt: "2026-07-12T01:00:00.000Z",
      updatedAt: "2026-07-12T01:00:00.000Z",
    },
    messages: [],
    turns: [],
    draft: draft(),
    simulation: null,
    summary: null,
  };
}

function simulationResult() {
  const result = {
    ok: true,
    kind: "simulated",
    conversationId: SESSION_ID,
    draft: draft({
      revisionNumber: 2,
      status: "simulated",
      initialStatus: "contract_ready",
      unresolvedAmbiguities: [],
      generatedFormula: {
        expression: 'money_result({ final: parameter("hourly_rate") })',
      },
      generatedExplanation: "按确认后的小时单价计算。",
      generatedTestCases: [generatedTestCase()],
      formulaHash: "d".repeat(64),
    }),
    simulation: {
      id: "66666666-6666-4666-8666-666666666666",
      createdAt: "2026-07-12T01:02:00.000Z",
      dataSelectionHash: "e".repeat(64),
      sampleSource: { kind: "approved_operations" },
      sampleSelection: {
        periodStart: "2026-07-01",
        periodEnd: "2026-07-10",
        populationCount: 10,
        sampledCount: 10,
        criteria: ["approved_reports"],
      },
      coverage: { totalRecords: 10, evaluatedRecords: 9, skippedRecords: 1 },
      scenarios: [{ name: "标准场景", kind: "normal", result: "passed" }],
      historicalTotals: {
        payableAmountYuan: "1000.00",
        receivableAmountYuan: null,
        recordCount: 10,
      },
      deltas: {
        payableAmountYuan: "100.00",
        receivableAmountYuan: "0.00",
        percentagePercent: "10.00",
      },
      largestChanges: [],
      warnings: [],
      duplicate: false,
    },
    summary: {
      recordCount: 10,
      coverage: { totalCount: 10, evaluatedCount: 9, ratePercent: "90.00" },
      uncoveredCount: 1,
      zeroPayCount: 2,
      reviewRoutedCount: 1,
      blockedCount: 0,
      largestIncreases: [],
      largestDecreases: [],
      totalOldYuan: "1000.00",
      totalNewYuan: "1100.00",
      totalDeltaYuan: "100.00",
      marginImpactYuan: "-100.00",
      historicalVerification: {
        status: "verified",
        label: "已通过历史数据验证",
      },
      dataSelectionHash: "e".repeat(64),
      riskFlags: [],
      warnings: [],
      scenarios: [
        {
          id: "scenario:000001",
          category: "contract_example",
          outcome: "calculated",
          amountYuan: "1100.00",
          expectedAmountYuan: "1100.00",
          passed: true,
        },
      ],
    },
    duplicate: false,
  };
  result.simulation = {
    version: 2,
    complete: true,
    status: "complete",
    id: result.simulation.id,
    createdAt: result.simulation.createdAt,
    summary: structuredClone(result.summary),
    duplicate: result.simulation.duplicate,
  };
  return result;
}

function simulatedSessionSummary(overrides = {}) {
  const result = simulationResult();
  return {
    ...sessionSummary(),
    draft: result.draft,
    simulation: result.simulation,
    summary: structuredClone(result.summary),
    ...overrides,
  };
}

function completeV2Simulation(result = simulationResult()) {
  return {
    version: 2,
    complete: true,
    status: "complete",
    id: result.simulation.id,
    createdAt: result.simulation.createdAt,
    summary: structuredClone(result.summary),
  };
}

function completeV2SessionSummary(overrides = {}) {
  const result = simulationResult();
  const simulation = completeV2Simulation(result);
  return {
    ...sessionSummary(),
    draft: result.draft,
    simulation,
    summary: structuredClone(simulation.summary),
    ...overrides,
  };
}

function legacyV1SessionSummary(overrides = {}) {
  const result = simulationResult();
  return {
    ...sessionSummary(),
    draft: result.draft,
    simulation: {
      version: 1,
      complete: false,
      status: "legacy",
      id: result.simulation.id,
      createdAt: result.simulation.createdAt,
      summary: null,
      message: "旧版摘要不完整，请重新试算",
    },
    summary: null,
    ...overrides,
  };
}

function jsonResponse(payload, init = {}) {
  return new Response(JSON.stringify(payload), {
    status: init.status ?? 200,
    headers: { "Content-Type": "application/json" },
  });
}

function endpointPayload(endpoint, result) {
  return endpoint === "startSession"
    ? { session: claimedSession(), result }
    : { result };
}

function callEndpoint(api, endpoint) {
  if (endpoint === "startSession") {
    return api.startSession({ projectId: PROJECT_ID, body: {} });
  }
  return api[endpoint]({
    projectId: PROJECT_ID,
    sessionId: SESSION_ID,
    body: {},
  });
}

function catalogEnvelope(latestSampledPeriod) {
  return {
    catalog: {
      scope: "receivable",
      executionGrain: "project_period",
      businessTimezone: null,
      businessTimezoneConfirmed: false,
      businessTimezoneSource: "unresolved",
      hasHistory: true,
      version: "a".repeat(64),
      variables: [
        {
          id: "system_minutes",
          label: "System minutes",
          runtimeType: { kind: "scalar", scalarType: "integer" },
          unit: "minutes",
          sourceLabel: "Live report",
          availability: "available",
          coverageNumerator: 1,
          coverageDenominator: 1,
          latestSampledPeriod,
        },
      ],
    },
  };
}

function governanceRule(overrides = {}) {
  return {
    id: "44444444-4444-4444-8444-444444444444",
    projectId: PROJECT_ID,
    scope: "payable",
    target: { targetType: "project", targetId: null },
    executionGrain: "report",
    compositionMode: "replace",
    priority: 100,
    versionNumber: 2,
    status: "pending_review",
    formulaHash: "a".repeat(64),
    contractHash: "b".repeat(64),
    parameterHash: "c".repeat(64),
    catalogHash: "d".repeat(64),
    dataSelectionHash: "e".repeat(64),
    simulationId: "55555555-5555-4555-8555-555555555555",
    effectiveFrom: "2026-07-12T00:00:00.000Z",
    effectiveUntil: null,
    createdBy: "22222222-2222-4222-8222-222222222222",
    approvedBy: null,
    aiDraftId: DRAFT_ID,
    reason: "提交审核",
    createdAt: "2026-07-12T00:00:00.000Z",
    approvedAt: null,
    archivedAt: null,
    eligibleApproverId: "66666666-6666-4666-8666-666666666666",
    requiresDifferentApprover: true,
    primaryAction: { state: "pending_review", action: "approve" },
    ...overrides,
  };
}

function reviewEvent(overrides = {}) {
  return {
    id: "66666666-6666-4666-8666-666666666666",
    eventType: "submitted_for_review",
    actorId: "22222222-2222-4222-8222-222222222222",
    actorRole: "operator_business",
    reason: "提交审核",
    comment: null,
    beforeStatus: "draft",
    afterStatus: "pending_review",
    createdAt: "2026-07-12T00:00:00.000Z",
    ...overrides,
  };
}

describe("custom settlement rule API", () => {
  it("returns a validated catalog and encodes the project and query values", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        catalog: {
          scope: "payable",
          executionGrain: "report",
          businessTimezone: null,
          businessTimezoneConfirmed: false,
          businessTimezoneSource: "unresolved",
          hasHistory: false,
          version: "a".repeat(64),
          variables: [
            {
              id: "system_minutes",
              label: "系统直播时长",
              runtimeType: { kind: "scalar", scalarType: "integer" },
              unit: "分钟",
              sourceLabel: "直播报告",
              availability: "available",
              coverageNumerator: 0,
              coverageDenominator: 0,
              latestSampledPeriod: null,
            },
          ],
        },
      }),
    );
    const api = createCustomSettlementRuleApi({ fetchImpl });

    const result = await api.getVariableCatalog({
      projectId: "项目 / A?#",
      scope: "payable",
      executionGrain: "report",
    });

    expect(result.catalog.hasHistory).toBe(false);
    expect(result.catalog.businessTimezone).toBeNull();
    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/projects/%E9%A1%B9%E7%9B%AE%20%2F%20A%3F%23/settlement-rules/variable-catalog?scope=payable&executionGrain=report",
      expect.objectContaining({
        method: "GET",
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it("rejects an invalid IANA timezone from the catalog as a protocol error", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        catalog: {
          scope: "payable",
          executionGrain: "report",
          businessTimezone: "Invalid/Timezone",
          businessTimezoneConfirmed: true,
          businessTimezoneSource: "organization_setting",
          hasHistory: false,
          version: "a".repeat(64),
          variables: [],
        },
      }),
    );
    const api = createCustomSettlementRuleApi({ fetchImpl });

    await expect(
      api.getVariableCatalog({
        projectId: PROJECT_ID,
        scope: "payable",
        executionGrain: "report",
      }),
    ).rejects.toMatchObject({
      code: "CUSTOM_RULE_RESPONSE_INVALID",
      retryable: true,
    });
  });

  it("accepts canonical offset timestamp periods from the live variable catalog", async () => {
    const latestSampledPeriod = {
      start: "2026-07-12T15:18:03.37728+00:00",
      end: "2026-07-12T16:18:03.37728+00:00",
    };
    const fetchImpl = vi.fn(async () =>
      jsonResponse(catalogEnvelope(latestSampledPeriod)),
    );
    const api = createCustomSettlementRuleApi({ fetchImpl });

    await expect(
      api.getVariableCatalog({
        projectId: "7a130000-0000-4000-8000-000000000001",
        scope: "receivable",
        executionGrain: "project_period",
      }),
    ).resolves.toMatchObject({
      catalog: {
        variables: [{ latestSampledPeriod }],
      },
    });
  });

  it("continues to accept canonical business-date catalog periods", async () => {
    const latestSampledPeriod = {
      start: "2026-07-01",
      end: "2026-07-31",
    };
    const fetchImpl = vi.fn(async () =>
      jsonResponse(catalogEnvelope(latestSampledPeriod)),
    );
    const api = createCustomSettlementRuleApi({ fetchImpl });

    await expect(
      api.getVariableCatalog({
        projectId: PROJECT_ID,
        scope: "receivable",
        executionGrain: "project_period",
      }),
    ).resolves.toMatchObject({
      catalog: {
        variables: [{ latestSampledPeriod }],
      },
    });
  });

  it.each([
    ["missing offset", "2026-07-12T15:18:03.37728"],
    ["space separator", "2026-07-12 15:18:03.37728+00:00"],
    ["compact offset", "2026-07-12T15:18:03.37728+0000"],
    ["impossible date", "2026-02-30T15:18:03.37728+00:00"],
  ])(
    "rejects a malformed or noncanonical catalog timestamp: %s",
    async (_label, start) => {
      const fetchImpl = vi.fn(async () =>
        jsonResponse(
          catalogEnvelope({
            start,
            end: "2026-07-12T16:18:03.37728+00:00",
          }),
        ),
      );
      const api = createCustomSettlementRuleApi({ fetchImpl });

      await expect(
        api.getVariableCatalog({
          projectId: PROJECT_ID,
          scope: "receivable",
          executionGrain: "project_period",
        }),
      ).rejects.toMatchObject({
        code: "CUSTOM_RULE_RESPONSE_INVALID",
        status: 200,
        retryable: true,
      });
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    ["business dates", { start: "2026-07-31", end: "2026-07-01" }],
    [
      "offset instants whose lexical order is misleading",
      {
        start: "2026-07-12T09:00:00+00:00",
        end: "2026-07-12T10:00:00+02:00",
      },
    ],
    [
      "sub-millisecond offset instants",
      {
        start: "2026-07-12T15:18:03.37729+00:00",
        end: "2026-07-12T15:18:03.37728+00:00",
      },
    ],
    [
      "mixed date and timestamp representations",
      {
        start: "2026-07-12",
        end: "2026-07-12T16:18:03.37728+00:00",
      },
    ],
  ])(
    "rejects a reversed or mixed catalog period: %s",
    async (_label, period) => {
      const fetchImpl = vi.fn(async () =>
        jsonResponse(catalogEnvelope(period)),
      );
      const api = createCustomSettlementRuleApi({ fetchImpl });

      await expect(
        api.getVariableCatalog({
          projectId: PROJECT_ID,
          scope: "receivable",
          executionGrain: "project_period",
        }),
      ).rejects.toMatchObject({
        code: "CUSTOM_RULE_RESPONSE_INVALID",
        status: 200,
        retryable: true,
      });
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    },
  );

  it("starts a session with the exact Task 8 body and returns a typed result", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(
        {
          session: {
            id: SESSION_ID,
            title: "主播结算规则",
            status: "active",
            lastMessageAt: "2026-07-12T01:00:00.000Z",
            createdAt: "2026-07-12T01:00:00.000Z",
            updatedAt: "2026-07-12T01:00:00.000Z",
          },
          result: clarifyingResult(),
        },
        { status: 201 },
      ),
    );
    const api = createCustomSettlementRuleApi({ fetchImpl });
    const body = {
      title: "主播结算规则",
      clientRequestId: "task9:start:0001",
      promptText: "每场按直播时长结算",
      seedContract: contract(),
      initialAmbiguities: [
        {
          code: "rule_definition",
          question: "这条规则最主要的计算条件是什么？",
          required: true,
        },
      ],
    };

    const result = await api.startSession({ projectId: PROJECT_ID, body });

    expect(result.result.draft.status).toBe("clarifying");
    expect(fetchImpl).toHaveBeenCalledWith(
      `/api/projects/${PROJECT_ID}/settlement-rules/ai-sessions`,
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
  });

  it("encodes project and session IDs and validates authoritative session refreshes", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ session: sessionSummary() }),
    );
    const api = createCustomSettlementRuleApi({ fetchImpl });

    const result = await api.refreshSession({
      projectId: "project / one",
      sessionId: SESSION_ID,
    });

    expect(result.session.draft.id).toBe(DRAFT_ID);
    expect(fetchImpl).toHaveBeenCalledWith(
      `/api/projects/project%20%2F%20one/settlement-rules/ai-sessions/${SESSION_ID}`,
      expect.objectContaining({
        method: "GET",
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it("rejects an authoritative refresh bound to a different requested session", async () => {
    const session = sessionSummary();
    session.conversation.id = OTHER_SESSION_ID;
    session.draft.conversationId = OTHER_SESSION_ID;
    const fetchImpl = vi.fn(async () => jsonResponse({ session }));
    const api = createCustomSettlementRuleApi({ fetchImpl });

    await expect(
      api.refreshSession({
        projectId: PROJECT_ID,
        sessionId: SESSION_ID,
      }),
    ).rejects.toMatchObject({
      code: "CUSTOM_RULE_RESPONSE_INVALID",
      retryable: true,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it.each(["answerOrRevise", "confirmAndSimulate"])(
    "%s rejects a result bound to a different requested session",
    async (endpoint) => {
      const result =
        endpoint === "answerOrRevise"
          ? clarifyingResult({
              conversationId: OTHER_SESSION_ID,
              draft: draft({ conversationId: OTHER_SESSION_ID }),
            })
          : {
              ...simulationResult(),
              conversationId: OTHER_SESSION_ID,
              draft: {
                ...simulationResult().draft,
                conversationId: OTHER_SESSION_ID,
              },
            };
      const fetchImpl = vi.fn(async () => jsonResponse({ result }));
      const api = createCustomSettlementRuleApi({ fetchImpl });

      await expect(callEndpoint(api, endpoint)).rejects.toMatchObject({
        code: "CUSTOM_RULE_RESPONSE_INVALID",
        retryable: true,
      });
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    },
  );

  it("posts answer and confirmation DTOs to their exact routes", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ result: clarifyingResult() }))
      .mockResolvedValueOnce(jsonResponse({ result: simulationResult() }));
    const api = createCustomSettlementRuleApi({ fetchImpl });
    const answerBody = {
      expectedDraftId: DRAFT_ID,
      expectedRevisionNumber: 1,
      clientRequestId: "task9:answer:0001",
      promptText: "按每小时一百元计算",
    };
    const confirmationBody = {
      expectedDraftId: DRAFT_ID,
      expectedRevisionNumber: 1,
      clientRequestId: "task9:confirm:0001",
      promptText: "确认当前业务规则并试算",
      contractConfirmed: true,
      expectedContractHash: "b".repeat(64),
      expectedCatalogVersion: "a".repeat(64),
      simulationSelection: {
        periodStart: "2026-07-01",
        periodEnd: "2026-07-31",
        criteriaCodes: [
          "approved_reports",
          "period_overlap",
          "complete_evidence",
          "project_scope",
        ],
      },
    };

    await api.answerOrRevise({
      projectId: PROJECT_ID,
      sessionId: SESSION_ID,
      body: answerBody,
    });
    const confirmed = await api.confirmAndSimulate({
      projectId: PROJECT_ID,
      sessionId: SESSION_ID,
      body: confirmationBody,
    });

    expect(confirmed.result.summary.totalNewYuan).toBe("1100.00");
    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      `/api/projects/${PROJECT_ID}/settlement-rules/ai-sessions/${SESSION_ID}/turns`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify(answerBody),
      }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      `/api/projects/${PROJECT_ID}/settlement-rules/ai-sessions/${SESSION_ID}/confirm-contract`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify(confirmationBody),
      }),
    );
  });

  it.each(["startSession", "answerOrRevise"])(
    "accepts a superseded clarifying replay from %s",
    async (endpoint) => {
      const result = {
        ...clarifyingResult(),
        draft: supersededClarifyingDraft(),
        duplicate: true,
      };
      const fetchImpl = vi.fn(async () =>
        jsonResponse(endpointPayload(endpoint, result)),
      );
      const api = createCustomSettlementRuleApi({ fetchImpl });

      await expect(callEndpoint(api, endpoint)).resolves.toMatchObject({
        result: {
          kind: "clarifying",
          duplicate: true,
          draft: {
            initialStatus: "clarifying",
            status: "superseded",
            supersededByDraftId: "77777777-7777-4777-8777-777777777777",
          },
        },
      });
    },
  );

  it.each(["startSession", "answerOrRevise"])(
    "rejects a non-duplicate superseded clarifying replay from %s",
    async (endpoint) => {
      const result = {
        ...clarifyingResult(),
        draft: supersededClarifyingDraft(),
        duplicate: false,
      };
      const fetchImpl = vi.fn(async () =>
        jsonResponse(endpointPayload(endpoint, result)),
      );
      const api = createCustomSettlementRuleApi({ fetchImpl });

      await expect(callEndpoint(api, endpoint)).rejects.toMatchObject({
        code: "CUSTOM_RULE_RESPONSE_INVALID",
        retryable: true,
      });
    },
  );

  it.each(
    ["startSession", "answerOrRevise"].flatMap((endpoint) => [
      [
        endpoint,
        "failed",
        draft({
          status: "failed",
          initialStatus: "failed",
          unresolvedAmbiguities: [],
        }),
      ],
      [
        endpoint,
        "superseded failed",
        draft({
          status: "superseded",
          initialStatus: "failed",
          unresolvedAmbiguities: [],
          supersededByDraftId: "77777777-7777-4777-8777-777777777777",
          supersededAt: "2026-07-12T01:01:00.000Z",
        }),
      ],
    ]),
  )(
    "%s rejects a %s draft in an otherwise valid clarifying envelope",
    async (endpoint, _caseName, failedDraft) => {
      const result = {
        ...clarifyingResult(),
        draft: failedDraft,
        duplicate: true,
      };
      const fetchImpl = vi.fn(async () =>
        jsonResponse(endpointPayload(endpoint, result)),
      );
      const api = createCustomSettlementRuleApi({ fetchImpl });

      await expect(callEndpoint(api, endpoint)).rejects.toMatchObject({
        code: "CUSTOM_RULE_RESPONSE_INVALID",
        retryable: true,
      });
    },
  );

  it.each(VALID_START_PROGRESS_MATRIX)(
    "accepts start progress attempt=$attempt status=$status duplicate=$duplicate",
    async ({ attempt, status, duplicate }) => {
      const result = retryInProgressResult(status);
      result.turn.attempt = attempt;
      result.turn.duplicate = duplicate;
      const fetchImpl = vi.fn(async () =>
        jsonResponse(endpointPayload("startSession", result), { status: 201 }),
      );
      const api = createCustomSettlementRuleApi({ fetchImpl });

      await expect(callEndpoint(api, "startSession")).resolves.toMatchObject({
        result: {
          kind: "retry_in_progress",
          turn: { attempt, status, duplicate },
        },
      });
    },
  );

  it.each([
    ["startSession", "simulated", () => simulationResult()],
    ["startSession", "retry_readback", () => retryReadbackResult()],
    ["answerOrRevise", "simulated", () => simulationResult()],
    ["answerOrRevise", "retry_in_progress", () => retryInProgressResult()],
    ["answerOrRevise", "retry_readback", () => retryReadbackResult()],
    [
      "confirmAndSimulate",
      "clarifying",
      () => ({
        ...clarifyingResult(),
        draft: supersededClarifyingDraft(),
        duplicate: true,
      }),
    ],
    ["confirmAndSimulate", "retry_in_progress", () => retryInProgressResult()],
    ["confirmAndSimulate", "retry_readback", () => retryReadbackResult()],
  ])(
    "%s rejects the impossible 2xx kind %s",
    async (endpoint, _kind, resultFactory) => {
      const fetchImpl = vi.fn(async () =>
        jsonResponse(endpointPayload(endpoint, resultFactory())),
      );
      const api = createCustomSettlementRuleApi({ fetchImpl });

      await expect(callEndpoint(api, endpoint)).rejects.toMatchObject({
        code: "CUSTOM_RULE_RESPONSE_INVALID",
        retryable: true,
      });
    },
  );

  it.each(INVALID_START_PROGRESS_MATRIX)(
    "rejects start progress attempt=$attempt status=$status duplicate=$duplicate",
    async ({ attempt, status, duplicate }) => {
      const result = retryInProgressResult(status);
      result.turn.attempt = attempt;
      result.turn.duplicate = duplicate;
      const fetchImpl = vi.fn(async () =>
        jsonResponse(endpointPayload("startSession", result)),
      );
      const api = createCustomSettlementRuleApi({ fetchImpl });

      await expect(callEndpoint(api, "startSession")).rejects.toMatchObject({
        code: "CUSTOM_RULE_RESPONSE_INVALID",
        retryable: true,
      });
    },
  );

  it.each([
    [
      "startSession",
      () => {
        const result = retryInProgressResult();
        delete result.turn;
        return result;
      },
    ],
    [
      "answerOrRevise",
      () => {
        const result = clarifyingResult();
        delete result.diff;
        return result;
      },
    ],
    [
      "confirmAndSimulate",
      () => ({ ...simulationResult(), turn: retryInProgressResult().turn }),
    ],
  ])(
    "%s rejects missing fields or cross-kind extras",
    async (endpoint, resultFactory) => {
      const fetchImpl = vi.fn(async () =>
        jsonResponse(endpointPayload(endpoint, resultFactory())),
      );
      const api = createCustomSettlementRuleApi({ fetchImpl });

      await expect(callEndpoint(api, endpoint)).rejects.toMatchObject({
        code: "CUSTOM_RULE_RESPONSE_INVALID",
        retryable: true,
      });
    },
  );

  it("accepts persisted simulation counts when the sample and history match coverage", async () => {
    const result = simulationResult();
    const fetchImpl = vi.fn(async () => jsonResponse({ result }));
    const api = createCustomSettlementRuleApi({ fetchImpl });

    await expect(
      api.confirmAndSimulate({
        projectId: PROJECT_ID,
        sessionId: SESSION_ID,
        body: {},
      }),
    ).resolves.toMatchObject({
      result: {
        simulation: {
          version: 2,
          complete: true,
          summary: {
            recordCount: 10,
            coverage: { totalCount: 10, evaluatedCount: 9 },
          },
        },
      },
    });
  });

  it("accepts a simulated authoritative session only with its persisted artifact", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ session: simulatedSessionSummary() }),
    );
    const api = createCustomSettlementRuleApi({ fetchImpl });

    await expect(
      api.refreshSession({ projectId: PROJECT_ID, sessionId: SESSION_ID }),
    ).resolves.toMatchObject({
      session: {
        conversation: { id: SESSION_ID },
        draft: { status: "simulated" },
        simulation: { id: "66666666-6666-4666-8666-666666666666" },
      },
    });
  });

  it("parses complete v2 and incomplete legacy session summaries by version", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ session: completeV2SessionSummary() }))
      .mockResolvedValueOnce(jsonResponse({ session: legacyV1SessionSummary() }));
    const api = createCustomSettlementRuleApi({ fetchImpl });

    await expect(
      api.refreshSession({ projectId: PROJECT_ID, sessionId: SESSION_ID }),
    ).resolves.toMatchObject({
      session: {
        simulation: {
          version: 2,
          complete: true,
          summary: { totalNewYuan: "1100.00", zeroPayCount: 2 },
        },
        summary: { totalNewYuan: "1100.00", zeroPayCount: 2 },
      },
    });
    await expect(
      api.refreshSession({ projectId: PROJECT_ID, sessionId: SESSION_ID }),
    ).resolves.toMatchObject({
      session: {
        simulation: {
          version: 1,
          complete: false,
          summary: null,
          message: "旧版摘要不完整，请重新试算",
        },
        summary: null,
      },
    });
  });

  it.each([
    ["extra key", (session) => (session.simulation.extra = true)],
    ["raw rows", (session) => (session.simulation.rawRows = [{ id: "raw" }])],
    [
      "raw cents",
      (session) => (session.simulation.summary.totalNewCents = "110000"),
    ],
  ])("rejects %s from a v2 session simulation", async (_label, mutate) => {
    const session = completeV2SessionSummary();
    mutate(session);
    const fetchImpl = vi.fn(async () => jsonResponse({ session }));
    const api = createCustomSettlementRuleApi({ fetchImpl });

    await expect(
      api.refreshSession({ projectId: PROJECT_ID, sessionId: SESSION_ID }),
    ).rejects.toMatchObject({
      code: "CUSTOM_RULE_RESPONSE_INVALID",
      retryable: true,
    });
  });

  it("rejects a v2 session whose authoritative summaries disagree", async () => {
    const session = completeV2SessionSummary();
    session.summary.totalNewYuan = "1100.01";
    const fetchImpl = vi.fn(async () => jsonResponse({ session }));
    const api = createCustomSettlementRuleApi({ fetchImpl });

    await expect(
      api.refreshSession({ projectId: PROJECT_ID, sessionId: SESSION_ID }),
    ).rejects.toMatchObject({ code: "CUSTOM_RULE_RESPONSE_INVALID" });
  });

  it.each([
    [
      "simulated draft without persisted artifact",
      () => simulatedSessionSummary({ simulation: null }),
    ],
    [
      "clarifying draft with persisted artifact",
      () => ({
        ...sessionSummary(),
        simulation: simulationResult().simulation,
      }),
    ],
  ])(
    "rejects an impossible authoritative terminal shape: %s",
    async (_label, makeSession) => {
      const fetchImpl = vi.fn(async () =>
        jsonResponse({ session: makeSession() }),
      );
      const api = createCustomSettlementRuleApi({ fetchImpl });

      await expect(
        api.refreshSession({ projectId: PROJECT_ID, sessionId: SESSION_ID }),
      ).rejects.toMatchObject({
        code: "CUSTOM_RULE_RESPONSE_INVALID",
        retryable: true,
      });
    },
  );

  it.each([
    ["summary increase is negative", "summary", "increase", "-0.01"],
    ["summary decrease is positive", "summary", "decrease", "0.01"],
    ["persisted increase is negative", "persisted", "increase", "-0.01"],
    ["persisted decrease is positive", "persisted", "decrease", "0.01"],
    ["persisted unchanged is nonzero", "persisted", "unchanged", "0.01"],
  ])(
    "rejects a financial direction mismatch: %s",
    async (_label, source, direction, deltaYuan) => {
      const result = simulationResult();
      if (source === "summary") {
        const change = {
          bucket: "authorized_ordinal:000001",
          deltaYuan,
          direction,
        };
        if (direction === "increase")
          result.summary.largestIncreases = [change];
        else result.summary.largestDecreases = [change];
      } else {
        const change = {
          bucket: "authorized_ordinal:000001",
          deltaYuan,
          direction: direction === "unchanged" ? "increase" : direction,
        };
        if (direction === "decrease")
          result.simulation.summary.largestDecreases = [change];
        else result.simulation.summary.largestIncreases = [change];
      }
      const fetchImpl = vi.fn(async () => jsonResponse({ result }));
      const api = createCustomSettlementRuleApi({ fetchImpl });

      await expect(
        api.confirmAndSimulate({
          projectId: PROJECT_ID,
          sessionId: SESSION_ID,
          body: {},
        }),
      ).rejects.toMatchObject({
        code: "CUSTOM_RULE_RESPONSE_INVALID",
        retryable: true,
      });
    },
  );

  it.each([
    {
      label: "confirmation coverage rate exponent",
      endpoint: "confirmAndSimulate",
      mutate(result) {
        result.summary.coverage.ratePercent = "1e3";
      },
    },
    {
      label: "confirmation coverage rate without scale",
      endpoint: "confirmAndSimulate",
      mutate(result) {
        result.summary.coverage.ratePercent = "90";
      },
    },
    {
      label: "summary old total exponent",
      endpoint: "confirmAndSimulate",
      mutate(result) {
        result.summary.totalOldYuan = "1e3";
      },
    },
    {
      label: "summary new total with a leading plus",
      endpoint: "confirmAndSimulate",
      mutate(result) {
        result.summary.totalNewYuan = "+1100.00";
      },
    },
    {
      label: "summary delta with multiple decimal points",
      endpoint: "confirmAndSimulate",
      mutate(result) {
        result.summary.totalDeltaYuan = "1.0.0";
      },
    },
    {
      label: "full summary increase exponent",
      endpoint: "confirmAndSimulate",
      mutate(result) {
        result.summary.largestIncreases = [
          {
            bucket: "authorized_ordinal:000001",
            deltaYuan: "1e3",
            direction: "increase",
          },
        ];
      },
    },
    {
      label: "full summary decrease NaN",
      endpoint: "confirmAndSimulate",
      mutate(result) {
        result.summary.largestDecreases = [
          {
            bucket: "authorized_ordinal:000001",
            deltaYuan: "NaN",
            direction: "decrease",
          },
        ];
      },
    },
    {
      label: "persisted confirmation change infinity",
      endpoint: "confirmAndSimulate",
      mutate(result) {
        result.simulation.summary.largestIncreases = [
          {
            bucket: "authorized_ordinal:000001",
            deltaYuan: "Infinity",
            direction: "increase",
          },
        ];
      },
    },
    {
      label: "persisted refresh change exponent",
      endpoint: "refreshSession",
      mutate(result) {
        result.simulation.summary.largestIncreases = [
          {
            bucket: "authorized_ordinal:000001",
            deltaYuan: "1e3",
            direction: "increase",
          },
        ];
      },
    },
    {
      label: "persisted unchanged sign comparison with malformed sign",
      endpoint: "refreshSession",
      mutate(result) {
        result.simulation.summary.totalDeltaYuan = "--0.00";
      },
    },
  ])(
    "classifies malformed decimal 2xx data as one-fetch protocol failure: $label",
    async ({ endpoint, mutate }) => {
      const result = simulationResult();
      mutate(result);
      const payload =
        endpoint === "refreshSession"
          ? {
              session: simulatedSessionSummary({
                draft: result.draft,
                simulation: result.simulation,
              }),
            }
          : { result };
      const fetchImpl = vi.fn(async () => jsonResponse(payload));
      const api = createCustomSettlementRuleApi({ fetchImpl });
      const request =
        endpoint === "refreshSession"
          ? api.refreshSession({
              projectId: PROJECT_ID,
              sessionId: SESSION_ID,
            })
          : api.confirmAndSimulate({
              projectId: PROJECT_ID,
              sessionId: SESSION_ID,
              body: {},
            });

      await expect(request).rejects.toMatchObject({
        name: "CustomSettlementRuleApiError",
        code: "CUSTOM_RULE_RESPONSE_INVALID",
        message: "结算规则服务返回了无法识别的响应",
        retryable: true,
        status: 200,
      });
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    },
  );

  it("accepts exact signed decimal directions at the storage boundaries", async () => {
    const result = simulationResult();
    result.summary.largestIncreases = [
      {
        bucket: "authorized_ordinal:000001",
        deltaYuan: "92233720368547758.07",
        direction: "increase",
      },
    ];
    result.summary.largestDecreases = [
      {
        bucket: "authorized_ordinal:000002",
        deltaYuan: "-92233720368547758.08",
        direction: "decrease",
      },
    ];
    result.simulation.summary = structuredClone(result.summary);
    const fetchImpl = vi.fn(async () => jsonResponse({ result }));
    const api = createCustomSettlementRuleApi({ fetchImpl });

    await expect(
      api.confirmAndSimulate({
        projectId: PROJECT_ID,
        sessionId: SESSION_ID,
        body: {},
      }),
    ).resolves.toMatchObject({
      result: {
        summary: {
          largestIncreases: [{ deltaYuan: "92233720368547758.07" }],
          largestDecreases: [{ deltaYuan: "-92233720368547758.08" }],
        },
        simulation: {
          summary: {
            largestIncreases: [{ deltaYuan: "92233720368547758.07" }],
            largestDecreases: [{ deltaYuan: "-92233720368547758.08" }],
          },
        },
      },
    });
  });

  it.each([
    "__proto__",
    "prototype",
    "constructor",
    "toString",
    "hasOwnProperty",
  ])(
    "rejects the reserved generated input identifier %s before record parsing",
    async (reservedKey) => {
      const result = simulationResult();
      const inputs = JSON.parse(
        `{"${reservedKey}":{"type":"integer","value":1}}`,
      );
      result.draft.generatedTestCases[0].inputs = inputs;
      const fetchImpl = vi.fn(async () => jsonResponse({ result }));
      const api = createCustomSettlementRuleApi({ fetchImpl });

      await expect(
        api.confirmAndSimulate({
          projectId: PROJECT_ID,
          sessionId: SESSION_ID,
          body: {},
        }),
      ).rejects.toMatchObject({
        code: "CUSTOM_RULE_RESPONSE_INVALID",
        retryable: true,
      });
      expect(Object.prototype.hasOwnProperty.call(inputs, reservedKey)).toBe(
        true,
      );
      expect({}.polluted).toBeUndefined();
    },
  );

  it("rejects generated input accessors without executing them", async () => {
    const result = simulationResult();
    let accessorReads = 0;
    const inputs = {};
    Object.defineProperty(inputs, "system_minutes", {
      enumerable: true,
      get() {
        accessorReads += 1;
        return { type: "integer", value: 60 };
      },
    });
    result.draft.generatedTestCases[0].inputs = inputs;
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ result }),
    }));
    const api = createCustomSettlementRuleApi({ fetchImpl });

    await expect(
      api.confirmAndSimulate({
        projectId: PROJECT_ID,
        sessionId: SESSION_ID,
        body: {},
      }),
    ).rejects.toMatchObject({
      code: "CUSTOM_RULE_RESPONSE_INVALID",
      retryable: true,
    });
    expect(accessorReads).toBe(0);
  });

  it("aborts the stale request when a newer request starts", async () => {
    let firstSignal;
    const fetchImpl = vi
      .fn()
      .mockImplementationOnce((_url, init) => {
        firstSignal = init.signal;
        return new Promise((_resolve, reject) => {
          init.signal.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        });
      })
      .mockResolvedValueOnce(jsonResponse({ session: sessionSummary() }));
    const api = createCustomSettlementRuleApi({ fetchImpl });

    const stale = api.refreshSession({
      projectId: PROJECT_ID,
      sessionId: SESSION_ID,
    });
    const current = api.refreshSession({
      projectId: PROJECT_ID,
      sessionId: SESSION_ID,
    });

    expect(firstSignal.aborted).toBe(true);
    await expect(stale).rejects.toMatchObject({ name: "AbortError" });
    await expect(current).resolves.toMatchObject({
      session: { draft: { id: DRAFT_ID } },
    });
  });

  it.each([
    [
      "empty required contract array",
      (payload) => {
        payload.result.draft.businessContract.calculationComponents = [];
      },
    ],
    [
      "invalid business identifier",
      (payload) => {
        payload.result.draft.businessContract.requiredInputs[0].name =
          "bad identifier";
      },
    ],
    [
      "invalid canonical timestamp",
      (payload) => {
        payload.result.draft.businessContract.effectiveStartAt =
          "2026-07-01 00:00:00";
      },
    ],
    [
      "invalid IANA timezone",
      (payload) => {
        payload.result.draft.businessContract.businessTimezone =
          "Not/A_Timezone";
      },
    ],
    [
      "missing output schema version",
      (payload) => {
        delete payload.result.draft.businessContract.schemaVersion;
      },
    ],
    [
      "missing output business timezone",
      (payload) => {
        delete payload.result.draft.businessContract.businessTimezone;
      },
    ],
    [
      "missing required draft lifecycle field",
      (payload) => {
        delete payload.result.draft.supersedesDraftId;
      },
    ],
    [
      "mismatched typed parameter default",
      (payload) => {
        payload.result.draft.businessContract.parameters[0].defaultValue = {
          type: "rate_bps",
          rateBps: 1_000,
        };
      },
    ],
    [
      "mismatched generated result type",
      (payload) => {
        payload.result = simulationResult();
        payload.result.draft.generatedTestCases[0].expectedResult = {
          type: "integer",
          value: 100,
        };
      },
      "confirmAndSimulate",
    ],
    [
      "strict extra response key",
      (payload) => {
        payload.result.draft.providerStack = "private-provider-stack";
      },
    ],
    [
      "malformed hash",
      (payload) => {
        payload.result.draft.contractHash = "not-a-sha256";
      },
    ],
    [
      "unsafe numeric value",
      (payload) => {
        payload.result.draft.businessContract.parameters[0].defaultValue = {
          type: "money_cents",
          amountCents: Number.MAX_SAFE_INTEGER + 1,
        };
      },
    ],
    [
      "malformed public decimal",
      (payload) => {
        payload.result = simulationResult();
        payload.result.simulation.summary.totalDeltaYuan = "1e3";
      },
      "confirmAndSimulate",
    ],
    [
      "invalid simulation count invariant",
      (payload) => {
        payload.result = simulationResult();
        payload.result.simulation.summary.coverage.evaluatedCount = 11;
      },
      "confirmAndSimulate",
    ],
    [
      "sample count does not match persisted coverage",
      (payload) => {
        payload.result = simulationResult();
        payload.result.simulation.sampleSelection = { sampledCount: 9 };
      },
      "confirmAndSimulate",
    ],
    [
      "historical count does not match persisted coverage",
      (payload) => {
        payload.result = simulationResult();
        payload.result.simulation.historicalTotals = { recordCount: 9 };
      },
      "confirmAndSimulate",
    ],
    [
      "tampered superseded lifecycle metadata",
      (payload) => {
        payload.result = {
          ...clarifyingResult(),
          draft: supersededClarifyingDraft({ supersededAt: null }),
        };
      },
    ],
    [
      "invalid summary status-count invariant",
      (payload) => {
        payload.result = simulationResult();
        payload.result.summary.reviewRoutedCount = 0;
      },
      "confirmAndSimulate",
    ],
    [
      "terminal retry-in-progress status",
      (payload) => {
        payload.result = {
          ok: true,
          kind: "retry_in_progress",
          conversationId: SESSION_ID,
          turn: {
            turnId: "77777777-7777-4777-8777-777777777777",
            status: "completed",
            attempt: 1,
            duplicate: true,
          },
        };
      },
    ],
  ])(
    "fails closed on malformed 2xx data: %s",
    async (_label, mutate, endpoint = "startSession") => {
      const payload = endpointPayload(endpoint, clarifyingResult());
      mutate(payload);
      const fetchImpl = vi.fn(async () => jsonResponse(payload));
      const api = createCustomSettlementRuleApi({ fetchImpl });

      await expect(callEndpoint(api, endpoint)).rejects.toMatchObject({
        name: "CustomSettlementRuleApiError",
        code: "CUSTOM_RULE_RESPONSE_INVALID",
        message: "结算规则服务返回了无法识别的响应",
        retryable: true,
      });
    },
  );

  it("maps non-2xx errors to business-safe typed errors without raw details", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(
        {
          error: {
            code: "CUSTOM_RULE_AI_UNAVAILABLE",
            message: "provider sk-secret raw prompt stack",
            retryable: true,
          },
        },
        { status: 503 },
      ),
    );
    const api = createCustomSettlementRuleApi({ fetchImpl });

    let caught;
    try {
      await api.startSession({ projectId: PROJECT_ID, body: {} });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(CustomSettlementRuleApiError);
    expect(caught).toMatchObject({
      code: "CUSTOM_RULE_AI_UNAVAILABLE",
      status: 503,
      retryable: true,
      message: "AI 暂时不可用，请稍后重试",
    });
    expect(JSON.stringify(caught)).not.toContain("sk-secret");
    expect(caught.stack).not.toContain("provider sk-secret");
  });

  it("accepts uncovered records that were evaluated through an explicit default", async () => {
    const result = simulationResult();
    result.summary.coverage = {
      totalCount: 10,
      evaluatedCount: 10,
      ratePercent: "100.00",
    };
    result.summary.uncoveredCount = 2;
    result.summary.reviewRoutedCount = 0;
    result.simulation.summary = structuredClone(result.summary);
    const fetchImpl = vi.fn(async () => jsonResponse({ result }));
    const api = createCustomSettlementRuleApi({ fetchImpl });

    await expect(
      api.confirmAndSimulate({
        projectId: PROJECT_ID,
        sessionId: SESSION_ID,
        body: {},
      }),
    ).resolves.toMatchObject({
      result: {
        summary: {
          uncoveredCount: 2,
          coverage: { evaluatedCount: 10 },
        },
      },
    });
  });

  it("preserves an allowlisted Task8 protocol error code without its message", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(
        {
          error: {
            code: "CUSTOM_RULE_RESPONSE_INVALID",
            message: "provider stack raw prompt sk-protocol-secret",
            retryable: true,
          },
        },
        { status: 500 },
      ),
    );
    const api = createCustomSettlementRuleApi({ fetchImpl });

    await expect(
      api.startSession({ projectId: PROJECT_ID, body: {} }),
    ).rejects.toMatchObject({
      code: "CUSTOM_RULE_RESPONSE_INVALID",
      message: "结算规则服务返回了无法识别的响应",
      retryable: true,
    });
  });

  it("redacts unknown server codes independently from hostile messages", async () => {
    const codeSecret = "provider-code-sk-code-secret raw_prompt_dump";
    const messageSecret = "provider-message-sk-message-secret internal stack";
    const fetchImpl = vi.fn(async () =>
      jsonResponse(
        {
          error: {
            code: codeSecret,
            message: messageSecret,
            retryable: true,
          },
        },
        { status: 503 },
      ),
    );
    const api = createCustomSettlementRuleApi({ fetchImpl });

    let caught;
    try {
      await api.startSession({ projectId: PROJECT_ID, body: {} });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(CustomSettlementRuleApiError);
    expect(caught).toMatchObject({
      code: "CUSTOM_RULE_REQUEST_FAILED",
      status: 503,
      retryable: true,
      message: "结算规则服务暂时不可用，请稍后重试",
    });
    const visibleError = `${caught.code} ${caught.message} ${caught.stack} ${JSON.stringify(caught)}`;
    expect(visibleError).not.toContain("sk-code-secret");
    expect(visibleError).not.toContain("raw_prompt_dump");
    expect(visibleError).not.toContain("sk-message-secret");
    expect(visibleError).not.toContain("internal stack");
  });

  it("lists public rule versions without accepting private formula fields", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        rules: [
          {
            id: "44444444-4444-4444-8444-444444444444",
            projectId: PROJECT_ID,
            scope: "payable",
            target: { targetType: "project", targetId: null },
            executionGrain: "report",
            compositionMode: "replace",
            priority: 100,
            versionNumber: 2,
            status: "active",
            formulaHash: "a".repeat(64),
            contractHash: "b".repeat(64),
            parameterHash: "c".repeat(64),
            catalogHash: "d".repeat(64),
            dataSelectionHash: "e".repeat(64),
            simulationId: "55555555-5555-4555-8555-555555555555",
            effectiveFrom: "2026-07-12T00:00:00.000Z",
            effectiveUntil: null,
            createdBy: "22222222-2222-4222-8222-222222222222",
            approvedBy: "66666666-6666-4666-8666-666666666666",
            aiDraftId: null,
            reason: "审核通过",
            createdAt: "2026-07-12T00:00:00.000Z",
            approvedAt: "2026-07-12T01:00:00.000Z",
            archivedAt: null,
            effectiveNow: true,
            scheduled: false,
            primaryAction: { state: "active", action: "create_new_version" },
          },
        ],
      }),
    );
    const api = createCustomSettlementRuleApi({ fetchImpl });

    const result = await api.listRuleVersions({
      projectId: PROJECT_ID,
      status: "active",
    });

    expect(result.rules[0]).toMatchObject({
      status: "active",
      primaryAction: { action: "create_new_version" },
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      `/api/projects/${PROJECT_ID}/settlement-rules?status=active`,
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("requires apply-and-submit to return the version, copied simulation, and review event atomically", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(
        {
          rule: {
            id: "44444444-4444-4444-8444-444444444444",
            projectId: PROJECT_ID,
            scope: "payable",
            target: { targetType: "project", targetId: null },
            executionGrain: "report",
            compositionMode: "replace",
            priority: 100,
            versionNumber: 1,
            status: "pending_review",
            formulaHash: "a".repeat(64),
            contractHash: "b".repeat(64),
            parameterHash: "c".repeat(64),
            catalogHash: "d".repeat(64),
            dataSelectionHash: "e".repeat(64),
            simulationId: "55555555-5555-4555-8555-555555555555",
            effectiveFrom: "2026-07-12T00:00:00.000Z",
            effectiveUntil: null,
            createdBy: "22222222-2222-4222-8222-222222222222",
            approvedBy: null,
            aiDraftId: DRAFT_ID,
            reason: "提交审核",
            createdAt: "2026-07-12T00:00:00.000Z",
            approvedAt: null,
            archivedAt: null,
            primaryAction: { state: "pending_review", action: "approve" },
          },
          simulation: {
            id: "55555555-5555-4555-8555-555555555555",
            createdAt: "2026-07-12T00:00:00.000Z",
          },
          event: {
            id: "66666666-6666-4666-8666-666666666666",
            eventType: "submitted_for_review",
            actorId: "22222222-2222-4222-8222-222222222222",
            actorRole: "operator_business",
            reason: "提交审核",
            comment: null,
            beforeStatus: "draft",
            afterStatus: "pending_review",
            createdAt: "2026-07-12T00:00:00.000Z",
          },
        },
        { status: 201 },
      ),
    );
    const api = createCustomSettlementRuleApi({ fetchImpl });
    const body = {
      source: { kind: "ai_draft", id: DRAFT_ID },
      sourceSimulationId: "88888888-8888-4888-8888-888888888888",
      destinationVersionId: "44444444-4444-4444-8444-444444444444",
      destinationSimulationId: "55555555-5555-4555-8555-555555555555",
      scope: "payable",
      target: { targetType: "project", targetId: null },
      effectiveFrom: "2026-07-12T00:00:00.000Z",
      reason: "提交审核",
      clientRequestId: "submit-rule-0001",
    };

    await expect(
      api.applyAndSubmitRule({ projectId: PROJECT_ID, body }),
    ).resolves.toMatchObject({
      rule: { status: "pending_review" },
      simulation: { id: "55555555-5555-4555-8555-555555555555" },
      event: { afterStatus: "pending_review" },
    });
  });

  it("loads governance review events, reusable templates, and latest project session", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ events: [reviewEvent()] }))
      .mockResolvedValueOnce(
        jsonResponse({
          templates: [
            {
              kind: "system",
              id: "system:hourly:v1",
              name: "系统按小时模板",
              description: "系统内置模板",
              contract: contract(),
              readOnly: true,
            },
            {
              kind: "organization",
              id: "77777777-7777-4777-8777-777777777777",
              name: "机构按小时模板",
              description: "机构沉淀模板",
              sourceRuleVersionId: "44444444-4444-4444-8444-444444444444",
              sourceProjectId: PROJECT_ID,
              sourceVersionNumber: 2,
              sourceScope: "payable",
              executionGrain: "report",
              compositionMode: "replace",
              parameters: {
                hourly_rate: { type: "money_cents", amountCents: 10_000 },
                bonus_rate: { type: "rate_bps", rateBps: 1_250 },
              },
              contract: contract(),
              status: "active",
              createdBy: "22222222-2222-4222-8222-222222222222",
              createdAt: "2026-07-12T00:00:00.000Z",
              archivedAt: null,
              readOnly: false,
            },
          ],
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ session: completeV2SessionSummary() }));
    const api = createCustomSettlementRuleApi({ fetchImpl });

    await expect(
      api.listRuleReviewEvents({ projectId: PROJECT_ID }),
    ).resolves.toMatchObject({
      events: [{ eventType: "submitted_for_review" }],
    });
    await expect(api.listRuleTemplates()).resolves.toMatchObject({
      templates: [{ kind: "system" }, { kind: "organization" }],
    });
    await expect(
      api.getLatestProjectRuleSession({
        projectId: PROJECT_ID,
        scope: "payable",
        target: { targetType: "project", targetId: null },
      }),
    ).resolves.toMatchObject({
      session: { draft: { status: "simulated" } },
    });

    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      `/api/projects/${PROJECT_ID}/settlement-rules/review-events`,
      expect.objectContaining({ method: "GET" }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      "/api/settlement-rule-templates",
      expect.objectContaining({ method: "GET" }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      3,
      `/api/projects/${PROJECT_ID}/settlement-rules/ai-sessions/latest?scope=payable&targetType=project`,
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("reopens requested changes as a draft and validates nullable lifecycle events", async () => {
    const reopened = governanceRule({
      status: "draft",
      primaryAction: { state: "draft", action: "apply_and_submit" },
    });
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        rule: reopened,
        simulation: {
          id: "55555555-5555-4555-8555-555555555555",
          createdAt: "2026-07-12T00:00:00.000Z",
        },
        event: null,
      }),
    );
    const api = createCustomSettlementRuleApi({ fetchImpl });

    await expect(
      api.reopenRuleDraft({
        projectId: PROJECT_ID,
        ruleVersionId: reopened.id,
        body: {
          reason: "按审核意见修改",
          clientRequestId: "reopen-rule-0001",
        },
      }),
    ).resolves.toMatchObject({
      rule: { id: reopened.id, status: "draft" },
      event: null,
    });
  });

  it("rejects an incomplete atomic apply-and-submit response", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        rule: {
          id: "44444444-4444-4444-8444-444444444444",
          projectId: PROJECT_ID,
          scope: "payable",
          target: { targetType: "project", targetId: null },
          executionGrain: "report",
          compositionMode: "replace",
          priority: 100,
          versionNumber: 1,
          status: "pending_review",
          formulaHash: "a".repeat(64),
          contractHash: "b".repeat(64),
          parameterHash: "c".repeat(64),
          catalogHash: "d".repeat(64),
          dataSelectionHash: "e".repeat(64),
          simulationId: "55555555-5555-4555-8555-555555555555",
          effectiveFrom: "2026-07-12T00:00:00.000Z",
          effectiveUntil: null,
          createdBy: "22222222-2222-4222-8222-222222222222",
          approvedBy: null,
          aiDraftId: DRAFT_ID,
          reason: "提交审核",
          createdAt: "2026-07-12T00:00:00.000Z",
          approvedAt: null,
          archivedAt: null,
          primaryAction: { state: "pending_review", action: "approve" },
        },
        simulation: {
          id: "55555555-5555-4555-8555-555555555555",
          createdAt: "2026-07-12T00:00:00.000Z",
        },
      }),
    );
    const api = createCustomSettlementRuleApi({ fetchImpl });

    await expect(
      api.applyAndSubmitRule({
        projectId: PROJECT_ID,
        body: {
          source: { kind: "ai_draft", id: DRAFT_ID },
          sourceSimulationId: "88888888-8888-4888-8888-888888888888",
          destinationVersionId: "44444444-4444-4444-8444-444444444444",
          destinationSimulationId: "55555555-5555-4555-8555-555555555555",
          scope: "payable",
          target: { targetType: "project", targetId: null },
          effectiveFrom: "2026-07-12T00:00:00.000Z",
          reason: "提交审核",
          clientRequestId: "submit-rule-0001",
        },
      }),
    ).rejects.toMatchObject({ code: "CUSTOM_RULE_RESPONSE_INVALID" });
  });

  it("lists settlement groups and changes assignment through the group endpoints", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          groups: [
            {
              id: "77777777-7777-4777-8777-777777777777",
              projectId: PROJECT_ID,
              name: "高优先级主播",
              description: "人工维护的显式结算分组",
              status: "active",
              createdBy: "22222222-2222-4222-8222-222222222222",
              createdAt: "2026-07-12T00:00:00.000Z",
              archivedAt: null,
              assignmentCount: 2,
              activeRuleCount: 1,
              pendingRuleCount: 0,
              futureAssignmentCount: 0,
              unassignedProjectStreamers: [],
              baseRuleCoveredProjectStreamerIds: [],
              assignmentConflict: {
                blocking: true,
                blockingCodes: ["same_priority_overlap"],
                orderedRuleIds: [
                  "44444444-4444-4444-8444-444444444444",
                  "55555555-5555-4555-8555-555555555555",
                ],
                message: "该主播在同一时间已有更高优先级分组规则",
              },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          assignmentChange: {
            insertedAssignment: {
              id: "99999999-9999-4999-8999-999999999999",
              projectId: PROJECT_ID,
              projectStreamerId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
              groupId: "77777777-7777-4777-8777-777777777777",
              effectiveFrom: "2026-07-13T00:00:00.000Z",
              effectiveUntil: null,
              assignedBy: "22222222-2222-4222-8222-222222222222",
              reason: "调整分组",
              createdAt: "2026-07-12T00:00:00.000Z",
            },
            closedAssignmentIds: [],
            newGroupSnapshotHash: "f".repeat(64),
          },
        }),
      );
    const api = createCustomSettlementRuleApi({ fetchImpl });

    await expect(
      api.listSettlementRuleGroups({ projectId: PROJECT_ID }),
    ).resolves.toMatchObject({
      groups: [
        {
          assignmentCount: 2,
          assignmentConflict: { blockingCodes: ["same_priority_overlap"] },
        },
      ],
    });
    await expect(
      api.changeSettlementGroupAssignment({
        projectId: PROJECT_ID,
        groupId: "77777777-7777-4777-8777-777777777777",
        body: {
          projectStreamerId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          effectiveFrom: "2026-07-13T00:00:00.000Z",
          reason: "调整分组",
          clientRequestId: "assign-group-0001",
        },
      }),
    ).resolves.toMatchObject({
      assignmentChange: { newGroupSnapshotHash: "f".repeat(64) },
    });
  });
});
