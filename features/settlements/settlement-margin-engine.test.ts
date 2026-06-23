import { describe, expect, it } from "vitest";

import {
  buildSettlementBreakdown,
  calculateCollaborationSplit,
  summarizeLineItems,
} from "./settlement-margin-engine";

describe("settlement margin engine", () => {
  it("summarizes revenue and cost into gross margin", () => {
    const summary = summarizeLineItems([
      { direction: "revenue", amount: 1000 },
      { direction: "revenue", amount: 200 },
      { direction: "cost", amount: 300 },
      { direction: "cost", amount: 150.5 },
    ]);
    expect(summary).toEqual({ revenue: 1200, cost: 450.5, grossMargin: 749.5 });
  });

  it("computes percentage split on gross margin (never negative basis)", () => {
    expect(
      calculateCollaborationSplit({
        mode: "percentage",
        sharePercentage: 0.2,
        grossMargin: 1000,
        totalHours: 40,
      }),
    ).toEqual({ basisAmount: 1000, computedAmount: 200 });

    expect(
      calculateCollaborationSplit({
        mode: "percentage",
        sharePercentage: 0.2,
        grossMargin: -500,
        totalHours: 40,
      }),
    ).toEqual({ basisAmount: 0, computedAmount: 0 });
  });

  it("computes hourly fixed split on settlement hours", () => {
    expect(
      calculateCollaborationSplit({
        mode: "hourly_fixed",
        hourlyFixedAmount: 50,
        grossMargin: 1000,
        totalHours: 12.5,
      }),
    ).toEqual({ basisAmount: 12.5, computedAmount: 625 });
  });

  it("builds a project breakdown with per-streamer margins and net margin", () => {
    const breakdown = buildSettlementBreakdown({
      items: [
        { streamerId: "S-1", direction: "revenue", amount: 800 },
        { streamerId: "S-1", direction: "cost", amount: 300 },
        { streamerId: "S-2", direction: "revenue", amount: 400 },
        { streamerId: "S-2", direction: "cost", amount: 100 },
        { streamerId: null, direction: "cost", amount: 50 },
      ],
      mcnSplit: 160,
    });

    expect(breakdown.revenue).toBe(1200);
    expect(breakdown.cost).toBe(450);
    expect(breakdown.grossMargin).toBe(750);
    expect(breakdown.mcnSplit).toBe(160);
    expect(breakdown.netMargin).toBe(590);
    expect(breakdown.byStreamer).toEqual(
      expect.arrayContaining([
        { streamerId: "S-1", revenue: 800, cost: 300, margin: 500 },
        { streamerId: "S-2", revenue: 400, cost: 100, margin: 300 },
        { streamerId: null, revenue: 0, cost: 50, margin: -50 },
      ]),
    );
  });
});
