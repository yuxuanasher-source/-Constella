import { describe, expect, it, vi } from "vitest";

import type { AiGatewayResult } from "@/features/ai/contracts";

import type { BusinessRuleContract } from "./custom-rule-contract";
import type { CustomRuleVariableCatalog } from "./custom-rule-variable-catalog";
import {
  SettlementAiInputError,
  createSettlementRuleAiAdapter,
  settlementDraftResponseSchema,
  type SettlementConversationPort,
  type SettlementStructuredGateway,
} from "./custom-rule-ai";

const HASH = "a".repeat(64);

describe("settlementDraftResponseSchema", () => {
  it("rejects unknown nested keys before business logic sees provider output", () => {
    const result = settlementDraftResponseSchema.safeParse({
      contractPatch: { summary: "按每场直播计算主播应付金额。" },
      unresolvedAmbiguities: [
        {
          code: "confirm_rate",
          question: "请确认每小时结算单价？",
          required: true,
          rawRow: { streamerAmount: 12_345 },
        },
      ],
      nextQuestion: "请确认每小时结算单价？",
      formulaProposal: null,
      testCases: [],
      safetyFlags: [],
    });

    expect(result.success).toBe(false);
  });

  it("allows exactly one focused question and withholds formulas while anything is unresolved", () => {
    const valid = settlementDraftResponseSchema.safeParse({
      contractPatch: {},
      unresolvedAmbiguities: [
        {
          code: "confirm_rate",
          question: "请确认每小时结算单价？",
          required: true,
        },
      ],
      nextQuestion: "请确认每小时结算单价？",
      formulaProposal: null,
      testCases: [],
      safetyFlags: ["等待用户确认单价"],
    });
    const multipleQuestions = settlementDraftResponseSchema.safeParse({
      contractPatch: {},
      unresolvedAmbiguities: [
        {
          code: "confirm_rate",
          question: "请确认每小时结算单价？",
          required: true,
        },
      ],
      nextQuestion: "单价是多少？何时生效？",
      formulaProposal: null,
      testCases: [],
      safetyFlags: [],
    });
    const prematureFormula = settlementDraftResponseSchema.safeParse({
      contractPatch: {},
      unresolvedAmbiguities: [
        {
          code: "confirm_rate",
          question: "请确认每小时结算单价？",
          required: true,
        },
      ],
      nextQuestion: "请确认每小时结算单价？",
      formulaProposal: "money_result({ final: yuan(100) })",
      testCases: [testCase("提前生成")],
      safetyFlags: [],
    });

    expect(valid.success).toBe(true);
    expect(multipleQuestions.success).toBe(false);
    expect(prematureFormula.success).toBe(false);
  });
});

describe("SettlementConversationPort", () => {
  it("uses only public conversation DTO and service method semantics", async () => {
    const port: SettlementConversationPort = {
      createConversation: async (_actor, title) => ({
        id: "conversation-1",
        title: title ?? "新会话",
        status: "active",
        lastMessageAt: "2026-07-12T00:00:00.000Z",
        createdAt: "2026-07-12T00:00:00.000Z",
        updatedAt: "2026-07-12T00:00:00.000Z",
      }),
      getHistory: async () => ({
        conversation: {
          id: "conversation-1",
          title: "结算规则",
          status: "active",
          lastMessageAt: "2026-07-12T00:00:00.000Z",
          createdAt: "2026-07-12T00:00:00.000Z",
          updatedAt: "2026-07-12T00:00:00.000Z",
        },
        messages: [],
      }),
      acceptTurn: async () => ({
        conversationId: "conversation-1",
        turnId: "turn-1",
        userMessageId: "user-message-1",
        assistantMessageId: "assistant-message-1",
        status: "accepted",
        attempt: 1,
        duplicate: false,
      }),
      retryTurn: async () => ({
        conversationId: "conversation-1",
        turnId: "turn-2",
        userMessageId: "user-message-2",
        assistantMessageId: "assistant-message-2",
        status: "accepted",
        attempt: 2,
        duplicate: false,
      }),
      prepareTurn: async () => ({
        messages: [],
        snapshot: {
          version: 1,
          summaryVersion: 0,
          messageIds: [],
          groundingRefs: [],
          assembledAt: "2026-07-12T00:00:00.000Z",
        },
      }),
      captureGatewayContext: async (_actor, _turnId, snapshot) => snapshot,
      markGenerating: async () => undefined,
      markValidating: async () => undefined,
      completeTurn: async () => undefined,
      failTurn: async () => undefined,
    };

    await expect(
      port.createConversation(
        { organizationId: "organization-1", userId: "user-1" },
        "结算规则",
      ),
    ).resolves.toMatchObject({ id: "conversation-1" });
  });
});

