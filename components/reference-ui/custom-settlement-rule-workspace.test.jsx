import { readFileSync } from "node:fs";

import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CustomSettlementRuleApiError } from "./custom-settlement-rule-api";
import CustomSettlementRuleWorkspace from "./custom-settlement-rule-workspace";

const PROJECT_ID = "33333333-3333-4333-8333-333333333333";
const SESSION_ID = "44444444-4444-4444-8444-444444444444";
const DRAFT_ID = "55555555-5555-4555-8555-555555555555";

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
      {
        name: "bonus_rate",
        description: "达标奖励比例",
        valueType: { kind: "scalar", scalarType: "rate_bps" },
        userFacingUnit: "%",
        defaultValue: { type: "rate_bps", rateBps: 1_250 },
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

function draft(status = "clarifying", overrides = {}) {
  const simulated = status === "simulated";
  const failed = status === "failed";
  return {
    id: DRAFT_ID,
    conversationId: SESSION_ID,
    revisionNumber: 1,
    status,
    initialStatus: simulated
      ? "contract_ready"
      : failed
        ? "failed"
        : "clarifying",
    businessContract: contract(),
    unresolvedAmbiguities:
      simulated || failed
        ? []
        : [
            {
              code: "hourly_rate",
              question: "每小时按多少元结算？",
              required: true,
            },
          ],
    variableCatalogVersion: "a".repeat(64),
    generatedFormula: simulated
      ? {
          expression:
            'money_result({ final: parameter("hourly_rate") * system_minutes })',
        }
      : null,
    generatedExplanation: simulated ? "按系统直播时长和已确认单价计算。" : null,
    generatedTestCases: simulated ? [generatedTestCase()] : [],
    safetyFlags: [],
    contractHash: "b".repeat(64),
    formulaHash: simulated ? "c".repeat(64) : null,
    parameterHash: "d".repeat(64),
    createdAt: "2026-07-12T01:00:00.000Z",
    supersedesDraftId: null,
    supersededByDraftId: null,
    supersededAt: null,
    ...overrides,
  };
}

function confirmableDraft(overrides = {}) {
  return draft("clarifying", {
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

function resultFor(nextDraft, overrides = {}) {
  return {
    ok: true,
    kind: "clarifying",
    conversationId: SESSION_ID,
    draft: nextDraft,
    diff: [],
    duplicate: false,
    ...overrides,
  };
}

function claimedSession() {
  return {
    id: SESSION_ID,
    title: "项目主播结算规则",
    status: "active",
    lastMessageAt: "2026-07-12T01:00:00.000Z",
    createdAt: "2026-07-12T01:00:00.000Z",
    updatedAt: "2026-07-12T01:00:00.000Z",
  };
}

function startEnvelope(nextDraft, resultOverrides = {}) {
  return {
    session: claimedSession(),
    result: resultFor(nextDraft, resultOverrides),
  };
}

function catalog(hasHistory = true, overrides = {}) {
  return {
    catalog: {
      scope: "payable",
      executionGrain: "report",
      businessTimezone: "Asia/Shanghai",
      businessTimezoneConfirmed: true,
      businessTimezoneSource: "contract_default",
      hasHistory,
      version: "a".repeat(64),
      variables: [
        {
          id: "system_minutes",
          label: "系统直播时长",
          runtimeType: { kind: "scalar", scalarType: "integer" },
          unit: "分钟",
          sourceLabel: "直播报告",
          availability: "available",
          coverageNumerator: 20,
          coverageDenominator: 20,
          latestSampledPeriod: {
            start: "2026-07-01",
            end: "2026-07-31",
          },
        },
      ],
      ...overrides,
    },
  };
}

function simulationEnvelope({ noHistory = false } = {}) {
  const simulatedDraft = draft("simulated", { revisionNumber: 3 });
  return {
    result: {
      ok: true,
      kind: "simulated",
      conversationId: SESSION_ID,
      draft: simulatedDraft,
      simulation: {
        id: "66666666-6666-4666-8666-666666666666",
        createdAt: "2026-07-12T01:02:00.000Z",
        dataSelectionHash: "e".repeat(64),
        sampleSource: { kind: "approved_operations" },
        sampleSelection: {
          periodStart: "2026-07-01",
          periodEnd: "2026-07-31",
          populationCount: 20,
          sampledCount: 20,
          criteria: ["approved_reports"],
        },
        coverage: { totalRecords: 20, evaluatedRecords: 18, skippedRecords: 2 },
        scenarios: [{ name: "标准场景", kind: "normal", result: "passed" }],
        historicalTotals: {
          payableAmountYuan: noHistory ? null : "1000.00",
          receivableAmountYuan: null,
          recordCount: 20,
        },
        deltas: {
          payableAmountYuan: "125.00",
          receivableAmountYuan: "0.00",
          percentagePercent: "12.50",
        },
        largestChanges: [],
        warnings: [],
      },
      summary: {
        recordCount: 20,
        coverage: { totalCount: 20, evaluatedCount: 18, ratePercent: "90.00" },
        uncoveredCount: 2,
        zeroPayCount: 3,
        reviewRoutedCount: 2,
        blockedCount: 0,
        largestIncreases: [
          {
            bucket: "authorized_ordinal:000001",
            deltaYuan: "80.00",
            direction: "increase",
          },
        ],
        largestDecreases: [
          {
            bucket: "authorized_ordinal:000002",
            deltaYuan: "-30.00",
            direction: "decrease",
          },
        ],
        totalOldYuan: noHistory ? null : "1000.00",
        totalNewYuan: "1125.00",
        totalDeltaYuan: noHistory ? null : "125.00",
        marginImpactYuan: "-125.00",
        historicalVerification: {
          status: noHistory ? "unverified" : "verified",
          label: noHistory ? "未经过历史数据验证" : "已通过历史数据验证",
        },
        dataSelectionHash: "e".repeat(64),
        riskFlags: [
          { code: "ZERO_PAY", severity: "warning", message: "存在零金额记录" },
        ],
        warnings: [
          { code: "LOW_COVERAGE", severity: "info", message: "两条记录未覆盖" },
        ],
        scenarios: [
          {
            id: "scenario:000001",
            category: "contract_example",
            outcome: "calculated",
            amountYuan: "1125.00",
            expectedAmountYuan: "1125.00",
            passed: true,
          },
        ],
      },
      duplicate: false,
    },
  };
}

function authoritativeSession(nextDraft, simulation = null) {
  return {
    session: {
      conversation: claimedSession(),
      messages: [],
      turns: [],
      draft: nextDraft,
      simulation,
    },
  };
}

function conversationTurn(status, overrides = {}) {
  return {
    id: "77777777-7777-4777-8777-777777777777",
    conversationId: SESSION_ID,
    userMessageId: "88888888-8888-4888-8888-888888888888",
    assistantMessageId: "99999999-9999-4999-8999-999999999999",
    mode: "deep",
    status,
    attempt: 1,
    retryOfTurnId: null,
    regenerateOfTurnId: null,
    errorCode: null,
    retryable: false,
    ...overrides,
  };
}

function authoritativeSessionWithTurns(nextDraft, turns, simulation = null) {
  const envelope = authoritativeSession(nextDraft, simulation);
  envelope.session.turns = turns;
  return envelope;
}

function persistedSimulation(overrides = {}) {
  return {
    id: "66666666-6666-4666-8666-666666666666",
    createdAt: "2026-07-12T01:02:00.000Z",
    dataSelectionHash: "e".repeat(64),
    sampleSource: { kind: "historical_settlements" },
    sampleSelection: {
      periodStart: "2026-07-01",
      periodEnd: "2026-07-31",
      populationCount: 20,
      sampledCount: 20,
      criteria: [
        "approved_reports",
        "selection_token_sha256:" + "f".repeat(64),
      ],
    },
    coverage: { totalRecords: 20, evaluatedRecords: 18, skippedRecords: 2 },
    scenarios: [{ name: "scenario:000001", kind: "normal", result: "passed" }],
    historicalTotals: {
      payableAmountYuan: "1000.00",
      receivableAmountYuan: null,
      recordCount: 20,
    },
    deltas: {
      payableAmountYuan: "125.00",
      receivableAmountYuan: "0.00",
      percentagePercent: "12.50",
    },
    largestChanges: [
      {
        dimension: "period",
        key: "authorized_ordinal:000001",
        deltaAmountYuan: "80.00",
        direction: "increase",
      },
      {
        dimension: "period",
        key: "authorized_ordinal:000002",
        deltaAmountYuan: "-30.00",
        direction: "decrease",
      },
    ],
    warnings: [
      {
        code: "CUSTOM_RULE_INCOMPLETE_COVERAGE",
        severity: "warning",
        message: "两条记录需要复核",
      },
    ],
    ...overrides,
  };
}

function api(overrides = {}) {
  return {
    abortActive: vi.fn(),
    getVariableCatalog: vi.fn(({ scope, executionGrain }) =>
      Promise.resolve(catalog(true, { scope, executionGrain })),
    ),
    startSession: vi.fn().mockResolvedValue(startEnvelope(draft())),
    refreshSession: vi
      .fn()
      .mockResolvedValue(authoritativeSession(confirmableDraft())),
    answerOrRevise: vi.fn().mockResolvedValue({ result: resultFor(draft()) }),
    confirmAndSimulate: vi.fn().mockResolvedValue(simulationEnvelope()),
    ...overrides,
  };
}

function renderWorkspace(apiClient = api(), props = {}) {
  return render(
    <CustomSettlementRuleWorkspace
      project={{ id: PROJECT_ID, name: "星火项目" }}
      period={{ start: "2026-07-01", end: "2026-07-31" }}
      target={{ targetType: "project", targetId: null }}
      api={apiClient}
      createRequestId={(operation) => `task9:${operation}:0001`}
      {...props}
    />,
  );
}

function expectOnePrimary(name) {
  const primary = document.querySelectorAll('[data-primary-action="true"]');
  expect(primary).toHaveLength(1);
  expect(primary[0]).toHaveAccessibleName(name);
}

async function startRule(prompt = "每场按直播时长和单价结算") {
  const payableScope = screen.getByRole("button", { name: "主播应付" });
  if (payableScope.getAttribute("aria-pressed") !== "true") {
    fireEvent.click(payableScope);
  }
  await waitFor(() =>
    expect(screen.getByLabelText("规则说明")).not.toBeDisabled(),
  );
  fireEvent.change(screen.getByLabelText("规则说明"), {
    target: { value: prompt },
  });
  fireEvent.click(screen.getByRole("button", { name: "开始澄清" }));
}

describe("CustomSettlementRuleWorkspace", () => {
  it("offers only Phase 1 business scopes on a full-width operational surface", async () => {
    const apiClient = api({
      getVariableCatalog: vi.fn(({ scope, executionGrain }) =>
        Promise.resolve(catalog(false, { scope, executionGrain })),
      ),
    });
    renderWorkspace(apiClient);

    expect(
      screen.getByRole("button", { name: "客户应收" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "主播应付" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("项目成本")).not.toBeInTheDocument();
    expect(screen.queryByText("风险校验")).not.toBeInTheDocument();
    expect(screen.queryByText("应用并提交审核")).not.toBeInTheDocument();
    expect(screen.getByTestId("custom-rule-workspace")).toHaveAttribute(
      "data-layout",
      "full-width",
    );
    expect(await screen.findByText("无历史数据")).toBeInTheDocument();
    expectOnePrimary("开始澄清");
  });

  it("shows one focused AI question and highlights every unresolved contract field", async () => {
    const clarifying = draft("clarifying", {
      unresolvedAmbiguities: [
        {
          code: "hourly_rate",
          question: "每小时按多少元结算？",
          required: true,
        },
        {
          code: "effective_period",
          question: "规则从哪天开始？",
          required: true,
        },
      ],
    });
    const apiClient = api({
      startSession: vi.fn().mockResolvedValue(startEnvelope(clarifying)),
    });
    renderWorkspace(apiClient);

    await startRule();

    const question = await screen.findByRole("heading", {
      name: "每小时按多少元结算？",
    });
    expect(question).toHaveFocus();
    expect(screen.queryByText("规则从哪天开始？")).not.toBeInTheDocument();
    expect(screen.getByTestId("contract-field-parameters")).toHaveAttribute(
      "data-unresolved",
      "true",
    );
    expect(
      screen.getByTestId("contract-field-effectiveStartAt"),
    ).toHaveAttribute("data-unresolved", "true");
    expectOnePrimary("回复 AI");
    expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite");
  });

  it("derives confirmation readiness from the real clarifying confirmation DTO", async () => {
    const ready = confirmableDraft();
    const apiClient = api({
      startSession: vi.fn().mockResolvedValue(startEnvelope(ready)),
    });
    renderWorkspace(apiClient);

    await startRule();

    const heading = await screen.findByRole("heading", {
      name: "业务规则草案",
    });
    expect(heading).toHaveFocus();
    expect(
      screen.queryByText("请确认以上业务规则无误？"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("confirm_contract")).not.toBeInTheDocument();
    expect(screen.queryByText("当前问题")).not.toBeInTheDocument();
    const normal = screen.getByTestId("business-contract");
    expect(normal).toHaveTextContent("¥100.00");
    expect(normal).toHaveTextContent("12.50%");
    expect(normal).not.toHaveTextContent(
      /amountCents|rateBps|hourly_rate|system_minutes/u,
    );

    const aiDraft = screen.getByRole("region", { name: "AI 业务草案" });
    expect(aiDraft).toHaveAttribute("data-source", "ai");
    expect(
      screen.queryByRole("region", { name: "确定性引擎解释" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("advanced-formula")).not.toBeInTheDocument();
    expect(screen.getByTestId("contract-field-summary")).toHaveAttribute(
      "data-unresolved",
      "false",
    );
    expectOnePrimary("确认业务规则并试算");
  });

  it("keeps the exact authoritative formula collapsed until advanced mode opens", async () => {
    const ready = confirmableDraft();
    const expression =
      'money_result({ final: parameter("hourly_rate") * system_minutes })';
    const apiClient = api({
      startSession: vi.fn().mockResolvedValue(startEnvelope(ready)),
      confirmAndSimulate: vi.fn().mockResolvedValue(simulationEnvelope()),
    });
    renderWorkspace(apiClient);

    await startRule();
    await screen.findByRole("heading", { name: "业务规则草案" });
    fireEvent.click(screen.getByRole("button", { name: "确认业务规则并试算" }));
    await screen.findByRole("heading", { name: "内部试算结果" });

    const advanced = screen.getByTestId("advanced-formula");
    const formula = screen.getByLabelText("高级公式内容");
    expect(advanced).not.toHaveAttribute("open");
    expect(formula).toHaveTextContent(expression);
    expect(formula).not.toBeVisible();
    expect(formula.tagName).toBe("PRE");
    expect(within(advanced).queryByRole("textbox")).not.toBeInTheDocument();

    fireEvent.click(within(advanced).getByText("高级公式"));

    expect(advanced).toHaveAttribute("open");
    expect(formula).toBeVisible();
    expect(screen.queryByText("应用并提交审核")).not.toBeInTheDocument();
    const aiDraft = screen.getByRole("region", { name: "AI 业务草案" });
    const engine = screen.getByRole("region", { name: "确定性引擎解释" });
    expect(aiDraft).toHaveAttribute("data-source", "ai");
    expect(engine).toHaveAttribute("data-source", "deterministic-engine");
    expect(engine).not.toEqual(aiDraft);
    expectOnePrimary("修改规则");
  });

  it("renders the authoritative natural-language revision diff and names preserved fields", async () => {
    const first = draft();
    const revisedContract = contract({
      title: "项目主播阶梯计费",
      summary: "按系统时长分档计算主播应付金额。",
    });
    const revised = confirmableDraft({
      revisionNumber: 2,
      businessContract: revisedContract,
    });
    const apiClient = api({
      startSession: vi.fn().mockResolvedValue(startEnvelope(first)),
      answerOrRevise: vi.fn().mockResolvedValue({
        result: resultFor(revised, {
          diff: [
            {
              field: "title",
              before: "项目主播按场计费",
              after: "项目主播阶梯计费",
            },
            {
              field: "summary",
              before: "每场直播按系统时长计算主播应付金额。",
              after: "按系统时长分档计算主播应付金额。",
            },
          ],
        }),
      }),
    });
    renderWorkspace(apiClient);
    await startRule();
    await screen.findByRole("heading", { name: "每小时按多少元结算？" });

    fireEvent.change(screen.getByLabelText("回复 AI"), {
      target: { value: "按两个时长档位计算，其他条件不变" },
    });
    fireEvent.click(screen.getByRole("button", { name: "回复 AI" }));

    const diff = await screen.findByRole("region", { name: "本轮修改" });
    expect(diff).toHaveTextContent("规则名称");
    expect(diff).toHaveTextContent("项目主播按场计费");
    expect(diff).toHaveTextContent("项目主播阶梯计费");
    expect(diff).toHaveTextContent("保持不变");
    expect(diff).toHaveTextContent("适用范围");
    expect(screen.getByTestId("contract-field-scope")).toHaveTextContent(
      "主播应付",
    );
    expect(
      screen.getByTestId("contract-field-executionGrain"),
    ).toHaveTextContent("按直播报告逐条计算");
    expect(apiClient.answerOrRevise).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: PROJECT_ID,
        sessionId: SESSION_ID,
        body: {
          expectedDraftId: DRAFT_ID,
          expectedRevisionNumber: 1,
          clientRequestId: "task9:answer:0001",
          promptText: "按两个时长档位计算，其他条件不变",
        },
        signal: expect.any(AbortSignal),
      }),
    );
    expectOnePrimary("确认业务规则并试算");
  });

  it("confirms the real clarifying DTO and renders every authoritative simulation value", async () => {
    const ready = confirmableDraft();
    const apiClient = api({
      startSession: vi.fn().mockResolvedValue(startEnvelope(ready)),
      confirmAndSimulate: vi.fn().mockResolvedValue(simulationEnvelope()),
    });
    renderWorkspace(apiClient);
    await startRule();
    await screen.findByRole("heading", { name: "业务规则草案" });

    fireEvent.click(screen.getByRole("button", { name: "确认业务规则并试算" }));

    const heading = await screen.findByRole("heading", {
      name: "内部试算结果",
    });
    expect(heading).toHaveFocus();
    const simulation = screen.getByRole("region", { name: "内部试算" });
    expect(simulation).toHaveTextContent("当前金额");
    expect(simulation).toHaveTextContent("新规则金额");
    expect(simulation).toHaveTextContent("差额");
    expect(simulation).toHaveTextContent("覆盖率");
    expect(simulation).toHaveTextContent("零金额");
    expect(simulation).toHaveTextContent("转人工复核");
    expect(simulation).toHaveTextContent("最大增加");
    expect(simulation).toHaveTextContent("最大减少");
    expect(simulation).toHaveTextContent("风险");
    expect(simulation).toHaveTextContent("提醒");
    expect(screen.getByText("当前金额").parentElement).toHaveTextContent(
      "¥1,000.00",
    );
    expect(screen.getByText("新规则金额").parentElement).toHaveTextContent(
      "¥1,125.00",
    );
    expect(screen.getByText("差额").parentElement).toHaveTextContent("¥125.00");
    expect(screen.getByText("覆盖率").parentElement).toHaveTextContent(
      "90.00%",
    );
    expect(screen.getByText("覆盖率").parentElement).toHaveTextContent(
      "18/20 条",
    );
    expect(screen.getByText("零金额").parentElement).toHaveTextContent("3 条");
    expect(
      within(simulation).getByText("转人工复核").parentElement,
    ).toHaveTextContent("2 条");
    expect(simulation).toHaveTextContent("第 1 条变更");
    expect(simulation).toHaveTextContent("¥80.00");
    expect(simulation).toHaveTextContent("第 2 条变更");
    expect(simulation).toHaveTextContent("-¥30.00");
    expect(simulation).toHaveTextContent("存在零金额记录");
    expect(simulation).toHaveTextContent("两条记录未覆盖");
    expect(simulation).toHaveTextContent("已通过历史数据验证");
    expect(simulation).not.toHaveTextContent("authorized_ordinal");
    expect(simulation).not.toHaveTextContent("无历史数据");
    expect(simulation).toHaveTextContent("内部预览");
    expect(screen.queryByText("应用并提交审核")).not.toBeInTheDocument();
    expectOnePrimary("修改规则");
    expect(apiClient.confirmAndSimulate).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      sessionId: SESSION_ID,
      body: {
        expectedDraftId: DRAFT_ID,
        expectedRevisionNumber: 1,
        clientRequestId: "task9:confirm:0001",
        promptText: "确认当前业务规则并进行内部试算",
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
      },
      signal: expect.any(AbortSignal),
    });
  });

  it("refreshes from the authoritative session and focuses the new result", async () => {
    const first = draft();
    const refreshed = confirmableDraft({ revisionNumber: 4 });
    const apiClient = api({
      startSession: vi.fn().mockResolvedValue(startEnvelope(first)),
      refreshSession: vi
        .fn()
        .mockResolvedValue(authoritativeSession(refreshed)),
    });
    renderWorkspace(apiClient);
    await startRule();
    await screen.findByRole("heading", { name: "每小时按多少元结算？" });

    fireEvent.click(screen.getByRole("button", { name: "刷新会话" }));

    const heading = await screen.findByRole("heading", {
      name: "业务规则草案",
    });
    expect(heading).toHaveFocus();
    expect(screen.queryByText("每小时按多少元结算？")).not.toBeInTheDocument();
    expect(apiClient.refreshSession).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      sessionId: SESSION_ID,
      signal: expect.any(AbortSignal),
    });
  });

  it("refreshes a superseded answer replay before choosing the current UI state", async () => {
    const superseded = draft("clarifying", {
      revisionNumber: 2,
      status: "superseded",
      businessContract: contract({ title: "已被后续修订替代的规则" }),
      supersededByDraftId: "77777777-7777-4777-8777-777777777777",
      supersededAt: "2026-07-12T01:03:00.000Z",
    });
    const latest = confirmableDraft({
      id: "77777777-7777-4777-8777-777777777777",
      revisionNumber: 3,
      businessContract: contract({ title: "权威最新结算规则" }),
      supersedesDraftId: DRAFT_ID,
    });
    const apiClient = api({
      startSession: vi.fn().mockResolvedValue(startEnvelope(draft())),
      answerOrRevise: vi.fn().mockResolvedValue({
        result: resultFor(superseded, { duplicate: true }),
      }),
      refreshSession: vi.fn().mockResolvedValue(authoritativeSession(latest)),
    });
    renderWorkspace(apiClient);
    await startRule();
    await screen.findByRole("heading", { name: "每小时按多少元结算？" });

    fireEvent.change(screen.getByLabelText("回复 AI"), {
      target: { value: "按最新业务口径继续" },
    });
    fireEvent.click(screen.getByRole("button", { name: "回复 AI" }));

    expect(
      await screen.findByRole("heading", { name: "业务规则草案" }),
    ).toHaveFocus();
    expect(screen.getByText("权威最新结算规则")).toBeInTheDocument();
    expect(
      screen.queryByText("已被后续修订替代的规则"),
    ).not.toBeInTheDocument();
    expect(apiClient.refreshSession).toHaveBeenCalledTimes(1);
    expect(apiClient.answerOrRevise).toHaveBeenCalledTimes(1);
    expectOnePrimary("确认业务规则并试算");
  });

  it("ignores a stale start response after the scope changes", async () => {
    let resolveStart;
    const apiClient = api({
      startSession: vi.fn().mockReturnValue(
        new Promise((resolve) => {
          resolveStart = resolve;
        }),
      ),
    });
    renderWorkspace(apiClient);
    await startRule();
    expectOnePrimary("正在生成…");

    fireEvent.click(screen.getByRole("button", { name: "客户应收" }));
    resolveStart(startEnvelope(draft()));

    await waitFor(() => expect(apiClient.abortActive).toHaveBeenCalled());
    await waitFor(() => expectOnePrimary("开始澄清"));
    expect(screen.queryByText("每小时按多少元结算？")).not.toBeInTheDocument();
  });

  it("focuses a business-safe error and retries with one primary action", async () => {
    const failure = new CustomSettlementRuleApiError({
      code: "CUSTOM_RULE_AI_UNAVAILABLE",
      status: 503,
      retryable: true,
      message: "AI 暂时不可用，请稍后重试",
    });
    const apiClient = api({
      startSession: vi
        .fn()
        .mockRejectedValueOnce(failure)
        .mockResolvedValueOnce(startEnvelope(draft())),
    });
    renderWorkspace(apiClient);
    await startRule("包含敏感业务金额的规则说明");

    const errorHeading = await screen.findByRole("heading", {
      name: "无法继续处理",
    });
    expect(errorHeading).toHaveFocus();
    expect(screen.getByText("AI 暂时不可用，请稍后重试")).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent("provider");
    expectOnePrimary("重试");

    fireEvent.click(screen.getByRole("button", { name: "重试" }));

    const question = await screen.findByRole("heading", {
      name: "每小时按多少元结算？",
    });
    expect(question).toHaveFocus();
    expect(apiClient.startSession).toHaveBeenCalledTimes(2);
    expectOnePrimary("回复 AI");
  });

  it("renders exact authoritative persisted simulation metrics without fabricating missing ones", async () => {
    const first = draft();
    const refreshed = draft("simulated", { revisionNumber: 4 });
    const apiClient = api({
      startSession: vi.fn().mockResolvedValue(startEnvelope(first)),
      refreshSession: vi
        .fn()
        .mockResolvedValue(
          authoritativeSessionWithTurns(
            refreshed,
            [conversationTurn("completed")],
            persistedSimulation(),
          ),
        ),
    });
    renderWorkspace(apiClient);
    await startRule();
    await screen.findByRole("heading", { name: "每小时按多少元结算？" });

    fireEvent.click(screen.getByRole("button", { name: "刷新会话" }));

    const simulation = await screen.findByRole("region", { name: "内部试算" });
    expect(screen.getByRole("heading", { name: "内部试算结果" })).toHaveFocus();
    expect(screen.getByText("当前金额").parentElement).toHaveTextContent(
      "¥1,000.00",
    );
    expect(screen.getByText("新规则金额").parentElement).toHaveTextContent(
      "服务端未提供",
    );
    expect(screen.getByText("差额").parentElement).toHaveTextContent("¥125.00");
    expect(screen.getByText("覆盖率").parentElement).toHaveTextContent(
      "服务端未提供",
    );
    expect(screen.getByText("覆盖率").parentElement).toHaveTextContent(
      "18/20 条",
    );
    expect(screen.getByText("零金额").parentElement).toHaveTextContent(
      "服务端未提供",
    );
    expect(
      within(simulation).getByText("转人工复核").parentElement,
    ).toHaveTextContent("服务端未提供");
    expect(simulation).toHaveTextContent("第 1 条变更");
    expect(simulation).toHaveTextContent("¥80.00");
    expect(simulation).toHaveTextContent("第 2 条变更");
    expect(simulation).toHaveTextContent("-¥30.00");
    expect(simulation).toHaveTextContent("两条记录需要复核");
    expect(screen.getByText("风险").parentElement).toHaveTextContent(
      "服务端未提供",
    );
    expect(simulation).not.toHaveTextContent("已通过历史数据验证");
    expect(simulation).not.toHaveTextContent("无新增风险");
    expect(simulation).not.toHaveTextContent("authorized_ordinal");
    expectOnePrimary("修改规则");
  });

  it("uses the authoritative no-history marker after session refresh", async () => {
    const noHistorySimulation = persistedSimulation({
      sampleSource: { kind: "approved_operations" },
      historicalTotals: {
        payableAmountYuan: null,
        receivableAmountYuan: null,
        recordCount: 20,
      },
      deltas: {
        payableAmountYuan: "0.00",
        receivableAmountYuan: "0.00",
        percentagePercent: "0.00",
      },
    });
    const apiClient = api({
      startSession: vi.fn().mockResolvedValue(startEnvelope(draft())),
      refreshSession: vi
        .fn()
        .mockResolvedValue(
          authoritativeSessionWithTurns(
            draft("simulated", { revisionNumber: 4 }),
            [conversationTurn("completed")],
            noHistorySimulation,
          ),
        ),
    });
    renderWorkspace(apiClient);
    await startRule();
    await screen.findByRole("heading", { name: "每小时按多少元结算？" });

    fireEvent.click(screen.getByRole("button", { name: "刷新会话" }));

    const simulation = await screen.findByRole("region", { name: "内部试算" });
    expect(simulation).toHaveTextContent("无历史数据");
    expect(screen.getByText("当前金额").parentElement).toHaveTextContent(
      "无历史数据",
    );
    expect(screen.getByText("新规则金额").parentElement).toHaveTextContent(
      "服务端未提供",
    );
    expect(screen.getByText("差额").parentElement).toHaveTextContent(
      "无历史对照",
    );
    expect(screen.getByText("差额").parentElement).not.toHaveTextContent(
      "¥0.00",
    );
  });

  it("keeps retry-in-progress visible across authoritative refreshes until terminal", async () => {
    let resolveTerminal;
    const terminal = new Promise((resolve) => {
      resolveTerminal = resolve;
    });
    const retryEnvelope = {
      session: claimedSession(),
      result: {
        ok: true,
        kind: "retry_in_progress",
        conversationId: SESSION_ID,
        turn: {
          turnId: "77777777-7777-4777-8777-777777777777",
          status: "generating",
          attempt: 1,
          duplicate: true,
        },
      },
    };
    const apiClient = api({
      startSession: vi.fn().mockResolvedValue(retryEnvelope),
      refreshSession: vi
        .fn()
        .mockResolvedValueOnce(
          authoritativeSessionWithTurns(draft(), [
            conversationTurn("generating"),
          ]),
        )
        .mockReturnValueOnce(terminal),
    });
    renderWorkspace(apiClient, {
      retryPollDelayMs: 0,
      retryPollMaxAttempts: 3,
    });

    await startRule();

    const progressHeading = await screen.findByRole("heading", {
      name: "AI 正在处理",
    });
    expect(progressHeading).toHaveFocus();
    expectOnePrimary("正在处理…");
    expect(apiClient.startSession).toHaveBeenCalledTimes(1);
    expect(apiClient.answerOrRevise).not.toHaveBeenCalled();

    resolveTerminal(
      authoritativeSessionWithTurns(draft(), [conversationTurn("completed")]),
    );

    const question = await screen.findByRole("heading", {
      name: "每小时按多少元结算？",
    });
    expect(question).toHaveFocus();
    expect(apiClient.refreshSession).toHaveBeenCalledTimes(2);
    expect(apiClient.startSession).toHaveBeenCalledTimes(1);
    expect(apiClient.answerOrRevise).not.toHaveBeenCalled();
    expectOnePrimary("回复 AI");
  });

  it("fails safely after bounded active refreshes without duplicating an AI turn", async () => {
    const retryEnvelope = {
      session: claimedSession(),
      result: {
        ok: true,
        kind: "retry_in_progress",
        conversationId: SESSION_ID,
        turn: {
          turnId: "77777777-7777-4777-8777-777777777777",
          status: "validating",
          attempt: 1,
          duplicate: true,
        },
      },
    };
    const apiClient = api({
      startSession: vi.fn().mockResolvedValue(retryEnvelope),
      refreshSession: vi
        .fn()
        .mockResolvedValue(
          authoritativeSessionWithTurns(draft(), [
            conversationTurn("validating"),
          ]),
        ),
    });
    renderWorkspace(apiClient, {
      retryPollDelayMs: 0,
      retryPollMaxAttempts: 2,
    });

    await startRule();

    const heading = await screen.findByRole("heading", {
      name: "AI 仍在处理",
    });
    expect(heading).toHaveFocus();
    expect(
      screen.getByText("处理尚未完成，请刷新查看最新状态"),
    ).toBeInTheDocument();
    expectOnePrimary("刷新处理状态");
    expect(apiClient.refreshSession).toHaveBeenCalledTimes(2);
    expect(apiClient.startSession).toHaveBeenCalledTimes(1);
    expect(apiClient.answerOrRevise).not.toHaveBeenCalled();
  });

  it("refreshes a superseded start replay without ever rendering the stale draft", async () => {
    let resolveRefresh;
    const pendingRefresh = new Promise((resolve) => {
      resolveRefresh = resolve;
    });
    const superseded = confirmableDraft({
      status: "superseded",
      businessContract: contract({ title: "过期的首次规则草案" }),
      supersededByDraftId: "77777777-7777-4777-8777-777777777777",
      supersededAt: "2026-07-12T01:03:00.000Z",
    });
    const latest = confirmableDraft({
      id: "77777777-7777-4777-8777-777777777777",
      revisionNumber: 2,
      businessContract: contract({ title: "权威首次规则草案" }),
      supersedesDraftId: DRAFT_ID,
    });
    const apiClient = api({
      startSession: vi
        .fn()
        .mockResolvedValue(startEnvelope(superseded, { duplicate: true })),
      refreshSession: vi.fn().mockReturnValue(pendingRefresh),
    });
    renderWorkspace(apiClient);

    await startRule();

    await waitFor(() =>
      expect(apiClient.refreshSession).toHaveBeenCalledTimes(1),
    );
    expect(screen.queryByText("过期的首次规则草案")).not.toBeInTheDocument();

    resolveRefresh(authoritativeSession(latest));

    expect(
      await screen.findByRole("heading", { name: "业务规则草案" }),
    ).toHaveFocus();
    expect(screen.getByText("权威首次规则草案")).toBeInTheDocument();
    expect(screen.queryByText("过期的首次规则草案")).not.toBeInTheDocument();
    expect(apiClient.refreshSession).toHaveBeenCalledTimes(1);
    expect(apiClient.answerOrRevise).not.toHaveBeenCalled();
    expectOnePrimary("确认业务规则并试算");
  });

  it("renders an authoritative failed draft as a focused safe error state", async () => {
    const failed = draft("failed", {
      initialStatus: "failed",
      unresolvedAmbiguities: [],
      safetyFlags: [
        {
          code: "ai_generation_failed",
          severity: "warning",
          message: "provider stack raw prompt sk-failed-secret",
        },
      ],
    });
    const apiClient = api({
      startSession: vi.fn().mockResolvedValue(startEnvelope(draft())),
      refreshSession: vi.fn().mockResolvedValue(
        authoritativeSessionWithTurns(failed, [
          conversationTurn("failed", {
            errorCode: "provider_raw_prompt_stack",
            retryable: true,
          }),
        ]),
      ),
    });
    renderWorkspace(apiClient);
    await startRule();
    await screen.findByRole("heading", { name: "每小时按多少元结算？" });

    fireEvent.click(screen.getByRole("button", { name: "刷新会话" }));

    const heading = await screen.findByRole("heading", {
      name: "AI 草案生成失败",
    });
    expect(heading).toHaveFocus();
    expect(
      screen.getByText("AI 未能生成可用草案，请重新开始"),
    ).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("AI 草案生成失败");
    expect(document.body).not.toHaveTextContent("sk-failed-secret");
    expect(document.body).not.toHaveTextContent("provider_raw_prompt_stack");
    expect(
      screen.queryByRole("button", { name: "开始澄清" }),
    ).not.toBeInTheDocument();
    expectOnePrimary("重新开始");
  });

  it("does not expose hostile error codes or messages through the workspace", async () => {
    const failure = new CustomSettlementRuleApiError({
      code: "provider-code-sk-ui-code raw_prompt",
      status: 503,
      retryable: true,
      message: "provider-message-sk-ui-message internal stack",
    });
    const apiClient = api({
      startSession: vi.fn().mockRejectedValue(failure),
    });
    renderWorkspace(apiClient);

    await startRule();

    const heading = await screen.findByRole("heading", {
      name: "无法继续处理",
    });
    expect(heading).toHaveFocus();
    expect(
      screen.getByText("结算规则服务暂时不可用，请稍后重试"),
    ).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent("sk-ui-code");
    expect(document.body).not.toHaveTextContent("raw_prompt");
    expect(document.body).not.toHaveTextContent("sk-ui-message");
    expect(document.body).not.toHaveTextContent("internal stack");
    expectOnePrimary("重试");
  });

  it("never exposes Task8 internal identifiers across visible normal-mode panels", async () => {
    const hostileContract = contract({
      calculationComponents: [
        {
          name: "final_component",
          description: "money_result parameter hourly_rate money_cents",
          expression: "money_result({ final: parameter(hourly_rate) })",
          resultType: { kind: "scalar", scalarType: "money_cents" },
        },
      ],
      requiredInputs: [
        {
          name: "system_minutes",
          description: "system_minutes cents provider_internal",
          source: "provider_stack_source",
          valueType: { kind: "scalar", scalarType: "integer" },
          userFacingUnit: "cents",
        },
      ],
      parameters: [
        {
          name: "bonus_rate",
          description: "bonus_rate rate_bps",
          valueType: { kind: "scalar", scalarType: "rate_bps" },
          userFacingUnit: "bps",
          defaultValue: { type: "rate_bps", rateBps: 1_250 },
        },
      ],
      businessTimezone: "America/New_York",
    });
    const hostileDraft = draft("simulated", {
      revisionNumber: 3,
      businessContract: hostileContract,
      generatedFormula: {
        expression:
          "money_result parameter hourly_rate system_minutes cents bps",
      },
      generatedExplanation:
        "money_result uses parameter(hourly_rate) and system_minutes cents bps",
    });
    const envelope = simulationEnvelope();
    envelope.result.draft = hostileDraft;
    envelope.result.summary.largestIncreases = [
      {
        bucket: "authorized_ordinal:000001",
        deltaYuan: "80.00",
        direction: "increase",
      },
    ];
    envelope.result.summary.riskFlags = [
      {
        code: "RAW_PROVIDER_RISK",
        severity: "warning",
        message: "provider_stack risk hourly_rate",
      },
    ];
    envelope.result.summary.warnings = [
      {
        code: "RAW_PROMPT_WARNING",
        severity: "info",
        message: "raw_prompt system_minutes money_cents",
      },
    ];
    const apiClient = api({
      startSession: vi.fn().mockResolvedValue({
        session: claimedSession(),
        result: envelope.result,
      }),
    });
    renderWorkspace(apiClient);

    await startRule();
    await screen.findByRole("heading", { name: "内部试算结果" });

    const formula = screen.getByLabelText("高级公式内容");
    expect(screen.getByTestId("advanced-formula")).not.toHaveAttribute("open");
    expect(formula).not.toBeVisible();
    const workspaceText = [
      screen.getByRole("region", { name: "AI 业务草案" }).textContent,
      screen.getByTestId("business-contract").textContent,
      screen.getByRole("region", { name: "确定性引擎解释" }).textContent,
      screen.getByRole("region", { name: "内部试算" }).textContent,
      screen.getByRole("status").textContent,
    ].join(" ");
    for (const internalValue of [
      "authorized_ordinal",
      "final_component",
      "money_result",
      "parameter",
      "hourly_rate",
      "system_minutes",
      "provider_internal",
      "provider_stack",
      "raw_prompt",
      "money_cents",
      "rate_bps",
      "cents",
      "bps",
      "America/New_York",
    ]) {
      expect(workspaceText).not.toContain(internalValue);
    }
    expect(workspaceText).toContain("第 1 条变更");
    expect(workspaceText).toContain("按已确认的业务条件计算");
    expect(workspaceText).toContain("一项业务风险需复核");
    expect(workspaceText).toContain("一项试算提醒需复核");
  });

  it("renders canonical large yuan amounts without numeric rounding", async () => {
    const envelope = simulationEnvelope();
    envelope.result.summary.totalOldYuan = "92233720368547758.07";
    envelope.result.summary.totalNewYuan = "92233720368547758.07";
    envelope.result.summary.totalDeltaYuan = "0.00";
    envelope.result.summary.marginImpactYuan = "0.00";
    const apiClient = api({
      startSession: vi.fn().mockResolvedValue({
        session: claimedSession(),
        result: envelope.result,
      }),
    });
    renderWorkspace(apiClient);

    await startRule();
    await screen.findByRole("heading", { name: "内部试算结果" });

    expect(screen.getByText("当前金额").parentElement).toHaveTextContent(
      "¥92,233,720,368,547,758.07",
    );
  });

  it.each([
    ["2026-07-01", "2026-07-01T00:00:00.000-04:00"],
    ["2026-01-15", "2026-01-15T00:00:00.000-05:00"],
  ])(
    "uses the confirmed catalog timezone offset for %s",
    async (periodStart, expectedStart) => {
      const apiClient = api({
        getVariableCatalog: vi.fn(({ scope, executionGrain }) =>
          Promise.resolve(
            catalog(true, {
              scope,
              executionGrain,
              businessTimezone: "America/New_York",
              businessTimezoneConfirmed: true,
              businessTimezoneSource: "organization_setting",
            }),
          ),
        ),
      });
      renderWorkspace(apiClient, {
        period: { start: periodStart, end: periodStart },
      });

      await startRule();
      await screen.findByRole("heading", { name: "每小时按多少元结算？" });

      expect(apiClient.startSession).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({
            seedContract: expect.objectContaining({
              effectiveStartAt: expectedStart,
              businessTimezone: "America/New_York",
            }),
          }),
        }),
      );
    },
  );

  it("blocks session start while the catalog timezone is unresolved", async () => {
    const apiClient = api({
      getVariableCatalog: vi.fn(({ scope, executionGrain }) =>
        Promise.resolve(
          catalog(false, {
            scope,
            executionGrain,
            businessTimezone: null,
            businessTimezoneConfirmed: false,
            businessTimezoneSource: "unresolved",
          }),
        ),
      ),
    });
    renderWorkspace(apiClient);

    const heading = await screen.findByRole("heading", {
      name: "业务时区待确认",
    });
    expect(heading).toHaveFocus();
    expect(
      screen.getByText("请先确认项目业务时区后再开始"),
    ).toBeInTheDocument();
    expectOnePrimary("重新读取时区");
    expect(apiClient.startSession).not.toHaveBeenCalled();
  });

  it("cannot start before the variable catalog resolves", async () => {
    let resolveCatalog;
    const pendingCatalog = new Promise((resolve) => {
      resolveCatalog = resolve;
    });
    const apiClient = api({
      getVariableCatalog: vi.fn().mockReturnValue(pendingCatalog),
    });
    renderWorkspace(apiClient);

    expect(screen.getByLabelText("规则说明")).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "正在读取范围…" }),
    ).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "正在读取范围…" }));
    expect(apiClient.startSession).not.toHaveBeenCalled();

    resolveCatalog(
      catalog(true, {
        scope: "receivable",
        executionGrain: "project_period",
      }),
    );
    await waitFor(() =>
      expect(screen.getByLabelText("规则说明")).toBeEnabled(),
    );
    expectOnePrimary("开始澄清");
  });

  it("focuses a catalog failure and retries only the authoritative catalog", async () => {
    const catalogFailure = new CustomSettlementRuleApiError({
      code: "CUSTOM_RULE_CATALOG_UNAVAILABLE",
      status: 503,
      retryable: true,
      message: "变量目录暂时不可用，请稍后重试",
    });
    const apiClient = api({
      getVariableCatalog: vi
        .fn()
        .mockRejectedValueOnce(catalogFailure)
        .mockResolvedValueOnce(
          catalog(true, {
            scope: "receivable",
            executionGrain: "project_period",
          }),
        ),
    });
    renderWorkspace(apiClient);

    const heading = await screen.findByRole("heading", {
      name: "无法读取业务范围",
    });
    expect(heading).toHaveFocus();
    expect(
      screen.getByText("变量目录暂时不可用，请稍后重试"),
    ).toBeInTheDocument();
    expectOnePrimary("重新读取范围");
    expect(screen.getByLabelText("规则说明")).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "重新读取范围" }));

    await waitFor(() =>
      expect(screen.getByLabelText("规则说明")).toBeEnabled(),
    );
    expectOnePrimary("开始澄清");
    expect(apiClient.getVariableCatalog).toHaveBeenCalledTimes(2);
    expect(apiClient.startSession).not.toHaveBeenCalled();
  });

  it("treats a click on the selected scope as a no-op during a request", async () => {
    let resolveStart;
    const apiClient = api({
      startSession: vi.fn().mockReturnValue(
        new Promise((resolve) => {
          resolveStart = resolve;
        }),
      ),
    });
    renderWorkspace(apiClient);
    await startRule();
    expectOnePrimary("正在生成…");
    const abortCount = apiClient.abortActive.mock.calls.length;

    fireEvent.click(screen.getByRole("button", { name: "主播应付" }));
    expect(apiClient.abortActive).toHaveBeenCalledTimes(abortCount);
    resolveStart(startEnvelope(draft()));

    expect(
      await screen.findByRole("heading", { name: "每小时按多少元结算？" }),
    ).toHaveFocus();
    expectOnePrimary("回复 AI");
  });

  it("keeps every Task9 border radius at eight pixels or less", () => {
    const source = readFileSync(
      `${process.cwd()}/components/reference-ui/custom-settlement-rule-workspace.jsx`,
      "utf8",
    );
    const radii = [...source.matchAll(/border-radius:\s*(\d+)px/gu)].map(
      (match) => Number(match[1]),
    );

    expect(radii.length).toBeGreaterThan(0);
    expect(Math.max(...radii)).toBeLessThanOrEqual(8);
    expect(source).not.toContain("999px");
    expect(source).not.toContain("retry_readback");
  });

  it("renders a complete empty state when project context is unavailable", () => {
    renderWorkspace(api(), { project: null });

    expect(
      screen.getByRole("heading", { name: "尚未选择结算范围" }),
    ).toBeInTheDocument();
    expect(screen.getByText("请先选择项目和有效结算周期")).toBeInTheDocument();
    expectOnePrimary("开始澄清");
    expect(screen.getByRole("button", { name: "开始澄清" })).toBeDisabled();
  });
});
