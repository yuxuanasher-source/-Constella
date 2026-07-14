import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, expectTypeOf, it, vi } from "vitest";

import { analyzeCustomRuleDataReadiness } from "./custom-rule-data-readiness";
import { buildCustomRuleVariableCatalog } from "./custom-rule-variable-catalog";
import * as customRuleRepositoryModule from "./custom-rule-repository";
import {
  SupabaseCustomRuleReadRepository,
  type ClarifyingCustomRuleDraftInput,
  type ContractReadyCustomRuleDraftInput,
  type CreateSettlementReconciliationRunInput,
  type CreateCustomRuleDraftInput,
  type CustomRuleRepository,
  type CustomRuleReadRepository,
  CustomRulePersistenceDataError,
  type FailedCustomRuleDraftInput,
  type FinalizeSettlementAiSimulationSummaryInput,
  type CompleteSettlementFormulaSimulation,
  type InsertSettlementFormulaSimulationInput,
  type LegacySettlementFormulaSimulation,
  type SettlementAiFormulaDraft,
  type SettlementFormulaSimulation,
  type SettlementSimulationOwner,
} from "./custom-rule-repository";
import {
  cloneRuleVersionToEditableDraft,
  type EditableReusableRuleDraft,
  type ReusableRuleVersion,
} from "./custom-rule-templates";
import type { CustomRuleExecutionUnit } from "./custom-rule-types";