describe("createSettlementRuleAiAdapter", () => {
  it("keeps formula and test cases absent until explicit contract confirmation", async () => {
    const gateway = gatewayReturning({
      contractPatch: {},
      unresolvedAmbiguities: [],
      nextQuestion: "请确认以上业务规则无误？",
      formulaProposal: null,
      testCases: [],
      safetyFlags: [],
    });
    const adapter = createSettlementRuleAiAdapter({ gateway });

    const result = await adapter.execute(
      adapter.prepare({
        ...baseInput(),
        action: "revise",
        contractConfirmed: false,
      }),
    );

    expect(result).toMatchObject({
      ok: true,
      formulaProposal: null,
      testCases: [],
      nextQuestion: "请确认以上业务规则无误？",
    });
  });

  it("accepts a formula only after confirmation and validates it deterministically", async () => {
    const gateway = gatewayReturning({
      contractPatch: {},
      unresolvedAmbiguities: [],
      nextQuestion: null,
      formulaProposal: "payable = money_result({ final: yuan(100) })",
      testCases: [testCase("确认后的标准场景")],
      safetyFlags: ["仅用于草案试算"],
    });
    const adapter = createSettlementRuleAiAdapter({ gateway });

    const result = await adapter.execute(
      adapter.prepare({
        ...baseInput(),
        action: "confirm",
        contractConfirmed: true,
      }),
    );

    expect(result).toMatchObject({
      ok: true,
      formulaProposal: "payable = money_result({ final: yuan(100) })",
      testCases: [{ name: "确认后的标准场景" }],
      validation: {
        formulaHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        variables: [],
      },
    });
  });

  it("rejects a provider validity claim when the Task 3 validator rejects its formula", async () => {
    const gateway = gatewayReturning({
      contractPatch: {},
      unresolvedAmbiguities: [],
      nextQuestion: null,
      formulaProposal: "payable = eval(unsafe_payload)",
      testCases: [testCase("模型声称有效")],
      safetyFlags: ["provider_claims_valid"],
    });
    const adapter = createSettlementRuleAiAdapter({ gateway });

    const result = await adapter.execute(
      adapter.prepare({
        ...baseInput(),
        action: "confirm",
        contractConfirmed: true,
      }),
    );

    expect(result).toMatchObject({
      ok: false,
      code: "SETTLEMENT_AI_FORMULA_INVALID",
      retryable: true,
    });
  });

  it("merges a natural-language patch and returns the exact deterministic business diff", async () => {
    const gateway = gatewayReturning({
      contractPatch: {
        summary: "按每场直播计算主播应付金额，黄证据按七折结算。",
        missingDataPolicy: { action: "block_batch" },
      },
      unresolvedAmbiguities: [
        {
          code: "confirm_effective_time",
          question: "请确认新规则生效时间？",
          required: true,
        },
      ],
      nextQuestion: "请确认新规则生效时间？",
      formulaProposal: null,
      testCases: [],
      safetyFlags: [],
    });
    const before = contract();
    const adapter = createSettlementRuleAiAdapter({ gateway });

    const result = await adapter.execute(
      adapter.prepare({
        ...baseInput(),
        currentContract: before,
        action: "revise",
        contractConfirmed: false,
        userMessage: "黄证据改成七折，其他条件不变。",
      }),
    );

    expect(result).toMatchObject({
      ok: true,
      contract: {
        title: before.title,
        calculationComponents: before.calculationComponents,
        summary: "按每场直播计算主播应付金额，黄证据按七折结算。",
        missingDataPolicy: { action: "block_batch" },
      },
      diff: [
        {
          field: "summary",
          before: before.summary,
          after: "按每场直播计算主播应付金额，黄证据按七折结算。",
        },
        {
          field: "missingDataPolicy",
          before: { action: "route_item_to_review" },
          after: { action: "block_batch" },
        },
      ],
    });
  });

  it("builds a stable prompt from scope-safe catalog metadata and coverage only", async () => {
    const requests: Parameters<SettlementStructuredGateway>[0][] = [];
    const gateway: SettlementStructuredGateway = async (request) => {
      requests.push(request);
      return gatewayResult({
        contractPatch: {},
        unresolvedAmbiguities: [
          {
            code: "confirm_rate",
            question: "请确认每小时结算单价？",
            required: true,
          },
        ],
        nextQuestion: "请确认每小时结算单价？",
        formulaProposal: null,
        testCases: [],
        safetyFlags: [],
      });
    };
    const adapter = createSettlementRuleAiAdapter({ gateway });
    const input = baseInput();

    const first = adapter.prepare(input);
    const second = adapter.prepare({
      ...input,
      catalog: {
        ...input.catalog,
        variables: [...input.catalog.variables].reverse(),
      },
    });
    await adapter.execute(first);
    await adapter.execute(second);

    expect(first.promptHash).toBe(second.promptHash);
    expect(requests[0]).toEqual(requests[1]);
    const payload = JSON.parse(requests[0].messages.at(-1)?.content ?? "null");
    expect(payload.catalog.variables).toEqual([
      {
        availability: "available",
        coverageDenominator: 10,
        coverageNumerator: 10,
        id: "evidence_level",
        label: "凭证等级",
        latestSampledPeriod: {
          end: "2026-07-10",
          start: "2026-07-01",
        },
        runtimeType: { kind: "scalar", scalarType: "string" },
        sourceLabel: "直播报告凭证等级",
        unit: "等级",
      },
      {
        availability: "available",
        coverageDenominator: 10,
        coverageNumerator: 10,
        id: "system_minutes",
        label: "系统直播时长",
        latestSampledPeriod: {
          end: "2026-07-10",
          start: "2026-07-01",
        },
        runtimeType: { kind: "scalar", scalarType: "integer" },
        sourceLabel: "直播报告系统计时",
        unit: "分钟",
      },
    ]);
    expect(JSON.stringify(payload)).not.toMatch(
      /rawReport|sampleRows|streamerAmount|otherStreamer|internalMargin|tax|rawImport|secret|databaseRow/i,
    );
  });

  it("projects only contract structure and never sends defaults, amounts, or examples", () => {
    const adapter = createSettlementRuleAiAdapter({
      gateway: async () => gatewayResult(),
    });
    const input = baseInput();
    input.currentContract.parameters[0].description = "known10000";
    input.currentContract.examples[0].description = "private-example-known10000";

    const prepared = adapter.prepare(input);
    const prompt = prepared.request.messages.at(-1)?.content ?? "";
    const payload = JSON.parse(prompt);

    expect(payload).not.toHaveProperty("currentContract");
    expect(payload.contractStructure).toEqual(
      expect.objectContaining({
        scope: "payable",
        target: { targetType: "project" },
        executionGrain: "report",
        compositionMode: "replace",
        calculationComponents: [
          {
            id: "base",
            resultType: { kind: "scalar", scalarType: "money_cents" },
          },
        ],
        requiredVariables: [
          {
            id: "system_minutes",
            valueType: { kind: "scalar", scalarType: "integer" },
          },
        ],
        parameters: [
          {
            name: "hourly_rate",
            valueType: { kind: "scalar", scalarType: "money_cents" },
          },
        ],
        missingDataPolicy: { action: "route_item_to_review" },
      }),
    );
    expect(prompt).not.toMatch(
      /known10000|amountCents|rateBps|defaultValue|expectedResult|private-example/i,
    );
    expect(prepared.request.messages[0].content).toContain(
      'parameter("parameter_name")',
    );
  });

  it("freezes trusted context before the gateway call and reuses it for technical retries", async () => {
    const captured: string[] = [];
    const gateway: SettlementStructuredGateway = vi.fn(async (request) => {
      const serializableRequest = { ...request };
      delete serializableRequest.responseSchema;
      captured.push(JSON.stringify(serializableRequest));
      request.messages[0].content = "provider-mutated-system-message";
      request.messages.push({
        role: "user",
        content: "provider-mutated-message-list",
      });
      return gatewayResult({
        contractPatch: {},
        unresolvedAmbiguities: [
          {
            code: "confirm_rate",
            question: "请确认每小时结算单价？",
            required: true,
          },
        ],
        nextQuestion: "请确认每小时结算单价？",
        formulaProposal: null,
        testCases: [],
        safetyFlags: [],
      });
    });
    const adapter = createSettlementRuleAiAdapter({ gateway });
    const mutable = baseInput();
    const prepared = adapter.prepare(mutable);
    mutable.currentContract.summary = "调用前被外部修改的摘要";
    mutable.catalog.variables[0].label = "调用前被外部修改的标签";

    const first = await adapter.execute(prepared);
    const retry = await adapter.execute(prepared);

    expect(first).toMatchObject({ ok: true });
    expect(retry).toMatchObject({ ok: true });
    expect(captured).toHaveLength(2);
    expect(captured[0]).toBe(captured[1]);
    expect(captured[0]).not.toContain("调用前被外部修改");
    expect(prepared.request.messages).toHaveLength(4);
    expect(
      prepared.request.messages.some((message) =>
        message.content.includes("provider-mutated"),
      ),
    ).toBe(false);
    expect(Object.isFrozen(prepared)).toBe(true);
  });

  it("restores a prepared request only from its frozen retry context", async () => {
    const captured: string[] = [];
    const adapter = createSettlementRuleAiAdapter({
      gateway: async (request) => {
        captured.push(JSON.stringify(request.messages));
        return gatewayResult({
          contractPatch: {},
          unresolvedAmbiguities: [
            {
              code: "confirm_rate",
              question: "璇风‘璁ゆ瘡灏忔椂缁撶畻鍗曚环锛?",
              required: true,
            },
          ],
          nextQuestion: "璇风‘璁ゆ瘡灏忔椂缁撶畻鍗曚环锛?",
          formulaProposal: null,
          testCases: [],
          safetyFlags: [],
        });
      },
    });
    const mutable = baseInput();
    const prepared = adapter.prepare(mutable);
    const frozenRetryContext = structuredClone(prepared.retryContext);
    mutable.currentContract.parameters[0].defaultValue = {
      type: "money_cents",
      amountCents: 99_999,
    };
    mutable.catalog.variables[0].label = "live-regrounded-label";

    const restored = adapter.restore(frozenRetryContext);
    await adapter.execute(restored);

    expect(restored.promptHash).toBe(prepared.promptHash);
    expect(restored.contextHash).toBe(prepared.contextHash);
    expect(restored.request.messages).toEqual(prepared.request.messages);
    expect(captured[0]).not.toContain("live-regrounded-label");
    expect(captured[0]).not.toContain("99999");
    expect(Object.isFrozen(restored.retryContext)).toBe(true);
  });

  it("returns a retryable failure without mutating existing draft evidence", async () => {
    const gateway: SettlementStructuredGateway = async () =>
      gatewayResult(undefined, {
        status: "failed",
        errorSummary: "provider unavailable",
      });
    const existing = contract();
    const snapshot = structuredClone(existing);
    const adapter = createSettlementRuleAiAdapter({ gateway });

    const result = await adapter.execute(
      adapter.prepare({ ...baseInput(), currentContract: existing }),
    );

    expect(result).toMatchObject({
      ok: false,
      code: "SETTLEMENT_AI_PROVIDER_FAILED",
      retryable: true,
    });
    expect(existing).toEqual(snapshot);
  });

  it("fails closed on prompt budgets, unsafe catalog keys, accessors, and proxy output", async () => {
    const adapter = createSettlementRuleAiAdapter({
      gateway: async () => gatewayResult(new Proxy({}, {})),
    });
    const unsafeCatalog = {
      ...catalog(),
      rawReportRows: [{ streamerAmount: 1_000 }],
    };
    const accessorInput = baseInput();
    Object.defineProperty(accessorInput.currentContract, "summary", {
      enumerable: true,
      get() {
        throw new Error("must not execute");
      },
    });

    expect(() =>
      adapter.prepare({ ...baseInput(), userMessage: "x".repeat(12_001) }),
    ).toThrow(SettlementAiInputError);
    expect(() =>
      adapter.prepare({ ...baseInput(), catalog: unsafeCatalog as never }),
    ).toThrow(SettlementAiInputError);
    expect(() => adapter.prepare(accessorInput)).toThrow(SettlementAiInputError);

    const result = await adapter.execute(adapter.prepare(baseInput()));
    expect(result).toMatchObject({
      ok: false,
      code: "SETTLEMENT_AI_OUTPUT_INVALID",
      retryable: true,
    });
  });
});

