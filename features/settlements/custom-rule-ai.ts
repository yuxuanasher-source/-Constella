import { createHash } from "node:crypto";
import { types as nodeTypes } from "node:util";

import { z } from "zod";

import type {
  AiConversationDto,
  AiConversationMessageDto,
  AiConversationTurnDto,
  ConversationContextSnapshot,
  ConversationGatewayContext,
  CreateTurnCommand,
  RetryTurnCommand,
} from "@/features/ai/conversation-contracts";
import type { ConversationActor } from "@/features/ai/conversation-service";
import type { CreatedConversationTurn } from "@/features/ai/conversation-repository";
import type {
  AiGatewayRequest,
  AiGatewayResult,
  AiMessage,
  AiProviderName,
} from "@/features/ai/contracts";

import {
  businessRuleContractPatchSchema,
  businessRuleContractSchema,
  diffBusinessRuleContracts,
  reviseBusinessRuleContract,
  runtimeValueTypeSchema,
  typedRuntimeValueSchema,
  type BusinessRuleContract,
  type BusinessRuleContractChange,
} from "./custom-rule-contract";
import { parseCustomRuleFormula } from "./custom-rule-parser";
import type {
  SettlementAiGeneratedTestCase,
  SettlementAiUnresolvedAmbiguity,
} from "./custom-rule-repository";
import type { NormalizedAstNode } from "./custom-rule-types";
import {
  validateCustomRuleFormula,
  type ValidateCustomRuleFormulaResult,
} from "./custom-rule-validator";
import type { CustomRuleVariableCatalog } from "./custom-rule-variable-catalog";

const MAX_USER_MESSAGE_CHARS = 4_000;
const MAX_CONVERSATION_MESSAGES = 200;
const MAX_CONVERSATION_CHARS = 50_000;
const MAX_PROMPT_CHARS = 100_000;
const MAX_PROVIDER_OUTPUT_CHARS = 100_000;
const MAX_SNAPSHOT_DEPTH = 24;
const MAX_SNAPSHOT_NODES = 20_000;
const MAX_CATALOG_VARIABLES = 300;
const MAX_UNRESOLVED_AMBIGUITIES = 100;
const MAX_TEST_CASES = 100;
const MAX_TEST_CASE_INPUTS = 100;
const HASH_PATTERN = /^[a-f0-9]{64}$/u;
const IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/u;
const PROVIDER_FAILURE_MESSAGE =
  "Settlement AI provider is temporarily unavailable.";

const SYSTEM_PROMPT = [
  "你是结算规则澄清助手，只负责把用户确认的业务含义转换为结构化草案。",
  "每轮最多提出一个聚焦问题。任何未解决事项或未明确确认的合同时，都不得生成公式或测试用例。",
  "公式只是建议，服务器会独立解析、校验、解释和试算。不要声称公式已生效，不要执行结算，也不要索取原始报表或个人金额。",
  "只使用请求中提供的范围安全变量目录。严格返回响应结构，不要添加字段。",
  'Reference configured values only as parameter("parameter_name"); never copy parameter defaults or example amounts into a formula.',
].join("\n");

const canonicalTextSchema = (maximum: number) =>
  z
    .string()
    .min(1)
    .max(maximum)
    .refine((value) => value === value.trim(), {
      message: "text must already be canonical",
    });

const focusedQuestionSchema = canonicalTextSchema(500).refine(
  (value) => {
    if (/\r|\n/u.test(value)) return false;
    const questionMarks = value.match(/[?？]/gu)?.length ?? 0;
    return questionMarks === 1;
  },
  { message: "must contain exactly one focused question" },
);

export const settlementAmbiguitySchema = z.strictObject({
  code: canonicalTextSchema(120).regex(IDENTIFIER_PATTERN),
  question: focusedQuestionSchema,
  required: z.boolean(),
});

export const settlementRuleTestCaseSchema = z
  .strictObject({
    name: canonicalTextSchema(200),
    inputs: z.record(
      z.string().regex(IDENTIFIER_PATTERN),
      typedRuntimeValueSchema,
    ),
    expectedResult: typedRuntimeValueSchema.refine(
      (value) => value.type === "money_cents",
      { message: "settlement formula test cases must expect money" },
    ),
  })
  .superRefine((testCase, context) => {
    if (Object.keys(testCase.inputs).length > MAX_TEST_CASE_INPUTS) {
      context.addIssue({
        code: "custom",
        path: ["inputs"],
        message: "too many test case inputs",
      });
    }
  });