describe("Phase 2 custom rule lifecycle repository", () => {
  it("loads only the active project-period reconciliation rule for the same organization", async () => {
    const calls: Array<[string, unknown]> = [];
    const rows = [
      executableVersionRow({
        id: RULE_VERSION_ID,
        scope: "reconciliation",
        target_type: "project",
        target_id: null,
        execution_grain: "project_period",
        composition_mode: "check",
      }),
      executableVersionRow({
        id: "00000000-0000-4000-8000-000000000099",
        organization_id: "00000000-0000-4000-8000-000000000099",
        scope: "reconciliation",
        target_type: "project",
        target_id: null,
        execution_grain: "project_period",
        composition_mode: "check",
      }),
    ];
    const query = {
      select: vi.fn((columns: string) => {
        calls.push(["select", columns]);
        return query;
      }),
      eq: vi.fn((column: string, value: unknown) => {
        calls.push([column, value]);
        return query;
      }),
      lte: vi.fn((column: string, value: unknown) => {
        calls.push([`lte:${column}`, value]);
        return query;
      }),
      or: vi.fn((value: string) => {
        calls.push(["or", value]);
        return query;
      }),
      order: vi.fn(() => query),
      limit: vi.fn(() => query),
      returns: vi.fn(async () => ({ data: rows, error: null })),
    };
    const repository = new SupabaseCustomRuleReadRepository({
      from: vi.fn((table: string) => {
        expect(table).toBe("custom_settlement_rule_versions");
        return query;
      }),
    } as unknown as SupabaseClient);

    const result = await repository.getActiveProjectReconciliationRule({
      organizationId: ORGANIZATION_ID,
      projectId: PROJECT_ID,
      executionTimestamp: "2026-07-15T00:00:00.000Z",
    });

    expect(result?.id).toBe(RULE_VERSION_ID);
    expect(calls).toEqual(
      expect.arrayContaining([
        ["organization_id", ORGANIZATION_ID],
        ["project_id", PROJECT_ID],
        ["scope", "reconciliation"],
        ["target_type", "project"],
        ["status", "active"],
      ]),
    );
  });

  it("persists and reads immutable reconciliation run snapshots by full input hash", async () => {
    const inserted = {
      id: "00000000-0000-4000-8000-000000000111",
      organization_id: ORGANIZATION_ID,
      project_id: PROJECT_ID,
      period_start: "2026-06-01",
      period_end: "2026-06-30",
      trigger_type: "manual",
      trigger_batch_id: null,
      core_input_hash: HASH_E,
      core_result: { income: { receivableCents: 1000 } },
      rule_version_id: RULE_VERSION_ID,
      formula_hash: HASH_C,
      custom_checks: [{ source: "custom_rule" }],
      final_checks: [{ source: "core" }, { source: "custom_rule" }],
      blocked: true,
      warnings: [{ code: "custom" }],
      created_by: CREATOR_ID,
      created_at: "2026-07-14T00:00:00.000Z",
    };
    const insert = vi.fn(() => ({
      select: vi.fn(() => ({
        single: vi.fn(async () => ({ data: inserted, error: null })),
      })),
    }));
    const from = vi.fn((table: string) => {
      expect(table).toBe("settlement_reconciliation_runs");
      return {
        insert,
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn(async () => ({ data: inserted, error: null })),
      };
    });
    const repository = new SupabaseCustomRuleReadRepository({
      from,
    } as unknown as SupabaseClient);

    const created = await repository.createSettlementReconciliationRun({
      organizationId: ORGANIZATION_ID,
      projectId: PROJECT_ID,
      periodStart: "2026-06-01",
      periodEnd: "2026-06-30",
      triggerType: "manual",
      triggerBatchId: null,
      inputHash: HASH_E,
      coreResult: inserted.core_result,
      ruleVersionId: RULE_VERSION_ID,
      formulaHash: HASH_C,
      customChecks: inserted.custom_checks,
      finalChecks: inserted.final_checks,
      blocked: true,
      warnings: inserted.warnings,
      createdBy: CREATOR_ID,
    });
    const cached = await repository.getCachedSettlementReconciliationRun({
      organizationId: ORGANIZATION_ID,
      projectId: PROJECT_ID,
      periodStart: "2026-06-01",
      periodEnd: "2026-06-30",
      inputHash: HASH_E,
    });

    expect(insert).toHaveBeenCalledWith({
      organization_id: ORGANIZATION_ID,
      project_id: PROJECT_ID,
      period_start: "2026-06-01",
      period_end: "2026-06-30",
      trigger_type: "manual",
      trigger_batch_id: null,
      core_input_hash: HASH_E,
      core_result: inserted.core_result,
      rule_version_id: RULE_VERSION_ID,
      formula_hash: HASH_C,
      custom_checks: inserted.custom_checks,
      final_checks: inserted.final_checks,
      blocked: true,
      warnings: inserted.warnings,
      created_by: CREATOR_ID,
    });
    expect(created.inputHash).toBe(HASH_E);
    expect(cached?.inputHash).toBe(HASH_E);
    expect(Object.isFrozen(cached)).toBe(true);
  });

  it("rehydrates cached reconciliation run DTOs from persisted final custom checks", async () => {
    const publicResult = {
      income: { receivableCents: 1000 },
      checks: [
        {
          source: "core",
          severity: "pass",
          code: "core_only",
          message: "core ok",
        },
        {
          source: "custom_rule",
          severity: "block",
          code: `custom_rule:${RULE_VERSION_ID}:0`,
          message: "custom block",
          ruleVersionId: RULE_VERSION_ID,
          formulaHash: HASH_C,
        },
      ],
      hasBlocking: true,
      hasWarning: true,
      canConfirm: false,
      canLock: false,
      customRule: {
        ruleVersionId: RULE_VERSION_ID,
        contractLabel: "Margin guardrail",
        formulaHash: HASH_C,
      },
    };
    const inserted = {
      id: "00000000-0000-4000-8000-000000000111",
      organization_id: ORGANIZATION_ID,
      project_id: PROJECT_ID,
      period_start: "2026-06-01",
      period_end: "2026-06-30",
      trigger_type: "manual",
      trigger_batch_id: null,
      core_input_hash: HASH_E,
      core_result: publicResult,
      rule_version_id: RULE_VERSION_ID,
      formula_hash: HASH_C,
      custom_checks: [
        {
          source: "custom_rule",
          severity: "block",
          code: `custom_rule:${RULE_VERSION_ID}:0`,
          message: "custom block",
          ruleVersionId: RULE_VERSION_ID,
          formulaHash: HASH_C,
        },
      ],
      final_checks: [
        {
          source: "core",
          severity: "pass",
          code: "core_only",
          message: "core ok",
        },
        {
          source: "custom_rule",
          severity: "block",
          code: `custom_rule:${RULE_VERSION_ID}:0`,
          message: "custom block",
          ruleVersionId: RULE_VERSION_ID,
          formulaHash: HASH_C,
        },
      ],
      blocked: true,
      warnings: [
        {
          source: "custom_rule",
          severity: "warn",
          code: `custom_rule:${RULE_VERSION_ID}:1`,
          message: "custom warning",
          ruleVersionId: RULE_VERSION_ID,
          formulaHash: HASH_C,
        },
      ],
      created_by: CREATOR_ID,
      created_at: "2026-07-14T00:00:00.000Z",
    };
    const repository = new SupabaseCustomRuleReadRepository({
      from: vi.fn((table: string) => {
        expect(table).toBe("settlement_reconciliation_runs");
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn(async () => ({ data: inserted, error: null })),
        };
      }),
    } as unknown as SupabaseClient);

    const cached = await repository.getCachedSettlementReconciliationRun({
      organizationId: ORGANIZATION_ID,
      projectId: PROJECT_ID,
      periodStart: "2026-06-01",
      periodEnd: "2026-06-30",
      inputHash: HASH_E,
    });

    expect(cached?.result).toEqual(publicResult);
    expect(cached?.result).not.toHaveProperty("customChecks");
    expect(cached?.result).not.toHaveProperty("warnings");
    expect(cached?.customChecks).toEqual(inserted.custom_checks);
    expect(cached?.warnings).toEqual(inserted.warnings);
  });

  it("rehydrates core-only cached reconciliation runs without sourced check shape drift", async () => {
    const coreResult = {
      income: { receivableCents: 1000 },
      checks: [{ key: "core_only", severity: "pass", message: "core ok" }],
      hasBlocking: false,
      hasWarning: false,
      canConfirm: true,
      canLock: true,
    };
    const inserted = {
      id: "00000000-0000-4000-8000-000000000111",
      organization_id: ORGANIZATION_ID,
      project_id: PROJECT_ID,
      period_start: "2026-06-01",
      period_end: "2026-06-30",
      trigger_type: "manual",
      trigger_batch_id: null,
      core_input_hash: HASH_E,
      core_result: coreResult,
      rule_version_id: null,
      formula_hash: null,
      custom_checks: [],
      final_checks: [
        {
          source: "core",
          severity: "pass",
          code: "core_only",
          message: "core ok",
        },
      ],
      blocked: false,
      warnings: [],
      created_by: CREATOR_ID,
      created_at: "2026-07-14T00:00:00.000Z",
    };
    const repository = new SupabaseCustomRuleReadRepository({
      from: vi.fn((table: string) => {
        expect(table).toBe("settlement_reconciliation_runs");
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn(async () => ({ data: inserted, error: null })),
        };
      }),
    } as unknown as SupabaseClient);

    const cached = await repository.getCachedSettlementReconciliationRun({
      organizationId: ORGANIZATION_ID,
      projectId: PROJECT_ID,
      periodStart: "2026-06-01",
      periodEnd: "2026-06-30",
      inputHash: HASH_E,
    });

    expect(cached?.result).toEqual(coreResult);
    expect(cached?.result.checks).toEqual([
      { key: "core_only", severity: "pass", message: "core ok" },
    ]);
    expect(cached?.result).not.toHaveProperty("customChecks");
    expect(cached?.result).not.toHaveProperty("warnings");
  });

  it("persists the public reconciliation result snapshot without formula internals", async () => {
    const publicResult = {
      income: { receivableCents: 1000 },
      checks: [
        {
          source: "custom_rule",
          severity: "warn",
          code: `custom_rule:${RULE_VERSION_ID}:0`,
          message: "custom warning",
          ruleVersionId: RULE_VERSION_ID,
          formulaHash: HASH_C,
        },
      ],
      hasBlocking: false,
      hasWarning: true,
      canConfirm: true,
      canLock: true,
      customRule: {
        ruleVersionId: RULE_VERSION_ID,
        contractLabel: "Margin guardrail",
        formulaHash: HASH_C,
      },
    };
    const inserted = {
      id: "00000000-0000-4000-8000-000000000111",
      organization_id: ORGANIZATION_ID,
      project_id: PROJECT_ID,
      period_start: "2026-06-01",
      period_end: "2026-06-30",
      trigger_type: "manual",
      trigger_batch_id: null,
      core_input_hash: HASH_E,
      core_result: publicResult,
      rule_version_id: RULE_VERSION_ID,
      formula_hash: HASH_C,
      custom_checks: [],
      final_checks: publicResult.checks,
      blocked: false,
      warnings: publicResult.checks,
      created_by: CREATOR_ID,
      created_at: "2026-07-14T00:00:00.000Z",
    };
    const insertedPayloads: unknown[] = [];
    const insert = vi.fn((payload: unknown) => {
      insertedPayloads.push(payload);
      return {
        select: vi.fn(() => ({
          single: vi.fn(async () => ({ data: inserted, error: null })),
        })),
      };
    });
    const repository = new SupabaseCustomRuleReadRepository({
      from: vi.fn((table: string) => {
        expect(table).toBe("settlement_reconciliation_runs");
        return { insert };
      }),
    } as unknown as SupabaseClient);

    const reconciliationRunInput: CreateSettlementReconciliationRunInput = {
      organizationId: ORGANIZATION_ID,
      projectId: PROJECT_ID,
      periodStart: "2026-06-01",
      periodEnd: "2026-06-30",
      triggerType: "manual",
      triggerBatchId: null,
      inputHash: HASH_E,
      coreResult: {
        income: { receivableCents: 1000 },
        checks: [{ key: "core_only", severity: "pass", message: "core ok" }],
      },
      result: publicResult,
      ruleVersionId: RULE_VERSION_ID,
      formulaHash: HASH_C,
      customChecks: [],
      finalChecks: publicResult.checks,
      blocked: false,
      warnings: publicResult.checks,
      createdBy: CREATOR_ID,
    };

    await repository.createSettlementReconciliationRun(reconciliationRunInput);

    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ core_result: publicResult }),
    );
    const insertedPayload = insertedPayloads[0] as
      | { core_result: unknown }
      | undefined;
    expect(insertedPayload).toBeDefined();
    expect(JSON.stringify(insertedPayload?.core_result)).not.toMatch(
      /formula("|:)|compiledAst|normalizedAst/,
    );
  });

  it("resolves executable rule versions by organization, project, scope, target, and execution timestamp", async () => {
    const rpc = vi.fn(async () => ({
      data: {
        versions: [
          executableVersionRow({
            id: "00000000-0000-4000-8000-000000000301",
            target_type: "project",
            target_id: null,
            composition_mode: "replace",
          }),
          executableVersionRow({
            id: "00000000-0000-4000-8000-000000000302",
            target_type: "streamer_group",
            target_id: GROUP_ID,
            priority: 20,
          }),
          executableVersionRow({
            id: "00000000-0000-4000-8000-000000000303",
            target_type: "streamer_group",
            target_id: SECOND_GROUP_ID,
            priority: 10,
            status: "archived",
            effective_from: "2026-06-01T00:00:00.000Z",
            effective_until: "2026-08-01T00:00:00.000Z",
            archived_at: "2026-07-01T00:00:00.000Z",
          }),
          executableVersionRow({
            id: "00000000-0000-4000-8000-000000000304",
            target_type: "project_streamer",
            target_id: PROJECT_STREAMER_ID,
            priority: 100,
          }),
          executableVersionRow({
            id: "00000000-0000-4000-8000-000000000305",
            effective_from: "2026-09-01T00:00:00.000Z",
          }),
          executableVersionRow({
            id: "00000000-0000-4000-8000-000000000306",
            effective_until: "2026-06-01T00:00:00.000Z",
          }),
          executableVersionRow({
            id: "00000000-0000-4000-8000-000000000307",
            approved_by: null,
            approved_at: null,
          }),
          executableVersionRow({
            id: "00000000-0000-4000-8000-000000000308",
            organization_id: "00000000-0000-4000-8000-000000000999",
          }),
          executableVersionRow({
            id: "00000000-0000-4000-8000-000000000309",
            target_type: "streamer_group",
            target_id: WRONG_GROUP_ID,
          }),
        ],
        assignments: [
          executableAssignmentRow({
            unit_key: "unit-1",
            group_id: GROUP_ID,
            assignment_id: ASSIGNMENT_ID,
          }),
          executableAssignmentRow({
            unit_key: "unit-1",
            group_id: SECOND_GROUP_ID,
            assignment_id: SECOND_ASSIGNMENT_ID,
            effective_from: "2026-07-10T00:00:00.000Z",
            effective_until: "2026-07-20T00:00:00.000Z",
          }),
        ],
      },
      error: null,
    }));
    const repository = new SupabaseCustomRuleReadRepository({
      rpc,
    } as unknown as SupabaseClient) as unknown as {
      resolveExecutableCustomRuleLayers(input: {
        organizationId: string;
        projectId: string;
        scope: "payable";
        executionTimestamp: string;
        executionUnits: CustomRuleExecutionUnit[];
      }): Promise<{
        projectBaseVersion: { id: string } | null;
        groupVersions: Array<{ groupId: string; version: { id: string } }>;
        projectStreamerVersions: Array<{
          projectStreamerId: string;
          version: { id: string };
        }>;
        assignmentsByUnitKey: Record<
          string,
          Array<{
            groupId: string;
            assignmentId: string;
            effectiveFrom: string;
            effectiveUntil: string | null;
          }>
        >;
      }>;
    };

    const result = await repository.resolveExecutableCustomRuleLayers({
      organizationId: ORGANIZATION_ID,
      projectId: PROJECT_ID,
      scope: "payable",
      executionTimestamp: "2026-07-15T00:00:00.000Z",
      executionUnits: [executableUnit()],
    });

    expect(result.projectBaseVersion?.id).toBe(
      "00000000-0000-4000-8000-000000000301",
    );
    expect(result.groupVersions.map((entry) => entry.version.id)).toEqual([
      "00000000-0000-4000-8000-000000000303",
      "00000000-0000-4000-8000-000000000302",
    ]);
    expect(result.projectStreamerVersions.map((entry) => entry.version.id)).toEqual([
      "00000000-0000-4000-8000-000000000304",
    ]);
    expect(result.assignmentsByUnitKey["unit-1"]).toEqual([
      {
        unitKey: "unit-1",
        projectStreamerId: PROJECT_STREAMER_ID,
        groupId: GROUP_ID,
        assignmentId: ASSIGNMENT_ID,
        effectiveFrom: "2026-07-01T00:00:00.000Z",
        effectiveUntil: null,
      },
      {
        unitKey: "unit-1",
        projectStreamerId: PROJECT_STREAMER_ID,
        groupId: SECOND_GROUP_ID,
        assignmentId: SECOND_ASSIGNMENT_ID,
        effectiveFrom: "2026-07-10T00:00:00.000Z",
        effectiveUntil: "2026-07-20T00:00:00.000Z",
      },
    ]);
  });

  it("loads executable rule layers for all units with one bounded database call", async () => {
    const rpc = vi.fn(async () => ({
      data: { versions: [], assignments: [] },
      error: null,
    }));
    const repository = new SupabaseCustomRuleReadRepository({
      rpc,
    } as unknown as SupabaseClient) as unknown as {
      resolveExecutableCustomRuleLayers(input: {
        organizationId: string;
        projectId: string;
        scope: "payable";
        executionTimestamp: string;
        executionUnits: CustomRuleExecutionUnit[];
      }): Promise<unknown>;
    };

    await repository.resolveExecutableCustomRuleLayers({
      organizationId: ORGANIZATION_ID,
      projectId: PROJECT_ID,
      scope: "payable",
      executionTimestamp: "2026-07-15T00:00:00.000Z",
      executionUnits: [
        executableUnit(),
        executableUnit({
          key: "unit-2",
          projectStreamerId: OTHER_PROJECT_STREAMER_ID,
          membershipSnapshot: {
            ...executableUnit().membershipSnapshot,
            projectStreamerId: OTHER_PROJECT_STREAMER_ID,
            groups: [
              {
                id: SECOND_GROUP_ID,
                name: "Silver",
                assignmentId: SECOND_ASSIGNMENT_ID,
              },
            ],
          },
        }),
      ],
    });

    expect(rpc).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenCalledWith(
      "resolve_executable_custom_settlement_rule_layers",
      {
        p_organization_id: ORGANIZATION_ID,
        p_project_id: PROJECT_ID,
        p_scope: "payable",
        p_execution_timestamp: "2026-07-15T00:00:00.000Z",
        p_project_streamer_ids: [
          PROJECT_STREAMER_ID,
          OTHER_PROJECT_STREAMER_ID,
        ],
        p_group_ids: [GROUP_ID, SECOND_GROUP_ID],
        p_units: [
          {
            unitKey: "unit-1",
            projectStreamerId: PROJECT_STREAMER_ID,
            effectiveAt: "2026-07-15T00:00:00.000Z",
            groupIds: [GROUP_ID, SECOND_GROUP_ID],
            assignmentIds: [ASSIGNMENT_ID, SECOND_ASSIGNMENT_ID],
          },
          {
            unitKey: "unit-2",
            projectStreamerId: OTHER_PROJECT_STREAMER_ID,
            effectiveAt: "2026-07-15T00:00:00.000Z",
            groupIds: [SECOND_GROUP_ID],
            assignmentIds: [SECOND_ASSIGNMENT_ID],
          },
        ],
      },
    );
  });

  it("filters executable assignment intervals at each unit frozen snapshot timestamp", async () => {
    const rpc = vi.fn(async () => ({
      data: {
        versions: [],
        assignments: [
          executableAssignmentRow({
            unit_key: "unit-1",
            assignment_id: ASSIGNMENT_ID,
            effective_from: "2026-07-01T00:00:00.000Z",
            effective_until: "2026-07-12T00:00:00.000Z",
          }),
          executableAssignmentRow({
            unit_key: "unit-1",
            assignment_id: SECOND_ASSIGNMENT_ID,
            group_id: SECOND_GROUP_ID,
            effective_from: "2026-07-12T00:00:00.000Z",
            effective_until: null,
          }),
        ],
      },
      error: null,
    }));
    const repository = new SupabaseCustomRuleReadRepository({
      rpc,
    } as unknown as SupabaseClient) as unknown as {
      resolveExecutableCustomRuleLayers(input: {
        organizationId: string;
        projectId: string;
        scope: "payable";
        executionTimestamp: string;
        executionUnits: CustomRuleExecutionUnit[];
      }): Promise<{
        assignmentsByUnitKey: Record<
          string,
          Array<{
            assignmentId: string;
            effectiveFrom: string;
            effectiveUntil: string | null;
          }>
        >;
      }>;
    };

    const result = await repository.resolveExecutableCustomRuleLayers({
      organizationId: ORGANIZATION_ID,
      projectId: PROJECT_ID,
      scope: "payable",
      executionTimestamp: "2026-07-20T00:00:00.000Z",
      executionUnits: [
        executableUnit({
          membershipSnapshot: {
            ...executableUnit().membershipSnapshot,
            effectiveAt: "2026-07-10T00:00:00.000Z",
          },
        }),
      ],
    });

    expect(result.assignmentsByUnitKey["unit-1"]).toEqual([
      expect.objectContaining({
        assignmentId: ASSIGNMENT_ID,
        effectiveFrom: "2026-07-01T00:00:00.000Z",
        effectiveUntil: "2026-07-12T00:00:00.000Z",
      }),
    ]);
  });

  it("creates settlement rule groups through a role-gated RPC", async () => {
    const rpc = vi.fn(async () => ({
      data: settlementRuleGroupRow(),
      error: null,
    }));
    const repository = new SupabaseCustomRuleReadRepository({
      rpc,
    } as unknown as SupabaseClient) as unknown as {
      createSettlementRuleGroup(
        input: Record<string, unknown>,
      ): Promise<unknown>;
    };

    const result = await repository.createSettlementRuleGroup({
      organizationId: ORGANIZATION_ID,
      projectId: PROJECT_ID,
      name: "Gold streamers",
      description: "High-volume settlement exception group.",
      reason: "Create the high-volume settlement group.",
      clientRequestId: "group-create-1",
    });

    expect(result).toMatchObject({
      id: GROUP_ID,
      name: "Gold streamers",
      status: "active",
    });
    expect(rpc).toHaveBeenCalledWith("create_settlement_rule_group", {
      p_organization_id: ORGANIZATION_ID,
      p_project_id: PROJECT_ID,
      p_name: "Gold streamers",
      p_description: "High-volume settlement exception group.",
      p_reason: "Create the high-volume settlement group.",
      p_client_request_id: "group-create-1",
    });
  });

  it("lists active and archived settlement rule groups with scoped assignment counts", async () => {
    const assignmentsSelect = vi.fn().mockReturnThis();
    const versionsSelect = vi.fn().mockReturnThis();
    const from = vi.fn((table: string) => {
      if (table === "settlement_rule_groups") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          returns: vi.fn(async () => ({
            data: [
              settlementRuleGroupRow({}, { includeCoverage: false }),
            ],
            error: null,
          })),
        };
      }
      if (table === "project_streamers") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          returns: vi.fn(async () => ({
            data: [
              {
                id: PROJECT_STREAMER_ID,
                streamer_id: "00000000-0000-4000-8000-000000000014",
                streamers: { display_name: "Streamer A" },
              },
            ],
            error: null,
          })),
        };
      }
      if (table === "project_streamer_settlement_group_assignments") {
        return {
          select: assignmentsSelect,
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          returns: vi.fn(async () => ({
            data: [
              {
                project_streamer_id: PROJECT_STREAMER_ID,
                group_id: GROUP_ID,
                effective_from: "2026-01-01T00:00:00.000Z",
                effective_until: null,
              },
              {
                project_streamer_id: OTHER_PROJECT_STREAMER_ID,
                group_id: GROUP_ID,
                effective_from: "2026-01-01T00:00:00.000Z",
                effective_until: null,
              },
              {
                project_streamer_id: OTHER_PROJECT_STREAMER_ID,
                group_id: GROUP_ID,
                effective_from: "2999-01-01T00:00:00.000Z",
                effective_until: null,
              },
            ],
            error: null,
          })),
        };
      }
      expect(table).toBe("custom_settlement_rule_versions");
      return {
        select: versionsSelect,
        eq: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        returns: vi.fn(async () => ({
          data: [
            { target_group_id: GROUP_ID, status: "active" },
            { target_group_id: GROUP_ID, status: "pending_review" },
          ],
          error: null,
        })),
      };
    });
    const repository = new SupabaseCustomRuleReadRepository({
      from,
    } as unknown as SupabaseClient) as unknown as {
      listSettlementRuleGroups(
        input: Record<string, unknown>,
      ): Promise<unknown[]>;
    };

    const result = await repository.listSettlementRuleGroups({
      organizationId: ORGANIZATION_ID,
      projectId: PROJECT_ID,
      includeArchived: true,
    });

    expect(result).toEqual([
      expect.objectContaining({
        id: GROUP_ID,
        assignmentCount: 2,
        futureAssignmentCount: 1,
        activeRuleCount: 1,
        pendingRuleCount: 1,
        unassignedProjectStreamers: [],
        baseRuleCoveredProjectStreamerIds: [],
      }),
    ]);
    expect(assignmentsSelect).toHaveBeenCalledWith(
      "project_streamer_id, group_id, effective_from, effective_until",
    );
    expect(versionsSelect).toHaveBeenCalledWith("target_group_id, status");
    expect(from).toHaveBeenCalledWith("project_streamers");
    expect(from).toHaveBeenCalledWith(
      "project_streamer_settlement_group_assignments",
    );
    expect(from).toHaveBeenCalledWith("custom_settlement_rule_versions");
  });

  it("archives settlement groups through a guarded RPC", async () => {
    const rpc = vi.fn(async () => ({
      data: settlementRuleGroupRow({
        status: "archived",
        archived_at: "2026-08-01T00:00:00.000Z",
      }),
      error: null,
    }));
    const repository = new SupabaseCustomRuleReadRepository({
      rpc,
    } as unknown as SupabaseClient) as unknown as {
      archiveSettlementRuleGroup(
        input: Record<string, unknown>,
      ): Promise<unknown>;
    };

    await repository.archiveSettlementRuleGroup({
      organizationId: ORGANIZATION_ID,
      projectId: PROJECT_ID,
      groupId: GROUP_ID,
      archivedAt: "2026-08-01T00:00:00.000Z",
      reason: "Archive after all group rules and assignments have ended.",
      clientRequestId: "group-archive-1",
    });

    expect(rpc).toHaveBeenCalledWith("archive_settlement_rule_group", {
      p_organization_id: ORGANIZATION_ID,
      p_project_id: PROJECT_ID,
      p_group_id: GROUP_ID,
      p_archived_at: "2026-08-01T00:00:00.000Z",
      p_reason: "Archive after all group rules and assignments have ended.",
      p_client_request_id: "group-archive-1",
    });
  });

  it("changes group assignment through one atomic close-and-insert RPC", async () => {
    const rpc = vi.fn(async () => ({
      data: settlementGroupAssignmentChangeRow(),
      error: null,
    }));
    const repository = new SupabaseCustomRuleReadRepository({
      rpc,
    } as unknown as SupabaseClient) as unknown as {
      changeSettlementGroupAssignment(
        input: Record<string, unknown>,
      ): Promise<unknown>;
    };

    const result = await repository.changeSettlementGroupAssignment({
      organizationId: ORGANIZATION_ID,
      projectId: PROJECT_ID,
      projectStreamerId: PROJECT_STREAMER_ID,
      groupId: GROUP_ID,
      effectiveFrom: "2026-08-01T00:00:00.000Z",
      effectiveUntil: null,
      reason: "Move streamer into the August rule group.",
      clientRequestId: "group-assignment-1",
    });

    expect(result).toMatchObject({
      insertedAssignment: { groupId: GROUP_ID },
      closedAssignmentIds: [ASSIGNMENT_ID],
      newGroupSnapshotHash: HASH_F,
    });
    expect(rpc).toHaveBeenCalledWith("change_settlement_group_assignment", {
      p_organization_id: ORGANIZATION_ID,
      p_project_id: PROJECT_ID,
      p_project_streamer_id: PROJECT_STREAMER_ID,
      p_group_id: GROUP_ID,
      p_effective_from: "2026-08-01T00:00:00.000Z",
      p_effective_until: null,
      p_reason: "Move streamer into the August rule group.",
      p_client_request_id: "group-assignment-1",
    });
  });

  it("reads pending group-rule simulations as stale after membership snapshot changes", async () => {
    const rpc = vi.fn(async () => ({
      data: settlementGroupAssignmentChangeRow(),
      error: null,
    }));
    const from = vi.fn((table: string) => {
      expect(table).toBe("settlement_group_simulation_freshness");
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        returns: vi.fn(async () => ({
          data: [
            settlementGroupSimulationFreshnessRow({
              group_snapshot_hash: HASH_E,
              current_group_snapshot_hash: HASH_F,
            }),
          ],
          error: null,
        })),
      };
    });
    const repository = new SupabaseCustomRuleReadRepository({
      from,
      rpc,
    } as unknown as SupabaseClient) as unknown as {
      changeSettlementGroupAssignment(
        input: Record<string, unknown>,
      ): Promise<{ newGroupSnapshotHash: string }>;
      listSettlementGroupSimulationFreshness(
        input: Record<string, unknown>,
      ): Promise<Array<{ stale: boolean; staleReason: string }>>;
    };

    const change = await repository.changeSettlementGroupAssignment({
      organizationId: ORGANIZATION_ID,
      projectId: PROJECT_ID,
      projectStreamerId: PROJECT_STREAMER_ID,
      groupId: GROUP_ID,
      effectiveFrom: "2026-08-01T00:00:00.000Z",
      effectiveUntil: null,
      reason: "Move streamer into the August rule group.",
      clientRequestId: "group-assignment-stale-1",
    });
    const freshness = await repository.listSettlementGroupSimulationFreshness({
      organizationId: ORGANIZATION_ID,
      projectId: PROJECT_ID,
      currentGroupSnapshotHash: change.newGroupSnapshotHash,
      now: "2026-07-20T00:00:00.000Z",
    });

    expect(freshness).toEqual([
      expect.objectContaining({
        simulationId: SIMULATION_ID,
        stale: true,
        staleReason: "group_snapshot_mismatch",
      }),
    ]);
  });

  it("submits one atomic RPC with distinct source and destination identities", async () => {
    const rpcData = lifecycleResultRow();
    const rpc = vi.fn(async () => ({ data: rpcData, error: null }));
    const repository = new SupabaseCustomRuleReadRepository({
      rpc,
    } as unknown as SupabaseClient);
    const lifecycleRepository = repository as unknown as {
      applyAndSubmitCustomRule(
        input: Record<string, unknown>,
      ): Promise<unknown>;
    };

    const result = await lifecycleRepository.applyAndSubmitCustomRule({
      organizationId: "00000000-0000-4000-8000-000000000001",
      projectId: "00000000-0000-4000-8000-000000000002",
      source: {
        kind: "ai_draft",
        id: "00000000-0000-4000-8000-000000000003",
      },
      sourceSimulationId: "00000000-0000-4000-8000-000000000004",
      destinationVersionId: "00000000-0000-4000-8000-000000000005",
      destinationSimulationId: "00000000-0000-4000-8000-000000000006",
      scope: "payable",
      target: { targetType: "project", targetId: null },
      effectiveFrom: "2026-08-01T00:00:00.000Z",
      reason: "Submit a validated custom settlement rule.",
      clientRequestId: "phase2-submit-1",
    });

    expect(rpc).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenCalledWith(
      "apply_and_submit_custom_settlement_rule",
      {
        p_organization_id: "00000000-0000-4000-8000-000000000001",
        p_project_id: "00000000-0000-4000-8000-000000000002",
        p_source_ai_draft_id: "00000000-0000-4000-8000-000000000003",
        p_source_rule_version_id: null,
        p_source_simulation_id: "00000000-0000-4000-8000-000000000004",
        p_rule_version_id: "00000000-0000-4000-8000-000000000005",
        p_version_simulation_id: "00000000-0000-4000-8000-000000000006",
        p_scope: "payable",
        p_target_type: "project",
        p_target_id: null,
        p_effective_from: "2026-08-01T00:00:00.000Z",
        p_reason: "Submit a validated custom settlement rule.",
        p_submission_event_type: "submitted",
        p_client_request_id: "phase2-submit-1",
      },
    );
    expect(result).toMatchObject({
      version: {
        id: "00000000-0000-4000-8000-000000000005",
        status: "pending_review",
        versionNumber: 2,
        simulationId: "00000000-0000-4000-8000-000000000006",
      },
      simulation: {
        id: "00000000-0000-4000-8000-000000000006",
        owner: {
          kind: "rule_version",
          id: "00000000-0000-4000-8000-000000000005",
        },
      },
      event: {
        eventType: "submitted",
        beforeStatus: "draft",
        afterStatus: "pending_review",
      },
    });
  });

  it("exports the lifecycle repository contract from the production module", () => {
    expect(customRuleRepositoryModule).toHaveProperty(
      "customSettlementRuleVersionSchema",
    );
  });

  it("fails closed when an atomic lifecycle return has an unknown field", async () => {
    const rpc = vi.fn(async () => ({
      data: {
        ...lifecycleResultRow(),
        version: { ...lifecycleResultRow().version, unexpected: true },
      },
      error: null,
    }));
    const repository = new SupabaseCustomRuleReadRepository({
      rpc,
    } as unknown as SupabaseClient) as unknown as {
      applyAndSubmitCustomRule(
        input: Record<string, unknown>,
      ): Promise<unknown>;
    };

    await expect(
      repository.applyAndSubmitCustomRule(lifecycleSubmitInput()),
    ).rejects.toBeInstanceOf(CustomRulePersistenceDataError);
  });

  it("maps lifecycle RPC failures without retrying a partial transaction", async () => {
    const rpc = vi.fn(async () => ({
      data: null,
      error: {
        code: "P0001",
        message: "custom_settlement_rule_stale_simulation",
      },
    }));
    const repository = new SupabaseCustomRuleReadRepository({
      rpc,
    } as unknown as SupabaseClient) as unknown as {
      applyAndSubmitCustomRule(
        input: Record<string, unknown>,
      ): Promise<unknown>;
    };

    await expect(
      repository.applyAndSubmitCustomRule(lifecycleSubmitInput()),
    ).rejects.toMatchObject({
      name: "CustomRulePersistenceQueryError",
      operation: "apply_and_submit_rule",
    });
    expect(rpc).toHaveBeenCalledOnce();
  });

  it("returns the database replay result unchanged for the same request", async () => {
    const data = lifecycleResultRow();
    const rpc = vi.fn(async () => ({ data, error: null }));
    const repository = new SupabaseCustomRuleReadRepository({
      rpc,
    } as unknown as SupabaseClient) as unknown as {
      applyAndSubmitCustomRule(
        input: Record<string, unknown>,
      ): Promise<unknown>;
    };

    const first = await repository.applyAndSubmitCustomRule(
      lifecycleSubmitInput(),
    );
    const replay = await repository.applyAndSubmitCustomRule(
      lifecycleSubmitInput(),
    );

    expect(replay).toEqual(first);
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it("records activation failures through the public lifecycle repository contract", async () => {
    const rpc = vi.fn(async () => ({
      data: lifecycleResultRow(),
      error: null,
    }));
    const repository = new SupabaseCustomRuleReadRepository({
      rpc,
    } as unknown as SupabaseClient) as unknown as {
      recordCustomRuleActivationFailure(
        input: Record<string, unknown>,
      ): Promise<unknown>;
    };

    const result = await repository.recordCustomRuleActivationFailure({
      organizationId: lifecycleSubmitInput().organizationId,
      projectId: lifecycleSubmitInput().projectId,
      ruleVersionId: lifecycleResultRow().version.id,
      reason: "Activation failed before production execution.",
      clientRequestId: "phase2-activation-failed-1",
      errorMessage: "Production execution is disabled.",
    });

    expect(result).toMatchObject({
      version: { id: lifecycleResultRow().version.id },
    });
    expect(rpc).toHaveBeenCalledWith("review_custom_settlement_rule", {
      p_organization_id: lifecycleSubmitInput().organizationId,
      p_project_id: lifecycleSubmitInput().projectId,
      p_rule_version_id: lifecycleResultRow().version.id,
      p_action: "activation_failed",
      p_effective_from: null,
      p_reason: "Activation failed before production execution.",
      p_comment: "Production execution is disabled.",
      p_force: false,
      p_acknowledgment: null,
      p_risk_summary: {},
      p_client_request_id: "phase2-activation-failed-1",
    });
  });

  it("maps a successful reopen without returning a stale review event", async () => {
    const rpc = vi.fn(async () => ({
      data: {
        version: {
          ...lifecycleResultRow().version,
          status: "draft",
        },
        simulation: lifecycleResultRow().simulation,
      },
      error: null,
    }));
    const repository = new SupabaseCustomRuleReadRepository({
      rpc,
    } as unknown as SupabaseClient) as unknown as {
      reopenRequestedChangesAsDraft(
        input: Record<string, unknown>,
      ): Promise<{ event: unknown }>;
    };

    const result = await repository.reopenRequestedChangesAsDraft({
      organizationId: lifecycleSubmitInput().organizationId,
      projectId: lifecycleSubmitInput().projectId,
      ruleVersionId: lifecycleResultRow().version.id,
      reason: "Reopen without inventing a review event.",
      clientRequestId: "phase2-reopen-no-event-1",
    });

    expect(result.event).toBeNull();
  });

  it.each([
    [
      "requestCustomRuleChanges",
      {
        organizationId: lifecycleSubmitInput().organizationId,
        projectId: lifecycleSubmitInput().projectId,
        ruleVersionId: lifecycleResultRow().version.id,
        reason: "The effective date needs confirmation.",
        comment: "Please rerun the current-period simulation.",
        clientRequestId: "phase2-request-changes-1",
      },
      "review_custom_settlement_rule",
      {
        p_organization_id: lifecycleSubmitInput().organizationId,
        p_project_id: lifecycleSubmitInput().projectId,
        p_rule_version_id: lifecycleResultRow().version.id,
        p_action: "request_changes",
        p_effective_from: null,
        p_reason: "The effective date needs confirmation.",
        p_comment: "Please rerun the current-period simulation.",
        p_force: false,
        p_acknowledgment: null,
        p_risk_summary: {},
        p_client_request_id: "phase2-request-changes-1",
      },
    ],
    [
      "reopenRequestedChangesAsDraft",
      {
        organizationId: lifecycleSubmitInput().organizationId,
        projectId: lifecycleSubmitInput().projectId,
        ruleVersionId: lifecycleResultRow().version.id,
        reason: "Reopen before editing the requested fields.",
        clientRequestId: "phase2-reopen-1",
      },
      "review_custom_settlement_rule",
      {
        p_organization_id: lifecycleSubmitInput().organizationId,
        p_project_id: lifecycleSubmitInput().projectId,
        p_rule_version_id: lifecycleResultRow().version.id,
        p_action: "reopen",
        p_effective_from: null,
        p_reason: "Reopen before editing the requested fields.",
        p_comment: null,
        p_force: false,
        p_acknowledgment: null,
        p_risk_summary: {},
        p_client_request_id: "phase2-reopen-1",
      },
    ],
    [
      "approveCustomRule",
      {
        organizationId: lifecycleSubmitInput().organizationId,
        projectId: lifecycleSubmitInput().projectId,
        ruleVersionId: lifecycleResultRow().version.id,
        effectiveFrom: "2026-08-01T00:00:00.000Z",
        reason: "Approve after server-side freshness and risk checks.",
        riskSummary: { material: false, codes: [] },
        clientRequestId: "phase2-approve-1",
      },
      "review_custom_settlement_rule",
      {
        p_organization_id: lifecycleSubmitInput().organizationId,
        p_project_id: lifecycleSubmitInput().projectId,
        p_rule_version_id: lifecycleResultRow().version.id,
        p_action: "approve",
        p_effective_from: "2026-08-01T00:00:00.000Z",
        p_reason: "Approve after server-side freshness and risk checks.",
        p_comment: null,
        p_force: false,
        p_acknowledgment: null,
        p_risk_summary: { material: false, codes: [] },
        p_client_request_id: "phase2-approve-1",
      },
    ],
    [
      "forceApproveCustomRule",
      {
        organizationId: lifecycleSubmitInput().organizationId,
        projectId: lifecycleSubmitInput().projectId,
        ruleVersionId: lifecycleResultRow().version.id,
        effectiveFrom: "2026-08-01T00:00:00.000Z",
        reason: "Sole owner accepts the documented material risk.",
        acknowledgment: "I understand and accept the settlement risk",
        riskSummary: { material: true, codes: ["safety_cap_exceeded"] },
        clientRequestId: "phase2-force-approve-1",
      },
      "review_custom_settlement_rule",
      {
        p_organization_id: lifecycleSubmitInput().organizationId,
        p_project_id: lifecycleSubmitInput().projectId,
        p_rule_version_id: lifecycleResultRow().version.id,
        p_action: "approve",
        p_effective_from: "2026-08-01T00:00:00.000Z",
        p_reason: "Sole owner accepts the documented material risk.",
        p_comment: null,
        p_force: true,
        p_acknowledgment: "I understand and accept the settlement risk",
        p_risk_summary: { material: true, codes: ["safety_cap_exceeded"] },
        p_client_request_id: "phase2-force-approve-1",
      },
    ],
    [
      "archiveCustomRule",
      {
        organizationId: lifecycleSubmitInput().organizationId,
        projectId: lifecycleSubmitInput().projectId,
        ruleVersionId: lifecycleResultRow().version.id,
        effectiveUntil: "2026-09-01T00:00:00.000Z",
        reason: "Archive after verifying a fixed settlement fallback.",
        fallbackProof: {
          simulationId: "00000000-0000-4000-8000-000000000006",
          proofKind: "fixed_fallback",
          remainingCustomLayerCount: 0,
          fixedFallbackAvailable: true,
          lockedBatchCount: 3,
          lockedBatchExclusion: {
            excluded: true,
            lockedBatchCount: 3,
          },
        },
        clientRequestId: "phase2-archive-1",
      },
      "archive_custom_settlement_rule",
      {
        p_organization_id: lifecycleSubmitInput().organizationId,
        p_project_id: lifecycleSubmitInput().projectId,
        p_rule_version_id: lifecycleResultRow().version.id,
        p_effective_until: "2026-09-01T00:00:00.000Z",
        p_reason: "Archive after verifying a fixed settlement fallback.",
        p_fallback_proof: {
          simulationId: "00000000-0000-4000-8000-000000000006",
          proofKind: "fixed_fallback",
          remainingCustomLayerCount: 0,
          fixedFallbackAvailable: true,
          lockedBatchCount: 3,
          lockedBatchExclusion: {
            excluded: true,
            lockedBatchCount: 3,
          },
        },
        p_client_request_id: "phase2-archive-1",
      },
    ],
  ] as const)(
    "maps %s to its single atomic lifecycle RPC",
    async (method, input, rpcName, rpcArguments) => {
      const rpc = vi.fn(async () => ({
        data: lifecycleResultRow(),
        error: null,
      }));
      const repository = new SupabaseCustomRuleReadRepository({
        rpc,
      } as unknown as SupabaseClient) as unknown as Record<
        string,
        (input: unknown) => Promise<unknown>
      >;

      const result = await repository[method](input);

      expect(result).toMatchObject({
        version: { id: lifecycleResultRow().version.id },
        event: { ruleVersionId: lifecycleResultRow().version.id },
      });
      expect(rpc).toHaveBeenCalledOnce();
      expect(rpc).toHaveBeenCalledWith(rpcName, rpcArguments);
    },
  );

  it("saves a draft and copied simulation through one RPC", async () => {
    const data = lifecycleSavedDraftResultRow();
    const rpc = vi.fn(async () => ({ data, error: null }));
    const repository = new SupabaseCustomRuleReadRepository({
      rpc,
    } as unknown as SupabaseClient) as unknown as {
      saveCustomRuleDraft(input: Record<string, unknown>): Promise<unknown>;
    };
    const draft = validDraftInput();

    const result = await repository.saveCustomRuleDraft({
      organizationId: data.version.organization_id,
      projectId: data.version.project_id,
      sourceAiDraftId: DRAFT_ID,
      sourceSimulationId: SIMULATION_ID,
      ruleVersionId: data.version.id,
      versionSimulationId: data.simulation.id,
      scope: "payable",
      target: { targetType: "project", targetId: null },
      draft: {
        priority: 100,
        formula: draft.generatedFormula.expression,
        compiledAst: draft.generatedFormula.normalizedAst,
        variables: [],
        parameters: {},
        ruleContract: draft.businessContract,
        systemExplanationTemplate: draft.generatedExplanation,
        missingDataPolicy: draft.businessContract.missingDataPolicy,
        testCases: draft.generatedTestCases,
        formulaHash: HASH_C,
        contractHash: HASH_B,
        parameterHash: HASH_D,
        catalogHash: HASH_A,
        dataSelectionHash: HASH_E,
      },
      reason: "Save an editable governed draft.",
      clientRequestId: "phase2-save-1",
    });

    expect(result).toMatchObject({ version: { status: "draft" } });
    expect(rpc).toHaveBeenCalledWith("save_custom_settlement_rule_draft", {
      p_organization_id: data.version.organization_id,
      p_project_id: data.version.project_id,
      p_source_ai_draft_id: DRAFT_ID,
      p_source_simulation_id: SIMULATION_ID,
      p_rule_version_id: data.version.id,
      p_version_simulation_id: data.simulation.id,
      p_scope: "payable",
      p_target_type: "project",
      p_target_id: null,
      p_draft: expect.objectContaining({
        priority: 100,
        formulaHash: HASH_C,
        contractHash: HASH_B,
        parameterHash: HASH_D,
        catalogHash: HASH_A,
        dataSelectionHash: HASH_E,
      }),
      p_reason: "Save an editable governed draft.",
      p_client_request_id: "phase2-save-1",
    });
  });

  it("saves an edited reopened draft with a fresh simulation proof", async () => {
    const data = lifecycleSavedDraftResultRow();
    const freshSourceSimulationId = "00000000-0000-4000-8000-000000000960";
    const freshVersionSimulationId = "00000000-0000-4000-8000-000000000961";
    const rpc = vi.fn(async () => ({
      data: {
        ...data,
        version: {
          ...data.version,
          simulation_id: freshVersionSimulationId,
          formula_hash: HASH_F,
        },
        simulation: {
          ...data.simulation,
          id: freshVersionSimulationId,
          formula_hash: HASH_F,
        },
      },
      error: null,
    }));
    const repository = new SupabaseCustomRuleReadRepository({
      rpc,
    } as unknown as SupabaseClient) as unknown as {
      saveCustomRuleDraft(input: Record<string, unknown>): Promise<unknown>;
    };
    const draft = validDraftInput();

    await repository.saveCustomRuleDraft({
      organizationId: data.version.organization_id,
      projectId: data.version.project_id,
      sourceAiDraftId: null,
      sourceSimulationId: freshSourceSimulationId,
      ruleVersionId: data.version.id,
      versionSimulationId: freshVersionSimulationId,
      scope: "payable",
      target: { targetType: "project", targetId: null },
      draft: {
        priority: 100,
        formula: "system_minutes * 3",
        compiledAst: draft.generatedFormula.normalizedAst,
        variables: [],
        parameters: {},
        ruleContract: draft.businessContract,
        systemExplanationTemplate: draft.generatedExplanation,
        missingDataPolicy: draft.businessContract.missingDataPolicy,
        testCases: draft.generatedTestCases,
        formulaHash: HASH_F,
        contractHash: HASH_B,
        parameterHash: HASH_D,
        catalogHash: HASH_A,
        dataSelectionHash: HASH_E,
      },
      reason: "Save edited requested changes with fresh simulation proof.",
      clientRequestId: "phase2-save-edited-fresh-1",
    });

    expect(rpc).toHaveBeenCalledWith("save_custom_settlement_rule_draft", {
      p_organization_id: data.version.organization_id,
      p_project_id: data.version.project_id,
      p_source_ai_draft_id: null,
      p_source_simulation_id: freshSourceSimulationId,
      p_rule_version_id: data.version.id,
      p_version_simulation_id: freshVersionSimulationId,
      p_scope: "payable",
      p_target_type: "project",
      p_target_id: null,
      p_draft: expect.objectContaining({
        formula: "system_minutes * 3",
        formulaHash: HASH_F,
      }),
      p_reason: "Save edited requested changes with fresh simulation proof.",
      p_client_request_id: "phase2-save-edited-fresh-1",
    });
  });

  it("rejects a saved draft without all server-computed freshness hashes", async () => {
    const rpc = vi.fn(async () => ({
      data: lifecycleSavedDraftResultRow(),
      error: null,
    }));
    const repository = new SupabaseCustomRuleReadRepository({
      rpc,
    } as unknown as SupabaseClient) as unknown as {
      saveCustomRuleDraft(input: Record<string, unknown>): Promise<unknown>;
    };
    const draft = validDraftInput();

    await expect(
      repository.saveCustomRuleDraft({
        organizationId: ORGANIZATION_ID,
        projectId: PROJECT_ID,
        sourceAiDraftId: DRAFT_ID,
        sourceSimulationId: SIMULATION_ID,
        ruleVersionId: lifecycleResultRow().version.id,
        versionSimulationId: SIMULATION_ID,
        scope: "payable",
        target: { targetType: "project", targetId: null },
        draft: {
          priority: 100,
          formula: draft.generatedFormula.expression,
          compiledAst: draft.generatedFormula.normalizedAst,
          variables: [],
          parameters: {},
          ruleContract: draft.businessContract,
          systemExplanationTemplate: draft.generatedExplanation,
          missingDataPolicy: draft.businessContract.missingDataPolicy,
          testCases: draft.generatedTestCases,
        },
        reason: "Attempt to save without canonical hashes.",
        clientRequestId: "phase2-save-missing-hashes",
      }),
    ).rejects.toMatchObject({ code: "CUSTOM_RULE_PERSISTENCE_INPUT_INVALID" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects lifecycle request ids longer than the database contract", async () => {
    const rpc = vi.fn(async () => ({
      data: lifecycleResultRow(),
      error: null,
    }));
    const repository = new SupabaseCustomRuleReadRepository({
      rpc,
    } as unknown as SupabaseClient) as unknown as {
      applyAndSubmitCustomRule(
        input: Record<string, unknown>,
      ): Promise<unknown>;
    };

    await expect(
      repository.applyAndSubmitCustomRule({
        ...lifecycleSubmitInput(),
        clientRequestId: "x".repeat(121),
      }),
    ).rejects.toMatchObject({ code: "CUSTOM_RULE_PERSISTENCE_INPUT_INVALID" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("lists project rules by status with deterministic newest-first order", async () => {
    const query = createLifecycleListQuery([lifecycleResultRow().version]);
    const repository = new SupabaseCustomRuleReadRepository({
      from: vi.fn(() => query.builder),
    } as unknown as SupabaseClient) as unknown as {
      listCustomRules(input: Record<string, unknown>): Promise<unknown[]>;
    };

    const rules = await repository.listCustomRules({
      organizationId: lifecycleSubmitInput().organizationId,
      projectId: lifecycleSubmitInput().projectId,
      status: "pending_review",
    });

    expect(rules).toHaveLength(1);
    expect(query.calls).toContainEqual([
      "eq",
      ["organization_id", lifecycleSubmitInput().organizationId],
    ]);
    expect(query.calls).toContainEqual([
      "eq",
      ["project_id", lifecycleSubmitInput().projectId],
    ]);
    expect(query.calls).toContainEqual(["eq", ["status", "pending_review"]]);
    expect(query.calls).toContainEqual([
      "order",
      ["version_number", { ascending: false }],
    ]);
    expect(query.calls).toContainEqual(["order", ["id", { ascending: false }]]);
  });

  it("lists review history by created_at and id stable tie-breaker", async () => {
    const query = createLifecycleListQuery([lifecycleResultRow().event]);
    const repository = new SupabaseCustomRuleReadRepository({
      from: vi.fn(() => query.builder),
    } as unknown as SupabaseClient) as unknown as {
      listCustomRuleReviewEvents(
        input: Record<string, unknown>,
      ): Promise<unknown[]>;
    };

    await repository.listCustomRuleReviewEvents({
      organizationId: lifecycleSubmitInput().organizationId,
      projectId: lifecycleSubmitInput().projectId,
      ruleVersionId: lifecycleResultRow().version.id,
    });

    expect(query.calls).toContainEqual([
      "order",
      ["created_at", { ascending: true }],
    ]);
    expect(query.calls).toContainEqual(["order", ["id", { ascending: true }]]);
  });
});

function createLifecycleListQuery(rows: unknown[]) {
  const calls: Array<[string, unknown[]]> = [];
  const record = (method: string, args: unknown[]) => {
    calls.push([method, args]);
    return builder;
  };
  const builder = {
    select: (columns: string) => record("select", [columns]),
    eq: (column: string, value: unknown) => record("eq", [column, value]),
    order: (column: string, options: unknown) =>
      record("order", [column, options]),
    returns: async <Value>() => {
      calls.push(["returns", []]);
      return { data: rows as Value, error: null };
    },
  };
  return { builder, calls };
}

function lifecycleSavedDraftResultRow() {
  const result = lifecycleResultRow();
  if (result.simulation === null) {
    throw new Error("expected default lifecycle result to include simulation");
  }
  return {
    version: { ...result.version, status: "draft", effective_from: null },
    simulation: result.simulation,
  };
}

function lifecycleSubmitInput(): Record<string, unknown> {
  return {
    organizationId: "00000000-0000-4000-8000-000000000001",
    projectId: "00000000-0000-4000-8000-000000000002",
    source: {
      kind: "ai_draft",
      id: "00000000-0000-4000-8000-000000000003",
    },
    sourceSimulationId: "00000000-0000-4000-8000-000000000004",
    destinationVersionId: "00000000-0000-4000-8000-000000000005",
    destinationSimulationId: "00000000-0000-4000-8000-000000000006",
    scope: "payable",
    target: { targetType: "project", targetId: null },
    effectiveFrom: "2026-08-01T00:00:00.000Z",
    reason: "Submit a validated custom settlement rule.",
    clientRequestId: "phase2-submit-1",
  };
}

function lifecycleResultRow(
  overrides: {
    version?: Record<string, unknown>;
    simulation?: ReturnType<typeof simulationRow> | null;
    event?: Record<string, unknown> | null;
  } = {},
) {
  const simulationInput = validSimulationInput({
    kind: "rule_version",
    id: "00000000-0000-4000-8000-000000000005",
  });
  const draft = validDraftInput();
  return {
    version: {
      id: "00000000-0000-4000-8000-000000000005",
      organization_id: "00000000-0000-4000-8000-000000000001",
      project_id: "00000000-0000-4000-8000-000000000002",
      scope: "payable",
      target_type: "project",
      target_id: null,
      execution_grain: draft.businessContract.executionGrain,
      composition_mode: draft.businessContract.compositionMode,
      priority: 100,
      version_number: 2,
      status: "pending_review",
      formula: draft.generatedFormula.expression,
      compiled_ast: draft.generatedFormula.normalizedAst,
      variables: [],
      parameters: {},
      rule_contract: draft.businessContract,
      system_explanation_template: draft.generatedExplanation,
      missing_data_policy: draft.businessContract.missingDataPolicy,
      test_cases: draft.generatedTestCases,
      simulation_summary: {
        coverage: simulationInput.coverage,
        historicalTotals: simulationInput.historicalTotals,
        deltas: simulationInput.deltas,
      },
      formula_hash: HASH_C,
      rule_contract_hash: HASH_B,
      parameter_hash: HASH_D,
      variable_catalog_version: HASH_A,
      data_selection_hash: HASH_E,
      simulation_id: "00000000-0000-4000-8000-000000000006",
      effective_from: null,
      effective_until: null,
      created_by: CREATOR_ID,
      approved_by: null,
      ai_draft_id: DRAFT_ID,
      reason: "Submit a validated custom settlement rule.",
      created_at: "2026-07-13T02:00:00.000Z",
      approved_at: null,
      archived_at: null,
      ...(overrides.version ?? {}),
    },
    simulation:
      overrides.simulation === undefined
        ? simulationRow(
            {
              kind: "rule_version",
              id: "00000000-0000-4000-8000-000000000005",
            },
            {
              id: "00000000-0000-4000-8000-000000000006",
              idempotency_key: "custom-rule-version:phase2-submit-1",
            },
          )
        : overrides.simulation,
    event: overrides.event ?? {
      id: "00000000-0000-4000-8000-000000000007",
      organization_id: "00000000-0000-4000-8000-000000000001",
      project_id: "00000000-0000-4000-8000-000000000002",
      rule_version_id: "00000000-0000-4000-8000-000000000005",
      event_type: "submitted",
      actor_id: CREATOR_ID,
      actor_role: "owner",
      reason: "Submit a validated custom settlement rule.",
      comment: null,
      before_status: "draft",
      after_status: "pending_review",
      risk_summary: {},
      formula_hash: HASH_C,
      rule_contract_hash: HASH_B,
      parameter_hash: HASH_D,
      variable_catalog_version: HASH_A,
      data_selection_hash: HASH_E,
      created_at: "2026-07-13T02:00:00.000Z",
    },
  };
}

function customRuleVersionFromLifecycleRow(): ReusableRuleVersion {
  const row = lifecycleResultRow().version;
  return {
    id: row.id,
    organizationId: row.organization_id,
    projectId: row.project_id,
    scope: "payable",
    target: { targetType: "project", targetId: null },
    executionGrain: row.execution_grain,
    compositionMode: row.composition_mode,
    priority: row.priority,
    versionNumber: row.version_number,
    status: "pending_review",
    formula: row.formula,
    compiledAst: row.compiled_ast,
    variables: row.variables,
    parameters: {
      minimumAmount: { type: "money_cents" as const, amountCents: 0 },
    },
    parameterDefinitions: [
      {
        key: "minimumAmount",
        labelZh: "Minimum amount",
        type: "money_cents" as const,
        value: 0,
        min: 0,
      },
    ],
    ruleContract: row.rule_contract,
    systemExplanationTemplate: row.system_explanation_template,
    missingDataPolicy: row.missing_data_policy,
    testCases: row.test_cases,
    simulationSummary: row.simulation_summary,
    formulaHash: row.formula_hash,
    contractHash: row.rule_contract_hash,
    parameterHash: row.parameter_hash,
    catalogHash: row.variable_catalog_version,
    dataSelectionHash: row.data_selection_hash,
    variableCatalogVersion: row.variable_catalog_version,
    simulationId: row.simulation_id,
    effectiveFrom: row.effective_from,
    effectiveUntil: row.effective_until,
    createdBy: row.created_by,
    approvedBy: row.approved_by,
    aiDraftId: row.ai_draft_id,
    reason: row.reason,
    createdAt: row.created_at,
    approvedAt: row.approved_at,
    archivedAt: row.archived_at,
  };
}

function organizationTemplateRow(overrides: Record<string, unknown> = {}) {
  const source = lifecycleResultRow().version;
  return {
    id: TEMPLATE_ID,
    organization_id: ORGANIZATION_ID,
    name: "Reusable receivable rule",
    description: "Use across projects.",
    source_rule_version_id: RULE_VERSION_ID,
    source_project_id: PROJECT_ID,
    source_version_number: source.version_number,
    source_scope: source.scope,
    execution_grain: source.execution_grain,
    composition_mode: source.composition_mode,
    formula: source.formula,
    compiled_ast: source.compiled_ast,
    variables: source.variables,
    parameters: source.parameters,
    rule_contract: source.rule_contract,
    missing_data_policy: source.missing_data_policy,
    test_cases: source.test_cases,
    status: "active",
    created_by: CREATOR_ID,
    created_at: "2026-07-13T02:00:00.000Z",
    archived_at: null,
    ...overrides,
  };
}

const PERIOD_START = "2026-06-01";
const PERIOD_END = "2026-06-30";
const PERIOD_START_BOUNDARY = "2026-06-01T00:00:00.000+08:00";
const PERIOD_END_EXCLUSIVE = "2026-07-01T00:00:00.000+08:00";

describe("SupabaseCustomRuleReadRepository", () => {
  it("aggregates only schema-backed coverage metadata from paginated sources", async () => {
    const mock = createClient();
    const repository: CustomRuleReadRepository =
      new SupabaseCustomRuleReadRepository(mock.client);

    const coverage = await repository.getProjectVariableCoverage({
      organizationId: "org-1",
      projectId: "project-1",
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
    });

    expect(coverage).toMatchObject({
      hasHistory: true,
      businessTimezone: "Asia/Shanghai",
      businessTimezoneConfirmed: true,
      businessTimezoneSource: "contract_default",
      variables: {
        system_minutes: {
          numerator: 2,
          denominator: 3,
          latestSampledPeriod: {
            start: "2026-06-01T10:00:00.000Z",
            end: "2026-06-30T10:00:00.000Z",
          },
        },
        screenshot_minutes: { numerator: 2, denominator: 3 },
        settlement_minutes: { numerator: 3, denominator: 3 },
        evidence_level: { numerator: 3, denominator: 3 },
        time_source: { numerator: 3, denominator: 3 },
        views: { numerator: 2, denominator: 3 },
        live_started_at: { numerator: 2, denominator: 3 },
        approved_at: { numerator: 2, denominator: 3 },
        project_id: { numerator: 1, denominator: 1 },
        streamer_id: { numerator: 2, denominator: 2 },
        streamer_source: { numerator: 2, denominator: 2 },
        collaboration_id: { numerator: 1, denominator: 2 },
        base_hourly_rate: { numerator: 1, denominator: 2 },
        base_salary: { numerator: 2, denominator: 2 },
        cps_rate: { numerator: 2, denominator: 2 },
        gift_amount: { numerator: 1, denominator: 3 },
        supplier_fee: { numerator: 1, denominator: 3 },
        traffic_cost: { numerator: 1, denominator: 3 },
        period_payable_amount: { numerator: 2, denominator: 2 },
        period_receivable_amount: { numerator: 1, denominator: 3 },
      },
    });

    const serialized = JSON.stringify(coverage);
    expect(serialized).not.toContain("report-1");
    expect(serialized).not.toContain("streamer-a");
    expect(serialized).not.toContain("parsed_payload");
    expect(serialized).not.toContain("source_payload");
    expect(serialized).not.toContain("amount_cents");
    expect(serialized).not.toContain("computed_amount");
    expect(mock.from).toHaveBeenCalledTimes(10);
  });

  it("scopes every query by organization/project and applies supplied period boundaries", async () => {
    const mock = createClient();
    const repository = new SupabaseCustomRuleReadRepository(mock.client);

    await repository.getProjectVariableCoverage({
      organizationId: "org-1",
      projectId: "project-1",
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
    });

    for (const table of TABLES) {
      expect(mock.calls[table]).toContainEqual([
        "eq",
        ["organization_id", "org-1"],
      ]);
      expect(mock.calls[table]).toContainEqual([
        "eq",
        ["project_id", "project-1"],
      ]);
      expect(mock.calls[table]).toContainEqual([
        "select",
        [expect.any(String), { count: "exact" }],
      ]);
      expect(mock.calls[table]).toContainEqual([
        "order",
        ["id", { ascending: false }],
      ]);
      expect(mock.calls[table]).toContainEqual([
        "order",
        ["id", { ascending: true }],
      ]);
      expect(mock.calls[table]).toContainEqual(["limit", [1]]);
      expect(mock.calls[table]).toContainEqual(["limit", [1_000]]);
      expect(
        mock.calls[table].filter(([method]) => method === "range"),
      ).toEqual([]);
      for (const queryCalls of mock.queries[table]) {
        expect(queryCalls).toContainEqual(["eq", ["organization_id", "org-1"]]);
        expect(queryCalls).toContainEqual(["eq", ["project_id", "project-1"]]);
      }
    }

    for (const table of ["live_reports", "project_cost_items"] as const) {
      expect(mock.calls[table]).toContainEqual([
        "gte",
        ["created_at", PERIOD_START_BOUNDARY],
      ]);
      expect(mock.calls[table]).toContainEqual([
        "lt",
        ["created_at", PERIOD_END_EXCLUSIVE],
      ]);
    }
    expect(mock.calls.project_streamers).toContainEqual([
      "lt",
      ["joined_at", PERIOD_END_EXCLUSIVE],
    ]);
    expect(mock.calls.settlement_batches).toContainEqual([
      "gte",
      ["period_end", "2026-06-01"],
    ]);
    expect(mock.calls.settlement_batches).toContainEqual([
      "lte",
      ["period_start", "2026-06-30"],
    ]);
    expect(mock.calls.settlement_batches).toContainEqual([
      "in",
      ["status", ["confirmed", "locked"]],
    ]);
    expect(selectFor(mock, "settlement_batches")).toBe(
      "id, batch_type, period_start, period_end",
    );
    expect(mock.calls.settlement_batch_items).toContainEqual([
      "in",
      [
        "settlement_batch_id",
        ["batch-payable-1", "batch-payable-2", "batch-receivable-1"],
      ],
    ]);
    expect(mock.calls.settlement_batch_items).not.toContainEqual([
      "gte",
      expect.any(Array),
    ]);
    expect(
      mock.calls.settlement_batch_items.filter(
        ([method, args]) => method === "lte" && args[0] !== "id",
      ),
    ).toEqual([]);
    expect(selectFor(mock, "settlement_batch_items")).not.toContain(
      "created_at",
    );
    expect(mock.calls.project_streamers).toContainEqual([
      "or",
      [`removed_at.is.null,removed_at.gte.${PERIOD_START_BOUNDARY}`],
    ]);

    expect(mock.calls.live_reports).toContainEqual([
      "eq",
      ["status", "approved"],
    ]);
    expect(selectFor(mock, "live_reports")).toContain("reviewed_at");
    expect(selectFor(mock, "live_reports")).toContain("id");
    expect(selectFor(mock, "live_reports")).toContain(
      "live_tasks!inner(system_started_at)",
    );
    expect(selectFor(mock, "live_reports")).not.toContain("approved_at");
    expect(selectFor(mock, "project_streamers")).toContain(
      "streamers!inner(source_type)",
    );
    expect(selectFor(mock, "project_streamers")).toContain("streamer_id");
    expect(mock.calls.project_cost_items).toContainEqual([
      "eq",
      ["source", "import"],
    ]);
    expect(mock.calls.project_cost_items).toContainEqual([
      "eq",
      ["status", "confirmed"],
    ]);
    expect(mock.calls.project_cost_items).toContainEqual([
      "in",
      ["item_type", ["gift", "supplier_fee", "traffic"]],
    ]);

    for (const table of TABLES) {
      expect(selectFor(mock, table)).not.toMatch(
        /parsed_payload|source_payload|raw_payload|amount_cents|computed_amount/u,
      );
    }
  });

  it("keeps sales/orders unavailable because normalized canonical fields do not exist", async () => {
    const repository = new SupabaseCustomRuleReadRepository(
      createClient().client,
    );
    const coverage = await repository.getProjectVariableCoverage({
      organizationId: "org-1",
      projectId: "project-1",
    });
    const catalog = buildCustomRuleVariableCatalog({
      scope: "payable",
      executionGrain: "report",
      coverage,
    });

    expect(
      catalog.variables.find(({ id }) => id === "sales_amount"),
    ).toMatchObject({
      availability: "unavailable",
      coverageNumerator: 0,
    });
    expect(
      catalog.variables.find(({ id }) => id === "orders_count"),
    ).toMatchObject({
      availability: "unavailable",
      coverageNumerator: 0,
    });
  });

  it("intersects import and settlement coverage with current approved report IDs", async () => {
    const results = defaultResults();
    results.live_reports = {
      ...results.live_reports,
      data: (results.live_reports.data ?? []).slice(0, 2).map((row, index) => ({
        ...(row as Record<string, unknown>),
        id: index === 0 ? "approved-a" : "approved-b",
      })),
      count: 2,
    };
    results.project_cost_items = {
      data: [
        {
          id: "cost-pending-1",
          item_type: "gift",
          live_report_id: "pending-c",
          created_at: "2026-06-10T00:00:00.000Z",
        },
        {
          id: "cost-pending-2",
          item_type: "gift",
          live_report_id: "pending-c",
          created_at: "2026-06-11T00:00:00.000Z",
        },
        {
          id: "cost-pending-3",
          item_type: "gift",
          live_report_id: "pending-d",
          created_at: "2026-06-12T00:00:00.000Z",
        },
        {
          id: "cost-pending-4",
          item_type: "gift",
          live_report_id: "unknown-report",
          created_at: "2026-06-13T00:00:00.000Z",
        },
        {
          id: "cost-pending-5",
          item_type: "gift",
          live_report_id: null,
          created_at: "2026-06-14T00:00:00.000Z",
        },
      ],
      count: 5,
      error: null,
    };
    results.settlement_batch_items = {
      data: [
        {
          id: "settlement-pending-1",
          settlement_batch_id: "batch-payable-1",
          streamer_id: "streamer-a",
          live_report_id: "pending-c",
        },
        {
          id: "settlement-pending-2",
          settlement_batch_id: "batch-payable-2",
          streamer_id: "streamer-b",
          live_report_id: "pending-d",
        },
        {
          id: "settlement-pending-3",
          settlement_batch_id: "batch-receivable-1",
          streamer_id: null,
          live_report_id: "unknown-report",
        },
        {
          id: "settlement-pending-4",
          settlement_batch_id: "batch-receivable-1",
          streamer_id: null,
          live_report_id: null,
        },
      ],
      count: 4,
      error: null,
    };
    const coverage = await new SupabaseCustomRuleReadRepository(
      createClient(results).client,
    ).getProjectVariableCoverage({
      organizationId: "org-1",
      projectId: "project-1",
    });

    expect(coverage.variables.gift_amount).toMatchObject({
      numerator: 0,
      denominator: 2,
    });
    expect(coverage.variables.period_payable_amount).toMatchObject({
      numerator: 0,
      denominator: 2,
    });
    expect(coverage.variables.period_receivable_amount).toMatchObject({
      numerator: 0,
      denominator: 2,
    });
  });

  it("uses approved reports for receivables and additionally intersects payable streamers", async () => {
    const results = defaultResults();
    results.settlement_batch_items = {
      data: [
        {
          id: "intersection-1",
          settlement_batch_id: "batch-payable-1",
          streamer_id: "streamer-a",
          live_report_id: "report-1",
        },
        {
          id: "intersection-2",
          settlement_batch_id: "batch-payable-1",
          streamer_id: "streamer-a",
          live_report_id: "report-1",
        },
        {
          id: "intersection-3",
          settlement_batch_id: "batch-payable-2",
          streamer_id: "streamer-foreign",
          live_report_id: "report-2",
        },
        {
          id: "intersection-4",
          settlement_batch_id: "batch-payable-2",
          streamer_id: null,
          live_report_id: "report-2",
        },
        {
          id: "intersection-5",
          settlement_batch_id: "batch-payable-2",
          streamer_id: "streamer-b",
          live_report_id: "report-unknown",
        },
        {
          id: "intersection-6",
          settlement_batch_id: "batch-receivable-1",
          streamer_id: null,
          live_report_id: "report-1",
        },
        {
          id: "intersection-7",
          settlement_batch_id: "batch-receivable-1",
          streamer_id: "streamer-foreign",
          live_report_id: "report-2",
        },
        {
          id: "intersection-8",
          settlement_batch_id: "batch-receivable-1",
          streamer_id: null,
          live_report_id: "report-foreign",
        },
      ],
      count: 8,
      error: null,
    };

    const coverage = await new SupabaseCustomRuleReadRepository(
      createClient(results).client,
    ).getProjectVariableCoverage({
      organizationId: "org-1",
      projectId: "project-1",
    });

    expect(coverage.variables.period_payable_amount).toMatchObject({
      numerator: 1,
      denominator: 2,
    });
    expect(coverage.variables.period_receivable_amount).toMatchObject({
      numerator: 2,
      denominator: 3,
    });
  });

  it("returns no-history metadata without converting it into a query failure", async () => {
    const mock = createClient(emptyResults());
    const repository = new SupabaseCustomRuleReadRepository(mock.client);

    const coverage = await repository.getProjectVariableCoverage({
      organizationId: "org-1",
      projectId: "project-new",
    });

    expect(coverage).toMatchObject({
      hasHistory: false,
      variables: {
        system_minutes: {
          numerator: 0,
          denominator: 0,
          latestSampledPeriod: null,
        },
        approved_at: { numerator: 0, denominator: 0 },
        project_id: { numerator: 1, denominator: 1 },
        gift_amount: { numerator: 0, denominator: 0 },
      },
    });
    expect(mock.from).toHaveBeenCalledTimes(4);
    expect(mock.calls.settlement_batch_items).toEqual([]);
  });

  it("converts business-date report boundaries in the resolved IANA timezone", async () => {
    const mock = createClient();
    const repository = new SupabaseCustomRuleReadRepository(mock.client, {
      resolvedBusinessTimezone: {
        value: "America/New_York",
        confirmed: true,
        source: "confirmed_contract",
      },
    });

    await repository.getProjectVariableCoverage({
      organizationId: "org-1",
      projectId: "project-1",
      periodStart: "2026-03-08",
      periodEnd: "2026-03-08",
    });

    for (const table of ["live_reports", "project_cost_items"] as const) {
      expect(mock.calls[table]).toContainEqual([
        "gte",
        ["created_at", "2026-03-08T00:00:00.000-05:00"],
      ]);
      expect(mock.calls[table]).toContainEqual([
        "lt",
        ["created_at", "2026-03-09T00:00:00.000-04:00"],
      ]);
    }
    expect(mock.calls.project_streamers).toContainEqual([
      "lt",
      ["joined_at", "2026-03-09T00:00:00.000-04:00"],
    ]);
    expect(mock.calls.project_streamers).toContainEqual([
      "or",
      ["removed_at.is.null,removed_at.gte.2026-03-08T00:00:00.000-05:00"],
    ]);
    expect(mock.calls.settlement_batches).toContainEqual([
      "gte",
      ["period_end", "2026-03-08"],
    ]);
    expect(mock.calls.settlement_batches).toContainEqual([
      "lte",
      ["period_start", "2026-03-08"],
    ]);
  });

  it("does not issue an unbounded settlement-item query when no batch overlaps", async () => {
    const results = defaultResults();
    results.settlement_batches = { data: [], count: 0, error: null };
    const mock = createClient(results);
    const coverage = await new SupabaseCustomRuleReadRepository(
      mock.client,
    ).getProjectVariableCoverage({
      organizationId: "org-1",
      projectId: "project-1",
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
    });

    expect(mock.calls.settlement_batch_items).toEqual([]);
    expect(coverage.variables.period_payable_amount.numerator).toBe(0);
    expect(coverage.variables.period_receivable_amount.numerator).toBe(0);
  });

  it("fails closed on query errors and identifies the failed source", async () => {
    const databaseError = new Error("database unavailable");
    const repository = new SupabaseCustomRuleReadRepository(
      createClient({
        ...defaultResults(),
        live_reports: { data: null, count: null, error: databaseError },
      }).client,
    );

    await expect(
      repository.getProjectVariableCoverage({
        organizationId: "org-1",
        projectId: "project-1",
      }),
    ).rejects.toMatchObject({
      code: "CUSTOM_RULE_COVERAGE_QUERY_FAILED",
      source: "live_reports",
      cause: databaseError,
    });
  });

  it("fails closed when the settlement-batch period query fails", async () => {
    const databaseError = new Error("batch query unavailable");
    const results = defaultResults();
    results.settlement_batches = {
      data: null,
      count: null,
      error: databaseError,
    };
    const mock = createClient(results);

    await expect(
      new SupabaseCustomRuleReadRepository(
        mock.client,
      ).getProjectVariableCoverage({
        organizationId: "org-1",
        projectId: "project-1",
        periodStart: PERIOD_START,
        periodEnd: PERIOD_END,
      }),
    ).rejects.toMatchObject({
      code: "CUSTOM_RULE_COVERAGE_QUERY_FAILED",
      source: "settlement_batches",
      cause: databaseError,
    });
    expect(mock.calls.settlement_batch_items).toEqual([]);
  });

  it.each([
    ["empty organization", { organizationId: " ", projectId: "project-1" }],
    ["empty project", { organizationId: "org-1", projectId: "" }],
    [
      "invalid start",
      {
        organizationId: "org-1",
        projectId: "project-1",
        periodStart: "not-a-date",
      },
    ],
    [
      "reversed period",
      {
        organizationId: "org-1",
        projectId: "project-1",
        periodStart: PERIOD_END,
        periodEnd: PERIOD_START,
      },
    ],
    [
      "offset timestamp",
      {
        organizationId: "org-1",
        projectId: "project-1",
        periodStart: "2026-06-01T00:00:00+08:00",
      },
    ],
    [
      "impossible calendar date",
      {
        organizationId: "org-1",
        projectId: "project-1",
        periodStart: "2026-02-30",
      },
    ],
    [
      "T24 time",
      {
        organizationId: "org-1",
        projectId: "project-1",
        periodEnd: "2026-06-01T24:00:00+08:00",
      },
    ],
    [
      "unknown key",
      {
        organizationId: "org-1",
        projectId: "project-1",
        extra: true,
      },
    ],
  ])("rejects %s before issuing a query", async (_label, input) => {
    const mock = createClient();
    const repository = new SupabaseCustomRuleReadRepository(mock.client);

    await expect(
      repository.getProjectVariableCoverage(input),
    ).rejects.toMatchObject({ code: "CUSTOM_RULE_COVERAGE_INPUT_INVALID" });
    expect(mock.from).not.toHaveBeenCalled();
  });

  it("rejects inherited/accessor input without invoking the accessor", async () => {
    const mock = createClient();
    const repository = new SupabaseCustomRuleReadRepository(mock.client);
    const inherited = Object.create({
      organizationId: "org-1",
      projectId: "project-1",
    }) as {
      organizationId: string;
      projectId: string;
    };
    let reads = 0;
    const accessorInput = { projectId: "project-1" };
    Object.defineProperty(accessorInput, "organizationId", {
      enumerable: true,
      get() {
        reads += 1;
        return "org-1";
      },
    });

    await expect(
      repository.getProjectVariableCoverage(inherited),
    ).rejects.toMatchObject({ code: "CUSTOM_RULE_COVERAGE_INPUT_INVALID" });
    await expect(
      repository.getProjectVariableCoverage(
        accessorInput as { organizationId: string; projectId: string },
      ),
    ).rejects.toMatchObject({ code: "CUSTOM_RULE_COVERAGE_INPUT_INVALID" });
    expect(reads).toBe(0);
    expect(mock.from).not.toHaveBeenCalled();
  });

  it("reads 1001 rows with a fixed high-water and 1000 + 1 keyset pages", async () => {
    const results = defaultResults();
    results.live_reports = {
      data: approvedReportRows(1_001),
      count: 1_001,
      error: null,
    };
    const mock = createClient(results);

    const coverage = await new SupabaseCustomRuleReadRepository(
      mock.client,
    ).getProjectVariableCoverage({
      organizationId: "org-1",
      projectId: "project-1",
    });

    expect(coverage.variables.system_minutes).toMatchObject({
      numerator: 1_001,
      denominator: 1_001,
    });
    expect(
      mock.calls.live_reports.filter(([method]) => method === "range"),
    ).toEqual([]);
    expect(
      mock.calls.live_reports.filter(([method]) => method === "limit"),
    ).toEqual([
      ["limit", [1]],
      ["limit", [1_000]],
      ["limit", [1_000]],
    ]);
    expect(mock.calls.live_reports).toContainEqual([
      "gt",
      ["id", "report-001000"],
    ]);
    expect(
      mock.calls.live_reports.filter(
        ([method, args]) =>
          method === "lte" && args[0] === "id" && args[1] === "report-001001",
      ),
    ).toHaveLength(2);
    expect(
      mock.from.mock.calls.filter(([table]) => table === "live_reports"),
    ).toHaveLength(3);
  });

  it("uses one page at the exact 1000-row boundary", async () => {
    const results = defaultResults();
    results.live_reports = {
      data: approvedReportRows(1_000),
      count: 1_000,
      error: null,
    };
    const mock = createClient(results);

    await new SupabaseCustomRuleReadRepository(
      mock.client,
    ).getProjectVariableCoverage({
      organizationId: "org-1",
      projectId: "project-1",
    });

    expect(
      mock.calls.live_reports.filter(([method]) => method === "range"),
    ).toEqual([]);
    expect(
      mock.calls.live_reports.filter(([method]) => method === "limit"),
    ).toEqual([
      ["limit", [1]],
      ["limit", [1_000]],
    ]);
    expect(
      mock.calls.live_reports.filter(([method]) => method === "gt"),
    ).toEqual([]);
  });

  it.each([
    [
      "duplicate page",
      {
        1: { data: [approvedReportRows(1)[0]] },
      },
    ],
    [
      "short first page",
      {
        0: { data: approvedReportRows(999) },
      },
    ],
    [
      "count drift",
      {
        1: { count: 2 },
      },
    ],
    [
      "non-monotonic first page",
      {
        0: { data: approvedReportRows(1_000).reverse() },
      },
    ],
  ] as const)(
    "fails closed on %s pagination anomalies",
    async (_label, pages) => {
      const results = defaultResults();
      results.live_reports = {
        data: approvedReportRows(1_001),
        count: 1_001,
        error: null,
        pages: pages as Record<number, MockPageOverride>,
      };

      await expect(
        new SupabaseCustomRuleReadRepository(
          createClient(results).client,
        ).getProjectVariableCoverage({
          organizationId: "org-1",
          projectId: "project-1",
        }),
      ).rejects.toMatchObject({
        code: "CUSTOM_RULE_COVERAGE_PAGE_INVALID",
        source: "live_reports",
      });
    },
  );

  it("fails closed when a later page query fails", async () => {
    const pageError = new Error("second page unavailable");
    const results = defaultResults();
    results.live_reports = {
      data: approvedReportRows(1_001),
      count: 1_001,
      error: null,
      pages: { 1: { error: pageError } },
    };

    await expect(
      new SupabaseCustomRuleReadRepository(
        createClient(results).client,
      ).getProjectVariableCoverage({
        organizationId: "org-1",
        projectId: "project-1",
      }),
    ).rejects.toMatchObject({
      code: "CUSTOM_RULE_COVERAGE_QUERY_FAILED",
      source: "live_reports",
      cause: pageError,
    });
  });

  it("excludes IDs inserted above the fixed high-water", async () => {
    const results = defaultResults();
    results.live_reports = {
      data: approvedReportRows(1_001),
      count: 1_001,
      error: null,
      afterHighWater(result) {
        result.data = [
          ...(result.data ?? []),
          approvedReportRow("report-999999"),
        ];
      },
    };
    const mock = createClient(results);

    const coverage = await new SupabaseCustomRuleReadRepository(
      mock.client,
    ).getProjectVariableCoverage({
      organizationId: "org-1",
      projectId: "project-1",
    });

    expect(coverage.variables.system_minutes).toMatchObject({
      numerator: 1_001,
      denominator: 1_001,
    });
    expect(mock.calls.live_reports).toContainEqual([
      "lte",
      ["id", "report-001001"],
    ]);
  });

  it("fails closed when deletion plus a new high ID drifts the snapshot", async () => {
    const results = defaultResults();
    results.live_reports = {
      data: approvedReportRows(1_001),
      count: 1_001,
      error: null,
      afterHighWater(result) {
        result.data = [
          ...(result.data ?? []).filter(
            (row) => rowOrderValue(row, "id") !== "report-000500",
          ),
          approvedReportRow("report-999999"),
        ];
      },
    };

    await expect(
      new SupabaseCustomRuleReadRepository(
        createClient(results).client,
      ).getProjectVariableCoverage({
        organizationId: "org-1",
        projectId: "project-1",
      }),
    ).rejects.toMatchObject({
      code: "CUSTOM_RULE_COVERAGE_PAGE_INVALID",
      source: "live_reports",
    });
  });

  it("chunks settlement batch IDs for independently bounded item snapshots", async () => {
    const results = defaultResults();
    const batches = settlementBatchRows(205);
    results.settlement_batches = {
      data: batches,
      count: batches.length,
      error: null,
    };
    results.settlement_batch_items = {
      data: batches.map((batch, index) => ({
        id: `settlement-item-${String(index + 1).padStart(6, "0")}`,
        settlement_batch_id: rowOrderValue(batch, "id"),
        streamer_id: "streamer-a",
        live_report_id: `report-${(index % 3) + 1}`,
      })),
      count: batches.length,
      error: null,
    };
    const mock = createClient(results);

    await new SupabaseCustomRuleReadRepository(
      mock.client,
    ).getProjectVariableCoverage({
      organizationId: "org-1",
      projectId: "project-1",
    });

    const itemChunks = mock.queries.settlement_batch_items.map((queryCalls) => {
      const chunkCall = queryCalls.find(
        ([method, args]) =>
          method === "in" && args[0] === "settlement_batch_id",
      );
      expect(chunkCall).toBeDefined();
      const ids = chunkCall?.[1][1] as readonly unknown[];
      expect(ids.length).toBeLessThanOrEqual(100);
      expect(queryCalls).toContainEqual(["eq", ["organization_id", "org-1"]]);
      expect(queryCalls).toContainEqual(["eq", ["project_id", "project-1"]]);
      return ids;
    });
    expect(itemChunks).toHaveLength(6);
    expect(new Set(itemChunks.map((ids) => JSON.stringify(ids))).size).toBe(3);
  });

  it("enforces the global settlement-item limit across chunks", async () => {
    const results = defaultResults();
    const batches = settlementBatchRows(101);
    const items = [
      ...Array.from({ length: 4_950 }, (_, index) => ({
        id: `settlement-item-a-${String(index + 1).padStart(6, "0")}`,
        settlement_batch_id: "batch-000001",
        streamer_id: "streamer-a",
        live_report_id: "report-1",
      })),
      ...Array.from({ length: 51 }, (_, index) => ({
        id: `settlement-item-b-${String(index + 1).padStart(6, "0")}`,
        settlement_batch_id: "batch-000101",
        streamer_id: "streamer-a",
        live_report_id: "report-1",
      })),
    ];
    results.settlement_batches = {
      data: batches,
      count: batches.length,
      error: null,
    };
    results.settlement_batch_items = {
      data: items,
      count: items.length,
      error: null,
    };

    await expect(
      new SupabaseCustomRuleReadRepository(
        createClient(results).client,
      ).getProjectVariableCoverage({
        organizationId: "org-1",
        projectId: "project-1",
      }),
    ).rejects.toMatchObject({
      code: "CUSTOM_RULE_COVERAGE_LIMIT_EXCEEDED",
      source: "settlement_batch_items",
    });
  });

  it.each([
    [5_001, "CUSTOM_RULE_COVERAGE_LIMIT_EXCEEDED"],
    [1.5, "CUSTOM_RULE_COVERAGE_COUNT_INVALID"],
    [Number.MAX_SAFE_INTEGER + 1, "CUSTOM_RULE_COVERAGE_COUNT_INVALID"],
  ])("rejects unsafe/excessive exact count %s", async (count, code) => {
    const repository = new SupabaseCustomRuleReadRepository(
      createClient({
        ...defaultResults(),
        live_reports: {
          data: defaultResults().live_reports.data,
          count,
          error: null,
        },
      }).client,
    );

    await expect(
      repository.getProjectVariableCoverage({
        organizationId: "org-1",
        projectId: "project-1",
      }),
    ).rejects.toMatchObject({ code });
  });

  it("is deterministic when database row order changes", async () => {
    const results = defaultResults();
    const reversedResults = Object.fromEntries(
      Object.entries(results).map(([table, result]) => [
        table,
        {
          ...result,
          data: result.data ? [...result.data].reverse() : result.data,
        },
      ]),
    ) as MockResults;
    const forward = await new SupabaseCustomRuleReadRepository(
      createClient(results).client,
    ).getProjectVariableCoverage({
      organizationId: "org-1",
      projectId: "project-1",
    });
    const reverse = await new SupabaseCustomRuleReadRepository(
      createClient(reversedResults).client,
    ).getProjectVariableCoverage({
      organizationId: "org-1",
      projectId: "project-1",
    });

    expect(reverse).toEqual(forward);
  });

  it("propagates explicit timezone provenance into catalog/readiness freshness", async () => {
    const client = createClient().client;
    const shanghaiCoverage = await new SupabaseCustomRuleReadRepository(
      client,
    ).getProjectVariableCoverage({
      organizationId: "org-1",
      projectId: "project-1",
    });
    const tokyoCoverage = await new SupabaseCustomRuleReadRepository(client, {
      resolvedBusinessTimezone: {
        value: "Asia/Tokyo",
        confirmed: true,
        source: "confirmed_contract",
      },
    }).getProjectVariableCoverage({
      organizationId: "org-1",
      projectId: "project-1",
    });
    const shanghaiCatalog = buildCustomRuleVariableCatalog({
      scope: "payable",
      executionGrain: "report",
      coverage: shanghaiCoverage,
    });
    const tokyoCatalog = buildCustomRuleVariableCatalog({
      scope: "payable",
      executionGrain: "report",
      coverage: tokyoCoverage,
    });
    const shanghaiReadiness = analyzeCustomRuleDataReadiness({
      catalog: shanghaiCatalog,
      inputs: [{ variableId: "weekday", required: true }],
    });
    const tokyoReadiness = analyzeCustomRuleDataReadiness({
      catalog: tokyoCatalog,
      inputs: [{ variableId: "weekday", required: true }],
    });

    expect(shanghaiCoverage.businessTimezoneSource).toBe("contract_default");
    expect(tokyoCoverage.businessTimezoneSource).toBe("confirmed_contract");
    expect(tokyoCatalog.businessTimezoneSource).toBe("confirmed_contract");
    expect(tokyoReadiness.businessTimezoneSource).toBe("confirmed_contract");
    expect(tokyoCatalog.version).not.toBe(shanghaiCatalog.version);
    expect(tokyoReadiness.readinessHash).not.toBe(
      shanghaiReadiness.readinessHash,
    );
  });

  it("does not confirm an invalid resolved timezone", async () => {
    const coverage = await new SupabaseCustomRuleReadRepository(
      createClient().client,
      {
        resolvedBusinessTimezone: {
          value: "Mars/Olympus",
          confirmed: true,
          source: "confirmed_contract",
        },
      },
    ).getProjectVariableCoverage({
      organizationId: "org-1",
      projectId: "project-1",
    });
    const catalog = buildCustomRuleVariableCatalog({
      scope: "payable",
      executionGrain: "report",
      coverage,
    });

    expect(coverage.businessTimezoneConfirmed).toBe(false);
    expect(catalog.variables.find(({ id }) => id === "weekday")).toMatchObject({
      availability: "unavailable",
    });
  });

  it("does not confirm a valid IANA value with unresolved provenance", async () => {
    const coverage = await new SupabaseCustomRuleReadRepository(
      createClient().client,
      {
        resolvedBusinessTimezone: {
          value: "Asia/Shanghai",
          confirmed: true,
          source: "unresolved",
        },
      },
    ).getProjectVariableCoverage({
      organizationId: "org-1",
      projectId: "project-1",
    });

    expect(coverage).toMatchObject({
      businessTimezone: "Asia/Shanghai",
      businessTimezoneSource: "unresolved",
      businessTimezoneConfirmed: false,
    });
  });

  it("rejects period filtering when the business timezone is unresolved", async () => {
    const mock = createClient();
    const repository = new SupabaseCustomRuleReadRepository(mock.client, {
      resolvedBusinessTimezone: {
        value: "Asia/Shanghai",
        confirmed: true,
        source: "unresolved",
      },
    });

    await expect(
      repository.getProjectVariableCoverage({
        organizationId: "org-1",
        projectId: "project-1",
        periodStart: PERIOD_START,
        periodEnd: PERIOD_END,
      }),
    ).rejects.toMatchObject({
      code: "CUSTOM_RULE_COVERAGE_INPUT_INVALID",
    });
    expect(mock.from).not.toHaveBeenCalled();
  });
});

describe("custom-rule draft and simulation persistence", () => {
  it("atomically finishes a validating turn and creates its draft through one RPC", async () => {
    const draft = validClarifyingDraftInput();
    const completion = validTurnCompletion(draft.aiResponse.content);
    const mock = createPersistenceClient({
      finalizedDraftRpcData: draftRow({
        unresolved_ambiguities: draft.unresolvedAmbiguities,
        generated_formula: null,
        generated_explanation: null,
        generated_test_cases: [],
        formula_hash: null,
        initial_status: "clarifying",
        status: "clarifying",
        duplicate: false,
        request_fingerprint: HASH_E,
      }),
    });
    const repository: CustomRuleRepository =
      new SupabaseCustomRuleReadRepository(mock.client);

    const result = await repository.finalizeDraftTurn({ draft, completion });

    expect(mock.rpc).toHaveBeenCalledWith("finalize_settlement_ai_draft_turn", {
      p_draft: draft,
      p_completion: completion,
    });
    expect(mock.from).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      initialStatus: "clarifying",
      status: "clarifying",
      generatedFormula: null,
      duplicate: false,
    });
  });

  it("atomically finishes a turn and persists a ready draft plus simulation summary", async () => {
    const draft = validDraftInput();
    const completion = validTurnCompletion(draft.aiResponse.content);
    const simulation = validAtomicSimulationSummary();
    const mock = createPersistenceClient({
      finalizedSimulationRpcData: {
        draft: draftRow({
          status: "simulated",
          duplicate: false,
          request_fingerprint: HASH_E,
        }),
        simulation: simulationRow(
          { kind: "ai_draft", id: DRAFT_ID },
          { duplicate: false },
        ),
      },
    });
    const repository: CustomRuleRepository =
      new SupabaseCustomRuleReadRepository(mock.client);

    const result = await repository.finalizeSimulationTurn({
      draft,
      completion,
      simulation,
    });

    expect(mock.rpc).toHaveBeenCalledWith(
      "finalize_settlement_ai_simulation_turn",
      {
        p_draft: draft,
        p_completion: completion,
        p_simulation: simulation,
      },
    );
    expect(mock.from).not.toHaveBeenCalled();
    expect(result.draft).toMatchObject({
      id: DRAFT_ID,
      initialStatus: "contract_ready",
      status: "simulated",
      duplicate: false,
    });
    expect(result.simulation).toMatchObject({
      id: SIMULATION_ID,
      owner: { kind: "ai_draft", id: DRAFT_ID },
      duplicate: false,
    });
  });

  it.each([
    [
      "retryable provider failure",
      {
        errorCode: "SETTLEMENT_AI_PROVIDER_FAILED" as const,
        errorSummary:
          "Settlement AI provider is temporarily unavailable." as const,
        retryable: true,
      },
    ],
    [
      "non-retryable formula failure",
      {
        errorCode: "SETTLEMENT_AI_FORMULA_INVALID" as const,
        errorSummary: "Settlement AI formula did not pass validation." as const,
        retryable: false,
      },
    ],
  ])("atomically persists sanitized %s semantics", async (_label, failure) => {
    const draft = validFailedDraftInput();
    const completion = validTurnCompletion(draft.aiResponse.content);
    const mock = createPersistenceClient({
      finalizedFailedRpcData: draftRow({
        unresolved_ambiguities: draft.unresolvedAmbiguities,
        ai_response: draft.aiResponse,
        generated_formula: null,
        generated_explanation: null,
        generated_test_cases: [],
        safety_flags: draft.safetyFlags,
        formula_hash: null,
        initial_status: "failed",
        status: "failed",
        duplicate: false,
        request_fingerprint: HASH_E,
      }),
    });
    const repository: CustomRuleRepository =
      new SupabaseCustomRuleReadRepository(mock.client);

    const result = await repository.finalizeFailedTurn({
      draft,
      completion,
      ...failure,
    });

    expect(mock.rpc).toHaveBeenCalledWith(
      "finalize_settlement_ai_failed_turn",
      {
        p_draft: draft,
        p_completion: completion,
        p_error_code: failure.errorCode,
        p_error_summary: failure.errorSummary,
        p_retryable: failure.retryable,
      },
    );
    expect(mock.from).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      initialStatus: "failed",
      status: "failed",
      aiResponse: draft.aiResponse,
      duplicate: false,
    });
  });

  it.each([
    [
      "unknown error code",
      {
        errorCode: "RAW_PROVIDER_EXCEPTION",
        errorSummary: "Settlement AI provider is temporarily unavailable.",
        retryable: true,
      },
    ],
    [
      "mismatched summary",
      {
        errorCode: "SETTLEMENT_AI_PROVIDER_FAILED",
        errorSummary: "Settlement AI formula did not pass validation.",
        retryable: true,
      },
    ],
    [
      "raw secret or stack text",
      {
        errorCode: "SETTLEMENT_AI_PROVIDER_FAILED",
        errorSummary: "Authorization: Bearer secret-token at provider.ts:42",
        retryable: true,
      },
    ],
    [
      "oversized summary",
      {
        errorCode: "SETTLEMENT_AI_PROVIDER_FAILED",
        errorSummary: "x".repeat(121),
        retryable: true,
      },
    ],
  ])(
    "rejects unsafe atomic failure semantics before RPC: %s",
    async (_label, failure) => {
      const draft = validFailedDraftInput();
      const mock = createPersistenceClient();
      const repository = new SupabaseCustomRuleReadRepository(mock.client);

      await expect(
        repository.finalizeFailedTurn({
          draft,
          completion: validTurnCompletion(draft.aiResponse.content),
          ...failure,
        } as never),
      ).rejects.toMatchObject({
        code: "CUSTOM_RULE_PERSISTENCE_INPUT_INVALID",
      });
      expect(mock.rpc).not.toHaveBeenCalled();
    },
  );

  it.each([
    [
      "content that differs from the turn-bound AI response",
      () => ({
        draft: validClarifyingDraftInput(),
        completion: validTurnCompletion("different content"),
      }),
    ],
    [
      "raw completion metadata",
      () => {
        const draft = validClarifyingDraftInput();
        return {
          draft,
          completion: {
            ...validTurnCompletion(draft.aiResponse.content),
            metadata: { rawRows: [] },
          },
        };
      },
    ],
    [
      "oversized completion metadata",
      () => {
        const draft = validClarifyingDraftInput();
        return {
          draft,
          completion: {
            ...validTurnCompletion(draft.aiResponse.content),
            metadata: { note: "x".repeat(61 * 1_024) },
          },
        };
      },
    ],
  ])(
    "rejects unsafe atomic draft completion before RPC: %s",
    async (_label, buildInput) => {
      const mock = createPersistenceClient();
      const repository: CustomRuleRepository =
        new SupabaseCustomRuleReadRepository(mock.client);

      await expect(
        repository.finalizeDraftTurn(buildInput()),
      ).rejects.toMatchObject({
        code: "CUSTOM_RULE_PERSISTENCE_INPUT_INVALID",
      });
      expect(mock.rpc).not.toHaveBeenCalled();
    },
  );

  it("fails closed when the atomic simulation RPC returns a partial result", async () => {
    const draft = validDraftInput();
    const mock = createPersistenceClient({
      finalizedSimulationRpcData: {
        draft: draftRow({ duplicate: false, request_fingerprint: HASH_E }),
      },
    });
    const repository: CustomRuleRepository =
      new SupabaseCustomRuleReadRepository(mock.client);

    await expect(
      repository.finalizeSimulationTurn({
        draft,
        completion: validTurnCompletion(draft.aiResponse.content),
        simulation: validAtomicSimulationSummary(),
      }),
    ).rejects.toMatchObject({ code: "CUSTOM_RULE_PERSISTENCE_DATA_INVALID" });
  });

  it("creates a draft through the authenticated RPC and maps duplicate revisions", async () => {
    const draft = draftRow({ duplicate: true, request_fingerprint: HASH_E });
    const mock = createPersistenceClient({ draftRpcData: draft });
    const repository: CustomRuleRepository =
      new SupabaseCustomRuleReadRepository(mock.client);
    const input = validDraftInput();

    const result = await repository.createDraft(input);

    expect(mock.rpc).toHaveBeenCalledWith("create_ai_settlement_rule_draft", {
      p_organization_id: ORGANIZATION_ID,
      p_project_id: PROJECT_ID,
      p_conversation_id: CONVERSATION_ID,
      p_idempotency_key: "draft-request-1",
      p_prompt_text: input.promptText,
      p_turn_trace: input.turnTrace,
      p_business_contract: input.businessContract,
      p_unresolved_ambiguities: input.unresolvedAmbiguities,
      p_variable_catalog_version: HASH_A,
      p_ai_response: input.aiResponse,
      p_generated_formula: input.generatedFormula,
      p_generated_explanation: input.generatedExplanation,
      p_generated_test_cases: input.generatedTestCases,
      p_model: input.model,
      p_safety_flags: input.safetyFlags,
      p_contract_hash: HASH_B,
      p_formula_hash: HASH_C,
      p_parameter_hash: HASH_D,
      p_status: "contract_ready",
    });
    expect(mock.from).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      id: DRAFT_ID,
      organizationId: ORGANIZATION_ID,
      projectId: PROJECT_ID,
      conversationId: CONVERSATION_ID,
      revisionNumber: 1,
      initialStatus: "contract_ready",
      status: "contract_ready",
      contractHash: HASH_B,
      formulaHash: HASH_C,
      parameterHash: HASH_D,
      duplicate: true,
    });
    expect(result).not.toHaveProperty("organization_id");
    expect(result).not.toHaveProperty("requestFingerprint");
    expect(result).not.toHaveProperty("request_fingerprint");
    if (result.initialStatus !== "contract_ready") {
      throw new Error("expected a contract-ready draft");
    }
    const narrowedFormula: SettlementAiFormulaDraft = result.generatedFormula;
    expect(narrowedFormula.expression).toBe("grossRevenue");
    if (result.status === "superseded") {
      const supersededByDraftId: string = result.supersededByDraftId;
      const supersededAt: string = result.supersededAt;
      expect([supersededByDraftId, supersededAt]).not.toContain(null);
    } else {
      const supersededByDraftId: null = result.supersededByDraftId;
      const supersededAt: null = result.supersededAt;
      expect([supersededByDraftId, supersededAt]).toEqual([null, null]);
    }
  });

  it("persists a clarifying draft without placeholder formula state", async () => {
    const input = validClarifyingDraftInput();
    const mock = createPersistenceClient({
      draftRpcData: draftRow({
        unresolved_ambiguities: input.unresolvedAmbiguities,
        generated_formula: null,
        generated_explanation: null,
        generated_test_cases: [],
        formula_hash: null,
        initial_status: "clarifying",
        status: "clarifying",
        duplicate: false,
        request_fingerprint: HASH_E,
      }),
    });
    const repository: CustomRuleRepository =
      new SupabaseCustomRuleReadRepository(mock.client);

    const result = await repository.createDraft(input);

    expect(mock.rpc).toHaveBeenCalledWith(
      "create_ai_settlement_rule_draft",
      expect.objectContaining({
        p_unresolved_ambiguities: input.unresolvedAmbiguities,
        p_generated_formula: null,
        p_generated_explanation: null,
        p_generated_test_cases: [],
        p_formula_hash: null,
        p_status: "clarifying",
      }),
    );
    expect(result).toMatchObject({
      initialStatus: "clarifying",
      status: "clarifying",
      generatedFormula: null,
      generatedExplanation: null,
      generatedTestCases: [],
      formulaHash: null,
    });
    if (result.initialStatus !== "clarifying") {
      throw new Error("expected a clarifying draft");
    }
    const noFormula: null = result.generatedFormula;
    expect(noFormula).toBeNull();
  });

  it("maps a valid superseded clarifying draft with required lifecycle metadata", async () => {
    const input = validClarifyingDraftInput();
    const mock = createPersistenceClient({
      draftRows: [
        draftRow({
          unresolved_ambiguities: input.unresolvedAmbiguities,
          generated_formula: null,
          generated_explanation: null,
          generated_test_cases: [],
          formula_hash: null,
          initial_status: "clarifying",
          status: "superseded",
          superseded_by_draft_id: DRAFT_2_ID,
          superseded_at: "2026-07-11T11:10:00.000Z",
        }),
      ],
    });
    const repository: CustomRuleRepository =
      new SupabaseCustomRuleReadRepository(mock.client);

    const [result] = await repository.listDrafts({
      organizationId: ORGANIZATION_ID,
      projectId: PROJECT_ID,
      conversationId: CONVERSATION_ID,
    });

    expect(result).toMatchObject({
      initialStatus: "clarifying",
      status: "superseded",
      generatedFormula: null,
      supersededByDraftId: DRAFT_2_ID,
      supersededAt: "2026-07-11T11:10:00.000Z",
    });
    if (result?.status === "superseded") {
      const supersededByDraftId: string = result.supersededByDraftId;
      const supersededAt: string = result.supersededAt;
      expect([supersededByDraftId, supersededAt]).not.toContain(null);
    }
  });

  it("persists failed evidence without an authoritative formula", async () => {
    const input = validFailedDraftInput();
    const mock = createPersistenceClient({
      draftRpcData: draftRow({
        unresolved_ambiguities: input.unresolvedAmbiguities,
        ai_response: input.aiResponse,
        generated_formula: null,
        generated_explanation: null,
        generated_test_cases: [],
        safety_flags: input.safetyFlags,
        formula_hash: null,
        initial_status: "failed",
        status: "failed",
        duplicate: false,
        request_fingerprint: HASH_E,
      }),
    });
    const repository: CustomRuleRepository =
      new SupabaseCustomRuleReadRepository(mock.client);

    const result = await repository.createDraft(input);

    expect(mock.rpc).toHaveBeenCalledWith(
      "create_ai_settlement_rule_draft",
      expect.objectContaining({
        p_ai_response: input.aiResponse,
        p_generated_formula: null,
        p_generated_explanation: null,
        p_generated_test_cases: [],
        p_safety_flags: input.safetyFlags,
        p_formula_hash: null,
        p_status: "failed",
      }),
    );
    expect(result).toMatchObject({
      initialStatus: "failed",
      status: "failed",
      aiResponse: input.aiResponse,
      safetyFlags: input.safetyFlags,
      generatedFormula: null,
      formulaHash: null,
    });
    if (result.initialStatus !== "failed") {
      throw new Error("expected a failed draft");
    }
    const noFormula: null = result.generatedFormula;
    expect(noFormula).toBeNull();
    // @ts-expect-error Failed drafts cannot expose an authoritative formula.
    const invalidFailedFormula: SettlementAiFormulaDraft =
      result.generatedFormula;
    expect(invalidFailedFormula).toBeNull();
  });

  it.each([
    [
      "clarifying without a required ambiguity",
      { ...validClarifyingDraftInput(), unresolvedAmbiguities: [] },
    ],
    [
      "clarifying with a placeholder formula",
      {
        ...validClarifyingDraftInput(),
        generatedFormula: validDraftInput().generatedFormula,
      },
    ],
    [
      "ready with unresolved ambiguities",
      {
        ...validDraftInput(),
        unresolvedAmbiguities:
          validClarifyingDraftInput().unresolvedAmbiguities,
      },
    ],
    [
      "ready without formula state",
      {
        ...validDraftInput(),
        generatedFormula: null,
        generatedExplanation: null,
        generatedTestCases: [],
        formulaHash: null,
      },
    ],
    [
      "failed with an authoritative formula",
      {
        ...validFailedDraftInput(),
        generatedFormula: validDraftInput().generatedFormula,
      },
    ],
  ])("rejects incoherent draft state before RPC: %s", async (_label, input) => {
    const mock = createPersistenceClient();
    const repository: CustomRuleRepository =
      new SupabaseCustomRuleReadRepository(mock.client);

    await expect(
      repository.createDraft(input as unknown as CreateCustomRuleDraftInput),
    ).rejects.toMatchObject({ code: "CUSTOM_RULE_PERSISTENCE_INPUT_INVALID" });
    expect(mock.rpc).not.toHaveBeenCalled();
  });

  it("preserves turn-bound AI response whitespace through RPC and row mapping", async () => {
    const preservedContent = "\n已生成项目应收规则草案。\n";
    const input = {
      ...validDraftInput(),
      aiResponse: {
        ...validAiResponse(),
        content: preservedContent,
      },
    };
    const mock = createPersistenceClient({
      draftRpcData: draftRow({
        ai_response: input.aiResponse,
        duplicate: false,
        request_fingerprint: HASH_E,
      }),
    });
    const repository: CustomRuleRepository =
      new SupabaseCustomRuleReadRepository(mock.client);

    const result = await repository.createDraft(input);

    expect(mock.rpc).toHaveBeenCalledWith(
      "create_ai_settlement_rule_draft",
      expect.objectContaining({
        p_ai_response: expect.objectContaining({ content: preservedContent }),
      }),
    );
    expect(result.aiResponse.content).toBe(preservedContent);
  });

  it("fails closed when a draft RPC row omits its immutable request fingerprint", async () => {
    const mock = createPersistenceClient({
      draftRpcData: draftRow({ duplicate: false }),
    });
    const repository: CustomRuleRepository =
      new SupabaseCustomRuleReadRepository(mock.client);

    await expect(
      repository.createDraft(validDraftInput()),
    ).rejects.toMatchObject({
      code: "CUSTOM_RULE_PERSISTENCE_DATA_INVALID",
    });
  });

  it.each([
    [
      "ambiguity code number",
      {
        unresolvedAmbiguities: [
          { code: 7, question: "请确认规则。", required: true },
        ],
      },
    ],
    [
      "ambiguity question number",
      {
        unresolvedAmbiguities: [
          { code: "confirm_rate", question: 7, required: true },
        ],
      },
    ],
    [
      "ambiguity required string",
      {
        unresolvedAmbiguities: [
          { code: "confirm_rate", question: "请确认规则。", required: "true" },
        ],
      },
    ],
    [
      "AI response content number",
      {
        aiResponse: {
          content: 7,
          finishReason: "stop",
          providerRequestId: null,
        },
      },
    ],
    [
      "non-finite normalized AST literal",
      {
        generatedFormula: {
          expression: "grossRevenue",
          normalizedAst: { kind: "literal", value: Number.POSITIVE_INFINITY },
        },
      },
    ],
    [
      "non-integer generated test money",
      {
        generatedTestCases: [
          {
            name: "标准场景",
            inputs: {},
            expectedResult: { type: "money_cents", amountCents: 1.5 },
          },
        ],
      },
    ],
    [
      "unknown safety severity",
      {
        safetyFlags: [
          { code: "manual_review", severity: "critical", message: "复核" },
        ],
      },
    ],
    ["non-string model", { model: 7 }],
  ])("rejects malformed draft input before RPC: %s", async (_label, patch) => {
    const mock = createPersistenceClient();
    const repository: CustomRuleRepository =
      new SupabaseCustomRuleReadRepository(mock.client);
    const unsafeInput = {
      ...validDraftInput(),
      ...patch,
    } as unknown as CreateCustomRuleDraftInput;

    await expect(repository.createDraft(unsafeInput)).rejects.toMatchObject({
      code: "CUSTOM_RULE_PERSISTENCE_INPUT_INVALID",
    });
    expect(mock.rpc).not.toHaveBeenCalled();
    expect(mock.from).not.toHaveBeenCalled();
  });

  it("rejects over-depth draft JSON before Zod recursion or RPC", async () => {
    let normalizedAst: Record<string, unknown> = {
      kind: "identifier",
      name: "grossRevenue",
    };
    for (let depth = 0; depth < 21; depth += 1) {
      normalizedAst = {
        kind: "unary",
        operator: "+",
        argument: normalizedAst,
      };
    }
    const mock = createPersistenceClient();
    const repository: CustomRuleRepository =
      new SupabaseCustomRuleReadRepository(mock.client);

    await expect(
      repository.createDraft({
        ...validDraftInput(),
        generatedFormula: {
          expression: "grossRevenue",
          normalizedAst,
        },
      } as never),
    ).rejects.toMatchObject({ code: "CUSTOM_RULE_PERSISTENCE_INPUT_INVALID" });
    expect(mock.rpc).not.toHaveBeenCalled();
  });

  it("rejects a draft JSON subcontainer over 64 KiB before RPC", async () => {
    const mock = createPersistenceClient();
    const repository: CustomRuleRepository =
      new SupabaseCustomRuleReadRepository(mock.client);

    await expect(
      repository.createDraft({
        ...validDraftInput(),
        safetyFlags: Array.from({ length: 20 }, (_, index) => ({
          code: `warning_${index}`,
          severity: "warning" as const,
          message: "x".repeat(4_000),
        })),
      }),
    ).rejects.toMatchObject({
      code: "CUSTOM_RULE_PERSISTENCE_INPUT_INVALID",
      message: expect.stringContaining(
        "conservative 61440-byte JSON input subcontainer budget",
      ),
    });
    expect(mock.rpc).not.toHaveBeenCalled();
  });

  it.each(["asc", "desc"] as const)(
    "lists conversation revisions in explicitly documented %s order",
    async (revisionOrder) => {
      const rows =
        revisionOrder === "asc"
          ? [draftRow(), draftRow({ id: DRAFT_2_ID, revision_number: 2 })]
          : [draftRow({ id: DRAFT_2_ID, revision_number: 2 }), draftRow()];
      const mock = createPersistenceClient({ draftRows: rows });
      const repository: CustomRuleRepository =
        new SupabaseCustomRuleReadRepository(mock.client);

      const result = await repository.listDrafts({
        organizationId: ORGANIZATION_ID,
        projectId: PROJECT_ID,
        conversationId: CONVERSATION_ID,
        revisionOrder,
      });

      expect(result.map(({ revisionNumber }) => revisionNumber)).toEqual(
        revisionOrder === "asc" ? [1, 2] : [2, 1],
      );
      expect(mock.queryCalls).toEqual(
        expect.arrayContaining([
          [
            "ai_settlement_rule_drafts",
            "eq",
            ["organization_id", ORGANIZATION_ID],
          ],
          ["ai_settlement_rule_drafts", "eq", ["project_id", PROJECT_ID]],
          [
            "ai_settlement_rule_drafts",
            "eq",
            ["conversation_id", CONVERSATION_ID],
          ],
          [
            "ai_settlement_rule_drafts",
            "order",
            ["revision_number", { ascending: revisionOrder === "asc" }],
          ],
        ]),
      );
    },
  );

  it("gets a draft only through organization, project, and conversation isolation", async () => {
    const mock = createPersistenceClient({ draftRows: [draftRow()] });
    const repository: CustomRuleRepository =
      new SupabaseCustomRuleReadRepository(mock.client);

    const result = await repository.getDraft({
      organizationId: ORGANIZATION_ID,
      projectId: PROJECT_ID,
      conversationId: CONVERSATION_ID,
      draftId: DRAFT_ID,
    });

    expect(result?.id).toBe(DRAFT_ID);
    expect(mock.queryCalls).toEqual(
      expect.arrayContaining([
        ["ai_settlement_rule_drafts", "eq", ["id", DRAFT_ID]],
        [
          "ai_settlement_rule_drafts",
          "eq",
          ["organization_id", ORGANIZATION_ID],
        ],
        ["ai_settlement_rule_drafts", "eq", ["project_id", PROJECT_ID]],
        [
          "ai_settlement_rule_drafts",
          "eq",
          ["conversation_id", CONVERSATION_ID],
        ],
      ]),
    );
  });

  it.each([
    ["extra JSON", { ai_response: { ...validAiResponse(), extra: true } }],
    ["missing JSON", { generated_test_cases: undefined }],
    [
      "unsafe JSON",
      {
        safety_flags: [
          { code: "x", severity: "block", message: "x", raw_payload: {} },
        ],
      },
    ],
    [
      "ambiguity field types",
      {
        unresolved_ambiguities: [{ code: 7, question: 7, required: "true" }],
      },
    ],
    [
      "AI response field types",
      {
        ai_response: {
          content: 7,
          finishReason: "stop",
          providerRequestId: null,
        },
      },
    ],
    [
      "generated formula AST",
      {
        generated_formula: {
          expression: "grossRevenue",
          normalizedAst: { kind: "literal", value: Number.POSITIVE_INFINITY },
        },
      },
    ],
    [
      "clarifying row with formula state",
      {
        initial_status: "clarifying",
        status: "clarifying",
        unresolved_ambiguities:
          validClarifyingDraftInput().unresolvedAmbiguities,
      },
    ],
    [
      "ready row without formula state",
      {
        initial_status: "contract_ready",
        generated_formula: null,
        generated_explanation: null,
        generated_test_cases: [],
        formula_hash: null,
      },
    ],
    [
      "simulated row from a clarifying initial state",
      {
        initial_status: "clarifying",
        status: "simulated",
        unresolved_ambiguities:
          validClarifyingDraftInput().unresolvedAmbiguities,
        generated_formula: null,
        generated_explanation: null,
        generated_test_cases: [],
        formula_hash: null,
      },
    ],
    [
      "superseded row without superseding draft",
      {
        status: "superseded",
        superseded_by_draft_id: null,
        superseded_at: "2026-07-11T11:10:00.000Z",
      },
    ],
    [
      "superseded row without superseded timestamp",
      {
        status: "superseded",
        superseded_by_draft_id: DRAFT_2_ID,
        superseded_at: null,
      },
    ],
    [
      "active row with supersession metadata",
      {
        status: "contract_ready",
        superseded_by_draft_id: DRAFT_2_ID,
        superseded_at: "2026-07-11T11:10:00.000Z",
      },
    ],
  ])("fails closed on malformed draft rows: %s", async (_label, patch) => {
    const malformed = { ...draftRow(), ...patch };
    const mock = createPersistenceClient({ draftRows: [malformed] });
    const repository: CustomRuleRepository =
      new SupabaseCustomRuleReadRepository(mock.client);

    await expect(
      repository.listDrafts({
        organizationId: ORGANIZATION_ID,
        projectId: PROJECT_ID,
        conversationId: CONVERSATION_ID,
      }),
    ).rejects.toMatchObject({ code: "CUSTOM_RULE_PERSISTENCE_DATA_INVALID" });
  });

  it("inserts an immutable AI draft simulation through RPC only", async () => {
    const owner = { kind: "ai_draft" as const, id: DRAFT_ID };
    const row = simulationRow(owner, { duplicate: false });
    const mock = createPersistenceClient({ simulationRpcData: row });
    const repository: CustomRuleRepository =
      new SupabaseCustomRuleReadRepository(mock.client);
    const input = validSimulationInput(owner);

    const result = await repository.insertSimulation(input);

    expect(mock.rpc).toHaveBeenCalledWith(
      "create_settlement_formula_simulation",
      {
        p_organization_id: ORGANIZATION_ID,
        p_project_id: PROJECT_ID,
        p_rule_version_id: null,
        p_ai_draft_id: DRAFT_ID,
        p_idempotency_key: "simulation-request-1",
        p_formula_hash: HASH_C,
        p_rule_contract_hash: HASH_B,
        p_parameter_hash: HASH_D,
        p_variable_catalog_version: HASH_A,
        p_data_selection_hash: HASH_E,
        p_sample_source: input.sampleSource,
        p_sample_selection: input.sampleSelection,
        p_coverage: input.coverage,
        p_scenarios: input.scenarios,
        p_historical_totals: input.historicalTotals,
        p_deltas: input.deltas,
        p_largest_changes: input.largestChanges,
        p_warnings: input.warnings,
      },
    );
    expect(mock.from).not.toHaveBeenCalled();
    expect(result.owner).toEqual(owner);
    expect(result.historicalTotals.oldPayableAmountCents).toBe(
      "9007199254740993",
    );
    expect(typeof result.historicalTotals.oldPayableAmountCents).toBe("string");
  });

  it("persists optional settlement group population in simulation sample selection", async () => {
    const owner = { kind: "ai_draft" as const, id: DRAFT_ID };
    const row = simulationRow(owner, { duplicate: false });
    const mock = createPersistenceClient({ simulationRpcData: row });
    const repository: CustomRuleRepository =
      new SupabaseCustomRuleReadRepository(mock.client);
    const groupPopulation = {
      assignedProjectStreamerIds: [PROJECT_STREAMER_ID],
      unassignedProjectStreamerIds: [OTHER_PROJECT_STREAMER_ID],
      groupSnapshotHash: HASH_F,
    };
    const input = {
      ...validSimulationInput(owner),
      sampleSelection: {
        ...validSampleSelection(),
        groupPopulation,
      },
    };

    await repository.insertSimulation(input);

    expect(mock.rpc).toHaveBeenCalledWith(
      "create_settlement_formula_simulation",
      expect.objectContaining({
        p_sample_selection: expect.objectContaining({ groupPopulation }),
      }),
    );
  });

  it("writes and decodes a complete v2 summary without Number coercion", async () => {
    const owner = { kind: "ai_draft" as const, id: DRAFT_ID };
    const input = validV2SimulationInput(owner);
    const mock = createPersistenceClient({
      simulationRpcData: simulationRow(owner, {
        sample_selection: input.sampleSelection,
        coverage: input.coverage,
        scenarios: input.scenarios,
        historical_totals: input.historicalTotals,
        deltas: input.deltas,
        warnings: input.warnings,
        duplicate: false,
      }),
    });
    const repository: CustomRuleRepository =
      new SupabaseCustomRuleReadRepository(mock.client);

    const result = await repository.insertSimulation(input as never);

    expect(result).toMatchObject({
      summarySchemaVersion: 2,
      summaryComplete: true,
      summaryStatus: "complete",
      coverage: input.coverage,
      scenarios: input.scenarios,
      historicalTotals: input.historicalTotals,
      deltas: input.deltas,
      warnings: input.warnings,
    });
    expect(result.historicalTotals.oldPayableAmountCents).toBe(
      "9007199254740993",
    );
    expect(typeof result.historicalTotals.oldPayableAmountCents).toBe("string");
    expect(mock.rpc).toHaveBeenCalledWith(
      "create_settlement_formula_simulation",
      expect.objectContaining({
        p_coverage: input.coverage,
        p_scenarios: input.scenarios,
        p_historical_totals: input.historicalTotals,
        p_deltas: input.deltas,
        p_warnings: input.warnings,
      }),
    );
    expectTypeOf(result).toEqualTypeOf<
      CompleteSettlementFormulaSimulation & { duplicate: boolean }
    >();
  });

  it("writes typed-output v2 summaries without payable or receivable totals", async () => {
    const owner = { kind: "ai_draft" as const, id: DRAFT_ID };
    const input = typedOutputV2SimulationInput(owner, "cost_items");
    const mock = createPersistenceClient({
      simulationRpcData: simulationRow(owner, {
        sample_selection: input.sampleSelection,
        coverage: input.coverage,
        scenarios: input.scenarios,
        historical_totals: input.historicalTotals,
        deltas: input.deltas,
        largest_changes: input.largestChanges,
        warnings: input.warnings,
        duplicate: false,
      }),
    });
    const repository: CustomRuleRepository =
      new SupabaseCustomRuleReadRepository(mock.client);

    const result = await repository.insertSimulation(input);

    expect(result).toMatchObject({
      summarySchemaVersion: 2,
      summaryComplete: true,
      historicalTotals: input.historicalTotals,
      deltas: input.deltas,
      scenarios: input.scenarios,
    });
    expect(mock.rpc).toHaveBeenCalledWith(
      "create_settlement_formula_simulation",
      expect.objectContaining({
        p_historical_totals: input.historicalTotals,
        p_deltas: input.deltas,
        p_scenarios: input.scenarios,
      }),
    );
  });

  it("rejects money-output v2 summaries with no active money total", async () => {
    const mock = createPersistenceClient();
    const repository: CustomRuleRepository =
      new SupabaseCustomRuleReadRepository(mock.client);
    const input = typedOutputV2SimulationInput({
      kind: "ai_draft",
      id: DRAFT_ID,
    });

    await expect(repository.insertSimulation(input)).rejects.toThrow(
      customRuleRepositoryModule.CustomRulePersistenceInputError,
    );
    expect(mock.rpc).not.toHaveBeenCalled();
  });

  it.each(["cost_items", "checks"] as const)(
    "accepts %s typed-output v2 summaries with explicit output kind",
    async (outputKind) => {
      const owner = { kind: "ai_draft" as const, id: DRAFT_ID };
      const input = typedOutputV2SimulationInput(owner, outputKind);
      const mock = createPersistenceClient({
        simulationRpcData: simulationRow(owner, {
          sample_selection: input.sampleSelection,
          coverage: input.coverage,
          scenarios: input.scenarios,
          historical_totals: input.historicalTotals,
          deltas: input.deltas,
          largest_changes: input.largestChanges,
          warnings: input.warnings,
          duplicate: false,
        }),
      });
      const repository: CustomRuleRepository =
        new SupabaseCustomRuleReadRepository(mock.client);

      const result = await repository.insertSimulation(input);

      expect(result.coverage).toMatchObject({ outputKind });
      expect(mock.rpc).toHaveBeenCalledWith(
        "create_settlement_formula_simulation",
        expect.objectContaining({
          p_coverage: expect.objectContaining({ outputKind }),
        }),
      );
    },
  );

  it("narrows persisted simulations by their required summary discriminator", () => {
    const assertNarrowed = (simulation: SettlementFormulaSimulation) => {
      if (simulation.summarySchemaVersion === 2 && simulation.summaryComplete) {
        expectTypeOf(
          simulation,
        ).toEqualTypeOf<CompleteSettlementFormulaSimulation>();
        expect(simulation.historicalTotals.verificationStatus).not.toBe(
          "legacy_unknown",
        );
        return;
      }

      expectTypeOf(
        simulation,
      ).toEqualTypeOf<LegacySettlementFormulaSimulation>();
      expect(simulation.historicalTotals.newPayableAmountCents).toBeNull();
    };

    expect(assertNarrowed).toBeTypeOf("function");
  });

  it.each([
    [
      "negative historical total",
      {
        historicalTotals: {
          ...validHistoricalTotals(),
          oldPayableAmountCents: "-100",
          newPayableAmountCents: "50",
        },
        deltas: {
          payableAmountCents: "150",
          receivableAmountCents: null,
          percentageBps: 15_000,
          marginImpactCents: "-150",
        },
      },
    ],
    [
      "negative final total",
      {
        historicalTotals: {
          ...validHistoricalTotals(),
          oldPayableAmountCents: "100",
          newPayableAmountCents: "-50",
        },
        deltas: {
          payableAmountCents: "-150",
          receivableAmountCents: null,
          percentageBps: -15_000,
          marginImpactCents: "150",
        },
      },
    ],
    [
      "negative scenario actual and expected amounts",
      {
        scenarios: [
          {
            id: "contract:negative",
            category: "contract_example" as const,
            outcome: "calculated" as const,
            amountCents: "-1",
            expectedAmountCents: "-1",
            passed: true,
          },
        ],
      },
    ],
  ])("rejects v2 %s before RPC", async (_label, patch) => {
    const mock = createPersistenceClient();
    const repository: CustomRuleRepository =
      new SupabaseCustomRuleReadRepository(mock.client);

    await expect(
      repository.insertSimulation({
        ...validSimulationInput({ kind: "ai_draft", id: DRAFT_ID }),
        ...patch,
      }),
    ).rejects.toMatchObject({ code: "CUSTOM_RULE_PERSISTENCE_INPUT_INVALID" });
    expect(mock.rpc).not.toHaveBeenCalled();
  });

  it("requires every skipped v2 record to be review-routed or blocked", async () => {
    const mock = createPersistenceClient();
    const repository: CustomRuleRepository =
      new SupabaseCustomRuleReadRepository(mock.client);
    const input = validSimulationInput({ kind: "ai_draft", id: DRAFT_ID });

    await expect(
      repository.insertSimulation({
        ...input,
        coverage: {
          ...input.coverage,
          reviewRoutedRecords: 0,
        },
      }),
    ).rejects.toMatchObject({ code: "CUSTOM_RULE_PERSISTENCE_INPUT_INVALID" });
    expect(mock.rpc).not.toHaveBeenCalled();
  });

  it("rejects Phase 1 rule-version simulation writes before RPC", async () => {
    const mock = createPersistenceClient();
    const repository: CustomRuleRepository =
      new SupabaseCustomRuleReadRepository(mock.client);

    await expect(
      repository.insertSimulation(
        validSimulationInput({ kind: "rule_version", id: RULE_VERSION_ID }),
      ),
    ).rejects.toMatchObject({ code: "CUSTOM_RULE_PERSISTENCE_INPUT_INVALID" });
    expect(mock.rpc).not.toHaveBeenCalled();
    expect(mock.from).not.toHaveBeenCalled();
  });

  it("reads simulations through scope and owner predicates in immutable recency order", async () => {
    const owner = { kind: "ai_draft" as const, id: DRAFT_ID };
    const mock = createPersistenceClient({
      simulationRows: [simulationRow(owner)],
    });
    const repository: CustomRuleRepository =
      new SupabaseCustomRuleReadRepository(mock.client);

    const listed = await repository.listSimulations({
      organizationId: ORGANIZATION_ID,
      projectId: PROJECT_ID,
      owner,
    });
    const found = await repository.getSimulation({
      organizationId: ORGANIZATION_ID,
      projectId: PROJECT_ID,
      simulationId: SIMULATION_ID,
      owner,
    });

    expect(listed).toHaveLength(1);
    expect(found?.owner).toEqual(owner);
    expect(mock.queryCalls).toEqual(
      expect.arrayContaining([
        [
          "settlement_formula_simulations",
          "eq",
          ["organization_id", ORGANIZATION_ID],
        ],
        ["settlement_formula_simulations", "eq", ["project_id", PROJECT_ID]],
        ["settlement_formula_simulations", "eq", ["ai_draft_id", DRAFT_ID]],
        [
          "settlement_formula_simulations",
          "order",
          ["created_at", { ascending: false }],
        ],
        [
          "settlement_formula_simulations",
          "order",
          ["id", { ascending: false }],
        ],
        ["settlement_formula_simulations", "eq", ["id", SIMULATION_ID]],
      ]),
    );
  });

  it("decodes v1 rows as incomplete legacy summaries and preserves unknown deltas", async () => {
    const owner = { kind: "ai_draft" as const, id: DRAFT_ID };
    const mock = createPersistenceClient({
      simulationRows: [
        legacySimulationRow(owner, {
          historical_totals: {
            payableAmountCents: null,
            receivableAmountCents: null,
            recordCount: 0,
          },
          deltas: {
            payableAmountCents: "0",
            receivableAmountCents: "0",
            percentageBps: 0,
          },
        }),
      ],
    });
    const repository: CustomRuleRepository =
      new SupabaseCustomRuleReadRepository(mock.client);

    const [legacy] = await repository.listSimulations({
      organizationId: ORGANIZATION_ID,
      projectId: PROJECT_ID,
      owner,
    });

    expect(legacy).toMatchObject({
      summarySchemaVersion: 1,
      summaryComplete: false,
      summaryStatus: "legacy",
      historicalTotals: {
        oldPayableAmountCents: null,
        oldReceivableAmountCents: null,
        newPayableAmountCents: null,
        newReceivableAmountCents: null,
        recordCount: 0,
        verificationStatus: "legacy_unknown",
      },
      deltas: {
        payableAmountCents: null,
        receivableAmountCents: null,
        percentageBps: null,
        marginImpactCents: null,
      },
    });
  });

  it("retains future rule-version simulation read compatibility", async () => {
    const owner = { kind: "rule_version" as const, id: RULE_VERSION_ID };
    const mock = createPersistenceClient({
      simulationRows: [simulationRow(owner)],
    });
    const repository: CustomRuleRepository =
      new SupabaseCustomRuleReadRepository(mock.client);

    const rows = await repository.listSimulations({
      organizationId: ORGANIZATION_ID,
      projectId: PROJECT_ID,
      owner,
    });

    expect(rows[0]?.owner).toEqual(owner);
    expect(mock.queryCalls).toEqual(
      expect.arrayContaining([
        [
          "settlement_formula_simulations",
          "eq",
          ["rule_version_id", RULE_VERSION_ID],
        ],
      ]),
    );
  });

  it("persists cloned rules through the reuse-draft RPC without copying simulation state", async () => {
    const source = customRuleVersionFromLifecycleRow();
    const clone = cloneRuleVersionToEditableDraft({
      sourceVersion: source,
      targetProjectId: OTHER_PROJECT_ID,
      targetCatalog: {
        version: HASH_F,
        variables: [{ id: "grossRevenue", availability: "available" }],
      },
      newVersionId: RULE_VERSION_2_ID,
      reason: "Clone to another project.",
    });
    const mock = createPersistenceClient({
      reuseDraftRpcData: lifecycleResultRow({
        version: {
          id: RULE_VERSION_2_ID,
          project_id: OTHER_PROJECT_ID,
          version_number: 1,
          status: "draft",
          simulation_summary: {},
          variable_catalog_version: HASH_F,
          data_selection_hash: "0".repeat(64),
          simulation_id: null,
          effective_from: null,
          approved_by: null,
          ai_draft_id: null,
          approved_at: null,
        },
        simulation: null,
        event: null,
      }),
    });
    const repository: CustomRuleRepository =
      new SupabaseCustomRuleReadRepository(mock.client);

    const result = await repository.cloneCustomRuleToDraft({
      organizationId: ORGANIZATION_ID,
      sourceProjectId: PROJECT_ID,
      targetProjectId: OTHER_PROJECT_ID,
      sourceRuleVersionId: RULE_VERSION_ID,
      targetVariableCatalogVersion: HASH_F,
      targetAvailableVariableIds: ["grossRevenue"],
      newVersionId: RULE_VERSION_2_ID,
      clone,
      reason: "Clone to another project.",
      clientRequestId: "clone-rpc-1",
    });

    expect(mock.rpc).toHaveBeenCalledWith("clone_custom_settlement_rule_to_draft", {
      p_organization_id: ORGANIZATION_ID,
      p_source_project_id: PROJECT_ID,
      p_target_project_id: OTHER_PROJECT_ID,
      p_source_rule_version_id: RULE_VERSION_ID,
      p_rule_version_id: RULE_VERSION_2_ID,
      p_clone: clone,
      p_reason: "Clone to another project.",
      p_client_request_id: "clone-rpc-1",
    });
    expect(result.version).toMatchObject({
      id: RULE_VERSION_2_ID,
      projectId: OTHER_PROJECT_ID,
      status: "draft",
      simulationId: null,
      aiDraftId: null,
      approvedBy: null,
      effectiveFrom: null,
    });
  });

  it("rejects forged clone payload executable state before RPC", async () => {
    const source = customRuleVersionFromLifecycleRow();
    const clone = cloneRuleVersionToEditableDraft({
      sourceVersion: source,
      targetProjectId: OTHER_PROJECT_ID,
      targetCatalog: {
        version: HASH_F,
        variables: [{ id: "grossRevenue", availability: "available" }],
      },
      newVersionId: RULE_VERSION_2_ID,
      reason: "Clone to another project.",
    });
    const mock = createPersistenceClient();
    const repository: CustomRuleRepository =
      new SupabaseCustomRuleReadRepository(mock.client);

    await expect(
      repository.cloneCustomRuleToDraft({
        organizationId: ORGANIZATION_ID,
        sourceProjectId: PROJECT_ID,
        targetProjectId: OTHER_PROJECT_ID,
        sourceRuleVersionId: RULE_VERSION_ID,
        targetVariableCatalogVersion: HASH_F,
        targetAvailableVariableIds: ["grossRevenue"],
        newVersionId: RULE_VERSION_2_ID,
        clone: {
          ...clone,
          version: {
            ...clone.version,
            status: "active",
            simulationId: SIMULATION_ID,
            approvedBy: CREATOR_ID,
          },
        },
        reason: "Clone to another project.",
        clientRequestId: "clone-rpc-forged-state",
      } as never),
    ).rejects.toMatchObject({ code: "CUSTOM_RULE_PERSISTENCE_INPUT_INVALID" });
    expect(mock.rpc).not.toHaveBeenCalled();
  });

  it("rejects forged clone payload non-project target before RPC", async () => {
    const source = customRuleVersionFromLifecycleRow();
    const clone = cloneRuleVersionToEditableDraft({
      sourceVersion: source,
      targetProjectId: OTHER_PROJECT_ID,
      targetCatalog: {
        version: HASH_F,
        variables: [{ id: "grossRevenue", availability: "available" }],
      },
      newVersionId: RULE_VERSION_2_ID,
      reason: "Clone to another project.",
    });
    const mock = createPersistenceClient();
    const repository: CustomRuleRepository =
      new SupabaseCustomRuleReadRepository(mock.client);

    await expect(
      repository.cloneCustomRuleToDraft({
        organizationId: ORGANIZATION_ID,
        sourceProjectId: PROJECT_ID,
        targetProjectId: OTHER_PROJECT_ID,
        sourceRuleVersionId: RULE_VERSION_ID,
        targetVariableCatalogVersion: HASH_F,
        targetAvailableVariableIds: ["grossRevenue"],
        newVersionId: RULE_VERSION_2_ID,
        clone: {
          ...clone,
          version: {
            ...clone.version,
            target: {
              targetType: "streamer_group",
              targetId: GROUP_ID,
            },
          },
        },
        reason: "Clone to another project.",
        clientRequestId: "clone-rpc-forged-target",
      } as never),
    ).rejects.toMatchObject({ code: "CUSTOM_RULE_PERSISTENCE_INPUT_INVALID" });
    expect(mock.rpc).not.toHaveBeenCalled();
  });

  it("persists parameter edits through a draft RPC and stales the prior simulation", async () => {
    const source = customRuleVersionFromLifecycleRow();
    const draft: EditableReusableRuleDraft = {
      ...source,
      id: RULE_VERSION_2_ID,
      versionNumber: source.versionNumber + 1,
      status: "draft" as const,
      parameters: { minimumAmount: { type: "money_cents" as const, amountCents: 12_500 } },
      parameterDefinitions: [
        {
          key: "minimumAmount",
          labelZh: "Minimum amount",
          type: "money_cents" as const,
          value: 12_500,
          min: 0,
        },
      ],
      parameterHash: HASH_F,
      simulationSummary: {},
      dataSelectionHash: "0".repeat(64),
      simulationId: null,
      effectiveFrom: null,
      effectiveUntil: null,
      approvedBy: null,
      approvedAt: null,
      archivedAt: null,
      aiDraftId: null,
    };
    const mock = createPersistenceClient({
      reuseDraftRpcData: lifecycleResultRow({
        version: {
          id: RULE_VERSION_2_ID,
          version_number: 3,
          status: "draft",
          parameters: draft.parameters,
          parameter_hash: HASH_F,
          simulation_summary: {},
          data_selection_hash: "0".repeat(64),
          simulation_id: null,
          effective_from: null,
          approved_by: null,
          ai_draft_id: null,
          approved_at: null,
        },
        simulation: null,
        event: null,
      }),
    });
    const repository: CustomRuleRepository =
      new SupabaseCustomRuleReadRepository(mock.client);

    const result = await repository.createCustomRuleParameterDraft({
      organizationId: ORGANIZATION_ID,
      projectId: PROJECT_ID,
      sourceRuleVersionId: RULE_VERSION_ID,
      newVersionId: RULE_VERSION_2_ID,
      edits: [{ key: "minimumAmount", type: "money_cents", value: 12_500 }],
      draft,
      reason: "Adjust minimum amount.",
      clientRequestId: "parameter-draft-rpc-1",
    });

    expect(mock.rpc).toHaveBeenCalledWith(
      "create_custom_settlement_rule_parameter_draft",
      {
        p_organization_id: ORGANIZATION_ID,
        p_project_id: PROJECT_ID,
        p_source_rule_version_id: RULE_VERSION_ID,
        p_rule_version_id: RULE_VERSION_2_ID,
        p_edits: [{ key: "minimumAmount", type: "money_cents", value: 12_500 }],
        p_draft: draft,
        p_reason: "Adjust minimum amount.",
        p_client_request_id: "parameter-draft-rpc-1",
      },
    );
    expect(result).toMatchObject({
      id: RULE_VERSION_2_ID,
      status: "draft",
      simulationId: null,
      parameterHash: HASH_F,
    });
  });

  it("rejects forged parameter draft executable state before RPC", async () => {
    const source = customRuleVersionFromLifecycleRow();
    const draft = {
      ...source,
      id: RULE_VERSION_2_ID,
      versionNumber: source.versionNumber + 1,
      status: "active",
      parameterHash: HASH_F,
      simulationSummary: {},
      dataSelectionHash: "0".repeat(64),
      simulationId: SIMULATION_ID,
      effectiveFrom: null,
      effectiveUntil: null,
      approvedBy: null,
      approvedAt: null,
      archivedAt: null,
      aiDraftId: null,
    };
    const mock = createPersistenceClient();
    const repository: CustomRuleRepository =
      new SupabaseCustomRuleReadRepository(mock.client);

    await expect(
      repository.createCustomRuleParameterDraft({
        organizationId: ORGANIZATION_ID,
        projectId: PROJECT_ID,
        sourceRuleVersionId: RULE_VERSION_ID,
        newVersionId: RULE_VERSION_2_ID,
        edits: [{ key: "minimumAmount", type: "money_cents", value: 12_500 }],
        draft,
        reason: "Attempt to preserve executable state through parameter edit.",
        clientRequestId: "parameter-draft-forged-state",
      } as never),
    ).rejects.toMatchObject({ code: "CUSTOM_RULE_PERSISTENCE_INPUT_INVALID" });
    expect(mock.rpc).not.toHaveBeenCalled();
  });

  it("persists organization templates and archives only the requested template row", async () => {
    const template = organizationTemplateRow();
    const mock = createPersistenceClient({
      organizationTemplateRpcData: template,
      organizationTemplateRows: [template],
    });
    const repository: CustomRuleRepository =
      new SupabaseCustomRuleReadRepository(mock.client);

    const saved = await repository.saveOrganizationRuleTemplate({
      organizationId: ORGANIZATION_ID,
      projectId: PROJECT_ID,
      sourceRuleVersionId: RULE_VERSION_ID,
      name: "Reusable receivable rule",
      description: "Use across projects.",
      confirmedContractHash: HASH_B,
      reason: "Save reusable template.",
      clientRequestId: "org-template-save-1",
    });
    const loaded = await repository.getOrganizationRuleTemplate({
      organizationId: ORGANIZATION_ID,
      templateId: TEMPLATE_ID,
    });
    await repository.archiveOrganizationRuleTemplate({
      organizationId: ORGANIZATION_ID,
      projectId: PROJECT_ID,
      templateId: TEMPLATE_ID,
      archivedAt: "2026-09-01T00:00:00.000Z",
      reason: "Archive requested template.",
      clientRequestId: "org-template-archive-1",
    });

    expect(saved).toMatchObject({ id: TEMPLATE_ID, organizationId: ORGANIZATION_ID });
    expect(loaded).toMatchObject({ id: TEMPLATE_ID, organizationId: ORGANIZATION_ID });
    expect(mock.rpc).toHaveBeenCalledWith("save_organization_settlement_rule_template", {
      p_organization_id: ORGANIZATION_ID,
      p_project_id: PROJECT_ID,
      p_source_rule_version_id: RULE_VERSION_ID,
      p_name: "Reusable receivable rule",
      p_description: "Use across projects.",
      p_confirmed_contract_hash: HASH_B,
      p_reason: "Save reusable template.",
      p_client_request_id: "org-template-save-1",
    });
    expect(mock.rpc).toHaveBeenCalledWith("archive_organization_settlement_rule_template", {
      p_organization_id: ORGANIZATION_ID,
      p_project_id: PROJECT_ID,
      p_template_id: TEMPLATE_ID,
      p_archived_at: "2026-09-01T00:00:00.000Z",
      p_reason: "Archive requested template.",
      p_client_request_id: "org-template-archive-1",
    });
    expect(mock.queryCalls).toContainEqual([
      "settlement_rule_templates",
      "eq",
      ["id", TEMPLATE_ID],
    ]);
  });

  it.each([
    ["missing owner", {}],
    [
      "mixed owner",
      { kind: "ai_draft", id: DRAFT_ID, ruleVersionId: RULE_VERSION_ID },
    ],
    ["unknown owner", { kind: "conversation", id: CONVERSATION_ID }],
  ])("rejects %s before issuing a simulation query", async (_label, owner) => {
    const mock = createPersistenceClient();
    const repository: CustomRuleRepository =
      new SupabaseCustomRuleReadRepository(mock.client);

    await expect(
      repository.insertSimulation({
        ...validSimulationInput({ kind: "ai_draft", id: DRAFT_ID }),
        owner,
      } as never),
    ).rejects.toMatchObject({ code: "CUSTOM_RULE_PERSISTENCE_INPUT_INVALID" });
    expect(mock.rpc).not.toHaveBeenCalled();
    expect(mock.from).not.toHaveBeenCalled();
  });

  it.each([
    [
      "raw sample rows",
      {
        sampleSelection: {
          ...validSampleSelection(),
          rawRows: [{ report_id: "report-1" }],
        },
      },
    ],
    [
      "payload-like data",
      {
        sampleSource: {
          kind: "historical_settlements",
          source_payload: { secret: true },
        },
      },
    ],
    [
      "cross-project identifiers",
      {
        sampleSelection: {
          ...validSampleSelection(),
          projectId: OTHER_PROJECT_ID,
        },
      },
    ],
    [
      "streamer private amounts",
      {
        largestChanges: [
          {
            dimension: "streamer",
            key: "streamer-private-1",
            deltaAmountCents: "100",
            direction: "increase",
          },
        ],
      },
    ],
    [
      "criteria project id",
      {
        sampleSelection: {
          ...validSampleSelection(),
          criteria: ["project_id=project-2"],
        },
      },
    ],
    [
      "criteria report id",
      {
        sampleSelection: {
          ...validSampleSelection(),
          criteria: ["reportId=report-2"],
        },
      },
    ],
    [
      "criteria amount cents",
      {
        sampleSelection: {
          ...validSampleSelection(),
          criteria: ["amountCents=100"],
        },
      },
    ],
    [
      "one-megabyte whitespace warning",
      {
        warnings: [
          {
            code: "large_warning",
            severity: "warning",
            message: `${" ".repeat(1024 * 1024)}x`,
          },
        ],
      },
    ],
  ])("rejects unsafe simulation summary input: %s", async (_label, patch) => {
    const mock = createPersistenceClient();
    const repository: CustomRuleRepository =
      new SupabaseCustomRuleReadRepository(mock.client);

    await expect(
      repository.insertSimulation({
        ...validSimulationInput({ kind: "ai_draft", id: DRAFT_ID }),
        ...patch,
      } as never),
    ).rejects.toMatchObject({ code: "CUSTOM_RULE_PERSISTENCE_INPUT_INVALID" });
    expect(mock.rpc).not.toHaveBeenCalled();
    expect(mock.from).not.toHaveBeenCalled();
  });

  it.each([
    "project_id",
    "reportId",
    "amountCents",
    "streamer",
    "streamerAmount",
    "tax",
    "raw payload",
  ])(
    "rejects forbidden largest-change key value %s before RPC",
    async (key) => {
      const mock = createPersistenceClient();
      const repository: CustomRuleRepository =
        new SupabaseCustomRuleReadRepository(mock.client);

      await expect(
        repository.insertSimulation({
          ...validSimulationInput({ kind: "ai_draft", id: DRAFT_ID }),
          largestChanges: [
            {
              dimension: "rule_component",
              key,
              deltaAmountCents: "100",
              direction: "increase",
            },
          ],
        }),
      ).rejects.toMatchObject({
        code: "CUSTOM_RULE_PERSISTENCE_INPUT_INVALID",
      });
      expect(mock.rpc).not.toHaveBeenCalled();
    },
  );

  it("rejects the reviewer 16-warning fixture before RPC", async () => {
    const mock = createPersistenceClient();
    const repository: CustomRuleRepository =
      new SupabaseCustomRuleReadRepository(mock.client);

    await expect(
      repository.insertSimulation({
        ...validSimulationInput({ kind: "ai_draft", id: DRAFT_ID }),
        warnings: Array.from({ length: 16 }, (_, index) => ({
          kind: "warning" as const,
          code: `warning_${index}`,
          severity: "warning" as const,
          message: "x".repeat(4_000),
        })),
      }),
    ).rejects.toMatchObject({
      code: "CUSTOM_RULE_PERSISTENCE_INPUT_INVALID",
      message: expect.stringContaining(
        "conservative 61440-byte JSON input subcontainer budget",
      ),
    });
    expect(mock.rpc).not.toHaveBeenCalled();
  });

  it("allows a warning subcontainer clearly below the conservative limit", async () => {
    const warnings = Array.from({ length: 8 }, (_, index) => ({
      kind: "warning" as const,
      code: `warning_${index}`,
      severity: "warning" as const,
      message: "x".repeat(4_000),
    }));
    const mock = createPersistenceClient();
    const repository: CustomRuleRepository =
      new SupabaseCustomRuleReadRepository(mock.client);

    await repository.insertSimulation({
      ...validSimulationInput({ kind: "ai_draft", id: DRAFT_ID }),
      warnings,
    });

    expect(mock.rpc).toHaveBeenCalledWith(
      "create_settlement_formula_simulation",
      expect.objectContaining({ p_warnings: warnings }),
    );
  });

  it("rejects over-depth and over-node JSON iteratively before RPC", async () => {
    const deepValue: Record<string, unknown> = {};
    let cursor = deepValue;
    for (let depth = 0; depth < 21; depth += 1) {
      const child: Record<string, unknown> = {};
      cursor.child = child;
      cursor = child;
    }
    const excessiveScenarios = Array.from({ length: 80 }, (_, index) => ({
      name: `场景${index}`,
      kind: "normal" as const,
      result: "passed" as const,
    }));

    for (const patch of [
      { warnings: [{ code: "deep", severity: "warning", message: deepValue }] },
      { scenarios: excessiveScenarios },
    ]) {
      const mock = createPersistenceClient();
      const repository: CustomRuleRepository =
        new SupabaseCustomRuleReadRepository(mock.client);
      await expect(
        repository.insertSimulation({
          ...validSimulationInput({ kind: "ai_draft", id: DRAFT_ID }),
          ...patch,
        } as never),
      ).rejects.toMatchObject({
        code: "CUSTOM_RULE_PERSISTENCE_INPUT_INVALID",
      });
      expect(mock.rpc).not.toHaveBeenCalled();
    }
  });

  it("fails closed on Proxy descriptor traps before RPC", async () => {
    const trapped = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error("proxy ownKeys trap");
        },
      },
    );
    const mock = createPersistenceClient();
    const repository: CustomRuleRepository =
      new SupabaseCustomRuleReadRepository(mock.client);

    await expect(
      repository.insertSimulation({
        ...validSimulationInput({ kind: "ai_draft", id: DRAFT_ID }),
        warnings: [trapped],
      } as never),
    ).rejects.toMatchObject({ code: "CUSTOM_RULE_PERSISTENCE_INPUT_INVALID" });
    expect(mock.rpc).not.toHaveBeenCalled();
  });

  it.each([
    [
      "unsafe numeric total",
      {
        historical_totals: {
          ...validHistoricalTotals(),
          oldPayableAmountCents: 9_007_199_254_740_992,
        },
      },
    ],
    ["extra payload", { raw_payload: { rows: [] } }],
    [
      "invalid owner pair",
      { rule_version_id: RULE_VERSION_ID, ai_draft_id: DRAFT_ID },
    ],
  ])("fails closed on malformed simulation rows: %s", async (_label, patch) => {
    const malformed = {
      ...simulationRow({ kind: "ai_draft", id: DRAFT_ID }),
      ...patch,
    };
    const mock = createPersistenceClient({ simulationRows: [malformed] });
    const repository: CustomRuleRepository =
      new SupabaseCustomRuleReadRepository(mock.client);

    await expect(
      repository.listSimulations({
        organizationId: ORGANIZATION_ID,
        projectId: PROJECT_ID,
        owner: { kind: "ai_draft", id: DRAFT_ID },
      }),
    ).rejects.toMatchObject({ code: "CUSTOM_RULE_PERSISTENCE_DATA_INVALID" });
  });
});

