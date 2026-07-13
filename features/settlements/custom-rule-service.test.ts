import { describe, expect, it, vi } from "vitest";

import type {
  AiConversationDto,
  AiConversationMessageDto,
  AiConversationTurnDto,
  ConversationContextSnapshot,
} from "@/features/ai/conversation-contracts";
import type { AiGatewayResult } from "@/features/ai/contracts";
import type {
  CreatedConversationTurn,
  StoredConversationTurn,
} from "@/features/ai/conversation-repository";
import {
  createConversationService,
  type ConversationPersistence,
} from "@/features/ai/conversation-service";

import { createSettlementRuleAiAdapter } from "./custom-rule-ai";
import * as customRuleServiceModule from "./custom-rule-service";
import type {
  SettlementConversationPort,
  SettlementStructuredGateway,
} from "./custom-rule-ai";
import type { BusinessRuleContract } from "./custom-rule-contract";
import {
  analyzeCustomRuleDataReadiness,
  calculateCustomRuleOptionalPolicyHash,
  type CustomRuleInputRequirement,
} from "./custom-rule-data-readiness";
import type {
  CreateCustomRuleDraftInput,
  CreatedCustomRuleDraft,
  CustomRuleDraft,
  CustomRuleRepository,
  FinalizeSettlementAiDraftTurnInput,
  FinalizeSettlementAiFailedTurnInput,
  FinalizeSettlementAiSimulationTurnInput,
  FinalizedSettlementAiSimulationTurn,
  InsertedSettlementFormulaSimulation,
  InsertSettlementFormulaSimulationInput,
  SettlementAiTurnCompletionInput,
  SettlementAiUnresolvedAmbiguity,
  SettlementFormulaSimulation,
} from "./custom-rule-repository";
import { SETTLEMENT_AI_FAILED_TURN_ERROR_SUMMARIES } from "./custom-rule-repository";
import { parseCustomRuleFormula } from "./custom-rule-parser";
import {
  createCustomRuleAuthoringService,
  type AuthorizedSimulationEvidencePort,
  type AuthorizedSimulationSelectionRequest,
  type CustomRuleAuthoringRepositoryPort,
  type CustomRuleLifecycleService,
  type SettlementVariableCatalogPort,
  type StartCustomRuleSessionInput,
} from "./custom-rule-service";
import {
  calculateCustomRuleEvidenceHash,
  hashCustomRuleContract,
  hashCustomRuleParameters,
  simulateCustomSettlementRule,
  type AuthorizedCustomRuleSimulationEvidence,
  type CustomRuleSimulationInput,
} from "./custom-rule-simulation";
import type { CustomRuleVariableCatalog } from "./custom-rule-variable-catalog";
import { validateCustomRuleFormula } from "./custom-rule-validator";
import { CUSTOM_RULE_FORCE_APPROVAL_ACKNOWLEDGEMENT } from "./custom-rule-governance";

describe("Phase 2 custom rule lifecycle service", () => {
  it("exports an injected lifecycle service with production execution disabled by default", () => {
    expect(customRuleServiceModule).toHaveProperty(
      "createCustomRuleLifecycleService",
    );
    expect(
      typeof (customRuleServiceModule as Record<string, unknown>)
        .createCustomRuleLifecycleService,
    ).toBe("function");
  });

  it("rejects approval before lifecycle mutation while execution is disabled", async () => {
    const fixture = phase2LifecycleFixture();
    const service = phase2LifecycleService(fixture);

    await expect(
      service.approveCustomRule({
        actor: phase2Actor(),
        projectId: PROJECT_ID,
        ruleVersionId: fixture.version.id,
        effectiveFrom: "2026-08-01T00:00:00.000Z",
        reason: "Approve only when production can execute the rule.",
        clientRequestId: "disabled-approval-1",
      }),
    ).rejects.toMatchObject({ code: "CUSTOM_RULE_EXECUTION_DISABLED" });

    expect(fixture.repository.approveCustomRule).not.toHaveBeenCalled();
    expect(
      fixture.repository.recordCustomRuleActivationFailure,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        ruleVersionId: fixture.version.id,
        errorMessage: "Production custom settlement rule execution is disabled",
      }),
    );
    expect(fixture.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "approve",
        result: "failure",
        isHighRisk: true,
      }),
    );
    expect(fixture.context.version.status).toBe("pending_review");
  });

  it("denies unauthorized approval before writing activation-failure records", async () => {
    const fixture = phase2LifecycleFixture({
      actor: { ...phase2Actor(), role: "finance" },
      eligibleApprovers: [],
    });
    const service = phase2LifecycleService(fixture);

    await expect(
      service.approveCustomRule({
        actor: phase2Actor(),
        projectId: PROJECT_ID,
        ruleVersionId: fixture.version.id,
        effectiveFrom: "2026-08-01T00:00:00.000Z",
        reason: "Execution disabled must not mask approval authorization.",
        clientRequestId: "disabled-unauthorized-approval-1",
      }),
    ).rejects.toMatchObject({ code: "STANDARD_APPROVAL_NOT_ALLOWED" });

    expect(fixture.repository.approveCustomRule).not.toHaveBeenCalled();
    expect(
      fixture.repository.recordCustomRuleActivationFailure,
    ).not.toHaveBeenCalled();
    expect(fixture.audit).not.toHaveBeenCalled();
  });

  it("recomputes freshness, material risk, and approver eligibility from server records", async () => {
    const fixture = phase2LifecycleFixture({
      actor: { ...phase2Actor(), role: "owner" },
      creatorUserId: uuid(901),
      eligibleApprovers: [{ userId: USER_ID, role: "owner" }],
      simulationFacts: {
        totalOldCents: "10000",
        totalNewCents: "20000",
        marginImpactCents: "0",
        riskFlags: [],
        scenarios: [{ amountCents: "20000" }],
        missingDataImpact: {
          policyAction: "route_item_to_review",
          amountDeltaCents: null,
        },
      },
      riskConfiguration: {
        project: {
          abnormalTotalIncreaseBps: 1_000,
          safetyCapCents: "100000",
        },
      },
    });
    const service = phase2LifecycleService(fixture, { enabled: true });

    await service.approveCustomRule({
      actor: { ...phase2Actor(), role: "streamer" },
      projectId: PROJECT_ID,
      ruleVersionId: fixture.version.id,
      effectiveFrom: "2026-08-01T00:00:00.000Z",
      reason: "Approve using only the server-owned governance context.",
      clientRequestId: "trusted-approval-1",
      isMaterialRisk: false,
      approverCount: 99,
      creatorId: USER_ID,
      hashes: { formulaHash: "0".repeat(64) },
      totals: { totalNewCents: "0" },
    });

    expect(
      fixture.repository.getCustomRuleGovernanceContext,
    ).toHaveBeenCalled();
    expect(fixture.repository.approveCustomRule).toHaveBeenCalledWith(
      expect.objectContaining({
        riskSummary: expect.objectContaining({
          material: true,
          codes: ["abnormal_total_increase"],
        }),
      }),
    );
    expect(fixture.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "approve",
        objectType: "custom_settlement_rule:pending_review->active",
        result: "success",
      }),
    );
  });

  it("uses the server role and complete eligible-owner set for force approval", async () => {
    const fixture = phase2LifecycleFixture({
      actor: { ...phase2Actor(), role: "ops_manager" },
      eligibleApprovers: [{ userId: USER_ID, role: "ops_manager" }],
    });
    const service = phase2LifecycleService(fixture, { enabled: true });

    await expect(
      service.forceApproveCustomRule({
        actor: { ...phase2Actor(), role: "owner" },
        projectId: PROJECT_ID,
        ruleVersionId: fixture.version.id,
        effectiveFrom: "2026-08-01T00:00:00.000Z",
        reason: "Client role must never upgrade server authorization.",
        acknowledgment: CUSTOM_RULE_FORCE_APPROVAL_ACKNOWLEDGEMENT,
        clientRequestId: "force-role-1",
      }),
    ).rejects.toMatchObject({ code: "FORCE_APPROVAL_OWNER_ONLY" });

    expect(fixture.repository.forceApproveCustomRule).not.toHaveBeenCalled();
  });

  it("persists the force marker, acknowledgement, reason, and risk summary", async () => {
    const fixture = phase2LifecycleFixture({
      actor: { ...phase2Actor(), role: "owner" },
      creatorUserId: uuid(902),
      eligibleApprovers: [{ userId: USER_ID, role: "owner" }],
    });
    const service = phase2LifecycleService(fixture, { enabled: true });

    await service.forceApproveCustomRule({
      actor: phase2Actor(),
      projectId: PROJECT_ID,
      ruleVersionId: fixture.version.id,
      effectiveFrom: "2026-08-01T00:00:00.000Z",
      reason: "Sole owner explicitly accepts the documented risk.",
      acknowledgment: CUSTOM_RULE_FORCE_APPROVAL_ACKNOWLEDGEMENT,
      clientRequestId: "force-owner-1",
    });

    expect(fixture.repository.forceApproveCustomRule).toHaveBeenCalledWith(
      expect.objectContaining({
        acknowledgment: CUSTOM_RULE_FORCE_APPROVAL_ACKNOWLEDGEMENT,
        reason: "Sole owner explicitly accepts the documented risk.",
        riskSummary: expect.objectContaining({ force: true }),
      }),
    );
  });

  it("does not save a changed draft against a stale version-bound simulation", async () => {
    const fixture = phase2LifecycleFixture({
      versionStatus: "draft",
    });
    const service = phase2LifecycleService(fixture);
    const changedDraft = {
      ...phase2DraftPayload(),
      formula: "system_minutes * 3",
      formulaHash: "f".repeat(64),
    };

    await expect(
      service.saveCustomRuleDraft({
        actor: phase2Actor(),
        projectId: PROJECT_ID,
        sourceAiDraftId: null,
        sourceSimulationId: fixture.simulation.id,
        ruleVersionId: fixture.version.id,
        versionSimulationId: fixture.simulation.id,
        scope: "payable",
        target: { targetType: "project", targetId: null },
        draft: changedDraft,
        reason: "Edit should require a new version-bound simulation.",
        clientRequestId: "stale-draft-save-1",
      }),
    ).rejects.toMatchObject({ code: "SIMULATION_STALE" });

    expect(fixture.repository.saveCustomRuleDraft).not.toHaveBeenCalled();
  });

  it("saves requested changes against fresh simulation proof before resubmitting", async () => {
    const fixture = phase2LifecycleFixture({
      versionStatus: "draft",
      reopenedAt: "2026-07-13T02:00:00.000Z",
    });
    const freshSourceSimulation = {
      ...fixture.simulation,
      id: uuid(960),
      createdAt: "2026-07-13T03:00:00.000Z",
      formulaHash: "f".repeat(64),
    };
    const freshVersionSimulation = {
      ...freshSourceSimulation,
      id: uuid(961),
    };
    fixture.context.simulation = freshSourceSimulation;
    fixture.context.expectedFreshness = {
      formulaHash: "f".repeat(64),
      contractHash: "b".repeat(64),
      parameterHash: "d".repeat(64),
      catalogHash: "a".repeat(64),
      dataSelectionHash: "e".repeat(64),
    };
    const editedDraft = {
      ...phase2DraftPayload(),
      formula: "system_minutes * 3",
      formulaHash: "f".repeat(64),
    };
    fixture.repository.saveCustomRuleDraft.mockResolvedValueOnce({
      version: {
        ...fixture.version,
        formula: editedDraft.formula,
        formulaHash: editedDraft.formulaHash,
        simulationId: freshVersionSimulation.id,
      },
      simulation: freshVersionSimulation,
    });
    const service = phase2LifecycleService(fixture);

    await service.saveCustomRuleDraft({
      actor: phase2Actor(),
      projectId: PROJECT_ID,
      sourceAiDraftId: null,
      sourceSimulationId: freshSourceSimulation.id,
      ruleVersionId: fixture.version.id,
      versionSimulationId: freshVersionSimulation.id,
      scope: "payable",
      target: { targetType: "project", targetId: null },
      draft: editedDraft,
      reason: "Save edited requested changes with fresh simulation proof.",
      clientRequestId: "save-edited-fresh-1",
    });

    expect(fixture.repository.saveCustomRuleDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceSimulationId: freshSourceSimulation.id,
        versionSimulationId: freshVersionSimulation.id,
        draft: expect.objectContaining({ formulaHash: "f".repeat(64) }),
      }),
    );

    fixture.context.version = {
      ...fixture.context.version,
      formula: editedDraft.formula,
      formulaHash: editedDraft.formulaHash,
      simulationId: freshVersionSimulation.id,
    };
    fixture.context.simulation = freshVersionSimulation;

    await service.resubmitCustomRule({
      actor: phase2Actor(),
      projectId: PROJECT_ID,
      source: { kind: "saved_draft", id: fixture.version.id },
      sourceSimulationId: freshVersionSimulation.id,
      destinationVersionId: uuid(962),
      destinationSimulationId: uuid(963),
      scope: "payable",
      target: { targetType: "project", targetId: null },
      effectiveFrom: "2026-08-01T00:00:00.000Z",
      reason: "Resubmit edited requested changes.",
      clientRequestId: "resubmit-edited-fresh-1",
    });

    expect(fixture.repository.resubmitCustomRule).toHaveBeenCalledWith(
      expect.objectContaining({
        source: { kind: "saved_draft", id: fixture.version.id },
        sourceSimulationId: freshVersionSimulation.id,
      }),
    );
  });

  it("requires reopen before edits and a newer fresh simulation before resubmit", async () => {
    const fixture = phase2LifecycleFixture({
      versionStatus: "changes_requested",
      reopenedAt: "2026-07-13T02:00:00.000Z",
      simulationCreatedAt: "2026-07-13T01:00:00.000Z",
    });
    const service = phase2LifecycleService(fixture);

    await expect(
      service.saveCustomRuleDraft({
        actor: phase2Actor(),
        projectId: PROJECT_ID,
        sourceAiDraftId: null,
        sourceSimulationId: fixture.simulation.id,
        ruleVersionId: fixture.version.id,
        versionSimulationId: fixture.simulation.id,
        scope: "payable",
        target: { targetType: "project", targetId: null },
        draft: phase2DraftPayload(),
        reason: "Attempted edit before reopening.",
        clientRequestId: "edit-before-reopen-1",
      }),
    ).rejects.toMatchObject({ code: "CUSTOM_RULE_PAYLOAD_IMMUTABLE" });
    expect(fixture.repository.saveCustomRuleDraft).not.toHaveBeenCalled();

    await service.reopenRequestedChangesAsDraft({
      actor: phase2Actor(),
      projectId: PROJECT_ID,
      ruleVersionId: fixture.version.id,
      reason: "Reopen before editing and resimulation.",
      clientRequestId: "reopen-1",
    });
    expect(fixture.repository.reopenRequestedChangesAsDraft).toHaveBeenCalled();

    fixture.context.version.status = "draft";
    await expect(
      service.resubmitCustomRule({
        actor: phase2Actor(),
        projectId: PROJECT_ID,
        source: { kind: "saved_draft", id: fixture.version.id },
        sourceSimulationId: fixture.simulation.id,
        destinationVersionId: uuid(910),
        destinationSimulationId: uuid(911),
        scope: "payable",
        target: { targetType: "project", targetId: null },
        effectiveFrom: "2026-08-01T00:00:00.000Z",
        reason: "Resubmit after requested changes.",
        clientRequestId: "resubmit-stale-1",
      }),
    ).rejects.toMatchObject({
      code: "CUSTOM_RULE_RESUBMIT_SIMULATION_REQUIRED",
    });
    expect(fixture.repository.resubmitCustomRule).not.toHaveBeenCalled();
  });

  it("derives effective-now and scheduled from intervals rather than status", async () => {
    const fixture = phase2LifecycleFixture();
    fixture.repository.listCustomRules.mockResolvedValue([
      {
        ...fixture.version,
        status: "archived",
        effectiveFrom: "2026-07-01T00:00:00.000Z",
        effectiveUntil: "2026-08-01T00:00:00.000Z",
        approvedAt: "2026-06-30T00:00:00.000Z",
      },
      {
        ...fixture.version,
        id: uuid(920),
        status: "active",
        effectiveFrom: "2026-08-01T00:00:00.000Z",
        effectiveUntil: null,
        approvedAt: "2026-07-13T00:00:00.000Z",
      },
    ]);
    const service = phase2LifecycleService(
      fixture,
      undefined,
      "2026-07-20T00:00:00.000Z",
    );

    const rules = await service.listCustomRules({
      actor: phase2Actor(),
      projectId: PROJECT_ID,
    });

    expect(rules[0]).toMatchObject({
      status: "archived",
      effectiveNow: true,
      scheduled: false,
    });
    expect(rules[1]).toMatchObject({
      status: "active",
      effectiveNow: false,
      scheduled: true,
    });
  });

  it("lists rules with only actor governance context", async () => {
    const fixture = phase2LifecycleFixture();
    fixture.repository.getCustomRuleGovernanceContext.mockResolvedValueOnce({
      actor: { ...phase2Actor(), role: "owner" },
    } as unknown as typeof fixture.context);
    const service = phase2LifecycleService(
      fixture,
      undefined,
      "2026-07-20T00:00:00.000Z",
    );

    await expect(
      service.listCustomRules({
        actor: phase2Actor(),
        projectId: PROJECT_ID,
      }),
    ).resolves.toHaveLength(1);

    expect(fixture.repository.listCustomRules).toHaveBeenCalledWith({
      organizationId: ORGANIZATION_ID,
      projectId: PROJECT_ID,
      status: undefined,
    });
  });

  it("archives only with server-owned fresh fallback proof", async () => {
    const fixture = phase2LifecycleFixture({
      versionStatus: "active",
      archiveSafety: {
        remainingCustomLayerCount: 0,
        fixedFallbackAvailable: true,
        lockedBatchCount: 4,
        proofKind: "fixed_fallback",
      },
    });
    const service = phase2LifecycleService(fixture);

    await service.archiveCustomRule({
      actor: phase2Actor(),
      projectId: PROJECT_ID,
      ruleVersionId: fixture.version.id,
      effectiveUntil: "2026-09-01T00:00:00.000Z",
      reason: "Archive after verifying the fixed fallback.",
      clientRequestId: "archive-safe-1",
      fixedFallbackAvailable: false,
      lockedBatchCount: 0,
    });

    expect(fixture.repository.archiveCustomRule).toHaveBeenCalledWith(
      expect.objectContaining({
        fallbackProof: {
          simulationId: uuid(905),
          proofKind: "fixed_fallback",
          remainingCustomLayerCount: 0,
          fixedFallbackAvailable: true,
          lockedBatchCount: 4,
          lockedBatchExclusion: {
            excluded: true,
            lockedBatchCount: 4,
          },
        },
      }),
    );
    expect(fixture.audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "void", isHighRisk: true }),
    );
  });

  it("rejects active archive when fallback proof reuses or stales the archived rule simulation", async () => {
    const sameRule = phase2LifecycleFixture({
      versionStatus: "active",
      archiveSafety: {
        fallbackSimulation: {
          id: uuid(903),
          createdAt: "2026-07-13T04:00:00.000Z",
          formulaHash: "c".repeat(64),
          contractHash: "b".repeat(64),
          parameterHash: "d".repeat(64),
          catalogHash: "a".repeat(64),
          dataSelectionHash: "e".repeat(64),
        },
      },
    });
    const sameRuleService = phase2LifecycleService(sameRule);

    await expect(
      sameRuleService.archiveCustomRule({
        actor: phase2Actor(),
        projectId: PROJECT_ID,
        ruleVersionId: sameRule.version.id,
        effectiveUntil: "2026-09-01T00:00:00.000Z",
        reason: "Archive with a reused proof.",
        clientRequestId: "archive-reused-proof-1",
      }),
    ).rejects.toMatchObject({
      code: "CUSTOM_RULE_ARCHIVE_FALLBACK_SIMULATION_REQUIRED",
    });
    expect(sameRule.repository.archiveCustomRule).not.toHaveBeenCalled();

    const stale = phase2LifecycleFixture({
      versionStatus: "active",
      archiveSafety: {
        fallbackSimulation: {
          id: uuid(906),
          createdAt: "2026-07-13T04:00:00.000Z",
          formulaHash: "f".repeat(64),
          contractHash: "b".repeat(64),
          parameterHash: "d".repeat(64),
          catalogHash: "a".repeat(64),
          dataSelectionHash: "e".repeat(64),
        },
      },
    });
    const staleService = phase2LifecycleService(stale);

    await expect(
      staleService.archiveCustomRule({
        actor: phase2Actor(),
        projectId: PROJECT_ID,
        ruleVersionId: stale.version.id,
        effectiveUntil: "2026-09-01T00:00:00.000Z",
        reason: "Archive with stale fallback proof.",
        clientRequestId: "archive-stale-proof-1",
      }),
    ).rejects.toMatchObject({ code: "SIMULATION_STALE" });
    expect(stale.repository.archiveCustomRule).not.toHaveBeenCalled();
  });

  it("records activation failure without returning a mutated version", async () => {
    const fixture = phase2LifecycleFixture({
      actor: { ...phase2Actor(), role: "owner" },
      creatorUserId: uuid(930),
      eligibleApprovers: [{ userId: USER_ID, role: "owner" }],
    });
    fixture.repository.approveCustomRule.mockRejectedValue(
      new Error("concurrent target activation conflict"),
    );
    const service = phase2LifecycleService(fixture, { enabled: true });

    await expect(
      service.approveCustomRule({
        actor: phase2Actor(),
        projectId: PROJECT_ID,
        ruleVersionId: fixture.version.id,
        effectiveFrom: "2026-08-01T00:00:00.000Z",
        reason: "Approval failed during atomic activation.",
        clientRequestId: "x".repeat(120),
      }),
    ).rejects.toThrow("concurrent target activation conflict");

    expect(
      fixture.repository.recordCustomRuleActivationFailure,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        ruleVersionId: fixture.version.id,
        clientRequestId: expect.stringMatching(
          /^activation_failed:[0-9a-f]{64}$/u,
        ),
      }),
    );
    expect(fixture.audit).toHaveBeenCalledWith(
      expect.objectContaining({ result: "failure", action: "approve" }),
    );
    expect(fixture.context.version.status).toBe("pending_review");
  });
});

const ORGANIZATION_ID = "00000000-0000-4000-8000-000000000001";
const PROJECT_ID = "00000000-0000-4000-8000-000000000002";
const USER_ID = "00000000-0000-4000-8000-000000000003";
const CONVERSATION_ID = "00000000-0000-4000-8000-000000000004";
const FIRST_DRAFT_ID = "00000000-0000-4000-8000-000000000101";
const CATALOG_VERSION = "a".repeat(64);
const actor = { organizationId: ORGANIZATION_ID, userId: USER_ID };

function phase2Actor() {
  return { organizationId: ORGANIZATION_ID, userId: USER_ID };
}

function phase2DraftPayload() {
  const parsed = parseCustomRuleFormula("system_minutes * 2");
  if (!parsed.ok) throw new Error("phase2 draft fixture failed to parse");
  return {
    priority: 100,
    formula: "system_minutes * 2",
    compiledAst: parsed.ast,
    variables: [],
    parameters: {},
    ruleContract: contract(),
    systemExplanationTemplate: "按系统时长计算自定义结算金额。",
    missingDataPolicy: contract().missingDataPolicy,
    testCases: [],
    formulaHash: "c".repeat(64),
    contractHash: "b".repeat(64),
    parameterHash: "d".repeat(64),
    catalogHash: "a".repeat(64),
    dataSelectionHash: "e".repeat(64),
  };
}