export const settlementDraftResponseSchema = z
  .strictObject({
    contractPatch: businessRuleContractPatchSchema,
    unresolvedAmbiguities: z
      .array(settlementAmbiguitySchema)
      .max(MAX_UNRESOLVED_AMBIGUITIES),
    nextQuestion: focusedQuestionSchema.nullable(),
    formulaProposal: canonicalTextSchema(16_384).nullable(),
    testCases: z.array(settlementRuleTestCaseSchema).max(MAX_TEST_CASES),
    safetyFlags: z.array(canonicalTextSchema(500)).max(100),
  })
  .superRefine((response, context) => {
    const ambiguityCodes = new Set<string>();
    for (const [index, ambiguity] of response.unresolvedAmbiguities.entries()) {
      if (ambiguityCodes.has(ambiguity.code)) {
        context.addIssue({
          code: "custom",
          path: ["unresolvedAmbiguities", index, "code"],
          message: "ambiguity codes must be unique",
        });
      }
      ambiguityCodes.add(ambiguity.code);
    }

    const hasUnresolved = response.unresolvedAmbiguities.length > 0;
    if (hasUnresolved) {
      if (response.formulaProposal !== null) {
        context.addIssue({
          code: "custom",
          path: ["formulaProposal"],
          message: "formula must be absent while ambiguities remain",
        });
      }
      if (response.testCases.length > 0) {
        context.addIssue({
          code: "custom",
          path: ["testCases"],
          message: "test cases must be absent while ambiguities remain",
        });
      }
      if (response.nextQuestion === null) {
        context.addIssue({
          code: "custom",
          path: ["nextQuestion"],
          message: "one focused question is required while ambiguities remain",
        });
      } else if (
        !response.unresolvedAmbiguities.some(
          (ambiguity) => ambiguity.question === response.nextQuestion,
        )
      ) {
        context.addIssue({
          code: "custom",
          path: ["nextQuestion"],
          message: "next question must identify one unresolved ambiguity",
        });
      }
    }

    if (response.formulaProposal === null && response.testCases.length > 0) {
      context.addIssue({
        code: "custom",
        path: ["testCases"],
        message: "test cases require a formula proposal",
      });
    }
    if (response.formulaProposal !== null && response.testCases.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["testCases"],
        message: "a formula proposal requires test cases",
      });
    }
    if (response.formulaProposal !== null && response.nextQuestion !== null) {
      context.addIssue({
        code: "custom",
        path: ["nextQuestion"],
        message: "a confirmed formula response cannot ask another question",
      });
    }
  });

const catalogPeriodSchema = z.strictObject({
  start: canonicalTextSchema(100),
  end: canonicalTextSchema(100),
});
const safeCatalogVariableSchema = z.strictObject({
  id: canonicalTextSchema(120).regex(IDENTIFIER_PATTERN),
  label: canonicalTextSchema(500),
  runtimeType: runtimeValueTypeSchema,
  unit: canonicalTextSchema(100),
  sourceLabel: canonicalTextSchema(500),
  availability: z.enum(["available", "partial", "unavailable"]),
  coverageNumerator: z.number().int().safe().nonnegative(),
  coverageDenominator: z.number().int().safe().nonnegative(),
  latestSampledPeriod: catalogPeriodSchema.nullable(),
});
const safeCatalogSchema = z
  .strictObject({
    scope: z.enum(["receivable", "payable", "external_cost", "reconciliation"]),
    executionGrain: z.enum([
      "report",
      "project_streamer_period",
      "batch",
      "project_period",
    ]),
    businessTimezone: z.string().min(1).max(100).nullable(),
    businessTimezoneConfirmed: z.boolean(),
    businessTimezoneSource: z.enum([
      "contract_default",
      "organization_setting",
      "confirmed_contract",
      "unresolved",
    ]),
    hasHistory: z.boolean(),
    version: z.string().regex(HASH_PATTERN),
    variables: z.array(safeCatalogVariableSchema).max(MAX_CATALOG_VARIABLES),
  })
  .superRefine((catalog, context) => {
    const ids = new Set<string>();
    for (const [index, variable] of catalog.variables.entries()) {
      if (ids.has(variable.id)) {
        context.addIssue({
          code: "custom",
          path: ["variables", index, "id"],
          message: "catalog variable ids must be unique",
        });
      }
      ids.add(variable.id);
      if (variable.coverageNumerator > variable.coverageDenominator) {
        context.addIssue({
          code: "custom",
          path: ["variables", index, "coverageNumerator"],
          message: "coverage numerator cannot exceed denominator",
        });
      }
    }
  });