const TABLES = [
  "live_reports",
  "project_streamers",
  "project_cost_items",
  "settlement_batches",
  "settlement_batch_items",
] as const;
type TableName = (typeof TABLES)[number];
type QueryCall = [
  (
    | "select"
    | "eq"
    | "in"
    | "gt"
    | "gte"
    | "lt"
    | "lte"
    | "or"
    | "not"
    | "order"
    | "range"
    | "limit"
    | "returns"
  ),
  unknown[],
];
type MockResult = {
  data: unknown[] | null;
  count: number | null;
  error: Error | null;
  pages?: Record<number, MockPageOverride>;
  highWater?: MockPageOverride;
  afterHighWater?: (result: MockResult) => void;
};
type MockPageOverride = {
  data?: unknown[] | null;
  count?: number | null;
  error?: Error | null;
};
type MockResults = Record<TableName, MockResult>;
type MockQuery = {
  select(columns: string, options: { count: "exact" }): MockQuery;
  eq(column: string, value: unknown): MockQuery;
  in(column: string, values: readonly unknown[]): MockQuery;
  gt(column: string, value: string): MockQuery;
  gte(column: string, value: string): MockQuery;
  lt(column: string, value: string): MockQuery;
  lte(column: string, value: string): MockQuery;
  or(filter: string): MockQuery;
  not(column: string, operator: string, value: unknown): MockQuery;
  order(column: string, options: { ascending: boolean }): MockQuery;
  range(from: number, to: number): MockQuery;
  limit(count: number): MockQuery;
  returns(): Promise<MockResult>;
};

