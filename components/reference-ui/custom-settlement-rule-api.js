import { z } from "zod";

import {
  businessRuleContractSchema,
  customRuleExecutionGrainSchema,
  customRuleScopeSchema,
  runtimeValueTypeSchema,
  typedRuntimeValueSchema,
} from "../../features/settlements/custom-rule-contract";

const hashSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const uuidSchema = z.string().uuid();
const canonicalTimestampSchema = z.iso.datetime({ offset: true });
const nonnegativeSafeIntegerSchema = z
  .number()
  .int()
  .nonnegative()
  .refine(Number.isSafeInteger, { message: "must be a safe integer" });
const positiveSafeIntegerSchema = z
  .number()
  .int()
  .positive()
  .refine(Number.isSafeInteger, { message: "must be a safe integer" });
const canonicalTextSchema = (maximum) =>
  z
    .string()
    .min(1)
    .max(maximum)
    .refine((value) => value === value.trim(), {
      message: "text must already be canonical",
    });
const identifierSchema = canonicalTextSchema(120).regex(
  /^[A-Za-z_][A-Za-z0-9_]*$/u,
);

function isValidBusinessDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(0, 0, 0, 0);
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function isValidIanaTimezone(value) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(0);
    return true;
  } catch {
    return false;
  }
}

const businessDateSchema = z.string().refine(isValidBusinessDate, {
  message: "must be a valid business date",
});
const ianaTimezoneSchema = canonicalTextSchema(100).refine(
  isValidIanaTimezone,
  { message: "must be a valid IANA timezone" },
);
const POSTGRES_BIGINT_MIN = BigInt("-9223372036854775808");
const POSTGRES_BIGINT_MAX = BigInt("9223372036854775807");
const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);
const MIN_SAFE_BIGINT = BigInt(Number.MIN_SAFE_INTEGER);

function fixedTwoDecimal(value) {
  const negative = value < 0;
  const absolute = negative ? -value : value;
  const whole = absolute / BigInt(100);
  const fraction = String(absolute % BigInt(100)).padStart(2, "0");
  return `${negative ? "-" : ""}${whole}.${fraction}`;
}

function isCanonicalScaledDecimal(value, minimum, maximum) {
  if (!/^-?(?:0|[1-9]\d*)\.\d{2}$/u.test(value)) return false;
  try {
    const scaled = BigInt(value.replace(".", ""));
    return (
      scaled >= minimum &&
      scaled <= maximum &&
      fixedTwoDecimal(scaled) === value
    );
  } catch {
    return false;
  }
}

const yuanDecimalSchema = z
  .string()
  .refine(
    (value) =>
      isCanonicalScaledDecimal(value, POSTGRES_BIGINT_MIN, POSTGRES_BIGINT_MAX),
    { message: "must be a canonical yuan decimal" },
  );
const percentDecimalSchema = z
  .string()
  .refine(
    (value) =>
      isCanonicalScaledDecimal(value, MIN_SAFE_BIGINT, MAX_SAFE_BIGINT),
    { message: "must be a canonical percentage decimal" },
  );
const coveragePercentSchema = percentDecimalSchema.refine((value) => {
  const basisPoints = BigInt(value.replace(".", ""));
  return basisPoints >= BigInt(0) && basisPoints <= BigInt(10_000);
});

const ambiguitySchema = z.strictObject({
  code: identifierSchema,
  question: canonicalTextSchema(500).refine((value) => {
    if (/\r|\n/u.test(value)) return false;
    return (value.match(/[?？]/gu)?.length ?? 0) === 1;
  }),
  required: z.boolean(),
});

const generatedTestCaseSchema = z
  .strictObject({
    name: canonicalTextSchema(200),
    inputs: z.record(identifierSchema, typedRuntimeValueSchema),
    expectedResult: typedRuntimeValueSchema.refine(
      (value) => value.type === "money_cents",
      { message: "settlement results must use money" },
    ),
  })
  .superRefine((testCase, context) => {
    if (Object.keys(testCase.inputs).length > 100) {
      context.addIssue({
        code: "custom",
        path: ["inputs"],
        message: "too many test case inputs",
      });
    }
  });