const conversationMessageSchema = z.strictObject({
  role: z.enum(["system", "user", "assistant", "tool"]),
  content: z.string().max(MAX_USER_MESSAGE_CHARS),
});
const preparedMessageSchema = z.strictObject({
  role: z.enum(["system", "user", "assistant", "tool"]),
  content: z.string().max(MAX_PROMPT_CHARS),
});
const prepareInputSchema = z.strictObject({
  action: z.enum(["clarify", "revise", "confirm"]),
  contractConfirmed: z.boolean(),
  userMessage: z.string().min(1).max(MAX_USER_MESSAGE_CHARS),
  currentContract: businessRuleContractSchema,
  unresolvedAmbiguities: z
    .array(settlementAmbiguitySchema)
    .max(MAX_UNRESOLVED_AMBIGUITIES),
  catalog: safeCatalogSchema,
  conversationMessages: z
    .array(conversationMessageSchema)
    .max(MAX_CONVERSATION_MESSAGES),
});

const frozenRetryContextSchema = z.strictObject({
  version: z.literal(1),
  action: z.enum(["clarify", "revise", "confirm"]),
  contractConfirmed: z.boolean(),
  currentContract: businessRuleContractSchema,
  unresolvedAmbiguities: z
    .array(settlementAmbiguitySchema)
    .max(MAX_UNRESOLVED_AMBIGUITIES),
  catalog: safeCatalogSchema,
  messages: z.array(preparedMessageSchema).max(MAX_CONVERSATION_MESSAGES + 2),
  promptHash: z.string().regex(HASH_PATTERN),
  contextHash: z.string().regex(HASH_PATTERN),
});

/** Public Xingyao service surface used by settlement authoring. */
export type SettlementConversationPort = {
  createConversation(
    actor: ConversationActor,
    title?: string,
  ): Promise<AiConversationDto>;
  getHistory(
    actor: ConversationActor,
    conversationId: string,
  ): Promise<{
    conversation: AiConversationDto;
    messages: AiConversationMessageDto[];
    turns: AiConversationTurnDto[];
  }>;
  acceptTurn(
    actor: ConversationActor,
    conversationId: string,
    command: CreateTurnCommand,
  ): Promise<CreatedConversationTurn>;
  retryTurn(
    actor: ConversationActor,
    sourceTurnId: string,
    command: RetryTurnCommand,
  ): Promise<CreatedConversationTurn>;
  prepareTurn(
    actor: ConversationActor,
    turnId: string,
    groundingRefs?: string[],
  ): Promise<{
    messages: AiMessage[];
    snapshot: ConversationContextSnapshot;
  }>;
  captureGatewayContext(
    actor: ConversationActor,
    turnId: string,
    snapshot: ConversationContextSnapshot,
    gatewayContext: ConversationGatewayContext,
  ): Promise<ConversationContextSnapshot>;
  markGenerating(
    actor: ConversationActor,
    turnId: string,
    providerName?: AiProviderName,
    invocationId?: string,
  ): Promise<void>;
  markValidating(actor: ConversationActor, turnId: string): Promise<void>;
  completeTurn(
    actor: ConversationActor,
    turnId: string,
    input: {
      content: string;
      providerName?: AiProviderName;
      invocationId?: string;
      metadata?: Record<string, unknown>;
    },
  ): Promise<void>;
  failTurn(
    actor: ConversationActor,
    turnId: string,
    input: {
      content?: string;
      providerName?: AiProviderName;
      invocationId?: string;
      errorCode: string;
      errorSummary: string;
      retryable: boolean;
    },
  ): Promise<void>;
};

export type SettlementStructuredGatewayRequest = Extract<
  AiGatewayRequest,
  { kind: "structured" }
>;
export type SettlementStructuredGateway = (
  request: SettlementStructuredGatewayRequest,
) => Promise<AiGatewayResult>;

export type SettlementAiInternalLogEvent = Readonly<{
  category: "provider_exception" | "provider_result_failed";
  providerName?: AiProviderName;
}>;

export type SettlementAiInternalLogger = (
  event: SettlementAiInternalLogEvent,
) => void;

export type PrepareSettlementAiInput = {
  action: "clarify" | "revise" | "confirm";
  contractConfirmed: boolean;
  userMessage: string;
  currentContract: BusinessRuleContract;
  unresolvedAmbiguities: SettlementAiUnresolvedAmbiguity[];
  catalog: CustomRuleVariableCatalog;
  conversationMessages: AiMessage[];
};

