import { z } from "zod";

const hashSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const scalarTypeSchema = z.enum([
  "money_cents",
  "rate_bps",
  "number",
  "integer",
  "boolean",
  "string",
  "timestamp",
]);

const runtimeValueTypeSchema = z.lazy(() =>
  z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("scalar"), scalarType: scalarTypeSchema }),
    z.strictObject({
      kind: z.literal("array"),
      itemType: runtimeValueTypeSchema,
    }),
    z.strictObject({
      kind: z.literal("object"),
      fields: z.record(z.string(), runtimeValueTypeSchema),
    }),
  ]),
);

const typedRuntimeValueSchema = z.lazy(() =>
  z.discriminatedUnion("type", [
    z.strictObject({ type: z.literal("money_cents"), amountCents: z.number() }),
    z.strictObject({ type: z.literal("rate_bps"), rateBps: z.number() }),
    z.strictObject({ type: z.literal("number"), value: z.number() }),
    z.strictObject({ type: z.literal("integer"), value: z.number().int() }),
    z.strictObject({ type: z.literal("boolean"), value: z.boolean() }),
    z.strictObject({ type: z.literal("string"), value: z.string() }),
    z.strictObject({ type: z.literal("timestamp"), value: z.string() }),
    z.strictObject({
      type: z.literal("array"),
      items: z.array(typedRuntimeValueSchema),
    }),
    z.strictObject({
      type: z.literal("object"),
      fields: z.record(z.string(), typedRuntimeValueSchema),
    }),
  ]),
);

const targetSchema = z.discriminatedUnion("targetType", [
  z.strictObject({ targetType: z.literal("project"), targetId: z.null() }),
  z.strictObject({
    targetType: z.literal("streamer_group"),
    targetId: z.string(),
  }),
  z.strictObject({
    targetType: z.literal("project_streamer"),
    targetId: z.string(),
  }),
]);

const calculationComponentSchema = z.strictObject({
  name: z.string(),
  description: z.string(),
  expression: z.string(),
  resultType: runtimeValueTypeSchema,
});

const requiredInputSchema = z.strictObject({
  name: z.string(),
  description: z.string(),
  source: z.string(),
  valueType: runtimeValueTypeSchema,
  userFacingUnit: z.string(),
});

const parameterSchema = z.strictObject({
  name: z.string(),
  description: z.string(),
  valueType: runtimeValueTypeSchema,
  userFacingUnit: z.string(),
  defaultValue: typedRuntimeValueSchema,
});

const exampleSchema = z.strictObject({
  name: z.string(),
  kind: z.enum(["normal", "boundary"]),
  description: z.string(),
  inputs: z.record(z.string(), typedRuntimeValueSchema),
  expectedResult: typedRuntimeValueSchema,
});

const generatedTestCaseSchema = z.strictObject({
  name: z.string(),
  inputs: z.record(z.string(), typedRuntimeValueSchema),
  expectedResult: typedRuntimeValueSchema,
});

const missingDataPolicySchema = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("route_item_to_review") }),
  z.strictObject({ action: z.literal("block_batch") }),
  z.strictObject({
    action: z.literal("use_explicit_default"),
    defaultValue: typedRuntimeValueSchema,
  }),
]);

const businessContractSchema = z.strictObject({
  schemaVersion: z.literal(1),
  scope: z.enum(["payable", "receivable"]),
  target: targetSchema,
  executionGrain: z.enum([
    "report",
    "project_streamer_period",
    "batch",
    "project_period",
  ]),
  compositionMode: z.enum([
    "replace",
    "add",
    "multiply",
    "clamp",
    "emit_items",
    "check",
  ]),
  title: z.string(),
  summary: z.string(),
  calculationComponents: z.array(calculationComponentSchema),
  requiredInputs: z.array(requiredInputSchema),
  parameters: z.array(parameterSchema),
  effectiveStartAt: z.string(),
  effectiveEndAt: z.string().nullable(),
  missingDataPolicy: missingDataPolicySchema,
  compositionDescription: z.string(),
  businessTimezone: z.string(),
  examples: z.array(exampleSchema),
});

const ambiguitySchema = z.strictObject({
  code: z.string(),
  question: z.string(),
  required: z.boolean(),
});

const safetyFlagSchema = z.strictObject({
  code: z.string(),
  severity: z.enum(["info", "warning", "block"]),
  message: z.string(),
});