const safetyFlagSchema = z.strictObject({
  code: canonicalTextSchema(120),
  severity: z.enum(["info", "warning", "block"]),
  message: canonicalTextSchema(4_000),
});

const REQUIRED_BUSINESS_CONTRACT_OUTPUT_FIELDS = [
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
];
const businessRuleContractOutputSchema = z
  .unknown()
  .superRefine((value, context) => {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return;
    }
    for (const field of REQUIRED_BUSINESS_CONTRACT_OUTPUT_FIELDS) {
      if (!Object.prototype.hasOwnProperty.call(value, field)) {
        context.addIssue({
          code: "custom",
          path: [field],
          message: "required public contract field is missing",
        });
      }
    }
  })
  .pipe(businessRuleContractSchema);

const draftSchema = z
  .strictObject({
    id: uuidSchema,
    conversationId: uuidSchema,
    revisionNumber: positiveSafeIntegerSchema,
    status: z.enum([
      "clarifying",
      "failed",
      "contract_ready",
      "simulated",
      "superseded",
    ]),
    initialStatus: z.enum(["clarifying", "failed", "contract_ready"]),
    businessContract: businessRuleContractOutputSchema,
    unresolvedAmbiguities: z.array(ambiguitySchema).max(100),
    variableCatalogVersion: hashSchema,
    generatedFormula: z
      .strictObject({ expression: canonicalTextSchema(20_000) })
      .nullable(),
    generatedExplanation: canonicalTextSchema(100_000).nullable(),
    generatedTestCases: z.array(generatedTestCaseSchema).max(200),
    safetyFlags: z.array(safetyFlagSchema).max(100),
    contractHash: hashSchema,
    formulaHash: hashSchema.nullable(),
    parameterHash: hashSchema,
    createdAt: canonicalTimestampSchema,
    supersedesDraftId: uuidSchema.nullable(),
    supersededByDraftId: uuidSchema.nullable(),
    supersededAt: canonicalTimestampSchema.nullable(),
  })
  .superRefine((draft, context) => {
    const readyShape = draft.initialStatus === "contract_ready";
    const clarifyingShape = draft.initialStatus === "clarifying";
    const allowedStatuses = readyShape
      ? ["contract_ready", "simulated", "superseded"]
      : clarifyingShape
        ? ["clarifying", "superseded"]
        : ["failed", "superseded"];
    if (!allowedStatuses.includes(draft.status)) {
      context.addIssue({
        code: "custom",
        path: ["status"],
        message: "draft status does not match its initial state",
      });
    }

    if (readyShape) {
      if (draft.unresolvedAmbiguities.length !== 0) {
        context.addIssue({ code: "custom", path: ["unresolvedAmbiguities"] });
      }
      if (
        !draft.generatedFormula ||
        !draft.generatedExplanation ||
        draft.generatedTestCases.length === 0 ||
        !draft.formulaHash
      ) {
        context.addIssue({
          code: "custom",
          path: ["generatedFormula"],
          message: "ready drafts require deterministic artifacts",
        });
      }
    } else {
      if (clarifyingShape && draft.unresolvedAmbiguities.length === 0) {
        context.addIssue({ code: "custom", path: ["unresolvedAmbiguities"] });
      }
      if (
        draft.generatedFormula !== null ||
        draft.generatedExplanation !== null ||
        draft.generatedTestCases.length !== 0 ||
        draft.formulaHash !== null
      ) {
        context.addIssue({
          code: "custom",
          path: ["generatedFormula"],
          message: "unready drafts cannot expose deterministic artifacts",
        });
      }
    }

    const superseded = draft.status === "superseded";
    if (superseded !== Boolean(draft.supersededByDraftId)) {
      context.addIssue({ code: "custom", path: ["supersededByDraftId"] });
    }
    if (superseded !== Boolean(draft.supersededAt)) {
      context.addIssue({ code: "custom", path: ["supersededAt"] });
    }
  });

const warningSchema = z.strictObject({
  code: canonicalTextSchema(120),
  severity: z.enum(["info", "warning", "block"]),
  message: canonicalTextSchema(4_000),
});

