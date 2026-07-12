import { createHash } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { z } from "zod";

import {
  ConversationServiceError,
  createConversationService,
  createSupabaseConversationPersistence,
} from "@/features/ai/conversation-service";
import type { ConversationRepositoryClient } from "@/features/ai/conversation-repository";
import { runAiGateway } from "@/features/ai/llm-gateway";
import {
  createConfiguredAiProviders,
  resolveAiProviderRouting,
} from "@/features/ai/provider-registry";
import type { AuditLogInput } from "@/lib/audit/audit";
import { writeAuditLog } from "@/lib/audit/audit";
import { getAuthContext, type AuthContext } from "@/lib/auth/context";
import {
  createSupabaseAdminClient,
  createSupabaseServerClient,
} from "@/lib/db/supabase-server";
import { isMcnStaff, type AppRole } from "@/lib/rbac/roles";

import { createSettlementRuleAiAdapter } from "./custom-rule-ai";
import { businessRuleContractSchema } from "./custom-rule-contract";
import {
  analyzeCustomRuleDataReadiness,
  type CustomRuleInputRequirement,
} from "./custom-rule-data-readiness";
import { buildCustomRuleTemplateExplanation } from "./custom-rule-explanation";
import { isCustomSettlementRulesEnabled } from "./custom-rule-feature-flag";
import { parseCustomRuleFormula } from "./custom-rule-parser";
import {
  SupabaseCustomRuleReadRepository,
  type CustomRuleDraft,
  type SettlementFormulaSimulation,
} from "./custom-rule-repository";
import {
  CustomRuleAuthoringServiceError,
  createCustomRuleAuthoringService,
  type AuthorizedSimulationEvidencePort,
  type AuthorizedSimulationSelectionRequest,
  type CustomRuleAuthoringResult,
} from "./custom-rule-service";
import {
  calculateCustomRuleDataSelectionHash,
  calculateCustomRuleEvidenceHash,
  freezeAuthorizedCustomRuleSimulationEvidence,
  hashCustomRuleContract,
  hashCustomRuleParameters,
  simulateCustomSettlementRule,
  type AuthorizedCustomRuleSimulationEvidence,
  type CustomRuleSimulationResult,
} from "./custom-rule-simulation";
import type { TypedRuntimeValue } from "./custom-rule-types";
import { validateCustomRuleFormula } from "./custom-rule-validator";
import {
  buildCustomRuleVariableCatalog,
  type CustomRuleVariableCatalog,
} from "./custom-rule-variable-catalog";

const AUTHOR_ROLES = new Set<AppRole>([
  "owner",
  "ops_manager",
  "operator_business",
]);

export type SafeCustomRuleError = {
  code: string;
  message: string;
  path?: Array<string | number>;
  retryable: boolean;
};

export class CustomRuleRouteError extends Error {
  readonly code: string;
  readonly status: number;
  readonly retryable: boolean;
  readonly path?: Array<string | number>;

  constructor(input: SafeCustomRuleError & { status: number }) {
    super(input.message);
    this.name = "CustomRuleRouteError";
    this.code = input.code;
    this.status = input.status;
    this.retryable = input.retryable;
    this.path = input.path;
  }
}

type ConversationService = ReturnType<typeof createConversationService>;
type AuthoringService = ReturnType<typeof createCustomRuleAuthoringService>;

export type SimulateExistingDraftInput = {
  actor: { organizationId: string; userId: string };
  projectId: string;
  conversationId: string;
  draftId: string;
  expectedRevisionNumber: number;
  clientRequestId: string;
  selection: AuthorizedSimulationSelectionRequest;
};

export type AuthorizeCustomRuleSelectionInput = Omit<
  SimulateExistingDraftInput,
  "clientRequestId" | "selection"
> & {
  selection: Omit<AuthorizedSimulationSelectionRequest, "selectionToken">;
};

export type CustomRuleEvidenceAdapter = AuthorizedSimulationEvidencePort & {
  authorizeSelection(
    input: AuthorizeCustomRuleSelectionInput,
  ): Promise<AuthorizedSimulationSelectionRequest>;
};

export type CustomRuleRouteContext = {
  supabase: SupabaseClient;
  auth: AuthContext;
  actor: { organizationId: string; userId: string };
  conversation: ConversationService;
  repository: SupabaseCustomRuleReadRepository;
  catalog: {
    getCatalog(input: {
      organizationId: string;
      projectId: string;
      scope: CustomRuleDraft["businessContract"]["scope"];
      executionGrain: CustomRuleDraft["businessContract"]["executionGrain"];
    }): Promise<CustomRuleVariableCatalog>;
  };
  evidence: CustomRuleEvidenceAdapter;
  authorizeSimulationSelection(
    input: AuthorizeCustomRuleSelectionInput,
  ): Promise<AuthorizedSimulationSelectionRequest>;
  authoring: AuthoringService;
  simulation: {
    simulateExistingDraft(input: SimulateExistingDraftInput): Promise<{
      draft: CustomRuleDraft;
      simulation: SettlementFormulaSimulation & { duplicate?: boolean };
      summary: CustomRuleSimulationResult;
    }>;
  };
  requireProjectAccess(projectId: string): Promise<void>;
  audit(input: AuditLogInput): Promise<void>;
};

export async function getCustomRuleRouteContext(): Promise<
  CustomRuleRouteContext | Response
