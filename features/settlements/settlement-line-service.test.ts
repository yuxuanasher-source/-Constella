import { describe, expect, it, vi } from "vitest";

import {
  addSettlementLineItem,
  getSettlementBreakdown,
  recomputeCollaborationSettlement,
  type CollaborationSettlementRecord,
  type SettlementBatchLite,
  type SettlementLineItemRecord,
} from "./settlement-line-service";

const actor = {
  userId: "11111111-1111-1111-1111-111111111111",
  name: "运营",
  role: "ops_manager" as const,
  organizationId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
};

function batch(
  overrides: Partial<SettlementBatchLite> = {},
): SettlementBatchLite {
  return {
    id: "B-1",
    projectId: "P-1",
    organizationId: actor.organizationId,
    status: "generated",
    ...overrides,
  };
}

function lineItem(
  overrides: Partial<SettlementLineItemRecord> = {},
): SettlementLineItemRecord {
  return {
    id: "L-1",
    settlementBatchId: "B-1",
    projectId: "P-1",
    streamerId: null,
    direction: "revenue",
    category: "manufacturer_unit_price",
    label: "厂家单价",
    amount: 1000,
    isSystemGenerated: false,
    ...overrides,
  };
}

describe("settlement line service", () => {
  it("adds a custom line item with a required reason", async () => {
    const repo = {
      getBatch: vi.fn().mockResolvedValue(batch()),
      createLineItem: vi.fn().mockResolvedValue(lineItem({ direction: "cost" })),
    };
    const audit = vi.fn().mockResolvedValue(undefined);

    await addSettlementLineItem({
      repo,
      audit,
      actor,
      batchId: "B-1",
      input: {
        direction: "cost",
        category: "promotion",
        label: "推广成本",
        amount: 300,
        reason: "本期推广投放",
      },
    });

    expect(repo.createLineItem).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "P-1",
        direction: "cost",
        category: "promotion",
        amount: 300,
      }),
    );
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ isHighRisk: true, reason: "本期推广投放" }),
    );
  });

  it("requires a reason for line items", async () => {
    const repo = {
      getBatch: vi.fn().mockResolvedValue(batch()),
      createLineItem: vi.fn(),
    };

    await expect(
      addSettlementLineItem({
        repo,
        audit: vi.fn(),
        actor,
        batchId: "B-1",
        input: { direction: "cost", category: "tax", label: "税费", amount: 50 },
      }),
    ).rejects.toThrow("Adding a settlement line item requires a reason");
  });

  it("blocks edits on a locked batch", async () => {
    const repo = {
      getBatch: vi.fn().mockResolvedValue(batch({ status: "locked" })),
      createLineItem: vi.fn(),
    };

    await expect(
      addSettlementLineItem({
        repo,
        audit: vi.fn(),
        actor,
        batchId: "B-1",
        input: {
          direction: "cost",
          category: "tax",
          label: "税费",
          amount: 50,
          reason: "补税",
        },
      }),
    ).rejects.toThrow("Locked or voided settlement batches cannot be edited");
  });

  it("rejects line item management from finance", async () => {
    const repo = { getBatch: vi.fn(), createLineItem: vi.fn() };

    await expect(
      addSettlementLineItem({
        repo,
        audit: vi.fn(),
        actor: { ...actor, role: "finance" },
        batchId: "B-1",
        input: {
          direction: "cost",
          category: "tax",
          label: "税费",
          amount: 50,
          reason: "补税",
        },
      }),
    ).rejects.toThrow("Current role cannot manage settlement line items");
  });

  it("recomputes a percentage split from gross margin", async () => {
    const repo = {
      getBatch: vi.fn().mockResolvedValue(batch()),
      getCollaboration: vi.fn().mockResolvedValue({
        id: "C-1",
        projectId: "P-1",
        mode: "percentage" as const,
        sharePercentage: 0.2,
        hourlyFixedAmount: null,
      }),
      listLineItems: vi.fn().mockResolvedValue([
        lineItem({ direction: "revenue", amount: 1000 }),
        lineItem({ id: "L-2", direction: "cost", amount: 200 }),
      ]),
      getBatchTotalHours: vi.fn().mockResolvedValue(40),
      upsertCollaborationSettlement: vi
        .fn()
        .mockImplementation(async (input) => ({
          id: "CS-1",
          settlementBatchId: input.settlementBatchId,
          collaborationId: input.collaborationId,
          projectId: input.projectId,
          mode: input.mode,
          sharePercentage: input.sharePercentage,
          hourlyFixedAmount: input.hourlyFixedAmount,
          basisAmount: input.basisAmount,
          totalHours: input.totalHours,
          computedAmount: input.computedAmount,
          manualAmount: 0,
        })),
    };
    const audit = vi.fn().mockResolvedValue(undefined);

    const result = await recomputeCollaborationSettlement({
      repo,
      audit,
      actor,
      batchId: "B-1",
      collaborationId: "C-1",
    });

    // gross margin = 1000 - 200 = 800; 800 * 0.2 = 160
    expect(result.basisAmount).toBe(800);
    expect(result.computedAmount).toBe(160);
    expect(result.totalHours).toBeNull();
  });

  it("recomputes an hourly fixed split from settlement hours", async () => {
    const repo = {
      getBatch: vi.fn().mockResolvedValue(batch()),
      getCollaboration: vi.fn().mockResolvedValue({
        id: "C-1",
        projectId: "P-1",
        mode: "hourly_fixed" as const,
        sharePercentage: null,
        hourlyFixedAmount: 50,
      }),
      listLineItems: vi.fn().mockResolvedValue([
        lineItem({ direction: "revenue", amount: 1000 }),
      ]),
      getBatchTotalHours: vi.fn().mockResolvedValue(12),
      upsertCollaborationSettlement: vi
        .fn()
        .mockImplementation(async (input) => ({
          id: "CS-1",
          ...input,
          manualAmount: 0,
        })),
    };

    const result = await recomputeCollaborationSettlement({
      repo,
      audit: vi.fn(),
      actor,
      batchId: "B-1",
      collaborationId: "C-1",
    });

    // 12 hours * 50 = 600
    expect(result.computedAmount).toBe(600);
    expect(result.totalHours).toBe(12);
  });

  it("rejects collaboration from a different project", async () => {
    const repo = {
      getBatch: vi.fn().mockResolvedValue(batch()),
      getCollaboration: vi.fn().mockResolvedValue({
        id: "C-9",
        projectId: "OTHER",
        mode: "percentage" as const,
        sharePercentage: 0.2,
        hourlyFixedAmount: null,
      }),
      listLineItems: vi.fn(),
      getBatchTotalHours: vi.fn(),
      upsertCollaborationSettlement: vi.fn(),
    };

    await expect(
      recomputeCollaborationSettlement({
        repo,
        audit: vi.fn(),
        actor,
        batchId: "B-1",
        collaborationId: "C-9",
      }),
    ).rejects.toThrow("Collaboration does not belong to this batch project");
  });

  it("builds a breakdown with mcn split netted out", async () => {
    const collab: CollaborationSettlementRecord = {
      id: "CS-1",
      settlementBatchId: "B-1",
      collaborationId: "C-1",
      projectId: "P-1",
      mode: "percentage",
      sharePercentage: 0.2,
      hourlyFixedAmount: null,
      basisAmount: 800,
      totalHours: null,
      computedAmount: 160,
      manualAmount: 0,
    };
    const repo = {
      getBatch: vi.fn().mockResolvedValue(batch()),
      listLineItems: vi.fn().mockResolvedValue([
        lineItem({ direction: "revenue", amount: 1000 }),
        lineItem({ id: "L-2", direction: "cost", amount: 200 }),
      ]),
      listCollaborationSettlements: vi.fn().mockResolvedValue([collab]),
    };

    const breakdown = await getSettlementBreakdown({
      repo,
      actor,
      batchId: "B-1",
    });

    expect(breakdown.revenue).toBe(1000);
    expect(breakdown.cost).toBe(200);
    expect(breakdown.grossMargin).toBe(800);
    expect(breakdown.mcnSplit).toBe(160);
    expect(breakdown.netMargin).toBe(640);
    expect(breakdown.collaborations).toHaveLength(1);
  });
});
