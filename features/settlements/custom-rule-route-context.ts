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
import {
  businessRuleContractSchema,
  customRuleScopeSchema,
  typedRuntimeValueSchema,
} from "./custom-rule-contract";
import {
  analyzeCustomRuleDataReadiness,
  buildCustomRuleInputRequirements,
  calculateCustomRuleOptionalPolicyHash,
  type CustomRuleDataReadinessReport,
  type CustomRuleInputRequirement,
} from "./custom-rule-data-readiness";
import { buildCustomRuleTemplateExplanation } from "./custom-rule-explanation";
import { isCustomSettlementRulesEnabled } from "./custom-rule-feature-flag";
import {
  determineSettlementPopulationCoverage,
  type SettlementGroupScopedRule,
} from "./custom-rule-groups";
import { parseCustomRuleFormula } from "./custom-rule-parser";
import {
  SupabaseCustomRuleReadRepository,
  CustomRulePersistenceDataError,
  CustomRulePersistenceInputError,
  CustomRulePersistenceQueryError,
  type InsertedSettlementFormulaSimulation,
  type CustomRuleDraft,
  type CustomRuleLifecycleResult,
  type CustomSettlementRuleVersion,
  type SettlementGroupAssignmentChangeResult,
  type SettlementRuleGroup,
  type SettlementFormulaSimulation,
} from "./custom-rule-repository";
import {
  CustomRuleAuthoringServiceError,
  createCustomRuleAuthoringService,
  createCustomRuleLifecycleService,
  createSettlementGroupMembershipGovernanceService,
  type CustomRuleLifecycleGovernanceContext,
  type CustomRuleLifecycleRepositoryPort,
  type CustomRuleLifecycleService,
  type SettlementGroupMembershipRepositoryPort,
  type SettlementGroupMembershipGovernanceService,
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
import type {
  CustomRuleMissingDataPolicy,
  CustomRuleScope,
  CustomRuleTarget,
  TypedRuntimeValue,
} from "./custom-rule-types";
import {
  getPrimaryActionForRuleState,
  CustomRuleGovernanceError,
} from "./custom-rule-governance";
import {
  CustomRuleTemplateError,
  listReusableSettlementRuleTemplates,
  type OrganizationRuleTemplate,
  type ReusableSettlementRuleTemplateDto,
} from "./custom-rule-templates";
import { listCustomRuleSystemTemplates } from "./custom-rule-system-templates";
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
const canonicalOffsetDateTimeSchema = z.iso.datetime({ offset: true });
const claimedAiSessionRowSchema = z.strictObject({
  id: z.string().uuid(),
  title: z.string().min(1).max(120),
  status: z.enum(["active", "archived"]),
  last_message_at: canonicalOffsetDateTimeSchema,
  created_at: canonicalOffsetDateTimeSchema,
  updated_at: canonicalOffsetDateTimeSchema,
  duplicate: z.boolean(),
});

const userExampleInputsSchema = z
  .record(
    z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/u),
    typedRuntimeValueSchema,
  )
  .superRefine((inputs, context) => {
    if (Object.keys(inputs).length > 100) {
      context.addIssue({
        code: "too_big",
        maximum: 100,
        origin: "object",
        message: "user example inputs exceed the supported limit",
      });
    }
  });

const GENERATED_COST_ITEM_TYPES = new Set([
  "cpa",
  "cps",
  "gift",
  "supplier_fee",
  "traffic",
  "platform_fee",
]);
const CHECK_SEVERITIES = new Set(["pass", "warn", "block"]);
const MAX_TYPED_EXPECTED_ITEMS = 20;
const MAX_TYPED_EXPECTED_TEXT_LENGTH = 120;
const MAX_GENERATED_COST_ITEM_AMOUNT_CENTS = 1_000_000_000;

function isExternalCostExpectedResult(value: TypedRuntimeValue): boolean {
  return (
    value.type === "array" &&
    value.items.length <= MAX_TYPED_EXPECTED_ITEMS &&
    value.items.every((item) => {
      if (item.type !== "object") return false;
      const keys = Object.keys(item.fields).sort();
      if (keys.join("\u0000") !== "amountCents\u0000category\u0000memo") {
        return false;
      }
      const category = item.fields.category;
      const amount = item.fields.amountCents;
      const memo = item.fields.memo;
      return (
        category?.type === "string" &&
        GENERATED_COST_ITEM_TYPES.has(category.value) &&
        amount?.type === "money_cents" &&
        Number.isSafeInteger(amount.amountCents) &&
        amount.amountCents >= 0 &&
        amount.amountCents <= MAX_GENERATED_COST_ITEM_AMOUNT_CENTS &&
        memo?.type === "string" &&
        memo.value.length > 0 &&
        memo.value.length <= MAX_TYPED_EXPECTED_TEXT_LENGTH &&
        !/[\u0000-\u001f\u007f]/u.test(memo.value)
      );
    })
  );
}

function isReconciliationExpectedResult(value: TypedRuntimeValue): boolean {
  return (
    value.type === "array" &&
    value.items.length <= MAX_TYPED_EXPECTED_ITEMS &&
    value.items.every((item) => {
      if (item.type !== "object") return false;
      const keys = Object.keys(item.fields).sort();
      if (keys.join("\u0000") !== "condition\u0000message\u0000severity") {
        return false;
      }
      const severity = item.fields.severity;
      const message = item.fields.message;
      const condition = item.fields.condition;
      return (
        severity?.type === "string" &&
        CHECK_SEVERITIES.has(severity.value) &&
        message?.type === "string" &&
        message.value.length > 0 &&
        message.value.length <= MAX_TYPED_EXPECTED_TEXT_LENGTH &&
        !/[\u0000-\u001f\u007f]/u.test(message.value) &&
        condition?.type === "boolean"
      );
    })
  );
}

function isSupportedUserExampleExpectedResult(
  value: TypedRuntimeValue,
): boolean {
  return (
    value.type === "money_cents" ||
    isExternalCostExpectedResult(value) ||
    isReconciliationExpectedResult(value)
  );
}

function assertUserExamplesMatchScope(
  examples: Array<z.infer<typeof customRuleUserExampleSchema>>,
  scope: CustomRuleScope,
): void {
  for (const [index, example] of examples.entries()) {
    const expectedResult = example.expectedResult;
    const compatible =
      scope === "external_cost"
        ? isExternalCostExpectedResult(expectedResult)
        : scope === "reconciliation"
          ? isReconciliationExpectedResult(expectedResult)
          : expectedResult.type === "money_cents";
    if (!compatible) {
      throw new CustomRuleRouteError({
        code: "CUSTOM_RULE_USER_EXAMPLE_INVALID",
        message: "User example expected result does not match rule scope",
        status: 400,
        retryable: false,
        path: ["selection", "userExamples", index, "expectedResult"],
      });
    }
  }
}

export const customRuleUserExampleSchema = z.strictObject({
  id: z.string().trim().min(1).max(120),
  inputs: userExampleInputsSchema,
  expectedResult: typedRuntimeValueSchema.refine(
    isSupportedUserExampleExpectedResult,
    { message: "user example expected result is not supported for simulation" },
  ),
});

export const customRuleUserExamplesSchema = z
  .array(customRuleUserExampleSchema)
  .max(50)
  .superRefine((examples, context) => {
    const ids = new Set<string>();
    for (const [index, example] of examples.entries()) {
      if (ids.has(example.id)) {
        context.addIssue({
          code: "custom",
          path: [index, "id"],
          message: "user example ids must be unique",
        });
      }
      ids.add(example.id);
    }
    if (JSON.stringify(examples).length > 64_000) {
      context.addIssue({
        code: "too_big",
        maximum: 64_000,
        origin: "array",
        message: "user examples exceed the supported payload size",
      });
    }
  });

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
type TemplateListingService = {
  listReusableSettlementRuleTemplates(input: {
    actor: { organizationId: string; userId: string };
  }): Promise<ReusableSettlementRuleTemplateDto[]>;
};

export function createCustomRuleStartRequestIdentity(input: {
  clientRequestId: string;
  title?: string;
  promptText: string;
  seedContract: CustomRuleDraft["businessContract"];
  initialAmbiguities: Array<{
    code: string;
    question: string;
    required: boolean;
  }>;
}): { requestFingerprint: string; task7ClientRequestId: string } {
  const requestFingerprint = sha256(
    JSON.stringify({
      version: 1,
      clientRequestId: input.clientRequestId,
      title: input.title ?? null,
      promptText: input.promptText,
      contractHash: hashCustomRuleContract(input.seedContract),
      initialAmbiguities: input.initialAmbiguities.map((ambiguity) => ({
        code: ambiguity.code,
        question: ambiguity.question,
        required: ambiguity.required,
      })),
    }),
  );
  return {
    requestFingerprint,
    task7ClientRequestId: `settlement-start:${requestFingerprint}`,
  };
}

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
  selection: Omit<AuthorizedSimulationSelectionRequest, "selectionToken"> & {
    userExamples?: AuthorizedCustomRuleSimulationEvidence["userExamples"];
  };
};

export type CustomRuleEvidenceAdapter = AuthorizedSimulationEvidencePort & {
  authorizeSelection(
    input: AuthorizeCustomRuleSelectionInput,
  ): Promise<AuthorizedSimulationSelectionRequest>;
  adjustReadiness(
    readiness: CustomRuleDataReadinessReport,
  ): CustomRuleDataReadinessReport;
  decorateSimulationResult(
    result: CustomRuleSimulationResult,
  ): CustomRuleSimulationResult;
};

