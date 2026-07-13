import { createHash } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createSettlementBatchRuleExceptionGate,
  resolveSettlementRuleException,
} from "@/features/settlements/custom-rule-exception-service";
import {
  executeCustomSettlementRulePipeline,
  type ExecutableCustomRuleLayer,
} from "@/features/settlements/custom-rule-executor";
import {
  createProductionCustomSettlementExecutionPort,
} from "@/features/settlements/custom-rule-service";
import type {
  CompiledAstNode,
  CustomRuleExecutionUnit,
  CustomRuleMissingDataPolicy,
  CustomRuleScope,
  RuntimeScalarType,
  RuntimeValueType,
} from "@/features/settlements/custom-rule-types";
import { validateCustomRuleFormula } from "@/features/settlements/custom-rule-validator";
import type { CustomSettlementRuleVersion } from "@/features/settlements/custom-rule-repository";
import {
  confirmSettlementBatch,
  generateSettlementBatch,
  lockSettlementBatch,
  type CustomSettlementExecutionPort,
  type SettlementActor,
  type SettlementBatchAtomicItemInput,
  type SettlementBatchItemRecord,
  type SettlementBatchRecord,
  type SettlementPoolReport,
  type SettlementRepository,
  type SettlementRuleExceptionRecord,
} from "@/features/settlements/settlement-service";

const ORG_ID = "org-production";
const PROJECT_ID = "project-production";
const PERIOD_START = "2026-07-01";
const PERIOD_END = "2026-07-31";

const owner: SettlementActor = {
  userId: "user-owner",
  name: "Owner",
  role: "owner",
  organizationId: ORG_ID,
};

const finance: SettlementActor = {
  ...owner,
  userId: "user-finance",
  name: "Finance",
  role: "finance",
};