const draftSchema = z.strictObject({
  id: z.string(),
  conversationId: z.string(),
  revisionNumber: z.number().int().positive(),
  status: z.enum([
    "clarifying",
    "failed",
    "contract_ready",
    "simulated",
    "superseded",
  ]),
  initialStatus: z.enum(["clarifying", "failed", "contract_ready"]),
  businessContract: businessContractSchema,
  unresolvedAmbiguities: z.array(ambiguitySchema),
  variableCatalogVersion: hashSchema,
  generatedFormula: z.strictObject({ expression: z.string() }).nullable(),
  generatedExplanation: z.string().nullable(),
  generatedTestCases: z.array(generatedTestCaseSchema),
  safetyFlags: z.array(safetyFlagSchema),
  contractHash: hashSchema,
  formulaHash: hashSchema.nullable(),
  parameterHash: hashSchema,
  createdAt: z.string(),
  supersedesDraftId: z.string().nullable().optional(),
  supersededByDraftId: z.string().nullable().optional(),
  supersededAt: z.string().nullable().optional(),
});

const warningSchema = z.strictObject({
  code: z.string(),
  severity: z.enum(["info", "warning", "block"]),
  message: z.string(),
});

const simulationSchema = z.strictObject({
  id: z.string(),
  createdAt: z.string(),
  dataSelectionHash: hashSchema,
  sampleSource: z.strictObject({
    kind: z.enum([
      "historical_settlements",
      "approved_operations",
      "synthetic_scenarios",
    ]),
  }),
  sampleSelection: z.strictObject({
    periodStart: z.string(),
    periodEnd: z.string(),
    populationCount: z.number().int().nonnegative(),
    sampledCount: z.number().int().nonnegative(),
    criteria: z.array(z.string()),
  }),
  coverage: z.strictObject({
    totalRecords: z.number().int().nonnegative(),
    evaluatedRecords: z.number().int().nonnegative(),
    skippedRecords: z.number().int().nonnegative(),
  }),
  scenarios: z.array(
    z.strictObject({
      name: z.string(),
      kind: z.enum(["normal", "boundary", "missing_data"]),
      result: z.enum(["passed", "warning", "failed"]),
    }),
  ),
  historicalTotals: z.strictObject({
    payableAmountYuan: z.string().nullable(),
    receivableAmountYuan: z.string().nullable(),
    recordCount: z.number().int().nonnegative(),
  }),
  deltas: z.strictObject({
    payableAmountYuan: z.string(),
    receivableAmountYuan: z.string(),
    percentagePercent: z.string(),
  }),
  largestChanges: z.array(
    z.strictObject({
      dimension: z.enum(["rule_component", "scenario", "period"]),
      key: z.string(),
      deltaAmountYuan: z.string(),
      direction: z.enum(["increase", "decrease", "unchanged"]),
    }),
  ),
  warnings: z.array(warningSchema),
  duplicate: z.boolean().optional(),
});

const summaryScenarioSchema = z.strictObject({
  id: z.string(),
  category: z.enum([
    "zero",
    "threshold_edge",
    "configured_maximum",
    "evidence_level",
    "missing_data_policy",
    "contract_example",
    "ai_test_case",
    "user_example",
  ]),
  outcome: z.enum(["calculated", "review_routed", "blocked"]),
  amountYuan: z.string().nullable(),
  expectedAmountYuan: z.string().nullable(),
  passed: z.boolean(),
});

const simulationSummarySchema = z.strictObject({
  recordCount: z.number().int().nonnegative(),
  coverage: z.strictObject({
    totalCount: z.number().int().nonnegative(),
    evaluatedCount: z.number().int().nonnegative(),
    ratePercent: z.string(),
  }),
  uncoveredCount: z.number().int().nonnegative(),
  zeroPayCount: z.number().int().nonnegative(),
  reviewRoutedCount: z.number().int().nonnegative(),
  blockedCount: z.number().int().nonnegative(),
  largestIncreases: z.array(
    z.strictObject({
      bucket: z.string(),
      deltaYuan: z.string(),
      direction: z.literal("increase"),
    }),
  ),
  largestDecreases: z.array(
    z.strictObject({
      bucket: z.string(),
      deltaYuan: z.string(),
      direction: z.literal("decrease"),
    }),
  ),
  totalOldYuan: z.string().nullable(),
  totalNewYuan: z.string(),
  totalDeltaYuan: z.string().nullable(),
  marginImpactYuan: z.string().nullable(),
  historicalVerification: z.strictObject({
    status: z.enum(["verified", "unverified"]),
    label: z.string(),
  }),
  dataSelectionHash: hashSchema,
  riskFlags: z.array(warningSchema),
  warnings: z.array(warningSchema),
  scenarios: z.array(summaryScenarioSchema),
});

const contractDiffSchema = z.strictObject({
  field: z.enum([
    "schemaVersion",
    "scope",
    "target",
    "executionGrain",
    "compositionMode",
    "title",
    "summary",
    "calculationComponents",
    "requiredInputs",
    "parameters",
    "effectiveStartAt",
    "effectiveEndAt",
    "missingDataPolicy",
    "compositionDescription",
    "businessTimezone",
    "examples",
  ]),
  before: z.unknown(),
  after: z.unknown(),
});

