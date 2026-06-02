import { describe, expect, it } from "vitest";

import {
  toStreamerEarningsSummary,
  toStreamerPayableItem,
  type StreamerPayableSafeRow,
} from "./streamer-settlement-queries";

const rows: StreamerPayableSafeRow[] = [
  {
    id: "item-1",
    project_name: "Launch Week",
    period_start: "2026-05-01",
    period_end: "2026-05-31",
    computed_amount: 160,
    manual_amount: 0,
    adjustment_amount: 0,
    payable_amount: 160,
    evidence_level: "green",
    evidence_snapshot: {
      settlementDuration: 120,
      timeSource: "system",
    },
    created_at: "2026-05-20T12:00:00.000Z",
  },
  {
    id: "item-2",
    project_name: "Launch Week",
    period_start: "2026-05-01",
    period_end: "2026-05-31",
    computed_amount: 0,
    manual_amount: 300,
    adjustment_amount: -20,
    payable_amount: 280,
    evidence_level: "red",
    evidence_snapshot: {
      source: "manual",
      itemType: "cpa",
      reason: "Imported CPA",
    },
    created_at: "2026-05-21T12:00:00.000Z",
  },
  {
    id: "item-3",
    project_name: "April Project",
    period_start: "2026-04-01",
    period_end: "2026-04-30",
    computed_amount: 500,
    manual_amount: 0,
    adjustment_amount: 0,
    payable_amount: 500,
    evidence_level: "green",
    evidence_snapshot: {
      settlementDuration: 300,
      timeSource: "system",
    },
    created_at: "2026-04-20T12:00:00.000Z",
  },
];

describe("streamer settlement safe DTO", () => {
  it("maps payable safe rows without exposing receivable profit or cost fields", () => {
    const item = toStreamerPayableItem(rows[0]);

    expect(item).toEqual({
      id: "item-1",
      projectName: "Launch Week",
      month: "2026-05",
      amount: 160,
      computedAmount: 160,
      manualAmount: 0,
      adjustmentAmount: 0,
      hours: 2,
      evidence: "green 路 system",
      source: "live_report",
      createdAt: "2026-05-20T12:00:00.000Z",
    });
    expect(JSON.stringify(item)).not.toContain("receivable");
    expect(JSON.stringify(item)).not.toContain("gross");
    expect(JSON.stringify(item)).not.toContain("cost");
  });

  it("summarizes current and historical payable amounts for streamer mobile", () => {
    const summary = toStreamerEarningsSummary(rows, {
      currentMonth: "2026-05",
    });

    expect(summary).toEqual({
      currentMonth: {
        month: "2026-05",
        earned: 440,
        pending: 0,
        finalized: false,
        hours: 2,
      },
      history: [
        { month: "2026-05", earned: 440 },
        { month: "2026-04", earned: 500 },
      ],
      items: [
        expect.objectContaining({ id: "item-1", amount: 160 }),
        expect.objectContaining({ id: "item-2", amount: 280 }),
        expect.objectContaining({ id: "item-3", amount: 500 }),
      ],
    });
  });
});