function createClient(results: MockResults = defaultResults()) {
  const calls = Object.fromEntries(
    TABLES.map((table) => [table, [] as QueryCall[]]),
  ) as Record<TableName, QueryCall[]>;
  const queries = Object.fromEntries(
    TABLES.map((table) => [table, [] as QueryCall[][]]),
  ) as Record<TableName, QueryCall[][]>;
  const state = {
    pageReads: Object.fromEntries(TABLES.map((table) => [table, 0])) as Record<
      TableName,
      number
    >,
    highWaterReads: Object.fromEntries(
      TABLES.map((table) => [table, 0]),
    ) as Record<TableName, number>,
  };
  const from = vi.fn((table: TableName) => {
    const queryCalls: QueryCall[] = [];
    queries[table].push(queryCalls);
    return createQuery(table, calls, queryCalls, results, state);
  });

  return {
    client: { from } as unknown as SupabaseClient,
    calls,
    queries,
    from,
  };
}

function createQuery(
  table: TableName,
  calls: Record<TableName, QueryCall[]>,
  queryCalls: QueryCall[],
  results: MockResults,
  state: {
    pageReads: Record<TableName, number>;
    highWaterReads: Record<TableName, number>;
  },
): MockQuery {
  let selectedRange: { from: number; to: number } | null = null;
  let selectedOrder: { column: string; ascending: boolean } | null = null;
  let selectedColumns = "";
  let selectedLimit: number | null = null;
  let idGreaterThan: string | null = null;
  let idLessThanOrEqual: string | null = null;
  let settlementBatchIds: readonly unknown[] | null = null;
  const record = (method: QueryCall[0], args: unknown[]): MockQuery => {
    const call: QueryCall = [method, args];
    calls[table].push(call);
    queryCalls.push(call);
    return query;
  };
  const query: MockQuery = {
    select: (columns, options) => {
      selectedColumns = columns;
      return record("select", [columns, options]);
    },
    eq: (column, value) => record("eq", [column, value]),
    in: (column, values) => {
      if (column === "settlement_batch_id") {
        settlementBatchIds = values;
      }
      return record("in", [column, values]);
    },
    gt: (column, value) => {
      if (column === "id") {
        idGreaterThan = value;
      }
      return record("gt", [column, value]);
    },
    gte: (column, value) => record("gte", [column, value]),
    lt: (column, value) => record("lt", [column, value]),
    lte: (column, value) => {
      if (column === "id") {
        idLessThanOrEqual = value;
      }
      return record("lte", [column, value]);
    },
    or: (filter) => record("or", [filter]),
    not: (column, operator, value) => record("not", [column, operator, value]),
    order: (column, options) => {
      selectedOrder = { column, ascending: options.ascending };
      return record("order", [column, options]);
    },
    range: (from, to) => {
      selectedRange = { from, to };
      return record("range", [from, to]);
    },
    limit: (count) => {
      selectedLimit = count;
      return record("limit", [count]);
    },
    returns: async () => {
      const returnsCall: QueryCall = ["returns", []];
      calls[table].push(returnsCall);
      queryCalls.push(returnsCall);
      const base = results[table];
      const isHighWater =
        selectedColumns === "id" &&
        selectedOrder?.ascending === false &&
        selectedLimit === 1;
      const pageIndex = isHighWater ? null : state.pageReads[table]++;
      const override = isHighWater
        ? base.highWater
        : pageIndex === null
          ? undefined
          : base.pages?.[pageIndex];
      const filteredData = filterRows(base.data, {
        idGreaterThan,
        idLessThanOrEqual,
        settlementBatchIds,
      });
      const hasCardinalityFilter =
        idGreaterThan !== null ||
        idLessThanOrEqual !== null ||
        settlementBatchIds !== null;
      const filteredCount =
        hasCardinalityFilter && filteredData ? filteredData.length : base.count;
      const orderedData = selectedOrder
        ? orderRows(filteredData, selectedOrder)
        : filteredData;
      const boundedData =
        selectedRange && orderedData
          ? orderedData.slice(selectedRange.from, selectedRange.to + 1)
          : selectedLimit !== null && orderedData
            ? orderedData.slice(0, selectedLimit)
            : orderedData;
      const unsafeData = hasOwn(override, "data")
        ? (override?.data ?? null)
        : boundedData;
      const data =
        selectedColumns === "id" && unsafeData
          ? unsafeData.map((row) => ({ id: rowOrderValue(row, "id") }))
          : unsafeData;
      const result = {
        data,
        count: hasOwn(override, "count")
          ? (override?.count ?? null)
          : filteredCount,
        error: hasOwn(override, "error")
          ? (override?.error ?? null)
          : base.error,
      };
      if (isHighWater) {
        state.highWaterReads[table] += 1;
        base.afterHighWater?.(base);
      }
      return result;
    },
  };
  return query;
}

