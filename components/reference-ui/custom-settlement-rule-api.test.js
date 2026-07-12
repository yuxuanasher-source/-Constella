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
  };
}

function simulationResult() {
  return {
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
}

function simulatedSessionSummary(overrides = {}) {
  const result = simulationResult();
  return {
    ...sessionSummary(),
    draft: result.draft,
    simulation: result.simulation,
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
          sampleSelection: { sampledCount: 10 },
          coverage: { totalRecords: 10 },
          historicalTotals: { recordCount: 10 },
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
        result.simulation.largestChanges = [
          {
            dimension: "scenario",
            key: "authorized_ordinal:000001",
            deltaAmountYuan: deltaYuan,
            direction,
          },
        ];
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
        result.simulation.largestChanges = [
          {
            dimension: "scenario",
            key: "authorized_ordinal:000001",
            deltaAmountYuan: "Infinity",
            direction: "increase",
          },
        ];
      },
    },
    {
      label: "persisted refresh change exponent",
      endpoint: "refreshSession",
      mutate(result) {
        result.simulation.largestChanges = [
          {
            dimension: "scenario",
            key: "authorized_ordinal:000001",
            deltaAmountYuan: "1e3",
            direction: "increase",
          },
        ];
      },
    },
    {
      label: "persisted unchanged sign comparison with malformed sign",
      endpoint: "refreshSession",
      mutate(result) {
        result.simulation.largestChanges = [
          {
            dimension: "scenario",
            key: "authorized_ordinal:000001",
            deltaAmountYuan: "--0.00",
            direction: "unchanged",
          },
        ];
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
    result.simulation.largestChanges = [
      {
        dimension: "scenario",
        key: "authorized_ordinal:000001",
        deltaAmountYuan: "92233720368547758.07",
        direction: "increase",
      },
      {
        dimension: "scenario",
        key: "authorized_ordinal:000002",
        deltaAmountYuan: "-92233720368547758.08",
        direction: "decrease",
      },
      {
        dimension: "scenario",
        key: "authorized_ordinal:000003",
        deltaAmountYuan: "0.00",
        direction: "unchanged",
      },
    ];
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
          largestChanges: expect.arrayContaining([
            expect.objectContaining({
              direction: "unchanged",
              deltaAmountYuan: "0.00",
            }),
          ]),
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
        payload.result.simulation.deltas.payableAmountYuan = "1e3";
      },
      "confirmAndSimulate",
    ],
    [
      "invalid simulation count invariant",
      (payload) => {
        payload.result = simulationResult();
        payload.result.simulation.coverage.skippedRecords = 9;
      },
      "confirmAndSimulate",
    ],
    [
      "sample count does not match persisted coverage",
      (payload) => {
        payload.result = simulationResult();
        payload.result.simulation.sampleSelection.sampledCount = 9;
      },
      "confirmAndSimulate",
    ],
    [
      "historical count does not match persisted coverage",
      (payload) => {
        payload.result = simulationResult();
        payload.result.simulation.historicalTotals.recordCount = 9;
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
    result.simulation.coverage = {
      totalRecords: 10,
      evaluatedRecords: 10,
      skippedRecords: 0,
    };
    result.summary.coverage = {
      totalCount: 10,
      evaluatedCount: 10,
      ratePercent: "100.00",
    };
    result.summary.uncoveredCount = 2;
    result.summary.reviewRoutedCount = 0;
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
});