> {
  if (!isCustomSettlementRulesEnabled()) {
    return safeErrorResponse(
      {
        code: "CUSTOM_RULE_FEATURE_DISABLED",
        message: "Custom settlement rule authoring is disabled",
        retryable: false,
      },
      404,
    );
  }

  const supabase = await createSupabaseServerClient();
  const auth = supabase ? await getAuthContext(supabase) : null;
  if (!supabase || !auth) {
    return safeErrorResponse(
      {
        code: "UNAUTHENTICATED",
        message: "Authentication is required",
        retryable: false,
      },
      401,
    );
  }
  if (!isMcnStaff(auth.role)) {
    return safeErrorResponse(
      {
        code: "CUSTOM_RULE_FORBIDDEN",
        message: "Settlement rule authoring is limited to MCN staff",
        retryable: false,
      },
      403,
    );
  }

  const admin = createSupabaseAdminClient();
  if (!admin) {
    return safeErrorResponse(
      {
        code: "CUSTOM_RULE_STORAGE_UNAVAILABLE",
        message: "Settlement rule authoring storage is unavailable",
        retryable: true,
      },
      503,
    );
  }

  const actor = {
    organizationId: auth.organizationId,
    userId: auth.userId,
  };
  const conversation = createConversationService(
    createSupabaseConversationPersistence(
      admin as unknown as ConversationRepositoryClient,
    ),
  );
  const repository = new SupabaseCustomRuleReadRepository(supabase);
  const catalog = {
    async getCatalog(input: {
      organizationId: string;
      projectId: string;
      scope: CustomRuleDraft["businessContract"]["scope"];
      executionGrain: CustomRuleDraft["businessContract"]["executionGrain"];
    }) {
      const coverage = await repository.getProjectVariableCoverage({
        organizationId: input.organizationId,
        projectId: input.projectId,
      });
      return buildCustomRuleVariableCatalog({
        scope: input.scope,
        executionGrain: input.executionGrain,
        coverage,
      });
    },
  };
  const evidence = createSupabaseCustomRuleEvidenceAdapter({
    client: supabase,
    repository,
  });
  const providers = createConfiguredAiProviders();
  const routing = resolveAiProviderRouting();
  const primaryProvider =
    providers.find((provider) => provider.name === routing.primaryProvider)
      ?.name ?? providers[0]?.name;
  if (!primaryProvider) {
    return safeErrorResponse(
      {
        code: "CUSTOM_RULE_AI_UNAVAILABLE",
        message: "Settlement rule AI is unavailable",
        retryable: true,
      },
      503,
    );
  }
  const ai = createSettlementRuleAiAdapter({
    gateway: (request) => runAiGateway({ providers, primaryProvider, request }),
  });
  const authoring = createCustomRuleAuthoringService({
    conversation,
    ai,
    repository,
    catalog,
    evidence,
    analyzeReadiness: analyzeCustomRuleDataReadiness,
    simulate: simulateCustomSettlementRule,
    primaryProvider,
    persistFailedRevisions: true,
  });
  const simulation = createExistingDraftSimulationService({
    repository,
    catalog,
    evidence,
  });

  return {
    supabase,
    auth,
    actor,
    conversation,
    repository,
    catalog,
    evidence,
    authorizeSimulationSelection: (input) => evidence.authorizeSelection(input),
    authoring,
    simulation,
    requireProjectAccess: (projectId) =>
      requireProjectAccess(supabase, auth.organizationId, projectId),
    audit: (input) => writeAuditLog(supabase, input),
  };
}

export function assertCustomRuleAuthorRole(role: AppRole): void {
  if (!AUTHOR_ROLES.has(role)) {
    throw new CustomRuleRouteError({
      code: "CUSTOM_RULE_AUTHOR_ROLE_REQUIRED",
      message: "Current role cannot author settlement rules",
      status: 403,
      retryable: false,
    });
  }
}

export async function parseCustomRuleJson<Schema extends z.ZodType>(
  request: Request,
  schema: Schema,
): Promise<z.output<Schema>> {
  let value: unknown;
  try {
    value = await request.json();
  } catch {
    throw new CustomRuleRouteError({
      code: "INVALID_JSON",
      message: "Request body must be valid JSON",
      status: 400,
      retryable: false,
    });
  }
  return parseWithSchema(value, schema);
}

export function parseCustomRuleParams<Schema extends z.ZodType>(
  value: unknown,
  schema: Schema,
): z.output<Schema> {
  return parseWithSchema(value, schema);
}

export function customRuleErrorResponse(error: unknown): Response {
  if (error instanceof CustomRuleRouteError) {
    return safeErrorResponse(
      {
        code: error.code,
        message: error.message,
        ...(error.path ? { path: error.path } : {}),
        retryable: error.retryable,
      },
      error.status,
    );
  }
  if (error instanceof CustomRuleAuthoringServiceError) {
    return authoringErrorResponse(error);
  }
  if (error instanceof ConversationServiceError) {
    if (
      error.code === "conversation_not_found" ||
      error.code === "turn_not_found"
    ) {
      return safeErrorResponse(
        {
          code: "CUSTOM_RULE_SESSION_NOT_FOUND",
          message: "Settlement rule session not found",
          retryable: false,
        },
        404,
      );
    }
    if (
      error.code === "turn_state_conflict" ||
      error.code === "turn_not_retryable" ||
      error.code === "turn_not_regeneratable"
    ) {
      return safeErrorResponse(
        {
          code: "CUSTOM_RULE_SESSION_CONFLICT",
          message: "Settlement rule session state changed",
          retryable: false,
        },
        409,
      );
    }
  }
  if (
    error instanceof Error &&
    (/^Organization is read-only because billing /u.test(error.message) ||
      /^Current plan is not entitled to /u.test(error.message))
  ) {
    return safeErrorResponse(
      {
        code: "BILLING_WRITE_BLOCKED",
        message: error.message,
        retryable: false,
      },
      403,
    );
  }
  return safeErrorResponse(
    {
      code: "CUSTOM_RULE_INTERNAL_ERROR",
      message: "Unable to process settlement rule request",
      retryable: true,
    },
    500,
  );
}

export function customRuleResolvedFailureResponse(
  result: CustomRuleAuthoringResult,
): Response | null {
  if (result.ok) return null;
  const mappings: Record<
    string,
    { code: string; message: string; status: number }
  > = {
    SETTLEMENT_AI_PROVIDER_FAILED: {
      code: "CUSTOM_RULE_AI_UNAVAILABLE",
      message: "Settlement rule AI is unavailable",
      status: 503,
    },
    SETTLEMENT_AI_OUTPUT_INVALID: {
      code: "CUSTOM_RULE_AI_OUTPUT_INVALID",
      message: "Settlement rule AI output did not pass validation",
      status: 422,
    },
    SETTLEMENT_AI_CONTRACT_INVALID: {
      code: "CUSTOM_RULE_AI_CONTRACT_INVALID",
      message: "Settlement rule AI contract did not pass validation",
      status: 422,
    },
    SETTLEMENT_AI_FORMULA_INVALID: {
      code: "CUSTOM_RULE_FORMULA_INVALID",
      message: "Settlement rule AI formula did not pass validation",
      status: 422,
    },
    persistence_failed: {
      code: "CUSTOM_RULE_STORAGE_UNAVAILABLE",
      message: "Settlement rule authoring storage is unavailable",
      status: 503,
    },
    conversation_failed: {
      code: "CUSTOM_RULE_AI_UNAVAILABLE",
      message: "Settlement rule AI is unavailable",
      status: 503,
    },
  };
  const mapping = mappings[result.code] ?? {
    code: "CUSTOM_RULE_INTERNAL_ERROR",
    message: "Unable to process settlement rule request",
    status: 500,
  };
  return safeErrorResponse(
    {
      code: mapping.code,
      message: mapping.message,
      retryable: result.retryable,
    },
    mapping.status,
  );
}

