import { createHash } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createSettlementBatchRuleExceptionGate,
  listSettlementRuleExceptions,
  resolveSettlementRuleException,
} from "./custom-rule-exception-service";
import type {
  SettlementBatchItemRecord,
  SettlementBatchRecord,
  SettlementRepository,
  SettlementRuleExceptionRecord,
} from "./settlement-service";
import type { CompiledAstNode, TypedRuntimeValue } from "./custom-rule-types";

type TestSettlementRepository = SettlementRepository &
  Required<
    Pick<
      SettlementRepository,
      | "listSettlementRuleExceptions"
      | "hasOpenSettlementRuleExceptions"
      | "resolveSettlementRuleException"
    >
  >;

const actor = {
  userId: "user-owner",
  name: "Owner",
  role: "owner" as const,
  organizationId: "org-1",
};

const financeActor = {
  ...actor,
  userId: "user-finance",
  role: "finance" as const,
};

const operatorActor = {
  ...actor,
  userId: "user-operator",
  role: "operator_business" as const,
};

const streamerActor = {
  ...actor,
  userId: "user-streamer",
  role: "streamer" as const,
};

function batch(
  patch: Partial<SettlementBatchRecord> = {},
): SettlementBatchRecord {
  return {
    id: "batch-1",
    organizationId: "org-1",
    projectId: "project-1",
    batchType: "payable",
    status: "generated",
    periodStart: "2026-07-01",
    periodEnd: "2026-07-31",
    computedAmount: 10,
    manualAmount: 0,
    adjustmentAmount: 0,
    evidenceSummary: {},
    createdBy: "user-owner",
    lockReason: null,
    reopenReason: null,
    lockedAt: null,
    ...patch,
  };
}

function item(
  patch: Partial<SettlementBatchItemRecord> = {},
): SettlementBatchItemRecord {
  return {
    id: "item-1",
    organizationId: "org-1",
    settlementBatchId: "batch-1",
    projectId: "project-1",
    streamerId: "streamer-1",
    liveReportId: "report-1",
    itemType: "live_report_payable",
    computedAmount: 10,
    manualAmount: 0,
    adjustmentAmount: 0,
    evidenceLevel: "yellow",
    evidenceSnapshot: {
      ruleEngine: {
        mode: "custom",
        typedInputs: [
          {
            prior_layer_amount: { type: "money_cents", amountCents: 0 },
          },
        ],
        sourceReportIds: ["report-1"],
        membershipAssignmentIds: ["assignment-old"],
      },
    },
    ...patch,
  };
}

