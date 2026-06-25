import { describe, expect, it } from "vitest";

import {
  formatMonthlyGrossProfitSnapshot,
  formatPendingReportSnapshot,
  getLoginBusinessSnapshot,
  type LoginSnapshotClient,
} from "./login-business-snapshot";

describe("login business snapshot", () => {
  it("formats a real pending report count for the hero metric", () => {
    expect(formatPendingReportSnapshot(7)).toEqual({
      label: "待审核报数",
      value: "7 笔",
      helper: "须处理",
      isLive: true,
    });
  });

  it("shows an empty state when there are no pending reports", () => {
    expect(formatPendingReportSnapshot(0)).toEqual({
      label: "待审核报数",
      value: "0 笔",
      helper: "已清空",
      isLive: true,
    });
  });

  it("falls back to a sync state when data access is unavailable", () => {
    expect(formatPendingReportSnapshot(null)).toEqual({
      label: "待审核报数",
      value: "实时",
      helper: "同步中",
      isLive: false,
    });
  });

  it("formats monthly gross profit and month-over-month trend", () => {
    expect(
      formatMonthlyGrossProfitSnapshot({
        currentAmount: 67100,
        previousAmount: 53636,
      }),
    ).toEqual({
      label: "本月毛利",
      value: "¥67,100",
      trendLabel: "↑25.1%",
      isLive: true,
    });
    expect(
      formatMonthlyGrossProfitSnapshot({
        currentAmount: 3000,
        previousAmount: 0,
      }),
    ).toMatchObject({ value: "¥3,000", trendLabel: "新增" });
    expect(
      formatMonthlyGrossProfitSnapshot({
        currentAmount: 0,
        previousAmount: -1200,
      }),
    ).toMatchObject({ value: "¥0", trendLabel: "持平" });
    expect(
      formatMonthlyGrossProfitSnapshot({
        currentAmount: null,
        previousAmount: null,
      }),
    ).toEqual({
      label: "本月毛利",
      value: "实时",
      trendLabel: "同步中",
      isLive: false,
    });
  });

  it("queries live report review statuses without exposing report details", async () => {
    const calls: Array<{ method: string; args: unknown[] }> = [];
    const client = {
      from(table: string) {
        calls.push({ method: "from", args: [table] });
        if (table === "live_reports") {
          return {
            select(columns: string, options: unknown) {
              calls.push({ method: "select", args: [columns, options] });
              return {
                in(column: string, values: string[]) {
                  calls.push({ method: "in", args: [column, values] });
                  return Promise.resolve({ count: 12, error: null });
                },
              };
            },
          };
        }

        return {
          select(columns: string) {
            calls.push({ method: "select", args: [columns] });
            return {
              neq(column: string, value: string) {
                calls.push({ method: "neq", args: [column, value] });
                return {
                  gte(columnGte: string, valueGte: string) {
                    calls.push({ method: "gte", args: [columnGte, valueGte] });
                    return {
                      lt(columnLt: string, valueLt: string) {
                        calls.push({ method: "lt", args: [columnLt, valueLt] });
                        return Promise.resolve({ data: [], error: null });
                      },
                    };
                  },
                };
              },
            };
          },
        };
      },
    } as unknown as LoginSnapshotClient;

    await expect(
      getLoginBusinessSnapshot(client, {
        now: new Date("2026-06-15T00:00:00Z"),
      }),
    ).resolves.toMatchObject({
      pendingReports: {
        label: "待审核报数",
        value: "12 笔",
        helper: "须处理",
        isLive: true,
      },
    });
    expect(calls.slice(0, 3)).toEqual([
      { method: "from", args: ["live_reports"] },
      {
        method: "select",
        args: ["id", { count: "exact", head: true }],
      },
      {
        method: "in",
        args: ["status", ["pending_review", "pending_adjudication"]],
      },
    ]);
  });

  it("queries settlement batches and derives current monthly gross profit", async () => {
    const calls: Array<{ method: string; args: unknown[] }> = [];
    const client = {
      from(table: string) {
        calls.push({ method: "from", args: [table] });
        if (table === "live_reports") {
          return {
            select() {
              return {
                in() {
                  return Promise.resolve({ count: 0, error: null });
                },
              };
            },
          };
        }

        return {
          select(columns: string) {
            calls.push({ method: "select", args: [columns] });
            return {
              neq(column: string, value: string) {
                calls.push({ method: "neq", args: [column, value] });
                return {
                  gte(columnGte: string, valueGte: string) {
                    calls.push({ method: "gte", args: [columnGte, valueGte] });
                    return {
                      lt(columnLt: string, valueLt: string) {
                        calls.push({ method: "lt", args: [columnLt, valueLt] });
                        return Promise.resolve({
                          data: [
                            {
                              batch_type: "receivable",
                              period_start: "2026-06-01",
                              computed_amount: 90000,
                              manual_amount: 1000,
                              adjustment_amount: -900,
                            },
                            {
                              batch_type: "payable",
                              period_start: "2026-06-01",
                              computed_amount: 23000,
                              manual_amount: 0,
                              adjustment_amount: 0,
                            },
                            {
                              batch_type: "receivable",
                              period_start: "2026-05-01",
                              computed_amount: 65000,
                              manual_amount: 0,
                              adjustment_amount: 0,
                            },
                            {
                              batch_type: "payable",
                              period_start: "2026-05-01",
                              computed_amount: 11364,
                              manual_amount: 0,
                              adjustment_amount: 0,
                            },
                          ],
                          error: null,
                        });
                      },
                    };
                  },
                };
              },
            };
          },
        };
      },
    } as unknown as LoginSnapshotClient;

    await expect(
      getLoginBusinessSnapshot(client, {
        now: new Date("2026-06-15T00:00:00Z"),
      }),
    ).resolves.toMatchObject({
      monthlyGrossProfit: {
        label: "本月毛利",
        value: "¥67,100",
        trendLabel: "↑25.1%",
        isLive: true,
      },
    });
    expect(calls).toContainEqual({
      method: "from",
      args: ["settlement_batches"],
    });
    expect(calls).toContainEqual({
      method: "select",
      args: [
        "batch_type, period_start, computed_amount, manual_amount, adjustment_amount",
      ],
    });
    expect(calls).toContainEqual({ method: "neq", args: ["status", "voided"] });
    expect(calls).toContainEqual({
      method: "gte",
      args: ["period_start", "2026-05-01"],
    });
    expect(calls).toContainEqual({
      method: "lt",
      args: ["period_start", "2026-07-01"],
    });
  });
});
