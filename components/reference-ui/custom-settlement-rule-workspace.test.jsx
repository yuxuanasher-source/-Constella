import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CustomSettlementRuleApiError } from "./custom-settlement-rule-api";
import CustomSettlementRuleWorkspace from "./custom-settlement-rule-workspace";

const PROJECT_ID = "33333333-3333-4333-8333-333333333333";
const SESSION_ID = "44444444-4444-4444-8444-444444444444";
const DRAFT_ID = "55555555-5555-4555-8555-555555555555";

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
  const ready = status === "contract_ready" || status === "simulated";
  return {
    id: DRAFT_ID,
    conversationId: SESSION_ID,
    revisionNumber: 1,
    status,
    initialStatus: ready ? "contract_ready" : "clarifying",
    businessContract: contract(),
    unresolvedAmbiguities: ready
      ? []
      : [
          {
            code: "hourly_rate",
            question: "每小时按多少元结算？",
            required: true,
          },
        ],
    variableCatalogVersion: "a".repeat(64),
    generatedFormula: ready
      ? {
          expression:
            'money_result({ final: parameter("hourly_rate") * system_minutes })',
        }
      : null,
    generatedExplanation: ready ? "按系统直播时长和已确认单价计算。" : null,
    generatedTestCases: [],
    safetyFlags: [],
    contractHash: "b".repeat(64),
    formulaHash: ready ? "c".repeat(64) : null,
    parameterHash: "d".repeat(64),
    createdAt: "2026-07-12T01:00:00.000Z",
    supersedesDraftId: null,
    supersededByDraftId: null,
    supersededAt: null,
    ...overrides,
  };
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

function catalog(hasHistory = true) {
  return {
    catalog: {
      scope: "payable",
      executionGrain: "report",
      businessTimezone: "Asia/Shanghai",
      businessTimezoneConfirmed: true,
      businessTimezoneSource: "contract_default",
      hasHistory,
      version: "a".repeat(64),
      variables: [],
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
          sampledCount: 18,
          criteria: ["approved_reports"],
        },
        coverage: { totalRecords: 20, evaluatedRecords: 18, skippedRecords: 2 },
        scenarios: [],
        historicalTotals: {
          payableAmountYuan: noHistory ? null : "1000.00",
          receivableAmountYuan: null,
          recordCount: noHistory ? 0 : 20,
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
        blockedCount: 1,
        largestIncreases: [
          { bucket: "高时长场次", deltaYuan: "80.00", direction: "increase" },
        ],
        largestDecreases: [
          {
            bucket: "缺少证据场次",
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
        scenarios: [],
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

function api(overrides = {}) {
  return {
    abortActive: vi.fn(),
    getVariableCatalog: vi.fn().mockResolvedValue(catalog()),
    startSession: vi.fn().mockResolvedValue(startEnvelope(draft())),
    refreshSession: vi
      .fn()
      .mockResolvedValue(authoritativeSession(draft("contract_ready"))),
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
  fireEvent.change(screen.getByLabelText("规则说明"), {
    target: { value: prompt },
  });
  fireEvent.click(screen.getByRole("button", { name: "开始澄清" }));
}

describe("CustomSettlementRuleWorkspace", () => {
  it("offers only Phase 1 business scopes on a full-width operational surface", async () => {
    const apiClient = api({
      getVariableCatalog: vi.fn().mockResolvedValue(catalog(false)),
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
    expectOnePrimary("开始澄清");
    expect(await screen.findByText("无历史数据")).toBeInTheDocument();
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

  it("keeps formulas collapsed and presents normal values only as yuan and percent", async () => {
    const ready = draft("contract_ready");
    const apiClient = api({
      startSession: vi.fn().mockResolvedValue(startEnvelope(ready)),
    });
    renderWorkspace(apiClient);

    await startRule();

    const heading = await screen.findByRole("heading", {
      name: "业务规则草案",
    });
    expect(heading).toHaveFocus();
    const advanced = screen.getByTestId("advanced-formula");
    expect(advanced).not.toHaveAttribute("open");
    const normal = screen.getByTestId("business-contract");
    expect(normal).toHaveTextContent("¥100.00");
    expect(normal).toHaveTextContent("12.50%");
    expect(normal).not.toHaveTextContent(
      /amountCents|rateBps|hourly_rate|system_minutes/u,
    );

    const aiDraft = screen.getByRole("region", { name: "AI 业务草案" });
    const engine = screen.getByRole("region", { name: "确定性引擎解释" });
    expect(aiDraft).toHaveAttribute("data-source", "ai");
    expect(engine).toHaveAttribute("data-source", "deterministic-engine");
    expect(engine).not.toEqual(aiDraft);
    expectOnePrimary("确认业务规则并试算");
  });

  it("renders the authoritative natural-language revision diff and names preserved fields", async () => {
    const first = draft();
    const revisedContract = contract({
      title: "项目主播阶梯计费",
      summary: "按系统时长分档计算主播应付金额。",
    });
    const revised = draft("contract_ready", {
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

  it("shows the complete internal simulation and never offers activation", async () => {
    const ready = draft("contract_ready");
    const apiClient = api({
      startSession: vi.fn().mockResolvedValue(startEnvelope(ready)),
      confirmAndSimulate: vi
        .fn()
        .mockResolvedValue(simulationEnvelope({ noHistory: true })),
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
    expect(simulation).toHaveTextContent("无历史数据");
    expect(simulation).toHaveTextContent("内部预览");
    expect(screen.queryByText("应用并提交审核")).not.toBeInTheDocument();
    expectOnePrimary("修改规则");
    expect(apiClient.confirmAndSimulate).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: PROJECT_ID,
        sessionId: SESSION_ID,
        body: expect.objectContaining({
          expectedDraftId: DRAFT_ID,
          expectedRevisionNumber: 1,
          contractConfirmed: true,
          expectedContractHash: "b".repeat(64),
          expectedCatalogVersion: "a".repeat(64),
          expectedFormulaHash: "c".repeat(64),
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
        }),
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it("refreshes from the authoritative session and focuses the new result", async () => {
    const first = draft();
    const refreshed = draft("contract_ready", { revisionNumber: 4 });
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

    fireEvent.click(screen.getByRole("button", { name: "主播应付" }));
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