export function toCustomRuleAuthoringDto(result: CustomRuleAuthoringResult) {
  if (!result.ok) {
    return {
      ok: false,
      ...("kind" in result ? { kind: result.kind } : {}),
      code: result.code,
      retryable: result.retryable,
      conversationId: result.conversationId,
      ...(result.failedDraft
        ? { failedDraft: toCustomRuleDraftDto(result.failedDraft) }
        : {}),
    };
  }
  if (result.kind === "clarifying") {
    return {
      ok: true,
      kind: result.kind,
      conversationId: result.conversationId,
      draft: toCustomRuleDraftDto(result.draft),
      diff: result.diff,
      duplicate: result.duplicate,
    };
  }
  if (result.kind === "simulated") {
    return {
      ok: true,
      kind: result.kind,
      conversationId: result.conversationId,
      draft: toCustomRuleDraftDto(result.draft),
      simulation: toCustomRuleSimulationDto(result.simulation),
      summary: toCustomRuleSimulationSummaryDto(result.summary),
      duplicate: result.duplicate,
    };
  }
  if (result.kind === "retry_readback") {
    return {
      ok: true,
      kind: result.kind,
      conversationId: result.conversationId,
      draft: toCustomRuleDraftDto(result.draft),
      turn: result.turn,
    };
  }
  return result;
}

export function toCustomRuleDraftDto(draft: CustomRuleDraft) {
  return {
    id: draft.id,
    conversationId: draft.conversationId,
    revisionNumber: draft.revisionNumber,
    status: draft.status,
    initialStatus: draft.initialStatus,
    businessContract: draft.businessContract,
    unresolvedAmbiguities: draft.unresolvedAmbiguities,
    variableCatalogVersion: draft.variableCatalogVersion,
    generatedFormula: draft.generatedFormula
      ? { expression: draft.generatedFormula.expression }
      : null,
    generatedExplanation: draft.generatedExplanation,
    generatedTestCases: draft.generatedTestCases,
    safetyFlags: draft.safetyFlags,
    contractHash: draft.contractHash,
    formulaHash: draft.formulaHash,
    parameterHash: draft.parameterHash,
    createdAt: draft.createdAt,
    supersedesDraftId: draft.supersedesDraftId,
    supersededByDraftId: draft.supersededByDraftId,
    supersededAt: draft.supersededAt,
  };
}

export function toCustomRuleSimulationSummaryDto(
  summary: CustomRuleSimulationResult,
) {
  return {
    recordCount: summary.recordCount,
    coverage: {
      totalCount: summary.coverage.totalCount,
      evaluatedCount: summary.coverage.evaluatedCount,
      ratePercent: bpsToPercent(summary.coverage.rateBps),
    },
    uncoveredCount: summary.uncoveredCount,
    zeroPayCount: summary.zeroPayCount,
    reviewRoutedCount: summary.reviewRoutedCount,
    blockedCount: summary.blockedCount,
    largestIncreases: summary.largestIncreases.map((change) => ({
      bucket: change.bucket,
      deltaYuan: centsToYuan(change.deltaAmountCents),
      direction: change.direction,
    })),
    largestDecreases: summary.largestDecreases.map((change) => ({
      bucket: change.bucket,
      deltaYuan: centsToYuan(change.deltaAmountCents),
      direction: change.direction,
    })),
    totalOldYuan: centsToYuan(summary.totalOldCents),
    totalNewYuan: centsToYuan(summary.totalNewCents),
    totalDeltaYuan: centsToYuan(summary.totalDeltaCents),
    marginImpactYuan: centsToYuan(summary.marginImpactCents),
    historicalVerification: summary.historicalVerification,
    dataSelectionHash: summary.dataSelectionHash,
    riskFlags: summary.riskFlags,
    warnings: summary.warnings,
    scenarios: summary.scenarios.map((scenario) => ({
      id: scenario.id,
      category: scenario.category,
      outcome: scenario.outcome,
      amountYuan: centsToYuan(scenario.amountCents),
      expectedAmountYuan: centsToYuan(scenario.expectedAmountCents),
      passed: scenario.passed,
    })),
  };
}

export function toCustomRuleSimulationDto(
  simulation: SettlementFormulaSimulation & { duplicate?: boolean },
) {
  return {
    id: simulation.id,
    createdAt: simulation.createdAt,
    dataSelectionHash: simulation.dataSelectionHash,
    sampleSource: simulation.sampleSource,
    sampleSelection: simulation.sampleSelection,
    coverage: simulation.coverage,
    scenarios: simulation.scenarios,
    historicalTotals: {
      payableAmountYuan: centsToYuan(
        simulation.historicalTotals.payableAmountCents,
      ),
      receivableAmountYuan: centsToYuan(
        simulation.historicalTotals.receivableAmountCents,
      ),
      recordCount: simulation.historicalTotals.recordCount,
    },
    deltas: {
      payableAmountYuan: centsToYuan(simulation.deltas.payableAmountCents),
      receivableAmountYuan: centsToYuan(
        simulation.deltas.receivableAmountCents,
      ),
      percentagePercent: bpsToPercent(simulation.deltas.percentageBps),
    },
    largestChanges: simulation.largestChanges.map((change) => ({
      dimension: change.dimension,
      key: change.key,
      deltaAmountYuan: centsToYuan(change.deltaAmountCents),
      direction: change.direction,
    })),
    warnings: simulation.warnings,
    ...(simulation.duplicate === undefined
      ? {}
      : { duplicate: simulation.duplicate }),
  };
}

export function toCustomRuleSessionDto(input: {
  history: Awaited<ReturnType<ConversationService["getHistory"]>>;
  draft: CustomRuleDraft;
  simulation: SettlementFormulaSimulation | null;
}) {
  return {
    conversation: input.history.conversation,
    messages: input.history.messages.map((message) => ({
      id: message.id,
      conversationId: message.conversationId,
      sequence: message.sequence,
      role: message.role,
      status: message.status,
      content: message.content,
      parentMessageId: message.parentMessageId,
      createdAt: message.createdAt,
      updatedAt: message.updatedAt,
    })),
    turns: input.history.turns.map((turn) => ({
      id: turn.id,
      conversationId: turn.conversationId,
      userMessageId: turn.userMessageId,
      assistantMessageId: turn.assistantMessageId,
      mode: turn.mode,
      status: turn.status,
      attempt: turn.attempt,
      retryOfTurnId: turn.retryOfTurnId,
      regenerateOfTurnId: turn.regenerateOfTurnId,
      errorCode: turn.errorCode,
      retryable: turn.retryable,
    })),
    draft: toCustomRuleDraftDto(input.draft),
    simulation: input.simulation
      ? toCustomRuleSimulationDto(input.simulation)
      : null,
  };
}