function exception(
  patch: Partial<SettlementRuleExceptionRecord> = {},
): SettlementRuleExceptionRecord {
  const compiledAst = moneyResultIdentifierAst("reviewed_sales_cents");
  return {
    id: "exception-1",
    organizationId: "org-1",
    projectId: "project-1",
    settlementBatchId: "batch-1",
    settlementBatchItemId: "item-1",
    liveReportId: "report-1",
    ruleVersionId: "rule-version-1",
    layerSnapshot: {
      versionId: "rule-version-1",
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
    variableName: "reviewed_sales_cents",
    policy: "route_item_to_review",
    status: "review_required",
    resolutionValue: null,
    resolutionReason: null,
    createdBy: "user-owner",
    resolvedBy: null,
    createdAt: "2026-07-12T00:00:00.000Z",
    resolvedAt: null,
    ...patch,
  };
}

function createRepo(): TestSettlementRepository {
  return {
    listSettlementPoolReports: vi.fn(),
    getSettlementRules: vi.fn(),
    getProjectSettlementRule: vi.fn(),
    createSettlementBatch: vi.fn(),
    createSettlementBatchItem: vi.fn(),
    createSettlementBatchAtomic: vi.fn(),
    markReportSettled: vi.fn(),
    getSettlementBatchById: vi.fn(async () => batch()),
    updateSettlementBatch: vi.fn(),
    listSettlementBatchItems: vi.fn(async () => [item()]),
    listStreamerUserLinks: vi.fn(),
    listSettlementRuleExceptions: vi.fn(async () => [exception()]),
    hasOpenSettlementRuleExceptions: vi.fn(async () => true),
    resolveSettlementRuleException: vi.fn(async (input) => ({
      batch: batch({ computedAmount: 25 }),
      item: item({ computedAmount: input.newComputedAmount }),
      exception: exception({
        status: "resolved",
        resolutionValue: input.resolutionValue,
        resolutionReason: input.resolutionReason,
        resolvedBy: input.resolvedBy,
        resolvedAt: "2026-07-13T00:00:00.000Z",
      }),
    })),
  };
}

describe("custom rule exception service", () => {
  let repo: TestSettlementRepository;
  const audit = vi.fn(async () => undefined);

  beforeEach(() => {
    repo = createRepo();
    audit.mockClear();
  });

  it("lists batch exceptions for MCN staff and filters cross-organization rows", async () => {
    vi.mocked(repo.listSettlementRuleExceptions).mockResolvedValueOnce([
      exception(),
      exception({ id: "cross-org", organizationId: "org-2" }),
    ]);

    const result = await listSettlementRuleExceptions({
      repo,
      actor: operatorActor,
      batchId: "batch-1",
    });

    expect(result).toEqual([exception()]);
    expect(repo.listSettlementRuleExceptions).toHaveBeenCalledWith({
      organizationId: "org-1",
      batchId: "batch-1",
    });
  });

  it("rejects streamer exception listing", async () => {
    await expect(
      listSettlementRuleExceptions({
        repo,
        actor: streamerActor,
        batchId: "batch-1",
      }),
    ).rejects.toThrow("Only MCN staff can view settlement rule exceptions");
  });

  it("replays the original snapshotted layer with the reviewed typed value and applies the batch total delta", async () => {
    const result = await resolveSettlementRuleException({
      repo,
      audit,
      actor: financeActor,
      batchId: "batch-1",
      exceptionId: "exception-1",
      input: {
        resolutionValue: { type: "money_cents", amountCents: 2500 },
        reason: "Matched finance source sheet",
      },
    });

    expect(result.amountDelta).toBe(15);
    expect(repo.resolveSettlementRuleException).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        exceptionId: "exception-1",
        settlementBatchItemId: "item-1",
        oldComputedAmount: 10,
        newComputedAmount: 25,
        resolutionValue: { type: "money_cents", amountCents: 2500 },
        resolutionReason: "Matched finance source sheet",
        resolvedBy: "user-finance",
      }),
    );
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "update",
        module: "settlement",
        objectType: "settlement_rule_exception",
        objectId: "exception-1",
        projectId: "project-1",
        reason: "Matched finance source sheet",
        isHighRisk: true,
        before: expect.objectContaining({ amountCents: 1000 }),
        after: expect.objectContaining({ amountCents: 2500 }),
      }),
    );
  });

  it("replays subsequent snapshotted modifier layers before applying the amount delta", async () => {
    const currentAst = moneyResultIdentifierAst("reviewed_sales_cents");
    const modifierAst = moneyResultIdentifierAst("bonus_amount");
    vi.mocked(repo.listSettlementRuleExceptions).mockResolvedValueOnce([
      exception({
        layerSnapshot: {
          ...exception().layerSnapshot,
          compiledAst: currentAst,
          compiledAstHash: hash(currentAst),
          activeCompiledAstHash: hash(currentAst),
          typedInputs: {
            prior_layer_amount: { type: "money_cents", amountCents: 0 },
            bonus_amount: { type: "money_cents", amountCents: 500 },
          },
          replayLayers: [
            {
              compiledAst: currentAst,
              compiledAstHash: hash(currentAst),
              activeCompiledAstHash: hash(currentAst),
              parameters: {},
              composition: "replace",
            },
            {
              compiledAst: modifierAst,
              compiledAstHash: hash(modifierAst),
              activeCompiledAstHash: hash(modifierAst),
              parameters: {},
              composition: "add",
            },
          ],
        },
      }),
    ]);

    await resolveSettlementRuleException({
      repo,
      audit,
      actor: financeActor,
      batchId: "batch-1",
      exceptionId: "exception-1",
      input: {
        resolutionValue: { type: "money_cents", amountCents: 2500 },
        reason: "Matched finance source sheet",
      },
    });

    expect(repo.resolveSettlementRuleException).toHaveBeenCalledWith(
      expect.objectContaining({
        oldComputedAmount: 10,
        newComputedAmount: 30,
      }),
    );
  });


  it("requires a reason and typed resolution value", async () => {
    await expect(
      resolveSettlementRuleException({
        repo,
        audit,
        actor: financeActor,
        batchId: "batch-1",
        exceptionId: "exception-1",
        input: {
          resolutionValue: { amountCents: 2500 } as unknown as TypedRuntimeValue,
          reason: " ",
        },
      }),
    ).rejects.toThrow("Resolving a settlement rule exception requires a reason");

    await expect(
      resolveSettlementRuleException({
        repo,
        audit,
        actor: financeActor,
        batchId: "batch-1",
        exceptionId: "exception-1",
        input: {
          resolutionValue: { amountCents: 2500 } as unknown as TypedRuntimeValue,
          reason: "Checked",
        },
      }),
    ).rejects.toThrow("resolutionValue must be a typed runtime value");

    expect(repo.resolveSettlementRuleException).not.toHaveBeenCalled();
  });

  it("lets operators view but not finalize resolutions", async () => {
    await expect(
      resolveSettlementRuleException({
        repo,
        audit,
        actor: operatorActor,
        batchId: "batch-1",
        exceptionId: "exception-1",
        input: {
          resolutionValue: { type: "money_cents", amountCents: 2500 },
          reason: "Ops reviewed",
        },
      }),
    ).rejects.toThrow("Current role cannot resolve settlement rule exceptions");

    expect(repo.resolveSettlementRuleException).not.toHaveBeenCalled();
  });

  it("rejects stale confirmed locked or voided batches before resolution", async () => {
    for (const status of ["confirmed", "locked", "voided"] as const) {
      vi.mocked(repo.getSettlementBatchById).mockResolvedValueOnce(
        batch({ status }),
      );

      await expect(
        resolveSettlementRuleException({
          repo,
          audit,
          actor: financeActor,
          batchId: "batch-1",
          exceptionId: "exception-1",
          input: {
            resolutionValue: { type: "money_cents", amountCents: 2500 },
            reason: "Checked",
          },
        }),
      ).rejects.toThrow(
        "Settlement batch is no longer open for rule exception resolution",
      );
    }
  });

  it("returns duplicate resolutions idempotently and conflicts on different values", async () => {
    vi.mocked(repo.listSettlementRuleExceptions).mockResolvedValueOnce([
      exception({
        status: "resolved",
        resolutionValue: { type: "money_cents", amountCents: 2500 },
        resolutionReason: "Matched finance source sheet",
        resolvedBy: "user-finance",
      }),
    ]);

    await expect(
      resolveSettlementRuleException({
        repo,
        audit,
        actor: financeActor,
        batchId: "batch-1",
        exceptionId: "exception-1",
        input: {
          resolutionValue: { type: "money_cents", amountCents: 2500 },
          reason: "Matched finance source sheet",
        },
      }),
    ).resolves.toMatchObject({ idempotent: true, amountDelta: 0 });

    vi.mocked(repo.listSettlementRuleExceptions).mockResolvedValueOnce([
      exception({
        status: "resolved",
        resolutionValue: { type: "money_cents", amountCents: 2500 },
      }),
    ]);
    await expect(
      resolveSettlementRuleException({
        repo,
        audit,
        actor: financeActor,
        batchId: "batch-1",
        exceptionId: "exception-1",
        input: {
          resolutionValue: { type: "money_cents", amountCents: 2600 },
          reason: "Matched finance source sheet",
        },
      }),
    ).rejects.toThrow(
      "Settlement rule exception was already resolved with a different value",
    );
  });

  it("records sibling exception values and replays only when the last sibling is resolved", async () => {
    const compiledAst = compiledFormulaAst(
      "money_result({ final: first_amount + second_amount })",
    );
    const firstException = exception({
      id: "exception-first",
      variableName: "first_amount",
      layerSnapshot: {
        ...exception().layerSnapshot,
        compiledAst,
        compiledAstHash: hash(compiledAst),
        activeCompiledAstHash: hash(compiledAst),
      },
    });
    const secondException = exception({
      id: "exception-second",
      variableName: "second_amount",
      layerSnapshot: firstException.layerSnapshot,
    });
    vi.mocked(repo.listSettlementRuleExceptions).mockResolvedValueOnce([
      firstException,
      secondException,
    ]);

    await resolveSettlementRuleException({
      repo,
      audit,
      actor: financeActor,
      batchId: "batch-1",
      exceptionId: "exception-first",
      input: {
        resolutionValue: { type: "money_cents", amountCents: 1000 },
        reason: "First checked",
      },
    });

    expect(repo.resolveSettlementRuleException).toHaveBeenLastCalledWith(
      expect.objectContaining({
        exceptionId: "exception-first",
        oldComputedAmount: 10,
        newComputedAmount: 10,
      }),
    );

    vi.mocked(repo.listSettlementRuleExceptions).mockResolvedValueOnce([
      exception({
        ...firstException,
        status: "resolved",
        resolutionValue: { type: "money_cents", amountCents: 1000 },
      }),
      secondException,
    ]);

    await resolveSettlementRuleException({
      repo,
      audit,
      actor: financeActor,
      batchId: "batch-1",
      exceptionId: "exception-second",
      input: {
        resolutionValue: { type: "money_cents", amountCents: 1500 },
        reason: "Second checked",
      },
    });

    expect(repo.resolveSettlementRuleException).toHaveBeenLastCalledWith(
      expect.objectContaining({
        exceptionId: "exception-second",
        oldComputedAmount: 10,
        newComputedAmount: 25,
      }),
    );
  });

  it("creates a confirm and lock gate that blocks open exceptions", async () => {
    const gate = createSettlementBatchRuleExceptionGate({
      repo,
      organizationId: "org-1",
    });

    await expect(gate.assertNoOpenRuleExceptions("batch-1")).rejects.toThrow(
      "Settlement batch has unresolved rule exceptions",
    );
  });
});