const sampleSelectionSchema = z
  .strictObject({
    periodStart: businessDateSchema,
    periodEnd: businessDateSchema,
    populationCount: nonnegativeSafeIntegerSchema,
    sampledCount: nonnegativeSafeIntegerSchema,
    criteria: z.array(canonicalTextSchema(200)).max(100),
  })
  .superRefine((selection, context) => {
    if (selection.periodStart > selection.periodEnd) {
      context.addIssue({ code: "custom", path: ["periodStart"] });
    }
    if (selection.sampledCount > selection.populationCount) {
      context.addIssue({ code: "custom", path: ["sampledCount"] });
    }
  });
const simulationCoverageSchema = z
  .strictObject({
    totalRecords: nonnegativeSafeIntegerSchema,
    evaluatedRecords: nonnegativeSafeIntegerSchema,
    skippedRecords: nonnegativeSafeIntegerSchema,
  })
  .superRefine((coverage, context) => {
    if (
      coverage.evaluatedRecords + coverage.skippedRecords !==
      coverage.totalRecords
    ) {
      context.addIssue({ code: "custom", path: ["totalRecords"] });
    }
  });
const simulationSchema = z
  .strictObject({
    id: uuidSchema,
    createdAt: canonicalTimestampSchema,
    dataSelectionHash: hashSchema,
    sampleSource: z.strictObject({
      kind: z.enum([
        "historical_settlements",
        "approved_operations",
        "synthetic_scenarios",
      ]),
    }),
    sampleSelection: sampleSelectionSchema,
    coverage: simulationCoverageSchema,
    scenarios: z
      .array(
        z.strictObject({
          name: canonicalTextSchema(200),
          kind: z.enum(["normal", "boundary", "missing_data"]),
          result: z.enum(["passed", "warning", "failed"]),
        }),
      )
      .min(1)
      .max(200),
    historicalTotals: z.strictObject({
      payableAmountYuan: yuanDecimalSchema.nullable(),
      receivableAmountYuan: yuanDecimalSchema.nullable(),
      recordCount: nonnegativeSafeIntegerSchema,
    }),
    deltas: z.strictObject({
      payableAmountYuan: yuanDecimalSchema,
      receivableAmountYuan: yuanDecimalSchema,
      percentagePercent: percentDecimalSchema,
    }),
    largestChanges: z
      .array(
        z.strictObject({
          dimension: z.enum(["rule_component", "scenario", "period"]),
          key: canonicalTextSchema(200),
          deltaAmountYuan: yuanDecimalSchema,
          direction: z.enum(["increase", "decrease", "unchanged"]),
        }),
      )
      .max(100),
    warnings: z.array(warningSchema).max(100),
    duplicate: z.boolean().optional(),
  })
  .superRefine((simulation, context) => {
    if (
      simulation.sampleSelection.sampledCount !==
      simulation.coverage.totalRecords
    ) {
      context.addIssue({
        code: "custom",
        path: ["sampleSelection", "sampledCount"],
      });
    }
    if (
      simulation.historicalTotals.recordCount !==
      simulation.coverage.totalRecords
    ) {
      context.addIssue({
        code: "custom",
        path: ["historicalTotals", "recordCount"],
      });
    }
  });

const summaryScenarioSchema = z.strictObject({
  id: canonicalTextSchema(200),
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
  amountYuan: yuanDecimalSchema.nullable(),
  expectedAmountYuan: yuanDecimalSchema.nullable(),
  passed: z.boolean(),
});

const summaryChangeSchema = (direction) =>
  z.strictObject({
    bucket: canonicalTextSchema(200),
    deltaYuan: yuanDecimalSchema,
    direction: z.literal(direction),
  });