function createExistingDraftSimulationService(input: {
  repository: SupabaseCustomRuleReadRepository;
  catalog: CustomRuleRouteContext["catalog"];
  evidence: AuthorizedSimulationEvidencePort;
}): CustomRuleRouteContext["simulation"] {
  return {
    async simulateExistingDraft(scope) {
      const drafts = await input.repository.listDrafts({
        organizationId: scope.actor.organizationId,
        projectId: scope.projectId,
        conversationId: scope.conversationId,
        revisionOrder: "desc",
        limit: 1,
      });
      const draft = drafts[0];
      if (!draft) {
        throw new CustomRuleRouteError({
          code: "CUSTOM_RULE_SESSION_NOT_FOUND",
          message: "Settlement rule session not found",
          status: 404,
          retryable: false,
        });
      }
      if (
        draft.id !== scope.draftId ||
        draft.revisionNumber !== scope.expectedRevisionNumber
      ) {
        throw new CustomRuleRouteError({
          code: "CUSTOM_RULE_STALE_REVISION",
          message: "Settlement rule draft is stale",
          status: 409,
          retryable: false,
        });
      }
      if (
        draft.initialStatus !== "contract_ready" ||
        (draft.status !== "contract_ready" && draft.status !== "simulated")
      ) {
        throw new CustomRuleRouteError({
          code: "CUSTOM_RULE_INVALID_TRANSITION",
          message: "Settlement rule draft is not ready for simulation",
          status: 409,
          retryable: false,
        });
      }

      const contract = businessRuleContractSchema.parse(draft.businessContract);
      const validation = validateCustomRuleFormula(
        draft.generatedFormula.expression,
        {
          scope: contract.scope,
          executionGrain: contract.executionGrain,
          parameters: contract.parameters.map((parameter) => ({
            name: parameter.name,
            valueType: parameter.valueType,
          })),
        },
      );
      const parsed = parseCustomRuleFormula(draft.generatedFormula.expression);
      if (
        !validation.ok ||
        !parsed.ok ||
        validation.formulaHash !== draft.formulaHash ||
        JSON.stringify(parsed.ast) !==
          JSON.stringify(draft.generatedFormula.normalizedAst) ||
        buildCustomRuleTemplateExplanation({ ast: validation.compiledAst }) !==
          draft.generatedExplanation
      ) {
        throw new CustomRuleRouteError({
          code: "CUSTOM_RULE_FORMULA_INVALID",
          message: "Settlement rule formula is no longer valid",
          status: 422,
          retryable: false,
        });
      }

      const catalog = await input.catalog.getCatalog({
        organizationId: scope.actor.organizationId,
        projectId: scope.projectId,
        scope: contract.scope,
        executionGrain: contract.executionGrain,
      });
      const parameters = parameterValues(contract);
      if (
        catalog.version !== draft.variableCatalogVersion ||
        hashCustomRuleContract(contract) !== draft.contractHash ||
        hashCustomRuleParameters(parameters) !== draft.parameterHash
      ) {
        throw new CustomRuleRouteError({
          code: "CUSTOM_RULE_STALE_REVISION",
          message: "Settlement rule draft is stale",
          status: 409,
          retryable: false,
        });
      }
      const readiness = analyzeCustomRuleDataReadiness({
        catalog,
        inputs: readinessRequirements(contract, validation.variables),
      });
      if (
        !readiness.readyForSimulation ||
        readiness.businessTimezone !== contract.businessTimezone
      ) {
        throw new CustomRuleRouteError({
          code: "CUSTOM_RULE_DATA_NOT_READY",
          message: "Project data is not ready for simulation",
          status: 422,
          retryable: false,
        });
      }
      const evidence = await input.evidence.loadAuthorizedEvidence({
        actor: scope.actor,
        organizationId: scope.actor.organizationId,
        projectId: scope.projectId,
        selection: scope.selection,
      });
      const simulationInput = {
        organizationId: scope.actor.organizationId,
        actorId: scope.actor.userId,
        projectId: scope.projectId,
        contract,
        compiledAst: validation.compiledAst,
        parameters,
        formulaHash: validation.formulaHash,
        contractHash: draft.contractHash,
        parameterHash: draft.parameterHash,
        catalogVersion: catalog.version,
        readiness,
        ...evidence,
        aiTestCases: draft.generatedTestCases,
      };
      const expectedSelectionHash =
        calculateCustomRuleDataSelectionHash(simulationInput);
      const summary = simulateCustomSettlementRule(simulationInput);
      if (summary.dataSelectionHash !== expectedSelectionHash) {
        throw new CustomRuleRouteError({
          code: "CUSTOM_RULE_SIMULATION_INVALID",
          message: "Settlement rule simulation freshness check failed",
          status: 422,
          retryable: false,
        });
      }
      const simulation = await input.repository.insertSimulation({
        organizationId: scope.actor.organizationId,
        projectId: scope.projectId,
        owner: { kind: "ai_draft", id: draft.id },
        idempotencyKey: `route-sim:${sha256(
          JSON.stringify({
            clientRequestId: scope.clientRequestId,
            conversationId: scope.conversationId,
            draftId: scope.draftId,
            selectionHash: summary.dataSelectionHash,
          }),
        )}`,
        ...summary.persistable,
      });
      return { draft, simulation, summary };
    },
  };
}

const AUTHORIZED_SELECTION_CRITERIA = new Set([
  "approved_reports",
  "period_overlap",
  "complete_evidence",
  "project_scope",
]);
const REQUIRED_SELECTION_CRITERIA = [
  "approved_reports",
  "period_overlap",
  "project_scope",
] as const;
const MAX_AUTHORIZED_REPORTS = 500;
const numericColumnSchema = z.union([z.string(), z.number()]);
const liveTaskRelationSchema = z.union([
  z.strictObject({ system_started_at: z.string().nullable() }),
  z.array(z.strictObject({ system_started_at: z.string().nullable() })),
]);
const approvedReportRowSchema = z.strictObject({
  id: z.string().uuid(),
  organization_id: z.string().uuid(),
  project_id: z.string().uuid(),
  streamer_id: z.string().uuid(),
  system_duration: z.number().int().nonnegative().nullable(),
  screenshot_duration: z.number().int().nonnegative().nullable(),
  settlement_duration: z.number().int().nonnegative().nullable(),
  evidence_level: z.enum(["green", "yellow", "red"]).nullable(),
  time_source: z.enum(["system", "screenshot", "claimed"]).nullable(),
  viewers: z.number().int().nonnegative().nullable(),
  reviewed_at: z.string().nullable(),
  created_at: z.string(),
  settled_batch_item_id: z.string().uuid().nullable(),
  live_tasks: liveTaskRelationSchema,
});
const batchRelationSchema = z.union([
  z.strictObject({
    id: z.string().uuid(),
    status: z.literal("locked"),
    batch_type: z.enum(["payable", "receivable"]),
    locked_at: z.string().nullable(),
  }),
  z.array(
    z.strictObject({
      id: z.string().uuid(),
      status: z.literal("locked"),
      batch_type: z.enum(["payable", "receivable"]),
      locked_at: z.string().nullable(),
    }),
  ),
]);
const settlementItemRowSchema = z.strictObject({
  id: z.string().uuid(),
  organization_id: z.string().uuid(),
  project_id: z.string().uuid(),
  live_report_id: z.string().uuid(),
  computed_amount: numericColumnSchema,
  manual_amount: numericColumnSchema,
  adjustment_amount: numericColumnSchema,
  settlement_batches: batchRelationSchema,
});
const streamerRelationSchema = z.union([
  z.strictObject({ source_type: z.string() }),
  z.array(z.strictObject({ source_type: z.string() })),
]);
const projectStreamerRowSchema = z.strictObject({
  id: z.string().uuid(),
  organization_id: z.string().uuid(),
  project_id: z.string().uuid(),
  streamer_id: z.string().uuid(),
  hourly_rate: numericColumnSchema.nullable(),
  base_salary: numericColumnSchema.nullable(),
  cps_rate_bps: z.number().int().min(0).max(10_000).nullable(),
  collaboration_id: z.string().uuid().nullable(),
  streamers: streamerRelationSchema,
});