function phase2LifecycleFixture(overrides: Record<string, unknown> = {}) {
  const parsed = parseCustomRuleFormula("system_minutes * 2");
  if (!parsed.ok) throw new Error("phase2 lifecycle fixture failed to parse");
  const hashes = {
    formulaHash: "c".repeat(64),
    contractHash: "b".repeat(64),
    parameterHash: "d".repeat(64),
    catalogHash: "a".repeat(64),
    dataSelectionHash: "e".repeat(64),
  };
  const version = {
    id: uuid(900),
    organizationId: ORGANIZATION_ID,
    projectId: PROJECT_ID,
    scope: "payable",
    target: { targetType: "project", targetId: null },
    executionGrain: "report",
    compositionMode: "replace",
    priority: 100,
    versionNumber: 2,
    status: (overrides.versionStatus ?? "pending_review") as string,
    formula: "system_minutes * 2",
    compiledAst: parsed.ast,
    variables: [],
    parameters: {},
    ruleContract: contract(),
    systemExplanationTemplate: "按系统时长计算自定义结算金额。",
    missingDataPolicy: contract().missingDataPolicy,
    testCases: [],
    simulationSummary: {},
    ...hashes,
    simulationId: uuid(903),
    effectiveFrom: null,
    effectiveUntil: null,
    createdBy: (overrides.creatorUserId ?? uuid(901)) as string,
    approvedBy: null,
    aiDraftId: FIRST_DRAFT_ID,
    reason: "Submit for review.",
    createdAt: "2026-07-13T00:00:00.000Z",
    approvedAt: null,
    archivedAt: null,
  };
  const simulation = {
    id: uuid(903),
    createdAt: (overrides.simulationCreatedAt ??
      "2026-07-13T03:00:00.000Z") as string,
    ...hashes,
  };
  const context = {
    actor: (overrides.actor ?? {
      ...phase2Actor(),
      role: "owner",
    }) as Record<string, unknown>,
    version,
    simulation,
    expectedFreshness: hashes,
    eligibleApprovers: (overrides.eligibleApprovers ?? [
      { userId: USER_ID, role: "owner" },
    ]) as unknown[],
    creatorUserId: (overrides.creatorUserId ?? version.createdBy) as string,
    simulationFacts: (overrides.simulationFacts ?? {
      totalOldCents: "10000",
      totalNewCents: "10000",
      marginImpactCents: "0",
      riskFlags: [],
      scenarios: [{ amountCents: "10000" }],
      missingDataImpact: {
        policyAction: "route_item_to_review",
        amountDeltaCents: null,
      },
    }) as Record<string, unknown>,
    currentMarginCents: "10000",
    contractFacts: {
      target: version.target,
      compositionMode: version.compositionMode,
      missingDataPolicy: version.missingDataPolicy,
      groupConflict: { resolution: "none", conflictingGroupIds: [] },
    },
    riskConfiguration: overrides.riskConfiguration,
    reopenedAt: overrides.reopenedAt ?? null,
    archiveSafety: {
      remainingCustomLayerCount: 1,
      fixedFallbackAvailable: false,
      lockedBatchCount: 0,
      proofKind: "remaining_custom_layers",
      fallbackSimulation: {
        id: uuid(905),
        createdAt: "2026-07-13T04:00:00.000Z",
        ...hashes,
      },
      ...(overrides.archiveSafety as Record<string, unknown> | undefined),
    },
  };
  const lifecycleResult = {
    version,
    simulation,
    event: {
      id: uuid(904),
      ruleVersionId: version.id,
      eventType: "approved",
      beforeStatus: "pending_review",
      afterStatus: "active",
    },
  };
  const repository = {
    getCustomRuleGovernanceContext: vi.fn(async () => context),
    saveCustomRuleDraft: vi.fn(async () => ({ version, simulation })),
    applyAndSubmitCustomRule: vi.fn(async () => lifecycleResult),
    requestCustomRuleChanges: vi.fn(async () => lifecycleResult),
    reopenRequestedChangesAsDraft: vi.fn(async () => lifecycleResult),
    resubmitCustomRule: vi.fn(async () => lifecycleResult),
    approveCustomRule: vi.fn(async () => lifecycleResult),
    forceApproveCustomRule: vi.fn(async () => lifecycleResult),
    archiveCustomRule: vi.fn(async () => lifecycleResult),
    listCustomRules: vi.fn(
      async (): Promise<Array<Record<string, unknown>>> => [version],
    ),
    recordCustomRuleActivationFailure: vi.fn(async () => lifecycleResult),
  };
  return {
    repository,
    audit: vi.fn(async () => undefined),
    context,
    version,
    simulation,
  };
}

function phase2LifecycleService(
  fixture: ReturnType<typeof phase2LifecycleFixture>,
  executionCapability?: { enabled: boolean },
  now = "2026-07-13T04:00:00.000Z",
): CustomRuleLifecycleService {
  const create = (customRuleServiceModule as Record<string, unknown>)
    .createCustomRuleLifecycleService as (
    input: Record<string, unknown>,
  ) => CustomRuleLifecycleService;
  return create({
    repository: fixture.repository,
    audit: fixture.audit,
    executionCapability,
    now: () => now,
  });
}

const STANDALONE_RETRY_SOURCE_TURN_ID = uuid(210);
const RETRY_CONTEXT_MESSAGE_IDS = [uuid(298), uuid(299), uuid(301)];

function retryContextSnapshot(): ConversationContextSnapshot {
  return {
    version: 7,
    summaryVersion: 3,
    messageIds: [...RETRY_CONTEXT_MESSAGE_IDS],
    groundingRefs: [],
    assembledAt: "2026-07-12T00:00:00.000Z",
  };
}

function startInput(
  clientRequestId = "recoverable-start-request-0001",
): StartCustomRuleSessionInput {
  return {
    actor,
    projectId: PROJECT_ID,
    conversationId: CONVERSATION_ID,
    clientRequestId,
    promptText: "Start a recoverable settlement draft.",
    seedContract: contract(),
    initialAmbiguities: [
      {
        code: "confirm_rate",
        question: "Confirm the hourly rate?",
        required: true,
      },
    ],
  };
}

const OUT_OF_ORDER_AMBIGUITIES: SettlementAiUnresolvedAmbiguity[] = [
  {
    code: "z_rate",
    question: "Confirm the hourly rate?",
    required: true,
  },
  {
    code: "a_effective_date",
    question: "Confirm the effective date?",
    required: true,
  },
  {
    code: "m_missing_policy",
    question: "Confirm the missing-data policy?",
    required: false,
  },
];

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolvePromise: (() => void) | undefined;
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve() {
      if (!resolvePromise) throw new Error("deferred promise is unavailable");
      resolvePromise();
    },
  };
}

async function recoveredStartFixture(
  clientRequestId: string,
  initialAmbiguities: SettlementAiUnresolvedAmbiguity[] = startInput(
    clientRequestId,
  ).initialAmbiguities,
) {
  const harness = createHarness([
    clarificationOutput("Confirm the recovered hourly rate?", "confirm_rate"),
  ]);
  const input = {
    ...startInput(clientRequestId),
    initialAmbiguities: structuredClone(initialAmbiguities),
  };
  const source = await harness.conversation.acceptTurn(actor, CONVERSATION_ID, {
    content: input.promptText,
    mode: "fast",
    clientRequestId: input.clientRequestId,
    attachments: [],
  });
  harness.expireTurn(source.turnId);
  const recovered = await harness.service.startSession(input);
  if (!recovered.ok || recovered.kind !== "clarifying") {
    throw new Error("recovered start fixture did not create a draft");
  }
  return { harness, input, source, recovered };
}

type RecoveryHarness = ReturnType<typeof createHarness>;
type RecoveredStartFixture = Awaited<ReturnType<typeof recoveredStartFixture>>;

function recoveryActivity(harness: RecoveryHarness) {
  return {
    accept: vi.mocked(harness.conversation.acceptTurn).mock.calls.length,
    retry: vi.mocked(harness.conversation.retryTurn).mock.calls.length,
    prepare: vi.mocked(harness.conversation.prepareTurn).mock.calls.length,
    capture: vi.mocked(harness.conversation.captureGatewayContext).mock.calls
      .length,
    catalog: vi.mocked(harness.catalogPort.getCatalog).mock.calls.length,
    gateway: harness.events.filter((event) => event === "gateway.execute")
      .length,
    finalizeDraft: harness.repository.finalizeDraftTurnCalls.length,
    finalizeFailed: harness.repository.finalizeFailedTurnCalls.length,
  };
}

const INELIGIBLE_EXPIRED_START_CASES: ReadonlyArray<{
  name: string;
  mutate: (harness: RecoveryHarness, source: CreatedConversationTurn) => void;
}> = [
  {
    name: "wrong error code",
    mutate: (harness, source) =>
      harness.tamperTurnForTest(source.turnId, {
        errorCode: "settlement_source_failed",
      }),
  },
  {
    name: "retryable false",
    mutate: (harness, source) =>
      harness.tamperTurnForTest(source.turnId, { retryable: false }),
  },
  {
    name: "wrong attempt",
    mutate: (harness, source) =>
      harness.tamperTurnForTest(source.turnId, { attempt: 2 }),
  },
  {
    name: "existing retry lineage",
    mutate: (harness, source) =>
      harness.tamperTurnForTest(source.turnId, { retryOfTurnId: uuid(999) }),
  },
  {
    name: "mismatched user content",
    mutate: (harness, source) =>
      harness.tamperMessageForTest(source.userMessageId, {
        content: "A different settlement request.",
      }),
  },
  {
    name: "mismatched user parent",
    mutate: (harness, source) =>
      harness.tamperMessageForTest(source.userMessageId, {
        parentMessageId: uuid(998),
      }),
  },
  {
    name: "missing source assistant lease metadata",
    mutate: (harness, source) =>
      harness.tamperMessageForTest(source.assistantMessageId, {
        metadata: undefined,
      }),
  },
  {
    name: "tampered source assistant lease metadata",
    mutate: (harness, source) =>
      harness.tamperMessageForTest(source.assistantMessageId, {
        metadata: { errorCode: "other_failure", retryable: true },
      }),
  },
  {
    name: "wrong source assistant status",
    mutate: (harness, source) =>
      harness.tamperMessageForTest(source.assistantMessageId, {
        status: "completed",
      }),
  },
];

const TAMPERED_RECOVERY_REPLAY_CASES: ReadonlyArray<{
  name: string;
  path: "pre_accept" | "post_duplicate";
  mutate: (fixture: RecoveredStartFixture) => void;
}> = [
  {
    name: "missing recovery successor",
    path: "pre_accept",
    mutate: ({ harness, recovered }) =>
      harness.deleteTurnForTest(recovered.draft.turnTrace.turnId),
  },
  {
    name: "missing expired source",
    path: "pre_accept",
    mutate: ({ harness, source }) => harness.deleteTurnForTest(source.turnId),
  },
  {
    name: "tampered source user content",
    path: "post_duplicate",
    mutate: ({ harness, source }) =>
      harness.tamperMessageForTest(source.userMessageId, {
        content: "Tampered recovered request.",
      }),
  },
  {
    name: "missing source assistant",
    path: "pre_accept",
    mutate: ({ harness, source }) =>
      harness.deleteMessageForTest(source.assistantMessageId),
  },
  {
    name: "tampered source assistant lease metadata",
    path: "post_duplicate",
    mutate: ({ harness, source }) =>
      harness.tamperMessageForTest(source.assistantMessageId, {
        metadata: { errorCode: "turn_lease_expired", retryable: false },
      }),
  },
  {
    name: "tampered successor assistant content",
    path: "pre_accept",
    mutate: ({ harness, recovered }) =>
      harness.tamperMessageForTest(
        recovered.draft.turnTrace.assistantMessageId,
        { content: "Tampered recovered assistant content." },
      ),
  },
  {
    name: "tampered successor completion metadata",
    path: "post_duplicate",
    mutate: ({ harness, recovered }) =>
      harness.tamperMessageForTest(
        recovered.draft.turnTrace.assistantMessageId,
        {
          metadata: {
            contextSnapshotVersion: 7,
            contextSummaryVersion: 3,
            contextMessageIds: [recovered.draft.turnTrace.userMessageId],
            settlementIdempotencyKey: "settlement-start:tampered",
            settlementInitialStatus: "clarifying",
          },
        },
      ),
  },
  {
    name: "tampered successor assistant status",
    path: "post_duplicate",
    mutate: ({ harness, recovered }) =>
      harness.tamperMessageForTest(
        recovered.draft.turnTrace.assistantMessageId,
        { status: "pending" },
      ),
  },
  {
    name: "tampered frozen contract hash",
    path: "pre_accept",
    mutate: ({ harness, recovered }) =>
      harness.tamperFrozenServiceContext(recovered.draft.turnTrace.turnId, {
        expectedContractHash: "f".repeat(64),
      }),
  },
  {
    name: "tampered frozen catalog hash",
    path: "post_duplicate",
    mutate: ({ harness, recovered }) =>
      harness.tamperFrozenServiceContext(recovered.draft.turnTrace.turnId, {
        expectedCatalogVersion: "f".repeat(64),
      }),
  },
  {
    name: "tampered frozen prompt hash",
    path: "pre_accept",
    mutate: ({ harness, recovered }) =>
      harness.tamperFrozenInvocationForTest(recovered.draft.turnTrace.turnId, {
        promptHash: "f".repeat(64),
      }),
  },
  {
    name: "tampered frozen context hash",
    path: "post_duplicate",
    mutate: ({ harness, recovered }) =>
      harness.tamperFrozenInvocationForTest(recovered.draft.turnTrace.turnId, {
        contextHash: "f".repeat(64),
      }),
  },
  {
    name: "tampered durable draft contract hash",
    path: "pre_accept",
    mutate: ({ harness, recovered }) =>
      harness.repository.tamperDraftForTest(recovered.draft.id, {
        contractHash: "f".repeat(64),
      }),
  },
];

function frozenRetryDraftIdempotencyKey(
  history: Awaited<ReturnType<SettlementConversationPort["getHistory"]>>,
  turnId: string,
): string {
  const metadata = history.turns.find((turn) => turn.id === turnId)
    ?.contextSnapshot?.gatewayContext?.invocationMetadata
    .settlementServiceRetryContext;
  if (
    typeof metadata !== "object" ||
    metadata === null ||
    !("draftIdempotencyKey" in metadata) ||
    typeof metadata.draftIdempotencyKey !== "string"
  ) {
    throw new Error("frozen retry draft key is missing");
  }
  return metadata.draftIdempotencyKey;
}