const retryTurnSchema = z.strictObject({
  turnId: z.string(),
  status: z.enum([
    "accepted",
    "grounding",
    "generating",
    "validating",
    "completed",
  ]),
  attempt: z.number().int().positive(),
  duplicate: z.boolean(),
});

const authoringResultSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    ok: z.literal(true),
    kind: z.literal("clarifying"),
    conversationId: z.string(),
    draft: draftSchema,
    diff: z.array(contractDiffSchema),
    duplicate: z.boolean(),
  }),
  z.strictObject({
    ok: z.literal(true),
    kind: z.literal("simulated"),
    conversationId: z.string(),
    draft: draftSchema,
    simulation: simulationSchema,
    summary: simulationSummarySchema,
    duplicate: z.boolean(),
  }),
  z.strictObject({
    ok: z.literal(true),
    kind: z.literal("retry_in_progress"),
    conversationId: z.string(),
    turn: retryTurnSchema,
  }),
  z.strictObject({
    ok: z.literal(true),
    kind: z.literal("retry_readback"),
    conversationId: z.string(),
    draft: draftSchema,
    turn: retryTurnSchema,
  }),
]);

const claimedSessionSchema = z.strictObject({
  id: z.string(),
  title: z.string(),
  status: z.enum(["active", "archived"]),
  lastMessageAt: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const conversationMessageSchema = z.strictObject({
  id: z.string(),
  conversationId: z.string(),
  sequence: z.number().int().nonnegative(),
  role: z.string(),
  status: z.string(),
  content: z.string(),
  parentMessageId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const conversationTurnSchema = z.strictObject({
  id: z.string(),
  conversationId: z.string(),
  userMessageId: z.string(),
  assistantMessageId: z.string().nullable(),
  mode: z.string(),
  status: z.string(),
  attempt: z.number().int().positive(),
  retryOfTurnId: z.string().nullable(),
  regenerateOfTurnId: z.string().nullable(),
  errorCode: z.string().nullable(),
  retryable: z.boolean(),
});

const authoritativeSessionSchema = z.strictObject({
  conversation: claimedSessionSchema,
  messages: z.array(conversationMessageSchema),
  turns: z.array(conversationTurnSchema),
  draft: draftSchema,
  simulation: simulationSchema.nullable(),
});

const catalogSchema = z.strictObject({
  scope: z.enum(["payable", "receivable"]),
  executionGrain: z.enum([
    "report",
    "project_streamer_period",
    "batch",
    "project_period",
  ]),
  businessTimezone: z.string().nullable(),
  businessTimezoneConfirmed: z.boolean(),
  businessTimezoneSource: z.enum([
    "contract_default",
    "organization_setting",
    "confirmed_contract",
    "unresolved",
  ]),
  hasHistory: z.boolean(),
  version: hashSchema,
  variables: z.array(
    z.strictObject({
      id: z.string(),
      label: z.string(),
      runtimeType: runtimeValueTypeSchema,
      unit: z.string(),
      sourceLabel: z.string(),
      availability: z.enum(["available", "partial", "unavailable"]),
      coverageNumerator: z.number().int().nonnegative(),
      coverageDenominator: z.number().int().nonnegative(),
      latestSampledPeriod: z
        .strictObject({ start: z.string(), end: z.string() })
        .nullable(),
    }),
  ),
});

const responseSchemas = {
  catalog: z.strictObject({ catalog: catalogSchema }),
  start: z.strictObject({
    session: claimedSessionSchema,
    result: authoringResultSchema,
  }),
  authoring: z.strictObject({ result: authoringResultSchema }),
  session: z.strictObject({ session: authoritativeSessionSchema }),
};

const errorEnvelopeSchema = z.strictObject({
  error: z.strictObject({
    code: z.string(),
    message: z.string(),
    path: z.array(z.union([z.string(), z.number()])).optional(),
    retryable: z.boolean(),
  }),
});

const SAFE_ERROR_MESSAGES = {
  CUSTOM_RULE_FEATURE_DISABLED: "AI 结算规则当前未启用",
  UNAUTHENTICATED: "登录状态已失效，请重新登录",
  CUSTOM_RULE_FORBIDDEN: "当前账号无权编辑结算规则",
  CUSTOM_RULE_AUTHOR_ROLE_REQUIRED: "当前账号无权编辑结算规则",
  BILLING_WRITE_BLOCKED: "当前套餐或账单状态不允许修改结算规则",
  CUSTOM_RULE_SESSION_NOT_FOUND: "结算规则会话不存在或已失效",
  CUSTOM_RULE_SESSION_CONFLICT: "规则已被更新，请刷新后重试",
  CUSTOM_RULE_IDEMPOTENCY_CONFLICT: "规则已被更新，请刷新后重试",
  CUSTOM_RULE_AI_UNAVAILABLE: "AI 暂时不可用，请稍后重试",
  CUSTOM_RULE_AI_OUTPUT_INVALID: "AI 草案未通过业务校验，请修改说明后重试",
  CUSTOM_RULE_AI_CONTRACT_INVALID: "AI 草案未通过业务校验，请修改说明后重试",
  CUSTOM_RULE_FORMULA_INVALID: "AI 草案未通过业务校验，请修改说明后重试",
  INVALID_REQUEST: "提交内容不完整，请检查后重试",
  INVALID_JSON: "提交内容不完整，请检查后重试",
};

export class CustomSettlementRuleApiError extends Error {
  constructor({ code, status, retryable, message }) {
    super(message);
    this.name = "CustomSettlementRuleApiError";
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

function safeErrorMessage(code) {
  return SAFE_ERROR_MESSAGES[code] ?? "结算规则服务暂时不可用，请稍后重试";
}

function invalidResponseError(status = 0) {
  return new CustomSettlementRuleApiError({
    code: "CUSTOM_RULE_RESPONSE_INVALID",
    status,
    retryable: status === 0 || status >= 500 || (status >= 200 && status < 300),
    message: "结算规则服务返回了无法识别的响应",
  });
}

function networkError() {
  return new CustomSettlementRuleApiError({
    code: "CUSTOM_RULE_NETWORK_ERROR",
    status: 0,
    retryable: true,
    message: "网络连接异常，请稍后重试",
  });
}

function pathSegment(value) {
  return encodeURIComponent(String(value));
}

export function createCustomSettlementRuleApi({
  fetchImpl = (...args) => globalThis.fetch(...args),
} = {}) {
  let activeController = null;

  const beginRequest = (externalSignal) => {
    activeController?.abort();
    const controller = new AbortController();
    activeController = controller;

    const relayAbort = () => controller.abort(externalSignal?.reason);
    if (externalSignal?.aborted) {
      relayAbort();
    } else {
      externalSignal?.addEventListener("abort", relayAbort, { once: true });
    }

    return {
      controller,
      cleanup() {
        externalSignal?.removeEventListener("abort", relayAbort);
        if (activeController === controller) activeController = null;
      },
    };
  };

  const request = async (url, init, schema, externalSignal) => {
    const active = beginRequest(externalSignal);
    try {
      const response = await fetchImpl(url, {
        ...init,
        signal: active.controller.signal,
      });
      let payload;
      try {
        payload = await response.json();
      } catch {
        throw invalidResponseError(response.status);
      }

      if (!response.ok) {
        const parsedError = errorEnvelopeSchema.safeParse(payload);
        if (!parsedError.success) throw invalidResponseError(response.status);
        const safe = parsedError.data.error;
        throw new CustomSettlementRuleApiError({
          code: safe.code,
          status: response.status,
          retryable: safe.retryable,
          message: safeErrorMessage(safe.code),
        });
      }

      const parsed = schema.safeParse(payload);
      if (!parsed.success) throw invalidResponseError(response.status);
      return parsed.data;
    } catch (error) {
      if (error?.name === "AbortError") throw error;
      if (error instanceof CustomSettlementRuleApiError) throw error;
      throw networkError();
    } finally {
      active.cleanup();
    }
  };

  const post = (url, body, schema, signal) =>
    request(
      url,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
      schema,
      signal,
    );

  const baseUrl = (projectId) =>
    `/api/projects/${pathSegment(projectId)}/settlement-rules`;

  return {
    abortActive() {
      activeController?.abort();
    },
    getVariableCatalog({ projectId, scope, executionGrain, signal }) {
      const query = new URLSearchParams({ scope, executionGrain });
      return request(
        `${baseUrl(projectId)}/variable-catalog?${query.toString()}`,
        { method: "GET" },
        responseSchemas.catalog,
        signal,
      );
    },
    startSession({ projectId, body, signal }) {
      return post(
        `${baseUrl(projectId)}/ai-sessions`,
        body,
        responseSchemas.start,
        signal,
      );
    },
    refreshSession({ projectId, sessionId, signal }) {
      return request(
        `${baseUrl(projectId)}/ai-sessions/${pathSegment(sessionId)}`,
        { method: "GET" },
        responseSchemas.session,
        signal,
      );
    },
    answerOrRevise({ projectId, sessionId, body, signal }) {
      return post(
        `${baseUrl(projectId)}/ai-sessions/${pathSegment(sessionId)}/turns`,
        body,
        responseSchemas.authoring,
        signal,
      );
    },
    confirmAndSimulate({ projectId, sessionId, body, signal }) {
      return post(
        `${baseUrl(projectId)}/ai-sessions/${pathSegment(sessionId)}/confirm-contract`,
        body,
        responseSchemas.authoring,
        signal,
      );
    },
  };
}