type ApprovedReportRow = z.infer<typeof approvedReportRowSchema>;
type SettlementItemRow = z.infer<typeof settlementItemRowSchema>;
type ProjectStreamerRow = z.infer<typeof projectStreamerRowSchema>;

export function createSupabaseCustomRuleEvidenceAdapter(input: {
  client: SupabaseClient;
  repository: Pick<SupabaseCustomRuleReadRepository, "listDrafts">;
}): CustomRuleEvidenceAdapter {
  const authorizedEvidence = new Map<
    string,
    AuthorizedCustomRuleSimulationEvidence
  >();

  return {
    async authorizeSelection(unsafeInput) {
      assertSupportedSelection(unsafeInput.selection);
      const drafts = await input.repository.listDrafts({
        organizationId: unsafeInput.actor.organizationId,
        projectId: unsafeInput.projectId,
        conversationId: unsafeInput.conversationId,
        revisionOrder: "desc",
        limit: 1,
      });
      const draft = drafts[0];
      if (!draft) {
        throw routeError(
          "CUSTOM_RULE_SESSION_NOT_FOUND",
          "Settlement rule session not found",
          404,
        );
      }
      if (
        draft.id !== unsafeInput.draftId ||
        draft.revisionNumber !== unsafeInput.expectedRevisionNumber
      ) {
        throw routeError(
          "CUSTOM_RULE_STALE_REVISION",
          "Settlement rule draft is stale",
          409,
        );
      }
      if (
        draft.businessContract.executionGrain !== "report" ||
        (draft.businessContract.scope !== "payable" &&
          draft.businessContract.scope !== "receivable")
      ) {
        throw routeError(
          "CUSTOM_RULE_SELECTION_UNSUPPORTED",
          "Historical simulation is unsupported for this execution grain",
          422,
        );
      }

      const reports = await loadApprovedReports(input.client, {
        organizationId: unsafeInput.actor.organizationId,
        projectId: unsafeInput.projectId,
        periodStart: unsafeInput.selection.periodStart,
        periodEnd: unsafeInput.selection.periodEnd,
        completeEvidence:
          unsafeInput.selection.criteriaCodes.includes("complete_evidence"),
      });
      assertRowsInScope(
        reports,
        unsafeInput.actor.organizationId,
        unsafeInput.projectId,
      );
      const itemIds = reports.flatMap((report) =>
        report.settled_batch_item_id ? [report.settled_batch_item_id] : [],
      );
      const items = itemIds.length
        ? await loadLockedSettlementItems(input.client, {
            organizationId: unsafeInput.actor.organizationId,
            projectId: unsafeInput.projectId,
            itemIds,
            scope: draft.businessContract.scope,
          })
        : [];
      assertRowsInScope(
        items,
        unsafeInput.actor.organizationId,
        unsafeInput.projectId,
      );
      const itemsById = new Map(items.map((item) => [item.id, item]));
      const comparableReports = reports.filter(
        (report) =>
          report.settled_batch_item_id !== null &&
          itemsById.has(report.settled_batch_item_id),
      );
      const streamerIds = [
        ...new Set(comparableReports.map((report) => report.streamer_id)),
      ];
      const streamers = streamerIds.length
        ? await loadProjectStreamers(input.client, {
            organizationId: unsafeInput.actor.organizationId,
            projectId: unsafeInput.projectId,
            streamerIds,
          })
        : [];
      assertRowsInScope(
        streamers,
        unsafeInput.actor.organizationId,
        unsafeInput.projectId,
      );
      const streamersById = new Map(
        streamers.map((streamer) => [streamer.streamer_id, streamer]),
      );
      const requiredVariables = new Set(
        draft.businessContract.requiredInputs.map((required) => required.name),
      );
      const selectedSnapshots = reports.map((report) => ({
        id: report.id,
        version: reportSnapshotVersion(
          report,
          report.settled_batch_item_id
            ? (itemsById.get(report.settled_batch_item_id) ?? null)
            : null,
          streamersById.get(report.streamer_id) ?? null,
        ),
      }));
      const records = comparableReports.map((report) => {
        const item = itemsById.get(report.settled_batch_item_id!);
        if (!item) {
          throw routeError(
            "CUSTOM_RULE_EVIDENCE_UNAVAILABLE",
            "Locked settlement evidence is unavailable",
            422,
          );
        }
        const streamer = streamersById.get(report.streamer_id) ?? null;
        const variables = reportVariables(
          report,
          streamer,
          draft.businessContract.businessTimezone,
        );
        for (const variableId of requiredVariables) {
          if (!Object.prototype.hasOwnProperty.call(variables, variableId)) {
            throw new CustomRuleRouteError({
              code: "CUSTOM_RULE_EVIDENCE_FIELD_UNAVAILABLE",
              message: `Authorized historical evidence is missing required field: ${variableId}`,
              status: 422,
              retryable: false,
              path: ["businessContract", "requiredInputs", variableId],
            });
          }
        }
        const version = reportSnapshotVersion(report, item, streamer);
        return {
          recordId: report.id,
          projectId: unsafeInput.projectId,
          sourceVersion: {
            kind: "immutable" as const,
            source: "locked_settlement_report",
            version,
          },
          variables,
          missingInputs: [],
          currentRuleResult: {
            unitSource: "current_rule_cents" as const,
            amountCents: settlementItemTotalCents(item),
          },
        };
      });
      const selectionToken = `server:${sha256(
        JSON.stringify({
          organizationId: unsafeInput.actor.organizationId,
          projectId: unsafeInput.projectId,
          conversationId: unsafeInput.conversationId,
          draftId: draft.id,
          revisionNumber: draft.revisionNumber,
          periodStart: unsafeInput.selection.periodStart,
          periodEnd: unsafeInput.selection.periodEnd,
          criteriaCodes: [...unsafeInput.selection.criteriaCodes].sort(),
          selectedSnapshots,
        }),
      )}`;
      const authorizedSelection: AuthorizedSimulationSelectionRequest = {
        selectionToken,
        periodStart: unsafeInput.selection.periodStart,
        periodEnd: unsafeInput.selection.periodEnd,
        criteriaCodes: [...unsafeInput.selection.criteriaCodes],
      };
      const evidence: AuthorizedCustomRuleSimulationEvidence = {
        provenance: {
          organizationId: unsafeInput.actor.organizationId,
          projectId: unsafeInput.projectId,
          actorId: unsafeInput.actor.userId,
          selectionToken,
          evidenceHash: "0".repeat(64),
          immutableSourceVersions: records.map(
            (record) => record.sourceVersion,
          ),
        },
        sampleSource: {
          kind: records.length
            ? "historical_settlements"
            : "approved_operations",
        },
        sampleSelection: {
          periodStart: unsafeInput.selection.periodStart,
          periodEnd: unsafeInput.selection.periodEnd,
          populationCount: reports.length,
          criteria: [...unsafeInput.selection.criteriaCodes],
        },
        records,
        userExamples: [],
        currentMarginCents: null,
      };
      evidence.provenance.evidenceHash =
        calculateCustomRuleEvidenceHash(evidence);
      authorizedEvidence.set(
        selectionToken,
        freezeAuthorizedCustomRuleSimulationEvidence(evidence),
      );
      return authorizedSelection;
    },

    async loadAuthorizedEvidence(loadInput) {
      if (
        loadInput.actor.organizationId !== loadInput.organizationId ||
        loadInput.actor.organizationId.length === 0
      ) {
        throw routeError(
          "CUSTOM_RULE_PROJECT_NOT_FOUND",
          "Project not found",
          404,
        );
      }
      const evidence = authorizedEvidence.get(
        loadInput.selection.selectionToken,
      );
      if (
        !evidence ||
        evidence.provenance.organizationId !== loadInput.organizationId ||
        evidence.provenance.projectId !== loadInput.projectId ||
        evidence.provenance.actorId !== loadInput.actor.userId ||
        evidence.sampleSelection.periodStart !==
          loadInput.selection.periodStart ||
        evidence.sampleSelection.periodEnd !== loadInput.selection.periodEnd ||
        JSON.stringify([...evidence.sampleSelection.criteria].sort()) !==
          JSON.stringify([...loadInput.selection.criteriaCodes].sort())
      ) {
        throw routeError(
          "CUSTOM_RULE_SELECTION_UNSUPPORTED",
          "Authorized simulation selection is unavailable",
          422,
        );
      }
      return evidence;
    },
  };
}