describe("custom rule authoring service", () => {
  it("atomically finalizes revision one without directly completing the turn", async () => {
    const harness = createHarness([
      clarificationOutput("请确认每小时结算单价？", "confirm_rate"),
    ]);
    const promptText = "  每场直播按时长结算，请逐项确认。\n";

    const result = await harness.service.startSession({
      actor,
      projectId: PROJECT_ID,
      conversationId: CONVERSATION_ID,
      title: "AI 结算规则",
      clientRequestId: "start-request-0001",
      promptText,
      seedContract: contract(),
      initialAmbiguities: [
        {
          code: "confirm_rate",
          question: "请确认每小时结算单价？",
          required: true,
        },
      ],
    });

    expect(result).toMatchObject({
      ok: true,
      kind: "clarifying",
      conversationId: CONVERSATION_ID,
      draft: {
        revisionNumber: 1,
        initialStatus: "clarifying",
        status: "clarifying",
        generatedFormula: null,
        generatedExplanation: null,
        generatedTestCases: [],
        formulaHash: null,
      },
    });
    const atomicInput = harness.repository.finalizeDraftTurnCalls[0];
    const draftInput = atomicInput.draft;
    expect(draftInput).toMatchObject({
      organizationId: ORGANIZATION_ID,
      projectId: PROJECT_ID,
      conversationId: CONVERSATION_ID,
      promptText,
      status: "clarifying",
      turnTrace: {
        turnId: "00000000-0000-4000-8000-000000000201",
        userMessageId: "00000000-0000-4000-8000-000000000301",
        assistantMessageId: "00000000-0000-4000-8000-000000000401",
      },
      generatedFormula: null,
      generatedExplanation: null,
      generatedTestCases: [],
      formulaHash: null,
    });
    expect(harness.conversation.acceptTurn).toHaveBeenCalledWith(
      actor,
      CONVERSATION_ID,
      expect.objectContaining({ content: promptText }),
    );
    expect(harness.conversation.createConversation).not.toHaveBeenCalled();
    expect(atomicInput.completion).toMatchObject({
      providerName: "deterministic",
      content: draftInput.aiResponse.content,
      aiInvocationId: null,
      metadata: {
        contextSnapshotVersion: 7,
        contextSummaryVersion: 3,
        contextMessageIds: ["00000000-0000-4000-8000-000000000301"],
        settlementIdempotencyKey: draftInput.idempotencyKey,
        settlementInitialStatus: "clarifying",
      },
    });
    expectOrdered(harness.events, [
      "conversation.markValidating",
      "repository.finalizeDraftTurn",
    ]);
    expect(harness.conversation.completeTurn).not.toHaveBeenCalled();
  });

  it("requires an existing conversation id and replays the same durable start key", async () => {
    const invalid = createHarness([
      clarificationOutput("Confirm hourly rate?", "confirm_rate"),
    ]);
    await expect(
      invalid.service.startSession({
        actor,
        projectId: PROJECT_ID,
        conversationId: "",
        clientRequestId: "start-request-invalid",
        promptText: "Clarify the settlement rule.",
        seedContract: contract(),
        initialAmbiguities: [
          {
            code: "confirm_rate",
            question: "Confirm hourly rate?",
            required: true,
          },
        ],
      }),
    ).rejects.toMatchObject({ code: "invalid_input" });
    expect(invalid.conversation.createConversation).not.toHaveBeenCalled();
    expect(invalid.repository.createDraftCalls).toHaveLength(0);

    const replay = createHarness([
      clarificationOutput("Confirm hourly rate?", "confirm_rate"),
    ]);
    const input = {
      actor,
      projectId: PROJECT_ID,
      conversationId: CONVERSATION_ID,
      clientRequestId: "start-request-replay",
      promptText: "Clarify the settlement rule.",
      seedContract: contract(),
      initialAmbiguities: [
        {
          code: "confirm_rate",
          question: "Confirm hourly rate?",
          required: true,
        },
      ],
    };
    const first = await replay.service.startSession(input);
    const second = await replay.service.startSession(input);
    expect(first).toMatchObject({ ok: true, duplicate: false });
    expect(second).toMatchObject({ ok: true, duplicate: true });
    expect(replay.repository.createDraftCalls).toHaveLength(1);
    expect(replay.conversation.acceptTurn).toHaveBeenCalledTimes(1);
    expect(replay.conversation.createConversation).not.toHaveBeenCalled();
  });

  it("recovers an expired start that crashed after accept without duplicating its user message", async () => {
    const harness = createHarness([
      clarificationOutput("Confirm the hourly rate?", "confirm_rate"),
    ]);
    const input = startInput("start-crash-before-prepare-0001");
    const source = await harness.conversation.acceptTurn(
      actor,
      CONVERSATION_ID,
      {
        content: input.promptText,
        mode: "fast",
        clientRequestId: input.clientRequestId,
        attachments: [],
      },
    );
    harness.expireTurn(source.turnId);

    const recovered = await harness.service.startSession(input);

    expect(recovered).toMatchObject({
      ok: true,
      kind: "clarifying",
      duplicate: false,
      draft: {
        revisionNumber: 1,
        turnTrace: { turnId: uuid(202), userMessageId: source.userMessageId },
      },
    });
    expect(harness.conversation.retryTurn).toHaveBeenCalledWith(
      actor,
      source.turnId,
      {
        clientRequestId: expect.stringMatching(
          /^settlement-start-recovery:[a-f0-9]{64}$/u,
        ),
      },
    );
    expect(harness.catalogPort.getCatalog).toHaveBeenCalledTimes(1);
    expect(
      harness.events.filter((event) => event === "ai.prepare"),
    ).toHaveLength(1);
    expect(
      harness.events.filter((event) => event === "ai.restore"),
    ).toHaveLength(0);
    expect(
      harness.events.filter((event) => event === "gateway.execute"),
    ).toHaveLength(1);
    const history = await harness.conversation.getHistory(
      actor,
      CONVERSATION_ID,
    );
    expect(
      history.turns.find((turn) => turn.id === source.turnId),
    ).toMatchObject({
      status: "failed",
      errorCode: "turn_lease_expired",
      retryable: true,
    });
    expect(history.turns.find((turn) => turn.id === uuid(202))).toMatchObject({
      retryOfTurnId: source.turnId,
      status: "completed",
      attempt: 2,
    });
    expect(
      history.messages.filter(
        (message) =>
          message.role === "user" && message.content === input.promptText,
      ),
    ).toHaveLength(1);
  });

  it("recovers a generating start only from its frozen gateway context", async () => {
    const crashedGateway = deferred();
    const harness = createHarness(
      [
        clarificationOutput("Original response is abandoned.", "confirm_rate"),
        clarificationOutput("Recovered frozen response?", "confirm_rate"),
      ],
      { gatewayGates: [crashedGateway.promise, undefined] },
    );
    const input = startInput("start-crash-after-freeze-0001");
    const abandoned = harness.service.startSession(input);
    void abandoned.catch(() => undefined);
    await vi.waitFor(() => {
      expect(harness.conversation.markGenerating).toHaveBeenCalledTimes(1);
      expect(
        harness.events.filter((event) => event === "gateway.execute"),
      ).toHaveLength(1);
    });
    harness.expireTurn(uuid(201));

    const recovered = await harness.service.startSession(input);

    expect(recovered).toMatchObject({
      ok: true,
      kind: "clarifying",
      draft: { turnTrace: { turnId: uuid(202) } },
    });
    expect(harness.catalogPort.getCatalog).toHaveBeenCalledTimes(1);
    expect(
      harness.events.filter((event) => event === "ai.prepare"),
    ).toHaveLength(1);
    expect(
      harness.events.filter((event) => event === "ai.restore"),
    ).toHaveLength(1);
    expect(
      harness.events.filter((event) => event === "gateway.execute"),
    ).toHaveLength(2);
    expect(harness.conversation.captureGatewayContext).toHaveBeenCalledTimes(1);
  });

  it("returns an unexpired duplicate start as in-progress without catalog or AI work", async () => {
    const harness = createHarness([]);
    const input = startInput("start-unexpired-duplicate-0001");
    const source = await harness.conversation.acceptTurn(
      actor,
      CONVERSATION_ID,
      {
        content: input.promptText,
        mode: "fast",
        clientRequestId: input.clientRequestId,
        attachments: [],
      },
    );

    const pending = await harness.service.startSession(input);

    expect(pending).toMatchObject({
      ok: true,
      kind: "retry_in_progress",
      turn: {
        turnId: source.turnId,
        status: "accepted",
        duplicate: true,
      },
    });
    expect(harness.catalogPort.getCatalog).not.toHaveBeenCalled();
    expect(harness.conversation.prepareTurn).not.toHaveBeenCalled();
    expect(harness.conversation.retryTurn).not.toHaveBeenCalled();
    expect(harness.events).not.toContain("gateway.execute");
  });

  it("shares one recovery successor across concurrent starts and replays its durable draft", async () => {
    const recoveryGateway = deferred();
    const harness = createHarness(
      [clarificationOutput("Recovered once?", "confirm_rate")],
      { gatewayGates: [recoveryGateway.promise] },
    );
    const input = startInput("start-concurrent-recovery-0001");
    const source = await harness.conversation.acceptTurn(
      actor,
      CONVERSATION_ID,
      {
        content: input.promptText,
        mode: "fast",
        clientRequestId: input.clientRequestId,
        attachments: [],
      },
    );
    harness.expireTurn(source.turnId);

    const owner = harness.service.startSession(input);
    void owner.catch(() => undefined);
    await vi.waitFor(() => {
      expect(
        harness.events.filter((event) => event === "gateway.execute"),
      ).toHaveLength(1);
      expect(harness.conversation.markGenerating).toHaveBeenCalledTimes(1);
    });
    const concurrent = await harness.service.startSession(input);

    expect(concurrent).toMatchObject({
      ok: true,
      kind: "retry_in_progress",
      turn: { turnId: uuid(202), status: "generating", duplicate: true },
    });
    const activeHistory = await harness.conversation.getHistory(
      actor,
      CONVERSATION_ID,
    );
    expect(
      activeHistory.turns.filter(
        (turn) => turn.retryOfTurnId === source.turnId,
      ),
    ).toHaveLength(1);
    expect(
      activeHistory.messages.find(
        (message) => message.id === source.assistantMessageId,
      ),
    ).toMatchObject({ status: "superseded" });
    expect(harness.repository.finalizeDraftTurnCalls).toHaveLength(0);
    recoveryGateway.resolve();
    await expect(owner).resolves.toMatchObject({
      ok: true,
      kind: "clarifying",
      duplicate: false,
    });

    const replay = await harness.service.startSession(input);
    expect(replay).toMatchObject({
      ok: true,
      kind: "clarifying",
      duplicate: true,
      draft: { turnTrace: { turnId: uuid(202) } },
    });
    expect(
      harness.events.filter((event) => event === "gateway.execute"),
    ).toHaveLength(1);
    expect(harness.repository.finalizeDraftTurnCalls).toHaveLength(1);
  });

  it("fails the recovery successor when frozen start metadata is tampered", async () => {
    const crashedGateway = deferred();
    const harness = createHarness(
      [
        clarificationOutput("Original response is abandoned.", "confirm_rate"),
        clarificationOutput("Must never execute.", "confirm_rate"),
      ],
      { gatewayGates: [crashedGateway.promise, undefined] },
    );
    const input = startInput("start-tampered-frozen-recovery-0001");
    const abandoned = harness.service.startSession(input);
    void abandoned.catch(() => undefined);
    await vi.waitFor(() => {
      expect(harness.conversation.markGenerating).toHaveBeenCalledTimes(1);
    });
    harness.expireTurn(uuid(201));
    harness.tamperFrozenServiceContext(uuid(201), {
      projectId: uuid(999),
    });

    await expect(harness.service.startSession(input)).rejects.toMatchObject({
      code: "conversation_failed",
      retryable: true,
      sourceTurnId: uuid(202),
    });
    expect(harness.catalogPort.getCatalog).toHaveBeenCalledTimes(1);
    expect(
      harness.events.filter((event) => event === "gateway.execute"),
    ).toHaveLength(1);
    expect(harness.conversation.failTurn).toHaveBeenLastCalledWith(
      actor,
      uuid(202),
      expect.objectContaining({ errorCode: "settlement_retry_setup_failed" }),
    );
  });

  it("fails closed when a recovery successor is terminal without a durable draft", async () => {
    for (const terminalStatus of ["completed", "failed"] as const) {
      const recoveryGateway = deferred();
      const harness = createHarness(
        [clarificationOutput("Abandoned recovery.", "confirm_rate")],
        { gatewayGates: [recoveryGateway.promise] },
      );
      const input = startInput(`start-${terminalStatus}-without-draft-0001`);
      const source = await harness.conversation.acceptTurn(
        actor,
        CONVERSATION_ID,
        {
          content: input.promptText,
          mode: "fast",
          clientRequestId: input.clientRequestId,
          attachments: [],
        },
      );
      harness.expireTurn(source.turnId);
      const abandoned = harness.service.startSession(input);
      void abandoned.catch(() => undefined);
      await vi.waitFor(() => {
        expect(harness.conversation.markGenerating).toHaveBeenCalledTimes(1);
      });
      const history = await harness.conversation.getHistory(
        actor,
        CONVERSATION_ID,
      );
      const successor = history.turns.find(
        (turn) => turn.retryOfTurnId === source.turnId,
      );
      if (!successor?.contextSnapshot) {
        throw new Error("recovery successor snapshot is missing");
      }
      if (terminalStatus === "completed") {
        harness.transitionTurnForTest(successor.id, "completed", {
          providerName: "deterministic",
          content: "Orphaned completed recovery.",
          aiInvocationId: null,
          metadata: {
            contextSnapshotVersion: successor.contextSnapshot.version,
            contextSummaryVersion: successor.contextSnapshot.summaryVersion,
            contextMessageIds: [...successor.contextSnapshot.messageIds],
            settlementIdempotencyKey: frozenRetryDraftIdempotencyKey(
              history,
              successor.id,
            ),
            settlementInitialStatus: "clarifying",
          },
        });
      } else {
        harness.transitionTurnForTest(successor.id, "failed", undefined, {
          errorCode: "settlement_recovery_failed",
          retryable: true,
        });
      }

      await expect(harness.service.startSession(input)).rejects.toMatchObject({
        code: "conversation_failed",
        retryable: false,
        sourceTurnId: successor.id,
      });
      const finalHistory = await harness.conversation.getHistory(
        actor,
        CONVERSATION_ID,
      );
      expect(
        finalHistory.turns.filter(
          (turn) => turn.retryOfTurnId === source.turnId,
        ),
      ).toHaveLength(1);
      expect(
        harness.events.filter((event) => event === "gateway.execute"),
      ).toHaveLength(1);
    }
  });

  it.each(INELIGIBLE_EXPIRED_START_CASES)(
    "rejects an ineligible expired start source: $name",
    async ({ mutate }) => {
      const harness = createHarness([]);
      const input = startInput("start-ineligible-source-0001");
      const source = await harness.conversation.acceptTurn(
        actor,
        CONVERSATION_ID,
        {
          content: input.promptText,
          mode: "fast",
          clientRequestId: input.clientRequestId,
          attachments: [],
        },
      );
      harness.expireTurn(source.turnId);
      mutate(harness, source);

      await expect(harness.service.startSession(input)).rejects.toMatchObject({
        code: "conversation_failed",
        retryable: false,
        sourceTurnId: source.turnId,
      });
      expect(harness.conversation.retryTurn).not.toHaveBeenCalled();
      expect(harness.catalogPort.getCatalog).not.toHaveBeenCalled();
      expect(harness.events).not.toContain("gateway.execute");
      expect(harness.repository.createDraftCalls).toHaveLength(0);
      expect(harness.repository.finalizeDraftTurnCalls).toHaveLength(0);
      expect(harness.repository.finalizeFailedTurnCalls).toHaveLength(0);
    },
  );

  it.each(["pre_accept", "post_duplicate"] as const)(
    "replays a verified durable recovery through $path without authoring side effects",
    async (path) => {
      const fixture = await recoveredStartFixture(
        `verified-recovery-${path}-0001`,
      );
      if (path === "post_duplicate") {
        fixture.harness.repository.hideDraftOnceForTest(
          fixture.recovered.draft.idempotencyKey,
        );
      }
      const before = recoveryActivity(fixture.harness);

      const replay = await fixture.harness.service.startSession(fixture.input);

      expect(replay).toMatchObject({
        ok: true,
        kind: "clarifying",
        duplicate: true,
        draft: {
          id: fixture.recovered.draft.id,
          turnTrace: fixture.recovered.draft.turnTrace,
        },
      });
      const after = recoveryActivity(fixture.harness);
      expect(after).toEqual({
        ...before,
        accept: before.accept + (path === "post_duplicate" ? 1 : 0),
      });
    },
  );

  it.each([
    { path: "pre_accept" as const, freshReadsBeforeStale: 0 },
    { path: "post_duplicate" as const, freshReadsBeforeStale: 1 },
  ])(
    "converges a mixed $path recovery replay to the same terminal draft",
    async ({ path, freshReadsBeforeStale }) => {
      const fixture = await recoveredStartFixture(
        `mixed-recovery-${path}-0001`,
      );
      if (path === "post_duplicate") {
        fixture.harness.repository.hideDraftOnceForTest(
          fixture.recovered.draft.idempotencyKey,
        );
      }
      fixture.harness.queueMixedRecoveryHistoryForTest(
        fixture.recovered.draft.turnTrace.turnId,
        freshReadsBeforeStale,
      );
      const before = recoveryActivity(fixture.harness);
      const historyReadsBefore = vi.mocked(
        fixture.harness.conversation.getHistory,
      ).mock.calls.length;
      const draftReadsBefore = fixture.harness.events.filter(
        (event) => event === "repository.listDrafts",
      ).length;

      const replay = await fixture.harness.service.startSession(fixture.input);

      expect(replay).toMatchObject({
        ok: true,
        kind: "clarifying",
        duplicate: true,
        draft: {
          id: fixture.recovered.draft.id,
          aiResponse: fixture.recovered.draft.aiResponse,
          turnTrace: fixture.recovered.draft.turnTrace,
        },
      });
      expect(
        vi.mocked(fixture.harness.conversation.getHistory).mock.calls.length -
          historyReadsBefore,
      ).toBe(path === "post_duplicate" ? 4 : 3);
      expect(
        fixture.harness.events.filter(
          (event) => event === "repository.listDrafts",
        ).length - draftReadsBefore,
      ).toBe(path === "post_duplicate" ? 4 : 3);
      expect(recoveryActivity(fixture.harness)).toEqual({
        ...before,
        accept: before.accept + (path === "post_duplicate" ? 1 : 0),
      });
    },
  );

  it("exhausts the bounded reread before rejecting a persistent recovery mismatch", async () => {
    const fixture = await recoveredStartFixture(
      "persistent-recovery-mismatch-0001",
    );
    fixture.harness.tamperMessageForTest(
      fixture.recovered.draft.turnTrace.assistantMessageId,
      { content: "Persistently tampered assistant content." },
    );
    const before = recoveryActivity(fixture.harness);
    const historyReadsBefore = vi.mocked(
      fixture.harness.conversation.getHistory,
    ).mock.calls.length;
    const draftReadsBefore = fixture.harness.events.filter(
      (event) => event === "repository.listDrafts",
    ).length;

    await expect(
      fixture.harness.service.startSession(fixture.input),
    ).rejects.toMatchObject({
      code: "conversation_failed",
      retryable: false,
    });

    expect(
      vi.mocked(fixture.harness.conversation.getHistory).mock.calls.length -
        historyReadsBefore,
    ).toBe(5);
    expect(
      fixture.harness.events.filter(
        (event) => event === "repository.listDrafts",
      ).length - draftReadsBefore,
    ).toBe(5);
    expect(recoveryActivity(fixture.harness)).toEqual(before);
  });

  it.each(["pre_accept", "post_duplicate"] as const)(
    "replays $path recovery with canonically equivalent ambiguity ordering",
    async (path) => {
      const fixture = await recoveredStartFixture(
        `unordered-ambiguity-${path}-0001`,
        OUT_OF_ORDER_AMBIGUITIES,
      );
      if (path === "post_duplicate") {
        fixture.harness.repository.hideDraftOnceForTest(
          fixture.recovered.draft.idempotencyKey,
        );
      }
      const before = recoveryActivity(fixture.harness);

      const replay = await fixture.harness.service.startSession(fixture.input);

      expect(replay).toMatchObject({
        ok: true,
        kind: "clarifying",
        duplicate: true,
        draft: { id: fixture.recovered.draft.id },
      });
      expect(recoveryActivity(fixture.harness)).toEqual({
        ...before,
        accept: before.accept + (path === "post_duplicate" ? 1 : 0),
      });
    },
  );

  it.each([
    {
      name: "field",
      tamper: (ambiguities: SettlementAiUnresolvedAmbiguity[]) => [
        { ...ambiguities[0], question: "Confirm a tampered effective date?" },
        ...ambiguities.slice(1),
      ],
    },
    {
      name: "membership",
      tamper: (ambiguities: SettlementAiUnresolvedAmbiguity[]) =>
        ambiguities.slice(1),
    },
  ])(
    "fails closed when canonical frozen ambiguity $name is tampered",
    async ({ tamper }) => {
      const fixture = await recoveredStartFixture(
        "tampered-canonical-ambiguity-0001",
        OUT_OF_ORDER_AMBIGUITIES,
      );
      const canonical = [...OUT_OF_ORDER_AMBIGUITIES].sort((left, right) =>
        left.code.localeCompare(right.code),
      );
      fixture.harness.tamperFrozenAiAmbiguitiesForTest(
        fixture.recovered.draft.turnTrace.turnId,
        tamper(canonical),
      );
      const before = recoveryActivity(fixture.harness);

      await expect(
        fixture.harness.service.startSession(fixture.input),
      ).rejects.toMatchObject({
        code: "conversation_failed",
        retryable: false,
      });
      expect(recoveryActivity(fixture.harness)).toEqual(before);
    },
  );

  it("preserves ordinary start replay through a post-duplicate draft readback", async () => {
    const harness = createHarness([
      clarificationOutput("Confirm the hourly rate?", "confirm_rate"),
    ]);
    const input = startInput("ordinary-post-duplicate-replay-0001");
    const first = await harness.service.startSession(input);
    if (!first.ok || first.kind !== "clarifying") {
      throw new Error("ordinary replay fixture did not create a draft");
    }
    harness.repository.hideDraftOnceForTest(first.draft.idempotencyKey);
    const before = recoveryActivity(harness);

    const replay = await harness.service.startSession(input);

    expect(replay).toMatchObject({
      ok: true,
      kind: "clarifying",
      duplicate: true,
      draft: { id: first.draft.id, turnTrace: first.draft.turnTrace },
    });
    expect(recoveryActivity(harness)).toEqual({
      ...before,
      accept: before.accept + 1,
    });
  });

  it.each(TAMPERED_RECOVERY_REPLAY_CASES)(
    "fails closed for $path durable recovery replay with $name",
    async ({ name, path, mutate }) => {
      const fixture = await recoveredStartFixture(
        `tampered-recovery-${path}-${name.replaceAll(" ", "-")}`,
      );
      mutate(fixture);
      if (path === "post_duplicate") {
        fixture.harness.repository.hideDraftOnceForTest(
          fixture.recovered.draft.idempotencyKey,
        );
      }
      const before = recoveryActivity(fixture.harness);

      await expect(
        fixture.harness.service.startSession(fixture.input),
      ).rejects.toMatchObject({
        code: "conversation_failed",
        retryable: false,
      });

      const after = recoveryActivity(fixture.harness);
      expect(after).toEqual({
        ...before,
        accept: before.accept + (path === "post_duplicate" ? 1 : 0),
      });
    },
  );

  it("replays a failed initial draft as a failure and rejects prompts over 4000 before AI", async () => {
    const failedStart = createHarness([{ providerFailure: true }], {
      persistFailedRevisions: true,
    });
    const input = {
      actor,
      projectId: PROJECT_ID,
      conversationId: CONVERSATION_ID,
      clientRequestId: "failed-start-replay-0001",
      promptText: "Start a settlement draft.",
      seedContract: contract(),
      initialAmbiguities: [
        {
          code: "confirm_rate",
          question: "Confirm the hourly rate?",
          required: true,
        },
      ],
    };

    const first = await failedStart.service.startSession(input);
    const replay = await failedStart.service.startSession(input);

    expect(first).toMatchObject({
      ok: false,
      code: "SETTLEMENT_AI_PROVIDER_FAILED",
      failedDraft: { initialStatus: "failed", revisionNumber: 1 },
    });
    expect(replay).toMatchObject({
      ok: false,
      code: "SETTLEMENT_AI_PROVIDER_FAILED",
      failedDraft: { initialStatus: "failed", revisionNumber: 1 },
    });
    expect(failedStart.repository.createDraftCalls).toHaveLength(1);
    expect(failedStart.conversation.acceptTurn).toHaveBeenCalledTimes(1);
    expect(
      failedStart.events.filter((event) => event === "gateway.execute"),
    ).toHaveLength(1);

    const oversized = createHarness([
      clarificationOutput("Confirm the hourly rate?", "confirm_rate"),
    ]);
    await expect(
      oversized.service.startSession({
        ...input,
        clientRequestId: "oversized-start-prompt-0001",
        promptText: "x".repeat(4_001),
      }),
    ).rejects.toMatchObject({ code: "invalid_input" });
    expect(oversized.conversation.getHistory).not.toHaveBeenCalled();
    expect(oversized.conversation.acceptTurn).not.toHaveBeenCalled();
    expect(oversized.events).not.toContain("gateway.execute");
  });

  it("reconciles unknown atomic start commits and retries rollback with the frozen operation key", async () => {
    const harness = createHarness(
      [clarificationOutput("Confirm the hourly rate?", "confirm_rate")],
      { atomicDraftFailure: "after_commit" },
    );
    const input = {
      actor,
      projectId: PROJECT_ID,
      conversationId: CONVERSATION_ID,
      clientRequestId: "start-completion-only-0001",
      promptText: "Clarify the settlement rule.",
      seedContract: contract(),
      initialAmbiguities: [
        {
          code: "confirm_rate",
          question: "Confirm the hourly rate?",
          required: true,
        },
      ],
    };

    const committed = await harness.service.startSession(input);
    expect(committed).toMatchObject({
      ok: true,
      kind: "clarifying",
      duplicate: true,
      draft: { revisionNumber: 1, status: "clarifying" },
    });
    expect(harness.repository.finalizeDraftTurnCalls).toHaveLength(1);
    expect(harness.conversation.completeTurn).not.toHaveBeenCalled();
    expect(harness.conversation.failTurn).not.toHaveBeenCalled();

    const rolledBack = createHarness(
      [
        clarificationOutput("Confirm the hourly rate?", "confirm_rate"),
        clarificationOutput("Confirm the hourly rate?", "confirm_rate"),
      ],
      { atomicDraftFailure: "before_write" },
    );
    const failed = await rolledBack.service.startSession({
      ...input,
      clientRequestId: "start-atomic-rollback-0001",
    });
    expect(failed).toMatchObject({
      ok: false,
      code: "persistence_failed",
      retryable: true,
      sourceTurnId: uuid(201),
      failedDraft: null,
    });
    if (failed.ok)
      throw new Error("atomic rollback fixture unexpectedly passed");
    expect(rolledBack.repository.atomicFailureSnapshots).toEqual([
      {
        kind: "draft",
        draftCount: 0,
        simulationCount: 0,
        turnStatus: "validating",
      },
    ]);

    const recovered = await rolledBack.service.retryTurn({
      actor,
      projectId: PROJECT_ID,
      conversationId: CONVERSATION_ID,
      sourceTurnId: failed.sourceTurnId,
      clientRequestId: "start-atomic-rollback-retry-0001",
    });

    expect(recovered).toMatchObject({
      ok: true,
      kind: "clarifying",
      duplicate: false,
      draft: { revisionNumber: 1 },
    });
    expect(
      rolledBack.events.filter((event) => event === "gateway.execute"),
    ).toHaveLength(2);
    expect(rolledBack.catalogPort.getCatalog).toHaveBeenCalledTimes(1);
    expect(rolledBack.conversation.captureGatewayContext).toHaveBeenCalledTimes(
      1,
    );
    expect(rolledBack.repository.finalizeDraftTurnCalls).toHaveLength(2);
    expect(
      rolledBack.repository.finalizeDraftTurnCalls[1].draft.idempotencyKey,
    ).toBe(
      rolledBack.repository.finalizeDraftTurnCalls[0].draft.idempotencyKey,
    );
    expect(
      rolledBack.evidencePort.loadAuthorizedEvidence,
    ).not.toHaveBeenCalled();
    expect(rolledBack.conversation.completeTurn).not.toHaveBeenCalled();

    const nonrecoverable = createHarness(
      [clarificationOutput("Confirm the hourly rate?", "confirm_rate")],
      { atomicDraftFailure: "before_write", failFailTurn: true },
    );
    await expect(
      nonrecoverable.service.startSession({
        ...input,
        clientRequestId: "start-atomic-nonrecoverable-0001",
      }),
    ).rejects.toMatchObject({
      code: "conversation_reconciliation_failed",
      retryable: false,
      sourceTurnId: uuid(201),
    });
  });

  it("fails the owned retry turn when a clarifying atomic partial artifact remains", async () => {
    const harness = createHarness([{ providerFailure: true }]);
    const failed = await harness.service.startSession({
      actor,
      projectId: PROJECT_ID,
      conversationId: CONVERSATION_ID,
      clientRequestId: "clarifying-partial-source-0001",
      promptText: "Clarify the settlement rule.",
      seedContract: contract(),
      initialAmbiguities: [
        {
          code: "confirm_rate",
          question: "Confirm the hourly rate?",
          required: true,
        },
      ],
    });
    if (failed.ok) throw new Error("clarifying source unexpectedly passed");
    const sourceHistory = await harness.conversation.getHistory(
      actor,
      CONVERSATION_ID,
    );
    harness.repository.seedDraft(
      clarifyingDraft({
        idempotencyKey: frozenRetryDraftIdempotencyKey(
          sourceHistory,
          failed.sourceTurnId,
        ),
        turnTrace: {
          turnId: uuid(611),
          userMessageId: uuid(612),
          assistantMessageId: uuid(613),
        },
      }),
    );

    await expect(
      harness.service.retryTurn({
        actor,
        projectId: PROJECT_ID,
        conversationId: CONVERSATION_ID,
        sourceTurnId: failed.sourceTurnId,
        clientRequestId: "clarifying-partial-retry-0001",
      }),
    ).rejects.toMatchObject({
      code: "conversation_reconciliation_failed",
      sourceTurnId: uuid(202),
    });

    const history = await harness.conversation.getHistory(
      actor,
      CONVERSATION_ID,
    );
    expect(history.turns.find((turn) => turn.id === uuid(202))).toMatchObject({
      status: "failed",
      errorCode: "settlement_post_open_validation_failed",
      retryable: false,
    });
    expect(harness.conversation.failTurn).toHaveBeenLastCalledWith(
      actor,
      uuid(202),
      expect.objectContaining({
        errorCode: "settlement_post_open_validation_failed",
        retryable: false,
      }),
    );
    expect(
      harness.events.filter((event) => event === "gateway.execute"),
    ).toHaveLength(1);
    expect(harness.repository.finalizeDraftTurnCalls).toHaveLength(0);
  });

  it("fails the owned retry turn when a contract-ready partial artifact remains", async () => {
    const harness = createHarness([{ providerFailure: true }]);
    const previous = harness.repository.seedDraft(confirmableDraft());
    const failed = await harness.service.confirmContract({
      actor,
      projectId: PROJECT_ID,
      conversationId: CONVERSATION_ID,
      expectedDraftId: previous.id,
      expectedRevisionNumber: previous.revisionNumber,
      clientRequestId: "contract-partial-source-0001",
      promptText: "Confirm this settlement contract.",
      contractConfirmed: true,
      expectedContractHash: previous.contractHash,
      expectedCatalogVersion: previous.variableCatalogVersion,
      simulationSelection: safeSelection(),
    });
    if (failed.ok) throw new Error("confirmation source unexpectedly passed");
    const sourceHistory = await harness.conversation.getHistory(
      actor,
      CONVERSATION_ID,
    );
    const partial = simulatedDraft();
    partial.id = uuid(620);
    partial.idempotencyKey = frozenRetryDraftIdempotencyKey(
      sourceHistory,
      failed.sourceTurnId,
    );
    partial.turnTrace = {
      turnId: uuid(621),
      userMessageId: uuid(622),
      assistantMessageId: uuid(623),
    };
    partial.status = "contract_ready";
    partial.revisionNumber = 2;
    partial.supersedesDraftId = previous.id;
    harness.repository.seedDraft(partial);

    await expect(
      harness.service.retryTurn({
        actor,
        projectId: PROJECT_ID,
        conversationId: CONVERSATION_ID,
        sourceTurnId: failed.sourceTurnId,
        clientRequestId: "contract-partial-retry-0001",
      }),
    ).rejects.toMatchObject({
      code: "conversation_reconciliation_failed",
      sourceTurnId: uuid(202),
    });

    const history = await harness.conversation.getHistory(
      actor,
      CONVERSATION_ID,
    );
    expect(history.turns.find((turn) => turn.id === uuid(202))).toMatchObject({
      status: "failed",
      errorCode: "settlement_post_open_validation_failed",
      retryable: false,
    });
    expect(harness.conversation.failTurn).toHaveBeenLastCalledWith(
      actor,
      uuid(202),
      expect.objectContaining({
        errorCode: "settlement_post_open_validation_failed",
        retryable: false,
      }),
    );
    expect(
      harness.events.filter((event) => event === "gateway.execute"),
    ).toHaveLength(1);
    expect(harness.repository.finalizeSimulationTurnCalls).toHaveLength(0);
  });

  it("revises by appending the generic turn first, preserves prior evidence, and replays idempotently", async () => {
    const harness = createHarness([
      {
        contractPatch: {
          summary: "每场直播按系统时长结算，其他已确认条件保持不变。",
        },
        unresolvedAmbiguities: [],
        nextQuestion: "请确认以上业务规则无误？",
        formulaProposal: null,
        testCases: [],
        safetyFlags: [],
      },
    ]);
    const previous = harness.repository.seedDraft(clarifyingDraft());
    const previousEvidence = structuredClone(previous);

    const input = {
      actor,
      projectId: PROJECT_ID,
      conversationId: CONVERSATION_ID,
      expectedDraftId: previous.id,
      expectedRevisionNumber: 1,
      clientRequestId: "revise-request-0001",
      promptText: "只调整摘要，其他条件不变。",
    };
    const first = await harness.service.answerOrRevise(input);
    const replay = await harness.service.answerOrRevise(input);

    expect(first).toMatchObject({
      ok: true,
      kind: "clarifying",
      duplicate: false,
      draft: {
        revisionNumber: 2,
        generatedFormula: null,
        generatedExplanation: null,
        generatedTestCases: [],
        formulaHash: null,
        unresolvedAmbiguities: [
          {
            code: "confirm_contract",
            question: "请确认以上业务规则无误？",
            required: true,
          },
        ],
      },
      diff: [
        {
          field: "summary",
          before: previous.businessContract.summary,
          after: "每场直播按系统时长结算，其他已确认条件保持不变。",
        },
      ],
    });
    expect(replay).toMatchObject({
      ok: true,
      duplicate: true,
      draft: {
        id: first.ok && first.kind === "clarifying" ? first.draft.id : "",
      },
    });
    expect(harness.conversation.acceptTurn).toHaveBeenCalledTimes(1);
    expect(harness.repository.createDraftCalls).toHaveLength(1);
    expect(harness.events.indexOf("conversation.acceptTurn")).toBeLessThan(
      harness.events.indexOf("repository.finalizeDraftTurn"),
    );
    expect(harness.conversation.completeTurn).not.toHaveBeenCalled();
    expect(previous.businessContract).toEqual(
      previousEvidence.businessContract,
    );
    expect(previous.generatedFormula).toEqual(
      previousEvidence.generatedFormula,
    );
    expect(previous.generatedTestCases).toEqual(
      previousEvidence.generatedTestCases,
    );
  });

  it("reads back a matching atomic revision after the commit response is lost", async () => {
    const output = {
      contractPatch: {
        summary: "每场直播按系统时长结算，其他已确认条件保持不变。",
      },
      unresolvedAmbiguities: [],
      nextQuestion: "请确认以上业务规则无误？",
      formulaProposal: null,
      testCases: [],
      safetyFlags: [],
    };
    const harness = createHarness([output], {
      atomicDraftFailure: "after_commit",
    });
    const previous = harness.repository.seedDraft(clarifyingDraft());
    const revision = {
      actor,
      projectId: PROJECT_ID,
      conversationId: CONVERSATION_ID,
      expectedDraftId: previous.id,
      expectedRevisionNumber: 1,
      clientRequestId: "revise-completion-only-0001",
      promptText: "Update only the summary.",
    };

    const recovered = await harness.service.answerOrRevise(revision);
    expect(recovered).toMatchObject({
      ok: true,
      kind: "clarifying",
      duplicate: true,
      draft: {
        revisionNumber: 2,
        initialStatus: "clarifying",
        status: "clarifying",
      },
    });
    expect(
      harness.events.filter((event) => event === "gateway.execute"),
    ).toHaveLength(1);
    expect(harness.catalogPort.getCatalog).toHaveBeenCalledTimes(1);
    expect(harness.conversation.captureGatewayContext).toHaveBeenCalledTimes(1);
    expect(harness.repository.finalizeDraftTurnCalls).toHaveLength(1);
    expect(harness.evidencePort.loadAuthorizedEvidence).not.toHaveBeenCalled();
    expect(harness.conversation.completeTurn).not.toHaveBeenCalled();
    expect(harness.conversation.failTurn).not.toHaveBeenCalled();

    const mismatch = createHarness([structuredClone(output)], {
      atomicDraftFailure: "partial",
    });
    const mismatchPrevious = mismatch.repository.seedDraft(clarifyingDraft());
    await expect(
      mismatch.service.answerOrRevise({
        ...revision,
        expectedDraftId: mismatchPrevious.id,
        clientRequestId: "revise-atomic-partial-0001",
      }),
    ).rejects.toMatchObject({
      code: "conversation_reconciliation_failed",
      retryable: false,
      sourceTurnId: uuid(201),
    });
    expect(
      mismatch.events.filter((event) => event === "gateway.execute"),
    ).toHaveLength(1);
    expect(mismatch.repository.finalizeDraftTurnCalls).toHaveLength(1);
    expect(mismatch.evidencePort.loadAuthorizedEvidence).not.toHaveBeenCalled();
  });

  it("atomically completes with the selected question and rejects tampered readback", async () => {
    const selectedQuestion = "请确认规则生效日期？";
    const output = {
      contractPatch: {},
      unresolvedAmbiguities: [
        {
          code: "b_date",
          question: selectedQuestion,
          required: true,
        },
        {
          code: "a_rate",
          question: "请确认每小时费率？",
          required: true,
        },
      ],
      nextQuestion: selectedQuestion,
      formulaProposal: null,
      testCases: [],
      safetyFlags: [],
    };
    const harness = createHarness([output]);
    const previous = harness.repository.seedDraft(clarifyingDraft());

    const result = await harness.service.answerOrRevise({
      actor,
      projectId: PROJECT_ID,
      conversationId: CONVERSATION_ID,
      expectedDraftId: previous.id,
      expectedRevisionNumber: 1,
      clientRequestId: "revise-selected-question-0001",
      promptText: "Keep both ambiguities and ask about the date first.",
    });
    expect(result).toMatchObject({
      ok: true,
      kind: "clarifying",
      draft: {
        aiResponse: { content: selectedQuestion },
        unresolvedAmbiguities: [{ code: "a_rate" }, { code: "b_date" }],
      },
    });
    expect(harness.repository.finalizeDraftTurnCalls[0]).toMatchObject({
      draft: { aiResponse: { content: selectedQuestion } },
      completion: { content: selectedQuestion },
    });
    expect(harness.conversation.completeTurn).not.toHaveBeenCalled();
    expect(
      harness.events.filter((event) => event === "gateway.execute"),
    ).toHaveLength(1);
    expect(harness.catalogPort.getCatalog).toHaveBeenCalledTimes(1);
    expect(harness.repository.finalizeDraftTurnCalls).toHaveLength(1);
    expect(harness.evidencePort.loadAuthorizedEvidence).not.toHaveBeenCalled();
    expect(harness.repository.insertSimulationCalls).toHaveLength(0);

    const tampered = createHarness([structuredClone(output)], {
      atomicDraftFailure: "after_commit",
      tamperAtomicDraftAfterCommit: "content",
    });
    const tamperedPrevious = tampered.repository.seedDraft(clarifyingDraft());
    await expect(
      tampered.service.answerOrRevise({
        actor,
        projectId: PROJECT_ID,
        conversationId: CONVERSATION_ID,
        expectedDraftId: tamperedPrevious.id,
        expectedRevisionNumber: 1,
        clientRequestId: "revise-selected-question-tampered-0001",
        promptText: "Keep both ambiguities and ask about the date first.",
      }),
    ).rejects.toMatchObject({
      code: "conversation_reconciliation_failed",
      retryable: false,
    });
    expect(
      tampered.events.filter((event) => event === "gateway.execute"),
    ).toHaveLength(1);
    expect(tampered.repository.finalizeDraftTurnCalls).toHaveLength(1);
  });

  it("atomically records an explicitly owned failed revision and generic failure", async () => {
    const harness = createHarness([{ providerFailure: true }], {
      persistFailedRevisions: true,
    });
    const previous = harness.repository.seedDraft(clarifyingDraft());
    const priorSnapshot = structuredClone(previous);

    const result = await harness.service.answerOrRevise({
      actor,
      projectId: PROJECT_ID,
      conversationId: CONVERSATION_ID,
      expectedDraftId: previous.id,
      expectedRevisionNumber: 1,
      clientRequestId: "failed-revision-request-0001",
      promptText: "继续生成规则。",
    });

    expect(result).toMatchObject({
      ok: false,
      code: "SETTLEMENT_AI_PROVIDER_FAILED",
      retryable: true,
      failedDraft: {
        initialStatus: "failed",
        generatedFormula: null,
        generatedExplanation: null,
        generatedTestCases: [],
        formulaHash: null,
      },
    });
    expect(harness.repository.createDraftCalls[0].status).toBe("failed");
    expect(harness.repository.finalizeFailedTurnCalls).toHaveLength(1);
    expect(harness.repository.finalizeFailedTurnCalls[0]).toMatchObject({
      draft: { status: "failed" },
      completion: {
        content: "Settlement AI provider is temporarily unavailable.",
      },
      errorCode: "SETTLEMENT_AI_PROVIDER_FAILED",
      errorSummary:
        SETTLEMENT_AI_FAILED_TURN_ERROR_SUMMARIES.SETTLEMENT_AI_PROVIDER_FAILED,
      retryable: true,
    });
    expectOrdered(harness.events, [
      "conversation.markValidating",
      "repository.finalizeFailedTurn",
    ]);
    expect(harness.conversation.failTurn).not.toHaveBeenCalled();
    expect(harness.conversation.completeTurn).not.toHaveBeenCalled();
    const providerFailureHistory = await harness.conversation.getHistory(
      actor,
      CONVERSATION_ID,
    );
    expect(
      providerFailureHistory.turns.find((turn) => turn.id === uuid(201)),
    ).toMatchObject({
      status: "failed",
      errorCode: "SETTLEMENT_AI_PROVIDER_FAILED",
      retryable: true,
    });
    expect(previous.businessContract).toEqual(priorSnapshot.businessContract);
    expect(previous.generatedFormula).toEqual(priorSnapshot.generatedFormula);
  });

  it("reconciles failed-turn atomic transport outcomes without split writes", async () => {
    const committed = createHarness([{ providerFailure: true }], {
      persistFailedRevisions: true,
      atomicFailedFailure: "after_commit",
    });
    const committedPrevious = committed.repository.seedDraft(clarifyingDraft());

    const readback = await committed.service.answerOrRevise({
      actor,
      projectId: PROJECT_ID,
      conversationId: CONVERSATION_ID,
      expectedDraftId: committedPrevious.id,
      expectedRevisionNumber: 1,
      clientRequestId: "failed-atomic-readback-0001",
      promptText: "Continue authoring the rule.",
    });

    expect(readback).toMatchObject({
      ok: false,
      code: "SETTLEMENT_AI_PROVIDER_FAILED",
      failedDraft: { initialStatus: "failed", duplicate: true },
    });
    expect(committed.repository.finalizeFailedTurnCalls).toHaveLength(1);
    expect(committed.conversation.failTurn).not.toHaveBeenCalled();
    expect(committed.conversation.completeTurn).not.toHaveBeenCalled();

    const rolledBack = createHarness([{ providerFailure: true }], {
      persistFailedRevisions: true,
      atomicFailedFailure: "before_write",
    });
    const rolledBackPrevious =
      rolledBack.repository.seedDraft(clarifyingDraft());
    const failed = await rolledBack.service.answerOrRevise({
      actor,
      projectId: PROJECT_ID,
      conversationId: CONVERSATION_ID,
      expectedDraftId: rolledBackPrevious.id,
      expectedRevisionNumber: 1,
      clientRequestId: "failed-atomic-rollback-0001",
      promptText: "Continue authoring the rule.",
    });

    expect(failed).toMatchObject({
      ok: false,
      code: "persistence_failed",
      sourceTurnId: uuid(201),
      failedDraft: null,
    });
    expect(rolledBack.repository.drafts).toHaveLength(1);
    expect(rolledBack.conversation.failTurn).toHaveBeenCalledTimes(1);
    expect(rolledBack.conversation.completeTurn).not.toHaveBeenCalled();
  });

  it("retries a provider failure from the public frozen conversation turn without live re-grounding", async () => {
    const harness = createHarness([
      { providerFailure: true },
      clarificationOutput("Confirm the final contract?", "confirm_contract"),
    ]);
    const previous = harness.repository.seedDraft(clarifyingDraft());

    const failed = await harness.service.answerOrRevise({
      actor,
      projectId: PROJECT_ID,
      conversationId: CONVERSATION_ID,
      expectedDraftId: previous.id,
      expectedRevisionNumber: 1,
      clientRequestId: "provider-failure-request-0001",
      promptText: "Continue authoring the rule.",
    });
    expect(failed).toMatchObject({
      ok: false,
      code: "SETTLEMENT_AI_PROVIDER_FAILED",
      sourceTurnId: uuid(201),
    });
    if (failed.ok)
      throw new Error("provider failure fixture unexpectedly passed");

    const retried = await harness.service.retryTurn({
      actor,
      projectId: PROJECT_ID,
      conversationId: CONVERSATION_ID,
      sourceTurnId: failed.sourceTurnId,
      clientRequestId: "provider-retry-request-0001",
    });

    expect(retried).toMatchObject({
      ok: true,
      kind: "clarifying",
      draft: { revisionNumber: 2 },
    });
    expect(harness.conversation.retryTurn).toHaveBeenCalledWith(
      actor,
      uuid(201),
      { clientRequestId: "provider-retry-request-0001" },
    );
    expect(harness.catalogPort.getCatalog).toHaveBeenCalledTimes(1);
    expect(harness.conversation.captureGatewayContext).toHaveBeenCalledTimes(1);
    expect(
      harness.events.filter((event) => event === "gateway.execute"),
    ).toHaveLength(2);
  });

  it("retries a persisted failed revision before applying normal stale checks", async () => {
    const harness = createHarness(
      [
        { providerFailure: true },
        clarificationOutput("Confirm the final contract?", "confirm_contract"),
      ],
      { persistFailedRevisions: true },
    );
    const previous = harness.repository.seedDraft(clarifyingDraft());

    const failed = await harness.service.answerOrRevise({
      actor,
      projectId: PROJECT_ID,
      conversationId: CONVERSATION_ID,
      expectedDraftId: previous.id,
      expectedRevisionNumber: 1,
      clientRequestId: "persisted-revise-failure-0001",
      promptText: "Continue the frozen revision.",
    });
    expect(failed).toMatchObject({
      ok: false,
      code: "SETTLEMENT_AI_PROVIDER_FAILED",
      sourceTurnId: uuid(201),
      failedDraft: {
        revisionNumber: 2,
        initialStatus: "failed",
        status: "failed",
      },
    });
    if (failed.ok || !failed.failedDraft) {
      throw new Error("persisted revision failure fixture unexpectedly passed");
    }

    const recovered = await harness.service.retryTurn({
      actor,
      projectId: PROJECT_ID,
      conversationId: CONVERSATION_ID,
      sourceTurnId: failed.sourceTurnId,
      clientRequestId: "persisted-revise-retry-0001",
    });

    expect(recovered).toMatchObject({
      ok: true,
      kind: "clarifying",
      draft: { revisionNumber: 3, initialStatus: "clarifying" },
    });
    expect(harness.repository.createDraftCalls).toHaveLength(2);
    expect(harness.repository.createDraftCalls[1].idempotencyKey).toMatch(
      /^settlement-retry:/u,
    );
    expect(harness.catalogPort.getCatalog).toHaveBeenCalledTimes(1);
    expect(harness.conversation.captureGatewayContext).toHaveBeenCalledTimes(1);
    expect(
      harness.events.filter((event) => event === "gateway.execute"),
    ).toHaveLength(2);
    expect(harness.evidencePort.loadAuthorizedEvidence).not.toHaveBeenCalled();

    await expect(
      harness.service.retryTurn({
        actor,
        projectId: PROJECT_ID,
        conversationId: CONVERSATION_ID,
        sourceTurnId: failed.sourceTurnId,
        clientRequestId: "persisted-revise-stale-retry-0001",
      }),
    ).rejects.toMatchObject({ code: "stale_revision", retryable: false });
    expect(harness.conversation.failTurn).not.toHaveBeenCalled();
    expect(harness.repository.createDraftCalls).toHaveLength(2);
    expect(
      harness.events.filter((event) => event === "gateway.execute"),
    ).toHaveLength(2);
  });

  it("rejects a completed retry semantic mismatch without compensating its nonowned successor", async () => {
    const harness = createHarness(
      [
        { providerFailure: true },
        clarificationOutput("Confirm the final contract?", "confirm_contract"),
      ],
      { persistFailedRevisions: true },
    );
    const previous = harness.repository.seedDraft(clarifyingDraft());
    const failed = await harness.service.answerOrRevise({
      actor,
      projectId: PROJECT_ID,
      conversationId: CONVERSATION_ID,
      expectedDraftId: previous.id,
      expectedRevisionNumber: 1,
      clientRequestId: "post-open-reconciliation-source-0001",
      promptText: "Continue the frozen revision.",
    });
    if (failed.ok) throw new Error("post-open source unexpectedly passed");
    await harness.service.retryTurn({
      actor,
      projectId: PROJECT_ID,
      conversationId: CONVERSATION_ID,
      sourceTurnId: failed.sourceTurnId,
      clientRequestId: "post-open-reconciliation-success-0001",
    });

    await expect(
      harness.service.retryTurn({
        actor,
        projectId: PROJECT_ID,
        conversationId: CONVERSATION_ID,
        sourceTurnId: failed.sourceTurnId,
        clientRequestId: "post-open-reconciliation-failure-0001",
      }),
    ).rejects.toMatchObject({
      code: "stale_revision",
      retryable: false,
      sourceTurnId: uuid(202),
    });
    expect(harness.conversation.failTurn).not.toHaveBeenCalled();
  });

  it("retries a failed confirmation provider turn from frozen context and runs AI only once more", async () => {
    const harness = createHarness([
      { providerFailure: true },
      confirmedFormulaOutput(),
    ]);
    const previous = harness.repository.seedDraft(confirmableDraft());

    const failed = await harness.service.confirmContract(
      confirmInput(previous),
    );
    expect(failed).toMatchObject({
      ok: false,
      code: "SETTLEMENT_AI_PROVIDER_FAILED",
      sourceTurnId: uuid(201),
    });
    if (failed.ok) throw new Error("confirmation failure unexpectedly passed");

    const retried = await harness.service.retryTurn({
      actor,
      projectId: PROJECT_ID,
      conversationId: CONVERSATION_ID,
      sourceTurnId: failed.sourceTurnId,
      clientRequestId: "confirm-provider-retry-0001",
    });

    expect(retried).toMatchObject({ ok: true, kind: "simulated" });
    expect(harness.catalogPort.getCatalog).toHaveBeenCalledTimes(1);
    expect(harness.evidencePort.loadAuthorizedEvidence).toHaveBeenCalledTimes(
      1,
    );
    expect(harness.conversation.captureGatewayContext).toHaveBeenCalledTimes(1);
    expect(
      harness.events.filter((event) => event === "gateway.execute"),
    ).toHaveLength(2);
  });

  it("appends a new semantic retry revision after a persisted failed confirmation", async () => {
    const harness = createHarness(
      [{ providerFailure: true }, confirmedFormulaOutput()],
      { persistFailedRevisions: true },
    );
    const previous = harness.repository.seedDraft(confirmableDraft());

    const failed = await harness.service.confirmContract(
      confirmInput(previous),
    );
    expect(failed).toMatchObject({
      ok: false,
      code: "SETTLEMENT_AI_PROVIDER_FAILED",
      sourceTurnId: uuid(201),
      failedDraft: {
        revisionNumber: 2,
        initialStatus: "failed",
        status: "failed",
      },
    });
    if (failed.ok || !failed.failedDraft) {
      throw new Error("persisted failure fixture unexpectedly passed");
    }

    const retried = await harness.service.retryTurn({
      actor,
      projectId: PROJECT_ID,
      conversationId: CONVERSATION_ID,
      sourceTurnId: failed.sourceTurnId,
      clientRequestId: "persisted-confirm-retry-0001",
    });

    expect(retried).toMatchObject({
      ok: true,
      kind: "simulated",
      draft: { revisionNumber: 3, initialStatus: "contract_ready" },
    });
    expect(harness.repository.createDraftCalls).toHaveLength(2);
    expect(harness.repository.createDraftCalls[1].idempotencyKey).toMatch(
      /^settlement-retry:/u,
    );
    expect(harness.repository.createDraftCalls[1].idempotencyKey).not.toBe(
      harness.repository.createDraftCalls[0].idempotencyKey,
    );
    const supersededFailure = harness.repository.drafts.find(
      (draft) => draft.id === failed.failedDraft?.id,
    );
    expect(supersededFailure).toMatchObject({
      initialStatus: "failed",
      status: "superseded",
      supersededByDraftId:
        retried.ok && retried.kind === "simulated" ? retried.draft.id : null,
      supersededAt: expect.any(String),
    });
    expect(
      harness.events.filter((event) => event === "gateway.execute"),
    ).toHaveLength(2);

    await expect(
      harness.service.retryTurn({
        actor,
        projectId: PROJECT_ID,
        conversationId: CONVERSATION_ID,
        sourceTurnId: failed.sourceTurnId,
        clientRequestId: "persisted-confirm-retry-conflict",
      }),
    ).rejects.toMatchObject({ code: "invalid_transition" });
    expect(harness.repository.createDraftCalls).toHaveLength(2);
    expect(
      harness.events.filter((event) => event === "gateway.execute"),
    ).toHaveLength(2);
  });

  it("fails closed when the public conversation API fails and never falls back to local draft history", async () => {
    const harness = createHarness([
      clarificationOutput("请确认每小时结算单价？", "confirm_rate"),
    ]);
    const previous = harness.repository.seedDraft(clarifyingDraft());
    vi.mocked(harness.conversation.getHistory).mockRejectedValueOnce(
      new Error("conversation unavailable"),
    );

    await expect(
      harness.service.answerOrRevise({
        actor,
        projectId: PROJECT_ID,
        conversationId: CONVERSATION_ID,
        expectedDraftId: previous.id,
        expectedRevisionNumber: 1,
        clientRequestId: "conversation-failure-0001",
        promptText: "继续。",
      }),
    ).rejects.toMatchObject({
      name: "CustomRuleAuthoringServiceError",
      code: "conversation_failed",
    });
    expect(harness.conversation.acceptTurn).not.toHaveBeenCalled();
    expect(harness.repository.createDraftCalls).toHaveLength(0);
  });

  it("best-effort fails every accepted turn when setup or frozen restore fails", async () => {
    const startInput = {
      actor,
      projectId: PROJECT_ID,
      conversationId: CONVERSATION_ID,
      clientRequestId: "accepted-setup-failure-0001",
      promptText: "Start a settlement draft.",
      seedContract: contract(),
      initialAmbiguities: [
        {
          code: "confirm_rate",
          question: "Confirm the hourly rate?",
          required: true,
        },
      ],
    };
    for (const failure of [
      "prepare_turn",
      "ai_prepare",
      "capture",
      "mark_generating",
      "mark_validating",
    ] as const) {
      const harness = createHarness(
        [clarificationOutput("Confirm the hourly rate?", "confirm_rate")],
        { acceptedSetupFailure: failure },
      );
      await expect(
        harness.service.startSession({
          ...startInput,
          clientRequestId: `accepted-${failure}-0001`,
        }),
      ).rejects.toMatchObject({
        code: "conversation_failed",
        sourceTurnId: uuid(201),
      });
      expect(harness.conversation.failTurn).toHaveBeenCalledWith(
        actor,
        uuid(201),
        expect.objectContaining({
          errorCode: "settlement_turn_setup_failed",
          retryable: true,
        }),
      );
      expect(
        JSON.stringify(vi.mocked(harness.conversation.failTurn).mock.calls),
      ).not.toContain("raw-secret-provider-body");
      expect(harness.repository.createDraftCalls).toHaveLength(0);
    }

    const reconciliation = createHarness(
      [clarificationOutput("Confirm the hourly rate?", "confirm_rate")],
      { acceptedSetupFailure: "capture", failFailTurn: true },
    );
    await expect(
      reconciliation.service.startSession({
        ...startInput,
        clientRequestId: "accepted-reconciliation-failure-0001",
      }),
    ).rejects.toMatchObject({
      code: "conversation_reconciliation_failed",
      retryable: false,
      sourceTurnId: uuid(201),
    });

    const restore = createHarness([{ providerFailure: true }], {
      acceptedSetupFailure: "ai_restore",
    });
    const previous = restore.repository.seedDraft(clarifyingDraft());
    const providerFailure = await restore.service.answerOrRevise({
      actor,
      projectId: PROJECT_ID,
      conversationId: CONVERSATION_ID,
      expectedDraftId: previous.id,
      expectedRevisionNumber: 1,
      clientRequestId: "restore-source-failure-0001",
      promptText: "Continue the settlement draft.",
    });
    if (providerFailure.ok)
      throw new Error("restore source unexpectedly passed");
    await expect(
      restore.service.retryTurn({
        actor,
        projectId: PROJECT_ID,
        conversationId: CONVERSATION_ID,
        sourceTurnId: providerFailure.sourceTurnId,
        clientRequestId: "restore-compensation-retry-0001",
      }),
    ).rejects.toMatchObject({
      code: "conversation_failed",
      sourceTurnId: uuid(202),
    });
    expect(restore.conversation.failTurn).toHaveBeenLastCalledWith(
      actor,
      uuid(202),
      expect.objectContaining({ errorCode: "settlement_retry_setup_failed" }),
    );

    const mismatch = createHarness([{ providerFailure: true }], {
      retryConversationMismatch: true,
    });
    const mismatchPrevious = mismatch.repository.seedDraft(clarifyingDraft());
    const mismatchSource = await mismatch.service.answerOrRevise({
      actor,
      projectId: PROJECT_ID,
      conversationId: CONVERSATION_ID,
      expectedDraftId: mismatchPrevious.id,
      expectedRevisionNumber: 1,
      clientRequestId: "retry-scope-source-0001",
      promptText: "Continue the settlement draft.",
    });
    if (mismatchSource.ok)
      throw new Error("retry scope source unexpectedly passed");
    await expect(
      mismatch.service.retryTurn({
        actor,
        projectId: PROJECT_ID,
        conversationId: CONVERSATION_ID,
        sourceTurnId: mismatchSource.sourceTurnId,
        clientRequestId: "retry-scope-mismatch-0001",
      }),
    ).rejects.toMatchObject({
      code: "conversation_failed",
      sourceTurnId: uuid(202),
    });
    expect(mismatch.conversation.prepareTurn).toHaveBeenCalledTimes(1);
    expect(mismatch.conversation.failTurn).toHaveBeenLastCalledWith(
      actor,
      uuid(202),
      expect.objectContaining({ errorCode: "settlement_retry_setup_failed" }),
    );
  });

  it("never terminates an active turn returned as a concurrent duplicate", async () => {
    const gatewayControl: { release?: () => void } = {};
    const gatewayGate = new Promise<void>((resolve) => {
      gatewayControl.release = resolve;
    });
    const duplicateStart = createHarness(
      [clarificationOutput("Confirm the hourly rate?", "confirm_rate")],
      { gatewayGate },
    );
    const input = {
      actor,
      projectId: PROJECT_ID,
      conversationId: CONVERSATION_ID,
      clientRequestId: "concurrent-duplicate-start-0001",
      promptText: "Start a duplicate settlement request.",
      seedContract: contract(),
      initialAmbiguities: [
        {
          code: "confirm_rate",
          question: "Confirm the hourly rate?",
          required: true,
        },
      ],
    };
    const owner = duplicateStart.service.startSession(input);
    await vi.waitFor(() => {
      expect(duplicateStart.conversation.markGenerating).toHaveBeenCalledTimes(
        1,
      );
    });
    const prepareCallsBeforeDuplicate = vi.mocked(
      duplicateStart.conversation.prepareTurn,
    ).mock.calls.length;
    const duplicate = await duplicateStart.service.startSession(input);
    expect(duplicate).toMatchObject({
      ok: true,
      kind: "retry_in_progress",
      turn: {
        turnId: uuid(201),
        status: "generating",
        duplicate: true,
      },
    });
    expect(duplicateStart.conversation.prepareTurn).toHaveBeenCalledTimes(
      prepareCallsBeforeDuplicate,
    );
    expect(duplicateStart.conversation.failTurn).not.toHaveBeenCalled();
    expect(duplicateStart.repository.finalizeDraftTurnCalls).toHaveLength(0);
    const releaseGateway = gatewayControl.release;
    if (!releaseGateway) throw new Error("gateway release was not initialized");
    releaseGateway();
    await expect(owner).resolves.toMatchObject({
      ok: true,
      kind: "clarifying",
    });
    expect(duplicateStart.repository.finalizeDraftTurnCalls).toHaveLength(1);

    const duplicateRetry = createHarness([], {
      retryTurnDuplicate: true,
      retryTurnStatus: "generating",
    });
    const pending = await duplicateRetry.service.retryTurn({
      actor,
      projectId: PROJECT_ID,
      conversationId: CONVERSATION_ID,
      sourceTurnId: uuid(210),
      clientRequestId: "concurrent-duplicate-retry-0001",
    });
    expect(pending).toMatchObject({
      ok: true,
      kind: "retry_in_progress",
      turn: { status: "generating", duplicate: true },
    });
    expect(duplicateRetry.conversation.prepareTurn).not.toHaveBeenCalled();
    expect(duplicateRetry.conversation.failTurn).not.toHaveBeenCalled();
  });

  it("branches on history-backed retry status before preparing accepted context", async () => {
    for (const status of ["grounding", "generating", "validating"] as const) {
      const active = createHarness([], {
        retryTurnStatus: status,
        retryTurnDuplicate: true,
      });
      const result = await active.service.retryTurn({
        actor,
        projectId: PROJECT_ID,
        conversationId: CONVERSATION_ID,
        sourceTurnId: uuid(210),
        clientRequestId: `active-${status}-retry-0001`,
      });
      expect(result).toMatchObject({
        ok: true,
        kind: "retry_in_progress",
        turn: { status, duplicate: true, attempt: 2 },
      });
      expect(active.conversation.prepareTurn).not.toHaveBeenCalled();
    }

    const completedIdempotencyKey = "completed-retry-draft-key-0001";
    const completedContent = "Exact completed retry assistant content.";
    const completed = createHarness([], {
      retryTurnStatus: "completed",
      retryTurnDuplicate: true,
      retryTerminalCompletion: {
        providerName: "deterministic",
        content: completedContent,
        aiInvocationId: null,
        metadata: {
          contextSnapshotVersion: 7,
          contextSummaryVersion: 3,
          contextMessageIds: [...RETRY_CONTEXT_MESSAGE_IDS],
          settlementIdempotencyKey: completedIdempotencyKey,
          settlementInitialStatus: "clarifying",
        },
      },
    });
    const completedDraft = completed.repository.seedDraft(
      clarifyingDraft({
        idempotencyKey: completedIdempotencyKey,
        aiResponseContent: completedContent,
        turnTrace: {
          turnId: uuid(201),
          userMessageId: uuid(301),
          assistantMessageId: uuid(401),
        },
      }),
    );
    const readback = await completed.service.retryTurn({
      actor,
      projectId: PROJECT_ID,
      conversationId: CONVERSATION_ID,
      sourceTurnId: STANDALONE_RETRY_SOURCE_TURN_ID,
      clientRequestId: "completed-retry-readback-0001",
    });
    expect(readback).toMatchObject({
      ok: true,
      kind: "retry_readback",
      draft: { id: completedDraft.id },
      turn: { status: "completed", duplicate: true, attempt: 2 },
    });
    expect(completed.conversation.prepareTurn).not.toHaveBeenCalled();

    const retryableFailure = createHarness([], {
      retryTurnStatus: "failed",
      retryTurnDuplicate: true,
      retryTurnRetryable: true,
    });
    const failed = await retryableFailure.service.retryTurn({
      actor,
      projectId: PROJECT_ID,
      conversationId: CONVERSATION_ID,
      sourceTurnId: uuid(210),
      clientRequestId: "failed-retry-readback-0001",
    });
    expect(failed).toMatchObject({
      ok: false,
      kind: "retry_failed",
      code: "conversation_failed",
      retryable: true,
      turn: { status: "failed", duplicate: true, attempt: 2 },
    });
    expect(retryableFailure.conversation.prepareTurn).not.toHaveBeenCalled();

    const conflict = createHarness([], {
      retryTurnStatus: "failed",
      retryTurnDuplicate: true,
      retryTurnRetryable: false,
    });
    await expect(
      conflict.service.retryTurn({
        actor,
        projectId: PROJECT_ID,
        conversationId: CONVERSATION_ID,
        sourceTurnId: uuid(210),
        clientRequestId: "failed-retry-conflict-0001",
      }),
    ).rejects.toMatchObject({
      code: "conversation_failed",
      retryable: false,
      sourceTurnId: uuid(201),
    });
    expect(conflict.conversation.prepareTurn).not.toHaveBeenCalled();
  });

  it("fails closed on pending assistants and source-bound drafts during completed retry readback", async () => {
    const completionIdempotencyKey = "completed-retry-key-0002";
    const completionContent = "Completed retry content.";
    const completion: SettlementAiTurnCompletionInput = {
      providerName: "deterministic",
      content: completionContent,
      aiInvocationId: null,
      metadata: {
        contextSnapshotVersion: 7,
        contextSummaryVersion: 3,
        contextMessageIds: [...RETRY_CONTEXT_MESSAGE_IDS],
        settlementIdempotencyKey: completionIdempotencyKey,
        settlementInitialStatus: "clarifying",
      },
    };
    const pending = createHarness([], {
      retryTurnStatus: "completed",
      retryTurnDuplicate: true,
    });
    pending.repository.seedDraft(
      clarifyingDraft({
        idempotencyKey: completionIdempotencyKey,
        aiResponseContent: completionContent,
        turnTrace: {
          turnId: uuid(201),
          userMessageId: uuid(301),
          assistantMessageId: uuid(401),
        },
      }),
    );
    await expect(
      pending.service.retryTurn({
        actor,
        projectId: PROJECT_ID,
        conversationId: CONVERSATION_ID,
        sourceTurnId: uuid(210),
        clientRequestId: "completed-pending-assistant-0001",
      }),
    ).rejects.toMatchObject({ code: "conversation_failed", retryable: false });
    expect(pending.conversation.failTurn).not.toHaveBeenCalled();

    const sourceBound = createHarness([], {
      retryTurnStatus: "completed",
      retryTurnDuplicate: true,
      retryTerminalCompletion: completion,
    });
    sourceBound.repository.seedDraft(
      clarifyingDraft({
        idempotencyKey: completionIdempotencyKey,
        aiResponseContent: completionContent,
      }),
    );
    await expect(
      sourceBound.service.retryTurn({
        actor,
        projectId: PROJECT_ID,
        conversationId: CONVERSATION_ID,
        sourceTurnId: uuid(210),
        clientRequestId: "completed-source-bound-draft-0001",
      }),
    ).rejects.toMatchObject({ code: "conversation_failed", retryable: false });
    expect(sourceBound.conversation.failTurn).not.toHaveBeenCalled();

    for (const tamper of ["content", "metadata"] as const) {
      const expectedKey = `completed-retry-${tamper}-key-0001`;
      const expectedContent = `Expected ${tamper} retry content.`;
      const terminalCompletion: SettlementAiTurnCompletionInput = {
        providerName: "deterministic",
        content:
          tamper === "content" ? "Tampered retry content." : expectedContent,
        aiInvocationId: null,
        metadata: {
          contextSnapshotVersion: 7,
          contextSummaryVersion: 3,
          contextMessageIds: [...RETRY_CONTEXT_MESSAGE_IDS],
          settlementIdempotencyKey:
            tamper === "metadata" ? "wrong-retry-key-0001" : expectedKey,
          settlementInitialStatus: "clarifying",
        },
      };
      const harness = createHarness([], {
        retryTurnStatus: "completed",
        retryTurnDuplicate: true,
        retryTerminalCompletion: terminalCompletion,
      });
      harness.repository.seedDraft(
        clarifyingDraft({
          idempotencyKey: expectedKey,
          aiResponseContent: expectedContent,
          turnTrace: {
            turnId: uuid(201),
            userMessageId: uuid(301),
            assistantMessageId: uuid(401),
          },
        }),
      );
      await expect(
        harness.service.retryTurn({
          actor,
          projectId: PROJECT_ID,
          conversationId: CONVERSATION_ID,
          sourceTurnId: uuid(210),
          clientRequestId: `completed-${tamper}-mismatch-0001`,
        }),
      ).rejects.toMatchObject({
        code: "conversation_failed",
        retryable: false,
      });
      expect(harness.conversation.failTurn).not.toHaveBeenCalled();
    }
  });

  it("requires completed retry metadata to exactly match the frozen turn context", async () => {
    const expectedKey = "completed-retry-exact-context-0001";
    const expectedContent = "Exact frozen-context retry content.";
    const snapshot = retryContextSnapshot();
    const exactMetadata: SettlementAiTurnCompletionInput["metadata"] = {
      contextSnapshotVersion: snapshot.version,
      contextSummaryVersion: snapshot.summaryVersion,
      contextMessageIds: [...snapshot.messageIds],
      settlementIdempotencyKey: expectedKey,
      settlementInitialStatus: "clarifying",
    };
    const tamperedMetadata = [
      {
        name: "snapshot-version",
        value: { ...exactMetadata, contextSnapshotVersion: 8 },
      },
      {
        name: "summary-version",
        value: { ...exactMetadata, contextSummaryVersion: 4 },
      },
      {
        name: "missing-message-id",
        value: {
          ...exactMetadata,
          contextMessageIds: [
            RETRY_CONTEXT_MESSAGE_IDS[0],
            RETRY_CONTEXT_MESSAGE_IDS[2],
          ],
        },
      },
      {
        name: "extra-message-id",
        value: {
          ...exactMetadata,
          contextMessageIds: [...RETRY_CONTEXT_MESSAGE_IDS, uuid(401)],
        },
      },
      {
        name: "reordered-message-ids",
        value: {
          ...exactMetadata,
          contextMessageIds: [
            RETRY_CONTEXT_MESSAGE_IDS[1],
            RETRY_CONTEXT_MESSAGE_IDS[0],
            RETRY_CONTEXT_MESSAGE_IDS[2],
          ],
        },
      },
    ];

    for (const tamper of tamperedMetadata) {
      const harness = createHarness([], {
        retryTurnStatus: "completed",
        retryTurnDuplicate: true,
        retryContextSnapshot: snapshot,
        retryTerminalCompletion: {
          providerName: "deterministic",
          content: expectedContent,
          aiInvocationId: null,
          metadata: tamper.value,
        },
      });
      harness.seedConversationMessage({
        id: RETRY_CONTEXT_MESSAGE_IDS[0],
        conversationId: CONVERSATION_ID,
        sequence: 1,
        role: "user",
        status: "completed",
        content: "Earlier settlement question.",
        parentMessageId: null,
        createdAt: "2026-07-12T00:00:00.000Z",
        updatedAt: "2026-07-12T00:00:00.000Z",
      });
      harness.seedConversationMessage({
        id: RETRY_CONTEXT_MESSAGE_IDS[1],
        conversationId: CONVERSATION_ID,
        sequence: 2,
        role: "assistant",
        status: "completed",
        content: "Earlier settlement answer.",
        parentMessageId: RETRY_CONTEXT_MESSAGE_IDS[0],
        createdAt: "2026-07-12T00:00:00.000Z",
        updatedAt: "2026-07-12T00:00:00.000Z",
      });
      harness.repository.seedDraft(
        clarifyingDraft({
          idempotencyKey: expectedKey,
          aiResponseContent: expectedContent,
          turnTrace: {
            turnId: uuid(201),
            userMessageId: uuid(301),
            assistantMessageId: uuid(401),
          },
        }),
      );

      await expect(
        harness.service.retryTurn({
          actor,
          projectId: PROJECT_ID,
          conversationId: CONVERSATION_ID,
          sourceTurnId: uuid(210),
          clientRequestId: `completed-${tamper.name}-0001`,
        }),
      ).rejects.toMatchObject({
        code: "conversation_failed",
        retryable: false,
        sourceTurnId: uuid(201),
      });
      expect(harness.conversation.failTurn).not.toHaveBeenCalled();
    }
  });

  it("integrates real Xingyao retry eligibility, lineage, and completed Task7 readback", async () => {
    const persistence = new InMemoryConversationPersistence();
    const conversation = createConversationService(persistence, {
      now: () => new Date("2026-07-12T00:00:00.000Z"),
    });
    const createdConversation = await conversation.createConversation(
      actor,
      "Settlement authoring integration",
    );
    const sourceTurnId = uuid(650);
    const sourceUserMessageId = uuid(651);
    const sourceSnapshot: ConversationContextSnapshot = {
      version: 11,
      summaryVersion: 5,
      messageIds: [sourceUserMessageId],
      groundingRefs: [],
      assembledAt: "2026-07-12T00:00:00.000Z",
      gatewayContext: {
        messages: [
          { role: "user", content: "Retry this settlement authoring turn." },
        ],
        attachments: [],
        mode: "fast",
        primaryProvider: "deterministic",
        lastUserMessage: "Retry this settlement authoring turn.",
        responseMetadata: {
          grounding: {},
          knowledge: {},
          retrospectiveDraft: null,
        },
        invocationMetadata: {},
      },
    };
    persistence.seedFailedTurn({
      turnId: sourceTurnId,
      userMessageId: sourceUserMessageId,
      assistantMessageId: uuid(652),
      retryable: true,
      contextSnapshot: sourceSnapshot,
    });
    const nonRetryableSourceTurnId = uuid(660);
    persistence.seedFailedTurn({
      turnId: nonRetryableSourceTurnId,
      userMessageId: uuid(661),
      assistantMessageId: uuid(662),
      retryable: false,
      contextSnapshot: {
        ...sourceSnapshot,
        messageIds: [uuid(661)],
      },
    });

    const clientRequestId = "real-conversation-retry-0001";
    const successor = await conversation.retryTurn(actor, sourceTurnId, {
      clientRequestId,
    });
    expect(successor).toMatchObject({
      conversationId: createdConversation.id,
      userMessageId: sourceUserMessageId,
      attempt: 2,
      duplicate: false,
    });
    expect(successor.turnId).not.toBe(sourceTurnId);

    const prepared = await conversation.prepareTurn(actor, successor.turnId);
    expect(prepared.snapshot).toEqual(sourceSnapshot);
    await conversation.markGenerating(actor, successor.turnId, "deterministic");
    await conversation.markValidating(actor, successor.turnId);
    const draftIdempotencyKey = "real-completed-retry-draft-0001";
    const assistantContent = "Persisted exact assistant response.";
    await conversation.completeTurn(actor, successor.turnId, {
      providerName: "deterministic",
      content: assistantContent,
      metadata: {
        contextSnapshotVersion: sourceSnapshot.version,
        contextSummaryVersion: sourceSnapshot.summaryVersion,
        contextMessageIds: [...sourceSnapshot.messageIds],
        settlementIdempotencyKey: draftIdempotencyKey,
        settlementInitialStatus: "clarifying",
      },
    });

    const repository = new InMemoryAuthoringRepository([], {}, () => {});
    const persistedDraft = repository.seedDraft(
      clarifyingDraft({
        idempotencyKey: draftIdempotencyKey,
        aiResponseContent: assistantContent,
        turnTrace: {
          turnId: successor.turnId,
          userMessageId: successor.userMessageId,
          assistantMessageId: successor.assistantMessageId,
        },
      }),
    );
    const adapter = createSettlementRuleAiAdapter({
      gateway: async () => {
        throw new Error("completed readback must not invoke the gateway");
      },
    });
    const service = createCustomRuleAuthoringService({
      conversation,
      ai: adapter,
      repository,
      catalog: { getCatalog: async () => catalog() },
      evidence: {
        loadAuthorizedEvidence: async (input) =>
          authorizedEvidence(input, "5000"),
      },
      analyzeReadiness: analyzeCustomRuleDataReadiness,
      simulate: simulateCustomSettlementRule,
      primaryProvider: "deterministic",
    });

    const readback = await service.retryTurn({
      actor,
      projectId: PROJECT_ID,
      conversationId: createdConversation.id,
      sourceTurnId,
      clientRequestId,
    });
    expect(readback).toMatchObject({
      ok: true,
      kind: "retry_readback",
      draft: { id: persistedDraft.id },
      turn: {
        turnId: successor.turnId,
        status: "completed",
        attempt: 2,
        duplicate: true,
      },
    });

    const history = await conversation.getHistory(
      actor,
      createdConversation.id,
    );
    const successorTurns = history.turns.filter(
      (turn) => turn.retryOfTurnId === sourceTurnId,
    );
    expect(successorTurns).toHaveLength(1);
    expect(successorTurns[0]).toMatchObject({
      id: successor.turnId,
      userMessageId: sourceUserMessageId,
      status: "completed",
      retryable: false,
    });

    await expect(
      conversation.retryTurn(actor, nonRetryableSourceTurnId, {
        clientRequestId: "real-nonretryable-source-0001",
      }),
    ).rejects.toMatchObject({ code: "turn_not_retryable" });
    expect(
      (
        await conversation.getHistory(actor, createdConversation.id)
      ).turns.filter((turn) => turn.retryOfTurnId === nonRetryableSourceTurnId),
    ).toHaveLength(0);
  });

  it("atomically finalizes a validated contract, simulation, and generic turn", async () => {
    const harness = createHarness([confirmedFormulaOutput()]);
    const previous = harness.repository.seedDraft(confirmableDraft());

    const result = await harness.service.confirmContract({
      actor,
      projectId: PROJECT_ID,
      conversationId: CONVERSATION_ID,
      expectedDraftId: previous.id,
      expectedRevisionNumber: 1,
      clientRequestId: "confirm-request-0001",
      promptText: "我确认以上业务规则。",
      contractConfirmed: true,
      expectedContractHash: previous.contractHash,
      expectedCatalogVersion: CATALOG_VERSION,
      simulationSelection: safeSelection(),
    });

    expect(result).toMatchObject({
      ok: true,
      kind: "simulated",
      draft: {
        revisionNumber: 2,
        initialStatus: "contract_ready",
        status: "simulated",
        unresolvedAmbiguities: [],
        generatedFormula: {
          expression: "payable = money_result({ final: yuan(20) })",
        },
        generatedExplanation: expect.stringContaining("结算公式按组件顺序输出"),
        generatedTestCases: [{ name: "确认后的标准场景" }],
        formulaHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      },
      simulation: {
        owner: { kind: "ai_draft" },
        formulaHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      },
      summary: {
        recordCount: 1,
        totalOldCents: "1600",
        totalNewCents: "2000",
        totalDeltaCents: "400",
      },
    });
    const readyInput = harness.repository.createDraftCalls[0];
    expect(readyInput).toMatchObject({
      status: "contract_ready",
      unresolvedAmbiguities: [],
      generatedFormula: {
        expression: "payable = money_result({ final: yuan(20) })",
      },
      generatedExplanation: expect.stringContaining("金额以元显示"),
      generatedTestCases: [{ name: "确认后的标准场景" }],
      formulaHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(harness.repository.insertSimulationCalls[0]).toMatchObject({
      organizationId: ORGANIZATION_ID,
      projectId: PROJECT_ID,
      owner: { kind: "ai_draft", id: expect.any(String) },
      formulaHash: readyInput.formulaHash,
      ruleContractHash: readyInput.contractHash,
      parameterHash: readyInput.parameterHash,
      variableCatalogVersion: CATALOG_VERSION,
    });
    expect(harness.repository.finalizeSimulationTurnCalls[0]).toMatchObject({
      draft: readyInput,
      completion: { content: readyInput.aiResponse.content },
      simulation: {
        idempotencyKey: expect.stringMatching(/^settlement-simulation:/),
        dataSelectionHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      },
    });
    expectOrdered(harness.events, [
      "conversation.acceptTurn",
      "conversation.prepareTurn",
      "conversation.captureGatewayContext",
      "conversation.markGenerating",
      "conversation.markValidating",
      "repository.finalizeSimulationTurn",
    ]);
    expect(harness.conversation.completeTurn).not.toHaveBeenCalled();
    expect(harness.conversation.captureGatewayContext).toHaveBeenCalledTimes(1);
    expect(harness.conversation.getHistory).toHaveBeenCalledWith(
      actor,
      CONVERSATION_ID,
    );
    expect(harness.evidencePort.loadAuthorizedEvidence).toHaveBeenCalledWith(
      expect.objectContaining({
        actor,
        organizationId: ORGANIZATION_ID,
        projectId: PROJECT_ID,
        selection: safeSelection(),
      }),
    );
    expect(harness.simulationInputs).toHaveLength(1);
    expect(Object.isFrozen(harness.simulationInputs[0].records)).toBe(true);
    expect(harness.simulationInputs[0].provenance).toMatchObject({
      organizationId: ORGANIZATION_ID,
      projectId: PROJECT_ID,
      actorId: USER_ID,
      selectionToken: "selection-token-0001",
    });
  });

  it("classifies formula-only inputs as optional for confirmation and existing-draft recovery", async () => {
    const harness = createHarness([optionalFormulaOutput()]);
    const previous = harness.repository.seedDraft(confirmableDraft());
    const confirmation = confirmInput(previous);

    await harness.service.confirmContract(confirmation);
    await harness.service.confirmContract(confirmation);

    expect(harness.readinessInputs).toHaveLength(2);
    for (const inputs of harness.readinessInputs) {
      expect(inputs).toEqual([
        {
          variableId: "evidence_level",
          required: false,
          missingDataPolicy: { action: "route_item_to_review" },
        },
        { variableId: "system_minutes", required: true },
      ]);
    }
    expect(harness.evidenceInputs.map((input) => input.inputs)).toEqual(
      harness.readinessInputs,
    );
  });

  it("returns an idempotent simulated success for the same durable confirmation key", async () => {
    const harness = createHarness([confirmedFormulaOutput()]);
    const previous = harness.repository.seedDraft(confirmableDraft());
    const confirmation = confirmInput(previous);

    const first = await harness.service.confirmContract(confirmation);
    const replay = await harness.service.confirmContract(confirmation);

    expect(first).toMatchObject({ ok: true, kind: "simulated" });
    expect(replay).toMatchObject({
      ok: true,
      kind: "simulated",
      duplicate: true,
    });
    expect(
      harness.events.filter((event) => event === "gateway.execute"),
    ).toHaveLength(1);
    expect(harness.repository.createDraftCalls).toHaveLength(1);
    expect(harness.repository.insertSimulationCalls).toHaveLength(1);
    expect(harness.repository.listSimulationCalls).toHaveLength(1);
    expect(harness.conversation.retryTurn).not.toHaveBeenCalled();
    expect(harness.repository.finalizeSimulationTurnCalls).toHaveLength(1);
    expect(harness.conversation.completeTurn).not.toHaveBeenCalled();
  });

  it("rejects invalid, stale, unresolved, and duplicate confirmation transitions before persistence", async () => {
    const falseConfirmation = createHarness([confirmedFormulaOutput()]);
    const falseDraft =
      falseConfirmation.repository.seedDraft(confirmableDraft());
    await expect(
      falseConfirmation.service.confirmContract({
        ...confirmInput(falseDraft),
        contractConfirmed: false,
      }),
    ).rejects.toMatchObject({ code: "invalid_transition" });

    const stale = createHarness([confirmedFormulaOutput()]);
    const staleDraft = stale.repository.seedDraft(confirmableDraft());
    await expect(
      stale.service.confirmContract({
        ...confirmInput(staleDraft),
        expectedRevisionNumber: 2,
      }),
    ).rejects.toMatchObject({ code: "stale_revision" });

    const unresolved = createHarness([confirmedFormulaOutput()]);
    const unresolvedDraft = unresolved.repository.seedDraft(
      clarifyingDraft({
        unresolvedAmbiguities: [
          {
            code: "confirm_rate",
            question: "请确认每小时结算单价？",
            required: true,
          },
        ],
      }),
    );
    await expect(
      unresolved.service.confirmContract(confirmInput(unresolvedDraft)),
    ).rejects.toMatchObject({ code: "unresolved_ambiguities" });

    const optional = createHarness([confirmedFormulaOutput()]);
    const optionalDraft = optional.repository.seedDraft(
      clarifyingDraft({
        unresolvedAmbiguities: [
          {
            code: "optional_rounding_note",
            question: "Confirm the optional rounding note?",
            required: false,
          },
        ],
      }),
    );
    await expect(
      optional.service.confirmContract(confirmInput(optionalDraft)),
    ).rejects.toMatchObject({ code: "unresolved_ambiguities" });

    const duplicate = createHarness([confirmedFormulaOutput()]);
    const duplicateDraft = duplicate.repository.seedDraft(simulatedDraft());
    await expect(
      duplicate.service.confirmContract(confirmInput(duplicateDraft)),
    ).rejects.toMatchObject({ code: "duplicate_confirmation" });

    for (const harness of [
      falseConfirmation,
      stale,
      unresolved,
      optional,
      duplicate,
    ]) {
      expect(harness.repository.createDraftCalls).toHaveLength(0);
      expect(harness.conversation.acceptTurn).not.toHaveBeenCalled();
    }
  });

  it("rejects formula, catalog, and selection hash mismatches without completing the generic turn", async () => {
    const formula = createHarness([confirmedFormulaOutput()]);
    const formulaDraft = formula.repository.seedDraft(confirmableDraft());
    await expect(
      formula.service.confirmContract({
        ...confirmInput(formulaDraft),
        expectedFormulaHash: "f".repeat(64),
      }),
    ).rejects.toMatchObject({ code: "formula_hash_mismatch" });
    expect(formula.conversation.failTurn).toHaveBeenCalledTimes(1);
    expect(formula.conversation.completeTurn).not.toHaveBeenCalled();
    expect(formula.repository.createDraftCalls).toHaveLength(0);

    const catalog = createHarness([confirmedFormulaOutput()]);
    const catalogDraft = catalog.repository.seedDraft(confirmableDraft());
    await expect(
      catalog.service.confirmContract({
        ...confirmInput(catalogDraft),
        expectedCatalogVersion: "b".repeat(64),
      }),
    ).rejects.toMatchObject({ code: "catalog_hash_mismatch" });
    expect(catalog.conversation.acceptTurn).not.toHaveBeenCalled();

    const evidence = createHarness([confirmedFormulaOutput()]);
    const evidenceDraft = evidence.repository.seedDraft(confirmableDraft());
    await expect(
      evidence.service.confirmContract({
        ...confirmInput(evidenceDraft),
        expectedEvidenceHash: "e".repeat(64),
      }),
    ).rejects.toMatchObject({ code: "evidence_hash_mismatch" });
    expect(evidence.evidencePort.loadAuthorizedEvidence).toHaveBeenCalledTimes(
      1,
    );
    expect(evidence.simulationInputs).toHaveLength(0);

    const selection = createHarness([confirmedFormulaOutput()]);
    const selectionDraft = selection.repository.seedDraft(confirmableDraft());
    await expect(
      selection.service.confirmContract({
        ...confirmInput(selectionDraft),
        expectedDataSelectionHash: "d".repeat(64),
      }),
    ).rejects.toMatchObject({ code: "selection_hash_mismatch" });
    expect(selection.conversation.failTurn).toHaveBeenCalledTimes(1);
    expect(selection.repository.createDraftCalls).toHaveLength(0);
    expect(selection.simulationInputs).toHaveLength(1);
  });

  it("changes evidence, final selection, and simulation idempotency hashes when authorized margin changes", async () => {
    const high = createHarness([confirmedFormulaOutput()], {
      currentMarginCents: "2000",
    });
    const low = createHarness([confirmedFormulaOutput()], {
      currentMarginCents: "500",
    });
    const highDraft = high.repository.seedDraft(confirmableDraft());
    const lowDraft = low.repository.seedDraft(confirmableDraft());

    const highResult = await high.service.confirmContract(
      confirmInput(highDraft),
    );
    const lowResult = await low.service.confirmContract(confirmInput(lowDraft));
    if (
      !highResult.ok ||
      highResult.kind !== "simulated" ||
      !lowResult.ok ||
      lowResult.kind !== "simulated"
    ) {
      throw new Error("margin hash fixtures must simulate successfully");
    }

    expect(high.simulationInputs[0].provenance.evidenceHash).not.toBe(
      low.simulationInputs[0].provenance.evidenceHash,
    );
    expect(highResult.summary.dataSelectionHash).not.toBe(
      lowResult.summary.dataSelectionHash,
    );
    expect(high.repository.insertSimulationCalls[0].idempotencyKey).not.toBe(
      low.repository.insertSimulationCalls[0].idempotencyKey,
    );
  });

  it("rejects unsafe free-form selection criteria before the evidence port is called", async () => {
    const harness = createHarness([confirmedFormulaOutput()]);
    const draft = harness.repository.seedDraft(confirmableDraft());
    const unsafe = {
      ...confirmInput(draft),
      simulationSelection: {
        ...safeSelection(),
        criteria: ["streamerId=private-1 amountCents=10000"],
      },
    };

    await expect(
      Reflect.apply(harness.service.confirmContract, undefined, [unsafe]),
    ).rejects.toMatchObject({ code: "invalid_input" });
    expect(harness.evidencePort.loadAuthorizedEvidence).not.toHaveBeenCalled();
    expect(harness.conversation.acceptTurn).not.toHaveBeenCalled();
  });

  it("fails closed on authorized evidence scope, token, or provenance hash mismatch", async () => {
    for (const evidenceFailure of [
      "scope",
      "selection_token",
      "hash",
    ] as const) {
      const harness = createHarness([confirmedFormulaOutput()], {
        evidenceFailure,
      });
      const draft = harness.repository.seedDraft(confirmableDraft());

      await expect(
        harness.service.confirmContract(confirmInput(draft)),
      ).rejects.toMatchObject({ code: "simulation_failed" });
      expect(harness.simulationInputs).toHaveLength(0);
      expect(harness.repository.createDraftCalls).toHaveLength(0);
      expect(harness.conversation.failTurn).toHaveBeenCalledTimes(1);
    }
  });

  it("rejects an adapter-forged optional-policy snapshot before simulation", async () => {
    const harness = createHarness([optionalFormulaOutput()], {
      evidenceFailure: "optional_policy_hash",
    });
    const draft = harness.repository.seedDraft(confirmableDraft());

    await expect(
      harness.service.confirmContract(confirmInput(draft)),
    ).rejects.toMatchObject({ code: "simulation_failed" });
    expect(harness.evidencePort.loadAuthorizedEvidence).toHaveBeenCalledTimes(
      1,
    );
    expect(harness.simulationInputs).toHaveLength(0);
  });

  it("blocks confirmation when an AI expected result disagrees with deterministic execution", async () => {
    const output = confirmedFormulaOutput();
    output.testCases[0].expectedResult.amountCents = 99_999;
    const harness = createHarness([output]);
    const draft = harness.repository.seedDraft(confirmableDraft());

    await expect(
      harness.service.confirmContract(confirmInput(draft)),
    ).rejects.toMatchObject({ code: "simulation_failed" });
    expect(harness.repository.createDraftCalls).toHaveLength(0);
    expect(harness.repository.insertSimulationCalls).toHaveLength(0);
    expect(harness.conversation.failTurn).toHaveBeenCalledTimes(1);
  });

  it("atomically persists a failed revision for a deterministic domain failure", async () => {
    const output = confirmedFormulaOutput();
    output.testCases[0].expectedResult.amountCents = 99_999;
    const harness = createHarness([output], {
      persistFailedRevisions: true,
    });
    const draft = harness.repository.seedDraft(confirmableDraft());

    await expect(
      harness.service.confirmContract(confirmInput(draft)),
    ).rejects.toMatchObject({ code: "simulation_failed" });

    expect(harness.repository.finalizeFailedTurnCalls).toHaveLength(1);
    expect(harness.repository.finalizeFailedTurnCalls[0]).toMatchObject({
      draft: {
        status: "failed",
        generatedFormula: null,
        generatedExplanation: null,
        generatedTestCases: [],
        formulaHash: null,
      },
      completion: {
        content:
          "deterministic scenario assertions or risk checks blocked confirmation",
      },
      errorCode: "simulation_failed",
      errorSummary: SETTLEMENT_AI_FAILED_TURN_ERROR_SUMMARIES.simulation_failed,
      retryable: false,
    });
    expect(harness.repository.finalizeSimulationTurnCalls).toHaveLength(0);
    expect(harness.conversation.failTurn).not.toHaveBeenCalled();
    expect(harness.conversation.completeTurn).not.toHaveBeenCalled();
    const domainFailureHistory = await harness.conversation.getHistory(
      actor,
      CONVERSATION_ID,
    );
    expect(
      domainFailureHistory.turns.find((turn) => turn.id === uuid(201)),
    ).toMatchObject({
      status: "failed",
      errorCode: "simulation_failed",
      retryable: false,
    });
  });

  it("retries a rollback-like atomic simulation failure with the same keys", async () => {
    const harness = createHarness(
      [confirmedFormulaOutput(), confirmedFormulaOutput()],
      {
        atomicSimulationFailure: "before_write",
      },
    );
    const previous = harness.repository.seedDraft(confirmableDraft());
    const confirmation = confirmInput(previous);

    const failed = await harness.service.confirmContract(confirmation);
    expect(failed).toMatchObject({
      ok: false,
      code: "persistence_failed",
      retryable: true,
      sourceTurnId: uuid(201),
      failedDraft: null,
    });
    if (failed.ok)
      throw new Error("atomic simulation rollback unexpectedly passed");
    expect(harness.repository.drafts).toHaveLength(1);
    expect(harness.repository.simulations).toHaveLength(0);
    expect(harness.repository.atomicFailureSnapshots).toEqual([
      {
        kind: "simulation",
        draftCount: 1,
        simulationCount: 0,
        turnStatus: "validating",
      },
    ]);
    expect(harness.conversation.failTurn).toHaveBeenCalledTimes(1);
    expect(harness.conversation.completeTurn).not.toHaveBeenCalled();

    const recovered = await harness.service.retryTurn({
      actor,
      projectId: PROJECT_ID,
      conversationId: CONVERSATION_ID,
      sourceTurnId: failed.sourceTurnId,
      clientRequestId: "atomic-simulation-retry-0001",
    });
    expect(recovered).toMatchObject({
      ok: true,
      kind: "simulated",
      draft: { initialStatus: "contract_ready", status: "simulated" },
    });
    expect(
      harness.events.filter((event) => event === "gateway.execute"),
    ).toHaveLength(2);
    expect(harness.repository.finalizeSimulationTurnCalls).toHaveLength(2);
    expect(harness.repository.insertSimulationCalls).toHaveLength(1);
    expect(
      harness.repository.finalizeSimulationTurnCalls[0].draft.idempotencyKey,
    ).toBe(
      harness.repository.finalizeSimulationTurnCalls[1].draft.idempotencyKey,
    );
    expect(
      harness.repository.finalizeSimulationTurnCalls[0].simulation
        .idempotencyKey,
    ).toBe(
      harness.repository.finalizeSimulationTurnCalls[1].simulation
        .idempotencyKey,
    );

    const nonrecoverable = createHarness([confirmedFormulaOutput()], {
      atomicSimulationFailure: "before_write",
      failFailTurn: true,
    });
    const nonrecoverableDraft =
      nonrecoverable.repository.seedDraft(confirmableDraft());
    await expect(
      nonrecoverable.service.confirmContract(confirmInput(nonrecoverableDraft)),
    ).rejects.toMatchObject({
      code: "conversation_reconciliation_failed",
      retryable: false,
      sourceTurnId: uuid(201),
    });
  });

  it("reads back a completed atomic simulation when the RPC response is lost", async () => {
    const harness = createHarness([confirmedFormulaOutput()], {
      atomicSimulationFailure: "after_commit",
    });
    const previous = harness.repository.seedDraft(confirmableDraft());

    const result = await harness.service.confirmContract(
      confirmInput(previous),
    );
    expect(result).toMatchObject({
      ok: true,
      kind: "simulated",
      duplicate: true,
      draft: { status: "simulated" },
    });
    expect(
      harness.events.filter((event) => event === "gateway.execute"),
    ).toHaveLength(1);
    expect(harness.repository.finalizeSimulationTurnCalls).toHaveLength(1);
    expect(harness.repository.insertSimulationCalls).toHaveLength(1);
    expect(
      harness.repository.listSimulationCalls.length,
    ).toBeGreaterThanOrEqual(2);
    expect(harness.conversation.completeTurn).not.toHaveBeenCalled();
    expect(harness.conversation.failTurn).not.toHaveBeenCalled();
  });

  it("boundedly re-reads transient mixed atomic snapshots before reconciling", async () => {
    const draftLag = createHarness(
      [clarificationOutput("Confirm the hourly rate?", "confirm_rate")],
      {
        atomicDraftFailure: "after_commit",
        transientDraftReadbackMisses: 1,
      },
    );
    const draftResult = await draftLag.service.startSession({
      actor,
      projectId: PROJECT_ID,
      conversationId: CONVERSATION_ID,
      clientRequestId: "transient-draft-readback-0001",
      promptText: "Start a settlement draft.",
      seedContract: contract(),
      initialAmbiguities: [
        {
          code: "confirm_rate",
          question: "Confirm the hourly rate?",
          required: true,
        },
      ],
    });
    expect(draftResult).toMatchObject({
      ok: true,
      kind: "clarifying",
      duplicate: true,
    });
    expect(
      draftLag.events.filter((event) => event === "repository.listDrafts")
        .length,
    ).toBeGreaterThanOrEqual(3);

    const simulationLag = createHarness([confirmedFormulaOutput()], {
      atomicSimulationFailure: "after_commit",
      transientSimulationReadbackMisses: 1,
    });
    const previous = simulationLag.repository.seedDraft(confirmableDraft());
    const simulationResult = await simulationLag.service.confirmContract(
      confirmInput(previous),
    );
    expect(simulationResult).toMatchObject({
      ok: true,
      kind: "simulated",
      duplicate: true,
    });
    expect(
      simulationLag.repository.listSimulationCalls.length,
    ).toBeGreaterThanOrEqual(2);
    expect(simulationLag.conversation.failTurn).not.toHaveBeenCalled();
  });

  it("fails closed on an impossible partial atomic simulation state", async () => {
    const harness = createHarness([confirmedFormulaOutput()], {
      atomicSimulationFailure: "partial",
    });
    const previous = harness.repository.seedDraft(confirmableDraft());

    await expect(
      harness.service.confirmContract(confirmInput(previous)),
    ).rejects.toMatchObject({
      code: "conversation_reconciliation_failed",
      retryable: false,
      sourceTurnId: uuid(201),
    });
    expect(harness.repository.finalizeSimulationTurnCalls).toHaveLength(1);
    expect(harness.repository.drafts).toHaveLength(2);
    expect(harness.repository.simulations).toHaveLength(0);
    expect(harness.conversation.completeTurn).not.toHaveBeenCalled();
    expect(harness.conversation.failTurn).toHaveBeenLastCalledWith(
      actor,
      uuid(201),
      expect.objectContaining({
        errorCode: "settlement_post_open_validation_failed",
        retryable: false,
      }),
    );
    const history = await harness.conversation.getHistory(
      actor,
      CONVERSATION_ID,
    );
    expect(history.turns.find((turn) => turn.id === uuid(201))).toMatchObject({
      status: "failed",
      errorCode: "settlement_post_open_validation_failed",
      retryable: false,
    });
  });
});

type ProviderOutput = Record<string, unknown> | { providerFailure: true };

function createHarness(
  outputs: ProviderOutput[],
  options: {
    persistFailedRevisions?: boolean;
    atomicDraftFailure?: "before_write" | "after_commit" | "partial";
    tamperAtomicDraftAfterCommit?: "content" | "hash";
    atomicSimulationFailure?: "before_write" | "after_commit" | "partial";
    atomicFailedFailure?: "before_write" | "after_commit" | "partial";
    transientDraftReadbackMisses?: number;
    transientSimulationReadbackMisses?: number;
    evidenceFailure?:
      | "scope"
      | "hash"
      | "selection_token"
      | "optional_policy_hash";
    currentMarginCents?: string;
    failFailTurn?: boolean;
    acceptedSetupFailure?:
      | "prepare_turn"
      | "ai_prepare"
      | "capture"
      | "mark_generating"
      | "mark_validating"
      | "ai_restore";
    retryTurnStatus?:
      | "accepted"
      | "grounding"
      | "generating"
      | "validating"
      | "completed"
      | "failed"
      | "cancelled";
    retryReturnedStatus?: AiConversationTurnDto["status"];
    retryTurnDuplicate?: boolean;
    retryTurnRetryable?: boolean;
    retryTerminalCompletion?: SettlementAiTurnCompletionInput;
    retryContextSnapshot?: ConversationContextSnapshot;
    gatewayGate?: Promise<void>;
    gatewayGates?: Array<Promise<void> | undefined>;
    retryConversationMismatch?: boolean;
  } = {},
) {
  const events: string[] = [];
  const readinessInputs: CustomRuleInputRequirement[][] = [];
  const evidenceInputs: Array<
    Parameters<AuthorizedSimulationEvidencePort["loadAuthorizedEvidence"]>[0]
  > = [];
  let acceptedContent = "";
  let turnNumber = 0;
  const capturedSnapshots = new Map<
    string,
    Awaited<ReturnType<SettlementConversationPort["captureGatewayContext"]>>
  >();
  const retrySources = new Map<string, string>();
  const acceptedRequests = new Map<
    string,
    Awaited<ReturnType<SettlementConversationPort["acceptTurn"]>>
  >();
  const retryRequests = new Map<
    string,
    Awaited<ReturnType<SettlementConversationPort["retryTurn"]>>
  >();
  const retrySuccessors = new Map<string, string>();
  const turns = new Map<string, StoredConversationTurn>();
  const messages = new Map<string, AiConversationMessageDto>();
  const historyReadQueue: Array<
    Awaited<ReturnType<SettlementConversationPort["getHistory"]>>
  > = [];
  messages.set(RETRY_CONTEXT_MESSAGE_IDS[0], {
    id: RETRY_CONTEXT_MESSAGE_IDS[0],
    conversationId: CONVERSATION_ID,
    sequence: 1,
    role: "user",
    status: "completed",
    content: "Earlier settlement question.",
    parentMessageId: null,
    createdAt: "2026-07-12T00:00:00.000Z",
    updatedAt: "2026-07-12T00:00:00.000Z",
  });
  messages.set(RETRY_CONTEXT_MESSAGE_IDS[1], {
    id: RETRY_CONTEXT_MESSAGE_IDS[1],
    conversationId: CONVERSATION_ID,
    sequence: 2,
    role: "assistant",
    status: "completed",
    content: "Earlier settlement answer.",
    parentMessageId: RETRY_CONTEXT_MESSAGE_IDS[0],
    createdAt: "2026-07-12T00:00:00.000Z",
    updatedAt: "2026-07-12T00:00:00.000Z",
  });
  const registerTurn = (input: {
    turnId: string;
    userMessageId: string;
    assistantMessageId: string;
    status: AiConversationTurnDto["status"];
    attempt: number;
    retryOfTurnId: string | null;
    retryable?: boolean;
    userContent?: string;
    contextSnapshot?: ConversationContextSnapshot | null;
  }) => {
    turns.set(input.turnId, {
      id: input.turnId,
      conversationId: CONVERSATION_ID,
      userMessageId: input.userMessageId,
      assistantMessageId: input.assistantMessageId,
      mode: "fast",
      status: input.status,
      attempt: input.attempt,
      contextSnapshot: input.contextSnapshot ?? null,
      retryOfTurnId: input.retryOfTurnId,
      regenerateOfTurnId: null,
      providerName: null,
      errorCode: null,
      errorSummary: null,
      retryable: input.retryable ?? false,
    });
    if (!messages.has(input.userMessageId)) {
      messages.set(input.userMessageId, {
        id: input.userMessageId,
        conversationId: CONVERSATION_ID,
        sequence: turnNumber * 2 - 1,
        role: "user",
        status: "completed",
        content: input.userContent ?? "Retry requested.",
        parentMessageId: null,
        createdAt: "2026-07-12T00:00:00.000Z",
        updatedAt: "2026-07-12T00:00:00.000Z",
      });
    }
    messages.set(input.assistantMessageId, {
      id: input.assistantMessageId,
      conversationId: CONVERSATION_ID,
      sequence: turnNumber * 2,
      role: "assistant",
      status: "pending",
      content: "",
      parentMessageId: input.userMessageId,
      createdAt: "2026-07-12T00:00:00.000Z",
      updatedAt: "2026-07-12T00:00:00.000Z",
    });
  };
  const transitionTurn = (
    turnId: string,
    status: AiConversationTurnDto["status"],
    completion?: SettlementAiTurnCompletionInput,
    failure?: { errorCode: string; retryable: boolean },
  ) => {
    const turn = turns.get(turnId);
    if (!turn) throw new Error("atomic fixture turn is missing");
    turns.set(turnId, {
      ...turn,
      status,
      errorCode:
        status === "failed"
          ? (failure?.errorCode ?? "conversation_failed")
          : null,
      retryable: status === "failed" && (failure?.retryable ?? false),
    });
    if (completion) {
      const assistant = messages.get(turn.assistantMessageId);
      if (!assistant) throw new Error("atomic fixture assistant is missing");
      messages.set(turn.assistantMessageId, {
        ...assistant,
        status: status === "failed" ? "failed" : "completed",
        content: completion.content,
        metadata: structuredClone(completion.metadata),
        updatedAt: "2026-07-12T00:00:01.000Z",
      });
    } else if (status === "failed") {
      const assistant = messages.get(turn.assistantMessageId);
      if (!assistant) throw new Error("atomic fixture assistant is missing");
      messages.set(turn.assistantMessageId, {
        ...assistant,
        status: "failed",
        metadata: {
          errorCode: failure?.errorCode ?? "conversation_failed",
          retryable: failure?.retryable ?? false,
        },
        updatedAt: "2026-07-12T00:00:01.000Z",
      });
    }
  };
  const requireRetrySource = (sourceTurnId: string): StoredConversationTurn => {
    let source = turns.get(sourceTurnId);
    if (!source && sourceTurnId === STANDALONE_RETRY_SOURCE_TURN_ID) {
      registerTurn({
        turnId: sourceTurnId,
        userMessageId: uuid(301),
        assistantMessageId: uuid(410),
        status: "failed",
        attempt: 1,
        retryOfTurnId: null,
        retryable: true,
        userContent: "Retry the failed settlement turn.",
        contextSnapshot: retryContextSnapshot(),
      });
      transitionTurn(sourceTurnId, "failed", undefined, {
        errorCode: "settlement_source_failed",
        retryable: true,
      });
      source = turns.get(sourceTurnId);
    }
    if (!source || source.status !== "failed" || !source.retryable) {
      throw new Error("Only failed retryable turns can be retried");
    }
    return source;
  };
  const currentHistory = (): Awaited<
    ReturnType<SettlementConversationPort["getHistory"]>
  > => ({
    conversation: {
      id: CONVERSATION_ID,
      title: "AI 结算规则",
      status: "active" as const,
      lastMessageAt: "2026-07-12T00:00:00.000Z",
      createdAt: "2026-07-12T00:00:00.000Z",
      updatedAt: "2026-07-12T00:00:00.000Z",
    },
    messages: [...messages.values()].map((message) => structuredClone(message)),
    turns: [...turns.values()].map((turn) => structuredClone(turn)),
  });
  const conversation: SettlementConversationPort = {
    createConversation: vi.fn(async () => {
      events.push("conversation.createConversation");
      return {
        id: CONVERSATION_ID,
        title: "AI 结算规则",
        status: "active" as const,
        lastMessageAt: "2026-07-12T00:00:00.000Z",
        createdAt: "2026-07-12T00:00:00.000Z",
        updatedAt: "2026-07-12T00:00:00.000Z",
      };
    }),
    getHistory: vi.fn(async () => {
      events.push("conversation.getHistory");
      return historyReadQueue.shift() ?? currentHistory();
    }),
    acceptTurn: vi.fn(async (_actor, _conversationId, command) => {
      events.push("conversation.acceptTurn");
      const existing = acceptedRequests.get(command.clientRequestId);
      if (existing) {
        const current = turns.get(existing.turnId);
        const duplicate: Awaited<
          ReturnType<SettlementConversationPort["acceptTurn"]>
        > = {
          ...existing,
          status: current?.status ?? existing.status,
          duplicate: true,
        };
        return duplicate;
      }
      acceptedContent = command.content;
      turnNumber += 1;
      const result = {
        conversationId: CONVERSATION_ID,
        turnId: uuid(200 + turnNumber),
        userMessageId: uuid(300 + turnNumber),
        assistantMessageId: uuid(400 + turnNumber),
        status: "accepted" as const,
        attempt: 1,
        duplicate: false,
      };
      registerTurn({
        turnId: result.turnId,
        userMessageId: result.userMessageId,
        assistantMessageId: result.assistantMessageId,
        status: result.status,
        attempt: result.attempt,
        retryOfTurnId: null,
        userContent: command.content,
      });
      acceptedRequests.set(command.clientRequestId, result);
      return result;
    }),
    retryTurn: vi.fn(async (_actor, sourceTurnId, command) => {
      events.push("conversation.retryTurn");
      const source = requireRetrySource(sourceTurnId);
      const requestKey = `${sourceTurnId}:${command.clientRequestId}`;
      const requested = retryRequests.get(requestKey);
      const successorId = retrySuccessors.get(sourceTurnId);
      const existing =
        requested ??
        (successorId
          ? (() => {
              const turn = turns.get(successorId);
              return turn
                ? {
                    conversationId: turn.conversationId,
                    turnId: turn.id,
                    userMessageId: turn.userMessageId,
                    assistantMessageId: turn.assistantMessageId,
                    status: turn.status,
                    attempt: turn.attempt,
                    duplicate: false,
                  }
                : undefined;
            })()
          : undefined);
      if (existing) {
        const current = turns.get(existing.turnId);
        return {
          ...existing,
          status: current?.status ?? existing.status,
          duplicate: true,
        };
      }
      turnNumber += 1;
      const turnId = uuid(200 + turnNumber);
      retrySources.set(turnId, sourceTurnId);
      const result = {
        conversationId: options.retryConversationMismatch
          ? uuid(999)
          : CONVERSATION_ID,
        turnId,
        userMessageId: source.userMessageId,
        assistantMessageId: uuid(400 + turnNumber),
        status: options.retryReturnedStatus ?? "accepted",
        attempt: source.attempt + 1,
        duplicate: options.retryTurnDuplicate ?? false,
      };
      const sourceAssistant = messages.get(source.assistantMessageId);
      if (sourceAssistant?.status === "failed") {
        messages.set(sourceAssistant.id, {
          ...sourceAssistant,
          status: "superseded",
          updatedAt: "2026-07-12T00:00:01.000Z",
        });
      }
      registerTurn({
        turnId: result.turnId,
        userMessageId: result.userMessageId,
        assistantMessageId: result.assistantMessageId,
        status: options.retryTurnStatus ?? result.status,
        attempt: result.attempt,
        retryOfTurnId: sourceTurnId,
        retryable: options.retryTurnRetryable,
        contextSnapshot: options.retryContextSnapshot ?? source.contextSnapshot,
      });
      if (
        (options.retryTurnStatus ?? result.status) === "completed" &&
        options.retryTerminalCompletion
      ) {
        transitionTurn(turnId, "completed", options.retryTerminalCompletion);
      }
      retryRequests.set(requestKey, result);
      retrySuccessors.set(sourceTurnId, turnId);
      return result;
    }),
    prepareTurn: vi.fn(async (_actor, turnId) => {
      events.push("conversation.prepareTurn");
      if (options.acceptedSetupFailure === "prepare_turn") {
        throw new Error("raw-secret-provider-body");
      }
      const turn = turns.get(turnId);
      if (!turn) throw new Error("prepared fixture turn is missing");
      const sourceTurnId = retrySources.get(turnId);
      if (sourceTurnId) {
        const frozen =
          turn.contextSnapshot ?? capturedSnapshots.get(sourceTurnId);
        transitionTurn(turnId, "grounding");
        if (!frozen?.gatewayContext) {
          const source = turns.get(sourceTurnId);
          if (!source) throw new Error("retry source fixture is missing");
          const sourceMessage = messages.get(source.userMessageId);
          if (!sourceMessage)
            throw new Error("retry source message is missing");
          return {
            turn: structuredClone(turn),
            messages: [
              { role: "user" as const, content: sourceMessage.content },
            ],
            snapshot: frozen ?? {
              version: 1,
              summaryVersion: 0,
              messageIds: [source.userMessageId],
              groundingRefs: [],
              assembledAt: "2026-07-12T00:00:00.000Z",
            },
          };
        }
        return {
          turn: structuredClone(turn),
          messages: frozen.gatewayContext.messages,
          snapshot: structuredClone(frozen),
        };
      }
      transitionTurn(turnId, "grounding");
      return {
        turn: structuredClone(turn),
        messages: [{ role: "user" as const, content: acceptedContent }],
        snapshot: {
          version: 7,
          summaryVersion: 3,
          messageIds: [uuid(300 + turnNumber)],
          groundingRefs: [],
          assembledAt: "2026-07-12T00:00:00.000Z",
        },
      };
    }),
    captureGatewayContext: vi.fn(
      async (_actor, turnId, snapshot, gatewayContext) => {
        void _actor;
        events.push("conversation.captureGatewayContext");
        if (options.acceptedSetupFailure === "capture") {
          throw new Error("raw-secret-provider-body");
        }
        const captured = { ...snapshot, gatewayContext };
        capturedSnapshots.set(turnId, structuredClone(captured));
        const turn = turns.get(turnId);
        if (!turn) throw new Error("captured fixture turn is missing");
        turns.set(turnId, {
          ...turn,
          contextSnapshot: structuredClone(captured),
        });
        return captured;
      },
    ),
    markGenerating: vi.fn(async (_actor, turnId) => {
      events.push("conversation.markGenerating");
      if (options.acceptedSetupFailure === "mark_generating") {
        throw new Error("raw-secret-provider-body");
      }
      transitionTurn(turnId, "generating");
    }),
    markValidating: vi.fn(async (_actor, turnId) => {
      events.push("conversation.markValidating");
      if (options.acceptedSetupFailure === "mark_validating") {
        throw new Error("raw-secret-provider-body");
      }
      transitionTurn(turnId, "validating");
    }),
    completeTurn: vi.fn(async (_actor, turnId, input) => {
      events.push("conversation.completeTurn");
      transitionTurn(turnId, "completed", {
        providerName: input.providerName ?? "deterministic",
        content: input.content,
        aiInvocationId: input.invocationId ?? null,
        metadata: (input.metadata ??
          {}) as SettlementAiTurnCompletionInput["metadata"],
      });
    }),
    failTurn: vi.fn(async (_actor, turnId, input) => {
      events.push("conversation.failTurn");
      if (options.failFailTurn)
        throw new Error("conversation failure persistence failed");
      transitionTurn(turnId, "failed", undefined, {
        errorCode: input.errorCode,
        retryable: input.retryable,
      });
    }),
  };

  const queue = [...outputs];
  const gatewayGates = [...(options.gatewayGates ?? [])];
  const gateway: SettlementStructuredGateway = async () => {
    events.push("gateway.execute");
    const output = queue.shift();
    const gate = gatewayGates.length
      ? gatewayGates.shift()
      : options.gatewayGate;
    if (gate) await gate;
    if (!output || "providerFailure" in output) {
      return gatewayResult(undefined, {
        status: "failed",
        errorSummary: "provider unavailable",
      });
    }
    return gatewayResult(output);
  };
  const repository = new InMemoryAuthoringRepository(
    events,
    options,
    transitionTurn,
  );
  const catalogPort: SettlementVariableCatalogPort = {
    getCatalog: vi.fn(async () => {
      events.push("catalog.getCatalog");
      return catalog();
    }),
  };
  const evidencePort: AuthorizedSimulationEvidencePort = {
    loadAuthorizedEvidence: vi.fn(async (input) => {
      events.push("evidence.loadAuthorizedEvidence");
      evidenceInputs.push(structuredClone(input));
      const evidence = structuredClone(
        authorizedEvidence(input, options.currentMarginCents ?? "5000"),
      );
      if (options.evidenceFailure === "scope") {
        evidence.provenance.projectId = uuid(999);
      } else if (options.evidenceFailure === "hash") {
        evidence.provenance.evidenceHash = "f".repeat(64);
      } else if (options.evidenceFailure === "selection_token") {
        evidence.provenance.selectionToken = "selection-token-other";
      } else if (options.evidenceFailure === "optional_policy_hash") {
        evidence.provenance.optionalPolicyHash = "f".repeat(64);
        evidence.provenance.evidenceHash =
          calculateCustomRuleEvidenceHash(evidence);
      }
      return deepFreezeFixture(evidence);
    }),
  };
  const simulationInputs: CustomRuleSimulationInput[] = [];
  const adapter = createSettlementRuleAiAdapter({ gateway });
  const service = createCustomRuleAuthoringService({
    conversation,
    ai: {
      prepare(input) {
        events.push("ai.prepare");
        if (options.acceptedSetupFailure === "ai_prepare") {
          throw new Error("raw-secret-provider-body");
        }
        return adapter.prepare(input);
      },
      restore(context) {
        events.push("ai.restore");
        if (options.acceptedSetupFailure === "ai_restore") {
          throw new Error("raw-secret-provider-body");
        }
        return adapter.restore(context);
      },
      execute: adapter.execute,
    },
    repository,
    catalog: catalogPort,
    evidence: evidencePort,
    analyzeReadiness: (input) => {
      readinessInputs.push(structuredClone([...input.inputs]));
      return analyzeCustomRuleDataReadiness(input);
    },
    simulate: (input) => {
      simulationInputs.push(input);
      return simulateCustomSettlementRule(input);
    },
    primaryProvider: "deterministic",
    persistFailedRevisions: options.persistFailedRevisions ?? false,
  });
  return {
    service,
    conversation,
    repository,
    catalogPort,
    evidencePort,
    simulationInputs,
    readinessInputs,
    evidenceInputs,
    events,
    seedConversationMessage(message: AiConversationMessageDto) {
      messages.set(message.id, structuredClone(message));
    },
    expireTurn(turnId: string) {
      transitionTurn(turnId, "failed", undefined, {
        errorCode: "turn_lease_expired",
        retryable: true,
      });
    },
    tamperTurnForTest(turnId: string, patch: Partial<StoredConversationTurn>) {
      const turn = turns.get(turnId);
      if (!turn) throw new Error("turn tamper fixture is missing");
      turns.set(turnId, { ...turn, ...structuredClone(patch) });
    },
    deleteTurnForTest(turnId: string) {
      if (!turns.delete(turnId)) {
        throw new Error("turn deletion fixture is missing");
      }
    },
    tamperMessageForTest(
      messageId: string,
      patch: Partial<AiConversationMessageDto>,
    ) {
      const message = messages.get(messageId);
      if (!message) throw new Error("message tamper fixture is missing");
      messages.set(messageId, { ...message, ...structuredClone(patch) });
    },
    deleteMessageForTest(messageId: string) {
      if (!messages.delete(messageId)) {
        throw new Error("message deletion fixture is missing");
      }
    },
    queueMixedRecoveryHistoryForTest(
      successorTurnId: string,
      freshReadsBeforeStale: number,
    ) {
      for (let index = 0; index < freshReadsBeforeStale; index += 1) {
        historyReadQueue.push(currentHistory());
      }
      const stale = currentHistory();
      const turnIndex = stale.turns.findIndex(
        (turn) => turn.id === successorTurnId,
      );
      if (turnIndex < 0) {
        throw new Error("mixed history successor fixture is missing");
      }
      stale.turns[turnIndex] = {
        ...stale.turns[turnIndex],
        status: "validating",
        errorCode: null,
        retryable: false,
      };
      const assistantId = stale.turns[turnIndex].assistantMessageId;
      const assistantIndex = stale.messages.findIndex(
        (message) => message.id === assistantId,
      );
      if (assistantIndex < 0) {
        throw new Error("mixed history assistant fixture is missing");
      }
      stale.messages[assistantIndex] = {
        ...stale.messages[assistantIndex],
        status: "pending",
        content: "",
        metadata: undefined,
      };
      historyReadQueue.push(stale);
    },
    transitionTurnForTest(
      turnId: string,
      status: AiConversationTurnDto["status"],
      completion?: SettlementAiTurnCompletionInput,
      failure?: { errorCode: string; retryable: boolean },
    ) {
      transitionTurn(turnId, status, completion, failure);
    },
    tamperFrozenServiceContext(turnId: string, patch: Record<string, unknown>) {
      const turn = turns.get(turnId);
      const snapshot = turn?.contextSnapshot;
      const gatewayContext = snapshot?.gatewayContext;
      const serviceContext =
        gatewayContext?.invocationMetadata.settlementServiceRetryContext;
      if (
        !turn ||
        !snapshot ||
        !gatewayContext ||
        typeof serviceContext !== "object" ||
        serviceContext === null
      ) {
        throw new Error("frozen service context fixture is missing");
      }
      const tampered = {
        ...snapshot,
        gatewayContext: {
          ...gatewayContext,
          invocationMetadata: {
            ...gatewayContext.invocationMetadata,
            settlementServiceRetryContext: {
              ...serviceContext,
              ...patch,
            },
          },
        },
      };
      turns.set(turnId, {
        ...turn,
        contextSnapshot: structuredClone(tampered),
      });
      capturedSnapshots.set(turnId, structuredClone(tampered));
    },
    tamperFrozenAiAmbiguitiesForTest(
      turnId: string,
      ambiguities: SettlementAiUnresolvedAmbiguity[],
    ) {
      const turn = turns.get(turnId);
      const snapshot = turn?.contextSnapshot;
      const gatewayContext = snapshot?.gatewayContext;
      const aiContext =
        gatewayContext?.invocationMetadata.settlementAiRetryContext;
      if (
        !turn ||
        !snapshot ||
        !gatewayContext ||
        typeof aiContext !== "object" ||
        aiContext === null
      ) {
        throw new Error("frozen AI context fixture is missing");
      }
      const tampered = {
        ...snapshot,
        gatewayContext: {
          ...gatewayContext,
          invocationMetadata: {
            ...gatewayContext.invocationMetadata,
            settlementAiRetryContext: {
              ...aiContext,
              unresolvedAmbiguities: structuredClone(ambiguities),
            },
          },
        },
      };
      turns.set(turnId, {
        ...turn,
        contextSnapshot: structuredClone(tampered),
      });
      capturedSnapshots.set(turnId, structuredClone(tampered));
    },
    tamperFrozenInvocationForTest(
      turnId: string,
      patch: Record<string, unknown>,
    ) {
      const turn = turns.get(turnId);
      const snapshot = turn?.contextSnapshot;
      const gatewayContext = snapshot?.gatewayContext;
      if (!turn || !snapshot || !gatewayContext) {
        throw new Error("frozen invocation fixture is missing");
      }
      const tampered = {
        ...snapshot,
        gatewayContext: {
          ...gatewayContext,
          invocationMetadata: {
            ...gatewayContext.invocationMetadata,
            ...patch,
          },
        },
      };
      turns.set(turnId, {
        ...turn,
        contextSnapshot: structuredClone(tampered),
      });
      capturedSnapshots.set(turnId, structuredClone(tampered));
    },
  };
}

class InMemoryConversationPersistence implements ConversationPersistence {
  private conversation: AiConversationDto | null = null;
  private readonly messages = new Map<string, AiConversationMessageDto>();
  private readonly turns = new Map<string, StoredConversationTurn>();
  private readonly requestTurns = new Map<string, string>();
  private turnSequence = 0;
  private messageSequence = 0;

  async createConversation(
    input: Parameters<ConversationPersistence["createConversation"]>[0],
  ): Promise<AiConversationDto | null> {
    if (
      input.organizationId !== ORGANIZATION_ID ||
      input.ownerUserId !== USER_ID
    ) {
      return null;
    }
    const now = "2026-07-12T00:00:00.000Z";
    this.conversation = {
      id: CONVERSATION_ID,
      title: input.title,
      status: "active",
      lastMessageAt: now,
      createdAt: now,
      updatedAt: now,
    };
    return structuredClone(this.conversation);
  }

  async listConversations(
    input: Parameters<ConversationPersistence["listConversations"]>[0],
  ): Promise<AiConversationDto[]> {
    return this.matchesActor(input) && this.conversation
      ? [structuredClone(this.conversation)]
      : [];
  }

  async getConversation(
    input: Parameters<ConversationPersistence["getConversation"]>[0],
  ): Promise<AiConversationDto | null> {
    return this.matchesScope(input) && this.conversation
      ? structuredClone(this.conversation)
      : null;
  }

  async listMessages(
    input: Parameters<ConversationPersistence["listMessages"]>[0],
  ): Promise<AiConversationMessageDto[]> {
    if (!this.matchesScope(input)) return [];
    return [...this.messages.values()]
      .sort((left, right) => left.sequence - right.sequence)
      .slice(-(input.limit ?? 200))
      .map((message) => structuredClone(message));
  }

  async listTurns(
    input: Parameters<ConversationPersistence["listTurns"]>[0],
  ): Promise<StoredConversationTurn[]> {
    if (!this.matchesScope(input)) return [];
    return [...this.turns.values()]
      .slice(-(input.limit ?? 200))
      .map((turn) => structuredClone(turn));
  }

  async createTurn(
    input: Parameters<ConversationPersistence["createTurn"]>[0],
  ): Promise<CreatedConversationTurn | null> {
    if (!this.matchesScope(input)) return null;
    const requestTurnId = this.requestTurns.get(input.clientRequestId);
    if (requestTurnId) {
      const duplicate = this.turns.get(requestTurnId);
      return duplicate ? this.createdTurn(duplicate, true) : null;
    }

    const source = input.sourceTurnId
      ? this.turns.get(input.sourceTurnId)
      : undefined;
    if (input.kind !== "user" && !source) return null;
    if (source) {
      const successor = [...this.turns.values()].find((turn) =>
        input.kind === "retry"
          ? turn.retryOfTurnId === source.id
          : turn.regenerateOfTurnId === source.id,
      );
      if (successor) return this.createdTurn(successor, true);
    }

    this.turnSequence += 1;
    const turnId = uuid(700 + this.turnSequence);
    let userMessageId: string;
    let attempt = 1;
    let contextSnapshot: ConversationContextSnapshot | null = null;
    if (input.kind === "user") {
      this.messageSequence += 1;
      userMessageId = uuid(800 + this.messageSequence);
      this.messages.set(userMessageId, {
        id: userMessageId,
        conversationId: input.conversationId,
        sequence: this.messageSequence,
        role: "user",
        status: "completed",
        content: input.content ?? "",
        parentMessageId: null,
        createdAt: "2026-07-12T00:00:00.000Z",
        updatedAt: "2026-07-12T00:00:00.000Z",
      });
    } else {
      userMessageId = source!.userMessageId;
      attempt = source!.attempt + 1;
      contextSnapshot = source!.contextSnapshot
        ? structuredClone(source!.contextSnapshot)
        : null;
      if (input.kind === "retry") {
        const sourceAssistant = this.messages.get(source!.assistantMessageId);
        if (sourceAssistant?.status === "failed") {
          this.messages.set(sourceAssistant.id, {
            ...sourceAssistant,
            status: "superseded",
            updatedAt: "2026-07-12T00:00:01.000Z",
          });
        }
      }
    }

    this.messageSequence += 1;
    const assistantMessageId = uuid(800 + this.messageSequence);
    this.messages.set(assistantMessageId, {
      id: assistantMessageId,
      conversationId: input.conversationId,
      sequence: this.messageSequence,
      role: "assistant",
      status: "pending",
      content: "",
      parentMessageId: userMessageId,
      createdAt: "2026-07-12T00:00:00.000Z",
      updatedAt: "2026-07-12T00:00:00.000Z",
    });
    const turn: StoredConversationTurn = {
      id: turnId,
      conversationId: input.conversationId,
      userMessageId,
      assistantMessageId,
      mode: input.mode,
      status: "accepted",
      attempt,
      contextSnapshot,
      retryOfTurnId: input.kind === "retry" ? source!.id : null,
      regenerateOfTurnId: input.kind === "regenerate" ? source!.id : null,
      providerName: null,
      errorCode: null,
      errorSummary: null,
      retryable: true,
    };
    this.turns.set(turn.id, turn);
    this.requestTurns.set(input.clientRequestId, turn.id);
    return this.createdTurn(turn, false);
  }

  async getTurn(
    input: Parameters<ConversationPersistence["getTurn"]>[0],
  ): Promise<StoredConversationTurn | null> {
    if (!this.matchesActor(input)) return null;
    const turn = this.turns.get(input.turnId);
    return turn ? structuredClone(turn) : null;
  }

  async transitionTurn(
    input: Parameters<ConversationPersistence["transitionTurn"]>[0],
  ): Promise<boolean> {
    if (!this.matchesActor(input)) return false;
    const turn = this.turns.get(input.turnId);
    if (!turn || turn.status !== input.from) return false;
    this.turns.set(turn.id, {
      ...turn,
      status: input.to,
      contextSnapshot: input.patch?.contextSnapshot
        ? structuredClone(input.patch.contextSnapshot)
        : turn.contextSnapshot,
      providerName: input.patch?.providerName ?? turn.providerName,
    });
    return true;
  }

  async completeTurn(
    input: Parameters<ConversationPersistence["completeTurn"]>[0],
  ): Promise<boolean> {
    if (!this.matchesActor(input)) return false;
    const turn = this.turns.get(input.turnId);
    const assistant = turn
      ? this.messages.get(turn.assistantMessageId)
      : undefined;
    if (!turn || !assistant || turn.status !== "validating") return false;
    this.turns.set(turn.id, {
      ...turn,
      status: "completed",
      providerName: input.providerName ?? turn.providerName,
      errorCode: null,
      errorSummary: null,
      retryable: false,
    });
    this.messages.set(assistant.id, {
      ...assistant,
      status: "completed",
      content: input.content,
      metadata: structuredClone(input.metadata ?? {}),
      updatedAt: "2026-07-12T00:00:02.000Z",
    });
    return true;
  }

  async failTurn(
    input: Parameters<ConversationPersistence["failTurn"]>[0],
  ): Promise<boolean> {
    if (!this.matchesActor(input)) return false;
    const turn = this.turns.get(input.turnId);
    const assistant = turn
      ? this.messages.get(turn.assistantMessageId)
      : undefined;
    if (!turn || !assistant) return false;
    this.turns.set(turn.id, {
      ...turn,
      status: "failed",
      providerName: input.providerName ?? turn.providerName,
      errorCode: input.errorCode,
      errorSummary: input.errorSummary,
      retryable: input.retryable,
    });
    this.messages.set(assistant.id, {
      ...assistant,
      status: "failed",
      content: input.content ?? assistant.content,
      metadata: {
        ...(assistant.metadata ?? {}),
        errorCode: input.errorCode,
        retryable: input.retryable,
      },
      updatedAt: "2026-07-12T00:00:02.000Z",
    });
    return true;
  }

  async renewLease(
    input: Parameters<ConversationPersistence["renewLease"]>[0],
  ): Promise<boolean> {
    return this.matchesActor(input) && this.turns.has(input.turnId);
  }

  seedFailedTurn(input: {
    turnId: string;
    userMessageId: string;
    assistantMessageId: string;
    retryable: boolean;
    contextSnapshot: ConversationContextSnapshot;
  }): void {
    if (!this.conversation)
      throw new Error("conversation must be created first");
    this.messageSequence += 1;
    this.messages.set(input.userMessageId, {
      id: input.userMessageId,
      conversationId: this.conversation.id,
      sequence: this.messageSequence,
      role: "user",
      status: "completed",
      content: "Retry this settlement authoring turn.",
      parentMessageId: null,
      createdAt: "2026-07-12T00:00:00.000Z",
      updatedAt: "2026-07-12T00:00:00.000Z",
    });
    this.messageSequence += 1;
    this.messages.set(input.assistantMessageId, {
      id: input.assistantMessageId,
      conversationId: this.conversation.id,
      sequence: this.messageSequence,
      role: "assistant",
      status: "failed",
      content: "",
      parentMessageId: input.userMessageId,
      metadata: {
        errorCode: "settlement_source_failed",
        retryable: input.retryable,
      },
      createdAt: "2026-07-12T00:00:00.000Z",
      updatedAt: "2026-07-12T00:00:00.000Z",
    });
    this.turns.set(input.turnId, {
      id: input.turnId,
      conversationId: this.conversation.id,
      userMessageId: input.userMessageId,
      assistantMessageId: input.assistantMessageId,
      mode: "fast",
      status: "failed",
      attempt: 1,
      contextSnapshot: structuredClone(input.contextSnapshot),
      retryOfTurnId: null,
      regenerateOfTurnId: null,
      providerName: "deterministic",
      errorCode: "settlement_source_failed",
      errorSummary: "Settlement source failed.",
      retryable: input.retryable,
    });
  }

  private matchesActor(input: {
    organizationId: string;
    ownerUserId: string;
  }): boolean {
    return (
      input.organizationId === ORGANIZATION_ID && input.ownerUserId === USER_ID
    );
  }

  private matchesScope(input: {
    organizationId: string;
    ownerUserId: string;
    conversationId: string;
  }): boolean {
    return (
      this.matchesActor(input) && this.conversation?.id === input.conversationId
    );
  }

  private createdTurn(
    turn: StoredConversationTurn,
    duplicate: boolean,
  ): CreatedConversationTurn {
    return {
      conversationId: turn.conversationId,
      turnId: turn.id,
      userMessageId: turn.userMessageId,
      assistantMessageId: turn.assistantMessageId,
      status: turn.status,
      attempt: turn.attempt,
      duplicate,
    };
  }
}

class InMemoryAuthoringRepository implements CustomRuleAuthoringRepositoryPort {
  readonly drafts: CustomRuleDraft[] = [];
  readonly simulations: SettlementFormulaSimulation[] = [];
  readonly createDraftCalls: CreateCustomRuleDraftInput[] = [];
  readonly insertSimulationCalls: InsertSettlementFormulaSimulationInput[] = [];
  readonly finalizeDraftTurnCalls: FinalizeSettlementAiDraftTurnInput[] = [];
  readonly finalizeSimulationTurnCalls: FinalizeSettlementAiSimulationTurnInput[] =
    [];
  readonly finalizeFailedTurnCalls: FinalizeSettlementAiFailedTurnInput[] = [];
  readonly atomicFailureSnapshots: Array<{
    kind: "draft" | "simulation" | "failed";
    draftCount: number;
    simulationCount: number;
    turnStatus: AiConversationTurnDto["status"];
  }> = [];
  readonly listSimulationCalls: Parameters<
    CustomRuleRepository["listSimulations"]
  >[0][] = [];
  private atomicDraftFailures = 0;
  private atomicSimulationFailures = 0;
  private atomicFailedFailures = 0;
  private hiddenDraftIdempotencyKey: string | null = null;
  private hiddenSimulationIdempotencyKey: string | null = null;
  private remainingDraftReadbackMisses = 0;
  private remainingSimulationReadbackMisses = 0;

  constructor(
    private readonly events: string[],
    private readonly options: {
      atomicDraftFailure?: "before_write" | "after_commit" | "partial";
      tamperAtomicDraftAfterCommit?: "content" | "hash";
      atomicSimulationFailure?: "before_write" | "after_commit" | "partial";
      atomicFailedFailure?: "before_write" | "after_commit" | "partial";
      transientDraftReadbackMisses?: number;
      transientSimulationReadbackMisses?: number;
      evidenceFailure?:
        | "scope"
        | "hash"
        | "selection_token"
        | "optional_policy_hash";
      currentMarginCents?: string;
      failFailTurn?: boolean;
      acceptedSetupFailure?:
        | "prepare_turn"
        | "ai_prepare"
        | "capture"
        | "mark_generating"
        | "mark_validating"
        | "ai_restore";
      retryTurnStatus?:
        | "accepted"
        | "grounding"
        | "generating"
        | "validating"
        | "completed"
        | "failed"
        | "cancelled";
      retryReturnedStatus?: AiConversationTurnDto["status"];
      retryTurnDuplicate?: boolean;
      retryTurnRetryable?: boolean;
      retryTerminalCompletion?: SettlementAiTurnCompletionInput;
      retryContextSnapshot?: ConversationContextSnapshot;
      gatewayGate?: Promise<void>;
      gatewayGates?: Array<Promise<void> | undefined>;
      retryConversationMismatch?: boolean;
    },
    private readonly transitionTurn: (
      turnId: string,
      status: AiConversationTurnDto["status"],
      completion?: SettlementAiTurnCompletionInput,
      failure?: { errorCode: string; retryable: boolean },
    ) => void,
  ) {}

  seedDraft(draft: CustomRuleDraft): CustomRuleDraft {
    const copy = structuredClone(draft);
    this.drafts.push(copy);
    return copy;
  }

  hideDraftOnceForTest(idempotencyKey: string): void {
    this.hiddenDraftIdempotencyKey = idempotencyKey;
    this.remainingDraftReadbackMisses = 1;
  }

  tamperDraftForTest(draftId: string, patch: Partial<CustomRuleDraft>): void {
    const draft = this.drafts.find((candidate) => candidate.id === draftId);
    if (!draft) throw new Error("draft tamper fixture is missing");
    Object.assign(draft, structuredClone(patch));
  }

  async finalizeDraftTurn(
    input: FinalizeSettlementAiDraftTurnInput,
  ): Promise<CreatedCustomRuleDraft> {
    this.events.push("repository.finalizeDraftTurn");
    this.finalizeDraftTurnCalls.push(structuredClone(input));
    this.createDraftCalls.push(structuredClone(input.draft));
    const failure = this.takeAtomicFailure("draft");
    if (failure === "before_write") {
      this.recordAtomicFailure("draft");
      throw new Error("atomic draft transport failure before commit");
    }
    const created = this.persistDraft(input.draft);
    if (failure === "partial") {
      throw new Error("atomic draft partial-state fixture");
    }
    this.transitionTurn(
      input.draft.turnTrace.turnId,
      "completed",
      input.completion,
    );
    if (this.options.tamperAtomicDraftAfterCommit) {
      const stored = this.drafts.find((draft) => draft.id === created.id);
      if (!stored) throw new Error("atomic draft tamper fixture is missing");
      if (this.options.tamperAtomicDraftAfterCommit === "content") {
        stored.aiResponse.content = "tampered persisted assistant content";
      } else {
        stored.contractHash = "f".repeat(64);
      }
    }
    if (failure === "after_commit") {
      this.hideCommittedDraftForTransientReadback(input.draft.idempotencyKey);
      throw new Error("atomic draft response lost after commit");
    }
    return created;
  }

  async finalizeSimulationTurn(
    input: FinalizeSettlementAiSimulationTurnInput,
  ): Promise<FinalizedSettlementAiSimulationTurn> {
    this.events.push("repository.finalizeSimulationTurn");
    this.finalizeSimulationTurnCalls.push(structuredClone(input));
    this.createDraftCalls.push(structuredClone(input.draft));
    const failure = this.takeAtomicFailure("simulation");
    if (failure === "before_write") {
      this.recordAtomicFailure("simulation");
      throw new Error("atomic simulation transport failure before commit");
    }
    const created = this.persistDraft(input.draft);
    if (failure === "partial") {
      throw new Error("atomic simulation partial-state fixture");
    }
    const simulationInput: InsertSettlementFormulaSimulationInput = {
      organizationId: input.draft.organizationId,
      projectId: input.draft.projectId,
      owner: { kind: "ai_draft", id: created.id },
      formulaHash: input.draft.formulaHash,
      ruleContractHash: input.draft.contractHash,
      parameterHash: input.draft.parameterHash,
      variableCatalogVersion: input.draft.variableCatalogVersion,
      ...input.simulation,
    };
    this.insertSimulationCalls.push(structuredClone(simulationInput));
    const simulation = this.persistSimulation(simulationInput);
    const draft = this.drafts.find((candidate) => candidate.id === created.id);
    if (!draft || draft.initialStatus !== "contract_ready") {
      throw new Error("atomic simulation draft fixture is invalid");
    }
    draft.status = "simulated";
    this.transitionTurn(
      input.draft.turnTrace.turnId,
      "completed",
      input.completion,
    );
    if (failure === "after_commit") {
      this.hideCommittedDraftForTransientReadback(input.draft.idempotencyKey);
      this.hiddenSimulationIdempotencyKey = input.simulation.idempotencyKey;
      this.remainingSimulationReadbackMisses =
        this.options.transientSimulationReadbackMisses ?? 0;
      throw new Error("atomic simulation response lost after commit");
    }
    return {
      draft: { ...structuredClone(draft), duplicate: created.duplicate },
      simulation,
    };
  }

  async finalizeFailedTurn(
    input: FinalizeSettlementAiFailedTurnInput,
  ): Promise<CreatedCustomRuleDraft> {
    this.events.push("repository.finalizeFailedTurn");
    this.finalizeFailedTurnCalls.push(structuredClone(input));
    this.createDraftCalls.push(structuredClone(input.draft));
    const failure = this.takeAtomicFailure("failed");
    if (failure === "before_write") {
      this.recordAtomicFailure("failed");
      throw new Error("atomic failed-turn transport failure before commit");
    }
    const created = this.persistDraft(input.draft);
    if (failure === "partial") {
      throw new Error("atomic failed-turn partial-state fixture");
    }
    this.transitionTurn(
      input.draft.turnTrace.turnId,
      "failed",
      input.completion,
      { errorCode: input.errorCode, retryable: input.retryable },
    );
    if (failure === "after_commit") {
      this.hideCommittedDraftForTransientReadback(input.draft.idempotencyKey);
      throw new Error("atomic failed-turn response lost after commit");
    }
    return created;
  }

  private persistDraft(
    input: CreateCustomRuleDraftInput,
  ): CreatedCustomRuleDraft {
    const duplicate = this.drafts.find(
      (draft) => draft.idempotencyKey === input.idempotencyKey,
    );
    if (duplicate) return { ...structuredClone(duplicate), duplicate: true };
    const previous = this.drafts
      .filter((draft) => draft.conversationId === input.conversationId)
      .sort((left, right) => right.revisionNumber - left.revisionNumber)[0];
    const revisionNumber = (previous?.revisionNumber ?? 0) + 1;
    const id = uuid(100 + revisionNumber);
    const created = createStoredDraft(input, {
      id,
      revisionNumber,
      createdBy: USER_ID,
      createdAt: "2026-07-12T00:00:00.000Z",
      supersedesDraftId: previous?.id ?? null,
    });
    if (previous) {
      const previousIndex = this.drafts.indexOf(previous);
      this.drafts[previousIndex] = supersedeDraft(previous, id);
    }
    this.drafts.push(created);
    return { ...structuredClone(created), duplicate: false };
  }

  async listDrafts(
    input: Parameters<CustomRuleRepository["listDrafts"]>[0],
  ): Promise<CustomRuleDraft[]> {
    this.events.push("repository.listDrafts");
    const hiddenKey =
      this.remainingDraftReadbackMisses > 0
        ? this.hiddenDraftIdempotencyKey
        : null;
    if (this.remainingDraftReadbackMisses > 0) {
      this.remainingDraftReadbackMisses -= 1;
    }
    return this.drafts
      .filter(
        (draft) =>
          draft.organizationId === input.organizationId &&
          draft.projectId === input.projectId &&
          draft.conversationId === input.conversationId &&
          draft.idempotencyKey !== hiddenKey,
      )
      .sort((left, right) =>
        input.revisionOrder === "asc"
          ? left.revisionNumber - right.revisionNumber
          : right.revisionNumber - left.revisionNumber,
      )
      .slice(0, input.limit ?? 100)
      .map((draft) => structuredClone(draft));
  }

  async getDraft(
    input: Parameters<CustomRuleRepository["getDraft"]>[0],
  ): Promise<CustomRuleDraft | null> {
    this.events.push("repository.getDraft");
    const draft = this.drafts.find(
      (candidate) =>
        candidate.id === input.draftId &&
        candidate.organizationId === input.organizationId &&
        candidate.projectId === input.projectId &&
        candidate.conversationId === input.conversationId,
    );
    return draft ? structuredClone(draft) : null;
  }

  private persistSimulation(
    input: InsertSettlementFormulaSimulationInput,
  ): InsertedSettlementFormulaSimulation {
    const existing = this.simulations.find(
      (simulation) => simulation.idempotencyKey === input.idempotencyKey,
    );
    if (existing) {
      if (existing.summarySchemaVersion !== 2 || !existing.summaryComplete) {
        throw new Error("legacy simulation cannot satisfy a current write");
      }
      return { ...structuredClone(existing), duplicate: true };
    }
    const simulation: InsertedSettlementFormulaSimulation = {
      ...structuredClone(input),
      id: uuid(500 + this.simulations.length + 1),
      summarySchemaVersion: 2,
      summaryComplete: true,
      summaryStatus: "complete",
      historicalTotals: {
        ...structuredClone(input.historicalTotals),
        payableAmountCents: input.historicalTotals.oldPayableAmountCents,
        receivableAmountCents: input.historicalTotals.oldReceivableAmountCents,
      },
      warnings: input.warnings.map((warning) => ({
        ...structuredClone(warning),
        kind: warning.kind ?? "warning",
      })),
      createdBy: USER_ID,
      createdAt: "2026-07-12T00:00:00.000Z",
      duplicate: false,
    };
    this.simulations.push(simulation);
    if (input.owner.kind === "ai_draft") {
      const draft = this.drafts.find(
        (candidate) => candidate.id === input.owner.id,
      );
      if (draft && draft.status === "contract_ready")
        draft.status = "simulated";
    }
    return structuredClone(simulation);
  }

  private takeAtomicFailure(
    kind: "draft" | "simulation" | "failed",
  ): "before_write" | "after_commit" | "partial" | undefined {
    if (kind === "draft") {
      if (this.atomicDraftFailures > 0) return undefined;
      this.atomicDraftFailures += 1;
      return this.options.atomicDraftFailure;
    }
    if (kind === "simulation") {
      if (this.atomicSimulationFailures > 0) return undefined;
      this.atomicSimulationFailures += 1;
      return this.options.atomicSimulationFailure;
    }
    if (this.atomicFailedFailures > 0) return undefined;
    this.atomicFailedFailures += 1;
    return this.options.atomicFailedFailure;
  }

  private hideCommittedDraftForTransientReadback(idempotencyKey: string): void {
    this.hiddenDraftIdempotencyKey = idempotencyKey;
    this.remainingDraftReadbackMisses =
      this.options.transientDraftReadbackMisses ?? 0;
  }

  private recordAtomicFailure(kind: "draft" | "simulation" | "failed"): void {
    this.atomicFailureSnapshots.push({
      kind,
      draftCount: this.drafts.length,
      simulationCount: this.simulations.length,
      turnStatus: "validating",
    });
  }

  async listSimulations(
    input: Parameters<CustomRuleRepository["listSimulations"]>[0],
  ): Promise<SettlementFormulaSimulation[]> {
    this.events.push("repository.listSimulations");
    this.listSimulationCalls.push(structuredClone(input));
    const hiddenKey =
      this.remainingSimulationReadbackMisses > 0
        ? this.hiddenSimulationIdempotencyKey
        : null;
    if (this.remainingSimulationReadbackMisses > 0) {
      this.remainingSimulationReadbackMisses -= 1;
    }
    return this.simulations
      .filter(
        (simulation) =>
          simulation.organizationId === input.organizationId &&
          simulation.projectId === input.projectId &&
          simulation.owner.kind === input.owner.kind &&
          simulation.owner.id === input.owner.id &&
          simulation.idempotencyKey !== hiddenKey,
      )
      .slice(0, input.limit ?? 100)
      .map((simulation) => structuredClone(simulation));
  }
}

type StoredDraftMetadata = {
  id: string;
  revisionNumber: number;
  createdBy: string;
  createdAt: string;
  supersedesDraftId: string | null;
};

function createStoredDraft(
  input: CreateCustomRuleDraftInput,
  metadata: StoredDraftMetadata,
): CustomRuleDraft {
  switch (input.status) {
    case "clarifying":
      return {
        ...structuredClone(input),
        ...metadata,
        initialStatus: "clarifying",
        status: "clarifying",
        supersededByDraftId: null,
        supersededAt: null,
      };
    case "failed":
      return {
        ...structuredClone(input),
        ...metadata,
        initialStatus: "failed",
        status: "failed",
        supersededByDraftId: null,
        supersededAt: null,
      };
    case "contract_ready":
      return {
        ...structuredClone(input),
        ...metadata,
        initialStatus: "contract_ready",
        status: "contract_ready",
        supersededByDraftId: null,
        supersededAt: null,
      };
  }
}

function supersedeDraft(
  draft: CustomRuleDraft,
  supersededByDraftId: string,
): CustomRuleDraft {
  const lifecycle: {
    status: "superseded";
    supersededByDraftId: string;
    supersededAt: string;
  } = {
    status: "superseded",
    supersededByDraftId,
    supersededAt: "2026-07-12T00:00:00.000Z",
  };
  switch (draft.initialStatus) {
    case "clarifying":
      return { ...draft, ...lifecycle };
    case "failed":
      return { ...draft, ...lifecycle };
    case "contract_ready":
      return { ...draft, ...lifecycle };
  }
}

function confirmInput(draft: CustomRuleDraft) {
  return {
    actor,
    projectId: PROJECT_ID,
    conversationId: CONVERSATION_ID,
    expectedDraftId: draft.id,
    expectedRevisionNumber: draft.revisionNumber,
    clientRequestId: "confirm-request-0001",
    promptText: "我确认以上业务规则。",
    contractConfirmed: true as const,
    expectedContractHash: draft.contractHash,
    expectedCatalogVersion: CATALOG_VERSION,
    simulationSelection: safeSelection(),
  };
}

function clarificationOutput(question: string, code: string) {
  return {
    contractPatch: {},
    unresolvedAmbiguities: [{ code, question, required: true }],
    nextQuestion: question,
    formulaProposal: null,
    testCases: [],
    safetyFlags: [],
  };
}

function confirmedFormulaOutput() {
  return {
    contractPatch: {},
    unresolvedAmbiguities: [],
    nextQuestion: null,
    formulaProposal: "payable = money_result({ final: yuan(20) })",
    testCases: [
      {
        name: "确认后的标准场景",
        inputs: { system_minutes: { type: "integer", value: 60 } },
        expectedResult: { type: "money_cents", amountCents: 2_000 },
      },
    ],
    safetyFlags: ["仅用于草案试算"],
  };
}

function optionalFormulaOutput() {
  const output = confirmedFormulaOutput();
  return {
    ...output,
    formulaProposal:
      "payable = money_result({ final: if(evidence_level == evidence_level, yuan(20), yuan(20)) })",
    testCases: output.testCases.map((testCase) => ({
      ...testCase,
      inputs: {
        ...testCase.inputs,
        evidence_level: { type: "string", value: "green" },
      },
    })),
  };
}

function clarifyingDraft(
  options: {
    unresolvedAmbiguities?: [
      SettlementAiUnresolvedAmbiguity,
      ...SettlementAiUnresolvedAmbiguity[],
    ];
    turnTrace?: {
      turnId: string;
      userMessageId: string;
      assistantMessageId: string;
    };
    idempotencyKey?: string;
    aiResponseContent?: string;
  } = {},
): CustomRuleDraft {
  const businessContract = contract();
  const parameters = Object.fromEntries(
    businessContract.parameters.map((parameter) => [
      parameter.name,
      parameter.defaultValue,
    ]),
  );
  return {
    id: FIRST_DRAFT_ID,
    organizationId: ORGANIZATION_ID,
    projectId: PROJECT_ID,
    conversationId: CONVERSATION_ID,
    idempotencyKey: options.idempotencyKey ?? "seed-draft-request-0001",
    promptText: "每场直播按时长结算。",
    turnTrace: options.turnTrace ?? {
      turnId: uuid(210),
      userMessageId: uuid(310),
      assistantMessageId: uuid(410),
    },
    businessContract,
    unresolvedAmbiguities: options.unresolvedAmbiguities ?? [
      {
        code: "confirm_rate",
        question: "请确认每小时结算单价？",
        required: true,
      },
    ],
    variableCatalogVersion: CATALOG_VERSION,
    aiResponse: {
      content: options.aiResponseContent ?? "请确认每小时结算单价？",
      finishReason: "stop",
      providerRequestId: null,
    },
    generatedFormula: null,
    generatedExplanation: null,
    generatedTestCases: [],
    model: "deterministic",
    safetyFlags: [],
    contractHash: hashCustomRuleContract(businessContract),
    formulaHash: null,
    parameterHash: hashCustomRuleParameters(parameters),
    initialStatus: "clarifying",
    status: "clarifying",
    revisionNumber: 1,
    createdBy: USER_ID,
    createdAt: "2026-07-12T00:00:00.000Z",
    supersedesDraftId: null,
    supersededByDraftId: null,
    supersededAt: null,
  };
}

function confirmableDraft(): CustomRuleDraft {
  return clarifyingDraft({
    unresolvedAmbiguities: [
      {
        code: "confirm_contract",
        question: "请确认以上业务规则无误？",
        required: true,
      },
    ],
  });
}

function simulatedDraft(): CustomRuleDraft {
  const businessContract = contract();
  const expression = "payable = money_result({ final: yuan(20) })";
  const parsed = parseCustomRuleFormula(expression);
  const validated = validateCustomRuleFormula(expression, {
    scope: businessContract.scope,
    executionGrain: businessContract.executionGrain,
    parameters: businessContract.parameters.map((parameter) => ({
      name: parameter.name,
      valueType: parameter.valueType,
    })),
  });
  if (!parsed.ok || !validated.ok) {
    throw new Error("simulated draft fixture formula must be valid");
  }
  const parameters = Object.fromEntries(
    businessContract.parameters.map((parameter) => [
      parameter.name,
      parameter.defaultValue,
    ]),
  );
  return {
    id: FIRST_DRAFT_ID,
    organizationId: ORGANIZATION_ID,
    projectId: PROJECT_ID,
    conversationId: CONVERSATION_ID,
    idempotencyKey: "seed-simulated-draft-request-0001",
    promptText: "我确认以上业务规则。",
    turnTrace: {
      turnId: uuid(211),
      userMessageId: uuid(311),
      assistantMessageId: uuid(411),
    },
    businessContract,
    unresolvedAmbiguities: [],
    variableCatalogVersion: CATALOG_VERSION,
    aiResponse: {
      content: "已生成并试算确认后的规则。",
      finishReason: "stop",
      providerRequestId: null,
    },
    generatedFormula: {
      expression,
      normalizedAst: parsed.ast,
    },
    generatedExplanation: "公式已经过确定性校验和试算。",
    generatedTestCases: [
      {
        name: "确认后的标准场景",
        inputs: { system_minutes: { type: "integer", value: 60 } },
        expectedResult: { type: "money_cents", amountCents: 2_000 },
      },
    ],
    model: "deterministic",
    safetyFlags: [],
    contractHash: hashCustomRuleContract(businessContract),
    formulaHash: validated.formulaHash,
    parameterHash: hashCustomRuleParameters(parameters),
    initialStatus: "contract_ready",
    status: "simulated",
    revisionNumber: 1,
    createdBy: USER_ID,
    createdAt: "2026-07-12T00:00:00.000Z",
    supersedesDraftId: null,
    supersededByDraftId: null,
    supersededAt: null,
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
    version: CATALOG_VERSION,
    variables: [
      {
        id: "system_minutes",
        label: "系统直播时长",
        runtimeType: { kind: "scalar", scalarType: "integer" },
        unit: "分钟",
        sourceLabel: "直播报告系统计时",
        availability: "available",
        coverageNumerator: 1,
        coverageDenominator: 1,
        latestSampledPeriod: { start: "2026-07-01", end: "2026-07-10" },
      },
      {
        id: "evidence_level",
        label: "凭证等级",
        runtimeType: { kind: "scalar", scalarType: "string" },
        unit: "等级",
        sourceLabel: "直播报告凭证等级",
        availability: "available",
        coverageNumerator: 1,
        coverageDenominator: 1,
        latestSampledPeriod: { start: "2026-07-01", end: "2026-07-10" },
      },
    ],
  };
}

function safeSelection(): AuthorizedSimulationSelectionRequest {
  return {
    selectionToken: "selection-token-0001",
    periodStart: "2026-07-01",
    periodEnd: "2026-07-10",
    criteriaCodes: ["approved_reports", "period_overlap", "project_scope"],
  };
}

function authorizedEvidence(
  input: Parameters<
    AuthorizedSimulationEvidencePort["loadAuthorizedEvidence"]
  >[0],
  currentMarginCents: string,
): AuthorizedCustomRuleSimulationEvidence {
  const evidence: AuthorizedCustomRuleSimulationEvidence = {
    provenance: {
      organizationId: input.organizationId,
      projectId: input.projectId,
      actorId: input.actor.userId,
      selectionToken: input.selection.selectionToken,
      evidenceHash: "0".repeat(64),
      optionalPolicyHash: calculateCustomRuleOptionalPolicyHash(
        input.inputs ?? [],
      ),
      immutableSourceVersions: [
        {
          kind: "immutable",
          source: "locked_settlement_item",
          version: "locked-v1",
        },
      ],
    },
    sampleSource: { kind: "historical_settlements" },
    sampleSelection: {
      periodStart: input.selection.periodStart,
      periodEnd: input.selection.periodEnd,
      populationCount: 1,
      criteria: [...input.selection.criteriaCodes],
    },
    records: [
      {
        recordId: "authorized-record-1",
        projectId: input.projectId,
        sourceVersion: {
          kind: "immutable",
          source: "locked_settlement_item",
          version: "locked-v1",
        },
        variables: {
          system_minutes: { type: "integer", value: 60 },
          evidence_level: { type: "string", value: "green" },
        },
        missingInputs: [],
        currentRuleResult: {
          unitSource: "current_rule_cents",
          amountCents: "1600",
        },
      },
    ],
    userExamples: [
      {
        id: "adjustable-standard",
        inputs: {
          system_minutes: { type: "integer", value: 90 },
          evidence_level: { type: "string", value: "green" },
        },
        expectedResult: { type: "money_cents", amountCents: 2_000 },
      },
    ],
    currentMarginCents,
  };
  evidence.provenance.evidenceHash = calculateCustomRuleEvidenceHash(evidence);
  return deepFreezeFixture(evidence);
}

function deepFreezeFixture<Value>(value: Value): Value {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  for (const descriptor of Object.values(
    Object.getOwnPropertyDescriptors(value),
  )) {
    if ("value" in descriptor) deepFreezeFixture(descriptor.value);
  }
  return Object.freeze(value);
}

function contract(): BusinessRuleContract {
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
    effectiveStartAt: "2026-07-12T00:00:00+08:00",
    effectiveEndAt: null,
    missingDataPolicy: { action: "route_item_to_review" },
    compositionDescription: "替换项目级基础应付规则。",
    businessTimezone: "Asia/Shanghai",
    examples: [
      {
        name: "标准场景",
        kind: "normal",
        description: "标准直播场景返回二十元。",
        inputs: { system_minutes: { type: "integer", value: 60 } },
        expectedResult: { type: "money_cents", amountCents: 2_000 },
      },
      {
        name: "零时长",
        kind: "boundary",
        description: "零时长边界仍按确认规则计算。",
        inputs: { system_minutes: { type: "integer", value: 0 } },
        expectedResult: { type: "money_cents", amountCents: 2_000 },
      },
      {
        name: "最大时长",
        kind: "boundary",
        description: "最大时长边界仍按确认规则计算。",
        inputs: { system_minutes: { type: "integer", value: 600 } },
        expectedResult: { type: "money_cents", amountCents: 2_000 },
      },
    ],
  };
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

function uuid(suffix: number): string {
  return `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
}

function expectOrdered(events: string[], expected: string[]): void {
  let previous = -1;
  for (const event of expected) {
    const index = events.indexOf(event, previous + 1);
    expect(index, `${event} missing from ${events.join(", ")}`).toBeGreaterThan(
      previous,
    );
    previous = index;
  }
}