export type PreparedSettlementAiRequest = Readonly<{
  request: SettlementStructuredGatewayRequest;
  promptHash: string;
  contextHash: string;
  action: PrepareSettlementAiInput["action"];
  contractConfirmed: boolean;
  currentContract: BusinessRuleContract;
  catalog: CustomRuleVariableCatalog;
  retryContext: FrozenSettlementAiContext;
}>;

export type FrozenSettlementAiContext = Readonly<{
  version: 1;
  action: PrepareSettlementAiInput["action"];
  contractConfirmed: boolean;
  currentContract: BusinessRuleContract;
  unresolvedAmbiguities: SettlementAiUnresolvedAmbiguity[];
  catalog: CustomRuleVariableCatalog;
  messages: AiMessage[];
  promptHash: string;
  contextHash: string;
}>;

type SuccessfulFormulaValidation = Extract<
  ValidateCustomRuleFormulaResult,
  { ok: true }
> & { normalizedAst: NormalizedAstNode };

export type SettlementAiSuccess = Readonly<{
  ok: true;
  contract: BusinessRuleContract;
  diff: BusinessRuleContractChange[];
  unresolvedAmbiguities: SettlementAiUnresolvedAmbiguity[];
  nextQuestion: string | null;
  formulaProposal: string | null;
  testCases: SettlementAiGeneratedTestCase[];
  safetyFlags: string[];
  validation: SuccessfulFormulaValidation | null;
  promptHash: string;
  contextHash: string;
  providerName?: AiProviderName;
}>;

export type SettlementAiFailureCode =
  | "SETTLEMENT_AI_PROVIDER_FAILED"
  | "SETTLEMENT_AI_OUTPUT_INVALID"
  | "SETTLEMENT_AI_CONTRACT_INVALID"
  | "SETTLEMENT_AI_FORMULA_INVALID";

export type SettlementAiFailure = Readonly<{
  ok: false;
  code: SettlementAiFailureCode;
  retryable: true;
  message: string;
  promptHash: string;
  contextHash: string;
  providerName?: AiProviderName;
}>;

export type SettlementAiResult = SettlementAiSuccess | SettlementAiFailure;

export class SettlementAiInputError extends TypeError {
  readonly code = "SETTLEMENT_AI_INPUT_INVALID";

  constructor(message: string) {
    super(message);
    this.name = "SettlementAiInputError";
  }
}

