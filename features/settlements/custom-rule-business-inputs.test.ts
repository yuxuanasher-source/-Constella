import { describe, expect, it } from "vitest";

import { adaptCustomRuleBusinessInputs } from "./custom-rule-business-inputs";

describe("adaptCustomRuleBusinessInputs", () => {
  it("joins confirmed normalized import rows by explicit IDs and compatible periods", () => {
    const result = adaptCustomRuleBusinessInputs({
      reports: [
        report("live-1", "streamer-1"),
        report("live-2", "streamer-1"),
      ],
      rows: [
        row({
          importBatchId: "batch-b",
          rowIndex: 1,
          liveReportId: "live-2",
          salesAmountCents: 2000,
          ordersCount: 2,
          giftAmountCents: 500,
          ignoredRawName: "must not enter context",
        }),
        row({
          importBatchId: "batch-a",
          rowIndex: 1,
          liveReportId: "live-1",
          salesAmountCents: 1000,
          ordersCount: 1,
          giftAmountCents: 300,
        }),
      ],
    });

    expect(result.errors).toEqual([]);
    expect(result.variablesByReportId).toEqual({
      "live-1": {
        sales_amount: { type: "money_cents", amountCents: 1000 },
        orders_count: { type: "integer", value: 1 },
        gift_amount: { type: "money_cents", amountCents: 300 },
      },
      "live-2": {
        sales_amount: { type: "money_cents", amountCents: 2000 },
        orders_count: { type: "integer", value: 2 },
        gift_amount: { type: "money_cents", amountCents: 500 },
      },
    });
    expect(JSON.stringify(result.executionSnapshot)).not.toContain(
      "ignoredRawName",
    );
    expect(result.executionSnapshot.sources.map((source) => source.rowIndex))
      .toEqual([1, 1]);
  });

  it("sums additive fields in stable source order", () => {
    const result = adaptCustomRuleBusinessInputs({
      reports: [report("live-1", "streamer-1")],
      rows: [
        row({
          importBatchId: "batch-b",
          rowIndex: 2,
          liveReportId: "live-1",
          salesAmountCents: 50,
          ordersCount: 1,
        }),
        row({
          importBatchId: "batch-a",
          rowIndex: 1,
          liveReportId: "live-1",
          salesAmountCents: 100,
          ordersCount: 2,
        }),
      ],
    });

    expect(result.variablesByReportId["live-1"]).toMatchObject({
      sales_amount: { type: "money_cents", amountCents: 150 },
      orders_count: { type: "integer", value: 3 },
    });
    expect(result.executionSnapshot.sources.map((source) => source.importBatchId))
      .toEqual(["batch-a", "batch-b"]);
  });

  it("turns duplicate non-additive conflicts and fuzzy rows into missing-data errors", () => {
    const result = adaptCustomRuleBusinessInputs({
      reports: [report("live-1", "streamer-1")],
      rows: [
        row({
          liveReportId: "live-1",
          streamerId: "streamer-1",
          salesAmountCents: 100,
        }),
        row({
          liveReportId: "live-1",
          streamerId: "streamer-other",
          salesAmountCents: 200,
        }),
        row({
          liveReportId: undefined,
          streamerId: "streamer-1",
          salesAmountCents: 300,
        }),
      ],
    });

    expect(result.variablesByReportId).toEqual({});
    expect(result.errors.map((error) => error.code)).toEqual([
      "NON_ADDITIVE_CONFLICT",
      "EXPLICIT_REPORT_ID_REQUIRED",
    ]);
  });

  it("requires compatible report periods", () => {
    const result = adaptCustomRuleBusinessInputs({
      reports: [report("live-1", "streamer-1")],
      rows: [
        row({
          liveReportId: "live-1",
          periodStart: "2026-06-01",
          periodEnd: "2026-07-01",
          salesAmountCents: 100,
        }),
      ],
    });

    expect(result.variablesByReportId).toEqual({});
    expect(result.errors).toMatchObject([
      { code: "INCOMPATIBLE_PERIOD", liveReportId: "live-1" },
    ]);
  });
});

function report(liveReportId: string, streamerId: string) {
  return {
    liveReportId,
    streamerId,
    periodStart: "2026-07-01",
    periodEnd: "2026-08-01",
  };
}

function row(
  overrides: Partial<
    Parameters<typeof adaptCustomRuleBusinessInputs>[0]["rows"][number]
  > &
    Record<string, unknown>,
): Parameters<typeof adaptCustomRuleBusinessInputs>[0]["rows"][number] {
  return {
    importBatchId: "batch-a",
    rowIndex: 1,
    liveReportId: "live-1",
    streamerId: "streamer-1",
    periodStart: "2026-07-01",
    periodEnd: "2026-08-01",
    ...overrides,
  };
}