function baseInput() {
  return {
    action: "clarify" as const,
    contractConfirmed: false,
    userMessage: "每场直播按时长结算，请帮我补全规则。",
    currentContract: contract(),
    unresolvedAmbiguities: [
      {
        code: "confirm_rate",
        question: "请确认每小时结算单价？",
        required: true,
      },
    ],
    catalog: catalog(),
    conversationMessages: [
      { role: "user" as const, content: "每场直播按时长结算。" },
      { role: "assistant" as const, content: "我会逐项确认业务含义。" },
    ],
  };
}

function contract(): BusinessRuleContract {
  return {
    schemaVersion: 1,
    scope: "payable",
    target: { targetType: "project", targetId: null },
    executionGrain: "report",
    compositionMode: "replace",
    title: "项目主播按场计费",
    summary: "按每场直播计算主播应付金额。",
    calculationComponents: [
      {
        name: "base",
        description: "按直播时长计算基础金额",
        expression: "直播时长乘以小时单价",
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
    compositionDescription: "替换项目级基础应付规则。",
    businessTimezone: "Asia/Shanghai",
    examples: [
      {
        name: "标准一小时",
        kind: "normal",
        description: "直播一小时按标准单价结算。",
        inputs: { system_minutes: { type: "integer", value: 60 } },
        expectedResult: { type: "money_cents", amountCents: 10_000 },
      },
      {
        name: "零时长",
        kind: "boundary",
        description: "直播时长为零时结算金额为零。",
        inputs: { system_minutes: { type: "integer", value: 0 } },
        expectedResult: { type: "money_cents", amountCents: 0 },
      },
      {
        name: "一分钟",
        kind: "boundary",
        description: "最小时长仍按规则精确计算。",
        inputs: { system_minutes: { type: "integer", value: 1 } },
        expectedResult: { type: "money_cents", amountCents: 167 },
      },
    ],
  };
}

function catalog(): CustomRuleVariableCatalog {
  return {
    scope: "payable",
    executionGrain: "report",
    businessTimezone: "Asia/Shanghai",
    businessTimezoneConfirmed: true,
    businessTimezoneSource: "confirmed_contract",
    hasHistory: true,
    version: HASH,
    variables: [
      {
        id: "system_minutes",
        label: "系统直播时长",
        runtimeType: { kind: "scalar", scalarType: "integer" },
        unit: "分钟",
        sourceLabel: "直播报告系统计时",
        availability: "available",
        coverageNumerator: 10,
        coverageDenominator: 10,
        latestSampledPeriod: { start: "2026-07-01", end: "2026-07-10" },
      },
      {
        id: "evidence_level",
        label: "凭证等级",
        runtimeType: { kind: "scalar", scalarType: "string" },
        unit: "等级",
        sourceLabel: "直播报告凭证等级",
        availability: "available",
        coverageNumerator: 10,
        coverageDenominator: 10,
        latestSampledPeriod: { start: "2026-07-01", end: "2026-07-10" },
      },
    ],
  };
}

function testCase(name: string) {
  return {
    name,
    inputs: {},
    expectedResult: { type: "money_cents" as const, amountCents: 10_000 },
  };
}

function gatewayReturning(
  output: Parameters<typeof gatewayResult>[0],
): SettlementStructuredGateway {
  return async () => gatewayResult(output);
}

function gatewayResult(
  structuredOutput?: unknown,
  overrides: Partial<AiGatewayResult> = {},
): AiGatewayResult {
  return {
    status: "succeeded",
    structuredOutput,
    providerName: "deterministic",
    fallbackUsed: false,
    usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
    latencyMs: 5,
    costCents: 0,
    ...overrides,
  };
}