function assertSupportedSelection(
  selection: AuthorizeCustomRuleSelectionInput["selection"],
): void {
  const criteria = [...selection.criteriaCodes];
  const unique = new Set(criteria);
  const supported =
    /^\d{4}-\d{2}-\d{2}$/u.test(selection.periodStart) &&
    /^\d{4}-\d{2}-\d{2}$/u.test(selection.periodEnd) &&
    selection.periodStart <= selection.periodEnd &&
    unique.size === criteria.length &&
    criteria.every((criterion) =>
      AUTHORIZED_SELECTION_CRITERIA.has(criterion),
    ) &&
    REQUIRED_SELECTION_CRITERIA.every((criterion) => unique.has(criterion));
  if (!supported) {
    throw routeError(
      "CUSTOM_RULE_SELECTION_UNSUPPORTED",
      "Historical simulation selection is unsupported",
      422,
    );
  }
}

async function loadApprovedReports(
  client: SupabaseClient,
  input: {
    organizationId: string;
    projectId: string;
    periodStart: string;
    periodEnd: string;
    completeEvidence: boolean;
  },
): Promise<ApprovedReportRow[]> {
  let query = client
    .from("live_reports")
    .select(
      "id, organization_id, project_id, streamer_id, system_duration, screenshot_duration, settlement_duration, evidence_level, time_source, viewers, reviewed_at, created_at, settled_batch_item_id, live_tasks!inner(system_started_at)",
    )
    .eq("organization_id", input.organizationId)
    .eq("project_id", input.projectId)
    .eq("status", "approved")
    .gte("reviewed_at", `${input.periodStart}T00:00:00.000Z`)
    .lte("reviewed_at", `${input.periodEnd}T23:59:59.999Z`);
  if (input.completeEvidence) {
    query = query
      .not("settlement_duration", "is", null)
      .not("evidence_level", "is", null)
      .not("time_source", "is", null);
  }
  const { data, error } = await query
    .order("id", { ascending: true })
    .limit(MAX_AUTHORIZED_REPORTS)
    .returns<unknown[]>();
  return parseEvidenceRows(
    approvedReportRowSchema,
    data,
    error,
    "approved live reports",
  ).sort((left, right) => left.id.localeCompare(right.id));
}

async function loadLockedSettlementItems(
  client: SupabaseClient,
  input: {
    organizationId: string;
    projectId: string;
    itemIds: string[];
    scope: "payable" | "receivable";
  },
): Promise<SettlementItemRow[]> {
  const { data, error } = await client
    .from("settlement_batch_items")
    .select(
      "id, organization_id, project_id, live_report_id, computed_amount, manual_amount, adjustment_amount, settlement_batches!inner(id, status, batch_type, locked_at)",
    )
    .eq("organization_id", input.organizationId)
    .eq("project_id", input.projectId)
    .in("id", input.itemIds)
    .eq("settlement_batches.status", "locked")
    .eq("settlement_batches.batch_type", input.scope)
    .order("id", { ascending: true })
    .limit(MAX_AUTHORIZED_REPORTS)
    .returns<unknown[]>();
  const rows = parseEvidenceRows(
    settlementItemRowSchema,
    data,
    error,
    "locked settlement items",
  );
  for (const row of rows) {
    const batch = oneRelation(row.settlement_batches);
    if (
      !batch ||
      batch.status !== "locked" ||
      batch.batch_type !== input.scope ||
      !batch.locked_at
    ) {
      throw new CustomRuleRouteError({
        code: "CUSTOM_RULE_EVIDENCE_FIELD_UNAVAILABLE",
        message:
          "Authorized historical evidence is missing required field: settlement_batches.locked_at",
        status: 422,
        retryable: false,
        path: ["settlement_batches", "locked_at"],
      });
    }
  }
  return rows;
}