function filterRows(
  rows: unknown[] | null,
  filters: {
    idGreaterThan: string | null;
    idLessThanOrEqual: string | null;
    settlementBatchIds: readonly unknown[] | null;
  },
): unknown[] | null {
  if (!rows) {
    return rows;
  }
  return rows.filter((row) => {
    const id = rowOrderValue(row, "id");
    if (filters.idGreaterThan && id.localeCompare(filters.idGreaterThan) <= 0) {
      return false;
    }
    if (
      filters.idLessThanOrEqual &&
      id.localeCompare(filters.idLessThanOrEqual) > 0
    ) {
      return false;
    }
    if (filters.settlementBatchIds) {
      const batchId = rowOrderValue(row, "settlement_batch_id");
      return filters.settlementBatchIds.includes(batchId);
    }
    return true;
  });
}

function hasOwn(value: object | null | undefined, key: PropertyKey): boolean {
  return value !== null && value !== undefined && Object.hasOwn(value, key);
}

function orderRows(
  rows: unknown[] | null,
  order: { column: string; ascending: boolean },
): unknown[] | null {
  if (!rows) {
    return rows;
  }
  return [...rows].sort((left, right) => {
    const leftValue = rowOrderValue(left, order.column);
    const rightValue = rowOrderValue(right, order.column);
    const comparison = leftValue.localeCompare(rightValue);
    return order.ascending ? comparison : -comparison;
  });
}

