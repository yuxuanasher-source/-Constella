import { describe, expect, it } from "vitest";

import { runSettlementGoldenPathRegression } from "./settlement-golden-path";

describe("P1/P2 settlement golden path", () => {
  it("moves an approved live report into a payable batch and streamer-safe bill", async () => {
    const result = await runSettlementGoldenPathRegression();

    expect(result.task.status).toBe("completed");
    expect(result.report).toMatchObject({
      status: "approved",
      settlementDuration: 120,
      timeSource: "system",
      evidenceLevel: "green",
      enterSettlementPool: true,
    });
    expect(result.poolBeforeBatch).toHaveLength(1);
    expect(result.batch.batchType).toBe("payable");
    expect(result.batch.computedAmount).toBe(160);
    expect(result.batchItems).toEqual([
      expect.objectContaining({
        liveReportId: result.report.id,
        streamerId: "streamer-1",
        computedAmount: 160,
        manualAmount: 0,
      }),
    ]);
    expect(result.batchItems[0].evidenceSnapshot).toMatchObject({
      settlementDuration: 120,
      timeSource: "system",
      evidenceLevel: "green",
    });
    expect(result.batchItems[0].computedAmount).toBe(160);
    expect(result.poolAfterBatch).toHaveLength(0);
    expect(result.streamerBill.currentMonth).toMatchObject({
      month: "2026-06",
      earned: 160,
      pending: 0,
      hours: 2,
    });
    expect(JSON.stringify(result.streamerBill)).not.toMatch(
      /receivable|gross|margin|cost/i,
    );
    expect(result.auditActions).toEqual(
      expect.arrayContaining([
        "live_report:create",
        "live_report:approve",
        "settlement_batch:create",
      ]),
    );
  });
});