describe("custom settlement production golden paths", () => {
  const audit = vi.fn(async () => undefined);
  const notify = vi.fn(async () => undefined);

  beforeEach(() => {
    audit.mockClear();
    notify.mockClear();
  });

  it("uses payable fixed fallback only when zero custom layers are active", async () => {
    const repo = createSettlementRepo({
      reports: [
        report({
          id: "report-fixed",
          streamerId: "streamer-fixed",
          settlementDuration: 90,
        }),
      ],
      rules: [
        {
          projectId: PROJECT_ID,
          streamerId: "streamer-fixed",
          settlementMethod: "base_salary_cpt",
          hourlyRate: 80,
          baseSalary: 50,
        },
      ],
    });
    const customExecutionPort: CustomSettlementExecutionPort = {
      resolveAndExecute: vi.fn(
        async (): Promise<"no_custom_layers"> => "no_custom_layers",
      ),
    };

    const result = await generateSettlementBatch({
      repo,
      audit,
      notify,
      actor: owner,
      input: batchInput("payable"),
      customExecutionPort,
    });

    expect(result.batch.computedAmount).toBe(170);
    expect(repo.createSettlementBatchAtomic).toHaveBeenCalledWith(
      expect.objectContaining({
        batchType: "payable",
        computedAmount: 170,
        items: [
          expect.objectContaining({
            computedAmount: 170,
            liveReportIds: ["report-fixed"],
            evidenceSnapshot: expect.not.objectContaining({
              ruleEngine: expect.anything(),
            }),
          }),
        ],
      }),
    );
  });

  it("applies payable project base, ordered groups, and individual exception layers", async () => {
    const repo = createSettlementRepo({
      reports: [
        report({
          id: "report-layered",
          streamerId: "streamer-layered",
          projectStreamerId: "project-streamer-layered",
          settlementGroups: [
            group("group-bronze", "Bronze", "assignment-bronze"),
            group("group-gold", "Gold", "assignment-gold"),
          ],
        }),
      ],
    });
    const port = createProductionCustomSettlementExecutionPort({
      repository: executableRepository({
        projectBaseVersion: ruleVersion({
          id: "rule-project-base",
          formula: "money_result({ final: yuan(100) })",
        }),
        groupVersions: [
          {
            groupId: "group-gold",
            version: ruleVersion({
              id: "rule-group-gold",
              target: { targetType: "streamer_group", targetId: "group-gold" },
              priority: 20,
              compositionMode: "add",
              formula: "money_result({ final: yuan(20) })",
            }),
          },
          {
            groupId: "group-bronze",
            version: ruleVersion({
              id: "rule-group-bronze",
              target: { targetType: "streamer_group", targetId: "group-bronze" },
              priority: 10,
              compositionMode: "add",
              formula: "money_result({ final: yuan(5) })",
            }),
          },
        ],
        projectStreamerVersions: [
          {
            projectStreamerId: "project-streamer-layered",
            version: ruleVersion({
              id: "rule-individual-exception",
              target: {
                targetType: "project_streamer",
                targetId: "project-streamer-layered",
              },
              priority: 100,
              compositionMode: "add",
              formula: "money_result({ final: yuan(7) })",
            }),
          },
        ],
      }),
      executionCapability: { enabled: true },
    });

    await generateSettlementBatch({
      repo,
      audit,
      notify,
      actor: owner,
      input: batchInput("payable"),
      customExecutionPort: port,
    });

    const payload = lastAtomicPayload(repo);
    expect(payload.computedAmount).toBe(132);
    expect(payload.items[0]).toMatchObject({
      computedAmount: 132,
      liveReportIds: ["report-layered"],
    });
    expect(ruleEngine(payload.items[0]).appliedLayers).toEqual([
      expect.objectContaining({ versionId: "rule-project-base" }),
      expect.objectContaining({ versionId: "rule-group-bronze" }),
      expect.objectContaining({ versionId: "rule-group-gold" }),
      expect.objectContaining({ versionId: "rule-individual-exception" }),
    ]);
    expect(ruleEngine(payload.items[0]).membershipAssignmentIds).toEqual([
      "assignment-bronze",
      "assignment-gold",
    ]);
  });

  it("applies a payable period guarantee across multiple reports and links every source", async () => {
    const repo = createSettlementRepo({
      reports: [
        report({
          id: "report-guarantee-a",
          streamerId: "streamer-guarantee",
          projectStreamerId: "project-streamer-guarantee",
          settlementDuration: 30,
        }),
        report({
          id: "report-guarantee-b",
          streamerId: "streamer-guarantee",
          projectStreamerId: "project-streamer-guarantee",
          settlementDuration: 40,
        }),
      ],
    });
    const port = createProductionCustomSettlementExecutionPort({
      repository: executableRepository({
        projectBaseVersion: ruleVersion({
          id: "rule-period-guarantee",
          executionGrain: "project_streamer_period",
          formula:
            "money_result({ final: max(yuan(100), period_settlement_minutes * yuan(1)) })",
        }),
      }),
      executionCapability: { enabled: true },
    });

    await generateSettlementBatch({
      repo,
      audit,
      notify,
      actor: owner,
      input: batchInput("payable"),
      customExecutionPort: port,
    });

    const payload = lastAtomicPayload(repo);
    expect(payload.computedAmount).toBe(100);
    expect(payload.items).toEqual([
      expect.objectContaining({
        computedAmount: 100,
        liveReportId: null,
        liveReportIds: ["report-guarantee-a", "report-guarantee-b"],
      }),
    ]);
    expect(ruleEngine(payload.items[0]).grain).toBe("project_streamer_period");
    expect(ruleEngine(payload.items[0]).sourceReportIds).toEqual([
      "report-guarantee-a",
      "report-guarantee-b",
    ]);
  });

  it("calculates receivable report fees with one batch base fee", async () => {
    const repo = createSettlementRepo({
      reports: [
        report({ id: "report-receivable-a", streamerId: "streamer-a" }),
        report({ id: "report-receivable-b", streamerId: "streamer-b" }),
      ],
      projectRule: {
        projectId: PROJECT_ID,
        settlementMethod: "base_salary_cpt",
        hourlyRate: 60,
        baseSalary: 500,
      },
    });

    await generateSettlementBatch({
      repo,
      audit,
      notify,
      actor: owner,
      input: batchInput("receivable"),
    });

    expect(lastAtomicPayload(repo)).toMatchObject({
      batchType: "receivable",
      computedAmount: 740,
      items: [
        expect.objectContaining({ computedAmount: 620 }),
        expect.objectContaining({ computedAmount: 120 }),
      ],
    });
  });

  it("splits a streamer-period when group membership changes inside the period", async () => {
    const repo = createSettlementRepo({
      reports: [
        report({
          id: "report-before-change",
          streamerId: "streamer-changing",
          projectStreamerId: "project-streamer-changing",
          createdAt: "2026-07-05T00:00:00.000Z",
          settlementGroups: [group("group-day", "Day", "assignment-day")],
        }),
        report({
          id: "report-after-change",
          streamerId: "streamer-changing",
          projectStreamerId: "project-streamer-changing",
          createdAt: "2026-07-20T00:00:00.000Z",
          settlementGroups: [group("group-night", "Night", "assignment-night")],
        }),
      ],
    });
    const port = createProductionCustomSettlementExecutionPort({
      repository: executableRepository({
        projectBaseVersion: ruleVersion({
          id: "rule-period-base",
          executionGrain: "project_streamer_period",
          formula: "money_result({ final: period_report_count * yuan(10) })",
        }),
        groupVersions: [
          {
            groupId: "group-day",
            version: ruleVersion({
              id: "rule-day-bonus",
              target: { targetType: "streamer_group", targetId: "group-day" },
              executionGrain: "project_streamer_period",
              priority: 10,
              compositionMode: "add",
              formula: "money_result({ final: yuan(1) })",
            }),
          },
          {
            groupId: "group-night",
            version: ruleVersion({
              id: "rule-night-bonus",
              target: { targetType: "streamer_group", targetId: "group-night" },
              executionGrain: "project_streamer_period",
              priority: 10,
              compositionMode: "add",
              formula: "money_result({ final: yuan(2) })",
            }),
          },
        ],
      }),
      executionCapability: { enabled: true },
    });

    await generateSettlementBatch({
      repo,
      audit,
      notify,
      actor: owner,
      input: batchInput("payable"),
      customExecutionPort: port,
    });

    const payload = lastAtomicPayload(repo);
    expect(payload.computedAmount).toBe(23);
    expect(payload.items).toEqual([
      expect.objectContaining({
        computedAmount: 11,
        liveReportIds: ["report-before-change"],
      }),
      expect.objectContaining({
        computedAmount: 12,
        liveReportIds: ["report-after-change"],
      }),
    ]);
    expect(payload.items.map((item) => ruleEngine(item).membershipAssignmentIds)).toEqual([
      ["assignment-day"],
      ["assignment-night"],
    ]);
  });

  it("uses explicit defaults and records the missing-data decision", async () => {
    const repo = createSettlementRepo({
      reports: [report({ id: "report-default" })],
    });
    const customExecutionPort = executorBackedPort({
      layer: executorLayer({
        versionId: "rule-explicit-default",
        formula: "money_result({ final: gift_amount })",
        declarations: [
          optionalMoneyInput("gift_amount", {
            action: "use_explicit_default",
            defaultValue: { type: "money_cents", amountCents: 888 },
          }),
        ],
      }),
    });

    await generateSettlementBatch({
      repo,
      audit,
      notify,
      actor: owner,
      input: batchInput("payable"),
      customExecutionPort,
    });

    const payload = lastAtomicPayload(repo);
    expect(payload.computedAmount).toBe(8.88);
    expect(ruleEngine(payload.items[0]).missingDataDecisions).toEqual([
      expect.objectContaining({
        variableName: "gift_amount",
        action: "use_explicit_default",
        value: { type: "money_cents", amountCents: 888 },
      }),
    ]);
  });

  it("routes review items through resolution, confirm, and lock gates", async () => {
    const repo = createSettlementRepo({
      reports: [report({ id: "report-review" })],
    });
    const customExecutionPort = executorBackedPort({
      layer: executorLayer({
        versionId: "rule-review",
        formula: "money_result({ final: gift_amount })",
        declarations: [
          optionalMoneyInput("gift_amount", {
            action: "route_item_to_review",
          }),
        ],
      }),
    });

    await generateSettlementBatch({
      repo,
      audit,
      notify,
      actor: owner,
      input: batchInput("payable"),
      customExecutionPort,
    });

    const payload = lastAtomicPayload(repo);
    expect(payload.computedAmount).toBe(0);
    expect(payload.items[0].exceptions).toEqual([
      expect.objectContaining({
        liveReportId: "report-review",
        variableName: "gift_amount",
        policy: "route_item_to_review",
      }),
    ]);

    const gate = createSettlementBatchRuleExceptionGate({
      repo,
      organizationId: ORG_ID,
    });
    await expect(
      confirmSettlementBatch({
        repo,
        audit,
        notify,
        actor: finance,
        batchId: "batch-created",
        reason: "Finance checked",
        gate,
      }),
    ).rejects.toThrow("Settlement batch has unresolved rule exceptions");

    await resolveSettlementRuleException({
      repo,
      audit,
      actor: finance,
      batchId: "batch-created",
      exceptionId: "exception-1",
      input: {
        resolutionValue: { type: "money_cents", amountCents: 2500 },
        reason: "Matched source sheet",
      },
    });

    await expect(
      confirmSettlementBatch({
        repo,
        audit,
        notify,
        actor: finance,
        batchId: "batch-created",
        reason: "Finance checked",
        gate,
      }),
    ).resolves.toMatchObject({ status: "confirmed" });

    await expect(
      lockSettlementBatch({
        repo,
        audit,
        notify,
        actor: owner,
        batchId: "batch-created",
        reason: "Owner locked after finance confirmation",
        gate,
        now: "2026-07-31T12:00:00.000Z",
      }),
    ).resolves.toMatchObject({
      status: "locked",
      computedAmount: 25,
      lockedAt: "2026-07-31T12:00:00.000Z",
    });
  });

  it("blocks batch generation without writing when a block-batch input is missing", async () => {
    const repo = createSettlementRepo({
      reports: [report({ id: "report-blocked" })],
    });
    const customExecutionPort = executorBackedPort({
      layer: executorLayer({
        versionId: "rule-blocked",
        formula: "money_result({ final: gift_amount })",
        declarations: [
          optionalMoneyInput("gift_amount", { action: "block_batch" }),
        ],
      }),
    });

    await expect(
      generateSettlementBatch({
        repo,
        audit,
        notify,
        actor: owner,
        input: batchInput("payable"),
        customExecutionPort,
      }),
    ).rejects.toMatchObject({
      issue: expect.objectContaining({
        code: "CUSTOM_RULE_MISSING_DATA_BLOCKED",
      }),
      noTransactionAttempted: true,
    });

    expect(repo.createSettlementBatchAtomic).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it("keeps locked history reproducible after a new active rule version exists", async () => {
    const historicalAst = compileAst("money_result({ final: gift_amount })");
    const newActiveAst = compileAst("money_result({ final: yuan(999) })");
    const repo = createSettlementRepo({
      reports: [report({ id: "report-locked-history" })],
      seedBatch: batch({ status: "locked", computedAmount: 10 }),
      seedItems: [
        item({
          computedAmount: 10,
          evidenceSnapshot: {
            ruleEngine: {
              mode: "custom",
              sourceReportIds: ["report-locked-history"],
            },
          },
        }),
      ],
      seedExceptions: [
        exceptionRecord({
          layerSnapshot: {
            versionId: "rule-history-v1",
            target: { targetType: "project", targetId: null },
            layer: "project_base",
            composition: "replace",
            compiledAst: historicalAst,
            compiledAstHash: hash(historicalAst),
            activeCompiledAstHash: hash(historicalAst),
            parameters: {},
            typedInputs: {
              prior_layer_amount: { type: "money_cents", amountCents: 0 },
            },
          },
        }),
      ],
    });

    await expect(
      resolveSettlementRuleException({
        repo,
        audit,
        actor: finance,
        batchId: "batch-created",
        exceptionId: "exception-1",
        input: {
          resolutionValue: { type: "money_cents", amountCents: 2500 },
          reason: "Late replay attempt",
        },
      }),
    ).rejects.toThrow(
      "Settlement batch is no longer open for rule exception resolution",
    );

    vi.mocked(repo.getSettlementBatchById).mockResolvedValueOnce(
      batch({ status: "generated", computedAmount: 10 }),
    );
    await resolveSettlementRuleException({
      repo,
      audit,
      actor: finance,
      batchId: "batch-created",
      exceptionId: "exception-1",
      input: {
        resolutionValue: { type: "money_cents", amountCents: 2500 },
        reason: `Replay with newer active hash ${hash(newActiveAst).slice(0, 8)}`,
      },
    });

    expect(repo.resolveSettlementRuleException).toHaveBeenCalledWith(
      expect.objectContaining({
        oldComputedAmount: 10,
        newComputedAmount: 25,
      }),
    );
  });

  it("preserves cents/yuan boundaries without 100x conversions", async () => {
    const repo = createSettlementRepo({
      reports: [
        report({ id: "report-cent", streamerId: "streamer-cent" }),
        report({ id: "report-yuan", streamerId: "streamer-yuan" }),
      ],
    });
    const customExecutionPort: CustomSettlementExecutionPort = {
      resolveAndExecute: vi.fn(async () => ({
        items: [
          customItem({
            streamerId: "streamer-cent",
            sourceReportIds: ["report-cent"],
            computedAmountCents: 1,
          }),
          customItem({
            streamerId: "streamer-yuan",
            sourceReportIds: ["report-yuan"],
            computedAmountCents: 123456,
          }),
        ],
      })),
    };

    await generateSettlementBatch({
      repo,
      audit,
      notify,
      actor: owner,
      input: batchInput("payable"),
      customExecutionPort,
    });

    expect(lastAtomicPayload(repo)).toMatchObject({
      computedAmount: 1234.57,
      items: [
        expect.objectContaining({ computedAmount: 0.01 }),
        expect.objectContaining({ computedAmount: 1234.56 }),
      ],
    });
  });
});

function batchInput(batchType: "payable" | "receivable") {
  return {
    projectId: PROJECT_ID,
    batchType,
    periodStart: PERIOD_START,
    periodEnd: PERIOD_END,
  };
}

function report(
  patch: Partial<SettlementPoolReport> = {},
): SettlementPoolReport {
  return {
    id: "report-1",
    organizationId: ORG_ID,
    projectId: PROJECT_ID,
    streamerId: "streamer-1",
    liveTaskId: "task-1",
    status: "approved",
    systemDuration: 120,
    screenshotDuration: 120,
    settlementDuration: 120,
    timeSource: "system",
    evidenceLevel: "green",
    settledBatchItemId: null,
    viewers: 100,
    reviewedAt: "2026-07-12T00:00:00.000Z",
    createdAt: "2026-07-12T00:00:00.000Z",
    ...patch,
  };
}

function group(id: string, name: string, assignmentId: string) {
  return { id, name, assignmentId };
}

function batch(patch: Partial<SettlementBatchRecord> = {}): SettlementBatchRecord {
  return {
    id: "batch-created",
    organizationId: ORG_ID,
    projectId: PROJECT_ID,
    batchType: "payable",
    status: "generated",
    periodStart: PERIOD_START,
    periodEnd: PERIOD_END,
    computedAmount: 0,
    manualAmount: 0,
    adjustmentAmount: 0,
    evidenceSummary: { green: 1, yellow: 0, red: 0, unknown: 0 },
    createdBy: owner.userId,
    lockedAt: null,
    lockReason: null,
    reopenReason: null,
    createdAt: "2026-07-31T00:00:00.000Z",
    updatedAt: "2026-07-31T00:00:00.000Z",
    ...patch,
  };
}

function item(
  patch: Partial<SettlementBatchItemRecord> = {},
): SettlementBatchItemRecord {
  return {
    id: "item-1",
    organizationId: ORG_ID,
    settlementBatchId: "batch-created",
    projectId: PROJECT_ID,
    streamerId: "streamer-1",
    liveReportId: "report-1",
    itemType: "live_report_payable",
    computedAmount: 0,
    manualAmount: 0,
    adjustmentAmount: 0,
    evidenceLevel: "green",
    evidenceSnapshot: {},
    createdAt: "2026-07-31T00:01:00.000Z",
    ...patch,
  };
}

type TestSettlementRepository = SettlementRepository &
  Required<
    Pick<
      SettlementRepository,
      | "hasOpenSettlementRuleExceptions"
      | "listSettlementRuleExceptions"
      | "resolveSettlementRuleException"
    >
  >;

function createSettlementRepo(input: {
  reports: SettlementPoolReport[];
  rules?: Awaited<ReturnType<SettlementRepository["getSettlementRules"]>>;
  projectRule?: Awaited<
    ReturnType<SettlementRepository["getProjectSettlementRule"]>
  >;
  seedBatch?: SettlementBatchRecord;
  seedItems?: SettlementBatchItemRecord[];
  seedExceptions?: SettlementRuleExceptionRecord[];
}): TestSettlementRepository {
  let currentBatch = input.seedBatch ?? batch();
  let currentItems = input.seedItems ?? [];
  let currentExceptions = input.seedExceptions ?? [];
  const repo: TestSettlementRepository = {
    listSettlementPoolReports: vi.fn(async () => input.reports),
    getSettlementRules: vi.fn(async () => input.rules ?? []),
    getProjectSettlementRule: vi.fn(async () => input.projectRule ?? null),
    createSettlementBatch: vi.fn(),
    createSettlementBatchItem: vi.fn(),
    createSettlementBatchAtomic: vi.fn(
      async (
        payload: Parameters<
          SettlementRepository["createSettlementBatchAtomic"]
        >[0],
      ) => {
        currentBatch = batch({
          batchType: payload.batchType,
          computedAmount: payload.computedAmount,
          manualAmount: payload.manualAmount,
          adjustmentAmount: payload.adjustmentAmount,
          evidenceSummary: payload.evidenceSummary,
        });
        currentItems = payload.items.map(
          (payloadItem: SettlementBatchAtomicItemInput, index: number) =>
            item({
              id: `item-${index + 1}`,
              streamerId: payloadItem.streamerId,
              liveReportId: payloadItem.liveReportId,
              itemType: payloadItem.itemType,
              computedAmount: payloadItem.computedAmount,
              manualAmount: payloadItem.manualAmount,
              adjustmentAmount: payloadItem.adjustmentAmount,
              evidenceLevel: payloadItem.evidenceLevel,
              evidenceSnapshot: payloadItem.evidenceSnapshot,
            }),
        );
        currentExceptions = payload.items.flatMap(
          (payloadItem: SettlementBatchAtomicItemInput, index: number) =>
            (payloadItem.exceptions ?? []).map(
              (payloadException, exceptionIndex: number) =>
                exceptionRecord({
                  id: `exception-${exceptionIndex + 1}`,
                  settlementBatchItemId: `item-${index + 1}`,
                  liveReportId: payloadException.liveReportId ?? null,
                  ruleVersionId: payloadException.ruleVersionId ?? null,
                  layerSnapshot: payloadException.layerSnapshot,
                  variableName: payloadException.variableName,
                  policy: payloadException.policy,
                }),
            ),
        );
        return { batch: currentBatch, items: currentItems };
      },
    ),
    markReportSettled: vi.fn(),
    getSettlementBatchById: vi.fn(async () => currentBatch),
    updateSettlementBatch: vi.fn(async (_batchId, patch) => {
      currentBatch = batch({
        ...currentBatch,
        ...patch,
        lockedAt: patch.lockedAt ?? currentBatch.lockedAt ?? null,
        lockReason: patch.lockReason ?? currentBatch.lockReason ?? null,
        reopenReason: patch.reopenReason ?? currentBatch.reopenReason ?? null,
      });
      return currentBatch;
    }),
    listSettlementBatchItems: vi.fn(async () => currentItems),
    listStreamerUserLinks: vi.fn(async () => []),
    listSettlementRuleExceptions: vi.fn(async () => currentExceptions),
    hasOpenSettlementRuleExceptions: vi.fn(
      async () =>
        currentExceptions.some((exception) => exception.status === "review_required"),
    ),
    resolveSettlementRuleException: vi.fn(async (resolution) => {
      currentItems = currentItems.map((currentItem) =>
        currentItem.id === resolution.settlementBatchItemId
          ? { ...currentItem, computedAmount: resolution.newComputedAmount }
          : currentItem,
      );
      const delta = resolution.newComputedAmount - resolution.oldComputedAmount;
      currentBatch = batch({
        ...currentBatch,
        computedAmount: currentBatch.computedAmount + delta,
      });
      currentExceptions = currentExceptions.map((currentException) =>
        currentException.id === resolution.exceptionId
          ? {
              ...currentException,
              status: "resolved",
              resolutionValue: resolution.resolutionValue,
              resolutionReason: resolution.resolutionReason,
              resolvedBy: resolution.resolvedBy,
              resolvedAt: "2026-07-31T00:02:00.000Z",
            }
          : currentException,
      );
      return {
        batch: currentBatch,
        item:
          currentItems.find((candidate) => candidate.id === resolution.settlementBatchItemId) ??
          currentItems[0],
        exception:
          currentExceptions.find((candidate) => candidate.id === resolution.exceptionId) ??
          currentExceptions[0],
      };
    }),
  };
  return repo;
}

function lastAtomicPayload(repo: SettlementRepository) {
  const calls = vi.mocked(repo.createSettlementBatchAtomic).mock.calls;
  const payload = calls.at(-1)?.[0];
  if (!payload) {
    throw new Error("expected settlement batch atomic payload");
  }
  return payload;
}

function executableRepository(
  lookup: Partial<
    Awaited<
      ReturnType<
        CustomRuleProductionRepository["resolveExecutableCustomRuleLayers"]
      >
    >
  >,
): CustomRuleProductionRepository {
  return {
    resolveExecutableCustomRuleLayers: vi.fn(async () => ({
      projectBaseVersion: lookup.projectBaseVersion ?? null,
      groupVersions: lookup.groupVersions ?? [],
      projectStreamerVersions: lookup.projectStreamerVersions ?? [],
      assignmentsByUnitKey: lookup.assignmentsByUnitKey ?? {},
    })),
  };
}

type CustomRuleProductionRepository = Parameters<
  typeof createProductionCustomSettlementExecutionPort
>[0]["repository"] & {};

function ruleVersion(input: {
  id: string;
  scope?: CustomRuleScope;
  target?:
    | { targetType: "project"; targetId: null }
    | { targetType: "streamer_group" | "project_streamer"; targetId: string };
  priority?: number;
  executionGrain?: CustomSettlementRuleVersion["executionGrain"];
  compositionMode?: CustomSettlementRuleVersion["compositionMode"];
  formula: string;
}): CustomSettlementRuleVersion {
  const scope = input.scope ?? "payable";
  const executionGrain = input.executionGrain ?? "report";
  const compositionMode = input.compositionMode ?? "replace";
  const compiled = validateCustomRuleFormula(input.formula, {
    scope,
    executionGrain,
    compositionMode,
  });
  if (!compiled.ok) {
    throw new Error(`test formula did not compile: ${compiled.issues[0]?.code}`);
  }
  return {
    id: input.id,
    organizationId: ORG_ID,
    projectId: PROJECT_ID,
    scope,
    target: input.target ?? { targetType: "project", targetId: null },
    priority: input.priority ?? 0,
    versionNumber: 1,
    status: "active",
    executionGrain,
    compositionMode,
    formula: input.formula,
    formulaHash: `${input.id}-formula-hash`,
    contractHash: `${input.id}-contract-hash`,
    compiledAst:
      compiled.compiledAst as unknown as CustomSettlementRuleVersion["compiledAst"],
    variables: [],
    ruleContract: {
      schemaVersion: 1,
      scope,
      target: input.target ?? { targetType: "project", targetId: null },
      executionGrain,
      compositionMode,
      title: input.id,
      summary: "Production golden path fixture.",
      calculationComponents: [
        {
          name: "final",
          description: "Final amount",
          expression: "final",
          resultType: { kind: "scalar", scalarType: "money_cents" },
        },
      ],
      businessTimezone: "Asia/Shanghai",
      requiredInputs: [],
      parameters: [],
      effectiveStartAt: "2026-07-01T00:00:00.000Z",
      effectiveEndAt: null,
      missingDataPolicy: { action: "block_batch" },
      compositionDescription: "Golden path test composition.",
      examples: [],
    } as CustomSettlementRuleVersion["ruleContract"],
    systemExplanationTemplate: "Golden path calculation.",
    missingDataPolicy: { action: "block_batch" },
    testCases: [],
    simulationSummary: {},
    parameters: {},
    parameterHash: `${input.id}-parameter-hash`,
    catalogHash: `${input.id}-catalog-hash`,
    dataSelectionHash: `${input.id}-data-selection-hash`,
    simulationId: null,
    effectiveFrom: "2026-07-01T00:00:00.000Z",
    effectiveUntil: null,
    createdBy: owner.userId,
    approvedBy: owner.userId,
    aiDraftId: null,
    reason: "Golden path fixture",
    createdAt: "2026-07-01T00:00:00.000Z",
    approvedAt: "2026-07-01T00:00:00.000Z",
    archivedAt: null,
  };
}

function executorBackedPort(input: {
  layer: ExecutableCustomRuleLayer;
}): CustomSettlementExecutionPort {
  return {
    resolveAndExecute: vi.fn(
      async (
        productionInput: Parameters<
          CustomSettlementExecutionPort["resolveAndExecute"]
        >[0],
      ) => {
        const result = executeCustomSettlementRulePipeline({
          planExecutionUnits: () =>
            productionInput.reports.map((sourceReport: SettlementPoolReport) =>
              executionUnit(sourceReport),
            ),
          resolveLayers: () => ({ base: input.layer, groupLayers: [] }),
          buildExecutionContext: () => ({}),
        });
        if (result.kind === "blocked") {
          throw result.error;
        }
        return {
          items: [
            ...result.snapshots.map((snapshot) =>
              customItem({
                streamerId: "streamer-1",
                sourceReportIds: snapshot.sourceReportIds,
                computedAmountCents: snapshot.finalAmountCents,
                evidenceSnapshot: {
                  ruleEngine: {
                    mode: "custom",
                    appliedLayers: snapshot.appliedLayers,
                    missingDataDecisions: snapshot.appliedLayers.flatMap(
                      (layer) => layer.missingDataDecisions,
                    ),
                    sourceReportIds: snapshot.sourceReportIds,
                  },
                },
              }),
            ),
            ...(result.kind === "review"
              ? result.exceptions.map((exception) =>
                  customItem({
                    streamerId: "streamer-1",
                    sourceReportIds: ["report-review"],
                    computedAmountCents: 0,
                    reviewRouted: true,
                    evidenceSnapshot: {
                      ruleEngine: {
                        mode: "custom",
                        missingDataDecisions: [exception],
                        sourceReportIds: ["report-review"],
                      },
                    },
                    exceptions: [
                      {
                        liveReportId: "report-review",
                        ruleVersionId: exception.ruleVersionId,
                        layerSnapshot: exception.layerSnapshot ?? {},
                        variableName: exception.variable,
                        policy: "route_item_to_review",
                      },
                    ],
                  }),
                )
              : []),
          ],
        };
      },
    ),
  };
}

function executionUnit(sourceReport: SettlementPoolReport): CustomRuleExecutionUnit {
  return {
    key: `report:${PROJECT_ID}:${sourceReport.id}`,
    grain: "report",
    projectId: PROJECT_ID,
    projectStreamerId: sourceReport.projectStreamerId ?? sourceReport.streamerId,
    streamerId: sourceReport.streamerId,
    periodStart: "2026-07-01T00:00:00.000Z",
    periodEnd: "2026-08-01T00:00:00.000Z",
    sourceReportIds: [sourceReport.id],
    membershipSnapshot: {
      projectStreamerId: sourceReport.projectStreamerId ?? sourceReport.streamerId,
      effectiveAt: sourceReport.createdAt,
      groups: [],
      snapshotHash: "snapshot-hash",
    },
    variables: {},
  };
}

function executorLayer(input: {
  versionId: string;
  formula: string;
  declarations?: ExecutableCustomRuleLayer["declarations"];
}): ExecutableCustomRuleLayer {
  const compiledAst = compileAst(input.formula);
  const compiledAstHash = hash(compiledAst);
  return {
    versionId: input.versionId,
    target: { targetType: "project", targetId: null },
    priority: 0,
    composition: "replace",
    formulaHash: `${input.versionId}-formula-hash`,
    contractHash: `${input.versionId}-contract-hash`,
    compiledAst,
    compiledAstHash,
    activeCompiledAstHash: compiledAstHash,
    declarations: input.declarations ?? [],
    parameters: {},
    authorized: true,
  };
}

function optionalMoneyInput(
  name: string,
  missingDataPolicy: CustomRuleMissingDataPolicy,
): ExecutableCustomRuleLayer["declarations"][number] {
  return {
    name,
    required: false,
    category: "optional_input",
    valueType: scalar("money_cents"),
    missingDataPolicy,
  };
}

function scalar(scalarType: RuntimeScalarType): RuntimeValueType {
  return { kind: "scalar", scalarType };
}

function customItem(
  input: {
    streamerId?: string;
    sourceReportIds: string[];
    computedAmountCents: number;
    evidenceSnapshot?: Record<string, unknown>;
    reviewRouted?: boolean;
    exceptions?: SettlementBatchAtomicItemInput["exceptions"];
  },
) {
  return {
    streamerId: input.streamerId ?? "streamer-1",
    sourceReportIds: input.sourceReportIds,
    computedAmountCents: input.computedAmountCents,
    evidenceSnapshot:
      input.evidenceSnapshot ??
      {
        ruleEngine: {
          mode: "custom",
          sourceReportIds: input.sourceReportIds,
          namedOutputsCents: { final: input.computedAmountCents },
        },
      },
    reviewRouted: input.reviewRouted ?? false,
    exceptions: input.exceptions,
  };
}

function exceptionRecord(
  patch: Partial<SettlementRuleExceptionRecord> = {},
): SettlementRuleExceptionRecord {
  const compiledAst = compileAst("money_result({ final: gift_amount })");
  return {
    id: "exception-1",
    organizationId: ORG_ID,
    projectId: PROJECT_ID,
    settlementBatchId: "batch-created",
    settlementBatchItemId: "item-1",
    liveReportId: "report-review",
    ruleVersionId: "rule-review",
    layerSnapshot: {
      versionId: "rule-review",
      target: { targetType: "project", targetId: null },
      layer: "project_base",
      composition: "replace",
      compiledAst,
      compiledAstHash: hash(compiledAst),
      activeCompiledAstHash: hash(compiledAst),
      parameters: {},
      typedInputs: {
        prior_layer_amount: { type: "money_cents", amountCents: 0 },
      },
    },
    variableName: "gift_amount",
    policy: "route_item_to_review",
    status: "review_required",
    resolutionValue: null,
    resolutionReason: null,
    createdBy: owner.userId,
    resolvedBy: null,
    createdAt: "2026-07-31T00:01:00.000Z",
    resolvedAt: null,
    ...patch,
  };
}

function ruleEngine(itemInput: SettlementBatchAtomicItemInput) {
  const engine = itemInput.evidenceSnapshot.ruleEngine;
  if (!engine || typeof engine !== "object" || Array.isArray(engine)) {
    throw new Error("expected rule engine snapshot");
  }
  return engine as Record<string, unknown> & {
    appliedLayers?: unknown[];
    membershipAssignmentIds?: string[];
    missingDataDecisions?: unknown[];
    sourceReportIds?: string[];
    grain?: string;
  };
}

function compileAst(formula: string): CompiledAstNode {
  const compiled = validateCustomRuleFormula(formula, {
    scope: "payable",
    executionGrain: "report",
  });
  if (!compiled.ok) {
    throw new Error(`test formula did not compile: ${compiled.issues[0]?.code}`);
  }
  return compiled.compiledAst;
}

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