function rowOrderValue(row: unknown, column: string): string {
  if (!row || typeof row !== "object" || Array.isArray(row)) {
    return "";
  }
  const value = (row as Record<string, unknown>)[column];
  return typeof value === "string" ? value : "";
}

function selectFor(mock: ReturnType<typeof createClient>, table: TableName) {
  const selects = mock.calls[table].filter(([method]) => method === "select");
  const call =
    selects.find(([, args]) => String(args[0]) !== "id") ?? selects[0];
  return String(call?.[1][0] ?? "");
}

function emptyResults(): MockResults {
  return Object.fromEntries(
    TABLES.map((table) => [table, { data: [], count: 0, error: null }]),
  ) as unknown as MockResults;
}

function defaultResults(): MockResults {
  return {
    live_reports: {
      data: [
        {
          id: "report-1",
          system_duration: 60,
          screenshot_duration: 58,
          settlement_duration: 60,
          evidence_level: "green",
          time_source: "system",
          viewers: 100,
          reviewed_at: "2026-06-02T10:00:00.000Z",
          created_at: "2026-06-01T10:00:00.000Z",
          live_tasks: {
            system_started_at: "2026-06-01T09:00:00.000Z",
          },
        },
        {
          id: "report-2",
          system_duration: null,
          screenshot_duration: 40,
          settlement_duration: 45,
          evidence_level: "yellow",
          time_source: "screenshot",
          viewers: null,
          reviewed_at: "2026-06-15T10:00:00.000Z",
          created_at: "2026-06-14T10:00:00.000Z",
          live_tasks: [{ system_started_at: null }],
        },
        {
          id: "report-3",
          system_duration: 30,
          screenshot_duration: null,
          settlement_duration: 30,
          evidence_level: "red",
          time_source: "system",
          viewers: 20,
          reviewed_at: null,
          created_at: "2026-06-30T10:00:00.000Z",
          live_tasks: {
            system_started_at: "2026-06-30T09:00:00.000Z",
          },
        },
      ],
      count: 3,
      error: null,
    },
    project_streamers: {
      data: [
        {
          id: "project-streamer-1",
          streamer_id: "streamer-a",
          hourly_rate: 8_000,
          base_salary: 0,
          cps_rate_bps: 1_500,
          collaboration_id: "collab-1",
          joined_at: "2026-05-01T00:00:00.000Z",
          removed_at: null,
          streamers: { source_type: "internal" },
        },
        {
          id: "project-streamer-2",
          streamer_id: "streamer-b",
          hourly_rate: null,
          base_salary: 5_000,
          cps_rate_bps: 0,
          collaboration_id: null,
          joined_at: "2026-06-05T00:00:00.000Z",
          removed_at: null,
          streamers: [{ source_type: "external" }],
        },
      ],
      count: 2,
      error: null,
    },
    project_cost_items: {
      data: [
        {
          id: "cost-1",
          item_type: "gift",
          live_report_id: "report-1",
          created_at: "2026-06-10T00:00:00.000Z",
        },
        {
          id: "cost-2",
          item_type: "gift",
          live_report_id: "report-1",
          created_at: "2026-06-11T00:00:00.000Z",
        },
        {
          id: "cost-3",
          item_type: "gift",
          live_report_id: null,
          created_at: "2026-06-12T00:00:00.000Z",
        },
        {
          id: "cost-4",
          item_type: "supplier_fee",
          live_report_id: "report-2",
          created_at: "2026-06-13T00:00:00.000Z",
        },
        {
          id: "cost-5",
          item_type: "traffic",
          live_report_id: "report-3",
          created_at: "2026-06-14T00:00:00.000Z",
        },
      ],
      count: 5,
      error: null,
    },
    settlement_batches: {
      data: [
        {
          id: "batch-payable-1",
          batch_type: "payable",
          status: "locked",
          period_start: "2026-06-01",
          period_end: "2026-06-15",
        },
        {
          id: "batch-payable-2",
          batch_type: "payable",
          status: "confirmed",
          period_start: "2026-06-16",
          period_end: "2026-06-30",
        },
        {
          id: "batch-receivable-1",
          batch_type: "receivable",
          status: "locked",
          period_start: "2026-06-01",
          period_end: "2026-06-30",
        },
      ],
      count: 3,
      error: null,
    },
    settlement_batch_items: {
      data: [
        {
          id: "settlement-item-1",
          settlement_batch_id: "batch-payable-1",
          streamer_id: "streamer-a",
          live_report_id: "report-1",
        },
        {
          id: "settlement-item-2",
          settlement_batch_id: "batch-payable-2",
          streamer_id: "streamer-b",
          live_report_id: "report-2",
        },
        {
          id: "settlement-item-3",
          settlement_batch_id: "batch-receivable-1",
          streamer_id: "streamer-a",
          live_report_id: "report-1",
        },
      ],
      count: 3,
      error: null,
    },
  };
}