export function createSettlementRuleAiAdapter(input: {
  gateway: SettlementStructuredGateway;
  internalLogger?: SettlementAiInternalLogger;
}) {
  if (
    typeof input?.gateway !== "function" ||
    (input.internalLogger !== undefined &&
      typeof input.internalLogger !== "function")
  ) {
    throw new SettlementAiInputError("a structured AI gateway is required");
  }
  const gateway = input.gateway;
  const internalLogger = input.internalLogger;

  return Object.freeze({
    prepare(
      unsafeInput: PrepareSettlementAiInput,
    ): PreparedSettlementAiRequest {
      const snapshot = snapshotForValidation(unsafeInput, MAX_PROMPT_CHARS);
      const parsed = prepareInputSchema.safeParse(snapshot);
      if (!parsed.success) {
        throw new SettlementAiInputError("settlement AI input is invalid");
      }
      validatePreparationState(parsed.data);

      const catalog = {
        ...parsed.data.catalog,
        variables: [...parsed.data.catalog.variables].sort((left, right) =>
          left.id.localeCompare(right.id),
        ),
      };
      const unresolvedAmbiguities = [...parsed.data.unresolvedAmbiguities].sort(
        compareAmbiguities,
      );
      const promptPayload = {
        action: parsed.data.action,
        catalog,
        contractConfirmed: parsed.data.contractConfirmed,
        contractStructure: projectContractStructure(
          parsed.data.currentContract,
        ),
        protocolVersion: 2,
        unresolvedAmbiguities,
        userMessage: parsed.data.userMessage,
      };
      const userPrompt = canonicalJson(promptPayload);
      const messages: AiMessage[] = [
        { role: "system", content: SYSTEM_PROMPT },
        ...parsed.data.conversationMessages,
        { role: "user", content: userPrompt },
      ];
      const conversationChars = parsed.data.conversationMessages.reduce(
        (total, message) => total + message.content.length,
        0,
      );
      if (
        conversationChars > MAX_CONVERSATION_CHARS ||
        userPrompt.length > MAX_PROMPT_CHARS
      ) {
        throw new SettlementAiInputError(
          "settlement AI prompt budget exceeded",
        );
      }
      const promptHash = sha256(canonicalJson(messages));
      const contextHash = hashPreparedContext({
        catalogVersion: catalog.version,
        currentContract: parsed.data.currentContract,
        messages,
        unresolvedAmbiguities,
      });
      return createPreparedRequest({
        promptHash,
        contextHash,
        action: parsed.data.action,
        contractConfirmed: parsed.data.contractConfirmed,
        currentContract: parsed.data.currentContract,
        unresolvedAmbiguities,
        catalog,
        messages,
      });
    },

    restore(unsafeContext: unknown): PreparedSettlementAiRequest {
      const snapshot = snapshotForValidation(
        unsafeContext,
        MAX_PROMPT_CHARS * 2,
      );
      const parsed = frozenRetryContextSchema.safeParse(snapshot);
      if (!parsed.success) {
        throw new SettlementAiInputError(
          "frozen settlement AI context is invalid",
        );
      }
      validatePreparationState({
        action: parsed.data.action,
        contractConfirmed: parsed.data.contractConfirmed,
        userMessage: "technical-retry",
        currentContract: parsed.data.currentContract,
        unresolvedAmbiguities: parsed.data.unresolvedAmbiguities,
        catalog: parsed.data.catalog,
        conversationMessages: [],
      });
      const messages = parsed.data.messages.map((message) => ({ ...message }));
      const promptHash = sha256(canonicalJson(messages));
      const contextHash = hashPreparedContext({
        catalogVersion: parsed.data.catalog.version,
        currentContract: parsed.data.currentContract,
        messages,
        unresolvedAmbiguities: parsed.data.unresolvedAmbiguities,
      });
      if (
        promptHash !== parsed.data.promptHash ||
        contextHash !== parsed.data.contextHash
      ) {
        throw new SettlementAiInputError(
          "frozen settlement AI context hash mismatch",
        );
      }
      return createPreparedRequest({
        promptHash,
        contextHash,
        action: parsed.data.action,
        contractConfirmed: parsed.data.contractConfirmed,
        currentContract: parsed.data.currentContract,
        unresolvedAmbiguities: parsed.data.unresolvedAmbiguities,
        catalog: parsed.data.catalog,
        messages,
      });
    },

    async execute(
      prepared: PreparedSettlementAiRequest,
    ): Promise<SettlementAiResult> {
      validatePreparedRequest(prepared);
      let gatewayResult: AiGatewayResult;
      try {
        gatewayResult = await gateway(
          toMutableGatewayRequest(prepared.request),
        );
      } catch {
        logInternal(internalLogger, { category: "provider_exception" });
        return failure(
          prepared,
          "SETTLEMENT_AI_PROVIDER_FAILED",
          PROVIDER_FAILURE_MESSAGE,
        );
      }

      if (gatewayResult.status !== "succeeded") {
        logInternal(internalLogger, {
          category: "provider_result_failed",
          providerName: gatewayResult.providerName,
        });
        return failure(
          prepared,
          "SETTLEMENT_AI_PROVIDER_FAILED",
          PROVIDER_FAILURE_MESSAGE,
          gatewayResult.providerName,
        );
      }

      let providerSnapshot: unknown;
      try {
        providerSnapshot = snapshotForValidation(
          gatewayResult.structuredOutput,
          MAX_PROVIDER_OUTPUT_CHARS,
        );
      } catch {
        return failure(
          prepared,
          "SETTLEMENT_AI_OUTPUT_INVALID",
          "provider output is not inert own data",
          gatewayResult.providerName,
        );
      }
      const parsedOutput =
        settlementDraftResponseSchema.safeParse(providerSnapshot);
      if (!parsedOutput.success) {
        return failure(
          prepared,
          "SETTLEMENT_AI_OUTPUT_INVALID",
          "provider output did not match the settlement draft schema",
          gatewayResult.providerName,
        );
      }
      const orderedOutput = orderProviderOutput(parsedOutput.data);
      const stateIssue = validateProviderState(prepared, orderedOutput);
      if (stateIssue) {
        return failure(
          prepared,
          "SETTLEMENT_AI_OUTPUT_INVALID",
          stateIssue,
          gatewayResult.providerName,
        );
      }

      let contract: BusinessRuleContract;
      try {
        contract = reviseBusinessRuleContract(
          prepared.currentContract,
          orderedOutput.contractPatch,
        );
      } catch {
        return failure(
          prepared,
          "SETTLEMENT_AI_CONTRACT_INVALID",
          "provider contract patch produced an invalid business contract",
          gatewayResult.providerName,
        );
      }
      if (
        contract.scope !== prepared.catalog.scope ||
        contract.executionGrain !== prepared.catalog.executionGrain
      ) {
        return failure(
          prepared,
          "SETTLEMENT_AI_CONTRACT_INVALID",
          "contract scope or grain no longer matches the frozen catalog",
          gatewayResult.providerName,
        );
      }

      let validation: SuccessfulFormulaValidation | null = null;
      if (orderedOutput.formulaProposal !== null) {
        const validated = validateCustomRuleFormula(
          orderedOutput.formulaProposal,
          {
            scope: contract.scope,
            executionGrain: contract.executionGrain,
            parameters: contract.parameters.map((parameter) => ({
              name: parameter.name,
              valueType: parameter.valueType,
            })),
          },
        );
        if (!validated.ok) {
          return failure(
            prepared,
            "SETTLEMENT_AI_FORMULA_INVALID",
            validated.issues
              .map((issue) => issue.code)
              .sort()
              .join(", "),
            gatewayResult.providerName,
          );
        }
        const normalized = parseCustomRuleFormula(
          orderedOutput.formulaProposal,
        );
        if (!normalized.ok) {
          return failure(
            prepared,
            "SETTLEMENT_AI_FORMULA_INVALID",
            normalized.issues
              .map((issue) => issue.code)
              .sort()
              .join(", "),
            gatewayResult.providerName,
          );
        }
        validation = deepFreezeOwned({
          ...validated,
          normalizedAst: normalized.ast,
        });
      }

      const success: SettlementAiSuccess = {
        ok: true,
        contract: deepFreezeOwned(contract),
        diff: deepFreezeOwned(
          diffBusinessRuleContracts(prepared.currentContract, contract),
        ),
        unresolvedAmbiguities: deepFreezeOwned(
          orderedOutput.unresolvedAmbiguities,
        ),
        nextQuestion: orderedOutput.nextQuestion,
        formulaProposal: orderedOutput.formulaProposal,
        testCases: deepFreezeOwned(orderedOutput.testCases),
        safetyFlags: deepFreezeOwned(orderedOutput.safetyFlags),
        validation,
        promptHash: prepared.promptHash,
        contextHash: prepared.contextHash,
        providerName: gatewayResult.providerName,
      };
      return Object.freeze(success);
    },
  });
}

