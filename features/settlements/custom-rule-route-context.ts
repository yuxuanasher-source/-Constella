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
  evidence: AuthorizedSimulationEvidencePort;
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
  const evidence = createScopedSyntheticEvidencePort();
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

function createScopedSyntheticEvidencePort(): AuthorizedSimulationEvidencePort {
  return {
    async loadAuthorizedEvidence(input) {
      if (input.actor.organizationId !== input.organizationId) {
        throw new CustomRuleRouteError({
          code: "CUSTOM_RULE_PROJECT_NOT_FOUND",
          message: "Project not found",
          status: 404,
          retryable: false,
        });
      }
      const evidence: AuthorizedCustomRuleSimulationEvidence = {
        provenance: {
          organizationId: input.organizationId,
          projectId: input.projectId,
          actorId: input.actor.userId,
          selectionToken: input.selection.selectionToken,
          evidenceHash: "0".repeat(64),
          immutableSourceVersions: [],
        },
        sampleSource: { kind: "synthetic_scenarios" },
        sampleSelection: {
          periodStart: input.selection.periodStart,
          periodEnd: input.selection.periodEnd,
          populationCount: 0,
          criteria: [...input.selection.criteriaCodes],
        },
        records: [],
        userExamples: [],
        currentMarginCents: null,
      };
      evidence.provenance.evidenceHash =
        calculateCustomRuleEvidenceHash(evidence);
      return freezeAuthorizedCustomRuleSimulationEvidence(evidence);
    },
  };
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