function approvedReportRows(count: number): unknown[] {
  return Array.from({ length: count }, (_, index) =>
    approvedReportRow(`report-${String(index + 1).padStart(6, "0")}`),
  );
}

function approvedReportRow(id: string): unknown {
  return {
    id,
    system_duration: 60,
    screenshot_duration: 60,
    settlement_duration: 60,
    evidence_level: "green",
    time_source: "system",
    viewers: 100,
    reviewed_at: "2026-06-02T10:00:00.000Z",
    created_at: "2026-06-01T10:00:00.000Z",
    live_tasks: { system_started_at: "2026-06-01T09:00:00.000Z" },
  };
}

function settlementBatchRows(count: number): unknown[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `batch-${String(index + 1).padStart(6, "0")}`,
    batch_type: "payable",
    status: "locked",
    period_start: "2026-06-01",
    period_end: "2026-06-30",
  }));
}

const ORGANIZATION_ID = "00000000-0000-4000-8000-000000000001";
const PROJECT_ID = "00000000-0000-4000-8000-000000000002";
const OTHER_PROJECT_ID = "00000000-0000-4000-8000-000000000102";
const CONVERSATION_ID = "00000000-0000-4000-8000-000000000003";
const DRAFT_ID = "00000000-0000-4000-8000-000000000004";
const DRAFT_2_ID = "00000000-0000-4000-8000-000000000104";
const TURN_ID = "00000000-0000-4000-8000-000000000005";
const USER_MESSAGE_ID = "00000000-0000-4000-8000-000000000006";
const ASSISTANT_MESSAGE_ID = "00000000-0000-4000-8000-000000000007";
const CREATOR_ID = "00000000-0000-4000-8000-000000000008";
const RULE_VERSION_ID = "00000000-0000-4000-8000-000000000009";
const RULE_VERSION_2_ID = "00000000-0000-4000-8000-000000000109";
const TEMPLATE_ID = "00000000-0000-4000-8000-000000000209";
const SIMULATION_ID = "00000000-0000-4000-8000-000000000010";
const GROUP_ID = "00000000-0000-4000-8000-000000000011";
const PROJECT_STREAMER_ID = "00000000-0000-4000-8000-000000000012";
const OTHER_PROJECT_STREAMER_ID = "00000000-0000-4000-8000-000000000015";
const ASSIGNMENT_ID = "00000000-0000-4000-8000-000000000013";
const SECOND_GROUP_ID = "00000000-0000-4000-8000-000000000016";
const WRONG_GROUP_ID = "00000000-0000-4000-8000-000000000017";
const SECOND_ASSIGNMENT_ID = "00000000-0000-4000-8000-000000000018";
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);
const HASH_D = "d".repeat(64);
const HASH_E = "e".repeat(64);
const HASH_F = "f".repeat(64);