async function loadProjectStreamers(
  client: SupabaseClient,
  input: {
    organizationId: string;
    projectId: string;
    streamerIds: string[];
  },
): Promise<ProjectStreamerRow[]> {
  const { data, error } = await client
    .from("project_streamers")
    .select(
      "id, organization_id, project_id, streamer_id, hourly_rate, base_salary, cps_rate_bps, collaboration_id, streamers!inner(source_type)",
    )
    .eq("organization_id", input.organizationId)
    .eq("project_id", input.projectId)
    .in("streamer_id", input.streamerIds)
    .order("streamer_id", { ascending: true })
    .limit(MAX_AUTHORIZED_REPORTS)
    .returns<unknown[]>();
  return parseEvidenceRows(
    projectStreamerRowSchema,
    data,
    error,
    "project streamer snapshots",
  );
}

function parseEvidenceRows<Schema extends z.ZodType>(
  schema: Schema,
  data: unknown,
  error: unknown,
  source: string,
): Array<z.output<Schema>> {
  if (error) {
    throw routeError(
      "CUSTOM_RULE_STORAGE_UNAVAILABLE",
      "Settlement rule evidence storage is unavailable",
      503,
      true,
    );
  }
  const parsed = z.array(schema).safeParse(data);
  if (!parsed.success) {
    throw routeError(
      "CUSTOM_RULE_EVIDENCE_INVALID",
      `Settlement rule evidence source is invalid: ${source}`,
      500,
      true,
    );
  }
  return parsed.data;
}

function assertRowsInScope(
  rows: Array<{ organization_id: string; project_id: string }>,
  organizationId: string,
  projectId: string,
): void {
  if (
    rows.some(
      (row) =>
        row.organization_id !== organizationId || row.project_id !== projectId,
    )
  ) {
    throw routeError("CUSTOM_RULE_PROJECT_NOT_FOUND", "Project not found", 404);
  }
}

function reportVariables(
  report: ApprovedReportRow,
  streamer: ProjectStreamerRow | null,
  businessTimezone: string,
): Record<string, TypedRuntimeValue> {
  const variables: Record<string, TypedRuntimeValue> = {
    project_id: { type: "string", value: report.project_id },
    streamer_id: { type: "string", value: report.streamer_id },
  };
  addIntegerVariable(variables, "system_minutes", report.system_duration);
  addIntegerVariable(
    variables,
    "screenshot_minutes",
    report.screenshot_duration,
  );
  addIntegerVariable(
    variables,
    "settlement_minutes",
    report.settlement_duration,
  );
  addIntegerVariable(variables, "views", report.viewers);
  addStringVariable(variables, "evidence_level", report.evidence_level);
  addStringVariable(variables, "time_source", report.time_source);
  if (report.reviewed_at) {
    variables.approved_at = { type: "timestamp", value: report.reviewed_at };
  }
  const liveTask = oneRelation(report.live_tasks);
  if (liveTask?.system_started_at) {
    variables.live_started_at = {
      type: "timestamp",
      value: liveTask.system_started_at,
    };
    const local = localWeekdayAndHour(
      liveTask.system_started_at,
      businessTimezone,
    );
    variables.weekday = { type: "integer", value: local.weekday };
    variables.hour_of_day = { type: "integer", value: local.hour };
  }
  if (streamer) {
    if (streamer.hourly_rate !== null) {
      variables.base_hourly_rate = {
        type: "money_cents",
        amountCents: decimalCentsAsSafeNumber(streamer.hourly_rate),
      };
    }
    if (streamer.base_salary !== null) {
      variables.base_salary = {
        type: "money_cents",
        amountCents: decimalCentsAsSafeNumber(streamer.base_salary),
      };
    }
    if (streamer.cps_rate_bps !== null) {
      variables.cps_rate = {
        type: "rate_bps",
        rateBps: streamer.cps_rate_bps,
      };
    }
    if (streamer.collaboration_id) {
      variables.collaboration_id = {
        type: "string",
        value: streamer.collaboration_id,
      };
    }
    const relation = oneRelation(streamer.streamers);
    if (relation) {
      variables.streamer_source = {
        type: "string",
        value: relation.source_type,
      };
    }
  }
  return variables;
}

function addIntegerVariable(
  variables: Record<string, TypedRuntimeValue>,
  name: string,
  value: number | null,
): void {
  if (value !== null) variables[name] = { type: "integer", value };
}

function addStringVariable(
  variables: Record<string, TypedRuntimeValue>,
  name: string,
  value: string | null,
): void {
  if (value !== null) variables[name] = { type: "string", value };
}

function localWeekdayAndHour(
  timestamp: string,
  businessTimezone: string,
): { weekday: number; hour: number } {
  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: businessTimezone,
      weekday: "short",
      hour: "2-digit",
      hourCycle: "h23",
    });
    const parts = Object.fromEntries(
      formatter
        .formatToParts(new Date(timestamp))
        .map((part) => [part.type, part.value]),
    );
    const weekdays: Record<string, number> = {
      Sun: 0,
      Mon: 1,
      Tue: 2,
      Wed: 3,
      Thu: 4,
      Fri: 5,
      Sat: 6,
    };
    const weekday = weekdays[parts.weekday ?? ""];
    const hour = Number(parts.hour);
    if (weekday === undefined || !Number.isInteger(hour)) throw new Error();
    return { weekday, hour };
  } catch {
    throw new CustomRuleRouteError({
      code: "CUSTOM_RULE_EVIDENCE_FIELD_UNAVAILABLE",
      message:
        "Authorized historical evidence is missing required field: businessTimezone",
      status: 422,
      retryable: false,
      path: ["businessContract", "businessTimezone"],
    });
  }
}

function reportSnapshotVersion(
  report: ApprovedReportRow,
  item: SettlementItemRow | null,
  streamer: ProjectStreamerRow | null,
): string {
  return sha256(
    JSON.stringify({
      report,
      item,
      streamer,
    }),
  );
}

function settlementItemTotalCents(item: SettlementItemRow): string {
  const total =
    decimalYuanToCents(item.computed_amount) +
    decimalYuanToCents(item.manual_amount) +
    decimalYuanToCents(item.adjustment_amount);
  return String(total);
}

function decimalCentsAsSafeNumber(value: string | number): number {
  const cents = decimalYuanToCents(value);
  const numeric = Number(cents);
  if (!Number.isSafeInteger(numeric)) {
    throw routeError(
      "CUSTOM_RULE_EVIDENCE_INVALID",
      "Settlement rule evidence amount is out of range",
      500,
      true,
    );
  }
  return numeric;
}

function decimalYuanToCents(value: string | number): bigint {
  const text = String(value);
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/u.exec(text);
  if (!match) {
    throw routeError(
      "CUSTOM_RULE_EVIDENCE_INVALID",
      "Settlement rule evidence amount is invalid",
      500,
      true,
    );
  }
  const sign = match[1] === "-" ? BigInt(-1) : BigInt(1);
  const whole = BigInt(match[2] ?? "0") * BigInt(100);
  const fraction = BigInt((match[3] ?? "").padEnd(2, "0") || "0");
  return sign * (whole + fraction);
}