function moneyResultIdentifierAst(name: string): CompiledAstNode {
  const money = { kind: "scalar" as const, scalarType: "money_cents" as const };
  return {
    kind: "call",
    callee: "money_result",
    arguments: [
      {
        kind: "object",
        entries: [
          {
            key: "final",
            value: {
              kind: "identifier",
              name,
              inferredType: money,
            },
          },
        ],
        inferredType: { kind: "object", fields: { final: money } },
      },
    ],
    inferredType: { kind: "object", fields: { final: money } },
  };
}

function compiledFormulaAst(formula: string): CompiledAstNode {
  if (formula !== "money_result({ final: first_amount + second_amount })") {
    throw new Error("unsupported test formula");
  }
  const money = { kind: "scalar" as const, scalarType: "money_cents" as const };
  return {
    kind: "call",
    callee: "money_result",
    arguments: [
      {
        kind: "object",
        entries: [
          {
            key: "final",
            value: {
              kind: "binary",
              operator: "+",
              left: {
                kind: "identifier",
                name: "first_amount",
                inferredType: money,
              },
              right: {
                kind: "identifier",
                name: "second_amount",
                inferredType: money,
              },
              inferredType: money,
            },
          },
        ],
        inferredType: { kind: "object", fields: { final: money } },
      },
    ],
    inferredType: { kind: "object", fields: { final: money } },
  };
}

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