function logInternal(
  logger: SettlementAiInternalLogger | undefined,
  event: SettlementAiInternalLogEvent,
): void {
  if (!logger) return;
  try {
    logger(
      event.providerName === undefined
        ? { category: event.category }
        : { category: event.category, providerName: event.providerName },
    );
  } catch {
    // Internal observability must not affect the authoring result.
  }
}

function toMutableGatewayRequest(
  frozen: SettlementStructuredGatewayRequest,
): SettlementStructuredGatewayRequest {
  return {
    ...frozen,
    messages: frozen.messages.map((message) => ({ ...message })),
    metadata: frozen.metadata ? { ...frozen.metadata } : undefined,
    attachments: frozen.attachments?.map((attachment) => ({ ...attachment })),
  };
}

function validatePreparationState(
  input: z.infer<typeof prepareInputSchema>,
): void {
  if (input.contractConfirmed !== (input.action === "confirm")) {
    throw new SettlementAiInputError(
      "only the confirm action can carry explicit contract confirmation",
    );
  }
  if (
    input.currentContract.scope !== input.catalog.scope ||
    input.currentContract.executionGrain !== input.catalog.executionGrain
  ) {
    throw new SettlementAiInputError(
      "business contract scope and grain must match the catalog",
    );
  }
  if (
    input.catalog.businessTimezoneConfirmed &&
    input.catalog.businessTimezone !== input.currentContract.businessTimezone
  ) {
    throw new SettlementAiInputError(
      "confirmed catalog timezone must match the business contract",
    );
  }
}