const simulationSummarySchema = z
  .strictObject({
    recordCount: nonnegativeSafeIntegerSchema,
    coverage: z.strictObject({
      totalCount: nonnegativeSafeIntegerSchema,
      evaluatedCount: nonnegativeSafeIntegerSchema,
      ratePercent: coveragePercentSchema,
    }),
    uncoveredCount: nonnegativeSafeIntegerSchema,
    zeroPayCount: nonnegativeSafeIntegerSchema,
    reviewRoutedCount: nonnegativeSafeIntegerSchema,
    blockedCount: nonnegativeSafeIntegerSchema,
    largestIncreases: z.array(summaryChangeSchema("increase")).max(100),
    largestDecreases: z.array(summaryChangeSchema("decrease")).max(100),
    totalOldYuan: yuanDecimalSchema.nullable(),
    totalNewYuan: yuanDecimalSchema,
    totalDeltaYuan: yuanDecimalSchema.nullable(),
    marginImpactYuan: yuanDecimalSchema.nullable(),
    historicalVerification: z.discriminatedUnion("status", [
      z.strictObject({
        status: z.literal("verified"),
        label: z.literal("已通过历史数据验证"),
      }),
      z.strictObject({
        status: z.literal("unverified"),
        label: z.literal("未经过历史数据验证"),
      }),
    ]),
    dataSelectionHash: hashSchema,
    riskFlags: z.array(warningSchema).max(100),
    warnings: z.array(warningSchema).max(100),
    scenarios: z.array(summaryScenarioSchema).min(1).max(500),
  })
  .superRefine((summary, context) => {
    const { totalCount, evaluatedCount, ratePercent } = summary.coverage;
    if (totalCount !== summary.recordCount || evaluatedCount > totalCount) {
      context.addIssue({ code: "custom", path: ["coverage"] });
    }
    if (summary.uncoveredCount > totalCount) {
      context.addIssue({ code: "custom", path: ["uncoveredCount"] });
    }
    if (
      evaluatedCount + summary.reviewRoutedCount + summary.blockedCount !==
      totalCount
    ) {
      context.addIssue({ code: "custom", path: ["coverage"] });
    }
    if (summary.zeroPayCount > evaluatedCount) {
      context.addIssue({ code: "custom", path: ["zeroPayCount"] });
    }
    const expectedBps =
      totalCount === 0
        ? BigInt(0)
        : (BigInt(evaluatedCount) * BigInt(10_000)) / BigInt(totalCount);
    if (ratePercent !== fixedTwoDecimal(expectedBps)) {
      context.addIssue({ code: "custom", path: ["coverage", "ratePercent"] });
    }
    for (const field of ["zeroPayCount", "reviewRoutedCount", "blockedCount"]) {
      if (summary[field] > summary.recordCount) {
        context.addIssue({ code: "custom", path: [field] });
      }
    }
    const verified = summary.historicalVerification.status === "verified";
    if (verified !== (summary.totalOldYuan !== null)) {
      context.addIssue({ code: "custom", path: ["totalOldYuan"] });
    }
    if (verified !== (summary.totalDeltaYuan !== null)) {
      context.addIssue({ code: "custom", path: ["totalDeltaYuan"] });
    }
    if (verified) {
      const oldCents = BigInt(summary.totalOldYuan.replace(".", ""));
      const newCents = BigInt(summary.totalNewYuan.replace(".", ""));
      const deltaCents = BigInt(summary.totalDeltaYuan.replace(".", ""));
      if (newCents - oldCents !== deltaCents) {
        context.addIssue({ code: "custom", path: ["totalDeltaYuan"] });
      }
    }
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

const clarifyingResultObjectSchema = z.strictObject({
  ok: z.literal(true),
  kind: z.literal("clarifying"),
  conversationId: uuidSchema,
  draft: draftSchema,
  diff: z.array(contractDiffSchema).max(17),
  duplicate: z.boolean(),
});

const simulatedResultObjectSchema = z.strictObject({
  ok: z.literal(true),
  kind: z.literal("simulated"),
  conversationId: uuidSchema,
  draft: draftSchema,
  simulation: simulationSchema,
  summary: simulationSummarySchema,
  duplicate: z.boolean(),
});

const startInProgressResultObjectSchema = z.strictObject({
  ok: z.literal(true),
  kind: z.literal("retry_in_progress"),
  conversationId: uuidSchema,
  turn: z.strictObject({
    turnId: uuidSchema,
    status: z.enum(["accepted", "grounding", "generating", "validating"]),
    attempt: z.union([z.literal(1), z.literal(2)]),
    duplicate: z.boolean(),
  }),
});

function validateClarifyingResult(result, context) {
  if (result.draft.conversationId !== result.conversationId) {
    context.addIssue({ code: "custom", path: ["draft", "conversationId"] });
  }
  if (
    result.draft.initialStatus !== "clarifying" ||
    !["clarifying", "superseded"].includes(result.draft.status)
  ) {
    context.addIssue({ code: "custom", path: ["draft", "status"] });
  }
  if (result.draft.status === "superseded" && !result.duplicate) {
    context.addIssue({ code: "custom", path: ["duplicate"] });
  }
}

function validateSimulatedResult(result, context) {
  if (result.draft.conversationId !== result.conversationId) {
    context.addIssue({ code: "custom", path: ["draft", "conversationId"] });
  }
  if (result.draft.status !== "simulated") {
    context.addIssue({ code: "custom", path: ["draft", "status"] });
  }
  if (
    result.simulation.dataSelectionHash !== result.summary.dataSelectionHash
  ) {
    context.addIssue({
      code: "custom",
      path: ["summary", "dataSelectionHash"],
    });
  }
  if (
    result.simulation.coverage.totalRecords !== result.summary.recordCount ||
    result.simulation.coverage.evaluatedRecords !==
      result.summary.coverage.evaluatedCount
  ) {
    context.addIssue({ code: "custom", path: ["summary", "coverage"] });
  }
}

const startResultSchema = z
  .discriminatedUnion("kind", [
    clarifyingResultObjectSchema,
    startInProgressResultObjectSchema,
  ])
  .superRefine((result, context) => {
    if (result.kind === "clarifying") {
      validateClarifyingResult(result, context);
    } else {
      const { attempt, status, duplicate } = result.turn;
      const validProgress =
        (attempt === 1 && duplicate) ||
        (attempt === 2 && (duplicate || status !== "accepted"));
      if (!validProgress) {
        context.addIssue({ code: "custom", path: ["turn"] });
      }
    }
  });
const answerResultSchema = clarifyingResultObjectSchema.superRefine(
  validateClarifyingResult,
);
const confirmResultSchema = simulatedResultObjectSchema.superRefine(
  validateSimulatedResult,
);

const claimedSessionSchema = z.strictObject({
  id: uuidSchema,
  title: canonicalTextSchema(120),
  status: z.enum(["active", "archived"]),
  lastMessageAt: canonicalTimestampSchema,
  createdAt: canonicalTimestampSchema,
  updatedAt: canonicalTimestampSchema,
});

const conversationMessageSchema = z.strictObject({
  id: uuidSchema,
  conversationId: uuidSchema,
  sequence: nonnegativeSafeIntegerSchema,
  role: z.enum(["user", "assistant", "system", "tool"]),
  status: z.enum(["pending", "streaming", "completed", "failed", "superseded"]),
  content: z.string().max(100_000),
  parentMessageId: uuidSchema.nullable(),
  createdAt: canonicalTimestampSchema,
  updatedAt: canonicalTimestampSchema,
});

const conversationTurnSchema = z.strictObject({
  id: uuidSchema,
  conversationId: uuidSchema,
  userMessageId: uuidSchema,
  assistantMessageId: uuidSchema.nullable(),
  mode: z.enum(["fast", "deep"]),
  status: z.enum([
    "accepted",
    "grounding",
    "generating",
    "validating",
    "completed",
    "failed",
    "cancelled",
  ]),
  attempt: positiveSafeIntegerSchema,
  retryOfTurnId: uuidSchema.nullable(),
  regenerateOfTurnId: uuidSchema.nullable(),
  errorCode: canonicalTextSchema(200).nullable(),
  retryable: z.boolean(),
});

const authoritativeSessionSchema = z
  .strictObject({
    conversation: claimedSessionSchema,
    messages: z.array(conversationMessageSchema).max(500),
    turns: z.array(conversationTurnSchema).max(500),
    draft: draftSchema,
    simulation: simulationSchema.nullable(),
  })
  .superRefine((session, context) => {
    const conversationId = session.conversation.id;
    if (session.draft.conversationId !== conversationId) {
      context.addIssue({ code: "custom", path: ["draft", "conversationId"] });
    }
    for (const [index, message] of session.messages.entries()) {
      if (message.conversationId !== conversationId) {
        context.addIssue({
          code: "custom",
          path: ["messages", index, "conversationId"],
        });
      }
    }
    for (const [index, turn] of session.turns.entries()) {
      if (turn.conversationId !== conversationId) {
        context.addIssue({
          code: "custom",
          path: ["turns", index, "conversationId"],
        });
      }
    }
    if (session.simulation && session.draft.status !== "simulated") {
      context.addIssue({ code: "custom", path: ["simulation"] });
    }
  });

const catalogPeriodSchema = z
  .strictObject({ start: businessDateSchema, end: businessDateSchema })
  .refine((period) => period.start <= period.end);
const catalogVariableSchema = z
  .strictObject({
    id: identifierSchema,
    label: canonicalTextSchema(500),
    runtimeType: runtimeValueTypeSchema,
    unit: canonicalTextSchema(100),
    sourceLabel: canonicalTextSchema(500),
    availability: z.enum(["available", "partial", "unavailable"]),
    coverageNumerator: nonnegativeSafeIntegerSchema,
    coverageDenominator: nonnegativeSafeIntegerSchema,
    latestSampledPeriod: catalogPeriodSchema.nullable(),
  })
  .refine(
    (variable) => variable.coverageNumerator <= variable.coverageDenominator,
    { path: ["coverageNumerator"] },
  );
const catalogSchema = z
  .strictObject({
    scope: customRuleScopeSchema,
    executionGrain: customRuleExecutionGrainSchema,
    businessTimezone: ianaTimezoneSchema.nullable(),
    businessTimezoneConfirmed: z.boolean(),
    businessTimezoneSource: z.enum([
      "contract_default",
      "organization_setting",
      "confirmed_contract",
      "unresolved",
    ]),
    hasHistory: z.boolean(),
    version: hashSchema,
    variables: z.array(catalogVariableSchema).max(300),
  })
  .superRefine((catalog, context) => {
    const ids = new Set();
    for (const [index, variable] of catalog.variables.entries()) {
      if (ids.has(variable.id)) {
        context.addIssue({ code: "custom", path: ["variables", index, "id"] });
      }
      ids.add(variable.id);
    }
    if (
      catalog.businessTimezoneConfirmed &&
      (!catalog.businessTimezone ||
        catalog.businessTimezoneSource === "unresolved" ||
        (catalog.businessTimezoneSource === "contract_default" &&
          catalog.businessTimezone !== "Asia/Shanghai"))
    ) {
      context.addIssue({ code: "custom", path: ["businessTimezoneConfirmed"] });
    }
  });

const responseSchemas = {
  catalog: z.strictObject({ catalog: catalogSchema }),
  start: z
    .strictObject({
      session: claimedSessionSchema,
      result: startResultSchema,
    })
    .superRefine((payload, context) => {
      if (payload.session.id !== payload.result.conversationId) {
        context.addIssue({
          code: "custom",
          path: ["result", "conversationId"],
        });
      }
    }),
  answer: z.strictObject({ result: answerResultSchema }),
  confirm: z.strictObject({ result: confirmResultSchema }),
  session: z.strictObject({ session: authoritativeSessionSchema }),
};

const publicErrorCodeSchema = z.enum([
  "CUSTOM_RULE_FEATURE_DISABLED",
  "UNAUTHENTICATED",
  "CUSTOM_RULE_FORBIDDEN",
  "CUSTOM_RULE_AUTHOR_ROLE_REQUIRED",
  "BILLING_WRITE_BLOCKED",
  "CUSTOM_RULE_SESSION_NOT_FOUND",
  "CUSTOM_RULE_SESSION_CONFLICT",
  "CUSTOM_RULE_IDEMPOTENCY_CONFLICT",
  "CUSTOM_RULE_AI_UNAVAILABLE",
  "CUSTOM_RULE_AI_OUTPUT_INVALID",
  "CUSTOM_RULE_AI_CONTRACT_INVALID",
  "CUSTOM_RULE_FORMULA_INVALID",
  "CUSTOM_RULE_PROJECT_NOT_FOUND",
  "CUSTOM_RULE_STORAGE_UNAVAILABLE",
  "CUSTOM_RULE_CATALOG_UNAVAILABLE",
  "CUSTOM_RULE_INVALID_TRANSITION",
  "CUSTOM_RULE_STALE_REVISION",
  "CUSTOM_RULE_UNRESOLVED_AMBIGUITIES",
  "CUSTOM_RULE_DUPLICATE_CONFIRMATION",
  "CUSTOM_RULE_STALE_CONTRACT",
  "CUSTOM_RULE_STALE_CATALOG",
  "CUSTOM_RULE_STALE_FORMULA",
  "CUSTOM_RULE_STALE_EVIDENCE",
  "CUSTOM_RULE_STALE_SELECTION",
  "CUSTOM_RULE_DATA_NOT_READY",
  "CUSTOM_RULE_SIMULATION_INVALID",
  "CUSTOM_RULE_SELECTION_UNSUPPORTED",
  "CUSTOM_RULE_SELECTION_TOO_LARGE",
  "CUSTOM_RULE_EVIDENCE_AMBIGUOUS",
  "CUSTOM_RULE_EVIDENCE_FIELD_UNAVAILABLE",
  "CUSTOM_RULE_EVIDENCE_INVALID",
  "CUSTOM_RULE_EVIDENCE_UNAVAILABLE",
  "CUSTOM_RULE_UNIT_MISMATCH",
  "CUSTOM_RULE_RESPONSE_INVALID",
  "CUSTOM_RULE_INTERNAL_ERROR",
  "INVALID_REQUEST",
  "INVALID_JSON",
]);
const errorEnvelopeSchema = z
  .strictObject({
    error: z.strictObject({
      code: z.unknown(),
      message: z.string(),
      path: z.array(z.union([z.string(), z.number()])).optional(),
      retryable: z.boolean(),
    }),
  })
  .transform(({ error }) => ({
    error: {
      code:
        publicErrorCodeSchema.safeParse(error.code).data ??
        "CUSTOM_RULE_REQUEST_FAILED",
      retryable: error.retryable,
    },
  }));

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
  CUSTOM_RULE_CATALOG_UNAVAILABLE: "变量目录暂时不可用，请稍后重试",
  CUSTOM_RULE_RESPONSE_INVALID: "结算规则服务返回了无法识别的响应",
  CUSTOM_RULE_NETWORK_ERROR: "网络连接异常，请稍后重试",
  CUSTOM_RULE_PROCESSING_TIMEOUT: "处理尚未完成，请刷新查看最新状态",
  CUSTOM_RULE_REQUEST_FAILED: "结算规则服务暂时不可用，请稍后重试",
  INVALID_REQUEST: "提交内容不完整，请检查后重试",
  INVALID_JSON: "提交内容不完整，请检查后重试",
};

const SAFE_LOCAL_ERROR_CODES = new Set([
  "CUSTOM_RULE_NETWORK_ERROR",
  "CUSTOM_RULE_PROCESSING_TIMEOUT",
  "CUSTOM_RULE_REQUEST_FAILED",
]);

export class CustomSettlementRuleApiError extends Error {
  constructor({ code, status, retryable }) {
    const safeCode = safeErrorCode(code);
    super(safeErrorMessage(safeCode));
    this.name = "CustomSettlementRuleApiError";
    this.code = safeCode;
    this.status = status;
    this.retryable = retryable;
  }
}

function safeErrorCode(code) {
  const publicCode = publicErrorCodeSchema.safeParse(code);
  if (publicCode.success) return publicCode.data;
  return SAFE_LOCAL_ERROR_CODES.has(code) ? code : "CUSTOM_RULE_REQUEST_FAILED";
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
        responseSchemas.answer,
        signal,
      );
    },
    confirmAndSimulate({ projectId, sessionId, body, signal }) {
      return post(
        `${baseUrl(projectId)}/ai-sessions/${pathSegment(sessionId)}/confirm-contract`,
        body,
        responseSchemas.confirm,
        signal,
      );
    },
  };
}