function oneRelation<Value>(value: Value | Value[]): Value | null {
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function routeError(
  code: string,
  message: string,
  status: number,
  retryable = false,
): CustomRuleRouteError {
  return new CustomRuleRouteError({ code, message, status, retryable });
}

async function requireProjectAccess(
  supabase: SupabaseClient,
  organizationId: string,
  projectId: string,
): Promise<void> {
  const { data, error } = await supabase
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (error) {
    throw new CustomRuleRouteError({
      code: "CUSTOM_RULE_STORAGE_UNAVAILABLE",
      message: "Settlement rule authoring storage is unavailable",
      status: 503,
      retryable: true,
    });
  }
  if (!data) {
    throw new CustomRuleRouteError({
      code: "CUSTOM_RULE_PROJECT_NOT_FOUND",
      message: "Project not found",
      status: 404,
      retryable: false,
    });
  }
}

function parseWithSchema<Schema extends z.ZodType>(
  value: unknown,
  schema: Schema,
): z.output<Schema> {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;
  const issue = parsed.error.issues[0];
  throw new CustomRuleRouteError({
    code: "INVALID_REQUEST",
    message: "Request validation failed",
    status: 400,
    retryable: false,
    ...(issue?.path.length
      ? {
          path: issue.path.filter(
            (item): item is string | number =>
              typeof item === "string" || typeof item === "number",
          ),
        }
      : {}),
  });
}

function authoringErrorResponse(
  error: CustomRuleAuthoringServiceError,
): Response {
  if (
    error.code === "conversation_failed" &&
    error.cause instanceof ConversationServiceError &&
    error.cause.code === "conversation_not_found"
  ) {
    return safeErrorResponse(
      {
        code: "CUSTOM_RULE_SESSION_NOT_FOUND",
        message: "Settlement rule session not found",
        retryable: false,
      },
      404,
    );
  }
  const mapped: Record<
    CustomRuleAuthoringServiceError["code"],
    { code: string; message: string; status: number }
  > = {
    invalid_input: {
      code: "INVALID_REQUEST",
      message: "Request validation failed",
      status: 400,
    },
    conversation_failed: {
      code: "CUSTOM_RULE_AI_UNAVAILABLE",
      message: "Settlement rule AI is unavailable",
      status: 503,
    },
    conversation_reconciliation_failed: {
      code: "CUSTOM_RULE_SESSION_CONFLICT",
      message: "Settlement rule session state changed",
      status: 409,
    },
    catalog_failed: {
      code: "CUSTOM_RULE_CATALOG_UNAVAILABLE",
      message: "Settlement rule variable catalog is unavailable",
      status: 503,
    },
    persistence_failed: {
      code: "CUSTOM_RULE_STORAGE_UNAVAILABLE",
      message: "Settlement rule authoring storage is unavailable",
      status: 503,
    },
    draft_not_found: {
      code: "CUSTOM_RULE_SESSION_NOT_FOUND",
      message: "Settlement rule session not found",
      status: 404,
    },
    invalid_transition: {
      code: "CUSTOM_RULE_INVALID_TRANSITION",
      message: "Settlement rule session cannot make this transition",
      status: 409,
    },
    stale_revision: {
      code: "CUSTOM_RULE_STALE_REVISION",
      message: "Settlement rule draft is stale",
      status: 409,
    },
    unresolved_ambiguities: {
      code: "CUSTOM_RULE_UNRESOLVED_AMBIGUITIES",
      message: "Settlement rule ambiguities must be resolved first",
      status: 409,
    },
    duplicate_confirmation: {
      code: "CUSTOM_RULE_DUPLICATE_CONFIRMATION",
      message: "Settlement rule contract was already confirmed",
      status: 409,
    },
    contract_hash_mismatch: {
      code: "CUSTOM_RULE_STALE_CONTRACT",
      message: "Settlement rule contract changed",
      status: 409,
    },
    catalog_hash_mismatch: {
      code: "CUSTOM_RULE_STALE_CATALOG",
      message: "Settlement rule variable catalog changed",
      status: 409,
    },
    formula_hash_mismatch: {
      code: "CUSTOM_RULE_STALE_FORMULA",
      message: "Settlement rule formula changed",
      status: 409,
    },
    evidence_hash_mismatch: {
      code: "CUSTOM_RULE_STALE_EVIDENCE",
      message: "Settlement rule evidence changed",
      status: 409,
    },
    selection_hash_mismatch: {
      code: "CUSTOM_RULE_STALE_SELECTION",
      message: "Settlement rule simulation selection changed",
      status: 409,
    },
    formula_validation_failed: {
      code: "CUSTOM_RULE_FORMULA_INVALID",
      message: "Settlement rule formula did not pass validation",
      status: 422,
    },
    readiness_failed: {
      code: "CUSTOM_RULE_DATA_NOT_READY",
      message: "Project data is not ready for simulation",
      status: 422,
    },
    simulation_failed: {
      code: "CUSTOM_RULE_SIMULATION_INVALID",
      message: "Settlement rule simulation failed",
      status: 422,
    },
  };
  const safe = mapped[error.code];
  return safeErrorResponse(
    {
      code: safe.code,
      message: safe.message,
      retryable: error.retryable,
    },
    safe.status,
  );
}

function safeErrorResponse(error: SafeCustomRuleError, status: number) {
  return NextResponse.json({ error }, { status });
}

function readinessRequirements(
  contract: z.infer<typeof businessRuleContractSchema>,
  formulaVariables: string[],
): CustomRuleInputRequirement[] {
  return [
    ...new Set([
      ...contract.requiredInputs.map((required) => required.name),
      ...formulaVariables,
    ]),
  ]
    .sort((left, right) => left.localeCompare(right))
    .map((variableId) => ({ variableId, required: true as const }));
}

function parameterValues(
  contract: z.infer<typeof businessRuleContractSchema>,
): Record<string, TypedRuntimeValue> {
  return Object.fromEntries(
    contract.parameters.map((parameter) => [
      parameter.name,
      parameter.defaultValue,
    ]),
  );
}

function centsToYuan(cents: string | null): string | null {
  if (cents === null) return null;
  if (!/^-?\d+$/u.test(cents)) {
    throw new CustomRuleRouteError({
      code: "CUSTOM_RULE_RESPONSE_INVALID",
      message: "Settlement rule response is invalid",
      status: 500,
      retryable: true,
    });
  }
  const value = BigInt(cents);
  const sign = value < 0 ? "-" : "";
  const absolute = value < 0 ? -value : value;
  const whole = absolute / BigInt(100);
  const fraction = String(absolute % BigInt(100)).padStart(2, "0");
  return `${sign}${whole}.${fraction}`;
}

function bpsToPercent(bps: number): string {
  return (bps / 100).toFixed(2);
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