function settlementRuleGroupRow(
  overrides: Record<string, unknown> = {},
  options: { includeCoverage?: boolean } = {},
) {
  const row = {
    id: GROUP_ID,
    organization_id: ORGANIZATION_ID,
    project_id: PROJECT_ID,
    name: "Gold streamers",
    description: "High-volume settlement exception group.",
    status: "active",
    created_by: CREATOR_ID,
    created_at: "2026-07-13T00:00:00.000Z",
    archived_at: null,
    assignment_count: 0,
    active_rule_count: 0,
    pending_rule_count: 0,
    future_assignment_count: 0,
    ...overrides,
  };
  if (options.includeCoverage === false) return row;
  return {
    ...row,
    unassigned_project_streamers: [
      {
        project_streamer_id: PROJECT_STREAMER_ID,
        streamer_id: "00000000-0000-4000-8000-000000000014",
        display_name: "Streamer A",
      },
    ],
    base_rule_covered_project_streamer_ids: [PROJECT_STREAMER_ID],
  };
}

function settlementGroupAssignmentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: ASSIGNMENT_ID,
    organization_id: ORGANIZATION_ID,
    project_id: PROJECT_ID,
    project_streamer_id: PROJECT_STREAMER_ID,
    group_id: GROUP_ID,
    effective_from: "2026-08-01T00:00:00.000Z",
    effective_until: null,
    assigned_by: CREATOR_ID,
    reason: "Move streamer into the August rule group.",
    created_at: "2026-07-13T00:00:00.000Z",
    ...overrides,
  };
}

function settlementGroupAssignmentChangeRow() {
  return {
    inserted_assignment: settlementGroupAssignmentRow(),
    closed_assignment_ids: [ASSIGNMENT_ID],
    new_group_snapshot_hash: HASH_F,
  };
}

function executableUnit(
  overrides: Partial<CustomRuleExecutionUnit> = {},
): CustomRuleExecutionUnit {
  return {
    key: "unit-1",
    grain: "report",
    projectId: PROJECT_ID,
    projectStreamerId: PROJECT_STREAMER_ID,
    streamerId: "00000000-0000-4000-8000-000000000019",
    periodStart: "2026-07-01T00:00:00.000Z",
    periodEnd: "2026-08-01T00:00:00.000Z",
    sourceReportIds: ["00000000-0000-4000-8000-000000000020"],
    membershipSnapshot: {
      projectStreamerId: PROJECT_STREAMER_ID,
      effectiveAt: "2026-07-15T00:00:00.000Z",
      groups: [
        { id: GROUP_ID, name: "Gold", assignmentId: ASSIGNMENT_ID },
        {
          id: SECOND_GROUP_ID,
          name: "Silver",
          assignmentId: SECOND_ASSIGNMENT_ID,
        },
      ],
      snapshotHash: HASH_E,
    },
    variables: {},
    ...overrides,
  };
}

function executableVersionRow(overrides: Record<string, unknown> = {}) {
  return {
    ...lifecycleResultRow({
      version: {
        status: "active",
        effective_from: "2026-07-01T00:00:00.000Z",
        effective_until: null,
        approved_by: CREATOR_ID,
        approved_at: "2026-06-30T00:00:00.000Z",
        archived_at: null,
        ...overrides,
      },
    }).version,
  };
}

function executableAssignmentRow(overrides: Record<string, unknown> = {}) {
  return {
    unit_key: "unit-1",
    project_streamer_id: PROJECT_STREAMER_ID,
    group_id: GROUP_ID,
    assignment_id: ASSIGNMENT_ID,
    effective_from: "2026-07-01T00:00:00.000Z",
    effective_until: null,
    ...overrides,
  };
}

function settlementGroupSimulationFreshnessRow(
  overrides: Record<string, unknown> = {},
) {
  return {
    simulation_id: SIMULATION_ID,
    rule_version_id: RULE_VERSION_ID,
    target_group_id: GROUP_ID,
    status: "pending_review",
    effective_from: "2026-08-01T00:00:00.000Z",
    group_snapshot_hash: HASH_E,
    current_group_snapshot_hash: HASH_E,
    ...overrides,
  };
}

function validBusinessContract() {
  const moneyType = {
    kind: "scalar" as const,
    scalarType: "money_cents" as const,
  };
  return {
    schemaVersion: 1 as const,
    scope: "receivable" as const,
    target: { targetType: "project" as const, targetId: null },
    executionGrain: "project_period" as const,
    compositionMode: "replace" as const,
    title: "项目应收分成",
    summary: "计算项目应收金额，适用于指定项目。",
    calculationComponents: [
      {
        name: "grossRevenue",
        description: "读取项目确认收入",
        expression: "grossRevenue",
        resultType: moneyType,
      },
    ],
    requiredInputs: [
      {
        name: "grossRevenue",
        description: "项目确认收入",
        source: "settlement_report.gross_revenue_cents",
        valueType: moneyType,
        userFacingUnit: "元",
      },
    ],
    parameters: [
      {
        name: "minimumAmount",
        description: "最低应收金额",
        valueType: moneyType,
        userFacingUnit: "元",
        defaultValue: { type: "money_cents" as const, amountCents: 0 },
      },
    ],
    effectiveStartAt: "2026-07-01T00:00:00+08:00",
    effectiveEndAt: null,
    missingDataPolicy: { action: "route_item_to_review" as const },
    compositionDescription: "替换项目周期的基础应收金额",
    businessTimezone: "Asia/Shanghai",
    examples: [
      {
        name: "标准项目应收",
        kind: "normal" as const,
        description: "项目收入一百元时返回一百元",
        inputs: {
          grossRevenue: { type: "money_cents" as const, amountCents: 10_000 },
        },
        expectedResult: { type: "money_cents" as const, amountCents: 10_000 },
      },
      {
        name: "零收入边界",
        kind: "boundary" as const,
        description: "项目没有收入时结果为零",
        inputs: {
          grossRevenue: { type: "money_cents" as const, amountCents: 0 },
        },
        expectedResult: { type: "money_cents" as const, amountCents: 0 },
      },
      {
        name: "最小金额边界",
        kind: "boundary" as const,
        description: "最小货币单位仍按整数分处理",
        inputs: {
          grossRevenue: { type: "money_cents" as const, amountCents: 1 },
        },
        expectedResult: { type: "money_cents" as const, amountCents: 1 },
      },
    ],
  };
}

function validAiResponse() {
  return {
    content: "已生成项目应收规则草案。",
    finishReason: "stop" as const,
    providerRequestId: null,
  };
}

function validDraftInput(): ContractReadyCustomRuleDraftInput {
  return {
    organizationId: ORGANIZATION_ID,
    projectId: PROJECT_ID,
    conversationId: CONVERSATION_ID,
    idempotencyKey: "draft-request-1",
    promptText: "请按项目确认收入生成应收规则。",
    turnTrace: {
      turnId: TURN_ID,
      userMessageId: USER_MESSAGE_ID,
      assistantMessageId: ASSISTANT_MESSAGE_ID,
    },
    businessContract: validBusinessContract(),
    unresolvedAmbiguities: [],
    variableCatalogVersion: HASH_A,
    aiResponse: validAiResponse(),
    generatedFormula: {
      expression: "grossRevenue",
      normalizedAst: { kind: "identifier", name: "grossRevenue" },
    },
    generatedExplanation: "项目确认收入直接作为本周期应收金额。",
    generatedTestCases: [
      {
        name: "标准收入",
        inputs: {
          grossRevenue: { type: "money_cents", amountCents: 10_000 },
        },
        expectedResult: { type: "money_cents", amountCents: 10_000 },
      },
    ],
    model: "gpt-5.2",
    safetyFlags: [],
    contractHash: HASH_B,
    formulaHash: HASH_C,
    parameterHash: HASH_D,
    status: "contract_ready",
  };
}

function validClarifyingDraftInput(): ClarifyingCustomRuleDraftInput {
  return {
    ...validDraftInput(),
    unresolvedAmbiguities: [
      {
        code: "confirm_revenue_scope",
        question: "请确认收入统计范围。",
        required: true,
      },
    ],
    generatedFormula: null,
    generatedExplanation: null,
    generatedTestCases: [],
    formulaHash: null,
    status: "clarifying",
  };
}

function validFailedDraftInput(): FailedCustomRuleDraftInput {
  return {
    ...validDraftInput(),
    unresolvedAmbiguities: [],
    aiResponse: {
      content: "规则生成失败，需人工检查输入。",
      finishReason: "content_filter",
      providerRequestId: "provider-request-failed-1",
    },
    generatedFormula: null,
    generatedExplanation: null,
    generatedTestCases: [],
    safetyFlags: [
      {
        code: "generation_failed",
        severity: "block",
        message: "未生成可执行公式。",
      },
    ],
    formulaHash: null,
    status: "failed",
  };
}

function validTurnCompletion(content: string) {
  return {
    providerName: "openai",
    content,
    aiInvocationId: "80000000-0000-4000-8000-000000000001",
    metadata: { modelVersion: "gpt-5.2" },
  };
}

function draftRow(overrides: Record<string, unknown> = {}) {
  const input = validDraftInput();
  return {
    id: DRAFT_ID,
    organization_id: ORGANIZATION_ID,
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    prompt_text: input.promptText,
    turn_trace: input.turnTrace,
    business_contract: input.businessContract,
    unresolved_ambiguities: input.unresolvedAmbiguities,
    variable_catalog_version: HASH_A,
    ai_response: input.aiResponse,
    generated_formula: input.generatedFormula,
    generated_explanation: input.generatedExplanation,
    generated_test_cases: input.generatedTestCases,
    model: input.model,
    safety_flags: input.safetyFlags,
    contract_hash: HASH_B,
    formula_hash: HASH_C,
    parameter_hash: HASH_D,
    initial_status: "contract_ready",
    status: "contract_ready",
    revision_number: 1,
    idempotency_key: "draft-request-1",
    created_by: CREATOR_ID,
    created_at: "2026-07-11T11:00:00.000Z",
    supersedes_draft_id: null,
    superseded_by_draft_id: null,
    superseded_at: null,
    ...overrides,
  };
}

function validSampleSelection() {
  return {
    periodStart: "2026-06-01",
    periodEnd: "2026-06-30",
    populationCount: 100,
    sampledCount: 20,
    criteria: ["confirmed", "locked"],
  };
}

function validHistoricalTotals() {
  return {
    oldPayableAmountCents: "9007199254740993",
    oldReceivableAmountCents: null,
    newPayableAmountCents: "9007199254741993",
    newReceivableAmountCents: null,
    recordCount: 20,
    verificationStatus: "verified" as const,
  };
}

function validSimulationInput(
  owner: SettlementSimulationOwner,
): InsertSettlementFormulaSimulationInput {
  return {
    organizationId: ORGANIZATION_ID,
    projectId: PROJECT_ID,
    owner,
    idempotencyKey: "simulation-request-1",
    formulaHash: HASH_C,
    ruleContractHash: HASH_B,
    parameterHash: HASH_D,
    variableCatalogVersion: HASH_A,
    dataSelectionHash: HASH_E,
    sampleSource: { kind: "historical_settlements" },
    sampleSelection: validSampleSelection(),
    coverage: {
      summarySchemaVersion: 2,
      totalRecords: 20,
      evaluatedRecords: 18,
      skippedRecords: 2,
      uncoveredRecords: 3,
      zeroAmountRecords: 2,
      reviewRoutedRecords: 1,
      blockedRecords: 1,
    },
    scenarios: [
      {
        id: "synthetic:zero",
        category: "zero",
        outcome: "calculated",
        amountCents: "0",
        expectedAmountCents: null,
        passed: true,
      },
      {
        id: "derived:missing:route_item_to_review",
        category: "missing_data_policy",
        outcome: "review_routed",
        amountCents: null,
        expectedAmountCents: null,
        passed: true,
      },
    ],
    historicalTotals: validHistoricalTotals(),
    deltas: {
      payableAmountCents: "1000",
      receivableAmountCents: null,
      percentageBps: 0,
      marginImpactCents: "-1000",
    },
    largestChanges: [
      {
        dimension: "rule_component",
        key: "grossRevenue",
        deltaAmountCents: "1000",
        direction: "increase",
      },
    ],
    warnings: [],
  };
}

function validV2SimulationInput(owner: SettlementSimulationOwner) {
  return {
    ...validSimulationInput(owner),
    warnings: [
      {
        kind: "risk" as const,
        code: "CUSTOM_RULE_ZERO_PAY_RECORDS",
        severity: "warning" as const,
        message: "新规则产生了零应付样本。",
      },
    ],
  };
}

function typedOutputV2SimulationInput(
  owner: SettlementSimulationOwner,
  outputKind?: "cost_items" | "checks",
): InsertSettlementFormulaSimulationInput {
  return {
    ...validSimulationInput(owner),
    coverage: {
      summarySchemaVersion: 2,
      ...(outputKind ? { outputKind } : {}),
      totalRecords: 1,
      evaluatedRecords: 1,
      skippedRecords: 0,
      uncoveredRecords: 0,
      zeroAmountRecords: 0,
      reviewRoutedRecords: 0,
      blockedRecords: 0,
    },
    sampleSelection: {
      ...validSampleSelection(),
      populationCount: 1,
      sampledCount: 1,
    },
    scenarios: [
      {
        id: "contract:typed-output",
        category: "contract_example",
        outcome: "calculated",
        amountCents: null,
        expectedAmountCents: null,
        passed: true,
      },
    ],
    historicalTotals: {
      oldPayableAmountCents: null,
      oldReceivableAmountCents: null,
      newPayableAmountCents: null,
      newReceivableAmountCents: null,
      recordCount: 1,
      verificationStatus: "unverified",
    },
    deltas: {
      payableAmountCents: null,
      receivableAmountCents: null,
      percentageBps: null,
      marginImpactCents: null,
    },
    largestChanges: [],
  };
}

function validAtomicSimulationSummary(): FinalizeSettlementAiSimulationSummaryInput {
  const simulation = validSimulationInput({
    kind: "ai_draft",
    id: DRAFT_ID,
  });
  return {
    idempotencyKey: simulation.idempotencyKey,
    dataSelectionHash: simulation.dataSelectionHash,
    sampleSource: simulation.sampleSource,
    sampleSelection: simulation.sampleSelection,
    coverage: simulation.coverage,
    scenarios: simulation.scenarios,
    historicalTotals: simulation.historicalTotals,
    deltas: simulation.deltas,
    largestChanges: simulation.largestChanges,
    warnings: simulation.warnings,
  };
}

function simulationRow(
  owner: SettlementSimulationOwner,
  overrides: Record<string, unknown> = {},
) {
  const input = validSimulationInput(owner);
  return {
    id: SIMULATION_ID,
    organization_id: ORGANIZATION_ID,
    project_id: PROJECT_ID,
    rule_version_id: owner.kind === "rule_version" ? owner.id : null,
    ai_draft_id: owner.kind === "ai_draft" ? owner.id : null,
    formula_hash: HASH_C,
    rule_contract_hash: HASH_B,
    parameter_hash: HASH_D,
    variable_catalog_version: HASH_A,
    data_selection_hash: HASH_E,
    sample_source: input.sampleSource,
    sample_selection: input.sampleSelection,
    coverage: input.coverage,
    scenarios: input.scenarios,
    historical_totals: input.historicalTotals,
    deltas: input.deltas,
    largest_changes: input.largestChanges,
    warnings: input.warnings,
    idempotency_key: "simulation-request-1",
    created_by: CREATOR_ID,
    created_at: "2026-07-11T11:05:00.000Z",
    ...overrides,
  };
}

function legacySimulationRow(
  owner: SettlementSimulationOwner,
  overrides: Record<string, unknown> = {},
) {
  return {
    ...simulationRow(owner),
    coverage: { totalRecords: 20, evaluatedRecords: 18, skippedRecords: 2 },
    scenarios: [{ name: "标准场景", kind: "normal", result: "passed" }],
    historical_totals: {
      payableAmountCents: "9007199254740993",
      receivableAmountCents: null,
      recordCount: 20,
    },
    deltas: {
      payableAmountCents: "1000",
      receivableAmountCents: "0",
      percentageBps: 0,
    },
    warnings: [],
    ...overrides,
  };
}

type PersistenceTableName =
  | "ai_settlement_rule_drafts"
  | "settlement_formula_simulations"
  | "settlement_rule_templates";
type PersistenceQueryCall = [
  PersistenceTableName,
  "select" | "eq" | "order" | "limit" | "returns" | "maybeSingle",
  unknown[],
];
type PersistenceMockQuery = {
  select(columns: string): PersistenceMockQuery;
  eq(column: string, value: unknown): PersistenceMockQuery;
  order(column: string, options: { ascending: boolean }): PersistenceMockQuery;
  limit(count: number): PersistenceMockQuery;
  returns<T>(): Promise<{ data: T; error: null }>;
  maybeSingle(): Promise<{ data: unknown; error: null }>;
};

function createPersistenceClient(
  options: {
    draftRows?: unknown[];
    simulationRows?: unknown[];
    draftRpcData?: unknown;
    simulationRpcData?: unknown;
    finalizedDraftRpcData?: unknown;
    finalizedSimulationRpcData?: unknown;
    finalizedFailedRpcData?: unknown;
    reuseDraftRpcData?: unknown;
    organizationTemplateRpcData?: unknown;
    organizationTemplateRows?: unknown[];
  } = {},
) {
  const queryCalls: PersistenceQueryCall[] = [];
  const rpc = vi.fn(async (fn: string) => {
    if (fn === "create_ai_settlement_rule_draft") {
      return {
        data: options.draftRpcData ?? draftRow({ duplicate: false }),
        error: null,
      };
    }
    if (fn === "create_settlement_formula_simulation") {
      return {
        data:
          options.simulationRpcData ??
          simulationRow(
            { kind: "ai_draft", id: DRAFT_ID },
            { duplicate: false },
          ),
        error: null,
      };
    }
    if (fn === "finalize_settlement_ai_draft_turn") {
      return {
        data:
          options.finalizedDraftRpcData ??
          draftRow({ duplicate: false, request_fingerprint: HASH_E }),
        error: null,
      };
    }
    if (fn === "finalize_settlement_ai_simulation_turn") {
      return {
        data: options.finalizedSimulationRpcData ?? {
          draft: draftRow({
            status: "simulated",
            duplicate: false,
            request_fingerprint: HASH_E,
          }),
          simulation: simulationRow(
            { kind: "ai_draft", id: DRAFT_ID },
            { duplicate: false },
          ),
        },
        error: null,
      };
    }
    if (fn === "finalize_settlement_ai_failed_turn") {
      return {
        data:
          options.finalizedFailedRpcData ??
          draftRow({
            unresolved_ambiguities: [],
            ai_response: validFailedDraftInput().aiResponse,
            generated_formula: null,
            generated_explanation: null,
            generated_test_cases: [],
            safety_flags: validFailedDraftInput().safetyFlags,
            formula_hash: null,
            initial_status: "failed",
            status: "failed",
            duplicate: false,
            request_fingerprint: HASH_E,
          }),
        error: null,
      };
    }
    if (
      fn === "clone_custom_settlement_rule_to_draft" ||
      fn === "create_custom_settlement_rule_parameter_draft"
    ) {
      return {
        data:
          options.reuseDraftRpcData ??
          lifecycleResultRow({ simulation: null, event: null }),
        error: null,
      };
    }
    if (
      fn === "save_organization_settlement_rule_template" ||
      fn === "archive_organization_settlement_rule_template"
    ) {
      return {
        data: options.organizationTemplateRpcData ?? organizationTemplateRow(),
        error: null,
      };
    }
    return { data: null, error: new Error(`Unexpected RPC: ${fn}`) };
  });
  const from = vi.fn((table: PersistenceTableName) => {
    const rows =
      table === "ai_settlement_rule_drafts"
        ? (options.draftRows ?? [])
        : table === "settlement_formula_simulations"
          ? (options.simulationRows ?? [])
          : (options.organizationTemplateRows ?? []);
    const record = (
      method: PersistenceQueryCall[1],
      args: unknown[],
    ): PersistenceMockQuery => {
      queryCalls.push([table, method, args]);
      return query;
    };
    const query: PersistenceMockQuery = {
      select: (columns) => record("select", [columns]),
      eq: (column, value) => record("eq", [column, value]),
      order: (column, orderOptions) => record("order", [column, orderOptions]),
      limit: (count) => record("limit", [count]),
      returns: async <T>() => {
        queryCalls.push([table, "returns", []]);
        return { data: rows as T, error: null };
      },
      maybeSingle: async () => {
        queryCalls.push([table, "maybeSingle", []]);
        return { data: rows[0] ?? null, error: null };
      },
    };
    return query;
  });

  return {
    client: { from, rpc } as unknown as SupabaseClient,
    from,
    rpc,
    queryCalls,
  };
}