export type CustomRuleRouteContext = {
  supabase: SupabaseClient;
  auth: AuthContext;
  actor: { organizationId: string; userId: string };
  claimAiSession(input: {
    projectId: string;
    clientRequestId: string;
    requestFingerprint: string;
    title?: string;
  }): Promise<{
    session: Awaited<ReturnType<ConversationService["createConversation"]>>;
    duplicate: boolean;
  }>;
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
  lifecycle: CustomRuleLifecycleService;
  groups: SettlementGroupMembershipGovernanceService;
  templates: TemplateListingService;
  simulation: {
    simulateExistingDraft(input: SimulateExistingDraftInput): Promise<{
      draft: CustomRuleDraft;
      simulation: InsertedSettlementFormulaSimulation;
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

  const actor = {
    organizationId: auth.organizationId,
    userId: auth.userId,
  };
  const repository = new SupabaseCustomRuleReadRepository(supabase);
  const governanceRepository = createRouteGovernanceRepository({
    repository,
    auth,
    supabase,
  });
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
  let conversation: ConversationService | undefined;
  let evidence: CustomRuleEvidenceAdapter | undefined;
  let authoring: AuthoringService | undefined;
  let lifecycle: CustomRuleLifecycleService | undefined;
  let groups: SettlementGroupMembershipGovernanceService | undefined;
  let templates: TemplateListingService | undefined;
  let simulation: CustomRuleRouteContext["simulation"] | undefined;

  const getConversation = (): ConversationService => {
    if (conversation) return conversation;
    const admin = createSupabaseAdminClient();
    if (!admin) {
      throw routeError(
        "CUSTOM_RULE_STORAGE_UNAVAILABLE",
        "Settlement rule authoring storage is unavailable",
        503,
        true,
      );
    }
    conversation = createConversationService(
      createSupabaseConversationPersistence(
        admin as unknown as ConversationRepositoryClient,
      ),
    );
    return conversation;
  };

  const getEvidence = (): CustomRuleEvidenceAdapter => {
    evidence ??= createSupabaseCustomRuleEvidenceAdapter({
      client: supabase,
      repository,
      catalog,
    });
    return evidence;
  };

  const getAuthoring = (): AuthoringService => {
    if (authoring) return authoring;
    const scopedConversation = getConversation();
    let providers: ReturnType<typeof createConfiguredAiProviders>;
    let routing: ReturnType<typeof resolveAiProviderRouting>;
    try {
      providers = createConfiguredAiProviders();
      routing = resolveAiProviderRouting();
    } catch {
      throw routeError(
        "CUSTOM_RULE_AI_UNAVAILABLE",
        "Settlement rule AI is unavailable",
        503,
        true,
      );
    }
    const primaryProvider =
      providers.find((provider) => provider.name === routing.primaryProvider)
        ?.name ?? providers[0]?.name;
    if (!primaryProvider) {
      throw routeError(
        "CUSTOM_RULE_AI_UNAVAILABLE",
        "Settlement rule AI is unavailable",
        503,
        true,
      );
    }
    const scopedEvidence = getEvidence();
    const ai = createSettlementRuleAiAdapter({
      gateway: (request) =>
        runAiGateway({ providers, primaryProvider, request }),
    });
    authoring = createCustomRuleAuthoringService({
      conversation: scopedConversation,
      ai,
      repository,
      catalog,
      evidence: scopedEvidence,
      analyzeReadiness: (readinessInput) =>
        scopedEvidence.adjustReadiness(
          analyzeCustomRuleDataReadiness(readinessInput),
        ),
      simulate: (simulationInput) =>
        scopedEvidence.decorateSimulationResult(
          simulateCustomSettlementRule(simulationInput),
        ),
      primaryProvider,
      persistFailedRevisions: true,
    });
    return authoring;
  };

  const getSimulation = (): CustomRuleRouteContext["simulation"] => {
    simulation ??= createCustomRuleExistingDraftSimulationService({
      repository,
      catalog,
      evidence: getEvidence(),
    });
    return simulation;
  };
  const getLifecycle = (): CustomRuleLifecycleService => {
    lifecycle ??= createCustomRuleLifecycleService({
      repository: governanceRepository,
      audit: (input) => writeAuditLog(supabase, input),
      executionCapability: {
        enabled: process.env.CUSTOM_SETTLEMENT_RULE_EXECUTION_ENABLED === "true",
      },
    });
    return lifecycle;
  };
  const getGroups = (): SettlementGroupMembershipGovernanceService => {
    groups ??= createSettlementGroupMembershipGovernanceService({
      repository: governanceRepository,
    });
    return groups;
  };
  const getTemplates = (): TemplateListingService => {
    templates ??= createCustomRuleTemplateListingService({
      supabase,
      actor,
    });
    return templates;
  };

  return {
    supabase,
    auth,
    actor,
    claimAiSession: (input) =>
      claimCustomSettlementAiSession(supabase, {
        organizationId: actor.organizationId,
        projectId: input.projectId,
        clientRequestId: input.clientRequestId,
        requestFingerprint: input.requestFingerprint,
        title: input.title ?? "结算规则会话",
      }),
    get conversation() {
      return getConversation();
    },
    repository,
    catalog,
    get evidence() {
      return getEvidence();
    },
    authorizeSimulationSelection: (input) =>
      getEvidence().authorizeSelection(input),
    get authoring() {
      return getAuthoring();
    },
    get lifecycle() {
      return getLifecycle();
    },
    get groups() {
      return getGroups();
    },
    get templates() {
      return getTemplates();
    },
    get simulation() {
      return getSimulation();
    },
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
  if (error instanceof CustomRuleGovernanceError) {
    return safeErrorResponse(
      {
        code: error.code,
        message: error.message,
        retryable: false,
      },
      statusForGovernanceError(error.code),
    );
  }
  if (error instanceof CustomRuleTemplateError) {
    return safeErrorResponse(
      {
        code: error.code,
        message: error.message,
        retryable: false,
      },
      error.code === "CUSTOM_RULE_TEMPLATE_ORG_MISMATCH" ? 403 : 422,
    );
  }
  if (error instanceof CustomRulePersistenceInputError) {
    return safeErrorResponse(
      {
        code: "INVALID_REQUEST",
        message: "Request validation failed",
        retryable: false,
      },
      400,
    );
  }
  if (error instanceof CustomRulePersistenceQueryError) {
    const conflict = persistenceConflict(error);
    const denial = persistenceDenial(error);
    const deterministicValidation = persistenceValidationFailure(error);
    return safeErrorResponse(
      {
        code: conflict
          ? "CUSTOM_RULE_CONFLICT"
          : denial
            ? "CUSTOM_RULE_ACTION_NOT_ALLOWED"
          : deterministicValidation
            ? "CUSTOM_RULE_VALIDATION_FAILED"
          : "CUSTOM_RULE_STORAGE_UNAVAILABLE",
        message: conflict
          ? "Settlement rule request conflicts with current data"
          : denial
            ? "Settlement rule request is not allowed"
          : deterministicValidation
            ? "Settlement rule request failed validation"
          : "Settlement rule storage is unavailable",
        retryable: !conflict && !denial && !deterministicValidation,
      },
      conflict ? 409 : denial ? 403 : deterministicValidation ? 422 : 503,
    );
  }
  if (error instanceof CustomRulePersistenceDataError) {
    return safeErrorResponse(
      {
        code: "CUSTOM_RULE_RESPONSE_INVALID",
        message: "Settlement rule response is invalid",
        retryable: true,
      },
      500,
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

export function toCustomRuleGovernanceRuleDto(
  rule: CustomSettlementRuleVersion & {
    effectiveNow?: boolean;
    scheduled?: boolean;
  },
) {
  return {
    id: rule.id,
    projectId: rule.projectId,
    scope: rule.scope,
    target: rule.target,
    executionGrain: rule.executionGrain,
    compositionMode: rule.compositionMode,
    priority: rule.priority,
    versionNumber: rule.versionNumber,
    status: rule.status,
    formulaHash: rule.formulaHash,
    contractHash: rule.contractHash,
    parameterHash: rule.parameterHash,
    catalogHash: rule.catalogHash,
    dataSelectionHash: rule.dataSelectionHash,
    simulationId: rule.simulationId,
    effectiveFrom: rule.effectiveFrom,
    effectiveUntil: rule.effectiveUntil,
    createdBy: rule.createdBy,
    approvedBy: rule.approvedBy,
    aiDraftId: rule.aiDraftId,
    reason: rule.reason,
    createdAt: rule.createdAt,
    approvedAt: rule.approvedAt,
    archivedAt: rule.archivedAt,
    ...(rule.effectiveNow === undefined
      ? {}
      : { effectiveNow: rule.effectiveNow }),
    ...(rule.scheduled === undefined ? {} : { scheduled: rule.scheduled }),
    primaryAction: getPrimaryActionForRuleState(rule.status),
  };
}

export function toCustomRuleLifecycleResultDto(
  result: CustomRuleLifecycleResult,
) {
  return {
    rule: toCustomRuleGovernanceRuleDto(result.version),
    simulation: {
      id: result.simulation.id,
      createdAt: result.simulation.createdAt,
    },
    event:
      result.event === null
        ? null
        : {
            id: result.event.id,
            eventType: result.event.eventType,
            actorId: result.event.actorId,
            actorRole: result.event.actorRole,
            reason: result.event.reason,
            comment: result.event.comment,
            beforeStatus: result.event.beforeStatus,
            afterStatus: result.event.afterStatus,
            createdAt: result.event.createdAt,
          },
  };
}

export function toSettlementRuleGroupDto(group: SettlementRuleGroup) {
  return {
    id: group.id,
    projectId: group.projectId,
    name: group.name,
    description: group.description,
    status: group.status,
    createdBy: group.createdBy,
    createdAt: group.createdAt,
    archivedAt: group.archivedAt,
    assignmentCount: group.assignmentCount,
    activeRuleCount: group.activeRuleCount,
    pendingRuleCount: group.pendingRuleCount,
    futureAssignmentCount: group.futureAssignmentCount,
    unassignedProjectStreamers: group.unassignedProjectStreamers,
    baseRuleCoveredProjectStreamerIds: group.baseRuleCoveredProjectStreamerIds,
  };
}

export function toSettlementGroupAssignmentChangeDto(
  change: SettlementGroupAssignmentChangeResult,
) {
  return {
    insertedAssignment: {
      id: change.insertedAssignment.id,
      projectId: change.insertedAssignment.projectId,
      projectStreamerId: change.insertedAssignment.projectStreamerId,
      groupId: change.insertedAssignment.groupId,
      effectiveFrom: change.insertedAssignment.effectiveFrom,
      effectiveUntil: change.insertedAssignment.effectiveUntil,
      assignedBy: change.insertedAssignment.assignedBy,
      reason: change.insertedAssignment.reason,
      createdAt: change.insertedAssignment.createdAt,
    },
    closedAssignmentIds: change.closedAssignmentIds,
    newGroupSnapshotHash: change.newGroupSnapshotHash,
  };
}

export function toReusableSettlementRuleTemplateDto(
  template: ReusableSettlementRuleTemplateDto,
) {
  if (template.kind === "system") {
    return {
      kind: template.kind,
      id: template.id,
      name: template.name,
      description: template.description,
      contract: template.contract,
      readOnly: template.readOnly,
    };
  }
  return {
    kind: template.kind,
    id: template.id,
    name: template.name,
    description: template.description,
    executionGrain: template.executionGrain,
    compositionMode: template.compositionMode,
    parameters: template.parameters,
    contract: template.ruleContract,
    status: template.status,
    createdBy: template.createdBy,
    createdAt: template.createdAt,
    archivedAt: template.archivedAt,
    readOnly: template.readOnly,
  };
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

function mapCustomRuleSimulationDto(
  simulation: SettlementFormulaSimulation & { duplicate?: boolean },
) {
  if (
    simulation.summarySchemaVersion === 1 &&
    !simulation.summaryComplete
  ) {
    return {
      version: 1 as const,
      complete: false as const,
      status: "legacy" as const,
      id: simulation.id,
      createdAt: simulation.createdAt,
      summary: null,
      message: "旧版摘要不完整，请重新试算" as const,
      ...(simulation.duplicate === undefined
        ? {}
        : { duplicate: simulation.duplicate }),
    };
  }

  const payableActive =
    simulation.historicalTotals.newPayableAmountCents !== null;
  const receivableActive =
    simulation.historicalTotals.newReceivableAmountCents !== null;
  const outputKind = simulation.coverage.outputKind ?? "money_result";
  const typedOutputSummary =
    outputKind === "cost_items" || outputKind === "checks";
  if (
    (typedOutputSummary && (payableActive || receivableActive)) ||
    (!typedOutputSummary && payableActive === receivableActive)
  ) {
    throw new CustomRuleRouteError({
      code: "CUSTOM_RULE_RESPONSE_INVALID",
      message: "Settlement rule response is invalid",
      status: 500,
      retryable: true,
    });
  }
  const totalOldCents = payableActive
    ? simulation.historicalTotals.oldPayableAmountCents
    : simulation.historicalTotals.oldReceivableAmountCents;
  const totalNewCents = payableActive
    ? simulation.historicalTotals.newPayableAmountCents
    : simulation.historicalTotals.newReceivableAmountCents;
  const totalDeltaCents = payableActive
    ? simulation.deltas.payableAmountCents
    : simulation.deltas.receivableAmountCents;
  if (!typedOutputSummary && totalNewCents === null) {
    throw new CustomRuleRouteError({
      code: "CUSTOM_RULE_RESPONSE_INVALID",
      message: "Settlement rule response is invalid",
      status: 500,
      retryable: true,
    });
  }
  const findingDto = (
    finding: (typeof simulation.warnings)[number],
  ) => ({
    code: finding.code,
    severity: finding.severity,
    message: finding.message,
  });
  const summary = {
    recordCount: simulation.historicalTotals.recordCount,
    coverage: {
      totalCount: simulation.coverage.totalRecords,
      evaluatedCount: simulation.coverage.evaluatedRecords,
      ratePercent: coverageRatePercent(
        simulation.coverage.evaluatedRecords,
        simulation.coverage.totalRecords,
      ),
    },
    uncoveredCount: simulation.coverage.uncoveredRecords,
    zeroPayCount: simulation.coverage.zeroAmountRecords,
    reviewRoutedCount: simulation.coverage.reviewRoutedRecords,
    blockedCount: simulation.coverage.blockedRecords,
    largestIncreases: simulation.largestChanges
      .filter((change) => change.direction === "increase")
      .map((change) => ({
        bucket: change.key,
        deltaYuan: centsToYuan(change.deltaAmountCents),
        direction: change.direction,
      })),
    largestDecreases: simulation.largestChanges
      .filter((change) => change.direction === "decrease")
      .map((change) => ({
        bucket: change.key,
        deltaYuan: centsToYuan(change.deltaAmountCents),
        direction: change.direction,
      })),
    totalOldYuan: centsToYuan(totalOldCents),
    totalNewYuan: centsToYuan(totalNewCents),
    totalDeltaYuan: centsToYuan(totalDeltaCents),
    marginImpactYuan: centsToYuan(simulation.deltas.marginImpactCents),
    historicalVerification:
      simulation.historicalTotals.verificationStatus === "verified"
        ? {
            status: "verified" as const,
            label: "已通过历史数据验证" as const,
          }
        : {
            status: "unverified" as const,
            label: "未经过历史数据验证" as const,
          },
    dataSelectionHash: simulation.dataSelectionHash,
    riskFlags: simulation.warnings
      .filter((finding) => finding.kind === "risk")
      .map(findingDto),
    warnings: simulation.warnings
      .filter((finding) => finding.kind === "warning")
      .map(findingDto),
    scenarios: simulation.scenarios.map((scenario) => ({
      id: scenario.id,
      category: scenario.category,
      outcome: scenario.outcome,
      amountYuan: centsToYuan(scenario.amountCents),
      expectedAmountYuan: centsToYuan(scenario.expectedAmountCents),
      passed: scenario.passed,
    })),
  };

  return {
    version: 2 as const,
    complete: true as const,
    status: "complete" as const,
    id: simulation.id,
    createdAt: simulation.createdAt,
    summary,
    ...(simulation.duplicate === undefined
      ? {}
      : { duplicate: simulation.duplicate }),
  };
}

type CustomRuleSimulationDto = ReturnType<typeof mapCustomRuleSimulationDto>;
type CompleteCustomRuleSimulationDto = Extract<
  CustomRuleSimulationDto,
  { version: 2 }
>;

export function toCustomRuleSimulationDto(
  simulation: InsertedSettlementFormulaSimulation,
): CompleteCustomRuleSimulationDto;
export function toCustomRuleSimulationDto(
  simulation: SettlementFormulaSimulation & { duplicate?: boolean },
): CustomRuleSimulationDto;
export function toCustomRuleSimulationDto(
  simulation: SettlementFormulaSimulation & { duplicate?: boolean },
): CustomRuleSimulationDto {
  return mapCustomRuleSimulationDto(simulation);
}

export function toCustomRuleSessionDto(input: {
  history: Awaited<ReturnType<ConversationService["getHistory"]>>;
  draft: CustomRuleDraft;
  simulation: SettlementFormulaSimulation | null;
}) {
  const simulation = input.simulation
    ? toCustomRuleSimulationDto(input.simulation)
    : null;
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
    simulation,
    summary: simulation?.version === 2 ? simulation.summary : null,
  };
}

export function createCustomRuleExistingDraftSimulationService(input: {
  repository: Pick<
    SupabaseCustomRuleReadRepository,
    "listDrafts" | "insertSimulation"
  >;
  catalog: CustomRuleRouteContext["catalog"];
  evidence: CustomRuleEvidenceAdapter;
  analyzeReadiness?: typeof analyzeCustomRuleDataReadiness;
  simulate?: typeof simulateCustomSettlementRule;
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
          ...(contract.scope === "external_cost" ||
          contract.scope === "reconciliation"
            ? { compositionMode: contract.compositionMode }
            : {}),
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
      const requirements = readinessRequirements(
        contract,
        validation.variables,
      );
      const readiness = input.evidence.adjustReadiness(
        (input.analyzeReadiness ?? analyzeCustomRuleDataReadiness)({
          catalog,
          inputs: requirements,
        }),
      );
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
        inputs: requirements,
      });
      if (
        evidence.provenance.optionalPolicyHash !==
        calculateCustomRuleOptionalPolicyHash(requirements)
      ) {
        throw new CustomRuleRouteError({
          code: "CUSTOM_RULE_SIMULATION_INVALID",
          message: "Settlement rule evidence policy snapshot is invalid",
          status: 422,
          retryable: false,
        });
      }
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
      const summary = input.evidence.decorateSimulationResult(
        (input.simulate ?? simulateCustomSettlementRule)(simulationInput),
      );
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
const MAX_AUTHORIZED_SOURCE_REPORTS = 10_000;
const MAX_AUTHORIZED_SIMULATION_RECORDS = 500;
const MAX_SELECTION_INCLUSIVE_CALENDAR_DAYS = 366;
const SNAPSHOT_MAX_AGE_MS = 5 * 60 * 1_000;
const SNAPSHOT_MAX_FUTURE_SKEW_MS = 60 * 1_000;
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const confirmedBusinessTimezoneSourceSchema = z.enum([
  "contract_default",
  "organization_setting",
  "confirmed_contract",
]);
const canonicalNumericTextSchema = z
  .string()
  .regex(/^-?(?:0|[1-9]\d*)(?:\.\d*[1-9])?$/u)
  .refine((value) => value !== "-0", {
    message: "numeric text must be canonical",
  });
const canonicalIntegerTextSchema = z.string().regex(/^(?:0|-?[1-9]\d*)$/u);
const liveTaskRelationSchema = z.union([
  z.strictObject({ system_started_at: z.string().nullable() }),
  z.array(z.strictObject({ system_started_at: z.string().nullable() })),
]);
const approvedReportRowSchema = z.strictObject({
  id: z.string().uuid(),
  organization_id: z.string().uuid(),
  project_id: z.string().uuid(),
  live_task_id: z.string().uuid(),
  streamer_id: z.string().uuid(),
  status: z.string().min(1),
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
const settlementBatchRowSchema = z.strictObject({
  id: z.string().uuid(),
  organization_id: z.string().uuid(),
  project_id: z.string().uuid(),
  status: z.literal("locked"),
  batch_type: z.enum(["payable", "receivable"]),
  title: z.string().min(1).max(200).nullable(),
  computed_amount: canonicalNumericTextSchema,
  manual_amount: canonicalNumericTextSchema,
  adjustment_amount: canonicalNumericTextSchema,
  locked_at: z.string().nullable(),
  period_start: z.string(),
  period_end: z.string(),
  created_at: canonicalOffsetDateTimeSchema,
  updated_at: canonicalOffsetDateTimeSchema,
  version: hashSchema,
});
const batchRelationSchema = z.union([
  z.strictObject({
    id: z.string().uuid(),
    status: z.literal("locked"),
    batch_type: z.enum(["payable", "receivable"]),
    locked_at: z.string().nullable(),
    period_start: z.string().optional(),
    period_end: z.string().optional(),
    version: hashSchema,
  }),
  z.array(
    z.strictObject({
      id: z.string().uuid(),
      status: z.literal("locked"),
      batch_type: z.enum(["payable", "receivable"]),
      locked_at: z.string().nullable(),
      period_start: z.string().optional(),
      period_end: z.string().optional(),
      version: hashSchema,
    }),
  ),
]);
const settlementItemRowSchema = z.strictObject({
  id: z.string().uuid(),
  organization_id: z.string().uuid(),
  project_id: z.string().uuid(),
  settlement_batch_id: z.string().uuid(),
  streamer_id: z.string().uuid().nullable(),
  live_report_id: z.string().uuid().nullable(),
  item_type: z.string().min(1).max(100),
  computed_amount: canonicalNumericTextSchema,
  manual_amount: canonicalNumericTextSchema,
  adjustment_amount: canonicalNumericTextSchema,
  evidence_level: z.enum(["green", "yellow", "red"]).nullable(),
  created_at: canonicalOffsetDateTimeSchema,
  settlement_batches: batchRelationSchema,
});
const projectCostRowSchema = z.strictObject({
  id: z.string().uuid(),
  organization_id: z.string().uuid(),
  project_id: z.string().uuid(),
  streamer_id: z.string().uuid().nullable(),
  live_report_id: z.string().uuid().nullable(),
  settlement_batch_id: z.string().uuid().nullable(),
  supplier_organization_id: z.string().uuid().nullable().optional(),
  item_type: z.string().min(1).max(100).optional(),
  import_type: z.string().min(1).max(100).nullable().optional(),
  source_payload: z.record(z.string(), z.unknown()).nullable().optional(),
  amount_cents: canonicalIntegerTextSchema,
  direction: z.enum(["cost", "revenue_offset", "adjustment"]),
  status: z.literal("confirmed"),
  created_at: z.string(),
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
  status: z.string().min(1).max(100),
  hourly_rate: canonicalNumericTextSchema.nullable(),
  base_salary: canonicalNumericTextSchema.nullable(),
  cps_rate_bps: z.number().int().min(0).max(10_000).nullable(),
  collaboration_id: z.string().uuid().nullable(),
  streamers: streamerRelationSchema,
});
const snapshotStreamerRowSchema = z.strictObject({
  id: z.string().uuid(),
  organization_id: z.string().uuid(),
  source_type: z.string().min(1).max(100),
});
const evidenceSnapshotSchema = z.strictObject({
  schema_version: z.literal(1),
  snapshot_version: z.literal(1),
  organization_id: z.string().uuid(),
  project_id: z.string().uuid(),
  actor_id: z.string().uuid(),
  scope: customRuleScopeSchema,
  period_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
  period_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
  business_timezone: z.string().min(1).max(100),
  business_timezone_confirmed: z.boolean(),
  business_timezone_source: confirmedBusinessTimezoneSourceSchema,
  captured_at: canonicalOffsetDateTimeSchema,
  source_count: z.number().int().min(0).max(MAX_AUTHORIZED_SOURCE_REPORTS),
  source_counts: z.strictObject({
    settlement_batches: z.number().int().min(0).max(MAX_AUTHORIZED_SOURCE_REPORTS),
    settlement_batch_items: z
      .number()
      .int()
      .min(0)
      .max(MAX_AUTHORIZED_SOURCE_REPORTS),
    live_reports: z.number().int().min(0).max(MAX_AUTHORIZED_SOURCE_REPORTS),
    live_tasks: z.number().int().min(0).max(MAX_AUTHORIZED_SOURCE_REPORTS),
    project_cost_items: z
      .number()
      .int()
      .min(0)
      .max(MAX_AUTHORIZED_SOURCE_REPORTS),
    project_streamers: z
      .number()
      .int()
      .min(0)
      .max(MAX_AUTHORIZED_SOURCE_REPORTS),
    streamers: z.number().int().min(0).max(MAX_AUTHORIZED_SOURCE_REPORTS),
    total: z.number().int().min(0).max(MAX_AUTHORIZED_SOURCE_REPORTS),
  }),
  record_count: z.number().int().min(0).max(MAX_AUTHORIZED_SIMULATION_RECORDS),
  project: z.strictObject({
    id: z.string().uuid(),
    organization_id: z.string().uuid(),
    code: z.string().min(1).max(200),
    name: z.string().min(1).max(500),
    status: z.string().min(1).max(100),
    updated_at: canonicalOffsetDateTimeSchema,
    business_timezone: z.string().min(1).max(100),
    business_timezone_confirmed: z.boolean(),
    business_timezone_source: confirmedBusinessTimezoneSourceSchema,
  }),
  settlement_batches: z
    .array(settlementBatchRowSchema)
    .max(MAX_AUTHORIZED_SOURCE_REPORTS),
  settlement_batch_items: z
    .array(settlementItemRowSchema)
    .max(MAX_AUTHORIZED_SOURCE_REPORTS),
  live_reports: z
    .array(approvedReportRowSchema)
    .max(MAX_AUTHORIZED_SOURCE_REPORTS),
  project_cost_items: z
    .array(projectCostRowSchema)
    .max(MAX_AUTHORIZED_SOURCE_REPORTS),
  project_streamers: z
    .array(projectStreamerRowSchema)
    .max(MAX_AUTHORIZED_SOURCE_REPORTS),
  streamers: z
    .array(snapshotStreamerRowSchema)
    .max(MAX_AUTHORIZED_SOURCE_REPORTS),
  snapshot_hash: hashSchema,
});

type ApprovedReportRow = z.infer<typeof approvedReportRowSchema>;
type SettlementBatchRow = z.infer<typeof settlementBatchRowSchema>;
type SettlementItemRow = z.infer<typeof settlementItemRowSchema>;
type ProjectCostRow = z.infer<typeof projectCostRowSchema>;
type ProjectStreamerRow = z.infer<typeof projectStreamerRowSchema>;
type EvidenceSnapshot = z.infer<typeof evidenceSnapshotSchema>;
type ConfirmedBusinessTimezoneSource = z.infer<
  typeof confirmedBusinessTimezoneSourceSchema
>;
type EvidenceSnapshotExpectation = {
  organizationId: string;
  actorId: string;
  projectId: string;
  scope: CustomRuleScope;
  periodStart: string;
  periodEnd: string;
  businessTimezone: string;
  businessTimezoneSource: ConfirmedBusinessTimezoneSource;
  executionGrain: CustomRuleDraft["businessContract"]["executionGrain"];
  periodStartInclusive: string;
  periodEndExclusive: string;
};
type AuthorizedSimulationRecord =
  AuthorizedCustomRuleSimulationEvidence["records"][number];

export function createSupabaseCustomRuleEvidenceAdapter(input: {
  client: SupabaseClient;
  repository: Pick<SupabaseCustomRuleReadRepository, "listDrafts">;
  catalog: CustomRuleRouteContext["catalog"];
  now?: () => Date;
}): CustomRuleEvidenceAdapter {
  const now = input.now ?? (() => new Date());
  const authorizedEvidence = new Map<
    string,
    {
      evidence: AuthorizedCustomRuleSimulationEvidence;
      historicalComplete: boolean;
      marginStatus: "available" | "unavailable" | "not_applicable";
      usesUnlinkedCostFallback: boolean;
    }
  >();
  let latestSelectionToken: string | null = null;

  return {
    async authorizeSelection(unsafeInput) {
      assertSupportedSelection(unsafeInput.selection);
      const userExamples = parseWithSchema(
        unsafeInput.selection.userExamples ?? [],
        customRuleUserExamplesSchema,
      );
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
      assertUserExamplesMatchScope(
        userExamples,
        draft.businessContract.scope,
      );
      const catalog = await input.catalog.getCatalog({
        organizationId: unsafeInput.actor.organizationId,
        projectId: unsafeInput.projectId,
        scope: draft.businessContract.scope,
        executionGrain: draft.businessContract.executionGrain,
      });
      if (
        !catalog.businessTimezoneConfirmed ||
        !catalog.businessTimezone ||
        catalog.businessTimezoneSource === "unresolved" ||
        catalog.businessTimezone !== draft.businessContract.businessTimezone
      ) {
        throw routeError(
          "CUSTOM_RULE_DATA_NOT_READY",
          "Project business timezone is not confirmed for this rule",
          422,
        );
      }
      const businessPeriod = businessPeriodBoundaries(
        unsafeInput.selection.periodStart,
        unsafeInput.selection.periodEnd,
        catalog.businessTimezone,
      );
      const snapshot = await readCustomSettlementEvidenceSnapshot(
        input.client,
        {
          organizationId: unsafeInput.actor.organizationId,
          actorId: unsafeInput.actor.userId,
          projectId: unsafeInput.projectId,
          scope: draft.businessContract.scope,
          periodStart: unsafeInput.selection.periodStart,
          periodEnd: unsafeInput.selection.periodEnd,
          businessTimezone: catalog.businessTimezone,
          businessTimezoneSource: catalog.businessTimezoneSource,
          executionGrain: draft.businessContract.executionGrain,
          periodStartInclusive: businessPeriod.startInclusive,
          periodEndExclusive: businessPeriod.endExclusive,
        },
        now,
      );
      const allBatches = [...snapshot.settlement_batches].sort((left, right) =>
        left.id.localeCompare(right.id),
      );
      const requestedBatches = allBatches.filter(
        (batch) => batch.batch_type === draft.businessContract.scope,
      );
      const oppositeScope =
        draft.businessContract.scope === "payable" ? "receivable" : "payable";
      const pairedBatches = allBatches.filter(
        (batch) => batch.batch_type === oppositeScope,
      );
      const batchScopeById = new Map(
        allBatches.map((batch) => [batch.id, batch.batch_type]),
      );
      const allItems = [...snapshot.settlement_batch_items].sort(
        (left, right) => left.id.localeCompare(right.id),
      );
      const items = allItems.filter(
        (item) =>
          batchScopeById.get(item.settlement_batch_id) ===
          draft.businessContract.scope,
      );
      const pairedItems = allItems.filter(
        (item) =>
          batchScopeById.get(item.settlement_batch_id) === oppositeScope,
      );
      const snapshotLinkedReportIds = new Set(
        allItems.flatMap((item) =>
          item.live_report_id ? [item.live_report_id] : [],
        ),
      );
      const reportIdsFromItems = [
        ...new Set(
          items.flatMap((item) =>
            item.live_report_id ? [item.live_report_id] : [],
          ),
        ),
      ].sort((left, right) => left.localeCompare(right));
      const reportsById = new Map(
        snapshot.live_reports.map((report) => [report.id, report]),
      );
      const reports = requestedBatches.length
        ? reportIdsFromItems.map((reportId) => {
            const report = reportsById.get(reportId);
            if (!report) {
              throw routeError(
                "CUSTOM_RULE_EVIDENCE_INVALID",
                "Locked settlement evidence references an unavailable approved report",
                500,
                true,
              );
            }
            return report;
          })
        : selectApprovedReportsWithinPeriod(snapshot.live_reports, {
            periodStartInclusive: businessPeriod.startInclusive,
            periodEndExclusive: businessPeriod.endExclusive,
            allowedOutOfWindowReportIds: snapshotLinkedReportIds,
          });
      const reportIds = reports.map((report) => report.id);
      const itemsByReport = groupLockedItemsByReport(items, reportIds);
      const historicalComplete = historicalAttributionComplete({
        executionGrain: draft.businessContract.executionGrain,
        batches: requestedBatches,
        items,
        reports,
        itemsByReport,
      });
      const pairedItemsByReport = groupLockedItemsByReport(pairedItems);
      const pairedComplete = pairedScopeComplete({
        executionGrain: draft.businessContract.executionGrain,
        requestedBatches,
        requestedItems: items,
        pairedBatches,
        pairedItems,
        reports,
        requestedItemsByReport: itemsByReport,
        pairedItemsByReport,
      });
      const expectedRecordCount = prospectiveAuthorizedRecordCount({
        executionGrain: draft.businessContract.executionGrain,
        reports,
        batches: requestedBatches,
        items,
      });
      if (snapshot.record_count !== expectedRecordCount) {
        throw routeError(
          "CUSTOM_RULE_EVIDENCE_INVALID",
          "Settlement rule evidence record count is invalid",
          500,
          true,
        );
      }
      const selectedBatchIds = new Set(
        [...items, ...pairedItems].map((item) => item.settlement_batch_id),
      );
      const selectedReportIds = new Set([
        ...reports.map((report) => report.id),
        ...[...items, ...pairedItems].flatMap((item) =>
          item.live_report_id === null ? [] : [item.live_report_id],
        ),
      ]);
      const periodStartEpoch = Date.parse(businessPeriod.startInclusive);
      const periodEndEpoch = Date.parse(businessPeriod.endExclusive);
      const costs = snapshot.project_cost_items
        .filter((cost) => {
          if (
            cost.live_report_id !== null ||
            cost.settlement_batch_id !== null
          ) {
            return (
              (cost.live_report_id === null ||
                selectedReportIds.has(cost.live_report_id)) &&
              (cost.settlement_batch_id === null ||
                selectedBatchIds.has(cost.settlement_batch_id))
            );
          }
          const createdAt = canonicalOffsetDateTimeEpoch(cost.created_at);
          return (
            createdAt !== null &&
            createdAt >= periodStartEpoch &&
            createdAt < periodEndEpoch
          );
        })
        .sort((left, right) => left.id.localeCompare(right.id));
      const costSelection = {
        usesUnlinkedPeriodFallback: costs.some(
          (cost) =>
            cost.live_report_id === null && cost.settlement_batch_id === null,
        ),
      };
      const margin = deriveCurrentMargin({
        scope: draft.businessContract.scope,
        executionGrain: draft.businessContract.executionGrain,
        reports,
        requestedBatches,
        pairedBatches,
        requestedItems: items,
        pairedItems,
        itemsByReport,
        pairedItemsByReport,
        costs,
        pairedComplete,
      });
      const streamers = [...snapshot.project_streamers].sort((left, right) =>
        left.streamer_id.localeCompare(right.streamer_id),
      );
      const streamersById = new Map(
        streamers.map((streamer) => [streamer.streamer_id, streamer]),
      );
      const requiredVariables = new Set(
        draft.businessContract.requiredInputs.flatMap((required) => {
          const catalogVariable = catalog.variables.find(
            (variable) => variable.id === required.name,
          );
          return catalogVariable?.availability === "available" &&
            catalogVariable.coverageDenominator > 0 &&
            catalogVariable.coverageNumerator ===
              catalogVariable.coverageDenominator
            ? [required.name]
            : [];
        }),
      );
      const records = buildAuthorizedSimulationRecords({
        organizationId: unsafeInput.actor.organizationId,
        projectId: unsafeInput.projectId,
        contract: draft.businessContract,
        selection: unsafeInput.selection,
        reports,
        batches: requestedBatches,
        items,
        itemsByReport,
        costs,
        streamersById,
        historicalComplete,
        periodBoundaries: businessPeriod,
      }).map((record) => ({
        ...record,
        sourceVersion: {
          ...record.sourceVersion,
          version: sha256(
            JSON.stringify({
              snapshotHash: snapshot.snapshot_hash,
              source: record.sourceVersion.source,
              version: record.sourceVersion.version,
            }),
          ),
        },
      }));
      if (records.length !== snapshot.record_count) {
        throw routeError(
          "CUSTOM_RULE_EVIDENCE_INVALID",
          "Settlement rule evidence record count changed during mapping",
          500,
          true,
        );
      }
      assertRequiredRecordVariables(records, requiredVariables);
      if (records.length > MAX_AUTHORIZED_SIMULATION_RECORDS) {
        throw routeError(
          "CUSTOM_RULE_SELECTION_TOO_LARGE",
          "Authorized simulation selection has too many execution records",
          422,
        );
      }
      const selectionToken = `server:${sha256(
        JSON.stringify({
          organizationId: unsafeInput.actor.organizationId,
          projectId: unsafeInput.projectId,
          conversationId: unsafeInput.conversationId,
          draftId: draft.id,
          revisionNumber: draft.revisionNumber,
          periodStart: unsafeInput.selection.periodStart,
          periodEnd: unsafeInput.selection.periodEnd,
          businessTimezone: catalog.businessTimezone,
          runtimePeriodStart: businessPeriod.runtimeStartInclusive,
          runtimePeriodEnd: businessPeriod.runtimeEndInclusive,
          costSelectionMode: costSelection.usesUnlinkedPeriodFallback
            ? "linked_plus_unlinked_period_fallback"
            : "linked_only",
          criteriaCodes: [...unsafeInput.selection.criteriaCodes].sort(),
          groupPopulation: unsafeInput.selection.groupPopulation ?? null,
          userExamples,
          snapshotHash: snapshot.snapshot_hash,
        }),
      )}`;
      const authorizedSelection: AuthorizedSimulationSelectionRequest = {
        selectionToken,
        periodStart: unsafeInput.selection.periodStart,
        periodEnd: unsafeInput.selection.periodEnd,
        criteriaCodes: [...unsafeInput.selection.criteriaCodes],
        ...(unsafeInput.selection.groupPopulation
          ? {
              groupPopulation: {
                assignedProjectStreamerIds: [
                  ...unsafeInput.selection.groupPopulation
                    .assignedProjectStreamerIds,
                ],
                unassignedProjectStreamerIds: [
                  ...unsafeInput.selection.groupPopulation
                    .unassignedProjectStreamerIds,
                ],
                groupSnapshotHash:
                  unsafeInput.selection.groupPopulation.groupSnapshotHash,
              },
            }
          : {}),
      };
      const evidence: AuthorizedCustomRuleSimulationEvidence = {
        provenance: {
          organizationId: unsafeInput.actor.organizationId,
          projectId: unsafeInput.projectId,
          actorId: unsafeInput.actor.userId,
          selectionToken,
          evidenceHash: "0".repeat(64),
          optionalPolicyHash: calculateCustomRuleOptionalPolicyHash([]),
          immutableSourceVersions: records.map(
            (record) => record.sourceVersion,
          ),
        },
        sampleSource: {
          kind: historicalComplete
            ? "historical_settlements"
            : "approved_operations",
        },
        sampleSelection: {
          periodStart: unsafeInput.selection.periodStart,
          periodEnd: unsafeInput.selection.periodEnd,
          populationCount:
            requestedBatches.length > 0 ? items.length : reports.length,
          criteria: [...unsafeInput.selection.criteriaCodes],
          ...(unsafeInput.selection.groupPopulation
            ? {
                groupPopulation: {
                  assignedProjectStreamerIds: [
                    ...unsafeInput.selection.groupPopulation
                      .assignedProjectStreamerIds,
                  ],
                  unassignedProjectStreamerIds: [
                    ...unsafeInput.selection.groupPopulation
                      .unassignedProjectStreamerIds,
                  ],
                  groupSnapshotHash:
                    unsafeInput.selection.groupPopulation.groupSnapshotHash,
                },
              }
            : {}),
        },
        records,
        userExamples: [...userExamples],
        currentMarginCents:
          margin.amount === null ? null : String(margin.amount),
      };
      evidence.provenance.evidenceHash =
        calculateCustomRuleEvidenceHash(evidence);
      authorizedEvidence.set(selectionToken, {
        evidence: freezeAuthorizedCustomRuleSimulationEvidence(evidence),
        historicalComplete,
        marginStatus: margin.status,
        usesUnlinkedCostFallback: costSelection.usesUnlinkedPeriodFallback,
      });
      latestSelectionToken = selectionToken;
      return authorizedSelection;
    },

    async loadAuthorizedEvidence(loadInput) {
      if (
        loadInput.actor.organizationId !== loadInput.organizationId ||
        loadInput.actor.organizationId.length === 0
      ) {
        throw routeError(
          "CUSTOM_RULE_PROJECT_ACCESS_DENIED",
          "Project access denied",
          403,
        );
      }
      const state = authorizedEvidence.get(loadInput.selection.selectionToken);
      const evidence = state?.evidence;
      if (
        !evidence ||
        evidence.provenance.organizationId !== loadInput.organizationId ||
        evidence.provenance.projectId !== loadInput.projectId ||
        evidence.provenance.actorId !== loadInput.actor.userId ||
        evidence.sampleSelection.periodStart !==
          loadInput.selection.periodStart ||
        evidence.sampleSelection.periodEnd !== loadInput.selection.periodEnd ||
        JSON.stringify([...evidence.sampleSelection.criteria].sort()) !==
          JSON.stringify([...loadInput.selection.criteriaCodes].sort()) ||
        JSON.stringify(evidence.sampleSelection.groupPopulation ?? null) !==
          JSON.stringify(loadInput.selection.groupPopulation ?? null)
      ) {
        throw routeError(
          "CUSTOM_RULE_SELECTION_UNSUPPORTED",
          "Authorized simulation selection is unavailable",
          422,
        );
      }
      return applyInputRequirementsToEvidence(
        evidence,
        loadInput.inputs ?? [],
      );
    },

    adjustReadiness(readiness) {
      const state = latestSelectionToken
        ? authorizedEvidence.get(latestSelectionToken)
        : null;
      if (!state || state.historicalComplete) return readiness;
      const warnings = readiness.warnings.some(
        (warning) => warning.code === "CUSTOM_RULE_PROJECT_NO_HISTORY",
      )
        ? readiness.warnings
        : [
            ...readiness.warnings,
            {
              code: "CUSTOM_RULE_PROJECT_NO_HISTORY" as const,
              reasonZh:
                "授权周期缺少完整锁定结算结果，本次试算不作为历史金额比较。",
            },
          ];
      return {
        ...readiness,
        historicalVerification: "unverified",
        readyForActivation: false,
        warnings,
      };
    },

    decorateSimulationResult(result) {
      const state = latestSelectionToken
        ? authorizedEvidence.get(latestSelectionToken)
        : null;
      if (!state) return result;
      const addedWarnings: Array<{
        code: string;
        severity: "warning";
        message: string;
      }> = [];
      if (state.marginStatus === "unavailable") {
        addedWarnings.push({
          code: "CUSTOM_RULE_MARGIN_UNAVAILABLE",
          severity: "warning",
          message: "授权证据无法完整分配应收、应付或成本组成，未验证毛利影响。",
        });
      }
      if (state.usesUnlinkedCostFallback) {
        addedWarnings.push({
          code: "CUSTOM_RULE_MARGIN_PROVISIONAL",
          severity: "warning",
          message: "未关联成本按业务日期内的创建时间纳入，毛利证据为临时口径。",
        });
      }
      if (addedWarnings.length === 0) return result;
      const addedCodes = new Set(addedWarnings.map((warning) => warning.code));
      const warnings = [
        ...result.warnings.filter((warning) => !addedCodes.has(warning.code)),
        ...addedWarnings,
      ].sort((left, right) => left.code.localeCompare(right.code));
      const persistedWarnings = [
        ...result.persistable.warnings.filter(
          (warning) => !addedCodes.has(warning.code),
        ),
        ...addedWarnings,
      ].sort((left, right) => left.code.localeCompare(right.code));
      return {
        ...result,
        warnings,
        persistable: {
          ...result.persistable,
          warnings: persistedWarnings,
        },
      };
    },
  };
}

function assertSupportedSelection(
  selection: AuthorizeCustomRuleSelectionInput["selection"],
): void {
  const criteria = [...selection.criteriaCodes];
  const unique = new Set(criteria);
  const start = parseBusinessDate(selection.periodStart);
  const end = parseBusinessDate(selection.periodEnd);
  const supported =
    start !== null &&
    end !== null &&
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
  if (!start || !end) return;
  const calendarDayDifference =
    (calendarUtcEpoch({ ...end, hour: 0, minute: 0, second: 0 }) -
      calendarUtcEpoch({ ...start, hour: 0, minute: 0, second: 0 })) /
    86_400_000;
  const inclusiveCalendarDays = calendarDayDifference + 1;
  if (
    !Number.isSafeInteger(inclusiveCalendarDays) ||
    inclusiveCalendarDays > MAX_SELECTION_INCLUSIVE_CALENDAR_DAYS
  ) {
    throw routeError(
      "CUSTOM_RULE_SELECTION_TOO_LARGE",
      "Historical simulation period exceeds the Phase 1 limit",
      422,
    );
  }
}

function businessPeriodBoundaries(
  periodStart: string,
  periodEnd: string,
  businessTimezone: string,
): {
  startInclusive: string;
  endExclusive: string;
  runtimeStartInclusive: string;
  runtimeEndInclusive: string;
} {
  const startInclusive = businessDateBoundary(periodStart, businessTimezone);
  const endExclusive = businessDateBoundary(
    nextBusinessDate(periodEnd),
    businessTimezone,
  );
  const startEpoch = Date.parse(startInclusive);
  const endEpoch = Date.parse(endExclusive);
  if (
    !Number.isFinite(startEpoch) ||
    !Number.isFinite(endEpoch) ||
    endEpoch <= startEpoch
  ) {
    throw routeError(
      "CUSTOM_RULE_DATA_NOT_READY",
      "Project business timezone cannot resolve the selection period",
      422,
    );
  }
  return {
    startInclusive,
    endExclusive,
    runtimeStartInclusive: new Date(startEpoch).toISOString(),
    runtimeEndInclusive: new Date(endEpoch - 1).toISOString(),
  };
}

function businessDateBoundary(value: string, timezone: string): string {
  const parts = parseBusinessDate(value);
  if (!parts) {
    throw routeError(
      "CUSTOM_RULE_SELECTION_UNSUPPORTED",
      "Historical simulation selection is unsupported",
      422,
    );
  }
  const targetEpoch = calendarUtcEpoch({
    ...parts,
    hour: 0,
    minute: 0,
    second: 0,
  });
  let instant = targetEpoch;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const local = zonedCalendarParts(instant, timezone);
    const adjustment = targetEpoch - calendarUtcEpoch(local);
    instant += adjustment;
    if (adjustment === 0) break;
  }
  const local = zonedCalendarParts(instant, timezone);
  if (
    local.year !== parts.year ||
    local.month !== parts.month ||
    local.day !== parts.day ||
    local.hour !== 0 ||
    local.minute !== 0 ||
    local.second !== 0
  ) {
    throw routeError(
      "CUSTOM_RULE_DATA_NOT_READY",
      "Project business timezone cannot resolve the selection period",
      422,
    );
  }
  const offsetMinutes = (targetEpoch - instant) / 60_000;
  if (!Number.isInteger(offsetMinutes) || Math.abs(offsetMinutes) > 24 * 60) {
    throw routeError(
      "CUSTOM_RULE_DATA_NOT_READY",
      "Project business timezone cannot resolve the selection period",
      422,
    );
  }
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absolute = Math.abs(offsetMinutes);
  return `${value}T00:00:00.000${sign}${String(Math.floor(absolute / 60)).padStart(2, "0")}:${String(absolute % 60).padStart(2, "0")}`;
}

function nextBusinessDate(value: string): string {
  const parts = parseBusinessDate(value);
  if (!parts) {
    throw routeError(
      "CUSTOM_RULE_SELECTION_UNSUPPORTED",
      "Historical simulation selection is unsupported",
      422,
    );
  }
  const date = new Date(0);
  date.setUTCFullYear(parts.year, parts.month - 1, parts.day + 1);
  date.setUTCHours(0, 0, 0, 0);
  if (date.getUTCFullYear() > 9_999) {
    throw routeError(
      "CUSTOM_RULE_SELECTION_UNSUPPORTED",
      "Historical simulation selection is unsupported",
      422,
    );
  }
  return `${String(date.getUTCFullYear()).padStart(4, "0")}-${String(
    date.getUTCMonth() + 1,
  ).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function parseBusinessDate(
  value: string,
): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(0, 0, 0, 0);
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
    ? { year, month, day }
    : null;
}

function zonedCalendarParts(
  epochMilliseconds: number,
  timezone: string,
): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
} {
  try {
    const formatter = new Intl.DateTimeFormat("en-US-u-ca-gregory-nu-latn", {
      timeZone: timezone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    const values = new Map<string, number>();
    for (const part of formatter.formatToParts(new Date(epochMilliseconds))) {
      if (
        part.type === "year" ||
        part.type === "month" ||
        part.type === "day" ||
        part.type === "hour" ||
        part.type === "minute" ||
        part.type === "second"
      ) {
        values.set(part.type, Number(part.value));
      }
    }
    const result = {
      year: values.get("year"),
      month: values.get("month"),
      day: values.get("day"),
      hour: values.get("hour"),
      minute: values.get("minute"),
      second: values.get("second"),
    };
    if (Object.values(result).some((part) => !Number.isInteger(part))) {
      throw new Error("invalid calendar part");
    }
    return result as {
      year: number;
      month: number;
      day: number;
      hour: number;
      minute: number;
      second: number;
    };
  } catch {
    throw routeError(
      "CUSTOM_RULE_DATA_NOT_READY",
      "Project business timezone cannot resolve the selection period",
      422,
    );
  }
}

function calendarUtcEpoch(input: {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}): number {
  const date = new Date(0);
  date.setUTCFullYear(input.year, input.month - 1, input.day);
  date.setUTCHours(input.hour, input.minute, input.second, 0);
  return date.getTime();
}

function assertApprovedReportSnapshots(reports: ApprovedReportRow[]): void {
  if (
    reports.some(
      (report) =>
        report.status !== "approved" ||
        report.settlement_duration === null ||
        report.time_source === null ||
        report.evidence_level === null,
    )
  ) {
    throw routeError(
      "CUSTOM_RULE_EVIDENCE_INVALID",
      "Approved report evidence violates the immutable snapshot invariant",
      500,
      true,
    );
  }
}

function canonicalOffsetDateTimeEpoch(value: unknown): number | null {
  const parsed = canonicalOffsetDateTimeSchema.safeParse(value);
  if (!parsed.success) return null;
  const epoch = Date.parse(parsed.data);
  return Number.isFinite(epoch) ? epoch : null;
}

async function readCustomSettlementEvidenceSnapshot(
  client: SupabaseClient,
  input: EvidenceSnapshotExpectation,
  now: () => Date,
): Promise<EvidenceSnapshot> {
  const { data, error } = await client.rpc(
    "read_custom_settlement_evidence_snapshot",
    {
      p_organization_id: input.organizationId,
      p_project_id: input.projectId,
      p_scope: input.scope,
      p_period_start: input.periodStart,
      p_period_end: input.periodEnd,
      p_business_timezone: input.businessTimezone,
      p_business_timezone_source: input.businessTimezoneSource,
      p_execution_grain: input.executionGrain,
      p_max_sources: MAX_AUTHORIZED_SOURCE_REPORTS,
      p_max_record_count: MAX_AUTHORIZED_SIMULATION_RECORDS,
    },
  );
  if (error) {
    const text = safeRpcErrorText(error);
    if (text.includes("snapshot_source_limit_exceeded")) {
      throw routeError(
        "CUSTOM_RULE_SELECTION_TOO_LARGE",
        "Authorized simulation selection has too many sources",
        422,
      );
    }
    if (text.includes("snapshot_record_limit_exceeded")) {
      throw routeError(
        "CUSTOM_RULE_SELECTION_TOO_LARGE",
        "Authorized simulation selection has too many execution records",
        422,
      );
    }
    if (
      text.includes("snapshot_access_denied") ||
      text.includes("snapshot_project_scope_mismatch")
    ) {
      throw routeError(
        "CUSTOM_RULE_PROJECT_ACCESS_DENIED",
        "Project access denied",
        403,
      );
    }
    throw routeError(
      "CUSTOM_RULE_STORAGE_UNAVAILABLE",
      "Settlement rule evidence storage is unavailable",
      503,
      true,
    );
  }
  if (
    data &&
    typeof data === "object" &&
    Number.isInteger(Reflect.get(data, "source_count")) &&
    Number(Reflect.get(data, "source_count")) > MAX_AUTHORIZED_SOURCE_REPORTS
  ) {
    throw routeError(
      "CUSTOM_RULE_SELECTION_TOO_LARGE",
      "Authorized simulation selection has too many sources",
      422,
    );
  }
  if (
    data &&
    typeof data === "object" &&
    Number.isInteger(Reflect.get(data, "record_count")) &&
    Number(Reflect.get(data, "record_count")) >
      MAX_AUTHORIZED_SIMULATION_RECORDS
  ) {
    throw routeError(
      "CUSTOM_RULE_SELECTION_TOO_LARGE",
      "Authorized simulation selection has too many execution records",
      422,
    );
  }
  return parseCustomSettlementEvidenceSnapshot(data, input, now);
}

export function parseCustomSettlementEvidenceSnapshot(
  data: unknown,
  expected: EvidenceSnapshotExpectation,
  now: () => Date,
): EvidenceSnapshot {
  const parsed = evidenceSnapshotSchema.safeParse(data);
  if (!parsed.success) {
    throw routeError(
      "CUSTOM_RULE_EVIDENCE_INVALID",
      "Settlement rule evidence snapshot is invalid",
      500,
      true,
    );
  }
  const snapshot = parsed.data;
  validateEvidenceSnapshot(snapshot, expected, now);
  return snapshot;
}

function validateEvidenceSnapshot(
  snapshot: EvidenceSnapshot,
  expected: EvidenceSnapshotExpectation,
  now: () => Date,
): void {
  const capturedAt = canonicalOffsetDateTimeEpoch(snapshot.captured_at);
  const nowEpoch = now().getTime();
  const periodStart = canonicalOffsetDateTimeEpoch(
    expected.periodStartInclusive,
  );
  const periodEnd = canonicalOffsetDateTimeEpoch(expected.periodEndExclusive);
  const countedSources = {
    settlement_batches: snapshot.settlement_batches.length,
    settlement_batch_items: snapshot.settlement_batch_items.length,
    live_reports: snapshot.live_reports.length,
    live_tasks: new Set(
      snapshot.live_reports.map((report) => report.live_task_id),
    ).size,
    project_cost_items: snapshot.project_cost_items.length,
    project_streamers: snapshot.project_streamers.length,
    streamers: snapshot.streamers.length,
  };
  const totalCountedSources = Object.values(countedSources).reduce(
    (total, count) => total + count,
    0,
  );
  const requestedBatches = snapshot.settlement_batches.filter(
    (batch) => batch.batch_type === expected.scope,
  );
  const requestedBatchIds = new Set(requestedBatches.map((batch) => batch.id));
  const requestedItems = snapshot.settlement_batch_items.filter((item) =>
    requestedBatchIds.has(item.settlement_batch_id),
  );
  const requestedReportIds = new Set(
    requestedItems.flatMap((item) =>
      item.live_report_id === null ? [] : [item.live_report_id],
    ),
  );
  const effectiveReports = requestedBatches.length
    ? snapshot.live_reports.filter((report) =>
        requestedReportIds.has(report.id),
      )
    : snapshot.live_reports.filter((report) => {
        const reviewedAt = canonicalOffsetDateTimeEpoch(report.reviewed_at);
        return (
          reviewedAt !== null &&
          periodStart !== null &&
          periodEnd !== null &&
          reviewedAt >= periodStart &&
          reviewedAt < periodEnd
        );
      });
  const expectedRecordCount = prospectiveAuthorizedRecordCount({
    executionGrain: expected.executionGrain,
    reports: effectiveReports,
    batches: requestedBatches,
    items: requestedItems,
  });
  if (
    snapshot.organization_id !== expected.organizationId ||
    snapshot.project_id !== expected.projectId ||
    snapshot.actor_id !== expected.actorId ||
    snapshot.scope !== expected.scope ||
    snapshot.period_start !== expected.periodStart ||
    snapshot.period_end !== expected.periodEnd ||
    snapshot.business_timezone !== expected.businessTimezone ||
    snapshot.business_timezone_source !== expected.businessTimezoneSource ||
    !snapshot.business_timezone_confirmed ||
    snapshot.project.id !== expected.projectId ||
    snapshot.project.organization_id !== expected.organizationId ||
    snapshot.project.business_timezone !== expected.businessTimezone ||
    snapshot.project.business_timezone_source !==
      expected.businessTimezoneSource ||
    !snapshot.project.business_timezone_confirmed ||
    capturedAt === null ||
    periodStart === null ||
    periodEnd === null ||
    periodEnd <= periodStart ||
    !Number.isFinite(nowEpoch) ||
    capturedAt < nowEpoch - SNAPSHOT_MAX_AGE_MS ||
    capturedAt > nowEpoch + SNAPSHOT_MAX_FUTURE_SKEW_MS ||
    snapshot.source_count !== totalCountedSources ||
    snapshot.source_counts.total !== totalCountedSources ||
    Object.entries(countedSources).some(
      ([source, count]) =>
        snapshot.source_counts[
          source as keyof typeof countedSources
        ] !== count,
    ) ||
    snapshot.record_count !== expectedRecordCount
  ) {
    throw routeError(
      "CUSTOM_RULE_EVIDENCE_INVALID",
      "Settlement rule evidence snapshot metadata is invalid",
      500,
      true,
    );
  }

  assertUniqueSnapshotRows(snapshot.settlement_batches, "batches");
  assertUniqueSnapshotRows(snapshot.settlement_batch_items, "items");
  assertUniqueSnapshotRows(snapshot.live_reports, "reports");
  assertUniqueSnapshotRows(snapshot.project_cost_items, "costs");
  assertUniqueSnapshotRows(snapshot.project_streamers, "project streamers");
  assertUniqueSnapshotRows(snapshot.streamers, "streamers");
  assertRowsInScope(
    snapshot.settlement_batches,
    expected.organizationId,
    expected.projectId,
  );
  assertRowsInScope(
    snapshot.settlement_batch_items,
    expected.organizationId,
    expected.projectId,
  );
  assertRowsInScope(
    snapshot.live_reports,
    expected.organizationId,
    expected.projectId,
  );
  assertRowsInScope(
    snapshot.project_cost_items,
    expected.organizationId,
    expected.projectId,
  );
  assertRowsInScope(
    snapshot.project_streamers,
    expected.organizationId,
    expected.projectId,
  );
  if (
    snapshot.streamers.some(
      (streamer) => streamer.organization_id !== expected.organizationId,
    )
  ) {
    throw routeError(
      "CUSTOM_RULE_EVIDENCE_INVALID",
      "Settlement rule evidence snapshot streamer scope is invalid",
      500,
      true,
    );
  }

  const batchesById = new Map(
    snapshot.settlement_batches.map((batch) => [batch.id, batch]),
  );
  for (const batch of snapshot.settlement_batches) {
    if (
      batch.period_start > expected.periodEnd ||
      batch.period_end < expected.periodStart ||
      batch.locked_at === null
    ) {
      throw routeError(
        "CUSTOM_RULE_EVIDENCE_INVALID",
        "Locked settlement batch is outside the authorized snapshot",
        500,
        true,
      );
    }
  }
  for (const item of snapshot.settlement_batch_items) {
    const batch = batchesById.get(item.settlement_batch_id);
    const relation = oneRelation(item.settlement_batches);
    if (
      !batch ||
      !relation ||
      relation.id !== batch.id ||
      relation.status !== batch.status ||
      relation.batch_type !== batch.batch_type ||
      relation.locked_at !== batch.locked_at ||
      relation.period_start !== batch.period_start ||
      relation.period_end !== batch.period_end ||
      relation.version !== batch.version
    ) {
      throw routeError(
        "CUSTOM_RULE_EVIDENCE_INVALID",
        "Settlement item snapshot is fractured from its locked batch",
        500,
        true,
      );
    }
  }

  assertApprovedReportSnapshots(snapshot.live_reports);
  for (const report of snapshot.live_reports) {
    if (canonicalOffsetDateTimeEpoch(report.reviewed_at) === null) {
      throw routeError(
        "CUSTOM_RULE_EVIDENCE_INVALID",
        "Approved report snapshot timestamp is invalid",
        500,
        true,
      );
    }
  }
  const reportIds = new Set(snapshot.live_reports.map((report) => report.id));
  const batchIds = new Set(
    snapshot.settlement_batches.map((batch) => batch.id),
  );
  for (const cost of snapshot.project_cost_items) {
    const linkedReportValid =
      cost.live_report_id === null || reportIds.has(cost.live_report_id);
    const linkedBatchValid =
      cost.settlement_batch_id === null ||
      batchIds.has(cost.settlement_batch_id);
    const createdAt = canonicalOffsetDateTimeEpoch(cost.created_at);
    const unlinkedInPeriod =
      cost.live_report_id !== null ||
      cost.settlement_batch_id !== null ||
      (createdAt !== null && createdAt >= periodStart && createdAt < periodEnd);
    if (!linkedReportValid || !linkedBatchValid || !unlinkedInPeriod) {
      throw routeError(
        "CUSTOM_RULE_EVIDENCE_INVALID",
        "Confirmed cost snapshot is outside the authorized selection",
        500,
        true,
      );
    }
  }
}

function assertUniqueSnapshotRows(
  rows: ReadonlyArray<{ id: string }>,
  source: string,
): void {
  const ids = rows.map((row) => row.id);
  if (new Set(ids).size !== ids.length) {
    throw routeError(
      "CUSTOM_RULE_EVIDENCE_INVALID",
      `Settlement rule evidence snapshot contains duplicate ${source}`,
      500,
      true,
    );
  }
}

function selectApprovedReportsWithinPeriod(
  reports: ApprovedReportRow[],
  input: {
    periodStartInclusive: string;
    periodEndExclusive: string;
    allowedOutOfWindowReportIds: ReadonlySet<string>;
  },
): ApprovedReportRow[] {
  const startEpoch = canonicalOffsetDateTimeEpoch(input.periodStartInclusive);
  const endEpoch = canonicalOffsetDateTimeEpoch(input.periodEndExclusive);
  if (startEpoch === null || endEpoch === null || endEpoch <= startEpoch) {
    throw routeError(
      "CUSTOM_RULE_EVIDENCE_INVALID",
      "Approved report review period is invalid",
      500,
      true,
    );
  }
  return reports
    .filter((report) => {
      const reviewedAt = canonicalOffsetDateTimeEpoch(report.reviewed_at);
      if (reviewedAt === null) {
        throw routeError(
          "CUSTOM_RULE_EVIDENCE_INVALID",
          "Approved report snapshot timestamp is invalid",
          500,
          true,
        );
      }
      const inPeriod = reviewedAt >= startEpoch && reviewedAt < endEpoch;
      if (!inPeriod && !input.allowedOutOfWindowReportIds.has(report.id)) {
        throw routeError(
          "CUSTOM_RULE_EVIDENCE_INVALID",
          "Approved report snapshot is outside the authorized review period",
          500,
          true,
        );
      }
      return inPeriod;
    })
    .sort((left, right) => left.id.localeCompare(right.id));
}

function deriveCurrentMargin(input: {
  scope: CustomRuleScope;
  executionGrain: CustomRuleDraft["businessContract"]["executionGrain"];
  reports: ApprovedReportRow[];
  requestedBatches: SettlementBatchRow[];
  pairedBatches: SettlementBatchRow[];
  requestedItems: SettlementItemRow[];
  pairedItems: SettlementItemRow[];
  itemsByReport: Map<string, SettlementItemRow>;
  pairedItemsByReport: Map<string, SettlementItemRow>;
  costs: ProjectCostRow[];
  pairedComplete: boolean;
}): {
  amount: bigint | null;
  status: "available" | "unavailable" | "not_applicable";
} {
  if (input.scope !== "payable" && input.scope !== "receivable") {
    return { amount: null, status: "not_applicable" };
  }
  if (input.requestedItems.length === 0) {
    return {
      amount: null,
      status: input.reports.length === 0 ? "not_applicable" : "unavailable",
    };
  }
  const reportPairingRequired =
    input.executionGrain === "report" ||
    input.executionGrain === "project_streamer_period";
  const selectedReportIds = new Set(input.reports.map((report) => report.id));
  const costsAreAllocatable =
    !reportPairingRequired ||
    input.costs.every(
      (cost) =>
        cost.live_report_id !== null &&
        selectedReportIds.has(cost.live_report_id),
    );
  if (
    !input.pairedComplete ||
    (reportPairingRequired &&
      input.reports.some(
        (report) =>
          !input.itemsByReport.has(report.id) ||
          !input.pairedItemsByReport.has(report.id),
      )) ||
    !costsAreAllocatable ||
    input.costs.some((cost) => cost.direction === "adjustment")
  ) {
    return { amount: null, status: "unavailable" };
  }
  const aggregateGrain = input.executionGrain !== "report";
  const requested = aggregateGrain
    ? input.requestedItems
    : input.reports.map((report) => requiredItem(input.itemsByReport, report));
  const paired = aggregateGrain
    ? input.pairedItems
    : input.reports.map((report) =>
        requiredItem(input.pairedItemsByReport, report),
      );
  const payable = input.scope === "payable" ? requested : paired;
  const receivable = input.scope === "receivable" ? requested : paired;

  // Contribution margin for the authorized selection: receivable - payable - costs + offsets.
  let amount =
    sumSettlementItemsCents(receivable) - sumSettlementItemsCents(payable);
  for (const cost of input.costs) {
    const costAmount = bigintCents(cost.amount_cents);
    amount += cost.direction === "revenue_offset" ? costAmount : -costAmount;
  }
  return { amount, status: "available" };
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
    throw routeError(
      "CUSTOM_RULE_PROJECT_ACCESS_DENIED",
      "Project access denied",
      403,
    );
  }
}

function groupLockedItemsByReport(
  items: SettlementItemRow[],
  selectedReportIds?: string[],
): Map<string, SettlementItemRow> {
  const selected = selectedReportIds ? new Set(selectedReportIds) : null;
  const grouped = new Map<string, SettlementItemRow>();
  for (const item of items) {
    if (item.live_report_id === null) continue;
    if (selected && !selected.has(item.live_report_id)) {
      throw routeError(
        "CUSTOM_RULE_EVIDENCE_INVALID",
        "Locked settlement evidence references an unauthorized report",
        500,
        true,
      );
    }
    if (grouped.has(item.live_report_id)) {
      throw routeError(
        "CUSTOM_RULE_EVIDENCE_AMBIGUOUS",
        "Authorized report has multiple locked current-rule results",
        422,
      );
    }
    grouped.set(item.live_report_id, item);
  }
  return grouped;
}

function historicalAttributionComplete(input: {
  executionGrain: CustomRuleDraft["businessContract"]["executionGrain"];
  batches: SettlementBatchRow[];
  items: SettlementItemRow[];
  reports: ApprovedReportRow[];
  itemsByReport: Map<string, SettlementItemRow>;
}): boolean {
  if (input.batches.length === 0 || input.items.length === 0) return false;
  const reportIds = new Set(input.reports.map((report) => report.id));
  if (
    input.reports.some((report) => !input.itemsByReport.has(report.id)) ||
    input.items.some(
      (item) =>
        item.live_report_id !== null && !reportIds.has(item.live_report_id),
    )
  ) {
    return false;
  }
  const manualItems = input.items.filter(
    (item) => item.live_report_id === null,
  );
  if (input.executionGrain === "report") return manualItems.length === 0;
  if (input.executionGrain === "project_streamer_period") {
    return manualItems.every((item) => item.streamer_id !== null);
  }
  return true;
}

function pairedScopeComplete(input: {
  executionGrain: CustomRuleDraft["businessContract"]["executionGrain"];
  requestedBatches: SettlementBatchRow[];
  requestedItems: SettlementItemRow[];
  pairedBatches: SettlementBatchRow[];
  pairedItems: SettlementItemRow[];
  reports: ApprovedReportRow[];
  requestedItemsByReport: Map<string, SettlementItemRow>;
  pairedItemsByReport: Map<string, SettlementItemRow>;
}): boolean {
  if (
    input.requestedItems.length === 0 ||
    input.pairedItems.length === 0 ||
    !sameBatchPeriodPopulation(input.requestedBatches, input.pairedBatches)
  ) {
    return false;
  }
  if (
    input.executionGrain === "batch" ||
    input.executionGrain === "project_period"
  ) {
    return true;
  }
  const requestedReportIds = input.requestedItems.flatMap((item) =>
    item.live_report_id ? [item.live_report_id] : [],
  );
  const pairedReportIds = input.pairedItems.flatMap((item) =>
    item.live_report_id ? [item.live_report_id] : [],
  );
  if (
    !(
      (requestedReportIds.length === 0 && pairedReportIds.length === 0) ||
      sameStringPopulation(requestedReportIds, pairedReportIds)
    )
  ) {
    return false;
  }
  if (
    input.reports.some(
      (report) =>
        !input.requestedItemsByReport.has(report.id) ||
        !input.pairedItemsByReport.has(report.id),
    )
  ) {
    return false;
  }
  const requestedManual = input.requestedItems.filter(
    (item) => item.live_report_id === null,
  );
  const pairedManual = input.pairedItems.filter(
    (item) => item.live_report_id === null,
  );
  if (input.executionGrain === "report") {
    return requestedManual.length === 0 && pairedManual.length === 0;
  }
  return (
    requestedManual.every((item) => item.streamer_id !== null) &&
    pairedManual.every((item) => item.streamer_id !== null) &&
    ((requestedManual.length === 0 && pairedManual.length === 0) ||
      sameStringPopulation(
        requestedManual.flatMap((item) =>
          item.streamer_id ? [item.streamer_id] : [],
        ),
        pairedManual.flatMap((item) =>
          item.streamer_id ? [item.streamer_id] : [],
        ),
      ))
  );
}

function sameBatchPeriodPopulation(
  requested: SettlementBatchRow[],
  paired: SettlementBatchRow[],
): boolean {
  return sameStringPopulation(
    requested.map((batch) => `${batch.period_start}:${batch.period_end}`),
    paired.map((batch) => `${batch.period_start}:${batch.period_end}`),
  );
}

function sameStringPopulation(left: string[], right: string[]): boolean {
  const sortedLeft = [...new Set(left)].sort();
  const sortedRight = [...new Set(right)].sort();
  return (
    sortedLeft.length > 0 &&
    sortedLeft.length === sortedRight.length &&
    sortedLeft.every((value, index) => value === sortedRight[index])
  );
}

function prospectiveAuthorizedRecordCount(input: {
  executionGrain: CustomRuleDraft["businessContract"]["executionGrain"];
  reports: ApprovedReportRow[];
  batches: SettlementBatchRow[];
  items: SettlementItemRow[];
}): number {
  if (input.executionGrain === "report") return input.reports.length;
  if (input.executionGrain === "project_streamer_period") {
    return new Set([
      ...input.reports.map((report) => report.streamer_id),
      ...input.items.flatMap((item) =>
        item.live_report_id === null && item.streamer_id !== null
          ? [item.streamer_id]
          : [],
      ),
    ]).size;
  }
  if (input.executionGrain === "batch") {
    if (input.batches.length === 0) return input.reports.length;
    const batchIdsWithItems = new Set(
      input.items.map((item) => item.settlement_batch_id),
    );
    return input.batches.filter((batch) => batchIdsWithItems.has(batch.id))
      .length;
  }
  if (input.executionGrain === "project_period") {
    return input.reports.length > 0 || input.items.length > 0 ? 1 : 0;
  }
  return 0;
}

function buildAuthorizedSimulationRecords(input: {
  organizationId: string;
  projectId: string;
  contract: CustomRuleDraft["businessContract"];
  selection: AuthorizeCustomRuleSelectionInput["selection"];
  reports: ApprovedReportRow[];
  batches: SettlementBatchRow[];
  items: SettlementItemRow[];
  itemsByReport: Map<string, SettlementItemRow>;
  costs: ProjectCostRow[];
  streamersById: Map<string, ProjectStreamerRow>;
  historicalComplete: boolean;
  periodBoundaries: ReturnType<typeof businessPeriodBoundaries>;
}): AuthorizedSimulationRecord[] {
  if (input.contract.executionGrain === "report") {
    return input.reports.map((report) => {
      const item = input.itemsByReport.get(report.id) ?? null;
      const streamer = input.streamersById.get(report.streamer_id) ?? null;
      const reportCosts = input.costs
        .filter((cost) => cost.live_report_id === report.id)
        .sort((left, right) => left.id.localeCompare(right.id));
      const variables = reportVariables(
        report,
        streamer,
        input.contract.businessTimezone,
      );
      if (input.contract.scope === "external_cost") {
        addExternalCostVariables(variables, report, reportCosts);
      }
      return {
        recordId: report.id,
        projectId: input.projectId,
        sourceVersion: {
          kind: "immutable",
          source: "locked_settlement_report",
          version: reportSnapshotVersion(report, item, streamer, reportCosts),
        },
        variables,
        missingInputs: [],
        currentRuleResult:
          input.historicalComplete && item
            ? {
                unitSource: "current_rule_cents",
                amountCents: settlementItemTotalCents(item),
              }
            : null,
      };
    });
  }
  if (input.contract.executionGrain === "project_streamer_period") {
    const grouped = groupReports(input.reports, (report) => report.streamer_id);
    const manualByStreamer = new Map<string, SettlementItemRow[]>();
    for (const item of input.items) {
      if (item.live_report_id !== null || item.streamer_id === null) continue;
      const group = manualByStreamer.get(item.streamer_id) ?? [];
      group.push(item);
      manualByStreamer.set(item.streamer_id, group);
    }
    const streamerIds = [
      ...new Set([...grouped.keys(), ...manualByStreamer.keys()]),
    ].sort((left, right) => left.localeCompare(right));
    return streamerIds.map((streamerId) => {
      const reports = grouped.get(streamerId) ?? [];
      const streamer = input.streamersById.get(streamerId) ?? null;
      const linkedItems = reports.flatMap((report) => {
        const item = input.itemsByReport.get(report.id);
        return item ? [item] : [];
      });
      const groupItems = [
        ...linkedItems,
        ...(manualByStreamer.get(streamerId) ?? []),
      ].sort((left, right) => left.id.localeCompare(right.id));
      const currentAmount = input.historicalComplete
        ? sumSettlementItemsCents(groupItems)
        : null;
      const periodComputedAmount = input.historicalComplete
        ? sumSettlementComputedCents(groupItems)
        : null;
      const variables = periodAggregateVariables({
        projectId: input.projectId,
        scope: input.contract.scope,
        selection: input.selection,
        reports,
        periodComputedAmount,
        periodBoundaries: input.periodBoundaries,
      });
      variables.streamer_id = { type: "string", value: streamerId };
      addProjectStreamerVariables(variables, streamer);
      return periodAggregateRecord({
        recordId: `project_streamer_period:${streamerId}:${input.selection.periodStart}:${input.selection.periodEnd}`,
        projectId: input.projectId,
        source: "locked_settlement_project_streamer_period",
        reports,
        items: groupItems,
        batches: batchesForItems(input.batches, groupItems),
        itemsByReport: input.itemsByReport,
        streamersById: input.streamersById,
        variables,
        currentAmount,
      });
    });
  }
  if (input.contract.executionGrain === "batch") {
    if (input.batches.length > 0) {
      const reportsById = new Map(
        input.reports.map((report) => [report.id, report]),
      );
      const itemsByBatch = groupItemsByBatch(input.items);
      return input.batches
        .filter((batch) => (itemsByBatch.get(batch.id)?.length ?? 0) > 0)
        .sort((left, right) => left.id.localeCompare(right.id))
        .map((batch) => {
          const groupItems = itemsByBatch.get(batch.id) ?? [];
          const reports = groupItems.flatMap((item) => {
            const report = item.live_report_id
              ? reportsById.get(item.live_report_id)
              : null;
            return report ? [report] : [];
          });
          const currentAmount = input.historicalComplete
            ? sumSettlementItemsCents(groupItems)
            : null;
          const periodComputedAmount = input.historicalComplete
            ? sumSettlementComputedCents(groupItems)
            : null;
          return periodAggregateRecord({
            recordId: `batch:${batch.id}`,
            projectId: input.projectId,
            source: "locked_settlement_batch",
            reports,
            items: groupItems,
            batches: [batch],
            itemsByReport: input.itemsByReport,
            streamersById: input.streamersById,
            variables: periodAggregateVariables({
              projectId: input.projectId,
              scope: input.contract.scope,
              selection: input.selection,
              reports,
              periodComputedAmount,
              periodBoundaries: input.periodBoundaries,
            }),
            currentAmount,
          });
        });
    }
    const grouped = groupReports(input.reports, (report) => {
      const item = input.itemsByReport.get(report.id) ?? null;
      const batch = item ? oneRelation(item.settlement_batches) : null;
      return batch ? batch.id : `unmatched:${report.id}`;
    });
    return [...grouped.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([batchKey, reports]) => {
        const groupItems = input.historicalComplete
          ? reports.map((report) => requiredItem(input.itemsByReport, report))
          : [];
        const currentAmount = input.historicalComplete
          ? sumSettlementItemsCents(groupItems)
          : null;
        const periodComputedAmount = input.historicalComplete
          ? sumSettlementComputedCents(groupItems)
          : null;
        return periodAggregateRecord({
          recordId: `batch:${batchKey}`,
          projectId: input.projectId,
          source: "locked_settlement_batch",
          reports,
          items: groupItems,
          batches: [],
          itemsByReport: input.itemsByReport,
          streamersById: input.streamersById,
          variables: periodAggregateVariables({
            projectId: input.projectId,
            scope: input.contract.scope,
            selection: input.selection,
            reports,
            periodComputedAmount,
            periodBoundaries: input.periodBoundaries,
          }),
          currentAmount,
        });
      });
  }
  if (input.contract.executionGrain === "project_period") {
    if (input.reports.length === 0 && input.items.length === 0) return [];
    const currentAmount = input.historicalComplete
      ? sumSettlementItemsCents(input.items)
      : null;
    const periodComputedAmount = input.historicalComplete
      ? sumSettlementComputedCents(input.items)
      : null;
    return [
      periodAggregateRecord({
        recordId: `project_period:${input.projectId}:${input.selection.periodStart}:${input.selection.periodEnd}`,
        projectId: input.projectId,
        source: "locked_settlement_project_period",
        reports: input.reports,
        items: input.items,
        batches: input.batches,
        itemsByReport: input.itemsByReport,
        streamersById: input.streamersById,
        variables: periodAggregateVariables({
          projectId: input.projectId,
          scope: input.contract.scope,
          selection: input.selection,
          reports: input.reports,
          periodComputedAmount,
          periodBoundaries: input.periodBoundaries,
        }),
        currentAmount,
      }),
    ];
  }
  throw routeError(
    "CUSTOM_RULE_SELECTION_UNSUPPORTED",
    "Historical simulation is unsupported for this execution grain",
    422,
  );
}

function groupReports(
  reports: ApprovedReportRow[],
  keyFor: (report: ApprovedReportRow) => string,
): Map<string, ApprovedReportRow[]> {
  const grouped = new Map<string, ApprovedReportRow[]>();
  for (const report of reports) {
    const key = keyFor(report);
    const group = grouped.get(key) ?? [];
    group.push(report);
    grouped.set(key, group);
  }
  return grouped;
}

function groupItemsByBatch(
  items: SettlementItemRow[],
): Map<string, SettlementItemRow[]> {
  const grouped = new Map<string, SettlementItemRow[]>();
  for (const item of items) {
    const group = grouped.get(item.settlement_batch_id) ?? [];
    group.push(item);
    grouped.set(item.settlement_batch_id, group);
  }
  for (const group of grouped.values()) {
    group.sort((left, right) => left.id.localeCompare(right.id));
  }
  return grouped;
}

function batchesForItems(
  batches: SettlementBatchRow[],
  items: SettlementItemRow[],
): SettlementBatchRow[] {
  const selected = new Set(items.map((item) => item.settlement_batch_id));
  return batches
    .filter((batch) => selected.has(batch.id))
    .sort((left, right) => left.id.localeCompare(right.id));
}

function requiredItem(
  itemsByReport: Map<string, SettlementItemRow>,
  report: ApprovedReportRow,
): SettlementItemRow {
  const item = itemsByReport.get(report.id);
  if (!item) {
    throw routeError(
      "CUSTOM_RULE_EVIDENCE_UNAVAILABLE",
      "Locked settlement evidence is unavailable",
      422,
    );
  }
  return item;
}

function periodAggregateRecord(input: {
  recordId: string;
  projectId: string;
  source: string;
  reports: ApprovedReportRow[];
  items: SettlementItemRow[];
  batches: SettlementBatchRow[];
  itemsByReport: Map<string, SettlementItemRow>;
  streamersById: Map<string, ProjectStreamerRow>;
  variables: Record<string, TypedRuntimeValue>;
  currentAmount: bigint | null;
}): AuthorizedSimulationRecord {
  const sourceVersions = input.reports.map((report) =>
    reportSnapshotVersion(
      report,
      input.itemsByReport.get(report.id) ?? null,
      input.streamersById.get(report.streamer_id) ?? null,
    ),
  );
  const itemVersions = [...input.items]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((item) => sha256(JSON.stringify(item)));
  const batchVersions = [...input.batches]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((batch) => sha256(JSON.stringify(batch)));
  const runtimePeriodBoundaries = {
    periodStart: input.variables.period_start ?? null,
    periodEnd: input.variables.period_end ?? null,
  };
  return {
    recordId: input.recordId,
    projectId: input.projectId,
    sourceVersion: {
      kind: "immutable",
      source: input.source,
      version: sha256(
        JSON.stringify({
          sourceVersions,
          itemVersions,
          batchVersions,
          runtimePeriodBoundaries,
        }),
      ),
    },
    variables: input.variables,
    missingInputs: [],
    currentRuleResult:
      input.currentAmount === null
        ? null
        : {
            unitSource: "current_rule_cents",
            amountCents: String(input.currentAmount),
          },
  };
}

function applyInputRequirementsToEvidence(
  evidence: AuthorizedCustomRuleSimulationEvidence,
  inputs: readonly CustomRuleInputRequirement[],
): AuthorizedCustomRuleSimulationEvidence {
  if (inputs.length === 0) return evidence;

  const requiredVariables = new Set(
    inputs.flatMap((requirement) =>
      requirement.required ? [requirement.variableId] : [],
    ),
  );
  assertRequiredRecordVariables(evidence.records, requiredVariables);

  const optionalPolicies = new Map<string, CustomRuleMissingDataPolicy>();
  for (const requirement of inputs) {
    if (
      !requirement.required &&
      requirement.missingDataPolicy &&
      !requiredVariables.has(requirement.variableId)
    ) {
      optionalPolicies.set(
        requirement.variableId,
        requirement.missingDataPolicy,
      );
    }
  }
  const records = evidence.records.map((record) => {
    const missingByVariable = new Map<string, CustomRuleMissingDataPolicy>();
    for (const missing of record.missingInputs) {
      if (!Object.hasOwn(record.variables, missing.variableId)) {
        missingByVariable.set(missing.variableId, missing.policy);
      }
    }
    for (const [variableId, policy] of optionalPolicies) {
      if (!Object.hasOwn(record.variables, variableId)) {
        missingByVariable.set(variableId, policy);
      }
    }
    return {
      ...record,
      missingInputs: [...missingByVariable]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([variableId, policy]) => ({ variableId, policy })),
    };
  });
  const mapped: AuthorizedCustomRuleSimulationEvidence = {
    ...evidence,
    provenance: {
      ...evidence.provenance,
      evidenceHash: "0".repeat(64),
      optionalPolicyHash: calculateCustomRuleOptionalPolicyHash(inputs),
    },
    records,
  };
  mapped.provenance.evidenceHash = calculateCustomRuleEvidenceHash(mapped);
  return freezeAuthorizedCustomRuleSimulationEvidence(mapped);
}

function assertRequiredRecordVariables(
  records: AuthorizedSimulationRecord[],
  requiredVariables: Set<string>,
): void {
  for (const record of records) {
    for (const variableId of requiredVariables) {
      if (!Object.prototype.hasOwnProperty.call(record.variables, variableId)) {
        throw new CustomRuleRouteError({
          code: "CUSTOM_RULE_EVIDENCE_FIELD_UNAVAILABLE",
          message: `Authorized historical evidence is missing required field: ${variableId}`,
          status: 422,
          retryable: false,
          path: ["businessContract", "requiredInputs", variableId],
        });
      }
    }
  }
}

function periodAggregateVariables(input: {
  projectId: string;
  scope: CustomRuleDraft["businessContract"]["scope"];
  selection: AuthorizeCustomRuleSelectionInput["selection"];
  reports: ApprovedReportRow[];
  periodComputedAmount: bigint | null;
  periodBoundaries: ReturnType<typeof businessPeriodBoundaries>;
}): Record<string, TypedRuntimeValue> {
  const variables: Record<string, TypedRuntimeValue> = {
    project_id: { type: "string", value: input.projectId },
    period_start: {
      type: "timestamp",
      value: input.periodBoundaries.runtimeStartInclusive,
    },
    period_end: {
      type: "timestamp",
      value: input.periodBoundaries.runtimeEndInclusive,
    },
    period_report_count: { type: "integer", value: input.reports.length },
  };
  addCompleteIntegerSum(
    variables,
    "period_system_minutes",
    input.reports.map((report) => report.system_duration),
  );
  addCompleteIntegerSum(
    variables,
    "period_settlement_minutes",
    input.reports.map((report) => report.settlement_duration),
  );
  if (input.reports.every((report) => report.evidence_level !== null)) {
    variables.red_evidence_count = {
      type: "integer",
      value: input.reports.filter((report) => report.evidence_level === "red")
        .length,
    };
    variables.yellow_evidence_count = {
      type: "integer",
      value: input.reports.filter(
        (report) => report.evidence_level === "yellow",
      ).length,
    };
  }
  if (input.periodComputedAmount !== null) {
    const variableId =
      input.scope === "payable"
        ? "period_payable_amount"
        : input.scope === "receivable"
          ? "period_receivable_amount"
          : null;
    if (variableId) {
      variables[variableId] = {
        type: "money_cents",
        amountCents: bigintAsSafeNumber(input.periodComputedAmount),
      };
    }
  }
  return variables;
}

function addCompleteIntegerSum(
  variables: Record<string, TypedRuntimeValue>,
  variableId: string,
  values: Array<number | null>,
): void {
  let total = 0;
  for (const value of values) {
    if (value === null) return;
    total += value;
  }
  if (!Number.isSafeInteger(total)) {
    throw routeError(
      "CUSTOM_RULE_EVIDENCE_INVALID",
      "Settlement rule evidence aggregate is out of range",
      500,
      true,
    );
  }
  variables[variableId] = { type: "integer", value: total };
}

function sumSettlementItemsCents(items: SettlementItemRow[]): bigint {
  return items.reduce(
    (sum, item) => sum + BigInt(settlementItemTotalCents(item)),
    BigInt(0),
  );
}

function sumSettlementComputedCents(items: SettlementItemRow[]): bigint {
  return items.reduce(
    (sum, item) => sum + decimalYuanToCents(item.computed_amount),
    BigInt(0),
  );
}

function bigintAsSafeNumber(value: bigint): number {
  const numeric = Number(value);
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
  addProjectStreamerVariables(variables, streamer);
  return variables;
}

function addProjectStreamerVariables(
  variables: Record<string, TypedRuntimeValue>,
  streamer: ProjectStreamerRow | null,
): void {
  if (!streamer) return;
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

function addExternalCostVariables(
  variables: Record<string, TypedRuntimeValue>,
  report: ApprovedReportRow,
  costs: ProjectCostRow[],
): void {
  variables.report_id = { type: "string", value: report.id };
  addCostTypeAmountVariable(variables, "gift_amount", costs, "gift");
  addCostTypeAmountVariable(
    variables,
    "supplier_fee",
    costs,
    "supplier_fee",
  );
  addCostTypeAmountVariable(variables, "traffic_cost", costs, "traffic");
  const salesAmount = sumPayloadMoneyCents(costs, "sales_amount_cents");
  if (salesAmount !== null) {
    variables.sales_amount = {
      type: "money_cents",
      amountCents: bigintAsSafeNumber(salesAmount),
    };
  }
  const orderCount = sumPayloadInteger(costs, "order_count");
  if (orderCount !== null) {
    variables.order_count = { type: "integer", value: orderCount };
  }
  const rowIndex = firstPayloadInteger(costs, "row_index");
  if (rowIndex !== null) {
    variables.import_row_index = { type: "integer", value: rowIndex };
  }
  const importType = firstCostString(costs, "import_type");
  if (importType !== null) {
    variables.import_type = { type: "string", value: importType };
  }
  const supplierId = firstCostString(costs, "supplier_organization_id");
  if (supplierId !== null) {
    variables.supplier_id = { type: "string", value: supplierId };
  }
}

function addCostTypeAmountVariable(
  variables: Record<string, TypedRuntimeValue>,
  variableId: "gift_amount" | "supplier_fee" | "traffic_cost",
  costs: ProjectCostRow[],
  itemType: string,
): void {
  const matching = costs.filter((cost) => cost.item_type === itemType);
  if (matching.length === 0) return;
  const total = matching.reduce(
    (sum, cost) => sum + BigInt(cost.amount_cents),
    BigInt(0),
  );
  variables[variableId] = {
    type: "money_cents",
    amountCents: bigintAsSafeNumber(total),
  };
}

function sumPayloadMoneyCents(
  costs: ProjectCostRow[],
  key: "sales_amount_cents",
): bigint | null {
  let total = BigInt(0);
  let found = false;
  for (const cost of costs) {
    const value = payloadValue(cost, key);
    const amount = integerPayloadValue(value);
    if (amount === null) continue;
    found = true;
    total += BigInt(amount);
  }
  return found ? total : null;
}

function sumPayloadInteger(
  costs: ProjectCostRow[],
  key: "order_count",
): number | null {
  let total = 0;
  let found = false;
  for (const cost of costs) {
    const value = integerPayloadValue(payloadValue(cost, key));
    if (value === null) continue;
    found = true;
    total += value;
  }
  return found ? total : null;
}

function firstPayloadInteger(
  costs: ProjectCostRow[],
  key: "row_index",
): number | null {
  for (const cost of costs) {
    const value = integerPayloadValue(payloadValue(cost, key));
    if (value !== null) return value;
  }
  return null;
}

function firstCostString(
  costs: ProjectCostRow[],
  key: "import_type" | "supplier_organization_id",
): string | null {
  for (const cost of costs) {
    const value = cost[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return null;
}

function payloadValue(cost: ProjectCostRow, key: string): unknown {
  const payload = cost.source_payload;
  if (!payload || Array.isArray(payload) || typeof payload !== "object") {
    return null;
  }
  return Object.prototype.hasOwnProperty.call(payload, key)
    ? payload[key]
    : null;
}

function integerPayloadValue(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
  }
  if (typeof value === "string" && /^\d+$/u.test(value)) {
    const numeric = Number(value);
    return Number.isSafeInteger(numeric) ? numeric : null;
  }
  return null;
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
  costs: ProjectCostRow[] = [],
): string {
  const reportSnapshot = {
    id: report.id,
    organization_id: report.organization_id,
    project_id: report.project_id,
    streamer_id: report.streamer_id,
    status: report.status,
    system_duration: report.system_duration,
    screenshot_duration: report.screenshot_duration,
    settlement_duration: report.settlement_duration,
    evidence_level: report.evidence_level,
    time_source: report.time_source,
    viewers: report.viewers,
    reviewed_at: report.reviewed_at,
    created_at: report.created_at,
    live_tasks: report.live_tasks,
  };
  return sha256(
    JSON.stringify({
      report: reportSnapshot,
      item,
      streamer,
      costs: costs.map(costSnapshotVersion),
    }),
  );
}

function costSnapshotVersion(cost: ProjectCostRow): Record<string, unknown> {
  return {
    id: cost.id,
    organization_id: cost.organization_id,
    project_id: cost.project_id,
    streamer_id: cost.streamer_id,
    live_report_id: cost.live_report_id,
    settlement_batch_id: cost.settlement_batch_id,
    supplier_organization_id: cost.supplier_organization_id ?? null,
    item_type: cost.item_type ?? null,
    import_type: cost.import_type ?? null,
    source_payload: cost.source_payload ?? null,
    amount_cents: cost.amount_cents,
    direction: cost.direction,
    status: cost.status,
    created_at: cost.created_at,
  };
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

function bigintCents(value: string | number): bigint {
  const text = String(value);
  if (!/^-?\d+$/u.test(text)) {
    throw routeError(
      "CUSTOM_RULE_EVIDENCE_INVALID",
      "Settlement rule cost amount is invalid",
      500,
      true,
    );
  }
  return BigInt(text);
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

async function claimCustomSettlementAiSession(
  client: SupabaseClient,
  input: {
    organizationId: string;
    projectId: string;
    clientRequestId: string;
    requestFingerprint: string;
    title: string;
  },
) {
  const { data, error } = await client.rpc(
    "claim_custom_settlement_ai_session",
    {
      p_organization_id: input.organizationId,
      p_project_id: input.projectId,
      p_client_request_id: input.clientRequestId,
      p_title: input.title,
      p_request_fingerprint: input.requestFingerprint,
    },
  );
  if (error) {
    const text = safeRpcErrorText(error);
    if (
      text.includes("idempotency") ||
      text.includes("request_mismatch") ||
      text.includes("session_replay_mismatch")
    ) {
      throw routeError(
        "CUSTOM_RULE_IDEMPOTENCY_CONFLICT",
        "Settlement rule start request conflicts with an earlier request",
        409,
      );
    }
    throw routeError(
      "CUSTOM_RULE_STORAGE_UNAVAILABLE",
      "Settlement rule authoring storage is unavailable",
      503,
      true,
    );
  }
  const parsed = claimedAiSessionRowSchema.safeParse(data);
  if (!parsed.success) {
    throw routeError(
      "CUSTOM_RULE_STORAGE_UNAVAILABLE",
      "Settlement rule authoring storage is unavailable",
      503,
      true,
    );
  }
  const row = parsed.data;
  return {
    session: {
      id: row.id,
      title: row.title,
      status: row.status,
      lastMessageAt: row.last_message_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    },
    duplicate: row.duplicate,
  };
}

function safeRpcErrorText(error: unknown): string {
  if (!error || typeof error !== "object") return "";
  const message = Reflect.get(error, "message");
  const details = Reflect.get(error, "details");
  return `${typeof message === "string" ? message : ""} ${
    typeof details === "string" ? details : ""
  }`.toLowerCase();
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
      code: "CUSTOM_RULE_PROJECT_ACCESS_DENIED",
      message: "Project access denied",
      status: 403,
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

function statusForGovernanceError(code: string): number {
  if (
    code === "CUSTOM_RULE_ACTION_NOT_ALLOWED" ||
    code === "STANDARD_APPROVAL_NOT_ALLOWED" ||
    code === "APPROVER_NOT_ELIGIBLE" ||
    code === "MATERIAL_RISK_REQUIRES_OWNER" ||
    code === "MATERIAL_RISK_REQUIRES_DISTINCT_OWNER" ||
    code === "CREATOR_APPROVAL_REQUIRES_DISTINCT_APPROVER" ||
    code === "FORCE_APPROVAL_OWNER_ONLY" ||
    code === "FORCE_APPROVAL_REQUIRES_SINGLE_OWNER" ||
    code === "FORCE_APPROVAL_REQUIRES_SOLE_ELIGIBLE_APPROVER" ||
    code === "FORCE_ACKNOWLEDGEMENT_REQUIRED" ||
    code === "FORCE_REASON_REQUIRED"
  ) {
    return 403;
  }
  if (
    code === "SIMULATION_STALE" ||
    code === "CUSTOM_RULE_SERVER_CONTEXT_MISMATCH" ||
    code === "CUSTOM_RULE_TRANSITION_NOT_ALLOWED"
  ) {
    return 409;
  }
  return 422;
}

function persistenceConflict(error: CustomRulePersistenceQueryError): boolean {
  const text = safeRpcErrorText(error.cause);
  return (
    postgresErrorCode(error.cause) === "23505" ||
    text.includes("conflict") ||
    text.includes("concurrent") ||
    text.includes("idempotency") ||
    text.includes("duplicate") ||
    text.includes("stale")
  );
}

function persistenceDenial(error: CustomRulePersistenceQueryError): boolean {
  const text = safeRpcErrorText(error.cause);
  return (
    text.includes("_denied") ||
    text.includes("_not_allowed") ||
    text.includes("access_denied")
  );
}

function persistenceValidationFailure(
  error: CustomRulePersistenceQueryError,
): boolean {
  const text = safeRpcErrorText(error.cause);
  return (
    text.includes("archive_fallback_invalid") ||
    text.includes("archive_period_invalid") ||
    text.includes("source_not_found") ||
    text.includes("target_invalid") ||
    text.includes("target_mismatch") ||
    text.includes("input_invalid") ||
    text.includes("payload_invalid") ||
    text.includes("readiness") ||
    text.includes("not_ready") ||
    text.includes("fallback_required") ||
    text.includes("simulation_required") ||
    text.includes("group_scope_mismatch") ||
    text.includes("project_streamer_scope_mismatch") ||
    text.includes("streamer_scope_mismatch") ||
    text.includes("population_incomplete")
  );
}

function postgresErrorCode(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const code = Reflect.get(error, "code");
  return typeof code === "string" ? code : null;
}

const routeEligibleApproverSchema = z.strictObject({
  user_id: z.string().uuid(),
  role: z.enum(["owner", "ops_manager"]),
  status: z.literal("active"),
});

const routeOrganizationTemplateSchema = z.strictObject({
  id: z.string().uuid(),
  organization_id: z.string().uuid(),
  name: z.string().min(1),
  description: z.string().nullable(),
  source_rule_version_id: z.string().uuid().nullable(),
  source_project_id: z.string().uuid().nullable(),
  source_version_number: z.number().int().nullable(),
  source_scope: z
    .enum(["receivable", "payable", "external_cost", "reconciliation"])
    .nullable(),
  execution_grain: z.enum([
    "report",
    "project_streamer_period",
    "batch",
    "project_period",
  ]),
  composition_mode: z.enum([
    "replace",
    "add",
    "multiply",
    "clamp",
    "emit_items",
    "check",
  ]),
  parameters: z.record(z.string(), typedRuntimeValueSchema),
  rule_contract: businessRuleContractSchema,
  status: z.enum(["active", "archived"]),
  created_by: z.string().uuid(),
  created_at: canonicalOffsetDateTimeSchema,
  archived_at: canonicalOffsetDateTimeSchema.nullable(),
});

const routeGroupProjectStreamerSchema = z.strictObject({
  id: z.string().uuid(),
});

const routeGroupAssignmentSchema = z.strictObject({
  project_streamer_id: z.string().uuid(),
  group_id: z.string().uuid(),
  effective_from: canonicalOffsetDateTimeSchema,
  effective_until: canonicalOffsetDateTimeSchema.nullable(),
});

const routeGroupScopedRuleSchema = z.strictObject({
  id: z.string().uuid(),
  target_id: z.string().uuid(),
  priority: z.number().int().nonnegative(),
  composition_mode: z.enum([
    "replace",
    "add",
    "multiply",
    "clamp",
    "emit_items",
    "check",
  ]),
  status: z.enum(["active", "pending_review"]),
});

const routeGroupSnapshotHashSchema = z.string().regex(/^[0-9a-f]{64}$/u);

function createCustomRuleTemplateListingService(input: {
  supabase: SupabaseClient;
  actor: { organizationId: string; userId: string };
}): TemplateListingService {
  return {
    async listReusableSettlementRuleTemplates() {
      const organizationTemplates = await listRouteOrganizationTemplates(input);
      return listReusableSettlementRuleTemplates({
        systemTemplates: listCustomRuleSystemTemplates(),
        organizationTemplates,
        actorOrganizationId: input.actor.organizationId,
      });
    },
  };
}

function createRouteGovernanceRepository(input: {
  repository: SupabaseCustomRuleReadRepository;
  auth: AuthContext;
  supabase: SupabaseClient;
}): CustomRuleLifecycleRepositoryPort & SettlementGroupMembershipRepositoryPort {
  const repository = input.repository as CustomRuleLifecycleRepositoryPort &
    SettlementGroupMembershipRepositoryPort &
    SupabaseCustomRuleReadRepository;
  return Object.assign(repository, {
    async getCustomRuleGovernanceContext(scope: {
      organizationId: string;
      projectId: string;
      actorUserId: string;
      ruleVersionId?: string;
      target?: CustomRuleTarget;
      source?: { kind: "ai_draft" | "saved_draft"; id: string };
      sourceSimulationId?: string;
      archiveFallbackProof?: {
        ruleVersionId: string;
        simulationId: string;
        proofKind: "remaining_custom_layers" | "fixed_fallback";
        remainingCustomLayerCount: number;
        fixedFallbackAvailable: boolean;
        lockedBatchCount: number;
      };
    }) {
      const actor = {
        organizationId: scope.organizationId,
        userId: scope.actorUserId,
        role: input.auth.role,
      };
      const versions = await input.repository.listCustomRules({
        organizationId: scope.organizationId,
        projectId: scope.projectId,
      });
      const versionId =
        scope.ruleVersionId ??
        (scope.source?.kind === "saved_draft" ? scope.source.id : undefined);
      const version =
        versionId === undefined
          ? undefined
          : versions.find((candidate) => candidate.id === versionId);
      const savedDraftSimulation =
        scope.source?.kind === "saved_draft" && scope.sourceSimulationId
          ? {
              owner: { kind: "rule_version", id: scope.source.id } as const,
              id: scope.sourceSimulationId,
            }
          : null;
      const simulationOwner =
        savedDraftSimulation?.owner ??
        (version?.simulationId !== null && version !== undefined
          ? ({ kind: "rule_version", id: version.id } as const)
          : scope.source?.kind === "ai_draft"
            ? ({ kind: "ai_draft", id: scope.source.id } as const)
            : null);
      const simulationId =
        savedDraftSimulation?.id ?? version?.simulationId ?? scope.sourceSimulationId;
      const rawSimulation =
        simulationOwner && simulationId
          ? await input.repository.getSimulation({
              organizationId: scope.organizationId,
              projectId: scope.projectId,
              simulationId,
              owner: simulationOwner,
            })
          : null;
      const simulation = rawSimulation
        ? {
            id: rawSimulation.id,
            createdAt: rawSimulation.createdAt,
            formulaHash: rawSimulation.formulaHash,
            contractHash: rawSimulation.ruleContractHash,
            parameterHash: rawSimulation.parameterHash,
            catalogHash: rawSimulation.variableCatalogVersion,
            dataSelectionHash: rawSimulation.dataSelectionHash,
          }
        : undefined;
      if (
        version &&
        scope.archiveFallbackProof?.ruleVersionId === version.id
      ) {
        throw new CustomRuleGovernanceError(
          "CUSTOM_RULE_ARCHIVE_FALLBACK_SIMULATION_REQUIRED",
          "Active rule archival requires a separate fresh fallback or remaining-layer simulation",
        );
      }
      const fallbackSimulation =
        version &&
        simulationOwner &&
        scope.archiveFallbackProof !== undefined
          ? await loadRouteFallbackSimulation({
              repository: input.repository,
              organizationId: scope.organizationId,
              projectId: scope.projectId,
              ruleVersionId: scope.archiveFallbackProof.ruleVersionId,
              simulationId: scope.archiveFallbackProof.simulationId,
            })
          : simulation;
      const expectedFreshness =
        version !== undefined
          ? {
              formulaHash: version.formulaHash,
              contractHash: version.contractHash,
              parameterHash: version.parameterHash,
              catalogHash: version.catalogHash,
              dataSelectionHash: version.dataSelectionHash,
            }
          : simulation;
      const eligibleApprovers = await loadRouteEligibleApprovers({
        supabase: input.supabase,
        organizationId: scope.organizationId,
      });
      const target = version?.target ?? scope.target;
      const groupGovernance =
        target?.targetType === "streamer_group"
          ? await loadRouteGroupGovernance({
              supabase: input.supabase,
              organizationId: scope.organizationId,
              projectId: scope.projectId,
              target,
              simulation: rawSimulation,
            })
          : undefined;
      return {
        actor,
        ...(version ? { version } : {}),
        ...(simulation ? { simulation } : {}),
        ...(expectedFreshness ? { expectedFreshness } : {}),
        eligibleApprovers,
        creatorUserId: version?.createdBy ?? actor.userId,
        simulationFacts: simulationFactsFrom(rawSimulation),
        currentMarginCents:
          rawSimulation?.summarySchemaVersion === 2
            ? rawSimulation.deltas.marginImpactCents
            : null,
        contractFacts: {
          target: target ?? { targetType: "project", targetId: null },
          compositionMode: version?.compositionMode ?? "replace",
          missingDataPolicy:
            version?.missingDataPolicy &&
            typeof version.missingDataPolicy === "object" &&
            "action" in version.missingDataPolicy
              ? version.missingDataPolicy
              : { action: "route_item_to_review" },
          groupConflict: { resolution: "none", conflictingGroupIds: [] },
        },
        archiveSafety:
          version && simulation && fallbackSimulation
            ? {
                remainingCustomLayerCount:
                  scope.archiveFallbackProof?.remainingCustomLayerCount ?? 1,
                fixedFallbackAvailable:
                  scope.archiveFallbackProof?.fixedFallbackAvailable ?? false,
                lockedBatchCount:
                  scope.archiveFallbackProof?.lockedBatchCount ?? 0,
                proofKind:
                  scope.archiveFallbackProof?.proofKind ??
                  ("remaining_custom_layers" as const),
                fallbackSimulation,
              }
            : undefined,
        ...(groupGovernance ? { groupGovernance } : {}),
      };
    },
  });
}

async function loadRouteEligibleApprovers(input: {
  supabase: SupabaseClient;
  organizationId: string;
}): Promise<readonly { userId: string; role: "owner" | "ops_manager" }[]> {
  const { data, error } = await input.supabase
    .from("organization_members")
    .select("user_id, role, status")
    .eq("organization_id", input.organizationId)
    .eq("status", "active")
    .in("role", ["owner", "ops_manager"])
    .order("user_id", { ascending: true })
    .returns<unknown[]>();
  if (error) {
    throw new CustomRulePersistenceQueryError(
      "list_custom_rule_eligible_approvers",
      error,
    );
  }
  if (!Array.isArray(data)) {
    throw new CustomRulePersistenceDataError(
      "lifecycle",
      "eligible approver result must be an array",
    );
  }
  return data.map((row) => {
    const parsed = routeEligibleApproverSchema.parse(row);
    return { userId: parsed.user_id, role: parsed.role };
  });
}

async function loadRouteGroupGovernance(input: {
  supabase: SupabaseClient;
  organizationId: string;
  projectId: string;
  target: Extract<CustomRuleTarget, { targetType: "streamer_group" }>;
  simulation: SettlementFormulaSimulation | null;
}): Promise<
  NonNullable<CustomRuleLifecycleGovernanceContext["groupGovernance"]>
> {
  const effectiveAt = new Date().toISOString();
  const { data: snapshotHashData, error: snapshotHashError } =
    await input.supabase.rpc("settlement_rule_group_project_snapshot_hash", {
      p_organization_id: input.organizationId,
      p_project_id: input.projectId,
      p_effective_at: effectiveAt,
    });
  if (snapshotHashError) {
    throw new CustomRulePersistenceQueryError(
      "load_settlement_group_snapshot_hash",
      snapshotHashError,
    );
  }
  const currentGroupSnapshotHash =
    routeGroupSnapshotHashSchema.parse(snapshotHashData);

  const { data: projectStreamerData, error: projectStreamerError } =
    await input.supabase
      .from("project_streamers")
      .select("id")
      .eq("organization_id", input.organizationId)
      .eq("project_id", input.projectId)
      .eq("status", "joined")
      .order("id", { ascending: true })
      .returns<unknown[]>();
  if (projectStreamerError) {
    throw new CustomRulePersistenceQueryError(
      "load_settlement_group_project_streamers",
      projectStreamerError,
    );
  }
  if (!Array.isArray(projectStreamerData)) {
    throw new CustomRulePersistenceDataError(
      "group",
      "project streamer result must be an array",
    );
  }

  const { data: assignmentData, error: assignmentError } = await input.supabase
    .from("project_streamer_settlement_group_assignments")
    .select("project_streamer_id, group_id, effective_from, effective_until")
    .eq("organization_id", input.organizationId)
    .eq("project_id", input.projectId)
    .order("project_streamer_id", { ascending: true })
    .returns<unknown[]>();
  if (assignmentError) {
    throw new CustomRulePersistenceQueryError(
      "load_settlement_group_assignments",
      assignmentError,
    );
  }
  if (!Array.isArray(assignmentData)) {
    throw new CustomRulePersistenceDataError(
      "assignment",
      "assignment result must be an array",
    );
  }

  const { data: ruleData, error: ruleError } = await input.supabase
    .from("custom_settlement_rule_versions")
    .select("id, target_id, priority, composition_mode, status")
    .eq("organization_id", input.organizationId)
    .eq("project_id", input.projectId)
    .eq("target_type", "streamer_group")
    .in("status", ["active", "pending_review"])
    .order("priority", { ascending: true })
    .order("id", { ascending: true })
    .returns<unknown[]>();
  if (ruleError) {
    throw new CustomRulePersistenceQueryError(
      "load_settlement_group_rules",
      ruleError,
    );
  }
  if (!Array.isArray(ruleData)) {
    throw new CustomRulePersistenceDataError(
      "group",
      "group rule result must be an array",
    );
  }

  const projectStreamerIds = projectStreamerData
    .map((row) => routeGroupProjectStreamerSchema.parse(row).id)
    .sort();
  const assignments = assignmentData.map((row) =>
    routeGroupAssignmentSchema.parse(row),
  );
  const activeAssignments = assignments.filter(
    (assignment) =>
      assignment.effective_from <= effectiveAt &&
      (assignment.effective_until === null ||
        effectiveAt < assignment.effective_until),
  );
  const population = determineSettlementPopulationCoverage({
    joinedProjectStreamerIds: projectStreamerIds,
    activeAssignments: activeAssignments.map((assignment) => ({
      projectStreamerId: assignment.project_streamer_id,
      groupId: assignment.group_id,
    })),
  });
  const projectStreamerIdsByGroupId = new Map<string, string[]>();
  for (const assignment of activeAssignments) {
    const list = projectStreamerIdsByGroupId.get(assignment.group_id) ?? [];
    list.push(assignment.project_streamer_id);
    projectStreamerIdsByGroupId.set(assignment.group_id, list);
  }
  const activePendingRules: SettlementGroupScopedRule[] = ruleData.map(
    (row) => {
      const parsed = routeGroupScopedRuleSchema.parse(row);
      return {
        id: parsed.id,
        targetGroupId: parsed.target_id,
        priority: parsed.priority,
        compositionMode: parsed.composition_mode,
        status: parsed.status,
        projectStreamerIds: [
          ...(projectStreamerIdsByGroupId.get(parsed.target_id) ?? []),
        ].sort(),
      };
    },
  );
  const simulationPopulation =
    input.simulation?.summarySchemaVersion === 2 &&
    input.simulation.sampleSelection.groupPopulation
      ? input.simulation.sampleSelection.groupPopulation
      : {
          assignedProjectStreamerIds: [],
          unassignedProjectStreamerIds: [],
          groupSnapshotHash:
            input.simulation?.dataSelectionHash ?? currentGroupSnapshotHash,
        };

  return {
    assignedProjectStreamerIds: [...population.assignedProjectStreamerIds],
    unassignedProjectStreamerIds: [...population.unassignedProjectStreamerIds],
    currentGroupSnapshotHash,
    simulationPopulation,
    activePendingRules,
  };
}

async function loadRouteFallbackSimulation(input: {
  repository: SupabaseCustomRuleReadRepository;
  organizationId: string;
  projectId: string;
  ruleVersionId: string;
  simulationId: string;
}) {
  const simulation = await input.repository.getSimulation({
    organizationId: input.organizationId,
    projectId: input.projectId,
    simulationId: input.simulationId,
    owner: { kind: "rule_version", id: input.ruleVersionId },
  });
  if (!simulation) {
    throw new CustomRuleGovernanceError(
      "CUSTOM_RULE_ARCHIVE_FALLBACK_SIMULATION_REQUIRED",
      "Active rule archival requires a separate fresh fallback or remaining-layer simulation",
    );
  }
  return {
    id: simulation.id,
    createdAt: simulation.createdAt,
    formulaHash: simulation.formulaHash,
    contractHash: simulation.ruleContractHash,
    parameterHash: simulation.parameterHash,
    catalogHash: simulation.variableCatalogVersion,
    dataSelectionHash: simulation.dataSelectionHash,
  };
}

function simulationFactsFrom(simulation: SettlementFormulaSimulation | null) {
  if (!simulation || simulation.summarySchemaVersion !== 2) {
    return {
      totalOldCents: null,
      totalNewCents: "0",
      marginImpactCents: null,
      riskFlags: [],
      scenarios: [],
      missingDataImpact: {
        policyAction: "route_item_to_review",
        amountDeltaCents: null,
      },
    };
  }
  const payableScope =
    simulation.historicalTotals.newPayableAmountCents !== null;
  return {
    totalOldCents: payableScope
      ? simulation.historicalTotals.oldPayableAmountCents
      : simulation.historicalTotals.oldReceivableAmountCents,
    totalNewCents:
      (payableScope
        ? simulation.historicalTotals.newPayableAmountCents
        : simulation.historicalTotals.newReceivableAmountCents) ?? "0",
    marginImpactCents: simulation.deltas.marginImpactCents,
    riskFlags: simulation.warnings.filter((warning) => warning.kind === "risk"),
    scenarios: simulation.scenarios.map((scenario) => ({
      amountCents: scenario.amountCents,
    })),
    missingDataImpact: {
      policyAction: "route_item_to_review",
      amountDeltaCents: null,
    },
  };
}

async function listRouteOrganizationTemplates(input: {
  supabase: SupabaseClient;
  actor: { organizationId: string; userId: string };
}): Promise<OrganizationRuleTemplate[]> {
  const { data, error } = await input.supabase
    .from("settlement_rule_templates")
    .select(
      [
        "id",
        "organization_id",
        "name",
        "description",
        "source_rule_version_id",
        "source_project_id",
        "source_version_number",
        "source_scope",
        "execution_grain",
        "composition_mode",
        "parameters",
        "rule_contract",
        "status",
        "created_by",
        "created_at",
        "archived_at",
      ].join(", "),
    )
    .eq("organization_id", input.actor.organizationId)
    .eq("status", "active")
    .order("name", { ascending: true })
    .returns<unknown[]>();
  if (error) {
    throw new CustomRulePersistenceQueryError(
      "list_organization_templates",
      error,
    );
  }
  if (!Array.isArray(data)) {
    throw new CustomRulePersistenceDataError(
      "organization template",
      "template list result must be an array",
    );
  }
  return data.map((row) => {
    const parsed = routeOrganizationTemplateSchema.parse(row);
    return {
      id: parsed.id,
      organizationId: parsed.organization_id,
      name: parsed.name,
      description: parsed.description,
      sourceRuleVersionId: parsed.source_rule_version_id,
      sourceProjectId: parsed.source_project_id,
      sourceVersionNumber: parsed.source_version_number,
      sourceScope: parsed.source_scope,
      executionGrain: parsed.execution_grain,
      compositionMode: parsed.composition_mode,
      formula: "",
      compiledAst: null,
      variables: [],
      parameters: parsed.parameters,
      ruleContract: parsed.rule_contract,
      missingDataPolicy: {},
      testCases: [],
      status: parsed.status,
      createdBy: parsed.created_by,
      createdAt: parsed.created_at,
      archivedAt: parsed.archived_at,
    };
  });
}

function readinessRequirements(
  contract: z.infer<typeof businessRuleContractSchema>,
  formulaVariables: string[],
): CustomRuleInputRequirement[] {
  return buildCustomRuleInputRequirements({
    requiredVariableIds: contract.requiredInputs.map(
      (required) => required.name,
    ),
    formulaVariableIds: formulaVariables,
    missingDataPolicy: contract.missingDataPolicy,
  });
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

function centsToYuan(cents: string): string;
function centsToYuan(cents: null): null;
function centsToYuan(cents: string | null): string | null;
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

function coverageRatePercent(evaluatedCount: number, totalCount: number): string {
  if (totalCount === 0) return "0.00";
  const rateBps =
    (BigInt(evaluatedCount) * BigInt(10_000)) / BigInt(totalCount);
  return bpsToPercent(Number(rateBps));
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