function validateProviderState(
  prepared: PreparedSettlementAiRequest,
  output: z.infer<typeof settlementDraftResponseSchema>,
): string | null {
  if (prepared.contractConfirmed) {
    if (output.unresolvedAmbiguities.length > 0) {
      return "confirmed contract response cannot contain unresolved ambiguities";
    }
    if (
      output.nextQuestion !== null ||
      output.formulaProposal === null ||
      output.testCases.length === 0
    ) {
      return "confirmed contract response requires one formula and test cases";
    }
    return null;
  }

  if (output.formulaProposal !== null || output.testCases.length > 0) {
    return "unconfirmed contract response cannot contain formula evidence";
  }
  if (output.nextQuestion === null) {
    return "unconfirmed contract response must ask one focused question";
  }
  return null;
}

function validatePreparedRequest(prepared: PreparedSettlementAiRequest): void {
  if (
    !prepared ||
    !Object.isFrozen(prepared) ||
    !HASH_PATTERN.test(prepared.promptHash) ||
    !HASH_PATTERN.test(prepared.contextHash) ||
    prepared.request.kind !== "structured" ||
    prepared.request.responseSchema !== settlementDraftResponseSchema ||
    !Object.isFrozen(prepared.retryContext)
  ) {
    throw new SettlementAiInputError(
      "prepared settlement AI request is invalid",
    );
  }
}

function createPreparedRequest(input: {
  promptHash: string;
  contextHash: string;
  action: PrepareSettlementAiInput["action"];
  contractConfirmed: boolean;
  currentContract: BusinessRuleContract;
  unresolvedAmbiguities: SettlementAiUnresolvedAmbiguity[];
  catalog: CustomRuleVariableCatalog;
  messages: AiMessage[];
}): PreparedSettlementAiRequest {
  const currentContract = deepFreezeOwned(
    businessRuleContractSchema.parse(
      snapshotForValidation(input.currentContract, MAX_PROMPT_CHARS),
    ),
  );
  const catalog = deepFreezeOwned(
    safeCatalogSchema.parse(
      snapshotForValidation(input.catalog, MAX_PROMPT_CHARS),
    ),
  );
  const unresolvedAmbiguities = deepFreezeOwned(
    z
      .array(settlementAmbiguitySchema)
      .parse(
        snapshotForValidation(input.unresolvedAmbiguities, MAX_PROMPT_CHARS),
      ),
  );
  const frozenMessages = deepFreezeOwned(
    z
      .array(preparedMessageSchema)
      .parse(snapshotForValidation(input.messages, MAX_PROMPT_CHARS)),
  );
  const retryContext = deepFreezeOwned({
    version: 1 as const,
    action: input.action,
    contractConfirmed: input.contractConfirmed,
    currentContract,
    unresolvedAmbiguities,
    catalog,
    messages: frozenMessages.map((message) => ({ ...message })),
    promptHash: input.promptHash,
    contextHash: input.contextHash,
  });
  const request: SettlementStructuredGatewayRequest = Object.freeze({
    kind: "structured" as const,
    promptKey: "settlements.custom-rule-authoring",
    promptVersion: 2,
    messages: frozenMessages,
    responseSchema: settlementDraftResponseSchema,
    mode: "fast" as const,
    metadata: Object.freeze({
      catalogVersion: catalog.version,
      executionGrain: catalog.executionGrain,
      promptHash: input.promptHash,
      scope: catalog.scope,
    }),
  });
  return Object.freeze({
    request,
    promptHash: input.promptHash,
    contextHash: input.contextHash,
    action: input.action,
    contractConfirmed: input.contractConfirmed,
    currentContract,
    catalog,
    retryContext,
  });
}

function hashPreparedContext(input: {
  catalogVersion: string;
  currentContract: BusinessRuleContract;
  messages: AiMessage[];
  unresolvedAmbiguities: SettlementAiUnresolvedAmbiguity[];
}): string {
  return sha256(
    canonicalJson({
      catalogVersion: input.catalogVersion,
      contract: input.currentContract,
      messages: input.messages,
      unresolvedAmbiguities: input.unresolvedAmbiguities,
    }),
  );
}

function projectContractStructure(contract: BusinessRuleContract) {
  return {
    schemaVersion: contract.schemaVersion,
    scope: contract.scope,
    target: { targetType: contract.target.targetType },
    executionGrain: contract.executionGrain,
    compositionMode: contract.compositionMode,
    calculationComponents: [...contract.calculationComponents]
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((component) => ({
        id: component.name,
        resultType: component.resultType,
      })),
    requiredVariables: [...contract.requiredInputs]
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((required) => ({
        id: required.name,
        valueType: required.valueType,
      })),
    parameters: [...contract.parameters]
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((parameter) => ({
        name: parameter.name,
        valueType: parameter.valueType,
      })),
    missingDataPolicy: { action: contract.missingDataPolicy.action },
  };
}

function orderProviderOutput(
  output: z.infer<typeof settlementDraftResponseSchema>,
): z.infer<typeof settlementDraftResponseSchema> {
  return {
    contractPatch: output.contractPatch,
    unresolvedAmbiguities: [...output.unresolvedAmbiguities].sort(
      compareAmbiguities,
    ),
    nextQuestion: output.nextQuestion,
    formulaProposal: output.formulaProposal,
    testCases: [...output.testCases].sort((left, right) => {
      const byName = left.name.localeCompare(right.name);
      return byName || canonicalJson(left).localeCompare(canonicalJson(right));
    }),
    safetyFlags: [...new Set(output.safetyFlags)].sort((left, right) =>
      left.localeCompare(right),
    ),
  };
}

function compareAmbiguities(
  left: SettlementAiUnresolvedAmbiguity,
  right: SettlementAiUnresolvedAmbiguity,
): number {
  return (
    left.code.localeCompare(right.code) ||
    left.question.localeCompare(right.question) ||
    Number(right.required) - Number(left.required)
  );
}

function failure(
  prepared: PreparedSettlementAiRequest,
  code: SettlementAiFailureCode,
  message: string,
  providerName?: AiProviderName,
): SettlementAiFailure {
  return Object.freeze({
    ok: false,
    code,
    retryable: true,
    message: message.slice(0, 2_000),
    promptHash: prepared.promptHash,
    contextHash: prepared.contextHash,
    providerName,
  });
}

function snapshotForValidation(
  value: unknown,
  maxStringCharacters: number,
): unknown {
  const budget = { nodes: 0, stringCharacters: 0, maxStringCharacters };
  try {
    return snapshotOwnData(value, budget, 0);
  } catch (error) {
    if (error instanceof SettlementAiInputError) throw error;
    throw new SettlementAiInputError("value is not inert own data");
  }
}

function snapshotOwnData(
  value: unknown,
  budget: {
    nodes: number;
    stringCharacters: number;
    maxStringCharacters: number;
  },
  depth: number,
): unknown {
  budget.nodes += 1;
  if (budget.nodes > MAX_SNAPSHOT_NODES || depth > MAX_SNAPSHOT_DEPTH) {
    throw new SettlementAiInputError("own-data snapshot budget exceeded");
  }
  if (typeof value === "string") {
    budget.stringCharacters += value.length;
    if (budget.stringCharacters > budget.maxStringCharacters) {
      throw new SettlementAiInputError("own-data string budget exceeded");
    }
    return value;
  }
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "undefined"
  ) {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new SettlementAiInputError("non-finite numbers are forbidden");
    }
    return value;
  }
  if (typeof value !== "object" || nodeTypes.isProxy(value)) {
    throw new SettlementAiInputError("only inert data values are accepted");
  }

  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new SettlementAiInputError("symbol properties are forbidden");
  }
  if (Array.isArray(value)) {
    const output: unknown[] = [];
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (!descriptor || !("value" in descriptor)) {
        throw new SettlementAiInputError(
          "sparse or accessor arrays are forbidden",
        );
      }
      output.push(snapshotOwnData(descriptor.value, budget, depth + 1));
    }
    const extraKeys = Object.keys(descriptors).filter(
      (key) => key !== "length" && !/^\d+$/u.test(key),
    );
    if (extraKeys.length > 0) {
      throw new SettlementAiInputError("array properties are forbidden");
    }
    return output;
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new SettlementAiInputError("class instances are forbidden");
  }
  const output: Record<string, unknown> = {};
  for (const key of Object.keys(descriptors).sort()) {
    if (key === "__proto__" || key === "prototype" || key === "constructor") {
      throw new SettlementAiInputError("unsafe property name");
    }
    const descriptor = descriptors[key];
    if (!("value" in descriptor) || !descriptor.enumerable) {
      throw new SettlementAiInputError(
        "accessors and hidden properties are forbidden",
      );
    }
    output[key] = snapshotOwnData(descriptor.value, budget, depth + 1);
  }
  return output;
}

function deepFreezeOwned<Value>(value: Value): Value {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  for (const descriptor of Object.values(
    Object.getOwnPropertyDescriptors(value),
  )) {
    if ("value" in descriptor) deepFreezeOwned(descriptor.value);
  }
  return Object.freeze(value);
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  return `{${Object.keys(value)
    .sort()
    .map(
      (key) =>
        `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`,
    )
    .join(",")}}`;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
